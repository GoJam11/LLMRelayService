import type { LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const iconColorMap = {
  blue: "bg-accent text-accent-foreground",
  green: "bg-lrs-success-bg text-lrs-success",
  amber: "bg-lrs-warn-bg text-lrs-warn",
  purple: "bg-accent text-accent-foreground",
  cyan: "bg-accent text-accent-foreground",
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
    <Card size="sm" className="flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-muted-foreground">{title}</span>
        {Icon && (
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]", iconBg)}>
            <Icon className="h-[15px] w-[15px]" />
          </div>
        )}
      </div>
      <div className="font-mono text-[28px] font-medium leading-none tracking-[-0.02em] text-foreground">
        {value}
      </div>
      <div className="text-[11.5px] text-muted-foreground">{description}</div>
    </Card>
  )
}
