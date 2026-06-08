import { describe, expect, it } from 'bun:test';
import { getDatabaseUrl } from '../src/db/config';
import { TEST_DATABASE_URL, isTrustedTestDatabaseUrl } from '../src/db/test-database';
import { getModels, loadModelAliasesForTest, loadProviderConfigsForTest, resetProviderConfigCache, resolveRoutesByModel, resolveRoutesForAnyModelFallback, resolveRoutesForFallbackModels, validateConfigEntries } from '../src/config';

describe('runtime config', () => {
  it('uses TEST_DATABASE_URL env var when running under bun test', () => {
    expect(getDatabaseUrl()).toBe(TEST_DATABASE_URL);
    expect(isTrustedTestDatabaseUrl(getDatabaseUrl())).toBe(true);
  });

  it('rejects removed fallback config', () => {
    expect(() => validateConfigEntries({
      primary: {
        type: 'anthropic',
        targetBaseUrl: 'https://example.com',
        fallbacks: ['secondary'],
      } as any,
    })).toThrow('Route "primary" uses removed field "fallbacks"; failover has been removed.');
  });

  it('normalizes OpenAI responses handling mode', () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://example.com/v1',
        responsesMode: 'chat_compat',
        extraFields: { vendor: 'internal' },
      } as any,
    });

    expect(configs.primary?.responsesMode).toBe('chat_compat');
    expect(configs.primary?.extraFields).toEqual({
      vendor: 'internal',
      responsesMode: 'chat_compat',
    });
  });

  it('orders model fallback candidates by priority and skips disabled providers', () => {
    const configs = validateConfigEntries({
      secondary: {
        type: 'openai',
        targetBaseUrl: 'https://secondary.example.com/v1',
        models: ['gpt-4o'],
        priority: 10,
      },
      disabled: {
        type: 'openai',
        targetBaseUrl: 'https://disabled.example.com/v1',
        models: ['gpt-4o'],
        priority: 20,
        enabled: false,
      },
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://primary.example.com/v1',
        models: ['gpt-4o'],
        priority: 30,
      },
    } as any);

    loadProviderConfigsForTest(configs);
    const routes = resolveRoutesByModel('/v1/chat/completions', '', 'gpt-4o');
    resetProviderConfigCache();

    expect(routes.map((route) => route.channelName)).toEqual(['primary', 'secondary']);
    expect(routes.map((route) => route.targetUrl)).toEqual([
      'https://primary.example.com/v1/chat/completions',
      'https://secondary.example.com/v1/chat/completions',
    ]);
  });

  it('treats model aliases as virtual models instead of expanding their target model', () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://primary.example.com/v1',
        models: ['gpt-4o'],
        priority: 30,
        providerUuid: 'provider-primary',
      },
      secondary: {
        type: 'openai',
        targetBaseUrl: 'https://secondary.example.com/v1',
        models: ['gpt-4o'],
        priority: 20,
      },
    } as any);

    loadProviderConfigsForTest(configs);
    loadModelAliasesForTest({ fast: { provider: 'provider-primary', model: 'gpt-4o' } });
    const routes = resolveRoutesByModel('/v1/chat/completions', '', 'fast');
    resetProviderConfigCache();

    expect(routes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual([
      'primary:gpt-4o',
    ]);
  });

  it('keeps explicit-only providers out of direct model routing but allows virtual routes to target them', () => {
    const configs = validateConfigEntries({
      official: {
        type: 'openai',
        targetBaseUrl: 'https://official.example.com/v1',
        models: ['gpt-5.5'],
        priority: 30,
      },
      cheap: {
        type: 'openai',
        targetBaseUrl: 'https://cheap.example.com/v1',
        models: ['gpt-5.5'],
        priority: 100,
        routingVisibility: 'explicit_only',
        providerUuid: 'provider-cheap',
      },
    } as any);

    loadProviderConfigsForTest(configs);
    loadModelAliasesForTest({ third: { provider: 'provider-cheap', model: 'gpt-5.5', targets: [{ provider: 'provider-cheap', model: 'gpt-5.5' }] } });
    const directRoutes = resolveRoutesByModel('/v1/chat/completions', '', 'gpt-5.5');
    const virtualRoutes = resolveRoutesByModel('/v1/chat/completions', '', 'third');
    const models = getModels();
    resetProviderConfigCache();

    expect(directRoutes.map((route) => `${route.channelName}:${route.resolvedModel ?? 'direct'}`)).toEqual(['official:direct']);
    expect(virtualRoutes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual(['cheap:gpt-5.5']);
    expect(models.map((model) => model.id).sort()).toEqual(['gpt-5.5', 'third']);
  });

  it('excludes explicit-only providers from site-wide fallback but permits explicit custom targets', () => {
    const configs = validateConfigEntries({
      direct: {
        type: 'openai',
        targetBaseUrl: 'https://direct.example.com/v1',
        models: ['gpt-4o'],
      },
      backend: {
        type: 'openai',
        targetBaseUrl: 'https://backend.example.com/v1',
        models: ['gpt-4o'],
        routingVisibility: 'explicit_only',
      },
    } as any);

    loadProviderConfigsForTest(configs);
    const sameModel = resolveRoutesByModel('/v1/chat/completions', '', 'gpt-4o');
    const anyModel = resolveRoutesForAnyModelFallback('/v1/chat/completions', '', 'openai');
    const custom = resolveRoutesForFallbackModels('/v1/chat/completions', '', ['backend:gpt-4o'], 'openai');
    resetProviderConfigCache();

    expect(sameModel.map((route) => route.channelName)).toEqual(['direct']);
    expect(anyModel.map((route) => route.channelName)).toEqual(['direct']);
    expect(custom.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual(['backend:gpt-4o']);
  });

  it('builds whole-site model fallback candidates without binding to the requested model name', () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://primary.example.com/v1',
        models: ['gpt-4o'],
        priority: 30,
      },
      backup: {
        type: 'openai',
        targetBaseUrl: 'https://backup.example.com/v1',
        models: ['gpt-4o-mini', 'deepseek-chat'],
        priority: 10,
      },
    } as any);

    loadProviderConfigsForTest(configs);
    const routes = resolveRoutesForAnyModelFallback('/v1/chat/completions', '', 'openai');
    resetProviderConfigCache();

    expect(routes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual([
      'primary:gpt-4o',
      'backup:gpt-4o-mini',
      'backup:deepseek-chat',
    ]);
  });

  it('resolves custom fallback model candidates by explicit channel and model', () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://primary.example.com/v1',
        models: ['gpt-4o'],
        priority: 30,
      },
      miniHigh: {
        type: 'openai',
        targetBaseUrl: 'https://mini-high.example.com/v1',
        models: ['gpt-4o-mini'],
        priority: 20,
      },
      miniLow: {
        type: 'openai',
        targetBaseUrl: 'https://mini-low.example.com/v1',
        models: ['gpt-4o-mini'],
        priority: 10,
      },
      deepseek: {
        type: 'openai',
        targetBaseUrl: 'https://deepseek.example.com/v1',
        models: ['deepseek-chat'],
        priority: 100,
      },
      disabled: {
        type: 'openai',
        targetBaseUrl: 'https://disabled.example.com/v1',
        models: ['claude-ignored'],
        priority: 200,
        enabled: false,
      },
    } as any);

    loadProviderConfigsForTest(configs);
    const routes = resolveRoutesForFallbackModels('/v1/chat/completions', '', ['miniLow:gpt-4o-mini', 'deepseek:deepseek-chat', 'disabled:claude-ignored'], 'openai');
    resetProviderConfigCache();

    expect(routes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual([
      'miniLow:gpt-4o-mini',
      'deepseek:deepseek-chat',
    ]);
  });

  it('does not expand custom fallback bare model names across providers', () => {
    const configs = validateConfigEntries({
      miniHigh: {
        type: 'openai',
        targetBaseUrl: 'https://mini-high.example.com/v1',
        models: ['gpt-4o-mini'],
        priority: 20,
      },
      miniLow: {
        type: 'openai',
        targetBaseUrl: 'https://mini-low.example.com/v1',
        models: ['gpt-4o-mini'],
        priority: 10,
      },
    } as any);

    loadProviderConfigsForTest(configs);
    const routes = resolveRoutesForFallbackModels('/v1/chat/completions', '', ['gpt-4o-mini'], 'openai');
    resetProviderConfigCache();

    expect(routes).toEqual([]);
  });

  it('resolves custom fallback candidates through model aliases', () => {
    const configs = validateConfigEntries({
      primary: {
        type: 'openai',
        targetBaseUrl: 'https://primary.example.com/v1',
        models: ['gpt-4o'],
        priority: 30,
        providerUuid: 'provider-primary',
      },
      backup: {
        type: 'openai',
        targetBaseUrl: 'https://backup.example.com/v1',
        models: ['gpt-4o-mini'],
        priority: 10,
        providerUuid: 'provider-backup',
      },
    } as any);

    loadProviderConfigsForTest(configs);
    loadModelAliasesForTest({ mini: { provider: 'provider-backup', model: 'gpt-4o-mini' } });
    const routes = resolveRoutesForFallbackModels('/v1/chat/completions', '', ['mini'], 'openai');
    resetProviderConfigCache();

    expect(routes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual([
      'backup:gpt-4o-mini',
    ]);
    expect(routes[0]?.targetUrl).toBe('https://backup.example.com/v1/chat/completions');
  });
});
