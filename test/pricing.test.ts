import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

const originalFetch = globalThis.fetch;
let pricingModule: typeof import('../src/pricing') | null = null;

describe('pricing', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input: Request | URL | string): Promise<Response> => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({
          openai: {
            models: {
              'gpt-5-mini': {
                cost: {
                  input: 1,
                  output: 2,
                  cache_read: 0.1,
                  cache_write: 1.25,
                },
              },
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input as RequestInfo | URL);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    pricingModule?.__resetPricingCacheForTests();
    globalThis.fetch = originalFetch;
  });

  it('subtracts cached openai prompt tokens before applying the full input price', async () => {
    pricingModule = await import('../src/pricing');
    pricingModule.__setPricingCacheForTests(new Map([
      ['gpt-5-mini', {
        input: 1,
        output: 2,
        cache_read: 0.1,
        cache_write: 1.25,
      }],
    ]));

    const cost = pricingModule.calculateCost({
      input_tokens: 117025,
      output_tokens: 170,
      cached_input_tokens: 116224,
    }, 'gpt-5-mini');

    expect(cost.upstream_type).toBe('openai');
    expect(cost.uncached_input_tokens).toBe(801);
    expect(cost.cache_read_tokens).toBe(116224);
    expect(cost.cache_write_tokens).toBe(0);
    expect(cost.input_cost).toBeCloseTo(0.000801, 12);
    expect(cost.output_cost).toBeCloseTo(0.00034, 12);
    expect(cost.cache_read_cost).toBeCloseTo(0.0116224, 12);
    expect(cost.total_cost).toBeCloseTo(0.0127634, 12);
  });

  it('keeps anthropic cache read and cache write tokens separate from openai cached prompt tokens', async () => {
    pricingModule = await import('../src/pricing');
    pricingModule.__setPricingCacheForTests(new Map([
      ['claude-opus-4-6', {
        input: 15,
        output: 75,
        cache_read: 1.5,
        cache_write: 18.75,
      }],
    ]));

    const cost = pricingModule.calculateCost({
      input_tokens: 72,
      output_tokens: 16,
      cache_read_input_tokens: 480,
      cache_creation_input_tokens: 96,
      cached_input_tokens: 999999,
    }, 'claude-opus-4-6', 'anthropic');

    expect(cost.upstream_type).toBe('anthropic');
    expect(cost.uncached_input_tokens).toBe(72);
    expect(cost.cache_read_tokens).toBe(480);
    expect(cost.cache_write_tokens).toBe(96);
    expect(cost.input_cost).toBeCloseTo(0.00108, 12);
    expect(cost.output_cost).toBeCloseTo(0.0012, 12);
    expect(cost.cache_read_cost).toBeCloseTo(0.00072, 12);
    expect(cost.cache_write_cost).toBeCloseTo(0.0018, 12);
    expect(cost.total_cost).toBeCloseTo(0.0048, 12);
  });
});
