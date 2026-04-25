import type {
  ConsoleRequestListItem,
  RequestSortKey,
  SortDirection,
} from "@/features/dashboard/types"

export function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "--"
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function formatCount(value: unknown): string {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return "--"
  return numeric.toLocaleString("zh-CN")
}

export function formatDuration(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return "--"
  if (numeric < 1000) return `${Math.round(numeric)} ms`
  if (numeric < 60 * 1000) {
    return `${(numeric / 1000).toFixed(numeric >= 10 * 1000 ? 1 : 2)} s`
  }
  return `${(numeric / (60 * 1000)).toFixed(1)} min`
}

export function formatPercent(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "--"
  return `${numeric.toFixed(1)}%`
}

export function formatCost(value: unknown): string {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric < 0) return "--"
  if (numeric === 0) return "$0.00"
  if (numeric < 0.01) return `$${numeric.toFixed(4)}`
  return `$${numeric.toFixed(2)}`
}

export function formatPricePerMillion(value: unknown): string {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric < 0) return "--"
  if (numeric === 0) return "$0.00 / 1M"
  if (numeric < 0.01) return `$${numeric.toFixed(4)} / 1M`
  return `$${numeric.toFixed(2)} / 1M`
}

export function calculateOutputTokensPerSecond(
  usageLike: any,
  timingLike: any,
): number | null {
  const outputTokens = Number(usageLike?.output_tokens ?? usageLike?.total_output_tokens)
  const generationDurationMs = Number(timingLike?.generation_duration_ms)

  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null
  if (!Number.isFinite(generationDurationMs) || generationDurationMs <= 0) return null

  return outputTokens / (generationDurationMs / 1000)
}

export function formatTokensPerSecond(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return "--"
  if (numeric >= 100) return `${numeric.toFixed(0)} tok/s`
  if (numeric >= 10) return `${numeric.toFixed(1)} tok/s`
  return `${numeric.toFixed(2)} tok/s`
}

