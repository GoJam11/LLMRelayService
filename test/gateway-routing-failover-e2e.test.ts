/**
 * 模型路由 & 故障转移 端到端测试
 *
 * 覆盖的场景：
 *   - 路由：基于模型路由、显式 provider 路由、未知模型 400、优先级选择、禁用 provider 跳过
 *   - 认证：缺少 key → 401、错误 key → 401、正确 key → 通过
 *   - 故障转移—重试：5xx 重试、429 重试、400 不重试、流式请求开流前的状态码错误也会重试/回退
 *   - 故障转移—网络/超时：网络错误重试、超时重试、全部超时 → 504
 *   - 故障转移—模型回退：same_model 模式、any_model 模式、自定义回退、全部失败 → 5xx 透传
 *   - 策略控制：failover 禁用、maxFallbackAttempts=0
 *
 * 上游均通过本地 mock server 模拟，不依赖任何真实 AI 服务。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import app from '../src/index';
import {
  loadModelAliasesForTest,
  loadProviderConfigsForTest,
  resetProviderConfigCache,
  validateConfigEntries,
} from '../src/config';
import {
  clearGatewayFailoverPolicyCache,
  loadFailoverPolicyForTest,
  type GatewayFailoverPolicyInput,
} from '../src/gateway-failover';
import {
  clearGatewayTimeoutSettingsCache,
  forceTimeoutSettingsForTest,
} from '../src/gateway-timeouts';

// ── Mock upstream server ───────────────────────────────────────────────────────

/** Each element is a one-shot handler; after dequeue the server returns a default 200. */
const responseQueue: Array<(req: Request) => Response | Promise<Response>> = [];
/** Ordered log of every request the mock server received. */
const requestLog: Array<{ method: string; path: string; body: string }> = [];

let mockServer: ReturnType<typeof Bun.serve>;
/** Base URL of the mock upstream, e.g. http://127.0.0.1:PORT */
let mockBaseUrl: string;
/** A URL whose port is closed (connection refused), used for network-error tests. */
let closedPortUrl: string;

const TEST_GATEWAY_KEY = 'test-admin-key-e2e-12345';

// ── Lifecycle ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Start mock upstream server on a random OS-assigned port.
  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      let bodyText = '';
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          bodyText = await req.text();
        }
      } catch {
        // ignore read errors if connection was aborted by client
      }
      requestLog.push({ method: req.method, path: new URL(req.url).pathname, body: bodyText });

      const handler = responseQueue.shift();
      if (!handler) {
        return defaultOkResponse();
      }
      return handler(new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: bodyText || undefined,
      }));
    },
  });
  mockBaseUrl = `http://127.0.0.1:${mockServer.port}`;

  // Grab a free port, close it immediately → any subsequent connect attempt fails.
  const tempServer = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const closedPort = tempServer.port;
  await tempServer.stop(true);
  closedPortUrl = `http://127.0.0.1:${closedPort}`;

  // Provide a global admin key so auth passes unless a test deliberately omits it.
  process.env.GATEWAY_API_KEY = TEST_GATEWAY_KEY;
});

afterAll(async () => {
  await mockServer?.stop(true);
  delete process.env.GATEWAY_API_KEY;
  resetProviderConfigCache();
});

