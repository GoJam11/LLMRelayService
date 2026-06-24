import { saveConsoleResponse, type ResponseTimingSnapshotForConsole } from './console-store';
import { trackPendingConsoleLogTask, waitForPendingConsoleLogTasks, waitForPendingConsoleRequestWrite } from './console-log-tasks';
import { parseUsageForProvider, getProviderAdapter, type UpstreamType, type UsageData } from './providers';
import { elapsedPerfMs, nowPerfMs, shouldLogBackgroundPerf } from './perf-detail';
import { toObservedEpochMs } from './perf-detail';
import { recordBackgroundPerfSample } from './perf-monitor';
import { estimateInputTokens, estimateOutputTokens } from './token-estimator';
import {
  DEFAULT_RESPONSE_STREAM_LOG_MAX_BYTES,
  DEFAULT_RESPONSE_STREAM_LOG_MAX_DURATION_MS,
  MIN_RESPONSE_STREAM_LOG_MAX_DURATION_MS,
  RESPONSE_STREAM_LOG_MAX_DURATION_MS_ENV,
} from './logging-constants';

const utf8Decoder = new TextDecoder();

function createEmptyUsage(): UsageData {
  return {
    model: '',
    stop_reason: '',
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 0,
  };
}

export type TruncationReason = 'size_limit' | 'duration_limit' | null;

interface ResponseObservation {
  rawPayload: string;
  timing: ResponseTimingSnapshotForConsole;
  payloadTruncated: boolean;
  truncationReason: TruncationReason;
  observeMs: number;
}

interface FinalizeProxyResponseOptions {
  response: Response;
  requestId: string;
  path: string;
  shouldLog: boolean;
  createdAt: number;
  createdAtPerf: number;
  upstreamType: UpstreamType;
  truncatePayloadForLog: (rawPayload: string) => { payload: string; originalBytes: number; loggedBytes: number; truncated: boolean };
  requestBody?: string;
  bodyIdleTimeoutMs?: number;
  /**
   * 当上游响应中的 model 字段需要改写回客户端可见的 alias 名时，提供 from→to 映射。
   * 用于 alias 路由场景：默认隐藏上游真实模型名。
   */
  rewriteModel?: { from: string; to: string };
}

export async function waitForPendingResponseLogs(): Promise<void> {
  await waitForPendingConsoleLogTasks();
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getStreamingObservationLimits(): { maxBytes: number; maxDurationMs: number } {
  return {
    maxBytes: DEFAULT_RESPONSE_STREAM_LOG_MAX_BYTES,
    maxDurationMs: Math.max(MIN_RESPONSE_STREAM_LOG_MAX_DURATION_MS, readPositiveIntEnv(RESPONSE_STREAM_LOG_MAX_DURATION_MS_ENV, DEFAULT_RESPONSE_STREAM_LOG_MAX_DURATION_MS)),
  };
}

function captureResponseHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  headers.forEach((value, key) => {
    captured[key] = value;
  });
  return captured;
}

function isEventStreamContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.toLowerCase().includes('text/event-stream'));
}

function normalizeIdleTimeoutMs(timeoutMs: number | null | undefined): number {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
}

function createBodyIdleTimeoutError(timeoutMs: number): DOMException {
  return new DOMException(
    `Upstream response body idle timeout after ${Math.round(timeoutMs / 1000)}s`,
    'TimeoutError',
  );
}

/**
 * 返回一个 TransformStream，把响应文本中所有出现的 `"model"`/`"original_model"` 字段
 * 中值为 `mapping.from` 的字符串替换为 `mapping.to`，用于 alias 路由场景下默认隐藏
 * 上游真实模型名。
 *
 * 实现要点：
 * - 按字节解码累积；只对纯 ASCII 字段名 `"model"` 做匹配，因此可以安全地按字符串扫描。
 * - 为避免 chunk 边界把 `"model":"<from>"` 切成两半，输出时保留尾部 N 字节作为
 *   下一轮的"窗口前缀"，N 取决于最长可能匹配的字节长度。
 * - 该转换只针对 JSON 风格的 `"model":"..."` / `"model": "..."` / `"<...>_model":"..."`
 *   片段；不会破坏 SSE 控制行（`data:`、`event:`）。
 */
