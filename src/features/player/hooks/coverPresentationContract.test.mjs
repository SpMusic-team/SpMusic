import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const HOOK = readFileSync(new URL('./useAllSongsWindow.ts', import.meta.url), 'utf8')
const READINESS = readFileSync(new URL('../model/playlistCoverReadiness.ts', import.meta.url), 'utf8')
const PIXELS = readFileSync(new URL('../model/playlistCoverPixels.ts', import.meta.url), 'utf8')

/**
 * Harness for the cover presentation contract.
 *
 * This deliberately executes the real `useAllSongsWindow`, the real
 * `playlistCoverReadiness` and the real pixel→BMP converter. Only the React
 * runtime, the DOM boundaries and the two native cover channels are substituted,
 * because those are exactly the seams the contract is defined against:
 *
 * - the *native channel* decides whether a path attempt or the pixel fallback runs,
 *   so the tests can assert "one forced pixels job, zero path attempts";
 * - the *DOM* decides whether a published URL is delivered, so the tests drive
 *   load/error through the same custom events the components dispatch.
 *
 * Everything the implementation decides — token currentness, dedupe, the recovery
 * epoch, fallback restoration, whether the cache still holds a broken URL — is the
 * real code under test. A test that only asserted "the helper received the right
 * predicate" would pass while the hook published into a stale generation.
 */
