import { describe, expect, it } from 'bun:test';
import {
  redactLogMetadataForZdr,
  redactRequestFieldsForZdr,
  redactResponseFieldsForZdr,
} from '../src/zdr-log-redaction';

describe('redactRequestFieldsForZdr', () => {
  it('strips all payload/summary/header content, keeping other fields intact', () => {
    const record = {
      request_id: 'req-1',
      original_payload: '{"prompt":"secret user prompt"}',
      original_payload_truncated: true,
      original_summary: { messages: 1 },
      forwarded_payload: '{"prompt":"secret forwarded"}',
      forwarded_payload_truncated: true,
      forwarded_summary: { messages: 1 },
      original_headers: { authorization: 'Bearer secret' },
      forward_headers: { authorization: 'Bearer secret' },
    };

    const redacted = redactRequestFieldsForZdr(record);

    expect(redacted.request_id).toBe('req-1');
    expect(redacted.original_payload).toBeNull();
    expect(redacted.original_payload_truncated).toBe(false);
    expect(redacted.original_summary).toBeNull();
    expect(redacted.forwarded_payload).toBeNull();
    expect(redacted.forwarded_payload_truncated).toBe(false);
    expect(redacted.forwarded_summary).toBeNull();
    expect(redacted.original_headers).toBeNull();
    expect(redacted.forward_headers).toBeNull();

    expect(JSON.stringify(redacted)).not.toContain('secret');
  });
});

describe('redactResponseFieldsForZdr', () => {
  it('strips response payload/headers content, keeping other fields intact', () => {
    const record = {
      request_id: 'req-1',
      status_code: 200,
      response_payload: '{"completion":"secret model output"}',
      response_payload_truncated: true,
      response_payload_truncation_reason: 'too large',
      response_headers: { 'set-cookie': 'session=secret' },
    };

    const redacted = redactResponseFieldsForZdr(record);

    expect(redacted.request_id).toBe('req-1');
    expect(redacted.status_code).toBe(200);
    expect(redacted.response_payload).toBeNull();
    expect(redacted.response_payload_truncated).toBe(false);
    expect(redacted.response_payload_truncation_reason).toBe('[redacted:zdr]');
    expect(redacted.response_headers).toBeNull();

    expect(JSON.stringify(redacted)).not.toContain('secret');
  });
});

describe('redactLogMetadataForZdr', () => {
  it('drops any key that could carry payload/prompt/completion content', () => {
    const metadata = {
      request_id: 'req-1',
      model: 'gpt-4',
      provider: 'openai',
      token_count: 42,
      latency_ms: 120,
      status_code: 200,
      payload: 'raw body',
      original_payload: 'raw body',
      prompt: 'user prompt text',
      completion: 'model output text',
      message: 'chat message text',
      content: 'some content',
      body: 'raw body',
      text: 'plain text',
    };

    const redacted = redactLogMetadataForZdr(metadata);

    expect(redacted.request_id).toBe('req-1');
    expect(redacted.model).toBe('gpt-4');
    expect(redacted.provider).toBe('openai');
    expect(redacted.token_count).toBe(42);
    expect(redacted.latency_ms).toBe(120);
    expect(redacted.status_code).toBe(200);

    expect(redacted.payload).toBeUndefined();
    expect(redacted.original_payload).toBeUndefined();
    expect(redacted.prompt).toBeUndefined();
    expect(redacted.completion).toBeUndefined();
    expect(redacted.message).toBeUndefined();
    expect(redacted.content).toBeUndefined();
    expect(redacted.body).toBeUndefined();
    expect(redacted.text).toBeUndefined();
  });
});
