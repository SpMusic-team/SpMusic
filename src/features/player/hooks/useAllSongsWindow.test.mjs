import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./useAllSongsWindow.ts', import.meta.url), 'utf8')

async function harness(count = 100) {
  const effects = []
  const previousEffects = []
  const refs = []
  const cleanups = []
  const calls = []
  const pending = []
  const revoked = []
  const pixelCalls = []
  const decodePending = []
  let holdDecode = false
  let beginFailure = false
  let observer
  let nextUrl = 0
  let refIndex = 0
  let effectIndex = 0
  let items = Array.from({ length: count }, (_, index) => ({
    key: `/music/${index}.flac`, sourcePath: `/music/${index}.flac`,
    trackId: `track-${index}`, available: true, track: {},
  }))
  globalThis.__allSongsWindowTest = {
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousEffects[index]
      if (!previous || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousEffects[index] = deps
      }
    },
    useCallback: callback => callback,
    useSyncExternalStore: () => {},
    beginAudioPlaylistCoverWindow: async () => { if (beginFailure) throw new Error('window unavailable'); return 1 },
    probeAudioPlaylistCover: path => {
      calls.push(path)
      return new Promise((resolve, reject) => pending.push({ path, item: items.find(item => item.sourcePath === path), resolve, reject }))
    },
    schedulePlaylistCoverPixels: async (input, options) => {
      pixelCalls.push({ input, options })
      return options.signal.aborted || !options.isCurrent() ? null : {}
    },
    playlistCoverImageFromPixels: () => ({ src: `blob:cover-${++nextUrl}` }),
    decodePlaylistCover: async () => {
      if (holdDecode) await new Promise(resolve => decodePending.push(resolve))
    },
    normalizeAudioSourcePath: path => path,
    URL: { revokeObjectURL: url => revoked.push(url) },
    IntersectionObserver: class {
      constructor(callback) { observer = callback }
      observe() {}
      disconnect() {}
    },
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const imports = compiled.match(/^import .+;$/gm)
  assert.equal(imports.length, 6, 'all runtime boundaries are explicitly mocked')
  const bindings = Object.keys(globalThis.__allSongsWindowTest).join(', ')
  const patched = `const { ${bindings} } = globalThis.__allSongsWindowTest;\n${compiled.replace(/^import .+;$/gm, '')}`
  const module = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}#${Math.random()}`)
  const store = module.createAllSongsCoverStore()
  const panelRef = { current: {} }
  const listRef = { current: { querySelectorAll: () => [] } }
  const render = (nextItems = items, enabled = true) => {
    items = nextItems
    refIndex = 0
    effectIndex = 0
    module.useAllSongsWindow(items, panelRef, listRef, enabled, false, store)
    for (const effect of effects.splice(0)) effect()
  }
  render()
  const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
  const demand = async indices => {
    const desired = new Set(indices)
    observer(items.map((item, index) => ({ target: { dataset: { songKey: item.key } }, isIntersecting: desired.has(index) })))
    await flush()
  }
  const finish = async (request = pending.shift(), mode = 'cover') => {
    assert(request, 'a native probe is pending')
    const item = request.item
    if (mode === 'error') request.reject(new Error('unreadable artwork'))
    else request.resolve({ id: item.trackId, sourcePath: item.sourcePath, coverArt: mode === 'missing' ? null : { filePath: `/covers/${item.trackId}` } })
    await flush()
  }
  const drain = async (limit = count, mode = 'cover') => {
    let completed = 0
    while (pending.length && completed < limit) { await finish(pending.shift(), mode); completed += 1 }
    return completed
  }
  const unmount = () => { for (const cleanup of cleanups) cleanup?.() }
  return {
    get items() { return items }, store, calls, pending, revoked, pixelCalls, demand, finish, drain, flush, unmount, render,
    holdDecode: () => { holdDecode = true },
    failBegin: value => { beginFailure = value },
    releaseDecode: async () => { for (const resolve of decodePending.splice(0)) resolve(); await flush() },
    dispose: () => { unmount(); module.disposeAllSongsCoverStore(store) },
  }
}

