// In-page measurement code for the coverlane harness.
//
// NEW file under tools/thumbnail-benchmark/; the author's existing
// visible-measurement.mjs is untouched.
//
// Everything here runs inside the application's renderer through CDP
// Runtime.evaluate, in the SAME execution context, for the whole duration of one
// user action. That is what makes section 3.1 of the closeout plan satisfiable:
//
//   1. instrumentation is installed BEFORE the input, and installing it must not
//      fetch artwork (listeners and observers only observe);
//   2. `t0 = performance.now()` is taken immediately before `click()` or the
//      first scroll assignment, inside the same evaluated function, so no IPC, no
//      layout wait and no timer can be charged to the wrong side of zero;
//   3. the grid-missing and metadata-not-ready time is INSIDE the total and is
//      also kept as separate marks;
//   4. listeners and rAF loops are torn down at the end of each action, and every
//      unfinished target stays in the record as a failure or a censored sample.
//
// Target sets come from a FROZEN fixture (plan section 3.2), never from "cards
// that happen to own an <img> this run":
//   * `mode: 'cohort'`   - a fixed id list, used for the open/leave actions where
//                          the first screen is the stated target;
//   * `mode: 'exposure'` - a frozen id universe covering the whole list; a card
//                          is registered the first time it becomes visible, so
//                          the denominator is "cards this scroll actually
//                          exposed", not "cards that already had pictures".
//
// Precision boundary, stated in the output and not only in this comment: the
// readiness predicate is a *visible proxy* (decoded image state, computed
// opacity, clipped geometry, N consecutive frames, plus a screenshot). It cannot
// observe GPU compositing or when a frame reaches the panel, and nothing here
// claims it does.

export const PAGE_API_VERSION = 'coverlane-page/2'

const IMG_SELECTOR = 'img.playlist-card-cover-image, img.playlist-card-cover-image-eager'

