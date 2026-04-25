import { describe, expect, it } from "bun:test";
import { detectOpenAiRequestKind } from "../src/providers/openai";

describe("detectOpenAiRequestKind", () => {
  it("should detect generic OpenAI payloads", () => {
    const payload = JSON.stringify({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: "hello",
        },
      ],
    });

    expect(detectOpenAiRequestKind(payload)).toBe("generic");
  });

  it("should return unknown for invalid JSON", () => {
    expect(detectOpenAiRequestKind("not-json")).toBe("unknown");
  });

  it("should return unknown for null payload", () => {
    expect(detectOpenAiRequestKind(null)).toBe("unknown");
  });
});
