import { describe, expect, test } from 'bun:test';
import { finalizeProxyResponse } from '../src/response-observer';

async function readAll(response: Response): Promise<string> {
  return response.body ? await new Response(response.body).text() : '';
}

function createResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

const baseOptions = {
  requestId: 'req-test',
  path: '/v1/chat/completions',
  shouldLog: false,
  createdAt: Date.now(),
  createdAtPerf: 0,
  upstreamType: 'openai' as const,
  truncatePayloadForLog: (rawPayload: string) => ({
    payload: rawPayload,
    originalBytes: rawPayload.length,
    loggedBytes: rawPayload.length,
    truncated: false,
  }),
};

describe('finalizeProxyResponse model rewrite', () => {
  test('rewrites JSON body model field from real model back to alias', async () => {
    const upstream = createResponse(
      JSON.stringify({ id: 'cmpl-1', model: 'gpt-4o-mini', choices: [{ message: { content: 'hi' } }] }),
      'application/json',
    );
    const response = finalizeProxyResponse({
      ...baseOptions,
      response: upstream,
      rewriteModel: { from: 'gpt-4o-mini', to: 'Auto' },
    });
    const body = await readAll(response);
    const parsed = JSON.parse(body) as { model: string };
    expect(parsed.model).toBe('Auto');
  });

  test('keeps body intact when no rewriteModel mapping is provided', async () => {
    const upstream = createResponse(
      JSON.stringify({ model: 'gpt-4o-mini' }),
      'application/json',
    );
    const response = finalizeProxyResponse({
      ...baseOptions,
      response: upstream,
    });
    const body = await readAll(response);
    const parsed = JSON.parse(body) as { model: string };
    expect(parsed.model).toBe('gpt-4o-mini');
  });

  test('does not rewrite model field when value does not match (e.g. different alias chain)', async () => {
    const upstream = createResponse(
      JSON.stringify({ model: 'gpt-4o' }),
      'application/json',
    );
    const response = finalizeProxyResponse({
      ...baseOptions,
      response: upstream,
      rewriteModel: { from: 'gpt-4o-mini', to: 'Auto' },
    });
    const body = await readAll(response);
    const parsed = JSON.parse(body) as { model: string };
    expect(parsed.model).toBe('gpt-4o');
  });

  test('rewrites model in SSE chunks across stream boundaries', async () => {
    const fullPayload = [
      'data: {"id":"1","model":"gpt-4o-mini","choices":[]}',
      '',
      'data: {"id":"2","model":"gpt-4o-mini","choices":[]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(fullPayload);
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        // 多段分块，故意把 model 字段切分到 chunk 边界附近
        const cut1 = fullPayload.indexOf('gpt-4o-mini') + 3;
        const cut2 = fullPayload.indexOf('gpt-4o-mini', cut1 + 5) + 2;
        controller.enqueue(bytes.slice(0, cut1));
        controller.enqueue(bytes.slice(cut1, cut2));
        controller.enqueue(bytes.slice(cut2));
        controller.close();
      },
    });
    const upstream = new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const response = finalizeProxyResponse({
      ...baseOptions,
      response: upstream,
      rewriteModel: { from: 'gpt-4o-mini', to: 'Auto' },
    });
    const body = await readAll(response);
    expect(body).not.toContain('gpt-4o-mini');
    expect(body.match(/"model":"Auto"/g)?.length).toBe(2);
  });

  test('skips rewrite when from equals to', async () => {
    const upstream = createResponse(JSON.stringify({ model: 'Auto' }), 'application/json');
    const response = finalizeProxyResponse({
      ...baseOptions,
      response: upstream,
      rewriteModel: { from: 'Auto', to: 'Auto' },
    });
    const body = await readAll(response);
    expect(JSON.parse(body).model).toBe('Auto');
  });
});
