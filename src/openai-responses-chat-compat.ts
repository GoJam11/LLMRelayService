type JsonRecord = Record<string, unknown>;

export interface ResponsesChatCompatError {
  status: number;
  message: string;
  code?: string | null;
  param?: string | null;
}

export type ResponsesChatCompatRequestResult =
  | {
      ok: true;
      body: string;
      requestModel: string;
    }
  | {
      ok: false;
      error: ResponsesChatCompatError;
    };

const encoder = new TextEncoder();

const REQUEST_DIRECT_FIELDS = [
  'model',
  'temperature',
  'top_p',
  'stop',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'user',
  'seed',
  'stream',
  'stream_options',
  'store',
  'metadata',
  'service_tier',
  'parallel_tool_calls',
  'logprobs',
  'top_logprobs',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function createError(message: string, param?: string, code: string | null = null): ResponsesChatCompatError {
  return {
    status: 400,
    message,
    code,
    param: param ?? null,
  };
}

export function createResponsesChatCompatErrorResponse(error: ResponsesChatCompatError): Response {
  return Response.json({
    error: {
      message: error.message,
      type: 'invalid_request_error',
      param: error.param ?? null,
      code: error.code ?? null,
    },
  }, { status: error.status });
}

export function isOpenAiResponsesEndpointPath(pathname: string): boolean {
  return pathname === '/v1/responses';
}

export function rewriteResponsesTargetUrlToChatCompletions(targetUrl: string): string {
  const url = new URL(targetUrl);
  if (url.pathname.endsWith('/responses')) {
    url.pathname = url.pathname.slice(0, -'/responses'.length) + '/chat/completions';
  } else if (!url.pathname.endsWith('/chat/completions')) {
    url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  }
  return url.toString();
}

function normalizeChatRole(role: unknown): string {
  if (role === 'developer') return 'system';
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role;
  }
  return 'user';
}

function normalizeFunctionArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createChatTextPart(text: string): JsonRecord {
  return { type: 'text', text };
}

function convertImageUrl(value: unknown): JsonRecord | string | null {
  if (typeof value === 'string') return { url: value };
  if (isRecord(value)) return value;
  return null;
}

function convertResponsesContentPartToChat(part: unknown, param: string): string | JsonRecord | null {
  if (typeof part === 'string') return part;
  if (!isRecord(part)) return null;

  const type = part.type;
  if (type === 'input_text' || type === 'output_text' || type === 'text') {
    const text = asString(part.text);
    return text == null ? null : createChatTextPart(text);
  }

  if (type === 'refusal') {
    const refusal = asString(part.refusal);
    return refusal == null ? null : createChatTextPart(refusal);
  }

  if (type === 'input_image' || type === 'image_url') {
    const imageUrl = convertImageUrl(part.image_url);
    if (!imageUrl) {
      throw createError('Responses image content requires image_url to be a string or object.', param);
    }
    return { type: 'image_url', image_url: imageUrl };
  }

  if (type === 'input_file') {
    throw createError('Responses input_file content cannot be represented by Chat Completions.', param);
  }

  const text = asString(part.text);
  return text == null ? null : createChatTextPart(text);
}

function convertResponsesContentToChat(content: unknown, role: string, param: string): unknown {
  if (typeof content === 'string') return content;
  if (content == null) return role === 'assistant' ? null : '';

  if (!Array.isArray(content)) {
    if (isRecord(content) && typeof content.text === 'string') return content.text;
    return String(content);
  }

  const converted = content
    .map((part, index) => convertResponsesContentPartToChat(part, `${param}[${index}]`))
    .filter((part): part is string | JsonRecord => part != null);

  const textParts = converted.map((part) => {
    if (typeof part === 'string') return part;
    return part.type === 'text' && typeof part.text === 'string' ? part.text : null;
  });

  if (textParts.every((part) => part != null)) {
    return textParts.join('');
  }

  return converted.map((part) => typeof part === 'string' ? createChatTextPart(part) : part);
}

