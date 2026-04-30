import type {
  ConsoleCreateKeyPayload,
  ConsoleKeysPayload,
  ConsoleModelsPayload,
  ConsoleProvidersPayload,
  ConsoleRequestListPayload,
  ConsoleRequestDetail,
  ConsoleSession,
  ConsoleUsageStatsPayload,
  ManagedApiKey,
  ManagedApiKeyDetail,
  ModelAlias,
  ModelAliasesPayload,
  ModelAliasMutationPayload,
  ProviderInfo,
  ProviderMutationPayload,
} from "@/features/dashboard/types"

export const DEFAULT_REQUEST_LIMIT = 50
export const DEFAULT_REQUEST_OFFSET = 0

export async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (response.status === 401) {
    throw new Error("unauthorized")
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown
      }
      throw new Error(String(payload.error ?? "request failed"))
    }

    const text = await response.text()
    throw new Error(text || "request failed")
  }

  return response.json()
}

export function fetchSession(): Promise<ConsoleSession> {
  return requestJson("/__console/api/session")
}

export type RequestSortKey = 'created_at' | 'response_status' | 'tokens'
export type SortDirection = 'asc' | 'desc'

export function fetchRequests(
  limit = DEFAULT_REQUEST_LIMIT,
  offset = DEFAULT_REQUEST_OFFSET,
  filters?: {
    route?: string;
    model?: string;
    api_key_name?: string;
    search?: string;
    status?: string;
    cache?: string;
  },
  sortBy?: RequestSortKey,
  sortOrder?: SortDirection,
): Promise<ConsoleRequestListPayload> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (filters?.route) params.set('route', filters.route);
  if (filters?.model) params.set('model', filters.model);
  if (filters?.api_key_name) params.set('api_key_name', filters.api_key_name);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.cache) params.set('cache', filters.cache);
  if (sortBy) params.set('sort_by', sortBy);
  if (sortOrder) params.set('sort_order', sortOrder);

  return requestJson(`/__console/api/requests?${params.toString()}`)
}

export function fetchUsageStats(query?: URLSearchParams): Promise<ConsoleUsageStatsPayload> {
  const qs = query?.toString()
  return requestJson(`/__console/api/stats${qs ? `?${qs}` : ""}`)
}

export function fetchRequestDetail(
  requestId: string,
): Promise<ConsoleRequestDetail> {
  return requestJson(`/__console/api/requests/${encodeURIComponent(requestId)}`)
}

export async function login(password: string): Promise<void> {
  const response = await fetch("/__console/login", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: unknown
    }
    throw new Error(String(payload.error ?? "登录失败"))
  }
}

export async function logout(): Promise<void> {
  await requestJson("/__console/logout", { method: "POST" })
}

export function fetchProviders(): Promise<ConsoleProvidersPayload> {
  return requestJson("/__console/api/providers")
}

export function fetchProvider(channelName: string): Promise<ProviderInfo> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}`)
}

export function createProvider(payload: ProviderMutationPayload): Promise<ProviderInfo> {
  return requestJson("/__console/api/providers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}

export function updateProvider(
  channelName: string,
  payload: ProviderMutationPayload,
): Promise<ProviderInfo> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}

export function deleteProvider(channelName: string): Promise<{ ok: boolean }> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}`, {
    method: "DELETE",
  })
}

export function toggleProvider(channelName: string, enabled: boolean): Promise<ProviderInfo> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}/enabled`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled }),
  })
}

export type TestProviderResult = {
  status: "ok" | "error"
  statusCode: number
  message: string
  latencyMs?: number
  model?: string
  rawResponse?: unknown
}

export function testProvider(channelName: string, model?: string): Promise<TestProviderResult> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(model ? { model } : {}),
  })
}

export function fetchKeys(): Promise<ConsoleKeysPayload> {
  return requestJson("/__console/api/keys")
}

export function createKey(name: string): Promise<ConsoleCreateKeyPayload> {
  return requestJson("/__console/api/keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })
}

export function getKey(id: string): Promise<ManagedApiKeyDetail> {
  return requestJson(`/__console/api/keys/${encodeURIComponent(id)}`)
}

export function renameKey(id: string, name: string): Promise<{ id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }> {
  return requestJson(`/__console/api/keys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })
}

export function deleteKey(id: string): Promise<{ ok: true }> {
  return requestJson(`/__console/api/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function setKeyAllowedModels(id: string, models: string[]): Promise<ManagedApiKey> {
  return requestJson(`/__console/api/keys/${encodeURIComponent(id)}/allowed-models`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ models }),
  })
}

export interface ConsoleFilterOptions {
  routes: string[]
  models: string[]
  clients: { value: string; label: string }[]
}

export function fetchFilterOptions(): Promise<{ ok: boolean } & ConsoleFilterOptions> {
  return requestJson("/__console/api/filters")
}

export function fetchModels(): Promise<ConsoleModelsPayload> {
  return requestJson("/__console/api/models")
}

export function fetchUpstreamModels(channelName: string): Promise<{ models: Array<{ id: string }> }> {
  return requestJson(`/__console/api/providers/${encodeURIComponent(channelName)}/upstream-models`)
}

export function fetchUpstreamModelsPreview(params: {
  targetBaseUrl: string
  type: 'openai' | 'anthropic'
  authHeader?: string
  authValue?: string
}): Promise<{ models: Array<{ id: string }> }> {
  return requestJson('/__console/api/upstream-models-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

// ── Model Aliases ──────────────────────────────────────────────────────────

export function fetchModelAliases(): Promise<ModelAliasesPayload> {
  return requestJson("/__console/api/model-aliases")
}

export function createModelAlias(payload: ModelAliasMutationPayload): Promise<ModelAlias> {
  return requestJson("/__console/api/model-aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function updateModelAlias(id: number, payload: ModelAliasMutationPayload): Promise<ModelAlias> {
  return requestJson(`/__console/api/model-aliases/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function toggleModelAlias(id: number, enabled: boolean): Promise<ModelAlias> {
  return requestJson(`/__console/api/model-aliases/${id}/enabled`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  })
}

export function deleteModelAlias(id: number): Promise<{ ok: true }> {
  return requestJson(`/__console/api/model-aliases/${id}`, {
    method: "DELETE",
  })
}