function createModelFieldRewriteBody(
  sourceBody: ReadableStream<Uint8Array>,
  mapping: { from: string; to: string },
): ReadableStream<Uint8Array> {
  if (!mapping.from || mapping.from === mapping.to) return sourceBody;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const fromEscaped = mapping.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配 "model":"<from>"（或带 "_model"/"display_model" 等后缀），允许空白
  const pattern = new RegExp(`("(?:[A-Za-z0-9_]*model)"\\s*:\\s*")(${fromEscaped})(")`, 'g');
  const safeTailBytes = Math.max(64, encoder.encode(mapping.from).length + 32);

  let buffer = '';

  function flushSafe(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (!buffer) return;
    // 留出尾巴避免 chunk 边界跨过待匹配文本
    if (buffer.length <= safeTailBytes) return;
    const flushEnd = buffer.length - safeTailBytes;
    const flushPart = buffer.slice(0, flushEnd).replace(pattern, (_match, prefix, _val, suffix) => `${prefix}${mapping.to}${suffix}`);
    controller.enqueue(encoder.encode(flushPart));
    buffer = buffer.slice(flushEnd);
  }

  return sourceBody.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      flushSafe(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (!buffer) return;
      const rewritten = buffer.replace(pattern, (_match, prefix, _val, suffix) => `${prefix}${mapping.to}${suffix}`);
      controller.enqueue(encoder.encode(rewritten));
      buffer = '';
    },
  }));
}

function createTimeoutGuardedBody(
  sourceBody: ReadableStream<Uint8Array>,
  timeoutMs: number | null | undefined,
  requestId: string,
  path: string,
): ReadableStream<Uint8Array> {
  const normalizedTimeoutMs = normalizeIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs <= 0) return sourceBody;

  const sourceReader = sourceBody.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function clearIdleTimer(): void {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdleTimer(controller: ReadableStreamDefaultController<Uint8Array>): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (closed) return;
      closed = true;
      idleTimer = null;
      const error = createBodyIdleTimeoutError(normalizedTimeoutMs);
      console.warn('[UPSTREAM_BODY_IDLE_TIMEOUT]', {
        request_id: requestId,
        path,
        timeout_ms: normalizedTimeoutMs,
      });
      void sourceReader.cancel(error).catch(() => undefined);
      try {
        controller.error(error);
      } catch {}
    }, normalizedTimeoutMs);
    if (idleTimer && typeof idleTimer === 'object' && 'unref' in idleTimer) {
      (idleTimer as NodeJS.Timeout).unref();
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      armIdleTimer(controller);
      try {
        const { value, done } = await sourceReader.read();
        clearIdleTimer();
        if (closed) return;
        if (done) {
          closed = true;
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (error) {
        clearIdleTimer();
        if (closed) return;
        closed = true;
        controller.error(error);
      }
    },
    cancel(reason) {
      closed = true;
      clearIdleTimer();
      return sourceReader.cancel(reason);
    },
  });
}

