import React, { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, CheckCircle, GitFork, Loader2, MapIcon, Plus, RefreshCw, RotateCcw, Save, Trash2, TriangleAlert, Wifi, X, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { Checkbox } from "@/components/ui/checkbox"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  createModelAlias,
  deleteModelAlias,
  fetchGatewayFailoverPolicy,
  fetchModelAliases,
  fetchProviders,
  testProvider,
  toggleModelAlias,
  updateGatewayFailoverPolicy,
  updateModelAlias,
} from "@/features/dashboard/api"
import type { GatewayFailoverPolicyPayload, ModelAlias, ModelFallbackMode, ProviderInfo } from "@/features/dashboard/types"
import type { TestProviderResult } from "@/features/dashboard/api"
import type { RouteTab } from "@/features/dashboard/hooks/use-hash-route"

const EMPTY_FORM = {
  alias: "",
  targets: [] as RouteTargetDraft[],
  description: "",
  visible: true,
  returnRealModel: false,
}

type RouteTargetDraft = {
  id: string
  provider: string
  model: string
}

function createTargetDraft(provider = "", model = ""): RouteTargetDraft {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    provider,
    model,
  }
}

type FailoverFormState = {
  enabled: boolean
  retryAttempts: string
  modelFallbackMode: ModelFallbackMode
  maxFallbackAttempts: string
  customModelFallbacks: Array<{ model: string; fallbacksText: string }>
  retryOnTimeout: boolean
  retryOnNetworkError: boolean
  retryOn429: boolean
  retryOn5xx: boolean
}

type RouteMapRoute = {
  key: string
  provider: string
  type: ProviderInfo["type"]
  model: string
  source: "alias" | "model" | "custom" | "any_model"
  modelKnown: boolean
}

type RouteMapEntry = {
  requestModel: string
  requestType: ProviderInfo["type"]
  kind: "alias" | "model" | "alias_override"
  primaryRoutes: RouteMapRoute[]
  fallbackRoutes: RouteMapRoute[]
  hiddenRoutes: RouteMapRoute[]
}

function getProviderRef(provider: ProviderInfo): string {
  return provider.providerUuid || provider.channelName
}

function sortProvidersByRoutingPriority(providers: ProviderInfo[]): ProviderInfo[] {
  return [...providers].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return a.channelName.localeCompare(b.channelName)
  })
}

function getModelRoutes(providers: ProviderInfo[], model: string, expectedType: ProviderInfo["type"], source: RouteMapRoute["source"] = "model"): RouteMapRoute[] {
  return sortProvidersByRoutingPriority(providers)
    .filter((provider) => provider.enabled)
    .filter((provider) => provider.routingVisibility === "direct")
    .filter((provider) => provider.type === expectedType)
    .filter((provider) => provider.models.some((candidate) => candidate.model === model))
    .map((provider) => ({
      key: `${source}:${provider.channelName}:${model}`,
      provider: provider.channelName,
      type: provider.type,
      model,
      source,
      modelKnown: true,
    }))
}

function getAliasTargets(alias: ModelAlias): Array<{ provider: string; model: string }> {
  return alias.targets?.length ? alias.targets : [{ provider: alias.provider, model: alias.model }]
}

function getAliasRoute(alias: ModelAlias, providers: ProviderInfo[], source: RouteMapRoute["source"] = "alias", target = getAliasTargets(alias)[0]!): RouteMapRoute {
  const provider = providers.find((candidate) => getProviderRef(candidate) === target.provider || candidate.channelName === target.provider)
  return {
    key: `${source}:${alias.alias}:${provider?.channelName ?? target.provider}:${target.model}`,
    provider: provider?.channelName ?? target.provider,
    type: provider?.type ?? "openai",
    model: target.model,
    source,
    modelKnown: provider?.models.some((candidate) => candidate.model === target.model) ?? false,
  }
}

function getAliasRoutes(alias: ModelAlias, providers: ProviderInfo[], source: RouteMapRoute["source"] = "alias"): RouteMapRoute[] {
  return getAliasTargets(alias).map((target) => getAliasRoute(alias, providers, source, target))
}

function isAliasRoutable(alias: ModelAlias, providers: ProviderInfo[]): boolean {
  if (!alias.enabled) return false
  return getAliasTargets(alias).some((target) => {
    const provider = providers.find((candidate) => getProviderRef(candidate) === target.provider || candidate.channelName === target.provider)
    return provider?.enabled === true
  })
}

function getRouteIdentity(route: RouteMapRoute): string {
  return `${route.provider}:${route.type}:${route.model}`
}

function resolveFallbackTarget(target: string, aliases: ModelAlias[], providers: ProviderInfo[], expectedType: ProviderInfo["type"]): RouteMapRoute[] {
  const alias = aliases.find((candidate) => candidate.enabled && candidate.alias === target)
  if (alias) {
    return getAliasRoutes(alias, providers, "custom").filter((route) => route.type === expectedType)
  }

  const separatorIndex = target.indexOf(":")
  if (separatorIndex <= 0 || separatorIndex === target.length - 1) return []

  const providerRef = target.slice(0, separatorIndex).trim()
  const model = target.slice(separatorIndex + 1).trim()
  const provider = providers.find((candidate) => getProviderRef(candidate) === providerRef || candidate.channelName === providerRef)
  if (!provider?.enabled || provider.type !== expectedType || !provider.models.some((candidate) => candidate.model === model)) return []

  return [{
    key: `custom:${provider.channelName}:${model}`,
    provider: provider.channelName,
    type: provider.type,
    model,
    source: "custom",
    modelKnown: true,
  }]
}