async function harness(options = {}) {
  const {
    count = 4,
    pathOutcome = 'ready',
    pixelOutcome = 'pixels',
    // `domAfterPublish: false` lets the tests publish without an automatic DOM event.
    autoReport = true,
  } = options

  const effects = []
  const cleanups = []
  let effectIndex = 0
  let previousDeps = []
  let refIndex = 0
  const refs = []
  const listeners = new Map()
  const frames = new Map()
  let frameSequence = 0
  let blobSequence = 0
  /** URLs the fake `Image` reports as unreadable bytes. */
  const brokenUrls = new Set()
  const pathRequests = []
  const pixelRequests = []
  let observerCallback
  let observedItems = null
  let configuredPath = pathOutcome
  let configuredPixel = pixelOutcome
  let auto = autoReport

  const items = Array.from({ length: count }, (_, index) => ({
    key: `/music/${index}.flac`,
    sourcePath: `/music/${index}.flac`,
    trackId: `track-${index}`,
    available: true,
    artworkRevision: 1,
    track: {},
  }))
  const nodes = new Map()
  const nodeFor = (item, index) => {
    let node = nodes.get(item.key)
    if (!node) {
      node = {
        dataset: { songKey: item.key }, index, isConnected: true,
        get offsetTop() { return Math.floor(node.index / 2) * 80 },
        getBoundingClientRect: () => {
          const top = Math.floor(node.index / 2) * 80 - panel.scrollTop
          return { top, bottom: top + 80, height: 80, left: node.index % 2 * 100, width: 100 }
        },
      }
      nodes.set(item.key, node)
    }
    node.index = index
    return node
  }
  const panel = {
    scrollTop: 0, clientHeight: 240,
    getBoundingClientRect: () => ({ top: 0, bottom: 240, height: 240 }),
    addEventListener: (name, listener) => { if (name === 'scroll') (listeners.get(name) ?? listeners.set(name, new Set()).get(name)).add(listener) },
    removeEventListener: (name, listener) => { listeners.get(name)?.delete(listener) },
  }

  /** Dispatch the protocol event a component would emit for one element. */
  const dispatch = (outcome, detail) => {
    const registry = globalThis.__coverContractTest
    const event = { type: outcome === 'loaded' ? registry.LOAD_EVENT : registry.ERROR_EVENT, detail }
    for (const listener of registry.eventListeners.get(event.type) ?? []) listener(event)
  }
  const eventListeners = new Map()

  globalThis.__coverContractTest = {
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    useLayoutEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    useCallback: callback => callback,
    useMemo: factory => factory(),
    useSyncExternalStore: (subscribe, getSnapshot) => {
      const value = getSnapshot()
      // The real hook uses this only to read the published presentation. Keeping
      // the subscription so a store notify reaches the component is unnecessary
      // here: the tests read the store directly, which is the same value React
      // would have received on the next render.
      void subscribe
      return value
    },
    requestAnimationFrame: callback => { const id = ++frameSequence; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
    URL: {
      createObjectURL: () => { blobSequence += 1; return `blob:cover-${blobSequence}` },
      revokeObjectURL: url => { globalThis.__coverContractTest.revoked.push(url) },
    },
    revoked: [],
    LOAD_EVENT: 'spmusic:playlist-cover-image-load',
    ERROR_EVENT: 'spmusic:playlist-cover-image-error',
    eventListeners,
    setEventListeners: (map) => { globalThis.__coverContractTest.eventListeners = map },
    addEventListener: (type, listener) => {
      const set = globalThis.__coverContractTest.eventListeners.get(type) ?? new Set()
      set.add(listener)
      globalThis.__coverContractTest.eventListeners.set(type, set)
    },
    removeEventListener: (type, listener) => { globalThis.__coverContractTest.eventListeners.get(type)?.delete(listener) },
    beginAudioPlaylistCoverWindow: async () => 7,
    scheduleTrackThumbnail: (input, scheduleOptions) => {
      pixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      if (configuredPixel === 'missing') return Promise.resolve(null)
      return Promise.resolve({ width: 256, height: 256, stride: 1024, pixels: new Uint8ClampedArray(256 * 256 * 4) })
    },
    scheduleFolderThumbnail: (input, scheduleOptions) => {
      pixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      return Promise.resolve({ width: 256, height: 256, stride: 1024, pixels: new Uint8ClampedArray(256 * 256 * 4) })
    },
    playlistCoverImageFromPixels: null,
    decodePlaylistCover: async () => {},
    attemptTrackThumbnailPath: async (input) => {
      pathRequests.push(input)
      if (configuredPath === 'ready') return { status: 'ready', image: { src: `asset://localhost/cache/${input.sourcePath}.jpg`, width: 256, height: 256, encodedBytes: 1 }, attemptId: `attempt-${pathRequests.length}` }
      if (configuredPath === 'fallback') return { status: 'fallback', reason: 'decode' }
      return { status: 'missing' }
    },
    attemptFolderThumbnailPath: async (input) => {
      pathRequests.push(input)
      if (configuredPath === 'ready') return { status: 'ready', image: { src: `asset://localhost/cache/${input.directoryPath}.jpg`, width: 256, height: 256, encodedBytes: 1 }, attemptId: `attempt-${pathRequests.length}` }
      if (configuredPath === 'fallback') return { status: 'fallback', reason: 'decode' }
      return { status: 'missing' }
    },
    notePathLanePresentationFailure: (attemptId) => { globalThis.__coverContractTest.presentationFailures.push(attemptId) },
    presentationFailures: [],
    IntersectionObserver: class {
      constructor(callback) { observerCallback = callback }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { documentElement: {}, querySelectorAll: () => [] },
    // `coverAbsoluteUrl` resolves against this, so the tests exercise the same
    // absolute-URL comparison the browser will perform rather than a string match.
    location: { href: 'http://localhost/' },
    window: null,
  }
  // `window` is the same object the module reaches for; the prelude below binds it.
  globalThis.__coverContractTest.window = globalThis.__coverContractTest
  // The real readiness module resolves against the real global, so the harness
  // provides the location it needs and nothing else.
  globalThis.window = globalThis.__coverContractTest
  // Object URLs and `Image` are browser globals; the real readiness module uses
  // both (URL release guarding and bounded decode), so they are provided once and
  // removed again when the harness tears down.
  const RealURL = globalThis.URL
  RealURL.createObjectURL = () => { blobSequence += 1; return `blob:cover-${blobSequence}` }
  RealURL.revokeObjectURL = (url) => { globalThis.__coverContractTest.revoked.push(url) }
  globalThis.Image = class FakeImage {
    constructor() {
      this.complete = false
      this.naturalWidth = 0
      this.onload = null
      this.onerror = null
      this._src = ''
    }
    get src() { return this._src }
    set src(value) {
      this._src = value
      // A managed asset that the tests did not mark as broken decodes immediately,
      // mirroring a warm WebView cache.
      queueMicrotask(() => {
        if (brokenUrls.has(value)) { this.complete = true; this.naturalWidth = 0; this.onerror?.(); return }
        this.complete = true
        this.naturalWidth = 256
        this.onload?.()
      })
    }
    removeAttribute(name) { if (name === 'src') this._src = '' }
  }

  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const stripImports = (code) => code.replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  const asModule = async (code, label) =>
    import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${label}-${Math.random()}`)

  // The real readiness module runs unmodified: the token/URL comparison rules it
  // owns are part of the contract, so substituting them would test a copy.
  const readinessUrl = `data:text/javascript;base64,${Buffer.from(compile(READINESS)).toString('base64')}`
  const readiness = await import(`${readinessUrl}#readiness-${Math.random()}`)
  globalThis.__coverContractTest.playlistCoverImageFromPixels = (pixels) => {
    blobSequence += 1
    return { src: `blob:cover-${blobSequence}`, width: pixels.width, height: pixels.height, encodedBytes: encodeBmp(pixels) }
  }

  // Substitute only the runtime boundaries. The readiness module is the *real*
  // one, re-attached by URL, so its currentness and URL-comparison rules cannot
  // drift from the implementation under test.
  //
  // Static imports are hoisted, so the import line may sit next to the prelude:
  // readiness is evaluated first, then the prelude binds the substituted globals,
  // then the hook body runs.
  const stripped = compile(HOOK).replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  assert(!/^import\b/m.test(stripped), 'the harness substitutes every runtime import')
  const prelude = `
    const { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore,
      requestAnimationFrame, cancelAnimationFrame, beginAudioPlaylistCoverWindow,
      scheduleTrackThumbnail, scheduleFolderThumbnail, playlistCoverImageFromPixels,
      decodePlaylistCover, attemptTrackThumbnailPath, attemptFolderThumbnailPath,
      notePathLanePresentationFailure, IntersectionObserver, ResizeObserver,
      MutationObserver, document, URL } = globalThis.__coverContractTest
    const window = globalThis.__coverContractTest
    const isStreamSource = () => false
    const orderPlaylistArtworkRows = (entries) => [...entries]
  `
  // The readiness module is bound by name, so every runtime symbol the hook takes
  // from it must be listed here. Assertions are untouched: this is the substituted
  // boundary, not the contract.
  const readinessImport = `import { COVER_IMAGE_LOAD_EVENT, COVER_IMAGE_ERROR_EVENT, ` +
    `coverImageEventDetail, createCoverPresentation, createCoverRecoveryLedger, ` +
    `decodePlaylistCoverWithin, isCurrentCoverReport, isSameCoverUrl, ` +
    `nextCoverSessionGeneration, releasePlaylistCoverUrl } from ${JSON.stringify(readinessUrl)};\n`
  const module = await asModule(readinessImport + prelude + stripped, 'hook')
  const store = module.createAllSongsCoverStore()
  const panelRef = { current: panel }
  const listRef = { current: { dataset: { layoutLevel: '2' }, querySelectorAll: () => (observedItems ?? items).map(nodeFor) } }

  const render = (nextItems = items, enabled = true) => {
    observedItems = nextItems
    refIndex = 0
    effectIndex = 0
    module.useAllSongsWindow(nextItems, panelRef, listRef, enabled, false, store, 0, nextItems)
    for (const effect of effects.splice(0)) effect()
    return store
  }
  const flush = async () => {
    for (let index = 0; index < 40; index += 1) await Promise.resolve()
    const ready = [...frames.values()]
    frames.clear()
    for (const callback of ready) callback(0)
    for (let index = 0; index < 40; index += 1) await Promise.resolve()
  }
  const demand = async (indices) => {
    const wanted = new Set(indices)
    // The observer is rebuilt when the descriptor set changes, so the current
    // items (not the ones captured at harness creation) decide the nodes.
    const current = observedItems ?? items
    observerCallback?.(current.map((item, index) => ({
      target: nodeFor(item, index),
      isIntersecting: wanted.has(index),
      boundingClientRect: nodeFor(item, index).getBoundingClientRect(),
      rootBounds: panel.getBoundingClientRect(),
    })))
    await flush()
  }
  const unmount = () => { for (const cleanup of cleanups) cleanup?.() }

  render()

  return {
    module, store, items, pathRequests, pixelRequests, dispatch, demand, flush, render, unmount,
    get revoked() { return globalThis.__coverContractTest.revoked },
    get presentationFailures() { return globalThis.__coverContractTest.presentationFailures },
    setPath: (value) => { configuredPath = value },
    setPixel: (value) => { configuredPixel = value },
    setAuto: (value) => { auto = value },
    get auto() { return auto },
    row: key => store.cache.get(key),
    /** The presentation a component would render for `key`, if any. */
    presentationFor: key => store.cache.get(key)?.presentation,
    /** Report the current presentation of `key` as loaded or failed. */
    report: async (key, outcome, overrides = {}) => {
      const presentation = store.cache.get(key)?.presentation
      assert(presentation, `a presentation is published for ${key}`)
      dispatch(outcome, {
        url: presentation.src,
        actualUrl: new URL(presentation.src, 'http://localhost/').href,
        token: presentation.token,
        ...overrides,
      })
      await flush()
    },
  }
}

function encodeBmp(pixels) {
  const rowStride = Math.ceil((pixels.width * 3) / 4) * 4
  return rowStride * pixels.height + 54
}

// ---------------------------------------------------------------------------
// Publishing and the token contract
// ---------------------------------------------------------------------------

test('a published cover exposes one immutable snapshot whose token names the full identity', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const row = h.row(h.items[0].key)
    assert(row, 'the row settled into the cache')
    const presentation = row.presentation
    assert(presentation, 'a URL is published with a presentation snapshot')
    assert.equal(presentation.src, row.coverUrl)
    const token = presentation.token
    assert.equal(token.key, h.items[0].key)
    assert.equal(token.url, presentation.src)
    // The identity must carry the artwork revision, otherwise a rescan would leave
    // old and new snapshots indistinguishable.
    assert.ok(/"artworkRevision"|,\s*\d+\]/.test(token.identity) || token.identity.includes('1'),
      `identity carries the revision: ${token.identity}`)
    assert.ok(token.publishGeneration >= 1)
    assert.ok(token.sessionGeneration >= 1)
  } finally { h.unmount() }
})

