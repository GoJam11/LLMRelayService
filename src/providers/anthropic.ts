import type { RouteAuthConfig } from '../config';
import type { DetectedRequestKind, PreparedRequestResult, ProviderAdapter, ProviderPrepareRequestOptions, UsageData } from './types';
import { summarizeJsonPayload } from './summary';

const REMOVE_NODE = Symbol('removeNode');
const responseTextEncoder = new TextEncoder();

function isThinkingBlockType(value: unknown): boolean {
  return value === 'thinking' || value === 'redacted_thinking';
}

export function detectAnthropicRequestKind(rawPayload: string | null, _rawHeaders?: Headers): DetectedRequestKind {
  if (rawPayload == null) return 'unknown';
  try {
    JSON.parse(rawPayload);
    return 'generic';
  } catch {
    return 'unknown';
  }
}

function injectRouteSystemIntoSystem(json: Record<string, unknown>, routeSystem: string): void {
  if (typeof json.system === 'string') {
    json.system = routeSystem + '\n\n' + json.system;
  } else if (Array.isArray(json.system)) {
    json.system = [{ type: 'text', text: routeSystem }, ...json.system];
  } else {
    json.system = routeSystem;
  }
}

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

function finalizeUsageTotals(result: UsageData): UsageData {
  result.total_tokens = result.input_tokens + result.output_tokens + result.cache_creation_input_tokens + result.cache_read_input_tokens;
  return result;
}

function buildForwardHeaders(sourceHeaders: Headers, auth?: RouteAuthConfig): Headers {
  const forwardHeaders = new Headers(sourceHeaders);
  forwardHeaders.delete('host');
  forwardHeaders.delete('content-length');
  forwardHeaders.delete('accept-encoding');
  forwardHeaders.delete('connection');
  forwardHeaders.delete('keep-alive');
  forwardHeaders.delete('proxy-authenticate');
  forwardHeaders.delete('proxy-authorization');
  forwardHeaders.delete('te');
  forwardHeaders.delete('trailer');
  forwardHeaders.delete('transfer-encoding');
  forwardHeaders.delete('upgrade');

  if (auth) {
    const headerName = auth.header.toLowerCase();
    forwardHeaders.delete('authorization');
    forwardHeaders.delete('x-api-key');
    forwardHeaders.set(headerName, auth.value);
  }

  return forwardHeaders;
}

function prepareRequest(options: ProviderPrepareRequestOptions): PreparedRequestResult {
  const {
    method,
    rawBodyText,
    routeSystem,
  } = options;
  if (method !== 'POST' || rawBodyText == null) {
    return {
      requestModel: 'unknown',
      body: null,
    };
  }

  let workingJson: Record<string, unknown>;
  try {
    workingJson = JSON.parse(rawBodyText) as Record<string, unknown>;
  } catch {
    return {
      requestModel: 'unknown',
      body: null,
    };
  }

  if (routeSystem) {
    injectRouteSystemIntoSystem(workingJson, routeSystem);
  }

  return {
    requestModel: typeof workingJson.model === 'string' ? workingJson.model : 'unknown',
    body: JSON.stringify(workingJson),
  };
}

function removeThinkingBlocksValue(value: unknown): { sanitized: unknown | typeof REMOVE_NODE; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const sanitizedItems: unknown[] = [];

    for (const item of value) {
      const sanitizedItem = removeThinkingBlocksValue(item);
      if (sanitizedItem.sanitized === REMOVE_NODE) {
        changed = true;
        continue;
      }
      sanitizedItems.push(sanitizedItem.sanitized);
      if (sanitizedItem.changed) changed = true;
    }

    return changed
      ? { sanitized: sanitizedItems, changed: true }
      : { sanitized: value, changed: false };
  }

  if (!value || typeof value !== 'object') {
    return { sanitized: value, changed: false };
  }

  const record = value as Record<string, unknown>;
  if (isThinkingBlockType(record.type) || record.type === 'signature_delta' || record.type === 'thinking_delta') {
    return { sanitized: REMOVE_NODE, changed: true };
  }

  let changed = false;
  const sanitizedRecord: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    const sanitizedItem = removeThinkingBlocksValue(item);
    if (sanitizedItem.sanitized === REMOVE_NODE) {
      changed = true;
      continue;
    }
    sanitizedRecord[key] = sanitizedItem.sanitized;
    if (sanitizedItem.changed) changed = true;
  }

  return changed
    ? { sanitized: sanitizedRecord, changed: true }
    : { sanitized: value, changed: false };
}

