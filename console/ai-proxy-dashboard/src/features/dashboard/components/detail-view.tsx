import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { PayloadPanel } from "@/features/dashboard/components/payload-panel"
import type { ConsoleRequestDetail } from "@/features/dashboard/types"
import {
  extractReadableSseText,
  formatCount,
  formatDuration,
  formatTime,
  shortText,
} from "@/features/dashboard/utils"

function statusStyle(code: number | null): { bg: string; fg: string } {
  if (code == null) return { bg: "var(--muted)", fg: "var(--lrs-faint)" }
  if (code >= 500) return { bg: "var(--lrs-danger-bg)", fg: "var(--lrs-danger)" }
  if (code >= 400) return { bg: "var(--lrs-warn-bg)", fg: "var(--lrs-warn)" }
  return { bg: "var(--lrs-success-bg)", fg: "var(--lrs-success)" }
}

function MetricCell({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 font-mono text-sm font-semibold"
        style={highlight ? { color: "var(--primary)" } : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function ReadonlyTextCard({
  title,
  description,
  value,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  description: string
  value: string
  emptyTitle: string
  emptyDescription: string
}) {
  const hasContent = value.trim().length > 0 && value.trim() !== "{}"

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border/60">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {hasContent ? (
          <Textarea
            readOnly
            value={value}
            className="min-h-64 w-full resize-none overflow-auto whitespace-pre-wrap break-all bg-background font-mono text-[11px] leading-5"
          />
        ) : (
          <Empty className="border-border/70">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

export function DetailView({
  detail,
  error,
}: {
  detail: ConsoleRequestDetail | null
  error: string
}) {
  const { t } = useTranslation()

  // Empty state
  if (!detail) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center p-8">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>{t("detail.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {error || t("detail.emptyDesc")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    )
  }

  const record = detail.record
  const usage = record.response_usage ?? {}
  const timing = record.response_timing ?? {}
  const st = statusStyle(record.response_status)

  // Request meta rows for request tab
  const originalHeadersText = JSON.stringify(record.original_headers ?? {}, null, 2)
  const forwardHeadersText = JSON.stringify(record.forward_headers ?? {}, null, 2)
  const responseHeadersText = JSON.stringify(record.response_headers ?? {}, null, 2)
  const readableSseText = timing.has_streaming_content
    ? extractReadableSseText(record.response_payload)
    : ""

  const inputTokens = usage.uncached_input_tokens ?? usage.input_tokens ?? usage.total_input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? usage.total_output_tokens ?? 0
  const cacheReadTokens = record.upstream_type === "openai"
    ? Number(usage.cached_input_tokens ?? 0)
    : Number(usage.cache_read_input_tokens ?? 0)
  const cacheCreationTokens = record.upstream_type === "openai"
    ? 0
    : Number(usage.cache_creation_input_tokens ?? usage.total_cache_creation_tokens ?? 0)

  return (
    <div className="flex h-full flex-col bg-[#fdffff]">
      {/* Top: status + model + channel + request_id */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            className="rounded-md px-2.5 py-1 font-mono text-xs font-bold"
            style={{ background: st.bg, color: st.fg }}
          >
            {record.response_status ?? "--"}
          </span>
          <span className="text-[15px] font-bold text-foreground">
            {record.request_model}
          </span>
          <span className="text-xs text-muted-foreground">· {record.route_prefix}</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
            {shortText(record.request_id, 24)}
          </span>
        </div>
        {error ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>{t("detail.refreshFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* 4×2 metric grid — 首包/首Token/总耗时/生成 + 输入/输出/cache_read/cache_creation */}
        <div
          className="mt-4 grid overflow-hidden rounded-lg border border-border bg-border"
          style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 1 }}
        >
          <MetricCell
            label={t("detail.firstChunk")}
            value={formatDuration(timing.first_chunk_latency_ms)}
          />
          <MetricCell
            label={t("detail.firstToken")}
            value={formatDuration(timing.first_token_latency_ms)}
            highlight
          />
          <MetricCell
            label={t("detail.duration")}
            value={formatDuration(timing.duration_ms)}
          />
          <MetricCell
            label={t("detail.generationDuration")}
            value={formatDuration(timing.generation_duration_ms)}
          />
          <MetricCell
            label={t("detail.inputTokens")}
            value={formatCount(inputTokens)}
          />
          <MetricCell
            label={t("detail.outputTokens")}
            value={formatCount(outputTokens)}
          />
          <MetricCell
            label="cache_read"
            value={formatCount(cacheReadTokens)}
          />
          <MetricCell
            label="cache_creation"
            value={formatCount(cacheCreationTokens)}
          />
        </div>
      </div>

      {/* Tabs: 原始请求 / 转发请求 / 响应 — Design: LRS Clear 风格五 */}
      <Tabs defaultValue="request" className="flex min-h-0 flex-1 flex-col">
        <TabsList
          variant="line"
          className="shrink-0 !h-auto w-full justify-start gap-0 border-b border-border bg-transparent px-6 py-0"
        >
          <TabsTrigger
            value="request"
            className="mr-6 h-auto flex-none px-0.5 py-[11px] text-[13px] font-medium text-muted-foreground after:bottom-0 data-[state=active]:font-bold data-[state=active]:text-foreground"
            style={{ '--tabs-line-color': 'var(--primary)', '--tabs-line-bottom': '0px' } as React.CSSProperties}
          >
            {t("detail.tabRequest")}
          </TabsTrigger>
          <TabsTrigger
            value="forward"
            className="mr-6 h-auto flex-none px-0.5 py-[11px] text-[13px] font-medium text-muted-foreground after:bottom-0 data-[state=active]:font-bold data-[state=active]:text-foreground"
            style={{ '--tabs-line-color': 'var(--primary)', '--tabs-line-bottom': '0px' } as React.CSSProperties}
          >
            {t("detail.tabForward")}
          </TabsTrigger>
          <TabsTrigger
            value="response"
            className="mr-6 h-auto flex-none px-0.5 py-[11px] text-[13px] font-medium text-muted-foreground after:bottom-0 data-[state=active]:font-bold data-[state=active]:text-foreground"
            style={{ '--tabs-line-color': 'var(--primary)', '--tabs-line-bottom': '0px' } as React.CSSProperties}
          >
            {t("detail.tabResponse")}
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {/* Request Tab */}
            <TabsContent value="request" className="mt-0">
              <div className="space-y-3">
                <PayloadPanel
                  title={t("detail.originalPayload")}
                  payload={record.original_payload}
                  truncated={record.original_payload_truncated}
                />
                <ReadonlyTextCard
                  title={t("detail.originalHeaders")}
                  description={t("detail.originalHeadersDesc")}
                  value={originalHeadersText}
                  emptyTitle={t("detail.noOriginalHeaders")}
                  emptyDescription={t("detail.noOriginalHeadersDesc")}
                />
                {/* Meta info */}
                <Card size="sm">
                  <CardHeader className="border-b border-border/60">
                    <CardTitle>{t("detail.overviewTitle")}</CardTitle>
                    <CardDescription>{t("detail.overviewDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="text-muted-foreground">{t("detail.requestId")}</div>
                      <div className="font-mono text-foreground">{record.request_id}</div>
                      <div className="text-muted-foreground">{t("detail.time")}</div>
                      <div className="font-mono text-foreground">{formatTime(record.created_at)}</div>
                      <div className="text-muted-foreground">{t("detail.path")}</div>
                      <div className="break-all font-mono text-foreground">{record.path}</div>
                      <div className="text-muted-foreground">{t("detail.keySource")}</div>
                      <div className="text-foreground">{detail.client_label || "generic"}</div>
                      <div className="text-muted-foreground">{t("detail.targetUrl")}</div>
                      <div className="break-all font-mono text-foreground">{record.target_url}</div>
                      <div className="text-muted-foreground">{t("detail.upstreamType")}</div>
                      <div className="text-foreground">{record.upstream_type}</div>
                      {record.failover_from ? (
                        <>
                          <div className="text-muted-foreground">{t("detail.failoverReason")}</div>
                          <div className="text-foreground">{record.failover_reason || record.failover_from}</div>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Forward Tab */}
            <TabsContent value="forward" className="mt-0">
              <div className="space-y-3">
                <PayloadPanel
                  title={t("detail.forwardedPayload")}
                  payload={record.forwarded_payload}
                  truncated={record.forwarded_payload_truncated}
                />
                <ReadonlyTextCard
                  title={t("detail.forwardedHeaders")}
                  description={t("detail.forwardedHeadersDesc")}
                  value={forwardHeadersText}
                  emptyTitle={t("detail.noForwardedHeaders")}
                  emptyDescription={t("detail.noForwardedHeadersDesc")}
                />
              </div>
            </TabsContent>

            {/* Response Tab */}
            <TabsContent value="response" className="mt-0">
              <div className="space-y-3">
                {timing.has_streaming_content ? (
                  <ReadonlyTextCard
                    title={t("detail.sseConcat")}
                    description={t("detail.sseConcatDesc")}
                    value={readableSseText}
                    emptyTitle={t("detail.noSseConcat")}
                    emptyDescription={t("detail.noSseConcatDesc")}
                  />
                ) : null}
                <PayloadPanel
                  title={t("detail.responseBody")}
                  payload={record.response_payload}
                  truncated={record.response_payload_truncated}
                />
                <ReadonlyTextCard
                  title={t("detail.responseHeaders")}
                  description={t("detail.responseHeadersDesc")}
                  value={responseHeadersText}
                  emptyTitle={t("detail.noResponseHeaders")}
                  emptyDescription={t("detail.noResponseHeadersDesc")}
                />
              </div>
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      {/* Bottom action bar */}
      <div className="flex shrink-0 items-center gap-4 border-t border-border px-6 py-3">
        <span className="text-[11.5px] text-muted-foreground">
          {t("detail.bottomHint")}
        </span>
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            className="text-[11.5px] font-semibold text-primary hover:underline"
            onClick={() => {
              navigator.clipboard
                ?.writeText(JSON.stringify(record, null, 2))
                .then(() => toast.success(t("common.copied")))
                .catch(() => toast.error(t("common.copyFailed")))
            }}
          >
            {t("detail.copy")}
          </button>
        </div>
      </div>
    </div>
  )
}
