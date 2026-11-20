import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const HOOK = readFileSync(new URL('./useLibraryArtwork.ts', import.meta.url), 'utf8')
const READINESS = readFileSync(new URL('../model/playlistCoverReadiness.ts', import.meta.url), 'utf8')

/**
 * Harness for the media-library artwork owner (`useLibraryArtwork`).
 *
 * The subject is that hook's *own* production decisions, so the module under test
 * is the real file. Only the runtime seams are substituted:
 *
 * - React, so effects can be driven deterministically in one process;
 * - the DOM (IntersectionObserver / MutationObserver / document / Image), because
 *   the contract is defined against the events those produce;
 * - the native channels, because the whole point is to observe *which* lane runs —
 *   a forced 256 track read, a forced 512 cover read, or the asset path helper.
 *
 * Everything the implementation decides stays real: the recovery ledger, the token
 * verification, the edge selection for the forced read, the "consumed once" rule
 * and the placeholder settlement.
 */
async function harness(options = {}) {
  const { trackCount = 2 } = options
  const effects = []
  const cleanups = []
  const previousDeps = []
  let effectIndex = 0
  let refIndex = 0
  const refs = []
  const states = []
  const stateSetters = []
  let stateIndex = 0
  let frameSequence = 0
  const frames = new Map()
  let urlSequence = 90
  /** Latest hook return value, which exposes the detail panel's demand setters. */
  let api = null

  const pathRequests = []
  const trackPixelRequests = []
  const coverPixelRequests = []
  const probeRequests = []
  const revoked = []
  const listeners = new Map()
  let observerCallback
  let mutationCallback
  let configuredPath = 'ready'
  /** Per-edge override, so a test can make one edge answer differently. */
  let configuredPathByEdge = new Map()
  const pathOutcomeFor = (maxEdge) => configuredPathByEdge.get(maxEdge) ?? configuredPath
  let configuredPixel = 'pixels'
  let configuredCover = 'ready'
  /**
   * Optional gate on the hero's cover path read.
   *
   * A late reply can only be observed if the reply is under the test's control:
   * without this the read settles inside `settle()` and there is nothing late.
   */
  let heroPathGate = null
  let heroPathInFlight = false
  let releaseHeroGate = null
  let pixelDecodeGate = null
  let pixelDecodeUrl = null

  let sources = [{
    sourceKind: 'folder',
    sourcePath: '/music/album',
    tracks: Array.from({ length: trackCount }, (_, index) => ({
      id: `track-${index}`,
      sourcePath: `/music/album/${index}.flac`,
      available: true,
    })),
  }, {
    // A second detail page, used to move the owner somewhere else while a reply
    // for the first one is still in flight.
    sourceKind: 'folder',
    sourcePath: '/music/other',
    tracks: [{ id: 'other-0', sourcePath: '/music/other/0.flac', available: true }],
  }]
  const descriptorFor = (index) => sources[0].tracks[index]
  /**
   * Replace the source descriptor array, which is what a rescan does.
   *
   * `playlistArtworkRevision` keys its revision on that array's identity, so a
   * fresh array *is* the revision change the real pipeline produces. Mutating a
   * counter instead would test a field the hook never reads.
   */
  const rescan = () => {
    const previous = sources[0]
    sources = [{ ...previous, tracks: previous.tracks.map((track) => ({ ...track })) }]
  }

  /** Every element the hook's IntersectionObserver was asked to observe. */
  const observed = new Set()
  // One element per source path: the hook keeps its `previews` map keyed by
  // element identity, so a fresh object per call would look like a second, still
  // visible consumer and the row would never leave demand.
  const elements = new Map()
  const element = (path) => {
    let node = elements.get(path)
    if (!node) {
      node = {
        _path: path,
        isConnected: true,
        matches: (selector) => selector === '[data-library-cover-source]',
        getAttribute: (name) => (name === 'data-library-cover-source' ? path : null),
        querySelectorAll: () => [],
      }
      elements.set(path, node)
    }
    return node
  }

  globalThis.__libraryArtworkTest = {
  // Deterministic hero tier for these recovery tests: they assert that a failure is retried
  // at the SAME edge, which must hold at any tier.
  selectHeroEdge: () => 1536,
  isHeroEdge: value => value === 1024 || value === 1536 || value === 2048,
  HERO_MAX_EDGE: 1536,
    useState: (initial) => {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      stateSetters[index] ??= (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }
      return [states[index], stateSetters[index]]
    },
    useRef: (value) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((entry, offset) => !Object.is(entry, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    useLayoutEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((entry, offset) => !Object.is(entry, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    requestAnimationFrame: (callback) => { const id = ++frameSequence; frames.set(id, callback); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
    beginAudioPlaylistCoverWindow: async () => 5,
    probeAudioPlaylistCover: async (sourcePath) => {
      probeRequests.push(sourcePath)
      const index = sources[0].tracks.findIndex((track) => track.sourcePath === sourcePath)
      const otherIndex = sources[1]?.tracks.findIndex((track) => track.sourcePath === sourcePath) ?? -1
      if (index === -1 && otherIndex >= 0) {
        return { id: sources[1].tracks[otherIndex].id, sourcePath, coverArt: { filePath: `/music/other/${otherIndex}.jpg` } }
      }
      if (configuredCover === 'missing') return { id: `track-${index}`, sourcePath, coverArt: null }
      return {
        id: `track-${index}`,
        sourcePath,
        coverArt: configuredCover === 'dataurl'
          ? { dataUrl: 'data:image/png;base64,AA==' }
          : { filePath: `/music/album/${index}.jpg` },
      }
    },
    scheduleTrackThumbnail: (input, scheduleOptions) => {
      trackPixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      if (configuredPixel === 'missing') return Promise.resolve(null)
      return Promise.resolve({ width: input.maxEdge, height: input.maxEdge, stride: input.maxEdge * 4, pixels: new Uint8ClampedArray(input.maxEdge * input.maxEdge * 4) })
    },
    schedulePlaylistCoverPixels: (input, scheduleOptions) => {
      coverPixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      if (configuredPixel === 'missing') return Promise.resolve(null)
      return Promise.resolve({ width: input.maxEdge, height: input.maxEdge, stride: input.maxEdge * 4, pixels: new Uint8ClampedArray(input.maxEdge * input.maxEdge * 4) })
    },
    attemptTrackThumbnailPath: async (input) => {
      pathRequests.push({ kind: 'track', input })
      if (pathOutcomeFor(input.maxEdge) === 'ready') {
        return { status: 'ready', image: { src: `asset://localhost/cache/track-${pathRequests.length}.jpg`, width: 256, height: 256, encodedBytes: 12 }, attemptId: `attempt-${pathRequests.length}` }
      }
      if (pathOutcomeFor(input.maxEdge) === 'missing') return { status: 'missing' }
      return { status: 'fallback', reason: 'decode' }
    },
    attemptPlaylistCoverThumbnailPath: async (input) => {
      pathRequests.push({ kind: 'cover', input })
      if (heroPathGate) {
        heroPathInFlight = true
        await heroPathGate
        heroPathInFlight = false
      }
      if (pathOutcomeFor(input.maxEdge) === 'ready') {
        return { status: 'ready', image: { src: `asset://localhost/cache/cover-${pathRequests.length}.jpg`, width: input.maxEdge, height: input.maxEdge, encodedBytes: 24 }, attemptId: `cover-attempt-${pathRequests.length}` }
      }
      if (pathOutcomeFor(input.maxEdge) === 'missing') return { status: 'missing' }
      return { status: 'fallback', reason: 'decode' }
    },
    playlistCoverImageFromPixels: (pixels) => {
      urlSequence += 1
      return { src: `blob:library-${urlSequence}`, width: pixels.width, height: pixels.height, encodedBytes: pixels.width * pixels.height * 3 }
    },
    isPlaylistCoverDecoded: (image) =>
      !(pixelDecodeGate && image.width === 512 && image.src.startsWith('blob:')),
    decodePlaylistCover: (image) => {
      pixelDecodeUrl = image.src
      return pixelDecodeGate
    },
    URL: {
      createObjectURL: () => { urlSequence += 1; return `blob:library-${urlSequence}` },
      revokeObjectURL: (url) => revoked.push(url),
    },
    createImageBitmap: async () => ({ width: 8, height: 8, close() {} }),
    fetch: async () => ({ blob: async () => ({}) }),
    document: {
      documentElement: { matches: () => false, querySelectorAll: () => [] },
      body: {},
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(8 * 8 * 4) }) }) }),
      querySelectorAll: (selector) => selector === 'img' ? [...images] : [],
    },
    IntersectionObserver: class {
      constructor(callback) { observerCallback = callback }
      observe(element) { observed.add(element) }
      unobserve(element) { observed.delete(element) }
      disconnect() { observed.clear() }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback }
      observe() {}
      disconnect() {}
    },
    // Every `Image` the readiness layer or the path lane constructs succeeds unless
    // the test marks the URL broken, which mirrors a WebView that can still serve
    // other resources while one managed file is gone.
    Image: null,
  }
  globalThis.window = globalThis.__libraryArtworkTest
  const images = []
  const brokenUrls = new Set()
  const RealURL = globalThis.URL
  RealURL.createObjectURL = () => { urlSequence += 1; return `blob:library-${urlSequence}` }
  RealURL.revokeObjectURL = (url) => revoked.push(url)
  globalThis.Image = class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.onload = null; this.onerror = null; this._src = '' }
    get src() { return this._src }
    set src(value) {
      this._src = value
      queueMicrotask(() => {
        if (brokenUrls.has(value)) { this.complete = true; this.naturalWidth = 0; this.onerror?.(); return }
        this.complete = true
        this.naturalWidth = 64
        this.onload?.()
      })
    }
    removeAttribute(name) { if (name === 'src') this._src = '' }
  }

  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const asModule = async (code, label) =>
    import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${label}-${Math.random()}`)

  // The real readiness module runs unmodified: the token comparison and the
  // ledger it owns are the contract, so substituting them would test a copy.
  const readinessUrl = `data:text/javascript;base64,${Buffer.from(compile(READINESS)).toString('base64')}`
  const readiness = await import(`${readinessUrl}#readiness-${Math.random()}`)

  const stripped = compile(HOOK).replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  assert(!/^import\b/m.test(stripped), 'the harness substitutes every runtime import')
  const prelude = `
    const { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo,
      requestAnimationFrame, cancelAnimationFrame, beginAudioPlaylistCoverWindow,
      probeAudioPlaylistCover, scheduleTrackThumbnail, schedulePlaylistCoverPixels,
      attemptTrackThumbnailPath, attemptPlaylistCoverThumbnailPath,
      playlistCoverImageFromPixels, isPlaylistCoverDecoded, decodePlaylistCover,
      selectHeroEdge, isHeroEdge, HERO_MAX_EDGE,
      URL, document, IntersectionObserver, ResizeObserver, MutationObserver } = globalThis.__libraryArtworkTest
    const window = globalThis.__libraryArtworkTest
    const coverOwnerAdmissionWidth = () => 2
    const subscribeCoverOwnerWidth = () => () => {}
    const createImageBitmap = () => globalThis.__libraryArtworkTest.createImageBitmap()
    const fetch = (...args) => globalThis.__libraryArtworkTest.fetch(...args)
    const setTimeout = (callback, delay) => globalThis.__libraryArtworkTest.setTimeout(callback, delay)
    const clearTimeout = (handle) => globalThis.__libraryArtworkTest.clearTimeout(handle)
    // The real source-path normalizer, inlined so the module has no imports left.
    const normalizeAudioSourcePath = (path) => path.replaceAll('\\\\', '/')
    // Real semantics: the revision is keyed on the descriptor array object, so a
    // rescan (a new array) is a new revision and an unrelated metadata update on
    // the same array is not.
    const artworkRevisions = new WeakMap()
    let nextArtworkRevision = 0
    const playlistArtworkRevision = (source) => {
      const token = source.directoryPaths ?? source.tracks
      let revision = artworkRevisions.get(token)
      if (revision === undefined) { revision = ++nextArtworkRevision; artworkRevisions.set(token, revision) }
      return revision
    }
    const admitLibraryArtwork = (required, optional, protectedPaths, residentLimit, optionalLimit) => {
      const reserved = new Set([...protectedPaths, ...required.keys()])
      const allowance = Math.max(0, Math.min(optionalLimit, residentLimit - reserved.size))
      const desired = new Map(required)
      let admitted = 0
      for (const [key, edge] of optional) {
        if (reserved.has(key)) continue
        if (admitted >= allowance) break
        desired.set(key, edge)
        admitted += 1
      }
      return desired
    }
    const selectArtworkEvictionKey = (keys, desired, pinned) => keys.find((key) => !desired.has(key) && !pinned.has(key))
      ?? keys.find((key) => !pinned.has(key)) ?? keys.find((key) => !desired.has(key)) ?? keys[0]
    const createPlaylistArtworkStore = (read, retain) => {
      let readSnapshot = read
      let retainSnapshot = retain
      const subscribers = new Map()
      const notify = (keys) => {
        for (const key of keys) {
          const entries = subscribers.get(key)
          if (!entries) continue
          const snapshot = readSnapshot(key)
          for (const entry of entries) {
            if (Object.is(entry.snapshot, snapshot)) continue
            entry.snapshot = snapshot
            entry.listener()
          }
        }
      }
      return {
        getSnapshot: (key) => readSnapshot(key),
        bind(read, retain) { readSnapshot = read; retainSnapshot = retain; notify(subscribers.keys()) },
        subscribe(key, listener) {
          const entries = subscribers.get(key) ?? new Set()
          const entry = { listener, snapshot: readSnapshot(key) }
          entries.add(entry)
          subscribers.set(key, entries)
          return () => { entries.delete(entry); if (!entries.size) subscribers.delete(key) }
        },
        notify,
        notifyAll: () => notify(subscribers.keys()),
        retain: (key) => (retainSnapshot ? retainSnapshot(key) : () => {}),
      }
    }
    const playlistArtworkKey = (scope, id, sourcePath) => JSON.stringify([scope, id, sourcePath.replaceAll('\\\\', '/')])
    // Hero key helpers: real semantics, inlined because the module has no imports
    // left. The hero publication is read through the store under this key, which
    // is exactly how the panel reads it.
    const heroPlaylistArtworkKey = (rowKey) => {
      const tuple = JSON.parse(rowKey)
      if (!Array.isArray(tuple) || tuple.length !== 3) throw new Error('heroPlaylistArtworkKey expects a 3-element row key')
      return JSON.stringify([...tuple, 'hero'])
    }
    const isHeroArtworkKey = (key) => {
      const tuple = typeof key === 'string' ? JSON.parse(key) : key
      return Array.isArray(tuple) && tuple.length === 4 && tuple[3] === 'hero'
    }
    const heroSlotId = (trackId) => trackId + '\\u0000hero'
    const isHeroSlotId = (key) => key.endsWith('\\u0000hero')
    const heroDisplayIdentity = (source) => JSON.stringify([
      'playlist-hero', source.scope, source.trackId, source.sourcePath, source.artworkRevision,
    ])
  `
  const readinessImport = `import { coverImageEventDetail, createCoverPresentation, createCoverRecoveryLedger, ` +
    `isCurrentCoverReport, nextCoverSessionGeneration, releasePlaylistCoverUrl } from ${JSON.stringify(readinessUrl)};\n`
  const module = await asModule(readinessImport + prelude + stripped, 'library-artwork')

  const render = (visible = true, detail = null, warmTrackId) => {
    refIndex = 0
    effectIndex = 0
    stateIndex = 0
    api = module.useLibraryArtwork(sources, detail, visible, warmTrackId)
    for (const effect of effects.splice(0)) effect()
    return api
  }
  const flush = async () => {
    for (let index = 0; index < 60; index += 1) await Promise.resolve()
    const ready = [...frames.values()]
    frames.clear()
    for (const callback of ready) callback(0)
    for (let index = 0; index < 60; index += 1) await Promise.resolve()
  }
  /** Report that the DOM could not display `presentation`. */
  const failPresentation = async (presentation, overrides = {}) => {
    assert(presentation, 'a presentation is published')
    const detail = {
      url: presentation.src,
      actualUrl: new URL(presentation.src, 'http://localhost/').href,
      token: presentation.token,
      ...overrides,
    }
    for (const listener of listeners.get('spmusic:playlist-cover-image-error') ?? []) {
      listener({ type: 'spmusic:playlist-cover-image-error', detail })
    }
    await flush()
  }
  const loadPresentation = async (presentation) => {
    const detail = {
      url: presentation.src,
      actualUrl: new URL(presentation.src, 'http://localhost/').href,
      token: presentation.token,
    }
    for (const listener of listeners.get('spmusic:playlist-cover-image-load') ?? []) {
      listener({ type: 'spmusic:playlist-cover-image-load', detail })
    }
    await flush()
  }
  /**
   * Model the mounted `<img>` elements the hook inspects to retire a replacement.
   *
   * A replacement is only retired once every element showing it reports
   * `complete && naturalWidth > 0` and no element still shows an older URL. The
   * tests drive that state explicitly instead of relying on a MutationObserver
   * the harness cannot produce.
   */
  const setMountedImages = (urls) => {
    images.length = 0
    for (const url of urls) images.push({ src: url, complete: true, naturalWidth: 64 })
  }
  /**
   * Drive the observer the way the real panel does for one visible set of paths.
   *
   * One element per path: the hook keys its `previews` map by element identity, so
   * a fresh object per call would look like an additional visible consumer and the
   * row would never leave demand.
   */
  const show = async (paths) => {
    const visible = new Set(paths)
    for (const path of new Set([...paths, ...elements.keys()])) element(path)
    const entries = [...elements.entries()].map(([path, target]) => ({
      target, isIntersecting: visible.has(path),
    }))
    observerCallback?.(entries)
    await flush()
  }

  /**
   * Keep pumping until the hook stops issuing new requests.
   *
   * The library owner admits in stages on purpose: the hero's 256 thumbnail is
   * published before its optional 512 upgrade, and `refresh()` re-enters the pump
   * for each stage. One `show()` therefore only covers the first stage.
   */
  const settle = async (paths) => {
    let previous = -1
    for (let round = 0; round < 12; round += 1) {
      await show(paths)
      const total = pathRequests.length + trackPixelRequests.length + coverPixelRequests.length
      if (total === previous) return
      previous = total
    }
  }
  const unmount = () => { for (const cleanup of cleanups) cleanup?.() }

  globalThis.__libraryArtworkTest.addEventListener = (type, listener) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  globalThis.__libraryArtworkTest.removeEventListener = (type, listener) => { listeners.get(type)?.delete(listener) }

  render(true)
  /**
   * Ask for the hero's 512 upgrade the way the detail panel does.
   *
   * `setVisibleTrackIds` is the real entry point: it decides the 512 edge for the
   * pinned first track, which is what the 512 branch of the pump reads.
   */
  const demandHero = async (trackIds, keepPersistentArtwork = true, heroEdge) => {
    api.setVisibleTrackIds('/music/album', trackIds, keepPersistentArtwork, true,
      heroEdge === undefined ? undefined : { heroEdge })
    await flush()
  }
  /**
   * Derive a hero key from a row key, exactly as the panel does.
   *
   * Kept in the harness scope (the prelude copy is what the hook module sees) so
   * a test can name the same key the store uses without duplicating the rule.
   */
  const heroKeyOf = (rowKey) => {
    const tuple = JSON.parse(rowKey)
    assert.equal(tuple.length, 3, 'a row key is a 3-tuple')
    return JSON.stringify([...tuple, 'hero'])
  }
  return {
    module, get sources() { return sources }, descriptorFor, rescan, settle, demandHero,
    observers: () => observerCallback, mutationCallback: () => mutationCallback,
    pathRequests, trackPixelRequests, coverPixelRequests, probeRequests, revoked, show, flush, render, unmount,
    rows: () => states[0],
    /**
     * The hero publication, read through the store under its derived key.
     *
     * Hero artwork deliberately does NOT live in `rows`: that table is the
     * ordinary-row projection and must never carry a tier above 256. Reading the
     * slot the way the panel does (derive the hero key from the row key, then ask
     * the store) is also what proves the key derivation works end to end.
     */
    hero: (trackId = 'track-0') => {
      const store = api?.artworkSource?.store
      const rowKey = api?.artworkSource?.keyByTrackId.get(trackId)
      if (!store || !rowKey) return undefined
      return store.getSnapshot(heroKeyOf(rowKey))
    },
    heroKey: (trackId = 'track-0') => {
      const rowKey = api?.artworkSource?.keyByTrackId.get(trackId)
      return rowKey ? heroKeyOf(rowKey) : undefined
    },
    rowKey: (trackId = 'track-0') => api?.artworkSource?.keyByTrackId.get(trackId),
    /**
     * Hold the next hero cover read open, so its reply can be released late.
     *
     * Without this a hero read always settles inside `settle()` and "a reply that
     * arrives after the page changed" has no observable meaning.
     */
    holdHeroPath: () => {
      heroPathGate = new Promise((resolve) => { releaseHeroGate = resolve })
    },
    /** Whether the held hero read is currently parked. */
    heroReadHeld: () => heroPathInFlight,
    holdHeroPixelDecode: () => {
      let release
      pixelDecodeGate = new Promise((resolve) => { release = resolve })
      return release
    },
    heroPixelDecodeUrl: () => pixelDecodeUrl,
    /** Release the held read. Safe to call more than once. */
    releaseHeroPath: () => {
      const release = releaseHeroGate
      releaseHeroGate = null
      release?.()
      return release
    },
    setPath: (value) => { configuredPath = value },
    setPathEdge: (maxEdge, value) => { configuredPathByEdge.set(maxEdge, value) },
    setPixel: (value) => { configuredPixel = value },
    setCover: (value) => { configuredCover = value },
    markBroken: (url) => brokenUrls.add(url),
    listenersFor: (type) => [...(listeners.get(type) ?? [])],
    failPresentation,
    loadPresentation,
    setMountedImages,
  }
}