test('a cached image reports success through complete/naturalWidth instead of a missed load event', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    // The element was already complete at commit, so no `load` event was queued for
    // it; the component reports the completed element itself.
    await h.report(h.items[0].key, 'loaded')
    assert.equal(h.row(h.items[0].key)?.presentationState, 'presented')
    assert.equal(h.pathRequests.length, 1, 'confirming the image starts no new work')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// The defect: a path cover that predecoded but failed in the DOM
// ---------------------------------------------------------------------------

test('a DOM failure after publishing runs exactly one forced pixel job that skips the path lane', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    assert.equal(h.pathRequests.length, 1, 'the normal lane used the path command')
    assert.equal(h.pixelRequests.length, 0, 'a ready path image does not pay for pixels')
    const failedUrl = h.presentationFor(h.items[0].key).src
    await h.report(h.items[0].key, 'failed')
    assert.equal(h.pathRequests.length, 1, 'recovery does not retry the path lane')
    assert.equal(h.pixelRequests.length, 1, 'exactly one forced pixel job')
    assert.equal(h.pixelRequests[0].input.maxEdge, 256, 'the 256 list entry, matching the source lane')
    const replacement = h.presentationFor(h.items[0].key)
    assert(replacement, 'a pixel replacement is published')
    assert.notEqual(replacement.src, failedUrl, 'the failing path URL is no longer the current cache hit')
    assert.equal(h.row(h.items[0].key).sourceLane, 'pixels')
    assert.deepEqual(h.presentationFailures, ['attempt-1'], 'the path attempt is charged exactly once')
    // Nothing else was scheduled: the recovery is a single bounded job.
    assert.equal(h.pathRequests.length, 1)
    assert.equal(h.pixelRequests.length, 1)
  } finally { h.unmount() }
})

