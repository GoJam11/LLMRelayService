import { useTranslation } from "react-i18next"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ConsoleUsageTimeSeriesPoint } from "@/features/dashboard/types"
import { formatCost, formatCount } from "@/features/dashboard/utils"

export function UsageTrendChart({ points }: { points: ConsoleUsageTimeSeriesPoint[] }) {
  const { t } = useTranslation()

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

  const chartData = points.map((point) => ({
    ...point,
    total_cost_label: formatCost(point.total_cost),
    total_tokens_label: formatCount(point.total_tokens),
  }))

  if (!chartData.length) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground">
        {t("chart.emptyTimeseries")}
      </div>
    )
  }

  const peakTokens = Math.max(...chartData.map((point) => point.total_tokens), 1)
  const peakCost = Math.max(...chartData.map((point) => point.total_cost), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="gap-1 border-b border-border/60 pb-4">
            <CardTitle className="text-base">{t("chart.tokenTrend")}</CardTitle>
            <CardDescription>{t("chart.tokenTrendDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={tokenChartConfig} className="min-h-[260px] w-full">
              <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="tokensFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-total_tokens)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-total_tokens)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket_label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
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
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1 border-b border-border/60 pb-4">
            <CardTitle className="text-base">{t("chart.costTrend")}</CardTitle>
            <CardDescription>{t("chart.costTrendDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={costChartConfig} className="min-h-[260px] w-full">
              <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket_label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
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
                  radius={[6, 6, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakTokens")}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{formatCount(peakTokens)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.peakCost")}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{formatCost(peakCost)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
          <div className="text-xs text-muted-foreground">{t("chart.dataPoints")}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{formatCount(chartData.length)}</div>
        </div>
      </div>
    </div>
  )
}