function sanitizeSseEventBlock(eventBlock: string, removedThinkingIndexes: number[]): string | null {
  if (!eventBlock) return eventBlock;

  const lines = eventBlock.split(/\r?\n/);
  const dataLines = lines.filter((line) => line.startsWith('data: '));
  if (dataLines.length === 0) return eventBlock;

  const rawData = dataLines.map((line) => line.slice(6)).join('\n');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return eventBlock;
  }

  let payloadChanged = false;

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const eventType = record.type;
    const rawIndex = typeof record.index === 'number' ? record.index : null;

    if (eventType === 'content_block_start' && rawIndex != null) {
      const contentBlock = record.content_block;
      if (contentBlock && typeof contentBlock === 'object') {
        const contentBlockType = (contentBlock as Record<string, unknown>).type;
        if (isThinkingBlockType(contentBlockType)) {
          removedThinkingIndexes.push(rawIndex);
          return null;
        }
      }
    }

    if ((eventType === 'content_block_delta' || eventType === 'content_block_stop') && rawIndex != null && removedThinkingIndexes.includes(rawIndex)) {
      return null;
    }

    if (rawIndex != null && (eventType === 'content_block_start' || eventType === 'content_block_delta' || eventType === 'content_block_stop')) {
      const removedBefore = removedThinkingIndexes.filter((index) => index < rawIndex).length;
      if (removedBefore > 0) {
        payloadChanged = true;
        parsed = {
          ...record,
          index: rawIndex - removedBefore,
        };
      }
    }
  }

  const sanitized = removeThinkingBlocksValue(parsed);
  if (!sanitized.changed) {
    if (payloadChanged) {
      const rebuiltLines: string[] = [];
      let wroteData = false;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          if (!wroteData) {
            rebuiltLines.push(`data: ${JSON.stringify(parsed)}`);
            wroteData = true;
          }
          continue;
        }
        rebuiltLines.push(line);
      }
      return rebuiltLines.join('\n');
    }
    return eventBlock;
  }
  if (sanitized.sanitized === REMOVE_NODE) {
    return null;
  }

  const rebuiltLines: string[] = [];
  let wroteData = false;
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      if (!wroteData) {
        rebuiltLines.push(`data: ${JSON.stringify(sanitized.sanitized)}`);
        wroteData = true;
      }
      continue;
    }
    rebuiltLines.push(line);
  }

  return rebuiltLines.join('\n');
}

function createThinkingBlockFilteredSseStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  const removedThinkingIndexes: number[] = [];

  function flushCompleteEvents(controller: TransformStreamDefaultController<Uint8Array>): void {
    while (true) {
      const boundaryMatch = /\r?\n\r?\n/.exec(buffer);
      if (!boundaryMatch || boundaryMatch.index == null) break;

      const separator = boundaryMatch[0];
      const eventBlock = buffer.slice(0, boundaryMatch.index);
      buffer = buffer.slice(boundaryMatch.index + separator.length);

      const sanitizedEvent = sanitizeSseEventBlock(eventBlock, removedThinkingIndexes);
      if (sanitizedEvent) {
        controller.enqueue(responseTextEncoder.encode(sanitizedEvent + separator));
      }
    }
  }

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      flushCompleteEvents(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      flushCompleteEvents(controller);

      if (!buffer) return;
      const sanitizedEvent = sanitizeSseEventBlock(buffer, removedThinkingIndexes);
      if (sanitizedEvent) {
        controller.enqueue(responseTextEncoder.encode(sanitizedEvent));
      }
    },
  }));
}

function createThinkingBlockFilteredJsonStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
    },
    flush(controller) {
      buffer += decoder.decode();

      let output = buffer;
      try {
        const parsed = JSON.parse(buffer) as unknown;
        const sanitized = removeThinkingBlocksValue(parsed);
        if (sanitized.changed && sanitized.sanitized !== REMOVE_NODE) {
          output = JSON.stringify(sanitized.sanitized);
        }
      } catch {}

      controller.enqueue(responseTextEncoder.encode(output));
    },
  }));
}