function createObservationCollector(
  createdAt: number,
  createdAtPerf: number,
  upstreamType: UpstreamType,
  contentType: string | null | undefined,
): {
  observationPromise: Promise<ResponseObservation>;
  observeChunkSafely: (chunk: Uint8Array) => void;
  stopObservation: (markTruncated: boolean, completedAtOverride?: number) => void;
  failObservation: (error: unknown) => void;
  isStopped: () => boolean;
} {
  const observeStart = nowPerfMs();
  const isEventStream = isEventStreamContentType(contentType);
  const provider = getProviderAdapter(upstreamType);
  const streamingLimits = isEventStream ? getStreamingObservationLimits() : null;
  const decoder = new TextDecoder();
  const observationTimeoutMs = isEventStream ? (streamingLimits?.maxDurationMs ?? DEFAULT_RESPONSE_STREAM_LOG_MAX_DURATION_MS) : null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let firstChunkAt: number | null = null;
  let firstTokenAt: number | null = null;
  let completedAt: number | null = null;
  let payloadTruncated = false;
  let truncationReason: TruncationReason = null;
  let hasStreamingContent = isEventStream;
  let pendingSseText = '';
  let observationStopped = false;
  let observationTimeout: ReturnType<typeof setTimeout> | null = null;
  let observationSettled = false;

  let resolveObservation!: (observation: ResponseObservation) => void;
  let rejectObservation!: (error: unknown) => void;
  const observationPromise = new Promise<ResponseObservation>((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });

  function clearObservationTimeout(): void {
    if (!observationTimeout) return;
    clearTimeout(observationTimeout);
    observationTimeout = null;
  }

  function settleObservation(
    kind: 'resolve' | 'reject',
    value: ResponseObservation | unknown,
  ): void {
    if (observationSettled) return;
    observationSettled = true;
    clearObservationTimeout();
    if (kind === 'resolve') {
      resolveObservation(value as ResponseObservation);
    } else {
      rejectObservation(value);
    }
  }

  function getObservedAt(nowEpochMs: number = Date.now()): number {
    return toObservedEpochMs(createdAt, createdAtPerf, nowPerfMs(), nowEpochMs);
  }

  function stopObservation(markTruncated: boolean, completedAtOverride?: number): void {
    if (observationStopped) return;
    if (markTruncated) payloadTruncated = true;
    if (completedAtOverride != null) completedAt = completedAtOverride;
    observationStopped = true;
    queueMicrotask(() => {
      try {
        settleObservation('resolve', buildObservation());
      } catch (error) {
        settleObservation('reject', error);
      }
    });
  }

  function failObservation(error: unknown): void {
    if (observationStopped) return;
    observationStopped = true;
    queueMicrotask(() => {
      settleObservation('reject', error);
    });
  }

  function observeChunkSafely(chunk: Uint8Array): void {
    if (observationStopped) return;
    try {
      observeChunk(chunk);
    } catch (error) {
      failObservation(error);
    }
  }

  function buildObservation(): ResponseObservation {
    const tail = decoder.decode();
    if (tail) {
      if (isEventStream) pendingSseText += tail;
      if (!hasStreamingContent && (tail.includes('event: ') || tail.includes('data: '))) {
        hasStreamingContent = true;
      }
      if (isEventStream) {
        consumeSseEvents(getObservedAt());
      } else if (firstTokenAt == null && provider.hasTextualSignal(tail)) {
        firstTokenAt = getObservedAt();
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const rawPayload = utf8Decoder.decode(merged);
    const timing: ResponseTimingSnapshotForConsole = {
      response_body_bytes: totalBytes,
      first_chunk_at: firstChunkAt,
      first_token_at: firstTokenAt ?? (hasStreamingContent ? null : firstChunkAt),
      completed_at: payloadTruncated ? null : (completedAt ?? Date.now()),
      has_streaming_content: hasStreamingContent,
    };

    if (timing.first_chunk_at != null && timing.first_chunk_at < createdAt) {
      timing.first_chunk_at = createdAt;
    }
    if (timing.first_token_at != null && timing.first_token_at < createdAt) {
      timing.first_token_at = createdAt;
    }
    if (timing.completed_at != null && timing.completed_at < (timing.first_chunk_at ?? createdAt)) {
      timing.completed_at = timing.first_chunk_at ?? createdAt;
    }

    return {
      rawPayload,
      timing,
      payloadTruncated,
      truncationReason,
      observeMs: elapsedPerfMs(observeStart),
    };
  }

  if (observationTimeoutMs != null) {
    observationTimeout = setTimeout(() => {
      truncationReason = 'duration_limit';
      stopObservation(true);
    }, observationTimeoutMs);
    if (observationTimeout && typeof observationTimeout === 'object' && 'unref' in observationTimeout) {
      (observationTimeout as NodeJS.Timeout).unref();
    }
  }

  const observeChunk = (chunk: Uint8Array): void => {
    if (observationStopped) return;
    const now = getObservedAt();

    let observedChunk = chunk;
    if (streamingLimits && totalBytes + chunk.byteLength > streamingLimits.maxBytes) {
      const remainingBytes = streamingLimits.maxBytes - totalBytes;
      observedChunk = remainingBytes > 0 ? chunk.slice(0, remainingBytes) : new Uint8Array();
      payloadTruncated = true;
      truncationReason = 'size_limit';
    }

    if (observedChunk.byteLength > 0) {
      if (firstChunkAt == null) firstChunkAt = now;
      totalBytes += observedChunk.byteLength;
      chunks.push(observedChunk);
    }

    const textChunk = decoder.decode(observedChunk, { stream: true });
    if (isEventStream && textChunk) {
      pendingSseText += textChunk;
    }
    if (!hasStreamingContent && (textChunk.includes('event: ') || textChunk.includes('data: '))) {
      hasStreamingContent = true;
    }

    if (isEventStream) {
      consumeSseEvents(now);
    } else if (firstTokenAt == null && provider.hasTextualSignal(textChunk)) {
      firstTokenAt = now;
    }

    if (payloadTruncated) {
      stopObservation(true);
    }
  };

  function consumeSseEvents(observedAt: number): void {
    if (firstTokenAt != null || !pendingSseText) return;

    const normalized = pendingSseText.replace(/\r\n/g, '\n');
    const eventBlocks = normalized.split(/\n\n/);
    const trailingPartial = normalized.endsWith('\n\n') ? '' : (eventBlocks.pop() ?? '');

    for (const block of eventBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      if (provider.hasTextualSignal(trimmed)) {
        firstTokenAt = observedAt;
        pendingSseText = trailingPartial;
        return;
      }
    }

    pendingSseText = trailingPartial;
  }

  return {
    observationPromise,
    observeChunkSafely,
    stopObservation,
    failObservation,
    isStopped: () => observationStopped,
  };
}

/**
 * Create a pass-through stream for SSE-style responses where the client's pull
 * cadence controls upstream reads. Observation remains best-effort only.
 */
function createObservingPassthrough(
  sourceBody: ReadableStream<Uint8Array>,
  createdAt: number,
  createdAtPerf: number,
  upstreamType: UpstreamType,
  contentType: string | null | undefined,
): { stream: ReadableStream<Uint8Array>; observationPromise: Promise<ResponseObservation> } {
  const sourceReader = sourceBody.getReader();
  const collector = createObservationCollector(createdAt, createdAtPerf, upstreamType, contentType);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await sourceReader.read();
        if (done) {
          collector.stopObservation(false, toObservedEpochMs(createdAt, createdAtPerf, nowPerfMs(), Date.now()));
          controller.close();
          return;
        }
        if (!value) return;

        controller.enqueue(value);
        collector.observeChunkSafely(value);
      } catch (error) {
        collector.failObservation(error);
        controller.error(error);
      }
    },
    cancel(reason) {
      collector.stopObservation(true);
      return sourceReader.cancel(reason);
    },
  });

  return { stream, observationPromise: collector.observationPromise };
}

