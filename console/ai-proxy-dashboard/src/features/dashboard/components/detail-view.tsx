import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { DetailMetricTable } from "@/features/dashboard/components/detail-metric-table"
import { PayloadPanel } from "@/features/dashboard/components/payload-panel"
import type { ConsoleRequestDetail } from "@/features/dashboard/types"
import {
  extractReadableSseText,
  formatBytes,
  formatDuration,
  formatTime,
  getCostMetricRows,
  getUsageMetricRows,
  shortText,
} from "@/features/dashboard/utils"

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

  if (!detail) {
    return (
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle>{t("detail.detailTitle")}</CardTitle>
          <CardDescription>{t("detail.detailDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Empty className="border-border/70">
            <EmptyHeader>
              <EmptyTitle>{t("detail.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {error || t("detail.emptyDesc")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  const record = detail.record
  const analysis = detail.analysis
  const sourceRequestType = detail.source_request_type ?? "unknown"
  const usage = record.response_usage ?? {}
  const timing = record.response_timing ?? {}
  const requestRows = [
    { label: t("detail.requestId"), value: record.request_id },
    { label: t("detail.time"), value: formatTime(record.created_at) },
    { label: t("detail.path"), value: record.path },
    { label: t("detail.routePrefix"), value: record.failover_from ? `${record.original_route_prefix || record.failover_from} → ${record.route_prefix}` : record.route_prefix },
    {
      label: t("detail.keySource"),
      value: detail.client_label || "generic",
    },
    { label: t("detail.requestModel"), value: record.request_model },
    { label: t("detail.responseModel"), value: usage.model || "--" },
    { label: t("detail.targetUrl"), value: record.target_url },
    { label: t("detail.upstreamType"), value: record.upstream_type },
    {
      label: t("detail.httpStatus"),
      value: `${record.response_status ?? "--"} ${record.response_status_text || ""}`.trim(),
    },
    ...(record.failover_reason ? [{ label: t("detail.failoverReason"), value: record.failover_reason }] : []),
  ]
  const timingRows = [
    { label: t("detail.firstChunk"), value: formatDuration(timing.first_chunk_latency_ms) },
    { label: t("detail.firstToken"), value: formatDuration(timing.first_token_latency_ms) },
    { label: t("detail.duration"), value: formatDuration(timing.duration_ms) },
    {
      label: t("detail.generationDuration"),
      value: formatDuration(timing.generation_duration_ms),
    },
    { label: t("detail.responseBodySize"), value: formatBytes(timing.response_body_bytes) },
    {
      label: t("detail.transferMode"),
      value: timing.has_streaming_content ? t("detail.streaming") : t("detail.nonStreaming"),
    },
  ]
  const usageRows = getUsageMetricRows(usage, timing, record.upstream_type)
  const costRows = getCostMetricRows(usage, record.request_model, record.upstream_type)
  const originalHeadersText = JSON.stringify(record.original_headers ?? {}, null, 2)
  const forwardHeadersText = JSON.stringify(record.forward_headers ?? {}, null, 2)
  const responseHeadersText = JSON.stringify(record.response_headers ?? {}, null, 2)
  const readableSseText = timing.has_streaming_content
    ? extractReadableSseText(record.response_payload)
    : ""

  return (
    <Card className="flex flex-col">
      <CardHeader className="shrink-0 gap-4 border-b border-border/60">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{record.route_prefix}</Badge>
            <Badge variant="outline">{record.upstream_type}</Badge>
            <Badge variant="outline">
              {analysis.summary}
            </Badge>
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl tracking-tight break-all">
              {record.path}
            </CardTitle>
            <CardDescription>
              {formatTime(record.created_at)} · {record.request_model} · user_id {shortText(record.forwarded_summary?.metadata_user_id, 28)}
            </CardDescription>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("detail.refreshFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardHeader>
      <ScrollArea className="min-h-0 flex-1">
        <CardContent className="min-w-0 pt-4">
        <Tabs defaultValue="summary" className="min-w-0 gap-4">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="summary">{t("detail.tabSummary")}</TabsTrigger>
            <TabsTrigger value="request">{t("detail.tabRequest")}</TabsTrigger>
            <TabsTrigger value="response">{t("detail.tabResponse")}</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-4">
            <div className="grid gap-4">
              <Card size="sm">
                <CardHeader className="border-b border-border/60">
                  <CardTitle>{t("detail.overviewTitle")}</CardTitle>
                  <CardDescription>{t("detail.overviewDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <DetailMetricTable rows={requestRows} />
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader className="border-b border-border/60">
                  <CardTitle>{t("detail.timingTitle")}</CardTitle>
                  <CardDescription>{t("detail.timingDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <DetailMetricTable rows={timingRows} />
                </CardContent>
              </Card>
            </div>

            <Card size="sm">
              <CardHeader className="border-b border-border/60">
                <CardTitle>{t("detail.tokenTitle")}</CardTitle>
                <CardDescription>{t("detail.tokenDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <DetailMetricTable rows={usageRows} />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader className="border-b border-border/60">
                <CardTitle>{t("detail.costTitle")}</CardTitle>
                <CardDescription>{t("detail.costDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <DetailMetricTable rows={costRows} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="request" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <PayloadPanel
                title={t("detail.originalPayload")}
                payload={record.original_payload}
                truncated={record.original_payload_truncated}
              />
              <PayloadPanel
                title={t("detail.forwardedPayload")}
                payload={record.forwarded_payload}
                truncated={record.forwarded_payload_truncated}
              />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ReadonlyTextCard
                title={t("detail.originalHeaders")}
                description={t("detail.originalHeadersDesc")}
                value={originalHeadersText}
                emptyTitle={t("detail.noOriginalHeaders")}
                emptyDescription={t("detail.noOriginalHeadersDesc")}
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

          <TabsContent value="response" className="space-y-4">
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
          </TabsContent>
        </Tabs>
      </CardContent>
      </ScrollArea>
    </Card>
  )
}
