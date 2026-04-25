import { useMemo } from "react"
import { Activity, ListFilter, MoveRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { PageHeader } from "@/components/ui/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
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
      <PageHeader
        icon={Activity}
        title={t("monitor.title")}
        description={t("monitor.description")}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void refresh()
              }}
            >
              {t("common.refreshData")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onNavigateToLogs}>
              {t("common.viewLogs")}
              <MoveRight data-icon="inline-end" />
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            {t("monitor.filterLabel")}
          </div>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="route-filter">{t("monitor.routeFilterLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={routeOptions}
                  value={routeFilter}
                  onChange={setRouteFilter}
                  placeholder={t("monitor.allRoutes")}
                  searchPlaceholder={t("common.searchRoute")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="range-filter">{t("monitor.timeRangeLabel")}</FieldLabel>
              <FieldContent>
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
                />
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <CardTitle>{t("monitor.overviewTitle")}</CardTitle>
          <CardDescription>
            {t("monitor.overviewDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {overviewCards.map((item) => (
              <MetricCard
                key={item.title}
                title={item.title}
                value={item.value}
                description={item.description}
              />
            ))}
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("monitor.systemMetrics")}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title={t("monitor.storageBackend")}
                value={overview?.storage_backend?.toUpperCase() ?? "PG"}
                description={t("monitor.retentionDescription", { count: formatCount(overview?.retention_max_records) })}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t("monitor.channelHealthLabel")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("monitor.channelHealthHint")}
              </p>
            </div>
            <ChannelHealth requests={requests} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <CardTitle>{t("monitor.latencyTitle")}</CardTitle>
          <CardDescription>
            {t("monitor.latencyDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("monitor.latencyMetrics")}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {operationsCards.map((item) => (
                <MetricCard
                  key={item.title}
                  title={item.title}
                  value={item.value}
                  description={item.description}
                />
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("monitor.cacheHealth")}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {cacheCards.map((item) => (
                <MetricCard
                  key={item.title}
                  title={item.title}
                  value={item.value}
                  description={item.description}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
