import { loadCatalogFromDb, saveCatalogToDb, type ModelPricing } from './catalog-db';
import { fetchModelsDevData } from './model-catalog';

export type { ModelPricing } from './catalog-db';

export type PricingUsageUpstreamType = 'anthropic' | 'openai';

interface PricingUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
}

let pricingCache: Map<string, ModelPricing> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchModelsDevPricing(): Promise<Map<string, ModelPricing>> {
  const now = Date.now();
  if (pricingCache && now - cacheTimestamp < CACHE_TTL) {
    return pricingCache;
  }

  // Try loading from DB first
  if (!pricingCache) {
    const { pricingMap, fetchedAt } = await loadCatalogFromDb();
    if (pricingMap.size > 0 && now - fetchedAt < CACHE_TTL) {
      pricingCache = pricingMap;
      cacheTimestamp = fetchedAt;
      return pricingCache;
    }
  }

  // Fetch from network (shared with model-catalog to avoid double request)
  const result = await fetchModelsDevData();
  if (result) {
    pricingCache = result.pricingMap;
    cacheTimestamp = now;
    // DB persistence is handled by model-catalog side
    saveCatalogToDb(result.contextMap, result.pricingMap, now).catch(() => {});
    console.log(`[pricing] Loaded ${result.pricingMap.size} model prices from Models.dev`);
  }

  return pricingCache || new Map();
}

export function getModelPricing(modelId: string): ModelPricing | null {
  if (!pricingCache) return null;
  return pricingCache.get(modelId) || null;
}

export async function ensurePricingLoaded(): Promise<void> {
  await fetchModelsDevPricing();
}

export function __setPricingCacheForTests(pricing: Map<string, ModelPricing> | null): void {
  pricingCache = pricing;
  cacheTimestamp = Date.now();
}

export function __resetPricingCacheForTests(): void {
  pricingCache = null;
  cacheTimestamp = 0;
}

export interface CostBreakdown {
  upstream_type: PricingUsageUpstreamType;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_write_cost: number;
  total_cost: number;
}

function inferPricingUsageUpstreamType(usage: PricingUsage): PricingUsageUpstreamType {
  if ((usage.cache_creation_input_tokens ?? 0) > 0) return 'anthropic';
  if ((usage.cache_read_input_tokens ?? 0) > 0) return 'anthropic';
  if ((usage.cached_input_tokens ?? 0) > 0) return 'openai';
  return 'anthropic';
}

function getCostTokenBuckets(
  usage: PricingUsage,
  upstreamType?: PricingUsageUpstreamType,
): {
  upstream_type: PricingUsageUpstreamType;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
} {
  const resolvedUpstreamType = upstreamType ?? inferPricingUsageUpstreamType(usage);
  const inputTokens = usage.input_tokens ?? 0;

  if (resolvedUpstreamType === 'openai') {
    const cachedInputTokens = usage.cached_input_tokens ?? 0;
    return {
      upstream_type: resolvedUpstreamType,
      uncached_input_tokens: Math.max(inputTokens - cachedInputTokens, 0),
      cache_read_tokens: cachedInputTokens,
      cache_write_tokens: 0,
    };
  }

  return {
    upstream_type: resolvedUpstreamType,
    uncached_input_tokens: inputTokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function calculateCost(
  usage: PricingUsage,
  modelId: string,
  upstreamType?: PricingUsageUpstreamType,
): CostBreakdown {
  const { upstream_type, uncached_input_tokens, cache_read_tokens, cache_write_tokens } =
    getCostTokenBuckets(usage, upstreamType);
  const outputTokens = usage.output_tokens ?? 0;
  const pricing = getModelPricing(modelId);

  if (!pricing) {
    return {
      upstream_type,
      uncached_input_tokens,
      cache_read_tokens,
      cache_write_tokens,
      input_cost: 0,
      output_cost: 0,
      cache_read_cost: 0,
      cache_write_cost: 0,
      total_cost: 0,
    };
  }

  const inputCost = (uncached_input_tokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cache_read_tokens / 1_000_000) * (pricing.cache_read ?? 0);
  const cacheWriteCost = (cache_write_tokens / 1_000_000) * (pricing.cache_write ?? 0);

  return {
    upstream_type,
    uncached_input_tokens,
    cache_read_tokens,
    cache_write_tokens,
    input_cost: inputCost,
    output_cost: outputCost,
    cache_read_cost: cacheReadCost,
    cache_write_cost: cacheWriteCost,
    total_cost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}


