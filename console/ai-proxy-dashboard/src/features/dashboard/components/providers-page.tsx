import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  Import,
  Search,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
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
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { JsonViewer } from "@/components/ui/json-viewer"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  createProvider,
  deleteProvider,
  fetchProvider,
  fetchProviders,
  fetchUpstreamModels,
  fetchUpstreamModelsPreview,
  testProvider,
  toggleProvider,
  updateProvider,
} from "@/features/dashboard/api"
import type {
  OpenAiResponsesMode,
  ProviderInfo,
  ProviderModelInfo,
  ProviderMutationPayload,
  RoutingVisibility,
  TestProviderResult,
} from "@/features/dashboard/types"

export type TestStatusMap = Map<string, TestProviderResult>

const typeLabels: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
}

type DialogMode = "create" | "edit"

type ModelRowState = {
  id: string
  model: string
}

type ProviderFormState = {
  channelName: string
  type: "anthropic" | "openai"
  targetBaseUrl: string
  priority: string
  routingVisibility: RoutingVisibility
  systemPrompt: string
  authHeader: "auto" | "x-api-key" | "authorization"
  responsesMode: OpenAiResponsesMode
  apiKey: string
  apiKeyDirty: boolean
  clearAuth: boolean
  extraFieldsJson: string
  models: ModelRowState[]
}

function getDefaultAuthHeaderForType(type: ProviderFormState["type"]): ProviderFormState["authHeader"] {
  return type === "anthropic" ? "x-api-key" : "authorization"
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback for non-secure contexts (HTTP over LAN)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createModelRow(model?: ProviderModelInfo): ModelRowState {
  const { model: modelName = "" } = model ?? {}
  return {
    id: generateId(),
    model: modelName,
  }
}

function stripResponsesModeFromExtraFields(extraFields: Record<string, unknown> | null | undefined) {
  if (!extraFields) return null
  const { responsesMode: _responsesMode, ...rest } = extraFields
  return Object.keys(rest).length > 0 ? rest : null
}

function createFormState(provider?: ProviderInfo): ProviderFormState {
  const type = provider?.type ?? "anthropic"
  const extraFields = stripResponsesModeFromExtraFields(provider?.extraFields)

  return {
    channelName: provider?.channelName ?? "",
    type,
    targetBaseUrl: provider?.targetBaseUrl ?? "",
    priority: String(provider?.priority ?? 0),
    routingVisibility: provider?.routingVisibility ?? "direct",
    systemPrompt: provider?.systemPrompt ?? "",
    authHeader: (() => {
      if (!provider?.auth?.header) return "auto"
      return provider.auth.header === getDefaultAuthHeaderForType(type) ? "auto" : provider.auth.header
    })(),
    responsesMode: provider?.responsesMode ?? "native",
    apiKey: provider?.auth?.value ?? "",
    apiKeyDirty: false,
    clearAuth: false,
    extraFieldsJson: (() => {
      if (!extraFields) return ""
      return Object.keys(extraFields).length > 0
        ? JSON.stringify(extraFields, null, 2)
        : ""
    })(),
    models: provider?.models.length
      ? provider.models.map((model) => createModelRow(model))
      : [createModelRow()],
  }
}

function parseExtraJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("Extra fields must be valid JSON object")
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extra fields must be a JSON object")
  }

  return parsed as Record<string, unknown>
}

function buildModels(rows: ModelRowState[]): ProviderModelInfo[] {
  const normalized = rows
    .map((row) => {
      const model = row.model.trim()
      if (!model) return null
      return { model } as ProviderModelInfo
    })
    .filter((item): item is ProviderModelInfo => item !== null)

  return normalized
}

function buildProviderPayload(
  state: ProviderFormState,
  mode: DialogMode,
): ProviderMutationPayload {
  const targetBaseUrl = state.targetBaseUrl.trim()
  const priorityText = state.priority.trim()
  const apiKey = state.apiKey.trim()

  const payload: ProviderMutationPayload = {
    channelName: state.channelName.trim(),
    type: state.type,
    targetBaseUrl,
    systemPrompt: state.systemPrompt.trim() || null,
    models: buildModels(state.models),
    priority: priorityText ? Number(priorityText) : 0,
    routingVisibility: state.routingVisibility,
    responsesMode: state.type === "openai" ? state.responsesMode : null,
    extraFields: parseExtraJson(state.extraFieldsJson),
  }

  const explicitHeader = state.authHeader === "auto" ? undefined : state.authHeader

  if (state.clearAuth) {
    payload.auth = null
  } else if (mode === "create") {
    if (apiKey) {
      payload.auth = explicitHeader ? { header: explicitHeader, value: apiKey } : { value: apiKey } as never
    }
  } else if (state.apiKeyDirty) {
    payload.auth = apiKey ? (explicitHeader ? { header: explicitHeader, value: apiKey } : { value: apiKey } as never) : null
  }

  return payload
}

