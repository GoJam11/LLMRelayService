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
  /** Anthropic 缓存写入按 TTL 分档计费，上游会在 `cache_creation` 里拆出 5m / 1h。 */
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

/**
 * 缓存价格缺失时的兜底比例（相对 input 单价）。
 *
 * models.dev 上很多条目只填了 input/output，没有 cache_read/cache_write；如果直接按 0 计费，
 * 缓存命中率高的会话（cache_read 几万 token、input 只有个位数）算出来的成本会趋近 0。
 * Anthropic 官方定价长期稳定为：cache read = 0.1x input，5m cache write = 1.25x input，
 * 1h cache write = 2x input；OpenAI 的 cached input 同样是 0.1x input，且不额外收缓存写入费。
 */
const ANTHROPIC_CACHE_READ_RATIO = 0.1;
const ANTHROPIC_CACHE_WRITE_5M_RATIO = 1.25;
const ANTHROPIC_CACHE_WRITE_1H_RATIO = 2;
const OPENAI_CACHE_READ_RATIO = 0.1;

export interface EffectiveCachePricing {
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  /** 是否使用了按 input 单价推导的兜底价格（上游没给缓存价）。 */
  derived: boolean;
}

/**
 * 解析出实际用于计费的缓存单价：优先用上游/自定义价格，缺失时按官方比例从 input 单价推导。
 */
export function resolveEffectiveCachePricing(
  pricing: ModelPricing,
  upstreamType: PricingUsageUpstreamType,
): EffectiveCachePricing {
  const readRatio = upstreamType === 'openai' ? OPENAI_CACHE_READ_RATIO : ANTHROPIC_CACHE_READ_RATIO;
  const cacheRead = pricing.cache_read ?? pricing.input * readRatio;

  if (upstreamType === 'openai') {
    // OpenAI 不对缓存写入单独收费，命中前的 prompt 按普通 input 计价。
    const cacheWrite = pricing.cache_write ?? 0;
    return {
      cache_read: cacheRead,
      cache_write_5m: cacheWrite,
      cache_write_1h: cacheWrite,
      derived: pricing.cache_read == null,
    };
  }

  const cacheWrite5m = pricing.cache_write ?? pricing.input * ANTHROPIC_CACHE_WRITE_5M_RATIO;
  // 有 5m 价格时按官方比例换算 1h（2x input / 1.25x input），避免 1h 缓存被低估 1.6 倍。
  const cacheWrite1h = pricing.cache_write != null
    ? pricing.cache_write * (ANTHROPIC_CACHE_WRITE_1H_RATIO / ANTHROPIC_CACHE_WRITE_5M_RATIO)
    : pricing.input * ANTHROPIC_CACHE_WRITE_1H_RATIO;

  return {
    cache_read: cacheRead,
    cache_write_5m: cacheWrite5m,
    cache_write_1h: cacheWrite1h,
    derived: pricing.cache_read == null || pricing.cache_write == null,
  };
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

export function calculateCostWithPricing(
  usage: PricingUsage,
  pricing: ModelPricing | null | undefined,
  upstreamType?: PricingUsageUpstreamType,
): CostBreakdown {
  const {
    upstream_type,
    uncached_input_tokens,
    cache_read_tokens,
    cache_write_tokens,
    cache_write_5m_tokens,
    cache_write_1h_tokens,
  } = getCostTokenBuckets(usage, upstreamType);
  const outputTokens = usage.output_tokens ?? 0;

  if (!pricing) {
    return {
      upstream_type,
      uncached_input_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_write_5m_tokens,
      cache_write_1h_tokens,
      input_cost: 0,
      output_cost: 0,
      cache_read_cost: 0,
      cache_write_cost: 0,
      total_cost: 0,
      cache_read_price: 0,
      cache_write_5m_price: 0,
      cache_write_1h_price: 0,
      cache_pricing_derived: false,
    };
  }

  const cachePricing = resolveEffectiveCachePricing(pricing, upstream_type);
  const inputCost = (uncached_input_tokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cache_read_tokens / 1_000_000) * cachePricing.cache_read;
  const cacheWriteCost = (cache_write_5m_tokens / 1_000_000) * cachePricing.cache_write_5m
    + (cache_write_1h_tokens / 1_000_000) * cachePricing.cache_write_1h;

  return {
    upstream_type,
    uncached_input_tokens,
    cache_read_tokens,
    cache_write_tokens,
    cache_write_5m_tokens,
    cache_write_1h_tokens,
    input_cost: inputCost,
    output_cost: outputCost,
    cache_read_cost: cacheReadCost,
    cache_write_cost: cacheWriteCost,
    total_cost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    cache_read_price: cachePricing.cache_read,
    cache_write_5m_price: cachePricing.cache_write_5m,
    cache_write_1h_price: cachePricing.cache_write_1h,
    cache_pricing_derived: cachePricing.derived,
  };
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
  /** cache_write_tokens 按 TTL 的拆分，未上报拆分时全部计入 5m 档。 */
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_write_cost: number;
  total_cost: number;
  /** 实际用于计费的缓存单价（USD / 1M tokens），可能是上游价格或按 input 推导的兜底价。 */
  cache_read_price: number;
  cache_write_5m_price: number;
  cache_write_1h_price: number;
  /** 缓存单价来自按 input 推导的兜底值，而非上游/自定义价格。 */
  cache_pricing_derived: boolean;
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
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
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
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
    };
  }

  const ephemeral5m = usage.ephemeral_5m_input_tokens ?? 0;
  const ephemeral1h = usage.ephemeral_1h_input_tokens ?? 0;
  // cache_creation_input_tokens 是总量；ephemeral_* 是它的 TTL 拆分。取两者较大值兜底，
  // 避免上游只给拆分不给总量（或反之）时漏计。
  const cacheWriteTokens = Math.max(usage.cache_creation_input_tokens ?? 0, ephemeral5m + ephemeral1h);
  const cacheWrite1hTokens = Math.min(ephemeral1h, cacheWriteTokens);

  return {
    upstream_type: resolvedUpstreamType,
    uncached_input_tokens: inputTokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: cacheWriteTokens,
    // 未上报 TTL 拆分时默认全部按 5m 档计费（Anthropic 默认 ttl 就是 5m）。
    cache_write_5m_tokens: cacheWriteTokens - cacheWrite1hTokens,
    cache_write_1h_tokens: cacheWrite1hTokens,
  };
}

export function calculateCost(
  usage: PricingUsage,
  modelId: string,
  upstreamType?: PricingUsageUpstreamType,
): CostBreakdown {
  return calculateCostWithPricing(usage, getModelPricing(modelId), upstreamType);
}