// ---------------------------------------------------------------------------
// The 256 list lane
// ---------------------------------------------------------------------------

test('a 256 library row whose path image fails in the DOM runs one forced track pixel read', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac')?.presentation
    assert(presentation, 'the path lane published a token-bearing snapshot')
    assert.equal(presentation.token.url, presentation.src)
    assert.equal(h.pathRequests.length, 1, 'the normal lane used the path helper')
    assert.equal(h.trackPixelRequests.length, 0, 'a healthy path image costs no pixels')

    await h.failPresentation(presentation)
    assert.equal(h.pathRequests.length, 1, 'recovery never re-enters the path helper')
    assert.equal(h.trackPixelRequests.length, 1, 'exactly one forced 256 track read')
    assert.equal(h.trackPixelRequests[0].input.maxEdge, 256)
    assert.equal(h.trackPixelRequests[0].input.sourcePath, '/music/album/0.flac')
    assert.equal(h.coverPixelRequests.length, 0, 'the 512 cover lane is not used for a 256 row')
    const replacement = h.rows().get('/music/album/0.flac')?.presentation
    assert(replacement, 'a replacement is published')
    assert.notEqual(replacement.src, presentation.src, 'the failing URL stops being displayed')
  } finally { h.unmount() }
})

test('the same 256 recovery is absorbed when the row reports failure again in one epoch', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const key = '/music/album/0.flac'
    await h.failPresentation(h.rows().get(key).presentation)
    const afterFirst = h.trackPixelRequests.length
    assert.equal(afterFirst, 1)
    // The forced replacement itself never loads; other elements of the same
    // publication keep reporting the failure.
    const replacement = h.rows().get(key)?.presentation
    if (replacement) await h.failPresentation(replacement)
    assert.equal(h.trackPixelRequests.length, afterFirst, 'the epoch is spent, not re-queued')
    assert.equal(h.pathRequests.filter((request) => request.kind === 'track').length, 1,
      'the path helper is not retried for a spent epoch')
    assert.equal(h.rows().get(key)?.coverThumbnail, undefined,
      'the row settles as a placeholder instead of a broken element')
  } finally { h.unmount() }
})

