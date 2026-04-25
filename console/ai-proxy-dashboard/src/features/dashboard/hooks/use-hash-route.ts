import { useSyncExternalStore } from "react"

export type PageRoute =
  | { page: "monitor" }
  | { page: "usage" }
  | { page: "providers" }
  | { page: "models" }
  | { page: "routes" }
  | { page: "keys" }
  | { page: "logs" }
  | { page: "detail"; requestId: string }

function parseHash(): PageRoute {
  const hash = window.location.hash.replace(/^#\/?/, "")
  if (hash === "monitor" || hash === "dashboard") return { page: "monitor" }
  if (hash === "usage") return { page: "usage" }
  if (hash === "logs") return { page: "logs" }
  if (hash === "providers") return { page: "providers" }
  if (hash === "models") return { page: "models" }
  if (hash === "routes") return { page: "routes" }
  if (hash === "keys") return { page: "keys" }
  if (hash.startsWith("detail/")) {
    const requestId = decodeURIComponent(hash.slice("detail/".length))
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
    } else {
      window.location.hash = `#/${target.page}`
    }
  }

  return [route, navigate]
}
