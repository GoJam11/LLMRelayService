import { useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, MoveRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ConsoleRequestListItem } from "@/features/dashboard/types"
import type { RequestSortKey, SortDirection } from "@/features/dashboard/api"
import {
  calculateOutputTokensPerSecond,
  copyText,
  formatCount,
  formatDuration,
  formatTokensPerSecond,
  formatTime,
  getHttpStatusBadgeVariant,
  getHttpStatusLabel,
  shortText,
  formatCost,
} from "@/features/dashboard/utils"

function getSourceTypeLabel(clientLabel?: string, t?: (key: string) => string): string {
  return clientLabel || (t ? t('logTable.anonymous') : 'Anonymous')
}

function getRuntimeStatusBadges(item: ConsoleRequestListItem, t: (key: string) => string): Array<{
  label: string
  variant: ReturnType<typeof getHttpStatusBadgeVariant>
}> {
  const badges: Array<{
    label: string
    variant: ReturnType<typeof getHttpStatusBadgeVariant>
  }> = [
    {
      label: getHttpStatusLabel(item.response_status),
      variant: getHttpStatusBadgeVariant(item.response_status),
    },
  ]

  if (item.response_payload_truncated) {
    const reasonLabel = item.response_payload_truncation_reason === "stream duration timeout"
      ? t("logTable.truncatedStream")
      : item.response_payload_truncation_reason === "body too large"
        ? t("logTable.truncatedSize")
        : t("logTable.truncatedLog")
    badges.push({
      label: reasonLabel,
      variant: "outline",
    })
  }

  if (item.failover_from) {
    badges.push({
      label: t("logTable.failedOver"),
      variant: "outline",
    })
  }

  return badges
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto px-0 text-left font-medium text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      {label}
      <span className="ml-1 text-muted-foreground/60">
        {active ? (
          direction === "asc" ? (
            <ArrowUp data-icon="inline-end" />
          ) : (
            <ArrowDown data-icon="inline-end" />
          )
        ) : (
          <ArrowUpDown data-icon="inline-end" />
        )}
      </span>
    </Button>
  )
}

