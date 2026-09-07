import type { HTMLAttributes, ReactNode, MouseEvent } from "react"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  TestStatusButton,
  type TestResultData,
  type TestStatusButtonProps,
} from "./test-status-button"

export interface TableRowActionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
}

export function TableRowActions({ children, className, ...props }: TableRowActionsProps) {
  return (
    <div
      className={cn("flex items-center justify-end gap-1 select-none", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export interface RowActionProps {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  loading?: boolean
  label?: string
  icon?: ReactNode
  variant?: "outline" | "ghost" | "default" | "secondary" | "destructive"
  className?: string
  size?: "xs" | "sm"
  type?: "button" | "submit"
}

function RowEditAction({
  onClick,
  disabled = false,
  loading = false,
  label,
  className,
  size = "xs",
}: Omit<RowActionProps, "icon" | "variant">) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      disabled={disabled || loading}
      onClick={onClick}
      className={className}
    >
      {loading ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <Pencil data-icon="inline-start" />
      )}
      {label ?? t("common.edit", "编辑")}
    </Button>
  )
}

function RowDeleteAction({
  onClick,
  disabled = false,
  loading = false,
  label,
  className,
  size = "xs",
}: Omit<RowActionProps, "icon" | "variant">) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn("text-destructive hover:text-destructive", className)}
    >
      {loading ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <Trash2 data-icon="inline-start" />
      )}
      {label ?? t("common.delete", "删除")}
    </Button>
  )
}

function RowGenericAction({
  onClick,
  disabled = false,
  loading = false,
  label,
  icon,
  variant = "outline",
  className,
  size = "xs",
  type = "button",
}: RowActionProps) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      disabled={disabled || loading}
      onClick={onClick}
      className={className}
    >
      {loading ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        icon
      )}
      {label}
    </Button>
  )
}

TableRowActions.Test = TestStatusButton
TableRowActions.Edit = RowEditAction
TableRowActions.Delete = RowDeleteAction
TableRowActions.Action = RowGenericAction

export type { TestResultData, TestStatusButtonProps }