/** Frame-level and event-level instrumentation. Installed before any action. */
const PAGE_INSTALL_BODY = String.raw`
  const state = {
    version: VERSION,
    installedAt: performance.now(),
    counters: {
      bmpCreateObjectUrl: 0, bmpBytes: 0,
      imageConstructions: 0,
      putImageDataCalls: 0, drawImageCalls: 0,
      imageDecodeCalls: 0,
      imgLoadEvents: 0, imgErrorEvents: 0,
      coverImageLoadCustom: 0, coverImageErrorCustom: 0,
    },
    frames: [],
    longTasks: [],
    domEvents: [],
    action: null,
    frameLoopStopped: false,
  }

  // --- frame intervals and long tasks -------------------------------------
  {
    let last = performance.now()
    const tick = t => {
      state.frames.push(t - last)
      last = t
      if (!state.frameLoopStopped) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  try {
    state.longTaskObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
    })
    state.longTaskObserver.observe({ entryTypes: ['longtask'] })
    state.longTaskSupported = true
  } catch { state.longTaskSupported = false }

  // --- JS pixel-path counters (plan section 4: report JS BMP work) ---------
  // Measurement-time wrapping only; no application file is modified.
  const originalCreateObjectURL = URL.createObjectURL
  URL.createObjectURL = function (object) {
    try {
      if (object && object.type === 'image/bmp') {
        state.counters.bmpCreateObjectUrl += 1
        state.counters.bmpBytes += object.size
      }
    } catch { /* a weird blob must not break the app */ }
    return originalCreateObjectURL.call(URL, object)
  }
  state.counters.createObjectUrlPatched = URL.createObjectURL !== originalCreateObjectURL

  const OriginalImage = window.Image
  window.Image = new Proxy(OriginalImage, {
    construct(target, args, newTarget) {
      state.counters.imageConstructions += 1
      return Reflect.construct(target, args, newTarget)
    },
  })
  state.counters.imagePatched = window.Image !== OriginalImage

  if (typeof CanvasRenderingContext2D === 'function') {
    const proto = CanvasRenderingContext2D.prototype
    if (typeof proto.putImageData === 'function') {
      const original = proto.putImageData
      proto.putImageData = function (...args) {
        state.counters.putImageDataCalls += 1
        return original.apply(this, args)
      }
      state.counters.putImageDataPatched = proto.putImageData !== original
    }
    if (typeof proto.drawImage === 'function') {
      const original = proto.drawImage
      proto.drawImage = function (...args) {
        state.counters.drawImageCalls += 1
        return original.apply(this, args)
      }
      state.counters.drawImagePatched = proto.drawImage !== original
    }
  }
  if (typeof HTMLImageElement !== 'undefined' && typeof HTMLImageElement.prototype.decode === 'function') {
    const originalDecode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function (...args) {
      state.counters.imageDecodeCalls += 1
      return originalDecode.apply(this, args)
    }
    state.counters.decodePatched = HTMLImageElement.prototype.decode !== originalDecode
  }

  // --- image lifecycle capture -------------------------------------------
  // Capture-phase listeners observe every <img> in the app and start no request
  // themselves, so installing them cannot warm a cover.
  document.addEventListener('load', event => {
    const target = event.target
    if (!target || target.tagName !== 'IMG') return
    state.counters.imgLoadEvents += 1
    if (state.action) state.action.events.push({ kind: 'img-load', at: performance.now(), src: sourceOf(target) })
  }, true)
  document.addEventListener('error', event => {
    const target = event.target
    if (!target || target.tagName !== 'IMG') return
    state.counters.imgErrorEvents += 1
    if (state.action) state.action.events.push({ kind: 'img-error', at: performance.now(), src: sourceOf(target) })
  }, true)
  window.addEventListener('spmusic:playlist-cover-image-load', () => {
    state.counters.coverImageLoadCustom += 1
  }, true)
  window.addEventListener('spmusic:playlist-cover-image-error', () => {
    state.counters.coverImageErrorCustom += 1
    if (state.action) state.action.events.push({ kind: 'cover-image-error-event', at: performance.now(), src: null })
  }, true)

  function sourceOf(image) {
    try { return image.currentSrc || image.src || null } catch { return null }
  }

  // --- DOM change capture (observation only) ------------------------------
  const domObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          for (const card of cardsWithin(node)) {
            pushEvent({ kind: 'card-added', at: performance.now(), id: card.dataset.playlistTrackId })
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue
          for (const card of cardsWithin(node)) {
            pushEvent({ kind: 'card-removed', at: performance.now(), id: card.dataset.playlistTrackId })
          }
        }
      } else if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
        const card = record.target.closest('[data-playlist-track-id]')
        pushEvent({ kind: 'img-src', at: performance.now(), id: card ? card.dataset.playlistTrackId : null, src: sourceOf(record.target) })
      }
    }
  })
  domObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
  state.domObserver = domObserver

  function cardsWithin(node) {
    const found = []
    if (node.matches && node.matches('[data-playlist-track-id]')) found.push(node)
    if (node.querySelectorAll) found.push(...node.querySelectorAll('[data-playlist-track-id]'))
    return found
  }
  function pushEvent(entry) {
    state.domEvents.push(entry)
    if (state.action) state.action.events.push(entry)
  }

  // --- helpers ------------------------------------------------------------
  function panelNow() { return document.querySelector('.playlist-panel') }
  function gridNow() { const panel = panelNow(); return panel ? panel.querySelector('.playlist-grid') : null }

  function visibleBounds() {
    const panel = panelNow()
    if (!panel) return null
    const panelRect = panel.getBoundingClientRect()
    const dock = [...document.querySelectorAll('.playlist-playback-dock')].find(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > panelRect.top && rect.top < panelRect.bottom
    })
    const bottom = Math.min(panelRect.bottom, dock ? dock.getBoundingClientRect().top : panelRect.bottom)
    return {
      top: panelRect.top, bottom, left: panelRect.left, right: panelRect.right,
      panelTop: panelRect.top, panelBottom: panelRect.bottom,
      dockTop: dock ? dock.getBoundingClientRect().top : null,
      scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight,
    }
  }

  function clipArea(rect, bounds) {
    if (!bounds) return 0
    const width = Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left))
    const height = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top))
    return width * height
  }

  function cardById(id) {
    const grid = gridNow()
    if (!grid) return null
    return grid.querySelector('[data-playlist-track-id="' + CSS.escape(id) + '"]')
  }
  function imageFor(card) { return card ? card.querySelector(IMG_SELECTOR) : null }

  function cardFacts(card, bounds, opacityThreshold) {
    const image = imageFor(card)
    const rect = card.getBoundingClientRect()
    const opacity = image ? Number(getComputedStyle(image).opacity) : null
    const decoded = Boolean(image && image.complete && image.naturalWidth > 0)
    return {
      area: clipArea(rect, bounds),
      cardRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      hasImage: Boolean(image),
      decoded,
      naturalWidth: image ? image.naturalWidth : 0,
      naturalHeight: image ? image.naturalHeight : 0,
      opacity,
      revealed: Boolean(image && decoded && opacity !== null && opacity >= opacityThreshold),
      srcScheme: schemeOf(sourceOf(image)),
      coverState: card.getAttribute('data-cover-state'),
      contentVisible: card.getAttribute('data-content-visible'),
      unavailable: card.getAttribute('data-unavailable'),
      dataLoaded: image ? image.dataset.loaded : null,
    }
  }

  function schemeOf(src) {
    if (!src) return null
    try {
      const url = new URL(src)
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.host || url.protocol
      return url.protocol
    } catch { return null }
  }

  // Cards currently in the grid, visible or not: needed to detect virtualisation.
  function mountedIds() {
    const grid = gridNow()
    if (!grid) return new Set()
    return new Set([...grid.querySelectorAll('[data-playlist-track-id]')].map(card => card.dataset.playlistTrackId))
  }
  function visibleCards() {
    const grid = gridNow()
    const bounds = visibleBounds()
    if (!grid || !bounds) return []
    return [...grid.querySelectorAll('[data-playlist-track-id]')].filter(card => {
      const rect = card.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
        && rect.right > bounds.left && rect.left < bounds.right
        && rect.width > 0 && rect.height > 0
    })
  }
`