function buildRouteMapEntries(
  aliases: ModelAlias[],
  providers: ProviderInfo[],
  policy: GatewayFailoverPolicyPayload | null,
): RouteMapEntry[] {
  const allRequestModels = new Map<string, { model: string; type: ProviderInfo["type"] }>()
  const routableAliases = aliases.filter((alias) => isAliasRoutable(alias, providers))
  const enabledProviders = providers.filter((candidate) => candidate.enabled)
  const directEnabledProviders = enabledProviders.filter((candidate) => candidate.routingVisibility === "direct")

  for (const provider of directEnabledProviders) {
    for (const model of provider.models) allRequestModels.set(`${provider.type}:${model.model}`, { model: model.model, type: provider.type })
  }
  for (const alias of routableAliases) {
    for (const route of getAliasRoutes(alias, providers)) {
      allRequestModels.set(`${route.type}:${alias.alias}`, { model: alias.alias, type: route.type })
    }
  }

  const enabledAliasesByName = new Map(routableAliases.map((alias) => [alias.alias, alias]))
  const customFallbacksByModel = new Map(policy?.customModelFallbacks.map((rule) => [rule.model, rule.fallbacks]) ?? [])
  const anyModelRoutes = sortProvidersByRoutingPriority(directEnabledProviders).flatMap((provider) => provider.models.map((model) => ({
    key: `any_model:${provider.channelName}:${model.model}`,
    provider: provider.channelName,
    type: provider.type,
    model: model.model,
    source: "any_model" as const,
    modelKnown: true,
  })))

  return Array.from(allRequestModels.values()).sort((a, b) => {
    const modelSort = a.model.localeCompare(b.model)
    return modelSort !== 0 ? modelSort : a.type.localeCompare(b.type)
  }).map(({ model: requestModel, type: requestType }) => {
    const alias = enabledAliasesByName.get(requestModel)
    const aliasRoutes = alias ? getAliasRoutes(alias, providers).filter((route) => route.type === requestType) : []
    const matchedAlias = aliasRoutes.length > 0 ? alias : undefined
    const modelRoutes = getModelRoutes(providers, requestModel, requestType)
    const primaryRoutes = matchedAlias ? aliasRoutes : modelRoutes.slice(0, 1)
    const customRoutes = policy?.enabled === false
      ? []
      : (customFallbacksByModel.get(requestModel) ?? []).flatMap((target) => resolveFallbackTarget(target, routableAliases, providers, requestType))
    const sitePolicyRoutes = policy?.enabled === false
      ? []
      : policy?.modelFallbackMode === "any_model"
      ? anyModelRoutes.filter((route) => route.type === requestType)
      : policy?.modelFallbackMode === "same_model"
        ? matchedAlias ? primaryRoutes : modelRoutes
        : []
    const seenRoutes = new Set(primaryRoutes.map(getRouteIdentity))
    const fallbackRoutes = [...customRoutes, ...sitePolicyRoutes]
      .filter((route) => {
        const routeIdentity = getRouteIdentity(route)
        if (seenRoutes.has(routeIdentity)) return false
        seenRoutes.add(routeIdentity)
        return true
      })
      .slice(0, policy?.maxFallbackAttempts ?? 0)

    return {
      requestModel,
      requestType,
      kind: matchedAlias && modelRoutes.length > 0 ? "alias_override" : matchedAlias ? "alias" : "model",
      primaryRoutes,
      fallbackRoutes,
      hiddenRoutes: matchedAlias ? modelRoutes : [],
    }
  })
}

function toFailoverForm(policy: GatewayFailoverPolicyPayload): FailoverFormState {
  return {
    enabled: policy.enabled,
    retryAttempts: String(policy.retryAttempts),
    modelFallbackMode: policy.modelFallbackMode,
    maxFallbackAttempts: String(policy.maxFallbackAttempts),
    customModelFallbacks: policy.customModelFallbacks.map((rule) => ({
      model: rule.model,
      fallbacksText: rule.fallbacks.join("\n"),
    })),
    retryOnTimeout: policy.retryOnTimeout,
    retryOnNetworkError: policy.retryOnNetworkError,
    retryOn429: policy.retryOnStatusCodes.includes(429),
    retryOn5xx: policy.retryOnStatusRanges.includes("5xx"),
  }
}

function parseBoundedInteger(value: string, label: string, limit: { min: number; max: number }, t: (key: string, options?: Record<string, unknown>) => string): number {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(t("routes.failoverValidationRequired", { label }))
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) throw new Error(t("routes.failoverValidationNumber", { label }))
  const normalized = Math.trunc(parsed)
  if (normalized < limit.min || normalized > limit.max) {
    throw new Error(t("routes.failoverValidationRange", { label, min: limit.min, max: limit.max }))
  }
  return normalized
}

function parseCustomModelFallbacks(
  rules: FailoverFormState["customModelFallbacks"],
  limits: GatewayFailoverPolicyPayload["limits"],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const normalized = rules
    .map((rule) => ({
      model: rule.model.trim(),
      fallbacks: rule.fallbacksText
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    }))
    .filter((rule) => rule.model || rule.fallbacks.length > 0)

  if (normalized.length > limits.customModelFallbackRules.max) {
    throw new Error(t("routes.failoverCustomValidationRuleCount", { max: limits.customModelFallbackRules.max }))
  }

  return normalized.map((rule, index) => {
    if (!rule.model) {
      throw new Error(t("routes.failoverCustomValidationModelRequired", { index: index + 1 }))
    }
    const fallbacks = Array.from(new Set(rule.fallbacks))
    if (fallbacks.length < limits.customModelFallbacksPerRule.min) {
      throw new Error(t("routes.failoverCustomValidationFallbackRequired", { model: rule.model }))
    }
    if (fallbacks.length > limits.customModelFallbacksPerRule.max) {
      throw new Error(t("routes.failoverCustomValidationFallbackCount", { model: rule.model, max: limits.customModelFallbacksPerRule.max }))
    }
    return { model: rule.model, fallbacks }
  })
}

function FailoverTriggerCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-foreground">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  )
}

