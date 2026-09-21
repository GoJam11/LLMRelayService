import { loadCatalogFromDb, saveCatalogToDb, type ModelPricing } from './catalog-db';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let contextCache: Map<string, number> | null = null;
let reasoningCache: Map<string, ModelReasoningInfo> | null = null;
let cacheLoadedAt = 0;
// Shared fetchedAt across context + pricing, set by whoever fetched last
let networkFetchedAt = 0;

export interface ModelReasoningInfo {
  reasoning: boolean;
  levels?: string[];
}

// A shared in-flight promise so model-catalog and pricing share one fetch
let sharedFetchPromise: Promise<{ contextMap: Map<string, number>; pricingMap: Map<string, ModelPricing>; reasoningMap: Map<string, ModelReasoningInfo> } | null> | null = null;

/**
 * models.dev 用同一个裸模型 ID（如 `claude-opus-4-6`）同时挂在 170+ 个 provider 下，
 * 我们的 catalog 只按模型 ID 建索引，所以必须挑一个“最可信”的条目，否则会被最后遍历到的
 * 二级经销商覆盖（它们经常只填 input/output，不填 cache_read/cache_write，导致缓存计费为 0）。
 *
 * 这里按“官方/一方 provider 优先”排序，排在越前面优先级越高；未列出的 provider 优先级为 0。
 */
const FIRST_PARTY_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'mistral',
  'moonshotai',
  'zhipuai',
  'alibaba',
  'cohere',
  'meta',
  'google-vertex',
  'google-vertex-anthropic',
  'amazon-bedrock',
  'azure',
  'azure-cognitive-services',
  'github-copilot',
  'openrouter',
];

const PROVIDER_RANK = new Map<string, number>(
  FIRST_PARTY_PROVIDERS.map((providerId, index) => [providerId, FIRST_PARTY_PROVIDERS.length - index]),
);

interface ModelCandidate {
  providerId: string;
  context?: number;
  cost?: ModelPricing;
  reasoning?: boolean;
  reasoningLevels?: string[];
}

function normalizePrice(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * 解析 models.dev 的 `cost` 对象。价格单位是 USD / 1M tokens。
 * 只有 input + output 都是合法数字才认为这条价格可用；cache_read / cache_write 可选。
 */
function parseModelCost(raw: unknown): ModelPricing | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const cost = raw as Record<string, unknown>;
  const input = normalizePrice(cost.input);
  const output = normalizePrice(cost.output);
  if (input == null || output == null) return undefined;

  const cacheRead = normalizePrice(cost.cache_read);
  const cacheWrite = normalizePrice(cost.cache_write);
  return {
    input,
    output,
    ...(cacheRead != null ? { cache_read: cacheRead } : {}),
    ...(cacheWrite != null ? { cache_write: cacheWrite } : {}),
  };
}

function parseModelContext(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ctx = (raw as Record<string, unknown>).context;
  if (typeof ctx !== 'number' || !Number.isFinite(ctx) || ctx <= 0) return undefined;
  return ctx;
}

function scoreCandidate(candidate: ModelCandidate): number {
  // provider 优先级占最高权重：官方条目即使缺 cache 字段也优先，缺失部分随后由 backfill 补齐。
  let score = (PROVIDER_RANK.get(candidate.providerId) ?? 0) * 100;
  if (candidate.cost) {
    score += 20;
    // 免费/占位渠道（input=output=0）会把真实价格冲掉，排到所有有价格的条目之后。
    if (candidate.cost.input > 0 || candidate.cost.output > 0) score += 20;
    if (candidate.cost.cache_read != null) score += 5;
    if (candidate.cost.cache_write != null) score += 5;
  }
  if (candidate.context != null) score += 1;
  return score;
}

/**
 * 选中的条目若缺 cache_read / cache_write，从“基础价格完全一致”的其他 provider 条目里补齐。
 * 基础价格一致说明是同一档官方定价的转售，缓存价格可以安全复用。
 */