export function pageInstallScript() {
  return `(() => {
    if (window.__coverlane && window.__coverlane.version) {
      return { alreadyInstalled: true, version: window.__coverlane.version }
    }
    const VERSION = ${JSON.stringify(PAGE_API_VERSION)}
    const IMG_SELECTOR = ${JSON.stringify(IMG_SELECTOR)}
    ${PAGE_INSTALL_BODY}
    window.__coverlane = {
      version: VERSION,
      state,
      helpers: {
        visibleBounds, cardById, imageFor, cardFacts, sourceOf, clipArea,
        panelNow, gridNow, mountedIds: typeof mountedIds === 'function' ? mountedIds : undefined,
        visibleCards: typeof visibleCards === 'function' ? visibleCards : undefined,
      },
    }
    return {
      alreadyInstalled: false,
      version: VERSION,
      longTaskSupported: state.longTaskSupported,
      patchState: {
        createObjectUrlPatched: state.counters.createObjectUrlPatched,
        imagePatched: state.counters.imagePatched,
        putImageDataPatched: state.counters.putImageDataPatched,
        drawImagePatched: state.counters.drawImagePatched,
        decodePatched: state.counters.decodePatched,
      },
    }
  })()`
}

/**
 * Run one action with a pre-input t0.
 *
 * `actionScript` is a body evaluated inside this wrapper. It receives `api`,
 * `spec`, `action` and `mark`, and must issue its input through `api.input(fn)`
 * so the input timestamp is recorded at the exact moment the input is issued.
 */
