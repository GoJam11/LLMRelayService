import { useCallback, useEffect, useRef, useState } from "react"
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
import { fetchRequestDetail } from "@/features/dashboard/api"
import { DetailView } from "@/features/dashboard/components/detail-view"
import type { ConsoleRequestDetail } from "@/features/dashboard/types"

export function DetailPage({
  requestId,
  onUnauthorized,
  onBack,
}: {
  requestId: string
  onUnauthorized: () => void
  onBack: () => void
}) {
  const [detail, setDetail] = useState<ConsoleRequestDetail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const loadIdRef = useRef(0)
  const { t } = useTranslation()

  const loadDetail = useCallback(async () => {
    const loadId = ++loadIdRef.current
    setLoading(true)

    try {
      const data = await fetchRequestDetail(requestId)
      if (loadId !== loadIdRef.current) return
      setDetail(data)
      setError("")
    } catch (err) {
      if (loadId !== loadIdRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (message === "unauthorized") {
        onUnauthorized()
        return
      }
      setError(message)
    } finally {
      if (loadId === loadIdRef.current) {
        setLoading(false)
      }
    }
  }, [requestId, onUnauthorized])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t("detail.backToLogs")}
        </Button>
        <Badge variant="outline" className="font-mono text-xs">
          {requestId}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void loadDetail()}
        >
          {t("common.refresh")}
        </Button>
      </div>

      {loading && !detail ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.loadingTitle")}</CardTitle>
            <CardDescription>{t("detail.loadingDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              {t("detail.requestIdLabel", { id: requestId })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <DetailView detail={detail} error={error} />
      )}
    </div>
  )
}
