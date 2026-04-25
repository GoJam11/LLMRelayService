import { useMemo } from "react"
import { BarChart3, ListFilter, MoveRight } from "lucide-react"
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
import { BucketTable } from "@/features/dashboard/components/bucket-table"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { UsageTrendChart } from "@/features/dashboard/components/usage-trend-chart"
import { useUsageStats } from "@/features/dashboard/hooks/use-usage-stats"
import {
  formatCost,
  formatCount,
  formatPercent,
} from "@/features/dashboard/utils"

export function UsagePage({
  onUnauthorized,
  onNavigateToLogs,
}: {
  onUnauthorized: () => void
  onNavigateToLogs: () => void
}) {
  const {
    overview,
    stats,
    filters,
    timeseries,
    refresh,
    routeFilter,
    setRouteFilter,
    modelFilter,
    setModelFilter,
    clientFilter,
    setClientFilter,
    rangeFilter,
    setRangeFilter,
  } = useUsageStats(onUnauthorized)

  const { t } = useTranslation()

  const rangeOptions = [
    { value: "1h", label: t("timeRange.1h") },
    { value: "24h", label: t("timeRange.24h") },
    { value: "72h", label: t("timeRange.72h") },
    { value: "7d", label: t("timeRange.7d") },
    { value: "30d", label: t("timeRange.30d") },
    { value: "all", label: t("timeRange.all") },
  ] as const

  const total = overview?.total ?? 0
  const errors = overview?.errors ?? 0
  const successCount = Math.max(0, total - errors)

  const cacheCost = (overview?.total_cache_read_cost ?? 0) + (overview?.total_cache_write_cost ?? 0)

  const headlineCards = useMemo(
    () => [
      {
        title: t("usage.totalRequests"),
        value: formatCount(total),
        description: t("usage.totalRequestsDesc", { count: formatCount(successCount) }),
      },
      {
        title: t("usage.totalTokens"),
        value: formatCount(overview?.total_tokens),
        description: t("usage.totalTokensDesc", { input: formatCount(overview?.total_input_tokens), output: formatCount(overview?.total_output_tokens) }),
      },
      {
        title: t("usage.totalCost"),
        value: formatCost(overview?.total_cost),
        description: t("usage.totalCostDesc", { input: formatCost(overview?.total_input_cost), output: formatCost(overview?.total_output_cost) }),
      },
      {
        title: t("usage.avgCostPerReq"),
        value: total > 0 ? formatCost((overview?.total_cost ?? 0) / total) : formatCost(0),
        description: total > 0 ? t("usage.avgTokensPerReq", { count: formatCount(Math.round((overview?.total_tokens ?? 0) / total)) }) : t("common.noData"),
      },
    ],
    [overview, successCount, total, t],
  )

  const costCards = [
    {
      title: t("usage.totalCostLabel"),
      value: formatCost(overview?.total_cost),
      description: t("usage.retentionDesc", { count: formatCount(overview?.retention_max_records) }),
    },
    {
      title: t("usage.inputCost"),
      value: formatCost(overview?.total_input_cost),
      description: t("usage.inputTokensDesc", { count: formatCount(overview?.total_input_tokens) }),
    },
    {
      title: t("usage.outputCost"),
      value: formatCost(overview?.total_output_cost),
      description: t("usage.outputTokensDesc", { count: formatCount(overview?.total_output_tokens) }),
    },
    {
      title: t("usage.cacheCost"),
      value: formatCost(cacheCost),
      description: t("usage.cacheCostDesc", { read: formatCost(overview?.total_cache_read_cost), write: formatCost(overview?.total_cache_write_cost) }),
    },
  ]

  const cacheCards = [
    {
      title: t("usage.cacheHitRate"),
      value: formatPercent(overview?.hit_rate),
      description: t("usage.cacheHitDesc", { hits: formatCount(overview?.cache_hits), creates: formatCount(overview?.cache_creates) }),
    },
    {
      title: t("usage.anthropicCacheRead"),
      value: formatCount(overview?.total_cache_read_tokens),
      description: t("usage.anthropicCacheReadDesc"),
    },
    {
      title: t("usage.anthropicCacheWrite"),
      value: formatCount(overview?.total_cache_creation_tokens),
      description: t("usage.anthropicCacheWriteDesc"),
    },
    {
      title: t("usage.openaiCachedPrompt"),
      value: formatCount(overview?.total_cached_input_tokens),
      description: t("usage.openaiCachedPromptDesc"),
    },
    {
      title: t("usage.reasoning"),
      value: formatCount(overview?.total_reasoning_output_tokens),
      description: t("usage.reasoningDesc"),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BarChart3}
        title={t("usage.title")}
        description={t("usage.description")}
        actions={
          <>
            <Button
              type="button"
              onClick={() => {
                void refresh()
              }}
            >
              {t("common.refreshData")}
            </Button>
            <Button type="button" variant="outline" onClick={onNavigateToLogs}>
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
            {t("usage.filterLabel")}
          </div>
          <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="usage-range-filter">{t("usage.timeRangeLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={rangeOptions.map((option) => ({ ...option }))}
                  value={rangeFilter}
                  onChange={(value) => setRangeFilter((value || "24h") as typeof rangeFilter)}
                  placeholder={t("timeRange.placeholder")}
                  searchPlaceholder={t("common.searchTimeRange")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="usage-route-filter">{t("usage.routeLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={filters.routes}
                  value={routeFilter}
                  onChange={setRouteFilter}
                  placeholder={t("usage.allRoutes")}
                  searchPlaceholder={t("common.searchRoute")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="usage-model-filter">{t("usage.modelLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={filters.models}
                  value={modelFilter}
                  onChange={setModelFilter}
                  placeholder={t("usage.allModels")}
                  searchPlaceholder={t("common.searchModel")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="usage-client-filter">{t("usage.clientLabel")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={filters.clients}
                  value={clientFilter}
                  onChange={setClientFilter}
                  placeholder={t("usage.allClients")}
                  searchPlaceholder={t("usage.searchClient")}
                />
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <CardTitle>{t("usage.coreDataTitle")}</CardTitle>
          <CardDescription>
            {t("usage.coreDataDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {headlineCards.map((item) => (
              <MetricCard
                key={item.title}
                title={item.title}
                value={item.value}
                description={item.description}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <CardTitle>{t("usage.trendTitle")}</CardTitle>
          <CardDescription>
            {t("usage.trendDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <UsageTrendChart points={timeseries} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 border-b border-border/60">
          <CardTitle>{t("usage.costCacheTitle")}</CardTitle>
          <CardDescription>
            {t("usage.costCacheDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("usage.costBreakdown")}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {costCards.map((item) => (
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
            <h3 className="text-xs font-medium text-muted-foreground">{t("usage.cacheAndReasoning")}</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h2 className="text-base font-semibold tracking-tight">{t("usage.groupDetail")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("usage.groupDetailDesc")}
          </p>
        </div>
        <BucketTable
          title={t("usage.routeBucket")}
          description={t("usage.routeBucketDesc")}
          buckets={stats.routes || []}
          onApplyFilter={setRouteFilter}
          showHitRate={true}
        />
        <BucketTable
          title={t("usage.modelBucket")}
          description={t("usage.modelBucketDesc")}
          buckets={stats.models || []}
          onApplyFilter={setModelFilter}
          showHitRate={true}
        />
        <BucketTable
          title={t("usage.clientBucket")}
          description={t("usage.clientBucketDesc")}
          buckets={stats.clients || []}
          onApplyFilter={setClientFilter}
          showHitRate={true}
        />
      </div>
    </div>
  )
}
