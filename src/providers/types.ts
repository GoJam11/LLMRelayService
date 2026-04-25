import type {
  CacheAnalysisResult,
  PayloadSummaryForConsole,
} from '../console-store';
import type { RouteAuthConfig } from '../config';

export type UpstreamType = 'anthropic' | 'openai';
export type DetectedRequestKind = 'generic' | 'unknown';

export interface UsageData {
  model: string;
  stop_reason: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
  estimated?: boolean;
}

export interface PreparedRequestResult {
  requestModel: string;
  body: string | null;
}

export interface ProviderPrepareRequestOptions {
  upstreamType: UpstreamType;
  method: string;
  rawBodyText: string | null;
  rawHeaders: Headers;
  routePrefix?: string;
  routeSystem?: string;
}

export interface ProviderAdapter {
  type: UpstreamType;
  buildForwardHeaders(sourceHeaders: Headers, auth?: RouteAuthConfig): Headers;
  prepareRequest(options: ProviderPrepareRequestOptions): PreparedRequestResult;
  transformResponse(response: Response): Response;
  parseUsage(body: string): UsageData;
  summarizePayload(rawPayload: string): PayloadSummaryForConsole | null;
  detectRequestKind(rawPayload: string | null, rawHeaders?: Headers): DetectedRequestKind;
  buildDebugAnalysis(usage: UsageData): CacheAnalysisResult;
  hasTextualSignal(eventBlock: string): boolean;
}
