import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createDbClient } from './db/client';
import { consoleProviders } from './db/schema';

type UpstreamType = 'anthropic' | 'openai';
type RouteAuthHeader = 'x-api-key' | 'authorization';
type RoutingVisibility = 'direct' | 'explicit_only';

interface RouteAuthConfig {
  header: RouteAuthHeader;
  value: string;
}

interface ModelConfig {
  model: string;
  context?: number;
  [key: string]: unknown;
}

interface ConfigEntry {
  type?: UpstreamType;
  targetBaseUrl: string;
  systemPrompt?: string;
  auth?: RouteAuthConfig;
  models?: ModelConfig[];
  priority?: number;
  enabled?: boolean;
  routingVisibility?: RoutingVisibility;
  extraFields?: Record<string, unknown>;
  providerUuid?: string;
  autoSyncModels?: boolean;
}

const db = createDbClient();
const storeReady = Promise.resolve();

function getDefaultAuthHeaderForType(type: UpstreamType): RouteAuthHeader {
  return type === 'anthropic' ? 'x-api-key' : 'authorization';
}

function normalizeStoredAuthHeader(value: string | null, type: UpstreamType): RouteAuthHeader {
  if (value == null || value.length === 0) {
    return getDefaultAuthHeaderForType(type);
  }
  if (value === 'x-api-key' || value === 'authorization') {
    return value;
  }
  throw new Error(`Provider auth_header must be x-api-key or authorization, got: ${value}`);
}

function normalizeStoredRoutingVisibility(value: string | null): RoutingVisibility {
  return value === 'explicit_only' ? 'explicit_only' : 'direct';
}

