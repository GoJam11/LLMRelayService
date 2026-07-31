import { describe, expect, it } from 'bun:test';

import { buildCatalogMapsFromModelsDev } from '../src/model-catalog';

describe('buildCatalogMapsFromModelsDev', () => {
  it('prefers the first-party provider over resellers that drop cache prices', () => {
    const { pricingMap } = buildCatalogMapsFromModelsDev({
      anthropic: {
        models: {
          'claude-opus-4-6': {
            limit: { context: 200000 },
            cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
          },
        },
      },
      // 出现在 models.dev 后面的二级经销商，只填了 input/output
      jiekou: {
        models: {
          'claude-opus-4-6': { cost: { input: 5, output: 25 } },
        },
      },
    });

    expect(pricingMap.get('claude-opus-4-6')).toEqual({
      input: 5,
      output: 25,
      cache_read: 0.5,
      cache_write: 6.25,
    });
  });

  it('backfills missing cache prices from another provider on the same base price', () => {
    const { pricingMap } = buildCatalogMapsFromModelsDev({
      openai: {
        models: {
          'gpt-5.2': { cost: { input: 1.75, output: 14, cache_read: 0.175 } },
        },
      },
      llmgateway: {
        models: {
          'gpt-5.2': { cost: { input: 1.75, output: 14, cache_read: 0.175, cache_write: 2.1875 } },
        },
      },
    });

    expect(pricingMap.get('gpt-5.2')).toEqual({
      input: 1.75,
      output: 14,
      cache_read: 0.175,
      cache_write: 2.1875,
    });
  });

  it('does not backfill cache prices from a provider with different base pricing', () => {
    const { pricingMap } = buildCatalogMapsFromModelsDev({
      anthropic: {
        models: {
          'claude-haiku-4-5': { cost: { input: 1, output: 5 } },
        },
      },
      xpersona: {
        models: {
          'claude-haiku-4-5': { cost: { input: 0.6, output: 3.7, cache_read: 0.06 } },
        },
      },
    });

    expect(pricingMap.get('claude-haiku-4-5')).toEqual({ input: 1, output: 5 });
  });

  it('ranks priced entries above free/placeholder entries when no first-party provider exists', () => {
    const { pricingMap } = buildCatalogMapsFromModelsDev({
      somereseller: {
        models: {
          'mystery-model': { cost: { input: 2, output: 8, cache_read: 0.2, cache_write: 2.5 } },
        },
      },
      kenari: {
        models: {
          'mystery-model': { cost: { input: 0, output: 0 } },
        },
      },
    });

    expect(pricingMap.get('mystery-model')).toEqual({
      input: 2,
      output: 8,
      cache_read: 0.2,
      cache_write: 2.5,
    });
  });

  it('ignores malformed cost and limit values', () => {
    const { contextMap, pricingMap } = buildCatalogMapsFromModelsDev({
      broken: {
        models: {
          'bad-cost': { cost: { input: 'free', output: 3 }, limit: { context: 0 } },
          'negative-cost': { cost: { input: -1, output: 3 } },
          'no-output': { cost: { input: 1 } },
          'ok-model': { cost: { input: 1, output: 2 }, limit: { context: 8192 } },
        },
      },
    });

    expect(pricingMap.has('bad-cost')).toBe(false);
    expect(pricingMap.has('negative-cost')).toBe(false);
    expect(pricingMap.has('no-output')).toBe(false);
    expect(contextMap.has('bad-cost')).toBe(false);
    expect(pricingMap.get('ok-model')).toEqual({ input: 1, output: 2 });
    expect(contextMap.get('ok-model')).toBe(8192);
  });

  it('keeps the context window when only a non-preferred provider reports one', () => {
    const { contextMap } = buildCatalogMapsFromModelsDev({
      anthropic: {
        models: {
          'claude-opus-4-6': { cost: { input: 5, output: 25 } },
        },
      },
      opencode: {
        models: {
          'claude-opus-4-6': { limit: { context: 200000 }, cost: { input: 5, output: 25 } },
        },
      },
    });

    expect(contextMap.get('claude-opus-4-6')).toBe(200000);
  });
});
