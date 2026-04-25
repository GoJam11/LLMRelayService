import type { PayloadSummaryForConsole } from '../console-store';

function previewTextForLog(text: string, maxChars = 160): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function extractTextForLog(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextForLog(item))
      .filter(Boolean)
      .join('\n\n');
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (record.content != null) return extractTextForLog(record.content);
  }

  return '';
}

export function summarizeJsonPayload(rawPayload: string): PayloadSummaryForConsole | null {
  try {
    const json = JSON.parse(rawPayload) as Record<string, unknown> | null;
    if (!json || typeof json !== 'object') return null;

    const messages = Array.isArray(json.messages)
      ? json.messages as Array<Record<string, unknown>>
      : Array.isArray(json.input)
        ? json.input as Array<Record<string, unknown>>
      : [];
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const systemText = extractTextForLog(json.instructions ?? json.system);
    const firstUserText = extractTextForLog(firstUserMessage?.content);

    return {
      model: typeof json.model === 'string' ? json.model : '',
      stream: Boolean(json.stream),
      metadata_user_id: typeof (json.metadata as Record<string, unknown> | undefined)?.user_id === 'string'
        ? (json.metadata as Record<string, unknown>).user_id as string
        : '',
      system_len: systemText.length,
      system_head: previewTextForLog(systemText),
      first_user_len: firstUserText.length,
      first_user_head: previewTextForLog(firstUserText),
      messages_count: messages.length,
      message_roles: messages.map((message) => String(message.role ?? message.type ?? 'unknown')),
    };
  } catch {
    return null;
  }
}
