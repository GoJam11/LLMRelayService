import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { deleteProvider, resetProviderConfigCache } from '../src/config';
import { registerOpenApiRoutes } from '../src/openapi-routes';

const TOKEN = 'test-openapi-routes-key';
const CHANNEL = 'openapi-route-suite';

/**
 * index.ts 在管理路由之后挂了一个 app.all('*') 兜底（SPA + 网关代理）。
 * 这里照抄这个结构，才能验证写错的 /api/v1 路径不会掉进兜底。
 */
function buildApp(): Hono {
  const app = new Hono();
  registerOpenApiRoutes(app);
  app.all('*', (c) => c.html('<!doctype html><title>SPA</title>'));
  return app;
}

const app = buildApp();

function call(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) {
  const token = init.token === undefined ? TOKEN : init.token;
  return app.request(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

let previousGatewayKey: string | undefined;

beforeEach(() => {
  previousGatewayKey = process.env.GATEWAY_API_KEY;
  process.env.GATEWAY_API_KEY = TOKEN;
});

afterEach(async () => {
  try {
    await deleteProvider(CHANNEL);
  } catch {
    // 渠道不存在时忽略
  }
  resetProviderConfigCache();
  if (previousGatewayKey === undefined) {
    delete process.env.GATEWAY_API_KEY;
  } else {
    process.env.GATEWAY_API_KEY = previousGatewayKey;
  }
});

describe('openapi provider routes', () => {
  it('requires a bearer token', async () => {
    const res = await call('/providers', { token: null });
    expect(res.status).toBe(401);
  });

  it('returns 404 JSON for unknown paths instead of falling through to the SPA', async () => {
    const get = await call('/nonexistent');
    expect(get.status).toBe(404);
    expect(get.headers.get('content-type')).toContain('application/json');
    expect(await get.json()).toMatchObject({ error: expect.stringContaining('/api/v1/nonexistent') });

    const post = await call('/nonexistent', { method: 'POST', body: {} });
    expect(post.status).toBe(404);
  });

  it('keeps a disabled channel disabled when saved without enabled', async () => {
    const created = await call('/providers', {
      method: 'POST',
      body: {
        channelName: CHANNEL,
        type: 'openai',
        targetBaseUrl: 'https://example.com/v1',
        models: ['probe-model'],
      },
    });
    expect(created.status).toBe(201);
    expect((await created.json()).data.enabled).toBe(true);

    const disabled = await call(`/providers/${CHANNEL}/enabled`, { method: 'PATCH', body: { enabled: false } });
    expect((await disabled.json()).data.enabled).toBe(false);

    const updated = await call(`/providers/${CHANNEL}`, { method: 'PATCH', body: { priority: 7 } });
    const updatedBody = await updated.json();
    expect(updatedBody.data.enabled).toBe(false);
    expect(updatedBody.data.priority).toBe(7);
  });

  it('answers 404 for every mutation on a missing channel', async () => {
    expect((await call('/providers/ghost')).status).toBe(404);
    expect((await call('/providers/ghost', { method: 'PATCH', body: { priority: 1 } })).status).toBe(404);
    expect((await call('/providers/ghost/enabled', { method: 'PATCH', body: { enabled: false } })).status).toBe(404);
    expect((await call('/providers/ghost', { method: 'DELETE' })).status).toBe(404);
    expect((await call('/providers/ghost/test', { method: 'POST', body: {} })).status).toBe(404);
    expect((await call('/providers/ghost/upstream-models')).status).toBe(404);
  });

  it('exposes the channel-management endpoints the console has', async () => {
    await call('/providers', {
      method: 'POST',
      body: {
        channelName: CHANNEL,
        type: 'openai',
        targetBaseUrl: 'https://example.com/v1',
        models: ['probe-model'],
      },
    });

    const models = await call('/models');
    expect(models.status).toBe(200);
    const modelsBody = await models.json();
    expect(modelsBody.data.openai.some((m: { id: string }) => m.id === 'probe-model')).toBe(true);

    const metadata = await call(`/models/${CHANNEL}/probe-model/metadata`, {
      method: 'PATCH',
      body: { context: 123456 },
    });
    expect(metadata.status).toBe(200);
    expect((await metadata.json()).data.context).toBe(123456);

    // 没配认证时应是 400 而不是 500
    expect((await call(`/providers/${CHANNEL}/test`, { method: 'POST', body: {} })).status).toBe(400);
    expect((await call(`/providers/${CHANNEL}/upstream-models`)).status).toBe(400);
    expect((await call('/upstream-models-preview', { method: 'POST', body: {} })).status).toBe(400);

    expect((await call('/settings/timeouts')).status).toBe(200);
    expect((await call('/settings/failover')).status).toBe(200);
  });
});
