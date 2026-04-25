import type { DetectedRequestKind, PreparedRequestResult, ProviderAdapter, ProviderPrepareRequestOptions, UsageData } from './types';
import { summarizeJsonPayload } from './summary';
import type { RouteAuthConfig } from '../config';

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
  const { method, rawBodyText } = options;
  if (method !== 'POST' || rawBodyText == null) {
    return {
      requestModel: 'unknown',
      body: null,
    };
  }

  try {
    const json = JSON.parse(rawBodyText) as Record<string, unknown>;
    return {
      requestModel: typeof json.model === 'string' ? json.model : 'unknown',
      body: rawBodyText,
    };
  } catch {
    return {
      requestModel: 'unknown',
      body: rawBodyText,
    };
  }
}

function transformResponse(response: Response): Response {
  return response;
}

function parseUsage(body: string): UsageData {
  const result = createEmptyUsage();
  const trimmed = body.trim();
  if (!trimmed) return result;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      applyOpenAiPayload(JSON.parse(trimmed) as Record<string, any>, result);
      return result;
    } catch {
      return result;
    }
  }

  const events = trimmed.split('\n\n');
  for (const event of events) {
    const lines = event.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;

      try {
        applyOpenAiPayload(JSON.parse(data) as Record<string, any>, result);
      } catch {}
    }
  }

  if (result.total_tokens === 0 && (result.input_tokens > 0 || result.output_tokens > 0)) {
    result.total_tokens = result.input_tokens + result.output_tokens;
  }

  return result;
}

function isOpenAiRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function applyOpenAiPayload(json: Record<string, any>, result: UsageData): void {
  if (!isOpenAiRecord(json)) return;

  const payload = isOpenAiRecord(json.response) ? json.response : json;

  if (typeof payload.model === 'string' && payload.model) {
    result.model = payload.model;
  }

  if (typeof payload.stop_reason === 'string' && payload.stop_reason) {
    result.stop_reason = payload.stop_reason;
  }

  if (
    !result.stop_reason
    && payload.status === 'incomplete'
    && isOpenAiRecord(payload.incomplete_details)
    && typeof payload.incomplete_details.reason === 'string'
  ) {
    result.stop_reason = payload.incomplete_details.reason;
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (choice && typeof choice === 'object' && typeof choice.finish_reason === 'string' && choice.finish_reason) {
      result.stop_reason = choice.finish_reason;
      break;
    }
  }

  const usage = isOpenAiRecord(payload.usage) ? payload.usage : null;
  if (!usage) return;

  if (typeof usage.input_tokens === 'number') result.input_tokens = usage.input_tokens;
  if (typeof usage.output_tokens === 'number') result.output_tokens = usage.output_tokens;
  if (typeof usage.prompt_tokens === 'number') result.input_tokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') result.output_tokens = usage.completion_tokens;
  if (typeof usage.total_tokens === 'number') result.total_tokens = usage.total_tokens;

  const inputDetails = isOpenAiRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isOpenAiRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : null;
  if (inputDetails && typeof inputDetails.cached_tokens === 'number') {
    result.cached_input_tokens = inputDetails.cached_tokens;
  }

  const outputDetails = isOpenAiRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : isOpenAiRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details
      : null;
  if (outputDetails && typeof outputDetails.reasoning_tokens === 'number') {
    result.reasoning_output_tokens = outputDetails.reasoning_tokens;
  }

  if (result.total_tokens === 0 && (result.input_tokens > 0 || result.output_tokens > 0)) {
    result.total_tokens = result.input_tokens + result.output_tokens;
  }
}

function hasTextualSignal(chunk: string): boolean {
  if (!chunk) return false;

  const lines = chunk.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data: ')) dataLines.push(line.slice(6).trim());
  }

  if (!dataLines.length) return false;

  for (const data of dataLines) {
    if (!data || data === '[DONE]') continue;

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const eventType = typeof json.type === 'string' ? json.type : '';
    if (eventType === 'response.output_text.delta' && typeof json.delta === 'string' && json.delta.length > 0) {
      return true;
    }

    if (eventType === 'response.completed') {
      const response = json.response as Record<string, unknown> | undefined;
      const output = response?.output as unknown;
      if (extractTextForCachePoint(output).length > 0) return true;
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (typeof delta === 'string' && delta.length > 0) return true;
      if (delta && typeof delta === 'object') {
        const content = (delta as Record<string, unknown>).content;
        if (typeof content === 'string' && content.length > 0) return true;
        if (Array.isArray(content) && extractTextForCachePoint(content).length > 0) return true;
        // Check for tool_calls - even empty content with tool_calls is a valid first token
        const toolCalls = (delta as Record<string, unknown>).tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) return true;
      }
    }
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

export function detectOpenAiRequestKind(rawPayload: string | null, _rawHeaders?: Headers): DetectedRequestKind {
  if (rawPayload == null) return 'unknown';
  try {
    JSON.parse(rawPayload);
    return 'generic';
  } catch {
    return 'unknown';
  }
}

function detectRequestKind(rawPayload: string | null, rawHeaders?: Headers): DetectedRequestKind {
  return detectOpenAiRequestKind(rawPayload, rawHeaders);
}

export const openaiProvider: ProviderAdapter = {
  type: 'openai',
  buildForwardHeaders,
  prepareRequest,
  transformResponse,
  parseUsage,
  summarizePayload: summarizeJsonPayload,
  detectRequestKind,
  buildDebugAnalysis: (usage) => ({
    cache_state: usage.cached_input_tokens > 0 ? 'hit' : 'miss',
    summary: usage.cached_input_tokens > 0 ? '已读取缓存' : '未命中缓存',
  }),
  hasTextualSignal,
};