function convertFunctionCallItemToChatMessage(item: JsonRecord, index: number): JsonRecord {
  const callId = asString(item.call_id) ?? asString(item.id) ?? `call_${index}`;
  const name = asString(item.name);
  if (!name) {
    throw createError('Responses function_call item requires a name.', `input[${index}].name`);
  }

  return {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: callId,
      type: 'function',
      function: {
        name,
        arguments: normalizeFunctionArguments(item.arguments),
      },
    }],
  };
}

function convertFunctionCallOutputItemToChatMessage(item: JsonRecord, index: number): JsonRecord {
  const callId = asString(item.call_id);
  if (!callId) {
    throw createError('Responses function_call_output item requires call_id.', `input[${index}].call_id`);
  }

  return {
    role: 'tool',
    tool_call_id: callId,
    content: typeof item.output === 'string' ? item.output : normalizeFunctionArguments(item.output),
  };
}

function convertResponsesInputItemToChatMessage(item: unknown, index: number): JsonRecord | null {
  if (typeof item === 'string') {
    return { role: 'user', content: item };
  }

  if (!isRecord(item)) {
    return { role: 'user', content: String(item) };
  }

  if (item.type === 'reasoning') return null;
  if (item.type === 'function_call') return convertFunctionCallItemToChatMessage(item, index);
  if (item.type === 'function_call_output') return convertFunctionCallOutputItemToChatMessage(item, index);
  if (item.type === 'item_reference') {
    throw createError('Responses item_reference requires server-side state and is not supported by Chat Completions compatibility.', `input[${index}]`);
  }

  const role = normalizeChatRole(item.role);
  const message: JsonRecord = {
    role,
    content: convertResponsesContentToChat(item.content, role, `input[${index}].content`),
  };

  if (role === 'tool') {
    const callId = asString(item.tool_call_id) ?? asString(item.call_id);
    if (callId) message.tool_call_id = callId;
  }

  if (role === 'assistant' && Array.isArray(item.tool_calls)) {
    message.tool_calls = item.tool_calls;
  }

  return message;
}

function convertResponsesInputToChatMessages(input: unknown): JsonRecord[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  if (!Array.isArray(input)) {
    throw createError('Responses request requires input to be a string or an array for Chat Completions compatibility.', 'input');
  }

  const messages: JsonRecord[] = [];
  input.forEach((item, index) => {
    const message = convertResponsesInputItemToChatMessage(item, index);
    if (message) messages.push(message);
  });
  return messages;
}

function convertResponsesToolsToChatTools(tools: unknown): unknown {
  if (tools == null) return undefined;
  if (!Array.isArray(tools)) {
    throw createError('tools must be an array.', 'tools');
  }

  return tools.map((tool, index) => {
    if (!isRecord(tool)) {
      throw createError('Each tool must be an object.', `tools[${index}]`);
    }
    if (tool.type !== 'function') {
      throw createError(`Responses built-in tool "${String(tool.type)}" cannot be represented by Chat Completions.`, `tools[${index}].type`);
    }
    if (isRecord(tool.function)) {
      return { type: 'function', function: tool.function };
    }

    const name = asString(tool.name);
    if (!name) {
      throw createError('Function tool requires a name.', `tools[${index}].name`);
    }

    return {
      type: 'function',
      function: {
        name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...(isRecord(tool.parameters) ? { parameters: tool.parameters } : {}),
        ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
      },
    };
  });
}

function convertResponsesToolChoiceToChat(toolChoice: unknown): unknown {
  if (toolChoice == null || typeof toolChoice === 'string') return toolChoice;
  if (!isRecord(toolChoice)) return toolChoice;
  if (toolChoice.type === 'function' && typeof toolChoice.name === 'string') {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    };
  }
  return toolChoice;
}

function convertResponsesTextFormatToChatResponseFormat(text: unknown): unknown {
  if (!isRecord(text) || !isRecord(text.format)) return undefined;
  const format = text.format;

  if (format.type === 'text') return undefined;
  if (format.type === 'json_object') return { type: 'json_object' };

  if (format.type !== 'json_schema') {
    throw createError(`Unsupported Responses text.format type "${String(format.type)}".`, 'text.format.type');
  }

  const schemaSource = isRecord(format.json_schema) ? format.json_schema : format;
  const name = asString(schemaSource.name) ?? 'Output';
  const schema = isRecord(schemaSource.schema) ? schemaSource.schema : { type: 'object' };
  const strict = typeof schemaSource.strict === 'boolean' ? schemaSource.strict : undefined;

  return {
    type: 'json_schema',
    json_schema: {
      name,
      ...(strict !== undefined ? { strict } : {}),
      schema,
    },
  };
}

