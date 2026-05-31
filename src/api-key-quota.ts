export interface ApiKeyQuotaSnapshot {
  token_quota: number | null;
  token_used: number;
  token_remaining: number | null;
  quota_exhausted: boolean;
}

export type ApiKeyQuotaParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function normalizeUsedTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

export function parseApiKeyTokenQuotaLimit(value: unknown): ApiKeyQuotaParseResult {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized == null || normalized === '') {
    return { ok: true, value: null };
  }

  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return { ok: false, error: 'token_quota 必须是非负整数或 null' };
  }

  return { ok: true, value: parsed };
}

export function buildApiKeyQuotaSnapshot(tokenQuota: number | null, tokenUsed: unknown): ApiKeyQuotaSnapshot {
  const normalizedUsed = normalizeUsedTokens(tokenUsed);
  const normalizedQuota = tokenQuota == null ? null : Math.max(0, Math.trunc(tokenQuota));
  const tokenRemaining = normalizedQuota == null
    ? null
    : Math.max(0, normalizedQuota - normalizedUsed);

  return {
    token_quota: normalizedQuota,
    token_used: normalizedUsed,
    token_remaining: tokenRemaining,
    quota_exhausted: normalizedQuota != null && normalizedUsed >= normalizedQuota,
  };
}
