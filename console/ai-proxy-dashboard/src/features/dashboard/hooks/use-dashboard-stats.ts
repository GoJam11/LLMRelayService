import { useCallback, useEffect, useRef, useState } from "react"

import { requestJson } from "@/features/dashboard/api"
import type {
  ConsoleRequestListItem,
  ConsoleStats,
  ConsoleUsageOverview,
} from "@/features/dashboard/types"

export type DashboardRange = "1h" | "24h" | "72h" | "7d" | "30d" | "all"

export function useDashboardStats(onUnauthorized: () => void) {
  const [overview, setOverview] = useState<ConsoleUsageOverview | null>(null)
  const [stats, setStats] = useState<ConsoleStats>({ routes: [], models: [], clients: [] })
  const [requests, setRequests] = useState<ConsoleRequestListItem[]>([])
  const [loading, setLoading] = useState(true)

  const [routeFilter, setRouteFilter] = useState("")
  const [rangeFilter, setRangeFilter] = useState<DashboardRange>("24h")

  const loadIdRef = useRef(0)

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const loadId = ++loadIdRef.current
      const silent = options.silent ?? false

      try {
        const query = new URLSearchParams()
        if (routeFilter) query.set("route", routeFilter)
        if (rangeFilter !== "all") query.set("range", rangeFilter)

        const qs = query.toString()
        const [statsData, requestsData] = await Promise.all([
          requestJson(`/__console/api/stats${qs ? `?${qs}` : ""}`),
          requestJson(`/__console/api/requests${qs ? `?${qs}&` : "?"}limit=500`),
        ])
        if (loadId !== loadIdRef.current) return

        setOverview(statsData.overview ?? null)
        setStats(statsData.stats ?? { routes: [], models: [], clients: [] })
        setRequests(requestsData.requests ?? [])
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        if (message === "unauthorized") {
          onUnauthorized()
          return
        }
        if (!silent) console.error("Dashboard stats error:", message)
      } finally {
        if (loadId === loadIdRef.current) {
          setLoading(false)
        }
      }
    },
    [onUnauthorized, rangeFilter, routeFilter],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return {
    overview,
    stats,
    requests,
    loading,
    refresh,
    routeFilter,
    setRouteFilter,
    rangeFilter,
    setRangeFilter,
  }
}
