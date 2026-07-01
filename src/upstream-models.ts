/**
 * 统一的上游模型列表拉取逻辑。
 *
 * OpenAI 与 Anthropic 的 `/v1/models` 接口均返回 `{ data: [{ id: string, ... }] }`，
 * 这里把 URL 拼接、认证头构造、超时与解析集中到一处，供 console 路由、渠道保存时的
 * 即时同步以及 24h 定时任务复用。
 */

export type UpstreamType = 'anthropic' | 'openai';
export type RouteAuthHeader = 'x-api-key' | 'authorization';

export interface FetchUpstreamModelsParams {
  targetBaseUrl: string;
  type: UpstreamType;
  authHeader: RouteAuthHeader;
  /** 认证值；authorization 头会自动补齐 `Bearer ` 前缀（幂等）。 */
  authValue: string;
  /** 请求超时（毫秒），默认 15s。 */
  timeoutMs?: number;
}

function buildModelsUrl(targetBaseUrl: string, type: UpstreamType): { url: string; extraHeaders: Record<string, string> } {
  const baseUrl = targetBaseUrl.replace(/\/$/, '');
  if (type === 'anthropic') {
    const v1Prefix = baseUrl.endsWith('/v1') ? '' : '/v1';
    return { url: `${baseUrl}${v1Prefix}/models`, extraHeaders: { 'anthropic-version': '2023-06-01' } };
  }
  return { url: `${baseUrl}/models`, extraHeaders: {} };
}

function buildAuthHeaders(authHeader: RouteAuthHeader, authValue: string): Record<string, string> {
  if (authHeader === 'authorization') {
    const value = authValue.startsWith('Bearer ') ? authValue : `Bearer ${authValue}`;
    return { Authorization: value };
  }
  return { 'x-api-key': authValue };
}

/**
 * 请求上游 `/v1/models`，返回模型 ID 列表。
 * 失败时（网络错误、非 2xx、解析异常）抛出带可读信息的 Error。
 */
export async function fetchUpstreamModelIds(params: FetchUpstreamModelsParams): Promise<string[]> {
  const baseUrl = (params.targetBaseUrl ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('targetBaseUrl 不能为空');
  }
  if (!params.authValue) {
    throw new Error('未配置认证信息（Credential），无法请求上游 models 接口');
  }

  const { url, extraHeaders } = buildModelsUrl(baseUrl, params.type);
  const authHeaders = buildAuthHeaders(params.authHeader, params.authValue);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 15000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { ...authHeaders, ...extraHeaders },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`上游返回 HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json().catch(() => null);
  const items: unknown[] = Array.isArray((data as Record<string, unknown> | null)?.data)
    ? ((data as Record<string, unknown>).data as unknown[])
    : [];

  return items
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'id' in item) {
        return String((item as Record<string, unknown>).id);
      }
      return null;
    })
    .filter((id): id is string => id !== null && id.length > 0);
}
