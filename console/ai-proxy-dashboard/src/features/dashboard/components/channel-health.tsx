import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { calculateChannelHealth, type HealthStatus } from "@/features/dashboard/utils/channel-health"
import type { ConsoleRequestListItem } from "@/features/dashboard/types"

const statusColors: Record<HealthStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
  "no-data": "bg-muted-foreground/30",
}

export function ChannelHealth({ requests }: { requests: ConsoleRequestListItem[] }) {
  const { t } = useTranslation()
  const healthData = useMemo(() => calculateChannelHealth(requests), [requests])

  const allHours = useMemo(() => {
    const hours = new Set<string>()
    healthData.forEach((data) => {
      data.hourlyStatus.forEach((_, hour) => hours.add(hour))
    })
    return Array.from(hours).sort().reverse().slice(0, 24)
  }, [healthData])

  if (healthData.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("channelHealth.title")}</CardTitle>
        <CardDescription>
          {t("channelHealth.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-background px-3 py-2 text-left font-medium">{t("channelHealth.routeCol")}</th>
                {allHours.map((hour) => (
                  <th key={hour} className="px-1 py-2 text-center text-xs font-medium">
                    {hour.split(" ")[1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {healthData.map((data) => (
                <tr key={data.route} className="border-b">
                  <td className="sticky left-0 bg-background px-3 py-2 font-mono text-xs">
                    {data.route}
                  </td>
                  {allHours.map((hour) => {
                    const status = data.hourlyStatus.get(hour) || "no-data"
                    return (
                      <td key={hour} className="px-1 py-2">
                        <div className={`mx-auto h-4 w-4 rounded ${statusColors[status]}`} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
