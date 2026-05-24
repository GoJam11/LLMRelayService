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
  blue: "bg-gradient-to-br from-blue-500 to-cyan-400 text-white",
  green: "bg-gradient-to-br from-emerald-400 to-teal-500 text-white",
  amber: "bg-gradient-to-br from-amber-300 to-orange-500 text-white",
  purple: "bg-gradient-to-br from-violet-400 to-blue-500 text-white",
  cyan: "bg-gradient-to-br from-cyan-300 to-blue-500 text-white",
  default: "bg-gradient-to-br from-slate-100 to-blue-100 text-primary",
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
    <Card size="sm" className="c4d-metric-card">
      <CardHeader className="relative z-10 pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardDescription className="pt-1 text-xs font-semibold text-muted-foreground">{title}</CardDescription>
          {Icon && (
            <div className={cn("c4d-icon-tile flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", iconBg)}>
              <Icon className="h-[18px] w-[18px]" />
            </div>
          )}
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="relative z-10 pt-0 text-xs font-medium text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  )
}
