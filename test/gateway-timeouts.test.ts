import { describe, expect, it } from 'bun:test';
import {
  CODE_DEFAULT_GATEWAY_TIMEOUTS,
  isImageRequestPath,
  normalizeGatewayTimeoutSettings,
  selectUpstreamFirstByteTimeoutMs,
} from '../src/gateway-timeouts';

describe('gateway timeout settings', () => {
  it('uses short first-byte timeout for normal requests and long timeout for images', () => {
    const settings = normalizeGatewayTimeoutSettings({}, CODE_DEFAULT_GATEWAY_TIMEOUTS);

    expect(settings.defaultFirstByteTimeoutMs).toBe(30_000);
    expect(settings.imageFirstByteTimeoutMs).toBe(300_000);
    expect(
      selectUpstreamFirstByteTimeoutMs(
        '/v1/chat/completions',
        'https://api.example.com/v1/chat/completions',
        settings,
      ),
    ).toBe(30_000);
    expect(
      selectUpstreamFirstByteTimeoutMs(
        '/v1/images/generations',
        'https://api.example.com/v1/images/generations',
        settings,
      ),
    ).toBe(300_000);
  });

  it('detects image endpoints after explicit provider routing', () => {
    expect(isImageRequestPath(
      '/providers/minimax/v1/images/generations',
      'https://api.minimaxi.com/v1/images/generations',
    )).toBe(true);
    expect(isImageRequestPath(
      '/providers/openai/v1/images/edits',
      'https://api.openai.com/v1/images/edits',
    )).toBe(true);
    expect(isImageRequestPath(
      '/providers/openai/v1/chat/completions',
      'https://api.openai.com/v1/chat/completions',
    )).toBe(false);
  });

  it('validates timeout ranges', () => {
    expect(() => normalizeGatewayTimeoutSettings({
      defaultFirstByteTimeoutMs: 999,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS)).toThrow('defaultFirstByteTimeoutMs');
    expect(() => normalizeGatewayTimeoutSettings({
      imageFirstByteTimeoutMs: 901_000,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS)).toThrow('imageFirstByteTimeoutMs');
    expect(normalizeGatewayTimeoutSettings({
      responseIdleTimeoutMs: 0,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS).responseIdleTimeoutMs).toBe(0);
  });
});