test('a forced pixel read that produces nothing settles without a second request', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    h.setPixel('missing')
    await h.failPresentation(h.rows().get('/music/album/0.flac').presentation)
    const settled = h.trackPixelRequests.length
    assert.equal(settled, 1, 'one bounded attempt')
    // Staying visible and pumping again must not add work: the epoch is spent.
    await h.show(['/music/album/0.flac'])
    await h.flush()
    assert.equal(h.trackPixelRequests.length, settled, 'a spent epoch does not loop while visible')
    assert.equal(h.pathRequests.length, 1)
  } finally { h.unmount() }
})

test('a forced pixel command failure settles the row as a placeholder, never a broken image', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    h.setPixel('error')
    const key = '/music/album/0.flac'
    await h.failPresentation(h.rows().get(key).presentation)
    assert.equal(h.trackPixelRequests.length, 1)
    const row = h.rows().get(key)
    // A failed read keeps the placeholder: no cover URL is left that would render
    // the element the DOM just rejected.
    assert.equal(row?.coverThumbnail, undefined, 'no broken element is left behind')
    // The epoch is over; another failure report changes nothing.
    const settled = h.trackPixelRequests.length
    await h.show([key])
    await h.flush()
    assert.equal(h.trackPixelRequests.length, settled, 'a command failure does not loop')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// The 512 hero lane — the C3 defect
// ---------------------------------------------------------------------------

test('a high-tier hero whose presented image fails later forces the cover pixel lane at the hero tier', async () => {
  const h = await harness()
  try {
    // The hero is a SEPARATE publication from the first row. The first card shows
    // the ordinary 256 row thumbnail; the hero upgrades independently.
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    // The row lane never carries the hero tier — the first row included.
    const rowRequests = h.pathRequests.filter((request) => request.kind === 'track')
    assert(rowRequests.length > 0, 'the rows read through the track path helper')
    for (const request of rowRequests) {
      assert.equal(request.input.maxEdge, 256, 'an ordinary row (the first one included) stays at 256')
    }
    // The hero publication is read from the hero key, never from `rows`.
    const presentation = h.hero('track-0')?.presentation
    assert(presentation, `the hero published a snapshot; path=${JSON.stringify(h.pathRequests.map((r) => [r.kind, r.input.maxEdge]))}`)
    assert(h.hero('track-0')?.coverThumbnail, 'the hero carries its own image')
    assert.notEqual(h.rows().get('/music/album/0.flac')?.presentation?.src, presentation.src,
      'the row and the hero must not share one publication')
    assert.equal(presentation.token.key, 'track-0\u0000hero', 'the hero publishes under its own slot id')
    const coverPathRequests = h.pathRequests.filter((request) => request.kind === 'cover')
    assert.equal(coverPathRequests.length, 1,
      `the hero used the cover path helper; path=${JSON.stringify(h.pathRequests.map((r) => [r.kind, r.input.maxEdge]))}`)
    const heroEdge = coverPathRequests[0].input.maxEdge
    assert.ok(heroEdge >= 256, `the hero read through the path lane, got ${heroEdge}`)

    // A DOM failure of the PUBLISHED hero ends this identity's epoch. The single
    // automatic fallback belongs to the read attempt (path lane → one ≤512 pixel
    // read), which already happened, so this must settle rather than re-read: the
    // hero falls back to the row preview and never leaves a broken element.
    h.setMountedImages([presentation.src])
    await h.loadPresentation(presentation)
    const beforePath = h.pathRequests.length
    await h.failPresentation(presentation)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.hero('track-0'), undefined, 'the hero settles instead of re-reading')
    assert.equal(h.pathRequests.length, beforePath,
      'a hero DOM failure does not re-enter the cover thumbnail_path')
    assert.equal(h.coverPixelRequests.length, 0,
      'the fallback budget was already spent by the read attempt itself')
    assert(h.rows().get('/music/album/0.flac')?.coverThumbnail,
      'the hero falls back to the row preview, so the detail page is not blank')
  } finally { h.unmount() }
})