/**
 * Non-streaming responses are logged from a cloned body so logging can finish
 * even if the client only inspects status/headers and never consumes the body.
 */
async function observeDetachedResponseBody(
  sourceBody: ReadableStream<Uint8Array>,
  createdAt: number,
  createdAtPerf: number,
  upstreamType: UpstreamType,
  contentType: string | null | undefined,
): Promise<ResponseObservation> {
  const sourceReader = sourceBody.getReader();
  const collector = createObservationCollector(createdAt, createdAtPerf, upstreamType, contentType);

  try {
    while (true) {
      const { value, done } = await sourceReader.read();
      if (done) {
        collector.stopObservation(false, toObservedEpochMs(createdAt, createdAtPerf, nowPerfMs(), Date.now()));
        break;
      }
      if (!value) continue;

      collector.observeChunkSafely(value);
      if (collector.isStopped()) {
        await sourceReader.cancel('response observation complete').catch(() => undefined);
        break;
      }
    }
  } catch (error) {
    collector.failObservation(error);
  }

  return collector.observationPromise;
}

function formatTruncationReason(reason: TruncationReason): string | undefined {
  if (reason === 'size_limit') return 'body too large';
  if (reason === 'duration_limit') return 'stream duration timeout';
  return undefined;
}

function hasNoTokenUsage(usage: UsageData): boolean {
  return usage.input_tokens === 0
    && usage.output_tokens === 0
    && usage.total_tokens === 0
    && usage.cache_creation_input_tokens === 0
    && usage.cache_read_input_tokens === 0
    && usage.cached_input_tokens === 0
    && usage.reasoning_output_tokens === 0
    && usage.ephemeral_5m_input_tokens === 0
    && usage.ephemeral_1h_input_tokens === 0;
}

function applyEstimatedTokenUsageFallback(
  usage: UsageData,
  requestBody: string | null | undefined,
  responseBody: string | null | undefined,
): UsageData {
  if (!hasNoTokenUsage(usage)) return usage;

  const estimatedInput = estimateInputTokens(requestBody);
  const estimatedOutput = estimateOutputTokens(responseBody);
  if (estimatedInput <= 0 && estimatedOutput <= 0) return usage;

  return {
    ...usage,
    input_tokens: estimatedInput,
    output_tokens: estimatedOutput,
    total_tokens: estimatedInput + estimatedOutput,
    estimated: true,
  };
}