test('more than 60 demanded covers converge without evicting or reloading visible rows', async () => {
  const h = await harness()
  try {
    await h.demand(Array.from({ length: 90 }, (_, index) => index))
    await h.drain(90)
    assert.equal(h.calls.length, 90, 'exactly one probe per demanded cover, with no repump loop')
    assert.equal(h.pixelCalls.length, 90)
    assert.equal(h.store.cache.size, 90)
    assert.equal(h.revoked.length, 0, 'every displayed object URL remains owned')
    assert.equal(h.pending.length, 0)
    assert(h.pixelCalls.every(({ input }) => input.maxEdge === 128))
  } finally { h.dispose() }
})

test('a new cover evicts an offscreen warm row before an older still-visible cover', async () => {
  const h = await harness()
  try {
    await h.demand(Array.from({ length: 60 }, (_, index) => index))
    await h.drain(60)
    const original = h.store.cache.get(h.items[0].key).coverUrl
    await h.demand([0, 60])
    await h.drain(2)
    assert.equal(h.store.cache.get(h.items[0].key)?.coverUrl, original)
    assert(!h.revoked.includes(original))
    assert.equal(h.calls.length, 61)
    assert.equal(h.store.cache.size, 60)
    assert.equal(h.revoked.length, 1)
  } finally { h.dispose() }
})

test('shrinking demand trims excess resident URLs even without a new publication', async () => {
  const h = await harness()
  try {
    await h.demand(Array.from({ length: 90 }, (_, index) => index))
    await h.drain(90)
    const kept = h.store.cache.get(h.items[0].key).coverUrl
    await h.demand([0])
    assert.equal(h.store.cache.size, 60)
    assert.equal(h.revoked.length, 30)
    assert.equal(h.store.cache.get(h.items[0].key).coverUrl, kept)
    assert.equal(h.calls.length, 90)
    await h.demand(Array.from({ length: 90 }, (_, index) => index))
    await h.drain(30)
    assert.equal(h.calls.length, 120, 'only evicted rows reload when they return')
    assert.equal(h.pending.length, 0)
  } finally { h.dispose() }
})

test('missing and failed covers settle once per demand and remain bounded during scrolling', async () => {
  for (const mode of ['missing', 'error']) {
    const h = await harness()
    try {
      await h.demand(Array.from({ length: 90 }, (_, index) => index))
      await h.drain(90, mode)
      assert.equal(h.calls.length, 90)
      assert.equal(h.store.cache.size, 90, 'terminal no-art rows share cache ownership')
      await h.demand([99])
      await h.drain(1, mode)
      assert.equal(h.store.cache.size, 60)
      assert.equal(h.calls.length, 91)
      assert.equal(h.revoked.length, 0)
    } finally { h.dispose() }
  }
})

test('offscreen in-flight results are discarded and can load when demanded again', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const stale = h.pending.shift()
    await h.demand([1])
    await h.finish(stale)
    await h.drain(1)
    assert(!h.store.cache.has(h.items[0].key))
    await h.demand([0, 1])
    await h.drain(1)
    assert.equal(h.calls.filter(path => path === h.items[0].sourcePath).length, 2)
    assert.equal(h.store.cache.size, 2)
  } finally { h.dispose() }
})

test('re-entering retries transient failures but preserves genuinely missing artwork', async () => {
  const h = await harness()
  try {
    await h.demand([0, 1])
    await h.finish(h.pending.shift(), 'error')
    await h.finish(h.pending.shift(), 'missing')
    await h.demand([0, 1])
    assert.equal(h.calls.length, 2, 'a failed read does not spin in the current visit')
    h.render(h.items, false)
    h.render(h.items, true)
    await h.demand([0, 1])
    await h.drain(1)
    assert.equal(h.calls.length, 3)
    assert.equal(h.calls.filter(path => path === h.items[1].sourcePath).length, 1)
    assert(h.store.cache.get(h.items[0].key).coverUrl)
  } finally { h.dispose() }
})

test('player thumbnails appearing and disappearing never revoke a prepared all-songs cover', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    await h.drain(1)
    const item = h.items[0]
    const owned = h.store.cache.get(item.key).coverUrl
    h.render([{ ...item, track: { coverThumbnail: { src: 'blob:player-cover' } } }, ...h.items.slice(1)])
    assert.equal(h.store.cache.get(item.key)?.coverUrl, owned, 'external player ownership does not invalidate this descriptor')
    h.render([item, ...h.items.slice(1)])
    await h.flush()
    assert.equal(h.calls.length, 1, 'switching tracks starts no duplicate all-songs probe')
    assert.equal(h.pixelCalls.length, 1)
    assert.equal(h.revoked.length, 0)
    assert.equal(h.store.cache.get(item.key)?.coverUrl, owned)
  } finally { h.dispose() }
})

