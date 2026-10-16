import { createContext, useState } from 'react'

export const LibraryChromeTransitionContext = createContext({ handoff: false, playerVisible: false, overviewBoundary: false, overviewVisible: false })

// Latch stationary route replacement for this library session. Outgoing pages
// must not rejoin the player projection stack after a successor finishes entering.
export function useLibraryChromeTransition(route: string | null, playerVisible: boolean) {
  const [session, setSession] = useState({ route, handoff: false, overviewBoundary: false })
  const current = session.route === route ? session : {
    route,
    handoff: route !== null && session.route !== null && route !== 'overview' && session.route !== 'overview',
    overviewBoundary: route !== null && session.route !== null && (route === 'overview' || session.route === 'overview'),
  }
  // Update during render so descendants see the new route in the same commit.
  if (current !== session) setSession(current)
  return { handoff: current.handoff, playerVisible, overviewBoundary: current.overviewBoundary, overviewVisible: route === 'overview' }
}
