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
    let standardDuration = 0
    let animations: Animation[] = []
    let wheelFrame: number | null = null
    let wheelTime: number | null = null
    let wheelInputTime: number | null = null
    let wheelDrive = 0
    let wheelVelocity = 0
    type WheelReturn = { start: number; end: number; anchor: number; from: number; velocity: number; target: number; targetVelocity: number; peak: number; peakTime: number; finished: boolean }
    type WheelModel = {
      position: number; velocity: number; drive: number; time: number | null; inputTime: number | null; tick: number
      peak: number; peakTime: number; deadline: number | null; returning: WheelReturn | null
      sampleTime: number | null; cadence: number; amount: number; amountTime: number; amountPeak: number; weakened: boolean
      returnLevel: number; growthTime: number | null; growthCount: number; growthSample: number | null; growthCadence: number
      sampleMagnitude: number; returnSampleLevel: number; growthSampleCount: number
      stableSamples: number; returnStableLevel: number | null
    }
    function createWheelModel(position = 0): WheelModel {
      return { position, velocity: 0, drive: 0, time: null, inputTime: null, tick: 0, peak: Math.abs(position), peakTime: 0, deadline: null, returning: null, sampleTime: null, cadence: 0, amount: 0, amountTime: 0, amountPeak: 0, weakened: false, returnLevel: 0, growthTime: null, growthCount: 0, growthSample: null, growthCadence: 0, sampleMagnitude: 0, returnSampleLevel: 0, growthSampleCount: 0, stableSamples: 0, returnStableLevel: null }
    }
    let wheelModel = createWheelModel()
    const releaseRemaining = [1, .69, .56, .42, .35, .27, .21, .15, .115, .077, .057, .038, .019, 0]
    const releaseMaxSlope = Math.max(...releaseRemaining.slice(1).map((value, index) => Math.abs(value - releaseRemaining[index]!) * (releaseRemaining.length - 1)))
    let wheelBoundaryFrame: number | null = null
    type PendingWheel = {
      delta: number; beforeTop: number; beforeMax: number; observedTop: number; stableChecks: number
      model: WheelModel
    }
    let wheelPending: PendingWheel | null = null
    let maxTop = 0
    let drag: { id: number; startX: number; startY: number; lastY: number; active: boolean; capture: HTMLElement; previousCursor: string } | null = null
    type TouchDrag = { id: number; startX: number; startY: number; lastY: number; owned: boolean; active: boolean; native: boolean }
    let touch: TouchDrag | null = null
    type TouchScroll = { owner: TouchDrag; top: number; time: number; range: number; direction: number; speed: number }
    let touchScroll: TouchScroll | null = null
    let touchCoast: TouchScroll | null = null
    let coastAnimations: Animation[] | null = null
    let nativeFrame: number | null = null
    let nativePending: { owner: TouchDrag; delta: number; beforeTop: number; beforeMax: number; observedTop: number; stableChecks: number } | null = null
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
      standardDuration = duration('--app-motion-standard')
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
      if (value === 0 && !animations.length && wheelDrive === 0 && wheelVelocity === 0) clearRows()
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
    const stopWheel = () => {
      if (wheelFrame !== null) cancelAnimationFrame(wheelFrame)
      wheelFrame = null
      wheelTime = null
      wheelInputTime = null
      wheelDrive = 0
      wheelVelocity = 0
      wheelModel = createWheelModel(offset)
    }
    const clearWheelPending = () => {
      if (wheelBoundaryFrame !== null) cancelAnimationFrame(wheelBoundaryFrame)
      wheelBoundaryFrame = null
      wheelPending = null
    }
    const interrupt = () => {
      touchCoast = null
      coastAnimations = null
      clearWheelPending()
      stopWheel()
      if (!animations.length) return
      const visual = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset'))
      animations.forEach((animation) => animation.cancel())
      animations = []
      paint(Number.isFinite(visual) ? visual : 0, true)
      rawPull = rawFor(offset)
    }
    const reset = () => {
      touchCoast = null
      touchScroll = null
      coastAnimations = null
      clearNativePending()
      clearWheelPending()
      stopWheel()
      animations.forEach((animation) => animation.cancel())
      animations = []
      rawPull = 0
      paint(0, true)
      metricsReady = false
    }
    const takeCoastOwnership = () => {
      touchCoast = null
      touchScroll = null
      if (coastAnimations) {
        interrupt()
        // A click/key may not produce another drag sample. Release the current
        // painted position rather than leaving a canceled pulse stretched.
        if (offset !== 0) rebound()
      }
    }
    const animateOffsets = (values: number[], options: KeyframeAnimationOptions, timings?: readonly { offset: number; easing?: string }[]) => {
      const frames = (properties: (value: number) => Keyframe) => values.map((value, index) => ({ offset: index / (values.length - 1), ...timings?.[index], ...properties(value) }))
      return [
        panel.animate(frames((value) => ({ '--playlist-overscroll-offset': `${value}px` })), options),
        hero.animate(frames((value) => ({ translate: `0 ${Math.min(0, value)}px`, '--playlist-hero-overscroll-scale': String(scale(value)) })), options),
        ...contents.map((content) => content.animate(frames((value) => ({ translate: `0 ${value}px` })), options)),
        ...[...stretchedCards].map(([card, { factor }]) => card.animate(frames((value) => ({ translate: `0 ${value + Math.max(0, value) * factor}px` })), options)),
      ]
    }
    const rebound = () => {
      interrupt()
      if (offset === 0) return
      ensureMetrics()
      const duration = standardDuration
      if (motionDisabled() || !Number.isFinite(duration) || duration <= 0) { reset(); return }
      const options = { duration, easing: 'linear' }
      const from = offset
      // Sampled reference decay: fast release followed by a monotonic tail.
      // All geometry derives from these same frames, including row spacing.
      const remaining = releaseRemaining
      animations = animateOffsets(remaining.map((fraction) => from * fraction), options)
      const current = animations
      paint(0, true)
      current[current.length - 1]!.onfinish = () => {
        if (animations !== current) return
        animations = []
        if (coastAnimations === current) coastAnimations = null
        rawPull = 0
        paint(0, true)
        metricsReady = false
      }
    }
    const impactTouchCoast = (direction: number, speed: number) => {
      if (strength() <= 0 || standardDuration <= 0 || offset !== 0 || animations.length) return
      const entry = standardDuration / 3
      // Native scroll reports real motion, not an exact physical overflow.
      // Convert its recent speed into a bounded, theme-scaled impact pulse.
      const target = resisted(-direction * speed * entry)
      if (!target) return
      interrupt()
      maxTop = Math.max(0, panel.scrollHeight - panel.clientHeight)
      prepareRows(direction < 0)
      // One timeline crosses the peak with zero velocity on both sides. A
      // finish callback must not park there before starting a second animation.
      animations = animateOffsets([0, target, 0], { duration: entry + standardDuration, easing: 'linear' }, [
        { offset: 0, easing: 'ease-out' },
        { offset: entry / (entry + standardDuration), easing: 'cubic-bezier(.2, 0, .2, 1)' },
        { offset: 1 },
      ])
      const current = animations
      coastAnimations = current
      paint(0, true)
      current[current.length - 1]!.onfinish = () => {
        if (animations !== current || coastAnimations !== current) return
        animations = []
        coastAnimations = null
        rawPull = 0
        paint(0, true)
        metricsReady = false
      }
    }
    const scroll = (delta: number, wheelInput = false) => {
      const enabled = strength() > 0
      if (offset === 0 && !animations.length) maxTop = Math.max(0, panel.scrollHeight - panel.clientHeight)
      interrupt()
      if (!enabled) { rawPull = 0; paint(0) }
      if (enabled && rawPull * delta > 0) {
        const release = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(rawPull))
        rawPull -= release
        paint(resisted(rawPull))
        delta -= release
      }
      const top = panel.scrollTop
      const projected = top + delta
      const bounded = Math.min(maxTop, Math.max(0, projected))
      // Even assigning the same boundary can cancel a native wheel animation.
      // Only a reverse wheel's remaining inward movement needs a real write.
      if (!wheelInput || bounded !== top) panel.scrollTop = bounded
      const excess = projected - bounded
      if (enabled && Math.abs(excess) > 0.01) {
        prepareRows(excess < 0)
        rawPull -= excess
        // Active input owns one accumulated pull, painted at most once per
        // frame. Starting an outward animation per wheel sample repeatedly
        // canceled/recreated every row animation and restarted its easing.
        paint(resisted(rawPull))
      }
    }
    const loadWheel = () => {
      Object.assign(wheelModel, { position: offset, velocity: wheelVelocity, drive: wheelDrive, time: wheelTime, inputTime: wheelInputTime })
      return wheelModel
    }
    const saveWheel = () => {
      offset = wheelModel.position
      wheelVelocity = wheelModel.velocity
      wheelDrive = wheelModel.drive
      wheelTime = wheelModel.time
      wheelInputTime = wheelModel.inputTime
      rawPull = rawFor(offset)
    }
    const solveWheel = (model: WheelModel, elapsed: number, decay: number, follow: number) => {
      const particular = follow * follow * model.drive / ((follow - decay) ** 2)
      const position = model.position - particular
      const velocity = model.velocity + decay * particular + follow * position
      const restoring = Math.exp(-decay * elapsed), following = Math.exp(-follow * elapsed)
      return {
        position: (position + velocity * elapsed) * following + particular * restoring,
        velocity: (velocity - follow * (position + velocity * elapsed)) * following - decay * particular * restoring,
        drive: model.drive * restoring,
      }
    }
    const amountAt = (model: WheelModel, now: number) => model.amount * Math.exp(-Math.max(0, now - model.amountTime) / Math.max(standardDuration / 3, model.cadence * 1.5, 1))
    const releaseAt = (progress: number) => {
      const at = Math.max(0, Math.min(1, progress)) * (releaseRemaining.length - 1)
      const index = Math.min(releaseRemaining.length - 2, Math.floor(at))
      const slope = (releaseRemaining[index + 1]! - releaseRemaining[index]!) * (releaseRemaining.length - 1)
      return { value: releaseRemaining[index]! + slope * (at - index) / (releaseRemaining.length - 1), slope }
    }
    const reclaimWheel = (model: WheelModel, now: number) => {
      model.returning = null
      model.deadline = null
      model.peak = Math.abs(model.position)
      model.peakTime = now
      model.amountPeak = Math.max(amountAt(model, now), Number.EPSILON)
      model.weakened = false
      model.growthTime = null
      model.growthCount = 0
      model.growthSample = null
      model.growthCadence = 0
      model.growthSampleCount = 0
      model.returnStableLevel = null
      if (Math.abs(model.drive) < Math.abs(model.position)) model.drive = model.position
    }
    const recordWheelInput = (model: WheelModel, delta: number, now: number) => {
      const magnitude = Math.abs(delta)
      const previousMagnitude = model.sampleMagnitude
      const gap = model.sampleTime === null ? Infinity : Math.max(0, now - model.sampleTime)
      const fresh = gap >= standardDuration
      model.stableSamples = !fresh && magnitude >= previousMagnitude ? model.stableSamples + 1 : 1
      const amount = amountAt(model, now) + Math.abs(delta)
      if (fresh) {
        reclaimWheel(model, now)
        model.amountPeak = amount
      } else {
        if (gap > 0) model.cadence = model.cadence ? model.cadence * .75 + gap * .25 : gap
        model.amountPeak = Math.max(model.amountPeak, amount)
        model.weakened = amount < model.amountPeak * .85
      }
      model.amount = amount
      model.amountTime = now
      model.sampleTime = now
      model.inputTime = Math.max(model.inputTime ?? now, now)
      // Compare renewed intent with the recent tail, not the strength of a
      // gesture that may have ended seconds ago. Sample-after-input minima
      // avoid treating the empty gaps inside grouped tail packets as intent.
      if (model.returning) model.returnLevel = Math.min(model.returnLevel, Math.max(amount, Number.EPSILON))
      if (model.returning) {
        model.returnSampleLevel = Math.min(model.returnSampleLevel, magnitude)
        // Freeze a known stable stream at return entry. A pause may resume at
        // that same strength; once a weaker tail arrives it loses this permit
        // permanently, rather than inheriting a progressively lower baseline.
        if (model.returnStableLevel !== null && magnitude < model.returnStableLevel) model.returnStableLevel = null
        const stableResume = model.returnStableLevel !== null && magnitude >= model.returnStableLevel
        // Packet compression can raise the rate envelope while every actual
        // sample is weakening. Require sustained sample-level growth too;
        // equal strong samples still allow a new steady gesture to take over.
        model.growthSampleCount = (magnitude > model.returnSampleLevel * 1.25 || stableResume) && magnitude >= previousMagnitude ? model.growthSampleCount + 1 : 0
      }
      model.sampleMagnitude = magnitude
      // Browser wheel input has no reliable contact-up phase. This relative
      // intent gate preserves constant slow streams; it is not finger telemetry.
      if (model.returning && amount > model.returnLevel * 1.25) {
        model.growthTime ??= now
        if (model.growthSample !== null && now > model.growthSample) {
          const interval = now - model.growthSample
          model.growthCadence = model.growthCadence ? model.growthCadence * .75 + interval * .25 : interval
        }
        model.growthSample = now
        model.growthCount++
      } else {
        model.growthTime = null
        model.growthCount = 0
        model.growthSample = null
        model.growthCadence = 0
      }
      model.deadline = null // An actual new edge sample owns its own input time.
      model.drive = resisted(rawFor(model.drive) + delta)
    }
    const beginWheelReturn = (model: WheelModel, now: number) => {
      const duration = standardDuration
      let end = Math.min(model.peakTime + duration, model.deadline ?? Infinity)
      let anchor = model.peakTime + duration / 2
      const reference = releaseAt(.5)
      let target = Math.sign(model.position) * model.peak * reference.value
      let targetVelocity = Math.sign(model.position) * model.peak * reference.slope / duration
      const slope = (target - model.position) / (anchor - now)
      const alpha = model.velocity / slope, beta = targetVelocity / slope
      // C1 and monotonicity alone permit a very short bridge to collapse most
      // of the visible stretch in one frame. Bound its exact quadratic speed
      // against the shared release curve, retaining the normal accepted bridge.
      const speedLimit = Math.max(Math.abs(model.velocity), 1.5 * releaseMaxSlope * Math.max(model.peak, Math.abs(model.position)) / duration)
      const maximumSpeed = (span: number, to: number, toVelocity: number) => {
        if (span <= 0) return Infinity
        const a = 6 * (model.position - to) / span + 3 * (model.velocity + toVelocity)
        const b = -6 * (model.position - to) / span - 4 * model.velocity - 2 * toVelocity
        const at = -b / (2 * a)
        const velocities = [model.velocity, toVelocity]
        if (at > 0 && at < 1) velocities.push((a * at + b) * at + model.velocity)
        return Math.max(...velocities.map((velocity) => -Math.sign(model.position) * velocity))
      }
      // The sampled tail reaches zero only at its original peak + R. An
      // earlier native-history deadline needs a complete bridge to zero.
      const sharedEnd = model.peakTime + duration
      if (Math.abs(end - sharedEnd) > 0.001 || anchor <= now || anchor >= end || slope * model.position >= 0 || alpha < 0 || beta < 0 || alpha * alpha + beta * beta > 9 || maximumSpeed(anchor - now, target, targetVelocity) > speedLimit) {
        target = 0
        targetVelocity = 0
        const maximumSpan = Math.min(duration, model.velocity * model.position < 0 ? 3 * Math.abs(model.position / model.velocity) : duration)
        let span = Math.min(maximumSpan, Math.max(0, end - now))
        if (maximumSpeed(span, 0, 0) > speedLimit) {
          // A late confirmation cannot recover its elapsed deadline. Extend
          // only as far as a continuous bounded-speed return needs, at most R.
          let low = span, high = maximumSpan
          for (let index = 0; index < 12; index++) {
            const middle = (low + high) / 2
            if (maximumSpeed(middle, 0, 0) > speedLimit) low = middle
            else high = middle
          }
          span = high
        }
        end = now + span
        anchor = end
      }
      model.returning = { start: now, end, anchor, from: model.position, velocity: model.velocity, target, targetVelocity, peak: model.peak, peakTime: model.peakTime, finished: false }
      model.returnLevel = Math.max(amountAt(model, now), Number.EPSILON)
      model.growthTime = null
      model.growthCount = 0
      model.growthSample = null
      model.growthCadence = 0
      model.returnSampleLevel = model.sampleMagnitude
      model.growthSampleCount = 0
      model.returnStableLevel = model.stableSamples >= 3 ? model.sampleMagnitude : null
    }
    const sampleWheelReturn = (model: WheelModel, now: number) => {
      const phase = model.returning!
      if (now >= phase.end) {
        model.position = 0
        model.velocity = 0
        model.drive = 0
        phase.finished = true
        return
      }
      if (now >= phase.anchor && phase.anchor < phase.end) {
        const reference = releaseAt((now - phase.peakTime) / standardDuration)
        model.position = Math.sign(phase.from) * phase.peak * reference.value
        model.velocity = Math.sign(phase.from) * phase.peak * reference.slope / standardDuration
        return
      }
      const duration = phase.anchor - phase.start
      const t = Math.max(0, Math.min(1, (now - phase.start) / duration))
      const t2 = t * t, t3 = t2 * t
      model.position = (2 * t3 - 3 * t2 + 1) * phase.from + (t3 - 2 * t2 + t) * duration * phase.velocity + (-2 * t3 + 3 * t2) * phase.target + (t3 - t2) * duration * phase.targetVelocity
      model.velocity = (6 * t2 - 6 * t) * phase.from / duration + (3 * t2 - 4 * t + 1) * phase.velocity + (-6 * t2 + 6 * t) * phase.target / duration + (3 * t2 - 2 * t) * phase.targetVelocity
    }
    const checkWheelIntent = (model: WheelModel, now: number) => {
      if (model.returning) {
        if (amountAt(model, now) <= model.returnLevel * 1.25) {
          model.growthTime = null
          model.growthCount = 0
          model.growthSample = null
          model.growthCadence = 0
          model.growthSampleCount = 0
        } else if (model.growthCount >= 3 && model.growthSampleCount >= 2 && model.growthTime !== null && now - model.growthTime >= Math.max(standardDuration / 4, model.growthCadence * 2)) {
          model.cadence = model.growthCadence
          reclaimWheel(model, now)
        }
        return
      }
      const quiet = model.inputTime !== null && now - model.inputTime >= Math.max(standardDuration / 8, model.cadence * 2)
      if ((quiet || model.weakened) && model.position * model.velocity < 0 && model.peak > 0 && Math.abs(model.position) <= model.peak * .9) beginWheelReturn(model, now)
    }
    const advanceWheelModel = (model: WheelModel, now: number) => {
      if (model.time === null) return
      const end = Math.max(model.time, now), duration = standardDuration
      if (duration <= 0 || motionDisabled()) {
        Object.assign(model, createWheelModel())
        model.time = end
        return
      }
      const decay = 3 / (duration * 1.8), follow = 4 * decay, tick = duration / 16
      if (model.tick <= model.time) model.tick = model.time + tick
      while (model.time < end) {
        if (model.returning?.finished) {
          model.drive *= Math.exp(-decay * (end - model.time))
          model.time = end
          checkWheelIntent(model, end)
          break
        }
        const from = model.time
        const quietAt = (model.inputTime ?? from) + duration
        const to = Math.min(end, model.tick, quietAt > from ? quietAt : Infinity)
        const rate = from >= quietAt ? 18 / duration : decay
        if (model.returning) {
          model.drive *= Math.exp(-rate * (to - from))
          sampleWheelReturn(model, to)
        } else {
          const before = { ...model }
          const next = solveWheel(model, to - from, rate, follow)
          const direction = Math.sign(model.position || model.drive)
          if (direction * model.velocity >= 0 && direction * next.velocity < 0) {
            let low = 0, high = to - from
            for (let index = 0; index < 16; index++) {
              const middle = (low + high) / 2
              if (direction * solveWheel(before, middle, rate, follow).velocity >= 0) low = middle
              else high = middle
            }
            model.peakTime = from + (low + high) / 2
            model.peak = Math.abs(solveWheel(before, model.peakTime - from, rate, follow).position)
          } else if (direction * next.velocity > 0) {
            model.peakTime = to
            model.peak = Math.abs(next.position)
          }
          Object.assign(model, next)
        }
        model.time = to
        if (to >= model.tick) {
          checkWheelIntent(model, to)
          model.tick += tick
        }
        if (!model.returning && Math.abs(model.position) < .1 && Math.abs(model.drive) < .1 && Math.abs(model.velocity) < .1 * follow) {
          model.position = 0
          model.drive = 0
          model.velocity = 0
          model.time = end
          break
        }
      }
    }
    const advanceWheel = (now: number) => {
      advanceWheelModel(loadWheel(), now)
      saveWheel()
    }
    const presentWheel = (now: number) => {
      wheelFrame = null
      advanceWheel(now)
      paint(offset, true)
      if ((!wheelModel.returning?.finished || (wheelModel.growthCount >= 3 && wheelModel.growthSampleCount >= 2)) && (offset !== 0 || wheelDrive !== 0 || wheelVelocity !== 0)) wheelFrame = requestAnimationFrame(presentWheel)
      else if (!wheelModel.returning) { wheelTime = null; metricsReady = false }
    }
    const scheduleWheel = () => {
      if (drag?.active || touch?.active || (wheelModel.returning?.finished && (wheelModel.growthCount < 3 || wheelModel.growthSampleCount < 2)) || (offset === 0 && wheelDrive === 0 && wheelVelocity === 0)) return
      if (visualFrame !== null) cancelAnimationFrame(visualFrame)
      visualFrame = null
      if (wheelFrame === null) wheelFrame = requestAnimationFrame(presentWheel)
    }
    const pullWheel = (delta: number, now: number) => {
      if (strength() <= 0) { reset(); return }
      if (wheelTime === null) {
        interrupt()
        wheelDrive = offset
        wheelVelocity = 0
        wheelTime = now
      }
      const model = loadWheel()
      recordWheelInput(model, delta, now)
      if (!model.tick) model.tick = now + standardDuration / 16
      saveWheel()
      scheduleWheel()
    }
    const advanceNativeWheel = (pending: PendingWheel, now: number) => advanceWheelModel(pending.model, now)
    const consumeNativeWheel = () => {
      const pending = wheelPending
      if (!pending) return
      const towardTop = pending.delta < 0, top = panel.scrollTop
      if (towardTop ? top > 0 : top < pending.beforeMax) return
      const now = performance.now()
      advanceNativeWheel(pending, now)
      clearWheelPending()
      const shadow = pending.model
      if (shadow.inputTime === null || strength() <= 0) return
      maxTop = pending.beforeMax
      prepareRows(towardTop)
      if (wheelTime === null) interrupt()
      else advanceWheel(now)
      // Keep native delivery on its real input/peak clock. Historical motion
      // already in return is never replayed as a fresh visible outward pulse.
      wheelModel = { ...shadow, position: offset, velocity: wheelVelocity, time: Math.max(wheelTime ?? now, now), deadline: shadow.peakTime + standardDuration }
      if (shadow.returning) {
        if (offset === 0 && wheelVelocity === 0) {
          wheelModel.returning = { ...shadow.returning, finished: true }
          wheelModel.drive = 0
        } else {
          // Native pending normally has no live presentation. If another
          // owner left a visible remainder, keep advancing it continuously;
          // a finished phase must never suppress a nonzero position/velocity.
          wheelModel.returning = null
          wheelModel.drive = offset
          wheelModel.peak = Math.abs(offset)
          wheelModel.weakened = true
        }
      }
      saveWheel()
      scheduleWheel()
    }
    const checkWheelBoundary = () => {
      if (wheelBoundaryFrame !== null || !wheelPending) return
      const owner = wheelPending
      wheelBoundaryFrame = requestAnimationFrame(() => {
        wheelBoundaryFrame = null
        if (wheelPending !== owner) return
        consumeNativeWheel()
        if (wheelPending !== owner) return
        const top = panel.scrollTop
        const wrongDirection = owner.delta < 0 ? top > owner.beforeTop + 1 : top < owner.beforeTop - 1
        if (wrongDirection) { clearWheelPending(); return }
        owner.stableChecks = Math.abs(top - owner.observedTop) < 0.01 ? owner.stableChecks + 1 : 0
        owner.observedTop = top
        const projection = owner.beforeTop + owner.delta
        const inside = projection >= 0 && projection <= owner.beforeMax
        if (inside && (Math.abs(top - projection) <= 1 || owner.stableChecks >= 2)) clearWheelPending()
        else if (owner.stableChecks < 2) checkWheelBoundary()
        // A delayed native commit wakes this check through the scroll event;
        // never poll an idle scrollport indefinitely.
      })
    }
    const queueNativeWheel = (delta: number, top: number, boundary: number, now: number) => {
      if (wheelPending && Math.sign(wheelPending.delta) !== Math.sign(delta)) clearWheelPending()
      if (!wheelPending) wheelPending = { delta: 0, beforeTop: top, beforeMax: boundary, observedTop: top, stableChecks: 0, model: createWheelModel() }
      const pending = wheelPending
      advanceNativeWheel(pending, now)
      const available = delta < 0 ? pending.beforeTop : pending.beforeMax - pending.beforeTop
      const previousExcess = Math.max(0, Math.abs(pending.delta) - available)
      pending.delta += delta
      pending.stableChecks = 0
      const excess = Math.max(0, Math.abs(pending.delta) - available) - previousExcess
      // Deduct the frozen native range in sample order. Only overflow enters
      // this bounded shadow driver, with its original input time preserved.
      if (excess > 0 && strength() > 0) {
        pending.model.time ??= now
        if (!pending.model.tick) pending.model.tick = now + standardDuration / 16
        recordWheelInput(pending.model, -Math.sign(delta) * excess, now)
      }
      checkWheelBoundary()
    }
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      takeCoastOwnership()
      const delta = event.deltaY * (event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(panel).lineHeight) || 16 : event.deltaMode === 2 ? panel.clientHeight : 1)
      const now = performance.now()
      advanceWheel(now)
      if (wheelPending && Math.sign(wheelPending.delta) !== Math.sign(delta)) clearWheelPending()
      // Settle older native samples before considering this event so its delta
      // cannot be counted in both the native ledger and direct edge feedback.
      consumeNativeWheel()
      const boundary = offset !== 0 || animations.length ? maxTop : Math.max(0, panel.scrollHeight - panel.clientHeight)
      const top = panel.scrollTop
      const outward = (top <= 0 && delta < 0) || (top >= boundary && delta > 0)
      if (!offset && !wheelDrive && !animations.length && !outward) {
        if (wheelTime !== null) { stopWheel(); paint(0, true) }
        queueNativeWheel(delta, top, boundary, now)
        return
      }
      event.preventDefault()
      if (animations.length) interrupt()
      if (offset * delta > 0 || wheelDrive * delta > 0) {
        // Opposite input explicitly takes ownership from the spring. Release
        // the visible distance first, then scroll only its inward remainder;
        // a lagging presentation must not stay stretched inside the range.
        rawPull = rawFor(offset)
        scroll(delta, true)
        if (offset !== 0) {
          wheelDrive = offset
          wheelVelocity = 0
          wheelTime = Math.max(wheelTime ?? now, now)
          wheelInputTime = now
          wheelModel.sampleMagnitude = Math.abs(delta)
          scheduleWheel()
        }
      } else {
        if (offset === 0 && wheelDrive === 0 && !animations.length) maxTop = boundary
        prepareRows(delta < 0)
        pullWheel(-delta, now)
      }
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
      if (previous?.active) rebound()
    }
    const down = (event: PointerEvent) => {
      takeCoastOwnership()
      if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      // Cards remain click candidates until a vertical drag is established.
      if (target?.closest('input, textarea, select, a, [contenteditable="true"], button:not(.playlist-card)')) return
      clearWheelPending()
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
      scroll(drag.lastY - event.clientY)
      drag.lastY = event.clientY
    }
    const end = (event: PointerEvent) => { if (drag?.id === event.pointerId) finish() }
    const click = (event: MouseEvent) => {
      if (!suppressClickRef.current || event.detail === 0) return
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    const clearNativePending = () => {
      if (nativeFrame !== null) cancelAnimationFrame(nativeFrame)
      nativeFrame = null
      nativePending = null
    }
    const checkNativeBoundary = () => {
      if (nativeFrame !== null || !nativePending) return
      const owner = nativePending.owner
      nativeFrame = requestAnimationFrame(() => {
        nativeFrame = null
        const pending = nativePending
        if (!pending || touch !== owner || owner.owned || !owner.active || touchBlocked) return
        const top = panel.scrollTop
        const towardTop = pending.delta < 0
        const atBoundary = towardTop ? top <= 0 : top >= pending.beforeMax
        if (atBoundary) {
          // Freeze the first sample's range. Native commits may arrive after
          // the last touchmove; consume the outward remainder exactly once.
          const available = towardTop ? pending.beforeTop : pending.beforeMax - pending.beforeTop
          const excess = Math.sign(pending.delta) * Math.max(0, Math.abs(pending.delta) - available)
          nativePending = null
          if (Math.abs(excess) > 0.01) {
            maxTop = pending.beforeMax
            interrupt()
            prepareRows(towardTop)
            rawPull -= excess
            paint(resisted(rawPull), true)
            panel.dataset.touchDragging = 'true'
          }
          return
        }
        if (offset !== 0 || animations.length) {
          reset()
          delete panel.dataset.touchDragging
          return
        }
        const projection = pending.beforeTop + pending.delta
        const inside = projection >= 0 && projection <= pending.beforeMax
        pending.stableChecks = Math.abs(top - pending.observedTop) < 0.01 ? pending.stableChecks + 1 : 0
        pending.observedTop = top
        // Settled ordinary scrolling calibrates away native touch slop. An
        // outward projection waits for scroll notification, never an idle loop.
        if (inside && (Math.abs(top - projection) <= 1 || pending.stableChecks >= 2)) nativePending = null
        else if (pending.stableChecks < 2) checkNativeBoundary()
      })
    }
    const queueNativeInput = (owner: TouchDrag, delta: number) => {
      if (!delta) return
      if (!touchScroll || touchScroll.owner !== owner) touchScroll = { owner, top: panel.scrollTop, time: performance.now(), range: Math.max(0, panel.scrollHeight - panel.clientHeight), direction: Math.sign(delta), speed: 0 }
      if (nativePending && Math.sign(nativePending.delta) !== Math.sign(delta)) clearNativePending()
      if (rawPull * delta > 0) {
        // The browser owns this pan. Reverse input releases our visual feedback
        // while its ordinary scrolling and inertia continue unchanged.
        reset()
        delete panel.dataset.touchDragging
      }
      if (!nativePending) {
        const top = panel.scrollTop
        nativePending = { owner, delta, beforeTop: top, beforeMax: Math.max(0, panel.scrollHeight - panel.clientHeight), observedTop: top, stableChecks: 0 }
      } else {
        nativePending.delta += delta
        nativePending.stableChecks = 0
      }
      checkNativeBoundary()
    }
    const nativeScroll = () => {
      if (nativePending) checkNativeBoundary()
      if (wheelPending) checkWheelBoundary()
      const sample = touch?.active && touch.native ? touchScroll : touchCoast
      if (!sample) return
      const now = performance.now(), top = panel.scrollTop
      const range = Math.max(0, panel.scrollHeight - panel.clientHeight)
      ensureMetrics()
      if (range !== sample.range || now - sample.time > standardDuration * 2) {
        if (sample === touchCoast) touchCoast = null
        else touchScroll = null
        return
      }
      const distance = top - sample.top
      if (!distance) return
      const direction = Math.sign(distance)
      if (sample === touchCoast && direction !== sample.direction) { touchCoast = null; return }
      const speed = Math.abs(distance) / Math.max(1, now - sample.time)
      const atEdge = direction < 0 ? top <= 0 : top >= range
      if (sample === touchCoast && atEdge) {
        // Consume only an observed interior-to-edge commit, once. A scrollend
        // following this commit may clear provenance but must not cancel pulse.
        touchCoast = null
        // A lone late edge commit may only settle the final finger sample.
        // Require observed interior motion, rather than inventing an impact
        // from its clamped distance or the finger's projected overflow.
        if (sample.speed > 0) impactTouchCoast(direction, sample.speed)
        return
      }
      if (!atEdge) sample.speed = direction === sample.direction ? speed : 0
      sample.direction = direction
      sample.top = top
      sample.time = now
    }
    const finishTouch = (shouldRebound: boolean, allowCoast = false) => {
      const previous = touch
      const sample = touchScroll
      // A committed edge scroll may precede touchend in the same task, before
      // the pending-boundary RAF can paint. Preserve that confirmed arrival.
      const pendingEdge = nativePending?.owner === previous && sample?.owner === previous
        && sample.speed > 0 && Math.sign(nativePending.delta) === sample.direction
        && (sample.direction < 0 ? sample.top <= 0 : sample.top >= sample.range)
      touch = null
      touchScroll = null
      clearNativePending()
      delete panel.dataset.touchDragging
      const coast = allowCoast && previous?.active && previous.native && !previous.owned && sample?.owner === previous && offset === 0 && !animations.length ? sample : null
      if (previous?.active && shouldRebound) rebound()
      if (coast) {
        ensureMetrics()
        if (performance.now() - coast.time <= standardDuration * 2) {
          if (coast.top > 0 && coast.top < coast.range) touchCoast = coast
          else if (pendingEdge) impactTouchCoast(coast.direction, coast.speed)
        }
      }
    }
    const touchStart = (event: TouchEvent) => {
      takeCoastOwnership()
      touchScroll = null
      clearWheelPending()
      if (event.touches.length !== 1) {
        finishTouch(false)
        reset()
        touchBlocked = true
        return
      }
      if (touchBlocked) return
      clearNativePending()
      suppressClickRef.current = false
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, a, [contenteditable="true"], button:not(.playlist-card)')) return
      const first = event.touches[0]!
      touch = { id: first.identifier, startX: first.clientX, startY: first.clientY, lastY: first.clientY, owned: false, active: false, native: false }
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
      if (wheelTime !== null) interrupt()
      const boundary = offset !== 0 || animations.length ? maxTop : Math.max(0, panel.scrollHeight - panel.clientHeight)
      const outward = (panel.scrollTop <= 0 && delta < 0) || (panel.scrollTop >= boundary && delta > 0)
      // Once native pan starts, scrollTop can lag this event. Keep its observed
      // finger input until a scroll notification/frame sees the committed edge.
      if (!touch.owned && (touch.native || !outward || !event.cancelable)) {
        touch.native = true
        queueNativeInput(touch, delta)
        return
      }
      if (event.cancelable) {
        event.preventDefault()
        touch.owned = true
        panel.dataset.touchDragging = 'true'
        scroll(delta)
      } else {
        // A native gesture already owns scrolling. Release visual displacement
        // when it reverses instead of fighting its real scroll position.
        reset()
        delete panel.dataset.touchDragging
      }
    }
    const touchEnd = (event: TouchEvent) => {
      if (!touch || !Array.from(event.touches).some((item) => item.identifier === touch!.id)) finishTouch(true, true)
      if (!event.touches.length) touchBlocked = false
    }
    const touchCancel = (event: TouchEvent) => {
      takeCoastOwnership()
      finishTouch(true)
      touchBlocked = event.touches.length > 0
    }
    const cancel = () => { finish(); finishTouch(false); touchBlocked = false; reset() }
    const leave = () => { if (!drag?.active) finish() }
    const nativeDrag = (event: DragEvent) => { if (drag) event.preventDefault() }
    const selectStart = (event: Event) => { if (drag?.active) event.preventDefault() }
    const clearCoastSource = () => { touchCoast = null }
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
    panel.addEventListener('scroll', nativeScroll, { passive: true })
    panel.addEventListener('scrollend', clearCoastSource)
    window.addEventListener('keydown', takeCoastOwnership)
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
      panel.removeEventListener('scroll', nativeScroll)
      panel.removeEventListener('scrollend', clearCoastSource)
      window.removeEventListener('keydown', takeCoastOwnership)
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
