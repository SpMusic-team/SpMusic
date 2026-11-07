import { useLayoutEffect, useMemo, type RefObject } from 'react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { usePlaylistOverscroll } from './usePlaylistOverscroll'
import { usePlaylistControllerMotion } from './usePlaylistControllerMotion'
import type { PlaylistControllerMode } from '../model/playlistControllerMode'

type VisibilityOptions = {
  panelRef: RefObject<HTMLElement | null>
  artworkRef: RefObject<HTMLDivElement | null>
  actionsRef: RefObject<HTMLDivElement | null>
  compactActionsRef: RefObject<HTMLDivElement | null>
  visibilityKey: string
  routeKey: string
  present: boolean
  heroOffscreen: boolean
  onHeroOffscreen: (offscreen: boolean) => void
  onActionsPassed: (passed: boolean) => void
  publishDetailVisibility?: (routeKey: string, offscreen: boolean) => void
}

type MotionOptions = {
  panelRef: RefObject<HTMLElement | null>
  dockRef: RefObject<HTMLElement | null>
  mode: PlaylistControllerMode
  seeking: boolean
  layoutKey: string
  controllerEnabled: boolean
  actionsPassed: boolean
  rowSelector?: string
}

export function useCollectionHeroMotion({ panelRef, dockRef, mode, seeking, layoutKey,
  controllerEnabled, actionsPassed, rowSelector }: MotionOptions) {
  const appearance = useAppearanceMotion()
  const returnTransition = useMemo(() => ({ ...appearance.layoutTransition,
    duration: Math.min((appearance.layoutTransition.duration ?? 0) * (5 / 6), 0.55) }), [appearance.layoutTransition])
  usePlaylistOverscroll(panelRef, appearance.disabled, layoutKey, { rowSelector })
  const controllerMotion = usePlaylistControllerMotion(panelRef, dockRef, mode, seeking, layoutKey,
    actionsPassed, appearance.layoutTransition, controllerEnabled)
  return { controllerMotion, returnTransition }
}

// Call after the page's scroll-positioning layout effects, before paint.
export function useCollectionHeroVisibility({ panelRef, artworkRef, actionsRef, compactActionsRef,
  visibilityKey, routeKey, present, heroOffscreen, onHeroOffscreen, onActionsPassed,
  publishDetailVisibility }: VisibilityOptions) {
  useLayoutEffect(() => {
    const panel = panelRef.current, heroActions = actionsRef.current, heroArtwork = artworkRef.current
    if (!panel || !heroActions || !heroArtwork || !present) return
    let disposed = false
    const measureVisibility = () => {
      if (disposed) return
      const heroRect = heroActions.getBoundingClientRect(), panelRect = panel.getBoundingClientRect()
      const offscreen = heroArtwork.getBoundingClientRect().bottom <= Math.max(0, panelRect.top + panel.clientTop)
      onHeroOffscreen(offscreen)
      publishDetailVisibility?.(routeKey, offscreen)
      const visible = heroRect.height > 0 && heroRect.bottom <= Math.max(0, panelRect.top)
      if (!visible) {
        const compact = compactActionsRef.current, focused = document.activeElement
        if (compact && focused instanceof HTMLElement && compact.contains(focused)) {
          const index = [...compact.querySelectorAll('button')].indexOf(focused as HTMLButtonElement)
          const target = index > 0 ? heroActions.querySelectorAll('button')[index - 1] : null
          if (target && !target.disabled) target.focus({ preventScroll: true })
          else panel.focus({ preventScroll: true })
        }
      }
      onActionsPassed(visible)
    }
    measureVisibility()
    const observer = new IntersectionObserver(measureVisibility, { root: panel, threshold: 0 })
    observer.observe(heroActions); observer.observe(heroArtwork)
    const resizeObserver = new ResizeObserver(measureVisibility)
    resizeObserver.observe(panel); resizeObserver.observe(heroActions)
    window.addEventListener('resize', measureVisibility)
    return () => { disposed = true; observer.disconnect(); resizeObserver.disconnect(); window.removeEventListener('resize', measureVisibility) }
  }, [panelRef, artworkRef, actionsRef, compactActionsRef, present, heroOffscreen, visibilityKey,
    onHeroOffscreen, onActionsPassed, publishDetailVisibility, routeKey])
}