export function convertResponsesRequestToChatCompletions(rawBodyText: string): ResponsesChatCompatRequestResult {
  let body: JsonRecord;
  try {
    const parsed = JSON.parse(rawBodyText) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: createError('Request body must be a JSON object.') };
    }
    body = parsed;
  } catch {
    return { ok: false, error: createError('Request body must be valid JSON.') };
  }

  try {
    if (body.previous_response_id != null) {
      throw createError('previous_response_id is not supported by Chat Completions compatibility; pass prior turns explicitly in input.', 'previous_response_id');
    }
    if (body.conversation != null) {
      throw createError('conversation is not supported by Chat Completions compatibility; pass prior turns explicitly in input.', 'conversation');
    }
    if (body.n != null && body.n !== 1) {
      throw createError('Responses API does not support n > 1; Chat Completions compatibility only supports one generation.', 'n');
    }

    const chatPayload: JsonRecord = {};
    for (const field of REQUEST_DIRECT_FIELDS) {
      if (body[field] !== undefined) chatPayload[field] = body[field];
    }

    const messages = convertResponsesInputToChatMessages(body.input);
    if (typeof body.instructions === 'string' && body.instructions.length > 0) {
      messages.unshift({ role: 'system', content: body.instructions });
    }
    chatPayload.messages = messages;

    if (body.max_output_tokens !== undefined) {
      chatPayload.max_tokens = body.max_output_tokens;
    }
    if (body.max_completion_tokens !== undefined) {
      chatPayload.max_completion_tokens = body.max_completion_tokens;
    }

    const tools = convertResponsesToolsToChatTools(body.tools);
    if (tools !== undefined) chatPayload.tools = tools;

    const toolChoice = convertResponsesToolChoiceToChat(body.tool_choice);
    if (toolChoice !== undefined) chatPayload.tool_choice = toolChoice;

    const responseFormat = convertResponsesTextFormatToChatResponseFormat(body.text);
    if (responseFormat !== undefined) chatPayload.response_format = responseFormat;
    if (body.response_format !== undefined && chatPayload.response_format === undefined) {
      chatPayload.response_format = body.response_format;
    }

    if (isRecord(body.reasoning) && typeof body.reasoning.effort === 'string') {
      chatPayload.reasoning_effort = body.reasoning.effort;
    }

    return {
      ok: true,
      body: JSON.stringify(chatPayload),
      requestModel: typeof chatPayload.model === 'string' ? chatPayload.model : 'unknown',
    };
  } catch (error) {
    if (isRecord(error) && typeof error.status === 'number' && typeof error.message === 'string') {
      return { ok: false, error: error as unknown as ResponsesChatCompatError };
    }
    return {
      ok: false,
      error: createError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function toResponseId(chatId: unknown): string {
  const id = typeof chatId === 'string' && chatId.length > 0 ? chatId : crypto.randomUUID();
  return id.startsWith('resp_') ? id : `resp_${id}`;
}

function generatedItemId(prefix: string, responseId: string, index: number): string {
  return `${prefix}_${responseId.replace(/^resp_/, '').replace(/[^A-Za-z0-9_-]/g, '_')}_${index}`;
}

function convertChatUsageToResponsesUsage(usage: unknown): JsonRecord | null {
  if (!isRecord(usage)) return null;

  const inputTokens = typeof usage.input_tokens === 'number'
    ? usage.input_tokens
    : typeof usage.prompt_tokens === 'number'
      ? usage.prompt_tokens
      : 0;
  const outputTokens = typeof usage.output_tokens === 'number'
    ? usage.output_tokens
    : typeof usage.completion_tokens === 'number'
      ? usage.completion_tokens
      : 0;
  const totalTokens = typeof usage.total_tokens === 'number'
    ? usage.total_tokens
    : inputTokens + outputTokens;

  const promptDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : {};
  const completionDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : isRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details
      : {};

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    input_tokens_details: {
      cached_tokens: typeof promptDetails.cached_tokens === 'number' ? promptDetails.cached_tokens : 0,
    },
    output_tokens_details: {
      reasoning_tokens: typeof completionDetails.reasoning_tokens === 'number' ? completionDetails.reasoning_tokens : 0,
    },
  };
}

function statusFromFinishReason(finishReason: unknown): { status: string; incompleteDetails: JsonRecord | null } {
  if (finishReason === 'length') {
    return { status: 'incomplete', incompleteDetails: { reason: 'max_output_tokens' } };
  }
  if (finishReason === 'content_filter') {
    return { status: 'incomplete', incompleteDetails: { reason: 'content_filter' } };
  }
  return { status: 'completed', incompleteDetails: null };
}

function convertChatMessageContentToResponseParts(message: JsonRecord): JsonRecord[] {
  const content = message.content;
  const annotations = Array.isArray(message.annotations) ? message.annotations : [];

  if (typeof content === 'string' && content.length > 0) {
    return [{ type: 'output_text', text: content, annotations }];
  }

  if (Array.isArray(content)) {
    return content.flatMap((part) => {
      if (typeof part === 'string') return [{ type: 'output_text', text: part, annotations }];
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        return [{ type: 'output_text', text: part.text, annotations }];
      }
      return [];
    });
  }

  if (typeof message.refusal === 'string' && message.refusal.length > 0) {
    return [{ type: 'refusal', refusal: message.refusal }];
  }

  return [];
}

