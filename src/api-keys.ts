import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { consoleApiKeys } from './db/schema';
import { createDbClient } from './db/client';
import { isModelAllowed, parseAllowedModels } from './api-key-model-filter';
import { buildApiKeyQuotaSnapshot, parseApiKeyCostQuotaLimit } from './api-key-quota';
export { isModelAllowed, parseAllowedModels } from './api-key-model-filter';

const db = createDbClient();
const storeReady = Promise.resolve();
const KEY_PREFIX = 'ak';

export interface StoredApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  allowed_models: string[];
  cost_quota: number | null;
  cost_used: number;
  cost_remaining: number | null;
  quota_exhausted: boolean;
}

export interface StoredApiKeyDetail extends StoredApiKeyRecord {
  key: string;
}

export interface AuthenticatedApiKeyInfo {
  id: string;
  name: string;
  allowed_models: string[];
  cost_quota: number | null;
  cost_used: number;
  cost_remaining: number | null;
  quota_exhausted: boolean;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function createRawKey(): string {
  return `${KEY_PREFIX}-${randomBytes(24).toString('base64url')}`;
}

function createKeyId(): string {
  return randomBytes(16).toString('hex');
}

function toRecord(row: typeof consoleApiKeys.$inferSelect): StoredApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.createdAt,
    last_used_at: row.lastUsedAt,
    allowed_models: parseAllowedModels(row.allowedModelsJson),
    ...buildApiKeyQuotaSnapshot(row.costQuotaMicrousd, row.costUsedMicrousd),
  };
}

export async function listManagedApiKeys(): Promise<StoredApiKeyRecord[]> {
  await storeReady;
  const rows = await db.select().from(consoleApiKeys)
    .where(eq(consoleApiKeys.revoked, 0))
    .orderBy(desc(consoleApiKeys.createdAt));

  return rows.map(toRecord);
}

export async function createManagedApiKey(name: string, costQuotaInput?: unknown): Promise<{ key: string; record: StoredApiKeyRecord }> {
  await storeReady;
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('Key 名称不能为空');
  }
  const parsedQuota = parseApiKeyCostQuotaLimit(costQuotaInput);
  if (!parsedQuota.ok) {
    throw new Error(parsedQuota.error);
  }

  const rawKey = createRawKey();
  const now = Date.now();
  const prefix = rawKey.slice(0, 10);
  const [row] = await db.insert(consoleApiKeys)
    .values({
      id: createKeyId(),
      name: normalizedName,
      keyHash: hashKey(rawKey),
      keyValue: rawKey,
      prefix,
      createdAt: now,
      lastUsedAt: null,
      revoked: 0,
      costQuotaMicrousd: parsedQuota.value,
      costUsedMicrousd: 0,
    })
    .returning();

  if (!row) {
    throw new Error('创建 API key 失败');
  }

  return {
    key: rawKey,
    record: toRecord(row),
  };
}

export async function getManagedApiKey(id: string): Promise<StoredApiKeyDetail | null> {
  await storeReady;
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const [row] = await db.select().from(consoleApiKeys)
    .where(and(
      eq(consoleApiKeys.id, normalizedId),
      eq(consoleApiKeys.revoked, 0),
    ))
    .limit(1);

  if (!row) return null;

  return {
    ...toRecord(row),
    key: row.keyValue,
  };
}

export async function renameManagedApiKey(id: string, name: string): Promise<StoredApiKeyRecord | null> {
  await storeReady;
  const normalizedId = id.trim();
  const normalizedName = name.trim();
  if (!normalizedId || !normalizedName) return null;

  const rows = await db.update(consoleApiKeys)
    .set({ name: normalizedName })
    .where(and(
      eq(consoleApiKeys.id, normalizedId),
      eq(consoleApiKeys.revoked, 0),
    ))
    .returning();

  return rows[0] ? toRecord(rows[0]) : null;
}

export async function deleteManagedApiKey(id: string): Promise<boolean> {
  await storeReady;
  const normalizedId = id.trim();
  if (!normalizedId) return false;

  const rows = await db.delete(consoleApiKeys)
    .where(eq(consoleApiKeys.id, normalizedId))
    .returning({ id: consoleApiKeys.id });

  return rows.length > 0;
}

export async function clearManagedApiKeys(): Promise<void> {
  await storeReady;
  await db.delete(consoleApiKeys);
}

export async function authenticateManagedApiKey(rawKey: string): Promise<AuthenticatedApiKeyInfo | null> {
  await storeReady;
  const normalized = rawKey.trim();
  if (!normalized) return null;

  const keyHash = hashKey(normalized);
  let row: typeof consoleApiKeys.$inferSelect | undefined;

  try {
    const rows = await db.select().from(consoleApiKeys)
      .where(and(
        eq(consoleApiKeys.keyHash, keyHash),
        eq(consoleApiKeys.revoked, 0),
      ))
      .limit(1);
    row = rows[0];
  } catch {
    // DB unavailable — treat as no match, do not expose internal errors to callers
    return null;
  }

  if (!row) return null;

  try {
    await db.update(consoleApiKeys)
      .set({ lastUsedAt: Date.now() })
      .where(and(
        eq(consoleApiKeys.id, row.id),
        ne(consoleApiKeys.revoked, 1),
      ));
  } catch {
    // Best-effort update; don't fail authentication if the update fails
  }

  return {
    id: row.id,
    name: row.name,
    allowed_models: parseAllowedModels(row.allowedModelsJson),
    ...buildApiKeyQuotaSnapshot(row.costQuotaMicrousd, row.costUsedMicrousd),
  };
}

export async function setApiKeyAllowedModels(id: string, models: string[]): Promise<StoredApiKeyRecord | null> {
  await storeReady;
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const cleanedModels = Array.from(
    new Set(
      models
        .map((m) => m.trim())
        .filter((m) => m.length > 0),
    ),
  );

  const rows = await db.update(consoleApiKeys)
    .set({ allowedModelsJson: JSON.stringify(cleanedModels) })
    .where(and(
      eq(consoleApiKeys.id, normalizedId),
      eq(consoleApiKeys.revoked, 0),
    ))
    .returning();

  return rows[0] ? toRecord(rows[0]) : null;
}

export async function setApiKeyCostQuota(id: string, costQuotaMicrousd: number | null): Promise<StoredApiKeyRecord | null> {
  await storeReady;
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const rows = await db.update(consoleApiKeys)
    .set({ costQuotaMicrousd })
    .where(and(
      eq(consoleApiKeys.id, normalizedId),
      eq(consoleApiKeys.revoked, 0),
    ))
    .returning();

  return rows[0] ? toRecord(rows[0]) : null;
}
