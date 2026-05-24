import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const colorMap = {
  blue: {
    border: "border-l-4 border-l-blue-400",
    value: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50/80 dark:bg-blue-950/20",
  },
  green: {
    border: "border-l-4 border-l-emerald-400",
    value: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50/80 dark:bg-emerald-950/20",
  },
  amber: {
    border: "border-l-4 border-l-amber-400",
    value: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50/80 dark:bg-amber-950/20",
  },
  purple: {
    border: "border-l-4 border-l-violet-400",
    value: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50/80 dark:bg-violet-950/20",
  },
  cyan: {
    border: "border-l-4 border-l-cyan-400",
    value: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50/80 dark:bg-cyan-950/20",
  },
  default: {
    border: "",
    value: "",
    bg: "",
  },
} as const

export type MetricCardColor = keyof typeof colorMap

export function MetricCard({
  title,
  value,
  description,
  color = "default",
}: {
  title: string
  value: string
  description: string
  color?: MetricCardColor
}) {
  const colors = colorMap[color]
  return (
    <Card size="sm" className={cn(colors.border, colors.bg)}>
      <CardHeader className="gap-2 border-b border-border/60">
        <CardDescription>{title}</CardDescription>
        <CardTitle className={cn("text-2xl font-bold tracking-tight", colors.value)}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3 text-xs text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  )
}
