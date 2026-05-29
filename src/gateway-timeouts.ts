import { eq } from 'drizzle-orm';
import { createDbClient, type DbClient } from './db/client';
import { gatewaySettings } from './db/schema';

export interface GatewayTimeoutSettings {
  defaultFirstByteTimeoutMs: number;
  imageFirstByteTimeoutMs: number;
  responseIdleTimeoutMs: number;
}

export interface TimeoutLimit {
  minMs: number;
  maxMs: number;
  allowZero?: boolean;
}

export type GatewayTimeoutSettingsView = GatewayTimeoutSettings & {
  defaults: GatewayTimeoutSettings;
  limits: {
    firstByte: TimeoutLimit;
    responseIdle: TimeoutLimit;
  };
  updatedAt: number | null;
};

type GatewayTimeoutSettingsInput = Partial<GatewayTimeoutSettings>;

const SETTINGS_KEY = 'gateway.timeouts';
const SETTINGS_CACHE_TTL_MS = 5_000;
const SETTINGS_WARNING_INTERVAL_MS = 60_000;

export const CODE_DEFAULT_GATEWAY_TIMEOUTS: GatewayTimeoutSettings = {
  defaultFirstByteTimeoutMs: 30_000,
  imageFirstByteTimeoutMs: 300_000,
  responseIdleTimeoutMs: 300_000,
};

export const GATEWAY_TIMEOUT_LIMITS = {
  firstByte: {
    minMs: 1_000,
    maxMs: 900_000,
  },
  responseIdle: {
    minMs: 0,
    maxMs: 3_600_000,
    allowZero: true,
  },
} satisfies GatewayTimeoutSettingsView['limits'];

let db: DbClient | null = null;
let cachedSettings: GatewayTimeoutSettingsView | null = null;
let cachedSettingsLoadedAt = 0;
let lastSettingsWarningAt = 0;

function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return undefined;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readNonNegativeIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return undefined;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function getGatewayTimeoutDefaults(): GatewayTimeoutSettings {
  return {
    defaultFirstByteTimeoutMs:
      readPositiveIntegerEnv('UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS')
      ?? readPositiveIntegerEnv('UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS')
      ?? CODE_DEFAULT_GATEWAY_TIMEOUTS.defaultFirstByteTimeoutMs,
    imageFirstByteTimeoutMs:
      readPositiveIntegerEnv('UPSTREAM_IMAGE_FIRST_BYTE_TIMEOUT_MS')
      ?? readPositiveIntegerEnv('UPSTREAM_REQUEST_TIMEOUT_MS')
      ?? CODE_DEFAULT_GATEWAY_TIMEOUTS.imageFirstByteTimeoutMs,
    responseIdleTimeoutMs:
      readNonNegativeIntegerEnv('UPSTREAM_RESPONSE_IDLE_TIMEOUT_MS')
      ?? CODE_DEFAULT_GATEWAY_TIMEOUTS.responseIdleTimeoutMs,
  };
}

function assertTimeoutInRange(value: number, fieldName: keyof GatewayTimeoutSettings, limits: TimeoutLimit): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }

  const normalized = Math.trunc(value);
  const tooSmall = limits.allowZero
    ? normalized < limits.minMs
    : normalized < limits.minMs;
  if (tooSmall || normalized > limits.maxMs) {
    throw new Error(`${fieldName} must be between ${limits.minMs}ms and ${limits.maxMs}ms`);
  }

  return normalized;
}

export function normalizeGatewayTimeoutSettings(
  input: GatewayTimeoutSettingsInput,
  defaults = getGatewayTimeoutDefaults(),
): GatewayTimeoutSettings {
  return {
    defaultFirstByteTimeoutMs: assertTimeoutInRange(
      input.defaultFirstByteTimeoutMs ?? defaults.defaultFirstByteTimeoutMs,
      'defaultFirstByteTimeoutMs',
      GATEWAY_TIMEOUT_LIMITS.firstByte,
    ),
    imageFirstByteTimeoutMs: assertTimeoutInRange(
      input.imageFirstByteTimeoutMs ?? defaults.imageFirstByteTimeoutMs,
      'imageFirstByteTimeoutMs',
      GATEWAY_TIMEOUT_LIMITS.firstByte,
    ),
    responseIdleTimeoutMs: assertTimeoutInRange(
      input.responseIdleTimeoutMs ?? defaults.responseIdleTimeoutMs,
      'responseIdleTimeoutMs',
      GATEWAY_TIMEOUT_LIMITS.responseIdle,
    ),
  };
}

