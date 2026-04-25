import { useState } from "react"
import { useTranslation } from "react-i18next"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Textarea } from "@/components/ui/textarea"
import { JsonViewer } from "@/components/ui/json-viewer"
import { formatBytes, getPayloadBytes, getPayloadText } from "@/features/dashboard/utils"

export function PayloadPanel({
  title,
  payload,
  truncated,
}: {
  title: string
  payload: string | null | undefined
  truncated: boolean
}) {
  const { t } = useTranslation()
  const payloadText = getPayloadText(payload)
  const payloadBytes = getPayloadBytes(payload)
  const [viewMode, setViewMode] = useState<"json" | "raw">("json")

  let parsedJson: unknown = null
  let isValidJson = false

  if (payloadText) {
    try {
      parsedJson = JSON.parse(payloadText)
      isValidJson = true
    } catch {
      isValidJson = false
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {payloadText ? t("payload.supportCopyView") : t("payload.noContent")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {isValidJson && (
              <div className="flex gap-1">
                <Button
                  variant={viewMode === "json" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("json")}
                >
                  {t("payload.structured")}
                </Button>
                <Button
                  variant={viewMode === "raw" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("raw")}
                >
                  {t("payload.raw")}
                </Button>
              </div>
            )}
            <Badge variant="outline">
              {truncated ? t("payload.truncated") : t("payload.fullRetained")}
            </Badge>
            <Badge variant="outline">{formatBytes(payloadBytes)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {payloadText ? (
          viewMode === "json" && isValidJson ? (
            <div className="min-h-[24rem] w-full overflow-auto rounded-md border bg-background p-4">
              <JsonViewer data={parsedJson} defaultExpanded />
            </div>
          ) : (
            <Textarea
              readOnly
              value={payloadText}
              className="min-h-[24rem] w-full resize-none overflow-auto whitespace-pre-wrap break-all bg-background font-mono text-[11px] leading-5"
            />
          )
        ) : (
          <Empty className="border-border/70">
            <EmptyHeader>
              <EmptyTitle>{t("payload.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("payload.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}
