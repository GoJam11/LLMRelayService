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
  activePage: "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs"
  onNavigate: (page: "monitor" | "usage" | "providers" | "models" | "routes" | "keys" | "logs") => void
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
    <nav className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="shrink-0">AI Proxy</Badge>
        <div className="flex gap-1">
          <Button
            type="button"
            variant={activePage === "monitor" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("monitor")}
          >
            {t("nav.monitor")}
          </Button>
          <Button
            type="button"
            variant={activePage === "usage" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("usage")}
          >
            {t("nav.usage")}
          </Button>
          <Button
            type="button"
            variant={activePage === "providers" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("providers")}
          >
            {t("nav.providers")}
          </Button>
          <Button
            type="button"
            variant={activePage === "models" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("models")}
          >
            {t("nav.models")}
          </Button>
          <Button
            type="button"
            variant={activePage === "routes" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("routes")}
          >
            {t("nav.routes")}
          </Button>
          <Button
            type="button"
            variant={activePage === "keys" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("keys")}
          >
            {t("nav.keys")}
          </Button>
          <Button
            type="button"
            variant={activePage === "logs" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigate("logs")}
          >
            {t("nav.logs")}
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
