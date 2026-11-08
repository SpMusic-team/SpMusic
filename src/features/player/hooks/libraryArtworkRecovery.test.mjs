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

  let sources = [{
    sourceKind: 'folder',
    sourcePath: '/music/album',
    tracks: Array.from({ length: trackCount }, (_, index) => ({
      id: `track-${index}`,
      sourcePath: `/music/album/${index}.flac`,
      available: true,
    })),
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
    // A path-lane image and a pixel image are both "already decoded" here: the
    // decode itself is not what these tests observe.
    isPlaylistCoverDecoded: () => true,
    decodePlaylistCover: async () => {},
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
      URL, document, IntersectionObserver, ResizeObserver, MutationObserver } = globalThis.__libraryArtworkTest
    const window = globalThis.__libraryArtworkTest
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
  const demandHero = async (trackIds, keepPersistentArtwork = true) => {
    api.setVisibleTrackIds('/music/album', trackIds, keepPersistentArtwork, true)
    await flush()
  }
  return {
    module, get sources() { return sources }, descriptorFor, rescan, settle, demandHero,
    observers: () => observerCallback, mutationCallback: () => mutationCallback,
    pathRequests, trackPixelRequests, coverPixelRequests, probeRequests, revoked, show, flush, render, unmount,
    rows: () => states[0],
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

test('a 512 hero whose presented image fails later forces the cover pixel lane at 512', async () => {
  const h = await harness()
  try {
    // The hero is the first track of the detail view. Its 256 thumbnail is
    // published first, then upgraded to 512, which is the branch under test.
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const heroKey = '/music/album/0.flac'
    const presentation = h.rows().get(heroKey)?.presentation
    assert(presentation, `the hero published a snapshot; path=${JSON.stringify(h.pathRequests.map((r) => [r.kind, r.input.maxEdge]))}`)
    const coverPathRequests = h.pathRequests.filter((request) => request.kind === 'cover')
    assert.equal(coverPathRequests.length, 1,
      `the 512 hero used the cover path helper; path=${JSON.stringify(h.pathRequests.map((r) => [r.kind, r.input.maxEdge]))}`)
    assert.equal(coverPathRequests[0].input.maxEdge, 512, 'the hero read the original 512 edge')

    // The element confirmed the image, so the upgrade is no longer "pending": a
    // later failure is a failure of the current presentation, not a rollback. The
    // hook retires a replacement only once the DOM shows it everywhere, so that
    // state is modelled explicitly.
    h.setMountedImages([presentation.src])
    await h.loadPresentation(presentation)
    const beforePath = h.pathRequests.length
    await h.failPresentation(presentation)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert.equal(h.pathRequests.length, beforePath, 'the 512 recovery never re-enters thumbnail_path')
    assert.equal(h.coverPixelRequests.length, 1, 'the 512 recovery uses schedulePlaylistCoverPixels')
    assert.equal(h.coverPixelRequests[0].input.maxEdge, 512, 'the recovery preserves the failing edge')
    assert.equal(h.coverPixelRequests[0].input.filePath, '/music/album/0.jpg',
      'the validated cover-file identity is preserved')
  } finally { h.unmount() }
})

test('the 512 hero recovery still reads the probe for the cover file identity', async () => {
  const h = await harness()
  try {
    h.render(true, { sourcePath: '/music/album', tracks: h.sources[0].tracks })
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    await h.demandHero(['track-0', 'track-1'])
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    const presentation = h.rows().get('/music/album/0.flac')?.presentation
    h.setMountedImages([presentation.src])
    await h.loadPresentation(presentation)
    const probesBefore = h.probeRequests.length
    await h.failPresentation(presentation)
    await h.settle(['/music/album/0.flac', '/music/album/1.flac'])
    assert(h.probeRequests.length > probesBefore, 'the forced 512 job still probes the cover file')
    assert.equal(h.coverPixelRequests.length, 1)
    assert.equal(h.coverPixelRequests[0].input.filePath, '/music/album/0.jpg')
    // The pixel command needs the file path, which only the probe can supply; what
    // must never happen again is the path *thumbnail* command.
    assert.equal(h.pathRequests.filter((request) => request.kind === 'cover').length, 1,
      'only the original attempt used the cover path helper')
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
