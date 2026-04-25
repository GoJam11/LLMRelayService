import { describe, expect, it } from "bun:test";
import { parseResponseUsage } from "../src/index";

// 真实 SSE 响应数据 (来自 scripts/sse example.txt)
const REAL_SSE = `event: message_start
data: {"message":{"content":[],"id":"msg_01NdUkbVUDlRH9cFJI0jHF0b","model":"claude-opus-4-6","role":"assistant","stop_reason":null,"stop_sequence":null,"type":"message","usage":{"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":384},"cache_creation_input_tokens":384,"cache_read_input_tokens":0,"inference_geo":"not_available","input_tokens":65,"output_tokens":1,"service_tier":"standard"}},"type":"message_start"}

event: ping
data: {"type":"ping"}

event: content_block_start
data: {"content_block":{"signature":"","thinking":"","type":"thinking"},"index":0,"type":"content_block_start"}

event: content_block_delta
data: {"delta":{"thinking":"The user is saying hello","type":"thinking_delta"},"index":0,"type":"content_block_delta"}

event: content_block_stop
data: {"index":0,"type":"content_block_stop"}

event: content_block_start
data: {"content_block":{"text":"","type":"text"},"index":1,"type":"content_block_start"}

event: content_block_delta
data: {"delta":{"text":"你好！","type":"text_delta"},"index":1,"type":"content_block_delta"}

event: content_block_stop
data: {"index":1,"type":"content_block_stop"}

event: message_delta
data: {"delta":{"stop_reason":"end_turn","stop_sequence":null},"type":"message_delta","usage":{"cache_creation_input_tokens":384,"cache_read_input_tokens":0,"input_tokens":65,"output_tokens":76}}

event: message_stop
data: {"type":"message_stop"}`;

describe("parseResponseUsage", () => {
  it("should parse real SSE streaming response", () => {
    const usage = parseResponseUsage(REAL_SSE);
    expect(usage.model).toBe("claude-opus-4-6");
    expect(usage.stop_reason).toBe("end_turn");
    expect(usage.input_tokens).toBe(65);
    expect(usage.output_tokens).toBe(76);
    expect(usage.cache_creation_input_tokens).toBe(384);
    expect(usage.cache_read_input_tokens).toBe(0);
    expect(usage.ephemeral_5m_input_tokens).toBe(384);
    expect(usage.ephemeral_1h_input_tokens).toBe(0);
  });

  it("should parse non-streaming JSON response", () => {
    const json = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30,
        cache_creation: {
          ephemeral_5m_input_tokens: 50,
          ephemeral_1h_input_tokens: 0,
        },
      },
    });
    const usage = parseResponseUsage(json);
    expect(usage.model).toBe("claude-sonnet-4-5-20250929");
    expect(usage.stop_reason).toBe("max_tokens");
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(200);
    expect(usage.total_tokens).toBe(380);
    expect(usage.cache_creation_input_tokens).toBe(50);
    expect(usage.cache_read_input_tokens).toBe(30);
    expect(usage.ephemeral_5m_input_tokens).toBe(50);
    expect(usage.ephemeral_1h_input_tokens).toBe(0);
  });

  it("should parse openai non-streaming JSON response", () => {
    const json = JSON.stringify({
      model: "gpt-5-mini",
      choices: [{ finish_reason: "stop" }],
      usage: {
        completion_tokens: 170,
        total_tokens: 117195,
        prompt_tokens: 117025,
        prompt_tokens_details: {
          cached_tokens: 116224,
        },
        completion_tokens_details: {
          reasoning_tokens: 22,
        },
      },
    });

    const usage = parseResponseUsage(json, "openai");
    expect(usage.model).toBe("gpt-5-mini");
    expect(usage.stop_reason).toBe("stop");
    expect(usage.input_tokens).toBe(117025);
    expect(usage.output_tokens).toBe(170);
    expect(usage.total_tokens).toBe(117195);
    expect(usage.cached_input_tokens).toBe(116224);
    expect(usage.reasoning_output_tokens).toBe(22);
    expect(usage.cache_creation_input_tokens).toBe(0);
    expect(usage.cache_read_input_tokens).toBe(0);
  });

  it("should return zeros for empty body", () => {
    const usage = parseResponseUsage("");
    expect(usage.model).toBe("");
    expect(usage.input_tokens).toBe(0);
    expect(usage.output_tokens).toBe(0);
  });

  it("should handle error response body gracefully", () => {
    const errorBody = JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    const usage = parseResponseUsage(errorBody);
    expect(usage.model).toBe("");
    expect(usage.input_tokens).toBe(0);
    expect(usage.output_tokens).toBe(0);
  });

  it("should handle malformed SSE gracefully", () => {
    const malformed = `event: message_start
data: {invalid json}

event: message_delta
data: also not json`;
    const usage = parseResponseUsage(malformed);
    expect(usage.model).toBe("");
    expect(usage.input_tokens).toBe(0);
  });

  it("should handle SSE with cache_read (no creation)", () => {
    const sse = `event: message_start
data: {"message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":200,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":1500,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}},"type":"message_start"}

event: message_delta
data: {"delta":{"stop_reason":"end_turn"},"type":"message_delta","usage":{"output_tokens":42,"cache_creation_input_tokens":0,"cache_read_input_tokens":1500,"input_tokens":200}}

event: message_stop
data: {"type":"message_stop"}`;
    const usage = parseResponseUsage(sse);
    expect(usage.model).toBe("claude-haiku-4-5-20251001");
    expect(usage.stop_reason).toBe("end_turn");
    expect(usage.input_tokens).toBe(200);
    expect(usage.output_tokens).toBe(42);
    expect(usage.cache_creation_input_tokens).toBe(0);
    expect(usage.cache_read_input_tokens).toBe(1500);
  });
});