function queueObservedResponseLog(
  observation: ResponseObservation,
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  requestId: string,
  path: string,
  createdAt: number,
  upstreamType: UpstreamType,
  truncatePayloadForLog: FinalizeProxyResponseOptions['truncatePayloadForLog'],
  requestBody?: string,
): void {
  const task = Promise.resolve()
    .then(async () => {
      const { rawPayload, timing, payloadTruncated, truncationReason, observeMs } = observation;
      const payloadForLog = truncatePayloadForLog(rawPayload);
      const usage = applyEstimatedTokenUsageFallback(
        parseUsageForProvider(rawPayload, upstreamType),
        requestBody,
        rawPayload,
      );

      // 合并截断原因：优先使用观测阶段的截断原因，其次使用日志输出阶段的截断原因
      const finalTruncationReason = truncationReason ?? (payloadForLog.truncated ? 'size_limit' : null);

      recordBackgroundPerfSample({
        kind: 'observe_response_body',
        request_id: requestId,
        total_ms: observeMs,
      });
      if (payloadTruncated || shouldLogBackgroundPerf(observeMs)) {
        const reason = formatTruncationReason(finalTruncationReason);
        const reasonSuffix = reason ? ` | reason=${reason}` : '';
        console.log(`[PERF_BG] observe_response_body | request_id=${requestId} | total=${observeMs}ms${reasonSuffix}`);
      }
      console.log('[RES_PAYLOAD]', {
        request_id: requestId,
        path,
        status: response.status,
        status_text: response.statusText,
        original_bytes: payloadForLog.originalBytes,
        logged_bytes: payloadForLog.loggedBytes,
        truncated: payloadForLog.truncated || payloadTruncated,
        truncation_reason: formatTruncationReason(finalTruncationReason),
        observed_truncated: payloadTruncated,
        log_truncated: payloadForLog.truncated,
      });
      console.log('[RES_USAGE]', {
        request_id: requestId,
        path,
        first_chunk_ms: timing.first_chunk_at == null ? null : Math.max(0, timing.first_chunk_at - createdAt),
        first_token_ms: timing.first_token_at == null ? null : Math.max(0, timing.first_token_at - createdAt),
        duration_ms: timing.completed_at == null ? null : Math.max(0, timing.completed_at - createdAt),
        body_bytes: timing.response_body_bytes,
        payload_truncated: payloadTruncated || payloadForLog.truncated,
        truncation_reason: formatTruncationReason(finalTruncationReason),
        ...usage,
      });

      await waitForPendingConsoleRequestWrite(requestId);
      return saveConsoleResponse({
        request_id: requestId,
        response_status: response.status,
        response_status_text: response.statusText,
        response_headers: captureResponseHeaders(response.headers),
        response_payload: payloadForLog.payload,
        response_payload_truncated: payloadTruncated || payloadForLog.truncated,
        response_payload_truncation_reason: formatTruncationReason(finalTruncationReason),
        response_usage: usage,
        response_timing: timing,
      });
    })
    .catch((error) => {
      console.warn('[RES_PAYLOAD_READ_ERR]', { request_id: requestId, path, error });
    });
  trackPendingConsoleLogTask(task);
}

function logResponseObservationAsync(
  observationPromise: Promise<ResponseObservation>,
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  requestId: string,
  path: string,
  createdAt: number,
  createdAtPerf: number,
  upstreamType: UpstreamType,
  truncatePayloadForLog: FinalizeProxyResponseOptions['truncatePayloadForLog'],
  requestBody?: string,
): void {
  const task = observationPromise
    .then((observation) => {
      queueObservedResponseLog(observation, response, requestId, path, createdAt, upstreamType, truncatePayloadForLog, requestBody);
    })
    .catch(async (error: unknown) => {
      console.warn('[RES_PAYLOAD_READ_ERR]', { request_id: requestId, path, error });
      await waitForPendingConsoleRequestWrite(requestId);
      await saveConsoleResponse({
        request_id: requestId,
        response_status: response.status,
        response_status_text: response.statusText || (response.status === 504 ? 'Timeout' : ''),
        response_headers: captureResponseHeaders(response.headers),
        response_payload: null,
        response_payload_truncated: false,
        response_usage: createEmptyUsage(),
        response_timing: {
          response_body_bytes: 0,
          first_chunk_at: null,
          first_token_at: null,
          completed_at: toObservedEpochMs(createdAt, createdAtPerf, nowPerfMs(), Date.now()),
          has_streaming_content: false,
        },
      });
    });
  trackPendingConsoleLogTask(task);
}

