import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { CheckCircle2, Info, X, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

type ToastVariant = "default" | "success" | "error"

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
  duration: number
}

type ToastOptions = {
  variant?: ToastVariant
  duration?: number
}

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return toasts
}

function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id)
  emit()
}

function push(message: string, options: ToastOptions = {}) {
  const id = nextId++
  const item: ToastItem = {
    id,
    message,
    variant: options.variant ?? "default",
    duration: options.duration ?? 3000,
  }
  // Keep at most a few visible at once.
  toasts = [...toasts, item].slice(-4)
  emit()
  return id
}

type ToastFn = ((message: string, options?: ToastOptions) => number) & {
  success: (message: string, options?: ToastOptions) => number
  error: (message: string, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

export const toast: ToastFn = Object.assign(
  (message: string, options?: ToastOptions) => push(message, options),
  {
    success: (message: string, options?: ToastOptions) =>
      push(message, { ...options, variant: "success" }),
    error: (message: string, options?: ToastOptions) =>
      push(message, { ...options, variant: "error" }),
    dismiss,
  }
)

const variantStyles: Record<ToastVariant, { icon: typeof Info; className: string; iconClassName: string }> = {
  default: {
    icon: Info,
    className: "border-border bg-popover text-popover-foreground",
    iconClassName: "text-muted-foreground",
  },
  success: {
    icon: CheckCircle2,
    className: "border-border bg-popover text-popover-foreground",
    iconClassName: "text-primary",
  },
  error: {
    icon: XCircle,
    className: "border-destructive/30 bg-popover text-popover-foreground",
    iconClassName: "text-destructive",
  },
}

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), item.duration)
    return () => window.clearTimeout(timer)
  }, [item.id, item.duration])

  const { icon: Icon, className, iconClassName } = variantStyles[item.variant]

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-[320px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs shadow-lg",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        className
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", iconClassName)} />
      <span className="flex-1 leading-relaxed">{item.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="-mr-1 -mt-0.5 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body
  )
}