function convertChatToolCallsToResponseItems(toolCalls: unknown, responseId: string, startIndex: number): JsonRecord[] {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls.flatMap((toolCall, offset) => {
    if (!isRecord(toolCall)) return [];
    const fn = isRecord(toolCall.function) ? toolCall.function : {};
    const name = asString(fn.name);
    if (!name) return [];

    return [{
      id: generatedItemId('fc', responseId, startIndex + offset),
      type: 'function_call',
      status: 'completed',
      call_id: asString(toolCall.id) ?? generatedItemId('call', responseId, startIndex + offset),
      name,
      arguments: normalizeFunctionArguments(fn.arguments),
    }];
  });
}

function collectOutputText(output: JsonRecord[]): string {
  return output
    .flatMap((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      return content.flatMap((part) => isRecord(part) && part.type === 'output_text' && typeof part.text === 'string' ? [part.text] : []);
    })
    .join('');
}

export function convertChatCompletionToResponsePayload(chatCompletion: unknown): JsonRecord {
  if (!isRecord(chatCompletion)) {
    throw new Error('Chat completion response must be a JSON object.');
  }

  const responseId = toResponseId(chatCompletion.id);
  const choices = Array.isArray(chatCompletion.choices) ? chatCompletion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(firstChoice.message) ? firstChoice.message : {};
  const finishReason = firstChoice.finish_reason;
  const { status, incompleteDetails } = statusFromFinishReason(finishReason);
  const output: JsonRecord[] = [];

  const content = convertChatMessageContentToResponseParts(message);
  if (content.length > 0) {
    output.push({
      id: generatedItemId('msg', responseId, 0),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content,
    });
  }

  output.push(...convertChatToolCallsToResponseItems(message.tool_calls, responseId, output.length));

  const response: JsonRecord = {
    id: responseId,
    object: 'response',
    created_at: typeof chatCompletion.created === 'number' ? chatCompletion.created : Math.floor(Date.now() / 1000),
    status,
    error: null,
    incomplete_details: incompleteDetails,
    model: typeof chatCompletion.model === 'string' ? chatCompletion.model : '',
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    store: false,
    usage: convertChatUsageToResponsesUsage(chatCompletion.usage),
  };

  const outputText = collectOutputText(output);
  if (outputText) response.output_text = outputText;

  return response;
}

