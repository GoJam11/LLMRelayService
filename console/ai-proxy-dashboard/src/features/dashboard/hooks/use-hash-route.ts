import { useSyncExternalStore } from "react"

export type RouteTab = "map" | "aliases" | "failover"

export type PageRoute =
  | { page: "monitor" }
  | { page: "usage"; client?: string }
  | { page: "providers" }
  | { page: "routes"; tab?: RouteTab }
  | { page: "models" }
  | { page: "keys" }
  | { page: "logs" }
  | { page: "settings" }
  | { page: "api" }
  | { page: "detail"; requestId: string }

function isRouteTab(value: string | null): value is RouteTab {
  return value === "map" || value === "aliases" || value === "failover"
}

function parseHash(): PageRoute {
  const hash = window.location.hash.replace(/^#\/?/, "")
  const [pageName, queryString = ""] = hash.split("?")
  const params = new URLSearchParams(queryString)
  if (pageName === "monitor" || pageName === "dashboard") return { page: "monitor" }
  if (pageName === "usage") return { page: "usage", client: params.get("client") || undefined }
  if (pageName === "logs") return { page: "logs" }
  if (pageName === "providers") return { page: "providers" }
  if (pageName === "models") return { page: "models" }
  if (pageName === "routes") {
    const tab = params.get("tab")
    // backward-compat: old "#/routes?tab=models" redirects to standalone models page
    if (tab === "models") return { page: "models" }
    return isRouteTab(tab) ? { page: "routes", tab } : { page: "routes" }
  }
  if (pageName === "keys") return { page: "keys" }
  if (pageName === "settings") return { page: "settings" }
  if (pageName === "api") return { page: "api" }
  if (pageName.startsWith("detail/")) {
    const requestId = decodeURIComponent(pageName.slice("detail/".length))
    if (requestId) return { page: "detail", requestId }
  }
  return { page: "monitor" }
}

// Cache the snapshot so useSyncExternalStore gets a stable reference
let cachedHash = ""
let cachedRoute: PageRoute = { page: "monitor" }

function getSnapshot(): PageRoute {
  const currentHash = window.location.hash
  if (currentHash !== cachedHash) {
    cachedHash = currentHash
    cachedRoute = parseHash()
  }
  return cachedRoute
}

function getServerSnapshot(): PageRoute {
  return { page: "monitor" }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback)
  return () => window.removeEventListener("hashchange", callback)
}

export function useHashRoute(): [PageRoute, (route: PageRoute) => void] {
  const route = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const navigate = (target: PageRoute) => {
    if (target.page === "detail") {
      window.location.hash = `#/detail/${encodeURIComponent(target.requestId)}`
    } else if (target.page === "usage" && target.client) {
      window.location.hash = `#/usage?client=${encodeURIComponent(target.client)}`
    } else if (target.page === "routes" && target.tab) {
      window.location.hash = `#/routes?tab=${encodeURIComponent(target.tab)}`
    } else {
      window.location.hash = `#/${target.page}`
    }
  }

  return [route, navigate]
}
