import { asc, eq } from 'drizzle-orm';
import { createDbClient } from './db/client';
import { runMigrations } from './db/migrate';
import { modelAliases } from './db/schema';

export interface ModelAliasEntry {
  id: number;
  alias: string;
  provider: string;
  model: string;
  description: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelAliasMutationInput {
  alias?: string;
  provider?: string;
  model?: string;
  description?: string | null;
  enabled?: boolean;
}

const db = createDbClient();
const storeReady = runMigrations();

function rowToEntry(row: typeof modelAliases.$inferSelect): ModelAliasEntry {
  return {
    id: row.id,
    alias: row.alias,
    provider: row.provider,
    model: row.model,
    description: row.description,
    enabled: row.enabled !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listModelAliases(): Promise<ModelAliasEntry[]> {
  await storeReady;
  const rows = await db.select().from(modelAliases).orderBy(asc(modelAliases.createdAt));
  return rows.map(rowToEntry);
}

export async function getModelAlias(id: number): Promise<ModelAliasEntry | null> {
  await storeReady;
  const rows = await db.select().from(modelAliases).where(eq(modelAliases.id, id));
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function getModelAliasByAlias(alias: string): Promise<ModelAliasEntry | null> {
  await storeReady;
  const rows = await db.select().from(modelAliases).where(eq(modelAliases.alias, alias));
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function createModelAlias(input: ModelAliasMutationInput): Promise<ModelAliasEntry> {
  await storeReady;

  const alias = (input.alias ?? '').trim();
  const provider = (input.provider ?? '').trim();
  const model = (input.model ?? '').trim();

  if (!alias) throw new Error('alias 不能为空');
  if (!provider) throw new Error('provider 不能为空');
  if (!model) throw new Error('model 不能为空');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias)) {
    throw new Error('alias 只允许字母、数字、点、下划线、连字符，且必须以字母或数字开头');
  }

  const now = Date.now();
  const rows = await db
    .insert(modelAliases)
    .values({
      alias,
      provider,
      model,
      description: input.description ?? null,
      enabled: input.enabled !== false ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!rows[0]) throw new Error('创建失败');
  return rowToEntry(rows[0]);
}

export async function updateModelAlias(id: number, input: ModelAliasMutationInput): Promise<ModelAliasEntry> {
  await storeReady;

  const existing = await getModelAlias(id);
  if (!existing) throw new Error('模型别名不存在');

  const alias = input.alias !== undefined ? (input.alias ?? '').trim() : existing.alias;
  const provider = input.provider !== undefined ? (input.provider ?? '').trim() : existing.provider;
  const model = input.model !== undefined ? (input.model ?? '').trim() : existing.model;

  if (!alias) throw new Error('alias 不能为空');
  if (!provider) throw new Error('provider 不能为空');
  if (!model) throw new Error('model 不能为空');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias)) {
    throw new Error('alias 只允许字母、数字、点、下划线、连字符，且必须以字母或数字开头');
  }

  const rows = await db
    .update(modelAliases)
    .set({
      alias,
      provider,
      model,
      description: input.description !== undefined ? (input.description ?? null) : existing.description,
      enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      updatedAt: Date.now(),
    })
    .where(eq(modelAliases.id, id))
    .returning();

  if (!rows[0]) throw new Error('更新失败');
  return rowToEntry(rows[0]);
}

export async function toggleModelAlias(id: number, enabled: boolean): Promise<ModelAliasEntry> {
  await storeReady;
  const rows = await db
    .update(modelAliases)
    .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(modelAliases.id, id))
    .returning();
  if (!rows[0]) throw new Error('模型别名不存在');
  return rowToEntry(rows[0]);
}

export async function deleteModelAlias(id: number): Promise<void> {
  await storeReady;
  const result = await db.delete(modelAliases).where(eq(modelAliases.id, id)).returning();
  if (result.length === 0) throw new Error('模型别名不存在');
}
