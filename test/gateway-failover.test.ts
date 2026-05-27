import { describe, expect, it } from 'bun:test';
import {
  CODE_DEFAULT_GATEWAY_FAILOVER_POLICY,
  getCustomModelFallbackModels,
  normalizeGatewayFailoverPolicy,
  shouldTriggerFailover,
} from '../src/gateway-failover';

describe('gateway failover policy', () => {
  it('normalizes defaults and configurable retry triggers', () => {
    const policy = normalizeGatewayFailoverPolicy({
      retryAttempts: 2,
      maxFallbackAttempts: 3,
      modelFallbackMode: 'any_model',
      retryOnStatusCodes: [503, 429, 429],
      retryOnStatusRanges: [],
    });

    expect(policy).toEqual({
      ...CODE_DEFAULT_GATEWAY_FAILOVER_POLICY,
      retryAttempts: 2,
      maxFallbackAttempts: 3,
      modelFallbackMode: 'any_model',
      customModelFallbacks: [],
      retryOnStatusCodes: [429, 503],
      retryOnStatusRanges: [],
    });
  });

  it('normalizes custom model fallback rules by request model name', () => {
    const policy = normalizeGatewayFailoverPolicy({
      customModelFallbacks: [
        { model: ' gpt-4o ', fallbacks: ['gpt-4o-mini', ' deepseek-chat ', 'gpt-4o-mini'] },
        { model: 'gpt-4o', fallbacks: ['claude-3-5-sonnet'] },
      ],
    });

    expect(policy.customModelFallbacks).toEqual([
      { model: 'gpt-4o', fallbacks: ['gpt-4o-mini', 'deepseek-chat', 'claude-3-5-sonnet'] },
    ]);
    expect(getCustomModelFallbackModels(policy, 'gpt-4o')).toEqual(['gpt-4o-mini', 'deepseek-chat', 'claude-3-5-sonnet']);
    expect(getCustomModelFallbackModels(policy, 'unknown')).toEqual([]);
  });

  it('validates retry and fallback limits', () => {
    expect(() => normalizeGatewayFailoverPolicy({ retryAttempts: 6 })).toThrow('retryAttempts');
    expect(() => normalizeGatewayFailoverPolicy({ maxFallbackAttempts: 21 })).toThrow('maxFallbackAttempts');
    expect(() => normalizeGatewayFailoverPolicy({ retryOnStatusCodes: [399] })).toThrow('retryOnStatusCodes');
    expect(() => normalizeGatewayFailoverPolicy({ retryOnStatusRanges: ['4xx' as any] })).toThrow('retryOnStatusRanges');
    expect(() => normalizeGatewayFailoverPolicy({ customModelFallbacks: [{ model: 'gpt-4o', fallbacks: [] }] })).toThrow('customModelFallbacks');
  });

  it('matches timeout, network, explicit status, and 5xx triggers', () => {
    const policy = normalizeGatewayFailoverPolicy({
      retryOnStatusCodes: [408, 429],
      retryOnStatusRanges: ['5xx'],
    });

    expect(shouldTriggerFailover(policy, { kind: 'timeout' })).toBe(true);
    expect(shouldTriggerFailover(policy, { kind: 'network_error' })).toBe(true);
    expect(shouldTriggerFailover(policy, { kind: 'status', status: 429 })).toBe(true);
    expect(shouldTriggerFailover(policy, { kind: 'status', status: 502 })).toBe(true);
    expect(shouldTriggerFailover(policy, { kind: 'status', status: 400 })).toBe(false);
  });
});