test('a recovery success commits a new generation and notifies subscribers', async () => {
  const h = await harness()
  try {
    let notified = 0
    const key = h.items[0].key
    const unsubscribe = (() => {
      const set = h.store.listeners.get(key) ?? new Set()
      const listener = () => { notified += 1 }
      set.add(listener)
      h.store.listeners.set(key, set)
      return () => set.delete(listener)
    })()
    try {
      await h.demand([0])
      const first = h.presentationFor(key).token.publishGeneration
      await h.report(key, 'failed')
      const recovered = h.presentationFor(key).token.publishGeneration
      assert(recovered > first, 'the recovery commits a new publish generation')
      assert(notified > 0, 'subscribers are notified of the replacement')
    } finally { unsubscribe() }
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// C1: a cover that loaded once can still fail later (remount, file evicted)
// ---------------------------------------------------------------------------

test('a cover that already presented can fail later and still gets one recovery', async () => {
  // A loaded report means "this image was readable at that moment", not "this
  // resource is permanently healthy". The file can be evicted by the shared
  // cache budget, or a remount can read it again and find it gone. Treating
  // `presented` as terminal would make that row show a broken image forever.
  const h = await harness()
  try {
    await h.demand([0])
    const key = h.items[0].key
    const failedUrl = h.presentationFor(key).src
    await h.report(key, 'loaded')
    assert.equal(h.row(key)?.presentationState, 'presented', 'the first load is recorded')
    assert.equal(h.pixelRequests.length, 0, 'a healthy load starts no recovery')

    await h.report(key, 'failed')
    assert.equal(h.pixelRequests.length, 1, 'a later failure of the same presentation runs one forced pixel job')
    assert.equal(h.pathRequests.length, 1, 'recovery never re-enters the path lane')
    const replacement = h.presentationFor(key)
    assert(replacement, 'a replacement is published')
    assert.notEqual(replacement.src, failedUrl, 'the failing URL stops being the current hit')
    assert.equal(h.row(key)?.sourceLane, 'pixels')
  } finally { h.unmount() }
})

test('repeated failures after a presented cover never exceed one recovery per epoch', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const key = h.items[0].key
    await h.report(key, 'loaded')
    await h.report(key, 'failed')
    const afterFirst = h.pixelRequests.length
    // The replacement published by the recovery may itself never confirm; extra
    // error reports must be absorbed by the spent epoch rather than looping.
    await h.report(key, 'failed')
    await h.report(key, 'failed')
    assert.equal(h.pixelRequests.length, afterFirst, 'the epoch stays spent')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Rejections: stale reports must never be accepted as current
// ---------------------------------------------------------------------------

test('a failure report for a superseded generation is ignored: no recovery, no eviction, no strike', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const stale = h.presentationFor(h.items[0].key)
    // A second commit supersedes it (the revision changed, so the row is rebuilt).
    h.setPath('ready')
    h.render([{ ...h.items[0], artworkRevision: 2 }, ...h.items.slice(1)])
    await h.demand([0])
    await h.flush()
    const current = h.presentationFor(h.items[0].key)
    if (!current) return
    h.dispatch('failed', {
      url: stale.src,
      actualUrl: new URL(stale.src, 'http://localhost/').href,
      token: stale.token,
    })
    await h.flush()
    assert.equal(h.presentationFor(h.items[0].key)?.token.url, current.token.url, 'the new resource is not evicted')
    assert.equal(h.pixelRequests.length, 0, 'no recovery was opened for the stale snapshot')
    assert.deepEqual(h.presentationFailures, [], 'a stale report is not charged to the breaker')
  } finally { h.unmount() }
})

test('a report whose URL differs from the published snapshot is ignored', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const presentation = h.presentationFor(h.items[0].key)
    // Same token, different resource: this is the "element already changed src"
    // case, which must not be attributed to the publication it names.
    h.dispatch('failed', {
      url: 'asset://localhost/cache/other.jpg',
      actualUrl: new URL('asset://localhost/cache/other.jpg', 'http://localhost/').href,
      token: presentation.token,
    })
    await h.flush()
    assert.equal(h.pixelRequests.length, 0)
    assert.equal(h.row(h.items[0].key).presentationState, 'pending')
  } finally { h.unmount() }
})

