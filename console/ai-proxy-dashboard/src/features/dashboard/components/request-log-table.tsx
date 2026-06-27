import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { ConsoleRequestListItem } from "@/features/dashboard/types"
import type { RequestSortKey, SortDirection } from "@/features/dashboard/api"
import {
  formatCost,
  formatCount,
  formatDuration,
  formatTime,
  getHttpStatusLabel,
  shortText,
} from "@/features/dashboard/utils"

function getNumericUsageValue(value: unknown): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function getRequestCacheReadTokens(item: ConsoleRequestListItem): number {
  return item.upstream_type === "openai"
    ? getNumericUsageValue(item.response_usage?.cached_input_tokens)
    : getNumericUsageValue(item.response_usage?.cache_read_input_tokens)
}

function calculateRequestCacheHitRate(item: ConsoleRequestListItem): number | undefined {
  const usage = item.response_usage
  const cacheReadTokens = getRequestCacheReadTokens(item)
  const inputTokens = getNumericUsageValue(usage?.input_tokens ?? usage?.total_input_tokens)
  const denominator = item.upstream_type === "openai"
    ? inputTokens
    : inputTokens
      + getNumericUsageValue(usage?.cache_creation_input_tokens ?? usage?.total_cache_creation_tokens)
      + cacheReadTokens

  if (denominator <= 0) return undefined
  return Math.min(100, (cacheReadTokens / denominator) * 100)
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string
  active: boolean
  direction: SortDirection
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-0.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      onClick={onClick}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      )}
    </button>
  )
}

function statusStyle(code: number | null): { bg: string; fg: string } {
  if (code == null) return { bg: "var(--muted)", fg: "var(--lrs-faint)" }
  if (code >= 500) return { bg: "var(--lrs-danger-bg)", fg: "var(--lrs-danger)" }
  if (code >= 400) return { bg: "var(--lrs-warn-bg)", fg: "var(--lrs-warn)" }
  return { bg: "var(--lrs-success-bg)", fg: "var(--lrs-success)" }
}

