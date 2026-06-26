import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Card } from "@/components/ui/card"
import { useDashboardStats } from "@/features/dashboard/hooks/use-dashboard-stats"
import type { DashboardRange } from "@/features/dashboard/hooks/use-dashboard-stats"
import {
  formatCost,
  formatCount,
  formatDuration,
  formatPercent,
  formatTime,
} from "@/features/dashboard/utils"

const DONUT_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

// Compact number formatter (8.94M / 1.2k / 856)
function compact(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "--"
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`
  return String(Math.round(n))
}

function statusColor(code: number | null): string {
  if (code == null) return "var(--lrs-faint)"
  if (code >= 500) return "var(--lrs-danger)"
  if (code >= 400) return "var(--lrs-warn)"
  return "var(--lrs-success)"
}

export function DashboardPage({
  onUnauthorized,
  onNavigateToLogs,
}: {
  onUnauthorized: () => void
  onNavigateToLogs: () => void
}) {
  const { t } = useTranslation()
  const { overview, stats, requests, rangeFilter } = useDashboardStats(onUnauthorized)

  const total = overview?.total ?? 0
  const errors = overview?.errors ?? 0
  const successCount = Math.max(0, total - errors)
  const successRate = total > 0 ? (successCount / total) * 100 : 0

  const code429 = useMemo(
    () => requests.filter((r) => r.response_status === 429).length,
    [requests],
  )
  const code5xx = useMemo(
    () => requests.filter((r) => r.response_status != null && r.response_status >= 500).length,
    [requests],
  )

  // ── Request trend buckets (bar chart) ─────────────────────
  const trendBars = useMemo(() => {
    if (!requests.length) return [] as { total: number }[]
    const bucketSizeMs: Record<DashboardRange, number> = {
      "1h": 5 * 60 * 1000,
      "24h": 60 * 60 * 1000,
      "72h": 3 * 60 * 60 * 1000,
      "7d": 24 * 60 * 60 * 1000,
      "30d": 24 * 60 * 60 * 1000,
      all: 7 * 24 * 60 * 60 * 1000,
    }
    const size = bucketSizeMs[rangeFilter]
    const map = new Map<number, number>()
    for (const req of requests) {
      const tsMs = req.created_at < 1e12 ? req.created_at * 1000 : req.created_at
      const bucket = Math.floor(tsMs / size) * size
      map.set(bucket, (map.get(bucket) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .slice(-24)
      .map(([, total]) => ({ total }))
  }, [requests, rangeFilter])

  const peak = useMemo(() => trendBars.reduce((m, b) => Math.max(m, b.total), 0), [trendBars])

  // ── Live request feed ─────────────────────────────────────
  const feed = useMemo(() => requests.slice(0, 7), [requests])

  // ── Channel share (donut) ─────────────────────────────────
  const channelShare = useMemo(() => {
    const routes = (stats.routes ?? []).filter((r) => r.requests > 0)
    const sorted = [...routes].sort((a, b) => b.requests - a.requests).slice(0, 5)
    const totalReqs = sorted.reduce((s, r) => s + r.requests, 0)
    return sorted.map((r, i) => ({
      key: r.key,
      label: r.label || r.key,
      requests: r.requests,
      pct: totalReqs > 0 ? Math.round((r.requests / totalReqs) * 100) : 0,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }))
  }, [stats.routes])

  const activeChannelCount = (stats.routes ?? []).filter((r) => r.requests > 0).length

  const donutGradient = useMemo(() => {
    if (!channelShare.length) return "var(--muted)"
    let acc = 0
    const segs = channelShare.map((s) => {
      const start = acc
      acc += s.pct
      return `${s.color} ${start}% ${acc}%`
    })
    if (acc < 100) segs.push(`var(--muted) ${acc}% 100%`)
    return `conic-gradient(${segs.join(", ")})`
  }, [channelShare])

  const rangeLabel = t(`timeRange.${rangeFilter}`)

  const stats5 = [
    {
      label: t("monitor.todayRequests"),
      value: formatCount(total),
      caption: t("monitor.successCount", {
        success: formatCount(successCount),
        errors: formatCount(errors),
      }),
    },
    {
      label: t("monitor.avgFirstToken"),
      value: formatDuration(overview?.avg_first_token_ms),
      caption: `${t("monitor.firstByteShort")} ${formatDuration(overview?.avg_first_chunk_ms)}`,
    },
    {
      label: t("monitor.cacheHitRate"),
      value: formatPercent(overview?.hit_rate),
      caption: t("monitor.cacheHitDesc", {
        hits: formatCount(overview?.cache_hits),
        creates: formatCount(overview?.cache_creates),
      }),
      accent: true,
    },
    {
      label: t("monitor.tokenUsage"),
      value: compact(overview?.total_tokens),
      caption: t("monitor.inputOutput", {
        in: compact(overview?.total_input_tokens),
        out: compact(overview?.total_output_tokens),
      }),
    },
    {
      label: t("monitor.successRateShort"),
      value: formatPercent(successRate),
      caption: t("monitor.statusBreakdown", { c429: code429, c5xx: code5xx }),
    },
  ]

  return (
    <Card className="flex flex-1 flex-col gap-0 overflow-hidden p-0">
      {/* ── Stat strip ── */}
      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-3 xl:grid-cols-5">
        {stats5.map((s, i) => (
          <div
            key={s.label}
            className="border-border px-7 py-6 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2n)]:border-r-0 sm:max-xl:[&:nth-child(3n)]:border-r-0"
            style={{ borderRightWidth: i === stats5.length - 1 ? 0 : undefined }}
          >
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div
              className="mt-2 font-mono text-[28px] font-medium leading-none tracking-[-0.02em]"
              style={s.accent ? { color: "var(--primary)" } : undefined}
            >
              {s.value}
            </div>
            <div className="mt-2 text-[11.5px] text-muted-foreground">{s.caption}</div>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[1.6fr_1fr]">
        {/* Left: trend + live feed */}
        <div className="flex min-h-0 flex-col gap-5 border-b border-border p-6 xl:border-b-0 xl:border-r xl:p-7">
          {/* Trend */}
          <div>
            <div className="mb-4 flex items-baseline justify-between">
              <span className="text-sm font-bold">{t("monitor.requestTrend")}</span>
              <span className="text-[11.5px] text-muted-foreground">
                {rangeLabel} · {t("monitor.peak")}{" "}
                <span className="font-mono text-foreground">{formatCount(peak)}</span>
              </span>
            </div>
            {trendBars.length > 0 ? (
              <div className="flex h-[90px] items-end gap-[5px]">
                {trendBars.map((b, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-[4px] bg-chart-4"
                    style={{ height: `${peak > 0 ? Math.max(4, (b.total / peak) * 100) : 4}%` }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-[90px] items-center justify-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            )}
          </div>

          {/* Live feed */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-bold">
              <span className="lrs-pulse h-[7px] w-[7px] rounded-full bg-primary" />
              {t("monitor.liveFeed")}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {feed.length > 0 ? (
                feed.map((r) => (
                  <button
                    key={r.request_id}
                    type="button"
                    onClick={onNavigateToLogs}
                    className="flex w-full items-center gap-3.5 border-b border-border/60 py-3 text-left last:border-0 hover:bg-accent/40"
                  >
                    <span className="w-[58px] shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatTime(r.created_at)}
                    </span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: statusColor(r.response_status) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="font-semibold">{r.route_prefix}</span>
                      <span className="text-muted-foreground"> · {r.request_model}</span>
                    </span>
                    <span className="w-[52px] shrink-0 text-right font-mono text-[12px]">
                      {formatDuration(r.response_timing?.first_token_latency_ms)}
                    </span>
                    <span className="w-[74px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                      {compact(r.response_usage?.input_tokens)}/{compact(r.response_usage?.output_tokens)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-muted-foreground">
                  {t("common.noData")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: channel share donut + cost footer */}
        <div className="flex min-h-0 flex-col p-6 xl:p-7">
          <div className="text-sm font-bold">{t("monitor.channelShare")}</div>
          <div className="mt-5 flex flex-col items-center gap-5">
            <div
              className="relative h-[140px] w-[140px] rounded-full"
              style={{ background: donutGradient }}
            >
              <div className="absolute inset-[30px] flex flex-col items-center justify-center rounded-full bg-card">
                <div className="font-mono text-[22px] font-medium">{activeChannelCount}</div>
                <div className="text-[10px] text-muted-foreground">{t("monitor.activeChannels")}</div>
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 text-[12.5px]">
              {channelShare.length > 0 ? (
                channelShare.map((s) => (
                  <div key={s.key} className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: s.color }}
                    />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-1.5 shrink-0 text-[11px] text-muted-foreground">
                      {t("monitor.timesUnit", { count: formatCount(s.requests) })}
                    </span>
                    <span className="ml-auto shrink-0 font-mono">{s.pct}%</span>
                  </div>
                ))
              ) : (
                <div className="py-2 text-center text-xs text-muted-foreground">
                  {t("common.noData")}
                </div>
              )}
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-border pt-4 text-[12.5px] text-muted-foreground">
            <span>{t("monitor.totalCostLabel")}</span>
            <span className="font-mono font-semibold text-foreground">
              {formatCost(overview?.total_cost)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}
