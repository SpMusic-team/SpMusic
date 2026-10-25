import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
  let frameSequence = 0
  const frames = new Map()
  const scrollListeners = new Set()
  const panel = {
    scrollTop: 0, clientHeight: 240,
    getBoundingClientRect: () => ({ top: 0, bottom: 240, height: 240 }),
    addEventListener: (name, listener) => { if (name === 'scroll') scrollListeners.add(listener) },
    removeEventListener: (name, listener) => { if (name === 'scroll') scrollListeners.delete(listener) },
  }
  let items = Array.from({ length: count }, (_, index) => ({
    key: `/music/${index}.flac`, sourcePath: `/music/${index}.flac`,
    trackId: `track-${index}`, available: true, track: {},
  }))
  const nodes = new Map()
  const nodeFor = (item, index) => {
    let node = nodes.get(item.key)
    if (!node) {
      node = { dataset: { songKey: item.key }, index, isConnected: true,
        get offsetTop() { return Math.floor(node.index / 2) * 80 },
        getBoundingClientRect: () => {
          const top = Math.floor(node.index / 2) * 80 - panel.scrollTop
          return { top, bottom: top + 80, height: 80, left: node.index % 2 * 100, width: 100 }
        } }
      nodes.set(item.key, node)
    }
    node.index = index
    return node
  }
  const orderPath = new URL('../model/playlistArtworkOrder.ts', import.meta.url)
  const orderExports = existsSync(orderPath) ? await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(readFileSync(orderPath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText).toString('base64')}`) : {}
  globalThis.__allSongsWindowTest = {
    ...orderExports,
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
    useMemo: factory => factory(),
    useSyncExternalStore: () => {},
    requestAnimationFrame: callback => { const id = ++frameSequence; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
    beginAudioPlaylistCoverWindow: async () => { if (beginFailure) throw new Error('window unavailable'); return 1 },
    scheduleTrackThumbnail: (input, options) => {
      pixelCalls.push({ input, options })
      calls.push(input.sourcePath)
      return new Promise((resolve, reject) => pending.push({ path: input.sourcePath, resolve, reject }))
    },
    playlistCoverImageFromPixels: () => ({ src: `blob:cover-${++nextUrl}` }),
    decodePlaylistCover: async () => {
      if (holdDecode) await new Promise(resolve => decodePending.push(resolve))
    },
    URL: { revokeObjectURL: url => revoked.push(url) },
    IntersectionObserver: class {
      constructor(callback) { observer = callback }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const imports = compiled.match(/^import .+;$/gm)
  assert.equal(imports.length, source.includes('orderPlaylistArtworkRows') ? 6 : 5, 'all runtime boundaries are explicitly supplied, including the real ordering helper')
  const bindings = Object.keys(globalThis.__allSongsWindowTest).join(', ')
  const patched = `const { ${bindings} } = globalThis.__allSongsWindowTest;\n${compiled.replace(/^import .+;$/gm, '')}\n//# sourceURL=useAllSongsWindow.test-module.mjs`
  const module = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}#${Math.random()}`)
  const store = module.createAllSongsCoverStore()
  const panelRef = { current: panel }
  const listRef = { current: { dataset: { layoutLevel: '2' }, querySelectorAll: () => items.map(nodeFor) } }
  const render = (nextItems = items, enabled = true) => {
    items = nextItems
    refIndex = 0
    effectIndex = 0
    module.useAllSongsWindow(items, panelRef, listRef, enabled, false, store)
    for (const effect of effects.splice(0)) effect()
  }
  render()
  const flush = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
    const ready = [...frames.values()]; frames.clear()
    for (const callback of ready) callback(performance.now())
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  }
  const demand = async indices => {
    const desired = new Set(indices)
    observer(items.map((item, index) => ({ target: nodeFor(item, index), boundingClientRect: nodeFor(item, index).getBoundingClientRect(), rootBounds: panel.getBoundingClientRect(), isIntersecting: desired.has(index) })))
    await flush()
  }
  const scroll = async top => { panel.scrollTop = top; for (const listener of scrollListeners) listener(); await flush() }
  const finish = async (request = pending.shift(), mode = 'cover') => {
    assert(request, 'a native thumbnail is pending')
    if (mode === 'error') request.reject(new Error('unreadable artwork'))
    else request.resolve(mode === 'missing' ? null : {})
    await flush()
  }
  const drain = async (limit = count, mode = 'cover') => {
    let completed = 0
    while (pending.length && completed < limit) { await finish(pending.shift(), mode); completed += 1 }
    return completed
  }
  const unmount = () => { for (const cleanup of cleanups) cleanup?.() }
  return {
    get items() { return items }, store, calls, pending, revoked, pixelCalls, demand, scroll, panel, finish, drain, flush, unmount, render,
    holdDecode: () => { holdDecode = true },
    failBegin: value => { beginFailure = value },
    releaseDecodeAt: async index => { const resolve=decodePending.splice(index,1)[0]; assert(resolve,'a decoder is pending'); resolve(); await flush() },
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
    assert(h.pixelCalls.every(({ input }) => input.maxEdge === 256))
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

test('scrolling backward reverses visible row groups while preserving horizontal order and warm covers', async () => {
  const h=await harness(20)
  try {
    await h.scroll(120)
    await h.demand([4,5,6,7])
    await h.drain(4)
    assert.deepEqual(h.calls,['/music/4.flac','/music/5.flac','/music/6.flac','/music/7.flac'],'positive scroll delta starts with the top visible row')
    await h.scroll(60)
    await h.demand([0,1,2,3])
    await h.drain(4)
    assert.deepEqual(h.calls.slice(4),['/music/2.flac','/music/3.flac','/music/0.flac','/music/1.flac'],'negative delta starts with the bottom visible row without reversing its columns')
    const probes=h.calls.length
    await h.scroll(120)
    await h.demand([4,5,6,7])
    await h.flush()
    assert.equal(h.calls.length,probes,'direction changes alone never reread cached covers')
  } finally { h.dispose() }
})

test('a fast reverse takes the newest window for the next free slot without preempting admitted work', async () => {
  const h=await harness(20)
  try {
    await h.scroll(120)
    await h.demand([4,5,6,7,8,9])
    assert.deepEqual(h.calls,['/music/4.flac','/music/5.flac'],'the local pipeline admits at most two requests')
    const oldFirst=h.pending.shift(),oldSecond=h.pending.shift()
    await h.scroll(60)
    await h.demand([0,1,2,3])
    assert.equal(h.calls.length,2,'reversal does not pretend an already active native request can be interrupted')
    await h.finish(oldFirst)
    assert.equal(h.calls.at(-1),'/music/2.flac','the newly free slot follows the latest backward order, not the old queue')
    assert(!h.store.cache.has(h.items[4].key),'late off-window completion cannot publish stale artwork')
    await h.finish(oldSecond)
    assert.equal(h.calls.at(-1),'/music/3.flac')
    await h.drain(4)
    assert.deepEqual(h.calls.slice(2),['/music/2.flac','/music/3.flac','/music/0.flac','/music/1.flac'])
  } finally { h.dispose() }
})

test('a ready later row publishes immediately while an earlier admitted decode is still pending', async () => {
  const h=await harness(20)
  try {
    h.holdDecode()
    await h.demand([0,2])
    await h.finish(h.pending.shift())
    await h.finish(h.pending.shift())
    await h.releaseDecodeAt(1)
    assert(h.store.cache.get(h.items[2].key)?.coverUrl,'a ready image is never held back to serialize its fade behind another row')
    assert(!h.store.cache.has(h.items[0].key))
    await h.releaseDecode()
    assert(h.store.cache.get(h.items[0].key)?.coverUrl)
    assert.equal(h.calls.length,2,'row admission adds no retry or artificial delay')
  } finally { h.dispose() }
})
