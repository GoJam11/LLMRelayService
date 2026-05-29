import { eq } from 'drizzle-orm';
import { createDbClient, type DbClient } from './db/client';
import { gatewaySettings } from './db/schema';

export type FailoverStatusRange = '5xx';
export type ModelFallbackMode = 'disabled' | 'same_model' | 'any_model';

export interface CustomModelFallbackRule {
  model: string;
  fallbacks: string[];
}

export interface GatewayFailoverPolicy {
  enabled: boolean;
  retryAttempts: number;
  modelFallbackMode: ModelFallbackMode;
  maxFallbackAttempts: number;
  customModelFallbacks: CustomModelFallbackRule[];
  retryOnTimeout: boolean;
  retryOnNetworkError: boolean;
  retryOnStatusCodes: number[];
  retryOnStatusRanges: FailoverStatusRange[];
}

export interface GatewayFailoverPolicyLimits {
  retryAttempts: { min: number; max: number };
  maxFallbackAttempts: { min: number; max: number };
  customModelFallbackRules: { min: number; max: number };
  customModelFallbacksPerRule: { min: number; max: number };
}

export type GatewayFailoverPolicyView = GatewayFailoverPolicy & {
  defaults: GatewayFailoverPolicy;
  limits: GatewayFailoverPolicyLimits;
  updatedAt: number | null;
};

export type GatewayFailoverPolicyInput = Partial<GatewayFailoverPolicy>;

export type FailoverTrigger =
  | { kind: 'timeout' }
  | { kind: 'network_error' }
  | { kind: 'status'; status: number };

const SETTINGS_KEY = 'gateway.failover';
const SETTINGS_CACHE_TTL_MS = 5_000;
const SETTINGS_WARNING_INTERVAL_MS = 60_000;

export const CODE_DEFAULT_GATEWAY_FAILOVER_POLICY: GatewayFailoverPolicy = {
  enabled: true,
  retryAttempts: 1,
  modelFallbackMode: 'same_model',
  maxFallbackAttempts: 2,
  customModelFallbacks: [],
  retryOnTimeout: true,
  retryOnNetworkError: true,
  retryOnStatusCodes: [408, 429],
  retryOnStatusRanges: ['5xx'],
};

export const GATEWAY_FAILOVER_POLICY_LIMITS: GatewayFailoverPolicyLimits = {
  retryAttempts: { min: 0, max: 5 },
  maxFallbackAttempts: { min: 0, max: 20 },
  customModelFallbackRules: { min: 0, max: 100 },
  customModelFallbacksPerRule: { min: 1, max: 50 },
};

let db: DbClient | null = null;
let cachedPolicy: GatewayFailoverPolicyView | null = null;
let cachedPolicyLoadedAt = 0;
let lastPolicyWarningAt = 0;