export function RequestLogTable({
  variant = "default",
  loading,
  refreshing = false,
  requests,
  selectedId,
  sortBy = "created_at",
  sortOrder = "desc",
  onSort,
  onSelect,
  onClearFilters,
  onApplyRouteFilter,
  onApplyModelFilter,
  onApplySourceTypeFilter,
}: {
  variant?: "default" | "compact"
  loading: boolean
  refreshing?: boolean
  requests: ConsoleRequestListItem[]
  selectedId: string | null
  sortBy?: RequestSortKey
  sortOrder?: SortDirection
  onSort: (sortBy: RequestSortKey, sortOrder: SortDirection) => void
  onSelect: (requestId: string) => void
  onClearFilters?: () => void
  onApplyRouteFilter?: (value: string) => void
  onApplyModelFilter?: (value: string) => void
  onApplySourceTypeFilter?: (value: string) => void
}) {
  // Silence unused-destructuring warnings without breaking the public API.
  void onApplyRouteFilter
  void onApplyModelFilter
  void onApplySourceTypeFilter
  const { t } = useTranslation()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const toggleSort = (nextKey: RequestSortKey) => {
    if (nextKey === sortBy) {
      onSort(nextKey, sortOrder === "asc" ? "desc" : "asc")
      return
    }
    onSort(nextKey, "desc")
  }

  // Compact 7-column layout per LRS Clear 风格五 design spec:
  // 时间 | Key | 渠道 / 模型 | 状态 | 首Token | Tokens | Cache
  if (variant === "compact") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header row */}
        <div
          className="grid shrink-0 items-center gap-2 border-b border-border px-6 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: "60px 78px 1fr 50px 62px 78px 50px 64px" }}
        >
          <span>
            <SortButton
              label={t("logTable.colTime")}
              active={sortBy === "created_at"}
              direction={sortOrder}
              onClick={() => toggleSort("created_at")}
            />
          </span>
          <span>{t("logTable.colSource")}</span>
          <span>{t("logTable.colRoute")}</span>
          <span>
            <SortButton
              label={t("logTable.colStatus")}
              active={sortBy === "response_status"}
              direction={sortOrder}
              onClick={() => toggleSort("response_status")}
            />
          </span>
          <span>{t("logTable.firstLabel")}</span>
          <span>
            <SortButton
              label={t("logTable.colTokens")}
              active={sortBy === "tokens"}
              direction={sortOrder}
              onClick={() => toggleSort("tokens")}
            />
          </span>
          <span className="text-right">{t("logTable.colCacheHitRate")}</span>
          <span className="text-right">{t("logTable.colPrice")}</span>
        </div>

        {/* Body */}
        <div className="relative min-h-0 flex-1 overflow-auto">
          {loading && !requests.length ? (
            <div className="space-y-1 p-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : requests.length ? (
            <div className={refreshing ? "opacity-60" : ""}>
              {refreshing && (
                <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-center py-1">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {requests.map((item) => {
                const timing = item.response_timing ?? {}
                const isSelected = item.request_id === selectedId
                const isHovered = hoveredId === item.request_id
                const cacheHitRate = calculateRequestCacheHitRate(item)
                const inputTokens = item.response_usage?.uncached_input_tokens ?? item.response_usage?.input_tokens ?? 0
                const outputTokens = item.response_usage?.output_tokens ?? item.response_usage?.total_output_tokens ?? 0
                const st = statusStyle(item.response_status)

                return (
                  <div
                    key={item.request_id}
                    onClick={() => onSelect(item.request_id)}
                    onMouseEnter={() => setHoveredId(item.request_id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className="grid cursor-pointer items-center gap-2 border-b border-border/50 border-l-[3px] px-6 py-3 text-xs transition-colors"
                    style={{
                      gridTemplateColumns: "60px 78px 1fr 50px 62px 78px 50px 64px",
                      borderLeftColor: isSelected ? "var(--primary)" : isHovered ? "var(--accent-foreground)" : "transparent",
                      background: isSelected ? "var(--accent)" : isHovered ? "var(--accent/50)" : "transparent",
                    }}
                  >
                    {/* 时间 */}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatTime(item.created_at)}
                    </span>

                    {/* Key */}
                    <span
                      className="truncate text-[11.5px] text-muted-foreground"
                      title={item.client_label ?? item.api_key_name ?? ""}
                    >
                      {item.client_label ?? item.api_key_name ?? "—"}
                    </span>

                    {/* 渠道 / 模型 */}
                    <span className="truncate">
                      <span className="font-semibold text-foreground">{item.route_prefix}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground/80">· {shortText(item.request_model, 22)}</span>
                    </span>

                    {/* 状态 */}
                    <span>
                      <span
                        className="inline-block rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold"
                        style={{ background: st.bg, color: st.fg }}
                        title={`${item.response_status ?? "--"} ${item.response_status_text ?? ""}`}
                      >
                        {getHttpStatusLabel(item.response_status)}
                      </span>
                    </span>

                    {/* 首Token */}
                    <span className="font-mono text-[11.5px] text-foreground">
                      {formatDuration(timing.first_token_latency_ms)}
                    </span>

                    {/* Tokens: 入/出 */}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatCount(inputTokens)}/{formatCount(outputTokens)}
                    </span>

                    {/* Cache */}
                    <span className="text-right font-mono text-[11px] text-muted-foreground">
                      {cacheHitRate != null ? `${Math.round(cacheHitRate)}%` : "—"}
                    </span>

                    {/* 价格 */}
                    <span
                      className="text-right font-mono text-[11px] text-foreground"
                      title={item.response_usage?.estimated ? t("logTable.priceEstimatedHint") : undefined}
                    >
                      {item.response_usage?.cost != null
                        ? `${formatCost(item.response_usage.cost)}${item.response_usage?.estimated ? "*" : ""}`
                        : "—"}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty className="m-4 border-border/70">
              <EmptyHeader>
                <EmptyTitle>{t("logTable.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("logTable.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
              {onClearFilters ? (
                <EmptyContent>
                  <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                    {t("common.clearFilters")}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </div>
      </div>
    )
  }

  // Default variant: keep the legacy full table for backwards compat
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-foreground">{t("logTable.title")}</div>
          <div className="text-[11px] text-muted-foreground">{t("logTable.description")}</div>
        </div>
        {onClearFilters ? (
          <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
            {t("common.clearFilters")}
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && !requests.length ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : requests.length ? (
          <div className={refreshing ? "opacity-60" : ""}>
            {refreshing && (
              <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-center py-1">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div className="border-b border-border/60">
              <div
                className="grid items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: "72px 1fr 110px 110px 70px 90px 70px" }}
              >
                <span>
                  <SortButton
                    label={t("logTable.colTime")}
                    active={sortBy === "created_at"}
                    direction={sortOrder}
                    onClick={() => toggleSort("created_at")}
                  />
                </span>
                <span>{t("logTable.colRequest")}</span>
                <span>{t("logTable.colRoute")}</span>
                <span>{t("logTable.colModel")}</span>
                <span>
                  <SortButton
                    label={t("logTable.colStatus")}
                    active={sortBy === "response_status"}
                    direction={sortOrder}
                    onClick={() => toggleSort("response_status")}
                  />
                </span>
                <span>{t("logTable.colLatency")}</span>
                <span className="text-right">
                  <SortButton
                    label={t("logTable.colTokens")}
                    active={sortBy === "tokens"}
                    direction={sortOrder}
                    onClick={() => toggleSort("tokens")}
                  />
                </span>
              </div>
              {requests.map((item) => {
                const timing = item.response_timing ?? {}
                const isSelected = item.request_id === selectedId
                const st = statusStyle(item.response_status)
                return (
                  <div
                    key={item.request_id}
                    onClick={() => onSelect(item.request_id)}
                    className="grid cursor-pointer items-center gap-2 border-b border-border/50 border-l-[3px] px-4 py-3 text-xs transition-colors hover:bg-accent/50"
                    style={{
                      gridTemplateColumns: "72px 1fr 110px 110px 70px 90px 70px",
                      borderLeftColor: isSelected ? "var(--primary)" : "transparent",
                      background: isSelected ? "var(--accent)" : undefined,
                    }}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatTime(item.created_at)}
                    </span>
                    <span className="truncate text-foreground">
                      {item.path}
                    </span>
                    <span>
                      <Badge variant="outline" className="text-[10px]">{item.route_prefix}</Badge>
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {shortText(item.request_model, 20)}
                    </span>
                    <span>
                      <span
                        className="inline-block rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold"
                        style={{ background: st.bg, color: st.fg }}
                      >
                        {getHttpStatusLabel(item.response_status)}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatDuration(timing.first_token_latency_ms)} / {formatDuration(timing.duration_ms)}
                    </span>
                    <span className="text-right font-mono text-[11px] text-muted-foreground">
                      {formatCount(item.response_usage?.input_tokens ?? 0)}/{formatCount(item.response_usage?.output_tokens ?? 0)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <Empty className="m-4 border-border/70">
            <EmptyHeader>
              <EmptyTitle>{t("logTable.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("logTable.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
            {onClearFilters ? (
              <EmptyContent>
                <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                  {t("common.clearFilters")}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>
    </div>
  )
}