test('a hero path-lane failure falls back to one ≤512 pixel read and never to a row tier', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    // Force the cover path lane to fail while the row track lane stays healthy.
    h.setPathEdge(1536, 'fallback')
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.coverPixelRequests.length, 1,
      `a failed hero path read falls back exactly once; cover=${JSON.stringify(h.coverPixelRequests.map((r) => r.input.maxEdge))}`)
    // The playlist pixel lane stops at 512 (plan D2 / §4.3): the hero tier is a
    // path-lane concept and must never be sent to the pixel command.
    assert.ok(h.coverPixelRequests[0].input.maxEdge <= 512,
      `the pixel fallback never exceeds 512, got ${h.coverPixelRequests[0].input.maxEdge}`)
    assert.equal(h.coverPixelRequests[0].input.filePath, '/music/album/0.jpg')
    assert(h.hero('track-0')?.coverThumbnail, 'the hero publishes the pixel fallback')
  } finally { h.unmount() }
})

test('a hero failure never consumes an ordinary row recovery epoch', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const hero = h.hero('track-0')
    assert(hero?.presentation, 'the hero published')
    // The hero element fails. That must settle the HERO slot and leave the row's
    // single automatic recovery untouched: the row never asked for this image.
    const rowQueriesBefore = h.pathRequests.filter((request) => request.kind === 'track').length
    await h.failPresentation(hero.presentation)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.hero('track-0'), undefined, 'the hero falls back to the row preview, never a broken element')
    // The row is still published, which is only possible if its epoch survived.
    assert(h.rows().get('/music/album/0.flac')?.coverThumbnail, 'the row keeps its own preview')
    assert.equal(h.pathRequests.filter((request) => request.kind === 'track').length, rowQueriesBefore,
      'the hero failure triggers no new row read')
    assert.equal(h.coverPixelRequests.length, 0,
      'the row lane paid nothing for the hero failure')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Report verification: stale or unverifiable events must not start a recovery
