import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

type ChartConfig = {
  [k: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
    theme?: {
      light: string
      dark: string
    }
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, item]) => item.color || item.theme)

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries({ light: "", dark: ".dark" })
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .filter(Boolean)
  .join("\n")}
}
`,
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  formatter,
}: {
  active?: boolean
  payload?: Array<any>
  className?: string
  hideLabel?: boolean
  indicator?: "line" | "dot" | "dashed"
  formatter?: (value: unknown, name: string, item: any) => [React.ReactNode, React.ReactNode] | React.ReactNode
}) {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  const label = payload[0]?.payload?.bucket_label

  return (
    <div className={cn("grid min-w-[180px] gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs shadow-xl", className)}>
      {!hideLabel && label ? <div className="font-medium text-foreground">{label}</div> : null}
      <div className="grid gap-1.5">
        {payload.map((item) => {
          const key = `${item.dataKey || item.name || "value"}`
          const itemConfig = config[key]
          const color = item.color || `var(--color-${key})`
          const formatted = formatter?.(item.value, key, item)
          const valueNode = Array.isArray(formatted) ? formatted[0] : formatted ?? item.value
          const labelNode = Array.isArray(formatted) ? formatted[1] : itemConfig?.label || item.name

          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span
                  className={cn(
                    "shrink-0 rounded-[2px]",
                    indicator === "dot" && "h-2.5 w-2.5 rounded-full",
                    indicator === "line" && "h-0.5 w-3",
                    indicator === "dashed" && "h-0.5 w-3 border-t border-dashed bg-transparent",
                  )}
                  style={{
                    backgroundColor: indicator === "dashed" ? "transparent" : color,
                    borderColor: color,
                  }}
                />
                <span>{labelNode}</span>
              </div>
              <span className="font-mono text-foreground">{valueNode}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  payload,
}: {
  className?: string
  payload?: Array<any>
}) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div className={cn("flex items-center justify-center gap-4", className)}>
      {payload.map((item) => {
        const key = `${item.dataKey || "value"}`
        const itemConfig = config[key]

        return (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            {itemConfig?.label || item.value}
          </div>
        )
      })}
    </div>
  )
}

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
}