beforeEach(() => {
  requestLog.length = 0;
  responseQueue.length = 0;
  // Load empty provider config so accidental DB loads can't bleed in.
  loadProviderConfigsForTest({});
  clearGatewayFailoverPolicyCache();
  clearGatewayTimeoutSettingsCache();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function defaultOkResponse(model = 'gpt-4o'): Response {
  return Response.json({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

function errorResponse(status: number, message = 'upstream error'): Response {
  return Response.json(
    { error: { message, type: 'api_error', code: null, param: null } },
    { status },
  );
}

function slowHandler(delayMs: number): () => Promise<Response> {
  return async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return defaultOkResponse();
  };
}

/** Build a POST Request to the gateway app. */
function gatewayReq(
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://gateway.internal${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_GATEWAY_KEY}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Shorthand for a chat completions body. */
function chatBody(model = 'gpt-4o', extra?: Record<string, unknown>): Record<string, unknown> {
  return { model, messages: [{ role: 'user', content: 'Hello' }], ...extra };
}

/**
 * Build a single-provider config pointing to the mock server's /v1 path.
 * Extra properties can override any field.
 */
function singleProviderConfig(overrides: Record<string, unknown> = {}) {
  return validateConfigEntries({
    primary: {
      type: 'openai',
      targetBaseUrl: `${mockBaseUrl}/v1`,
      auth: { header: 'authorization', value: 'upstream-key' },
      models: ['gpt-4o'],
      ...overrides,
    } as any,
  });
}

/** Load a no-retry, no-fallback failover policy. */
function disableFailover() {
  loadFailoverPolicyForTest({
    enabled: false,
    retryAttempts: 0,
    maxFallbackAttempts: 0,
  });
}

// ── Category 1: Basic Routing ──────────────────────────────────────────────────

describe('routing', () => {
  it('routes model-based request to the correct provider', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(1);
    expect(requestLog[0]!.path).toBe('/v1/chat/completions');
  });

  it('routes explicit /providers/:name/... request to named provider', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(
      gatewayReq('/providers/primary/v1/chat/completions', chatBody()),
    );

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(1);
  });

  it('returns 400 for an unrecognized model', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody('unknown-model-xyz')));

    expect(res.status).toBe(400);
    expect(requestLog).toHaveLength(0); // no upstream request made
  });

  it('selects the highest-priority provider when multiple providers share the same model', async () => {
    const configs = validateConfigEntries({
      low: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/low/v1`,
        auth: { header: 'authorization', value: 'key-low' },
        models: ['gpt-4o'],
        priority: 5,
      },
      high: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/high/v1`,
        auth: { header: 'authorization', value: 'key-high' },
        models: ['gpt-4o'],
        priority: 10,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    disableFailover();
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    // Verify the HIGH-priority provider was called (path includes /high/v1/...)
    expect(requestLog[0]!.path).toBe('/high/v1/chat/completions');
  });

  it('skips disabled providers and returns 400 when no enabled provider matches', async () => {
    const configs = validateConfigEntries({
      disabled: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        enabled: false,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    disableFailover();

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(400);
    expect(requestLog).toHaveLength(0);
  });

  it('type-forced /openai/v1/... prefix restricts to OpenAI providers only', async () => {
    const configs = validateConfigEntries({
      anthropic_provider: {
        type: 'anthropic',
        targetBaseUrl: `${mockBaseUrl}`,
        auth: { header: 'x-api-key', value: 'anthro-key' },
        models: ['claude-3-opus'],
      },
      openai_provider: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/v1`,
        auth: { header: 'authorization', value: 'oai-key' },
        models: ['gpt-4o'],
      },
    } as any);
    loadProviderConfigsForTest(configs);
    disableFailover();
    responseQueue.push(() => defaultOkResponse());

    // /openai/v1/... forces OpenAI type, so anthropic_provider should be skipped
    const res = await app.fetch(
      gatewayReq('/openai/v1/chat/completions', chatBody('gpt-4o')),
    );

    expect(res.status).toBe(200);
    expect(requestLog[0]!.path).toBe('/v1/chat/completions');
  });
});

// ── Category 2: Authentication ─────────────────────────────────────────────────

describe('authentication', () => {
  it('returns 401 when no auth header is provided', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();

    const req = new Request('http://gateway.internal/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody()),
    });

    const res = await app.fetch(req);

    expect(res.status).toBe(401);
    expect(requestLog).toHaveLength(0);
  });

  it('returns 401 when the wrong key is provided', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();

    const req = new Request('http://gateway.internal/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer completely-wrong-key',
      },
      body: JSON.stringify(chatBody()),
    });

    const res = await app.fetch(req);

    expect(res.status).toBe(401);
    expect(requestLog).toHaveLength(0);
  });

  it('accepts the correct admin key and proxies the request', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    disableFailover();
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
  });
});

// ── Category 3: Failover — Retry on Error Status ──────────────────────────────

describe('failover – retry on error status', () => {
  it('retries on 5xx up to retryAttempts and succeeds on the final attempt', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 2,
      maxFallbackAttempts: 0,
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });
    // Two failures, one success
    responseQueue.push(() => errorResponse(500));
    responseQueue.push(() => errorResponse(500));
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(3);
  });

  it('passes through the upstream 5xx when all retries are exhausted', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0,
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });
    responseQueue.push(() => errorResponse(503));
    responseQueue.push(() => errorResponse(503));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(503);
    expect(requestLog).toHaveLength(2); // initial + 1 retry
  });

  it('retries on 429 (rate-limited) and succeeds', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0,
      retryOnStatusCodes: [429],
      retryOnStatusRanges: [],
    });
    responseQueue.push(() => errorResponse(429, 'Rate limited'));
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
  });

  it('does NOT retry on 400 — passes through immediately', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 2,
      maxFallbackAttempts: 0,
      retryOnStatusCodes: [429],
      retryOnStatusRanges: ['5xx'],
    });
    responseQueue.push(() => errorResponse(400, 'Bad request'));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(400);
    expect(requestLog).toHaveLength(1); // exactly one attempt, no retry
  });

  it('does NOT retry on 403 — passes through immediately', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 2,
      maxFallbackAttempts: 0,
      retryOnStatusCodes: [429],
      retryOnStatusRanges: ['5xx'],
    });
    responseQueue.push(() => errorResponse(403, 'Forbidden'));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(403);
    expect(requestLog).toHaveLength(1);
  });

  it('retries a streaming request when the upstream returns an error status before the first byte', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0,
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [429],
    });
    responseQueue.push(() => errorResponse(429, 'Rate limited'));
    responseQueue.push(() => defaultOkResponse());

    // stream: true must NOT disable status-based failover: the error status arrives
    // before any body is streamed to the client, so retrying to the next attempt is safe.
    const res = await app.fetch(
      gatewayReq('/v1/chat/completions', chatBody('gpt-4o', { stream: true })),
    );

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
  });

  it('falls over a streaming request to the next provider on 5xx', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/secondary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      modelFallbackMode: 'same_model',
      maxFallbackAttempts: 1,
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });
    responseQueue.push(() => errorResponse(503, 'Service unavailable'));
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(
      gatewayReq('/v1/chat/completions', chatBody('gpt-4o', { stream: true })),
    );

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    // Primary (high priority) is tried first, then the request falls over to secondary.
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/secondary/v1/chat/completions');
  });
});

// ── Category 4: Failover — Network Error & Timeout ────────────────────────────

describe('failover – network error and timeout', () => {
  it('retries on network error and falls back to secondary provider', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        // Points to the closed port → immediate connection refused
        targetBaseUrl: `${closedPortUrl}/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'same_model',
      retryOnNetworkError: true,
      retryOnStatusRanges: [],
      retryOnStatusCodes: [],
    });
    responseQueue.push(() => defaultOkResponse()); // serves the secondary request

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(1); // only secondary reached the mock
  });

  it('returns 502 on network error when no fallback is configured', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${closedPortUrl}/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 0,
      retryOnNetworkError: true,
    });

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(502);
    expect(requestLog).toHaveLength(0); // closed port never touches mock
  });

  it('retries on timeout and succeeds on the second attempt', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    // Very short first-byte timeout (200 ms) — the mock will delay the first response
    forceTimeoutSettingsForTest({
      defaultFirstByteTimeoutMs: 200,
      streamFirstByteTimeoutMs: 200,
      imageFirstByteTimeoutMs: 200,
      responseIdleTimeoutMs: 0,
    });
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0,
      retryOnTimeout: true,
      retryOnStatusRanges: [],
      retryOnStatusCodes: [],
    });

    responseQueue.push(slowHandler(600)); // first attempt: hangs > 200 ms → timeout
    responseQueue.push(() => defaultOkResponse()); // second attempt: instant success

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
  });

  it('returns 504 when all retry attempts time out', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    forceTimeoutSettingsForTest({
      defaultFirstByteTimeoutMs: 200,
      streamFirstByteTimeoutMs: 200,
      imageFirstByteTimeoutMs: 200,
      responseIdleTimeoutMs: 0,
    });
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0,
      retryOnTimeout: true,
      retryOnStatusRanges: [],
      retryOnStatusCodes: [],
    });

    responseQueue.push(slowHandler(600));
    responseQueue.push(slowHandler(600));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(504);
    expect(requestLog).toHaveLength(2);
  });

  it('does NOT retry on timeout when retryOnTimeout is false', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    forceTimeoutSettingsForTest({
      defaultFirstByteTimeoutMs: 200,
      streamFirstByteTimeoutMs: 200,
      imageFirstByteTimeoutMs: 200,
      responseIdleTimeoutMs: 0,
    });
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 2,
      maxFallbackAttempts: 0,
      retryOnTimeout: false, // disabled
      retryOnStatusRanges: [],
      retryOnStatusCodes: [],
    });

    responseQueue.push(slowHandler(600));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(504);
    expect(requestLog).toHaveLength(1); // no retry
  });
});

