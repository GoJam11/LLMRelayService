import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle, GitFork, Loader2, MapIcon, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2, TriangleAlert, Wifi, X, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { HelpDialogButton } from "@/components/help-dialog-button"
import { PageHeader } from "@/components/ui/page-header"
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
  FieldContent,
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

const EMPTY_FORM = {
  alias: "",
  provider: "",
  model: "",
  description: "",
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

function getAliasRoute(alias: ModelAlias, providers: ProviderInfo[], source: RouteMapRoute["source"] = "alias"): RouteMapRoute {
  const provider = providers.find((candidate) => getProviderRef(candidate) === alias.provider || candidate.channelName === alias.provider)
  return {
    key: `${source}:${alias.alias}:${provider?.channelName ?? alias.provider}:${alias.model}`,
    provider: provider?.channelName ?? alias.provider,
    type: provider?.type ?? "openai",
    model: alias.model,
    source,
    modelKnown: provider?.models.some((candidate) => candidate.model === alias.model) ?? false,
  }
}

function isAliasRoutable(alias: ModelAlias, providers: ProviderInfo[]): boolean {
  if (!alias.enabled) return false
  const provider = providers.find((candidate) => getProviderRef(candidate) === alias.provider || candidate.channelName === alias.provider)
  return provider?.enabled === true
}

function getRouteIdentity(route: RouteMapRoute): string {
  return `${route.provider}:${route.type}:${route.model}`
}

function resolveFallbackTarget(target: string, aliases: ModelAlias[], providers: ProviderInfo[], expectedType: ProviderInfo["type"]): RouteMapRoute[] {
  const alias = aliases.find((candidate) => candidate.enabled && candidate.alias === target)
  if (alias) {
    const route = getAliasRoute(alias, providers, "custom")
    return route.type === expectedType ? [route] : []
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

  for (const provider of enabledProviders) {
    for (const model of provider.models) allRequestModels.set(`${provider.type}:${model.model}`, { model: model.model, type: provider.type })
  }
  for (const alias of routableAliases) {
    const route = getAliasRoute(alias, providers)
    allRequestModels.set(`${route.type}:${alias.alias}`, { model: alias.alias, type: route.type })
  }

  const enabledAliasesByName = new Map(routableAliases.map((alias) => [alias.alias, alias]))
  const customFallbacksByModel = new Map(policy?.customModelFallbacks.map((rule) => [rule.model, rule.fallbacks]) ?? [])
  const anyModelRoutes = sortProvidersByRoutingPriority(enabledProviders).flatMap((provider) => provider.models.map((model) => ({
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
    const aliasRoute = alias ? getAliasRoute(alias, providers) : null
    const matchedAlias = aliasRoute?.type === requestType ? alias : undefined
    const modelRoutes = getModelRoutes(providers, requestModel, requestType)
    const primaryRoutes = matchedAlias ? [aliasRoute!] : modelRoutes.slice(0, 1)
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

function formatUpdatedAt(timestamp: number | null, language: string): string {
  if (!timestamp) return "--"
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", { hour12: false })
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
  const selectedProvider = providers.find((p) => (p.providerUuid || p.channelName) === draft.provider)
  const availableModels = selectedProvider?.models ?? []

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
        <FieldLabel>{t("routes.targetProvider")}</FieldLabel>
        <Select
          value={draft.provider}
          onValueChange={(v) => onChange({ provider: v, model: "" })}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("routes.selectProvider")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providers.map((p) => (
                <SelectItem key={p.providerUuid || p.channelName} value={p.providerUuid || p.channelName}>
                  <span className="flex items-center gap-2">
                    {p.channelName}
                    {!p.enabled && (
                      <Badge variant="secondary" className="text-xs">{t("common.disabled")}</Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{t("routes.targetModel")}</FieldLabel>
        <Select
          value={draft.model}
          onValueChange={(v) => onChange({ model: v })}
          disabled={!draft.provider || availableModels.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !draft.provider
                  ? t("routes.selectFirstProvider")
                  : availableModels.length === 0
                    ? t("routes.noProviderModels")
                    : t("routes.selectTargetModel")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {availableModels.map((m) => (
                <SelectItem key={m.model} value={m.model}>
                  {m.model}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
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
  const provider = providers.find((p) => p.providerUuid === alias.provider) ?? providers.find((p) => p.channelName === alias.provider)
  const providerLabel = provider?.channelName ?? alias.provider
  if (!provider) {
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
  const modelExists = provider.models.some((m) => m.model === alias.model)
  if (!modelExists) {
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
            {t("providers.modelRemovedHint", { model: alias.model, provider: providerLabel })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  if (!provider.enabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs">{t("providers.providerDisabled")}</Badge>
          </TooltipTrigger>
          <TooltipContent>{t("providers.providerDisabledHint", { name: providerLabel })}</TooltipContent>
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
    <div className="flex flex-wrap gap-2">
      {routes.map((route, index) => (
        <div key={`${route.key}:${index}`} className="border border-border/70 bg-card px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium text-foreground">{route.provider}</span>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="font-mono text-xs text-foreground">{route.model}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{route.type}</span>
            <span>{route.source === "alias" ? "alias" : route.source === "custom" ? "custom fallback" : route.source === "any_model" ? "any model" : "model"}</span>
            {!route.modelKnown ? <span>{t("routes.routeMapModelNotListed")}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RoutesPage({ onUnauthorized }: { onUnauthorized: () => void }) {
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
  const [draft, setDraft] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

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
    setDraft(EMPTY_FORM)
    setSubmitError("")
    setDialogOpen(true)
  }

  const openEdit = (alias: ModelAlias) => {
    setEditTarget(alias)
    setDraft({
      alias: alias.alias,
      provider: alias.provider,
      model: alias.model,
      description: alias.description ?? "",
    })
    setSubmitError("")
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    const trimmed = {
      alias: draft.alias.trim(),
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      description: draft.description.trim() || null,
    }
    if (!trimmed.alias || !trimmed.provider || !trimmed.model) {
      setSubmitError(t("routes.requiredFieldsError"))
      return
    }
    try {
      setSubmitting(true)
      setSubmitError("")
      if (editTarget) {
        const updated = await updateModelAlias(editTarget.id, trimmed)
        setAliases((cur) => cur?.map((a) => (a.id === updated.id ? updated : a)) ?? null)
      } else {
        const created = await createModelAlias(trimmed)
        setAliases((cur) => [...(cur ?? []), created])
      }
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
      const resolvedChannelName = providers.find((p) => p.providerUuid === alias.provider)?.channelName ?? alias.provider
      const result = await testProvider(resolvedChannelName, alias.model)
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={GitFork}
        title={t("routes.title")}
        description={t("routes.description", { interpolation: { escapeValue: false } })}
        actions={
          <>
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
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus />
              {t("routes.newAlias")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>{t("routes.failoverTitle")}</CardTitle>
              <CardDescription className="mt-1">{t("routes.failoverDesc")}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {failoverPolicy ? (
                <Badge variant="secondary">
                  {t("routes.failoverUpdatedAt", { time: formatUpdatedAt(failoverPolicy.updatedAt, i18n.language) })}
                </Badge>
              ) : null}
              <HelpDialogButton
                title={t("routes.failoverHelpTitle")}
                description={t("routes.failoverHelpDesc")}
                buttonLabel={t("common.help")}
              >
                <div className="space-y-4">
                  <div>
                    <div className="font-medium text-foreground">{t("routes.failoverHelpCustomTitle")}</div>
                    <p className="mt-1">{t("routes.failoverHelpCustomBody")}</p>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{t("routes.failoverHelpAliasTitle")}</div>
                    <p className="mt-1">{t("routes.failoverHelpAliasBody")}</p>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{t("routes.failoverHelpOrderTitle")}</div>
                    <p className="mt-1">{t("routes.failoverHelpOrderBody")}</p>
                  </div>
                  <div className="border border-border/70 bg-muted/30 p-3 font-mono text-xs text-foreground">
                    <div>{t("routes.failoverHelpExampleRequest")}: gpt-4o</div>
                    <div>{t("routes.failoverHelpExampleFallbacks")}: mini, backup:gpt-4o-mini</div>
                  </div>
                </div>
              </HelpDialogButton>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => failoverPolicy && setFailoverForm(toFailoverForm(failoverPolicy))}
                disabled={!failoverPolicy || savingFailover}
              >
                <RotateCcw data-icon="inline-start" />
                {t("routes.failoverReset")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!failoverPolicy || !failoverForm || savingFailover}
                onClick={() => void handleFailoverSave()}
              >
                {savingFailover ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                {savingFailover ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {!failoverForm || !failoverPolicy ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel>{t("routes.failoverEnabled")}</FieldLabel>
                  <FieldContent>
                    <div className="flex h-10 items-center gap-3">
                      <Switch
                        checked={failoverForm.enabled}
                        onCheckedChange={(checked) => setFailoverForm((current) => current ? { ...current, enabled: checked } : current)}
                      />
                      <span className="text-sm text-muted-foreground">
                        {failoverForm.enabled ? t("common.enabled") : t("common.disabled")}
                      </span>
                    </div>
                    <FieldDescription>{t("routes.failoverEnabledHint")}</FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>{t("routes.failoverMode")}</FieldLabel>
                  <FieldContent>
                    <Select
                      value={failoverForm.modelFallbackMode}
                      onValueChange={(value) => setFailoverForm((current) => current ? { ...current, modelFallbackMode: value as ModelFallbackMode } : current)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">{t("routes.failoverModeDisabled")}</SelectItem>
                        <SelectItem value="same_model">{t("routes.failoverModeSameModel")}</SelectItem>
                        <SelectItem value="any_model">{t("routes.failoverModeAnyModel")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t("routes.failoverModeHint")}</FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor="failover-retry-attempts">{t("routes.failoverRetryAttempts")}</FieldLabel>
                  <FieldContent>
                    <Input
                      id="failover-retry-attempts"
                      type="number"
                      min={failoverPolicy.limits.retryAttempts.min}
                      max={failoverPolicy.limits.retryAttempts.max}
                      step="1"
                      value={failoverForm.retryAttempts}
                      onChange={(event) => setFailoverForm((current) => current ? { ...current, retryAttempts: event.target.value } : current)}
                      className="tabular-nums"
                    />
                    <FieldDescription>
                      {t("routes.failoverRangeHint", failoverPolicy.limits.retryAttempts)}
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor="failover-max-fallback-attempts">{t("routes.failoverMaxFallbackAttempts")}</FieldLabel>
                  <FieldContent>
                    <Input
                      id="failover-max-fallback-attempts"
                      type="number"
                      min={failoverPolicy.limits.maxFallbackAttempts.min}
                      max={failoverPolicy.limits.maxFallbackAttempts.max}
                      step="1"
                      value={failoverForm.maxFallbackAttempts}
                      onChange={(event) => setFailoverForm((current) => current ? { ...current, maxFallbackAttempts: event.target.value } : current)}
                      className="tabular-nums"
                    />
                    <FieldDescription>
                      {t("routes.failoverRangeHint", failoverPolicy.limits.maxFallbackAttempts)}
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel>{t("routes.failoverTriggers")}</FieldLabel>
                  <FieldContent>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <FailoverTriggerCheckbox
                        id="failover-timeout"
                        label={t("routes.failoverTriggerTimeout")}
                        checked={failoverForm.retryOnTimeout}
                        onChange={(checked) => setFailoverForm((current) => current ? { ...current, retryOnTimeout: checked } : current)}
                      />
                      <FailoverTriggerCheckbox
                        id="failover-network"
                        label={t("routes.failoverTriggerNetwork")}
                        checked={failoverForm.retryOnNetworkError}
                        onChange={(checked) => setFailoverForm((current) => current ? { ...current, retryOnNetworkError: checked } : current)}
                      />
                      <FailoverTriggerCheckbox
                        id="failover-429"
                        label={t("routes.failoverTrigger429")}
                        checked={failoverForm.retryOn429}
                        onChange={(checked) => setFailoverForm((current) => current ? { ...current, retryOn429: checked } : current)}
                      />
                      <FailoverTriggerCheckbox
                        id="failover-5xx"
                        label={t("routes.failoverTrigger5xx")}
                        checked={failoverForm.retryOn5xx}
                        onChange={(checked) => setFailoverForm((current) => current ? { ...current, retryOn5xx: checked } : current)}
                      />
                    </div>
                    <FieldDescription>{t("routes.failoverTriggersHint")}</FieldDescription>
                  </FieldContent>
                </Field>
                <Field className="md:col-span-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <FieldLabel>{t("routes.failoverCustomTitle")}</FieldLabel>
                      <FieldDescription>{t("routes.failoverCustomDesc")}</FieldDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addCustomFallbackRule}
                      disabled={failoverForm.customModelFallbacks.length >= failoverPolicy.limits.customModelFallbackRules.max}
                    >
                      <Plus data-icon="inline-start" />
                      {t("routes.failoverCustomAdd")}
                    </Button>
                  </div>
                  <FieldContent>
                    {failoverForm.customModelFallbacks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("routes.failoverCustomEmpty")}</p>
                    ) : (
                      <div className="grid gap-3">
                        {failoverForm.customModelFallbacks.map((rule, index) => (
                          <div key={index} className="grid gap-3 border border-border/70 bg-card/70 p-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
                            <Field>
                              <FieldLabel htmlFor={`failover-custom-model-${index}`}>{t("routes.failoverCustomRequestModel")}</FieldLabel>
                              <Input
                                id={`failover-custom-model-${index}`}
                                value={rule.model}
                                placeholder="gpt-4o"
                                onChange={(event) => updateCustomFallbackRule(index, { model: event.target.value })}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`failover-custom-fallbacks-${index}`}>{t("routes.failoverCustomFallbackModels")}</FieldLabel>
                              <Textarea
                                id={`failover-custom-fallbacks-${index}`}
                                value={rule.fallbacksText}
                                placeholder={t("routes.failoverCustomFallbackPlaceholder")}
                                onChange={(event) => updateCustomFallbackRule(index, { fallbacksText: event.target.value })}
                                className="min-h-20 font-mono text-xs"
                              />
                              <FieldDescription>{t("routes.failoverCustomFallbackHint")}</FieldDescription>
                            </Field>
                            <div className="flex items-start justify-end md:pt-6">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="text-destructive hover:text-destructive"
                                onClick={() => removeCustomFallbackRule(index)}
                              >
                                <X data-icon="inline-start" />
                                {t("common.delete")}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </FieldContent>
                </Field>
              </FieldGroup>
              <div className="grid gap-3 border border-border/70 bg-card/70 p-4">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">{t("routes.failoverCurrentMode")}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{failoverModeLabel}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("routes.failoverRetryAttempts")}</div>
                    <div className="font-mono text-base text-foreground">{failoverForm.retryAttempts}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("routes.failoverMaxFallbackAttempts")}</div>
                    <div className="font-mono text-base text-foreground">{failoverForm.maxFallbackAttempts}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("routes.failoverCustomRuleCount")}</div>
                  <div className="font-mono text-base text-foreground">{failoverForm.customModelFallbacks.length}</div>
                </div>
              </div>
            </div>
          )}

          {failoverError ? <p className="mt-4 text-sm text-destructive">{failoverError}</p> : null}
          {failoverFeedback ? <p className="mt-4 text-sm text-muted-foreground">{failoverFeedback}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <div className="flex items-start gap-3">
            <MapIcon className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle>{t("routes.routeMapTitle")}</CardTitle>
              <CardDescription className="mt-1">{t("routes.routeMapDesc")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
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
                <TableRow>
                  <TableHead>{t("routes.routeMapRequestModel")}</TableHead>
                  <TableHead>{t("routes.routeMapPrimaryRoute")}</TableHead>
                  <TableHead>{t("routes.routeMapFallbackRoutes")}</TableHead>
                  <TableHead>{t("routes.routeMapCoveredRoutes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routeMapEntries.map((entry) => (
                  <TableRow key={`${entry.requestType}:${entry.requestModel}`}>
                    <TableCell className="align-top">
                      <div className="font-mono text-xs font-medium">{entry.requestModel}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs">{entry.requestType}</Badge>
                        <Badge variant={entry.kind === "model" ? "secondary" : "outline"} className="text-xs">
                          {entry.kind === "alias_override"
                            ? t("routes.routeMapAliasOverride")
                            : entry.kind === "alias"
                              ? t("routes.routeMapAlias")
                              : t("routes.routeMapModel")}
                        </Badge>
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
        </CardContent>
      </Card>

      <Card>
        {error && (
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        )}

        <CardContent className="p-0">
          {aliases === null ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !hasAliases ? (
            <Empty>
              <EmptyHeader>
                <GitFork className="h-8 w-8 text-muted-foreground" />
              </EmptyHeader>
              <EmptyContent>
              <EmptyTitle>{t("routes.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("routes.emptyDescription")}
                </EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("routes.colAlias")}</TableHead>
                  <TableHead>{t("routes.colProvider")}</TableHead>
                  <TableHead>{t("routes.colTargetModel")}</TableHead>
                  <TableHead>{t("routes.colNotes")}</TableHead>
                  <TableHead>{t("routes.colStatus")}</TableHead>
                  <TableHead className="w-24 text-right">{t("routes.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases.map((alias) => (
                  <TableRow key={alias.id} className={!alias.enabled ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs font-medium">{alias.alias}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {providers.find((p) => p.providerUuid === alias.provider)?.channelName ?? alias.provider}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {alias.model}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {alias.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={alias.enabled}
                          disabled={togglingId === alias.id}
                          onCheckedChange={(checked) => handleToggle(alias, checked)}
                        />
                        {alias.enabled && (
                          <AliasStatus alias={alias} providers={providers} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {(() => {
                          const result = testResults.get(alias.id)
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
                              <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className={result.status === "ok" ? "text-green-600 border-green-500/50 hover:text-green-700" : "text-destructive border-destructive/50 hover:text-destructive"}
                                    onClick={() => handleTest(alias)}
                                  >
                                    {result.status === "ok"
                                      ? <CheckCircle data-icon="inline-start" />
                                      : <XCircle data-icon="inline-start" />
                                    }
                                    {t("common.test")}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">{result.message}</p>
                                  {result.latencyMs != null && (
                                    <p className="text-xs text-muted-foreground">{result.latencyMs}ms</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                              </TooltipProvider>
                            )
                          }
                          return (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => handleTest(alias)}
                            >
                              <Wifi data-icon="inline-start" />
                              {t("common.test")}
                            </Button>
                          )
                        })()}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openEdit(alias)}
                        >
                          <Pencil data-icon="inline-start" />
                          {t("common.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === alias.id}
                          onClick={() => handleDelete(alias.id)}
                        >
                          <Trash2 data-icon="inline-start" />
                          {t("common.delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? t("routes.editDialogTitle") : t("routes.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? t("routes.editDialogDesc")
                : t("routes.createDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <AliasForm
            draft={draft}
            providers={providers}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
