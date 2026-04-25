/**
 * Shared DB persistence layer for models.dev catalog data.
 * Stores context window and pricing info per model, keyed by modelId.
 */

import { createDbClient } from './db/client';
import { modelCatalogCache } from './db/schema';

export interface ModelPricing {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface CatalogEntry {
  modelId: string;
  contextWindow?: number;
  pricing?: ModelPricing;
  fetchedAt: number;
}

/**
 * Load all catalog entries from DB into memory maps.
 * Returns empty maps if DB is unavailable.
 */
export async function loadCatalogFromDb(): Promise<{
  contextMap: Map<string, number>;
  pricingMap: Map<string, ModelPricing>;
  fetchedAt: number;
}> {
  try {
    const db = createDbClient();
    const rows = await db.select().from(modelCatalogCache);
    const contextMap = new Map<string, number>();
    const pricingMap = new Map<string, ModelPricing>();
    let maxFetchedAt = 0;
    for (const row of rows) {
      if (row.contextWindow != null) {
        contextMap.set(row.modelId, row.contextWindow);
      }
      if (row.pricingJson) {
        try {
          pricingMap.set(row.modelId, JSON.parse(row.pricingJson) as ModelPricing);
        } catch {
          // ignore corrupt entries
        }
      }
      if (row.fetchedAt > maxFetchedAt) maxFetchedAt = row.fetchedAt;
    }
    return { contextMap, pricingMap, fetchedAt: maxFetchedAt };
  } catch (err) {
    console.warn('[catalog-db] Failed to load from DB:', err);
    return { contextMap: new Map(), pricingMap: new Map(), fetchedAt: 0 };
  }
}

/**
 * Persist catalog data to DB using upsert.
 */
export async function saveCatalogToDb(
  contextMap: Map<string, number>,
  pricingMap: Map<string, ModelPricing>,
  fetchedAt: number,
): Promise<void> {
  try {
    // Build combined set of all modelIds
    const allModelIds = new Set([...contextMap.keys(), ...pricingMap.keys()]);
    if (allModelIds.size === 0) return;

    const rows = Array.from(allModelIds).map((modelId) => ({
      modelId,
      contextWindow: contextMap.get(modelId) ?? null,
      pricingJson: pricingMap.has(modelId) ? JSON.stringify(pricingMap.get(modelId)) : null,
      fetchedAt,
    }));

    // Batch upsert in chunks to avoid hitting parameter limits
    const db = createDbClient();
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db
        .insert(modelCatalogCache)
        .values(chunk)
        .onConflictDoUpdate({
          target: modelCatalogCache.modelId,
          set: {
            contextWindow: modelCatalogCache.contextWindow,
            pricingJson: modelCatalogCache.pricingJson,
            fetchedAt: modelCatalogCache.fetchedAt,
          },
        });
    }
    console.log(`[catalog-db] Saved ${allModelIds.size} entries`);
  } catch (err) {
    console.warn('[catalog-db] Failed to save to DB:', err);
  }
}