// ── Category 5: Failover — Model Fallback ─────────────────────────────────────

describe('failover – model fallback', () => {
  it('falls back to same model on secondary provider after primary retries exhausted', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/secondary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'same_model',
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // primary fails
    responseQueue.push(() => defaultOkResponse()); // secondary succeeds

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/secondary/v1/chat/completions');
  });

  it('falls back to any model on any provider in any_model mode', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      backup: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/backup/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o-mini'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'any_model',
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // primary fails
    responseQueue.push(() => defaultOkResponse('gpt-4o-mini')); // backup succeeds

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody('gpt-4o')));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/backup/v1/chat/completions');

    // Verify the fallback request body was rewritten to use gpt-4o-mini
    const fallbackBody = JSON.parse(requestLog[1]!.body) as Record<string, unknown>;
    expect(fallbackBody.model).toBe('gpt-4o-mini');
  });

  it('uses custom model fallback rules to redirect to an alternative model', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      fallback_provider: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/fallback/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['claude-3-5-sonnet'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'disabled', // site-wide fallback disabled
      customModelFallbacks: [
        { model: 'gpt-4o', fallbacks: ['fallback_provider:claude-3-5-sonnet'] },
      ],
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // primary fails
    responseQueue.push(() => defaultOkResponse('claude-3-5-sonnet')); // fallback succeeds

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody('gpt-4o')));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/fallback/v1/chat/completions');

    const fallbackBody = JSON.parse(requestLog[1]!.body) as Record<string, unknown>;
    expect(fallbackBody.model).toBe('claude-3-5-sonnet');
  });

  it('treats aliases as virtual models with independent fallback rules', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
        providerUuid: 'provider-primary',
      },
      real_model_fallback: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/real-model-fallback/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['claude-3-5-sonnet'],
        priority: 5,
      },
      alias_fallback: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/alias-fallback/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['deepseek-chat'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadModelAliasesForTest({ fast: { provider: 'provider-primary', model: 'gpt-4o' } });
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'disabled',
      customModelFallbacks: [
        { model: 'gpt-4o', fallbacks: ['real_model_fallback:claude-3-5-sonnet'] },
        { model: 'fast', fallbacks: ['alias_fallback:deepseek-chat'] },
      ],
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500));
    responseQueue.push(() => defaultOkResponse('deepseek-chat'));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody('fast')));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/alias-fallback/v1/chat/completions');

    const initialBody = JSON.parse(requestLog[0]!.body) as Record<string, unknown>;
    const fallbackBody = JSON.parse(requestLog[1]!.body) as Record<string, unknown>;
    expect(initialBody.model).toBe('gpt-4o');
    expect(fallbackBody.model).toBe('deepseek-chat');
  });

  it('tries additional virtual route targets even when site-wide model fallback is disabled', async () => {
    const configs = validateConfigEntries({
      cheap1: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/cheap1/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-5.5'],
        routingVisibility: 'explicit_only',
        providerUuid: 'provider-cheap1',
      },
      cheap2: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/cheap2/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-5.5'],
        routingVisibility: 'explicit_only',
        providerUuid: 'provider-cheap2',
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadModelAliasesForTest({
      'gpt-5.5-third': {
        provider: 'provider-cheap1',
        model: 'gpt-5.5',
        targets: [
          { provider: 'provider-cheap1', model: 'gpt-5.5' },
          { provider: 'provider-cheap2', model: 'gpt-5.5' },
        ],
      },
    });
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'disabled',
      customModelFallbacks: [],
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500));
    responseQueue.push(() => defaultOkResponse('gpt-5.5'));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody('gpt-5.5-third')));

    expect(res.status).toBe(200);
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/cheap1/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/cheap2/v1/chat/completions');
    expect(JSON.parse(requestLog[0]!.body).model).toBe('gpt-5.5');
    expect(JSON.parse(requestLog[1]!.body).model).toBe('gpt-5.5');
  });

  it('passes through the last upstream error when all fallback routes are exhausted', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/secondary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'same_model',
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // primary fails
    responseQueue.push(() => errorResponse(503)); // secondary also fails

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    // The last upstream error status is passed through
    expect(res.status).toBe(503);
    expect(requestLog).toHaveLength(2);
  });

  it('respects maxFallbackAttempts to limit the number of fallback providers tried', async () => {
    const configs = validateConfigEntries({
      p1: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/p1/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 30,
      },
      p2: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/p2/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 20,
      },
      p3: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/p3/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    // maxFallbackAttempts=1 means only one fallback after primary fails (p2 but not p3)
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 0,
      maxFallbackAttempts: 1,
      modelFallbackMode: 'same_model',
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // p1 fails
    responseQueue.push(() => errorResponse(500)); // p2 also fails (only fallback allowed)

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(500); // p2's last error
    // p3 was never tried because maxFallbackAttempts=1
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/p1/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/p2/v1/chat/completions');
  });
});

