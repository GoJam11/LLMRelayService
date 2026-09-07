import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export type StatusVariant = "success" | "warning" | "destructive" | "muted" | "info"

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StatusVariant
  mode?: "badge" | "dot"
  pulse?: boolean
  children?: ReactNode
  className?: string
}

export function StatusBadge({
  variant = "muted",
  mode = "badge",
  pulse = false,
  children,
  className,
  ...props
}: StatusBadgeProps) {
  if (mode === "dot") {
    const dotColors: Record<StatusVariant, string> = {
      success: "bg-green-500 dark:bg-green-400",
      warning: "bg-amber-500 dark:bg-amber-400",
      destructive: "bg-destructive",
      muted: "bg-muted-foreground/40",
      info: "bg-primary",
    }

    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs font-medium select-none", className)}
        {...props}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            dotColors[variant],
            pulse && "animate-pulse",
          )}
        />
        {children && <span>{children}</span>}
      </span>
    )
  }

  const badgeVariants: Record<StatusVariant, string> = {
    success: "border-green-500/30 bg-green-500/10 text-green-700 dark:border-green-500/40 dark:text-green-400 font-normal",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-400 font-normal",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive font-normal",
    muted: "border-border bg-muted/30 text-muted-foreground font-normal",
    info: "border-primary/30 bg-primary/10 text-primary font-normal",
  }

  return (
    <Badge
      variant="outline"
      className={cn("text-xs", badgeVariants[variant], className)}
      {...props}
    >
      {pulse && (
        <span
          className={cn(
            "mr-1.5 h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-green-500",
            variant === "warning" && "bg-amber-500",
            variant === "destructive" && "bg-destructive",
            variant === "info" && "bg-primary",
            variant === "muted" && "bg-muted-foreground",
            "animate-pulse",
          )}
        />
      )}
      {children}
    </Badge>
  )
}
