/**
 * Strips prompt/completion content from records right before they reach any
 * logger, cache, or persistence layer, whenever ZDR is active. Only
 * request/response *metadata* survives: request ID, timestamps, model,
 * provider, token counts, latency, status code, and the ZDR flag itself.
 *
 * This module is intentionally pure (no DB/network access) so it can sit at
 * the single choke point where console request/response snapshots are about
 * to be persisted (see console-store.ts) and be unit-tested in isolation.
 */

export interface RedactablePayloadFields {
  original_payload: string | null;
  original_payload_truncated?: boolean;
  original_summary: unknown | null;
  forwarded_payload: string | null;
  forwarded_payload_truncated?: boolean;
  forwarded_summary: unknown | null;
  original_headers: Record<string, string> | null;
  forward_headers: unknown | null;
}

export interface RedactableResponseFields {
  response_payload: string | null;
  response_payload_truncated?: boolean;
  response_payload_truncation_reason?: string | null;
  response_headers?: Record<string, string> | null;
}

const ZDR_REDACTION_MARKER = '[redacted:zdr]';

/**
 * Redacts payload/body/header fields from a console request snapshot. Never
 * hashes or truncates-with-preview the original content — the fields are
 * fully replaced with null / a fixed marker so no trace of the content can be
 * reconstructed from logs.
 */
export function redactRequestFieldsForZdr<T extends RedactablePayloadFields>(record: T): T {
  return {
    ...record,
    original_payload: null,
    original_payload_truncated: false,
    original_summary: null,
    forwarded_payload: null,
    forwarded_payload_truncated: false,
    forwarded_summary: null,
    original_headers: null,
    forward_headers: null,
  };
}

export function redactResponseFieldsForZdr<T extends RedactableResponseFields>(record: T): T {
  return {
    ...record,
    response_payload: null,
    response_payload_truncated: false,
    response_payload_truncation_reason: ZDR_REDACTION_MARKER,
    response_headers: null,
  };
}

/**
 * Redacts a free-form console.log(...) metadata object, dropping any key
 * that could carry payload content (body/payload/prompt/completion/message
 * fields) regardless of call site. Metadata keys (request id, model,
 * provider, tokens, latency, status) pass through untouched.
 */
const CONTENT_KEY_PATTERN = /payload|prompt|completion|message|content|body|text/i;

export function redactLogMetadataForZdr(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    result[key] = CONTENT_KEY_PATTERN.test(key) ? undefined : value;
  }
  return result;
}