function createBufferedJsonResponseTransform(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
    },
    flush(controller) {
      buffer += decoder.decode();

      try {
        const parsed = JSON.parse(buffer) as unknown;
        controller.enqueue(encoder.encode(JSON.stringify(convertChatCompletionToResponsePayload(parsed))));
      } catch {
        controller.enqueue(encoder.encode(buffer));
      }
    },
  }));
}

function sseEvent(event: string, payload: JsonRecord): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function sseDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

interface StreamToolCallState {
  id: string;
  name: string;
  arguments: string;
}

interface StreamState {
  responseId: string;
  model: string;
  createdAt: number;
  created: boolean;
  messageStarted: boolean;
  contentStarted: boolean;
  finalized: boolean;
  text: string;
  finishReason: unknown;
  usage: unknown;
  toolCalls: Map<number, StreamToolCallState>;
}

function createEmptyStreamState(): StreamState {
  return {
    responseId: '',
    model: '',
    createdAt: Math.floor(Date.now() / 1000),
    created: false,
    messageStarted: false,
    contentStarted: false,
    finalized: false,
    text: '',
    finishReason: null,
    usage: null,
    toolCalls: new Map(),
  };
}

function streamResponseSkeleton(state: StreamState, status = 'in_progress', output: JsonRecord[] = []): JsonRecord {
  const { incompleteDetails } = statusFromFinishReason(state.finishReason);
  return {
    id: state.responseId || toResponseId(null),
    object: 'response',
    created_at: state.createdAt,
    status,
    error: null,
    incomplete_details: status === 'incomplete' ? incompleteDetails : null,
    model: state.model,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    store: false,
    usage: status === 'completed' || status === 'incomplete'
      ? convertChatUsageToResponsesUsage(state.usage)
      : null,
  };
}

function messageItemForStream(state: StreamState): JsonRecord {
  const content = [{ type: 'output_text', text: state.text, annotations: [] }];
  return {
    id: generatedItemId('msg', state.responseId, 0),
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content,
  };
}

function functionCallItemsForStream(state: StreamState, startIndex: number): JsonRecord[] {
  return Array.from(state.toolCalls.entries()).map(([index, call], offset) => ({
    id: generatedItemId('fc', state.responseId, startIndex + offset),
    type: 'function_call',
    status: 'completed',
    call_id: call.id || generatedItemId('call', state.responseId, index),
    name: call.name,
    arguments: call.arguments,
  }));
}

function ensureStreamCreated(controller: TransformStreamDefaultController<Uint8Array>, state: StreamState, chunk: JsonRecord): void {
  if (!state.responseId) state.responseId = toResponseId(chunk.id);
  if (!state.model && typeof chunk.model === 'string') state.model = chunk.model;
  if (typeof chunk.created === 'number') state.createdAt = chunk.created;
  if (state.created) return;

  state.created = true;
  const response = streamResponseSkeleton(state);
  controller.enqueue(sseEvent('response.created', {
    type: 'response.created',
    response,
  }));
}

function ensureMessageStarted(controller: TransformStreamDefaultController<Uint8Array>, state: StreamState): void {
  ensureStreamCreated(controller, state, {});
  if (!state.messageStarted) {
    state.messageStarted = true;
    const item = {
      id: generatedItemId('msg', state.responseId, 0),
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    };
    controller.enqueue(sseEvent('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item,
    }));
  }

  if (!state.contentStarted) {
    state.contentStarted = true;
    controller.enqueue(sseEvent('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: generatedItemId('msg', state.responseId, 0),
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    }));
  }
}

function appendToolCallDelta(state: StreamState, toolCallDelta: unknown): void {
  if (!Array.isArray(toolCallDelta)) return;

  for (const item of toolCallDelta) {
    if (!isRecord(item)) continue;
    const index = typeof item.index === 'number' ? item.index : state.toolCalls.size;
    const existing = state.toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
    if (typeof item.id === 'string') existing.id = item.id;
    const fn = isRecord(item.function) ? item.function : {};
    if (typeof fn.name === 'string') existing.name += fn.name;
    if (typeof fn.arguments === 'string') existing.arguments += fn.arguments;
    state.toolCalls.set(index, existing);
  }
}

