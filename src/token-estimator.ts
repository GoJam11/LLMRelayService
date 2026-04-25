import { encoding_for_model, get_encoding } from '@dqbd/tiktoken';

export interface TokenEstimate {
  input_tokens: number;
  output_tokens: number;
  estimated: true;
}

type EncodingType = ReturnType<typeof get_encoding>;
type JsonRecord = Record<string, any>;

let cachedEncoder: EncodingType | null = null;

function getEncoder(modelName: string): EncodingType {
  try {
    return encoding_for_model(modelName as any);
  } catch {
    // Fallback to cl100k_base (GPT-3.5+/GPT-4 encoding)
    return get_encoding('cl100k_base');
  }
}

function countTokensInternal(text: string, encoder: EncodingType): number {
  try {
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch {
    // Fallback to character heuristic: ~1 token per 4 chars (English)
    return Math.ceil(text.length / 4);
  }
}

function getDefaultEncoder(): EncodingType {
  if (cachedEncoder) return cachedEncoder;
  cachedEncoder = get_encoding('cl100k_base');
  return cachedEncoder;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function joinPieces(pieces: string[], separator = '\n\n'): string {
  return pieces.filter((piece) => piece.length > 0).join(separator);
}

export function countTokens(text: string, modelName: string = 'gpt-3.5-turbo'): number {
  try {
    const encoder = getEncoder(modelName);
    return countTokensInternal(text, encoder);
  } catch {
    // Last resort: character heuristic
    return Math.ceil(text.length / 4);
  }
}

interface RequestMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  function_call?: unknown;
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return joinPieces(value.map((item) => extractContentText(item)));
  }

  if (!isRecord(value)) return '';

  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'image_url' || type === 'input_image' || type === 'image') return '';

  const directTextFields = ['text', 'input_text', 'output_text', 'value'];
  for (const field of directTextFields) {
    if (typeof value[field] === 'string') return value[field];
  }

  if (value.content != null) return extractContentText(value.content);
  if (value.input != null && (type === 'tool_use' || type === 'function_call')) {
    return safeJsonStringify(value.input);
  }
  if (typeof value.arguments === 'string') return value.arguments;

  const fn = value.function;
  if (isRecord(fn)) {
    const pieces = [
      typeof fn.name === 'string' ? fn.name : '',
      typeof fn.arguments === 'string' ? fn.arguments : '',
    ];
    return joinPieces(pieces, '\n');
  }

  return '';
}

function extractInputParts(parsed: JsonRecord): { text: string; messageCount: number; usedKnownFields: boolean } {
  const pieces: string[] = [];
  let messageCount = 0;
  let usedKnownFields = false;

  if (parsed.system != null) {
    usedKnownFields = true;
    pieces.push(extractContentText(parsed.system));
  }

  if (typeof parsed.instructions === 'string') {
    usedKnownFields = true;
    pieces.push(parsed.instructions);
  }

  if (typeof parsed.prompt === 'string') {
    usedKnownFields = true;
    pieces.push(parsed.prompt);
  }

  const messages = parsed.messages as RequestMessage[] | undefined;
  if (Array.isArray(messages)) {
    usedKnownFields = true;
    for (const msg of messages) {
      messageCount += 1;
      pieces.push(extractContentText(msg.content));
      if (msg.tool_calls != null) pieces.push(safeJsonStringify(msg.tool_calls));
      if (msg.function_call != null) pieces.push(safeJsonStringify(msg.function_call));
    }
  }

  if (parsed.input != null) {
    usedKnownFields = true;
    if (typeof parsed.input === 'string') {
      pieces.push(parsed.input);
    } else if (Array.isArray(parsed.input)) {
      for (const item of parsed.input) {
        if (isRecord(item) && (item.role != null || item.content != null)) {
          messageCount += 1;
          pieces.push(extractContentText(item.content ?? item));
        } else {
          pieces.push(extractContentText(item));
        }
      }
    } else {
      pieces.push(extractContentText(parsed.input));
    }
  }

  if (Array.isArray(parsed.tools)) {
    usedKnownFields = true;
    pieces.push(safeJsonStringify(parsed.tools));
  }
  if (Array.isArray(parsed.functions)) {
    usedKnownFields = true;
    pieces.push(safeJsonStringify(parsed.functions));
  }

  return {
    text: joinPieces(pieces),
    messageCount,
    usedKnownFields,
  };
}

export function estimateInputTokens(requestBodyText: string | null | undefined): number {
  if (!requestBodyText) return 0;

  try {
    const parsed = JSON.parse(requestBodyText) as unknown;
    if (!isRecord(parsed)) return 0;

    const modelName = typeof parsed.model === 'string' && parsed.model.length > 0
      ? parsed.model
      : 'gpt-3.5-turbo';
    const encoder = getEncoder(modelName);
    const input = extractInputParts(parsed);
    const text = input.text || (!input.usedKnownFields ? safeJsonStringify(parsed) : '');
    if (!text) return input.messageCount > 0 ? input.messageCount * 4 : 0;

    // ~4 tokens per chat message for role/name framing overhead.
    return countTokensInternal(text, encoder) + input.messageCount * 4;
  } catch {
    // Can't parse or estimate, return 0
    return 0;
  }
}