export function pageActionScript(actionScript) {
  return `(async (spec) => {
    const api = window.__coverlane
    if (!api) return { error: 'instrumentation not installed; call install first' }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const raf = () => new Promise(r => requestAnimationFrame(r))
    const opacityThreshold = spec.opacityThreshold
    const requiredFrames = spec.requiredFrames
    const mode = spec.mode || 'cohort'

    const countersBefore = { ...api.state.counters }
    const longTasksBefore = api.state.longTasks.length
    const framesBefore = api.state.frames.length
    const eventsBefore = api.state.domEvents.length

    const action = {
      name: spec.name,
      mode,
      t0: null,
      inputAtByIndex: [],
      t0Count: 0,
      lastInputAt: null,
      stoppedAt: null,
      marks: {},
      events: [],
      samples: 0,
      samplerCostMs: [],
      targets: new Map(),
      registrations: [],   // exposure mode: (ms, id) of each lazy registration
      dereferences: [],    // exposure mode: (ms, id) of each unmount while unready
      errors: [],
    }
    const labelOf = id => {
      if (!spec.labels || !Object.prototype.hasOwnProperty.call(spec.labels, id)) return null
      const label = spec.labels[id]
      if (!label || typeof label !== 'object') return null
      // hasCover is the only field the measurement cares about; null means the
      // card could not be labelled and must stay out of both classes.
      return label.hasCover === true ? true : label.hasCover === false ? false : null
    }
    const universe = new Set(spec.universe || spec.cohort || [])

    function newTarget(id) {
      return {
        id,
        labelHasCover: labelOf(id),
        firstExposedMs: null,
        firstImageMs: null,
        firstDecodedMs: null,
        visibleProxyReadyMs: null,
        readySinceFrame: null,
        longestBlankMs: 0,
        blankStartedAtMs: null,
        blankExposureMs: 0,
        blankAreaMs: 0,
        exposureAreaMs: 0,
        maxArea: 0,
        everExposed: false,
        censoredOffscreen: false,
        unmountedWhileUnready: false,
        domErrors: 0,
        loadEvents: 0,
        identityMismatches: 0,
        lastState: null,
        lastOpacity: null,
        lastScheme: null,
        lastNaturalWidth: 0,
      }
    }
    for (const id of (spec.cohort || [])) action.targets.set(id, newTarget(id))
    api.state.action = action

    let sampleTimer = null
    let sampling = false
    let lastSampleAt = null

    function registerVisibleInExposureMode() {
      if (mode !== 'exposure') return
      const cards = api.helpers.visibleCards()
      for (const card of cards) {
        const id = card.dataset.playlistTrackId
        if (!id || action.targets.has(id) || !universe.has(id)) continue
        action.targets.set(id, newTarget(id))
        action.registrations.push({ id, at: performance.now() - (action.t0 ?? performance.now()) })
      }
    }

    function sampleOnce() {
      if (!sampling) return
      const started = performance.now()
      registerVisibleInExposureMode()
      const bounds = api.helpers.visibleBounds()
      const mark = started
      const dt = lastSampleAt === null ? 0 : Math.max(0, mark - lastSampleAt)
      const mounted = api.helpers.mountedIds()
      const visibleIds = new Set(api.helpers.visibleCards().map(card => card.dataset.playlistTrackId))
      for (const target of action.targets.values()) {
        const card = api.helpers.cardById(target.id)
        if (!card) {
          if (target.everExposed && target.visibleProxyReadyMs === null && !target.censoredOffscreen) {
            target.censoredOffscreen = true
            action.dereferences.push({ id: target.id, at: mark - action.t0 })
          }
          continue
        }
        const facts = api.helpers.cardFacts(card, bounds, opacityThreshold)
        const el = mark - action.t0
        target.lastState = facts.coverState
        target.lastOpacity = facts.opacity
        target.lastScheme = facts.srcScheme
        target.lastNaturalWidth = facts.naturalWidth
        if (facts.area > 0) {
          target.everExposed = true
          if (target.firstExposedMs === null) target.firstExposedMs = el
          if (facts.hasImage && target.firstImageMs === null) target.firstImageMs = el
          if (facts.decoded && target.firstDecodedMs === null) target.firstDecodedMs = el
        }
        if (facts.area > target.maxArea) target.maxArea = facts.area
        const readyNow = facts.area > 0 && facts.revealed
        if (readyNow) {
          target.readySinceFrame = (target.readySinceFrame ?? 0) + 1
          if (target.readySinceFrame >= requiredFrames && target.visibleProxyReadyMs === null) {
            target.visibleProxyReadyMs = el
          }
        } else {
          target.readySinceFrame = null
        }
        // Blank exposure accumulates only while the card is on screen and not yet
        // proxy-ready. Area-weighted, so a half-clipped card costs half.
        if (facts.area > 0 && !readyNow) {
          target.blankAreaMs += facts.area * dt
          target.blankExposureMs += dt
          if (target.blankStartedAtMs === null) target.blankStartedAtMs = el
          const blankDuration = el - target.blankStartedAtMs
          if (blankDuration > target.longestBlankMs) target.longestBlankMs = blankDuration
        } else if (facts.area > 0 && readyNow) {
          target.blankStartedAtMs = null
        }
        if (facts.area > 0) target.exposureAreaMs += facts.area * dt
        // A cohort card that is no longer MOUNTED was virtualised or replaced, not
        // merely scrolled out. Plan section 3.2 requires that to be recorded, and
        // that "the node disappeared" never be counted as a finished cover.
        if (!mounted.has(target.id) && target.everExposed && target.visibleProxyReadyMs === null) {
          if (!target.censoredOffscreen) {
            target.censoredOffscreen = true
            target.unmountedWhileUnready = true
            action.dereferences.push({ id: target.id, at: el, reason: 'unmounted' })
          }
        }
        // A card that scrolled out while still blank is a censored sample, never
        // a success; its accrued blank exposure is kept.
        if (!visibleIds.has(target.id) && target.everExposed && target.visibleProxyReadyMs === null) {
          if (!target.censoredOffscreen) {
            target.censoredOffscreen = true
            action.dereferences.push({ id: target.id, at: el, reason: 'offscreen' })
          }
        }
        // DOM error / identity bookkeeping from the recorded event stream.
        if (facts.area > 0 && !facts.hasImage && facts.coverState === 'error') target.domErrors = Math.max(target.domErrors, 1)
        // Identity: the card returned for this target id must still carry that id.
        // A selector lookup makes a mismatch nearly impossible, which is exactly
        // why it is cheap to check and dishonest to fake: an idle cover state is
        // NOT a mismatch (it means artwork metadata has not arrived yet), and
        // treating it as one inflates the counter without measuring anything.
        if (card.dataset.playlistTrackId && card.dataset.playlistTrackId !== target.id) {
          target.identityMismatches += 1
          action.errors.push('card id ' + card.dataset.playlistTrackId + ' served for target ' + target.id)
        }
      }
      lastSampleAt = mark
      action.samples += 1
      action.samplerCostMs.push(performance.now() - started)
      if (sampling) sampleTimer = requestAnimationFrame(sampleOnce)
    }

    // --- the measured input ------------------------------------------------
    api.input = fn => {
      if (action.t0 === null) action.t0 = performance.now()
      const at = performance.now()
      fn()
      action.t0Count += 1
      action.inputAtByIndex.push(at - action.t0)
      action.lastInputAt = at - action.t0
      if (!sampling) {
        sampling = true
        sampleTimer = requestAnimationFrame(sampleOnce)
      }
      return action.lastInputAt
    }
    const mark = name => { action.marks[name] = performance.now() - action.t0 }

    // --- action body -------------------------------------------------------
    let bodyResult = null
    try {
      bodyResult = await (async () => {
        ${actionScript}
      })()
    } catch (error) {
      action.errors.push('action body threw: ' + String(error && error.message ? error.message : error))
    }

    // --- teardown ----------------------------------------------------------
    sampling = false
    if (sampleTimer !== null) cancelAnimationFrame(sampleTimer)
    action.stoppedAt = action.t0 === null ? null : performance.now() - action.t0
    api.state.action = null

    const countersAfter = { ...api.state.counters }
    const counters = {}
    for (const key of Object.keys(countersAfter)) {
      if (typeof countersAfter[key] === 'number') counters[key] = countersAfter[key] - (countersBefore[key] || 0)
    }
    const actionLongTasks = api.state.longTasks.slice(longTasksBefore)
    const actionFrames = api.state.frames.slice(framesBefore)

    const targets = [...action.targets.values()].map(target => ({
      ...target,
      // "exposed" for exposure mode means the card became visible at some point.
      exposed: target.everExposed,
      ready: target.visibleProxyReadyMs !== null,
      status: target.visibleProxyReadyMs !== null
        ? 'ready'
        : target.censoredOffscreen ? 'censored-offscreen'
          : target.everExposed ? 'not-ready' : 'never-exposed',
      blankAreaMs: Math.round(target.blankAreaMs),
      exposureAreaMs: Math.round(target.exposureAreaMs),
    }))

    const classes = { hasCover: [], noCover: [], unknown: [] }
    for (const target of targets) {
      if (target.labelHasCover === true) classes.hasCover.push(target)
      else if (target.labelHasCover === false) classes.noCover.push(target)
      else classes.unknown.push(target)
    }
    const classify = list => {
      const exposed = list.filter(t => t.exposed)
      const ready = list.filter(t => t.ready)
      // "All covers complete" is computed over the has-cover class only, so a
      // no-cover placeholder can never complete it early. Cards that never became
      // visible are still counted in the class total, so they cannot vanish from
      // the denominator, but they cannot supply a completion time either.
      const exposedSettled = exposed.length > 0
        && exposed.every(t => t.ready || t.status === 'censored-offscreen')
      return {
        count: list.length,
        exposed: exposed.length,
        ready: ready.length,
        notReady: list.filter(t => t.status === 'not-ready').length,
        censoredOffscreen: list.filter(t => t.status === 'censored-offscreen').length,
        neverExposed: list.filter(t => t.status === 'never-exposed').length,
        exposedSettled,
        firstMs: ready.length ? Math.min(...ready.map(t => t.visibleProxyReadyMs)) : null,
        allMs: exposedSettled ? Math.max(...exposed.map(t => t.visibleProxyReadyMs ?? 0)) : null,
        blankExposureMsTotal: Math.round(list.reduce((a, t) => a + t.blankExposureMs, 0)),
        blankAreaMsTotal: list.reduce((a, t) => a + t.blankAreaMs, 0),
        longestBlankMs: list.length ? Math.round(Math.max(...list.map(t => t.longestBlankMs))) : 0,
      }
    }
    const samplerCosts = action.samplerCostMs
    const sortedFrames = [...actionFrames].sort((a, b) => a - b)
    const exposedTargets = targets.filter(t => t.exposed)

    return {
      name: action.name,
      mode,
      bodyResult,
      t0RecordedBeforeInput: action.t0 !== null && action.inputAtByIndex.length > 0,
      t0ToFirstInputMs: action.inputAtByIndex.length ? action.inputAtByIndex[0] : null,
      inputCount: action.t0Count,
      lastInputAtMs: action.lastInputAt,
      elapsedMs: action.stoppedAt,
      marks: action.marks,
      samples: action.samples,
      registrations: action.registrations.length,
      dereferences: action.dereferences.length,
      targets,
      summary: {
        targetCount: targets.length,
        exposedCount: exposedTargets.length,
        ready: targets.filter(t => t.ready).length,
        notReady: targets.filter(t => t.status === 'not-ready').length,
        censoredOffscreen: targets.filter(t => t.status === 'censored-offscreen').length,
        neverExposed: targets.filter(t => t.status === 'never-exposed').length,
        hasCover: classify(classes.hasCover),
        noCover: classify(classes.noCover),
        unknownCover: classify(classes.unknown),
        // Backwards-compatible headline numbers, computed over has-cover only.
        firstCoverMs: classify(classes.hasCover).firstMs,
        allCoverReadyMs: classify(classes.hasCover).allMs,
        blankExposureMsTotal: Math.round(targets.reduce((a, t) => a + t.blankExposureMs, 0)),
        blankAreaMsTotal: targets.reduce((a, t) => a + t.blankAreaMs, 0),
        longestBlankMs: targets.length ? Math.round(Math.max(...targets.map(t => t.longestBlankMs))) : 0,
        domErrors: targets.reduce((a, t) => a + t.domErrors, 0),
        identityMismatches: targets.reduce((a, t) => a + t.identityMismatches, 0),
      },
      counters,
      longTasks: {
        count: actionLongTasks.length,
        totalMs: actionLongTasks.reduce((a, t) => a + t.duration, 0),
        maxMs: actionLongTasks.length ? Math.max(...actionLongTasks.map(t => t.duration)) : 0,
        over50Ms: actionLongTasks.filter(t => t.duration > 50).length,
      },
      frameIntervals: {
        count: actionFrames.length,
        p50Ms: sortedFrames.length ? sortedFrames[Math.floor((sortedFrames.length - 1) * 0.5)] : null,
        p95Ms: sortedFrames.length ? sortedFrames[Math.floor((sortedFrames.length - 1) * 0.95)] : null,
        maxMs: sortedFrames.length ? sortedFrames[sortedFrames.length - 1] : null,
        over50Ms: actionFrames.filter(v => v > 50).length,
      },
      samplerCost: {
        meanMs: samplerCosts.length ? samplerCosts.reduce((a, b) => a + b, 0) / samplerCosts.length : null,
        maxMs: samplerCosts.length ? Math.max(...samplerCosts) : null,
        samples: samplerCosts.length,
      },
      events: action.events.slice(0, 5000),
      eventCount: action.events.length,
      errors: action.errors,
    }
  })`
}