function SegmentedToggle({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex overflow-hidden rounded-[10px] border border-input text-xs">
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 px-3 py-2.5 text-center transition-colors",
              i > 0 && !active && "border-l border-input",
              active
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function ProvidersPage({
  onUnauthorized,
}: {
  onUnauthorized: () => void
}) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [error, setError] = useState("")
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>("create")
  const [activeProvider, setActiveProvider] = useState<ProviderInfo | null>(null)
  const [formState, setFormState] = useState<ProviderFormState>(() => createFormState())
  const [formError, setFormError] = useState("")
  const [submitPending, setSubmitPending] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [testResults, setTestResults] = useState<TestStatusMap>(new Map())
  const [testingChannels, setTestingChannels] = useState<Set<string>>(new Set())
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogProvider, setTestDialogProvider] = useState<ProviderInfo | null>(null)
  const [testDialogModel, setTestDialogModel] = useState<string>("")
  const [testDialogResult, setTestDialogResult] = useState<TestProviderResult | null>(null)
  const [testDialogLoading, setTestDialogLoading] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [togglingChannels, setTogglingChannels] = useState<Set<string>>(new Set())

  // 同步上游模型弹窗
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncError, setSyncError] = useState("")
  const [syncModels, setSyncModels] = useState<Array<{ id: string }>>([])
  const [syncSelected, setSyncSelected] = useState<Set<string>>(new Set())

  // 配置导入/导出弹窗
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [configDialogMode, setConfigDialogMode] = useState<"import" | "export">("export")
  const [configJson, setConfigJson] = useState("")
  const [configError, setConfigError] = useState("")

  const loadProviders = useCallback(async () => {
    try {
      const data = await fetchProviders()
      setProviders(data.providers)
      setError("")
    } catch (err) {
      if (err instanceof Error && err.message === "unauthorized") {
        onUnauthorized()
        return
      }

      setError(err instanceof Error ? err.message : String(err))
    }
  }, [onUnauthorized])

  const testSingleProvider = useCallback(async (channelName: string, model?: string) => {
    setTestingChannels((prev) => new Set(prev).add(channelName))
    try {
      const result = await testProvider(channelName, model)
      setTestResults((prev) => new Map(prev).set(channelName, result))
      return result
    } catch (err) {
      const errorResult: TestProviderResult = {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : String(err),
      }
      setTestResults((prev) => new Map(prev).set(channelName, errorResult))
      return errorResult
    } finally {
      setTestingChannels((prev) => {
        const next = new Set(prev)
        next.delete(channelName)
        return next
      })
    }
  }, [])

  const testAllProviders = useCallback(async () => {
    if (!providers || testingAll) return

    setTestingAll(true)
    setTestResults(new Map())

    // 并发测试所有provider
    await Promise.all(
      providers.map((provider) => testSingleProvider(provider.channelName))
    )

    setTestingAll(false)
  }, [providers, testingAll, testSingleProvider])

  const toggleSingleProvider = useCallback(
    async (channelName: string, enabled: boolean) => {
      setTogglingChannels((prev) => new Set(prev).add(channelName))
      try {
        await toggleProvider(channelName, enabled)
        await loadProviders()
      } catch (err) {
        // Toggle failure — silently reload to restore original state
        await loadProviders()
      } finally {
        setTogglingChannels((prev) => {
          const next = new Set(prev)
          next.delete(channelName)
          return next
        })
      }
    },
    [loadProviders]
  )

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const providerStats = useMemo(() => {
    const list = providers ?? []

    return {
      total: list.length,
      anthropicCount: list.filter((provider) => provider.type === "anthropic").length,
      openAiCount: list.filter((provider) => provider.type === "openai").length,
      enabledCount: list.filter((provider) => provider.enabled).length,
      explicitOnlyCount: list.filter((provider) => provider.routingVisibility === "explicit_only").length,
    }
  }, [providers])

  const displayedProviders = useMemo(() => {
    const list = providers ?? []
    const query = searchQuery.trim().toLowerCase()

    return list.filter((provider) => {
      const matchesSearch = !query || [
        provider.channelName,
        provider.targetBaseUrl,
        provider.type,
        provider.routingVisibility,
        provider.models.map((model) => model.model).join(" "),
      ].some((value) => value.toLowerCase().includes(query))
      const matchesType = typeFilter === "all" || provider.type === typeFilter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "enabled" && provider.enabled) ||
        (statusFilter === "disabled" && !provider.enabled)

      return matchesSearch && matchesType && matchesStatus
    })
  }, [providers, searchQuery, statusFilter, typeFilter])

  function openCreateDialog() {
    setDialogMode("create")
    setActiveProvider(null)
    setFormState(createFormState())
    setFormError("")
    setShowApiKey(false)
    setDialogOpen(true)
  }

  async function openEditDialog(provider: ProviderInfo) {
    setDialogMode("edit")
    setActiveProvider(provider)
    setFormState(createFormState(provider))
    setFormError("")
    setShowApiKey(false)

    try {
      const detail = await fetchProvider(provider.channelName)
      setActiveProvider(detail)
      setFormState(createFormState(detail))
    } catch (err) {
      if (err instanceof Error && err.message === "unauthorized") {
        onUnauthorized()
        return
      }

      setFormError(err instanceof Error ? `${t("providers.loadApiKeyFailed", { error: err.message })}` : `${t("providers.loadApiKeyFailed", { error: String(err) })}`)
    }

    setDialogOpen(true)
  }

  function openTestDialog(provider: ProviderInfo) {
    setTestDialogProvider(provider)
    setTestDialogModel(provider.models?.[0]?.model ?? "")
    setTestDialogResult(null)
    setTestDialogOpen(true)
  }

  async function handleTestDialogTest() {
    if (!testDialogProvider) return
    setTestDialogLoading(true)
    try {
      const result = await testSingleProvider(testDialogProvider.channelName, testDialogModel || undefined)
      setTestDialogResult(result)
    } finally {
      setTestDialogLoading(false)
    }
  }

  function updateModelRow(id: string, patch: Partial<ModelRowState>) {
    setFormState((current) => ({
      ...current,
      models: current.models.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }))
  }

  function addModelRow() {
    setFormState((current) => ({
      ...current,
      models: [...current.models, createModelRow()],
    }))
  }

  function clearAllModels() {
    const nonEmptyCount = formState.models.filter((r) => r.model.trim() !== "").length
    if (nonEmptyCount === 0) {
      setFormState((current) => ({ ...current, models: [createModelRow()] }))
      return
    }
    if (!window.confirm(t("providers.clearAllModelsConfirm", { count: nonEmptyCount }))) return
    setFormState((current) => ({ ...current, models: [createModelRow()] }))
  }

  async function openSyncDialog() {
    if (!dialogMode || !formState.targetBaseUrl.trim()) return
    setSyncError("")
    setSyncModels([])
    setSyncSelected(new Set())
    setSyncDialogOpen(true)
    setSyncLoading(true)
    try {
      let data: { models: Array<{ id: string }> }
      // 如果有表单中的 targetBaseUrl 和 apiKey，优先用表单参数（无需先保存）
      if (formState.apiKey?.trim()) {
        data = await fetchUpstreamModelsPreview({
          targetBaseUrl: formState.targetBaseUrl.trim(),
          type: formState.type as 'openai' | 'anthropic',
          authHeader: formState.authHeader ?? undefined,
          authValue: formState.apiKey.trim(),
        })
      } else if (formState.channelName.trim()) {
        // 已保存的渠道，用 channelName 从数据库读取认证信息
        data = await fetchUpstreamModels(formState.channelName.trim())
      } else {
        throw new Error(t("providers.syncNeedUrl"))
      }
      const existingIds = new Set(formState.models.map((r) => r.model.trim()).filter(Boolean))
      setSyncModels(data.models)
      // 默认选中不存在的模型
      setSyncSelected(new Set(data.models.map((m) => m.id).filter((id) => !existingIds.has(id))))
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncLoading(false)
    }
  }

  function handleSyncConfirm() {
    if (syncSelected.size === 0) {
      setSyncDialogOpen(false)
      return
    }
    const existingIds = new Set(formState.models.map((r) => r.model.trim()).filter(Boolean))
    const toAdd = [...syncSelected].filter((id) => !existingIds.has(id))
    if (toAdd.length === 0) {
      setSyncDialogOpen(false)
      return
    }
    setFormState((current) => {
      // 过滤掉空白占位行（只有一个空行时）
      const nonEmpty = current.models.filter((r) => r.model.trim() !== "")
      const newRows = toAdd.map((id) => createModelRow({ model: id }))
      return {
        ...current,
        models: nonEmpty.length > 0 ? [...nonEmpty, ...newRows] : newRows,
      }
    })
    setSyncDialogOpen(false)
  }


  function removeModelRow(id: string) {
    setFormState((current) => ({
      ...current,
      models: current.models.length > 1
        ? current.models.filter((row) => row.id !== id)
        : [createModelRow()],
    }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")
    setSubmitPending(true)

    try {
      const payload = buildProviderPayload(formState, dialogMode)

      if (dialogMode === "create") {
        await createProvider(payload)
      } else if (activeProvider) {
        await updateProvider(activeProvider.channelName, payload)
      }

      await loadProviders()
      setDialogOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitPending(false)
    }
  }

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteDialogProvider, setDeleteDialogProvider] = useState<ProviderInfo | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const openDeleteDialog = useCallback((provider: ProviderInfo) => {
    setDeleteDialogProvider(provider)
    setDeleteDialogOpen(true)
  }, [])

  const handleDeleteProvider = useCallback(async () => {
    if (!deleteDialogProvider) return
    setDeletePending(true)

    try {
      await deleteProvider(deleteDialogProvider.channelName)
      setDeleteDialogOpen(false)
      setDeleteDialogProvider(null)
      await loadProviders()
    } catch (err) {
      // Error will be shown in dialog
    } finally {
      setDeletePending(false)
    }
  }, [deleteDialogProvider, loadProviders])

  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("providers.loadFailed")}</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (providers === null) {
    return <ProvidersPageSkeleton />
  }

  const handleExportConfig = () => {
    setConfigDialogMode("export")
    setConfigError("")
    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      providers: providers.map((p) => ({
        channelName: p.channelName,
        type: p.type,
        targetBaseUrl: p.targetBaseUrl,
        systemPrompt: p.systemPrompt,
        priority: p.priority,
        enabled: p.enabled,
        models: p.models,
        auth: p.auth,
        responsesMode: p.responsesMode,
        extraFields: p.extraFields,
      })),
    }
    setConfigJson(JSON.stringify(exportData, null, 2))
    setConfigDialogOpen(true)
  }

  const handleImportConfig = () => {
    setConfigDialogMode("import")
    setConfigJson("")
    setConfigError("")
    setConfigDialogOpen(true)
  }

  const renderEditPane = () => {
    if (!dialogOpen) {
      return (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <Server className="h-7 w-7 opacity-40" />
          <p className="text-sm">{t("providers.selectHint")}</p>
        </div>
      )
    }
    return (
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2.5 border-b border-border px-6 py-4">
          <span className="text-[15px] font-extrabold">
            {dialogMode === "create" ? t("providers.addChannel") : t("providers.editChannel")}
          </span>
          {dialogMode === "edit" ? (
            <span className="font-mono text-[11px] text-muted-foreground">{activeProvider?.channelName}</span>
          ) : null}
          {dialogMode === "edit" && activeProvider ? (
            <div className="ml-auto flex items-center gap-3.5">
              <button
                type="button"
                className="text-[11.5px] font-semibold text-primary disabled:opacity-50"
                disabled={testingChannels.has(activeProvider.channelName)}
                onClick={() => openTestDialog(activeProvider)}
              >
                {testingChannels.has(activeProvider.channelName) ? t("common.testing") : t("common.test")}
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground disabled:opacity-50"
                disabled={togglingChannels.has(activeProvider.channelName)}
                onClick={() => toggleSingleProvider(activeProvider.channelName, !activeProvider.enabled)}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: activeProvider.enabled ? "var(--lrs-success)" : "var(--lrs-faint)" }}
                />
                {activeProvider.enabled ? t("common.enabled") : t("common.disabled")}
              </button>
              <button
                type="button"
                className="text-[11.5px] font-semibold text-destructive"
                onClick={() => openDeleteDialog(activeProvider)}
              >
                {t("common.delete")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("common.saveFailed")}</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pane-channel-name">Channel Name</FieldLabel>
              <Input
                id="pane-channel-name"
                value={formState.channelName}
                onChange={(event) => setFormState((current) => ({ ...current, channelName: event.target.value }))}
              />
              <FieldDescription>{t("providers.channelNameHint", { name: formState.channelName || "channel-name" })}</FieldDescription>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Type</FieldLabel>
                <SegmentedToggle
                  value={formState.type}
                  onChange={(value) => setFormState((current) => ({ ...current, type: value as ProviderFormState["type"] }))}
                  options={[
                    { value: "anthropic", label: "anthropic" },
                    { value: "openai", label: "openai" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pane-priority">Priority</FieldLabel>
                <Input
                  id="pane-priority"
                  inputMode="numeric"
                  value={formState.priority}
                  onChange={(event) => setFormState((current) => ({ ...current, priority: event.target.value }))}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="pane-target-url">Target Base URL</FieldLabel>
              <Input
                id="pane-target-url"
                value={formState.targetBaseUrl}
                onChange={(event) => setFormState((current) => ({ ...current, targetBaseUrl: event.target.value }))}
              />
              <FieldDescription>
                {formState.type === "openai" ? t("providers.targetUrlOpenaiHint") : t("providers.targetUrlAnthropicHint")}
              </FieldDescription>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              {formState.type === "openai" ? (
                <Field>
                  <FieldLabel>{t("providers.responsesModeLabel")}</FieldLabel>
                  <SegmentedToggle
                    value={formState.responsesMode}
                    onChange={(value) => setFormState((current) => ({ ...current, responsesMode: value as OpenAiResponsesMode }))}
                    options={[
                      { value: "native", label: "native" },
                      { value: "chat_compat", label: "chat_compat" },
                      { value: "disabled", label: "disabled" },
                    ]}
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel>Routing Visibility</FieldLabel>
                <SegmentedToggle
                  value={formState.routingVisibility}
                  onChange={(value) => setFormState((current) => ({ ...current, routingVisibility: value as RoutingVisibility }))}
                  options={[
                    { value: "direct", label: "direct" },
                    { value: "explicit_only", label: "explicit_only" },
                  ]}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="pane-auth-header">Auth Method</FieldLabel>
              <Select
                value={formState.authHeader}
                onValueChange={(value) => setFormState((current) => ({ ...current, authHeader: value as ProviderFormState["authHeader"], apiKeyDirty: true, clearAuth: false }))}
              >
                <SelectTrigger id="pane-auth-header" className="w-full"><SelectValue placeholder="Select auth method" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="auto">{t("providers.authMethodAuto")}</SelectItem>
                  <SelectItem value="x-api-key">x-api-key</SelectItem>
                  <SelectItem value="authorization">Authorization: Bearer</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="pane-auth-value">Credential</FieldLabel>
              <div className="relative">
                <Input
                  id="pane-auth-value"
                  type={showApiKey ? "text" : "password"}
                  value={formState.apiKey}
                  onChange={(event) => setFormState((current) => ({ ...current, apiKey: event.target.value, apiKeyDirty: true, clearAuth: false }))}
                  placeholder={dialogMode === "edit" ? t("providers.noApiKey") : ""}
                  className="pr-8"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? t("providers.hideApiKey") : t("providers.showApiKey")}
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="pane-system-prompt">System Prompt</FieldLabel>
              <Textarea
                id="pane-system-prompt"
                rows={3}
                value={formState.systemPrompt}
                onChange={(event) => setFormState((current) => ({ ...current, systemPrompt: event.target.value }))}
              />
              <FieldDescription>{t("providers.systemPromptHint")}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="pane-extra-fields">Extra Fields</FieldLabel>
              <Textarea
                id="pane-extra-fields"
                rows={2}
                value={formState.extraFieldsJson}
                onChange={(event) => setFormState((current) => ({ ...current, extraFieldsJson: event.target.value }))}
                placeholder='{"vendor": "internal"}'
                className="text-xs"
              />
              <FieldDescription>{t("providers.extraFieldsHint")}</FieldDescription>
            </Field>
          </FieldGroup>

          {/* Models */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Models</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={clearAllModels} disabled={formState.models.every((r) => r.model.trim() === "")}>
                  <Trash2 data-icon="inline-start" />
                  {t("providers.clearAllModels")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => void openSyncDialog()} disabled={!formState.targetBaseUrl.trim()}>
                  <Download data-icon="inline-start" />
                  Sync
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={addModelRow}>
                  <Plus data-icon="inline-start" />
                  Add
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Model ID</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {formState.models.map((row, index) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-1">
                        <input
                          className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                          value={row.model}
                          placeholder="model-id"
                          onChange={(event) => updateModelRow(row.id, { model: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <button type="button" className="text-muted-foreground transition-colors hover:text-destructive" onClick={() => removeModelRow(row.id)} aria-label="Remove">
                          <X className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {formState.models.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground">{t("providers.noModels")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            {dialogMode === "edit" ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setFormState((current) => ({ ...current, apiKey: "", apiKeyDirty: true, clearAuth: true }))}>
                Clear Auth
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" size="sm" className="ml-auto" disabled={submitPending}>
              {submitPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col">
        {providers.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Server />
              </EmptyMedia>
              <EmptyTitle>{t("providers.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("providers.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <Plus data-icon="inline-start" />
                Create Channel
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid min-h-[calc(100vh-9rem)] flex-1 grid-cols-1 overflow-hidden rounded-xl border border-border lg:grid-cols-[1fr_1.05fr]">
            {/* Channel list */}
            <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                <span className="text-[13px] text-muted-foreground">
                  共 <b className="font-mono font-semibold text-foreground">{displayedProviders.length}</b> 个渠道 · {providerStats.enabledCount} {t("common.enabled")}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    title={t("providers.testAll")}
                    onClick={testAllProviders}
                    disabled={testingAll || providers.length === 0}
                  >
                    <RefreshCw className={testingAll ? "animate-spin" : ""} />
                  </Button>
                  <Button type="button" size="icon-sm" variant="outline" title={t("providers.exportConfigButton")} onClick={handleExportConfig}>
                    <Download />
                  </Button>
                  <Button type="button" size="icon-sm" variant="outline" title={t("providers.importConfigButton")} onClick={handleImportConfig}>
                    <Upload />
                  </Button>
                  <Button type="button" size="sm" onClick={openCreateDialog}>
                    <Plus data-icon="inline-start" />
                    {t("providers.addChannel")}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索渠道、URL、模型..."
                    className="h-8 bg-card pl-8 text-xs"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-8 w-[5.5rem] bg-card text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[5.5rem] bg-card text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="enabled">{t("common.enabled")}</SelectItem>
                    <SelectItem value="disabled">{t("common.disabled")}</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-col overflow-auto">
                {displayedProviders.length === 0 ? (
                  <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                    {t("common.noData")}
                  </div>
                ) : (
                  displayedProviders.map((provider) => {
                    const selected =
                      dialogOpen && dialogMode === "edit" && activeProvider?.channelName === provider.channelName
                    const testResult = testResults.get(provider.channelName)
                    return (
                      <button
                        type="button"
                        key={provider.channelName}
                        onClick={() => void openEditDialog(provider)}
                        className={cn(
                          "block w-full border-b border-l-[3px] border-border/60 px-5 py-4 text-left transition-colors",
                          selected ? "border-l-primary bg-accent/50" : "border-l-transparent hover:bg-accent/30",
                          !provider.enabled && "opacity-60",
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: provider.enabled ? "var(--lrs-success)" : "var(--lrs-faint)" }}
                          />
                          <span className="text-[14px] font-bold">{provider.channelName}</span>
                          <span className="rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
                            {typeLabels[provider.type] ?? provider.type}
                          </span>
                          {provider.routingVisibility === "explicit_only" ? (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                              backend-only
                            </span>
                          ) : null}
                          {testResult ? (
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              title={testResult.message}
                              style={{ background: testResult.status === "ok" ? "var(--lrs-success)" : "var(--lrs-danger)" }}
                            />
                          ) : null}
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">priority {provider.priority}</span>
                        </div>
                        <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">{provider.targetBaseUrl}</div>
                        {provider.models.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {provider.models.slice(0, 4).map((m) => (
                              <span
                                key={m.model}
                                className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                {m.model}
                              </span>
                            ))}
                            {provider.models.length > 4 ? (
                              <span className="text-[10px] text-muted-foreground">+{provider.models.length - 4}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
            {/* Edit pane */}
            <div className="flex min-h-0 flex-col overflow-auto">{renderEditPane()}</div>
          </div>
        )}
      </div>

      <Dialog open={false} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" ? "Create Channel" : `Edit ${activeProvider?.channelName ?? "Channel"}`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? t("providers.createDialogDesc")
                : t("providers.editDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("common.saveFailed")}</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex max-h-[70vh] gap-6 overflow-hidden">
              {/* Left: Provider config */}
              <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="provider-channel-name">Channel Name</FieldLabel>
                    <Input
                      id="provider-channel-name"
                      value={formState.channelName}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, channelName: event.target.value }))
                      }
                    />
                    <FieldDescription>
                      {t("providers.channelNameHint", { name: formState.channelName || "channel-name" })}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="provider-type">Type</FieldLabel>
                    <Select
                      value={formState.type}
                      onValueChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          type: value as ProviderFormState["type"],
                        }))
                      }
                    >
                      <SelectTrigger id="provider-type" className="w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                          <SelectItem value="openai">OpenAI</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("providers.typeOpenaiHint")}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="provider-target-url">Target Base URL</FieldLabel>
                    <Input
                      id="provider-target-url"
                      value={formState.targetBaseUrl}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, targetBaseUrl: event.target.value }))
                      }
                    />
                    <FieldDescription>
                      {formState.type === "openai"
                        ? t("providers.targetUrlOpenaiHint")
                        : t("providers.targetUrlAnthropicHint")}
                    </FieldDescription>
                  </Field>

                  {formState.type === "openai" ? (
                    <Field>
                      <FieldLabel htmlFor="provider-responses-mode">
                        {t("providers.responsesModeLabel")}
                      </FieldLabel>
                      <Select
                        value={formState.responsesMode}
                        onValueChange={(value) =>
                          setFormState((current) => ({
                            ...current,
                            responsesMode: value as OpenAiResponsesMode,
                          }))
                        }
                      >
                        <SelectTrigger id="provider-responses-mode" className="w-full">
                          <SelectValue placeholder={t("providers.responsesModeLabel")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="native">{t("providers.responsesModeNative")}</SelectItem>
                            <SelectItem value="chat_compat">{t("providers.responsesModeChatCompat")}</SelectItem>
                            <SelectItem value="disabled">{t("providers.responsesModeDisabled")}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("providers.responsesModeHint")}
                      </FieldDescription>
                    </Field>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="provider-priority">Priority</FieldLabel>
                    <Input
                      id="provider-priority"
                      inputMode="numeric"
                      value={formState.priority}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, priority: event.target.value }))
                      }
                    />
                    <FieldDescription>
                      {t("providers.priorityHint")}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="provider-routing-visibility">Routing Visibility</FieldLabel>
                    <Select
                      value={formState.routingVisibility}
                      onValueChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          routingVisibility: value as RoutingVisibility,
                        }))
                      }
                    >
                      <SelectTrigger id="provider-routing-visibility" className="w-full">
                        <SelectValue placeholder="Routing visibility" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="direct">Direct</SelectItem>
                          <SelectItem value="explicit_only">Explicit only</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Direct providers can be matched by client model names. Explicit-only providers are only used by virtual routes and custom fallback targets.
                    </FieldDescription>
                  </Field>

                  <FieldSeparator>Routing</FieldSeparator>

                  <Field>
                    <FieldLabel htmlFor="provider-system-prompt">System Prompt</FieldLabel>
                    <Textarea
                      id="provider-system-prompt"
                      rows={4}
                      value={formState.systemPrompt}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, systemPrompt: event.target.value }))
                      }
                    />
                    <FieldDescription>
                      {t("providers.systemPromptHint")}
                    </FieldDescription>
                  </Field>

                  <FieldSeparator>Auth</FieldSeparator>

                  <Field>
                    <FieldLabel htmlFor="provider-auth-header">Auth Method</FieldLabel>
                    <Select
                      value={formState.authHeader}
                      onValueChange={(value) =>
                        setFormState((current) => ({
                          ...current,
                          authHeader: value as ProviderFormState["authHeader"],
                          apiKeyDirty: true,
                          clearAuth: false,
                        }))
                      }
                    >
                      <SelectTrigger id="provider-auth-header" className="w-full">
                        <SelectValue placeholder="Select auth method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="auto">{t("providers.authMethodAuto")}</SelectItem>
                          <SelectItem value="x-api-key">x-api-key</SelectItem>
                          <SelectItem value="authorization">Authorization: Bearer</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {t("providers.authMethodHint")}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="provider-auth-value">Credential</FieldLabel>
                    <div className="relative">
                      <Input
                        id="provider-auth-value"
                        type={showApiKey ? "text" : "password"}
                        value={formState.apiKey}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            apiKey: event.target.value,
                            apiKeyDirty: true,
                            clearAuth: false,
                          }))
                        }
                        placeholder={dialogMode === "edit" ? t("providers.noApiKey") : ""}
                        className="pr-8"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowApiKey((v) => !v)}
                        aria-label={showApiKey ? t("providers.hideApiKey") : t("providers.showApiKey")}
                      >
                        {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    
                  </Field>

                  <FieldSeparator>Advanced</FieldSeparator>

                  <Field>
                    <FieldLabel htmlFor="provider-extra-fields">Extra Fields</FieldLabel>
                    <Textarea
                      id="provider-extra-fields"
                      rows={3}
                      value={formState.extraFieldsJson}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          extraFieldsJson: event.target.value,
                        }))
                      }
                      placeholder='{"vendor": "internal"}'
                      className="text-xs"
                    />
                    <FieldDescription>
                      {t("providers.extraFieldsHint")}
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </div>

              {/* Divider */}
              <div className="w-px shrink-0 bg-border" />

              {/* Right: Models - wider, table style */}
              <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Models</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={clearAllModels}
                      disabled={formState.models.every((r) => r.model.trim() === "")}
                    >
                      <Trash2 data-icon="inline-start" />
                      {t("providers.clearAllModels")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void openSyncDialog()}
                      disabled={!formState.targetBaseUrl.trim()}
                    >
                      <Download data-icon="inline-start" />
                      Sync
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={addModelRow}>
                      <Plus data-icon="inline-start" />
                      Add
                    </Button>
                  </div>
                </div>

                <div className="rounded-none border border-border/60 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/40">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Model ID</th>
                        <th className="w-8 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {formState.models.map((row, index) => (
                        <tr key={row.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{index + 1}</td>
                          <td className="px-3 py-1">
                            <input
                              className="w-full bg-transparent outline-none font-mono text-xs placeholder:text-muted-foreground/50 focus:ring-0"
                              value={row.model}
                              placeholder="model-id"
                              onChange={(event) => updateModelRow(row.id, { model: event.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => removeModelRow(row.id)}
                              aria-label="Remove"
                            >
                              <X className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {formState.models.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground text-xs">{t("providers.noModels")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <DialogFooter>
              {dialogMode === "edit" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      apiKey: "",
                      apiKeyDirty: true,
                      clearAuth: true,
                    }))
                  }
                >
                  Clear Auth
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitPending}>
                {submitPending ? "Saving..." : dialogMode === "create" ? "Create Channel" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 测试弹窗 */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("providers.testDialogTitle", { name: testDialogProvider?.channelName })}</DialogTitle>
            <DialogDescription>
              {t("providers.testDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("providers.selectModel")}</FieldLabel>
              <Select
                value={testDialogModel}
                onValueChange={setTestDialogModel}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("providers.selectModelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {testDialogProvider?.models.map((m) => (
                      <SelectItem key={m.model} value={m.model}>
                        {m.model}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {testDialogProvider?.models.length === 0 && (
                <FieldDescription className="text-destructive">
                  {t("providers.noModelsConfigured")}
                </FieldDescription>
              )}
            </Field>

            {testDialogResult && (
              <div className="flex flex-col gap-3">
                <Alert variant={testDialogResult.status === "ok" ? "default" : "destructive"}>
                  <AlertTitle>
                    {testDialogResult.status === "ok" ? t("providers.testSuccess") : t("providers.testFailed")}
                  </AlertTitle>
                  <AlertDescription className="flex items-center justify-between">
                    <span>{testDialogResult.message}</span>
                    <span className="text-muted-foreground">
                      {testDialogResult.model && `${testDialogResult.model} • `}
                      {testDialogResult.latencyMs}ms
                    </span>
                  </AlertDescription>
                </Alert>

                {testDialogResult.rawResponse ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("providers.rawResponse")}</span>
                    <ScrollArea className="h-75 rounded-md border bg-muted/30 p-3">
                      <JsonViewer data={testDialogResult.rawResponse} defaultExpanded />
                    </ScrollArea>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTestDialogOpen(false)}
            >
              {t("common.close")}
            </Button>
            <Button
              type="button"
              onClick={handleTestDialogTest}
              disabled={testDialogLoading || !testDialogModel || testDialogProvider?.models.length === 0}
            >
              <RefreshCw
                data-icon="inline-start"
                className={testDialogLoading ? "animate-spin" : ""}
              />
              {testDialogLoading ? t("common.testing") + "..." : t("providers.startTest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("providers.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("providers.deleteDialogDesc", { name: deleteDialogProvider?.channelName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProvider}
              disabled={deletePending}
            >
              {deletePending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 同步上游模型弹窗 */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("providers.syncDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("providers.syncDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          {syncLoading ? (
            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
                {t("providers.syncLoading")}
              </div>
            </div>
          ) : syncError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("providers.syncFailed")}</AlertTitle>
              <AlertDescription>{syncError}</AlertDescription>
            </Alert>
          ) : syncModels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("providers.syncEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("providers.syncCount", { total: syncModels.length, selected: syncSelected.size })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setSyncSelected(new Set(syncModels.map((m) => m.id)))}
                  >
                    {t("common.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setSyncSelected(new Set())}
                  >
                    {t("common.clear")}
                  </button>
                </div>
              </div>
              <ScrollArea className="h-72 rounded-md border">
                <div className="flex flex-col divide-y">
                  {syncModels.map((m) => {
                    const alreadyExists = formState.models.some(
                      (r) => r.model.trim() === m.id
                    )
                    return (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={syncSelected.has(m.id)}
                          onCheckedChange={(checked) => {
                            setSyncSelected((prev) => {
                              const next = new Set(prev)
                              if (checked) next.add(m.id)
                              else next.delete(m.id)
                              return next
                            })
                          }}
                        />
                        <span className="font-mono text-xs flex-1">{m.id}</span>
                        {alreadyExists && (
                          <span className="text-xs text-muted-foreground">{t("common.alreadyExists")}</span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSyncDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSyncConfirm}
              disabled={syncLoading || syncSelected.size === 0}
            >
              {t("providers.addSelectedModels")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 配置导入/导出弹窗 */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {configDialogMode === "import" ? t("providers.importConfigTitle") : t("providers.exportConfigTitle")}
            </DialogTitle>
            <DialogDescription>
              {configDialogMode === "import" ? t("providers.importConfigDesc") : t("providers.exportConfigDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-3">
            {configError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("common.errorOccurred")}</AlertTitle>
                <AlertDescription>{configError}</AlertDescription>
              </Alert>
            ) : null}

            <Field className="min-h-0 flex-1">
              <FieldLabel htmlFor="provider-config-json">{t("providers.configJsonLabel")}</FieldLabel>
              <Textarea
                id="provider-config-json"
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                readOnly={configDialogMode === "export"}
                rows={12}
                className="h-[min(52dvh,28rem)] min-h-40 resize-none overflow-auto font-mono text-xs [field-sizing:fixed]"
                placeholder={configDialogMode === "import" ? t("providers.importConfigPlaceholder") : undefined}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfigDialogOpen(false)}>
              {t("common.close")}
            </Button>
            {configDialogMode === "import" ? (
              <Button
                type="button"
                onClick={async () => {
                  setConfigError("")
                  try {
                    const trimmed = configJson.trim()
                    if (!trimmed) {
                      throw new Error(t("providers.importConfigEmpty"))
                    }
                    const parsed = JSON.parse(trimmed)
                    if (parsed.version !== 1) {
                      throw new Error(t("providers.importConfigVersionMismatch", { version: parsed.version ?? "unknown" }))
                    }
                    if (!Array.isArray(parsed.providers)) {
                      throw new Error(t("providers.importConfigInvalid"))
                    }
                    // 逐个创建 provider
                    for (const p of parsed.providers) {
                      const payload: ProviderMutationPayload = {
                        channelName: p.channelName,
                        type: p.type,
                        targetBaseUrl: p.targetBaseUrl,
                        systemPrompt: p.systemPrompt ?? null,
                        models: p.models ?? [],
                        priority: p.priority ?? 0,
                        responsesMode: p.type === "openai" ? (p.responsesMode ?? "native") : null,
                        extraFields: p.extraFields ?? null,
                        auth: p.auth ?? null,
                      }
                      await createProvider(payload)
                    }
                    await loadProviders()
                    setConfigDialogOpen(false)
                  } catch (err) {
                    setConfigError(err instanceof Error ? err.message : String(err))
                  }
                }}
                disabled={!configJson.trim()}
              >
                <Import data-icon="inline-start" />
                {t("providers.importConfigConfirm")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(configJson).catch(() => {})
                }}
              >
                <Copy data-icon="inline-start" />
                {t("providers.copyExportConfig")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProvidersPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-col gap-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-18" />
                <Skeleton className="h-5 w-18" />
                <Skeleton className="h-5 w-16" />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Separator />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
