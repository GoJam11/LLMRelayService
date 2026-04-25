import { calculateCost, getModelPricing, type CostBreakdown, type ModelPricing } from './pricing';
import { detectRequestKindForProvider } from './providers';
import type { DetectedRequestKind } from './providers';
import { createDbClient } from './db/client';
import { getDatabaseUrl } from './db/config';
import { isTrustedTestDatabaseUrl } from './db/test-database';
import { runMigrations } from './db/migrate';
import { consoleRequests } from './db/schema';
import { eq, desc, asc, and, or, sql, count, gte, isNotNull, isNull, like, notInArray, type SQL } from 'drizzle-orm';
import { elapsedPerfMs, getMaxPerfPhase, nowPerfMs, shouldLogBackgroundPerf } from './perf-detail';
import { recordBackgroundPerfSample } from './perf-monitor';

export type UpstreamTypeForConsole = 'anthropic' | 'openai';

export interface PayloadSummaryForConsole {
  model: string;
  stream: boolean;
  metadata_user_id: string;
  system_len: number;
  system_head: string;
  first_user_len: number;
  first_user_head: string;
  messages_count: number;
  message_roles?: string[];
}

export interface ForwardHeadersSummary {
  authorization: string;
  user_agent: string;
  x_app: string;
  anthropic_beta: string;
  anthropic_version: string;
  anthropic_dangerous_direct_browser_access: string;
  x_stainless_arch: string;
  x_stainless_lang: string;
  x_stainless_package_version: string;
}

export interface ResponseUsageForConsole {
  model: string;
  stop_reason: string;
  input_tokens: number;
  uncached_input_tokens?: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
  cost?: number;
  cost_breakdown?: CostBreakdown;
  cost_pricing?: ModelPricing;
  estimated?: boolean;
}

export interface ResponseTimingSnapshotForConsole {
  response_body_bytes: number;
  first_chunk_at: number | null;
  first_token_at: number | null;
  completed_at: number | null;
  has_streaming_content: boolean;
}

export interface ResponseTimingForConsole extends ResponseTimingSnapshotForConsole {
  first_chunk_latency_ms: number | null;
  first_token_latency_ms: number | null;
  duration_ms: number | null;
  generation_duration_ms: number | null;
}

export interface ConsoleRequestSnapshotInput {
  request_id: string;
  created_at: number;
  route_prefix: string;
  upstream_type?: UpstreamTypeForConsole;
  method: string;
  path: string;
  target_url: string;
  request_model: string;
  api_key_id?: string | null;
  api_key_name?: string | null;
  original_payload: string | null;
  original_payload_truncated: boolean;
  original_summary: PayloadSummaryForConsole | null;
  forwarded_payload: string | null;
  forwarded_payload_truncated: boolean;
  forwarded_summary: PayloadSummaryForConsole | null;
  original_headers: Record<string, string> | null;
  forward_headers: ForwardHeadersSummary | null;
  failover_from: string | null;
  failover_chain: string[];
  original_route_prefix: string | null;
  original_request_model: string | null;
  failover_reason: string | null;
  source_request_type?: string;
}

export interface ConsoleResponseSnapshotInput {
  request_id: string;
  response_status: number;
  response_status_text: string;
  response_headers?: Record<string, string> | null;
  response_payload: string | null;
  response_payload_truncated: boolean;
  response_payload_truncation_reason?: string | null;
  response_usage: ResponseUsageForConsole;
  response_timing?: Partial<ResponseTimingSnapshotForConsole> | null;
}

interface ConsoleRequestRow {
  request_id: string;
  created_at: number | string;
  route_prefix: string;
  upstream_type: string;
  method: string;
  path: string;
  target_url: string;
  request_model: string;
  api_key_id: string | null;
  api_key_name: string | null;
  original_payload: string | null;
  original_payload_truncated: number | string;
  original_summary_json: string | null;
  forwarded_payload: string | null;
  forwarded_payload_truncated: number | string;
  forwarded_summary_json: string | null;
  original_headers_json: string | null;
  forward_headers_json: string | null;
  response_headers_json: string | null;
  response_status: number | string | null;
  response_status_text: string | null;
  response_payload: string | null;
  response_payload_truncated: number | string;
  response_payload_truncation_reason: string | null;
  response_body_bytes: number | string;
  first_chunk_at: number | string | null;
  first_token_at: number | string | null;
  completed_at: number | string | null;
  has_streaming_content: number | string;
  response_model: string | null;
  stop_reason: string | null;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  cache_creation_input_tokens: number | string;
  cache_read_input_tokens: number | string;
  cached_input_tokens: number | string;
  reasoning_output_tokens: number | string;
  ephemeral_5m_input_tokens: number | string;
  ephemeral_1h_input_tokens: number | string;
  token_usage_estimated: number | string;
  failover_from: string | null;
  failover_chain_json: string | null;
  original_route_prefix: string | null;
  original_request_model: string | null;
  failover_reason: string | null;
}

export interface StoredConsoleRequest {
  request_id: string;
  created_at: number;
  route_prefix: string;
  upstream_type: UpstreamTypeForConsole;
  method: string;
  path: string;
  target_url: string;
  request_model: string;
  original_payload: string | null;
  original_payload_truncated: boolean;
  original_summary: PayloadSummaryForConsole | null;
  forwarded_payload: string | null;
  forwarded_payload_truncated: boolean;
  forwarded_summary: PayloadSummaryForConsole | null;
  original_headers: Record<string, string> | null;
  forward_headers: ForwardHeadersSummary | null;
  response_headers: Record<string, string> | null;
  response_status: number | null;
  response_status_text: string;
  response_payload: string | null;
  response_payload_truncated: boolean;
  response_payload_truncation_reason: string | null;
  response_timing: ResponseTimingForConsole;
  response_usage: ResponseUsageForConsole;
  failover_from: string | null;
  failover_chain: string[];
  original_route_prefix: string | null;
  original_request_model: string | null;
  failover_reason: string | null;
}

export interface ConsoleRequestDetailResult {
  record: StoredConsoleRequest;
  previous: StoredConsoleRequest | null;
  analysis: CacheAnalysisResult;
  source_request_type: DetectedRequestKind;
  client_label: string;
  api_key_id: string | null;
  api_key_name: string | null;
}

export interface CacheAnalysisResult {
  cache_state: 'hit' | 'create' | 'miss';
  summary: string;
}

export interface ConsoleRequestListItem {
  request_id: string;
  created_at: number;
  route_prefix: string;
  upstream_type: UpstreamTypeForConsole;
  source_request_type: DetectedRequestKind;
  client_label: string;
  api_key_id: string | null;
  api_key_name: string | null;
  path: string;
  target_url: string;
  request_model: string;
  response_status: number | null;
  response_status_text: string;
  response_payload_truncated: boolean;
  response_payload_truncation_reason: string | null;
  response_timing: ResponseTimingForConsole;
  response_usage: ResponseUsageForConsole;
  forwarded_summary: PayloadSummaryForConsole | null;
  analysis: CacheAnalysisResult;
  failover_from: string | null;
  failover_chain: string[];
  original_route_prefix: string | null;
  original_request_model: string | null;
  failover_reason: string | null;
}

type ConsoleRequestListRow = Pick<ConsoleRequestRow,
  'request_id'
  | 'created_at'
  | 'route_prefix'
  | 'upstream_type'
  | 'path'
  | 'target_url'
  | 'request_model'
  | 'api_key_id'
  | 'api_key_name'
  | 'forwarded_summary_json'
  | 'response_status'
  | 'response_status_text'
  | 'response_payload_truncated'
  | 'response_payload_truncation_reason'
  | 'response_body_bytes'
  | 'first_chunk_at'
  | 'first_token_at'
  | 'completed_at'
  | 'has_streaming_content'
  | 'response_model'
  | 'stop_reason'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'cache_creation_input_tokens'
  | 'cache_read_input_tokens'
  | 'cached_input_tokens'
  | 'reasoning_output_tokens'
  | 'ephemeral_5m_input_tokens'
  | 'ephemeral_1h_input_tokens'
  | 'token_usage_estimated'
  | 'failover_from'
  | 'failover_chain_json'
  | 'original_route_prefix'
  | 'original_request_model'
  | 'failover_reason'