function processChatCompletionChunk(
  controller: TransformStreamDefaultController<Uint8Array>,
  state: StreamState,
  chunk: JsonRecord,
): void {
  ensureStreamCreated(controller, state, chunk);
  if (isRecord(chunk.usage)) state.usage = chunk.usage;

  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    if (choice.finish_reason != null) state.finishReason = choice.finish_reason;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (Array.isArray(delta.tool_calls)) appendToolCallDelta(state, delta.tool_calls);

    const contentDelta = typeof delta.content === 'string' ? delta.content : '';
    if (!contentDelta) continue;

    ensureMessageStarted(controller, state);
    state.text += contentDelta;
    controller.enqueue(sseEvent('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: generatedItemId('msg', state.responseId, 0),
      output_index: 0,
      content_index: 0,
      delta: contentDelta,
    }));
  }
}

function finalizeStream(controller: TransformStreamDefaultController<Uint8Array>, state: StreamState): void {
  if (state.finalized) return;
  state.finalized = true;
  ensureStreamCreated(controller, state, {});

  const output: JsonRecord[] = [];
  if (state.messageStarted || state.text.length > 0) {
    ensureMessageStarted(controller, state);
    const message = messageItemForStream(state);
    controller.enqueue(sseEvent('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      text: state.text,
    }));
    controller.enqueue(sseEvent('response.content_part.done', {
      type: 'response.content_part.done',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      part: (message.content as JsonRecord[])[0] as JsonRecord,
    }));
    controller.enqueue(sseEvent('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: message,
    }));
    output.push(message);
  }

  const functionCalls = functionCallItemsForStream(state, output.length);
  for (const [offset, item] of functionCalls.entries()) {
    const outputIndex = output.length + offset;
    controller.enqueue(sseEvent('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item,
    }));
    controller.enqueue(sseEvent('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item,
    }));
  }
  output.push(...functionCalls);

  const { status } = statusFromFinishReason(state.finishReason);
  const response = streamResponseSkeleton(state, status, output);
  const outputText = collectOutputText(output);
  if (outputText) response.output_text = outputText;

  controller.enqueue(sseEvent('response.completed', {
    type: 'response.completed',
    response,
  }));
  controller.enqueue(sseDone());
}

function processSseBlock(
  controller: TransformStreamDefaultController<Uint8Array>,
  state: StreamState,
  block: string,
): void {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  if (!dataLines.length) return;

  const data = dataLines.join('\n').trim();
  if (!data) return;
  if (data === '[DONE]') {
    finalizeStream(controller, state);
    return;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    if (isRecord(parsed)) processChatCompletionChunk(controller, state, parsed);
  } catch {
    controller.enqueue(encoder.encode(`${block}\n\n`));
  }
}

function createChatCompletionsSseToResponsesSseStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const state = createEmptyStreamState();
  let buffer = '';

  function flushCompleteBlocks(controller: TransformStreamDefaultController<Uint8Array>): void {
    while (true) {
      const boundaryMatch = /\r?\n\r?\n/.exec(buffer);
      if (!boundaryMatch || boundaryMatch.index == null) break;
      const block = buffer.slice(0, boundaryMatch.index);
      buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
      processSseBlock(controller, state, block);
    }
  }

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      flushCompleteBlocks(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      flushCompleteBlocks(controller);
      if (buffer.trim()) processSseBlock(controller, state, buffer);
      finalizeStream(controller, state);
    },
  }));
}

function isEventStream(headers: Headers): boolean {
  return headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false;
}

function responseHeadersForTransformedBody(sourceHeaders: Headers, contentType: string): Headers {
  const headers = new Headers(sourceHeaders);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', contentType);
  return headers;
}

export function transformChatCompletionsResponseToResponses(response: Response): Response {
  if (!response.ok || !response.body) return response;

  if (isEventStream(response.headers)) {
    return new Response(createChatCompletionsSseToResponsesSseStream(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeadersForTransformedBody(response.headers, 'text/event-stream; charset=utf-8'),
    });
  }

  return new Response(createBufferedJsonResponseTransform(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersForTransformedBody(response.headers, 'application/json'),
  });
}
