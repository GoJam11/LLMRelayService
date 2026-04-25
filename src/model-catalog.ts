import { loadCatalogFromDb, saveCatalogToDb, type ModelPricing } from './catalog-db';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let contextCache: Map<string, number> | null = null;
let cacheLoadedAt = 0;
// Shared fetchedAt across context + pricing, set by whoever fetched last
let networkFetchedAt = 0;

// A shared in-flight promise so model-catalog and pricing share one fetch
let sharedFetchPromise: Promise<{ contextMap: Map<string, number>; pricingMap: Map<string, ModelPricing> } | null> | null = null;

export async function fetchModelsDevData(): Promise<{ contextMap: Map<string, number>; pricingMap: Map<string, ModelPricing> } | null> {
  if (sharedFetchPromise) return sharedFetchPromise;

  sharedFetchPromise = (async () => {
    try {
      const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`models.dev responded with ${response.status}`);
      const data = await response.json() as Record<string, unknown>;

      const contextMap = new Map<string, number>();
      const pricingMap = new Map<string, ModelPricing>();

      for (const provider of Object.values(data)) {
        if (!provider || typeof provider !== 'object') continue;
        const models = (provider as Record<string, unknown>).models;
        if (!models || typeof models !== 'object') continue;
        for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
          if (!model || typeof model !== 'object') continue;
          const m = model as Record<string, unknown>;
          const limit = m.limit;
          if (limit && typeof limit === 'object') {
            const ctx = (limit as Record<string, unknown>).context;
            if (typeof ctx === 'number' && ctx > 0) contextMap.set(modelId, ctx);
          }
          const cost = m.cost;
          if (cost && typeof cost === 'object') {
            pricingMap.set(modelId, cost as ModelPricing);
          }
        }
      }
      return { contextMap, pricingMap };
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
    return;
  }
  const now = Date.now();
  contextCache = result.contextMap;
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