test('rows entering with a player thumbnail prepare an independently owned decoded cover', async () => {
  const h = await harness()
  try {
    const item = h.items[0]
    h.render([{ ...item, track: { coverThumbnail: { src: 'blob:player-cover' } } }, ...h.items.slice(1)])
    await h.demand([0])
    assert.equal(h.calls.length, 1, 'a borrowed player URL cannot suppress independent all-songs preparation')
    h.holdDecode()
    await h.finish()
    assert(!h.store.cache.has(item.key), 'a new owned cover is published only after decoding')
    h.render([item, ...h.items.slice(1)])
    await h.releaseDecode()
    const owned = h.store.cache.get(item.key)?.coverUrl
    assert(owned)
    assert.notEqual(owned, 'blob:player-cover')
    assert.equal(h.calls.length, 1)
    assert.equal(h.pixelCalls.length, 1)
    assert.equal(h.revoked.length, 0, 'this window never revokes a borrowed player URL')
  } finally { h.dispose() }
})

test('a player thumbnail arriving during decode does not cancel all-songs ownership', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    h.holdDecode()
    await h.finish()
    const item = h.items[0]
    h.render([{ ...item, track: { coverThumbnail: { src: 'blob:player-cover' } } }, ...h.items.slice(1)])
    await h.releaseDecode()
    assert(h.store.cache.get(item.key)?.coverUrl, 'external hydration cannot discard the prepared decoded cover')
    assert.equal(h.revoked.length, 0)
    h.render([item, ...h.items.slice(1)])
    await h.flush()
    assert.equal(h.calls.length, 1)
  } finally { h.dispose() }
})

test('failure from an obsolete descriptor cannot mark its replacement as completed', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    const obsolete = h.pending.shift()
    const replacement = { ...h.items[0], trackId: 'replacement' }
    h.render([replacement, ...h.items.slice(1)])
    await h.finish(obsolete, 'error')
    assert(!h.store.cache.has(replacement.key))
    await h.drain(1)
    assert.equal(h.store.cache.get(replacement.key).trackId, 'replacement')
    assert.equal(h.calls.length, 2)
  } finally { h.dispose() }
})

test('replacing a completed failed descriptor invalidates its terminal cache row', async () => {
  const h = await harness()
  try {
    await h.demand([0])
    await h.drain(1, 'error')
    const replacement = { ...h.items[0], trackId: 'replacement' }
    h.render([replacement, ...h.items.slice(1)])
    await h.flush()
    await h.drain(1)
    assert.equal(h.store.cache.get(replacement.key).trackId, 'replacement')
    assert.equal(h.calls.length, 2)
  } finally { h.dispose() }
})

test('a failed cover window settles demand and retries when the next visit opens a window', async () => {
  const h = await harness()
  try {
    h.render(h.items, false)
    h.failBegin(true)
    h.render(h.items, true)
    await h.demand([0, 1])
    assert.equal(h.store.cache.size, 2)
    assert.equal(h.calls.length, 0)
    h.render(h.items, false)
    h.failBegin(false)
    h.render(h.items, true)
    await h.demand([0, 1])
    await h.drain(2)
    assert.equal(h.calls.length, 2)
    assert([...h.store.cache.values()].every(row => row.coverUrl))
  } finally { h.dispose() }
})

test('unmount aborts queued work and revokes an object URL completed after cleanup', async () => {
  const h = await harness()
  try {
    h.holdDecode()
    await h.demand([0, 1, 2])
    await h.finish()
    h.unmount()
    assert(h.pixelCalls[0].options.signal.aborted)
    await h.releaseDecode()
    await h.drain(2)
    assert.equal(h.calls.length, 2, 'cleanup starts no further probes')
    assert.equal(h.store.cache.size, 0)
    assert.deepEqual(h.revoked, ['blob:cover-1'])
  } finally { h.dispose() }
})