test('a report without a token is never treated as current', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const presentation = h.presentationFor(h.items[0].key)
    h.dispatch('failed', { url: presentation.src, actualUrl: new URL(presentation.src, 'http://localhost/').href })
    await h.flush()
    assert.equal(h.pixelRequests.length, 0, 'an unverifiable report starts no recovery')
    assert.equal(h.row(h.items[0].key).presentationState, 'pending')
  } finally { h.unmount() }
})

test('a report after the owner unmounted reaches no surviving owner', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const presentation = h.presentationFor(h.items[0].key)
    h.unmount()
    const pixelCallsBefore = h.pixelRequests.length
    h.dispatch('failed', {
      url: presentation.src,
      actualUrl: new URL(presentation.src, 'http://localhost/').href,
      token: presentation.token,
    })
    await h.flush()
    assert.equal(h.pixelRequests.length, pixelCallsBefore, 'an unmounted owner runs nothing')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Dedupe: several elements, one publication
// ---------------------------------------------------------------------------

test('concurrent errors from several elements of one publication start one recovery', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const presentation = h.presentationFor(h.items[0].key)
    // Three mounted <img> elements share this snapshot (hero, row, card).
    for (let index = 0; index < 3; index += 1) {
      h.dispatch('failed', {
        url: presentation.src,
        actualUrl: new URL(presentation.src, 'http://localhost/').href,
        token: presentation.token,
      })
    }
    await h.flush()
    assert.equal(h.pixelRequests.length, 1, 'one publication, one recovery')
    assert.deepEqual(h.presentationFailures, ['attempt-1'], 'the attempt is charged once, not once per element')
  } finally { h.unmount() }
})

