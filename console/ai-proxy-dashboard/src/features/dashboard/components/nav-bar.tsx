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
    "flex h-9 w-9 items-center justify-center rounded-2xl transition-colors text-sidebar-foreground/58 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <aside className="flex h-[calc(100vh-1rem)] w-[4.75rem] shrink-0 flex-col overflow-hidden rounded-[1.5rem] border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_24px_70px_-44px_rgba(42,79,150,0.55)] backdrop-blur-xl lg:h-[calc(100vh-1.5rem)] lg:w-60 lg:rounded-[2rem]">
      {/* Logo */}
      <div className="flex h-20 items-center justify-center gap-3 px-3 lg:justify-start lg:px-5">
        <div className="c4d-logo-cube flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-400 to-violet-500 text-sidebar-primary-foreground">
          <span className="sr-only">LLMRelayService</span>
        </div>
        <div className="hidden leading-tight lg:block">
          <div className="text-base font-bold tracking-tight text-sidebar-foreground">LLMRelayService</div>
          <div className="text-xs font-medium text-sidebar-foreground/50">API Gateway</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 lg:px-4">
        <div className="space-y-1.5">
          {navItems.map(({ page, icon: Icon, label }) => (
            <button
              key={page}
              type="button"
              onClick={() => onNavigate(page)}
              className={cn(
                "flex w-full items-center justify-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition-all lg:justify-start lg:px-3.5",
                activePage === page
                  ? "bg-gradient-to-br from-blue-500 to-blue-400 text-sidebar-primary-foreground shadow-[0_14px_28px_-18px_rgba(31,96,255,0.78)]"
                  : "text-sidebar-foreground/62 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
              >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-4 mb-4 hidden lg:block">
        <div className="c4d-sidebar-figure" aria-hidden="true" />
      </div>

      {/* Bottom controls */}
      <div className="border-t border-sidebar-border bg-white/22 p-2 lg:p-3">
        <div className="flex flex-col items-center gap-1 lg:flex-row">
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
            className={cn(ctrlBtn, "lg:ml-auto")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
