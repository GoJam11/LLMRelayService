import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function MetricCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card size="sm">
      <CardHeader className="gap-2 border-b border-border/60">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3 text-xs text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  )
}