function backfillCachePricing(chosen: ModelPricing, candidates: ModelCandidate[]): ModelPricing {
  if (chosen.cache_read != null && chosen.cache_write != null) return chosen;

  let cacheRead = chosen.cache_read;
  let cacheWrite = chosen.cache_write;
  for (const candidate of candidates) {
    const cost = candidate.cost;
    if (!cost) continue;
    if (cost.input !== chosen.input || cost.output !== chosen.output) continue;
    if (cacheRead == null && cost.cache_read != null) cacheRead = cost.cache_read;
    if (cacheWrite == null && cost.cache_write != null) cacheWrite = cost.cache_write;
    if (cacheRead != null && cacheWrite != null) break;
  }

  if (cacheRead === chosen.cache_read && cacheWrite === chosen.cache_write) return chosen;
  return {
    input: chosen.input,
    output: chosen.output,
    ...(cacheRead != null ? { cache_read: cacheRead } : {}),
    ...(cacheWrite != null ? { cache_write: cacheWrite } : {}),
  };
}

function parseModelReasoning(raw: unknown): { reasoning?: boolean; levels?: string[] } {
  if (!raw || typeof raw !== 'object') return {};
  const m = raw as Record<string, unknown>;
  let reasoning: boolean | undefined = typeof m.reasoning === 'boolean' ? m.reasoning : undefined;
  let levels: string[] | undefined;
  if (Array.isArray(m.reasoning_options)) {
    for (const opt of m.reasoning_options) {
      if (opt && typeof opt === 'object' && (opt as Record<string, unknown>).type === 'effort') {
        const vals = (opt as Record<string, unknown>).values;
        if (Array.isArray(vals)) {
          levels = vals.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
        }
      }
    }
  }
  if (levels && levels.length > 0 && reasoning === undefined) {
    reasoning = true;
  }
  return { reasoning, levels };
}

export function isLikelyReasoningModelId(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  const name = normalized.includes('/') ? normalized.split('/').slice(1).join('/') : normalized;
  return (
    /(^|[-_./])(o1|o3|o4|r1|qwq|qvq)([-_./]|$)/i.test(name) ||
    /thinking/i.test(name) ||
    /reason(er|ing)/i.test(name) ||
    /claude-3[.-]7/i.test(name) ||
    /muse-spark/i.test(name) ||
    /deepseek-(v4|r1)/i.test(name)
  );
}

export function isKnownNonReasoningOpenAiModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  const name = normalized.includes('/') ? normalized.split('/').slice(1).join('/') : normalized;
  if (
    name.startsWith('gpt-4o') ||
    name.startsWith('gpt-4-') ||
    name === 'gpt-4' ||
    name.startsWith('gpt-3.5') ||
    name.startsWith('chatgpt-4o') ||
    name.startsWith('dall-e') ||
    name.startsWith('text-embedding')
  ) {
    return true;
  }
  return false;
}

/**
 * 把 models.dev 的 `{ provider: { models: { modelId: {...} } } }` 结构压平成按模型 ID 索引的
 * context / pricing / reasoning 三张表，同一个模型 ID 出现在多个 provider 时按可信度择优并补齐缓存价格。
 */
