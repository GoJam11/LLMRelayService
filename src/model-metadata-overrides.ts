import { and, eq } from 'drizzle-orm';
import { createDbClient } from './db/client';
import { modelMetadataOverrides } from './db/schema';
import type { ModelPricing } from './catalog-db';

const db = createDbClient();
const storeReady = Promise.resolve();

export interface ModelMetadataOverride {
  channelName: string;
  modelId: string;
  context?: number;
  pricing?: ModelPricing;
  createdAt: number;
  updatedAt: number;
}

export interface ModelMetadataOverrideInput {
  context?: number | null;
  pricing?: Partial<ModelPricing> | null;
}

function parsePricing(value: string | null): ModelPricing | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ModelPricing>;
    const input = normalizeOptionalPrice(parsed.input, 'pricing.input');
    const output = normalizeOptionalPrice(parsed.output, 'pricing.output');
    if (input == null || output == null) return undefined;
    const cacheRead = normalizeOptionalPrice(parsed.cache_read, 'pricing.cache_read');
    const cacheWrite = normalizeOptionalPrice(parsed.cache_write, 'pricing.cache_write');
    return {
      input,
      output,
      ...(cacheRead != null ? { cache_read: cacheRead } : {}),
      ...(cacheWrite != null ? { cache_write: cacheWrite } : {}),
    };
  } catch {
    return undefined;
  }
}

function rowToOverride(row: typeof modelMetadataOverrides.$inferSelect): ModelMetadataOverride {
  return {
    channelName: row.channelName,
    modelId: row.modelId,
    ...(row.contextWindow != null ? { context: row.contextWindow } : {}),
    ...(parsePricing(row.pricingJson) ? { pricing: parsePricing(row.pricingJson) } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空`);
  }
  return normalized;
}

function normalizeOptionalContext(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('context 必须是正整数');
  }
  return Math.trunc(numeric);
}

function normalizeOptionalPrice(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${fieldName} 必须是非负数字`);
  }
  return numeric;
}

function normalizePricing(value: Partial<ModelPricing> | null | undefined): ModelPricing | undefined {
  if (value == null) return undefined;
  const input = normalizeOptionalPrice(value.input, 'pricing.input');
  const output = normalizeOptionalPrice(value.output, 'pricing.output');
  const cacheRead = normalizeOptionalPrice(value.cache_read, 'pricing.cache_read');
  const cacheWrite = normalizeOptionalPrice(value.cache_write, 'pricing.cache_write');

  if (input == null && output == null && cacheRead == null && cacheWrite == null) {
    return undefined;
  }
  if (input == null || output == null) {
    throw new Error('自定义价格必须同时填写 input 和 output');
  }

  return {
    input,
    output,
    ...(cacheRead != null ? { cache_read: cacheRead } : {}),
    ...(cacheWrite != null ? { cache_write: cacheWrite } : {}),
  };
}

export function getModelOverrideKey(channelName: string, modelId: string): string {
  return `${channelName}\u0000${modelId}`;
}

export async function listModelMetadataOverrides(): Promise<Map<string, ModelMetadataOverride>> {
  await storeReady;
  const rows = await db.select().from(modelMetadataOverrides);
  return new Map(rows.map((row) => {
    const override = rowToOverride(row);
    return [getModelOverrideKey(override.channelName, override.modelId), override];
  }));
}

export async function getModelMetadataOverride(
  channelName: string,
  modelId: string,
): Promise<ModelMetadataOverride | null> {
  await storeReady;
  const normalizedChannelName = normalizeRequiredString(channelName, 'channelName');
  const normalizedModelId = normalizeRequiredString(modelId, 'modelId');
  const [row] = await db.select().from(modelMetadataOverrides)
    .where(and(
      eq(modelMetadataOverrides.channelName, normalizedChannelName),
      eq(modelMetadataOverrides.modelId, normalizedModelId),
    ))
    .limit(1);
  return row ? rowToOverride(row) : null;
}

export async function upsertModelMetadataOverride(
  channelName: string,
  modelId: string,
  input: ModelMetadataOverrideInput,
): Promise<ModelMetadataOverride | null> {
  await storeReady;
  const normalizedChannelName = normalizeRequiredString(channelName, 'channelName');
  const normalizedModelId = normalizeRequiredString(modelId, 'modelId');
  const context = normalizeOptionalContext(input.context);
  const pricing = normalizePricing(input.pricing);

  if (context == null && pricing == null) {
    await deleteModelMetadataOverride(normalizedChannelName, normalizedModelId);
    return null;
  }

  const now = Date.now();
  const [row] = await db.insert(modelMetadataOverrides)
    .values({
      channelName: normalizedChannelName,
      modelId: normalizedModelId,
      contextWindow: context ?? null,
      pricingJson: pricing ? JSON.stringify(pricing) : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [modelMetadataOverrides.channelName, modelMetadataOverrides.modelId],
      set: {
        contextWindow: context ?? null,
        pricingJson: pricing ? JSON.stringify(pricing) : null,
        updatedAt: now,
      },
    })
    .returning();

  return row ? rowToOverride(row) : null;
}

export async function deleteModelMetadataOverride(channelName: string, modelId: string): Promise<boolean> {
  await storeReady;
  const normalizedChannelName = normalizeRequiredString(channelName, 'channelName');
  const normalizedModelId = normalizeRequiredString(modelId, 'modelId');
  const rows = await db.delete(modelMetadataOverrides)
    .where(and(
      eq(modelMetadataOverrides.channelName, normalizedChannelName),
      eq(modelMetadataOverrides.modelId, normalizedModelId),
    ))
    .returning({ id: modelMetadataOverrides.id });
  return rows.length > 0;
}