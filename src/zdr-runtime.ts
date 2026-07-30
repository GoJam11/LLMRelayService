/**
 * Runtime lookups for ZDR provider/model-group scope levels, with a short
 * TTL cache (mirrors the pattern used by gateway-timeouts.ts /
 * gateway-failover.ts) so the routing hot path only pays for a DB round trip
 * at most once every few seconds.
 *
 * Deliberately independent from config.ts's provider-config cache: this only
 * reads the narrow set of ZDR-related columns and never influences routing
 * beyond the additive filter/redaction steps that consume it.
 */
import { createDbClient, type DbClient } from './db/client';
import { consoleProviders, modelAliases } from './db/schema';
import { parseZdrOverrideColumn, type ZdrOverride } from './zdr-settings';

const CACHE_TTL_MS = 5_000;

let db: DbClient | null = null;
function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

interface ProviderZdrRow {
  channelName: string;
  zdrCapable: boolean;
  noTrainingCapable: boolean;
  zdrOverride: ZdrOverride;
}

let providerCache: Map<string, ProviderZdrRow> | null = null;
let providerCacheAt = 0;

let aliasCache: Map<string, ZdrOverride> | null = null;
let aliasCacheAt = 0;

export function clearZdrRuntimeCache(): void {
  providerCache = null;
  providerCacheAt = 0;
  aliasCache = null;
  aliasCacheAt = 0;
}

async function loadProviderZdrRows(): Promise<Map<string, ProviderZdrRow>> {
  const now = Date.now();
  if (providerCache && now - providerCacheAt < CACHE_TTL_MS) return providerCache;

  const rows = await getDb().select({
    channelName: consoleProviders.channelName,
    zdrCapable: consoleProviders.zdrCapable,
    noTrainingCapable: consoleProviders.noTrainingCapable,
    zdrOverride: consoleProviders.zdrOverride,
  }).from(consoleProviders);

  const map = new Map<string, ProviderZdrRow>();
  for (const row of rows) {
    map.set(row.channelName, {
      channelName: row.channelName,
      zdrCapable: Boolean(row.zdrCapable),
      noTrainingCapable: Boolean(row.noTrainingCapable),
      zdrOverride: parseZdrOverrideColumn(row.zdrOverride),
    });
  }
  providerCache = map;
  providerCacheAt = now;
  return map;
}

async function loadAliasZdrOverrides(): Promise<Map<string, ZdrOverride>> {
  const now = Date.now();
  if (aliasCache && now - aliasCacheAt < CACHE_TTL_MS) return aliasCache;

  const rows = await getDb().select({
    alias: modelAliases.alias,
    zdrOverride: modelAliases.zdrOverride,
  }).from(modelAliases);

  const map = new Map<string, ZdrOverride>();
  for (const row of rows) {
    map.set(row.alias, parseZdrOverrideColumn(row.zdrOverride));
  }
  aliasCache = map;
  aliasCacheAt = now;
  return map;
}

export async function getProviderZdrInfo(channelName: string): Promise<ProviderZdrRow | null> {
  const map = await loadProviderZdrRows();
  return map.get(channelName) ?? null;
}

export async function listAllProviderZdrInfo(): Promise<ProviderZdrRow[]> {
  const map = await loadProviderZdrRows();
  return Array.from(map.values());
}

export async function getModelGroupZdrOverride(modelOrAlias: string): Promise<ZdrOverride> {
  const map = await loadAliasZdrOverrides();
  return map.get(modelOrAlias) ?? null;
}
