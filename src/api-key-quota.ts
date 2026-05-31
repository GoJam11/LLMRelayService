const MICRO_USD_PER_USD = 1_000_000;

export interface ApiKeyQuotaSnapshot {
  cost_quota: number | null;
  cost_used: number;
  cost_remaining: number | null;
  quota_exhausted: boolean;
}

export type ApiKeyQuotaParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

function normalizeMicrousd(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

export function microusdToUsd(value: unknown): number {
  return normalizeMicrousd(value) / MICRO_USD_PER_USD;
}

export function usdToQuotaMicrousd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * MICRO_USD_PER_USD);
}

export function usdCostToChargeMicrousd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value * MICRO_USD_PER_USD);
}

export function parseApiKeyCostQuotaLimit(value: unknown): ApiKeyQuotaParseResult {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized == null || normalized === '') {
    return { ok: true, value: null };
  }

  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: 'cost_quota 必须是非负数字或 null' };
  }

  return { ok: true, value: usdToQuotaMicrousd(parsed) };
}

export function buildApiKeyQuotaSnapshot(
  costQuotaMicrousd: number | null,
  costUsedMicrousd: unknown,
): ApiKeyQuotaSnapshot {
  const normalizedUsed = normalizeMicrousd(costUsedMicrousd);
  const normalizedQuota = costQuotaMicrousd == null ? null : Math.max(0, Math.trunc(costQuotaMicrousd));
  const costRemainingMicrousd = normalizedQuota == null
    ? null
    : Math.max(0, normalizedQuota - normalizedUsed);

  return {
    cost_quota: normalizedQuota == null ? null : microusdToUsd(normalizedQuota),
    cost_used: microusdToUsd(normalizedUsed),
    cost_remaining: costRemainingMicrousd == null ? null : microusdToUsd(costRemainingMicrousd),
    quota_exhausted: normalizedQuota != null && normalizedUsed >= normalizedQuota,
  };
}