>;

export interface ConsoleOverview {
  total: number;
  cache_hits: number;
  cache_creates: number;
  cache_misses: number;
  errors: number;
  failovers: number;
  hit_rate: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cached_input_tokens: number;
  total_reasoning_output_tokens: number;
  total_tokens: number;
  total_cost: number;
  total_input_cost: number;
  total_output_cost: number;
  total_cache_read_cost: number;
  total_cache_write_cost: number;
  avg_first_chunk_ms: number | null;
  avg_first_token_ms: number | null;
  avg_duration_ms: number | null;
  avg_generation_ms: number | null;
  storage_backend: 'postgresql';
  retention_max_records: number;
}

export interface ConsoleStatsBucket {
  key: string;
  label: string;
  requests: number;
  errors: number;
  cache_hits: number;
  cache_creates: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cached_input_tokens: number;
  total_reasoning_output_tokens: number;
  total_tokens: number;
  total_cost: number;
  avg_first_chunk_ms: number | null;
  avg_first_token_ms: number | null;
  avg_duration_ms: number | null;
  last_seen_at: number;
}

export interface ConsoleUsageFilterOptions {
  routes: Array<{ value: string; label: string }>;
  models: Array<{ value: string; label: string }>;
  clients: Array<{ value: string; label: string }>;
}

export interface ConsoleGatewayStats {
  routes: ConsoleStatsBucket[];
  models: ConsoleStatsBucket[];
  clients: ConsoleStatsBucket[];
}

export interface ConsoleUsageTimeSeriesPoint {
  bucket_start: number;
  bucket_label: string;
  requests: number;
  total_tokens: number;
  total_cost: number;
  errors: number;
}

export interface ConsoleUsageStatsPayload {
  overview: ConsoleOverview;
  stats: ConsoleGatewayStats;
  filters: ConsoleUsageFilterOptions;
  timeseries: ConsoleUsageTimeSeriesPoint[];
}

const MAX_DEBUG_RECORDS = Math.max(200, Number.parseInt(process.env.DEBUG_DB_MAX_RECORDS || '50000', 10) || 50000);
const db = createDbClient();
const consoleStoreReady = runMigrations();

function assertConsoleClearAllowed(): void {
  if (process.env.ALLOW_CONSOLE_DB_CLEAR === '1') return;

  const databaseUrl = getDatabaseUrl();
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\/+/, '').toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isTestDatabase = database.includes('test');
  const isTrustedTestDatabase = isTrustedTestDatabaseUrl(databaseUrl);

  if (!isLocalHost && !isTestDatabase && !isTrustedTestDatabase) {
    throw new Error(`Refusing to clear console tables on non-test database ${host}/${database}. Set ALLOW_CONSOLE_DB_CLEAR=1 to override.`);
  }
}

interface ConsoleQueryFilters {
  route?: string;
  model?: string;
  client?: string; // DetectedRequestKind 或 API key 名称
  api_key_name?: string;         // 用于 logs 按 API Key 名称筛选
  created_after?: number;
  search?: string;
  status?: "success" | "error";
  cache_state?: "hit" | "create" | "miss" | "bypass" | "error";
}

type UsageAccumulator = {
  requests: number;
  errors: number;
  cache_hits: number;
  cache_creates: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cached_input_tokens: number;
  total_reasoning_output_tokens: number;
  total_tokens: number;
  total_cost: number;
  total_input_cost: number;
  total_output_cost: number;
  total_cache_read_cost: number;
  total_cache_write_cost: number;
  first_chunk_latency_total: number;
  first_chunk_latency_count: number;
  first_token_latency_total: number;
  first_token_latency_count: number;
  duration_total: number;
  duration_count: number;
  generation_total: number;
  generation_count: number;
  last_seen_at: number;
};

type ConsoleUsageRow = {
  request_id: string;
  created_at: number;
  route_prefix: string;
  request_model: string;
  response_model: string | null;
  original_payload: string | null;
  original_headers_json: string | null;
  upstream_type: UpstreamTypeForConsole;
  response_status: number | null;
  api_key_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  first_chunk_at: number | null;
  first_token_at: number | null;
  completed_at: number | null;
  failover_from: string | null;
};

const CLIENT_LABELS: Record<DetectedRequestKind, string> = {
  generic: 'Generic',
  unknown: '未知',
};

function getModelBucketExpression() {
  return sql<string>`coalesce(nullif(${consoleRequests.responseModel}, ''), ${consoleRequests.requestModel})`;
}

function getEffectiveModel(row: Pick<ConsoleUsageRow, 'response_model' | 'request_model'>): string {
  return row.response_model && row.response_model.length > 0
    ? row.response_model
    : row.request_model;
}

function getClientLabel(kind: string): string {
  return CLIENT_LABELS[kind as DetectedRequestKind] ?? kind;
}

function createUsageAccumulator(): UsageAccumulator {
  return {
    requests: 0,
    errors: 0,
    cache_hits: 0,
    cache_creates: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_creation_tokens: 0,
    total_cache_read_tokens: 0,
    total_cached_input_tokens: 0,
    total_reasoning_output_tokens: 0,
    total_tokens: 0,
    total_cost: 0,
    total_input_cost: 0,
    total_output_cost: 0,
    total_cache_read_cost: 0,
    total_cache_write_cost: 0,
    first_chunk_latency_total: 0,
    first_chunk_latency_count: 0,
    first_token_latency_total: 0,
    first_token_latency_count: 0,
    duration_total: 0,
    duration_count: 0,
    generation_total: 0,
    generation_count: 0,
    last_seen_at: 0,
  };
}

function roundAverage(total: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((total / count) * 10) / 10;
}

function addLatencySample(totalKey: keyof Pick<UsageAccumulator, 'first_chunk_latency_total' | 'first_token_latency_total' | 'duration_total' | 'generation_total'>, countKey: keyof Pick<UsageAccumulator, 'first_chunk_latency_count' | 'first_token_latency_count' | 'duration_count' | 'generation_count'>, value: number | null, accumulator: UsageAccumulator) {
  if (value == null || !Number.isFinite(value) || value < 0) return;
  accumulator[totalKey] += value;
  accumulator[countKey] += 1;
}

function detectClientKindFromRow(row: { source_request_type?: string | null; original_payload?: string | null; upstream_type: string; original_headers_json?: string | null }): DetectedRequestKind {
  // Use pre-computed source_request_type if available (new rows)
  if (row.source_request_type && row.source_request_type !== 'unknown') {
    return row.source_request_type as DetectedRequestKind;
  }
  // Fallback for legacy rows that don't have the column populated
  if (row.original_payload != null) {
    const originalHeaders = parseJson<Record<string, string>>(row.original_headers_json ?? null);
    return detectRequestKindForProvider(
      row.original_payload,
      row.upstream_type as UpstreamTypeForConsole,
      originalHeaders ? new Headers(originalHeaders) : undefined,
    );
  }
  return 'unknown';
}

function matchesUsageFilters(row: ConsoleUsageRow, clientBucketKey: string, filters?: ConsoleQueryFilters): boolean {
  if (filters?.client && clientBucketKey !== filters.client) return false;
  return true;
}

/** API key 名称优先，否则用 detectedKind */
function getClientBucketKey(row: ConsoleUsageRow): string {
  if (row.api_key_name && row.api_key_name.trim()) return row.api_key_name.trim();
  return detectClientKindFromRow(row);
}

