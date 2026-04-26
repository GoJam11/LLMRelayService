import { describe, expect, it } from 'bun:test';
import { getDatabaseUrl } from '../src/db/config';
import { TEST_DATABASE_URL, isTrustedTestDatabaseUrl } from '../src/db/test-database';
import { validateConfigEntries } from '../src/config';

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
});
