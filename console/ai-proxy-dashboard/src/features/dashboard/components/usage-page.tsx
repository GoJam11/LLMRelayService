import { useMemo, useState } from "react"
import { Download, MoveRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { UsageTrendChart } from "@/features/dashboard/components/usage-trend-chart"
import { useUsageStats } from "@/features/dashboard/hooks/use-usage-stats"
import type { ConsoleStatsBucket } from "@/features/dashboard/types"
import { formatCost, formatCount, formatPercent } from "@/features/dashboard/utils"
import { cn } from "@/lib/utils"

const DONUT_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

type Group = "clients" | "routes" | "models"

function compact(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "--"
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`
  return String(Math.round(n))
}

export function UsagePage({
  onUnauthorized,
  onNavigateToLogs,
  initialClientFilter,
}: {
  onUnauthorized: () => void
  onNavigateToLogs: () => void
  initialClientFilter?: string
}) {
  const { overview, stats, timeseries, refresh, rangeFilter, setRangeFilter } = useUsageStats(
    onUnauthorized,
    { initialClientFilter },
  )
  const { t } = useTranslation()
  const [group, setGroup] = useState<Group>(initialClientFilter ? "clients" : "clients")

  const rangeOptions = [
    { value: "1h", label: t("timeRange.1h") },
    { value: "24h", label: t("timeRange.24h") },
    { value: "72h", label: t("timeRange.72h") },
    { value: "7d", label: t("timeRange.7d") },
    { value: "30d", label: t("timeRange.30d") },
    { value: "all", label: t("timeRange.all") },
  ]

  const groupTabs: { key: Group; label: string }[] = [
    { key: "clients", label: t("usage.byClient") },
    { key: "routes", label: t("usage.byRoute") },
    { key: "models", label: t("usage.byModel") },
  ]
  const groupNoun =
    group === "clients" ? t("usage.nounClient") : group === "routes" ? t("usage.nounRoute") : t("usage.nounModel")

  const total = overview?.total ?? 0

  const rows = useMemo(() => {
    const source: ConsoleStatsBucket[] =
      group === "clients" ? stats.clients : group === "routes" ? stats.routes : stats.models
    const sorted = [...(source ?? [])].sort((a, b) => b.requests - a.requests)
    const totalReqs = sorted.reduce((s, r) => s + r.requests, 0)
    return sorted.map((r, i) => {
      const cacheRate = r.requests > 0 ? (r.cache_hits / r.requests) * 100 : 0
      return {
        key: r.key,
        name: r.label || r.key,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
        requests: r.requests,
        input: r.total_input_tokens ?? 0,
        output: r.total_output_tokens ?? 0,
        cacheRate,
        cost: r.total_cost ?? 0,
        pct: totalReqs > 0 ? Math.round((r.requests / totalReqs) * 100) : 0,
      }
    })
  }, [group, stats])

  const donutGradient = useMemo(() => {
    const top = rows.slice(0, 5)
    if (!top.length) return "var(--muted)"
    let acc = 0
    const segs = top.map((s) => {
      const start = acc
      acc += s.pct
      return `${s.color} ${start}% ${acc}%`
    })
    if (acc < 100) segs.push(`var(--muted) ${acc}% 100%`)
    return `conic-gradient(${segs.join(", ")})`
  }, [rows])

  const handleExportCsv = () => {
    const header = ["name", "requests", "input", "output", "cache_rate", "cost", "share"]
    const lines = rows.map((r) =>
      [r.name, r.requests, r.input, r.output, `${r.cacheRate.toFixed(1)}%`, r.cost, `${r.pct}%`].join(","),
    )
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `usage-${group}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Group tabs + range/export + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex">
          {groupTabs.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              className={cn(
                "mr-6 border-b-2 py-3 text-[13px] transition-colors",
                group === g.key
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Combobox
            options={rangeOptions}
            value={rangeFilter}
            onChange={(value) => setRangeFilter((value || "24h") as typeof rangeFilter)}
            placeholder={t("timeRange.placeholder")}
            searchPlaceholder={t("common.searchTimeRange")}
            className="w-32"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
            <Download data-icon="inline-start" />
            {t("usage.exportCsv")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            {t("common.refreshData")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onNavigateToLogs}>
            {t("common.viewLogs")}
            <MoveRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[
          { label: t("usage.summaryReqs"), value: formatCount(total) },
          { label: t("usage.summaryTokens"), value: compact(overview?.total_tokens) },
          { label: t("usage.summaryCache"), value: formatPercent(overview?.hit_rate), accent: true },
          { label: t("usage.summaryCost"), value: formatCost(overview?.total_cost) },
        ].map((s) => (
          <div key={s.label} className="bg-card px-6 py-5">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div
              className="mt-2 font-mono text-[26px] font-medium tracking-[-0.02em]"
              style={s.accent ? { color: "var(--primary)" } : undefined}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Chart + donut */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="xl:border-r xl:border-border xl:pr-6">
          <div className="mb-4 text-sm font-bold">{t("usage.trendStackTitle")}</div>
          <UsageTrendChart points={timeseries} />
        </div>
        <div>
          <div className="mb-4 text-sm font-bold">
            {groupNoun}
            {t("usage.shareTitle")}
          </div>
          <div className="flex flex-col items-center gap-5">
            <div className="relative h-32 w-32 rounded-full" style={{ background: donutGradient }}>
              <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-card">
                <div className="font-mono text-xl font-medium">{rows.length}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t("usage.groupCountUnit", { noun: groupNoun })}
                </div>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2.5 text-[12.5px]">
              {rows.slice(0, 5).map((r) => (
                <div key={r.key} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-muted-foreground">{r.pct}%</span>
                </div>
              ))}
              {rows.length === 0 ? (
                <div className="py-2 text-center text-xs text-muted-foreground">{t("common.noData")}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="border-t border-border">
        <div className="grid grid-cols-[1.4fr_90px_80px_80px_72px_92px_64px] gap-3 border-b border-border py-3 text-[10.5px] font-semibold text-muted-foreground">
          <span>{groupNoun}</span>
          <span>{t("usage.reqCount")}</span>
          <span>{t("usage.inputCol")}</span>
          <span>{t("usage.outputCol")}</span>
          <span>{t("usage.cacheRate")}</span>
          <span>{t("usage.costCol")}</span>
          <span>{t("usage.shareCol")}</span>
        </div>
        {rows.length > 0 ? (
          rows.map((r) => (
            <div
              key={r.key}
              className="grid grid-cols-[1.4fr_90px_80px_80px_72px_92px_64px] items-center gap-3 border-b border-border/60 py-3 text-[12.5px]"
            >
              <span className="flex items-center gap-2.5 font-semibold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
                <span className="truncate">{r.name}</span>
              </span>
              <span className="font-mono">{formatCount(r.requests)}</span>
              <span className="font-mono text-muted-foreground">{compact(r.input)}</span>
              <span className="font-mono text-muted-foreground">{compact(r.output)}</span>
              <span className="font-mono text-muted-foreground">{r.cacheRate.toFixed(0)}%</span>
              <span className="font-mono font-semibold">{formatCost(r.cost)}</span>
              <span className="font-mono text-primary">{r.pct}%</span>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">{t("common.noData")}</div>
        )}
      </div>
    </div>
  )
}
