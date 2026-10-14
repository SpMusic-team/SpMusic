import { useEffect, useRef, type RefObject } from 'react'

// Playlist input stays on the fixed scrollport. Only its contents move, so an
// elastic edge cannot move out from under the pointer or affect the sidebar.
export function usePlaylistOverscroll(panelRef: RefObject<HTMLElement | null>, disabled: boolean, scopeKey: string) {
  const suppressClickRef = useRef(false)
  useEffect(() => {
    const panel = panelRef.current
    const hero = panel?.querySelector<HTMLElement>('.playlist-hero')
    if (!panel || !hero) return
    let offset = 0
    let rawPull = 0
    const stretchedCards = new Map<HTMLElement, { factor: number; previousTranslate: string }>()
    const contents = [...panel.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== hero && !child.classList.contains('playlist-grid'))
    const previousTranslations = new Map([...contents, hero].map((element) => [element, element.style.translate]))
    let visualFrame: number | null = null
    let metricsReady = false
    let heroHeight = 1
    let motionStrength = 0
    let fastDuration = 0
    let standardDuration = 0
    let motionEasing = 'ease-out'
    let animations: Animation[] = []
    let animationTarget = 0
    let returnAfterOutward = false
    let timer: number | null = null
    let maxTop = 0
    let drag: { id: number; startX: number; startY: number; lastY: number; active: boolean; capture: HTMLElement; previousCursor: string } | null = null
    let touch: { id: number; startX: number; startY: number; lastY: number; owned: boolean; active: boolean } | null = null
    let touchBlocked = false
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = panel.closest<HTMLElement>('.spmusic-app') ?? document.documentElement
    const motionDisabled = () => disabled || media.matches || root.dataset.motion === 'off'
    const ensureMetrics = () => {
      if (metricsReady) return
      const styles = getComputedStyle(panel)
      heroHeight = Math.max(1, hero.offsetHeight)
      const distance = Number.parseFloat(styles.getPropertyValue('--player-lyrics-overscroll-distance'))
      motionStrength = Number.isFinite(distance) ? Math.max(0, distance) / 40 : 0
      const duration = (name: string) => {
        const value = styles.getPropertyValue(name).trim()
        const parsed = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
        return Number.isFinite(parsed) ? parsed : 0
      }
      fastDuration = duration('--app-motion-fast')
      standardDuration = duration('--app-motion-standard')
      motionEasing = styles.getPropertyValue('--app-motion-easing').trim() || 'ease-out'
      metricsReady = true
    }
    const strength = () => {
      ensureMetrics()
      if (motionDisabled()) return 0
      return motionStrength
    }
    const response = () => { const amount = strength(); return heroHeight * 0.035 * amount }
    const pullUnit = () => heroHeight * 0.024
    const resisted = (raw: number) => Math.sign(raw) * Math.min(180, response() * Math.log1p(Math.abs(raw) / pullUnit()))
    const rawFor = (value: number) => response() > 0 ? Math.sign(value) * pullUnit() * Math.expm1(Math.abs(value) / response()) : 0
    const clearRows = () => {
      for (const [card, { previousTranslate }] of stretchedCards) {
        if (previousTranslate) card.style.translate = previousTranslate
        else card.style.removeProperty('translate')
      }
      stretchedCards.clear()
    }
    const prepareRows = (stretch: boolean) => {
      if (stretchedCards.size) return
      const bounds = panel.getBoundingClientRect()
      let previousTop = -Infinity
      let row = 0
      // A viewport of buffer hides the transition to the untouched tail. Its
      // geometry remains stationary, so a long playlist cannot grow its range.
      const cards = panel.querySelector('.playlist-grid')?.children ?? []
      const rows: { card: HTMLElement; factor: number }[] = []
      const buffer = Math.max(180, bounds.height)
      const upper = bounds.top - buffer
      const lower = bounds.bottom + buffer
      // DOM order is row order for every supported grid/row layout. Locate the
      // bottom viewport in logarithmic reads instead of measuring 1797 cards.
      let first = 0
      let after = cards.length
      while (first < after) {
        const middle = (first + after) >>> 1
        if (cards[middle]!.getBoundingClientRect().bottom < upper) first = middle + 1
        else after = middle
      }
      // Read the bounded prefix in one pass, before any presentation writes.
      for (let index = first; index < cards.length; index++) {
        const card = cards[index]!
        if (!(card instanceof HTMLElement)) continue
        const rect = card.getBoundingClientRect()
        if (rect.top > lower) break
        if (rect.bottom < upper) continue
        if (Math.abs(card.offsetTop - previousTop) > 1) { row++; previousTop = card.offsetTop }
        rows.push({ card, factor: stretch ? Math.min(1, row * 0.1) : 0 })
      }
      for (const { card, factor } of rows) stretchedCards.set(card, { factor, previousTranslate: card.style.translate })
    }
    const scale = (value: number) => 1 + Math.max(0, value) / heroHeight
    const render = (value: number) => {
      // The diagnostic property is non-inherited. Only the small hero subtree
      // consumes a shared scalar; 1797 cards do not recalculate every frame.
      panel.style.setProperty('--playlist-overscroll-offset', `${value}px`)
      hero.style.setProperty('--playlist-hero-overscroll-scale', String(scale(value)))
      hero.style.translate = `0 ${Math.min(0, value)}px`
      for (const content of contents) content.style.translate = `0 ${value}px`
      for (const [card, { factor }] of stretchedCards) card.style.translate = `0 ${value + Math.max(0, value) * factor}px`
      if (value === 0 && !animations.length) clearRows()
    }
    const paint = (value: number, immediate = false) => {
      offset = value
      if (value !== 0 || animations.length) panel.dataset.overscrolling = 'true'
      else delete panel.dataset.overscrolling
      if (immediate || value === 0) {
        if (visualFrame !== null) cancelAnimationFrame(visualFrame)
        visualFrame = null
        render(value)
      } else if (visualFrame === null) {
        visualFrame = requestAnimationFrame(() => { visualFrame = null; render(offset) })
      }
    }
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      returnAfterOutward = false
    }
    const interrupt = () => {
      clearTimer()
      if (!animations.length) return
      const visual = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset'))
      animations.forEach((animation) => animation.cancel())
      animations = []
      paint(Number.isFinite(visual) ? visual : 0, true)
      rawPull = rawFor(offset)
    }
    const reset = () => {
      clearTimer()
      animations.forEach((animation) => animation.cancel())
      animations = []
      rawPull = 0
      paint(0, true)
      metricsReady = false
    }
    const animate = (target: number, variable: string) => {
      interrupt()
      if (offset === target) return
      ensureMetrics()
      const duration = (variable === '--app-motion-fast' ? fastDuration : standardDuration) * (target === 0 ? 1.8 : 1)
      if (motionDisabled() || !Number.isFinite(duration) || duration <= 0) { reset(); return }
      const options = { duration, easing: target === 0 ? 'linear' : motionEasing }
      const from = offset
      // Sampled reference decay: fast release followed by a monotonic tail.
      // All geometry derives from these same frames, including row spacing.
      const remaining = target === 0 ? [1, .69, .56, .42, .35, .27, .21, .15, .115, .077, .057, .038, .019, 0] : [1, 0]
      const frames = (properties: (value: number) => Keyframe) => remaining.map((fraction, index) => ({
          offset: index / (remaining.length - 1),
          ...properties(target + (from - target) * fraction),
      }))
      animations = [
        panel.animate(frames((value) => ({ '--playlist-overscroll-offset': `${value}px` })), options),
        hero.animate(frames((value) => ({ translate: `0 ${Math.min(0, value)}px`, '--playlist-hero-overscroll-scale': String(scale(value)) })), options),
        ...contents.map((content) => content.animate(frames((value) => ({ translate: `0 ${value}px` })), options)),
        ...[...stretchedCards].map(([card, { factor }]) => card.animate(frames((value) => ({ translate: `0 ${value + Math.max(0, value) * factor}px` })), options)),
      ]
      animationTarget = target
      const current = animations
      paint(target, true)
      current[current.length - 1]!.onfinish = () => {
        if (animations !== current) return
        animations = []
        rawPull = rawFor(target)
        paint(target, true)
        if (target === 0) metricsReady = false
        if (returnAfterOutward && target !== 0 && !drag?.active && !touch?.active) animate(0, '--app-motion-standard')
      }
    }
    const scroll = (delta: number, wheel: boolean) => {
      const enabled = strength() > 0
      if (offset === 0 && !animations.length) maxTop = Math.max(0, panel.scrollHeight - panel.clientHeight)
      const outward = (panel.scrollTop <= 0 && delta < 0) || (panel.scrollTop >= maxTop && delta > 0)
      const previousRaw = rawPull
      interrupt()
      if (!enabled) { rawPull = 0; paint(0) }
      if (enabled && rawPull * delta > 0) {
        const release = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(rawPull))
        rawPull -= release
        paint(resisted(rawPull))
        delta -= release
      }
      const projected = panel.scrollTop + delta
      const bounded = Math.min(maxTop, Math.max(0, projected))
      panel.scrollTop = bounded
      const excess = projected - bounded
      if (enabled && Math.abs(excess) > 0.01) {
        prepareRows(excess < 0)
        if (wheel && outward && previousRaw * excess < 0) rawPull = previousRaw
        rawPull -= excess
        const pull = rawPull
        if (wheel) animate(resisted(pull), '--app-motion-fast')
        else paint(resisted(pull))
        rawPull = pull
      }
    }
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const delta = event.deltaY * (event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(panel).lineHeight) || 16 : event.deltaMode === 2 ? panel.clientHeight : 1)
      const boundary = offset !== 0 || animations.length ? maxTop : Math.max(0, panel.scrollHeight - panel.clientHeight)
      if (!offset && !animations.length && panel.scrollTop + delta >= 0 && panel.scrollTop + delta <= boundary) return
      event.preventDefault()
      scroll(delta, true)
      clearTimer()
      if (!drag?.active && !touch?.active && offset !== 0) timer = window.setTimeout(() => {
        timer = null
        if (animations.length && animationTarget !== 0) returnAfterOutward = true
        else animate(0, '--app-motion-standard')
      }, 120)
    }
    const finish = () => {
      const previous = drag
      drag = null
      delete panel.dataset.dragging
      if (previous) {
        if (previous.previousCursor) previous.capture.style.cursor = previous.previousCursor
        else previous.capture.style.removeProperty('cursor')
        if (previous.capture.hasPointerCapture(previous.id)) previous.capture.releasePointerCapture(previous.id)
      }
      if (previous?.active) animate(0, '--app-motion-standard')
    }
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      // Cards remain click candidates until a vertical drag is established.
      if (target?.closest('input, textarea, select, a, [contenteditable="true"], button:not(.playlist-card)')) return
      const bounds = panel.getBoundingClientRect()
      if (event.clientX >= bounds.left + panel.clientLeft + panel.clientWidth) return // scrollbar
      finish()
      suppressClickRef.current = false
      const capture = target?.closest<HTMLElement>('.playlist-card, .playlist-hero') ?? panel
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastY: event.clientY, active: false, capture, previousCursor: capture.style.cursor }
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      if (!(event.buttons & 1)) { finish(); return }
      if (!drag.active) {
        const vertical = Math.abs(event.clientY - drag.startY)
        if (vertical < 5 || vertical <= Math.abs(event.clientX - drag.startX)) return
        drag.active = true
        suppressClickRef.current = true
        panel.dataset.dragging = 'true'
        const selection = window.getSelection()
        if (selection?.anchorNode && selection.focusNode && panel.contains(selection.anchorNode) && panel.contains(selection.focusNode)) selection.removeAllRanges()
        // Cursor inheritance stays in the small origin subtree, not 1797 cards.
        if (drag.capture !== panel) drag.capture.style.cursor = 'grabbing'
        drag.capture.setPointerCapture(event.pointerId)
      }
      event.preventDefault()
      scroll(drag.lastY - event.clientY, false)
      drag.lastY = event.clientY
    }
    const end = (event: PointerEvent) => { if (drag?.id === event.pointerId) finish() }
    const click = (event: MouseEvent) => {
      if (!suppressClickRef.current || event.detail === 0) return
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    const finishTouch = (rebound: boolean) => {
      const previous = touch
      touch = null
      delete panel.dataset.touchDragging
      if (previous?.active && rebound) animate(0, '--app-motion-standard')
    }
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finishTouch(false)
        reset()
        touchBlocked = true
        return
      }
      if (touchBlocked) return
      suppressClickRef.current = false
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, a, [contenteditable="true"], button:not(.playlist-card)')) return
      const first = event.touches[0]!
      touch = { id: first.identifier, startX: first.clientX, startY: first.clientY, lastY: first.clientY, owned: false, active: false }
    }
    const touchMove = (event: TouchEvent) => {
      if (!touch || touchBlocked || event.touches.length !== 1) return
      const current = event.touches[0]!
      if (current.identifier !== touch.id) return
      const delta = touch.lastY - current.clientY
      touch.lastY = current.clientY
      if (!touch.active) {
        const vertical = Math.abs(current.clientY - touch.startY)
        if (vertical < 5 || vertical <= Math.abs(current.clientX - touch.startX)) return
        touch.active = true
        suppressClickRef.current = true
      }
      const boundary = offset !== 0 || animations.length ? maxTop : Math.max(0, panel.scrollHeight - panel.clientHeight)
      const outward = (panel.scrollTop <= 0 && delta < 0) || (panel.scrollTop >= boundary && delta > 0)
      // Keep native scrolling and inertia in the ordinary range. Touch events
      // continue after native scrolling cancels the corresponding PointerEvent.
      if (!touch.owned && !offset && !animations.length && !outward) return
      if (event.cancelable) {
        event.preventDefault()
        touch.owned = true
        panel.dataset.touchDragging = 'true'
        scroll(delta, false)
      } else if (outward) {
        if (!offset && !animations.length) maxTop = boundary
        interrupt()
        prepareRows(delta < 0)
        rawPull -= delta
        paint(resisted(rawPull))
        panel.dataset.touchDragging = 'true'
      } else {
        // A native gesture already owns scrolling. Release visual displacement
        // when it reverses instead of fighting its real scroll position.
        reset()
        delete panel.dataset.touchDragging
      }
    }
    const touchEnd = (event: TouchEvent) => {
      if (!touch || !Array.from(event.touches).some((item) => item.identifier === touch!.id)) finishTouch(true)
      if (!event.touches.length) touchBlocked = false
    }
    const touchCancel = (event: TouchEvent) => {
      finishTouch(true)
      touchBlocked = event.touches.length > 0
    }
    const cancel = () => { finish(); finishTouch(false); touchBlocked = false; reset() }
    const leave = () => { if (!drag?.active) finish() }
    const nativeDrag = (event: DragEvent) => { if (drag) event.preventDefault() }
    const selectStart = (event: Event) => { if (drag?.active) event.preventDefault() }
    const observer = new MutationObserver(cancel)
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion', 'style'] })
    media.addEventListener('change', cancel)
    panel.addEventListener('wheel', wheel, { passive: false })
    panel.addEventListener('pointerdown', down)
    panel.addEventListener('pointerleave', leave)
    panel.addEventListener('lostpointercapture', end)
    panel.addEventListener('click', click, true)
    panel.addEventListener('dragstart', nativeDrag)
    panel.addEventListener('selectstart', selectStart)
    panel.addEventListener('touchstart', touchStart, { passive: true })
    panel.addEventListener('touchmove', touchMove, { passive: false })
    panel.addEventListener('touchend', touchEnd)
    panel.addEventListener('touchcancel', touchCancel)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', cancel)
      panel.removeEventListener('wheel', wheel)
      panel.removeEventListener('pointerdown', down)
      panel.removeEventListener('pointerleave', leave)
      panel.removeEventListener('lostpointercapture', end)
      panel.removeEventListener('click', click, true)
      panel.removeEventListener('dragstart', nativeDrag)
      panel.removeEventListener('selectstart', selectStart)
      panel.removeEventListener('touchstart', touchStart)
      panel.removeEventListener('touchmove', touchMove)
      panel.removeEventListener('touchend', touchEnd)
      panel.removeEventListener('touchcancel', touchCancel)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      cancel()
      panel.style.removeProperty('--playlist-overscroll-offset')
      hero.style.removeProperty('--playlist-hero-overscroll-scale')
      for (const [element, previousTranslate] of previousTranslations) {
        if (previousTranslate) element.style.translate = previousTranslate
        else element.style.removeProperty('translate')
      }
    }
  }, [panelRef, disabled, scopeKey])
}
