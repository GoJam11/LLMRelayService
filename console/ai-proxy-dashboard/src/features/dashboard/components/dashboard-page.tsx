import { useMemo } from "react"
import { Activity, MoveRight, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Combobox } from "@/components/ui/combobox"
import { PageHeader } from "@/components/ui/page-header"
import { ChannelHealth } from "@/features/dashboard/components/channel-health"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { useDashboardStats } from "@/features/dashboard/hooks/use-dashboard-stats"
import type { DashboardRange } from "@/features/dashboard/hooks/use-dashboard-stats"
import {
  formatCount,
  formatDuration,
  formatPercent,
  getHttpStatusBadgeVariant,
  shortText,
  formatTime,
} from "@/features/dashboard/utils"

export function DashboardPage({
  onUnauthorized,
  onNavigateToLogs,
}: {
  onUnauthorized: () => void
  onNavigateToLogs: () => void
}) {
  const { t } = useTranslation()
  const {
    overview,
    stats,
    requests,
    refresh,
    routeFilter,
    setRouteFilter,
    rangeFilter,
    setRangeFilter,
  } = useDashboardStats(onUnauthorized)

  const routeOptions = useMemo(
    () =>
      (stats?.routes || []).map((route) => ({
        value: route.key,
        label: route.label,
      })),
    [stats?.routes],
  )

  const total = overview?.total ?? 0
  const errors = overview?.errors ?? 0
  const successCount = Math.max(0, total - errors)
  const successRate = total > 0 ? (successCount / total) * 100 : 0

  const overviewCards = [
    {
      title: t("monitor.totalRequests"),
      value: formatCount(total),
      description: t("monitor.successCount", { success: formatCount(successCount), errors: formatCount(errors) }),
    },
    {
      title: t("monitor.successRate"),
      value: formatPercent(successRate),
      description: t("monitor.totalCount", { total: formatCount(total) }),
    },
    {
      title: t("monitor.errorRequests"),
      value: formatCount(errors),
      description: total > 0 ? t("monitor.errorRate", { rate: formatPercent((errors / total) * 100) }) : t("common.noData"),
    },
    {
      title: t("monitor.failovers"),
      value: formatCount(overview?.failovers),
      description: total > 0 ? t("monitor.failoverRate", { rate: formatPercent(((overview?.failovers ?? 0) / total) * 100) }) : t("common.noData"),
    },
  ]

  const operationsCards = [
    {
      title: t("monitor.avgFirstChunk"),
      value: formatDuration(overview?.avg_first_chunk_ms),
      description: t("monitor.avgFirstChunkDesc"),
    },
    {
      title: t("monitor.avgFirstToken"),
      value: formatDuration(overview?.avg_first_token_ms),
      description: t("monitor.avgFirstTokenDesc"),
    },
    {
      title: t("monitor.avgDuration"),
      value: formatDuration(overview?.avg_duration_ms),
      description: t("monitor.avgDurationDesc"),
    },
    {
      title: t("monitor.avgGeneration"),
      value: formatDuration(overview?.avg_generation_ms),
      description: t("monitor.avgGenerationDesc"),
    },
  ]

  const cacheCards = [
    {
      title: t("monitor.cacheHitRate"),
      value: formatPercent(overview?.hit_rate),
      description: t("monitor.cacheHitDesc", { hits: formatCount(overview?.cache_hits), creates: formatCount(overview?.cache_creates) }),
    },
    {
      title: t("monitor.cacheHits"),
      value: formatCount(overview?.cache_hits),
      description: t("monitor.cacheHitsDesc"),
    },
    {
      title: t("monitor.cacheCreates"),
      value: formatCount(overview?.cache_creates),
      description: t("monitor.cacheCreatesDesc"),
    },
    {
      title: t("monitor.cacheMisses"),
      value: formatCount(overview?.cache_misses),
      description: t("monitor.cacheMissesDesc"),
    },
  ]

  // ── Request trend chart data ───────────────────────────────
  const trendData = useMemo(() => {
    if (!requests.length) return []

    const bucketSizeMs: Record<DashboardRange, number> = {
      "1h":  5 * 60 * 1000,
      "24h": 60 * 60 * 1000,
      "72h": 3 * 60 * 60 * 1000,
      "7d":  24 * 60 * 60 * 1000,
      "30d": 24 * 60 * 60 * 1000,
      "all": 7 * 24 * 60 * 60 * 1000,
    }
    const size = bucketSizeMs[rangeFilter]
    const bucketMap = new Map<number, { total: number; errors: number }>()

    for (const req of requests) {
      const tsMs = req.created_at < 1e12 ? req.created_at * 1000 : req.created_at
      const bucket = Math.floor(tsMs / size) * size
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, { total: 0, errors: 0 })
      const entry = bucketMap.get(bucket)!
      entry.total++
      if (req.response_status == null || req.response_status >= 400) entry.errors++
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, data]) => {
        const d = new Date(ts)
        let label: string
        if (rangeFilter === "1h") {
          label = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        } else if (rangeFilter === "24h" || rangeFilter === "72h") {
          label = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`
        } else {
          label = `${d.getMonth() + 1}/${d.getDate()}`
        }
        return { bucket: label, total: data.total, errors: data.errors }
      })
  }, [requests, rangeFilter])

  // ── Recent requests (newest first) ────────────────────────
  const recentRequests = useMemo(() => requests.slice(0, 8), [requests])

  const trendChartConfig = {
    total: { label: t("monitor.totalRequests"), color: "var(--color-chart-1)" },
    errors: { label: t("monitor.errorRequests"), color: "var(--color-chart-3)" },
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header row: title on left, filters + actions on right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          icon={Activity}
          title={t("monitor.title")}
          description={t("monitor.description")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            options={routeOptions}
            value={routeFilter}
            onChange={setRouteFilter}
            placeholder={t("monitor.allRoutes")}
            searchPlaceholder={t("common.searchRoute")}
            className="w-40"
          />
          <Combobox
            options={[
              { value: "1h", label: t("timeRange.1h") },
              { value: "24h", label: t("timeRange.24h") },
              { value: "72h", label: t("timeRange.72h") },
              { value: "7d", label: t("timeRange.7d") },
              { value: "30d", label: t("timeRange.30d") },
              { value: "all", label: t("timeRange.all") },
            ]}
            value={rangeFilter}
            onChange={(value) => setRangeFilter((value || "24h") as typeof rangeFilter)}
            placeholder={t("timeRange.placeholder")}
            searchPlaceholder={t("common.searchTimeRange")}
            className="w-36"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { void refresh() }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.refreshData")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onNavigateToLogs}>
            {t("common.viewLogs")}
            <MoveRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      {/* Overview metric cards — directly visible without wrapper */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((item, i) => (
          <MetricCard
            key={item.title}
            title={item.title}
            value={item.value}
            description={item.description}
            color={(["blue", "green", "amber", "purple"] as const)[i % 4]}
          />
        ))}
      </div>

      {/* Request trend chart + Recent requests */}
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Request volume trend chart */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("monitor.requestTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <ChartContainer config={trendChartConfig} className="min-h-[200px] w-full">
                <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-3)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-chart-3)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    tick={{ fontSize: 11 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    fill="url(#totalFill)"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="errors"
                    fill="url(#errorFill)"
                    stroke="var(--color-chart-3)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent requests mini list */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("monitor.recentRequests")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentRequests.length > 0 ? (
              <div className="overflow-hidden">
                {recentRequests.map((req) => (
                  <div
                    key={req.request_id}
                    className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant={getHttpStatusBadgeVariant(req.response_status)}
                        className="tabular-nums shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {req.response_status ?? "—"}
                      </Badge>
                      <span className="text-xs truncate text-muted-foreground max-w-[110px]">
                        {shortText(req.route_prefix ?? "", 22)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 pl-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(req.response_timing?.duration_ms)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatTime(req.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>


      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{t("monitor.latencyMetrics")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {operationsCards.map((item, i) => (
            <MetricCard
              key={item.title}
              title={item.title}
              value={item.value}
              description={item.description}
              color={(["cyan", "blue", "purple", "amber"] as const)[i % 4]}
            />
          ))}
        </div>
      </div>

      {/* Cache health + system metrics */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{t("monitor.cacheHealth")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cacheCards.map((item, i) => (
            <MetricCard
              key={item.title}
              title={item.title}
              value={item.value}
              description={item.description}
              color={(["green", "cyan", "amber", "purple"] as const)[i % 4]}
            />
          ))}
          <MetricCard
            title={t("monitor.storageBackend")}
            value={overview?.storage_backend?.toUpperCase() ?? "PG"}
            description={t("monitor.retentionDescription", { count: formatCount(overview?.retention_max_records) })}
          />
        </div>
      </div>

      {/* Channel health table */}
      <ChannelHealth requests={requests} />
    </div>
  )
}
