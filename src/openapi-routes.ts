import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import {
  createProvider,
  deleteProvider,
  ensureProviderConfigsLoaded,
  getProviderInfo,
  getProviders,
  toggleProvider,
  updateProvider,
} from './config';
import {
  getConsoleRequest,
  getConsoleUsageStats,
  listConsoleRequests,
  type RequestSortKey,
  type SortDirection,
} from './console-store';
import {
  createManagedApiKey,
  deleteManagedApiKey,
  getManagedApiKey,
  listManagedApiKeys,
  renameManagedApiKey,
  setApiKeyAllowedModels,
} from './api-keys';
import {
  createModelAlias,
  deleteModelAlias,
  listModelAliases,
  toggleModelAlias,
  updateModelAlias,
} from './console-model-alias-store';

function getGatewayKey(): string {
  return process.env.GATEWAY_API_KEY ?? '';
}

function isGatewayKeyConfigured(): boolean {
  return getGatewayKey().length > 0;
}

function extractBearerToken(c: Context): string | null {
  const auth = c.req.header('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function isBearerAuthenticated(c: Context): boolean {
  if (!isGatewayKeyConfigured()) return false;
  const token = extractBearerToken(c);
  return token === getGatewayKey();
}

function bearerAuthMiddleware() {
  return async (c: Context, next: Next) => {
    if (!isGatewayKeyConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY not configured' }, 503);
    }
    if (!isBearerAuthenticated(c)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}

function resolveMutationStatus(error: unknown): 400 | 403 | 404 {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('禁止在线修改') || message.includes('read-only')) {
    return 403;
  }
  if (message.includes('不存在')) {
    return 404;
  }
  return 400;
}

function parseFilters(c: Context) {
  const route = c.req.query('route') || undefined;
  const model = c.req.query('model') || undefined;
  const client = c.req.query('client') || undefined;
  const apiKeyName = c.req.query('api_key_name') || undefined;
  const search = c.req.query('search') || undefined;
  const status = c.req.query('status') as 'success' | 'error' | undefined;
  const cacheState = c.req.query('cache_state') as
    | 'hit'
    | 'create'
    | 'miss'
    | 'bypass'
    | 'error'
    | undefined;
  const sortBy = c.req.query('sort_by') as RequestSortKey | undefined;
  const sortOrder = c.req.query('sort_order') as SortDirection | undefined;

  let created_after: number | undefined;
  const range = c.req.query('range') || undefined;
  if (range) {
    const now = Date.now();
    switch (range) {
      case '1h':
        created_after = now - 60 * 60 * 1000;
        break;
      case '24h':
        created_after = now - 24 * 60 * 60 * 1000;
        break;
      case '72h':
        created_after = now - 72 * 60 * 60 * 1000;
        break;
      case '7d':
        created_after = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        created_after = now - 30 * 24 * 60 * 60 * 1000;
        break;
    }
  }

  return {
    route,
    model,
    client,
    api_key_name: apiKeyName,
    created_after,
    search,
    status,
    cache_state: cacheState,
    sort_by: sortBy,
    sort_order: sortOrder,
  };
}

export function registerOpenApiRoutes(app: Hono<any>): void {
  const v1 = new Hono();

  // ── Health ───────────────────────────────────────────────────────────────
  v1.get('/health', (c) => c.json({ status: 'ok' }));

  // All other routes require Bearer auth
  v1.use('*', bearerAuthMiddleware());

  // ── Providers ────────────────────────────────────────────────────────────
  v1.get('/providers', async (c) => {
    await ensureProviderConfigsLoaded();
    const providers = getProviders();
    return c.json({ data: providers });
  });

  v1.get('/providers/:channelName', async (c) => {
    await ensureProviderConfigsLoaded();
    const provider = getProviderInfo(c.req.param('channelName'), {
      includeAuthValue: true,
    });
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json({ data: provider });
  });

  v1.post('/providers', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    try {
      const provider = await createProvider(payload as any);
      return c.json({ data: provider }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        resolveMutationStatus(error),
      );
    }
  });

  v1.patch('/providers/:channelName', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    try {
      const provider = await updateProvider(c.req.param('channelName'), payload as any);
      return c.json({ data: provider });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        resolveMutationStatus(error),
      );
    }
  });

  v1.delete('/providers/:channelName', async (c) => {
    try {
      await deleteProvider(c.req.param('channelName'));
      return c.json({ data: { ok: true } });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        resolveMutationStatus(error),
      );
    }
  });

  v1.patch('/providers/:channelName/enabled', async (c) => {
    const { enabled } = await c.req.json().catch(() => ({}));
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400);
    }
    try {
      const provider = await toggleProvider(c.req.param('channelName'), enabled);
      return c.json({ data: provider });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        resolveMutationStatus(error),
      );
    }
  });

  // ── Requests ─────────────────────────────────────────────────────────────
  v1.get('/requests', async (c) => {
    const limit = Number.parseInt(c.req.query('limit') || '50', 10) || 50;
    const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0;
    const filters = parseFilters(c);

    const result = await listConsoleRequests(
      limit,
      offset,
      filters,
      filters.sort_by,
      filters.sort_order,
    );
    return c.json({ data: result.requests, total: result.total, limit, offset });
  });

  v1.get('/requests/:requestId', async (c) => {
    const detail = await getConsoleRequest(c.req.param('requestId'));
    if (!detail) {
      return c.json({ error: 'Request not found' }, 404);
    }
    return c.json({ data: detail });
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  v1.get('/stats', async (c) => {
    const filters = parseFilters(c);
    const usage = await getConsoleUsageStats(filters);
    return c.json({ data: usage });
  });

  // ── API Keys ─────────────────────────────────────────────────────────────
  v1.get('/keys', async (c) => {
    const keys = await listManagedApiKeys();
    return c.json({ data: keys });
  });

  v1.get('/keys/:id', async (c) => {
    const key = await getManagedApiKey(c.req.param('id'));
    if (!key) {
      return c.json({ error: 'API key not found' }, 404);
    }
    return c.json({ data: key });
  });

  v1.post('/keys', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    const name = String((payload as { name?: unknown }).name ?? '').trim();
    if (!name) {
      return c.json({ error: 'Key name is required' }, 400);
    }
    try {
      const created = await createManagedApiKey(name);
      return c.json({ data: created }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  v1.patch('/keys/:id', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    const name = String((payload as { name?: unknown }).name ?? '').trim();
    if (!name) {
      return c.json({ error: 'Key name is required' }, 400);
    }
    const updated = await renameManagedApiKey(c.req.param('id'), name);
    if (!updated) {
      return c.json({ error: 'API key not found' }, 404);
    }
    return c.json({ data: updated });
  });

  v1.delete('/keys/:id', async (c) => {
    const deleted = await deleteManagedApiKey(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'API key not found' }, 404);
    }
    return c.json({ data: { ok: true } });
  });

  v1.patch('/keys/:id/allowed-models', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    const models = (payload as { models?: unknown }).models;
    if (!Array.isArray(models) || models.some((m) => typeof m !== 'string')) {
      return c.json({ error: 'models must be an array of strings' }, 400);
    }
    const updated = await setApiKeyAllowedModels(c.req.param('id'), models as string[]);
    if (!updated) {
      return c.json({ error: 'API key not found' }, 404);
    }
    return c.json({ data: updated });
  });

  // ── Model Aliases ────────────────────────────────────────────────────────
  v1.get('/aliases', async (c) => {
    const aliases = await listModelAliases();
    return c.json({ data: aliases });
  });

  v1.post('/aliases', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await createModelAlias(payload as any);
      return c.json({ data: alias }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  v1.patch('/aliases/:id', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await updateModelAlias(id, payload as any);
      return c.json({ data: alias });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  v1.patch('/aliases/:id/enabled', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    const { enabled } = await c.req.json().catch(() => ({}));
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400);
    }
    try {
      const alias = await toggleModelAlias(id, enabled);
      return c.json({ data: alias });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  v1.delete('/aliases/:id', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    try {
      await deleteModelAlias(id);
      return c.json({ data: { ok: true } });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.route('/api/v1', v1);
}
