import { useEffect, useState } from "react"
import { BookOpen, RefreshCw, Terminal, Wifi } from "lucide-react"
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
  EmptyTitle,
} from "@/components/ui/empty"
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
import { fetchModels, testProvider } from "@/features/dashboard/api"
import type { GatewayModel, TestProviderResult } from "@/features/dashboard/types"

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
}: {
  models: GatewayModel[]
  onTest: (model: GatewayModel) => void
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
          <TableRow key={model.id}>
            <TableCell className="font-mono text-xs">{model.id}</TableCell>
            <TableCell className="text-muted-foreground">{formatContext(model.context)}</TableCell>
            <TableCell className="text-muted-foreground tabular-nums">{formatPrice(model.pricing?.input)}</TableCell>
            <TableCell className="text-muted-foreground tabular-nums">{formatPrice(model.pricing?.output)}</TableCell>
            <TableCell>
              <Badge variant="outline" className="font-normal">
                {model.channelName}
              </Badge>
            </TableCell>
            <TableCell>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onTest(model)}
              >
                <Wifi data-icon="inline-start" />
                {t("common.test")}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
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

export function ModelsPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useTranslation()
  const [openaiModels, setOpenaiModels] = useState<GatewayModel[] | null>(null)
  const [anthropicModels, setAntropicModels] = useState<GatewayModel[] | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogModel, setTestDialogModel] = useState<GatewayModel | null>(null)
  const [testDialogResult, setTestDialogResult] = useState<TestProviderResult | null>(null)
  const [testDialogLoading, setTestDialogLoading] = useState(false)

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

  const totalCount = (openaiModels?.length ?? 0) + (anthropicModels?.length ?? 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BookOpen}
        title={t("models.title")}
        description={
          openaiModels !== null && anthropicModels !== null
            ? t("models.totalCount", { count: totalCount })
            : undefined
        }
        actions={
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
        }
      />

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
            <ModelTable models={anthropicModels} onTest={openTestDialog} />
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
            <ModelTable models={openaiModels} onTest={openTestDialog} />
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
    </div>
  )
}
