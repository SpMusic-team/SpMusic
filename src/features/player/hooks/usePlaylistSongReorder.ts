import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useAppearance, useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'

export type PlaylistReorderDraft = Readonly<{ expectedKeys: readonly string[]; orderedKeys: readonly string[] }>
type Options = {
  enabled: boolean
  scopeKey: string
  sourceVersion: string
  orderedKeys: readonly string[]
  selectedKeys?: ReadonlySet<string>
  layoutKey: string | number
  gridRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  onCommit: (draft: PlaylistReorderDraft) => Promise<{ ok: boolean; errorMessage?: string }>
  retainArtwork?: (key: string) => () => void
  holdContent?: (key: string) => () => void
  onPreview?: (keys: readonly string[] | null) => void
}
type Rect = { left: number; top: number; width: number; height: number }
type Slot = { card: HTMLElement; key: string; index: number; rect: Rect }
type Session = {
  id: number; pointerType: string; key: string; startX: number; startY: number; x: number; y: number
  grid: HTMLElement; scroll: HTMLElement; scopeKey: string; sourceVersion: string; layoutKey: string | number; geometryKey: string
  keys: readonly string[]; indices: Map<string, number>; moved: readonly string[]; movedSet: Set<string>; draft: readonly string[]
  displayKeys: readonly string[]; remaining: readonly string[]; preview?: Options['onPreview']
  pendingRects: Map<string, DOMRect> | null; neighbors: Map<HTMLElement, Animation>
  rect: Rect; source: HTMLElement; overlay: HTMLElement | null; ghost: HTMLElement | null
  phase: 'armed' | 'dragging' | 'committing' | 'settling'; insertion: number
  mutations: Map<HTMLElement, { translate: string; transition: string; source: string | null }>
  animations: Set<Animation>; leases: (() => void)[]; disposeListeners: () => void; commit: Options['onCommit']
  frame: number | null; time: number | null; live: boolean; dock: HTMLElement | null
}
const cardKey = (card: HTMLElement) => card.dataset.songKey ?? card.dataset.playlistTrackId
const sameOrder = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((key, index) => key === right[index])
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

// Clone only a single painted card, not React components or artwork owners.
// Computed presentation freezes in-flight cover reveals and checkbox strokes.
function paintedClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const originals = [source, ...source.querySelectorAll<HTMLElement | SVGElement>('*')]
  const copies = [clone, ...clone.querySelectorAll<HTMLElement | SVGElement>('*')]
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index]!, copy = copies[index]!
    const styles = getComputedStyle(original)
    for (const property of styles) copy.style.setProperty(property, styles.getPropertyValue(property))
    copy.style.animation = 'none'
    copy.style.transition = 'none'
    copy.removeAttribute('id')
    copy.removeAttribute('data-reveal')
    if (copy instanceof HTMLButtonElement) { copy.disabled = false; copy.tabIndex = -1 }
  }
  clone.removeAttribute('data-reorder-source')
  clone.style.position = 'relative'
  clone.style.margin = '0'
  clone.style.width = '100%'
  clone.style.height = '100%'
  clone.style.minHeight = '0'
  clone.style.transform = 'none'
  clone.style.translate = 'none'
  if (source.dataset.selected === 'true') {
    for (const path of clone.querySelectorAll<SVGElement>('.playlist-card-checkbox-check path')) path.style.strokeDashoffset = '0'
    for (const fill of clone.querySelectorAll<HTMLElement>('.playlist-card-checkbox-fill')) fill.style.opacity = '1'
    for (const icon of clone.querySelectorAll<HTMLElement>('.playlist-card-checkbox-icon')) icon.style.opacity = '0'
  }
  return clone
}