/**
 * Action body: press the list control and measure the whole reveal.
 *
 * The click happens inside `api.input`, so `t0` precedes it in the same context.
 * The grid-missing interval is never subtracted.
 */
export const ACTION_OPEN_LIST = String.raw`
    const budgetMs = spec.budgetMs
    // Candidate order matters: from the media-library surface the entry point is
    // the library row labelled "打开播放列表 <name>", not the dock button.
    const candidates = [
      [...document.querySelectorAll('button')].find(b =>
        ['播放列表', '打开播放列表', '显示播放列表'].includes(b.getAttribute('aria-label'))),
      [...document.querySelectorAll('button')].find(b => /^打开播放列表\s/.test(b.getAttribute('aria-label') || '')),
      [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '打开播放列表'),
      [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '返回播放列表管理'),
    ].filter(Boolean)
    const control = candidates.find(b => !b.disabled)
    if (!control) {
      action.errors.push('list control absent')
      return {
        name: spec.name,
        error: 'list control absent',
        controls: [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 40),
      }
    }
    const controlLabel = control.getAttribute('aria-label')
    api.input(() => control.click())
    const deadline = action.t0 + budgetMs
    let noted = false
    while (performance.now() < deadline) {
      if (!action.marks.panelVisibleMs && document.querySelector('.playlist-panel')) mark('panelVisibleMs')
      if (!action.marks.gridVisibleMs && document.querySelector('.playlist-grid')) mark('gridVisibleMs')
      if (!action.marks.firstCardMs && document.querySelector('.playlist-grid [data-playlist-track-id]')) {
        mark('firstCardMs')
        if (!noted) {
          noted = true
          const grid = document.querySelector('.playlist-grid')
          const first = grid.querySelector('[data-playlist-track-id]')
          const expected = (spec.cohort || [])[0]
          if (expected && first && first.dataset.playlistTrackId !== expected) {
            action.errors.push('cohort slot 0 holds ' + first.dataset.playlistTrackId + ' not ' + expected)
          }
        }
      }
      // The grid can mount before any card is present; a break on the grid alone
      // would then leave the cohort wait below with nothing to observe.
      if (action.marks.firstCardMs) break
      await raf()
    }
    if (!action.marks.firstCardMs) action.errors.push('cohort cards never mounted within budget')
    // Wait for the labelled has-cover cohort to settle. The bound is finite and
    // every target still unready when it expires stays in the record as not-ready
    // or censored; nothing is dropped to make the number look good.
    const waitDeadline = action.t0 + budgetMs
    while (performance.now() < waitDeadline) {
      const values = [...action.targets.values()]
      const hasCover = values.filter(t => t.labelHasCover === true)
      const pending = hasCover.filter(t => t.visibleProxyReadyMs === null && !t.censoredOffscreen)
      if (hasCover.length > 0 && pending.length === 0) break
      // A card that never became visible cannot become ready without a scroll, so
      // waiting on it would burn the whole budget for nothing.
      if (pending.length > 0 && pending.every(t => !t.everExposed)) break
      if (values.length > 0 && values.every(t => t.censoredOffscreen)) break
      await raf()
    }
    await raf(); await raf()
    mark('endMs')
    return { waitedFor: 'has-cover cohort proxy-ready', controlLabel }
`

