import { describe, expect, it } from "bun:test"
import { extractReadableSseText } from "../console/ai-proxy-dashboard/src/features/dashboard/utils"

describe("extractReadableSseText", () => {
  it("extracts readable text from anthropic SSE payloads", () => {
    const ssePayload = `event: message_start
data: {"message":{"content":[],"model":"claude-opus-4-6"},"type":"message_start"}

event: content_block_start
data: {"content_block":{"text":"","type":"text"},"index":0,"type":"content_block_start"}

event: content_block_delta
data: {"delta":{"text":"你好","type":"text_delta"},"index":0,"type":"content_block_delta"}

event: content_block_delta
data: {"delta":{"text":"，世界","type":"text_delta"},"index":0,"type":"content_block_delta"}

event: message_stop
data: {"type":"message_stop"}`

    expect(extractReadableSseText(ssePayload)).toBe("你好，世界")
  })

  it("extracts readable text from openai SSE payloads", () => {
    const ssePayload = `data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"index":0}]}

data: [DONE]`

    expect(extractReadableSseText(ssePayload)).toBe("Hello world")
  })

  it("ignores malformed SSE chunks", () => {
    const ssePayload = `event: message_start
data: {invalid-json}

data: [DONE]`

    expect(extractReadableSseText(ssePayload)).toBe("")
  })
})