function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeIntegerInRange(
  value: unknown,
  fallback: number,
  fieldName: keyof Pick<GatewayFailoverPolicy, 'retryAttempts' | 'maxFallbackAttempts'>,
): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number`);
  }

  const normalized = Math.trunc(parsed);
  const limit = GATEWAY_FAILOVER_POLICY_LIMITS[fieldName];
  if (normalized < limit.min || normalized > limit.max) {
    throw new Error(`${fieldName} must be between ${limit.min} and ${limit.max}`);
  }
  return normalized;
}

function normalizeModelFallbackMode(value: unknown, fallback: ModelFallbackMode): ModelFallbackMode {
  if (value == null || value === '') return fallback;
  if (value === 'disabled' || value === 'same_model' || value === 'any_model') {
    return value;
  }
  throw new Error('modelFallbackMode must be disabled, same_model, or any_model');
}

function normalizeStatusCodes(value: unknown, fallback: number[]): number[] {
  if (value == null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new Error('retryOnStatusCodes must be an array');
  }

  const codes = value.map((item) => {
    const status = Number(item);
    if (!Number.isFinite(status) || status < 400 || status > 599) {
      throw new Error('retryOnStatusCodes entries must be HTTP status codes between 400 and 599');
    }
    return Math.trunc(status);
  });
  return Array.from(new Set(codes)).sort((a, b) => a - b);
}

function normalizeStatusRanges(value: unknown, fallback: FailoverStatusRange[]): FailoverStatusRange[] {
  if (value == null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new Error('retryOnStatusRanges must be an array');
  }

  const ranges = value.map((item) => {
    if (item === '5xx') return item;
    throw new Error('retryOnStatusRanges only supports 5xx');
  });
  return Array.from(new Set(ranges));
}

function normalizeModelName(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const model = value.trim();
  if (!model) {
    throw new Error(`${fieldName} must not be empty`);
  }
  return model;
}

function normalizeCustomModelFallbacks(value: unknown, fallback: CustomModelFallbackRule[]): CustomModelFallbackRule[] {
  if (value == null) {
    return fallback.map((rule) => ({ model: rule.model, fallbacks: [...rule.fallbacks] }));
  }
  if (!Array.isArray(value)) {
    throw new Error('customModelFallbacks must be an array');
  }
  if (value.length > GATEWAY_FAILOVER_POLICY_LIMITS.customModelFallbackRules.max) {
    throw new Error(`customModelFallbacks must contain at most ${GATEWAY_FAILOVER_POLICY_LIMITS.customModelFallbackRules.max} rules`);
  }

  const rules = new Map<string, string[]>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`customModelFallbacks[${index}] must be an object`);
    }

    const record = item as Record<string, unknown>;
    const model = normalizeModelName(record.model, `customModelFallbacks[${index}].model`);
    if (!Array.isArray(record.fallbacks)) {
      throw new Error(`customModelFallbacks[${index}].fallbacks must be an array`);
    }

    const normalizedFallbacks = record.fallbacks.map((fallbackModel, fallbackIndex) => (
      normalizeModelName(fallbackModel, `customModelFallbacks[${index}].fallbacks[${fallbackIndex}]`)
    ));
    const dedupedFallbacks = Array.from(new Set(normalizedFallbacks));
    if (dedupedFallbacks.length < GATEWAY_FAILOVER_POLICY_LIMITS.customModelFallbacksPerRule.min) {
      throw new Error(`customModelFallbacks[${index}].fallbacks must include at least one model`);
    }
    if (dedupedFallbacks.length > GATEWAY_FAILOVER_POLICY_LIMITS.customModelFallbacksPerRule.max) {
      throw new Error(`customModelFallbacks[${index}].fallbacks must contain at most ${GATEWAY_FAILOVER_POLICY_LIMITS.customModelFallbacksPerRule.max} models`);
    }

    const current = rules.get(model) ?? [];
    rules.set(model, Array.from(new Set([...current, ...dedupedFallbacks])));
  }

  return Array.from(rules.entries()).map(([model, fallbacks]) => ({ model, fallbacks }));
}

export function normalizeGatewayFailoverPolicy(
  input: GatewayFailoverPolicyInput,
  defaults = CODE_DEFAULT_GATEWAY_FAILOVER_POLICY,
): GatewayFailoverPolicy {
  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    retryAttempts: normalizeIntegerInRange(input.retryAttempts, defaults.retryAttempts, 'retryAttempts'),
    modelFallbackMode: normalizeModelFallbackMode(input.modelFallbackMode, defaults.modelFallbackMode),
    maxFallbackAttempts: normalizeIntegerInRange(input.maxFallbackAttempts, defaults.maxFallbackAttempts, 'maxFallbackAttempts'),
    customModelFallbacks: normalizeCustomModelFallbacks(input.customModelFallbacks, defaults.customModelFallbacks),
    retryOnTimeout: readBoolean(input.retryOnTimeout, defaults.retryOnTimeout),
    retryOnNetworkError: readBoolean(input.retryOnNetworkError, defaults.retryOnNetworkError),
    retryOnStatusCodes: normalizeStatusCodes(input.retryOnStatusCodes, defaults.retryOnStatusCodes),
    retryOnStatusRanges: normalizeStatusRanges(input.retryOnStatusRanges, defaults.retryOnStatusRanges),
  };
}

function buildPolicyView(input: GatewayFailoverPolicyInput, updatedAt: number | null): GatewayFailoverPolicyView {
  return {
    ...normalizeGatewayFailoverPolicy(input),
    defaults: CODE_DEFAULT_GATEWAY_FAILOVER_POLICY,
    limits: GATEWAY_FAILOVER_POLICY_LIMITS,
    updatedAt,
  };
}

function parseStoredPolicy(valueJson: string): GatewayFailoverPolicyInput {
  if (!valueJson.trim()) return {};
  const parsed = JSON.parse(valueJson) as Record<string, unknown>;
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined,
    retryAttempts: typeof parsed.retryAttempts === 'number' ? parsed.retryAttempts : undefined,
    modelFallbackMode: typeof parsed.modelFallbackMode === 'string' ? parsed.modelFallbackMode as ModelFallbackMode : undefined,
    maxFallbackAttempts: typeof parsed.maxFallbackAttempts === 'number' ? parsed.maxFallbackAttempts : undefined,
    customModelFallbacks: Array.isArray(parsed.customModelFallbacks) ? parsed.customModelFallbacks as CustomModelFallbackRule[] : undefined,
    retryOnTimeout: typeof parsed.retryOnTimeout === 'boolean' ? parsed.retryOnTimeout : undefined,
    retryOnNetworkError: typeof parsed.retryOnNetworkError === 'boolean' ? parsed.retryOnNetworkError : undefined,
    retryOnStatusCodes: Array.isArray(parsed.retryOnStatusCodes) ? parsed.retryOnStatusCodes as number[] : undefined,
    retryOnStatusRanges: Array.isArray(parsed.retryOnStatusRanges) ? parsed.retryOnStatusRanges as FailoverStatusRange[] : undefined,
  };
}

function warnPolicyFallback(error: unknown): void {
  const now = Date.now();
  if (now - lastPolicyWarningAt < SETTINGS_WARNING_INTERVAL_MS) return;
  lastPolicyWarningAt = now;
  console.warn('[GATEWAY_FAILOVER_POLICY_FALLBACK]', error instanceof Error ? error.message : String(error));
}

export function clearGatewayFailoverPolicyCache(): void {
  cachedPolicy = null;
  cachedPolicyLoadedAt = 0;
}

export async function getGatewayFailoverPolicy(): Promise<GatewayFailoverPolicyView> {
  const now = Date.now();
  if (cachedPolicy && now - cachedPolicyLoadedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedPolicy;
  }

  try {
    const rows = await getDb()
      .select()
      .from(gatewaySettings)
      .where(eq(gatewaySettings.key, SETTINGS_KEY))
      .limit(1);

    const row = rows[0];
    const view = row
      ? buildPolicyView(parseStoredPolicy(row.valueJson), row.updatedAt)
      : buildPolicyView({}, null);

    cachedPolicy = view;
    cachedPolicyLoadedAt = now;
    return view;
  } catch (error) {
    warnPolicyFallback(error);
    if (cachedPolicy) return cachedPolicy;
    return buildPolicyView({}, null);
  }
}

export async function updateGatewayFailoverPolicy(input: GatewayFailoverPolicyInput): Promise<GatewayFailoverPolicyView> {
  const policy = normalizeGatewayFailoverPolicy(input);
  const updatedAt = Date.now();

  await getDb()
    .insert(gatewaySettings)
    .values({
      key: SETTINGS_KEY,
      valueJson: JSON.stringify(policy),
      updatedAt,
    })
    .onConflictDoUpdate({
      target: gatewaySettings.key,
      set: {
        valueJson: JSON.stringify(policy),
        updatedAt,
      },
    });

  cachedPolicy = buildPolicyView(policy, updatedAt);
  cachedPolicyLoadedAt = updatedAt;
  return cachedPolicy;
}

export function describeFailoverTrigger(trigger: FailoverTrigger): string {
  if (trigger.kind === 'timeout') return 'timeout';
  if (trigger.kind === 'network_error') return 'network_error';
  return `http_${trigger.status}`;
}

export function shouldTriggerFailover(policy: GatewayFailoverPolicy, trigger: FailoverTrigger): boolean {
  if (!policy.enabled) return false;
  if (trigger.kind === 'timeout') return policy.retryOnTimeout;
  if (trigger.kind === 'network_error') return policy.retryOnNetworkError;
  if (policy.retryOnStatusCodes.includes(trigger.status)) return true;
  return policy.retryOnStatusRanges.includes('5xx') && trigger.status >= 500 && trigger.status <= 599;
}

export function getCustomModelFallbackModels(policy: GatewayFailoverPolicy, requestedModel: string): string[] {
  const model = requestedModel.trim();
  if (!model) return [];
  return policy.customModelFallbacks.find((rule) => rule.model === model)?.fallbacks ?? [];
}

/**
 * Test-only: directly inject a failover policy into the cache, bypassing the database.
 * Throws if called outside of a test environment.
 */
export function loadFailoverPolicyForTest(input: GatewayFailoverPolicyInput): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('loadFailoverPolicyForTest is only available while running tests');
  }
  cachedPolicy = buildPolicyView(input, null);
  cachedPolicyLoadedAt = Date.now();
}