function isUsageCacheHit(
  upstreamType: UpstreamTypeForConsole,
  usage: Pick<ConsoleUsageRow, 'cache_read_input_tokens' | 'cached_input_tokens'>,
): boolean {
  return upstreamType === 'openai'
    ? usage.cached_input_tokens > 0
    : usage.cache_read_input_tokens > 0;
}

function updateUsageAccumulator(accumulator: UsageAccumulator, row: ConsoleUsageRow, model: string) {
  accumulator.requests += 1;
  if (row.response_status != null && row.response_status >= 400) {
    accumulator.errors += 1;
  }
  if (isUsageCacheHit(row.upstream_type, row)) {
    accumulator.cache_hits += 1;
  }
  if (row.upstream_type === 'anthropic' && row.cache_creation_input_tokens > 0) {
    accumulator.cache_creates += 1;
  }

  accumulator.total_input_tokens += row.input_tokens;
  accumulator.total_output_tokens += row.output_tokens;
  accumulator.total_cache_creation_tokens += row.cache_creation_input_tokens;
  accumulator.total_cache_read_tokens += row.cache_read_input_tokens;
  accumulator.total_cached_input_tokens += row.cached_input_tokens;
  accumulator.total_reasoning_output_tokens += row.reasoning_output_tokens;
  accumulator.total_tokens += row.total_tokens;
  accumulator.last_seen_at = Math.max(accumulator.last_seen_at, row.created_at);

  if (model) {
    const cost = calculateCost({
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_creation_input_tokens: row.cache_creation_input_tokens,
      cache_read_input_tokens: row.cache_read_input_tokens,
      cached_input_tokens: row.cached_input_tokens,
    }, model, row.upstream_type);

    accumulator.total_cost += cost.total_cost;
    accumulator.total_input_cost += cost.input_cost;
    accumulator.total_output_cost += cost.output_cost;
    accumulator.total_cache_read_cost += cost.cache_read_cost;
    accumulator.total_cache_write_cost += cost.cache_write_cost;
  }

  const firstChunkLatency = row.first_chunk_at == null ? null : row.first_chunk_at - row.created_at;
  const firstTokenLatency = row.first_token_at == null ? null : row.first_token_at - row.created_at;
  const duration = row.completed_at == null ? null : row.completed_at - row.created_at;
  const generation = row.completed_at == null || row.first_token_at == null
    ? null
    : row.completed_at - row.first_token_at;

  addLatencySample('first_chunk_latency_total', 'first_chunk_latency_count', firstChunkLatency, accumulator);
  addLatencySample('first_token_latency_total', 'first_token_latency_count', firstTokenLatency, accumulator);
  addLatencySample('duration_total', 'duration_count', duration, accumulator);
  addLatencySample('generation_total', 'generation_count', generation, accumulator);
}

function usageAccumulatorToOverview(accumulator: UsageAccumulator): ConsoleOverview {
  return {
    total: accumulator.requests,
    cache_hits: accumulator.cache_hits,
    cache_creates: accumulator.cache_creates,
    cache_misses: Math.max(0, accumulator.requests - accumulator.cache_hits - accumulator.cache_creates),
    errors: accumulator.errors,
    failovers: 0,
    hit_rate: accumulator.requests > 0 ? Number(((accumulator.cache_hits / accumulator.requests) * 100).toFixed(1)) : 0,
    total_input_tokens: accumulator.total_input_tokens,
    total_output_tokens: accumulator.total_output_tokens,
    total_cache_creation_tokens: accumulator.total_cache_creation_tokens,
    total_cache_read_tokens: accumulator.total_cache_read_tokens,
    total_cached_input_tokens: accumulator.total_cached_input_tokens,
    total_reasoning_output_tokens: accumulator.total_reasoning_output_tokens,
    total_tokens: accumulator.total_tokens,
    total_cost: accumulator.total_cost,
    total_input_cost: accumulator.total_input_cost,
    total_output_cost: accumulator.total_output_cost,
    total_cache_read_cost: accumulator.total_cache_read_cost,
    total_cache_write_cost: accumulator.total_cache_write_cost,
    avg_first_chunk_ms: roundAverage(accumulator.first_chunk_latency_total, accumulator.first_chunk_latency_count),
    avg_first_token_ms: roundAverage(accumulator.first_token_latency_total, accumulator.first_token_latency_count),
    avg_duration_ms: roundAverage(accumulator.duration_total, accumulator.duration_count),
    avg_generation_ms: roundAverage(accumulator.generation_total, accumulator.generation_count),
    storage_backend: 'postgresql',
    retention_max_records: MAX_DEBUG_RECORDS,
  };
}

function usageAccumulatorToBucket(key: string, label: string, accumulator: UsageAccumulator): ConsoleStatsBucket {
  return {
    key,
    label,
    requests: accumulator.requests,
    errors: accumulator.errors,
    cache_hits: accumulator.cache_hits,
    cache_creates: accumulator.cache_creates,
    total_input_tokens: accumulator.total_input_tokens,
    total_output_tokens: accumulator.total_output_tokens,
    total_cache_creation_tokens: accumulator.total_cache_creation_tokens,
    total_cache_read_tokens: accumulator.total_cache_read_tokens,
    total_cached_input_tokens: accumulator.total_cached_input_tokens,
    total_reasoning_output_tokens: accumulator.total_reasoning_output_tokens,
    total_tokens: accumulator.total_tokens,
    total_cost: accumulator.total_cost,
    avg_first_chunk_ms: roundAverage(accumulator.first_chunk_latency_total, accumulator.first_chunk_latency_count),
    avg_first_token_ms: roundAverage(accumulator.first_token_latency_total, accumulator.first_token_latency_count),
    avg_duration_ms: roundAverage(accumulator.duration_total, accumulator.duration_count),
    last_seen_at: accumulator.last_seen_at,
  };
}

function sortUsageBuckets(buckets: ConsoleStatsBucket[]): ConsoleStatsBucket[] {
  return buckets
    .sort((left, right) => {
      if (left.requests !== right.requests) {
        return right.requests - left.requests;
      }
      return right.last_seen_at - left.last_seen_at;
    })
    .slice(0, 20);
}

