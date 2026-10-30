import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'

export type CollectionLayoutSnapshot = Readonly<{ cover: DOMRect | null; copy: DOMRect }>
export type CollectionLayoutSelectors = Readonly<{
  item: string
  cover: string
  copy: string
  getId: (element: HTMLElement) => string | undefined
}>
type Options<Layout extends { label: string }> = {
  panelRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  layouts: readonly Layout[]
  storageKey: string
  defaultLevel: () => number
  selectors: CollectionLayoutSelectors
  gestureArea?: 'grid' | 'panel'
  announce: (layout: Layout) => string
  onBeforeTransition?: (snapshot: ReadonlyMap<string, CollectionLayoutSnapshot> | null, grid: HTMLElement) => void
  onSettled?: () => void
}
const PLAYLIST_WHEEL_THRESHOLD = 28
const PLAYLIST_WHEEL_STEP_LOCK_MS = 150
const PLAYLIST_TRACKPAD_IDLE_MS = 350
const PLAYLIST_PINCH_MIN_DISTANCE = 24
const PLAYLIST_PINCH_DISTANCE_RATIO = 0.12

function readLayoutLevel(storageKey: string, count: number, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null || !/^(0|[1-9]\d*)$/.test(stored)) return fallback
    const level = Number(stored)
    return Number.isSafeInteger(level) && level < count ? level : fallback
  } catch { return fallback }
}

function snapshotCardLayout(grid: HTMLElement, panel: HTMLElement, selectors: CollectionLayoutSelectors): Map<string, CollectionLayoutSnapshot> {
  const bounds = panel.getBoundingClientRect()
  const snapshots = new Map<string, CollectionLayoutSnapshot>()
  for (const card of grid.querySelectorAll<HTMLElement>(selectors.item)) {
    const cardBounds = card.getBoundingClientRect()
    if (cardBounds.bottom < bounds.top - bounds.height * 2 || cardBounds.top > bounds.bottom + bounds.height * 2) continue
    const trackId = selectors.getId(card)
    const copy = card.querySelector<HTMLElement>(selectors.copy)
    const cover = card.querySelector<HTMLElement>(selectors.cover)
    if (!trackId || !copy) continue
    snapshots.set(trackId, {
      cover: cover && getComputedStyle(cover).display !== 'none' ? cover.getBoundingClientRect() : null,
      copy: copy.getBoundingClientRect(),
    })
  }
  return snapshots
}

function animateLayoutPart(element: HTMLElement, from: DOMRect, to: DOMRect, duration: number, easing: string, kind: 'cover' | 'copy'): Animation | null {
  if (to.width <= 0 || to.height <= 0 || from.width <= 0 || from.height <= 0) return null
  const x = from.left - to.left
  const y = from.top - to.top
  // Text adopts the final typography immediately; only its position animates.
  // Resizing a copy box is not a valid glyph transform.
  const scaleX = kind === 'cover' ? from.width / to.width : 1
  const scaleY = kind === 'cover' ? from.height / to.height : 1
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(scaleX - 1) < 0.005 && Math.abs(scaleY - 1) < 0.005) return null
  return element.animate([
    { transform: kind === 'cover' ? `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` : `translate(${x}px, ${y}px)`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], { duration, easing, fill: 'both' })
}

