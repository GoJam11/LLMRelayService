import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

interface PageHeaderProps {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ icon: Icon, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
