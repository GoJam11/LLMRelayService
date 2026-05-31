import { describe, expect, test } from 'bun:test';
import { buildApiKeyQuotaSnapshot, normalizeUsedTokens, parseApiKeyTokenQuotaLimit } from '../src/api-key-quota';

describe('parseApiKeyTokenQuotaLimit', () => {
  test('empty values mean unlimited quota', () => {
    expect(parseApiKeyTokenQuotaLimit(null)).toEqual({ ok: true, value: null });
    expect(parseApiKeyTokenQuotaLimit(undefined)).toEqual({ ok: true, value: null });
    expect(parseApiKeyTokenQuotaLimit('')).toEqual({ ok: true, value: null });
    expect(parseApiKeyTokenQuotaLimit('   ')).toEqual({ ok: true, value: null });
  });

  test('accepts non-negative integers', () => {
    expect(parseApiKeyTokenQuotaLimit(0)).toEqual({ ok: true, value: 0 });
    expect(parseApiKeyTokenQuotaLimit(1000)).toEqual({ ok: true, value: 1000 });
    expect(parseApiKeyTokenQuotaLimit('2500')).toEqual({ ok: true, value: 2500 });
  });

  test('rejects negative, fractional, and non-numeric values', () => {
    expect(parseApiKeyTokenQuotaLimit(-1).ok).toBe(false);
    expect(parseApiKeyTokenQuotaLimit(1.5).ok).toBe(false);
    expect(parseApiKeyTokenQuotaLimit('abc').ok).toBe(false);
  });
});

describe('buildApiKeyQuotaSnapshot', () => {
  test('unlimited quota never exhausts', () => {
    expect(buildApiKeyQuotaSnapshot(null, 500)).toEqual({
      token_quota: null,
      token_used: 500,
      token_remaining: null,
      quota_exhausted: false,
    });
  });

  test('zero quota is exhausted immediately', () => {
    expect(buildApiKeyQuotaSnapshot(0, 0)).toEqual({
      token_quota: 0,
      token_used: 0,
      token_remaining: 0,
      quota_exhausted: true,
    });
  });

  test('computes remaining quota and exhaustion from used tokens', () => {
    expect(buildApiKeyQuotaSnapshot(1000, 400)).toEqual({
      token_quota: 1000,
      token_used: 400,
      token_remaining: 600,
      quota_exhausted: false,
    });

    expect(buildApiKeyQuotaSnapshot(1000, 1000)).toEqual({
      token_quota: 1000,
      token_used: 1000,
      token_remaining: 0,
      quota_exhausted: true,
    });
  });
});

describe('normalizeUsedTokens', () => {
  test('normalizes aggregate values defensively', () => {
    expect(normalizeUsedTokens('42')).toBe(42);
    expect(normalizeUsedTokens(-3)).toBe(0);
    expect(normalizeUsedTokens('not-a-number')).toBe(0);
  });
});
