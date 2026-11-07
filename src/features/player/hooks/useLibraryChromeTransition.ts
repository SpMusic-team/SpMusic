import { createContext, useCallback, useMemo, useRef, useState, type RefObject } from 'react'

export type LibraryNavigationGeometry = {
  items: Map<string, DOMRect>
}
type SidebarScrollMode = 'desktop' | 'overlay'
type CategoryScrollStore = {
  read: (mode: SidebarScrollMode) => number
  write: (mode: SidebarScrollMode, top: number) => void
}
export const LibraryChromeTransitionContext = createContext<{
  handoff: boolean; playerVisible: boolean; overviewBoundary: boolean; overviewVisible: boolean
  categoryId: string | null
  geometry: RefObject<LibraryNavigationGeometry> | null
  categoryScroll: CategoryScrollStore | null
  publishDetailVisibility?: (routeKey: string, offscreen: boolean) => void
  offscreenReturn: boolean
}>({ handoff: false, playerVisible: false, overviewBoundary: false, overviewVisible: false, categoryId: null, geometry: null, categoryScroll: null, offscreenReturn: false })

// Latch stationary route replacement for this library session. Outgoing pages
// must not rejoin the player projection stack after a successor finishes entering.
export function useLibraryChromeTransition(route: string | null, playerVisible: boolean, parentRouteKey?: string | null) {
  const geometry = useRef<LibraryNavigationGeometry>({ items: new Map() })
  const categoryScrollPositions = useRef({ desktop: 0, overlay: 0 })
  const categoryScroll = useMemo<CategoryScrollStore>(() => ({
    read: mode => categoryScrollPositions.current[mode],
    write: (mode, top) => { categoryScrollPositions.current[mode] = top },
  }), [])
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
    offscreenReturn: Boolean(session.route?.startsWith('tracks:') && (parentRouteKey !== undefined ? route === parentRouteKey : route?.startsWith('category:'))
      && detailVisibility?.routeKey === session.route && detailVisibility.offscreen),
  }
  // Update during render so descendants see the new route in the same commit.
  if (current !== session) setSession(current)
  return { handoff: current.handoff, playerVisible, overviewBoundary: current.overviewBoundary, overviewVisible: route === 'overview', categoryId: current.categoryId, geometry, categoryScroll, publishDetailVisibility, offscreenReturn: current.offscreenReturn }
}
