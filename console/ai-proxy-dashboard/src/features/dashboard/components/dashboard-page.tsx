import { useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  MoveRight,
  RefreshCw,
  Zap,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"

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
  formatTime,
  getHttpStatusBadgeVariant,
  shortText,
} from "@/features/dashboard/utils"

// Mini sparkline — tiny line chart without axes
function MiniSparkline({ data, color = "#10b981" }: { data: number[]; color?: string }) {
  if (data.length < 2) return <span className="text-muted-foreground/50 text-xs">—</span>
  return (
    <LineChart
      width={60}
      height={28}
      data={data.map((v) => ({ v }))}
      margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
    >
      <Line
        type="monotone"
        dataKey="v"
        stroke={color}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  )
}

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

  const [trendTab, setTrendTab] = useState<"requests" | "success" | "latency">("requests")

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

  // ── Request trend chart data ───────────────────────────────
  const trendData = useMemo(() => {
    if (!requests.length) return []

    const bucketSizeMs: Record<DashboardRange, number> = {
      "1h": 5 * 60 * 1000,
      "24h": 60 * 60 * 1000,
      "72h": 3 * 60 * 60 * 1000,
      "7d": 24 * 60 * 60 * 1000,
      "30d": 24 * 60 * 60 * 1000,
      "all": 7 * 24 * 60 * 60 * 1000,
    }
    const size = bucketSizeMs[rangeFilter]
    const bucketMap = new Map<number, { total: number; errors: number; totalLatency: number; latencyCount: number }>()

    for (const req of requests) {
      const tsMs = req.created_at < 1e12 ? req.created_at * 1000 : req.created_at
      const bucket = Math.floor(tsMs / size) * size
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, { total: 0, errors: 0, totalLatency: 0, latencyCount: 0 })
      const entry = bucketMap.get(bucket)!
      entry.total++
      if (req.response_status == null || req.response_status >= 400) entry.errors++
      if (req.response_timing?.duration_ms != null) {
        entry.totalLatency += req.response_timing.duration_ms
        entry.latencyCount++
      }
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
        const bucketSuccessRate = data.total > 0 ? ((data.total - data.errors) / data.total) * 100 : 0
        const avgLatency = data.latencyCount > 0 ? data.totalLatency / data.latencyCount : 0
        return { bucket: label, total: data.total, errors: data.errors, successRate: bucketSuccessRate, avgLatency }
      })
  }, [requests, rangeFilter])

  // ── Per-route hourly sparkline data ───────────────────────
  const routeSparklines = useMemo(() => {
    const bucketMs = 60 * 60 * 1000
    const routeBuckets = new Map<string, Map<number, number>>()
    for (const req of requests) {
      const tsMs = req.created_at < 1e12 ? req.created_at * 1000 : req.created_at
      const bucket = Math.floor(tsMs / bucketMs) * bucketMs
      const route = req.route_prefix
      if (!routeBuckets.has(route)) routeBuckets.set(route, new Map())
      const m = routeBuckets.get(route)!
      m.set(bucket, (m.get(bucket) ?? 0) + 1)
    }
    const result: Record<string, number[]> = {}
    for (const [route, buckets] of routeBuckets.entries()) {
      result[route] = Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .slice(-6)
        .map(([, v]) => v)
    }
    return result
  }, [requests])

  // ── Recent logs (newest first, last 10) ──────────────────
  const recentLogs = useMemo(() => requests.slice(0, 10), [requests])

  const trendChartConfig = {
    total: { label: t("monitor.tabRequests"), color: "var(--color-chart-1)" },
    errors: { label: t("monitor.errorRequests"), color: "var(--color-chart-3)" },
    successRate: { label: t("monitor.tabSuccessRate"), color: "var(--color-chart-2)" },
    avgLatency: { label: t("monitor.tabLatency"), color: "var(--color-chart-4)" },
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

      {/* Overview metric cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={t("monitor.totalRequests")}
          value={formatCount(total)}
          description={t("monitor.successCount", { success: formatCount(successCount), errors: formatCount(errors) })}
          color="blue"
          icon={Layers}
        />
        <MetricCard
          title={t("monitor.successRate")}
          value={formatPercent(successRate)}
          description={t("monitor.totalCount", { total: formatCount(total) })}
          color="green"
          icon={CheckCircle2}
        />
        <MetricCard
          title={t("monitor.errorRequests")}
          value={formatCount(errors)}
          description={total > 0 ? t("monitor.errorRate", { rate: formatPercent((errors / total) * 100) }) : t("common.noData")}
          color="amber"
          icon={AlertTriangle}
        />
        <MetricCard
          title={t("monitor.failovers")}
          value={formatCount(overview?.failovers)}
          description={total > 0 ? t("monitor.failoverRate", { rate: formatPercent(((overview?.failovers ?? 0) / total) * 100) }) : t("common.noData")}
          color="purple"
          icon={ArrowLeftRight}
        />
      </div>

      {/* Full-width request trend chart with tab switcher */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium">{t("monitor.requestTrend")}</CardTitle>
            <div className="flex gap-1">
              {(["requests", "success", "latency"] as const).map((tab) => (
                <Button
                  key={tab}
                  size="sm"
                  variant={trendTab === tab ? "default" : "ghost"}
                  className="h-7 px-3 text-xs"
                  onClick={() => setTrendTab(tab)}
                >
                  {tab === "requests"
                    ? t("monitor.tabRequests")
                    : tab === "success"
                      ? t("monitor.tabSuccessRate")
                      : t("monitor.tabLatency")}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trendData.length > 0 ? (
            <ChartContainer config={trendChartConfig} className="min-h-[220px] w-full">
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
                  <linearGradient id="successFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-4)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-chart-4)" stopOpacity={0.05} />
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
                {trendTab === "requests" && (
                  <>
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
                  </>
                )}
                {trendTab === "success" && (
                  <Area
                    type="monotone"
                    dataKey="successRate"
                    fill="url(#successFill)"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2}
                  />
                )}
                {trendTab === "latency" && (
                  <Area
                    type="monotone"
                    dataKey="avgLatency"
                    fill="url(#latencyFill)"
                    stroke="var(--color-chart-4)"
                    strokeWidth={2}
                  />
                )}
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-xs text-muted-foreground">
              {t("common.noData")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel status + Recent logs */}
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Channel status table */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("monitor.channelStatus")}</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onNavigateToLogs}
              >
                {t("monitor.viewAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(stats?.routes || []).length > 0 ? (
              <div className="overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border/50 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <span>{t("monitor.channelName")}</span>
                  <span>{t("monitor.statusLabel")}</span>
                  <span className="text-right">{t("monitor.tabSuccessRate")}</span>
                  <span className="text-right">{t("monitor.tabLatency")}</span>
                  <span className="pr-1 text-right">{t("monitor.trend")}</span>
                </div>
                {(stats?.routes || []).slice(0, 6).map((route) => {
                  const routeTotal = route.requests
                  const routeErrors = route.errors
                  const routeSuccessRate = routeTotal > 0 ? ((routeTotal - routeErrors) / routeTotal) * 100 : null
                  const errorRate = routeTotal > 0 ? routeErrors / routeTotal : 0
                  const statusColor =
                    !routeTotal
                      ? "bg-gray-400"
                      : errorRate < 0.05
                        ? "bg-emerald-500"
                        : errorRate < 0.2
                          ? "bg-amber-500"
                          : "bg-red-500"
                  const statusLabel =
                    !routeTotal
                      ? t("monitor.statusUnknown")
                      : errorRate < 0.05
                        ? t("monitor.statusHealthy")
                        : errorRate < 0.2
                          ? t("monitor.statusDegraded")
                          : t("monitor.statusDown")
                  const sparkColor =
                    errorRate < 0.05 ? "#10b981" : errorRate < 0.2 ? "#f59e0b" : "#ef4444"
                  const sparkData = routeSparklines[route.key] ?? []
                  return (
                    <div
                      key={route.key}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-border/50 px-4 py-2.5 last:border-0 transition-colors hover:bg-muted/30"
                    >
                      <span className="truncate text-sm font-medium">{route.label || route.key}</span>
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        {statusLabel}
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {routeSuccessRate != null ? formatPercent(routeSuccessRate) : "—"}
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {formatDuration(route.avg_duration_ms)}
                      </span>
                      <span className="flex justify-end">
                        <MiniSparkline data={sparkData} color={sparkColor} />
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent logs */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("monitor.recentLogs")}</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onNavigateToLogs}
              >
                {t("monitor.viewAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentLogs.length > 0 ? (
              <div className="overflow-hidden">
                {recentLogs.map((req) => {
                  const method =
                    req.path?.toLowerCase().includes("/models") &&
                    !req.path?.toLowerCase().includes("/chat")
                      ? "GET"
                      : "POST"
                  const methodColor =
                    method === "GET"
                      ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
                  return (
                    <div
                      key={req.request_id}
                      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 last:border-0 transition-colors hover:bg-muted/30"
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${methodColor}`}
                      >
                        {method}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {shortText(req.path ?? "", 28)}
                      </span>
                      <Badge
                        variant={getHttpStatusBadgeVariant(req.response_status)}
                        className="shrink-0 px-1.5 py-0 text-[10px] tabular-nums"
                      >
                        {req.response_status ?? "—"}
                      </Badge>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatDuration(req.response_timing?.duration_ms)}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">
                        {formatTime(req.created_at)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latency metrics section */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{t("monitor.latencyMetrics")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title={t("monitor.avgFirstChunk")}
            value={formatDuration(overview?.avg_first_chunk_ms)}
            description={t("monitor.avgFirstChunkDesc")}
            color="cyan"
            icon={Gauge}
          />
          <MetricCard
            title={t("monitor.avgFirstToken")}
            value={formatDuration(overview?.avg_first_token_ms)}
            description={t("monitor.avgFirstTokenDesc")}
            color="blue"
            icon={Zap}
          />
          <MetricCard
            title={t("monitor.avgDuration")}
            value={formatDuration(overview?.avg_duration_ms)}
            description={t("monitor.avgDurationDesc")}
            color="purple"
            icon={Clock}
          />
          <MetricCard
            title={t("monitor.avgGeneration")}
            value={formatDuration(overview?.avg_generation_ms)}
            description={t("monitor.avgGenerationDesc")}
            color="amber"
            icon={BarChart3}
          />
        </div>
      </div>

      {/* Cache health + system metrics */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{t("monitor.cacheHealth")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title={t("monitor.cacheHitRate")}
            value={formatPercent(overview?.hit_rate)}
            description={t("monitor.cacheHitDesc", { hits: formatCount(overview?.cache_hits), creates: formatCount(overview?.cache_creates) })}
            color="green"
          />
          <MetricCard
            title={t("monitor.cacheHits")}
            value={formatCount(overview?.cache_hits)}
            description={t("monitor.cacheHitsDesc")}
            color="cyan"
          />
          <MetricCard
            title={t("monitor.cacheCreates")}
            value={formatCount(overview?.cache_creates)}
            description={t("monitor.cacheCreatesDesc")}
            color="amber"
          />
          <MetricCard
            title={t("monitor.cacheMisses")}
            value={formatCount(overview?.cache_misses)}
            description={t("monitor.cacheMissesDesc")}
            color="purple"
          />
          <MetricCard
            title={t("monitor.storageBackend")}
            value={overview?.storage_backend?.toUpperCase() ?? "PG"}
            description={t("monitor.retentionDescription", { count: formatCount(overview?.retention_max_records) })}
          />
        </div>
      </div>

      {/* Channel health heatmap */}
      <ChannelHealth requests={requests} />
    </div>
  )
}
