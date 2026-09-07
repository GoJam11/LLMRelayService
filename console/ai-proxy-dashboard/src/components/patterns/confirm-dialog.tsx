import type { ReactNode } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  variant?: "destructive" | "default"
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  loading = false,
  variant = "destructive",
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  const handleConfirm = async () => {
    await onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant === "destructive" && (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            )}
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground pt-1">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            {cancelText ?? t("common.cancel", "取消")}
          </Button>
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
            size="sm"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {confirmText ?? (variant === "destructive" ? t("common.delete", "删除") : t("common.confirm", "确认"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