function getUsageTimeBucketSizeMs(filters?: ConsoleQueryFilters): number {
  if (filters?.created_after == null) return 24 * 60 * 60 * 1000;

  const rangeMs = Math.max(Date.now() - filters.created_after, 0);
  if (rangeMs <= 2 * 60 * 60 * 1000) return 5 * 60 * 1000;
  if (rangeMs <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000;
  if (rangeMs <= 3 * 24 * 60 * 60 * 1000) return 6 * 60 * 60 * 1000;
  if (rangeMs <= 14 * 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function floorToUsageBucket(timestamp: number, bucketSizeMs: number): number {
  return Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;
}

function formatUsageBucketLabel(bucketStart: number, bucketSizeMs: number): string {
  const date = new Date(bucketStart);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');

  if (bucketSizeMs < 24 * 60 * 60 * 1000) {
    return `${month}-${day} ${hour}:${minute}`;
  }

  return `${month}-${day}`;
}

async function listUsageRows(filters?: ConsoleQueryFilters): Promise<ConsoleUsageRow[]> {
  await consoleStoreReady;

  const rows = await db.select({
    request_id: consoleRequests.requestId,
    created_at: consoleRequests.createdAt,
    route_prefix: consoleRequests.routePrefix,
    request_model: consoleRequests.requestModel,
    response_model: consoleRequests.responseModel,
    source_request_type: consoleRequests.sourceRequestType,
    upstream_type: consoleRequests.upstreamType,
    api_key_name: consoleRequests.apiKeyName,
    response_status: consoleRequests.responseStatus,
    input_tokens: consoleRequests.inputTokens,
    output_tokens: consoleRequests.outputTokens,
    total_tokens: consoleRequests.totalTokens,
    cache_creation_input_tokens: consoleRequests.cacheCreationInputTokens,
    cache_read_input_tokens: consoleRequests.cacheReadInputTokens,
    cached_input_tokens: consoleRequests.cachedInputTokens,
    reasoning_output_tokens: consoleRequests.reasoningOutputTokens,
    first_chunk_at: consoleRequests.firstChunkAt,
    first_token_at: consoleRequests.firstTokenAt,
    completed_at: consoleRequests.completedAt,
    failover_from: consoleRequests.failoverFrom,
  }).from(consoleRequests)
    .where(buildRequestWhere(filters));

  return rows.map((row) => ({
    request_id: String(row.request_id),
    created_at: normalizeNumber(row.created_at),
    route_prefix: String(row.route_prefix),
    request_model: String(row.request_model),
    response_model: row.response_model ? String(row.response_model) : null,
    source_request_type: row.source_request_type ?? 'unknown',
    original_payload: null,
    original_headers_json: null,
    api_key_name: row.api_key_name ?? null,
    upstream_type: row.upstream_type === 'openai' ? 'openai' : 'anthropic',
    response_status: normalizeNullableNumber(row.response_status),
    input_tokens: normalizeNumber(row.input_tokens),
    output_tokens: normalizeNumber(row.output_tokens),
    total_tokens: normalizeNumber(row.total_tokens),
    cache_creation_input_tokens: normalizeNumber(row.cache_creation_input_tokens),
    cache_read_input_tokens: normalizeNumber(row.cache_read_input_tokens),
    cached_input_tokens: normalizeNumber(row.cached_input_tokens),
    reasoning_output_tokens: normalizeNumber(row.reasoning_output_tokens),
    first_chunk_at: normalizeNullableNumber(row.first_chunk_at),
    first_token_at: normalizeNullableNumber(row.first_token_at),
    completed_at: normalizeNullableNumber(row.completed_at),
    failover_from: row.failover_from ?? null,
  }));
}

async function buildUsageStats(filters?: ConsoleQueryFilters): Promise<ConsoleUsageStatsPayload> {
  const rows = await listUsageRows(filters);

  const overviewAccumulator = createUsageAccumulator();
  const routeMap = new Map<string, UsageAccumulator>();
  const modelMap = new Map<string, UsageAccumulator>();
  const clientMap = new Map<string, UsageAccumulator>();
  const routeOptions = new Map<string, string>();
  const modelOptions = new Map<string, string>();
  const clientOptions = new Set<string>();
  const bucketSizeMs = getUsageTimeBucketSizeMs(filters);
  const timeSeriesMap = new Map<number, { requests: number; total_tokens: number; total_cost: number; errors: number }>();
  let failovers = 0;

  for (const row of rows) {
    const clientBucketKey = getClientBucketKey(row);
    const model = getEffectiveModel(row);

    routeOptions.set(row.route_prefix, row.route_prefix);
    modelOptions.set(model, model);
    clientOptions.add(clientBucketKey);

    if (!matchesUsageFilters(row, clientBucketKey, filters)) {
      continue;
    }

    if (row.failover_from) {
      failovers += 1;
    }

    updateUsageAccumulator(overviewAccumulator, row, model);

    const routeAccumulator = routeMap.get(row.route_prefix) ?? createUsageAccumulator();
    updateUsageAccumulator(routeAccumulator, row, model);
    routeMap.set(row.route_prefix, routeAccumulator);

    const modelAccumulator = modelMap.get(model) ?? createUsageAccumulator();
    updateUsageAccumulator(modelAccumulator, row, model);
    modelMap.set(model, modelAccumulator);

    const clientAccumulator = clientMap.get(clientBucketKey) ?? createUsageAccumulator();
    updateUsageAccumulator(clientAccumulator, row, model);
    clientMap.set(clientBucketKey, clientAccumulator);

    const bucketStart = floorToUsageBucket(row.created_at, bucketSizeMs);
    const point = timeSeriesMap.get(bucketStart) ?? { requests: 0, total_tokens: 0, total_cost: 0, errors: 0 };
    point.requests += 1;
    point.total_tokens += row.total_tokens;
    if (row.response_status != null && row.response_status >= 400) {
      point.errors += 1;
    }
    if (model) {
      const cost = calculateCost({
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_creation_input_tokens: row.cache_creation_input_tokens,
        cache_read_input_tokens: row.cache_read_input_tokens,
        cached_input_tokens: row.cached_input_tokens,
      }, model, row.upstream_type);
      point.total_cost += cost.total_cost;
    }
    timeSeriesMap.set(bucketStart, point);
  }

  const overview = usageAccumulatorToOverview(overviewAccumulator);
  overview.failovers = failovers;

  return {
    overview,
    stats: {
      routes: sortUsageBuckets(Array.from(routeMap.entries()).map(([key, accumulator]) => usageAccumulatorToBucket(key, key, accumulator))),
      models: sortUsageBuckets(Array.from(modelMap.entries()).map(([key, accumulator]) => usageAccumulatorToBucket(key, key, accumulator))),
      clients: sortUsageBuckets(Array.from(clientMap.entries()).map(([key, accumulator]) => usageAccumulatorToBucket(key, getClientLabel(key), accumulator))),
    },
    filters: {
      routes: Array.from(routeOptions.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      models: Array.from(modelOptions.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      clients: Array.from(clientOptions)
        .sort((left, right) => getClientLabel(left).localeCompare(getClientLabel(right), 'zh-CN'))
        .map((value) => ({ value, label: getClientLabel(value) })),
    },
    timeseries: Array.from(timeSeriesMap.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([bucket_start, point]) => ({
        bucket_start,
        bucket_label: formatUsageBucketLabel(bucket_start, bucketSizeMs),
        requests: point.requests,
        total_tokens: point.total_tokens,
        total_cost: point.total_cost,
        errors: point.errors,
      })),
  };
}

function buildRequestWhere(filters?: ConsoleQueryFilters, options?: { requireCompletedResponse?: boolean }): SQL | undefined {
  const conditions: SQL[] = [];

  if (options?.requireCompletedResponse) {
    conditions.push(isNotNull(consoleRequests.responseStatus));
  }
  if (filters?.route) {
    conditions.push(eq(consoleRequests.routePrefix, filters.route));
  }
  if (filters?.model) {
    conditions.push(sql`${getModelBucketExpression()} = ${filters.model}`);
  }
  if (filters?.created_after != null) {
    conditions.push(gte(consoleRequests.createdAt, filters.created_after));
  }

  // 状态筛选
  if (filters?.status === "success") {
    conditions.push(and(isNotNull(consoleRequests.responseStatus), sql`${consoleRequests.responseStatus} >= 200`, sql`${consoleRequests.responseStatus} < 400`));
  } else if (filters?.status === "error") {
    conditions.push(or(isNull(consoleRequests.responseStatus), sql`${consoleRequests.responseStatus} >= 400`));
  }

  // API Key 名称筛选
  if (filters?.api_key_name) {
    if (filters.api_key_name === '__anonymous__') {
      conditions.push(isNull(consoleRequests.apiKeyName));
    } else {
      conditions.push(eq(consoleRequests.apiKeyName, filters.api_key_name));
    }
  }

  // 搜索筛选
  if (filters?.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(or(
      like(consoleRequests.requestId, searchPattern),
      like(consoleRequests.path, searchPattern),
      like(consoleRequests.routePrefix, searchPattern),
      like(consoleRequests.requestModel, searchPattern),
      like(consoleRequests.upstreamType, searchPattern),
    ));
  }

  // 缓存状态筛选
  // hit: 有缓存读取 (cacheReadInputTokens > 0 或 cachedInputTokens > 0)
  // create: 有缓存创建但无读取 (cacheCreationInputTokens > 0 且无缓存读取)
  // miss: 无缓存相关 token
  if (filters?.cache_state === "hit") {
    conditions.push(or(
      sql`${consoleRequests.cacheReadInputTokens} > 0`,
      sql`${consoleRequests.cachedInputTokens} > 0`
    ));
  } else if (filters?.cache_state === "create") {
    conditions.push(and(
      sql`${consoleRequests.cacheCreationInputTokens} > 0`,
      sql`${consoleRequests.cacheReadInputTokens} = 0`,
      sql`${consoleRequests.cachedInputTokens} = 0`
    ));
  } else if (filters?.cache_state === "miss") {
    conditions.push(and(
      sql`${consoleRequests.cacheCreationInputTokens} = 0`,
      sql`${consoleRequests.cacheReadInputTokens} = 0`,
      sql`${consoleRequests.cachedInputTokens} = 0`
    ));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function upsertRequest(data: {
  request_id: string;
  created_at: number;
  route_prefix: string;
  upstream_type: string;
  method: string;
  path: string;
  target_url: string;
  request_model: string;
  original_payload: string | null;
  original_payload_truncated: number;
  original_summary_json: string | null;
  forwarded_payload: string | null;
  forwarded_payload_truncated: number;
  forwarded_summary_json: string | null;
  original_headers_json: string | null;
  forward_headers_json: string | null;
  response_headers_json: string | null;
  failover_from: string | null;
  failover_chain_json: string | null;
  original_route_prefix: string | null;
  original_request_model: string | null;
  failover_reason: string | null;
}) {
  await consoleStoreReady;
  await db.insert(consoleRequests).values({
    requestId: data.request_id,
    createdAt: data.created_at,
    routePrefix: data.route_prefix,
    upstreamType: data.upstream_type,
    method: data.method,
    path: data.path,
    targetUrl: data.target_url,
    requestModel: data.request_model,
    originalPayload: data.original_payload,
    originalPayloadTruncated: data.original_payload_truncated,
    originalSummaryJson: data.original_summary_json,
    forwardedPayload: data.forwarded_payload,
    forwardedPayloadTruncated: data.forwarded_payload_truncated,
    forwardedSummaryJson: data.forwarded_summary_json,
    originalHeadersJson: data.original_headers_json,
    forwardHeadersJson: data.forward_headers_json,
    responseHeadersJson: data.response_headers_json,
    failoverFrom: data.failover_from,
    failoverChainJson: data.failover_chain_json,
    originalRoutePrefix: data.original_route_prefix,
    originalRequestModel: data.original_request_model,
    failoverReason: data.failover_reason,
  }).onConflictDoUpdate({
    target: consoleRequests.requestId,
    set: {
      routePrefix: sql`excluded.route_prefix`,
      upstreamType: sql`excluded.upstream_type`,
      method: sql`excluded.method`,
      path: sql`excluded.path`,
      targetUrl: sql`excluded.target_url`,
      requestModel: sql`excluded.request_model`,
      originalPayload: sql`excluded.original_payload`,
      originalPayloadTruncated: sql`excluded.original_payload_truncated`,
      originalSummaryJson: sql`excluded.original_summary_json`,
      forwardedPayload: sql`excluded.forwarded_payload`,
      forwardedPayloadTruncated: sql`excluded.forwarded_payload_truncated`,
      forwardedSummaryJson: sql`excluded.forwarded_summary_json`,
      originalHeadersJson: sql`excluded.original_headers_json`,
      forwardHeadersJson: sql`excluded.forward_headers_json`,
      responseHeadersJson: sql`excluded.response_headers_json`,
      failoverFrom: sql`excluded.failover_from`,
      failoverChainJson: sql`excluded.failover_chain_json`,
      originalRoutePrefix: sql`COALESCE(console_requests.original_route_prefix, excluded.original_route_prefix)`,
      originalRequestModel: sql`COALESCE(console_requests.original_request_model, excluded.original_request_model)`,
      failoverReason: sql`COALESCE(console_requests.failover_reason, excluded.failover_reason)`,
    },
  });
}

async function updateResponse(data: {
  request_id: string;
  response_status: number;
  response_status_text: string;
  response_headers_json: string | null;
  response_payload: string | null;
  response_payload_truncated: number;
  response_body_bytes: number;
  first_chunk_at: number | null;
  first_token_at: number | null;
  completed_at: number | null;
  has_streaming_content: number;
  response_model: string | null;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}) {
  await consoleStoreReady;
  await db.update(consoleRequests)
    .set({
      responseStatus: data.response_status,
      responseStatusText: data.response_status_text,
      responseHeadersJson: data.response_headers_json,
      responsePayload: data.response_payload,
      responsePayloadTruncated: data.response_payload_truncated,
      responseBodyBytes: data.response_body_bytes,
      firstChunkAt: data.first_chunk_at,
      firstTokenAt: data.first_token_at,
      completedAt: data.completed_at,
      hasStreamingContent: data.has_streaming_content,
      responseModel: data.response_model,
      stopReason: data.stop_reason,
      inputTokens: data.input_tokens,
      outputTokens: data.output_tokens,
      totalTokens: data.total_tokens,
      cacheCreationInputTokens: data.cache_creation_input_tokens,
      cacheReadInputTokens: data.cache_read_input_tokens,
      cachedInputTokens: data.cached_input_tokens,
      reasoningOutputTokens: data.reasoning_output_tokens,
      ephemeral5mInputTokens: data.ephemeral_5m_input_tokens,
      ephemeral1hInputTokens: data.ephemeral_1h_input_tokens,
    })
    .where(eq(consoleRequests.requestId, data.request_id));
}

async function findRequest(request_id: string): Promise<ConsoleRequestRow | null> {
  await consoleStoreReady;
  const rows = await db.select().from(consoleRequests).where(eq(consoleRequests.requestId, request_id));
  return rows[0] ? toCamelCaseRow(rows[0]) : null;
}

function serializeJson(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function toCamelCaseRow(row: typeof consoleRequests.$inferSelect): ConsoleRequestRow {
  return {
    request_id: row.requestId,
    created_at: row.createdAt,
    route_prefix: row.routePrefix,
    upstream_type: row.upstreamType,
    method: row.method,
    path: row.path,
    target_url: row.targetUrl,
    request_model: row.requestModel,
    api_key_id: row.apiKeyId,
    api_key_name: row.apiKeyName,
    original_payload: row.originalPayload,
    original_payload_truncated: row.originalPayloadTruncated,
    original_summary_json: row.originalSummaryJson,
    forwarded_payload: row.forwardedPayload,
    forwarded_payload_truncated: row.forwardedPayloadTruncated,
    forwarded_summary_json: row.forwardedSummaryJson,
    original_headers_json: row.originalHeadersJson,
    forward_headers_json: row.forwardHeadersJson,
    response_headers_json: row.responseHeadersJson,
    response_status: row.responseStatus,
    response_status_text: row.responseStatusText,
    response_payload: row.responsePayload,
    response_payload_truncated: row.responsePayloadTruncated,
    response_payload_truncation_reason: row.responsePayloadTruncationReason,
    response_body_bytes: row.responseBodyBytes,
    first_chunk_at: row.firstChunkAt,
    first_token_at: row.firstTokenAt,
    completed_at: row.completedAt,
    has_streaming_content: row.hasStreamingContent,
    response_model: row.responseModel,
    stop_reason: row.stopReason,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    total_tokens: row.totalTokens,
    cache_creation_input_tokens: row.cacheCreationInputTokens,
    cache_read_input_tokens: row.cacheReadInputTokens,
    cached_input_tokens: row.cachedInputTokens,
    reasoning_output_tokens: row.reasoningOutputTokens,
    ephemeral_5m_input_tokens: row.ephemeral5mInputTokens,
    ephemeral_1h_input_tokens: row.ephemeral1hInputTokens,
    token_usage_estimated: row.tokenUsageEstimated,
    failover_from: row.failoverFrom,
    failover_chain_json: row.failoverChainJson,
    original_route_prefix: row.originalRoutePrefix,
    original_request_model: row.originalRequestModel,
    failover_reason: row.failoverReason,
  };
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function roundNullableNumber(value: number | null | undefined): number | null {
  const normalized = normalizeNullableNumber(value);
  if (normalized == null) return null;
  return Math.round(normalized * 10) / 10;
}

function toTiming(row: Pick<ConsoleRequestRow, 'created_at' | 'response_body_bytes' | 'first_chunk_at' | 'first_token_at' | 'completed_at' | 'has_streaming_content'>): ResponseTimingForConsole {
  const createdAt = normalizeNumber(row.created_at);
  const firstChunkAt = normalizeNullableNumber(row.first_chunk_at);
  const firstTokenAt = normalizeNullableNumber(row.first_token_at);
  const completedAt = normalizeNullableNumber(row.completed_at);

  return {
    response_body_bytes: normalizeNumber(row.response_body_bytes),
    first_chunk_at: firstChunkAt,
    first_token_at: firstTokenAt,
    completed_at: completedAt,
    has_streaming_content: normalizeNumber(row.has_streaming_content) > 0,
    first_chunk_latency_ms: firstChunkAt == null ? null : Math.max(0, firstChunkAt - createdAt),
    first_token_latency_ms: firstTokenAt == null ? null : Math.max(0, firstTokenAt - createdAt),
    duration_ms: completedAt == null ? null : Math.max(0, completedAt - createdAt),
    generation_duration_ms: completedAt == null || firstTokenAt == null ? null : Math.max(0, completedAt - firstTokenAt),
  };
}

function toUsage(row: Pick<ConsoleRequestRow,
  'response_model'
  | 'stop_reason'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'cache_creation_input_tokens'
  | 'cache_read_input_tokens'
  | 'cached_input_tokens'
  | 'reasoning_output_tokens'
  | 'ephemeral_5m_input_tokens'
  | 'ephemeral_1h_input_tokens'
  | 'token_usage_estimated'
>): ResponseUsageForConsole {
  return {
    model: row.response_model ?? '',
    stop_reason: row.stop_reason ?? '',
    input_tokens: normalizeNumber(row.input_tokens),
    output_tokens: normalizeNumber(row.output_tokens),
    total_tokens: normalizeNumber(row.total_tokens),
    cache_creation_input_tokens: normalizeNumber(row.cache_creation_input_tokens),
    cache_read_input_tokens: normalizeNumber(row.cache_read_input_tokens),
    cached_input_tokens: normalizeNumber(row.cached_input_tokens),
    reasoning_output_tokens: normalizeNumber(row.reasoning_output_tokens),
    ephemeral_5m_input_tokens: normalizeNumber(row.ephemeral_5m_input_tokens),
    ephemeral_1h_input_tokens: normalizeNumber(row.ephemeral_1h_input_tokens),
    estimated: normalizeNumber(row.token_usage_estimated) > 0,
  };
}

function withCalculatedUsage(
  requestModel: string,
  responseUsage: ResponseUsageForConsole,
  upstreamType: UpstreamTypeForConsole,
): ResponseUsageForConsole {
  const model = responseUsage.model || requestModel;
  const pricing = getModelPricing(model);
  const cost = calculateCost(responseUsage, model, upstreamType);

  return {
    ...responseUsage,
    uncached_input_tokens: cost.uncached_input_tokens,
    cost: cost.total_cost,
    cost_breakdown: cost,
    cost_pricing: pricing ?? undefined,
  };
}

function getListCacheState(record: {
  upstream_type: UpstreamTypeForConsole;
  response_usage: ResponseUsageForConsole;
}): CacheAnalysisResult['cache_state'] {
  if (record.upstream_type === 'openai') {
    if (record.response_usage.cached_input_tokens > 0) return 'hit';
    return 'miss';
  }

  if (record.response_usage.cache_read_input_tokens > 0) return 'hit';
  if (record.response_usage.cache_creation_input_tokens > 0) return 'create';
  return 'miss';
}

function buildListAnalysis(record: {
  upstream_type: UpstreamTypeForConsole;
  response_usage: ResponseUsageForConsole;
}): CacheAnalysisResult {
  const cacheState = getListCacheState(record);

  return {
    cache_state: cacheState,
    summary: cacheState === 'hit' ? '已读取缓存' : cacheState === 'create' ? '本次创建缓存' : '未命中缓存',
  };
}

function getRequestClientLabel(apiKeyName: string | null | undefined, _sourceRequestType: DetectedRequestKind): string {
  if (apiKeyName && apiKeyName.trim()) return apiKeyName.trim();
  return '匿名';
}

/** Strip verbose message_roles array from list responses (keep for detail) */
function stripMessageRoles(summary: PayloadSummaryForConsole | null): PayloadSummaryForConsole | null {
  if (!summary) return null;
  const { message_roles: _, ...rest } = summary;
  return rest;
}

function mapListRow(row: ConsoleRequestListRow): ConsoleRequestListItem {
  const upstreamType = row.upstream_type === 'openai' ? 'openai' : 'anthropic';
  const responseUsage = withCalculatedUsage(row.request_model, toUsage(row), upstreamType);
  const sourceRequestType = ((row as any).source_request_type ?? 'unknown') as DetectedRequestKind;

  return {
    request_id: row.request_id,
    created_at: normalizeNumber(row.created_at),
    route_prefix: row.route_prefix,
    upstream_type: upstreamType,
    source_request_type: sourceRequestType,
    client_label: getRequestClientLabel(row.api_key_name, sourceRequestType),
    api_key_id: row.api_key_id ?? null,
    api_key_name: row.api_key_name ?? null,
    path: row.path,
    target_url: row.target_url,
    request_model: row.request_model,
    response_status: normalizeNullableNumber(row.response_status),
    response_status_text: row.response_status_text ?? '',
    response_payload_truncated: normalizeNumber(row.response_payload_truncated) > 0,
    response_payload_truncation_reason: row.response_payload_truncation_reason ?? null,
    response_timing: toTiming(row),
    response_usage: responseUsage,
    forwarded_summary: stripMessageRoles(parseJson<PayloadSummaryForConsole>(row.forwarded_summary_json)),
    analysis: buildListAnalysis({
      upstream_type: upstreamType,
      response_usage: responseUsage,
    }),
    failover_from: row.failover_from ?? null,
    failover_chain: parseJson<string[]>(row.failover_chain_json) ?? [],
    original_route_prefix: row.original_route_prefix ?? null,
    original_request_model: row.original_request_model ?? null,
    failover_reason: row.failover_reason ?? null,
  };
}

async function mapRow(row: ConsoleRequestRow): Promise<StoredConsoleRequest> {
  const requestId = row.request_id;
  const upstreamType = row.upstream_type === 'openai' ? 'openai' : 'anthropic';
  const responseUsage = withCalculatedUsage(row.request_model, toUsage(row), upstreamType);

  return {
    request_id: requestId,
    created_at: normalizeNumber(row.created_at),
    route_prefix: row.route_prefix,
    upstream_type: upstreamType,
    method: row.method,
    path: row.path,
    target_url: row.target_url,
    request_model: row.request_model,
    original_payload: row.original_payload,
    original_payload_truncated: normalizeNumber(row.original_payload_truncated) > 0,
    original_summary: parseJson<PayloadSummaryForConsole>(row.original_summary_json),
    forwarded_payload: row.forwarded_payload,
    forwarded_payload_truncated: normalizeNumber(row.forwarded_payload_truncated) > 0,
    forwarded_summary: parseJson<PayloadSummaryForConsole>(row.forwarded_summary_json),
    original_headers: parseJson<Record<string, string>>(row.original_headers_json),
    forward_headers: parseJson<ForwardHeadersSummary>(row.forward_headers_json),
    response_headers: parseJson<Record<string, string>>(row.response_headers_json),
    response_status: normalizeNullableNumber(row.response_status),
    response_status_text: row.response_status_text ?? '',
    response_payload: row.response_payload,
    response_payload_truncated: normalizeNumber(row.response_payload_truncated) > 0,
    response_payload_truncation_reason: row.response_payload_truncation_reason ?? null,
    response_timing: toTiming(row),
    response_usage: responseUsage,
    failover_from: row.failover_from ?? null,
    failover_chain: parseJson<string[]>(row.failover_chain_json) ?? [],
    original_route_prefix: row.original_route_prefix ?? null,
    original_request_model: row.original_request_model ?? null,
    failover_reason: row.failover_reason ?? null,
  };
}

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;
let cleanupRunning = false;

async function cleanupOldRows(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS || cleanupRunning) return;

  cleanupRunning = true;
  try {
    const retainedRequestIds = db.select({ requestId: consoleRequests.requestId })
      .from(consoleRequests)
      .orderBy(desc(consoleRequests.createdAt))
      .limit(MAX_DEBUG_RECORDS);

    await db.delete(consoleRequests)
      .where(notInArray(consoleRequests.requestId, retainedRequestIds));
    lastCleanupAt = Date.now();
  } finally {
    cleanupRunning = false;
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function normalizeOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

export async function saveConsoleRequest(record: ConsoleRequestSnapshotInput): Promise<void> {
  try {
    const totalStart = nowPerfMs();
    const phaseDurations: Record<string, number> = {};
    const upstreamType = record.upstream_type ?? 'anthropic';
    const sourceRequestType = (
      record.source_request_type && record.source_request_type !== 'unknown'
        ? record.source_request_type
        : detectRequestKindForProvider(
          record.original_payload,
          upstreamType,
          record.original_headers ? new Headers(record.original_headers) : undefined,
        )
    ) as DetectedRequestKind;

    const txStart = nowPerfMs();
    await db.insert(consoleRequests).values({
      requestId: record.request_id,
      createdAt: record.created_at,
      routePrefix: record.route_prefix,
      upstreamType,
      method: record.method,
      path: record.path,
      targetUrl: record.target_url,
      requestModel: record.request_model,
      apiKeyId: record.api_key_id ?? null,
      apiKeyName: record.api_key_name ?? null,
      originalPayload: record.original_payload,
      originalPayloadTruncated: record.original_payload_truncated ? 1 : 0,
      originalSummaryJson: serializeJson(record.original_summary),
      forwardedPayload: record.forwarded_payload,
      forwardedPayloadTruncated: record.forwarded_payload_truncated ? 1 : 0,
      forwardedSummaryJson: serializeJson(record.forwarded_summary),
      originalHeadersJson: serializeJson(record.original_headers),
      forwardHeadersJson: serializeJson(record.forward_headers),
      responseHeadersJson: null,
      failoverFrom: record.failover_from ?? null,
      failoverChainJson: serializeJson(record.failover_chain.length > 0 ? record.failover_chain : null),
      originalRoutePrefix: record.original_route_prefix ?? null,
      originalRequestModel: record.original_request_model ?? null,
      failoverReason: record.failover_reason ?? null,
      sourceRequestType,
    }).onConflictDoUpdate({
      target: consoleRequests.requestId,
      set: {
        routePrefix: record.route_prefix,
        upstreamType,
        method: record.method,
        path: record.path,
        targetUrl: record.target_url,
        requestModel: record.request_model,
        originalPayload: record.original_payload,
        originalPayloadTruncated: record.original_payload_truncated ? 1 : 0,
        originalSummaryJson: serializeJson(record.original_summary),
        forwardedPayload: record.forwarded_payload,
        forwardedPayloadTruncated: record.forwarded_payload_truncated ? 1 : 0,
        forwardedSummaryJson: serializeJson(record.forwarded_summary),
        originalHeadersJson: serializeJson(record.original_headers),
        forwardHeadersJson: serializeJson(record.forward_headers),
        failoverFrom: record.failover_from ?? null,
        failoverChainJson: serializeJson(record.failover_chain.length > 0 ? record.failover_chain : null),
        originalRoutePrefix: record.original_route_prefix ?? null,
        originalRequestModel: record.original_request_model ?? null,
        failoverReason: record.failover_reason ?? null,
        sourceRequestType,
      },
    });
    phaseDurations.db_tx_ms = elapsedPerfMs(txStart);

    const cleanupStart = nowPerfMs();
    await cleanupOldRows();
    phaseDurations.cleanup_ms = elapsedPerfMs(cleanupStart);

    const totalMs = elapsedPerfMs(totalStart);
    const slowestPhase = getMaxPerfPhase(phaseDurations);
    recordBackgroundPerfSample({
      kind: 'save_console_request',
      request_id: record.request_id,
      total_ms: totalMs,
    });
    if (shouldLogBackgroundPerf(totalMs)) {
      console.log(`[PERF_BG] save_console_request | request_id=${record.request_id} | total=${totalMs}ms`);
    }
  } catch (error) {
    console.warn('[CONSOLE_DB_WRITE_ERR]', { phase: 'request', request_id: record.request_id, error });
  }
}

export async function saveConsoleResponse(record: ConsoleResponseSnapshotInput): Promise<void> {
  try {
    const totalStart = nowPerfMs();
    const timing = record.response_timing ?? {};

    const txStart = nowPerfMs();
    await db.update(consoleRequests)
      .set({
        responseStatus: record.response_status,
        responseStatusText: record.response_status_text,
        responseHeadersJson: serializeJson(record.response_headers ?? null),
        responsePayload: record.response_payload,
        responsePayloadTruncated: record.response_payload_truncated ? 1 : 0,
        responsePayloadTruncationReason: record.response_payload_truncation_reason ?? null,
        responseBodyBytes: timing.response_body_bytes ?? 0,
        firstChunkAt: timing.first_chunk_at ?? null,
        firstTokenAt: timing.first_token_at ?? null,
        completedAt: timing.completed_at ?? null,
        hasStreamingContent: timing.has_streaming_content ? 1 : 0,
        responseModel: record.response_usage.model,
        stopReason: record.response_usage.stop_reason,
        inputTokens: record.response_usage.input_tokens,
        outputTokens: record.response_usage.output_tokens,
        totalTokens: record.response_usage.total_tokens,
        cacheCreationInputTokens: record.response_usage.cache_creation_input_tokens,
        cacheReadInputTokens: record.response_usage.cache_read_input_tokens,
        cachedInputTokens: record.response_usage.cached_input_tokens,
        reasoningOutputTokens: record.response_usage.reasoning_output_tokens,
        ephemeral5mInputTokens: record.response_usage.ephemeral_5m_input_tokens,
        ephemeral1hInputTokens: record.response_usage.ephemeral_1h_input_tokens,
        tokenUsageEstimated: record.response_usage.estimated ? 1 : 0,
      })
      .where(eq(consoleRequests.requestId, record.request_id));
    const dbTxMs = elapsedPerfMs(txStart);
    const totalMs = elapsedPerfMs(totalStart);

    recordBackgroundPerfSample({
      kind: 'save_console_response',
      request_id: record.request_id,
      total_ms: totalMs,
    });
    if (shouldLogBackgroundPerf(totalMs)) {
      console.log(`[PERF_BG] save_console_response | request_id=${record.request_id} | total=${totalMs}ms`);
    }
  } catch (error) {
    console.warn('[CONSOLE_DB_WRITE_ERR]', { phase: 'response', request_id: record.request_id, error });
  }
}

export type RequestSortKey = 'created_at' | 'response_status' | 'tokens';
export type SortDirection = 'asc' | 'desc';

export async function listConsoleRequests(
  limit = 50,
  offset = 0,
  filters?: ConsoleQueryFilters,
  sortBy: RequestSortKey = 'created_at',
  sortOrder: SortDirection = 'desc',
): Promise<{ requests: ConsoleRequestListItem[]; total: number }> {
  const safeLimit = normalizeLimit(limit);
  const safeOffset = normalizeOffset(offset);

  // 构建排序
  const orderByColumn = (() => {
    switch (sortBy) {
      case 'response_status':
        return consoleRequests.responseStatus;
      case 'tokens':
        return consoleRequests.totalTokens;
      case 'created_at':
      default:
        return consoleRequests.createdAt;
    }
  })();

  const orderByExpr = sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

  // 查询数据
  const rows = await db.select({
    request_id: consoleRequests.requestId,
    created_at: consoleRequests.createdAt,
    route_prefix: consoleRequests.routePrefix,
    upstream_type: consoleRequests.upstreamType,
    path: consoleRequests.path,
    target_url: consoleRequests.targetUrl,
    request_model: consoleRequests.requestModel,
    api_key_id: consoleRequests.apiKeyId,
    api_key_name: consoleRequests.apiKeyName,
    source_request_type: consoleRequests.sourceRequestType,
    forwarded_summary_json: consoleRequests.forwardedSummaryJson,
    response_status: consoleRequests.responseStatus,
    response_status_text: consoleRequests.responseStatusText,
    response_payload_truncated: consoleRequests.responsePayloadTruncated,
    response_payload_truncation_reason: consoleRequests.responsePayloadTruncationReason,
    response_body_bytes: consoleRequests.responseBodyBytes,
    first_chunk_at: consoleRequests.firstChunkAt,
    first_token_at: consoleRequests.firstTokenAt,
    completed_at: consoleRequests.completedAt,
    has_streaming_content: consoleRequests.hasStreamingContent,
    response_model: consoleRequests.responseModel,
    stop_reason: consoleRequests.stopReason,
    input_tokens: consoleRequests.inputTokens,
    output_tokens: consoleRequests.outputTokens,
    total_tokens: consoleRequests.totalTokens,
    cache_creation_input_tokens: consoleRequests.cacheCreationInputTokens,
    cache_read_input_tokens: consoleRequests.cacheReadInputTokens,
    cached_input_tokens: consoleRequests.cachedInputTokens,
    reasoning_output_tokens: consoleRequests.reasoningOutputTokens,
    ephemeral_5m_input_tokens: consoleRequests.ephemeral5mInputTokens,
    ephemeral_1h_input_tokens: consoleRequests.ephemeral1hInputTokens,
    token_usage_estimated: consoleRequests.tokenUsageEstimated,
    failover_from: consoleRequests.failoverFrom,
    failover_chain_json: consoleRequests.failoverChainJson,
    original_route_prefix: consoleRequests.originalRoutePrefix,
    original_request_model: consoleRequests.originalRequestModel,
    failover_reason: consoleRequests.failoverReason,
  })
    .from(consoleRequests)
    .where(buildRequestWhere(filters))
    .orderBy(orderByExpr)
    .limit(safeLimit)
    .offset(safeOffset);

  // 查询总数
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(consoleRequests)
    .where(buildRequestWhere(filters));

  const total = Number(countResult[0]?.count) || 0;

  return {
    requests: rows.map((row) => mapListRow(row)),
    total,
  };
}

export async function getConsoleRequest(requestId: string): Promise<ConsoleRequestDetailResult | null> {
  const row = await findRequest(requestId);
  if (!row) return null;

  const record = await mapRow(row);
  const sourceRequestType = detectClientKindFromRow(row);

  return {
    record,
    previous: null,
    analysis: buildListAnalysis({
      upstream_type: record.upstream_type,
      response_usage: record.response_usage,
    }),
    source_request_type: sourceRequestType,
    client_label: getRequestClientLabel((row as any).api_key_name ?? null, sourceRequestType),
    api_key_id: (row as any).api_key_id ?? null,
    api_key_name: (row as any).api_key_name ?? null,
  };
}

export async function getConsoleOverview(filters?: { route?: string; model?: string; client?: DetectedRequestKind; created_after?: number }): Promise<ConsoleOverview> {
  const usage = await buildUsageStats(filters);
  return usage.overview;
}

export async function getConsoleGatewayStats(filters?: { route?: string; model?: string; client?: DetectedRequestKind; created_after?: number }): Promise<ConsoleGatewayStats> {
  const usage = await buildUsageStats(filters);
  return usage.stats;
}

export async function getConsoleUsageStats(filters?: { route?: string; model?: string; client?: string; created_after?: number }): Promise<ConsoleUsageStatsPayload> {
  return buildUsageStats(filters);
}

export async function clearConsoleRequests(): Promise<void> {
  try {
    assertConsoleClearAllowed();
    await db.delete(consoleRequests);
  } catch (error) {
    console.warn('[CONSOLE_DB_CLEAR_ERR]', error);
  }
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'no-data';

export async function getProviderHealthStatuses(): Promise<Record<string, ProviderHealthStatus>> {
  await consoleStoreReady;

  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  const rows = await db.select({
    routePrefix: consoleRequests.routePrefix,
    total: count(),
    success: sql<number>`sum(CASE WHEN ${consoleRequests.responseStatus} >= 200 AND ${consoleRequests.responseStatus} < 400 THEN 1 ELSE 0 END)`,
  })
    .from(consoleRequests)
    .where(gte(consoleRequests.createdAt, oneHourAgo))
    .groupBy(consoleRequests.routePrefix);

  const result: Record<string, ProviderHealthStatus> = {};
  for (const row of rows) {
    const prefix = row.routePrefix;
    if (!prefix) continue;

    const total = Number(row.total);
    const success = Number(row.success);

    if (total === 0) {
      result[prefix] = 'no-data';
    } else if (success === total) {
      result[prefix] = 'healthy';
    } else if (success > 0) {
      result[prefix] = 'degraded';
    } else {
      result[prefix] = 'down';
    }
  }

  return result;
}

export interface ConsoleFilterOptions {
  routes: string[];
  models: string[];
  clients: { value: string; label: string }[];
}

export async function getConsoleFilterOptions(): Promise<ConsoleFilterOptions> {
  await consoleStoreReady;

  // 查询所有不同的 route_prefix
  const routeRows = await db
    .selectDistinct({ route: consoleRequests.routePrefix })
    .from(consoleRequests)
    .orderBy(consoleRequests.routePrefix);

  // 查询所有不同的 request_model (使用 model bucket)
  const modelRows = await db
    .selectDistinct({ model: getModelBucketExpression() })
    .from(consoleRequests)
    .orderBy(getModelBucketExpression());

  // 查询所有不同的 api_key_name（已使用 API Key 的请求）
  const keyNameRows = await db
    .selectDistinct({ apiKeyName: consoleRequests.apiKeyName })
    .from(consoleRequests)
    .where(isNotNull(consoleRequests.apiKeyName))
    .orderBy(consoleRequests.apiKeyName);

  // 检查是否存在匿名（无 API Key）请求
  const anonymousCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(consoleRequests)
    .where(isNull(consoleRequests.apiKeyName));

  const hasAnonymous = Number(anonymousCount[0]?.count) > 0;

  const clients: ConsoleFilterOptions['clients'] = [];
  if (hasAnonymous) {
    clients.push({ value: '__anonymous__', label: '匿名' });
  }
  for (const row of keyNameRows) {
    if (row.apiKeyName) {
      clients.push({ value: row.apiKeyName, label: row.apiKeyName });
    }
  }

  return {
    routes: routeRows.map(row => row.route).filter(Boolean),
    models: modelRows.map(row => row.model).filter(Boolean),
    clients,
  };
}
