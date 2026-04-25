import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ConsoleStatsBucket } from "@/features/dashboard/types"
import {
  calculateHitRate,
  formatCount,
  formatDuration,
  formatPercent,
  formatTime,
  formatCost,
} from "@/features/dashboard/utils"

export function BucketTable({
  title,
  description,
  buckets,
  onApplyFilter,
  showHitRate = true,
}: {
  title: string
  description: string
  buckets: ConsoleStatsBucket[]
  onApplyFilter: (key: string) => void
  showHitRate?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription className="text-sm leading-6">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {buckets.length ? (
          <div className="rounded-lg border border-border/70">
            <ScrollArea className="w-full">
              <Table>
                <TableHeader className="bg-background">
                  <TableRow>
                    <TableHead>{t("bucket.colDimension")}</TableHead>
                    <TableHead className="text-right">{t("bucket.colRequests")}</TableHead>
                    {showHitRate && <TableHead className="text-right">{t("bucket.colHitRate")}</TableHead>}
                    <TableHead className="text-right">{t("bucket.colAvgFirstToken")}</TableHead>
                    <TableHead className="text-right">{t("bucket.colErrors")}</TableHead>
                    <TableHead className="text-right">{t("bucket.colTotalTokens")}</TableHead>
                    <TableHead className="text-right">{t("bucket.colTotalCost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.map((bucket) => (
                    <TableRow key={bucket.key}>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-col gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto justify-start px-0 text-left font-medium text-foreground"
                            onClick={() => onApplyFilter(bucket.key)}
                          >
                            {bucket.label || bucket.key || "--"}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {t("bucket.lastSeen", { time: formatTime(bucket.last_seen_at) })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCount(bucket.requests)}
                      </TableCell>
                      {showHitRate && (
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatPercent(
                            calculateHitRate(bucket.cache_hits, bucket.requests),
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatDuration(bucket.avg_first_token_ms)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCount(bucket.errors)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCount(bucket.total_tokens)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCost(bucket.total_cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        ) : (
          <Empty className="border-border/70">
            <EmptyHeader>
              <EmptyTitle>{t("bucket.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("bucket.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}
