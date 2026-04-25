import { createConsoleProviderEntry, deleteConsoleProviderEntry, listConsoleProviderEntries, toggleConsoleProviderEntry, updateConsoleProviderEntry } from './console-provider-store';
import { listModelAliases } from './console-model-alias-store';

export type UpstreamType = 'anthropic' | 'openai';
export type RouteAuthHeader = 'x-api-key' | 'authorization';

const CHANNEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface RouteAuthConfig {
  header: RouteAuthHeader;
  value: string;
}

export interface ModelConfig {
  model: string;
  context?: number;
  [key: string]: unknown;
}

export interface ConfigEntry {
  type?: UpstreamType;
  targetBaseUrl: string;
  systemPrompt?: string;
  auth?: RouteAuthConfig;
  models?: ModelConfig[];
  priority?: number;
  enabled?: boolean;
  extraFields?: Record<string, unknown>;
  providerUuid?: string;
}

export interface RouteResult {
  channelName: string;
  type: UpstreamType;
  targetUrl: string;
  systemPrompt?: string;
  auth?: RouteAuthConfig;
  /** 当请求 model 是一个别名时，此字段为真实的上游模型名，需要改写请求体 */
  resolvedModel?: string;
}

export interface ProviderAuthInfo {
  header: RouteAuthHeader;
  configured: boolean;
  value?: string;
}

export interface ProviderInfo {
  channelName: string;
  type: UpstreamType;
  targetBaseUrl: string;
  systemPrompt: string | null;
  priority: number;
  enabled: boolean;
  models: ModelConfig[];
  auth: ProviderAuthInfo | null;
  extraFields: Record<string, unknown> | null;
  providerUuid: string;
}

export interface ProviderMutationAuthInput {
  header?: RouteAuthHeader;
  value?: string;
}

export interface ProviderMutationInput {
  channelName?: string;
  type?: UpstreamType;
  targetBaseUrl?: string;
  systemPrompt?: string | null;
  models?: Array<string | ModelConfig> | null;
  priority?: number;
  auth?: ProviderMutationAuthInput | null;
  extraFields?: Record<string, unknown> | null;
}

type RawConfigEntry = ConfigEntry & {
  cc?: unknown;
  adapterFile?: unknown;
  supportedClientTypes?: unknown;
  fallbacks?: unknown;
  pathRewrite?: unknown;
  systemFile?: unknown;
};

function getModelId(model: ModelConfig): string {
  return model.model;
}

function normalizeLegacyModel(item: string | ModelConfig, index: number): ModelConfig {
  if (typeof item === 'string') {
    const model = item.trim();
    if (!model) {
      throw new Error(`models[${index}] 不能为空`);
    }
    return { model };
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`models[${index}] 必须是字符串或对象`);
  }

  const model = normalizeRequiredString((item as Record<string, unknown>).model, `models[${index}].model`);
  const normalized: ModelConfig = {
    ...(item as Record<string, unknown>),
    model,
  };

  if ('context' in normalized && normalized.context != null) {
    const context = Number(normalized.context);
    if (!Number.isFinite(context) || context <= 0) {
      throw new Error(`models[${index}].context 必须是正整数`);
    }
    normalized.context = Math.trunc(context);
  }

  return normalized;
}

export function validateConfigEntries(entries: Record<string, RawConfigEntry>): Record<string, ConfigEntry> {
  const configs: Record<string, ConfigEntry> = {};

  for (const [channelName, entry] of Object.entries(entries)) {
    if (entry && typeof entry === 'object' && 'cc' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "cc".`);
    }
    if (entry && typeof entry === 'object' && 'adapterFile' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "adapterFile".`);
    }
    if (entry && typeof entry === 'object' && 'supportedClientTypes' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "supportedClientTypes".`);
    }
    if (entry && typeof entry === 'object' && 'enableCcMasquerade' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "enableCcMasquerade"; CC masquerade has been removed.`);
    }
    if (entry && typeof entry === 'object' && 'fallbacks' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "fallbacks"; failover has been removed.`);
    }
    if (entry && typeof entry === 'object' && 'pathRewrite' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "pathRewrite"; path rewrite is no longer supported.`);
    }
    if (entry && typeof entry === 'object' && 'systemFile' in entry) {
      throw new Error(`Route "${channelName}" uses removed field "systemFile"; use "systemPrompt" instead.`);
    }

    const type = normalizeProviderType(entry.type ?? 'openai');
    const targetBaseUrl = normalizeTargetBaseUrl(entry.targetBaseUrl);
    const systemPrompt = normalizeOptionalString(entry.systemPrompt);
    const models = normalizeModels(entry.models);
    const priority = normalizePriority(entry.priority);
    const auth = normalizeStaticAuthInput(entry.auth, type);

    configs[channelName] = {
      type,
      targetBaseUrl,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(auth ? { auth } : {}),
      models,
      priority,
      enabled: entry.enabled !== false,
    };
  }

  return configs;
}

