export type ConsoleSession = {
  authenticated: boolean
  enabled: boolean
}

export type ConsoleSummary = {
  model?: string
  metadata_user_id?: string
  system_len?: number
  first_user_len?: number
  message_roles?: string[]
}

export type ConsoleResponseTiming = {
  first_chunk_latency_ms?: number | null
  first_token_latency_ms?: number | null
  duration_ms?: number | null
  generation_duration_ms?: number | null
  response_body_bytes?: number | null
  has_streaming_content?: boolean
}

export type ConsoleModelPricing = {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
}

export type ConsoleCostBreakdown = {
  upstream_type: "anthropic" | "openai"
  uncached_input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  input_cost: number
  output_cost: number
  cache_read_cost: number
  cache_write_cost: number
  total_cost: number
}

export type ConsoleResponseUsage = {
  model?: string
  stop_reason?: string
  input_tokens?: number
  uncached_input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cached_input_tokens?: number
  reasoning_output_tokens?: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_cache_creation_tokens?: number
  total_cache_read_tokens?: number
  cost?: number
  cost_breakdown?: ConsoleCostBreakdown
  cost_pricing?: ConsoleModelPricing
  estimated?: boolean
}

export type ConsoleAnalysis = {
  cache_state: string
  summary: string
}

export type ConsoleRequestListItem = {
  request_id: string
  created_at: number
  route_prefix: string
  upstream_type: string
  source_request_type?: string | null
  client_label?: string
  api_key_id?: string | null
  api_key_name?: string | null
  path: string
  target_url: string
  request_model: string
  response_status: number | null
  response_status_text: string
  response_payload_truncated: boolean
  response_payload_truncation_reason: string | null
  response_timing: ConsoleResponseTiming
  response_usage: ConsoleResponseUsage
  forwarded_summary: ConsoleSummary | null
  analysis: ConsoleAnalysis
  failover_from: string | null
  failover_chain: string[]
  original_route_prefix: string | null
  original_request_model: string | null
  failover_reason: string | null
}

export type ConsoleRequestDetail = {
  record: any
  previous: any
  analysis: ConsoleAnalysis
  source_request_type?: string | null
  client_label?: string
  api_key_id?: string | null
  api_key_name?: string | null
}

export type ConsoleStatsBucket = {
  key: string
  label: string
  requests: number
  errors: number
  cache_hits: number
  cache_creates: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_cache_creation_tokens?: number
  total_cache_read_tokens?: number
  total_cached_input_tokens?: number
  total_reasoning_output_tokens?: number
  total_tokens: number
  total_cost: number
  avg_first_chunk_ms?: number | null
  avg_first_token_ms: number | null
  avg_duration_ms?: number | null
  last_seen_at: number
}

export type ConsoleStats = {
  routes: ConsoleStatsBucket[]
  models: ConsoleStatsBucket[]
  clients: ConsoleStatsBucket[]
}

export type ConsoleUsageFilterOption = {
  value: string
  label: string
}

export type ConsoleUsageFilters = {
  routes: ConsoleUsageFilterOption[]
  models: ConsoleUsageFilterOption[]
  clients: ConsoleUsageFilterOption[]
}

export type ConsoleUsageOverview = {
  total: number
  cache_hits: number
  cache_creates: number
  cache_misses: number
  errors: number
  failovers: number
  hit_rate: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  total_cached_input_tokens: number
  total_reasoning_output_tokens: number
  total_tokens: number
  total_cost: number
  total_input_cost: number
  total_output_cost: number
  total_cache_read_cost: number
  total_cache_write_cost: number
  avg_first_chunk_ms: number | null
  avg_first_token_ms: number | null
  avg_duration_ms: number | null
  avg_generation_ms: number | null
  storage_backend: "postgresql"
  retention_max_records: number
}

export type ConsoleUsageTimeSeriesPoint = {
  bucket_start: number
  bucket_label: string
  requests: number
  total_tokens: number
  total_cost: number
  errors: number
}

export type ConsoleUsageStatsPayload = {
  overview: ConsoleUsageOverview
  stats: ConsoleStats
  filters: ConsoleUsageFilters
  timeseries: ConsoleUsageTimeSeriesPoint[]
}

export type ConsoleDashboardPayload = {
  overview: any
  stats: ConsoleStats
  requests: ConsoleRequestListItem[]
}

export type ConsoleRequestListPayload = {
  requests: ConsoleRequestListItem[]
  total?: number
  offset?: number
}

export type RequestSortKey =
  | "created_at"
  | "response_status"
  | "tokens"

export type SortDirection = "asc" | "desc"

export type ProviderModelInfo = {
  model: string
  context?: number
  [key: string]: unknown
}

export type ProviderAuthInfo = {
  header: "x-api-key" | "authorization"
  configured: boolean
  value?: string
}

export type OpenAiResponsesMode = "native" | "chat_compat" | "disabled"

export type ProviderInfo = {
  channelName: string
  type: "anthropic" | "openai"
  targetBaseUrl: string
  systemPrompt: string | null
  priority: number
  enabled: boolean
  models: ProviderModelInfo[]
  auth: ProviderAuthInfo | null
  responsesMode?: OpenAiResponsesMode
  extraFields: Record<string, unknown> | null
  providerUuid: string
  healthStatus?: "healthy" | "degraded" | "down" | "no-data"
}

export type ConsoleProvidersPayload = {
  providers: ProviderInfo[]
}

export type ProviderMutationPayload = {
  channelName?: string
  type?: "anthropic" | "openai"
  targetBaseUrl?: string
  systemPrompt?: string | null
  models?: Array<string | ProviderModelInfo> | null
  priority?: number
  auth?: {
    header?: "x-api-key" | "authorization"
    value?: string
  } | null
  responsesMode?: OpenAiResponsesMode | null
  extraFields?: Record<string, unknown> | null
}

export type ManagedApiKey = {
  id: string
  name: string
  prefix: string
  created_at: number
  last_used_at: number | null
}

export type ConsoleKeysPayload = {
  keys: ManagedApiKey[]
}

export type ConsoleCreateKeyPayload = {
  key: string
  record: ManagedApiKey
}

export type ManagedApiKeyDetail = ManagedApiKey & {
  key: string
}

export type TestProviderResult = {
  status: "ok" | "error"
  statusCode: number
  message: string
  latencyMs?: number
  model?: string
  rawResponse?: unknown
}

export type GatewayModel = {
  id: string
  channelName: string
  type: "anthropic" | "openai"
  context?: number
  pricing?: ConsoleModelPricing
}

export type ConsoleModelsPayload = {
  openai: GatewayModel[]
  anthropic: GatewayModel[]
}

export type ModelAlias = {
  id: number
  alias: string
  provider: string
  model: string
  description: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type ModelAliasesPayload = {
  aliases: ModelAlias[]
}

export type ModelAliasMutationPayload = {
  alias?: string
  provider?: string
  model?: string
  description?: string | null
  enabled?: boolean
}