export function buildCatalogMapsFromModelsDev(data: unknown): {
  contextMap: Map<string, number>;
  pricingMap: Map<string, ModelPricing>;
  reasoningMap: Map<string, ModelReasoningInfo>;
} {
  const contextMap = new Map<string, number>();
  const pricingMap = new Map<string, ModelPricing>();
  const reasoningMap = new Map<string, ModelReasoningInfo>();
  if (!data || typeof data !== 'object') return { contextMap, pricingMap, reasoningMap };

  const candidates = new Map<string, ModelCandidate[]>();
  for (const [providerId, provider] of Object.entries(data as Record<string, unknown>)) {
    if (!provider || typeof provider !== 'object') continue;
    const models = (provider as Record<string, unknown>).models;
    if (!models || typeof models !== 'object') continue;
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (!model || typeof model !== 'object') continue;
      const m = model as Record<string, unknown>;
      const context = parseModelContext(m.limit);
      const cost = parseModelCost(m.cost);
      const { reasoning, levels } = parseModelReasoning(m);
      if (context == null && cost == null && reasoning === undefined) continue;

      const list = candidates.get(modelId);
      const candidate: ModelCandidate = {
        providerId,
        ...(context != null ? { context } : {}),
        ...(cost != null ? { cost } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(levels != null ? { reasoningLevels: levels } : {}),
      };
      if (list) list.push(candidate);
      else candidates.set(modelId, [candidate]);
    }
  }

  for (const [modelId, list] of candidates) {
    // 稳定排序：分数相同时保持 models.dev 的原始顺序。
    const ranked = list
      .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate) }))
      .sort((left, right) => (right.score - left.score) || (left.index - right.index))
      .map((entry) => entry.candidate);

    const best = ranked[0];
    if (!best) continue;

    const context = best.context ?? ranked.find((candidate) => candidate.context != null)?.context;
    if (context != null) contextMap.set(modelId, context);

    const cost = best.cost ?? ranked.find((candidate) => candidate.cost != null)?.cost;
    if (cost != null) pricingMap.set(modelId, backfillCachePricing(cost, ranked));

    const reasoning = best.reasoning ?? ranked.find((candidate) => candidate.reasoning !== undefined)?.reasoning;
    const levels = best.reasoningLevels ?? ranked.find((candidate) => candidate.reasoningLevels != null)?.reasoningLevels;
    if (reasoning !== undefined || levels != null) {
      reasoningMap.set(modelId, {
        reasoning: reasoning ?? isLikelyReasoningModelId(modelId),
        levels: levels && levels.length > 0 ? levels : (reasoning ? ['low', 'medium', 'high', 'xhigh', 'max'] : undefined),
      });
    }
  }

  return { contextMap, pricingMap, reasoningMap };
}

export async function fetchModelsDevData(): Promise<{ contextMap: Map<string, number>; pricingMap: Map<string, ModelPricing>; reasoningMap: Map<string, ModelReasoningInfo> } | null> {
  if (sharedFetchPromise) return sharedFetchPromise;

  sharedFetchPromise = (async () => {
    try {
      const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`models.dev responded with ${response.status}`);
      const data = await response.json() as unknown;
      return buildCatalogMapsFromModelsDev(data);
    } catch {
      return null;
    } finally {
      sharedFetchPromise = null;
    }
  })();

  return sharedFetchPromise;
}

async function refreshFromNetwork(): Promise<void> {
  const result = await fetchModelsDevData();
  if (!result) {
    if (contextCache === null) contextCache = new Map();
    if (reasoningCache === null) reasoningCache = new Map();
    return;
  }
  const now = Date.now();
  contextCache = result.contextMap;
  reasoningCache = result.reasoningMap;
  cacheLoadedAt = now;
  networkFetchedAt = now;
  // Persist to DB in background (don't await)
  saveCatalogToDb(result.contextMap, result.pricingMap, now).catch(() => {});
}

/**
 * Attempt to warm the in-memory context cache from DB.
 * Returns true if DB had fresh enough data (within TTL).
 */
export async function warmModelCatalogFromDb(): Promise<boolean> {
  const { contextMap, fetchedAt } = await loadCatalogFromDb();
  if (contextMap.size > 0) {
    contextCache = contextMap;
    cacheLoadedAt = fetchedAt;
  }
  return contextMap.size > 0 && Date.now() - fetchedAt < CACHE_TTL_MS;
}

export async function ensureModelCatalogLoaded(): Promise<void> {
  if (contextCache !== null && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return;
  }
  await refreshFromNetwork();
}

/**
 * Returns the context window size from models.dev for the given model ID.
 * Returns undefined if the catalog has not been loaded yet or the model is unknown.
 */
export function lookupModelContext(modelId: string): number | undefined {
  return contextCache?.get(modelId);
}

/**
 * Returns the reasoning capability and supported effort levels for the given model ID.
 * Falls back to name-based heuristics if models.dev catalog does not define it.
 */
export function lookupModelReasoning(modelId: string): ModelReasoningInfo {
  const fromCache = reasoningCache?.get(modelId);
  if (fromCache) return fromCache;
  const isReasoning = isLikelyReasoningModelId(modelId);
  return {
    reasoning: isReasoning,
    levels: isReasoning ? ['low', 'medium', 'high', 'xhigh', 'max'] : undefined,
  };
}