let providerConfigs: Record<string, ConfigEntry> = {};
let providerConfigsLoaded = false;
let providerConfigsPromise: Promise<void> | null = null;

// Model alias cache: alias name → { provider (uuid or channelName), model }
interface AliasTarget { provider: string; model: string; }
let aliasConfigs: Record<string, AliasTarget> = {};
let aliasConfigsLoaded = false;
// UUID → channelName map for alias routing
let uuidToChannelName: Record<string, string> = {};

function setProviderConfigs(nextProviderConfigs: Record<string, ConfigEntry>): void {
  providerConfigs = nextProviderConfigs;
  // Rebuild uuid → channelName map
  uuidToChannelName = {};
  for (const [channelName, entry] of Object.entries(nextProviderConfigs)) {
    if (entry.providerUuid) {
      uuidToChannelName[entry.providerUuid] = channelName;
    }
  }
}

async function reloadProviderConfigs(): Promise<void> {
  const [nextProviderConfigs, nextAliases] = await Promise.all([
    listConsoleProviderEntries(),
    listModelAliases(),
  ]);
  setProviderConfigs(nextProviderConfigs);
  aliasConfigs = {};
  for (const entry of nextAliases) {
    if (entry.enabled) {
      aliasConfigs[entry.alias] = { provider: entry.provider, model: entry.model };
    }
  }
  providerConfigsLoaded = true;
  aliasConfigsLoaded = true;
}

export async function ensureProviderConfigsLoaded(): Promise<void> {
  if (providerConfigsLoaded) return;
  if (!providerConfigsPromise) {
    providerConfigsPromise = reloadProviderConfigs().finally(() => {
      providerConfigsPromise = null;
    });
  }
  await providerConfigsPromise;
}

async function refreshProviderConfigs(): Promise<void> {
  providerConfigsLoaded = false;
  aliasConfigsLoaded = false;
  await ensureProviderConfigsLoaded();
}

function getConfigs(): Record<string, ConfigEntry> {
  return providerConfigs;
}

/**
 * 获取 provider 的原始配置（包含 auth value）
 * 仅供内部使用（如测试 API），不要暴露给外部
 */
export function getProviderConfig(channelName: string): ConfigEntry | undefined {
  return providerConfigs[channelName];
}

function isModelRoutedPath(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/');
}

function parseExplicitRoutePath(pathname: string): { channelName: string; path: string } | null {
  const match = pathname.match(/^\/providers\/([^/]+)(\/.*)?$/);
  if (!match) return null;

  const channelName = match[1]!;
  if (!(channelName in getConfigs())) return null;

  // 跳过禁用的渠道
  const entry = getConfigs()[channelName];
  if (entry?.enabled === false) return null;

  return {
    channelName,
    path: match[2] || '/',
  };
}

function inferExpectedProviderType(pathname: string): UpstreamType | null {
  // /v1/messages 是 Anthropic 端点
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages?')) {
    return 'anthropic';
  }
  // 其他 /v1/* 端点（如 /v1/chat/completions）是 OpenAI 兼容端点
  if (isModelRoutedPath(pathname)) {
    return 'openai';
  }
  return null;
}

function findRouteByModel(model: string, expectedType?: UpstreamType): { channelName: string; entry: ConfigEntry } | null {
  const sortedConfigs = Object.entries(getConfigs()).filter(([, entry]) => entry != null) as [string, ConfigEntry][];
  sortedConfigs.sort((a, b) => {
    const priorityA = a[1].priority ?? 0;
    const priorityB = b[1].priority ?? 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
    return a[0].localeCompare(b[0]);
  });

  for (const [channelName, entry] of sortedConfigs) {
    // 跳过禁用的渠道
    if (entry.enabled === false) {
      continue;
    }
    // 如果指定了期望的 provider 类型，只匹配该类型
    if (expectedType !== undefined && entry.type !== expectedType) {
      continue;
    }
    const modelIds = entry.models?.map(getModelId) ?? [];
    if (modelIds.includes(model)) {
      return { channelName, entry };
    }
  }

  return null;
}

