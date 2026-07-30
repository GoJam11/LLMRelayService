import { describe, expect, it } from 'bun:test';
import { filterCandidatesForZdr } from '../src/zdr-provider-filter';

describe('filterCandidatesForZdr', () => {
  const candidates = [
    { channelName: 'openai-main' },
    { channelName: 'anthropic-eu' },
    { channelName: 'random-vendor' },
  ];

  const capabilities = [
    { channelName: 'openai-main', zdrCapable: true },
    { channelName: 'anthropic-eu', zdrCapable: false },
    { channelName: 'random-vendor', zdrCapable: false },
  ];

  it('passes all candidates through unchanged when ZDR is not active', () => {
    expect(filterCandidatesForZdr(candidates, false, capabilities)).toEqual(candidates);
  });

  it('keeps only ZDR-capable providers when ZDR is active', () => {
    const result = filterCandidatesForZdr(candidates, true, capabilities);
    expect(result).toEqual([{ channelName: 'openai-main' }]);
  });

  it('excludes candidates with no capability record at all when ZDR is active', () => {
    const result = filterCandidatesForZdr(candidates, true, [
      { channelName: 'openai-main', zdrCapable: true },
    ]);
    expect(result).toEqual([{ channelName: 'openai-main' }]);
  });

  it('returns an empty list when ZDR is active and no candidate is capable', () => {
    const result = filterCandidatesForZdr(candidates, true, [
      { channelName: 'openai-main', zdrCapable: false },
    ]);
    expect(result).toEqual([]);
  });
});
