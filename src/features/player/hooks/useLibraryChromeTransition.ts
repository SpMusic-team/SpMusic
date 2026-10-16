import { createContext, useRef, useState, type RefObject } from 'react'

export type LibraryNavigationGeometry = {
  items: Map<string, DOMRect>
}
export const LibraryChromeTransitionContext = createContext<{
  handoff: boolean; playerVisible: boolean; overviewBoundary: boolean; overviewVisible: boolean
  categoryId: string | null
  geometry: RefObject<LibraryNavigationGeometry> | null
}>({ handoff: false, playerVisible: false, overviewBoundary: false, overviewVisible: false, categoryId: null, geometry: null })

// Latch stationary route replacement for this library session. Outgoing pages
// must not rejoin the player projection stack after a successor finishes entering.
export function useLibraryChromeTransition(route: string | null, playerVisible: boolean) {
  const geometry = useRef<LibraryNavigationGeometry>({ items: new Map() })
  const [session, setSession] = useState({ route, handoff: false, overviewBoundary: false, categoryId: route?.startsWith('category:') ? route.slice(9) : null })
  const current = session.route === route ? session : {
    route,
    handoff: route !== null && session.route !== null && route !== 'overview' && session.route !== 'overview',
    overviewBoundary: route !== null && session.route !== null && (route === 'overview' || session.route === 'overview'),
    categoryId: route?.startsWith('category:') ? route.slice(9) : session.categoryId,
  }
  // Update during render so descendants see the new route in the same commit.
  if (current !== session) setSession(current)
  return { handoff: current.handoff, playerVisible, overviewBoundary: current.overviewBoundary, overviewVisible: route === 'overview', categoryId: current.categoryId, geometry }
}