function transformResponse(response: Response): Response {
  return response;
}

function parseUsage(body: string): UsageData {
  const result = createEmptyUsage();
  if (!body) return result;

  if (!body.startsWith('event:')) {
    try {
      const json = JSON.parse(body) as Record<string, any>;
      result.model = json.model ?? '';
      result.stop_reason = json.stop_reason ?? '';
      const usage = json.usage;
      if (usage) {
        result.input_tokens = usage.input_tokens ?? 0;
        result.output_tokens = usage.output_tokens ?? 0;
        result.cache_creation_input_tokens = usage.cache_creation_input_tokens ?? 0;
        result.cache_read_input_tokens = usage.cache_read_input_tokens ?? 0;
        if (usage.cache_creation && typeof usage.cache_creation === 'object') {
          result.ephemeral_5m_input_tokens = usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
          result.ephemeral_1h_input_tokens = usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
        }
        finalizeUsageTotals(result);
      }
      return result;
    } catch {
      return result;
    }
  }

  const events = body.split('\n\n');
  for (const event of events) {
    const lines = event.split('\n');
    let eventType = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (!data) continue;

    try {
      const json = JSON.parse(data) as Record<string, any>;
      if (eventType === 'message_start' && json.message) {
        result.model = json.message.model ?? '';
        const usage = json.message.usage;
        if (usage) {
          result.input_tokens = usage.input_tokens ?? 0;
          result.cache_creation_input_tokens = usage.cache_creation_input_tokens ?? 0;
          result.cache_read_input_tokens = usage.cache_read_input_tokens ?? 0;
          if (usage.cache_creation && typeof usage.cache_creation === 'object') {
            result.ephemeral_5m_input_tokens = usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
            result.ephemeral_1h_input_tokens = usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
          }
          finalizeUsageTotals(result);
        }
      }
      if (eventType === 'message_delta') {
        result.stop_reason = json.delta?.stop_reason ?? result.stop_reason;
        if (json.usage?.output_tokens != null) result.output_tokens = json.usage.output_tokens;
        if (json.usage?.cache_creation_input_tokens != null) result.cache_creation_input_tokens = json.usage.cache_creation_input_tokens;
        if (json.usage?.cache_read_input_tokens != null) result.cache_read_input_tokens = json.usage.cache_read_input_tokens;
        finalizeUsageTotals(result);
      }
    } catch {}
  }

  return result;
}

function hasTextualSignal(chunk: string): boolean {
  if (!chunk) return false;

  const lines = chunk.split(/\r?\n/);
  let eventType = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event: ')) eventType = line.slice(7).trim();
    if (line.startsWith('data: ')) dataLines.push(line.slice(6));
  }

  if (!dataLines.length) return false;

  const data = dataLines.join('\n');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (eventType === 'content_block_start') {
    const block = json.content_block as Record<string, unknown> | undefined;
    return block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0;
  }

  if (eventType === 'content_block_delta') {
    const delta = json.delta as Record<string, unknown> | undefined;
    return delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0;
  }

  if (eventType === 'message_start') {
    const message = json.message as Record<string, unknown> | undefined;
    return extractTextForCachePoint(message?.content).length > 0;
  }

  return false;
}

function extractTextForCachePoint(value: unknown): string {
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextForCachePoint(item))
      .filter(Boolean)
      .join('\n\n');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (record.content != null) return extractTextForCachePoint(record.content);
  }

  return '';
}

export const anthropicProvider: ProviderAdapter = {
  type: 'anthropic',
  buildForwardHeaders,
  prepareRequest,
  transformResponse,
  parseUsage,
  summarizePayload: summarizeJsonPayload,
  detectRequestKind: detectAnthropicRequestKind,
  buildDebugAnalysis: (usage) => ({
    cache_state: usage.cache_read_input_tokens > 0
      ? 'hit'
      : usage.cache_creation_input_tokens > 0
        ? 'create'
        : 'miss',
    summary: usage.cache_read_input_tokens > 0
      ? '已读取缓存'
      : usage.cache_creation_input_tokens > 0
        ? '本次创建缓存'
        : '未命中缓存',
  }),
  hasTextualSignal,
};