/** Action body: leave the list panel (return), then stop. */
export const ACTION_LEAVE_LIST = String.raw`
    const budgetMs = spec.budgetMs
    const back = [...document.querySelectorAll('button.playlist-close')][0]
      || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '返回播放列表管理')
    if (!back) {
      action.errors.push('close control absent')
      return { name: spec.name, error: 'close control absent' }
    }
    const before = document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length
    api.input(() => back.click())
    const deadline = action.t0 + budgetMs
    while (performance.now() < deadline) {
      const now = document.querySelectorAll('.playlist-grid [data-playlist-track-id]').length
      if (now < before) { mark('gridDetachedMs'); break }
      await raf()
    }
    await raf(); await raf()
    mark('endMs')
    return { control: back.getAttribute('aria-label') || back.className }
`

/**
 * Action body: one deterministic scroll programme.
 *
 * Every assignment to `scrollTop` goes through `api.input`, so the FIRST input
 * records t0 and the LAST input becomes `tStop`.
 */
export const ACTION_SCROLL = String.raw`
    const panel = document.querySelector('.playlist-panel')
    if (!panel) {
      action.errors.push('panel absent')
      return { name: spec.name, error: 'panel absent' }
    }
    const maxTop = () => Math.max(0, panel.scrollHeight - panel.clientHeight)
    action.marks.startScrollTopPx = panel.scrollTop
    for (const segment of spec.program) {
      if (segment.kind === 'set') {
        api.input(() => { panel.scrollTop = Math.round(maxTop() * segment.fraction) })
        await raf()
      } else if (segment.kind === 'move') {
        const frames = Math.max(1, Math.round(segment.ms / 16.7))
        for (let i = 0; i < frames; i++) {
          api.input(() => { panel.scrollTop = panel.scrollTop + segment.pxPerFrame })
          await raf()
        }
      } else if (segment.kind === 'hold') {
        await sleep(segment.ms)
      } else {
        action.errors.push('unknown segment kind ' + segment.kind)
      }
    }
    mark('tStopMs')
    // Stop-to-settled: bound the wait, keep timeouts as censored not success.
    const stopDeadline = performance.now() + spec.stopBudgetMs
    let settled = false
    while (performance.now() < stopDeadline) {
      const values = [...action.targets.values()].filter(t => t.everExposed)
      const exposedNow = values.filter(t => !t.censoredOffscreen)
      if (exposedNow.length > 0 && exposedNow.every(t => t.visibleProxyReadyMs !== null)) { settled = true; break }
      await raf()
    }
    if (settled) mark('stopSettledMs')
    else mark('stopSettledTimeoutMs')
    await raf(); await raf()
    mark('endMs')
    return {
      startScrollTopPx: action.marks.startScrollTopPx,
      tStopMs: action.marks.tStopMs,
      finalScrollTopPx: panel.scrollTop,
      stopSettled: settled,
    }
`

