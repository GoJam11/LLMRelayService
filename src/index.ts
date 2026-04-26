/**
 * LLM Gateway - Bun + Hono
 * 统一域名，按路径前缀透传到不同 AI 后端
 */

import { Hono } from 'hono';
import { proxy } from 'hono/proxy';
import { DEFAULT_OPENAI_RESPONSES_MODE, ensureProviderConfigsLoaded, getModels, resolveRoute, resolveRouteByModel, type RouteResult } from './config';
import { trackPendingConsoleRequestWrite } from './console-log-tasks';
import { saveConsoleRequest, type ForwardHeadersSummary, type PayloadSummaryForConsole } from './console-store';
import { registerConsoleRoutes } from './console-ui';
import { buildForwardHeadersForProvider, prepareRequestForProvider, type UpstreamType, type UsageData, parseUsageForProvider, summarizePayloadForProvider, detectRequestKindForProvider } from './providers';
import { finalizeProxyResponse } from './response-observer';
import { authenticateManagedApiKey } from './api-keys';
import { recordRequestPerfSample, trackRequestStart, trackRequestEnd } from './perf-monitor';
import { elapsedPerfMs, getMaxPerfPhase, nowPerfMs, roundPerfMs, shouldLogRequestPerf } from './perf-detail';
import { PAYLOAD_LOG_LIMIT_BYTES } from './logging-constants';
import { ensureModelCatalogLoaded, lookupModelContext } from './model-catalog';
import { initializeTokenEstimator } from './token-estimator';
import {
  convertResponsesRequestToChatCompletions,
  createResponsesChatCompatErrorResponse,
  isOpenAiResponsesEndpointPath,
  rewriteResponsesTargetUrlToChatCompletions,
  transformChatCompletionsResponseToResponses,
} from './openai-responses-chat-compat';

const SYNTHETIC_MODEL_CREATED = 0;
const SYNTHETIC_ANTHROPIC_MODEL_CREATED_AT = '1970-01-01T00:00:00Z';

interface AnalyticsDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

interface AnalyticsDataset {
  writeDataPoint(dataPoint: AnalyticsDataPoint): void;
}

export interface Env {
  LLM_STATUS?: AnalyticsDataset;
}

interface GatewayCredentialCandidate {
  header: 'x-api-key' | 'authorization';
  credential: string;
}

function buildGatewayErrorResponse(
  upstreamType: UpstreamType,
  status: number,
  message: string,
  details?: string,
): Response {
  if (upstreamType === 'openai') {
    return Response.json({
      error: {
        message: details ? `${message}: ${details}` : message,
        type: status === 401 ? 'authentication_error' : 'api_error',
        code: null,
        param: null,
      },
    }, { status });
  }

  return Response.json({
    error: message,
    ...(details ? { details } : {}),
  }, { status });
}

function readGatewayCredentials(headers: Headers): GatewayCredentialCandidate[] {
  const candidates: GatewayCredentialCandidate[] = [];
  const seen = new Set<string>();

  const xApiKey = headers.get('x-api-key')?.trim();
  if (xApiKey) {
    candidates.push({ header: 'x-api-key', credential: xApiKey });
    seen.add(xApiKey);
  }

  const authorization = headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const bearerToken = match?.[1]?.trim();
  if (bearerToken && !seen.has(bearerToken)) {
    candidates.push({ header: 'authorization', credential: bearerToken });
  }

  return candidates;
}

