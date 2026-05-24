import type { LucideIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const iconColorMap = {
  blue: "bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400",
  purple: "bg-violet-100 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400",
  cyan: "bg-cyan-100 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400",
  default: "bg-muted text-muted-foreground",
} as const

export type MetricCardColor = keyof typeof iconColorMap

export function MetricCard({
  title,
  value,
  description,
  color = "default",
  icon: Icon,
}: {
  title: string
  value: string
  description: string
  color?: MetricCardColor
  icon?: LucideIcon
}) {
  const iconBg = iconColorMap[color]
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardDescription className="text-xs">{title}</CardDescription>
          {Icon && (
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", iconBg)}>
              <Icon className="h-[18px] w-[18px]" />
            </div>
          )}
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  )
}
