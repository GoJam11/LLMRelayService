import { useCallback, useEffect, useRef, useState } from "react"

import { fetchUsageStats } from "@/features/dashboard/api"
import type {
  ConsoleStats,
  ConsoleUsageFilters,
  ConsoleUsageOverview,
  ConsoleUsageTimeSeriesPoint,
  DateRangePreset,
  DateRangeValue,
} from "@/features/dashboard/types"

export type UsageRange = DateRangePreset

export function useUsageStats(
  onUnauthorized: () => void,
  options: { initialClientFilter?: string; initialDateRange?: DateRangeValue } = {},
) {
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
  const [clientFilter, setClientFilter] = useState(options.initialClientFilter ?? "")
  const [dateRange, setDateRange] = useState<DateRangeValue>(
    options.initialDateRange ?? { preset: "24h" },
  )

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

        if (dateRange.preset === "custom") {
          if (dateRange.from != null) query.set("from", String(dateRange.from))
          if (dateRange.to != null) query.set("to", String(dateRange.to))
        } else if (dateRange.preset !== "all") {
          query.set("range", dateRange.preset)
        }

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
    [clientFilter, dateRange, modelFilter, onUnauthorized, routeFilter],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setClientFilter(options.initialClientFilter ?? "")
  }, [options.initialClientFilter])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const setRangeFilter = useCallback((preset: UsageRange) => {
    setDateRange({ preset })
  }, [])

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
    rangeFilter: dateRange.preset,
    setRangeFilter,
    dateRange,
    setDateRange,
  }
}