/** Final state snapshot after all actions: what the DOM actually contains. */
export const PAGE_FINAL_STATE = `(() => {
  const api = window.__coverlane
  if (!api) return { error: 'instrumentation missing; call install first' }
  const { state, helpers } = api
  const grid = helpers.gridNow()
  const cards = grid ? [...grid.querySelectorAll('[data-playlist-track-id]')] : []
  const bounds = helpers.visibleBounds()
  const rows = cards.map(card => {
    const facts = helpers.cardFacts(card, bounds, 0.99)
    return {
      id: card.dataset.playlistTrackId,
      inView: facts.area > 0,
      area: Math.round(facts.area),
      hasImage: facts.hasImage,
      decoded: facts.decoded,
      naturalWidth: facts.naturalWidth,
      naturalHeight: facts.naturalHeight,
      opacity: facts.opacity,
      revealed: facts.revealed,
      srcScheme: facts.srcScheme,
      coverState: facts.coverState,
      contentVisible: facts.contentVisible,
      unavailable: facts.unavailable,
      dataLoaded: facts.dataLoaded,
    }
  })
  const schemes = {}
  const states = {}
  for (const row of rows) {
    const schemeKey = row.srcScheme || 'none'
    schemes[schemeKey] = (schemes[schemeKey] || 0) + 1
    const stateKey = row.coverState || 'none'
    states[stateKey] = (states[stateKey] || 0) + 1
  }
  return {
    page: { version: state.version, installedAt: state.installedAt, longTaskSupported: state.longTaskSupported },
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    grid: grid ? {
      layoutLevel: grid.dataset.layoutLevel,
      layoutColumns: grid.dataset.layoutColumns,
      coverMotion: grid.dataset.coverMotion,
      contentWindow: grid.dataset.contentWindow,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    } : null,
    bounds,
    cardCount: rows.length,
    rows,
    schemes,
    states,
    counters: { ...state.counters },
    longTasks: {
      count: state.longTasks.length,
      over50Ms: state.longTasks.filter(t => t.duration > 50).length,
      maxMs: state.longTasks.length ? Math.max(...state.longTasks.map(t => t.duration)) : 0,
    },
    frames: { count: state.frames.length },
  }
})()`

