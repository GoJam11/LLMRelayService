/**
 * Zero Data Retention (ZDR) settings and effective-scope resolution.
 *
 * ZDR is a platform-wide privacy setting, ON by default. When active for a
 * given request:
 *   - only providers/models explicitly flagged as ZDR-capable may be routed to
 *   - prompt/response content must never reach any logger, cache, or
 *     analytics/observability path (see zdr-log-redaction.ts)
 *
 * Scoping (most restrictive wins):
 *   1. Global      - account/instance-wide default (this module, gatewaySettings key)
 *   2. Model group - per model-alias override (modelAliases.zdrOverride)
 *   3. Guardrail   - per-provider/routing-policy override (consoleProviders.zdrOverride)
 *   4. Per-request - override header/param; can only make a request MORE strict,
 *                    never loosen a stricter org/guardrail-level setting
 */
import { eq } from 'drizzle-orm';
import { createDbClient, type DbClient } from './db/client';
import { gatewaySettings } from './db/schema';

const SETTINGS_KEY = 'zdr.global';
const SETTINGS_CACHE_TTL_MS = 5_000;

/** ZDR defaults ON for every account/org/API key with no explicit configuration. */
export const ZDR_DEFAULT_ENABLED = true;

export interface ZdrGlobalSettings {
  enabled: boolean;
}

export type ZdrOverride = true | false | null | undefined;

export interface ZdrScopeInputs {
  /** Global/account-level setting (defaults to ON). */
  global: boolean;
  /** Per model-group (model alias) override, if any. */
  modelGroupOverride?: ZdrOverride;
  /** Per guardrail/policy-group (provider) override, if any. */
  guardrailOverride?: ZdrOverride;
  /** Per-request override supplied by the caller (header/param). */
  requestOverride?: ZdrOverride;
}

let db: DbClient | null = null;
let cached: { settings: ZdrGlobalSettings; updatedAt: number | null } | null = null;
let cachedAt = 0;

function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

export function clearZdrSettingsCache(): void {
  cached = null;
  cachedAt = 0;
}

export async function getZdrGlobalSettings(): Promise<{ settings: ZdrGlobalSettings; updatedAt: number | null }> {
  const now = Date.now();
  if (cached && now - cachedAt < SETTINGS_CACHE_TTL_MS) return cached;

  const rows = await getDb()
    .select()
    .from(gatewaySettings)
    .where(eq(gatewaySettings.key, SETTINGS_KEY))
    .limit(1);

  const row = rows[0];
  if (!row) {
    cached = { settings: { enabled: ZDR_DEFAULT_ENABLED }, updatedAt: null };
    cachedAt = now;
    return cached;
  }

  let enabled = ZDR_DEFAULT_ENABLED;
  try {
    const parsed = JSON.parse(row.valueJson) as Partial<ZdrGlobalSettings>;
    if (typeof parsed.enabled === 'boolean') enabled = parsed.enabled;
  } catch {
    // Corrupt/legacy value: fail safe to the ZDR-on default.
  }

  cached = { settings: { enabled }, updatedAt: row.updatedAt };
  cachedAt = now;
  return cached;
}

/**
 * Persists the global ZDR flag. Callers are responsible for the password
 * re-entry / privileged-token gate before invoking this to *disable* ZDR
 * (see zdr-privileged-token.ts) and for writing the audit log entry.
 */
export async function setZdrGlobalEnabled(enabled: boolean): Promise<{ settings: ZdrGlobalSettings; updatedAt: number }> {
  const updatedAt = Date.now();
  const settings: ZdrGlobalSettings = { enabled };

  await getDb()
    .insert(gatewaySettings)
    .values({ key: SETTINGS_KEY, valueJson: JSON.stringify(settings), updatedAt })
    .onConflictDoUpdate({
      target: gatewaySettings.key,
      set: { valueJson: JSON.stringify(settings), updatedAt },
    });

  cached = { settings, updatedAt };
  cachedAt = updatedAt;
  return { settings, updatedAt };
}

/**
 * Resolves the effective ZDR flag for a single request from the four scope
 * levels. ZDR being "on" (true) is always the more restrictive state, so the
 * effective result is the logical OR across all defined levels: any level
 * that requires ZDR wins, and a looser per-request override can never turn
 * ZDR off if a stricter global/model-group/guardrail setting has it on.
 */
export function resolveEffectiveZdr(inputs: ZdrScopeInputs): boolean {
  if (inputs.global) return true;
  return (
    inputs.modelGroupOverride === true
    || inputs.guardrailOverride === true
    || inputs.requestOverride === true
  );
}

/** Parses a stored `0|1|null` override column value into a tri-state ZdrOverride. */
export function parseZdrOverrideColumn(value: number | null | undefined): ZdrOverride {
  if (value == null) return null;
  return value === 1;
}

/** Parses the per-request override header value (`"true"` / `"false"`), if present. */
export function parseZdrRequestOverrideHeader(value: string | null | undefined): ZdrOverride {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

export const ZDR_REQUEST_OVERRIDE_HEADER = 'x-zdr-override';
