import { useMemo } from "react"
import { Activity, MoveRight, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { PageHeader } from "@/components/ui/page-header"
import { ChannelHealth } from "@/features/dashboard/components/channel-health"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { useDashboardStats } from "@/features/dashboard/hooks/use-dashboard-stats"
import {
  formatCount,
  formatDuration,
  formatPercent,
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

      {/* Latency metrics section */}
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