function buildSettingsView(
  input: GatewayTimeoutSettingsInput,
  updatedAt: number | null,
  defaults = getGatewayTimeoutDefaults(),
): GatewayTimeoutSettingsView {
  return {
    ...normalizeGatewayTimeoutSettings(input, defaults),
    defaults,
    limits: GATEWAY_TIMEOUT_LIMITS,
    updatedAt,
  };
}

function parseStoredSettings(valueJson: string): GatewayTimeoutSettingsInput {
  if (!valueJson.trim()) return {};

  const parsed = JSON.parse(valueJson) as Record<string, unknown>;
  return {
    defaultFirstByteTimeoutMs:
      typeof parsed.defaultFirstByteTimeoutMs === 'number'
        ? parsed.defaultFirstByteTimeoutMs
        : undefined,
    imageFirstByteTimeoutMs:
      typeof parsed.imageFirstByteTimeoutMs === 'number'
        ? parsed.imageFirstByteTimeoutMs
        : undefined,
    responseIdleTimeoutMs:
      typeof parsed.responseIdleTimeoutMs === 'number'
        ? parsed.responseIdleTimeoutMs
        : undefined,
  };
}

function warnSettingsFallback(error: unknown): void {
  const now = Date.now();
  if (now - lastSettingsWarningAt < SETTINGS_WARNING_INTERVAL_MS) return;
  lastSettingsWarningAt = now;
  console.warn('[GATEWAY_TIMEOUT_SETTINGS_FALLBACK]', error instanceof Error ? error.message : String(error));
}

export function clearGatewayTimeoutSettingsCache(): void {
  cachedSettings = null;
  cachedSettingsLoadedAt = 0;
}

export async function getGatewayTimeoutSettings(): Promise<GatewayTimeoutSettingsView> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const rows = await getDb()
      .select()
      .from(gatewaySettings)
      .where(eq(gatewaySettings.key, SETTINGS_KEY))
      .limit(1);

    const row = rows[0];
    const view = row
      ? buildSettingsView(parseStoredSettings(row.valueJson), row.updatedAt)
      : buildSettingsView({}, null);

    cachedSettings = view;
    cachedSettingsLoadedAt = now;
    return view;
  } catch (error) {
    warnSettingsFallback(error);
    if (cachedSettings) return cachedSettings;
    return buildSettingsView({}, null);
  }
}

export async function updateGatewayTimeoutSettings(input: GatewayTimeoutSettingsInput): Promise<GatewayTimeoutSettingsView> {
  const defaults = getGatewayTimeoutDefaults();
  const settings = normalizeGatewayTimeoutSettings(input, defaults);
  const updatedAt = Date.now();

  await getDb()
    .insert(gatewaySettings)
    .values({
      key: SETTINGS_KEY,
      valueJson: JSON.stringify(settings),
      updatedAt,
    })
    .onConflictDoUpdate({
      target: gatewaySettings.key,
      set: {
        valueJson: JSON.stringify(settings),
        updatedAt,
      },
    });

  cachedSettings = buildSettingsView(settings, updatedAt, defaults);
  cachedSettingsLoadedAt = updatedAt;
  return cachedSettings;
}

export function isImageRequestPath(pathname: string, targetUrl?: string): boolean {
  const candidates = [pathname];

  if (targetUrl) {
    try {
      candidates.push(new URL(targetUrl).pathname);
    } catch {
      candidates.push(targetUrl);
    }
  }

  return candidates.some((candidate) => {
    const normalized = candidate.toLowerCase();
    return (
      normalized.includes('/images/generations')
      || normalized.includes('/images/edits')
      || normalized.includes('/images/variations')
    );
  });
}

export function selectUpstreamFirstByteTimeoutMs(
  pathname: string,
  targetUrl: string,
  settings: GatewayTimeoutSettings,
): number {
  return isImageRequestPath(pathname, targetUrl)
    ? settings.imageFirstByteTimeoutMs
    : settings.defaultFirstByteTimeoutMs;
}

/**
 * Test-only: directly inject timeout settings into the cache, bypassing validation
 * and the database. Allows sub-minimum timeouts for fast timeout tests.
 * Throws if called outside of a test environment.
 */
export function forceTimeoutSettingsForTest(settings: GatewayTimeoutSettings): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('forceTimeoutSettingsForTest is only available while running tests');
  }
  cachedSettings = {
    ...settings,
    defaults: getGatewayTimeoutDefaults(),
    limits: GATEWAY_TIMEOUT_LIMITS,
    updatedAt: null,
  };
  cachedSettingsLoadedAt = Date.now();
}