function buildRouteResult(channelName: string, entry: ConfigEntry, path: string, search: string): RouteResult {
  // 路径拼接规则：
  // - OpenAI 端点：去掉请求路径中的 /v1，用户必须在 targetBaseUrl 中包含 /v1
  //   例如 targetBaseUrl=https://api.openai.com/v1，请求 /v1/chat/completions
  //   最终 URL = https://api.openai.com/v1/chat/completions
  // - Anthropic 端点：保留 /v1，用户填写的 targetBaseUrl 不需要包含 /v1
  //   例如 targetBaseUrl=https://api.anthropic.com，请求 /v1/messages
  //   最终 URL = https://api.anthropic.com/v1/messages
  let normalizedPath = path;
  const providerType = (entry.type ?? 'openai') as UpstreamType;
  const pathStartsWithV1 = isModelRoutedPath(path);

  if (pathStartsWithV1 && providerType === 'openai') {
    // OpenAI 端点：去掉 /v1，用户必须在 targetBaseUrl 中指定完整路径
    normalizedPath = path.slice(3);
    if (!normalizedPath) normalizedPath = '/';
  }

  return {
    channelName,
    type: (entry.type ?? 'openai') as UpstreamType,
    targetUrl: entry.targetBaseUrl + normalizedPath + search,
    systemPrompt: entry.systemPrompt,
    auth: entry.auth,
  };
}

function getEditableAuthValue(auth: RouteAuthConfig): string {
  if (auth.header === 'authorization') {
    return auth.value.replace(/^Bearer\s+/i, '').trim();
  }

  return auth.value;
}

function buildProviderInfo(
  channelName: string,
  entry: ConfigEntry,
  includeAuthValue = false,
): ProviderInfo {
  return {
    channelName,
    type: entry.type ?? 'openai',
    targetBaseUrl: entry.targetBaseUrl,
    systemPrompt: entry.systemPrompt ?? null,
    priority: entry.priority ?? 0,
    enabled: entry.enabled !== false,
    models: entry.models ?? [],
    auth: entry.auth
      ? {
          header: entry.auth.header,
          configured: entry.auth.value.length > 0,
          ...(includeAuthValue
            ? { value: getEditableAuthValue(entry.auth) }
            : {}),
        }
      : null,
    extraFields: entry.extraFields ?? null,
    providerUuid: entry.providerUuid ?? '',
  };
}

