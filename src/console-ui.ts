import type { Context } from 'hono';
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createProvider, deleteProvider, ensureProviderConfigsLoaded, getProviderInfo, getProviders, refreshRoutingConfigCache, resolveRoute, toggleProvider, updateProvider } from './config';
import { getConsoleRequest, listConsoleRequests, getProviderHealthStatuses, getConsoleUsageStats, getConsoleFilterOptions, getMaxDebugRecords, type RequestSortKey, type SortDirection } from './console-store';
import { createManagedApiKey, deleteManagedApiKey, getManagedApiKey, listManagedApiKeys, renameManagedApiKey, setApiKeyAllowedModels, setApiKeyCostQuota } from './api-keys';
import { parseApiKeyCostQuotaLimit } from './api-key-quota';
import { createModelAlias, deleteModelAlias, listModelAliases, toggleModelAlias, updateModelAlias } from './console-model-alias-store';
import {
  listChannelModelsWithMetadata,
  listUpstreamModelsForChannel,
  previewUpstreamModels,
  setChannelModelMetadata,
  testProviderConnectivity,
  type UpstreamModelsPreviewInput,
} from './provider-admin';
import { getGatewayTimeoutSettings, updateGatewayTimeoutSettings } from './gateway-timeouts';
import { getGatewayFailoverPolicy, updateGatewayFailoverPolicy } from './gateway-failover';

const CONSOLE_COOKIE_NAME = 'CONSOLE_COOKIE_NAME';
const CONSOLE_UI_DIST_DIR = resolve(import.meta.dir, '..', 'dist', 'frontend');

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolveProviderMutationStatus(error: unknown): 400 | 403 | 404 {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('禁止在线修改') || message.includes('read-only')) {
    return 403;
  }
  // 「不存在」来自 config 层，「does not exist」来自 store 层，两种都得认，
  // 否则删除/禁用一个不存在的渠道会返回 400。
  if (message.includes('不存在') || /does not exist/i.test(message)) {
    return 404;
  }
  return 400;
}

function hashSecret(secret: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < secret.length; index += 1) {
    hash ^= secret.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function getConsolePassword(): string {
  return process.env.GATEWAY_API_KEY ?? '';
}

function isPasswordConfigured(): boolean {
  return getConsolePassword().length > 0;
}

function getAuthToken(): string {
  return `v1:${hashSecret(getConsolePassword())}`;
}

function isAuthenticated(c: Context): boolean {
  if (!isPasswordConfigured()) return false;
  return getCookie(c, CONSOLE_COOKIE_NAME) === getAuthToken();
}

function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept') ?? '';
  const contentType = c.req.header('content-type') ?? '';
  return accept.includes('application/json') || contentType.includes('application/json');
}

async function readPassword(c: Context): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = await c.req.json().catch(() => ({}));
    return String((payload as { password?: unknown }).password ?? '');
  }

  const form = await c.req.formData().catch(() => null);
  return String(form?.get('password') ?? '');
}

async function readGatewayKey(c: Context): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = await c.req.json().catch(() => ({}));
    return String((payload as { gatewayKey?: unknown }).gatewayKey ?? '');
  }

  const form = await c.req.formData().catch(() => null);
  return String(form?.get('gatewayKey') ?? '');
}

function resolveStaticFilePath(requestPath: string): string | null {
  const candidatePath = requestPath === '/' ? '/index.html' : requestPath;
  const decodedPath = decodeURIComponent(candidatePath);
  const relativePath = decodedPath.replace(/^\/+/, '');
  const resolvedPath = resolve(CONSOLE_UI_DIST_DIR, relativePath);
  const staticRootPrefix = `${CONSOLE_UI_DIST_DIR}/`;

  if (resolvedPath !== CONSOLE_UI_DIST_DIR && !resolvedPath.startsWith(staticRootPrefix)) {
    return null;
  }

  if (!existsSync(resolvedPath)) {
    return null;
  }

  if (!statSync(resolvedPath).isFile()) {
    return null;
  }

  return resolvedPath;
}

