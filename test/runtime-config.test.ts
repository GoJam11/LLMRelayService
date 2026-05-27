import { describe, expect, it } from 'bun:test';
import { getDatabaseUrl } from '../src/db/config';
import { TEST_DATABASE_URL, isTrustedTestDatabaseUrl } from '../src/db/test-database';
import { loadProviderConfigsForTest, resetProviderConfigCache, resolveRoutesByModel, resolveRoutesForAnyModelFallback, resolveRoutesForFallbackModels, validateConfigEntries } from '../src/config';

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

  it('resolves custom fallback model candidates in configured model order', () => {
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
    const routes = resolveRoutesForFallbackModels('/v1/chat/completions', '', ['gpt-4o-mini', 'deepseek-chat', 'claude-ignored'], 'openai');
    resetProviderConfigCache();

    expect(routes.map((route) => `${route.channelName}:${route.resolvedModel}`)).toEqual([
      'miniHigh:gpt-4o-mini',
      'miniLow:gpt-4o-mini',
      'deepseek:deepseek-chat',
    ]);
  });
});
