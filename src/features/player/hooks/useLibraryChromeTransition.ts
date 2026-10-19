import { createContext, useCallback, useRef, useState, type RefObject } from 'react'

export type LibraryNavigationGeometry = {
  items: Map<string, DOMRect>
}
export const LibraryChromeTransitionContext = createContext<{
  handoff: boolean; playerVisible: boolean; overviewBoundary: boolean; overviewVisible: boolean
  categoryId: string | null
  geometry: RefObject<LibraryNavigationGeometry> | null
  publishDetailVisibility?: (routeKey: string, offscreen: boolean) => void
  offscreenReturn: boolean
}>({ handoff: false, playerVisible: false, overviewBoundary: false, overviewVisible: false, categoryId: null, geometry: null, offscreenReturn: false })

// Latch stationary route replacement for this library session. Outgoing pages
// must not rejoin the player projection stack after a successor finishes entering.
export function useLibraryChromeTransition(route: string | null, playerVisible: boolean) {
  const geometry = useRef<LibraryNavigationGeometry>({ items: new Map() })
  const [detailVisibility, setDetailVisibility] = useState<{ routeKey: string; offscreen: boolean } | null>(null)
  const publishDetailVisibility = useCallback((routeKey: string, offscreen: boolean) => {
    setDetailVisibility((previous) => previous?.routeKey === routeKey && previous.offscreen === offscreen
      ? previous : { routeKey, offscreen })
  }, [])
  const [session, setSession] = useState({ route, handoff: false, overviewBoundary: false, categoryId: route?.startsWith('category:') ? route.slice(9) : null, offscreenReturn: false })
  const current = session.route === route ? session : {
    route,
    handoff: route !== null && session.route !== null && route !== 'overview' && session.route !== 'overview',
    overviewBoundary: route !== null && session.route !== null && (route === 'overview' || session.route === 'overview'),
    categoryId: route?.startsWith('category:') ? route.slice(9) : session.categoryId,
    // Consume a scope-owned snapshot only at a detail -> category boundary.
    // Keep it for this route, including StrictMode's repeated render.
    offscreenReturn: Boolean(session.route?.startsWith('tracks:') && route?.startsWith('category:')
      && detailVisibility?.routeKey === session.route && detailVisibility.offscreen),
  }
  // Update during render so descendants see the new route in the same commit.
  if (current !== session) setSession(current)
  return { handoff: current.handoff, playerVisible, overviewBoundary: current.overviewBoundary, overviewVisible: route === 'overview', categoryId: current.categoryId, geometry, publishDetailVisibility, offscreenReturn: current.offscreenReturn }
}
