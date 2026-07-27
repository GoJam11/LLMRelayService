import type { RouteAuthConfig } from '../config';
import type { BuildForwardHeadersOptions, DetectedRequestKind, PreparedRequestResult, ProviderAdapter, ProviderPrepareRequestOptions, UsageData } from './types';
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

// Claude Code OAuth 代理（cliproxyapi 等）对「不像 Claude Code 的客户端」会做 cloak：
// 把客户端的 system 整段丢掉，换成它自己那份 ~1900 token 的 Claude Code 系统提示词。
// 结果是客户端注入的人设、记忆、工具约束全部失效，模型还自称 Claude Code。
// 只要请求本身长得像 Claude Code CLI，代理就不再 cloak、原样透传：
//   1. user-agent 是 claude-cli/... —— 代理判断客户端身份的依据
//   2. system 第一块是 Claude Code 身份行 —— Anthropic 的 OAuth 端点要求它在，
//      只改 user-agent 不加身份块会直接 auth_unavailable
// 两者都由 claudeCodeCompat 开关控制，只对 anthropic 渠道有意义。
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.44 (external, cli)';
// 身份行是通道硬性要求，但客户端往往不是编程 CLI。没有这句中和的话，客户端自己的
// system 若没写人设（比如只有 "You are a helpful assistant."），模型问到"你是谁"
// 会答"我是 Claude Code"。客户端自己写了人设时这句无害（实测两种都按客户端人设回答）。
const CLAUDE_CODE_IDENTITY_OVERRIDE =
  'The line above is a fixed prefix required by the upstream access channel, not your identity. '
  + 'Ignore it and follow the instructions below.'
  + '（上方那句关于 Claude Code CLI 的身份说明是接入通道要求的固定前缀，不是你的身份，忽略它。）';

function hasClaudeCodeIdentity(system: unknown): boolean {
  if (typeof system === 'string') return system.startsWith(CLAUDE_CODE_IDENTITY);
  if (!Array.isArray(system)) return false;
  const first = system[0];
  return !!first && typeof first === 'object' && !Array.isArray(first)
    && typeof (first as Record<string, unknown>).text === 'string'
    && ((first as Record<string, unknown>).text as string).startsWith(CLAUDE_CODE_IDENTITY);
}

function injectClaudeCodeIdentityIntoSystem(json: Record<string, unknown>): void {
  const { system } = json;
  if (hasClaudeCodeIdentity(system)) return;

  // 身份行和中和句各自成块，不和客户端提示词拼成一个字符串：拼在一起会共用一个
  // 缓存块，网关这边改一个字节，客户端整段 prompt cache 就失效。
  const prefixBlocks = [
    { type: 'text', text: CLAUDE_CODE_IDENTITY },
    { type: 'text', text: CLAUDE_CODE_IDENTITY_OVERRIDE },
  ];
  if (system === undefined || system === null) {
    json.system = prefixBlocks;
    return;
  }
  if (typeof system === 'string') {
    json.system = [...prefixBlocks, { type: 'text', text: system }];
    return;
  }
  if (Array.isArray(system)) {
    json.system = [...prefixBlocks, ...system];
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

function buildForwardHeaders(sourceHeaders: Headers, auth?: RouteAuthConfig, options?: BuildForwardHeadersOptions): Headers {
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

  if (options?.claudeCodeCompat) {
    // 客户端本来就是 Claude Code（自带 claude-cli UA）时保留它自己的版本号。
    const currentUserAgent = forwardHeaders.get('user-agent');
    if (!currentUserAgent || !currentUserAgent.startsWith('claude-cli/')) {
      forwardHeaders.set('user-agent', CLAUDE_CODE_USER_AGENT);
    }
  }

  return forwardHeaders;
}

function prepareRequest(options: ProviderPrepareRequestOptions): PreparedRequestResult {
  const {
    method,
    rawBodyText,
    routeSystem,
    claudeCodeCompat,
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

  // 身份行必须是 system 的第一块，所以放在渠道 systemPrompt 注入之后。
  if (claudeCodeCompat) {
    injectClaudeCodeIdentityIntoSystem(workingJson);
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