export function RequestLogTable({
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
  loading: boolean
  refreshing?: boolean
  requests: ConsoleRequestListItem[]
  selectedId: string | null
  sortBy?: RequestSortKey
  sortOrder?: SortDirection
  onSort: (sortBy: RequestSortKey, sortOrder: SortDirection) => void
  onSelect: (requestId: string) => void
  onClearFilters: () => void
  onApplyRouteFilter: (value: string) => void
  onApplyModelFilter: (value: string) => void
  onApplySourceTypeFilter: (value: string) => void
}) {
  const [feedback, setFeedback] = useState("")
  const { t } = useTranslation()

  const toggleSort = (nextKey: RequestSortKey) => {
    if (nextKey === sortBy) {
      onSort(nextKey, sortOrder === "asc" ? "desc" : "asc")
      return
    }
    onSort(nextKey, "desc")
  }

  const emitCopyFeedback = async (label: string, value: string) => {
    const copied = await copyText(value)
    setFeedback(copied ? t("logTable.copied", { label }) : t("logTable.copyFailed", { label }))
    window.setTimeout(() => setFeedback(""), 1400)
  }

  return (
    <>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
              {t("logTable.title")}
            </CardTitle>
            <CardDescription>
              {t("logTable.description")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
              {t("common.clearFilters")}
            </Button>
          </div>
        </div>
        {feedback ? <div className="text-xs text-muted-foreground">{feedback}</div> : null}
      </CardHeader>
      <CardContent>
        {loading && !requests.length ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : requests.length ? (
          <div className={`relative transition-opacity duration-200 ${refreshing ? "opacity-50" : ""}`}>
            {refreshing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <div className="rounded-lg border border-border/70">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="min-w-41">
                      <SortButton
                        label={t("logTable.colTime")}
                        active={sortBy === "created_at"}
                        direction={sortOrder}
                        onClick={() => toggleSort("created_at")}
                      />
                    </TableHead>
                    <TableHead className="min-w-[200px]">
                      {t("logTable.colRequest")}
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      {t("logTable.colRoute")}
                    </TableHead>
                    <TableHead>
                      {t("logTable.colModel")}
                    </TableHead>
                    <TableHead>
                      {t("logTable.colSource")}
                    </TableHead>
                    <TableHead className="min-w-[180px]">
                      <SortButton
                        label={t("logTable.colStatus")}
                        active={sortBy === "response_status"}
                        direction={sortOrder}
                        onClick={() => toggleSort("response_status")}
                      />
                    </TableHead>
                    <TableHead>
                      {t("logTable.colLatency")}
                    </TableHead>
                    <TableHead className="text-right">
                      <SortButton
                        label="Tokens"
                        active={sortBy === "tokens"}
                        direction={sortOrder}
                        onClick={() => toggleSort("tokens")}
                      />
                    </TableHead>
                    <TableHead className="text-right">
                      {t("logTable.colOutputSpeed")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("logTable.colCost")}
                    </TableHead>
                    <TableHead className="w-24 text-right">{t("logTable.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((item) => {
                    const timing = item.response_timing ?? {}
                    const isSelected = item.request_id === selectedId
                    const outputSpeed = formatTokensPerSecond(
                      calculateOutputTokensPerSecond(item.response_usage, timing),
                    )

                    return (
                      <TableRow
                        key={item.request_id}
                        data-state={isSelected ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => onSelect(item.request_id)}
                      >
                        <TableCell className="font-medium text-foreground">
                          <div className="flex flex-col gap-1 whitespace-normal">
                            <span>{formatTime(item.created_at)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {shortText(item.request_id, 24)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="font-medium text-foreground">
                            {item.path}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-col gap-1.5">
                            {item.failover_from ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className="text-muted-foreground line-through">
                                        {item.original_route_prefix || item.failover_from}
                                      </Badge>
                                      <MoveRight data-icon="inline-end" className="text-muted-foreground/60" />
                                      <Badge variant="outline">{item.route_prefix}</Badge>
                                    </div>
                                  </TooltipTrigger>
                                  {item.failover_reason && (
                                    <TooltipContent>
                                      <p>{item.failover_reason}</p>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Badge variant="outline">{item.route_prefix}</Badge>
                            )}
                            <Badge variant="outline" className="w-fit">{item.upstream_type}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const reqModel = item.request_model
                            const resModel = item.response_usage?.model
                            const hasDifferentResModel = resModel && resModel !== reqModel
                            return hasDifferentResModel ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="cursor-help border-dashed border-muted-foreground/50">
                                      {shortText(resModel, 22)}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{t("logTable.requestModel", { model: reqModel })}</p>
                                    <p>{t("logTable.responseModel", { model: resModel })}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Badge variant="outline">
                                {shortText(reqModel, 22)}
                              </Badge>
                            )
                          })()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getSourceTypeLabel(item.client_label, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-wrap gap-2">
                            {getRuntimeStatusBadges(item, t).map((statusBadge) => (
                              <Badge
                                key={`${item.request_id}-${statusBadge.label}`}
                                variant={statusBadge.variant}
                              >
                                {statusBadge.label}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{t("logTable.firstLabel")}</span>
                            <span>{formatDuration(timing.first_token_latency_ms)}</span>
                            <span className="text-muted-foreground">{t("logTable.totalLabel")}</span>
                            <span>{formatDuration(timing.duration_ms)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <span className="text-muted-foreground">{t("logTable.inputLabel")}</span>
                            <span>{formatCount(item.response_usage?.uncached_input_tokens ?? item.response_usage?.input_tokens ?? 0)}</span>
                            <span className="text-muted-foreground">{t("logTable.outputLabel")}</span>
                            <span>{formatCount(item.response_usage?.output_tokens ?? item.response_usage?.total_output_tokens ?? 0)}</span>
                            <span className="text-muted-foreground">{t("logTable.cacheLabel")}</span>
                            <span>{formatCount(item.response_usage?.cache_read_input_tokens ?? item.response_usage?.cached_input_tokens ?? 0)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                          {outputSpeed}
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          {formatCost(item.response_usage?.cost)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {t("logTable.actionLabel")}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>{t("logTable.actionMenuTitle")}</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => onSelect(item.request_id)}
                              >
                                {t("logTable.viewDetail")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => void emitCopyFeedback("request_id", item.request_id)}
                              >
                                {t("logTable.copyRequestId")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => void emitCopyFeedback(t("detail.path"), item.path)}
                              >
                                {t("logTable.copyPath")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => onApplyRouteFilter(item.route_prefix)}
                              >
                                {t("logTable.filterSameRoute")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onApplyModelFilter(item.request_model)}
                              >
                                {t("logTable.filterSameModel")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  onApplySourceTypeFilter(item.api_key_name || '__anonymous__')
                                }
                              >
                                {t("logTable.filterSameSource")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <Empty className="border-border/70">
            <EmptyHeader>
              <EmptyTitle>{t("logTable.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("logTable.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={onClearFilters}>
                清空筛选
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </>
  )
}
