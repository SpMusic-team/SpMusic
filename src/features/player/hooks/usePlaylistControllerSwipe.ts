import { animate, useMotionValue } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { appearanceEasingMap } from '@/features/appearance/model/appearanceMotion'
import { useAppearance } from '@/features/appearance/hooks/useAppearance'
import type { PlayerPlaybackViewModel, TrackCardPreviewToken } from '@/features/player/model/playerUiViewModel'

type SwipePointer = {
  id: number; startX: number; startY: number; width: number; stride: number
  dragging: boolean; dx: number; lastX: number; lastAt: number; velocity: number
}
type SwipeOwner = {
  originTrackId: string | undefined; sequence: number | undefined
  tokenId?: number; targetTrackId?: string; committed: boolean
}
type QueuedSwipe = {
  pointer: SwipePointer; owner: SwipeOwner; released: boolean; enough: boolean
}

// Only the locally owned preview token may be discarded: the audio player has
// a single preview slot shared with the full-size player.
export function usePlaylistControllerSwipe(playback: PlayerPlaybackViewModel, disabled: boolean,
  isPreviewPaintReady?: (token: TrackCardPreviewToken) => boolean, commandBusy = false) {
  const { appearance, motion } = useAppearance()
  const settings = appearance.player.controllerSwipe
  const viewportRef = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const highlight = useMotionValue(0)
  const [preview, setPreview] = useState<TrackCardPreviewToken | null>(null)
  const [pageStride, setPageStride] = useState(0)
  const [active, setActive] = useState(false)
  const suppressClick = useRef(false)
  const latest = useRef(playback)
  const queuedSwipe = useRef<QueuedSwipe | null>(null)
  const settleOwner = useRef<SwipeOwner | null>(null)
  const latestPreviewReady = useRef(isPreviewPaintReady)
  useLayoutEffect(() => { latest.current = playback })
  useLayoutEffect(() => { latestPreviewReady.current = isPreviewPaintReady })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let disposed = false
    let revision = 0
    let token: TrackCardPreviewToken | null = null
    let requestedDirection: -1 | 1 | null = null
    let preparing: Promise<TrackCardPreviewToken | null> | null = null
    let pointer: SwipePointer | null = null
    let settling = false
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    let slideAnimation: ReturnType<typeof animate> | undefined
    let lightAnimation: ReturnType<typeof animate> | undefined
    const scale = appearance.motion.durationScale
    const light = (value: number, durationMs: number) => {
      lightAnimation?.stop()
      if (motion.disabled || durationMs * scale === 0) {
        highlight.set(value)
        return
      }
      lightAnimation = animate(highlight, value, { duration: durationMs * scale / 1000, ease: appearanceEasingMap[settings.easing] })
    }
    const clearHold = () => { clearTimeout(holdTimer); holdTimer = undefined }
    const ownerIsCurrent = (owner: SwipeOwner) => {
      const current = latest.current
      if (!owner.committed) return current.track?.id === owner.originTrackId
        && current.selectionActivitySequence === owner.sequence
      const intent = current.selectionVisualIntent
      return owner.tokenId !== undefined && current.track?.id === owner.targetTrackId
        && intent?.previewTokenId === owner.tokenId && intent.targetTrackId === owner.targetTrackId
        && intent.sequence === current.selectionActivitySequence
    }
    const clearQueued = () => {
      const queued = queuedSwipe.current
      queuedSwipe.current = null
      if (queued && viewport.hasPointerCapture(queued.pointer.id)) viewport.releasePointerCapture(queued.pointer.id)
    }
    const discard = () => {
      if (token) latest.current.onDiscardTrackPreview?.(token.id)
      token = null
    }
    const reset = () => {
      revision += 1
      clearHold()
      slideAnimation?.stop()
      lightAnimation?.stop()
      discard()
      requestedDirection = null
      preparing = null
      const previousPointer = pointer
      pointer = null
      if (previousPointer && viewport.hasPointerCapture(previousPointer.id)) viewport.releasePointerCapture(previousPointer.id)
      settling = false
      x.set(0)
      highlight.set(0)
      if (!disposed) { setPreview(null); setActive(false) }
      viewport.dataset.swipePhase = 'idle'
    }
    const request = (direction: -1 | 1) => {
      if (requestedDirection === direction) return preparing
      const requestRevision = ++revision
      discard()
      setPreview(null)
      requestedDirection = direction
      const originTrackId = latest.current.track?.id
      preparing = Promise.resolve().then(() => latest.current.onPrepareTrackPreview?.(direction) ?? null).then((result) => {
        if (disposed || requestRevision !== revision || originTrackId !== latest.current.track?.id || result?.originTrackId !== originTrackId) {
          if (result) latest.current.onDiscardTrackPreview?.(result.id)
          return null
        }
        token = result
        setPreview(result)
        return result
      }).catch(() => null)
      return preparing
    }
    const settleBack = async () => {
      const currentRevision = ++revision
      // The neighbor still paints while the rows travel back to the origin.
      // Keep its preview lease until reset removes that row; discarding now
      // drops the decoded cover mid-animation. The revision above still
      // invalidates any prepare result that has not arrived yet.
      viewport.dataset.swipePhase = 'settling'
      if (motion.disabled || settings.settleDurationMs * scale === 0) {
        reset()
        drainQueued()
        return
      }
      slideAnimation = animate(x, 0, { duration: settings.settleDurationMs * scale / 1000, ease: appearanceEasingMap[settings.easing] })
      await slideAnimation
      if (!disposed && currentRevision === revision) { reset(); drainQueued() }
    }
    const cancel = () => {
      if (pointer?.dragging || settling || queuedSwipe.current) suppressClick.current = true
      clearQueued()
      settleOwner.current = null
      reset()
    }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) { if (pointer) cancel(); return }
      if (event.button !== 0 || disabled || !latest.current.onPrepareTrackPreview || !latest.current.onCommitTrackPreview) return
      if (settling || commandBusy || queuedSwipe.current) {
        // Input intent survives the previous swipe's animation/selection lock.
        // Keep at most one continuation, owned by this controller's transition.
        suppressClick.current = true
        const owner = settleOwner.current
        if (queuedSwipe.current || !owner || !ownerIsCurrent(owner)
          || latest.current.isTransportBusy || (commandBusy && !latest.current.isSelectionPending)) return
        const width = viewport.getBoundingClientRect().width
        if (!width) return
        const paintedWidth = viewport.querySelector<HTMLElement>('.playlist-controller-swipe-highlight')?.getBoundingClientRect().width ?? width
        const stride = Math.max(width, paintedWidth) + (Number.parseFloat(getComputedStyle(viewport).columnGap) || 0)
        queuedSwipe.current = { owner, released: false, enough: false,
          pointer: { id: event.pointerId, startX: event.clientX, startY: event.clientY, width, stride,
            dragging: false, dx: 0, lastX: event.clientX, lastAt: performance.now(), velocity: 0 } }
        viewport.setPointerCapture(event.pointerId)
        return
      }
      if (pointer) return
      suppressClick.current = false
      const width = viewport.getBoundingClientRect().width
      if (!width) return
      const paintedWidth = viewport.querySelector<HTMLElement>('.playlist-controller-swipe-highlight')?.getBoundingClientRect().width ?? width
      const pageGap = Number.parseFloat(getComputedStyle(viewport).columnGap) || 0
      const stride = Math.max(width, paintedWidth) + pageGap
      setPageStride(stride)
      pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, width, stride, dragging: false, dx: 0, lastX: event.clientX, lastAt: performance.now(), velocity: 0 }
      viewport.dataset.swipePhase = 'pressed'
      holdTimer = setTimeout(() => { if (pointer && !pointer.dragging) light(settings.highlightOpacity, settings.highlightInMs) }, settings.holdDelayMs)
    }
    const move = (event: PointerEvent) => {
      const queued = queuedSwipe.current
      if (queued && !queued.released && queued.pointer.id === event.pointerId) {
        const current = queued.pointer
        const dx = event.clientX - current.startX, dy = event.clientY - current.startY
        if (!current.dragging && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearQueued(); return }
        if (Math.abs(dx) >= 10 && Math.abs(dx) > Math.abs(dy) * 1.2) current.dragging = true
        const now = performance.now()
        current.velocity = (event.clientX - current.lastX) / Math.max(1, now - current.lastAt)
        current.lastX = event.clientX; current.lastAt = now
        current.dx = Math.max(-current.stride, Math.min(current.stride, dx))
        if (current.dragging) event.preventDefault()
        return
      }
      const current = pointer
      if (!current || current.id !== event.pointerId || settling) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      if (!current.dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { cancel(); return }
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.2) return
        current.dragging = true
        suppressClick.current = true
        clearHold()
        light(0, settings.highlightOutMs)
        setActive(true)
        viewport.dataset.swipePhase = 'dragging'
        viewport.setPointerCapture(event.pointerId)
      }
      event.preventDefault()
      const now = performance.now()
      current.velocity = (event.clientX - current.lastX) / Math.max(1, now - current.lastAt)
      current.lastX = event.clientX
      current.lastAt = now
      current.dx = Math.max(-current.stride, Math.min(current.stride, dx))
      x.set(current.dx)
      if (Math.abs(dx) >= 10) void request(dx < 0 ? 1 : -1)
    }
    const up = async (event: PointerEvent) => {
      const queued = queuedSwipe.current
      if (queued && !queued.released && queued.pointer.id === event.pointerId) {
        if (event.clientX !== queued.pointer.lastX) move(event)
        if (queuedSwipe.current !== queued) return
        const current = queued.pointer
        const velocity = performance.now() - current.lastAt < 100 ? current.velocity : 0
        queued.released = true
        queued.enough = current.dragging && (Math.abs(current.dx) >= current.width * 0.2
          || (Math.abs(current.dx) >= 24 && Math.abs(velocity) >= 0.5 && Math.sign(velocity) === Math.sign(current.dx)))
        // Drop the capture owner before releasing capture; lostpointercapture
        // must not cancel the saved, already completed gesture.
        queuedSwipe.current = null
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
        if (queued.enough) queuedSwipe.current = queued
        drainQueued()
        return
      }
      const current = pointer
      if (!current || current.id !== event.pointerId) return
      // WebViews can coalesce the last movement into pointerup. Use the release
      // coordinates for both the threshold and the requested neighbor.
      const finalDx = event.clientX - current.startX
      const finalDy = event.clientY - current.startY
      const now = performance.now()
      if (event.clientX !== current.lastX) {
        current.velocity = (event.clientX - current.lastX) / Math.max(1, now - current.lastAt)
        current.lastAt = now
      }
      current.dx = Math.max(-current.stride, Math.min(current.stride, finalDx))
      if (!current.dragging && Math.abs(finalDx) >= 10 && Math.abs(finalDx) > Math.abs(finalDy) * 1.2) {
        current.dragging = true
        suppressClick.current = true
        setActive(true)
      }
      if (current.dragging) x.set(current.dx)
      clearHold()
      light(0, settings.highlightOutMs)
      pointer = null
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
      if (!current.dragging) { viewport.dataset.swipePhase = 'idle'; return }
      settling = true
      const direction = current.dx < 0 ? 1 : -1
      const velocity = performance.now() - current.lastAt < 100 ? current.velocity : 0
      const enough = Math.abs(current.dx) >= current.width * 0.2 || (Math.abs(current.dx) >= 24 && Math.abs(velocity) >= 0.5 && Math.sign(velocity) === Math.sign(current.dx))
      if (!enough) {
        settleOwner.current = { originTrackId: latest.current.track?.id,
          sequence: latest.current.selectionActivitySequence, committed: false }
        void settleBack()
        return
      }
      await finishSwipe(current, direction)
    }
    const finishSwipe = async (current: SwipePointer, direction: -1 | 1) => {
      const owner: SwipeOwner = { originTrackId: latest.current.track?.id,
        sequence: latest.current.selectionActivitySequence, committed: false }
      settleOwner.current = owner
      const pending = request(direction)
      const releaseRevision = revision
      const result = await pending
      if (disposed || releaseRevision !== revision || !settling) return
      if (!result) { void settleBack(); return }
      owner.tokenId = result.id
      owner.targetTrackId = result.targetTrackId
      // The playback commit changes the current row immediately. Keep the
      // decoded preview as its entering cover instead of exposing an old canvas
      // or an as-yet-unpainted target image for the first committed frame.
      const readyDeadline = performance.now() + 5000
      while (latestPreviewReady.current && !latestPreviewReady.current(result) && performance.now() < readyDeadline) {
        await new Promise(requestAnimationFrame)
        if (disposed || releaseRevision !== revision || !settling) return
      }
      if (latestPreviewReady.current && !latestPreviewReady.current(result)) { void settleBack(); return }
      viewport.dataset.swipePhase = 'settling'
      if (motion.disabled || settings.settleDurationMs * scale === 0) {
        // A zero-duration Motion timeline can flush its final transform after
        // the new track's layout-effect cleanup has already restored x=0.
        // Direct manipulation has no outstanding timeline to repaint later.
        x.set(-direction * current.stride)
      } else {
        slideAnimation = animate(x, -direction * current.stride, { duration: settings.settleDurationMs * scale / 1000, ease: motion.trackCardCommitEase })
        await slideAnimation
      }
      if (disposed || releaseRevision !== revision || !settling) return
      // Establish ownership before the synchronous callback can publish the
      // selection and rebuild this effect for its new track/disabled state.
      owner.committed = true
      const accepted = latest.current.onCommitTrackPreview?.(result.id) === true
      if (accepted) {
        token = null
        viewport.dataset.swipePhase = 'committed'
        // A one-track queue may validly commit the current track again. That
        // has no id change to trigger the normal presentation cleanup.
        if (result.targetTrackId === result.originTrackId) { reset(); drainQueued() }
      } else { owner.committed = false; void settleBack() }
    }
    const drainQueued = () => {
      const queued = queuedSwipe.current
      if (!queued || disposed || settling || disabled || commandBusy) return
      if (!ownerIsCurrent(queued.owner)) { clearQueued(); return }
      // Take the single slot atomically. No token from the previous origin is
      // reused: the next request resolves against the newly selected track.
      queuedSwipe.current = null
      const current = queued.pointer
      pointer = queued.released ? null : current
      setPageStride(current.stride)
      if (!current.dragging) {
        viewport.dataset.swipePhase = 'pressed'
        return
      }
      suppressClick.current = true
      setActive(true)
      x.set(current.dx)
      viewport.dataset.swipePhase = queued.released ? 'settling' : 'dragging'
      if (queued.released) {
        settling = true
        if (queued.enough) void finishSwipe(current, current.dx < 0 ? 1 : -1)
        else void settleBack()
      } else void request(current.dx < 0 ? 1 : -1)
    }
    const lost = (event: PointerEvent) => {
      if (event.target === viewport && (pointer || (queuedSwipe.current && !queuedSwipe.current.released))) cancel()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const visibility = () => { if (document.hidden) cancel() }
    viewport.dataset.swipePhase = 'idle'
    const queued = queuedSwipe.current
    if (queued && (disabled || !ownerIsCurrent(queued.owner) || latest.current.isTransportBusy
      || (commandBusy && !latest.current.isSelectionPending))) clearQueued()
    viewport.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    viewport.addEventListener('lostpointercapture', lost)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', cancel)
    document.addEventListener('visibilitychange', visibility)
    drainQueued()
    return () => {
      reset()
      disposed = true
      viewport.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      viewport.removeEventListener('lostpointercapture', lost)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [playback.track?.id, playback.selectionActivitySequence, disabled, commandBusy, settings, appearance.motion.durationScale, motion.disabled, motion.trackCardCommitEase, x, highlight])

  useLayoutEffect(() => () => {
    const queued = queuedSwipe.current
    queuedSwipe.current = null
    settleOwner.current = null
    const viewport = viewportRef.current
    if (queued && viewport?.hasPointerCapture(queued.pointer.id)) viewport.releasePointerCapture(queued.pointer.id)
  }, [])

  return { viewportRef, x, highlight, preview, active, pageStride, onClickCapture: (event: React.MouseEvent) => {
    if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
  } }
}
