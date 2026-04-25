import type { Context } from 'hono';
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createProvider, deleteProvider, ensureProviderConfigsLoaded, getModels, getProviderConfig, getProviderInfo, getProviders, resolveRoute, toggleProvider, updateProvider } from './config';
import { getConsoleRequest, listConsoleRequests, getProviderHealthStatuses, getConsoleUsageStats, getConsoleFilterOptions, type RequestSortKey, type SortDirection } from './console-store';
import { createManagedApiKey, deleteManagedApiKey, getManagedApiKey, listManagedApiKeys, renameManagedApiKey } from './api-keys';
import { createModelAlias, deleteModelAlias, listModelAliases, toggleModelAlias, updateModelAlias } from './console-model-alias-store';
import { ensureModelCatalogLoaded, lookupModelContext } from './model-catalog';
import { ensurePricingLoaded, getModelPricing } from './pricing';

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
  if (message.includes('不存在')) {
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

function getPassword(): string {
  return process.env.PASSWORD ?? '';
}

function isPasswordConfigured(): boolean {
  return getPassword().length > 0;
}

function getAuthToken(): string {
  return `v1:${hashSecret(getPassword())}`;
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    return c.redirect('/');
  }

  const password = await readPassword(c);
  if (password !== getPassword()) {
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const options = await getConsoleFilterOptions();
    return c.json({ ok: true, ...options });
  });

  app.get('/__console/api/requests/:requestId', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    await ensureProviderConfigsLoaded();
    await Promise.all([ensureModelCatalogLoaded(), ensurePricingLoaded()]);

    const rawModels = getModels();
    const enrich = (m: (typeof rawModels)[number]) => {
      const pricing = getModelPricing(m.id);
      return {
        ...m,
        context: m.context ?? lookupModelContext(m.id),
        ...(pricing ? { pricing } : {}),
      };
    };

    return c.json({
      openai: rawModels.filter((m) => m.type === 'openai').map(enrich),
      anthropic: rawModels.filter((m) => m.type === 'anthropic').map(enrich),
    });
  });

  app.post('/__console/api/providers', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const channelName = c.req.param('channelName');
    await ensureProviderConfigsLoaded();

    const provider = getProviderConfig(channelName);
    if (!provider) {
      return c.json({ error: 'Provider 不存在' }, 404);
    }

    const auth = provider.auth;
    if (!auth?.value) {
      return c.json({ error: '该渠道未配置认证信息，无法请求上游 models 接口' }, 400);
    }

    const baseUrl = provider.targetBaseUrl.replace(/\/$/, '');
    const authHeaders: Record<string, string> = {};
    if (auth.header === 'authorization') {
      authHeaders.Authorization = auth.value;
    } else {
      authHeaders['x-api-key'] = auth.value;
    }

    let modelsUrl: string;
    let extraHeaders: Record<string, string> = {};
    if (provider.type === 'anthropic') {
      const v1Prefix = baseUrl.endsWith('/v1') ? '' : '/v1';
      modelsUrl = baseUrl + v1Prefix + '/models';
      extraHeaders = { 'anthropic-version': '2023-06-01' };
    } else {
      modelsUrl = baseUrl + '/models';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: { ...authHeaders, ...extraHeaders },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return c.json({ error: `上游返回 HTTP ${response.status}: ${text.slice(0, 200)}` }, 502);
      }

      const data = await response.json();
      // OpenAI 和 Anthropic 的 /v1/models 均返回 { data: [{ id: string, ... }] }
      const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
      const models = items
        .map((item) => {
          if (typeof item === 'object' && item !== null && 'id' in item) {
            return { id: String((item as Record<string, unknown>).id) };
          }
          return null;
        })
        .filter((m): m is { id: string } => m !== null);

      return c.json({ models });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  // 临时拉取：用表单里的参数（不需要先保存）
  app.post('/__console/api/upstream-models-preview', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const body = await c.req.json<{
      targetBaseUrl: string;
      type: 'openai' | 'anthropic';
      authHeader?: string;
      authValue?: string;
    }>();

    const baseUrl = (body.targetBaseUrl ?? '').replace(/\/$/, '');
    if (!baseUrl) {
      return c.json({ error: 'targetBaseUrl 不能为空' }, 400);
    }
    if (!body.authValue) {
      return c.json({ error: '未填写认证信息（Credential），无法请求上游 models 接口' }, 400);
    }

    const authHeaders: Record<string, string> = {};
    const headerName = body.authHeader && body.authHeader !== 'auto'
      ? body.authHeader
      : body.type === 'anthropic' ? 'x-api-key' : 'authorization';

    if (headerName === 'authorization') {
      const val = body.authValue.startsWith('Bearer ') ? body.authValue : `Bearer ${body.authValue}`;
      authHeaders.Authorization = val;
    } else {
      authHeaders['x-api-key'] = body.authValue;
    }

    let modelsUrl: string;
    let extraHeaders: Record<string, string> = {};
    if (body.type === 'anthropic') {
      const v1Prefix = baseUrl.endsWith('/v1') ? '' : '/v1';
      modelsUrl = baseUrl + v1Prefix + '/models';
      extraHeaders = { 'anthropic-version': '2023-06-01' };
    } else {
      modelsUrl = baseUrl + '/models';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: { ...authHeaders, ...extraHeaders },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return c.json({ error: `上游返回 HTTP ${response.status}: ${text.slice(0, 200)}` }, 502);
      }

      const data = await response.json();
      const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
      const models = items
        .map((item) => {
          if (typeof item === 'object' && item !== null && 'id' in item) {
            return { id: String((item as Record<string, unknown>).id) };
          }
          return null;
        })
        .filter((m): m is { id: string } => m !== null);

      return c.json({ models });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  app.post('/__console/api/providers/:channelName/test', async (c) => {
    if (!isPasswordConfigured()) {
      console.log(`[ProviderTest] ${c.req.param('channelName')}: PASSWORD 未设置`)
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      console.log(`[ProviderTest] ${c.req.param('channelName')}: 未授权`)
      return c.json({ error: '未授权' }, 401);
    }

    const channelName = c.req.param('channelName');
    await ensureProviderConfigsLoaded();

    // 使用 getProviderConfig 获取包含 auth value 的配置
    const provider = getProviderConfig(channelName);
    if (!provider) {
      console.log(`[ProviderTest] ${channelName}: Provider 不存在`)
      return c.json({ error: 'Provider 不存在' }, 404);
    }

    const auth = provider.auth;
    if (!auth?.value) {
      console.log(`[ProviderTest] ${channelName}: 认证未配置`)
      return c.json({ error: '认证未配置' }, 400);
    }

    // 解析请求体，获取指定的模型（可选）
    let requestedModel: string | undefined;
    try {
      const body = await c.req.json();
      requestedModel = body.model;
    } catch {
      // 忽略解析错误
    }

    // 使用请求中指定的模型，或第一个配置的模型
    const testModel = requestedModel || provider.models?.[0]?.model;
    if (!testModel) {
      console.log(`[ProviderTest] ${channelName}: 未配置模型`)
      return c.json({ error: '未配置模型' }, 400);
    }

    console.log(`[ProviderTest] ${channelName}: 开始测试 model=${testModel} url=${provider.targetBaseUrl}`)

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let testUrl: string
      let headers: Record<string, string>
      let body: object
      const authHeaders: Record<string, string> = {}
      if (auth.header === 'authorization') {
        authHeaders.Authorization = auth.value
      } else {
        authHeaders['x-api-key'] = auth.value
      }

      // 路径拼接规则：
      // - OpenAI 类型：不补 /v1，用户必须在 targetBaseUrl 中包含 /v1
      // - Anthropic 类型：如果不包含 /v1 则补，这是行业惯例
      const baseUrl = provider.targetBaseUrl.replace(/\/$/, '')

      if (provider.type === 'anthropic') {
        // Anthropic：检测是否需要补 /v1
        const v1Prefix = baseUrl.endsWith('/v1') ? '' : '/v1'
        testUrl = baseUrl + v1Prefix + '/messages'
        headers = {
          ...authHeaders,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
        body = {
          model: testModel,
          messages: [{ role: 'user', content: 'Reply with exactly "OK"' }],
          max_tokens: 1024,
        }
      } else {
        // OpenAI：不补 /v1，用户必须填写完整路径
        testUrl = baseUrl + '/chat/completions'
        headers = {
          ...authHeaders,
          'content-type': 'application/json',
        }
        body = {
          model: testModel,
          messages: [{ role: 'user', content: 'Reply with exactly "OK"' }],
          max_tokens: 1024,
        }
      }

      const response = await fetch(testUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - startTime

      // 打印原始响应信息用于调试
      console.log(`[ProviderTest] ${channelName}: HTTP ${response.status} bodySize=${response.headers.get('content-length')}`)

      const data = await response.json().catch(() => ({}))
      console.log(`[ProviderTest] ${channelName}: 响应数据 ${JSON.stringify(data).slice(0, 1000)}`)

      if (response.ok) {
        // 检查响应内容是否包含 OK（需要处理 thinking 类型的 content）
        let content = ''
        let hasThinking = false
        let stopReason = ''
        if (provider.type === 'anthropic') {
          // 遍历所有 content 块，优先查找 text 类型，其次是 thinking
          const contents = data.content ?? []
          console.log(`[ProviderTest] ${channelName}: content块数量=${contents.length}`)
          for (let i = 0; i < contents.length; i++) {
            const block = contents[i]
            console.log(`[ProviderTest] ${channelName}: content[${i}] type=${block.type}`)
            if (block.type === 'text') {
              content = block.text ?? ''
            } else if (block.type === 'thinking') {
              hasThinking = true
              if (!content) {
                content = block.thinking ?? ''
              }
            }
          }
          stopReason = data.stop_reason ?? ''
        } else {
          content = data.choices?.[0]?.message?.content ?? ''
          stopReason = data.choices?.[0]?.finish_reason ?? ''
          // OpenAI 兼容的思考模型：content 可能在 reasoning_content 或类似字段
          if (!content && data.choices?.[0]?.message?.reasoning_content) {
            hasThinking = true
            content = data.choices?.[0]?.message?.reasoning_content
          }
        }

        console.log(`[ProviderTest] ${channelName}: 提取的content="${content.slice(0, 200)}" stopReason="${stopReason}" hasThinking=${hasThinking}`)

        if (content.toUpperCase().includes('OK')) {
          console.log(`[ProviderTest] ${channelName}: 成功 latencyMs=${latencyMs}`)
          return c.json({
            status: 'ok',
            statusCode: response.status,
            message: '模型响应正常',
            latencyMs,
            model: testModel,
            rawResponse: data,
          })
        } else if (hasThinking || stopReason === 'max_tokens' || stopReason === 'stop') {
          // 思考模型可能只有 thinking 没有 text（max_tokens 不足），但连通性正常
          console.log(`[ProviderTest] ${channelName}: 思考模型连通正常 latencyMs=${latencyMs}`)
          return c.json({
            status: 'ok',
            statusCode: response.status,
            message: '模型连通正常（思考模型，输出被截断）',
            latencyMs,
            model: testModel,
            rawResponse: data,
          })
        } else {
          console.log(`[ProviderTest] ${channelName}: 响应内容异常`)
          return c.json({
            status: 'error',
            statusCode: response.status,
            message: `HTTP ${response.status} - 响应内容为空或不含OK`,
            latencyMs,
            model: testModel,
            rawResponse: data,
          })
        }
      } else {
        const errorText = await response.text().catch(() => '')
        console.log(`[ProviderTest] ${channelName}: HTTP ${response.status} error="${errorText.slice(0, 200)}"`)

        // 尝试解析上游返回的错误信息
        let errorDetail = ''
        try {
          const errorJson = JSON.parse(errorText)
          errorDetail = errorJson.error?.message || errorJson.message || errorJson.error?.type || ''
        } catch {
          errorDetail = errorText.slice(0, 200)
        }

        // 针对常见错误码提供更友好的提示
        let friendlyMessage = `HTTP ${response.status}`
        if (errorDetail) {
          friendlyMessage += `: ${errorDetail}`
        } else if (response.status === 401) {
          friendlyMessage = 'API Key 无效或已过期'
        } else if (response.status === 403) {
          friendlyMessage = '无访问权限，请检查 API Key 权限设置'
        } else if (response.status === 429) {
          friendlyMessage = '请求频率超限，请稍后重试'
        } else if (response.status === 400) {
          friendlyMessage = '请求参数错误，请检查模型名称是否正确'
        }

        return c.json({
          status: 'error',
          statusCode: response.status,
          message: friendlyMessage,
          latencyMs,
          model: testModel,
          rawResponse: errorText ? (() => {
            try {
              return JSON.parse(errorText);
            } catch {
              return errorText.slice(0, 1000);
            }
          })() : null,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[ProviderTest] ${channelName}: 异常 ${message}`)

      if (message.includes('aborted')) {
        return c.json({
          status: 'error',
          statusCode: 0,
          message: '请求超时（30秒）',
          latencyMs: 30000,
          model: testModel,
        })
      }
      return c.json({
        status: 'error',
        statusCode: 0,
        message: `连接失败: ${message}`,
        latencyMs: Date.now() - startTime,
        model: testModel,
      })
    }
  });

  app.get('/__console/api/keys', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
    }
    if (!isAuthenticated(c)) {
      return c.json({ error: '未授权' }, 401);
    }

    const keys = await listManagedApiKeys();
    return c.json({ keys });
  });

  app.post('/__console/api/keys', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      const created = await createManagedApiKey(name);
      return c.json(created, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/__console/api/keys/:id', async (c) => {
    if (!isPasswordConfigured()) {
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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
      return c.json({ error: 'PASSWORD 未设置' }, 503);
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

  // ── Model Aliases ────────────────────────────────────────────────────────

  app.get('/__console/api/model-aliases', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'PASSWORD 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const aliases = await listModelAliases();
    return c.json({ aliases });
  });

  app.post('/__console/api/model-aliases', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'PASSWORD 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await createModelAlias(payload as any);
      return c.json(alias, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch('/__console/api/model-aliases/:id', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'PASSWORD 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    const payload = await c.req.json().catch(() => ({}));
    try {
      const alias = await updateModelAlias(id, payload as any);
      return c.json(alias);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch('/__console/api/model-aliases/:id/enabled', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'PASSWORD 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    const { enabled } = await c.req.json().catch(() => ({}));
    if (typeof enabled !== 'boolean') return c.json({ error: 'enabled 必须是布尔值' }, 400);
    try {
      const alias = await toggleModelAlias(id, enabled);
      return c.json(alias);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete('/__console/api/model-aliases/:id', async (c) => {
    if (!isPasswordConfigured()) return c.json({ error: 'PASSWORD 未设置' }, 503);
    if (!isAuthenticated(c)) return c.json({ error: '未授权' }, 401);
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: '无效的 id' }, 400);
    try {
      await deleteModelAlias(id);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.use('*', maybeServeFrontend);
}
