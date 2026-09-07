import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ConsoleUsageTimeSeriesPoint } from "@/features/dashboard/types"
import { formatCost, formatCount } from "@/features/dashboard/utils"

type MetricTab = "overview" | "tokens" | "cost" | "requests" | "savings"

export function UsageTrendChart({ points }: { points: ConsoleUsageTimeSeriesPoint[] }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<MetricTab>("overview")

  const tokenChartConfig = {
    total_tokens: {
      label: t("chart.tokenConsumption"),
      color: "var(--color-chart-1)",
    },
  } as const

  const costChartConfig = {
    total_cost: {
      label: t("chart.costSpend"),
      color: "var(--color-chart-2)",
    },
  } as const

  const requestChartConfig = {
    requests: {
      label: t("chart.requests"),
      color: "var(--color-chart-3)",
    },
    errors: {
      label: t("chart.errors"),
      color: "var(--color-chart-5)",
    },
  } as const

  const savingsChartConfig = {
    cost_savings: {
      label: t("chart.costSavings"),
      color: "var(--color-chart-4)",
    },
  } as const

  const chartData = points.map((point) => ({
    ...point,
    cost_savings: point.cost_savings ?? 0,
    cache_hits: point.cache_hits ?? 0,
    total_cost_label: formatCost(point.total_cost),
    total_tokens_label: formatCount(point.total_tokens),
    cost_savings_label: formatCost(point.cost_savings ?? 0),
  }))

  if (!chartData.length) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-none border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground">
        {t("chart.emptyTimeseries")}
      </div>
    )
  }

  const peakTokens = Math.max(...chartData.map((point) => point.total_tokens), 0)
  const peakCost = Math.max(...chartData.map((point) => point.total_cost), 0)
  const peakRequests = Math.max(...chartData.map((point) => point.requests), 0)
  const peakSavings = Math.max(...chartData.map((point) => point.cost_savings), 0)

  const renderTokenChart = (minHeight = "min-h-[260px]") => (
    <Card className="rounded-none">
      <CardHeader className="gap-1 border-b border-border/60 pb-3">
        <CardTitle className="text-base">{t("chart.tokenTrend")}</CardTitle>
        <CardDescription className="text-xs">{t("chart.tokenTrendDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer config={tokenChartConfig} className={`${minHeight} w-full`}>
          <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="tokensFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-total_tokens)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-total_tokens)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket_label" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: string | number) => formatCount(Number(value))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => [formatCount(Number(value)), tokenChartConfig.total_tokens.label]}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Area
              type="monotone"
              dataKey="total_tokens"
              stroke="var(--color-total_tokens)"
              fill="url(#tokensFill)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )

  const renderCostChart = (minHeight = "min-h-[260px]") => (
    <Card className="rounded-none">
      <CardHeader className="gap-1 border-b border-border/60 pb-3">
        <CardTitle className="text-base">{t("chart.costTrend")}</CardTitle>
        <CardDescription className="text-xs">{t("chart.costTrendDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer config={costChartConfig} className={`${minHeight} w-full`}>
          <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket_label" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value: string | number) => formatCost(Number(value))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => [formatCost(Number(value)), costChartConfig.total_cost.label]}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="total_cost"
              fill="var(--color-total_cost)"
              radius={[0, 0, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )

  const renderRequestChart = () => (
    <Card className="rounded-none">
      <CardHeader className="gap-1 border-b border-border/60 pb-3">
        <CardTitle className="text-base">{t("chart.requestTrend")}</CardTitle>
        <CardDescription className="text-xs">{t("chart.requestTrendDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer config={requestChartConfig} className="min-h-[300px] w-full">
          <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket_label" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: string | number) => formatCount(Number(value))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    const label = name === "requests" ? requestChartConfig.requests.label : requestChartConfig.errors.label
                    return [formatCount(Number(value)), label]
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="requests"
              fill="var(--color-requests)"
              radius={[0, 0, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="errors"
              fill="var(--color-errors)"
              radius={[0, 0, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )

  const renderSavingsChart = () => (
    <Card className="rounded-none">
      <CardHeader className="gap-1 border-b border-border/60 pb-3">
        <CardTitle className="text-base">{t("chart.savingsTrend")}</CardTitle>
        <CardDescription className="text-xs">{t("chart.savingsTrendDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ChartContainer config={savingsChartConfig} className="min-h-[300px] w-full">
          <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket_label" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value: string | number) => formatCost(Number(value))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => [formatCost(Number(value)), savingsChartConfig.cost_savings.label]}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="cost_savings"
              fill="var(--color-cost_savings)"
              radius={[0, 0, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      {/* 视图切换 */}
      <div className="flex items-center justify-between">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MetricTab)}>
          <TabsList className="h-8 rounded-none bg-muted/60">
            <TabsTrigger value="overview" className="text-xs px-2.5 h-6 rounded-none">
              {t("chart.overview")}
            </TabsTrigger>
            <TabsTrigger value="tokens" className="text-xs px-2.5 h-6 rounded-none">
              {t("chart.metricTokens")}
            </TabsTrigger>
            <TabsTrigger value="cost" className="text-xs px-2.5 h-6 rounded-none">
              {t("chart.metricCost")}
            </TabsTrigger>
            <TabsTrigger value="requests" className="text-xs px-2.5 h-6 rounded-none">
              {t("chart.metricRequests")}
            </TabsTrigger>
            <TabsTrigger value="savings" className="text-xs px-2.5 h-6 rounded-none">
              {t("chart.metricSavings")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 主图表区域 */}
      {activeTab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {renderTokenChart()}
          {renderCostChart()}
        </div>
      )}
      {activeTab === "tokens" && renderTokenChart("min-h-[300px]")}
      {activeTab === "cost" && renderCostChart("min-h-[300px]")}
      {activeTab === "requests" && renderRequestChart()}
      {activeTab === "savings" && renderSavingsChart()}

      {/* 底部指标概览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-none border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakTokens")}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-foreground">{formatCount(peakTokens)}</div>
        </div>
        <div className="rounded-none border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakCost")}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-foreground">{formatCost(peakCost)}</div>
        </div>
        <div className="rounded-none border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakRequests")}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-foreground">{formatCount(peakRequests)}</div>
        </div>
        <div className="rounded-none border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakSavings")}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-primary">{formatCost(peakSavings)}</div>
        </div>
      </div>
    </div>
  )
}
