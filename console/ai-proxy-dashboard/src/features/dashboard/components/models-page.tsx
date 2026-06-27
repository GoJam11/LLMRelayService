import { useEffect, useState } from "react"
import { Pencil, RefreshCw, Terminal, Wifi } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { JsonViewer } from "@/components/ui/json-viewer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fetchModels, testProvider, updateModelMetadata } from "@/features/dashboard/api"
import type { ConsoleModelPricing, GatewayModel, TestProviderResult } from "@/features/dashboard/types"

function formatContext(context?: number) {
  if (!context) return "--"
  if (context >= 1000) return `${(context / 1000).toLocaleString("en-US")}K`
  return String(context)
}

function formatPrice(price?: number) {
  if (price === undefined || price === null) return "--"
  // models.dev stores prices in USD per million tokens
  return `$${price.toFixed(2)}`
}

function ModelTable({
  models,
  onTest,
  onEdit,
}: {
  models: GatewayModel[]
  onTest: (model: GatewayModel) => void
  onEdit: (model: GatewayModel) => void
}) {
  const { t } = useTranslation()
  if (models.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("models.noModelsTitle")}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>{t("models.noModelsDesc")}</EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("models.modelId")}</TableHead>
          <TableHead>{t("models.contextLength")}</TableHead>
          <TableHead>{t("models.inputPrice")}</TableHead>
          <TableHead>{t("models.outputPrice")}</TableHead>
          <TableHead>{t("models.channel")}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={`${model.channelName}:${model.id}`}>
            <TableCell className="font-mono text-xs">{model.id}</TableCell>
            <TableCell className="text-muted-foreground">
              <span>{formatContext(model.context)}</span>
              {model.override?.context != null && <Badge variant="secondary" className="ml-2 text-xs">{t("models.manualBadge")}</Badge>}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              <span>{formatPrice(model.pricing?.input)}</span>
              {model.override?.pricing && <Badge variant="secondary" className="ml-2 text-xs">{t("models.manualBadge")}</Badge>}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">{formatPrice(model.pricing?.output)}</TableCell>
            <TableCell>
              <Badge variant="outline" className="font-normal">
                {model.channelName}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onTest(model)}
                >
                  <Wifi data-icon="inline-start" />
                  {t("common.test")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onEdit(model)}
                >
                  <Pencil data-icon="inline-start" />
                  {t("common.edit")}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

type ModelMetadataDraft = {
  context: string
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
}

type ParsedModelMetadataDraft = {
  context: number | null
  pricing: Partial<ConsoleModelPricing> | null
}

function numberToDraft(value: number | undefined): string {
  return value == null ? "" : String(value)
}

function createMetadataDraft(model: GatewayModel): ModelMetadataDraft {
  const pricing = model.override?.pricing ?? model.pricing
  return {
    context: numberToDraft(model.override?.context ?? model.context),
    input: numberToDraft(pricing?.input),
    output: numberToDraft(pricing?.output),
    cacheRead: numberToDraft(pricing?.cache_read),
    cacheWrite: numberToDraft(pricing?.cache_write),
  }
}

function parseOptionalNumber(
  value: string,
  label: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  options: { integer?: boolean; min?: number } = {},
): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) {
    throw new Error(t("models.validationNumber", { label }))
  }
  if (options.integer && !Number.isInteger(numeric)) {
    throw new Error(t("models.validationInteger", { label }))
  }
  if (options.min != null && numeric < options.min) {
    throw new Error(t("models.validationMin", { label, min: options.min }))
  }
  return numeric
}

function buildPricingDraft(
  draft: ModelMetadataDraft,
  t: (key: string, options?: Record<string, unknown>) => string,
): Partial<ConsoleModelPricing> | null {
  const pricing = {
    input: parseOptionalNumber(draft.input, t("models.inputPrice"), t, { min: 0 }),
    output: parseOptionalNumber(draft.output, t("models.outputPrice"), t, { min: 0 }),
    cache_read: parseOptionalNumber(draft.cacheRead, t("models.cacheReadPrice"), t, { min: 0 }),
    cache_write: parseOptionalNumber(draft.cacheWrite, t("models.cacheWritePrice"), t, { min: 0 }),
  }
  if (pricing.input == null && pricing.output == null && pricing.cache_read == null && pricing.cache_write == null) {
    return null
  }
  if (pricing.input == null || pricing.output == null) {
    throw new Error(t("models.customPricingRequired"))
  }
  return {
    ...(pricing.input != null ? { input: pricing.input } : {}),
    ...(pricing.output != null ? { output: pricing.output } : {}),
    ...(pricing.cache_read != null ? { cache_read: pricing.cache_read } : {}),
    ...(pricing.cache_write != null ? { cache_write: pricing.cache_write } : {}),
  }
}

