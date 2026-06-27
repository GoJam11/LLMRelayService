import { Code2, LogOut, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

type Page = "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs" | "settings" | "api"

const PAGE_SUBTITLE: Record<Page, string> = {
  monitor: "实时流量概览",
  usage: "用量",
  logs: "请求日志",
  providers: "渠道管理",
  models: "模型",
  keys: "密钥管理",
  routes: "路由",
  settings: "配置",
  api: "API 文档",
}

export function NavBar({
  activePage,
  onNavigate,
  logoutPending,
  onLogout,
}: {
  activePage: Page
  onNavigate: (page: Page) => void
  logoutPending: boolean
  onLogout: () => void
}) {
  const { t } = useTranslation()

  // Primary horizontal nav — design order: 监控 用量 日志 渠道 模型 密钥 路由
  const navItems: { page: Page; label: string }[] = [
    { page: "monitor", label: t("nav.monitor") },
    { page: "usage", label: t("nav.usage") },
    { page: "logs", label: t("nav.logs") },
    { page: "providers", label: t("nav.providers") },
    { page: "models", label: t("nav.models") },
    { page: "keys", label: t("nav.keys") },
    { page: "routes", label: t("nav.routes") },
  ]

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-[9px] border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 lg:px-8">
      {/* Brand */}
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          onClick={() => onNavigate("monitor")}
          className="flex items-center"
        >
          <span className="text-[17px] font-extrabold tracking-[0.04em] text-foreground">LRS</span>
        </button>
        <span className="hidden text-[13px] text-muted-foreground sm:inline">
          {PAGE_SUBTITLE[activePage]}
        </span>
      </div>

      {/* Primary nav */}
      <nav className="hidden flex-1 items-center justify-center gap-5 text-[13px] md:flex lg:gap-6">
        {navItems.map(({ page, label }) => (
          <button
            key={page}
            type="button"
            onClick={() => onNavigate(page)}
            className={cn(
              "transition-colors",
              activePage === page
                ? "font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-2.5">
        <div className="hidden items-center gap-1.5 text-[12px] font-semibold text-primary lg:flex">
          <span className="lrs-pulse h-[7px] w-[7px] rounded-full bg-primary" />
          {t("nav.live")}
        </div>

        <button
          type="button"
          onClick={() => onNavigate("api")}
          className={cn(iconBtn, activePage === "api" && "border-primary bg-primary text-primary-foreground")}
          title="API"
        >
          <Code2 className="h-[15px] w-[15px]" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate("settings")}
          className={cn(iconBtn, activePage === "settings" && "border-primary bg-primary text-primary-foreground")}
          title={t("nav.settings")}
        >
          <Settings className="h-[15px] w-[15px]" />
        </button>

        <button type="button" disabled={logoutPending} onClick={onLogout} className={iconBtn} title={t("nav.logout")}>
          <LogOut className="h-[15px] w-[15px]" />
        </button>
      </div>
    </header>
  )
}