export function usePlaylistSongReorder(options: Options) {
  const latest = useRef(options)
  const { appearance } = useAppearance()
  const geometryKey = `${appearance.typography.fontFamily}\0${appearance.typography.fontScale}`
  const motion = useAppearanceMotion()
  const motionRef = useRef(motion)
  const session = useRef<Session | null>(null)
  const clickToken = useRef(false)
  const keyboardBusy = useRef(false)
  const [isDragging, setDragging] = useState(false)
  const [announcement, announce] = useState('')

  const clearPresentation = useCallback((current: Session, preserveAnimations = false) => {
    if (!preserveAnimations) {
      for (const animation of current.animations) animation.cancel()
      current.animations.clear()
      current.neighbors.clear()
    }
    for (const [card, previous] of current.mutations) {
      card.style.translate = previous.translate
      card.style.transition = previous.transition
      if (previous.source === null) card.removeAttribute('data-reorder-source')
      else card.setAttribute('data-reorder-source', previous.source)
    }
    current.mutations.clear()
  }, [])
  const dispose = useCallback((current: Session) => {
    current.live = false
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    current.frame = null
    current.disposeListeners()
    current.preview?.(null)
    clearPresentation(current)
    current.overlay?.remove()
    current.overlay = null
    current.ghost = null
    for (const release of current.leases.splice(0).reverse()) release()
    delete current.grid.dataset.reordering
    delete current.grid.dataset.reorderPhase
    if (current.grid.hasPointerCapture(current.id)) current.grid.releasePointerCapture(current.id)
    if (session.current === current) { session.current = null; setDragging(false) }
  }, [clearPresentation])

  const slots = useCallback((current: Session): Slot[] => {
    const grid = current.grid, scrollBounds = current.scroll.getBoundingClientRect(), gridBounds = grid.getBoundingClientRect()
    const nodes = grid.children
    const first = nodes[0] instanceof HTMLElement ? nodes[0] : null
    if (!first) return []
    const localParent = first.offsetParent === grid
    const originTop = gridBounds.top - (localParent ? 0 : grid.offsetTop)
    const originLeft = gridBounds.left - (localParent ? 0 : grid.offsetLeft)
    const buffer = Math.max(current.rect.height * 2, scrollBounds.height)
    const min = scrollBounds.top - originTop - buffer, max = scrollBounds.bottom - originTop + buffer
    let low = 0, high = nodes.length
    while (low < high) {
      const middle = (low + high) >>> 1, card = nodes[middle]
      if (card instanceof HTMLElement && card.offsetTop + card.offsetHeight < min) low = middle + 1
      else high = middle
    }
    const result: Slot[] = []
    for (let index = low; index < nodes.length; index++) {
      const card = nodes[index]
      if (!(card instanceof HTMLElement)) continue
      if (card.offsetTop > max) break
      const key = cardKey(card), originalIndex = key === undefined ? undefined : current.indices.get(key)
      if (key === undefined || originalIndex === undefined) continue
      result.push({ card, key, index: originalIndex, rect: { left: originLeft + card.offsetLeft, top: originTop + card.offsetTop, width: card.offsetWidth, height: card.offsetHeight } })
    }
    return result
  }, [])

  const project = useCallback((current: Session, keys: readonly string[]) => {
    if (!current.preview) return
    current.pendingRects = new Map(slots(current).map(slot => [slot.key, slot.card.getBoundingClientRect()]))
    current.displayKeys = keys
    current.indices = new Map(keys.map((key, index) => [key, index]))
    current.preview(keys)
  }, [slots])

  const animate = useCallback((current: Session, element: HTMLElement, frames: Keyframe[], duration: number) => {
    if (duration <= 0) return Promise.resolve()
    const animation = element.animate(frames, { duration, easing: motionRef.current.reorder.easing, fill: 'forwards' })
    current.animations.add(animation)
    return animation.finished.then(() => {
      if (element.isConnected) animation.commitStyles()
    }).catch(() => {}).finally(() => { animation.cancel(); current.animations.delete(animation) })
  }, [])
  const settle = useCallback(async (current: Session, ok: boolean, message?: string) => {
    if (!current.live) return
    current.phase = 'settling'
    current.grid.dataset.reorderPhase = 'settling'
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    current.frame = null
    const badge = current.overlay?.querySelector<HTMLElement>('.playlist-reorder-count')
    if (badge) badge.style.opacity = '0'
    current.pendingRects ??= new Map(slots(current).map(slot => [slot.key, slot.card.getBoundingClientRect()]))
    current.preview?.(null)
    current.displayKeys = latest.current.orderedKeys
    current.indices = new Map(current.displayKeys.map((key, index) => [key, index]))
    await nextFrame()
    if (!current.live) return
    clearPresentation(current, true)
    const target = [...current.grid.querySelectorAll<HTMLElement>('.playlist-card')].find(card => cardKey(card) === current.key)
    if (target) {
      current.mutations.set(target, { translate: target.style.translate, transition: target.style.transition, source: target.getAttribute('data-reorder-source') })
      target.dataset.reorderSource = 'true'
    }
    const rect = target?.getBoundingClientRect() ?? current.rect
    const overlay = current.overlay, ghost = current.ghost
    if (overlay && ghost) {
      const from = overlay.getBoundingClientRect()
      const duration = Number(motionRef.current.reorder.settle.duration ?? 0) * 1000
      await Promise.all([
        animate(current, overlay, [{ left: `${from.left}px`, top: `${from.top}px` }, { left: `${rect.left}px`, top: `${rect.top}px` }], duration),
        animate(current, ghost, [{ transform: getComputedStyle(ghost).transform }, { transform: 'scale(1)' }], duration),
      ])
    }
    if (!current.live) return
    announce(message ?? (ok ? `已移动 ${current.moved.length} 首歌曲` : '已取消排序'))
    dispose(current)
  }, [animate, clearPresentation, dispose, slots])

  const paint = useCallback((current: Session) => {
    if (!current.live || current.phase !== 'dragging') return
    const now = performance.now(), elapsed = Math.min(32, current.time === null ? 16 : now - current.time) / 1000
    current.time = now
    const settings = motionRef.current.reorder
    const scrollRect = current.scroll.getBoundingClientRect()
    const bottom = Math.min(scrollRect.bottom, current.dock?.getBoundingClientRect().top ?? scrollRect.bottom)
    const top = Math.max(scrollRect.top, 0), visibleHeight = Math.max(1, bottom - top)
    const edge = Math.min(settings.edgeZonePx, visibleHeight / 3)
    const edgeAmount = current.y < top + edge ? -Math.min(1, (top + edge - current.y) / edge) : current.y > bottom - edge ? Math.min(1, (current.y - bottom + edge) / edge) : 0
    if (edgeAmount) current.scroll.scrollTop += edgeAmount * visibleHeight * settings.maxScrollViewportPerSecond * elapsed
    const measured = slots(current)
    if (!measured.length) return
    const x = current.rect.left + current.x - current.startX, y = current.rect.top + current.y - current.startY
    if (current.overlay) { current.overlay.style.left = `${x}px`; current.overlay.style.top = `${y}px` }
    const centerX = x + current.rect.width / 2, centerY = y + current.rect.height / 2
    let closest = measured[0]!, distance = Infinity
    for (const slot of measured) {
      const next = Math.hypot(centerX - slot.rect.left - slot.rect.width / 2, centerY - slot.rect.top - slot.rect.height / 2)
      if (next < distance) { closest = slot; distance = next }
    }
    const insertion = Math.max(0, Math.min(current.remaining.length, closest.index))
    if (insertion !== current.insertion) {
      current.insertion = insertion
      current.draft = [...current.remaining.slice(0, insertion), ...current.moved, ...current.remaining.slice(insertion)]
      project(current, [...current.remaining.slice(0, insertion), current.key, ...current.remaining.slice(insertion)])
    }
    if (current.preview) {
      for (const slot of measured) {
        if (slot.key !== current.key) continue
        if (!current.mutations.has(slot.card)) current.mutations.set(slot.card, { translate: slot.card.style.translate, transition: slot.card.style.transition, source: slot.card.getAttribute('data-reorder-source') })
        slot.card.dataset.reorderSource = 'true'
      }
      return
    }
    const desired = new Map(current.draft.map((key, index) => [key, index]))
    const byIndex = new Map(measured.map(slot => [slot.index, slot.rect]))
    const columns = Math.max(1, Number(current.grid.dataset.layoutColumns) || 1)
    const base = measured[0]!
    const nextRow = measured.find(slot => Math.floor(slot.index / columns) !== Math.floor(base.index / columns))
    const rowStride = nextRow ? (nextRow.rect.top - base.rect.top) / (Math.floor(nextRow.index / columns) - Math.floor(base.index / columns)) : base.rect.height + (Number.parseFloat(getComputedStyle(current.grid).rowGap) || 0)
    const nextColumn = measured.find(slot => Math.floor(slot.index / columns) === Math.floor(base.index / columns) && slot.index !== base.index)
    const columnStride = nextColumn ? (nextColumn.rect.left - base.rect.left) / (nextColumn.index - base.index) : base.rect.width
    const neighborDuration = Number(settings.neighbor.duration ?? 0) * 1000
    for (const slot of measured) {
      if (!current.mutations.has(slot.card)) current.mutations.set(slot.card, { translate: slot.card.style.translate, transition: slot.card.style.transition, source: slot.card.getAttribute('data-reorder-source') })
      if (current.movedSet.has(slot.key)) { slot.card.dataset.reorderSource = 'true'; continue }
      const targetIndex = desired.get(slot.key) ?? slot.index
      const target = byIndex.get(targetIndex) ?? { left: base.rect.left + (targetIndex % columns - base.index % columns) * columnStride, top: base.rect.top + (Math.floor(targetIndex / columns) - Math.floor(base.index / columns)) * rowStride }
      slot.card.style.transition = `translate ${neighborDuration}ms ${settings.easing}`
      slot.card.style.translate = `${target.left - slot.rect.left}px ${target.top - slot.rect.top}px`
    }
  }, [project, slots])

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const options = latest.current
    if (event.isPrimary && !session.current) clickToken.current = false
    if (!options.enabled || session.current || keyboardBusy.current || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reorder-handle]') : null
    const source = handle?.closest<HTMLButtonElement>('.playlist-card')
    const grid = options.gridRef.current, scroll = options.scrollRef.current
    if (!handle || !source || source.disabled || !grid || !scroll || !grid.contains(source)) return
    const key = cardKey(source)
    if (!key || !options.orderedKeys.includes(key)) return
    clickToken.current = true
    event.preventDefault()
    event.stopPropagation()
    const keys = [...options.orderedKeys]
    const moved = options.selectedKeys?.has(key) ? keys.filter(item => options.selectedKeys!.has(item)) : [key]
    const movedSet = new Set(moved), remaining = keys.filter(item => !movedSet.has(item))
    const insertion = keys.slice(0, keys.indexOf(key)).filter(item => !movedSet.has(item)).length
    const rect = source.getBoundingClientRect()
    const current: Session = { id: event.pointerId, pointerType: event.pointerType, key, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      grid, scroll, scopeKey: options.scopeKey, sourceVersion: options.sourceVersion, layoutKey: options.layoutKey, geometryKey, keys, indices: new Map(keys.map((key, index) => [key, index])), moved, movedSet, draft: keys,
      displayKeys: keys, remaining, preview: options.onPreview, pendingRects: null, neighbors: new Map(),
      rect, source, overlay: null, ghost: null, phase: 'armed', insertion, mutations: new Map(), animations: new Set(), leases: [], disposeListeners: () => {}, commit: options.onCommit, frame: null, time: null, live: true,
      dock: document.querySelector<HTMLElement>('.playlist-playback-dock:not([data-dock-superseded]) .playlist-selection-panel') }
    session.current = current
    const start = () => {
      current.phase = 'dragging'
      current.grid.dataset.reordering = 'true'
      current.grid.dataset.reorderPhase = 'dragging'
      current.leases.push(options.retainArtwork?.(key) ?? (() => {}), options.holdContent?.(key) ?? (() => {}))
      // Already painted companions keep their existing decoded resources. Do
      // not mount or acquire artwork for the rest of a very large selection.
      for (const slot of slots(current)) if (slot.key !== key && movedSet.has(slot.key)
        && slot.card.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top
        && slot.card.getBoundingClientRect().top < scroll.getBoundingClientRect().bottom
        && slot.card.querySelector('img')) current.leases.push(options.retainArtwork?.(slot.key) ?? (() => {}))
      const overlay = document.createElement('div'), ghost = paintedClone(source)
      overlay.className = 'playlist-reorder-overlay'
      overlay.setAttribute('aria-hidden', 'true'); overlay.inert = true
      // The fixed layer lives outside the app's themed subtree. Keep its pill
      // and shadow in the same theme as the captured card, including dark mode.
      const presentation = getComputedStyle(source)
      for (const property of presentation) if (property.startsWith('--')) overlay.style.setProperty(property, presentation.getPropertyValue(property))
      Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: presentation.borderRadius, fontFamily: presentation.fontFamily })
      overlay.append(ghost)
      if (moved.length > 1) {
        const badge = document.createElement('span')
        badge.className = 'playlist-reorder-count'; badge.textContent = `项目：${moved.length}`
        if (grid.dataset.layoutFlow === 'tile') {
          const cover = source.querySelector('.playlist-card-cover')?.getBoundingClientRect()
          if (cover) { badge.style.left = `${cover.left - rect.left + cover.width / 2}px`; badge.style.top = `${cover.top - rect.top + cover.height / 2}px` }
        }
        badge.style.transition = `opacity ${motionRef.current.disabled ? 0 : 120}ms ${motionRef.current.reorder.easing}`
        overlay.append(badge)
      }
      document.body.append(overlay)
      current.overlay = overlay; current.ghost = ghost
      current.draft = [...remaining.slice(0, insertion), ...moved, ...remaining.slice(insertion)]
      project(current, [...remaining.slice(0, insertion), key, ...remaining.slice(insertion)])
      ghost.style.transformOrigin = `${event.clientX - rect.left}px ${event.clientY - rect.top}px`
      ghost.style.transform = `scale(${motionRef.current.reorder.liftScale})`
      void animate(current, ghost, [{ transform: 'scale(1)' }, { transform: `scale(${motionRef.current.reorder.liftScale})` }], Number(motionRef.current.reorder.lift.duration ?? 0) * 1000)
      grid.setPointerCapture(current.id)
      setDragging(true)
      const frame = () => { if (!current.live || current.phase !== 'dragging') return; paint(current); current.frame = requestAnimationFrame(frame) }
      frame()
    }
    const cancel = () => { if (current.phase === 'armed') dispose(current); else if (current.phase === 'dragging') void settle(current, false) }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== current.id || !current.live || current.phase === 'committing' || current.phase === 'settling') return
      if (current.pointerType === 'mouse' && next.buttons !== 1) { cancel(); return }
      current.x = next.clientX; current.y = next.clientY
      if (current.phase === 'armed' && Math.hypot(current.x - current.startX, current.y - current.startY) >= motionRef.current.reorder.activationDistancePx) start()
      if (current.phase === 'dragging' && next.cancelable) next.preventDefault()
    }
    const end = async (next: PointerEvent) => {
      if (next.pointerId !== current.id || !current.live) return
      if (next.type === 'pointercancel') { cancel(); return }
      if (current.phase === 'armed') { dispose(current); return }
      if (current.phase !== 'dragging') return
      current.x = next.clientX; current.y = next.clientY; paint(current)
      current.phase = 'committing'; grid.dataset.reorderPhase = 'committing'
      if (current.frame !== null) cancelAnimationFrame(current.frame)
      current.frame = null
      if (grid.hasPointerCapture(current.id)) grid.releasePointerCapture(current.id)
      if (sameOrder(current.keys, current.draft)) { void settle(current, false); return }
      project(current, current.draft)
      try {
        const result = await current.commit({ expectedKeys: current.keys, orderedKeys: current.draft })
        await settle(current, result.ok, result.ok ? undefined : result.errorMessage ?? '排序未能保存')
      } catch (error) { await settle(current, false, error instanceof Error ? error.message : '排序未能保存') }
    }
    const second = (next: PointerEvent) => { if (next.pointerId !== current.id) cancel() }
    const escape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); cancel() } }
    // Touch starts with implicit capture on its original SVG/handle. Moving
    // capture to the stable grid legitimately emits lostcapture for that old
    // element; only loss of our grid capture cancels the drag.
    const lost = (next: PointerEvent) => { if (next.pointerId === current.id && current.phase === 'dragging' && !grid.hasPointerCapture(current.id)) cancel() }
    const visibility = () => { if (document.hidden) cancel() }
    const context = (next: Event) => { next.preventDefault(); if (current.pointerType === 'mouse') cancel() }
    const wheel = (next: WheelEvent) => { if (current.phase === 'armed') cancel(); else if (current.phase === 'dragging') { next.preventDefault(); next.stopPropagation(); scroll.scrollTop += next.deltaY } }
    const scrolled = () => { if (current.phase === 'armed') cancel() }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true)
    window.addEventListener('pointerdown', second, true); window.addEventListener('lostpointercapture', lost, true)
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    window.addEventListener('contextmenu', context, true); window.addEventListener('wheel', wheel, { capture: true, passive: false })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('scroll', scrolled, true)
    current.disposeListeners = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('pointerdown', second, true); window.removeEventListener('lostpointercapture', lost, true)
      window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      window.removeEventListener('contextmenu', context, true); window.removeEventListener('wheel', wheel, true); document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('scroll', scrolled, true)
    }
  }, [animate, dispose, geometryKey, paint, project, settle, slots])

  useLayoutEffect(() => {
    latest.current = options; motionRef.current = motion
    const current = session.current
    if (!current) return
    if (current.pendingRects) {
      const before = current.pendingRects
      current.pendingRects = null
      for (const [card, animation] of current.neighbors) { animation.cancel(); current.animations.delete(animation); current.neighbors.delete(card) }
      const duration = Number(motion.reorder.neighbor.duration ?? 0) * 1000
      for (const slot of slots(current)) {
        if (slot.key === current.key && current.phase !== 'armed') {
          if (!current.mutations.has(slot.card)) current.mutations.set(slot.card, { translate: slot.card.style.translate, transition: slot.card.style.transition, source: slot.card.getAttribute('data-reorder-source') })
          slot.card.dataset.reorderSource = 'true'
        }
        const from = before.get(slot.key) ?? (current.phase !== 'dragging' && current.movedSet.has(slot.key) ? current.overlay?.getBoundingClientRect() : undefined)
        const to = slot.card.getBoundingClientRect()
        if (!from || !duration || slot.key === current.key) continue
        const x = from.left - to.left, y = from.top - to.top
        if (Math.abs(x) < .5 && Math.abs(y) < .5) continue
        const animation = slot.card.animate([{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], { duration, easing: motion.reorder.easing })
        current.animations.add(animation); current.neighbors.set(slot.card, animation)
        void animation.finished.catch(() => {}).then(() => { current.animations.delete(animation); if (current.neighbors.get(slot.card) === animation) current.neighbors.delete(slot.card) })
      }
    }
    if (!options.enabled && (current.phase === 'armed' || current.phase === 'dragging') || options.scopeKey !== current.scopeKey || options.layoutKey !== current.layoutKey || geometryKey !== current.geometryKey
      || current.phase !== 'committing' && current.phase !== 'settling' && (options.sourceVersion !== current.sourceVersion || !sameOrder(options.orderedKeys, current.keys))) dispose(current)
    if (motion.disabled && current.live) {
      for (const animation of current.animations) { animation.finish(); animation.cancel() }
      current.animations.clear(); current.neighbors.clear()
      if (current.ghost) current.ghost.style.transform = 'scale(1)'
    }
  })
  useLayoutEffect(() => () => { const current = session.current; if (current) dispose(current) }, [dispose])
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.detail === 0) return
    if (clickToken.current) { clickToken.current = false; event.preventDefault(); event.stopPropagation() }
  }, [])
  const onKeyDownCapture = useCallback(async (event: ReactKeyboardEvent<HTMLElement>) => {
    const options = latest.current
    if (!options.enabled || !event.altKey || event.ctrlKey || event.metaKey || event.key !== 'ArrowUp' && event.key !== 'ArrowDown' || keyboardBusy.current || session.current) return
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.playlist-card') : null
    const key = card && cardKey(card), index = key ? options.orderedKeys.indexOf(key) : -1
    const target = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (index < 0 || target < 0 || target >= options.orderedKeys.length) return
    event.preventDefault(); event.stopPropagation()
    const orderedKeys = [...options.orderedKeys]; orderedKeys.splice(index, 1); orderedKeys.splice(target, 0, key!)
    keyboardBusy.current = true
    try { const result = await options.onCommit({ expectedKeys: [...options.orderedKeys], orderedKeys }); announce(result.ok ? `已移动到第 ${target + 1} 项` : result.errorMessage ?? '排序未能保存') }
    catch (error) { announce(error instanceof Error ? error.message : '排序未能保存') }
    finally { keyboardBusy.current = false }
  }, [])
  return { onPointerDownCapture, onClickCapture, onKeyDownCapture, announcement, isDragging }
}
