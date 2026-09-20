import { describe, expect, it } from 'bun:test';
import { matchPreset, PRESET_CHANNELS } from '../console/ai-proxy-dashboard/src/features/dashboard/components/providers-page';

describe('preset channels', () => {
  it('includes CommandCode in PRESET_CHANNELS without duplicate ids', () => {
    const ids = PRESET_CHANNELS.map((preset) => preset.id);
    expect(ids).toContain('commandcode');

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('matches CommandCode preset by type and baseUrl', () => {
    const matched = matchPreset('openai', 'https://api.commandcode.ai/provider/v1');
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe('commandcode');
    expect(matched?.label).toBe('CommandCode');
    expect(matched?.suggestedName).toBe('commandcode');
    expect(matched?.type).toBe('openai');
    expect(matched?.baseUrl).toBe('https://api.commandcode.ai/provider/v1');
  });

  it('matches CommandCode preset with trailing slash and case-insensitivity', () => {
    const matched = matchPreset('openai', 'HTTPS://API.COMMANDCODE.AI/PROVIDER/V1/');
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe('commandcode');
  });
});
