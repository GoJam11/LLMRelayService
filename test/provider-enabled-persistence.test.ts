import { afterEach, describe, expect, it } from 'bun:test';
import { createProvider, deleteProvider, getProviderInfo, resetProviderConfigCache, toggleProvider, updateProvider } from '../src/config';

const CHANNEL = 'test-enabled-persistence';

async function removeChannel(channelName: string): Promise<void> {
  try {
    await deleteProvider(channelName);
  } catch {
    // 渠道不存在时忽略
  }
}

afterEach(async () => {
  await removeChannel(CHANNEL);
  await removeChannel(`${CHANNEL}-renamed`);
  resetProviderConfigCache();
});

describe('provider enabled persistence', () => {
  it('keeps a channel disabled when the edit form is saved without enabled', async () => {
    await createProvider({
      channelName: CHANNEL,
      type: 'openai',
      targetBaseUrl: 'https://example.com/v1',
      models: ['gpt-test'],
    });
    await toggleProvider(CHANNEL, false);
    expect(getProviderInfo(CHANNEL)?.enabled).toBe(false);

    // 控制台保存按钮提交的 payload 不含 enabled。
    const updated = await updateProvider(CHANNEL, {
      channelName: CHANNEL,
      type: 'openai',
      targetBaseUrl: 'https://example.com/v1',
      models: ['gpt-test', 'gpt-test-2'],
      priority: 3,
    });

    expect(updated.enabled).toBe(false);
    expect(getProviderInfo(CHANNEL)?.enabled).toBe(false);
  });

  it('keeps the disabled state across a rename', async () => {
    await createProvider({
      channelName: CHANNEL,
      type: 'openai',
      targetBaseUrl: 'https://example.com/v1',
      models: ['gpt-test'],
    });
    await toggleProvider(CHANNEL, false);

    const updated = await updateProvider(CHANNEL, {
      channelName: `${CHANNEL}-renamed`,
      type: 'openai',
      targetBaseUrl: 'https://example.com/v1',
      models: ['gpt-test'],
    });

    expect(updated.enabled).toBe(false);
    expect(getProviderInfo(`${CHANNEL}-renamed`)?.enabled).toBe(false);
  });

  it('honors an explicit enabled flag in the payload', async () => {
    await createProvider({
      channelName: CHANNEL,
      type: 'openai',
      targetBaseUrl: 'https://example.com/v1',
      models: ['gpt-test'],
      enabled: false,
    });
    expect(getProviderInfo(CHANNEL)?.enabled).toBe(false);

    const updated = await updateProvider(CHANNEL, { enabled: true });
    expect(updated.enabled).toBe(true);
  });
});
