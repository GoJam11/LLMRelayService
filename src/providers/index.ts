import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import type { RouteAuthConfig } from '../config';
import type { DetectedRequestKind, PreparedRequestResult, ProviderAdapter, ProviderPrepareRequestOptions, UpstreamType, UsageData } from './types';

const providers: Record<UpstreamType, ProviderAdapter> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

export type { DetectedRequestKind, PreparedRequestResult, ProviderAdapter, ProviderPrepareRequestOptions, UpstreamType, UsageData } from './types';

export function getProviderAdapter(upstreamType: UpstreamType): ProviderAdapter {
  return providers[upstreamType];
}

export function buildForwardHeadersForProvider(
  sourceHeaders: Headers,
  upstreamType: UpstreamType,
  auth?: RouteAuthConfig,
): Headers {
  return getProviderAdapter(upstreamType).buildForwardHeaders(sourceHeaders, auth);
}

export function prepareRequestForProvider(options: ProviderPrepareRequestOptions): PreparedRequestResult {
  return getProviderAdapter(options.upstreamType).prepareRequest(options);
}

export function parseUsageForProvider(body: string, upstreamType: UpstreamType): UsageData {
  return getProviderAdapter(upstreamType).parseUsage(body);
}

export function summarizePayloadForProvider(rawPayload: string, upstreamType: UpstreamType) {
  return getProviderAdapter(upstreamType).summarizePayload(rawPayload);
}

export function detectRequestKindForProvider(rawPayload: string | null, upstreamType: UpstreamType, rawHeaders?: Headers): DetectedRequestKind {
  return getProviderAdapter(upstreamType).detectRequestKind(rawPayload, rawHeaders);
}
