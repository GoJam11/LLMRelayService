import { useEffect, useMemo, useState } from "react"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { DateRangePreset, DateRangeValue } from "@/features/dashboard/types"
import { cn } from "@/lib/utils"

export interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  className?: string
}

function padZero(n: number): string {
  return String(n).padStart(2, "0")
}

function toLocalDatetimeInputString(timestampMs?: number): string {
  if (!timestampMs) return ""
  const d = new Date(timestampMs)
  if (Number.isNaN(d.getTime())) return ""
  const YYYY = d.getFullYear()
  const MM = padZero(d.getMonth() + 1)
  const DD = padZero(d.getDate())
  const hh = padZero(d.getHours())
  const mm = padZero(d.getMinutes())
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}`
}

function fromLocalDatetimeInputString(str: string): number | undefined {
  if (!str.trim()) return undefined
  const d = new Date(str)
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : undefined
}

function formatDisplayDate(timestampMs: number): string {
  const d = new Date(timestampMs)
  const pad = padZero
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: DateRangePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [error, setError] = useState<string | null>(null)

  // 当 Popover 打开或外部 value 变更时同步本地自定义输入框
  useEffect(() => {
    if (open) {
      setError(null)
      if (value.preset === "custom") {
        setCustomStart(toLocalDatetimeInputString(value.from))
        setCustomEnd(toLocalDatetimeInputString(value.to))
      } else {
        // 如果当前是 preset，提供合理的默认起止供用户直接微调
        const now = Date.now()
        let startMs: number = now - 24 * 60 * 60 * 1000
        let endMs: number = now

        if (value.preset === "1h") startMs = now - 60 * 60 * 1000
        else if (value.preset === "72h") startMs = now - 72 * 60 * 60 * 1000
        else if (value.preset === "7d") startMs = now - 7 * 24 * 60 * 60 * 1000
        else if (value.preset === "30d") startMs = now - 30 * 24 * 60 * 60 * 1000
        else if (value.preset === "today") {
          const d = new Date()
          startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
        } else if (value.preset === "yesterday") {
          const d = new Date()
          startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
          endMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - 1
        } else if (value.preset === "this_month") {
          const d = new Date()
          startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        }

        setCustomStart(toLocalDatetimeInputString(startMs))
        setCustomEnd(toLocalDatetimeInputString(endMs))
      }
    }
  }, [open, value])

  const presets: { value: DateRangePreset; label: string }[] = useMemo(
    () => [
      { value: "1h", label: t("timeRange.1h") },
      { value: "24h", label: t("timeRange.24h") },
      { value: "today", label: t("timeRange.today") },
      { value: "yesterday", label: t("timeRange.yesterday") },
      { value: "72h", label: t("timeRange.72h") },
      { value: "7d", label: t("timeRange.7d") },
      { value: "30d", label: t("timeRange.30d") },
      { value: "this_month", label: t("timeRange.this_month") },
      { value: "all", label: t("timeRange.all") },
    ],
    [t],
  )

  const handleSelectPreset = (preset: DateRangePreset) => {
    onChange({ preset })
    setOpen(false)
  }

  const handleApplyCustom = () => {
    const fromMs = fromLocalDatetimeInputString(customStart)
    const toMs = fromLocalDatetimeInputString(customEnd)

    if (fromMs != null && toMs != null && fromMs > toMs) {
      setError(t("timeRange.invalidRange"))
      return
    }

    setError(null)
    onChange({
      preset: "custom",
      from: fromMs,
      to: toMs,
    })
    setOpen(false)
  }

  const handleResetCustom = () => {
    const now = Date.now()
    setCustomStart(toLocalDatetimeInputString(now - 24 * 60 * 60 * 1000))
    setCustomEnd(toLocalDatetimeInputString(now))
    setError(null)
  }

  const triggerText = useMemo(() => {
    if (value.preset !== "custom") {
      const match = presets.find((p) => p.value === value.preset)
      return match ? match.label : t(`timeRange.${value.preset}`, value.preset)
    }

    if (value.from && value.to) {
      return `${formatDisplayDate(value.from)} ~ ${formatDisplayDate(value.to)}`
    }
    if (value.from) {
      return `>= ${formatDisplayDate(value.from)}`
    }
    if (value.to) {
      return `<= ${formatDisplayDate(value.to)}`
    }
    return t("timeRange.custom")
  }, [value, presets, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 min-w-[130px] justify-between text-left text-xs font-normal",
            value.preset === "custom" && "border-primary text-foreground font-medium",
            className,
          )}
        >
          <span className="flex items-center gap-1.5 truncate">
            <CalendarIcon data-icon="inline-start" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{triggerText}</span>
          </span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-auto p-0 rounded-none border border-border shadow-lg"
      >
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
          {/* 左侧：快捷预设 */}
          <div className="p-3 w-full md:w-44 flex flex-col gap-1 bg-muted/20">
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("timeRange.presets")}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-1 gap-1">
              {presets.map((p) => {
                const isActive = value.preset === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleSelectPreset(p.value)}
                    className={cn(
                      "w-full text-left px-2.5 py-1.5 text-xs transition-colors rounded-none",
                      isActive
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 右侧：自定义起止时间 */}
          <div className="p-4 w-full md:w-72 flex flex-col gap-3.5 bg-card">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("timeRange.customRange")}
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <Label htmlFor="date-range-start" className="text-xs text-muted-foreground font-normal">
                  {t("timeRange.startTime")}
                </Label>
                <Input
                  id="date-range-start"
                  type="datetime-local"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value)
                    setError(null)
                  }}
                  className="h-8 rounded-none text-xs"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="date-range-end" className="text-xs text-muted-foreground font-normal">
                  {t("timeRange.endTime")}
                </Label>
                <Input
                  id="date-range-end"
                  type="datetime-local"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value)
                    setError(null)
                  }}
                  className="h-8 rounded-none text-xs"
                />
              </div>
            </div>

            {error ? (
              <div className="text-[11px] text-destructive">{error}</div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border mt-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleResetCustom}
                className="rounded-none text-muted-foreground hover:text-foreground"
              >
                {t("timeRange.reset")}
              </Button>
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={handleApplyCustom}
                className="rounded-none px-3"
              >
                {t("timeRange.apply")}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