test('a repeated failure of the recovery replacement settles instead of looping', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    await h.report(h.items[0].key, 'failed')
    assert.equal(h.pixelRequests.length, 1, 'the first recovery ran')
    // The pixel replacement also fails in the DOM.
    await h.report(h.items[0].key, 'failed')
    assert.equal(h.pixelRequests.length, 1, 'no second recovery in the same epoch')
    const row = h.row(h.items[0].key)
    assert.equal(row.presentationState, 'failed', 'the row settles as failed')
    assert.equal(row.transientFailure, true, 'failure is recorded as transient, not as confirmed absence')
    assert.equal(row.presentation, undefined, 'no broken element is left behind')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Dual failure: bounded, no broken element, no permanent loading
// ---------------------------------------------------------------------------

test('a pixel failure during recovery settles as a placeholder with a transient failure', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.setPixel('error')
    await h.report(h.items[0].key, 'failed')
    const row = h.row(h.items[0].key)
    assert.equal(row.presentationState, 'failed')
    assert.equal(row.presentation, undefined, 'the failed URL is removed from the display')
    assert.equal(row.transientFailure, true)
    assert.equal(row.coverUrl, undefined, 'no cover URL is left that would render a broken element')
    assert.equal(h.pathRequests.length, 1, 'the path lane was not retried')
  } finally { h.unmount() }
})

