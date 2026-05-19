import { describe, expect, it } from "bun:test";
import { finalizeProxyResponse } from "../src/response-observer";

const encoder = new TextEncoder();

function finalizeForTest(response: Response, bodyIdleTimeoutMs: number): Response {
  return finalizeProxyResponse({
    response,
    requestId: "timeout-test",
    path: "/v1/chat/completions",
    shouldLog: false,
    createdAt: Date.now(),
    createdAtPerf: performance.now(),
    upstreamType: "openai",
    truncatePayloadForLog: (rawPayload) => ({
      payload: rawPayload,
      originalBytes: encoder.encode(rawPayload).byteLength,
      loggedBytes: encoder.encode(rawPayload).byteLength,
      truncated: false,
    }),
    bodyIdleTimeoutMs,
  });
}

async function expectReadTimeout(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Expected response body");

  try {
    await reader.read();
  } catch (error) {
    return error;
  }

  throw new Error("Expected body read to time out");
}

describe("response body idle timeout", () => {
  it("errors a stalled upstream response body", async () => {
    let cancelReason: unknown = null;
    const upstreamBody = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason;
      },
    });

    const response = finalizeForTest(new Response(upstreamBody, {
      headers: { "content-type": "application/json" },
    }), 10);

    const error = await expectReadTimeout(response);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect((error as DOMException).message).toContain("Upstream response body idle timeout");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((cancelReason as DOMException | null)?.name).toBe("TimeoutError");
  });

  it("allows slow bodies when the idle timeout is disabled", async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode("ok"));
          controller.close();
        }, 20);
      },
    });

    const response = finalizeForTest(new Response(upstreamBody, {
      headers: { "content-type": "application/json" },
    }), 0);

    await expect(response.text()).resolves.toBe("ok");
  });
});
