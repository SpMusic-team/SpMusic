import { useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

const LONG_PRESS_MS = 400

type Options = {
  identity: string
  disabled: boolean
  selectMode: boolean
  onEnterSelectMode?: (identity: string) => void
}

// Listeners exist only for the active press. Selection state remains owned by
// the parent; the release-click token survives that parent's selection render.
export function usePlaylistCardLongPress({ identity, disabled, selectMode, onEnterSelectMode }: Options) {
  const active = useRef<{ cancel: () => void; pointerType: string } | null>(null)
  const releaseClick = useRef<{ pointerType: string } | null>(null)
  const enabled = !disabled && Boolean(onEnterSelectMode)

  useLayoutEffect(() => {
    return () => {
      active.current?.cancel()
      releaseClick.current = null
    }
  }, [identity, enabled])

  useLayoutEffect(() => {
    active.current?.cancel()
  }, [selectMode])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    active.current?.cancel()
    if (event.isPrimary) releaseClick.current = null
    if (!enabled || selectMode || !onEnterSelectMode || !event.isPrimary || event.button !== 0
      || (event.pointerType === 'mouse' && event.buttons !== 1)
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

    const button = event.currentTarget
    const panel = button.closest<HTMLElement>('.playlist-panel')
    const { pointerId, pointerType, clientX, clientY } = event
    const threshold = pointerType === 'mouse' ? 5 : 10
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', anotherPointer, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('lostpointercapture', end, true)
      window.removeEventListener('touchstart', touchStart, true)
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('wheel', cancel, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
      button.removeEventListener('dragstart', cancel)
      button.removeEventListener('selectstart', cancel)
      if (active.current === session) active.current = null
    }
    const anotherPointer = (next: PointerEvent) => { if (next.pointerId !== pointerId) cancel() }
    const touchStart = (next: TouchEvent) => { if (next.touches.length > 1) cancel() }
    const end = (next: PointerEvent) => { if (next.pointerId === pointerId) cancel() }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      if ((pointerType === 'mouse' ? next.buttons !== 1 : !(next.buttons & 1))
        || Math.hypot(next.clientX - clientX, next.clientY - clientY) >= threshold
        || panel?.dataset.dragging === 'true') cancel()
    }
    const session = { cancel, pointerType }
    active.current = session
    window.addEventListener('pointerdown', anotherPointer, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    window.addEventListener('lostpointercapture', end, true)
    window.addEventListener('touchstart', touchStart, { capture: true, passive: true })
    window.addEventListener('scroll', cancel, { capture: true, passive: true })
    window.addEventListener('wheel', cancel, { capture: true, passive: true })
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', cancel)
    button.addEventListener('dragstart', cancel)
    button.addEventListener('selectstart', cancel)
    timer = setTimeout(() => {
      timer = undefined
      if (active.current !== session || !button.isConnected || button.disabled
        || document.visibilityState === 'hidden' || panel?.dataset.dragging === 'true') {
        cancel()
        return
      }
      releaseClick.current = { pointerType }
      onEnterSelectMode(identity)
    }, LONG_PRESS_MS)
  }

  const consumeClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      active.current?.cancel()
      return false
    }
    if (!releaseClick.current) return false
    releaseClick.current = null
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const onContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const pointerType = active.current?.pointerType ?? releaseClick.current?.pointerType
    if (pointerType === 'touch' || pointerType === 'pen') event.preventDefault()
    else active.current?.cancel()
  }

  return { onPointerDown, consumeClick, onContextMenu }
}