export function getProviderInfo(
  channelName: string,
  options?: { includeAuthValue?: boolean },
): ProviderInfo | null {
  const entry = getConfigs()[channelName];
  if (!entry) return null;
  return buildProviderInfo(channelName, entry, options?.includeAuthValue ?? false);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空`);
  }
  return normalized;
}

function normalizeChannelName(value: unknown): string {
  const channelName = normalizeRequiredString(value, 'channelName');
  if (!CHANNEL_NAME_RE.test(channelName)) {
    throw new Error('channelName 只能包含字母、数字、点、下划线和中划线，且必须以字母或数字开头');
  }
  return channelName;
}

function normalizeProviderType(value: unknown): UpstreamType {
  if (value === 'anthropic' || value === 'openai') {
    return value;
  }
  throw new Error('type 必须是 anthropic 或 openai');
}

function normalizeTargetBaseUrl(value: unknown): string {
  const rawValue = normalizeRequiredString(value, 'targetBaseUrl');
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('targetBaseUrl 必须是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('targetBaseUrl 仅支持 http/https');
  }
  return rawValue.replace(/\/+$/, '');
}

function normalizeModels(value: unknown): ModelConfig[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error('models 必须是数组');
  }

  return value.map((item, index) => normalizeLegacyModel(item as string | ModelConfig, index));
}

function normalizePriority(value: unknown): number {
  if (value == null || value === '') return 0;
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    throw new Error('priority 必须是数字');
  }
  return Math.trunc(priority);
}

function getDefaultAuthHeaderForType(type: UpstreamType): RouteAuthHeader {
  return type === 'anthropic' ? 'x-api-key' : 'authorization';
}

function normalizeAuthHeader(value: unknown, type: UpstreamType): RouteAuthHeader {
  if (value == null || value === '') {
    return getDefaultAuthHeaderForType(type);
  }
  if (value === 'x-api-key' || value === 'authorization') {
    return value;
  }
  throw new Error('auth.header 必须是 x-api-key 或 authorization');
}

function normalizeAuthValueForStorage(value: string, header: RouteAuthHeader): string {
  const normalized = header === 'authorization'
    ? value.replace(/^Bearer\s+/i, '').trim()
    : value.trim();

  if (!normalized) {
    throw new Error('auth.value 不能为空');
  }

  return header === 'authorization' ? `Bearer ${normalized}` : normalized;
}

function normalizeStaticAuthInput(value: unknown, type: UpstreamType, existingAuth?: RouteAuthConfig): RouteAuthConfig | undefined {
  if (value === undefined) return existingAuth;
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('auth 必须是对象或 null');
  }

  const record = value as Record<string, unknown>;
  if ('prefix' in record) {
    throw new Error('auth.prefix 不再支持；authorization 会自动使用 Bearer 前缀');
  }

  const header = normalizeAuthHeader(record.header ?? existingAuth?.header, type);

  const authValue = normalizeOptionalString(record.value);
  if (!authValue) {
    if (!existingAuth?.value) {
      throw new Error('auth.value 不能为空');
    }

    return {
      header,
      value: normalizeAuthValueForStorage(getEditableAuthValue(existingAuth), header),
    };
  }

  return {
    header,
    value: normalizeAuthValueForStorage(authValue, header),
  };
}

function buildNormalizedEntry(payload: ProviderMutationInput, existingEntry?: ConfigEntry): ConfigEntry {
  const type = payload.type === undefined
    ? (existingEntry?.type ?? 'openai')
    : normalizeProviderType(payload.type);
  const targetBaseUrl = payload.targetBaseUrl === undefined
    ? normalizeTargetBaseUrl(existingEntry?.targetBaseUrl)
    : normalizeTargetBaseUrl(payload.targetBaseUrl);
  const systemPrompt = payload.systemPrompt === undefined
    ? existingEntry?.systemPrompt
    : normalizeOptionalString(payload.systemPrompt);
  const models = payload.models === undefined
    ? (existingEntry?.models ?? [])
    : normalizeModels(payload.models);
  const priority = payload.priority === undefined
    ? (existingEntry?.priority ?? 0)
    : normalizePriority(payload.priority);
  const auth = normalizeStaticAuthInput(payload.auth, type, existingEntry?.auth);
  const extraFields = payload.extraFields === undefined
    ? existingEntry?.extraFields
    : (payload.extraFields ?? undefined);

  const normalized: ConfigEntry = {
    type,
    targetBaseUrl,
    models,
    priority,
  };

  if (systemPrompt) normalized.systemPrompt = systemPrompt;
  if (auth) normalized.auth = auth;
  if (extraFields && Object.keys(extraFields).length > 0) normalized.extraFields = extraFields;

  return normalized;
}

function validateConsoleCandidate(channelName: string, entry: ConfigEntry, existingChannelName?: string): void {
  if (channelName in providerConfigs && channelName !== existingChannelName) {
    throw new Error(`Provider "${channelName}" 已存在`);
  }

  const nextProviderConfigs = { ...providerConfigs };
  nextProviderConfigs[channelName] = entry;
  if (existingChannelName && existingChannelName !== channelName) {
    delete nextProviderConfigs[existingChannelName];
  }
  setProviderConfigs(nextProviderConfigs);
}

function restoreProviderConfigs(snapshot: Record<string, ConfigEntry>): void {
  providerConfigs = snapshot;
  providerConfigsLoaded = true;
}

export function resetProviderConfigCache(): void {
  providerConfigs = {};
  providerConfigsLoaded = false;
  providerConfigsPromise = null;
}

export interface ModelInfo {
  id: string;
  channelName: string;
  type: UpstreamType;
  context?: number;
}

export function resolveRoute(pathname: string, search: string): RouteResult | null {
  const parsed = parseExplicitRoutePath(pathname);
  if (!parsed) return null;

  return buildRouteResult(parsed.channelName, getConfigs()[parsed.channelName]!, parsed.path, search);
}

export function resolveRouteByModel(pathname: string, search: string, model: string, forcedType?: UpstreamType): RouteResult | null {
  if (!isModelRoutedPath(pathname)) return null;

  // 根据端点推断期望的 provider 类型（显式指定时优先使用）
  const expectedType = forcedType ?? inferExpectedProviderType(pathname);
  if (!expectedType) return null;

  // 先检查 model alias：如果 model 是一个别名，直接解析到目标 provider + model
  const aliasTarget = aliasConfigs[model];
  if (aliasTarget) {
    // provider 字段可能是 uuid 或 channelName（兼容旧数据）
    const resolvedChannelName = uuidToChannelName[aliasTarget.provider] ?? aliasTarget.provider;
    const entry = getConfigs()[resolvedChannelName];
    if (entry && entry.enabled !== false && (!expectedType || entry.type === expectedType)) {
      const result = buildRouteResult(resolvedChannelName, entry, pathname, search);
      return { ...result, resolvedModel: aliasTarget.model };
    }
    // alias 存在但 provider 不可用时继续走普通查找（降级）
  }

  const matched = findRouteByModel(model, expectedType);
  if (!matched) return null;

  return buildRouteResult(matched.channelName, matched.entry, pathname, search);
}

export function getModels(): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seenModelKeys = new Set<string>();
  const sortedConfigs = Object.entries(getConfigs()).sort((a, b) => {
    const priorityA = a[1].priority ?? 0;
    const priorityB = b[1].priority ?? 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
    return a[0].localeCompare(b[0]);
  });

  for (const [channelName, entry] of sortedConfigs) {
    if (entry.enabled === false) continue;
    const routeType = entry.type ?? 'openai';
    for (const model of entry.models ?? []) {
      const modelId = getModelId(model);
      const dedupeKey = `${modelId}:${routeType}`;
      if (seenModelKeys.has(dedupeKey)) continue;
      seenModelKeys.add(dedupeKey);
      models.push({
        id: modelId,
        channelName,
        type: routeType,
        context: model.context,
      });
    }
  }
  return models;
}

export function getProviders(): ProviderInfo[] {
  return Object.entries(getConfigs())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([channelName, entry]) => buildProviderInfo(channelName, entry));
}

export async function createProvider(input: ProviderMutationInput): Promise<ProviderInfo> {
  await ensureProviderConfigsLoaded();
  const channelName = normalizeChannelName(input.channelName);

  if (channelName in getConfigs()) {
    throw new Error(`Provider "${channelName}" 已存在`);
  }

  const entry = buildNormalizedEntry(input);
  const snapshot = providerConfigs;
  validateConsoleCandidate(channelName, entry);

  try {
    await createConsoleProviderEntry(channelName, entry);
    await refreshProviderConfigs();
  } catch (error) {
    restoreProviderConfigs(snapshot);
    throw error;
  }

  return getProviderInfo(channelName)!;
}

export async function updateProvider(channelName: string, input: ProviderMutationInput): Promise<ProviderInfo> {
  await ensureProviderConfigsLoaded();
  const normalizedChannelName = normalizeChannelName(channelName);

  const existingEntry = providerConfigs[normalizedChannelName];
  if (!existingEntry) {
    throw new Error(`Provider "${normalizedChannelName}" 不存在`);
  }

  const nextChannelName = input.channelName === undefined
    ? normalizedChannelName
    : normalizeChannelName(input.channelName);
  const entry = buildNormalizedEntry(input, existingEntry);
  const snapshot = providerConfigs;
  validateConsoleCandidate(nextChannelName, entry, normalizedChannelName);

  try {
    await updateConsoleProviderEntry(normalizedChannelName, nextChannelName, entry);
    await refreshProviderConfigs();
  } catch (error) {
    restoreProviderConfigs(snapshot);
    throw error;
  }

  return getProviderInfo(nextChannelName)!;
}

export async function deleteProvider(channelName: string): Promise<void> {
  await ensureProviderConfigsLoaded();
  const normalizedChannelName = normalizeChannelName(channelName);

  const existingEntry = providerConfigs[normalizedChannelName];
  if (!existingEntry) {
    throw new Error(`Provider "${normalizedChannelName}" does not exist`);
  }

  const snapshot = providerConfigs;

  try {
    await deleteConsoleProviderEntry(normalizedChannelName);
    await refreshProviderConfigs();
  } catch (error) {
    restoreProviderConfigs(snapshot);
    throw error;
  }
}

export async function toggleProvider(channelName: string, enabled: boolean): Promise<ProviderInfo> {
  await ensureProviderConfigsLoaded();
  const normalizedChannelName = normalizeChannelName(channelName);

  const existingEntry = providerConfigs[normalizedChannelName];
  if (!existingEntry) {
    throw new Error(`Provider "${normalizedChannelName}" does not exist`);
  }

  const snapshot = providerConfigs;

  try {
    await toggleConsoleProviderEntry(normalizedChannelName, enabled);
    await refreshProviderConfigs();
  } catch (error) {
    restoreProviderConfigs(snapshot);
    throw error;
  }

  const updated = providerConfigs[normalizedChannelName];
  if (!updated) {
    restoreProviderConfigs(snapshot);
    throw new Error(`Provider "${normalizedChannelName}" was deleted during toggle`);
  }

  return buildProviderInfo(normalizedChannelName, updated);
}
