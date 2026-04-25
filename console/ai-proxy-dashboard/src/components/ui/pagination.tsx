"use client"

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface PaginationProps {
  total: number
  limit: number
  offset: number
  onPageChange: (offset: number) => void
  onLimitChange: (limit: number) => void
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function Pagination({
  total,
  limit,
  offset,
  onPageChange,
  onLimitChange,
}: PaginationProps) {
  if (total === 0) return null

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.min(Math.floor(offset / limit) + 1, totalPages)
  const pageStart = offset + 1
  const pageEnd = Math.min(offset + limit, total)

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(page, totalPages))
    onPageChange((clamped - 1) * limit)
  }

  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "ellipsis", totalPages]
    }
    if (currentPage >= totalPages - 3) {
      return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }
    return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages]
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      {/* 左侧：条数信息 + 每页条数选择 */}
      <div className="flex items-center gap-4">
        <p className="text-xs text-muted-foreground">
          显示{" "}
          <span className="text-xs font-medium text-foreground">{pageStart}</span>
          {" – "}
          <span className="text-xs font-medium text-foreground">{pageEnd}</span>{" "}
          条，共{" "}
          <span className="text-xs font-medium text-foreground">{total}</span> 条
        </p>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground lg:block">每页</span>
          <Select value={String(limit)} onValueChange={(v) => onLimitChange(parseInt(v, 10))}>
            <SelectTrigger className="h-8 w-[64px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="hidden text-xs text-muted-foreground lg:block">条</span>
        </div>
      </div>

      {/* 右侧：翻页控件 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 sm:flex"
          disabled={currentPage <= 1}
          onClick={() => goToPage(1)}
          aria-label="首页"
        >
          <ChevronsLeft className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">上一页</span>
        </Button>

        {getPageNumbers().map((page, index) =>
          page === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex h-8 w-8 items-center justify-center text-xs text-muted-foreground"
            >
              <MoreHorizontal className="size-4" />
            </span>
          ) : (
            <Button
              key={page}
              variant={currentPage === page ? "outline" : "ghost"}
              size="icon"
              className="h-8 w-8 text-xs"
              onClick={() => goToPage(page)}
              aria-current={currentPage === page ? "page" : undefined}
            >
              {page}
            </Button>
          )
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          disabled={currentPage >= totalPages}
          onClick={() => goToPage(currentPage + 1)}
          aria-label="下一页"
        >
          <span className="hidden sm:inline">下一页</span>
          <ChevronRight className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 sm:flex"
          disabled={currentPage >= totalPages}
          onClick={() => goToPage(totalPages)}
          aria-label="尾页"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