function extractToolCallText(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) return '';
  return joinPieces(toolCalls.map((toolCall) => {
    if (!isRecord(toolCall)) return '';
    const pieces: string[] = [];
    if (typeof toolCall.name === 'string') pieces.push(toolCall.name);
    if (typeof toolCall.arguments === 'string') pieces.push(toolCall.arguments);
    if (isRecord(toolCall.function)) {
      if (typeof toolCall.function.name === 'string') pieces.push(toolCall.function.name);
      if (typeof toolCall.function.arguments === 'string') pieces.push(toolCall.function.arguments);
    }
    return joinPieces(pieces, '\n');
  }));
}

function extractOutputPiecesFromJson(value: unknown): string[] {
  if (!isRecord(value)) return [];

  const payload = isRecord(value.response) ? value.response : value;
  const pieces: string[] = [];

  if (typeof payload.output_text === 'string') pieces.push(payload.output_text);
  if (typeof payload.completion === 'string') pieces.push(payload.completion);

  if (payload.content != null && (payload.role === 'assistant' || payload.type === 'message')) {
    pieces.push(extractContentText(payload.content));
  }

  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!isRecord(choice)) continue;
      if (typeof choice.text === 'string') pieces.push(choice.text);

      const message = isRecord(choice.message) ? choice.message : null;
      if (message) {
        pieces.push(extractContentText(message.content));
        pieces.push(extractToolCallText(message.tool_calls));
        if (message.function_call != null) pieces.push(safeJsonStringify(message.function_call));
      }

      const delta = isRecord(choice.delta) ? choice.delta : null;
      if (delta) {
        pieces.push(extractContentText(delta.content));
        pieces.push(extractToolCallText(delta.tool_calls));
        if (delta.function_call != null) pieces.push(safeJsonStringify(delta.function_call));
      } else if (typeof choice.delta === 'string') {
        pieces.push(choice.delta);
      }
    }
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item)) continue;
      if (item.content != null) pieces.push(extractContentText(item.content));
      if (item.arguments != null) pieces.push(extractContentText(item.arguments));
    }
  }

  const message = isRecord(payload.message) ? payload.message : null;
  if (message?.content != null) pieces.push(extractContentText(message.content));

  const delta = isRecord(payload.delta) ? payload.delta : null;
  if (delta) {
    if (typeof delta.text === 'string') pieces.push(delta.text);
    if (typeof delta.content === 'string') pieces.push(delta.content);
  }

  return pieces.filter((piece) => piece.length > 0);
}

function extractStreamingOutputPiecesFromJson(json: JsonRecord, eventType: string): string[] {
  const pieces: string[] = [];

  if (eventType === 'content_block_start' && isRecord(json.content_block)) {
    const block = json.content_block;
    if (block.type === 'text' && typeof block.text === 'string') pieces.push(block.text);
  }

  if (eventType === 'content_block_delta' && isRecord(json.delta)) {
    const delta = json.delta;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') pieces.push(delta.text);
  }

  if (eventType === 'message_start' && isRecord(json.message) && json.message.content != null) {
    pieces.push(extractContentText(json.message.content));
  }

  if (typeof json.type === 'string') {
    if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
      pieces.push(json.delta);
    }
    if (json.type === 'response.completed') {
      pieces.push(...extractOutputPiecesFromJson(json));
    }
  }

  if (pieces.length > 0) return pieces;

  pieces.push(...extractOutputPiecesFromJson(json));
  return pieces.filter((piece) => piece.length > 0);
}

function extractSseOutputText(responseText: string): { text: string; sawSseData: boolean } {
  const normalized = responseText.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\n/);
  const pieces: string[] = [];
  let sawSseData = false;

  for (const block of blocks) {
    if (!block.trim()) continue;

    let eventType = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    }

    if (dataLines.length === 0) continue;
    sawSseData = true;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') continue;

    try {
      const json = JSON.parse(data) as unknown;
      if (isRecord(json)) {
        if (json.type === 'response.completed' && pieces.length > 0) continue;
        pieces.push(...extractStreamingOutputPiecesFromJson(json, eventType));
      }
    } catch {}
  }

  return {
    text: joinPieces(pieces, ''),
    sawSseData,
  };
}

export function estimateOutputTokens(responseText: string | null | undefined): number {
  if (!responseText) return 0;

  try {
    const trimmed = responseText.trim();
    const encoder = getDefaultEncoder();

    if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
      const sseOutput = extractSseOutputText(responseText);
      if (sseOutput.text) return countTokensInternal(sseOutput.text, encoder);
      if (sseOutput.sawSseData) return 0;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed) as unknown;
      const text = joinPieces(extractOutputPiecesFromJson(parsed));
      return text ? countTokensInternal(text, encoder) : 0;
    }

    return countTokensInternal(responseText, encoder);
  } catch {
    return Math.ceil((responseText?.length ?? 0) / 4);
  }
}

// Initialize encoder on module load to avoid WASM init delay during request handling
export function initializeTokenEstimator(): void {
  try {
    cachedEncoder = getDefaultEncoder();
  } catch (err) {
    console.warn('[TOKEN_ESTIMATOR_INIT]', 'Failed to initialize tiktoken encoder', err);
  }
}