export function shortText(text: unknown, max = 18): string {
  const value = String(text ?? "")
  if (!value) return "--"
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

export function calculateHitRate(hits: unknown, requests: unknown): number {
  const hitValue = Number(hits || 0)
  const requestValue = Number(requests || 0)
  if (!requestValue) return 0
  return (hitValue / requestValue) * 100
}

export function getTotalTokens(usageLike: any, upstreamType?: string): number {
  const explicitTotal = Number(usageLike?.total_tokens ?? 0)
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal

  const input = Number(usageLike?.input_tokens ?? usageLike?.total_input_tokens ?? 0)
  const output = Number(
    usageLike?.output_tokens ?? usageLike?.total_output_tokens ?? 0,
  )
  if (upstreamType === "openai") {
    return input + output
  }
  const cacheCreation = Number(
    usageLike?.cache_creation_input_tokens ??
      usageLike?.total_cache_creation_tokens ??
      0,
  )
  const cacheRead = Number(
    usageLike?.cache_read_input_tokens ?? usageLike?.total_cache_read_tokens ?? 0,
  )

  return input + output + cacheCreation + cacheRead
}

export function getUsageMetricRows(
  usageLike: any,
  timingLike: any,
  upstreamType: string,
): Array<{ label: string; value: string }> {
  const outputSpeed = formatTokensPerSecond(
    calculateOutputTokensPerSecond(usageLike, timingLike),
  )

  if (upstreamType === "openai") {
    return [
      { label: "prompt", value: formatCount(usageLike?.input_tokens) },
      {
        label: "uncached prompt",
        value: formatCount(
          usageLike?.uncached_input_tokens ?? usageLike?.input_tokens,
        ),
      },
      { label: "completion", value: formatCount(usageLike?.output_tokens) },
      { label: "total", value: formatCount(getTotalTokens(usageLike, upstreamType)) },
      { label: "输出速度", value: outputSpeed },
      {
        label: "cached prompt",
        value: formatCount(usageLike?.cached_input_tokens),
      },
      {
        label: "reasoning",
        value: formatCount(usageLike?.reasoning_output_tokens),
      },
      { label: "stop reason", value: usageLike?.stop_reason || "--" },
    ]
  }

  return [
    { label: "input", value: formatCount(usageLike?.input_tokens) },
    { label: "output", value: formatCount(usageLike?.output_tokens) },
    { label: "total", value: formatCount(getTotalTokens(usageLike, upstreamType)) },
    { label: "输出速度", value: outputSpeed },
    {
      label: "cache create",
      value: formatCount(usageLike?.cache_creation_input_tokens),
    },
    {
      label: "cache read",
      value: formatCount(usageLike?.cache_read_input_tokens),
    },
    { label: "stop reason", value: usageLike?.stop_reason || "--" },
  ]
}

function formatCostFormula(
  tokens: unknown,
  unitPrice: unknown,
  cost: unknown,
): string {
  return `${formatCount(tokens)} × ${formatCost(unitPrice)} / 1,000,000 = ${formatCost(cost)}`
}

export function getCostMetricRows(
  usageLike: any,
  fallbackModel?: string,
  upstreamType?: string,
): Array<{ label: string; value: string }> {
  const pricing = usageLike?.cost_pricing
  const breakdown = usageLike?.cost_breakdown
  const resolvedUpstreamType = upstreamType === "openai" ? "openai" : "anthropic"
  const model = usageLike?.model || fallbackModel || "--"
  const uncachedInputTokens =
    breakdown?.uncached_input_tokens ??
    usageLike?.uncached_input_tokens ??
    usageLike?.input_tokens ??
    0
  const cacheReadTokens =
    breakdown?.cache_read_tokens ??
    (resolvedUpstreamType === "openai"
      ? usageLike?.cached_input_tokens
      : usageLike?.cache_read_input_tokens) ??
    0
  const cacheWriteTokens =
    breakdown?.cache_write_tokens ??
    (resolvedUpstreamType === "anthropic"
      ? usageLike?.cache_creation_input_tokens
      : 0) ??
    0
  const rows = [
    { label: "总成本", value: formatCost(usageLike?.cost) },
    { label: "模型", value: model },
  ]

  if (!pricing || !breakdown) {
    rows.push({
      label: "计算公式",
      value: "缺少该模型的定价数据，暂时无法展开计算公式。",
    })
    return rows
  }

  if (resolvedUpstreamType === "openai") {
    rows.push({
      label: "模型单价",
      value: `输入 ${formatPricePerMillion(pricing.input)} · 输出 ${formatPricePerMillion(pricing.output)} · cached prompt ${formatPricePerMillion(pricing.cache_read ?? 0)}`,
    })
  } else {
    rows.push({
      label: "模型单价",
      value: `输入 ${formatPricePerMillion(pricing.input)} · 输出 ${formatPricePerMillion(pricing.output)} · 缓存读 ${formatPricePerMillion(pricing.cache_read ?? 0)} · 缓存写 ${formatPricePerMillion(pricing.cache_write ?? 0)}`,
    })
  }
  rows.push({
    label: "输入公式",
    value: formatCostFormula(
      uncachedInputTokens,
      pricing.input,
      breakdown.input_cost,
    ),
  })
  rows.push({
    label: "输出公式",
    value: formatCostFormula(
      usageLike?.output_tokens,
      pricing.output,
      breakdown.output_cost,
    ),
  })
  rows.push({
    label: resolvedUpstreamType === "openai" ? "cached prompt公式" : "缓存读公式",
    value: formatCostFormula(
      cacheReadTokens,
      pricing.cache_read ?? 0,
      breakdown.cache_read_cost,
    ),
  })
  if (resolvedUpstreamType === "anthropic") {
    rows.push({
      label: "缓存写公式",
      value: formatCostFormula(
        cacheWriteTokens,
        pricing.cache_write ?? 0,
        breakdown.cache_write_cost,
      ),
    })
  }
  rows.push({
    label: "汇总公式",
    value:
      resolvedUpstreamType === "openai"
        ? `${formatCost(breakdown.input_cost)} + ${formatCost(breakdown.output_cost)} + ${formatCost(breakdown.cache_read_cost)} = ${formatCost(breakdown.total_cost)}`
        : `${formatCost(breakdown.input_cost)} + ${formatCost(breakdown.output_cost)} + ${formatCost(breakdown.cache_read_cost)} + ${formatCost(breakdown.cache_write_cost)} = ${formatCost(breakdown.total_cost)}`,
  })
  return rows
}

export function getStatusBadgeVariant(
  cacheState: string,
): "secondary" | "outline" | "destructive" {
  if (cacheState === "hit") return "secondary"
  if (cacheState === "miss") return "destructive"
  return "outline"
}

export function getComparisonBadgeVariant(
  status: string,
): "secondary" | "outline" | "destructive" {
  if (status === "expected_hit_confirmed") return "secondary"
  if (status === "expected_hit_missed") return "destructive"
  return "outline"
}

export function getHttpStatusLabel(
  status: number | null | undefined,
): string {
  if (status == null) return "请求中"
  if (status === 408 || status === 504) return `${status} 超时`
  if (status >= 200 && status < 400) return `${status} 成功`
  return `${status} 失败`
}

export function getHttpStatusBadgeVariant(
  status: number | null | undefined,
): "secondary" | "outline" | "destructive" {
  if (status == null) return "outline"
  if (status >= 200 && status < 400) return "secondary"
  return "destructive"
}

export function getPayloadText(payload: string | null | undefined): string {
  const text = String(payload ?? "")
  if (!text) return ""

  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function extractJsonObjectsFromSse(payloadText: string): Array<Record<string, unknown>> {
  const blocks = payloadText
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  const results: Array<Record<string, unknown>> = []

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())

    if (!dataLines.length) continue

    const rawData = dataLines.join("\n")
    if (!rawData || rawData === "[DONE]") continue

    try {
      const parsed = JSON.parse(rawData) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        results.push(parsed as Record<string, unknown>)
      }
    } catch {
      continue
    }
  }

  return results
}

function collectTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value

  if (Array.isArray(value)) {
    return value.map((item) => collectTextFromUnknown(item)).join("")
  }

  if (!value || typeof value !== "object") return ""

  const record = value as Record<string, unknown>

  if (typeof record.text === "string") return record.text
  if (typeof record.output_text === "string") return record.output_text
  if (typeof record.content === "string") return record.content

  if (Array.isArray(record.content)) {
    return record.content.map((item) => collectTextFromUnknown(item)).join("")
  }

  return ""
}

export function extractReadableSseText(payload: string | null | undefined): string {
  const payloadText = String(payload ?? "").trim()
  if (!payloadText) return ""

  const jsonObjects = extractJsonObjectsFromSse(payloadText)
  if (!jsonObjects.length) return ""

  const segments: string[] = []

  for (const event of jsonObjects) {
    const eventType = typeof event.type === "string" ? event.type : ""
    const delta = event.delta
    const message = event.message

    if (eventType === "content_block_start") {
      const contentBlock = (event.content_block ?? null) as Record<string, unknown> | null
      if (!contentBlock) continue

      if (contentBlock.type === "text") {
        const text = collectTextFromUnknown(contentBlock)
        if (text) segments.push(text)
      }
      continue
    }

    if (eventType === "content_block_delta" && delta && typeof delta === "object") {
      const deltaRecord = delta as Record<string, unknown>
      if (deltaRecord.type === "text_delta" && typeof deltaRecord.text === "string") {
        segments.push(deltaRecord.text)
      }
      continue
    }

    if (eventType === "message_start" && message && typeof message === "object") {
      const messageRecord = message as Record<string, unknown>
      const text = collectTextFromUnknown(messageRecord.content)
      if (text) segments.push(text)
      continue
    }

    if (Array.isArray(event.choices)) {
      for (const choice of event.choices as Array<Record<string, unknown>>) {
        const choiceDelta = choice?.delta
        if (typeof choiceDelta === "string") {
          segments.push(choiceDelta)
          continue
        }

        if (choiceDelta && typeof choiceDelta === "object") {
          const deltaRecord = choiceDelta as Record<string, unknown>

          // reasoning_content 推理内容
          const reasoningContent = deltaRecord.reasoning_content
          if (typeof reasoningContent === "string" && reasoningContent) {
            segments.push(reasoningContent)
          }

          // content 普通内容
          const content = deltaRecord.content
          if (typeof content === "string" && content) {
            segments.push(content)
          }
          if (Array.isArray(content)) {
            const text = content.map((item) => collectTextFromUnknown(item)).join("")
            if (text) segments.push(text)
          }

          // tool_calls 工具调用
          const toolCalls = deltaRecord.tool_calls
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (!tc || typeof tc !== "object") continue
              const tcRecord = tc as Record<string, unknown>
              const func = tcRecord.function
              if (func && typeof func === "object") {
                const funcRecord = func as Record<string, unknown>
                // 函数名只在第一次出现时添加
                if (typeof funcRecord.name === "string" && funcRecord.name) {
                  segments.push(`\n[Tool: ${funcRecord.name}]\n`)
                }
                // 参数逐块拼接
                if (typeof funcRecord.arguments === "string") {
                  segments.push(funcRecord.arguments)
                }
              }
            }
          }
        }
      }
      continue
    }

    const text = collectTextFromUnknown(event.output)
      || collectTextFromUnknown(event.content)
      || collectTextFromUnknown(delta)

    if (text) segments.push(text)
  }

  return segments.join("").trim()
}

export function getPayloadBytes(payload: string | null | undefined): number {
  const text = String(payload ?? "")
  return new TextEncoder().encode(text).length
}

function getSortableValue(item: ConsoleRequestListItem, sortKey: RequestSortKey): number | string {
  if (sortKey === "created_at") return item.created_at ?? 0
  if (sortKey === "response_status") return item.response_status ?? -1
  return getTotalTokens(item.response_usage, item.upstream_type)
}

export function sortRequests(
  requests: ConsoleRequestListItem[],
  sortKey: RequestSortKey,
  sortDirection: SortDirection,
): ConsoleRequestListItem[] {
  const copied = [...requests]
  copied.sort((left, right) => {
    const leftValue = getSortableValue(left, sortKey)
    const rightValue = getSortableValue(right, sortKey)

    let result = 0
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      result = leftValue.localeCompare(rightValue, "zh-CN")
    } else {
      result = Number(leftValue) - Number(rightValue)
    }

    return sortDirection === "asc" ? result : -result
  })
  return copied
}

export async function copyText(value: string): Promise<boolean> {
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
