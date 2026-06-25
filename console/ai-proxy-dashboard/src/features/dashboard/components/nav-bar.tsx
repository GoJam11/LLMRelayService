import {
  BarChart2,
  Building2,
  Code2,
  Cpu,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MoonStar,
  Network,
  ScrollText,
  Settings2,
  SunMedium,
  LaptopMinimal,
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

type Page = "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs" | "settings" | "api"

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
    { page: "logs" as const, icon: ScrollText, label: t("nav.logs") },
    { page: "providers" as const, icon: Building2, label: t("nav.providers") },
    { page: "models" as const, icon: Cpu, label: t("nav.models") },
    { page: "keys" as const, icon: KeyRound, label: t("nav.keys") },
    { page: "routes" as const, icon: Network, label: t("nav.routes") },
    { page: "settings" as const, icon: Settings2, label: t("nav.settings") },
    { page: "api" as const, icon: Code2, label: "API" },
  ]

  const ctrlBtn =
    "flex h-9 w-9 items-center justify-center rounded-xl transition-colors text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 rounded-[1.25rem] border border-sidebar-border bg-sidebar px-3 text-sidebar-foreground shadow-[0_18px_50px_-40px_rgba(15,154,166,0.5)] backdrop-blur-xl lg:h-16 lg:gap-4 lg:px-5">
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="c4d-logo-cube flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#14b3bf] via-[#0f9aa6] to-[#0c7c86] text-sidebar-primary-foreground">
          <span className="text-sm font-extrabold tracking-[0.04em]">L</span>
        </div>
        <span className="hidden text-base font-extrabold tracking-[0.04em] sm:inline">LRS</span>
      </div>

      {/* Navigation */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(({ page, icon: Icon, label }) => (
          <button
            key={page}
            type="button"
            onClick={() => onNavigate(page)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all",
              activePage === page
                ? "bg-gradient-to-br from-[#0f9aa6] to-[#14b3bf] text-sidebar-primary-foreground shadow-[0_12px_24px_-16px_rgba(15,154,166,0.8)]"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon className="h-[17px] w-[17px] shrink-0" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </nav>

      {/* Live + controls */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 hidden items-center gap-1.5 text-xs font-semibold text-primary md:flex">
          <span className="lrs-pulse h-[7px] w-[7px] rounded-full bg-primary" />
          {t("nav.live")}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ctrlBtn}>
              <ActiveThemeIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="min-w-40">
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
          <DropdownMenuContent side="bottom" align="end" className="min-w-32">
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
          className={ctrlBtn}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