function AliasForm({
  draft,
  providers,
  onChange,
}: {
  draft: typeof EMPTY_FORM
  providers: ProviderInfo[]
  onChange: (patch: Partial<typeof EMPTY_FORM>) => void
}) {
  const { t } = useTranslation()
  const targets = draft.targets.length > 0 ? draft.targets : [createTargetDraft()]
  const updateTarget = (id: string, patch: Partial<RouteTargetDraft>) => {
    onChange({
      targets: targets.map((target) => target.id === id ? { ...target, ...patch } : target),
    })
  }
  const removeTarget = (id: string) => {
    if (targets.length <= 1) return
    onChange({ targets: targets.filter((target) => target.id !== id) })
  }

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel>{t("routes.aliasLabel")}</FieldLabel>
        <FieldDescription>
          {t("routes.aliasHint")}
        </FieldDescription>
        <Input
          placeholder="Auto"
          value={draft.alias}
          onChange={(e) => onChange({ alias: e.target.value })}
        />
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <div>
            <FieldLabel>{t("routes.routeTargetsLabel")}</FieldLabel>
            <FieldDescription>{t("routes.routeTargetsHint")}</FieldDescription>
          </div>
          <Button type="button" variant="outline" size="xs" onClick={() => onChange({ targets: [...targets, createTargetDraft()] })}>
            <Plus data-icon="inline-start" />
            {t("routes.routeTargetAdd")}
          </Button>
        </div>
        <div className="grid gap-3">
          {targets.map((target, index) => {
            const selectedProvider = providers.find((p) => (p.providerUuid || p.channelName) === target.provider)
            const availableModels = selectedProvider?.models ?? []

            return (
              <div key={target.id} className="grid gap-2 border border-border/70 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Select value={target.provider} onValueChange={(value) => updateTarget(target.id, { provider: value, model: "" })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("routes.selectProvider")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {providers.map((p) => (
                        <SelectItem key={p.providerUuid || p.channelName} value={p.providerUuid || p.channelName}>
                          <span className="flex items-center gap-2">
                            {p.channelName}
                            <Badge variant={p.routingVisibility === "explicit_only" ? "outline" : "secondary"} className="text-xs">
                              {p.routingVisibility === "explicit_only" ? t("routes.providerExplicitOnly") : t("routes.providerDirect")}
                            </Badge>
                            {!p.enabled && <Badge variant="secondary" className="text-xs">{t("common.disabled")}</Badge>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Select value={target.model} onValueChange={(value) => updateTarget(target.id, { model: value })} disabled={!target.provider || availableModels.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={!target.provider ? t("routes.selectFirstProvider") : availableModels.length === 0 ? t("routes.noProviderModels") : t("routes.selectTargetModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableModels.map((m) => (
                        <SelectItem key={m.model} value={m.model}>{m.model}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="xs" className="justify-self-end text-destructive hover:text-destructive" onClick={() => removeTarget(target.id)} disabled={targets.length <= 1}>
                  <X data-icon="inline-start" />
                  {index === 0 ? t("routes.routeTargetPrimary") : t("common.delete")}
                </Button>
              </div>
            )
          })}
        </div>
      </Field>
      <Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={draft.visible} onCheckedChange={(value) => onChange({ visible: value === true })} />
          {t("routes.visibleToClients")}
        </label>
        <FieldDescription>{t("routes.visibleToClientsHint")}</FieldDescription>
      </Field>
      <Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={draft.returnRealModel} onCheckedChange={(value) => onChange({ returnRealModel: value === true })} />
          {t("routes.returnRealModel")}
        </label>
        <FieldDescription>{t("routes.returnRealModelHint")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{t("routes.notesLabel")}</FieldLabel>
        <Input
          placeholder={t("routes.notesPlaceholder")}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </FieldGroup>
  )
}

function AliasStatus({
  alias,
  providers,
}: {
  alias: ModelAlias
  providers: ProviderInfo[]
}) {
  const { t } = useTranslation()
  const targets = alias.targets?.length ? alias.targets : [{ provider: alias.provider, model: alias.model }]
  const missingProvider = targets.find((target) => !(providers.find((p) => p.providerUuid === target.provider) ?? providers.find((p) => p.channelName === target.provider)))
  const providerLabel = missingProvider?.provider ?? alias.provider
  if (missingProvider) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="gap-1 text-xs">
              <TriangleAlert className="h-3 w-3" />
              {t("providers.providerNotExist")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("providers.providerDeletedHint", { name: providerLabel })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  const missingModel = targets.find((target) => {
    const provider = providers.find((p) => p.providerUuid === target.provider) ?? providers.find((p) => p.channelName === target.provider)
    return provider && !provider.models.some((m) => m.model === target.model)
  })
  if (missingModel) {
    const provider = providers.find((p) => p.providerUuid === missingModel.provider) ?? providers.find((p) => p.channelName === missingModel.provider)
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 border-yellow-500 text-xs text-yellow-600 dark:text-yellow-400">
              <TriangleAlert className="h-3 w-3" />
              {t("providers.modelRemoved")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("providers.modelRemovedHint", { model: missingModel.model, provider: provider?.channelName ?? missingModel.provider })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  const disabledProvider = targets.map((target) => providers.find((p) => p.providerUuid === target.provider) ?? providers.find((p) => p.channelName === target.provider)).find((provider) => provider && !provider.enabled)
  if (disabledProvider) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs">{t("providers.providerDisabled")}</Badge>
          </TooltipTrigger>
          <TooltipContent>{t("providers.providerDisabledHint", { name: disabledProvider.channelName })}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return null
}

function RouteMapRouteList({ routes, emptyLabel }: { routes: RouteMapRoute[]; emptyLabel: string }) {
  const { t } = useTranslation()

  if (routes.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {routes.map((route, index) => (
        <Badge key={`${route.key}:${index}`} variant="outline" className="gap-1.5 font-normal">
          <span className="font-mono text-xs font-medium text-foreground">{route.provider}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-xs text-foreground">{route.model}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{route.type}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {route.source === "alias"
              ? t("routes.routeMapSourceAlias")
              : route.source === "custom"
                ? t("routes.routeMapSourceCustom")
                : route.source === "any_model"
                  ? t("routes.routeMapSourceAnyModel")
                  : t("routes.routeMapSourceModel")}
          </span>
          {!route.modelKnown ? <span className="text-amber-600 dark:text-amber-300">· {t("routes.routeMapModelNotListed")}</span> : null}
        </Badge>
      ))}
    </div>
  )
}

function GlobalFailoverEditor({
  failoverForm,
  failoverPolicy,
  setFailoverForm,
  savingFailover,
  handleFailoverSave,
  failoverError,
  failoverFeedback,
  failoverModeLabel,
}: {
  failoverForm: FailoverFormState
  failoverPolicy: GatewayFailoverPolicyPayload
  setFailoverForm: (fn: (prev: FailoverFormState | null) => FailoverFormState | null) => void
  savingFailover: boolean
  handleFailoverSave: () => Promise<void>
  failoverError: string
  failoverFeedback: string
  failoverModeLabel: string
  i18nLanguage: string
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-7 py-4">
        <span className="text-[15px] font-extrabold">{t("routes.failoverGlobalTitle")}</span>
        <span className="rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
          {t("routes.failoverGlobalChip")}
        </span>
        <span
          className="ml-auto text-[12px] font-semibold"
          style={{ color: failoverForm.enabled ? "var(--lrs-success)" : "var(--lrs-faint)" }}
        >
          {failoverForm.enabled ? t("common.enabled") : t("common.disabled")}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-7 py-6">
        {/* 匹配顺序说明 */}
        <div className="mb-6 rounded-lg border border-border/60 bg-accent/20 p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("routes.failoverMatchOrderTitle")}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-muted-foreground">
              1
            </div>
            <span className="text-[13px]">{t("routes.failoverMatchOrderStep1")}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: "var(--primary)" }}
            >
              2
            </div>
            <span className="text-[13px] font-semibold">{t("routes.failoverMatchOrderStep2")}</span>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">{t("routes.failoverMatchOrderHint")}</p>
        </div>

        <FieldGroup className="gap-5">
          <Field>
            <div className="flex items-center gap-3">
              <Switch
                checked={failoverForm.enabled}
                onCheckedChange={(checked) => setFailoverForm((c) => c ? { ...c, enabled: checked } : c)}
              />
              <FieldLabel className="!mb-0">{t("routes.failoverEnabled")}</FieldLabel>
            </div>
            <FieldDescription>{t("routes.failoverEnabledHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("routes.failoverMode")}</FieldLabel>
            <FieldDescription>
              {t("routes.failoverCurrentMode")}: <span className="font-semibold text-foreground">{failoverModeLabel}</span>
            </FieldDescription>
            <Select
              value={failoverForm.modelFallbackMode}
              onValueChange={(v) => setFailoverForm((c) => c ? { ...c, modelFallbackMode: v as ModelFallbackMode } : c)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">{t("routes.failoverModeDisabled")}</SelectItem>
                  <SelectItem value="same_model">{t("routes.failoverModeSameModel")}</SelectItem>
                  <SelectItem value="any_model">{t("routes.failoverModeAnyModel")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>{t("routes.failoverRetryRow")}</FieldLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[12px] text-muted-foreground">{t("routes.failoverRetryAttempts")}</div>
                <Input
                  type="number"
                  className="font-mono"
                  value={failoverForm.retryAttempts}
                  onChange={(e) => setFailoverForm((c) => c ? { ...c, retryAttempts: e.target.value } : c)}
                />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {t("routes.failoverRangeHint", { min: failoverPolicy.limits.retryAttempts.min, max: failoverPolicy.limits.retryAttempts.max })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[12px] text-muted-foreground">{t("routes.failoverMaxFallbackAttempts")}</div>
                <Input
                  type="number"
                  className="font-mono"
                  value={failoverForm.maxFallbackAttempts}
                  onChange={(e) => setFailoverForm((c) => c ? { ...c, maxFallbackAttempts: e.target.value } : c)}
                />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {t("routes.failoverRangeHint", { min: failoverPolicy.limits.maxFallbackAttempts.min, max: failoverPolicy.limits.maxFallbackAttempts.max })}
                </div>
              </div>
            </div>
          </Field>

          <Field>
            <FieldLabel>{t("routes.failoverTriggers")}</FieldLabel>
            <FieldDescription>{t("routes.failoverTriggersHint")}</FieldDescription>
            <div className="grid grid-cols-2 gap-y-2.5">
              <FailoverTriggerCheckbox
                id="g-retryOnTimeout"
                label={t("routes.failoverTriggerTimeout")}
                checked={failoverForm.retryOnTimeout}
                onChange={(v) => setFailoverForm((c) => c ? { ...c, retryOnTimeout: v } : c)}
              />
              <FailoverTriggerCheckbox
                id="g-retryOnNetworkError"
                label={t("routes.failoverTriggerNetwork")}
                checked={failoverForm.retryOnNetworkError}
                onChange={(v) => setFailoverForm((c) => c ? { ...c, retryOnNetworkError: v } : c)}
              />
              <FailoverTriggerCheckbox
                id="g-retryOn429"
                label={t("routes.failoverTrigger429")}
                checked={failoverForm.retryOn429}
                onChange={(v) => setFailoverForm((c) => c ? { ...c, retryOn429: v } : c)}
              />
              <FailoverTriggerCheckbox
                id="g-retryOn5xx"
                label={t("routes.failoverTrigger5xx")}
                checked={failoverForm.retryOn5xx}
                onChange={(v) => setFailoverForm((c) => c ? { ...c, retryOn5xx: v } : c)}
              />
            </div>
          </Field>
        </FieldGroup>

        {/* 两种写法 hint */}
        <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("routes.failoverChainSyntaxTitle")}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2.5">
              <code className="rounded bg-accent px-2 py-0.5 font-mono text-[12px] text-foreground">mini</code>
              <span className="text-[12px] text-muted-foreground">{t("routes.failoverChainSyntaxAliasHint")}</span>
            </div>
            <div className="flex items-baseline gap-2.5">
              <code className="rounded bg-accent px-2 py-0.5 font-mono text-[12px] text-foreground">backup:gpt-4o-mini</code>
              <span className="text-[12px] text-muted-foreground">{t("routes.failoverChainSyntaxChannelHint")}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-card/60 px-7 py-3">
        {failoverError ? <p className="text-sm text-destructive">{failoverError}</p> : null}
        {failoverFeedback ? <span className="text-[12px] text-muted-foreground">{failoverFeedback}</span> : null}
        <Button
          type="button"
          className="ml-auto"
          size="sm"
          onClick={handleFailoverSave}
          disabled={savingFailover}
        >
          {savingFailover ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
          {savingFailover ? t("common.saving") : t("routes.failoverSaveGlobal")}
        </Button>
      </div>
    </>
  )
}

function CustomFallbackEditor({
  index,
  rule,
  updateCustomFallbackRule,
  removeCustomFallbackRule,
  savingFailover,
  handleFailoverSave,
  failoverError,
  failoverFeedback,
}: {
  index: number
  rule: { model: string; fallbacksText: string } | undefined
  updateCustomFallbackRule: (index: number, patch: Partial<{ model: string; fallbacksText: string }>) => void
  removeCustomFallbackRule: (idx: number) => void
  savingFailover: boolean
  handleFailoverSave: () => Promise<void>
  failoverError: string
  failoverFeedback: string
}) {
  const { t } = useTranslation()
  if (!rule) return null
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-7 py-4">
        <span className="text-[15px] font-extrabold">{t("routes.failoverCustomRuleTitle")}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{rule.model || `规则 ${index + 1}`}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => removeCustomFallbackRule(index)}
        >
          <Trash2 data-icon="inline-start" />
          {t("routes.failoverDeleteRule")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-7 py-6">
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>{t("routes.failoverCustomRequestModel")}</FieldLabel>
            <FieldDescription>{t("routes.failoverHelpCustomBody")}</FieldDescription>
            <Input
              className="font-mono"
              placeholder="gpt-4o"
              value={rule.model}
              onChange={(e) => updateCustomFallbackRule(index, { model: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>{t("routes.failoverCustomFallbackModels")}</FieldLabel>
            <FieldDescription>{t("routes.failoverCustomFallbackHint")}</FieldDescription>
            <Textarea
              className="font-mono text-sm"
              placeholder={t("routes.failoverCustomFallbackPlaceholder")}
              rows={5}
              value={rule.fallbacksText}
              onChange={(e) => updateCustomFallbackRule(index, { fallbacksText: e.target.value })}
            />
          </Field>
        </FieldGroup>
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-card/60 px-7 py-3">
        {failoverError ? <p className="text-sm text-destructive">{failoverError}</p> : null}
        {failoverFeedback ? <span className="text-[12px] text-muted-foreground">{failoverFeedback}</span> : null}
        <Button
          type="button"
          className="ml-auto"
          size="sm"
          onClick={handleFailoverSave}
          disabled={savingFailover}
        >
          {savingFailover ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
          {savingFailover ? t("common.saving") : t("routes.failoverSaveRule")}
        </Button>
      </div>
    </>
  )
}

export function RoutesPage({
  activeTab = "map",
  onTabChange,
  onUnauthorized,
}: {
  activeTab?: RouteTab
  onTabChange?: (tab: RouteTab) => void
  onUnauthorized: () => void
}) {
  const { t, i18n } = useTranslation()
  const [aliases, setAliases] = useState<ModelAlias[] | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [failoverPolicy, setFailoverPolicy] = useState<GatewayFailoverPolicyPayload | null>(null)
  const [failoverForm, setFailoverForm] = useState<FailoverFormState | null>(null)
  const [error, setError] = useState("")
  const [failoverError, setFailoverError] = useState("")
  const [failoverFeedback, setFailoverFeedback] = useState("")
  const [loading, setLoading] = useState(false)
  const [savingFailover, setSavingFailover] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ModelAlias | null>(null)
  const [creatingAlias, setCreatingAlias] = useState(false)
  const [draft, setDraft] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [aliasFeedback, setAliasFeedback] = useState("")

  const [selectedRuleIndex, setSelectedRuleIndex] = useState<number | null>(null)

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Map<number, TestProviderResult | "loading">>(new Map())

  const handleUnauth = useCallback(
    (message: string) => {
      if (message === "unauthorized") {
        onUnauthorized()
        return true
      }
      return false
    },
    [onUnauthorized],
  )

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [aliasData, providerData, failoverData] = await Promise.all([
        fetchModelAliases(),
        fetchProviders(),
        fetchGatewayFailoverPolicy(),
      ])
      setAliases(aliasData.aliases)
      setProviders(providerData.providers)
      setFailoverPolicy(failoverData)
      setFailoverForm(toFailoverForm(failoverData))
      setError("")
      setFailoverError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [handleUnauth])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditTarget(null)
    setCreatingAlias(true)
    setDraft({ ...EMPTY_FORM, targets: [createTargetDraft()] })
    setSubmitError("")
    setDialogOpen(false)
  }

  const openEdit = (alias: ModelAlias) => {
    setEditTarget(alias)
    setCreatingAlias(false)
    setDraft({
      alias: alias.alias,
      targets: (alias.targets?.length ? alias.targets : [{ provider: alias.provider, model: alias.model }]).map((target) => createTargetDraft(target.provider, target.model)),
      description: alias.description ?? "",
      visible: alias.visible,
      returnRealModel: alias.returnRealModel === true,
    })
    setSubmitError("")
    setDialogOpen(false)
  }

  const closeAliasPane = () => {
    setEditTarget(null)
    setCreatingAlias(false)
    setSubmitError("")
  }

  const handleSubmit = async () => {
    const trimmed = {
      alias: draft.alias.trim(),
      targets: draft.targets.map((target) => ({ provider: target.provider.trim(), model: target.model.trim() })),
      description: draft.description.trim() || null,
      visible: draft.visible,
      returnRealModel: draft.returnRealModel,
    }
    if (!trimmed.alias || trimmed.targets.length === 0 || trimmed.targets.some((target) => !target.provider || !target.model)) {
      setSubmitError(t("routes.requiredFieldsError"))
      return
    }
    try {
      setSubmitting(true)
      setSubmitError("")
      if (editTarget) {
        const updated = await updateModelAlias(editTarget.id, trimmed)
        setAliases((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
        setEditTarget(updated)
      } else {
        const created = await createModelAlias(trimmed)
        setAliases((cur) => [...(cur ?? []), created])
        setEditTarget(created)
        setCreatingAlias(false)
      }
      setAliasFeedback(t("routes.aliasSavedToast"))
      window.setTimeout(() => setAliasFeedback(""), 1800)
      setDialogOpen(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (alias: ModelAlias, enabled: boolean) => {
    try {
      setTogglingId(alias.id)
      const updated = await toggleModelAlias(alias.id, enabled)
      setAliases((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      setDeletingId(id)
      await deleteModelAlias(id)
      setAliases((cur) => cur?.filter((a) => a.id !== id) ?? null)
      setTestResults((cur) => { const next = new Map(cur); next.delete(id); return next })
      if (editTarget?.id === id) closeAliasPane()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (alias: ModelAlias) => {
    setTestResults((cur) => new Map(cur).set(alias.id, "loading"))
    try {
      const firstTarget = getAliasTargets(alias)[0]!
      const resolvedChannelName = providers.find((p) => p.providerUuid === firstTarget.provider)?.channelName ?? firstTarget.provider
      const result = await testProvider(resolvedChannelName, firstTarget.model)
      setTestResults((cur) => new Map(cur).set(alias.id, result))
    } catch (err) {
      setTestResults((cur) => new Map(cur).set(alias.id, {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const hasAliases = useMemo(() => (aliases?.length ?? 0) > 0, [aliases])
  const routeMapEntries = useMemo(
    () => buildRouteMapEntries(aliases ?? [], providers, failoverPolicy),
    [aliases, providers, failoverPolicy],
  )

  const handleFailoverSave = async () => {
    if (!failoverPolicy || !failoverForm) return
    try {
      setSavingFailover(true)
      setFailoverError("")
      const retryAttempts = parseBoundedInteger(
        failoverForm.retryAttempts,
        t("routes.failoverRetryAttempts"),
        failoverPolicy.limits.retryAttempts,
        t,
      )
      const maxFallbackAttempts = parseBoundedInteger(
        failoverForm.maxFallbackAttempts,
        t("routes.failoverMaxFallbackAttempts"),
        failoverPolicy.limits.maxFallbackAttempts,
        t,
      )
      const customModelFallbacks = parseCustomModelFallbacks(
        failoverForm.customModelFallbacks,
        failoverPolicy.limits,
        t,
      )
      const next = await updateGatewayFailoverPolicy({
        enabled: failoverForm.enabled,
        retryAttempts,
        modelFallbackMode: failoverForm.modelFallbackMode,
        maxFallbackAttempts,
        customModelFallbacks,
        retryOnTimeout: failoverForm.retryOnTimeout,
        retryOnNetworkError: failoverForm.retryOnNetworkError,
        retryOnStatusCodes: failoverForm.retryOn429 ? [408, 429] : [408],
        retryOnStatusRanges: failoverForm.retryOn5xx ? ["5xx"] : [],
      })
      setFailoverPolicy(next)
      setFailoverForm(toFailoverForm(next))
      setFailoverError("")
      setFailoverFeedback(t("routes.failoverSaved"))
      window.setTimeout(() => setFailoverFeedback(""), 1800)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (handleUnauth(message)) return
      setFailoverError(message)
    } finally {
      setSavingFailover(false)
    }
  }

  const addCustomFallbackRule = () => {
    setFailoverForm((current) => current
      ? {
          ...current,
          customModelFallbacks: [...current.customModelFallbacks, { model: "", fallbacksText: "" }],
        }
      : current)
  }

  const updateCustomFallbackRule = (index: number, patch: Partial<{ model: string; fallbacksText: string }>) => {
    setFailoverForm((current) => {
      if (!current) return current
      return {
        ...current,
        customModelFallbacks: current.customModelFallbacks.map((rule, ruleIndex) => (
          ruleIndex === index ? { ...rule, ...patch } : rule
        )),
      }
    })
  }

  const removeCustomFallbackRule = (index: number) => {
    setFailoverForm((current) => current
      ? {
          ...current,
          customModelFallbacks: current.customModelFallbacks.filter((_, ruleIndex) => ruleIndex !== index),
        }
      : current)
  }

  const failoverModeLabel = failoverForm?.modelFallbackMode === "any_model"
    ? t("routes.failoverModeAnyModel")
    : failoverForm?.modelFallbackMode === "same_model"
      ? t("routes.failoverModeSameModel")
      : t("routes.failoverModeDisabled")

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Tabs + actions */}
      <Tabs value={activeTab} onValueChange={(value) => onTabChange?.(value as RouteTab)} className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border">
          <TabsList
            variant="line"
            className="!h-auto w-auto flex-1 gap-0 justify-start overflow-x-auto border-none bg-transparent px-8 py-0"
          >
            {(
              [
                ["aliases", t("routes.tabAliases")],
                ["failover", t("routes.tabFailover")],
                ["map", t("routes.tabRouteMap")],
              ] as const
            ).map(([value, label], i, arr) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  "h-auto flex-none px-0.5 py-[13px] text-[13px] font-medium text-muted-foreground after:bottom-0 data-[state=active]:font-bold data-[state=active]:text-foreground",
                  i < arr.length - 1 && "mr-[26px]",
                )}
                style={{ "--tabs-line-color": "var(--primary)", "--tabs-line-bottom": "0px" } as React.CSSProperties}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2 pr-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </Button>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <TabsContent value="failover" className="mt-0 flex-1">
          {!failoverForm || !failoverPolicy ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid min-h-[calc(100vh-12rem)] flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_1.15fr]">
              {/* Rule list */}
              <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                  <span className="text-[13px] text-muted-foreground">
                    {t("routes.failoverSidebarCount", { count: failoverForm.customModelFallbacks.length })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => failoverPolicy && setFailoverForm(toFailoverForm(failoverPolicy))}
                      disabled={savingFailover}
                    >
                      <RotateCcw data-icon="inline-start" />
                      {t("routes.failoverReset")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        addCustomFallbackRule()
                        setSelectedRuleIndex(failoverForm.customModelFallbacks.length)
                      }}
                      disabled={failoverForm.customModelFallbacks.length >= failoverPolicy.limits.customModelFallbackRules.max}
                    >
                      <Plus data-icon="inline-start" />
                      {t("routes.failoverNewRule")}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-1 flex-col overflow-auto">
                  {/* Global rule card */}
                  <button
                    type="button"
                    onClick={() => setSelectedRuleIndex(null)}
                    className={cn(
                      "block w-full border-b border-l-[3px] border-border/60 px-5 py-4 text-left transition-colors",
                      selectedRuleIndex === null ? "border-l-primary bg-accent/50" : "border-l-transparent hover:bg-accent/30",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-extrabold">{t("routes.failoverGlobalTitle")}</span>
                      <span className="rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
                        {t("routes.failoverGlobalChip")}
                      </span>
                      <span className="ml-auto text-[11px] font-semibold" style={{ color: failoverForm.enabled ? "var(--lrs-success)" : "var(--lrs-faint)" }}>
                        {failoverForm.enabled ? t("common.enabled") : t("common.disabled")}
                      </span>
                    </div>
                    <div className="mt-2 text-[11.5px] text-muted-foreground">
                      {t("routes.failoverGlobalSubtitle")} ·{" "}
                      <span className="font-mono text-foreground/80">{failoverModeLabel}</span>
                    </div>
                  </button>

                  {/* Per-model rules */}
                  <div className="px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground/70">
                    {t("routes.failoverModelRulesHeader")} · {failoverForm.customModelFallbacks.length}
                  </div>
                  {failoverForm.customModelFallbacks.length === 0 ? (
                    <div className="px-5 py-6 text-[12px] text-muted-foreground/70">
                      {t("routes.failoverModelRulesEmpty")}
                    </div>
                  ) : (
                    failoverForm.customModelFallbacks.map((rule, index) => {
                      const selected = selectedRuleIndex === index
                      const fallbacks = rule.fallbacksText
                        .split(/[\n,]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                      return (
                        <button
                          type="button"
                          key={index}
                          onClick={() => setSelectedRuleIndex(index)}
                          className={cn(
                            "block w-full border-b border-l-[3px] border-border/60 px-5 py-4 text-left transition-colors",
                            selected ? "border-l-primary bg-accent/50" : "border-l-transparent hover:bg-accent/30",
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-[13.5px] font-bold">
                              {rule.model || `规则 ${index + 1}`}
                            </span>
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                              {t("routes.failoverCustomTitle")}
                            </span>
                          </div>
                          {fallbacks.length > 0 ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {fallbacks.slice(0, 3).map((target, i) => (
                                <span
                                  key={`${target}-${i}`}
                                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground/80"
                                >
                                  {target}
                                </span>
                              ))}
                              {fallbacks.length > 3 ? (
                                <span className="text-[11px] text-muted-foreground">+{fallbacks.length - 3}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Editor pane */}
              <div className="flex min-h-0 flex-col overflow-auto">
                {selectedRuleIndex === null ? (
                  <GlobalFailoverEditor
                    failoverForm={failoverForm}
                    failoverPolicy={failoverPolicy}
                    setFailoverForm={setFailoverForm}
                    savingFailover={savingFailover}
                    handleFailoverSave={handleFailoverSave}
                    failoverError={failoverError}
                    failoverFeedback={failoverFeedback}
                    failoverModeLabel={failoverModeLabel}
                    i18nLanguage={i18n.language}
                  />
                ) : (
                  <CustomFallbackEditor
                    index={selectedRuleIndex}
                    rule={failoverForm.customModelFallbacks[selectedRuleIndex]}
                    updateCustomFallbackRule={updateCustomFallbackRule}
                    removeCustomFallbackRule={(idx) => {
                      removeCustomFallbackRule(idx)
                      setSelectedRuleIndex(null)
                    }}
                    savingFailover={savingFailover}
                    handleFailoverSave={handleFailoverSave}
                    failoverError={failoverError}
                    failoverFeedback={failoverFeedback}
                  />
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="map" className="mt-0 flex-1">
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
            <MapIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold">{t("routes.routeMapTitle")}</span>
            <span className="text-[13px] text-muted-foreground">—</span>
            <span className="text-[13px] text-muted-foreground">{t("routes.routeMapDesc")}</span>
          </div>
          {aliases === null ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : routeMapEntries.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <MapIcon className="h-8 w-8 text-muted-foreground" />
              </EmptyHeader>
              <EmptyContent>
                <EmptyTitle>{t("routes.routeMapEmptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("routes.routeMapEmptyDesc")}</EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-52 border-b border-border py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("routes.routeMapRequestModel")}
                  </TableHead>
                  <TableHead className="min-w-72 border-b border-border py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("routes.routeMapPrimaryRoute")}
                  </TableHead>
                  <TableHead className="min-w-72 border-b border-border py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("routes.routeMapFallbackRoutes")}
                  </TableHead>
                  <TableHead className="min-w-72 border-b border-border py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("routes.routeMapCoveredRoutes")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routeMapEntries.map((entry) => (
                  <TableRow key={`${entry.requestType}:${entry.requestModel}`} className="hover:bg-accent/30">
                    <TableCell className="align-top">
                      <div className="font-mono text-xs font-medium">{entry.requestModel}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
                          {entry.requestType}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                          {entry.kind === "alias_override"
                            ? t("routes.routeMapAliasOverride")
                            : entry.kind === "alias"
                              ? t("routes.routeMapAlias")
                              : t("routes.routeMapModel")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <RouteMapRouteList routes={entry.primaryRoutes} emptyLabel={t("routes.routeMapNoRoute")} />
                    </TableCell>
                    <TableCell className="align-top">
                      <RouteMapRouteList routes={entry.fallbackRoutes} emptyLabel={t("routes.routeMapNoFallback")} />
                    </TableCell>
                    <TableCell className="align-top">
                      <RouteMapRouteList routes={entry.hiddenRoutes} emptyLabel={t("routes.routeMapNoCoveredRoute")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="aliases" className="mt-0 flex-1">
          {aliases === null ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid min-h-[calc(100vh-12rem)] flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_1.05fr]">
              {/* Alias list */}
              <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                  <span className="text-[13px] text-muted-foreground">
                    {hasAliases
                      ? t("routes.aliasSidebarCount", { count: aliases.length })
                      : t("routes.emptyTitle")}
                  </span>
                  <Button type="button" size="sm" onClick={openCreate}>
                    <Plus data-icon="inline-start" />
                    {t("routes.newAlias")}
                  </Button>
                </div>
                <div className="flex flex-1 flex-col overflow-auto">
                  {!hasAliases ? (
                    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground">
                      <GitFork className="h-8 w-8 text-muted-foreground/60" />
                      <div className="mt-2 text-sm text-foreground">{t("routes.emptyTitle")}</div>
                      <div>{t("routes.emptyDescription")}</div>
                    </div>
                  ) : (
                    aliases.map((alias) => {
                      const selected = editTarget?.id === alias.id
                      const targets = getAliasTargets(alias)
                      const primary = targets[0]
                      const fallbacks = targets.slice(1)
                      const testResult = testResults.get(alias.id)
                      const okTest = testResult && testResult !== "loading" ? testResult : null
                      return (
                        <button
                          type="button"
                          key={alias.id}
                          onClick={() => openEdit(alias)}
                          className={cn(
                            "block w-full border-b border-l-[3px] border-border/60 px-5 py-4 text-left transition-colors",
                            selected ? "border-l-primary bg-accent/50" : "border-l-transparent hover:bg-accent/30",
                            !alias.enabled && "opacity-60",
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: alias.enabled ? "var(--lrs-success)" : "var(--lrs-faint)" }}
                            />
                            <span className="text-[14px] font-bold">{alias.alias}</span>
                            <span className="rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
                              alias
                            </span>
                            {alias.returnRealModel ? (
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                                {t("routes.returnRealModelBadge")}
                              </span>
                            ) : null}
                            {okTest ? (
                              <span
                                className="ml-auto h-1.5 w-1.5 rounded-full"
                                title={okTest.message}
                                style={{ background: okTest.status === "ok" ? "var(--lrs-success)" : "var(--lrs-danger)" }}
                              />
                            ) : null}
                          </div>
                          {primary ? (
                            <div className="mt-2 font-mono text-[11.5px] text-muted-foreground">
                              <ArrowRight className="mr-1 inline h-3 w-3 align-[-2px]" />
                              {primary.provider}
                              <span className="text-muted-foreground/60"> : </span>
                              {primary.model}
                            </div>
                          ) : null}
                          <div className="mt-1.5 text-[11px] text-muted-foreground">
                            {fallbacks.length > 0 ? (
                              <>
                                <span>{t("routes.aliasSummaryFallback")} </span>
                                <span className="font-mono text-foreground/80">
                                  {fallbacks.map((f) => `${f.provider}:${f.model}`).join(" → ")}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground/60">{t("routes.aliasSummaryNoFallback")}</span>
                            )}
                          </div>
                          <div className="mt-2 inline-flex items-center gap-1.5">
                            <AliasStatus alias={alias} providers={providers} />
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Edit pane */}
              <div className="flex min-h-0 flex-col overflow-auto">
                {!editTarget && !creatingAlias ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
                    <GitFork className="h-10 w-10 text-muted-foreground/40" />
                    <div className="text-sm font-semibold text-foreground">{t("routes.aliasNoSelection")}</div>
                    <p className="max-w-sm text-xs text-muted-foreground">{t("routes.aliasNoSelectionHint")}</p>
                    <Button type="button" variant="outline" size="sm" onClick={openCreate}>
                      <Plus data-icon="inline-start" />
                      {t("routes.newAlias")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 border-b border-border px-7 py-4">
                      <span className="text-[15px] font-extrabold">
                        {editTarget ? t("routes.aliasEditTitle") : t("routes.aliasCreateTitle")}
                      </span>
                      {editTarget ? (
                        <span className="font-mono text-[11px] text-muted-foreground">{editTarget.alias}</span>
                      ) : null}
                      <div className="ml-auto flex items-center gap-1.5">
                        {editTarget ? (
                          <>
                            {(() => {
                              const result = testResults.get(editTarget.id)
                              if (result === "loading") {
                                return (
                                  <Button type="button" variant="outline" size="xs" disabled>
                                    <Loader2 data-icon="inline-start" className="animate-spin" />
                                    {t("common.testing")}
                                  </Button>
                                )
                              }
                              if (result) {
                                return (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className={result.status === "ok" ? "text-green-600 border-green-500/50 hover:text-green-700" : "text-destructive border-destructive/50 hover:text-destructive"}
                                    onClick={() => handleTest(editTarget)}
                                  >
                                    {result.status === "ok"
                                      ? <CheckCircle data-icon="inline-start" />
                                      : <XCircle data-icon="inline-start" />
                                    }
                                    {t("common.test")}
                                  </Button>
                                )
                              }
                              return (
                                <Button type="button" variant="outline" size="xs" onClick={() => handleTest(editTarget)}>
                                  <Wifi data-icon="inline-start" />
                                  {t("common.test")}
                                </Button>
                              )
                            })()}
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="text-destructive hover:text-destructive"
                              disabled={deletingId === editTarget.id}
                              onClick={() => handleDelete(editTarget.id)}
                            >
                              <Trash2 data-icon="inline-start" />
                              {t("common.delete")}
                            </Button>
                          </>
                        ) : null}
                        <Button type="button" variant="ghost" size="xs" onClick={closeAliasPane}>
                          <X data-icon="inline-start" />
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto px-7 py-6">
                      <AliasForm
                        draft={draft}
                        providers={providers}
                        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                      />
                      {submitError ? (
                        <p className="mt-4 text-sm text-destructive">{submitError}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 border-t border-border bg-card/60 px-7 py-3">
                      {editTarget ? (
                        <div className="flex items-center gap-2.5">
                          <Switch
                            checked={editTarget.enabled}
                            disabled={togglingId === editTarget.id}
                            onCheckedChange={(checked) => handleToggle(editTarget, checked)}
                          />
                          <span className="text-[13px] text-muted-foreground">
                            {editTarget.enabled ? t("common.enabled") : t("common.disabled")}
                          </span>
                        </div>
                      ) : null}
                      {aliasFeedback ? (
                        <span className="text-[12px] text-muted-foreground">{aliasFeedback}</span>
                      ) : null}
                      <Button
                        type="button"
                        className="ml-auto"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={submitting}
                      >
                        {submitting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                        {submitting ? t("common.saving") : t("common.save")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("routes.editDialogTitle")}</DialogTitle>
            <DialogDescription>{t("routes.editDialogDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
