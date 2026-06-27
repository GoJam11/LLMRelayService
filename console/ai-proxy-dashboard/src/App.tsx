import { useCallback, useEffect, useState } from "react"

import { fetchSession, login, logout } from "@/features/dashboard/api"
import { DashboardPage } from "@/features/dashboard/components/dashboard-page"
import { DetailPage } from "@/features/dashboard/components/detail-page"
import { ApiDocsPage } from "@/features/dashboard/components/api-docs-page"
import { KeysPage } from "@/features/dashboard/components/keys-page"
import { LogsPage } from "@/features/dashboard/components/logs-page"
import { NavBar } from "@/features/dashboard/components/nav-bar"
import { ProvidersPage } from "@/features/dashboard/components/providers-page"
import { ModelsPage } from "@/features/dashboard/components/models-page"
import { RoutesPage } from "@/features/dashboard/components/routes-page"
import { SettingsPage } from "@/features/dashboard/components/settings-page"
import { UsagePage } from "@/features/dashboard/components/usage-page"
import {
  DisabledView,
  LoadingView,
  LoginView,
  SessionErrorView,
} from "@/features/dashboard/components/session-shell"
import { useHashRoute } from "@/features/dashboard/hooks/use-hash-route"
import type { ConsoleSession } from "@/features/dashboard/types"

export function App() {
  const [session, setSession] = useState<ConsoleSession | null>(null)
  const [sessionError, setSessionError] = useState("")
  const [logoutPending, setLogoutPending] = useState(false)
  const [route, navigate] = useHashRoute()

  const loadSession = useCallback(async () => {
    try {
      const nextSession = await fetchSession()
      setSession(nextSession)
      setSessionError("")
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const handleUnauthorized = useCallback(() => {
    setSession((current) => ({
      enabled: current?.enabled ?? true,
      authenticated: false,
    }))
  }, [])

  const handleLogin = useCallback(async (password: string) => {
    await login(password)
    setSession({ enabled: true, authenticated: true })
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      setLogoutPending(true)
      await logout()
      setSession((current) => ({
        enabled: current?.enabled ?? true,
        authenticated: false,
      }))
    } finally {
      setLogoutPending(false)
    }
  }, [])

  if (sessionError) {
    return <SessionErrorView description={sessionError} />
  }

  if (session === null) {
    return <LoadingView />
  }

  if (!session.enabled) {
    return <DisabledView />
  }

  if (!session.authenticated) {
    return <LoginView onLogin={handleLogin} />
  }

  const activePage = route.page === "detail" ? "logs" : route.page === "models" ? "models" : route.page

  function renderPage() {
    switch (route.page) {
      case "monitor":
        return (
          <DashboardPage
            onUnauthorized={handleUnauthorized}
            onNavigateToLogs={() => navigate({ page: "logs" })}
          />
        )
      case "usage":
        return (
          <UsagePage
            onUnauthorized={handleUnauthorized}
            onNavigateToLogs={() => navigate({ page: "logs" })}
            initialClientFilter={route.client}
          />
        )
      case "providers":
        return (
          <ProvidersPage
            onUnauthorized={handleUnauthorized}
          />
        )
      case "models":
        return <ModelsPage onUnauthorized={handleUnauthorized} />
      case "routes":
        return (
          <RoutesPage
            activeTab={route.page === "routes" ? route.tab : undefined}
            onTabChange={(tab) => navigate({ page: "routes", tab })}
            onUnauthorized={handleUnauthorized}
          />
        )
      case "keys":
        return (
          <KeysPage
            onUnauthorized={handleUnauthorized}
            onViewUsage={(client) => navigate({ page: "usage", client })}
          />
        )
      case "settings":
        return (
          <SettingsPage
            onUnauthorized={handleUnauthorized}
          />
        )
      case "detail":
        return (
          <DetailPage
            requestId={route.requestId}
            onUnauthorized={handleUnauthorized}
            onBack={() => navigate({ page: "logs" })}
          />
        )
      case "api":
        return <ApiDocsPage />
      case "logs":
      default:
        return <LogsPage onUnauthorized={handleUnauthorized} />

    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-card text-foreground">
      <NavBar
        activePage={activePage}
        onNavigate={(page) => navigate({ page })}
        logoutPending={logoutPending}
        onLogout={handleLogout}
      />
      <main className={`flex-1 ${activePage === "logs" ? "overflow-hidden" : "overflow-y-auto"}`}>
        <div
          className={`mx-auto flex ${activePage === "logs" ? "h-full" : "min-h-[calc(100vh-4.25rem)]"} max-w-[1540px] flex-col ${
            activePage === "monitor" ? "" : "px-5 py-5 lg:px-8 lg:py-7"
          }`}
        >
          {renderPage()}
        </div>
      </main>
    </div>
  )
}

export default App
