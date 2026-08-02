import { afterEach, describe, expect, test } from 'bun:test';
import { getCostMetricRows } from '../console/ai-proxy-dashboard/src/features/dashboard/utils';
import { getEffectivePricing, getPricingModelCandidates } from '../src/console-store';
import { getModelOverrideKey, type ModelMetadataOverride } from '../src/model-metadata-overrides';
import {
  __resetPricingCacheForTests,
  __setPricingCacheForTests,
  calculateCostWithPricing,
  type ModelPricing,
} from '../src/pricing';

const CHANNEL = 'CPA-Claude';
const SONNET_PRICING: ModelPricing = { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 };

function setCatalog(entries: Record<string, ModelPricing>): void {
  __setPricingCacheForTests(new Map(Object.entries(entries)));
}

function buildOverride(channelName: string, modelId: string, pricing: ModelPricing): Map<string, ModelMetadataOverride> {
  return new Map([[getModelOverrideKey(channelName, modelId), {
    channelName,
    modelId,
    pricing,
    createdAt: 0,
    updatedAt: 0,
  }]]);
}

afterEach(() => {
  __resetPricingCacheForTests();
});

describe('getPricingModelCandidates', () => {
  test('keeps order, trims and drops empty/duplicate ids', () => {
    expect(getPricingModelCandidates(' openclaw ', 'claude-sonnet-5', '', null, undefined, 'claude-sonnet-5'))
      .toEqual(['openclaw', 'claude-sonnet-5']);
    expect(getPricingModelCandidates(null, undefined, '   ')).toEqual([]);
  });
});

describe('getEffectivePricing', () => {
  test('uses the upstream response model when it has a price', () => {
    setCatalog({ 'claude-sonnet-5': SONNET_PRICING });

    expect(getEffectivePricing(CHANNEL, ['claude-sonnet-5', 'claude-sonnet-5']))
      .toEqual({ pricing: SONNET_PRICING, model: 'claude-sonnet-5' });
  });

  // 中转上游把响应模型写成自己的代号（cliproxyapi 会返回 openclaw / code），
  // 只认响应模型就取不到价，整条请求按 0 计费。
  test('falls back to the request model when the response model is unknown', () => {
    setCatalog({ 'claude-sonnet-5': SONNET_PRICING });

    expect(getEffectivePricing(CHANNEL, ['openclaw', 'claude-sonnet-5']))
      .toEqual({ pricing: SONNET_PRICING, model: 'claude-sonnet-5' });
  });

  test('manual override on any candidate beats a catalog hit on another', () => {
    const custom: ModelPricing = { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 };
    setCatalog({ openclaw: { input: 99, output: 99 } });

    expect(getEffectivePricing(CHANNEL, ['openclaw', 'claude-sonnet-5'], buildOverride(CHANNEL, 'claude-sonnet-5', custom)))
      .toEqual({ pricing: custom, model: 'claude-sonnet-5' });
  });

  test('override of another channel does not leak across channels', () => {
    setCatalog({});

    expect(getEffectivePricing(CHANNEL, ['claude-sonnet-5'], buildOverride('other-channel', 'claude-sonnet-5', SONNET_PRICING)))
      .toBeNull();
  });

  test('returns null when no candidate has a price', () => {
    setCatalog({ 'claude-sonnet-5': SONNET_PRICING });

    expect(getEffectivePricing(CHANNEL, ['openclaw', 'mimo-v2.5-pro'])).toBeNull();
  });
});

describe('cache cost after the model fallback', () => {
  // 线上真实样本：input 只有 2 个 token，成本几乎全在缓存读写上。
  test('bills cache read/write instead of charging 0', () => {
    setCatalog({ 'claude-sonnet-5': SONNET_PRICING });

    const usage = {
      input_tokens: 2,
      output_tokens: 49,
      cache_creation_input_tokens: 24802,
      cache_read_input_tokens: 56069,
      ephemeral_5m_input_tokens: 24802,
      ephemeral_1h_input_tokens: 0,
    };
    const resolved = getEffectivePricing(CHANNEL, getPricingModelCandidates('openclaw', 'claude-sonnet-5'));
    const cost = calculateCostWithPricing(usage, resolved?.pricing, 'anthropic');

    expect(cost.cache_read_cost).toBeCloseTo((56069 / 1_000_000) * 0.2, 10);
    expect(cost.cache_write_cost).toBeCloseTo((24802 / 1_000_000) * 2.5, 10);
    expect(cost.total_cost).toBeCloseTo(0.0000040 + 0.00049 + 0.0112138 + 0.062005, 6);

    // 回退之前：响应模型取不到价，整条请求（含 8 万缓存 token）都按 0 计费。
    expect(calculateCostWithPricing(usage, null, 'anthropic').total_cost).toBe(0);
  });
});

describe('日志详情的价格详情面板', () => {
  const usage = {
    model: 'openclaw',
    input_tokens: 2,
    output_tokens: 49,
    cache_creation_input_tokens: 24802,
    cache_read_input_tokens: 56069,
    cost: 0.0737128,
    cost_pricing: SONNET_PRICING,
    cost_pricing_model: 'claude-sonnet-5',
    cost_breakdown: {
      upstream_type: 'anthropic',
      uncached_input_tokens: 2,
      cache_read_tokens: 56069,
      cache_write_tokens: 24802,
      cache_write_5m_tokens: 24802,
      cache_write_1h_tokens: 0,
      input_cost: 0.000004,
      output_cost: 0.00049,
      cache_read_cost: 0.0112138,
      cache_write_cost: 0.062005,
      total_cost: 0.0737128,
      cache_read_price: 0.2,
      cache_write_5m_price: 2.5,
      cache_write_1h_price: 4,
      cache_pricing_derived: false,
    },
  };

  test('列出缓存读写的单价与计算公式，并标出实际计价模型', () => {
    const rows = getCostMetricRows(usage, 'claude-sonnet-5', 'anthropic');
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));

    expect(byLabel.get('模型')).toBe('openclaw');
    expect(byLabel.get('计价模型')).toBe('claude-sonnet-5');
    expect(byLabel.get('模型单价')).toContain('缓存读 $0.20 / 1M');
    expect(byLabel.get('模型单价')).toContain('缓存写 $2.50 / 1M');
    expect(byLabel.get('缓存读公式')).toBe('56,069 × $0.20 / 1M = $0.011214');
    expect(byLabel.get('缓存写公式')).toBe('24,802 × $2.50 / 1M = $0.062005');
    expect(byLabel.get('汇总公式')).toContain('= $0.073713');
  });

  test('没有价格时提示去模型页配置，并点名缺价的模型', () => {
    const rows = getCostMetricRows({ model: 'openclaw', cost: 0 }, 'claude-sonnet-5', 'anthropic');

    expect(rows.find((row) => row.label === '计算公式')?.value).toContain('openclaw');
  });
});