export async function captureScreenshot(cdp, path, writeFileSync) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path, Buffer.from(result.data, 'base64'))
  return path
}

/** Ordered card ids plus geometry at the moment the fixture is captured. */
export const PAGE_CARD_IDS = `(() => {
  const api = window.__coverlane
  if (!api) return { error: 'installation missing' }
  const { helpers } = api
  const grid = helpers.gridNow()
  if (!grid) return { error: 'no grid' }
  const bounds = helpers.visibleBounds()
  const cards = [...grid.querySelectorAll('[data-playlist-track-id]')]
  return {
    ids: cards.map(card => card.dataset.playlistTrackId),
    geometry: cards.map(card => {
      const rect = card.getBoundingClientRect()
      return {
        id: card.dataset.playlistTrackId,
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        inViewArea: Math.round(helpers.clipArea(rect, bounds)),
      }
    }),
    bounds,
    grid: { layoutLevel: grid.dataset.layoutLevel, layoutColumns: grid.dataset.layoutColumns },
    scrollTop: bounds ? bounds.scrollTop : null,
    scrollHeight: bounds ? bounds.scrollHeight : null,
  }
})()`

/** Probe cover metadata through the application's own command. */
export function probeCoverScript(paths) {
  return `(async () => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke
    if (!invoke) return { error: 'no tauri invoke' }
    const rows = []
    for (const path of ${JSON.stringify(paths)}) {
      try {
        const response = await invoke('audio_probe_playlist_cover', { input: { path } })
        rows.push({
          path,
          id: response && response.id ? response.id : null,
          hasCover: Boolean(response && response.coverArt),
          mimeType: response && response.coverArt ? response.coverArt.mimeType : null,
          byteLen: response && response.coverArt ? response.coverArt.byteLen : null,
          hasFilePath: Boolean(response && response.coverArt && response.coverArt.filePath),
          hasDataUrl: Boolean(response && response.coverArt && response.coverArt.dataUrl),
        })
      } catch (error) {
        rows.push({ path, error: String(error && error.message ? error.message : error) })
      }
    }
    return { rows }
  })()`
}
