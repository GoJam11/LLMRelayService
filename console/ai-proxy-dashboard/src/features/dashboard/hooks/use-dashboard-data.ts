import { useCallback, useEffect, useRef, useState } from "react"

import {
  DEFAULT_REQUEST_LIMIT,
  DEFAULT_REQUEST_OFFSET,
  fetchRequests,
  fetchFilterOptions,
  type ConsoleFilterOptions,
  type RequestSortKey,
  type SortDirection,
} from "@/features/dashboard/api"
import type {
  ConsoleRequestListItem,
} from "@/features/dashboard/types"

export interface RequestFilters {
  route?: string;
  model?: string;
  api_key_name?: string;
  search?: string;
  status?: string;
  cache?: string;
}

export function useDashboardData(onUnauthorized: () => void) {
  const [requests, setRequests] = useState<ConsoleRequestListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(DEFAULT_REQUEST_LIMIT)
  const [offset, setOffset] = useState(DEFAULT_REQUEST_OFFSET)
  const [sortBy, setSortBy] = useState<RequestSortKey>('created_at')
  const [sortOrder, setSortOrder] = useState<SortDirection>('desc')
  const [filterOptions, setFilterOptions] = useState<ConsoleFilterOptions>({
    routes: [],
    models: [],
    clients: [],
  })
  const loadIdRef = useRef(0)

  // Refs 保存最新的可变值，供稳定回调读取，避免闭包捕获旧值
  const limitRef = useRef(DEFAULT_REQUEST_LIMIT)
  const offsetRef = useRef(DEFAULT_REQUEST_OFFSET)
  const sortByRef = useRef<RequestSortKey>('created_at')
  const sortOrderRef = useRef<SortDirection>('desc')
  const latestFiltersRef = useRef<RequestFilters>({})
  const onUnauthorizedRef = useRef(onUnauthorized)

  // 每次渲染同步 refs
  limitRef.current = limit
  offsetRef.current = offset
  sortByRef.current = sortBy
  sortOrderRef.current = sortOrder
  onUnauthorizedRef.current = onUnauthorized

  // 加载筛选选项（稳定引用）
  const loadFilterOptions = useCallback(async () => {
    try {
      const data = await fetchFilterOptions()
      setFilterOptions({
        routes: data.routes ?? [],
        models: data.models ?? [],
        clients: data.clients ?? [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === "unauthorized") {
        onUnauthorizedRef.current()
      }
    }
  }, [])

  // 初始加载筛选选项
  useEffect(() => {
    void loadFilterOptions()
  }, [loadFilterOptions])

  // refreshDashboard 为稳定引用（空依赖数组），通过 refs 读取最新状态
  // 避免 state 变化导致函数重建进而引发 useEffect 二次触发
  const refreshDashboard = useCallback(
    async (options: {
      silent?: boolean;
      limit?: number;
      offset?: number;
      filters?: RequestFilters;
      sortBy?: RequestSortKey;
      sortOrder?: SortDirection;
    } = {}) => {
      const loadId = ++loadIdRef.current
      const silent = options.silent ?? false
      if (!silent) setRefreshing(true)
      const requestLimit = options.limit ?? limitRef.current
      const requestOffset = options.offset ?? offsetRef.current
      // 显式传入 filters 时更新 ref；否则沿用上次的 filters
      const requestFilters = 'filters' in options ? (options.filters ?? {}) : latestFiltersRef.current
      const requestSortBy = options.sortBy ?? sortByRef.current
      const requestSortOrder = options.sortOrder ?? sortOrderRef.current

      if ('filters' in options) {
        latestFiltersRef.current = options.filters ?? {}
      }

      try {
        const data = await fetchRequests(
          requestLimit,
          requestOffset,
          requestFilters,
          requestSortBy,
          requestSortOrder,
        )
        if (loadId !== loadIdRef.current) return

        setRequests(data.requests ?? [])
        setTotal(data.total ?? 0)
        setLimit(requestLimit)
        setOffset(requestOffset)
        setSortBy(requestSortBy)
        setSortOrder(requestSortOrder)
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        if (message === "unauthorized") {
          onUnauthorizedRef.current()
          return
        }
        if (!silent) {
          console.error("Dashboard data error:", message)
        }
      } finally {
        if (loadId === loadIdRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [], // 稳定引用，不依赖任何 state
  )

  return {
    loading,
    refreshing,
    refreshDashboard,
    requests,
    total,
    limit,
    offset,
    sortBy,
    sortOrder,
    filterOptions,
    loadFilterOptions,
  }
}
