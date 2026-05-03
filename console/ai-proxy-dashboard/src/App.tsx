import { useCallback, useEffect, useState } from "react"

import { fetchSession, login, logout } from "@/features/dashboard/api"
import { DashboardPage } from "@/features/dashboard/components/dashboard-page"
import { DetailPage } from "@/features/dashboard/components/detail-page"
import { ApiDocsPage } from "@/features/dashboard/components/api-docs-page"
import { KeysPage } from "@/features/dashboard/components/keys-page"
import { LogsPage } from "@/features/dashboard/components/logs-page"
import { ModelsPage } from "@/features/dashboard/components/models-page"
import { NavBar } from "@/features/dashboard/components/nav-bar"
import { ProvidersPage } from "@/features/dashboard/components/providers-page"
import { RoutesPage } from "@/features/dashboard/components/routes-page"
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

  const activePage = route.page === "detail" ? "logs" : route.page

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
          />
        )
      case "providers":
        return (
          <ProvidersPage
            onUnauthorized={handleUnauthorized}
          />
        )
      case "models":
        return (
          <ModelsPage
            onUnauthorized={handleUnauthorized}
          />
        )
      case "routes":
        return (
          <RoutesPage
            onUnauthorized={handleUnauthorized}
          />
        )
      case "keys":
        return (
          <KeysPage
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
        return (
          <LogsPage
            onUnauthorized={handleUnauthorized}
            onSelectDetail={(requestId) => navigate({ page: "detail", requestId })}
          />
        )
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-430 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <NavBar
          activePage={activePage}
          onNavigate={(page) => navigate({ page })}
          logoutPending={logoutPending}
          onLogout={handleLogout}
        />

        {renderPage()}
      </div>
    </main>
  )
}

export default App
