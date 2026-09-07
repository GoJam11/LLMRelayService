import type { ReactNode } from "react"
import { ListFilter, RotateCcw } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"

export interface FilterCardProps {
  title?: ReactNode
  icon?: ReactNode
  children: ReactNode
  onReset?: () => void
  resetLabel?: string
  resetDisabled?: boolean
  actions?: React.ReactNode
  className?: string
  gridClassName?: string
}

export function FilterCard({
  title,
  icon,
  children,
  onReset,
  resetLabel,
  resetDisabled = false,
  actions,
  className,
  gridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-4",
}: FilterCardProps) {
  const { t } = useTranslation()

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {icon ?? <ListFilter className="h-4 w-4 text-muted-foreground" />}
            {title ?? t("common.filter", "筛选")}
          </div>

          <div className="flex items-center gap-2">
            {actions}
            {onReset && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onReset}
                disabled={resetDisabled}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw data-icon="inline-start" />
                {resetLabel ?? t("common.reset", "重置")}
              </Button>
            )}
          </div>
        </div>

        <FieldGroup className={gridClassName}>
          {children}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