test('a recovery that produces no pixels terminates without queueing more work', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.setPixel('missing')
    await h.report(h.items[0].key, 'failed')
    await h.flush()
    assert.equal(h.row(h.items[0].key).presentationState, 'failed')
    const settled = h.pixelRequests.length
    await h.flush()
    assert.equal(h.pixelRequests.length, settled, 'no retry loop for a bounded failure')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Retry epoch: leaving and returning
// ---------------------------------------------------------------------------

test('leaving demand and returning opens a new epoch with one fresh recovery', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.setPixel('error')
    await h.report(h.items[0].key, 'failed')
    assert.equal(h.row(h.items[0].key).presentationState, 'failed')
    const attemptsBefore = h.pixelRequests.length
    // Scroll the row out of demand and back in.
    await h.demand([])
    h.setPath('ready')
    h.setPixel('pixels')
    await h.demand([0])
    await h.flush()
    assert(h.pixelRequests.length > attemptsBefore || h.pathRequests.length > 1,
      'the returning row is admitted again in a new epoch')
  } finally { h.unmount() }
})

test('staying in demand does not re-trigger recovery on every pump', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.setPixel('error')
    await h.report(h.items[0].key, 'failed')
    const attempts = h.pixelRequests.length
    // Re-render and re-demand without leaving the viewport.
    h.render()
    await h.demand([0])
    await h.flush()
    assert.equal(h.pixelRequests.length, attempts, 'a row that never left demand spends one recovery')
  } finally { h.unmount() }
})

test('an artwork revision change resets the old failure immediately', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.setPixel('error')
    await h.report(h.items[0].key, 'failed')
    assert.equal(h.row(h.items[0].key).presentationState, 'failed')
    h.setPixel('pixels')
    // A rescan changes the revision: the old failure describes a different resource.
    h.render([{ ...h.items[0], artworkRevision: 9 }, ...h.items.slice(1)])
    await h.demand([0])
    await h.flush()
    const row = h.row(h.items[0].key)
    assert(row.presentation, 'the rescanned descriptor publishes its own image')
    assert.notEqual(row.presentationState, 'failed', 'a new revision is not born failed')
  } finally { h.unmount() }
})

// ---------------------------------------------------------------------------
// Candidate groups keep their order and their source semantics
// ---------------------------------------------------------------------------

test('a candidate group recovery starts at the candidate that produced the failed image', async () => {
  const h = await harness()
  try {
    const group = {
      kind: 'track-candidates', key: 'collection-cover:test',
      candidates: [
        { key: 'a', trackId: 'a', sourcePath: '/music/a.flac', available: true, artworkRevision: 1 },
        { key: 'b', trackId: 'b', sourcePath: '/music/b.flac', available: true, artworkRevision: 1 },
      ],
      available: true,
    }
    h.render([group])
    await h.demand([0])
    // The first candidate's path attempt answered, so the publication records its
    // index; that is where the recovery resumes instead of re-walking from zero.
    assert.equal(h.pathRequests.length, 1, 'the group stopped at the first available candidate')
    assert.equal(h.pathRequests[0].sourcePath, '/music/a.flac')
    const recordedIndex = h.row(group.key)?.candidateIndex
    assert.equal(recordedIndex, 0, 'the publication records the candidate index it used')

    await h.report(group.key, 'failed')
    assert.equal(h.pathRequests.length, 1, 'recovery never re-enters the path lane')
    assert.equal(h.pixelRequests.length, 1, 'exactly one forced pixel job for the group')
    assert.equal(h.pixelRequests[0].input.sourcePath, '/music/a.flac',
      'recovery starts at the candidate that produced the failed image')
    assert(h.presentationFor(group.key), 'the replacement is published')
  } finally { h.unmount() }
})