// ── Category 6: Policy Control ────────────────────────────────────────────────

describe('policy control', () => {
  it('immediately passes through errors when failover is disabled', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({ enabled: false });

    responseQueue.push(() => errorResponse(500));

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(500);
    expect(requestLog).toHaveLength(1); // no retry at all
  });

  it('maxFallbackAttempts=0 disables fallback even when retries are configured', async () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/primary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 10,
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: `${mockBaseUrl}/secondary/v1`,
        auth: { header: 'authorization', value: 'key' },
        models: ['gpt-4o'],
        priority: 5,
      },
    } as any);
    loadProviderConfigsForTest(configs);
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 0, // no fallback to secondary
      modelFallbackMode: 'same_model',
      retryOnStatusRanges: ['5xx'],
      retryOnStatusCodes: [],
    });

    responseQueue.push(() => errorResponse(500)); // primary attempt 1
    responseQueue.push(() => errorResponse(500)); // primary retry

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(500);
    // Only primary was tried (twice via retry), secondary never touched
    expect(requestLog).toHaveLength(2);
    expect(requestLog[0]!.path).toBe('/primary/v1/chat/completions');
    expect(requestLog[1]!.path).toBe('/primary/v1/chat/completions');
  });

  it('returns 200 on successful proxy when upstream responds normally', async () => {
    loadProviderConfigsForTest(singleProviderConfig());
    loadFailoverPolicyForTest({
      enabled: true,
      retryAttempts: 1,
      maxFallbackAttempts: 1,
      retryOnStatusRanges: ['5xx'],
    });
    responseQueue.push(() => defaultOkResponse());

    const res = await app.fetch(gatewayReq('/v1/chat/completions', chatBody()));

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect((body as any).choices[0].message.content).toBe('ok');
    expect(requestLog).toHaveLength(1); // no unnecessary retries on success
  });
});
