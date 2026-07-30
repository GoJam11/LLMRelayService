import { describe, expect, it } from 'bun:test';
import {
  parseZdrOverrideColumn,
  parseZdrRequestOverrideHeader,
  resolveEffectiveZdr,
  ZDR_DEFAULT_ENABLED,
} from '../src/zdr-settings';

describe('ZDR default state', () => {
  it('is on by default', () => {
    expect(ZDR_DEFAULT_ENABLED).toBe(true);
  });
});

describe('resolveEffectiveZdr (most-restrictive-wins)', () => {
  it('is active when global default is on and nothing else is set', () => {
    expect(resolveEffectiveZdr({ global: true })).toBe(true);
  });

  it('is inactive when global is off and no scope enables it', () => {
    expect(resolveEffectiveZdr({ global: false })).toBe(false);
  });

  it('a model-group override can turn ZDR on even if global is off', () => {
    expect(resolveEffectiveZdr({ global: false, modelGroupOverride: true })).toBe(true);
  });

  it('a guardrail (provider) override can turn ZDR on even if global is off', () => {
    expect(resolveEffectiveZdr({ global: false, guardrailOverride: true })).toBe(true);
  });

  it('a per-request override can turn ZDR on even if nothing else requires it', () => {
    expect(resolveEffectiveZdr({ global: false, requestOverride: true })).toBe(true);
  });

  it('a looser per-request override cannot turn ZDR off when the global default is on', () => {
    expect(resolveEffectiveZdr({ global: true, requestOverride: false })).toBe(true);
  });

  it('a looser per-request override cannot turn ZDR off when a model-group override is on', () => {
    expect(resolveEffectiveZdr({ global: false, modelGroupOverride: true, requestOverride: false })).toBe(true);
  });

  it('a looser per-request override cannot turn ZDR off when a guardrail override is on', () => {
    expect(resolveEffectiveZdr({ global: false, guardrailOverride: true, requestOverride: false })).toBe(true);
  });

  it('a looser model-group/guardrail override cannot turn ZDR off when the global default is on', () => {
    expect(resolveEffectiveZdr({
      global: true,
      modelGroupOverride: false,
      guardrailOverride: false,
      requestOverride: false,
    })).toBe(true);
  });
});

describe('parseZdrOverrideColumn', () => {
  it('maps null/undefined to null (inherit)', () => {
    expect(parseZdrOverrideColumn(null)).toBeNull();
    expect(parseZdrOverrideColumn(undefined)).toBeNull();
  });

  it('maps 1 to true and 0 to false', () => {
    expect(parseZdrOverrideColumn(1)).toBe(true);
    expect(parseZdrOverrideColumn(0)).toBe(false);
  });
});

describe('parseZdrRequestOverrideHeader', () => {
  it('maps missing header to null', () => {
    expect(parseZdrRequestOverrideHeader(null)).toBeNull();
    expect(parseZdrRequestOverrideHeader(undefined)).toBeNull();
  });

  it('parses true/1 as true and false/0 as false, case-insensitively', () => {
    expect(parseZdrRequestOverrideHeader('true')).toBe(true);
    expect(parseZdrRequestOverrideHeader('TRUE')).toBe(true);
    expect(parseZdrRequestOverrideHeader('1')).toBe(true);
    expect(parseZdrRequestOverrideHeader('false')).toBe(false);
    expect(parseZdrRequestOverrideHeader('0')).toBe(false);
  });

  it('treats unrecognized values as null (inherit)', () => {
    expect(parseZdrRequestOverrideHeader('garbage')).toBeNull();
    expect(parseZdrRequestOverrideHeader('')).toBeNull();
  });
});