function logEmptyResponseAsync(
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  requestId: string,
  path: string,
  createdAt: number,
  createdAtPerf: number,
  upstreamType: UpstreamType,
  truncatePayloadForLog: FinalizeProxyResponseOptions['truncatePayloadForLog'],
  requestBody?: string,
): void {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isEventStream = isEventStreamContentType(contentType);
  const observation: ResponseObservation = {
    rawPayload: '',
    timing: {
      response_body_bytes: 0,
      first_chunk_at: null,
      first_token_at: null,
      completed_at: toObservedEpochMs(createdAt, createdAtPerf, nowPerfMs(), Date.now()),
      has_streaming_content: isEventStream,
    },
    payloadTruncated: false,
    truncationReason: null,
    observeMs: 0,
  };
  queueObservedResponseLog(observation, response, requestId, path, createdAt, upstreamType, truncatePayloadForLog, requestBody);
}

export function finalizeProxyResponse(options: FinalizeProxyResponseOptions): Response {
  const { response, requestId, path, shouldLog, createdAt, createdAtPerf, upstreamType, truncatePayloadForLog, requestBody, bodyIdleTimeoutMs, rewriteModel } = options;
  const provider = getProviderAdapter(upstreamType);
  const transformedResponse = provider.transformResponse(response);
  const headers = new Headers(transformedResponse.headers);
  const contentType = headers.get('content-type')?.toLowerCase() ?? '';
  const isEventStream = isEventStreamContentType(contentType);
  if (isEventStream) {
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-cache');
    headers.set('x-accel-buffering', 'no');
  }

  if (!transformedResponse.body) {
    if (shouldLog) logEmptyResponseAsync(transformedResponse, requestId, path, createdAt, createdAtPerf, upstreamType, truncatePayloadForLog, requestBody);
    return new Response(null, {
      status: transformedResponse.status,
      statusText: transformedResponse.statusText,
      headers,
    });
  }

  const rewrittenBody = rewriteModel && rewriteModel.from && rewriteModel.from !== rewriteModel.to
    ? createModelFieldRewriteBody(transformedResponse.body, rewriteModel)
    : transformedResponse.body;

  const guardedBody = createTimeoutGuardedBody(
    rewrittenBody,
    bodyIdleTimeoutMs,
    requestId,
    path,
  );

  if (!shouldLog) {
    return new Response(guardedBody, {
      status: transformedResponse.status,
      statusText: transformedResponse.statusText,
      headers,
    });
  }

  if (!isEventStream) {
    const responseWithGuardedBody = new Response(guardedBody, {
      status: transformedResponse.status,
      statusText: transformedResponse.statusText,
      headers,
    });
    const detachedBody = responseWithGuardedBody.clone().body;
    if (detachedBody) {
      logResponseObservationAsync(
        observeDetachedResponseBody(detachedBody, createdAt, createdAtPerf, upstreamType, contentType),
        responseWithGuardedBody,
        requestId,
        path,
        createdAt,
        createdAtPerf,
        upstreamType,
        truncatePayloadForLog,
        requestBody,
      );
    } else {
      logEmptyResponseAsync(responseWithGuardedBody, requestId, path, createdAt, createdAtPerf, upstreamType, truncatePayloadForLog, requestBody);
    }
    return responseWithGuardedBody;
  }

  // SSE responses stay on the client-driven read cadence so logging never owns
  // the upstream lifecycle for long-lived streams.
  const { stream: observedBody, observationPromise } = createObservingPassthrough(
    guardedBody,
    createdAt,
    createdAtPerf,
    upstreamType,
    contentType,
  );
  logResponseObservationAsync(observationPromise, transformedResponse, requestId, path, createdAt, createdAtPerf, upstreamType, truncatePayloadForLog, requestBody);

  return new Response(observedBody, {
    status: transformedResponse.status,
    statusText: transformedResponse.statusText,
    headers,
  });
}