async function authenticateGateway(headers: Headers, upstreamType: UpstreamType): Promise<{ ok: true; apiKeyInfo: { id: string; name: string } | null } | { ok: false; response: Response }> {
  const adminGatewayKey = process.env.GATEWAY_API_KEY;
  const providedCredentials = readGatewayCredentials(headers);

  if (providedCredentials.length === 0) {
    return {
      ok: false,
      response: buildGatewayErrorResponse(
        upstreamType,
        401,
        '缺少 x-api-key 或 Authorization: Bearer token',
      ),
    };
  }

  if (adminGatewayKey && providedCredentials.some(({ credential }) => credential === adminGatewayKey)) {
    return { ok: true, apiKeyInfo: null };
  }

  for (const { credential } of providedCredentials) {
    const managedApiKey = await authenticateManagedApiKey(credential);
    if (managedApiKey) {
      return { ok: true, apiKeyInfo: managedApiKey };
    }
  }

  if (!adminGatewayKey) {
    return {
      ok: false,
      response: buildGatewayErrorResponse(upstreamType, 503, '网关未配置管理员 key，且提供的凭证无效'),
    };
  }

  return {
    ok: false,
    response: buildGatewayErrorResponse(upstreamType, 401, '网关认证失败'),
  };
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS = 30_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

interface TruncatedPayloadForLog {
  payload: string;
  originalBytes: number;
  loggedBytes: number;
  truncated: boolean;
  truncationReason?: string;
}

type PayloadSummaryForLog = PayloadSummaryForConsole;

function truncatePayloadForLog(rawPayload: string, maxBytes = PAYLOAD_LOG_LIMIT_BYTES): TruncatedPayloadForLog {
  const bytes = utf8Encoder.encode(rawPayload);
  if (bytes.length <= maxBytes) {
    return {
      payload: rawPayload,
      originalBytes: bytes.length,
      loggedBytes: bytes.length,
      truncated: false,
    };
  }

  const truncatedBytes = bytes.slice(0, maxBytes);
  return {
    payload: utf8Decoder.decode(truncatedBytes),
    originalBytes: bytes.length,
    loggedBytes: maxBytes,
    truncated: true,
    truncationReason: 'body too large',
  };
}

function summarizeHeadersForLog(headers: Headers): ForwardHeadersSummary {
  return {
    authorization: headers.has('authorization') ? 'present' : 'missing',
    user_agent: headers.get('user-agent') ?? '',
    x_app: headers.get('x-app') ?? '',
    anthropic_beta: headers.get('anthropic-beta') ?? '',
    anthropic_version: headers.get('anthropic-version') ?? '',
    anthropic_dangerous_direct_browser_access: headers.get('anthropic-dangerous-direct-browser-access') ?? '',
    x_stainless_arch: headers.get('x-stainless-arch') ?? '',
    x_stainless_lang: headers.get('x-stainless-lang') ?? '',
    x_stainless_package_version: headers.get('x-stainless-package-version') ?? '',
  };
}

function captureOriginalHeaders(headers: Headers): Record<string, string> {
  const sensitiveKeys = new Set(['authorization', 'x-api-key', 'cookie']);
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = sensitiveKeys.has(key.toLowerCase()) ? `[redacted, length=${value.length}]` : value;
  });
  return result;
}

function applyCorsHeaders(headers: Headers): void {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
}

function getUpstreamRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.UPSTREAM_REQUEST_TIMEOUT_MS || `${DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPSTREAM_REQUEST_TIMEOUT_MS;
}

function createUpstreamResponseStartTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Upstream response start timeout', 'TimeoutError'));
  }, timeoutMs);
  if (typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref();
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function buildUpstreamSearch(url: URL): string {
  const searchParams = new URLSearchParams(url.search);

  const search = searchParams.toString();
  return search ? `?${search}` : '';
}

function extractModelFromRequestBody(rawPayload: string | null): string | null {
  if (rawPayload == null) return null;

  try {
    const json = JSON.parse(rawPayload) as Record<string, unknown>;
    return typeof json.model === 'string' && json.model.length > 0 ? json.model : null;
  } catch {
    return null;
  }
}

function addPerfPhase(phases: Record<string, number>, name: string, durationMs: number): void {
  phases[name] = roundPerfMs((phases[name] ?? 0) + durationMs);
}

const app = new Hono<{ Bindings: Env }>();

export function parseResponseUsage(body: string, upstreamType: UpstreamType = 'anthropic'): UsageData {
  return parseUsageForProvider(body, upstreamType);
}

function buildOpenAiModelsPayload(type?: UpstreamType) {
  const models = type == null
    ? getModels()
    : getModels().filter((model) => model.type === type);
  return {
    object: 'list',
    data: models.map((model) => {
      const contextWindow = model.context ?? lookupModelContext(model.id);
      return {
        id: model.id,
        object: 'model',
        created: SYNTHETIC_MODEL_CREATED,
        owned_by: 'ai-proxy',
        ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
      };
    }),
  };
}

function buildAnthropicModelsPayload(type?: UpstreamType) {
  const models = type == null
    ? getModels()
    : getModels().filter((model) => model.type === type);

  const data = models
    .map((model) => ({
      type: 'model' as const,
      id: model.id,
      display_name: model.id,
      created_at: SYNTHETIC_ANTHROPIC_MODEL_CREATED_AT,
    }));

  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}

app.get('/v1/models', async (c) => {
  await ensureProviderConfigsLoaded();
  await ensureModelCatalogLoaded();
  return c.json(buildOpenAiModelsPayload());
});

app.get('/openai/v1/models', async (c) => {
  await ensureProviderConfigsLoaded();
  await ensureModelCatalogLoaded();
  return c.json(buildOpenAiModelsPayload('openai'));
});

app.get('/anthropic/v1/models', async (c) => {
  await ensureProviderConfigsLoaded();
  await ensureModelCatalogLoaded();
  return c.json(buildAnthropicModelsPayload('anthropic'));
});

registerConsoleRoutes(app);

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  await next();
  applyCorsHeaders(c.res.headers);
});

app.all('*', async (c) => {
  trackRequestStart();
  try {
    return await handleProxyRequest(c);
  } finally {
    trackRequestEnd();
  }
});

/**
 * 检测 /openai/* 和 /anthropic/* 类型强制前缀
 * 返回剥离前缀后的路径和对应的 provider 类型，否则返回 null
 */
function parseTypeForcedPrefix(pathname: string): { strippedPath: string; type: UpstreamType } | null {
  if (pathname.startsWith('/openai/')) {
    return { strippedPath: pathname.slice('/openai'.length), type: 'openai' };
  }
  if (pathname.startsWith('/anthropic/')) {
    return { strippedPath: pathname.slice('/anthropic'.length), type: 'anthropic' };
  }
  return null;
}

async function handleProxyRequest(c: any): Promise<Response> {
  const requestPerfStart = nowPerfMs();
  const requestPerfPhases: Record<string, number> = {};
  const configStart = nowPerfMs();
  await ensureProviderConfigsLoaded();
  addPerfPhase(requestPerfPhases, 'ensure_provider_configs_ms', elapsedPerfMs(configStart));
  const url = new URL(c.req.url);
  const upstreamSearch = buildUpstreamSearch(url);
  const requestId = crypto.randomUUID().slice(0, 8);
  const requestCreatedPerfAt = nowPerfMs();
  const requestCreatedAt = Date.now();
  let requestChannelName: string | null = null;
  let resolvedChannelName: string | null = null;
  let lastForwardedPayloadChars = 0;

  const emitRequestPerf = (status: number): void => {
    const totalMs = elapsedPerfMs(requestPerfStart);
    const slowestPhase = getMaxPerfPhase(requestPerfPhases);
    recordRequestPerfSample({
      request_id: requestId,
      path: url.pathname + url.search,
      total_ms: totalMs,
      status,
      slowest_phase: slowestPhase.name,
      slowest_phase_ms: slowestPhase.ms,
    });
    if (!shouldLogRequestPerf(totalMs)) return;
    console.log(`[REQ_PERF] ${c.req.method} ${url.pathname + url.search} | status=${status} | total=${totalMs}ms`);
  };

  let rawPayloadForLog: string | null = null;
  let originalPayloadForStore: string | null = null;
  let originalSummaryForLog: PayloadSummaryForLog | null = null;
  let originalRequestModel = 'unknown';

  if (c.req.method === 'POST') {
    const readBodyStart = nowPerfMs();
    try {
      const requestBodyText = await c.req.raw.clone().text();
      rawPayloadForLog = requestBodyText;
      originalPayloadForStore = requestBodyText;
      const payloadForLog = truncatePayloadForLog(requestBodyText);
      const logOriginalPayloadStart = nowPerfMs();
      console.log('[REQ_PAYLOAD_ORIG]', {
        request_id: requestId,
        method: c.req.method,
        path: url.pathname + url.search,
        original_bytes: payloadForLog.originalBytes,
        logged_bytes: payloadForLog.loggedBytes,
        truncated: payloadForLog.truncated,
        truncation_reason: payloadForLog.truncationReason,
      });
      addPerfPhase(requestPerfPhases, 'log_req_payload_orig_ms', elapsedPerfMs(logOriginalPayloadStart));
    } catch (e) {
      console.warn('[REQ_PAYLOAD_READ_ERR]', { request_id: requestId, path: url.pathname + url.search, error: e });
    }
    addPerfPhase(requestPerfPhases, 'read_body_ms', elapsedPerfMs(readBodyStart));
  }

  const routeLookupStart = nowPerfMs();
  // 检测 /openai/* 和 /anthropic/* 类型强制前缀
  const typeForced = parseTypeForcedPrefix(url.pathname);
  const lookupPathname = typeForced?.strippedPath ?? url.pathname;
  const explicitRoute = resolveRoute(lookupPathname, upstreamSearch);
  const modelRoutedInitialRoute = explicitRoute
    ? null
    : resolveRouteByModel(lookupPathname, upstreamSearch, extractModelFromRequestBody(rawPayloadForLog) ?? '', typeForced?.type);
  const initialRoute = explicitRoute ?? modelRoutedInitialRoute;
  requestChannelName = explicitRoute?.channelName ?? null;
  addPerfPhase(requestPerfPhases, 'route_lookup_ms', elapsedPerfMs(routeLookupStart));

  if (!initialRoute) {
    const requestedModel = extractModelFromRequestBody(rawPayloadForLog);
    const errorMessage = requestedModel
      ? `模型 '${requestedModel}' 未配置或不可用`
      : '未找到有效的服务配置';
    const badRequestResponse = c.json({ error: errorMessage }, 400);
    emitRequestPerf(badRequestResponse.status);
    return badRequestResponse;
  }

  if (rawPayloadForLog != null) {
    const summarizeOriginalStart = nowPerfMs();
    const payloadSummary = summarizePayloadForProvider(rawPayloadForLog, initialRoute.type);
    originalSummaryForLog = payloadSummary;
    if (payloadSummary?.model) originalRequestModel = payloadSummary.model;
    addPerfPhase(requestPerfPhases, 'summarize_original_ms', elapsedPerfMs(summarizeOriginalStart));
    if (payloadSummary) {
      const logOriginalSummaryStart = nowPerfMs();
      console.log('[REQ_PAYLOAD_ORIG_SUMMARY]', {
        request_id: requestId,
        path: url.pathname + url.search,
        ...payloadSummary,
      });
      addPerfPhase(requestPerfPhases, 'log_req_payload_orig_summary_ms', elapsedPerfMs(logOriginalSummaryStart));
    }
  }

  const authStart = nowPerfMs();
  const gatewayAuth = await authenticateGateway(c.req.raw.headers, initialRoute.type);
  addPerfPhase(requestPerfPhases, 'auth_ms', elapsedPerfMs(authStart));
  if (!gatewayAuth.ok) {
    applyCorsHeaders(gatewayAuth.response.headers);
    emitRequestPerf(gatewayAuth.response.status);
    return gatewayAuth.response;
  }
  const matchedApiKey = gatewayAuth.apiKeyInfo;
  const route: RouteResult = initialRoute;
  resolvedChannelName = route.channelName;
  const routeTargetPathname = (() => {
    try {
      return new URL(route.targetUrl).pathname;
    } catch {
      return '';
    }
  })();
  const isOpenAiResponsesRequest = c.req.method === 'POST'
    && route.type === 'openai'
    && (isOpenAiResponsesEndpointPath(lookupPathname) || routeTargetPathname.endsWith('/responses'));
  const responsesMode = route.type === 'openai'
    ? (route.responsesMode ?? DEFAULT_OPENAI_RESPONSES_MODE)
    : DEFAULT_OPENAI_RESPONSES_MODE;
  const adaptResponsesToChatCompletions = isOpenAiResponsesRequest && responsesMode === 'chat_compat';
  const responsesDisabled = isOpenAiResponsesRequest && responsesMode === 'disabled';
  const upstreamTargetUrl = adaptResponsesToChatCompletions
    ? rewriteResponsesTargetUrlToChatCompletions(route.targetUrl)
    : route.targetUrl;

  let body: BodyInit | null | undefined;
  let requestModel = originalRequestModel;
  let forwardedPayload: string | null = null;
  let forwardedPayloadForStore: string | null = null;
  let forwardedSummaryForLog: PayloadSummaryForLog | null = null;
  let sourceRequestType = 'unknown';

  const buildHeadersStart = nowPerfMs();
  const forwardHeaders = buildForwardHeadersForProvider(
    c.req.raw.headers,
    route.type,
    route.auth,
  );
  addPerfPhase(requestPerfPhases, 'build_forward_headers_ms', elapsedPerfMs(buildHeadersStart));

  const summarizeHeadersStart = nowPerfMs();
  const headersSummary = summarizeHeadersForLog(forwardHeaders);
  addPerfPhase(requestPerfPhases, 'summarize_headers_ms', elapsedPerfMs(summarizeHeadersStart));

  const returnLoggedLocalResponse = (
    localResponse: Response,
    logTag: string,
    logDetails: Record<string, unknown>,
  ): Response => {
    const detectRequestTypeStart = nowPerfMs();
    sourceRequestType = detectRequestKindForProvider(
      originalPayloadForStore,
      route.type,
      c.req.raw.headers,
    );
    addPerfPhase(requestPerfPhases, 'detect_request_type_ms', elapsedPerfMs(detectRequestTypeStart));

    const queueConsoleWriteStart = nowPerfMs();
    const originalPayloadForRecord = originalPayloadForStore == null
      ? null
      : truncatePayloadForLog(originalPayloadForStore);
    trackPendingConsoleRequestWrite(requestId, () => saveConsoleRequest({
      request_id: requestId,
      created_at: requestCreatedAt,
      route_prefix: route.channelName,
      upstream_type: route.type,
      method: c.req.method,
      path: url.pathname + url.search,
      target_url: upstreamTargetUrl,
      request_model: requestModel,
      api_key_id: matchedApiKey?.id ?? null,
      api_key_name: matchedApiKey?.name ?? null,
      original_payload: originalPayloadForRecord?.payload ?? null,
      original_payload_truncated: originalPayloadForRecord?.truncated ?? false,
      original_summary: originalSummaryForLog,
      forwarded_payload: null,
      forwarded_payload_truncated: false,
      forwarded_summary: null,
      original_headers: captureOriginalHeaders(c.req.raw.headers),
      forward_headers: headersSummary,
      failover_from: null,
      failover_chain: [],
      original_route_prefix: null,
      original_request_model: null,
      failover_reason: null,
      source_request_type: sourceRequestType as any,
    }));
    addPerfPhase(requestPerfPhases, 'queue_console_request_ms', elapsedPerfMs(queueConsoleWriteStart));

    console.warn(logTag, {
      request_id: requestId,
      path: url.pathname + url.search,
      target_url: upstreamTargetUrl,
      ...logDetails,
    });
    console.log('[REQ_HEADERS_FWD]', {
      request_id: requestId,
      path: url.pathname + url.search,
      target_url: upstreamTargetUrl,
      headers: headersSummary,
    });
    console.log('[RES]', { request_id: requestId, status: localResponse.status, status_text: localResponse.statusText || 'Error' });

    const finalizeStart = nowPerfMs();
    const response = finalizeProxyResponse({
      response: localResponse,
      requestId,
      path: url.pathname + url.search,
      shouldLog: true,
      createdAt: requestCreatedAt,
      createdAtPerf: requestCreatedPerfAt,
      upstreamType: route.type,
      truncatePayloadForLog,
      requestBody: rawPayloadForLog ?? undefined,
    });
    addPerfPhase(requestPerfPhases, 'finalize_response_ms', elapsedPerfMs(finalizeStart));
    emitRequestPerf(response.status);
    return response;
  };

  if (responsesDisabled) {
    const disabledResponse = createResponsesChatCompatErrorResponse({
      status: 400,
      message: 'Responses endpoint is disabled for this provider.',
      code: 'responses_disabled',
      param: null,
    });
    applyCorsHeaders(disabledResponse.headers);
    return returnLoggedLocalResponse(disabledResponse, '[REQ_RESPONSES_DISABLED]', {
      responses_mode: responsesMode,
    });
  }

  if (c.req.method === 'POST' && rawPayloadForLog != null) {
    const prepareStart = nowPerfMs();
    const prepared = prepareRequestForProvider({
      upstreamType: route.type,
      method: c.req.method,
      rawBodyText: rawPayloadForLog,
      rawHeaders: c.req.raw.headers,
      routePrefix: route.channelName,
      routeSystem: route.systemPrompt,
    });
    addPerfPhase(requestPerfPhases, 'prepare_request_ms', elapsedPerfMs(prepareStart));

    if (prepared.body != null) {
      body = prepared.body;
      requestModel = prepared.requestModel;
      if (adaptResponsesToChatCompletions) {
        const converted = convertResponsesRequestToChatCompletions(body as string, {
          targetUrl: upstreamTargetUrl,
        });
        if (!converted.ok) {
          const compatibilityErrorResponse = createResponsesChatCompatErrorResponse(converted.error);
          applyCorsHeaders(compatibilityErrorResponse.headers);
          return returnLoggedLocalResponse(compatibilityErrorResponse, '[REQ_COMPAT_ERR]', {
            message: converted.error.message,
            param: converted.error.param ?? null,
            code: converted.error.code ?? null,
          });
        }
        body = converted.body;
        requestModel = converted.requestModel;
      }
      // 如果请求 model 是别名，改写请求体中的 model 字段为真实模型名
      if (route.resolvedModel && requestModel !== route.resolvedModel) {
        try {
          const parsed = JSON.parse(body as string) as Record<string, unknown>;
          parsed.model = route.resolvedModel;
          body = JSON.stringify(parsed);
        } catch {
          // body 不是 JSON（不应发生），保持原样
        }
      }
    } else if (originalSummaryForLog?.model) {
      requestModel = originalSummaryForLog.model;
    }
  }

  if (c.req.method === 'POST') {
    forwardedPayload = typeof body === 'string' ? body : rawPayloadForLog;
    if (forwardedPayload != null) {
      forwardedPayloadForStore = forwardedPayload;
      lastForwardedPayloadChars = forwardedPayload.length;
      const payloadForLog = truncatePayloadForLog(forwardedPayload);
      const logForwardedPayloadStart = nowPerfMs();
      console.log('[REQ_PAYLOAD_FWD]', {
        request_id: requestId,
        method: c.req.method,
        path: url.pathname + url.search,
        target_url: upstreamTargetUrl,
        original_bytes: payloadForLog.originalBytes,
        logged_bytes: payloadForLog.loggedBytes,
        truncated: payloadForLog.truncated,
        truncation_reason: payloadForLog.truncationReason,
      });
      addPerfPhase(requestPerfPhases, 'log_req_payload_fwd_ms', elapsedPerfMs(logForwardedPayloadStart));

      const summarizeForwardedStart = nowPerfMs();
      const payloadSummary = summarizePayloadForProvider(forwardedPayload, route.type);
      forwardedSummaryForLog = payloadSummary;
      addPerfPhase(requestPerfPhases, 'summarize_forwarded_ms', elapsedPerfMs(summarizeForwardedStart));
      if (payloadSummary) {
        const logForwardedSummaryStart = nowPerfMs();
        console.log('[REQ_PAYLOAD_FWD_SUMMARY]', {
          request_id: requestId,
          path: url.pathname + url.search,
          target_url: upstreamTargetUrl,
          ...payloadSummary,
        });
        addPerfPhase(requestPerfPhases, 'log_req_payload_fwd_summary_ms', elapsedPerfMs(logForwardedSummaryStart));
      }
    }

    const logHeadersStart = nowPerfMs();
    console.log('[REQ_HEADERS_FWD]', {
      request_id: requestId,
      path: url.pathname + url.search,
      target_url: upstreamTargetUrl,
      headers: headersSummary,
    });
    addPerfPhase(requestPerfPhases, 'log_req_headers_ms', elapsedPerfMs(logHeadersStart));

    const detectRequestTypeStart = nowPerfMs();
    sourceRequestType = detectRequestKindForProvider(
      originalPayloadForStore,
      route.type,
      c.req.raw.headers,
    );
    addPerfPhase(requestPerfPhases, 'detect_request_type_ms', elapsedPerfMs(detectRequestTypeStart));

    const queueConsoleWriteStart = nowPerfMs();
    const originalPayloadForRecord = originalPayloadForStore == null
      ? null
      : truncatePayloadForLog(originalPayloadForStore);
    const forwardedPayloadForRecord = forwardedPayloadForStore == null
      ? null
      : truncatePayloadForLog(forwardedPayloadForStore);
    trackPendingConsoleRequestWrite(requestId, () => saveConsoleRequest({
      request_id: requestId,
      created_at: requestCreatedAt,
      route_prefix: route.channelName,
      upstream_type: route.type,
      method: c.req.method,
      path: url.pathname + url.search,
      target_url: upstreamTargetUrl,
      request_model: requestModel,
      api_key_id: matchedApiKey?.id ?? null,
      api_key_name: matchedApiKey?.name ?? null,
      original_payload: originalPayloadForRecord?.payload ?? null,
      original_payload_truncated: originalPayloadForRecord?.truncated ?? false,
      original_summary: originalSummaryForLog,
      forwarded_payload: forwardedPayloadForRecord?.payload ?? null,
      forwarded_payload_truncated: forwardedPayloadForRecord?.truncated ?? false,
      forwarded_summary: forwardedSummaryForLog,
      original_headers: captureOriginalHeaders(c.req.raw.headers),
      forward_headers: headersSummary,
      failover_from: null,
      failover_chain: [],
      original_route_prefix: null,
      original_request_model: null,
      failover_reason: null,
      source_request_type: sourceRequestType as any,
    }));
    addPerfPhase(requestPerfPhases, 'queue_console_request_ms', elapsedPerfMs(queueConsoleWriteStart));
  }

  console.log('[REQ]', { request_id: requestId, method: c.req.method, path: url.pathname + url.search, target_url: upstreamTargetUrl });

  let upstreamResponse: Response;
  const proxyStart = nowPerfMs();
  try {
    const upstreamTimeoutMs = getUpstreamRequestTimeoutMs();
    const upstreamResponseStartTimeout = createUpstreamResponseStartTimeout(upstreamTimeoutMs);
    try {
      upstreamResponse = await proxy(upstreamTargetUrl, {
        raw: c.req.raw.clone(),
        headers: forwardHeaders,
        body,
        signal: upstreamResponseStartTimeout.signal,
      });
    } finally {
      upstreamResponseStartTimeout.clear();
    }
    addPerfPhase(requestPerfPhases, 'proxy_ms', elapsedPerfMs(proxyStart));
  } catch (err: any) {
    addPerfPhase(requestPerfPhases, 'proxy_ms', elapsedPerfMs(proxyStart));
    const isTimeoutError = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const terminalErrorResponse = isTimeoutError
      ? buildGatewayErrorResponse(route.type, 504, 'Upstream timeout', `No first byte received within ${Math.round(getUpstreamRequestTimeoutMs() / 1000)}s`)
      : buildGatewayErrorResponse(route.type, 502, 'Upstream request failed', err?.message || String(err));
    console.log('[RES]', { request_id: requestId, status: terminalErrorResponse.status, status_text: terminalErrorResponse.statusText || 'Error' });
    const finalizeStart = nowPerfMs();
    const response = finalizeProxyResponse({
      response: terminalErrorResponse,
      requestId,
      path: url.pathname + url.search,
      shouldLog: c.req.method === 'POST',
      createdAt: requestCreatedAt,
      createdAtPerf: requestCreatedPerfAt,
      upstreamType: route.type,
      truncatePayloadForLog,
      requestBody: forwardedPayload ?? undefined,
    });
    addPerfPhase(requestPerfPhases, 'finalize_response_ms', elapsedPerfMs(finalizeStart));
    emitRequestPerf(response.status);
    return response;
  }

  if (adaptResponsesToChatCompletions) {
    upstreamResponse = transformChatCompletionsResponseToResponses(upstreamResponse);
  }

  console.log('[RES]', { request_id: requestId, status: upstreamResponse.status, status_text: upstreamResponse.statusText });
  const finalizeStart = nowPerfMs();
  const response = finalizeProxyResponse({
    response: upstreamResponse,
    requestId,
    path: url.pathname + url.search,
    shouldLog: c.req.method === 'POST',
    createdAt: requestCreatedAt,
    createdAtPerf: requestCreatedPerfAt,
    upstreamType: route.type,
    truncatePayloadForLog,
    requestBody: forwardedPayload ?? undefined,
  });
  addPerfPhase(requestPerfPhases, 'finalize_response_ms', elapsedPerfMs(finalizeStart));
  const analyticsStart = nowPerfMs();
  try {
    c.env.LLM_STATUS?.writeDataPoint({
      indexes: [route.channelName],
      blobs: [requestModel, url.pathname, '', String(response.status)],
      doubles: [0, 0, 0, 0, 0, 0, response.status],
    });
  } catch (e) {
    console.error('[AE write error]', e);
  }
  addPerfPhase(requestPerfPhases, 'analytics_write_ms', elapsedPerfMs(analyticsStart));
  emitRequestPerf(response.status);
  return response;
}

export default app;
