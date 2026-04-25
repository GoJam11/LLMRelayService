import { useCallback, useEffect, useRef, useState } from "react"

import { fetchUsageStats } from "@/features/dashboard/api"
import type {
  ConsoleStats,
  ConsoleUsageFilters,
  ConsoleUsageOverview,
  ConsoleUsageTimeSeriesPoint,
} from "@/features/dashboard/types"

export type UsageRange = "1h" | "24h" | "72h" | "7d" | "30d" | "all"

export function useUsageStats(onUnauthorized: () => void) {
  const [overview, setOverview] = useState<ConsoleUsageOverview | null>(null)
  const [stats, setStats] = useState<ConsoleStats>({ routes: [], models: [], clients: [] })
  const [filters, setFilters] = useState<ConsoleUsageFilters>({
    routes: [],
    models: [],
    clients: [],
  })
  const [timeseries, setTimeseries] = useState<ConsoleUsageTimeSeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  const [routeFilter, setRouteFilter] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [rangeFilter, setRangeFilter] = useState<UsageRange>("24h")

  const loadIdRef = useRef(0)

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const loadId = ++loadIdRef.current
      const silent = options.silent ?? false

      try {
        const query = new URLSearchParams()
        if (routeFilter) query.set("route", routeFilter)
        if (modelFilter) query.set("model", modelFilter)
        if (clientFilter) query.set("client", clientFilter)
        if (rangeFilter !== "all") query.set("range", rangeFilter)

        const data = await fetchUsageStats(query)
        if (loadId !== loadIdRef.current) return

        setOverview(data.overview ?? null)
        setStats(data.stats ?? { routes: [], models: [], clients: [] })
        setFilters(data.filters ?? { routes: [], models: [], clients: [] })
        setTimeseries(data.timeseries ?? [])
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        if (message === "unauthorized") {
          onUnauthorized()
          return
        }
        if (!silent) console.error("Usage stats error:", message)
      } finally {
        if (loadId === loadIdRef.current) {
          setLoading(false)
        }
      }
    },
    [clientFilter, modelFilter, onUnauthorized, rangeFilter, routeFilter],
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
    filters,
    timeseries,
    loading,
    refresh,
    routeFilter,
    setRouteFilter,
    modelFilter,
    setModelFilter,
    clientFilter,
    setClientFilter,
    rangeFilter,
    setRangeFilter,
  }
}