function createStaticFileResponse(filePath: string): Response {
  const extension = extname(filePath).toLowerCase();
  const headers = new Headers();
  headers.set('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream');
  headers.set('Cache-Control', extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
  return new Response(Bun.file(filePath), { status: 200, headers });
}

function renderMissingFrontendBuildPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 网关观测台未构建</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #04111f;
      --line: rgba(148, 163, 184, 0.18);
      --text: #e5eefb;
      --muted: #94a3b8;
      --shadow: 0 36px 90px rgba(2, 6, 23, 0.42);
      --sans: 'Inter Variable', 'SF Pro Display', system-ui, sans-serif;
      --mono: ui-monospace, 'SFMono-Regular', monospace;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 0% 0%, rgba(56, 189, 248, 0.14), transparent 30%),
        radial-gradient(circle at 100% 100%, rgba(14, 165, 233, 0.12), transparent 28%),
        linear-gradient(180deg, #020617, #0b1120 48%, #020617);
      color: var(--text);
      font-family: var(--sans);
    }

    article {
      width: min(680px, 100%);
      padding: 28px;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(15, 23, 42, 0.94));
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(30px, 5vw, 42px);
      line-height: 1.04;
      letter-spacing: -0.035em;
    }

    p {
      margin: 0 0 12px;
      color: var(--muted);
      line-height: 1.76;
    }

    code {
      font-family: var(--mono);
      color: #dbeafe;
      background: rgba(148, 163, 184, 0.08);
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 999px;
      padding: 2px 10px;
    }
  </style>
</head>
<body>
  <article>
    <h1>前端静态资源还没有生成</h1>
    <p>当前服务已经切成前后端分离模式，根路径会优先读取构建后的前端产物。</p>
    <p>本地开发请运行 <code>bun run dev</code>，会同时启动 Bun 后端和 Vite 前端。</p>
    <p>生产构建或镜像构建前请先运行 <code>bun run build</code>，产物会输出到 <code>dist/frontend</code>。</p>
  </article>
