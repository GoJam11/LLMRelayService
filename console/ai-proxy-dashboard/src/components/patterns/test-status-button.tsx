import { CheckCircle, Loader2, Wifi, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface TestResultData {
  status: "ok" | "error"
  message?: string
  latencyMs?: number
  statusCode?: number
}

export interface TestStatusButtonProps {
  /**
   * The current test result or "loading" string.
   * Null or undefined means idle.
   */
  result?: TestResultData | "loading" | null
  /**
   * Click handler to trigger or re-trigger the test.
   */
  onTest: () => void | Promise<void>
  /**
   * Explicit disabled override (e.g. if parent form is submitting).
   */
  disabled?: boolean
  /**
   * Button size. Inline table actions should always use "xs" (default).
   */
  size?: "xs" | "sm"
  /**
   * Custom label for the test button (defaults to t("common.test") or "测试").
   */
  label?: string
  /**
   * Custom label for testing state (defaults to t("common.testing") or "测试中").
   */
  loadingLabel?: string
  /**
   * Extra className.
   */
  className?: string
}

export function TestStatusButton({
  result,
  onTest,
  disabled = false,
  size = "xs",
  label,
  loadingLabel,
  className,
}: TestStatusButtonProps) {
  const { t } = useTranslation()

  const defaultLabel = label ?? t("common.test", "测试")
  const defaultTestingLabel = loadingLabel ?? t("common.testing", "测试中")

  if (result === "loading") {
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled
        className={cn("select-none", className)}
      >
        <Loader2 data-icon="inline-start" className="animate-spin" />
        {defaultTestingLabel}
      </Button>
    )
  }

  if (result && (result.status === "ok" || result.status === "error")) {
    const isOk = result.status === "ok"
    const tooltipMessage = result.message || (isOk ? t("common.testSuccess", "测试通过") : t("common.testFailed", "测试失败"))

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={size}
              disabled={disabled}
              className={cn(
                isOk
                  ? "border-green-500/50 text-green-600 hover:border-green-600/70 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                  : "border-destructive/50 text-destructive hover:border-destructive hover:text-destructive",
                className,
              )}
              onClick={onTest}
            >
              {isOk ? (
                <CheckCircle data-icon="inline-start" />
              ) : (
                <XCircle data-icon="inline-start" />
              )}
              {defaultLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            <p>{tooltipMessage}</p>
            {result.latencyMs != null && (
              <p className="mt-0.5 text-muted-foreground">{result.latencyMs}ms</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      disabled={disabled}
      className={cn("select-none", className)}
      onClick={onTest}
    >
      <Wifi data-icon="inline-start" />
      {defaultLabel}
    </Button>
  )
}