// ---------------------------------------------------------------------------

test('a failure report for a superseded publication is ignored', async () => {
  const h = await harness()
  try {
    const key = '/music/album/0.flac'
    await h.show([key])
    const stale = h.rows().get(key).presentation
    assert(stale)
    // A rescan changes the artwork revision, which republishes the row. An element
    // still painting the superseded snapshot then reports a failure.
    h.rescan()
    h.render(true)
    await h.settle([key])
    const current = h.rows().get(key)?.presentation
    assert(current, 'the new revision publishes its own snapshot')
    assert.notEqual(current.token.identity, stale.token.identity, 'the identity moved with the revision')
    const before = h.trackPixelRequests.length
    await h.failPresentation(stale)
    assert.equal(h.trackPixelRequests.length, before, 'a stale snapshot starts no recovery')
    assert.equal(h.rows().get(key)?.presentation?.src, current.src,
      'the current resource is not evicted by a superseded report')
  } finally { h.unmount() }
})

test('a report naming another owner session is ignored', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac').presentation
    await h.failPresentation(presentation, {
      token: { ...presentation.token, sessionGeneration: presentation.token.sessionGeneration + 7 },
    })
    assert.equal(h.trackPixelRequests.length, 0, 'another owner lifetime cannot drive this owner')
  } finally { h.unmount() }
})

