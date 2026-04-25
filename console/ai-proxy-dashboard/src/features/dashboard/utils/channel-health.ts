import type { ConsoleRequestListItem } from "@/features/dashboard/types"

export type HealthStatus = "healthy" | "degraded" | "down" | "no-data"

export interface ChannelHealthData {
  route: string
  hourlyStatus: Map<string, HealthStatus>
}

export function calculateChannelHealth(
  requests: ConsoleRequestListItem[]
): ChannelHealthData[] {
  const routeHourMap = new Map<string, Map<string, { total: number; success: number }>>()

  requests.forEach((req) => {
    const route = req.route_prefix || "unknown"
    const timestamp = new Date(req.created_at)
    const hourKey = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}-${String(timestamp.getDate()).padStart(2, "0")} ${String(timestamp.getHours()).padStart(2, "0")}:00`

    if (!routeHourMap.has(route)) {
      routeHourMap.set(route, new Map())
    }

    const hourMap = routeHourMap.get(route)!
    if (!hourMap.has(hourKey)) {
      hourMap.set(hourKey, { total: 0, success: 0 })
    }

    const stats = hourMap.get(hourKey)!
    stats.total++

    const status = req.response_status
    if (status !== null && status >= 200 && status < 400) {
      stats.success++
    }
  })

  return Array.from(routeHourMap.entries()).map(([route, hourMap]) => {
    const hourlyStatus = new Map<string, HealthStatus>()

    hourMap.forEach((stats, hourKey) => {
      if (stats.total === 0) {
        hourlyStatus.set(hourKey, "no-data")
      } else if (stats.success === stats.total) {
        hourlyStatus.set(hourKey, "healthy")
      } else if (stats.success > 0) {
        hourlyStatus.set(hourKey, "degraded")
      } else {
        hourlyStatus.set(hourKey, "down")
      }
    })

    return { route, hourlyStatus }
  })
}
