import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Download,
  Eye,
  EyeOff,
  Globe,
  Plus,
  RefreshCw,
  Server,
  SquarePen,
  Trash2,
  Wifi,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  TestProviderResult,
} from "@/features/dashboard/types"

export type TestStatusMap = Map<string, TestProviderResult>

const typeLabels: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
}

const typeVariants: Record<string, "default" | "secondary" | "outline"> = {
  anthropic: "default",
  openai: "secondary",
}

const responseModeVariants: Record<OpenAiResponsesMode, "default" | "secondary" | "outline"> = {
  native: "secondary",
  chat_compat: "outline",
  disabled: "outline",
}

const healthColors: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
  "no-data": "bg-muted-foreground/40",
}

const healthLabels: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  "no-data": "No Data",
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

function createModelRow(model?: ProviderModelInfo): ModelRowState {
  const { model: modelName = "" } = model ?? {}
  return {
    id: crypto.randomUUID(),
    model: modelName,
  }
}

function formatProviderModel(model: ProviderInfo["models"][number]) {
  const modelId = String(model.model || "--")
  const context = typeof model.context === "number" ? `${Math.round(model.context / 1000)}k` : null

  return {
    key: context ? `${modelId}:${model.context}` : modelId,
    label: context ? `${modelId} (${context})` : modelId,
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

export function ProvidersPage({
  onUnauthorized,
}: {
  onUnauthorized: () => void
}) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [error, setError] = useState("")
  const { t } = useTranslation()
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
    }
  }, [providers])

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

  return (
    <>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Server}
          title={t("providers.title")}
          description={t("providers.description")}
          actions={
            <>
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <Plus data-icon="inline-start" />
                {t("providers.addChannel")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={testAllProviders}
                disabled={testingAll || providers.length === 0}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={testingAll ? "animate-spin" : ""}
                />
                {testingAll ? t("common.testing") : t("providers.testAll")}
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Total {providerStats.total}</Badge>
          <Badge variant="outline">Anthropic {providerStats.anthropicCount}</Badge>
          <Badge variant="outline">OpenAI {providerStats.openAiCount}</Badge>
        </div>

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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.channelName}
                provider={provider}
                testResult={testResults.get(provider.channelName)}
                isTesting={testingChannels.has(provider.channelName)}
                isToggling={togglingChannels.has(provider.channelName)}
                onOpenTestDialog={() => openTestDialog(provider)}
                onEdit={() => openEditDialog(provider)}
                onDelete={() => openDeleteDialog(provider)}
                onToggle={(enabled) => toggleSingleProvider(provider.channelName, enabled)}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                    {dialogMode === "edit" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void openSyncDialog()}
                      >
                        <Download data-icon="inline-start" />
                        Sync
                      </Button>
                    )}
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
    </>
  )
}

function ProviderCard({
  provider,
  testResult,
  isTesting,
  isToggling,
  onOpenTestDialog,
  onEdit,
  onDelete,
  onToggle,
}: {
  provider: ProviderInfo
  testResult?: TestProviderResult
  isTesting?: boolean
  isToggling?: boolean
  onOpenTestDialog?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onToggle?: (enabled: boolean) => void
}) {
  const healthStatus = provider.healthStatus ?? "no-data"
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const { t } = useTranslation()
  const MODEL_COLLAPSE_THRESHOLD = 5

  return (
    <Card className={!provider.enabled ? "opacity-50" : ""}>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="truncate font-mono text-sm">{provider.channelName}</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{provider.targetBaseUrl}</span>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${healthColors[healthStatus]}`}
              aria-label={healthLabels[healthStatus]}
            />
            {onToggle ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={provider.enabled ? "secondary" : "outline"}
                      size="xs"
                      onClick={() => onToggle(!provider.enabled)}
                      disabled={isToggling}
                    >
                      {provider.enabled ? (
                        <Eye data-icon="inline-start" />
                      ) : (
                        <EyeOff data-icon="inline-start" />
                      )}
                      {isToggling ? "..." : provider.enabled ? t("common.enabled") : t("common.disabled")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {provider.enabled ? t("providers.disableChannel") : t("providers.enableChannel")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            <div className="flex gap-1">
              {onOpenTestDialog ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={onOpenTestDialog}
                  disabled={isTesting}
                >
                  <Wifi data-icon="inline-start" />
                  {isTesting ? t("common.testing") : t("common.test")}
                </Button>
              ) : null}
              {onEdit ? (
                <Button type="button" variant="outline" size="xs" onClick={onEdit}>
                  <SquarePen data-icon="inline-start" />
                  Edit
                </Button>
              ) : null}
              {onDelete ? (
                <Button type="button" variant="ghost" size="xs" onClick={onDelete}>
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {testResult ? (
          <Alert variant={testResult.status === "ok" ? "default" : "destructive"}>
            <AlertDescription className="flex items-center justify-between text-xs">
              <span>{testResult.message}</span>
              {testResult.latencyMs !== undefined && (
                <span className="text-muted-foreground">
                  {testResult.latencyMs}ms
                </span>
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={typeVariants[provider.type] ?? "outline"}>
            {typeLabels[provider.type] ?? provider.type}
          </Badge>
          {provider.type === "openai" ? (
            <Badge variant={responseModeVariants[provider.responsesMode ?? "native"]}>
              {t(`providers.responsesModeBadge.${provider.responsesMode ?? "native"}`)}
            </Badge>
          ) : null}
          <Badge variant="outline">priority {provider.priority}</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">        {provider.models.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Models {provider.models.length > MODEL_COLLAPSE_THRESHOLD ? `(${provider.models.length})` : ""}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(modelsExpanded
                  ? provider.models
                  : provider.models.slice(0, MODEL_COLLAPSE_THRESHOLD)
                ).map((model) => {
                  const formattedModel = formatProviderModel(model)

                  return (
                    <Badge key={formattedModel.key} variant="ghost" className="font-mono text-xs">
                      {formattedModel.label}
                    </Badge>
                  )
                })}
                {provider.models.length > MODEL_COLLAPSE_THRESHOLD && !modelsExpanded && (
                  <button
                    type="button"
                    onClick={() => setModelsExpanded(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    +{provider.models.length - MODEL_COLLAPSE_THRESHOLD} more
                  </button>
                )}
                {modelsExpanded && provider.models.length > MODEL_COLLAPSE_THRESHOLD && (
                  <button
                    type="button"
                    onClick={() => setModelsExpanded(false)}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}

        {provider.systemPrompt ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">System Prompt</span>
              <p className="line-clamp-4 text-xs text-muted-foreground">{provider.systemPrompt}</p>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
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