export function useCollectionLayout<Layout extends { label: string }>(options: Options<Layout>) {
  const { panelRef, gridRef, layouts, storageKey, defaultLevel, selectors, gestureArea = 'grid' } = options
  const appearanceMotion = useAppearanceMotion()
  const callbacksRef = useRef(options)
  useLayoutEffect(() => { callbacksRef.current = options })
  const [level, setLevel] = useState(() => readLayoutLevel(storageKey, layouts.length, defaultLevel()))
  const [announcement, setAnnouncement] = useState('')
  const layoutLevelRef = useRef(level)
  const wheelAccumulatedDeltaRef = useRef(0)
  const wheelLastAtRef = useRef(0)
  const wheelLockedUntilRef = useRef(0)
  const pendingLayoutSnapshotRef = useRef<Map<string, CollectionLayoutSnapshot> | null>(null)
  const activeLayoutAnimationsRef = useRef<Set<Animation>>(new Set())
  const layoutTransitionGenerationRef = useRef(0)
  const stopLayoutAnimations = useCallback(() => {
    for (const animation of activeLayoutAnimationsRef.current) animation.cancel()
    activeLayoutAnimationsRef.current.clear()
  }, [])
  useLayoutEffect(() => {
    const snapshots = pendingLayoutSnapshotRef.current
    pendingLayoutSnapshotRef.current = null
    const grid = gridRef.current
    if (!snapshots || !grid || appearanceMotion.disabled) return
    const duration = Number(appearanceMotion.layoutTransition.duration ?? 0) * 1000
    if (duration <= 0) { callbacksRef.current.onSettled?.(); return }
    const ease = appearanceMotion.layoutTransition.ease
    const easing = Array.isArray(ease) && ease.length === 4 ? `cubic-bezier(${ease.join(', ')})` : typeof ease === 'string' ? ease : 'ease-out'
    const generation = layoutTransitionGenerationRef.current
    const animations: Animation[] = []
    const parts: { element: HTMLElement; from: DOMRect; to: DOMRect; kind: 'cover' | 'copy' }[] = []
    // Batch all destination reads before animate() installs any transforms.
    for (const card of grid.querySelectorAll<HTMLElement>(selectors.item)) {
      const snapshot = snapshots.get(selectors.getId(card) ?? '')
      if (!snapshot) continue
      for (const [selector, from, kind] of [[selectors.cover, snapshot.cover, 'cover'], [selectors.copy, snapshot.copy, 'copy']] as const) {
        if (!from) continue
        const element = card.querySelector<HTMLElement>(selector)
        if (!element || getComputedStyle(element).display === 'none') continue
        parts.push({ element, from, to: element.getBoundingClientRect(), kind })
      }
    }
    for (const { element, from, to, kind } of parts) {
      const animation = animateLayoutPart(element, from, to, duration, easing, kind)
      if (!animation) continue
      animations.push(animation)
      activeLayoutAnimationsRef.current.add(animation)
      animation.onfinish = () => { activeLayoutAnimationsRef.current.delete(animation); animation.cancel() }
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (generation === layoutTransitionGenerationRef.current) callbacksRef.current.onSettled?.()
    })
  }, [level, appearanceMotion, gridRef, selectors])
  useEffect(() => () => {
    layoutTransitionGenerationRef.current += 1
    stopLayoutAnimations()
  }, [stopLayoutAnimations])
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const acceptsTarget = (target: EventTarget | null) => {
      const area = gestureArea === 'panel' ? panel : gridRef.current
      if (!area || !(target instanceof Node) || !area.contains(target)) return false
      const handleTarget = target instanceof Element ? target : target.parentElement
      if (handleTarget?.closest('[data-reorder-handle]')) return false
      // Preserve the existing detail-grid boundary and input behavior.
      if (gestureArea === 'grid') return true
      const element = target instanceof Element ? target : target.parentElement
      if (!element || element.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], .playlist-library-sidebar, .playlist-playback-dock, [inert]')) return false
      return !(element instanceof HTMLElement && element.isContentEditable)
        && !element.closest<HTMLElement>('[contenteditable]')?.isContentEditable
    }
    const changeLayout = (direction: -1 | 1, now: number) => {
      const grid = gridRef.current
      if ((gestureArea === 'grid' && !grid) || now < wheelLockedUntilRef.current) return
      const currentLevel = layoutLevelRef.current
      const nextLevel = Math.max(0, Math.min(layouts.length - 1, currentLevel + direction))
      if (nextLevel === currentLevel) return
      const nextLayout = layouts[nextLevel]
      if (!nextLayout) return
      // Capture painted geometry before cancelling interrupted animations.
      const snapshot = !grid || appearanceMotion.disabled ? null : snapshotCardLayout(grid, panel, selectors)
      pendingLayoutSnapshotRef.current = snapshot
      if (grid) callbacksRef.current.onBeforeTransition?.(snapshot, grid)
      layoutTransitionGenerationRef.current += 1
      stopLayoutAnimations()
      wheelLockedUntilRef.current = now + PLAYLIST_WHEEL_STEP_LOCK_MS
      layoutLevelRef.current = nextLevel
      setLevel(nextLevel)
      try { window.localStorage.setItem(storageKey, String(nextLevel)) } catch { /* Blocked storage must not block the view. */ }
      setAnnouncement(callbacksRef.current.announce(nextLayout))
    }
    const pressedControlKeys = new Set<string>()
    let wheelInput: 'control' | 'trackpad' | null = null
    let trackpadLastAt = -Infinity
    let trackpadConsumed = false
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') pressedControlKeys.add(event.code || event.key)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') pressedControlKeys.delete(event.code || event.key)
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !acceptsTarget(event.target)) return
      event.preventDefault()
      const now = performance.now()
      // Chromium emits ctrlKey wheel for a trackpad pinch without pressing Ctrl.
      const nextInput = pressedControlKeys.size > 0 ? 'control' : 'trackpad'
      if (wheelInput !== nextInput) wheelAccumulatedDeltaRef.current = 0
      wheelInput = nextInput
      if (nextInput === 'trackpad') {
        if (now - trackpadLastAt > PLAYLIST_TRACKPAD_IDLE_MS) {
          trackpadConsumed = false
          wheelAccumulatedDeltaRef.current = 0
        }
        // Refresh even after consumption or during the layout step lock. A long
        // stream remains one gesture regardless of its duration or direction.
        trackpadLastAt = now
        if (trackpadConsumed) return
      }
      if (now < wheelLockedUntilRef.current) return
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? panel.clientHeight : 1
      const delta = event.deltaY * multiplier
      if (
        now - wheelLastAtRef.current > 250
        || Math.sign(delta) !== Math.sign(wheelAccumulatedDeltaRef.current)
      ) wheelAccumulatedDeltaRef.current = 0
      wheelLastAtRef.current = now
      wheelAccumulatedDeltaRef.current += delta
      if (Math.abs(wheelAccumulatedDeltaRef.current) < PLAYLIST_WHEEL_THRESHOLD) return

      const direction = wheelAccumulatedDeltaRef.current < 0 ? -1 : 1
      wheelAccumulatedDeltaRef.current = 0
      if (nextInput === 'trackpad') trackpadConsumed = true
      changeLayout(direction, now)
    }

    let pinch: { identifiers: readonly number[]; distance: number } | null = null
    let touchBlocked = false
    const touchDistance = (first: Touch, second: Touch) => Math.hypot(
      second.clientX - first.clientX, second.clientY - first.clientY,
    )
    const insidePanel = (touch: Touch) => {
      const bounds = panel.getBoundingClientRect()
      return touch.clientX >= bounds.left && touch.clientX <= bounds.right
        && touch.clientY >= bounds.top && touch.clientY <= bounds.bottom
    }
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 2) {
        pinch = null
        touchBlocked = true
        return
      }
      if (touchBlocked || event.touches.length !== 2) return
      const [first, second] = Array.from(event.touches)
      if (![first!, second!].every((touch) => acceptsTarget(touch.target) && insidePanel(touch))) return
      // Reserve only the two-finger gesture; one-finger scrolling stays native.
      if (event.cancelable) event.preventDefault()
      pinch = { identifiers: [first!.identifier, second!.identifier], distance: touchDistance(first!, second!) }
      wheelAccumulatedDeltaRef.current = 0
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (touchBlocked) {
        if (event.touches.length === 2 && event.cancelable) event.preventDefault()
        return
      }
      if (!pinch) return
      const touches = Array.from(event.touches)
      if (touches.length !== 2 || !touches.every((touch) => pinch!.identifiers.includes(touch.identifier)
        && insidePanel(touch))) {
        pinch = null
        touchBlocked = true
        return
      }
      if (event.cancelable) event.preventDefault()
      const distance = touchDistance(touches[0]!, touches[1]!)
      const delta = distance - pinch.distance
      const threshold = Math.max(PLAYLIST_PINCH_MIN_DISTANCE, pinch.distance * PLAYLIST_PINCH_DISTANCE_RATIO)
      const now = performance.now()
      if (Math.abs(delta) < threshold || now < wheelLockedUntilRef.current) return
      // Translation leaves the separation unchanged; spreading matches Ctrl+wheel up.
      changeLayout(delta > 0 ? -1 : 1, now)
      // Consume this gesture even at a layout boundary. Only lifting every
      // touch unlocks it, so continuing or replacing one finger cannot repeat.
      pinch = null
      touchBlocked = true
    }
    const handleTouchEnd = (event: TouchEvent) => {
      pinch = null
      if (event.touches.length === 0) touchBlocked = false
    }
    const handleTouchCancel = (event: TouchEvent) => {
      pinch = null
      touchBlocked = event.touches.length > 0
    }
    const handleBlur = () => {
      pressedControlKeys.clear()
      wheelInput = null
      trackpadLastAt = -Infinity
      trackpadConsumed = false
      wheelAccumulatedDeltaRef.current = 0
      wheelLastAtRef.current = 0
      pinch = null
      touchBlocked = false
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    panel.addEventListener('wheel', handleWheel, { passive: false })
    panel.addEventListener('touchstart', handleTouchStart, { passive: false })
    panel.addEventListener('touchmove', handleTouchMove, { passive: false })
    panel.addEventListener('touchend', handleTouchEnd)
    panel.addEventListener('touchcancel', handleTouchCancel)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      panel.removeEventListener('wheel', handleWheel)
      panel.removeEventListener('touchstart', handleTouchStart)
      panel.removeEventListener('touchmove', handleTouchMove)
      panel.removeEventListener('touchend', handleTouchEnd)
      panel.removeEventListener('touchcancel', handleTouchCancel)
      pinch = null
      pendingLayoutSnapshotRef.current = null
      stopLayoutAnimations()
    }
  }, [appearanceMotion, stopLayoutAnimations, panelRef, gridRef, layouts, storageKey, selectors, gestureArea])
  const selectLevel = useCallback((nextLevel: number) => {
    if (!Number.isInteger(nextLevel) || !layouts[nextLevel]) return
    layoutLevelRef.current = nextLevel
    setLevel(nextLevel)
    try { window.localStorage.setItem(storageKey, String(nextLevel)) } catch { /* Storage is optional. */ }
    setAnnouncement(callbacksRef.current.announce(layouts[nextLevel]))
  }, [layouts, storageKey])
  return { level, layout: layouts[level] ?? layouts[defaultLevel()]!, announcement, selectLevel }
}
