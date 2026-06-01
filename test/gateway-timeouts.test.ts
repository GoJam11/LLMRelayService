import { afterEach, describe, expect, it } from 'bun:test';
import {
  CODE_DEFAULT_GATEWAY_TIMEOUTS,
  getGatewayTimeoutDefaults,
  isImageRequestPath,
  normalizeGatewayTimeoutSettings,
  selectUpstreamFirstByteTimeoutMs,
} from '../src/gateway-timeouts';

describe('gateway timeout settings', () => {
  afterEach(() => {
    delete process.env.UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS;
    delete process.env.UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS;
    delete process.env.UPSTREAM_IMAGE_FIRST_BYTE_TIMEOUT_MS;
    delete process.env.UPSTREAM_REQUEST_TIMEOUT_MS;
    delete process.env.UPSTREAM_RESPONSE_IDLE_TIMEOUT_MS;
  });

  it('uses separate first-byte timeouts for normal, streaming, and image requests', () => {
    const settings = normalizeGatewayTimeoutSettings({}, CODE_DEFAULT_GATEWAY_TIMEOUTS);

    expect(settings.defaultFirstByteTimeoutMs).toBe(300_000);
    expect(settings.streamFirstByteTimeoutMs).toBe(30_000);
    expect(settings.imageFirstByteTimeoutMs).toBe(300_000);
    expect(
      selectUpstreamFirstByteTimeoutMs(
        '/v1/chat/completions',
        'https://api.example.com/v1/chat/completions',
        settings,
      ),
    ).toBe(300_000);
    expect(
      selectUpstreamFirstByteTimeoutMs(
        '/v1/chat/completions',
        'https://api.example.com/v1/chat/completions',
        settings,
        true,
      ),
    ).toBe(30_000);
    expect(
      selectUpstreamFirstByteTimeoutMs(
        '/v1/images/generations',
        'https://api.example.com/v1/images/generations',
        settings,
        true,
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

  it('keeps legacy UPSTREAM_REQUEST_TIMEOUT_MS as a first-byte timeout fallback', () => {
    process.env.UPSTREAM_REQUEST_TIMEOUT_MS = '180000';

    expect(getGatewayTimeoutDefaults()).toEqual({
      defaultFirstByteTimeoutMs: 180_000,
      streamFirstByteTimeoutMs: 180_000,
      imageFirstByteTimeoutMs: 180_000,
      responseIdleTimeoutMs: 300_000,
    });
  });

  it('prefers split first-byte timeout env vars over the legacy fallback', () => {
    process.env.UPSTREAM_REQUEST_TIMEOUT_MS = '180000';
    process.env.UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS = '300000';
    process.env.UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS = '30000';
    process.env.UPSTREAM_IMAGE_FIRST_BYTE_TIMEOUT_MS = '600000';

    expect(getGatewayTimeoutDefaults()).toEqual({
      defaultFirstByteTimeoutMs: 300_000,
      streamFirstByteTimeoutMs: 30_000,
      imageFirstByteTimeoutMs: 600_000,
      responseIdleTimeoutMs: 300_000,
    });
  });

  it('validates timeout ranges', () => {
    expect(() => normalizeGatewayTimeoutSettings({
      defaultFirstByteTimeoutMs: 999,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS)).toThrow('defaultFirstByteTimeoutMs');
    expect(() => normalizeGatewayTimeoutSettings({
      streamFirstByteTimeoutMs: 999,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS)).toThrow('streamFirstByteTimeoutMs');
    expect(() => normalizeGatewayTimeoutSettings({
      imageFirstByteTimeoutMs: 901_000,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS)).toThrow('imageFirstByteTimeoutMs');
    expect(normalizeGatewayTimeoutSettings({
      responseIdleTimeoutMs: 0,
    }, CODE_DEFAULT_GATEWAY_TIMEOUTS).responseIdleTimeoutMs).toBe(0);
  });
});