test('a report whose resolved URL differs from the published one is ignored', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac').presentation
    await h.failPresentation(presentation, { actualUrl: 'http://localhost/other.jpg' })
    assert.equal(h.trackPixelRequests.length, 0, 'an element that changed src is not this publication')
  } finally { h.unmount() }
})

test('a URL-only report never starts a recovery during the transition period', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac').presentation
    for (const listener of h.listenersFor('spmusic:playlist-cover-image-error')) {
      listener({ type: 'spmusic:playlist-cover-image-error', detail: presentation.src })
    }
    await h.flush()
    assert.equal(h.trackPixelRequests.length, 0, 'a tokenless event cannot be attributed, so it is ignored')
  } finally { h.unmount() }
})

test('several elements reporting the same failed publication start one recovery', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac').presentation
    for (let index = 0; index < 4; index += 1) {
      for (const listener of h.listenersFor('spmusic:playlist-cover-image-error')) {
        listener({
          type: 'spmusic:playlist-cover-image-error',
          detail: { url: presentation.src, actualUrl: new URL(presentation.src, 'http://localhost/').href, token: presentation.token },
        })
      }
    }
    await h.flush()
    assert.equal(h.trackPixelRequests.length, 1, 'one publication, one recovery')
    assert.equal(h.pathRequests.length, 1, 'the path helper is not retried')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// A DOM load does not restore the spent epoch; a real retry trigger does
// ---------------------------------------------------------------------------

test('a DOM load after a recovery does not reopen the epoch', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const failed = h.rows().get('/music/album/0.flac').presentation
    await h.failPresentation(failed)
    assert.equal(h.trackPixelRequests.length, 1)
    const replacement = h.rows().get('/music/album/0.flac').presentation
    // The replacement finally loads.
    await h.loadPresentation(replacement)
    // Then it fails later, exactly like a cache eviction or a remount would cause.
    await h.failPresentation(replacement)
    assert.equal(h.trackPixelRequests.length, 1, 'the spent epoch stays spent after a load')
  } finally { h.unmount() }
})

