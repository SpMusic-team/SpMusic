import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useIsPresent, type MotionValue } from 'motion/react'

export type LibraryDockBinding = {
  searchOpen: boolean
  onSearchToggle?: () => void
  controllerOffsetY?: MotionValue<number>
  controllerHidden?: boolean
}

export const LibraryDockContext = createContext<{
  dockRef: RefObject<HTMLElement | null>
  activeRouteKey: string | null
  publish: (owner: symbol, routeKey: string, binding: LibraryDockBinding) => () => void
} | null>(null)

// Bind local page controls to the one session-owned dock. Retiring pages must
// neither publish controls nor clear a successor's registration.
export function useLibraryDockBinding(routeKey: string, binding: LibraryDockBinding) {
  const context = useContext(LibraryDockContext)
  const isPresent = useIsPresent()
  const owner = useRef(Symbol('library-dock-page'))
  const action = useRef(binding.onSearchToggle)
  useLayoutEffect(() => { action.current = binding.onSearchToggle })
  const toggleSearch = useCallback(() => action.current?.(), [])
  const hasSearch = Boolean(binding.onSearchToggle)
  const stableBinding = useMemo(() => ({
    searchOpen: binding.searchOpen,
    onSearchToggle: hasSearch ? toggleSearch : undefined,
    controllerOffsetY: binding.controllerOffsetY,
    controllerHidden: binding.controllerHidden,
  }), [binding.searchOpen, hasSearch, binding.controllerOffsetY, binding.controllerHidden, toggleSearch])
  const publish = context?.publish
  const active = isPresent && context?.activeRouteKey === routeKey
  useLayoutEffect(() => {
    if (!active || !publish) return
    return publish(owner.current, routeKey, stableBinding)
  }, [active, publish, routeKey, stableBinding])
  return context
}
