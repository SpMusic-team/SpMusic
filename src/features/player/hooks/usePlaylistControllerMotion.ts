import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { animate, useMotionValue, type AnimationPlaybackControls, type Transition } from 'motion/react'
import type { PlaylistControllerMode } from '@/features/player/model/playlistControllerMode'

export function usePlaylistControllerMotion(
  panelRef: RefObject<HTMLElement | null>,
  dockRef: RefObject<HTMLElement | null>,
  mode: PlaylistControllerMode,
  seeking: boolean,
  layoutKey: string,
  heroPassed: boolean,
  transition: Transition,
) {
  const offsetY = useMotionValue(0)
  const [hidden, setHidden] = useState(false)
  const hiddenRef = useRef(false)
  const baselineRef = useRef(0)
  const travelRef = useRef(0)
  const seekingRef = useRef(seeking)
  const heroPassedRef = useRef(heroPassed)
  const transitionRef = useRef(transition)
  const directionRef = useRef(0)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)
  const targetRef = useRef<number | null>(null)
  const syncHeroRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    animationRef.current?.stop()
    animationRef.current = null
    targetRef.current = null
  }, [])

  const readTop = useCallback(() => {
    const panel = panelRef.current
    return panel ? Math.max(0, Math.min(panel.scrollTop, panel.scrollHeight - panel.clientHeight)) : 0
  }, [panelRef])

  const rebase = useCallback((options?: { reveal?: boolean }) => {
    stop()
    directionRef.current = 0
    baselineRef.current = readTop()
    if (options?.reveal || baselineRef.current === 0) offsetY.set(0)
  }, [offsetY, readTop, stop])

  useLayoutEffect(() => {
    transitionRef.current = transition
    if (Number(transition.duration ?? 0) === 0 && targetRef.current !== null) {
      const target = targetRef.current
      stop()
      offsetY.set(target)
    }
  }, [transition, offsetY, stop])

  useLayoutEffect(() => {
    seekingRef.current = seeking
    rebase()
  }, [seeking, rebase])

  useLayoutEffect(() => { rebase() }, [layoutKey, rebase])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const dock = dockRef.current
    if (!panel || !dock) return
    let pressedPointer: number | null = null
    let keyboardFocus = false
    let disposed = false
    let panelWidth = 0
    let panelHeight = 0

    const locked = () => pressedPointer !== null || keyboardFocus || seekingRef.current
    const moveTo = (target: number) => {
      if (targetRef.current === target) return
      stop()
      targetRef.current = target
      if (Number(transitionRef.current.duration ?? 0) === 0 || offsetY.get() === target) {
        offsetY.set(target)
      } else {
        // One shared trajectory for the dock and its actions; a reversal
        // starts from the painted position rather than waiting on a queue.
        animationRef.current = animate(offsetY, target, transitionRef.current)
      }
    }
    syncHeroRef.current = () => {
      if (mode === 'fixed' || locked()) return
      if (!heroPassedRef.current) moveTo(0)
      else if (directionRef.current > 0) moveTo(travelRef.current)
    }

    const updateHidden = () => {
      if (disposed) return
      const offscreen = travelRef.current > 0 && offsetY.get() >= travelRef.current
      if (offscreen && dock.contains(document.activeElement)) panel.focus({ preventScroll: true })
      if (hiddenRef.current !== offscreen) {
        hiddenRef.current = offscreen
        setHidden(offscreen)
      }
    }
    const measure = () => {
      const bottom = Number.parseFloat(getComputedStyle(dock).bottom)
      const travel = dock.offsetHeight + (Number.isFinite(bottom) ? bottom : 0)
      if (travel === travelRef.current && panelWidth === panel.clientWidth && panelHeight === panel.clientHeight) return
      travelRef.current = travel
      panelWidth = panel.clientWidth
      panelHeight = panel.clientHeight
      offsetY.set(mode === 'fixed' ? 0 : Math.min(offsetY.get(), travelRef.current))
      rebase()
      updateHidden()
    }
    const scroll = () => {
      const top = readTop()
      const delta = top - baselineRef.current
      baselineRef.current = top
      if (mode === 'fixed' || top === 0) {
        stop()
        directionRef.current = 0
        offsetY.set(0)
      } else if (locked()) {
        rebase()
      } else if (delta !== 0) {
        const direction = Math.sign(delta)
        const changed = directionRef.current !== direction
        directionRef.current = direction
        if (!heroPassedRef.current) moveTo(0)
        else if (changed) moveTo(direction > 0 ? travelRef.current : 0)
      }
    }
    const pointerDown = (event: PointerEvent) => {
      keyboardFocus = false
      if (dock.contains(event.target as Node)) pressedPointer = event.pointerId
      rebase()
    }
    const pointerUp = (event: PointerEvent) => {
      if (pressedPointer === event.pointerId) {
        pressedPointer = null
        rebase()
      }
    }
    const focusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && dock.contains(target) && target.matches(':focus-visible')) {
        keyboardFocus = true
        rebase({ reveal: true })
      } else {
        rebase()
      }
    }
    const focusOut = (event: FocusEvent) => {
      if (!dock.contains(event.relatedTarget as Node | null)) keyboardFocus = false
      rebase()
    }
    const blur = () => { pressedPointer = null; keyboardFocus = false; rebase() }

    offsetY.set(0)
    measure()
    const unsubscribe = offsetY.on('change', updateHidden)
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(dock)
    resizeObserver.observe(panel)
    panel.addEventListener('scroll', scroll, { passive: true })
    panel.addEventListener('focusin', focusIn)
    dock.addEventListener('focusin', focusIn)
    dock.addEventListener('focusout', focusOut)
    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', pointerUp, true)
    window.addEventListener('blur', blur)
    return () => {
      disposed = true
      stop()
      directionRef.current = 0
      syncHeroRef.current = null
      unsubscribe()
      resizeObserver.disconnect()
      panel.removeEventListener('scroll', scroll)
      panel.removeEventListener('focusin', focusIn)
      dock.removeEventListener('focusin', focusIn)
      dock.removeEventListener('focusout', focusOut)
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerUp, true)
      window.removeEventListener('blur', blur)
    }
  }, [dockRef, mode, offsetY, panelRef, readTop, rebase, stop])

  useLayoutEffect(() => {
    heroPassedRef.current = heroPassed
    // Observer notifications alone never manufacture scroll intent: initial
    // song positioning and resize establish eligibility without hiding.
    syncHeroRef.current?.()
  }, [heroPassed, mode])

  return { offsetY, hidden, rebase }
}