function parseJsonArray<T>(value: string, fieldName: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${fieldName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid ${fieldName}: expected an array.`);
  }

  return parsed as T[];
}

function rowToConfigEntry(row: typeof consoleProviders.$inferSelect): ConfigEntry {
  if (row.authValue != null && row.authValue.length === 0) {
    throw new Error(`Provider "${row.channelName}" has invalid empty auth configuration in database.`);
  }

  const providerType = row.type === 'anthropic' ? 'anthropic' : 'openai';

  const auth: RouteAuthConfig | undefined = row.authValue == null
    ? undefined
    : {
        header: normalizeStoredAuthHeader(row.authHeader, providerType),
        value: row.authValue,
      };

  return {
    type: providerType,
    targetBaseUrl: row.targetBaseUrl,
    ...(row.systemPrompt ? { systemPrompt: row.systemPrompt } : {}),
    models: parseJsonArray<ModelConfig>(row.modelsJson, `${row.channelName}.models`),
    priority: row.priority,
    routingVisibility: normalizeStoredRoutingVisibility(row.routingVisibility),
    ...(auth ? { auth } : {}),
    ...(row.enabled === 0 ? { enabled: false } : {}),
    ...(row.extraFieldsJson && row.extraFieldsJson.trim()
      ? { extraFields: JSON.parse(row.extraFieldsJson) as Record<string, unknown> }
      : {}),
    providerUuid: row.providerUuid || '',
    ...(row.autoSyncModels === 1 ? { autoSyncModels: true } : {}),
  };
}

function serializeEntry(channelName: string, entry: ConfigEntry, now = Date.now(), providerUuid?: string) {
  return {
    channelName,
    providerUuid: providerUuid ?? entry.providerUuid ?? randomUUID(),
    type: entry.type ?? 'openai',
    targetBaseUrl: entry.targetBaseUrl,
    systemPrompt: entry.systemPrompt ?? null,
    modelsJson: JSON.stringify(entry.models ?? []),
    priority: entry.priority ?? 0,
    authHeader: entry.auth?.header ?? null,
    authValue: entry.auth?.value ?? null,
    extraFieldsJson: entry.extraFields && Object.keys(entry.extraFields).length > 0
      ? JSON.stringify(entry.extraFields)
      : '',
    routingVisibility: entry.routingVisibility ?? 'direct',
    enabled: entry.enabled !== false ? 1 : 0,
    autoSyncModels: entry.autoSyncModels ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listConsoleProviderEntries(): Promise<Record<string, ConfigEntry>> {
  await storeReady;
  const rows = await db.select().from(consoleProviders).orderBy(asc(consoleProviders.channelName));
  // Backfill any rows missing a UUID (e.g. migrated from old schema)
  const toBackfill = rows.filter((r) => !r.providerUuid);
  if (toBackfill.length > 0) {
    await Promise.all(
      toBackfill.map((r) =>
        db.update(consoleProviders)
          .set({ providerUuid: randomUUID() })
          .where(eq(consoleProviders.channelName, r.channelName))
      )
    );
    // Re-fetch after backfill
    const freshRows = await db.select().from(consoleProviders).orderBy(asc(consoleProviders.channelName));
    return Object.fromEntries(freshRows.map((row) => [row.channelName, rowToConfigEntry(row)]));
  }
  return Object.fromEntries(rows.map((row) => [row.channelName, rowToConfigEntry(row)]));
}

export async function createConsoleProviderEntry(channelName: string, entry: ConfigEntry): Promise<void> {
  await storeReady;
  await db.insert(consoleProviders).values(serializeEntry(channelName, entry));
}

export async function upsertConsoleProviderEntry(channelName: string, entry: ConfigEntry): Promise<void> {
  await storeReady;
  const now = Date.now();
  // Preserve existing UUID if row already exists
  const existing = await db.select({ providerUuid: consoleProviders.providerUuid })
    .from(consoleProviders).where(eq(consoleProviders.channelName, channelName)).limit(1);
  const existingUuid = existing[0]?.providerUuid || undefined;
  await db.insert(consoleProviders)
    .values(serializeEntry(channelName, entry, now, existingUuid))
    .onConflictDoUpdate({
      target: consoleProviders.channelName,
      set: {
        type: entry.type ?? 'openai',
        targetBaseUrl: entry.targetBaseUrl,
        systemPrompt: entry.systemPrompt ?? null,
        modelsJson: JSON.stringify(entry.models ?? []),
        priority: entry.priority ?? 0,
        authHeader: entry.auth?.header ?? null,
        authValue: entry.auth?.value ?? null,
        extraFieldsJson: entry.extraFields && Object.keys(entry.extraFields).length > 0
          ? JSON.stringify(entry.extraFields)
          : '',
        routingVisibility: entry.routingVisibility ?? 'direct',
        enabled: entry.enabled !== false ? 1 : 0,
        autoSyncModels: entry.autoSyncModels ? 1 : 0,
        updatedAt: now,
      },
    });
}

export async function updateConsoleProviderEntry(currentChannelName: string, nextChannelName: string, entry: ConfigEntry): Promise<void> {
  await storeReady;
  const now = Date.now();
  // Preserve the existing UUID (do not regenerate on rename)
  const existing = await db.select({ providerUuid: consoleProviders.providerUuid })
    .from(consoleProviders).where(eq(consoleProviders.channelName, currentChannelName)).limit(1);
  const existingUuid = existing[0]?.providerUuid || randomUUID();
  const rows = await db.update(consoleProviders)
    .set({
      channelName: nextChannelName,
      type: entry.type ?? 'openai',
      targetBaseUrl: entry.targetBaseUrl,
      systemPrompt: entry.systemPrompt ?? null,
      modelsJson: JSON.stringify(entry.models ?? []),
      priority: entry.priority ?? 0,
      authHeader: entry.auth?.header ?? null,
      authValue: entry.auth?.value ?? null,
      extraFieldsJson: entry.extraFields && Object.keys(entry.extraFields).length > 0
        ? JSON.stringify(entry.extraFields)
        : '',
      routingVisibility: entry.routingVisibility ?? 'direct',
      providerUuid: existingUuid,
      enabled: entry.enabled !== false ? 1 : 0,
      autoSyncModels: entry.autoSyncModels ? 1 : 0,
      updatedAt: now,
    })
    .where(eq(consoleProviders.channelName, currentChannelName))
    .returning({ channelName: consoleProviders.channelName });

  if (rows.length === 0) {
    throw new Error(`Provider "${currentChannelName}" does not exist.`);
  }
}

export async function updateConsoleProviderModels(channelName: string, models: ModelConfig[], syncedAt = Date.now()): Promise<void> {
  await storeReady;
  const result = await db.update(consoleProviders)
    .set({ modelsJson: JSON.stringify(models), modelsSyncedAt: syncedAt, updatedAt: syncedAt })
    .where(eq(consoleProviders.channelName, channelName))
    .returning({ channelName: consoleProviders.channelName });

  if (result.length === 0) {
    throw new Error(`Provider "${channelName}" does not exist`);
  }
}

export async function toggleConsoleProviderEntry(channelName: string, enabled: boolean): Promise<void> {
  await storeReady;
  const now = Date.now();
  const result = await db.update(consoleProviders)
    .set({ enabled: enabled ? 1 : 0, updatedAt: now })
    .where(eq(consoleProviders.channelName, channelName))
    .returning({ channelName: consoleProviders.channelName });

  if (result.length === 0) {
    throw new Error(`Provider "${channelName}" does not exist`);
  }
}

export async function clearConsoleProviderEntries(): Promise<void> {
  await storeReady;
  await db.delete(consoleProviders);
}

export async function deleteConsoleProviderEntry(channelName: string): Promise<void> {
  await storeReady;
  const result = await db.delete(consoleProviders)
    .where(eq(consoleProviders.channelName, channelName))
    .returning({ channelName: consoleProviders.channelName });

  if (result.length === 0) {
    throw new Error(`Provider "${channelName}" does not exist`);
  }
}
