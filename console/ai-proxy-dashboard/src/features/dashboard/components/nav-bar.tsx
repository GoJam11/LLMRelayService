import { Globe, LaptopMinimal, MoonStar, SunMedium } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

export function NavBar({
  activePage,
  onNavigate,
  logoutPending,
  onLogout,
}: {
  activePage: "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs" | "api"
  onNavigate: (page: "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs" | "api") => void
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
  const activeTheme = themeOptions.find((option) => option.value === theme) ?? themeOptions[2]
  const ActiveThemeIcon = activeTheme.icon

  return (
    <nav className="flex flex-col gap-4 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/[0.06] shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <span className="text-sm font-bold">AI</span>
          </div>
          <Badge variant="secondary" className="shrink-0 font-semibold">Proxy</Badge>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex flex-wrap gap-0.5">
          {(["monitor", "usage", "providers", "models", "routes", "keys", "logs"] as const).map((page) => (
            <Button
              key={page}
              type="button"
              variant={activePage === page ? "default" : "ghost"}
              size="sm"
              onClick={() => onNavigate(page)}
              className={activePage === page ? "shadow-sm" : ""}
            >
              {t(`nav.${page === "monitor" ? "monitor" : page === "usage" ? "usage" : page === "providers" ? "providers" : page === "models" ? "models" : page === "routes" ? "routes" : page === "keys" ? "keys" : "logs"}`)}
            </Button>
          ))}
          <Button
            type="button"
            variant={activePage === "api" ? "default" : "ghost"}
            size="sm"
            onClick={() => onNavigate("api")}
            className={activePage === "api" ? "shadow-sm" : ""}
          >
            API
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <ActiveThemeIcon data-icon="inline-start" />
              {activeTheme.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuLabel>{t("nav.themeLabel")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {themeOptions.map((option) => {
                const Icon = option.icon

                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setTheme(option.value)}
                  >
                    <Icon />
                    {option.label}
                    {theme === option.value ? <span className="ml-auto text-muted-foreground">{t("common.current")}</span> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Globe data-icon="inline-start" />
              {currentLang === "zh" ? t("lang.zh") : t("lang.en")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            <DropdownMenuLabel>{t("lang.switch")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setLanguage("zh")}>
                中文
                {currentLang === "zh" ? <span className="ml-auto text-muted-foreground">{t("common.current")}</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage("en")}>
                English
                {currentLang === "en" ? <span className="ml-auto text-muted-foreground">{t("common.current")}</span> : null}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={logoutPending}
          onClick={onLogout}
        >
          {logoutPending ? t("nav.loggingOut") : t("nav.logout")}
        </Button>
      </div>
    </nav>
  )
}
