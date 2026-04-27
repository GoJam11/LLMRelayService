import { describe, expect, it } from "bun:test";
import {
  convertChatCompletionToResponsePayload,
  convertResponsesRequestToChatCompletions,
  rewriteResponsesTargetUrlToChatCompletions,
  transformChatCompletionsResponseToResponses,
} from "../src/openai-responses-chat-compat";

function parseSseEvent(text: string, eventName: string): any {
  const blocks = text.split(/\n\n/);
  for (const block of blocks) {
    if (!block.includes(`event: ${eventName}`)) continue;
    const data = block
      .split(/\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    return JSON.parse(data);
  }
  throw new Error(`Missing SSE event ${eventName}`);
}

describe("openai responses chat compatibility", () => {
  it("rewrites response targets to chat completions targets", () => {
    expect(rewriteResponsesTargetUrlToChatCompletions("https://api.example.com/v1/responses?foo=1"))
      .toBe("https://api.example.com/v1/chat/completions?foo=1");
  });

  it("converts Responses requests to Chat Completions payloads", () => {
    const converted = convertResponsesRequestToChatCompletions(JSON.stringify({
      model: "gpt-test",
      instructions: "Be concise.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Return JSON." }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: "{\"query\":\"status\"}",
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "ok",
        },
      ],
      max_output_tokens: 42,
      text: {
        format: {
          type: "json_schema",
          name: "Answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
        },
      },
      tools: [{
        type: "function",
        name: "lookup",
        parameters: { type: "object" },
      }],
      tool_choice: { type: "function", name: "lookup" },
      stream: true,
    }));

    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.error.message);

    const body = JSON.parse(converted.body);
    expect(body.model).toBe("gpt-test");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(42);
    expect(body.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Return JSON." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: "{\"query\":\"status\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "Answer",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
    });
    expect(body.tools).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        parameters: { type: "object" },
      },
    }]);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "lookup" },
    });
  });

  it("drops Responses-only built-in tools during Chat compatibility conversion", () => {
    const converted = convertResponsesRequestToChatCompletions(JSON.stringify({
      model: "gpt-test",
      input: "hello",
      tools: [
        { type: "web_search_preview" },
        { type: "function", name: "lookup", parameters: { type: "object" } },
      ],
      tool_choice: { type: "web_search_preview" },
    }));

    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.error.message);

    const body = JSON.parse(converted.body);
    expect(body.tools).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        parameters: { type: "object" },
      },
    }]);
    expect(body.tool_choice).toBeUndefined();
  });

  it("omits tool fields when all Responses tools are built-in only", () => {
    const converted = convertResponsesRequestToChatCompletions(JSON.stringify({
      model: "gpt-test",
      input: "hello",
      tools: [{ type: "web_search" }],
      tool_choice: "required",
    }));

    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.error.message);

    const body = JSON.parse(converted.body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("sanitizes converted Chat payloads for MiniMax compatibility", () => {
    const converted = convertResponsesRequestToChatCompletions(JSON.stringify({
      model: "MiniMax-M2.7",
      instructions: "Follow the system rules.",
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Use the workspace tools carefully." }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "exec_command",
          strict: false,
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"],
            additionalProperties: false,
          },
        },
        { type: "web_search" },
      ],
      tool_choice: "auto",
      store: false,
      metadata: { user_id: "debug" },
      service_tier: "auto",
      parallel_tool_calls: false,
      logprobs: true,
      stream: true,
      max_output_tokens: 128,
      temperature: 0,
      top_p: 0.9,
    }), {
      targetUrl: "https://api.minimaxi.com/v1/chat/completions",
    });

    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.error.message);

    const body = JSON.parse(converted.body);
    expect(body).toEqual({
      model: "MiniMax-M2.7",
      messages: [
        {
          role: "system",
          content: "Follow the system rules.\n\nUse the workspace tools carefully.",
        },
        { role: "user", content: "hello" },
      ],
      stream: true,
      max_completion_tokens: 128,
      top_p: 0.9,
      tools: [{
        type: "function",
        function: {
          name: "exec_command",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"],
            additionalProperties: false,
          },
        },
      }],
    });
  });

  it("converts Chat Completions payloads to Responses payloads", () => {
    const response = convertChatCompletionToResponsePayload({
      id: "chatcmpl_123",
      object: "chat.completion",
      created: 123,
      model: "gpt-test",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "Hello",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{\"q\":\"x\"}" },
          }],
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        prompt_tokens_details: { cached_tokens: 6 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    });

    expect(response.id).toBe("resp_chatcmpl_123");
    expect(response.object).toBe("response");
    expect(response.status).toBe("completed");
    expect(response.output_text).toBe("Hello");
    expect((response.output as any[])[0].content[0].text).toBe("Hello");
    expect((response.output as any[])[1]).toMatchObject({
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: "{\"q\":\"x\"}",
    });
    expect(response.usage).toEqual({
      input_tokens: 10,
      output_tokens: 4,
      total_tokens: 14,
      input_tokens_details: { cached_tokens: 6 },
      output_tokens_details: { reasoning_tokens: 2 },
    });
  });

  it("converts think-tagged Chat Completions content into Responses reasoning items", () => {
    const response = convertChatCompletionToResponsePayload({
      id: "chatcmpl_think",
      object: "chat.completion",
      created: 321,
      model: "gpt-test",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "<think>Plan the answer first.</think>Hello",
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
    });

    expect(response.output_text).toBe("Hello");
    expect((response.output as any[])[0]).toEqual({
      id: "rs_chatcmpl_think_0",
      type: "reasoning",
      content: [{ type: "reasoning_text", text: "Plan the answer first." }],
      summary: [],
    });
    expect((response.output as any[])[1]).toMatchObject({
      id: "msg_chatcmpl_think_1",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello", annotations: [] }],
    });
  });

  it("transforms non-streaming Chat responses into Responses JSON", async () => {
    const transformed = transformChatCompletionsResponseToResponses(new Response(JSON.stringify({
      id: "chatcmpl_456",
      created: 456,
      model: "gpt-test",
      choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }), {
      headers: { "content-type": "application/json", "content-length": "999" },
    }));

    expect(transformed.headers.get("content-type")).toBe("application/json");
    expect(transformed.headers.has("content-length")).toBe(false);
    const json = await transformed.json();
    expect(json.object).toBe("response");
    expect(json.output[0].content[0].text).toBe("Done");
  });

  it("transforms streaming Chat SSE into Responses SSE", async () => {
    const chatSse = [
      'data: {"id":"chatcmpl_789","object":"chat.completion.chunk","created":789,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_789","object":"chat.completion.chunk","created":789,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_789","object":"chat.completion.chunk","created":789,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_789","object":"chat.completion.chunk","created":789,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const transformed = transformChatCompletionsResponseToResponses(new Response(chatSse, {
      headers: { "content-type": "text/event-stream" },
    }));

    const text = await transformed.text();
    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain('"delta":"Hel"');
    expect(text).toContain('"delta":"lo"');

    const completed = parseSseEvent(text, "response.completed");
    expect(completed.response.object).toBe("response");
    expect(completed.response.output_text).toBe("Hello");
    expect(completed.response.usage).toEqual({
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });

  it("transforms think-tagged streaming Chat SSE into Responses reasoning events", async () => {
    const chatSse = [
      'data: {"id":"chatcmpl_think_stream","object":"chat.completion.chunk","created":790,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_think_stream","object":"chat.completion.chunk","created":790,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"<think>pla"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_think_stream","object":"chat.completion.chunk","created":790,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"n</think>Hel"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_think_stream","object":"chat.completion.chunk","created":790,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_think_stream","object":"chat.completion.chunk","created":790,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":6,"total_tokens":11}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const transformed = transformChatCompletionsResponseToResponses(new Response(chatSse, {
      headers: { "content-type": "text/event-stream" },
    }));

    const text = await transformed.text();
    expect(text).toContain("event: response.reasoning_text.delta");
    expect(text).toContain("event: response.output_text.delta");
    expect(text).not.toContain("<think>");
    expect(text).not.toContain("</think>");

    const completed = parseSseEvent(text, "response.completed");
    expect(completed.response.output_text).toBe("Hello");
    expect(completed.response.output[0]).toEqual({
      id: "rs_chatcmpl_think_stream_0",
      type: "reasoning",
      content: [{ type: "reasoning_text", text: "plan" }],
      summary: [],
    });
    expect(completed.response.output[1]).toMatchObject({
      id: "msg_chatcmpl_think_stream_1",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello", annotations: [] }],
    });
  });
});