</body>
</html>`;
}

async function maybeServeFrontend(c: Context, next: () => Promise<void>): Promise<Response | void> {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    await next();
    return;
  }

  const url = new URL(c.req.url);
  const path = url.pathname;

  if (path.startsWith('/__console')) {
    await next();
    return;
  }

  await ensureProviderConfigsLoaded();

  if (resolveRoute(path, url.search)) {
    await next();
    return;
  }

  // SPA: 对于根路径和前端路由（无扩展名），统一回退到 index.html
  if (extname(path) === '') {
    if (!existsSync(CONSOLE_UI_DIST_DIR)) {
      return c.html(renderMissingFrontendBuildPage());
    }

    const indexFile = resolveStaticFilePath('/index.html');
    if (indexFile) {
      return createStaticFileResponse(indexFile);
    }
  }

  // 静态资源文件（CSS, JS, 字体等）
  const directFile = resolveStaticFilePath(path);
  if (directFile) {
    return createStaticFileResponse(directFile);
  }

  await next();
}

async function handleLogin(c: Context): Promise<Response> {
  if (!isPasswordConfigured()) {
    if (wantsJson(c)) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    return c.redirect('/');
  }

  const password = await readPassword(c);
  const gatewayKey = await readGatewayKey(c);
  const credential = password || gatewayKey;
  if (credential !== getConsolePassword()) {
    if (wantsJson(c)) {
      return c.json({ error: '密码不正确。' }, 401);
    }
    return c.redirect('/');
  }

  setCookie(c, CONSOLE_COOKIE_NAME, getAuthToken(), {
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
    sameSite: 'Lax',
  });

  if (wantsJson(c)) {
    return c.json({ authenticated: true, ok: true });
  }

  return c.redirect('/');
}

function handleLogout(c: Context): Response {
  deleteCookie(c, CONSOLE_COOKIE_NAME, { path: '/' });

  if (wantsJson(c)) {
    return c.json({ authenticated: false, ok: true });
  }

  return c.redirect('/');
}

type ParsedFilters = {
  route?: string;
  model?: string;
  client?: string;
  api_key_name?: string;
  created_after?: number;
  search?: string;
  status?: "success" | "error";
  cache_state?: "hit" | "create" | "miss" | "bypass" | "error";
  sort_by?: RequestSortKey;
  sort_order?: SortDirection;
};

function parseConsoleFilters(c: Context): ParsedFilters {
  const route = c.req.query('route') || undefined;
  const model = c.req.query('model') || undefined;
  const rawClient = c.req.query('client') || undefined;
  const apiKeyName = c.req.query('api_key_name') || undefined;
  const range = c.req.query('range') || undefined;
  const search = c.req.query('search') || undefined;
  const rawStatus = c.req.query('status') || undefined;
  const rawCache = c.req.query('cache') || undefined;
  const rawSortBy = c.req.query('sort_by') || undefined;
  const rawSortOrder = c.req.query('sort_order') || undefined;
  let created_after: number | undefined;

  const client = rawClient?.trim() || undefined;

  const status = rawStatus && ['success', 'error'].includes(rawStatus)
    ? rawStatus as "success" | "error"
    : undefined;

  const cache_state = rawCache && ['hit', 'create', 'miss', 'bypass', 'error'].includes(rawCache)
    ? rawCache as "hit" | "create" | "miss" | "bypass" | "error"
    : undefined;

  const sort_by = rawSortBy && ['created_at', 'response_status', 'tokens'].includes(rawSortBy)
    ? rawSortBy as RequestSortKey
    : undefined;

  const sort_order = rawSortOrder && ['asc', 'desc'].includes(rawSortOrder)
    ? rawSortOrder as SortDirection
    : undefined;

  if (range) {
    const now = Date.now();
    switch (range) {
      case '1h': created_after = now - 60 * 60 * 1000; break;
      case '24h': created_after = now - 24 * 60 * 60 * 1000; break;
      case '72h': created_after = now - 72 * 60 * 60 * 1000; break;
      case '7d': created_after = now - 7 * 24 * 60 * 60 * 1000; break;
      case '30d': created_after = now - 30 * 24 * 60 * 60 * 1000; break;
    }
  }

  return { route, model, client, api_key_name: apiKeyName, created_after, search, status, cache_state, sort_by, sort_order };
}

export function registerConsoleRoutes(app: Hono<any>): void {
  app.get('/__console', (c) => c.redirect('/'));
  app.get('/__debug', (c) => c.redirect('/'));  // legacy redirect

  app.post('/__console/login', (c) => handleLogin(c));
  app.post('/__console/logout', (c) => handleLogout(c));

  app.get('/__console/api/session', (c) => c.json({
    authenticated: isAuthenticated(c),
    enabled: isPasswordConfigured(),
  }));

  app.get('/__console/api/requests', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const limit = Number.parseInt(c.req.query('limit') || '50', 10) || 50;
    const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0;
    const filters = parseConsoleFilters(c);

    const result = await listConsoleRequests(
      limit,
      offset,
      filters,
      filters.sort_by,
      filters.sort_order,
    );
    return c.json({ ok: true, ...result });
  });

  app.get('/__console/api/stats', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const filters = parseConsoleFilters(c);
    const usage = await getConsoleUsageStats(filters);
    return c.json(usage);
  });

  app.get('/__console/api/filters', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const options = await getConsoleFilterOptions();
    return c.json({ ok: true, ...options });
  });

  // Read-only runtime info shown on the 配置 page alongside editable timeouts.
  // Record retention is env-configured (DEBUG_DB_MAX_RECORDS); CORS is built-in (origin '*', always on).
  const buildSettingsRuntimeInfo = () => ({
    retentionMaxRecords: getMaxDebugRecords(),
    corsAllowOrigin: '*',
    corsEnabled: true,
  });

  app.get('/__console/api/settings/timeouts', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const settings = await getGatewayTimeoutSettings();
    return c.json({ ok: true, ...settings, runtime: buildSettingsRuntimeInfo() });
  });

  app.patch('/__console/api/settings/timeouts', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    try {
      const settings = await updateGatewayTimeoutSettings(payload as any);
      return c.json({ ok: true, ...settings, runtime: buildSettingsRuntimeInfo() });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/__console/api/settings/failover', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const policy = await getGatewayFailoverPolicy();
    return c.json({ ok: true, ...policy });
  });

  app.patch('/__console/api/settings/failover', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    try {
      const policy = await updateGatewayFailoverPolicy(payload as any);
      return c.json({ ok: true, ...policy });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/__console/api/requests/:requestId', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const requestId = c.req.param('requestId');
    const detail = await getConsoleRequest(requestId);
    if (!detail) {
      return c.json({ error: '未找到请求记录' }, 404);
    }

    return c.json(detail);
  });

  app.get('/__console/api/providers', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    await ensureProviderConfigsLoaded();
    const providers = getProviders();
    const healthStatuses = await getProviderHealthStatuses();

    const providersWithHealth = providers.map((provider) => ({
      ...provider,
      healthStatus: healthStatuses[provider.channelName] ?? 'no-data',
    }));

    return c.json({ providers: providersWithHealth });
  });

  app.get('/__console/api/providers/:channelName', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    await ensureProviderConfigsLoaded();
    const provider = getProviderInfo(c.req.param('channelName'), { includeAuthValue: true });
    if (!provider) {
      return c.json({ error: 'Provider 不存在' }, 404);
    }

    return c.json(provider);
  });

  app.get('/__console/api/models', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    return c.json(await listChannelModelsWithMetadata());
  });

  app.patch('/__console/api/models/:channelName/:modelId/metadata', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    const result = await setChannelModelMetadata(c.req.param('channelName'), c.req.param('modelId'), payload);
    return c.json(result.body as object, result.status);
  });

  app.post('/__console/api/providers', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));

    try {
      const provider = await createProvider(payload as any);
      return c.json(provider, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, resolveProviderMutationStatus(error));
    }
  });

  app.patch('/__console/api/providers/:channelName', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));

    try {
      const provider = await updateProvider(c.req.param('channelName'), payload as any);
      return c.json(provider);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, resolveProviderMutationStatus(error));
    }
  });

  app.delete('/__console/api/providers/:channelName', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    try {
      await deleteProvider(c.req.param('channelName'));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, resolveProviderMutationStatus(error));
    }
  });

  app.patch('/__console/api/providers/:channelName/enabled', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const { enabled } = await c.req.json().catch(() => ({}));
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled 必须是布尔值' }, 400);
    }

    try {
      const provider = await toggleProvider(c.req.param('channelName'), enabled);
      return c.json(provider);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, resolveProviderMutationStatus(error));
    }
  });

  app.get('/__console/api/providers/:channelName/upstream-models', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const result = await listUpstreamModelsForChannel(c.req.param('channelName'));
    return c.json(result.body as object, result.status);
  });

  // 临时拉取：用表单里的参数（不需要先保存）
  app.post('/__console/api/upstream-models-preview', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const body = await c.req.json<UpstreamModelsPreviewInput>().catch(() => ({} as UpstreamModelsPreviewInput));
    const result = await previewUpstreamModels(body);
    return c.json(result.body as object, result.status);
  });

  app.post('/__console/api/providers/:channelName/test', async (c) => {
    if (!isPasswordConfigured()) {
      console.log(`[ProviderTest] ${c.req.param('channelName')}: GATEWAY_API_KEY 未设置`)
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      console.log(`[ProviderTest] ${c.req.param('channelName')}: 未授权`)
      return c.json({ error: '未授权' }, 401);
    }

    // 请求体可选，只用来指定测试哪个模型
    const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
    const result = await testProviderConnectivity(c.req.param('channelName'), body.model);
    return c.json(result.body as object, result.status);
  });

  app.get('/__console/api/keys', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const keys = await listManagedApiKeys();
    return c.json({ keys });
  });

  app.post('/__console/api/keys', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    const name = String((payload as { name?: unknown }).name ?? '').trim();
    if (!name) {
      return c.json({ error: 'Key 名称不能为空' }, 400);
    }

    try {
      const created = await createManagedApiKey(name, (payload as { cost_quota?: unknown }).cost_quota);
      return c.json(created, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/__console/api/keys/:id', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const key = await getManagedApiKey(c.req.param('id'));
    if (!key) {
      return c.json({ error: '未找到 API key' }, 404);
    }

    return c.json(key);
  });

  app.patch('/__console/api/keys/:id', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    const name = String((payload as { name?: unknown }).name ?? '').trim();
    if (!name) {
      return c.json({ error: 'Key 名称不能为空' }, 400);
    }

    const updated = await renameManagedApiKey(c.req.param('id'), name);
    if (!updated) {
      return c.json({ error: '未找到 API key' }, 404);
    }

    return c.json(updated);
  });

  app.delete('/__console/api/keys/:id', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const deleted = await deleteManagedApiKey(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: '未找到 API key' }, 404);
    }

    return c.json({ ok: true });
  });

  app.patch('/__console/api/keys/:id/allowed-models', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    const models = (payload as { models?: unknown }).models;
    if (!Array.isArray(models) || models.some((m) => typeof m !== 'string')) {
      return c.json({ error: 'models 必须是字符串数组' }, 400);
    }

    const updated = await setApiKeyAllowedModels(c.req.param('id'), models as string[]);
    if (!updated) {
      return c.json({ error: '未找到 API key' }, 404);
    }

    return c.json(updated);
  });

  app.patch('/__console/api/keys/:id/quota', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const payload = await c.req.json().catch(() => ({}));
    const parsed = parseApiKeyCostQuotaLimit((payload as { cost_quota?: unknown }).cost_quota);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }

    const updated = await setApiKeyCostQuota(c.req.param('id'), parsed.value);
    if (!updated) {
      return c.json({ error: '未找到 API key' }, 404);
    }

    return c.json(updated);
  });

  // ── Model Aliases ────────────────────────────────────────────────────────

  app.get('/__console/api/model-aliases', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const aliases = await listModelAliases();
    return c.json({ aliases });
  });

  app.post('/__console/api/model-aliases', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await createModelAlias(payload as any);
      await refreshRoutingConfigCache();
      return c.json(alias, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch('/__console/api/model-aliases/:id', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await updateModelAlias(id, payload as any);
      await refreshRoutingConfigCache();
      return c.json(alias);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch('/__console/api/model-aliases/:id/enabled', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    const { enabled } = await c.req.json().catch(() => ({}));
    if (typeof enabled !== 'boolean') return c.json({ error: 'enabled 必须是布尔值' }, 400);
    try {
      const alias = await toggleModelAlias(id, enabled);
      await refreshRoutingConfigCache();
      return c.json(alias);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete('/__console/api/model-aliases/:id', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'GATEWAY_API_KEY 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    try {
      await deleteModelAlias(id);
      await refreshRoutingConfigCache();
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.use('*', maybeServeFrontend);
}
