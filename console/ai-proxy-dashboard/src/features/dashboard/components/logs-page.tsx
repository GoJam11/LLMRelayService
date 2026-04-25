import { useEffect, useMemo, useRef, useState } from "react"
import { ListFilter, Radio, RotateCcw, ScrollText } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Combobox } from "@/components/ui/combobox"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { RequestLogTable } from "@/features/dashboard/components/request-log-table"
import { useDashboardData } from "@/features/dashboard/hooks/use-dashboard-data"
import type { RequestSortKey, SortDirection } from "@/features/dashboard/api"

export function LogsPage({
  onUnauthorized,
  onSelectDetail,
}: {
  onUnauthorized: () => void
  onSelectDetail: (requestId: string) => void
}) {
  const {
    loading,
    refreshing,
    refreshDashboard,
    requests,
    total,
    limit,
    offset,
    filterOptions,
    sortBy,
    sortOrder,
  } = useDashboardData(onUnauthorized)

  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [routeFilter, setRouteFilter] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [sourceTypeFilter, setSourceTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [cacheFilter, setCacheFilter] = useState("all")
  const [liveMode, setLiveMode] = useState(false)
  const { t } = useTranslation()

  // 搜索框防抖 300ms，避免每次按键都触发 API
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  // 构建后端过滤参数（搜索使用防抖后的值）
  const filters = useMemo(() => ({
    search: debouncedSearchQuery || undefined,
    route: routeFilter || undefined,
    model: modelFilter || undefined,
    api_key_name: sourceTypeFilter !== "all" ? sourceTypeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    cache: cacheFilter !== "all" ? cacheFilter : undefined,
  }), [debouncedSearchQuery, routeFilter, modelFilter, sourceTypeFilter, statusFilter, cacheFilter])

  // 筛选变化时重置到第 1 页并重新请求
  // refreshDashboard 是稳定引用，不会引起重复触发
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      void refreshDashboard({ filters })
      return
    }
    void refreshDashboard({ filters, offset: 0 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // Live mode: poll every 3s, limit 100, offset 0
  const liveModeRef = useRef(liveMode)
  liveModeRef.current = liveMode
  useEffect(() => {
    if (!liveMode) return
    // entering live mode — immediately fetch latest 100
    void refreshDashboard({ limit: 100, offset: 0, filters: filtersRef.current })
    const id = window.setInterval(() => {
      if (liveModeRef.current) {
        void refreshDashboard({ silent: true, limit: 100, offset: 0, filters: filtersRef.current })
      }
    }, 3000)
    return () => window.clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode])

  const handlePageChange = (newOffset: number) => {
    void refreshDashboard({ offset: newOffset, filters })
  }

  const handleLimitChange = (newLimit: number) => {
    void refreshDashboard({ limit: newLimit, offset: 0, filters })
  }

  const handleSortChange = (newSortBy: RequestSortKey, newSortOrder: SortDirection) => {
    void refreshDashboard({ sortBy: newSortBy, sortOrder: newSortOrder, filters })
  }

  // 下拉选项从后端获取
  const routeOptions = useMemo(() => {
    return filterOptions.routes.map((value) => ({ value, label: value }))
  }, [filterOptions.routes])

  const modelOptions = useMemo(() => {
    return filterOptions.models.map((value) => ({ value, label: value }))
  }, [filterOptions.models])

  const sourceTypeOptions = useMemo(() => {
    return filterOptions.clients.map((client) => ({
      value: client.value,
      label: client.label,
    }))
  }, [filterOptions.clients])

  const clearFilters = () => {
    setSearchQuery("")
    setRouteFilter("")
    setModelFilter("")
    setSourceTypeFilter("all")
    setStatusFilter("all")
    setCacheFilter("all")
  }

  const hasActiveFilters = searchQuery || routeFilter || modelFilter || sourceTypeFilter !== "all" || statusFilter !== "all" || cacheFilter !== "all"

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <PageHeader
        icon={ScrollText}
        title={t("logs.title")}
        description={t("logs.description")}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant={liveMode ? "default" : "outline"}
              onClick={() => setLiveMode((v) => !v)}
              className={liveMode ? "animate-pulse" : ""}
            >
              <Radio data-icon="inline-start" className="h-4 w-4" />
              Live
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={refreshing || liveMode}
              onClick={() => {
                void refreshDashboard({ filters: filtersRef.current })
              }}
            >
              <RotateCcw data-icon="inline-start" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {t("common.refreshData")}
            </Button>
          </>
        }
      />

      {/* Filter Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-semibold">
              <ListFilter data-icon="inline-start" className="h-4 w-4" />
              {t("logs.filterPanelLabel")}
            </div>
            {(hasActiveFilters) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                {t("common.clearAllFilters")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Field>
              <FieldLabel htmlFor="request-search">{t("logs.filterPanelLabel")}</FieldLabel>
              <FieldContent>
                <Input
                  id="request-search"
                  placeholder={t("logs.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="route-filter">{t("logs.routeFilter")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={routeOptions}
                  value={routeFilter}
                  onChange={setRouteFilter}
                  placeholder={t("logs.allRoutes")}
                  searchPlaceholder={t("logs.searchRoute")}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="model-filter">{t("logs.modelFilter")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={modelOptions}
                  value={modelFilter}
                  onChange={setModelFilter}
                  placeholder={t("logs.allModels")}
                  searchPlaceholder={t("logs.searchModel")}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="source-type-filter">{t("logs.sourceFilter")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={[{ value: "all", label: t("logs.allTypes") }, ...sourceTypeOptions]}
                  value={sourceTypeFilter}
                  onChange={setSourceTypeFilter}
                  placeholder={t("logs.allTypes")}
                  searchPlaceholder={t("logs.searchType")}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="status-filter">{t("logs.statusFilter")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={[
                    { value: "all", label: t("logs.allStatus") },
                    { value: "success", label: t("logs.statusSuccess") },
                    { value: "error", label: t("logs.statusError") },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  placeholder={t("logs.allStatus")}
                  searchPlaceholder={t("logs.searchStatus")}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="cache-filter">{t("logs.cacheFilter")}</FieldLabel>
              <FieldContent>
                <Combobox
                  options={[
                    { value: "all", label: t("logs.allCache") },
                    { value: "hit", label: t("logs.cacheHit") },
                    { value: "create", label: t("logs.cacheCreate") },
                    { value: "miss", label: t("logs.cacheMiss") },
                    { value: "bypass", label: t("logs.cacheBypass") },
                    { value: "error", label: t("logs.cacheError") },
                  ]}
                  value={cacheFilter}
                  onChange={setCacheFilter}
                  placeholder={t("logs.allCache")}
                  searchPlaceholder={t("logs.searchCache")}
                />
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {/* Table + Pagination Card */}
      <Card>
        <RequestLogTable
          loading={loading}
          refreshing={refreshing}
          requests={requests}
          selectedId={null}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSortChange}
          onSelect={(requestId) => onSelectDetail(requestId)}
          onClearFilters={clearFilters}
          onApplyRouteFilter={setRouteFilter}
          onApplyModelFilter={setModelFilter}
          onApplySourceTypeFilter={setSourceTypeFilter}
        />

        {!liveMode && (
          <div className="border-t border-border/60">
            <div className="px-4 py-4">
              <Pagination
                total={total}
                limit={limit}
                offset={offset}
                onPageChange={handlePageChange}
                onLimitChange={handleLimitChange}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
