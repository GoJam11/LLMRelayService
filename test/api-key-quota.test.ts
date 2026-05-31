import { describe, expect, test } from 'bun:test';
import {
  buildApiKeyQuotaSnapshot,
  microusdToUsd,
  parseApiKeyCostQuotaLimit,
  usdCostToChargeMicrousd,
  usdToQuotaMicrousd,
} from '../src/api-key-quota';

describe('parseApiKeyCostQuotaLimit', () => {
  test('empty values mean unlimited quota', () => {
    expect(parseApiKeyCostQuotaLimit(null)).toEqual({ ok: true, value: null });
    expect(parseApiKeyCostQuotaLimit(undefined)).toEqual({ ok: true, value: null });
    expect(parseApiKeyCostQuotaLimit('')).toEqual({ ok: true, value: null });
  });

  test('accepts non-negative dollar values and stores micro-USD', () => {
    expect(parseApiKeyCostQuotaLimit(0)).toEqual({ ok: true, value: 0 });
    expect(parseApiKeyCostQuotaLimit(0.01)).toEqual({ ok: true, value: 10_000 });
    expect(parseApiKeyCostQuotaLimit('2.5')).toEqual({ ok: true, value: 2_500_000 });
  });

  test('rejects negative and non-numeric values', () => {
    expect(parseApiKeyCostQuotaLimit(-1).ok).toBe(false);
    expect(parseApiKeyCostQuotaLimit('abc').ok).toBe(false);
  });
});

describe('buildApiKeyQuotaSnapshot', () => {
  test('unlimited quota never exhausts', () => {
    expect(buildApiKeyQuotaSnapshot(null, 500)).toEqual({
      cost_quota: null,
      cost_used: 0.0005,
      cost_remaining: null,
      quota_exhausted: false,
    });
  });

  test('zero quota is exhausted immediately', () => {
    expect(buildApiKeyQuotaSnapshot(0, 0)).toEqual({
      cost_quota: 0,
      cost_used: 0,
      cost_remaining: 0,
      quota_exhausted: true,
    });
  });

  test('computes remaining cost quota and exhaustion from used cost', () => {
    expect(buildApiKeyQuotaSnapshot(1_000_000, 400_000)).toEqual({
      cost_quota: 1,
      cost_used: 0.4,
      cost_remaining: 0.6,
      quota_exhausted: false,
    });

    expect(buildApiKeyQuotaSnapshot(1_000_000, 1_000_000)).toEqual({
      cost_quota: 1,
      cost_used: 1,
      cost_remaining: 0,
      quota_exhausted: true,
    });
  });
});

describe('micro-USD helpers', () => {
  test('rounds configured quotas but rounds usage charges up', () => {
    expect(usdToQuotaMicrousd(0.0000014)).toBe(1);
    expect(usdCostToChargeMicrousd(0.0000014)).toBe(2);
    expect(microusdToUsd('42')).toBe(0.000042);
  });
});
