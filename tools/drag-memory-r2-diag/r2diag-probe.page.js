(() => {
  const api = window.__coverlane
  if (!api) return { error: 'coverlane instrumentation must be installed first' }
  if (window.__r2diag && window.__r2diag.version === '__VERSION__') {
    return { alreadyInstalled: true, version: window.__r2diag.version }
  }

  const diag = {
    version: '__VERSION__',
    t0: performance.now(),
    inflight: 0,
    inflightPeak: 0,
    predecodes: [],
    predecodeSeq: 0,
    inflightByUrl: new Map(),
    overlapPairs: 0,
    mountSamples: [],
    seenConstructions: 0,
    seenSrcAssignments: 0,
    releasesWithoutEvent: 0,
    domLoads: 0,
    domErrors: 0,
  }

  // The harness already proxied window.Image. Proxy that proxy and keep calling through,
  // so the element application code receives is a genuine HTMLImageElement.
  // Only elements created through `new Image()` are temporary predecodes. The cover
  // elements React mounts are created by the parser/createElement path and their src is
  // set as an ATTRIBUTE, which does not go through the src property setter at all. This
  // distinction is what the first smoke run got wrong: counting every src assignment
  // counted the whole mounted grid and reported an in-flight peak of 1369.
  // Two collections with two different jobs, kept apart on purpose:
  //   constructed - a permanent marker: "this element came from new Image()", i.e. it is a
  //                 temporary predecode and never a mounted cover. A WeakSet is right
  //                 here because the marker must outlive individual requests (a temp can
  //                 be re-src'd after one attempt finished) but must not retain elements.
  //   open        - the elements whose request is currently in flight. A Set, so the
  //                 sweep can iterate exactly the small live set.
  // An earlier version used ONE set for both and deleted from it on release, which made a
  // re-src'd temporary stop being tracked entirely: its later removeAttribute('src') was
  // then never seen and the request stayed open forever.
  const constructed = new WeakSet()
  const open = new Set()
  const currentImage = window.Image
  window.Image = new Proxy(currentImage, {
    construct(target, args, newTarget) {
      diag.seenConstructions += 1
      const element = Reflect.construct(target, args, newTarget)
      constructed.add(element)
      trackElement(element)
      return element
    },
  })
  diag.imageProxied = window.Image !== currentImage

  const elementState = new WeakMap()
  function trackElement(element) {
    if (elementState.has(element)) return
    elementState.set(element, { active: false, url: null, startedAt: 0, id: 0, row: null })
    // Capture listeners are NOT reliable for these: load/error do not bubble on the
    // element itself, and the lane assigns `element.onload` directly, which the
    // application is entitled to replace. A capture listener on the element still fires
    // before the property handler, so it is used here, and the producer's own handler is
    // left untouched (it must keep running: it is what decides the attempt outcome).
    element.addEventListener('load', () => release(element, 'load'), true)
    element.addEventListener('error', () => release(element, 'error'), true)
  }

  function absoluteUrl(value) {
    try { return new URL(value, location.href).href } catch { return String(value) }
  }

  function onSource(element, value) {
    let state = elementState.get(element)
    if (!state) { state = { active: false, url: null, startedAt: 0, id: 0, row: null }; elementState.set(element, state) }
    const next = absoluteUrl(value)
    if (state.active && state.url === next) return
    if (state.active) release(element, 'reassigned')
    const startedAt = performance.now()
    state.active = true
    state.url = next
    state.startedAt = startedAt
    state.id = ++diag.predecodeSeq
    diag.inflight += 1
    if (diag.inflight > diag.inflightPeak) diag.inflightPeak = diag.inflight
    const sameUrl = diag.inflightByUrl.get(next) || 0
    if (sameUrl > 0) diag.overlapPairs += 1
    diag.inflightByUrl.set(next, sameUrl + 1)
    const row = {
      id: state.id,
      url: next,
      startedAt: Math.round(startedAt),
      endedAt: null,
      outcome: null,
      durationMs: null,
      overlapped: sameUrl > 0,
      sameUrlAtStart: sameUrl,
    }
    state.row = row
    open.add(element)
    diag.predecodes.push(row)
    if (diag.predecodes.length > 6000) diag.predecodes.shift()
  }

  function release(element, outcome) {
    const state = elementState.get(element)
    if (!state || !state.active) return
    state.active = false
    const endedAt = performance.now()
    diag.inflight -= 1
    if (diag.inflight < 0) diag.inflight = 0
    const remaining = (diag.inflightByUrl.get(state.url) || 1) - 1
    if (remaining <= 0) diag.inflightByUrl.delete(state.url)
    else diag.inflightByUrl.set(state.url, remaining)
    if (state.row) {
      state.row.endedAt = Math.round(endedAt)
      state.row.outcome = outcome
      state.row.durationMs = Math.round(endedAt - state.startedAt)
    }
    if (outcome === 'reassigned' || outcome === 'detached' || outcome === 'swept') diag.releasesWithoutEvent += 1
    // Only the request is over; the element stays marked as a temporary so a later re-src
    // is still recognised as predecode traffic.
    open.delete(element)
  }

  // Count DOM image outcomes so the predecode volume can be compared with real painting.
  document.addEventListener('load', event => {
    if (event.target && event.target.tagName === 'IMG') diag.domLoads += 1
  }, true)
  document.addEventListener('error', event => {
    if (event.target && event.target.tagName === 'IMG') diag.domErrors += 1
  }, true)

  // A created element only becomes a request when src is assigned; measuring from there
  // is what makes "in flight" mean "a request may exist", not "an object exists".
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  if (srcDescriptor && srcDescriptor.set && srcDescriptor.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDescriptor.enumerable,
      get() { return srcDescriptor.get.call(this) },
      set(value) {
        diag.seenSrcAssignments += 1
        // A DOM cover element that is not a constructed temporary is not a predecode:
        // it is the picture that will be painted, and it stays as long as the row does.
        if (constructed.has(this)) {
          if (value) onSource(this, String(value))
        } else if (value) {
          diag.domSrcAssignments = (diag.domSrcAssignments || 0) + 1
        }
        return srcDescriptor.set.call(this, value)
      },
    })
    diag.srcPatched = true
  }

  // The one release path the lane always takes.
  //
  // playlistCoverPathLane.predecodeCoverImage calls element.removeAttribute('src') in its
  // finish() for EVERY outcome (success, failure, timeout, abort) - it is documented there
  // as "dropping the src cancels a decode still in flight". Removing an ATTRIBUTE does not
  // go through the src property setter, which is why an earlier version of this probe
  // counted 846 temporaries as still running when they had all already finished, and
  // reported an in-flight peak of 1005 for a lane whose width is 4.
  const originalRemoveAttribute = Element.prototype.removeAttribute
  if (typeof originalRemoveAttribute === 'function') {
    Element.prototype.removeAttribute = function (name) {
      const result = originalRemoveAttribute.call(this, name)
      if (typeof name === 'string' && name.toLowerCase() === 'src' && constructed.has(this)) {
        release(this, 'src-removed')
      }
      return result
    }
    diag.removeAttributePatched = true
  }

  /**
   * Release any temporary whose request has already resolved without an observed event.
   *
   * A `complete` element with a natural size (or with naturalWidth 0 and a non-empty
   * currentSrc) is no longer in flight by any definition, so leaving it counted would
   * inflate the peak. This does not invent an outcome: the row records `swept`.
   */
  function sweepResolved() {
    let swept = 0
    for (const element of open) {
      const state = elementState.get(element)
      if (!state || !state.active) continue
      // A resolved request is not in flight whatever its size: a successful decode has
      // naturalWidth > 0, and a failed one keeps its currentSrc while reporting 0.
      if (element.complete) {
        release(element, 'swept')
        swept += 1
      }
    }
    return swept
  }

  function sampleMounts(label) {
    sweepResolved()
    const helpers = api.helpers
    const bounds = helpers.visibleBounds()
    const grid = helpers.gridNow()
    if (!bounds || !grid) return null
    const cards = Array.from(grid.querySelectorAll('[data-playlist-track-id]'))
    const seenUrls = new Map()
    let onscreen = 0, offscreen = 0, onscreenArea = 0, offscreenArea = 0
    let withImage = 0, decodedAny = 0, offscreenDecoded = 0
    let nearestOffscreenDistance = null
    for (const card of cards) {
      const image = helpers.imageFor(card)
      if (!image) continue
      withImage += 1
      const rect = card.getBoundingClientRect()
      const decoded = Boolean(image.complete && image.naturalWidth > 0)
      if (decoded) decodedAny += 1
      const src = image.currentSrc || image.src || null
      const area = decoded ? image.naturalWidth * image.naturalHeight : 0
      if (src) {
        const entry = seenUrls.get(src) || { url: src, elements: 0, area: 0, decoded: 0 }
        entry.elements += 1
        if (decoded) { entry.area = area; entry.decoded += 1 }
        seenUrls.set(src, entry)
      }
      const visible = rect.bottom > bounds.top && rect.top < bounds.bottom
        && rect.right > bounds.left && rect.left < bounds.right
        && rect.width > 0 && rect.height > 0
      if (visible) { onscreen += 1; onscreenArea += area }
      else {
        offscreen += 1; offscreenArea += area
        if (decoded) {
          offscreenDecoded += 1
          const distance = rect.bottom <= bounds.top ? bounds.top - rect.bottom : rect.top - bounds.bottom
          if (nearestOffscreenDistance === null || distance < nearestOffscreenDistance) {
            nearestOffscreenDistance = Math.round(distance)
          }
        }
      }
    }
    let uniqueDecodedArea = 0
    for (const entry of seenUrls.values()) uniqueDecodedArea += entry.area
    const sample = {
      at: Math.round(performance.now()),
      label: label || null,
      cards: cards.length,
      withImage,
      decodedAny,
      onscreen,
      offscreen,
      offscreenDecoded,
      onscreenAreaPx: onscreenArea,
      offscreenAreaPx: offscreenArea,
      uniqueUrls: seenUrls.size,
      uniqueDecodedAreaPx: uniqueDecodedArea,
      duplicateElements: withImage - seenUrls.size,
      nearestOffscreenDistancePx: nearestOffscreenDistance,
      inflight: diag.inflight,
    }
    diag.mountSamples.push(sample)
    if (diag.mountSamples.length > 2000) diag.mountSamples.shift()
    return sample
  }

  function percentile(sorted, p) {
    if (sorted.length === 0) return null
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
    return sorted[index]
  }

  window.__r2diag = {
    version: diag.version,
    state: diag,
    helpers: {
      sampleMounts,
      snapshot(maxRows) {
        const finished = diag.predecodes.filter(r => r.endedAt !== null).map(r => r.durationMs).sort((a, b) => a - b)
        const overlapped = diag.predecodes.filter(r => r.overlapped === true).length
        const stillOpen = diag.predecodes.filter(r => r.endedAt === null).length
        const rows = typeof maxRows === 'number' ? diag.predecodes.slice(-maxRows) : diag.predecodes.slice(-600)
        return {
          version: diag.version,
          elapsedMs: Math.round(performance.now() - diag.t0),
          seenConstructions: diag.seenConstructions,
          seenSrcAssignments: diag.seenSrcAssignments,
          imageProxied: diag.imageProxied,
          srcPatched: diag.srcPatched,
          domLoads: diag.domLoads,
          domErrors: diag.domErrors,
          inflight: diag.inflight,
          inflightPeak: diag.inflightPeak,
          predecodesTotal: diag.predecodes.length,
          predecodesStillOpen: stillOpen,
          predecodesOverlapped: overlapped,
          overlapPairs: diag.overlapPairs,
          releasesWithoutEvent: diag.releasesWithoutEvent,
          uniqueUrlsTouched: new Set(diag.predecodes.map(r => r.url)).size,
          durationMs: {
            count: finished.length,
            p50: percentile(finished, 0.5),
            p90: percentile(finished, 0.9),
            p95: percentile(finished, 0.95),
            p99: percentile(finished, 0.99),
            max: finished.length ? finished[finished.length - 1] : null,
          },
          mountSamples: diag.mountSamples.slice(-400),
          rows,
        }
      },
      recent(maxRows) {
        return diag.predecodes.slice(-(maxRows || 600))
      },
      mountTail(maxRows) {
        return diag.mountSamples.slice(-(maxRows || 400))
      },
      reset() {
        diag.predecodes.length = 0
        diag.mountSamples.length = 0
        diag.overlapPairs = 0
        diag.inflightPeak = diag.inflight
        diag.domLoads = 0
        diag.domErrors = 0
        return true
      },
    },
  }
  return { installed: true, version: diag.version, imageProxied: diag.imageProxied, srcPatched: diag.srcPatched }
})()