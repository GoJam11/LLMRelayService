import {
  BarChart2,
  Building2,
  Code2,
  Cpu,
  Globe,
  KeyRound,
  LaptopMinimal,
  LayoutDashboard,
  LogOut,
  MoonStar,
  Network,
  ScrollText,
  SunMedium,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-provider"
import { setLanguage, getLanguage } from "@/i18n"

type Page = "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs" | "api"

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
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation()
  const currentLang = getLanguage()

  const themeOptions = [
    { value: "light" as const, label: t("nav.themeLight"), icon: SunMedium },
    { value: "dark" as const, label: t("nav.themeDark"), icon: MoonStar },
    { value: "system" as const, label: t("nav.themeSystem"), icon: LaptopMinimal },
  ]
  const activeTheme = themeOptions.find((o) => o.value === theme) ?? themeOptions[2]
  const ActiveThemeIcon = activeTheme.icon

  const navItems = [
    { page: "monitor" as const, icon: LayoutDashboard, label: t("nav.monitor") },
    { page: "usage" as const, icon: BarChart2, label: t("nav.usage") },
    { page: "providers" as const, icon: Building2, label: t("nav.providers") },
    { page: "models" as const, icon: Cpu, label: t("nav.models") },
    { page: "routes" as const, icon: Network, label: t("nav.routes") },
    { page: "keys" as const, icon: KeyRound, label: t("nav.keys") },
    { page: "logs" as const, icon: ScrollText, label: t("nav.logs") },
    { page: "api" as const, icon: Code2, label: "API" },
  ]

  const ctrlBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
          <span className="text-sm font-bold">AI</span>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-sidebar-foreground">AI Proxy</div>
          <div className="text-xs text-sidebar-foreground/50">API Gateway</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          {navItems.map(({ page, icon: Icon, label }) => (
            <button
              key={page}
              type="button"
              onClick={() => onNavigate(page)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                activePage === page
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ctrlBtn}>
                <ActiveThemeIcon className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-40">
              <DropdownMenuLabel>{t("nav.themeLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {themeOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
                      <Icon />
                      {option.label}
                      {theme === option.value && (
                        <span className="ml-auto text-muted-foreground">{t("common.current")}</span>
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ctrlBtn}>
                <Globe className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-32">
              <DropdownMenuLabel>{t("lang.switch")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setLanguage("zh")}>
                  中文
                  {currentLang === "zh" && (
                    <span className="ml-auto text-muted-foreground">{t("common.current")}</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("en")}>
                  English
                  {currentLang === "en" && (
                    <span className="ml-auto text-muted-foreground">{t("common.current")}</span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            disabled={logoutPending}
            onClick={onLogout}
            className={cn(ctrlBtn, "ml-auto")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