function parseMetadataDraft(
  draft: ModelMetadataDraft,
  t: (key: string, options?: Record<string, unknown>) => string,
): ParsedModelMetadataDraft {
  const context = parseOptionalNumber(draft.context, t("models.contextLength"), t, { integer: true, min: 1 })
  const pricing = buildPricingDraft(draft, t)
  return { context, pricing }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function ModelsPage({
  onUnauthorized,
  embedded = false,
}: {
  onUnauthorized: () => void
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const [openaiModels, setOpenaiModels] = useState<GatewayModel[] | null>(null)
  const [anthropicModels, setAntropicModels] = useState<GatewayModel[] | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogModel, setTestDialogModel] = useState<GatewayModel | null>(null)
  const [testDialogResult, setTestDialogResult] = useState<TestProviderResult | null>(null)
  const [testDialogLoading, setTestDialogLoading] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editDialogModel, setEditDialogModel] = useState<GatewayModel | null>(null)
  const [editDraft, setEditDraft] = useState<ModelMetadataDraft>({ context: "", input: "", output: "", cacheRead: "", cacheWrite: "" })
  const [editError, setEditError] = useState("")
  const [savingMetadata, setSavingMetadata] = useState(false)

  const loadModels = async () => {
    setLoading(true)
    try {
      const data = await fetchModels()
      setOpenaiModels(data.openai)
      setAntropicModels(data.anthropic)
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === "unauthorized") {
        onUnauthorized()
        return
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadModels()
  }, [])

  const openTestDialog = async (model: GatewayModel) => {
    setTestDialogModel(model)
    setTestDialogResult(null)
    setTestDialogOpen(true)
    setTestDialogLoading(true)
    try {
      const result = await testProvider(model.channelName, model.id)
      setTestDialogResult(result)
    } catch (err) {
      const errorResult: TestProviderResult = {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : String(err),
      }
      setTestDialogResult(errorResult)
    } finally {
      setTestDialogLoading(false)
    }
  }

  async function handleRetest() {
    if (!testDialogModel) return
    setTestDialogResult(null)
    setTestDialogLoading(true)
    try {
      const result = await testProvider(testDialogModel.channelName, testDialogModel.id)
      setTestDialogResult(result)
    } catch (err) {
      const errorResult: TestProviderResult = {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : String(err),
      }
      setTestDialogResult(errorResult)
    } finally {
      setTestDialogLoading(false)
    }
  }

  const openEditDialog = (model: GatewayModel) => {
    setEditDialogModel(model)
    setEditDraft(createMetadataDraft(model))
    setEditError("")
    setEditDialogOpen(true)
  }

  const handleSaveMetadata = async () => {
    if (!editDialogModel) return
    setSavingMetadata(true)
    try {
      const parsedDraft = parseMetadataDraft(editDraft, t)
      const updated = await updateModelMetadata(editDialogModel.channelName, editDialogModel.id, {
        context: parsedDraft.context,
        pricing: parsedDraft.pricing,
      })
      const updateList = (models: GatewayModel[] | null) => models?.map((model) => (
        model.channelName === updated.channelName && model.id === updated.id ? updated : model
      )) ?? null
      setOpenaiModels(updateList)
      setAntropicModels(updateList)
      setEditDialogOpen(false)
      setEditDialogModel(null)
      setEditError("")
      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === "unauthorized") {
        onUnauthorized()
        return
      }
      setEditError(message)
    } finally {
      setSavingMetadata(false)
    }
  }

  const totalCount = (openaiModels?.length ?? 0) + (anthropicModels?.length ?? 0)

  return (
    <div className="flex flex-col gap-6">
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {openaiModels !== null && anthropicModels !== null
              ? t("models.totalCount", { count: totalCount })
              : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadModels()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {t("common.refresh")}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadModels()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {t("common.refresh")}
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("common.loadFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Endpoint reference */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">{t("models.endpointsTitle")}</CardTitle>
          </div>
          <CardDescription>
            {t("models.endpointsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">{t("models.openaiProtocol")}</p>
              <div className="space-y-1">
                {["/openai/v1/chat/completions", "/openai/v1/responses", "/openai/v1/models"].map((path) => (
                  <code key={path} className="block rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                    {path}
                  </code>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">{t("models.anthropicProtocol")}</p>
              <div className="space-y-1">
                {["/anthropic/v1/messages", "/anthropic/v1/messages/count_tokens", "/anthropic/v1/models"].map((path) => (
                  <code key={path} className="block rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                    {path}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Anthropic */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Anthropic</CardTitle>
            {anthropicModels !== null && (
              <Badge variant="secondary">{anthropicModels.length}</Badge>
            )}
          </div>
          <CardDescription>{t("models.anthropicDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {anthropicModels === null ? (
            <LoadingSkeleton />
          ) : (
            <ModelTable models={anthropicModels} onTest={openTestDialog} onEdit={openEditDialog} />
          )}
        </CardContent>
      </Card>

      {/* OpenAI */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>OpenAI</CardTitle>
            {openaiModels !== null && (
              <Badge variant="secondary">{openaiModels.length}</Badge>
            )}
          </div>
          <CardDescription>{t("models.openaiDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {openaiModels === null ? (
            <LoadingSkeleton />
          ) : (
            <ModelTable models={openaiModels} onTest={openTestDialog} onEdit={openEditDialog} />
          )}
        </CardContent>
      </Card>

      {/* 测试弹窗 */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("models.testDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("models.testDialogDesc", { model: testDialogModel?.id, channel: testDialogModel?.channelName })}
            </DialogDescription>
          </DialogHeader>

          {testDialogLoading && !testDialogResult && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("common.testing")}...
            </div>
          )}

          {testDialogResult && (
            <div className="flex flex-col gap-3">
              <Alert variant={testDialogResult.status === "ok" ? "default" : "destructive"}>
                <AlertTitle>
                  {testDialogResult.status === "ok" ? t("models.testSuccess") : t("models.testFailed")}
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
                  <span className="text-sm font-medium">{t("models.rawResponse")}</span>
                  <ScrollArea className="h-75 rounded-md border bg-muted/30 p-3">
                    <JsonViewer data={testDialogResult.rawResponse} defaultExpanded />
                  </ScrollArea>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTestDialogOpen(false)}
            >
              {t("common.close")}
            </Button>
            {testDialogResult && (
              <Button
                type="button"
                onClick={handleRetest}
                disabled={testDialogLoading}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={testDialogLoading ? "animate-spin" : ""}
                />
                {testDialogLoading ? `${t("common.testing")}...` : t("models.retest")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("models.editDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("models.editDialogDesc", { model: editDialogModel?.id, channel: editDialogModel?.channelName })}
            </DialogDescription>
          </DialogHeader>
          {editError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("common.saveFailed")}</AlertTitle>
              <AlertDescription>{editError}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="model-context-override">{t("models.contextLength")}</FieldLabel>
              <FieldContent>
                <Input
                  id="model-context-override"
                  inputMode="numeric"
                  placeholder={t("models.emptyMeansAuto")}
                  value={editDraft.context}
                  onChange={(event) => setEditDraft((current) => ({ ...current, context: event.target.value }))}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-input-price-override">{t("models.inputPrice")}</FieldLabel>
              <FieldContent>
                <Input
                  id="model-input-price-override"
                  inputMode="decimal"
                  placeholder={t("models.emptyMeansAuto")}
                  value={editDraft.input}
                  onChange={(event) => setEditDraft((current) => ({ ...current, input: event.target.value }))}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-output-price-override">{t("models.outputPrice")}</FieldLabel>
              <FieldContent>
                <Input
                  id="model-output-price-override"
                  inputMode="decimal"
                  placeholder={t("models.emptyMeansAuto")}
                  value={editDraft.output}
                  onChange={(event) => setEditDraft((current) => ({ ...current, output: event.target.value }))}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-cache-read-price-override">{t("models.cacheReadPrice")}</FieldLabel>
              <FieldContent>
                <Input
                  id="model-cache-read-price-override"
                  inputMode="decimal"
                  placeholder={t("models.emptyMeansAuto")}
                  value={editDraft.cacheRead}
                  onChange={(event) => setEditDraft((current) => ({ ...current, cacheRead: event.target.value }))}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-cache-write-price-override">{t("models.cacheWritePrice")}</FieldLabel>
              <FieldContent>
                <Input
                  id="model-cache-write-price-override"
                  inputMode="decimal"
                  placeholder={t("models.emptyMeansAuto")}
                  value={editDraft.cacheWrite}
                  onChange={(event) => setEditDraft((current) => ({ ...current, cacheWrite: event.target.value }))}
                />
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button type="button" disabled={savingMetadata} onClick={() => void handleSaveMetadata()}>
              {savingMetadata ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