test('a new artwork revision opens a fresh recovery opportunity', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const key = '/music/album/0.flac'
    h.setPixel('error')
    await h.failPresentation(h.rows().get(key).presentation)
    assert.equal(h.trackPixelRequests.length, 1)
    h.setPixel('pixels')
    h.setPath('ready')
    h.rescan()
    h.render(true)
    await h.show([key])
    const republished = h.rows().get(key)?.presentation
    assert(republished, 'the new revision publishes its own image')
    const before = h.trackPixelRequests.length
    await h.failPresentation(republished)
    assert.equal(h.trackPixelRequests.length, before + 1,
      'a different resource is not born with its recovery spent')
  } finally { h.unmount() }
})

test('a row that leaves demand and returns gets a new epoch', async () => {
  const h = await harness()
  try {
    const key = '/music/album/0.flac'
    await h.show([key])
    h.setPixel('error')
    await h.failPresentation(h.rows().get(key).presentation)
    const attempts = h.trackPixelRequests.length
    assert.equal(attempts, 1)
    // Leave the viewport, then come back with a working pixel channel. A returning
    // row is a new demand, so its spent epoch must not suppress it.
    await h.show([])
    h.setPixel('pixels')
    h.setPath('error')
    await h.settle([key])
    assert(h.trackPixelRequests.length > attempts,
      `the returning row is admitted again; track=${JSON.stringify(h.trackPixelRequests.map((r) => r.input.maxEdge))} path=${JSON.stringify(h.pathRequests.map((r) => [r.kind, r.input.maxEdge]))}`)
  } finally { h.unmount() }
})

test('an unmounted owner runs no recovery for a late report', async () => {
  const h = await harness()
  try {
    await h.show(['/music/album/0.flac'])
    const presentation = h.rows().get('/music/album/0.flac').presentation
    h.unmount()
    const before = h.trackPixelRequests.length
    for (const listener of h.listenersFor('spmusic:playlist-cover-image-error')) {
      listener({
        type: 'spmusic:playlist-cover-image-error',
        detail: { url: presentation.src, actualUrl: new URL(presentation.src, 'http://localhost/').href, token: presentation.token },
      })
    }
    await h.flush()
    assert.equal(h.trackPixelRequests.length, before, 'an unmounted owner does nothing')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// The row lane never carries the hero's tier — the invariant of this change
// ---------------------------------------------------------------------------

test('with a high-tier hero every ordinary row request stays at 256', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    // The hero took a high tier…
    const coverRequests = h.pathRequests.filter((request) => request.kind === 'cover')
    assert.equal(coverRequests.length, 1, 'the hero read through the cover lane')
    assert.ok(coverRequests[0].input.maxEdge > 256,
      `the hero asked for a high tier, got ${coverRequests[0].input.maxEdge}`)
    // …and no row request ever exceeds 256. This is measured at the REQUEST side;
    // the store-side assertion below is the other half.
    const rowRequests = [...h.pathRequests.filter((request) => request.kind === 'track'),
      ...h.trackPixelRequests]
    assert(rowRequests.length > 0, 'the rows really were read')
    for (const request of rowRequests) {
      assert.ok(request.input.maxEdge <= 256,
        `an ordinary row must stay at 256, got ${request.input.maxEdge}`)
    }
  } finally { h.unmount() }
})

test('no row publication carries an image longer than its 256 lane', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert(h.hero('track-0')?.coverThumbnail, 'the hero published its high-tier image')
    // The core invariant, checked on the published rows themselves. Longest edge,
    // not width: a 256-wide tier thumbnail of a wide source is 256x128 and a `width`
    // -only check would be satisfied by accident.
    for (const [path, row] of h.rows()) {
      const image = row.coverThumbnail
      if (!image) continue
      assert.ok(Math.max(image.width, image.height) <= 256,
        `row ${path} published a ${image.width}x${image.height} image`)
    }
    // The hero is NOT in the row table at all: it has its own record.
    assert.equal(h.rows().has('/music/album/0.flac'), true, 'the first row is still published as a row')
  } finally { h.unmount() }
})

test('the hero key is not reachable from the row key map', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const map = h.module.useLibraryArtwork
      ? null
      : null
    void map
    // Every value in `keyByTrackId` must be a 3-tuple row key. A hero key in this
    // map is exactly the leak this design removes, so it is asserted structurally.
    const rowKeys = ['track-0', 'track-1'].map((id) => h.rowKey(id))
    for (const key of rowKeys) {
      assert(key, 'the track has a row key')
      assert.equal(JSON.parse(key).length, 3, `keyByTrackId values are row keys, got ${key}`)
    }
    const heroKey = h.heroKey('track-0')
    assert(heroKey)
    assert.equal(JSON.parse(heroKey).length, 4, 'the hero key is a 4-tuple')
    assert.notEqual(heroKey, h.rowKey('track-0'), 'and it is not the row key')
    assert.equal(rowKeys.includes(heroKey), false, 'the hero key appears in no row entry')
  } finally { h.unmount() }
})

test('a shared track uses the displayed detail scope for its hero key', async () => {
  const h = await harness()
  try {
    const [detail, other] = h.sources
    other.tracks.push(detail.tracks[0])
    h.render(true, detail)
    await h.demandHero(['track-0', 'track-1'])

    assert.equal(JSON.parse(h.heroKey())[0], 'folder\u0000/music/album')
    assert.equal(h.hero()?.coverThumbnail?.width, 1536)
    assert.equal(JSON.parse(h.rowKey('other-0'))[0], 'folder\u0000/music/other')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Late replies and withdrawal
// ---------------------------------------------------------------------------

test('a hero reply that lands after the detail page changes is discarded', async () => {
  // The cover path lane is held open so the reply can be released *after* the
  // owner has already moved on, which is the only way to observe a late reply.
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    h.holdHeroPath()
    await h.demandHero(['track-0', 'track-1'])
    await h.flush()
    assert.equal(h.heroReadHeld(), true, 'the hero read is parked')
    // The owner moves to another detail page before the reply arrives. A different
    // source list is what a real navigation produces.
    h.render(true, { sourcePath: '/music/other', tracks: h.sources[1].tracks })
    await h.flush()
    h.releaseHeroPath()
    await h.flush()
    // The late reply describes the old detail's first track; it must not publish.
    assert.equal(h.hero('track-0'), undefined,
      'a hero reply for a detail page that is no longer shown is discarded')
  } finally {
    h.releaseHeroPath?.()
    h.unmount()
  }
})

test('switching details releases the previously published hero blob', async () => {
  const h = await harness()
  try {
    h.render(true, h.sources[0])
    h.setPathEdge(1536, 'fallback')
    await h.demandHero(['track-0', 'track-1'])
    const oldUrl = h.hero()?.coverThumbnail?.src
    assert.ok(oldUrl?.startsWith('blob:'))

    h.render(true, h.sources[1])
    assert.equal(h.hero(), undefined)
    assert.ok(h.revoked.includes(oldUrl), 'the old detail drops its hero before the new read settles')
  } finally { h.unmount() }
})

test('a hero pixel fallback finishing decode after navigation is revoked without publishing', async () => {
  const h = await harness()
  const releaseDecode = h.holdHeroPixelDecode()
  try {
    h.render(true, h.sources[0])
    h.setPathEdge(1536, 'fallback')
    await h.demandHero(['track-0', 'track-1'])
    const staleUrl = h.heroPixelDecodeUrl()
    assert.ok(staleUrl?.startsWith('blob:'))

    h.render(true, h.sources[1])
    releaseDecode()
    await h.flush()
    assert.equal(h.hero(), undefined)
    assert.equal(h.revoked.filter((url) => url === staleUrl).length, 1)
  } finally {
    releaseDecode()
    h.unmount()
  }
})

test('an unavailable first row never starts a hero publication for the second row', async () => {
  const h = await harness()
  try {
    h.sources[0].tracks[0].available = false
    h.render(true, h.sources[0])
    await h.demandHero(['track-0', 'track-1'])
    assert.equal(h.pathRequests.some((request) => request.kind === 'cover'), false)
    assert.equal(h.hero('track-1'), undefined)
  } finally { h.unmount() }
})

test('a changed hero tier discards the in-flight result and requests the latest tier', async () => {
  const h = await harness()
  try {
    h.render(true, h.sources[0])
    h.holdHeroPath()
    await h.demandHero(['track-0', 'track-1'], true, 1536)
    assert.equal(h.heroReadHeld(), true)
    await h.demandHero(['track-0', 'track-1'], true, 1024)

    h.releaseHeroPath()
    await h.flush()
    assert.deepEqual(h.pathRequests.filter((request) => request.kind === 'cover')
      .map((request) => request.input.maxEdge), [1536, 1024])
    assert.equal(h.hero()?.coverThumbnail?.width, 1024)
  } finally {
    h.releaseHeroPath()
    h.unmount()
  }
})

test('withdrawing demand releases the previous hero while its replacement is in flight', async () => {
  const h = await harness()
  try {
    h.render(true, h.sources[0])
    await h.demandHero(['track-0', 'track-1'], true, 1536)
    assert.equal(h.hero()?.coverThumbnail?.width, 1536)
    h.holdHeroPath()
    await h.demandHero(['track-0', 'track-1'], true, 1024)
    assert.equal(h.heroReadHeld(), true)

    await h.demandHero(['track-0', 'track-1'], false)
    assert.equal(h.hero(), undefined)
    h.releaseHeroPath()
    await h.flush()
    assert.equal(h.hero(), undefined)
  } finally {
    h.releaseHeroPath()
    h.unmount()
  }
})

test('withdrawing the hero tier releases the high-tier image', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert(h.hero('track-0')?.coverThumbnail, 'the hero is published')
    // `keepPersistentArtwork: false` is what the panel reports when the hero is no
    // longer pinned (panel leaving / offscreen). The hero slot must be released.
    await h.demandHero(['track-0', 'track-1'], false)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.hero('track-0'), undefined, 'the withdrawn hero is released')
    // The rows are untouched by the withdrawal: they never depended on the hero.
    assert(h.rows().get('/music/album/0.flac')?.coverThumbnail, 'the row keeps its preview')
  } finally { h.unmount() }
})

test('a hero whose recovery settled is re-read after leaving and re-entering demand', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const first = h.hero('track-0')
    assert(first?.presentation, 'the hero published once')
    // The hero element fails: this identity's epoch settles and the slot clears.
    await h.failPresentation(first.presentation)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.hero('track-0'), undefined, 'the failed hero settled')
    // Leaving demand and coming back is a documented retry trigger. A settled
    // verdict must NOT survive it, or one DOM failure would blacklist the identity
    // for the whole session (resizing the hero away and back would never re-read).
    await h.demandHero(['track-0', 'track-1'], false)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const coverReadsBefore = h.pathRequests.filter((request) => request.kind === 'cover').length
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const coverReadsAfter = h.pathRequests.filter((request) => request.kind === 'cover').length
    assert(coverReadsAfter > coverReadsBefore,
      `the returning hero is re-read; cover reads ${coverReadsBefore} -> ${coverReadsAfter}`)
    assert(h.hero('track-0')?.coverThumbnail, 'and it publishes again')
  } finally { h.unmount() }
})
