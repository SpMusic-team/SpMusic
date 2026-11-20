// Real browser Storage and the production Vite module; no filesystem fixture.
// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
let browser
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' }) })
after(async () => { await browser?.close() })
async function run(body, args) {
  const page = await browser.newPage()
  try {
    await page.route('**/__manual_order_storage_test', route => route.fulfill({ contentType: 'text/html', body: '<script type="module">import * as api from "/src/features/player/model/manualSongOrderStorage.ts";window.orderStorage=api;</script>' }))
    await page.goto(origin + '/__manual_order_storage_test')
    await page.waitForFunction(() => Boolean(window.orderStorage))
    return await page.evaluate(body, args)
  } finally { await page.close() }
}

test('manual ordering stores independent folder and aggregate scopes with canonical separators', async () => {
  const value = await run(() => {
    const api = window.orderStorage
    const initial = api.readManualSongOrders()
    api.saveManualSongOrder('folder:a', ['C:\\Music\\b.flac', 'C:/Music/a.flac'], undefined)
    api.saveManualSongOrder(null, ['/audio/b.flac', '/audio/a.flac'], undefined)
    const read = api.readManualSongOrders()
    return { initial: [...initial.orders], error: read.error, orders: [...read.orders], raw: JSON.parse(localStorage.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY)) }
  })
  assert.deepEqual(value.initial, [])
  assert.equal(value.error, undefined)
  assert.deepEqual(value.orders, [['folder:a', ['C:/Music/b.flac', 'C:/Music/a.flac']], [null, ['/audio/b.flac', '/audio/a.flac']]])
  assert.equal(value.raw.version, 1)
})

test('manual merge removes stale paths and appends new discoveries without metadata sorting', async () => {
  const value = await run(() => {
    const api = window.orderStorage
    const rows = [{ path: '/music/a', title: 'A' }, { path: '/music/b', title: 'Z' }, { path: '/music/new', title: '0' }]
    const first = api.applyManualSongOrder(rows, ['/music/deleted', '/music/b', '/music/a'], item => item.path)
    const changed = rows.map(item => ({ ...item, title: 'renamed ' + item.title }))
    return { first: first.map(item => item.path), second: api.applyManualSongOrder(changed, ['/music/b', '/music/a'], item => item.path).map(item => item.path) }
  })
  assert.deepEqual(value.first, ['/music/b', '/music/a', '/music/new'])
  assert.deepEqual(value.second, value.first)
})

test('filtered moves replace only visible slots and reject stale or invalid projections', async () => {
  const value = await run(() => {
    const api = window.orderStorage
    const full = ['hidden-0', 'a', 'hidden-1', 'b', 'hidden-2', 'c']
    return { moved: api.mergeFilteredSongOrder(full, ['a', 'b', 'c'], ['b', 'c', 'a']),
      stale: api.mergeFilteredSongOrder(full, ['b', 'a', 'c'], ['a', 'c', 'b']),
      duplicate: api.mergeFilteredSongOrder(full, ['a', 'b', 'c'], ['a', 'a', 'b']),
      foreign: api.mergeFilteredSongOrder(full, ['a', 'b', 'c'], ['a', 'b', 'x']) }
  })
  assert.deepEqual(value.moved, ['hidden-0', 'b', 'hidden-1', 'c', 'hidden-2', 'a'])
  assert.equal(value.stale, undefined)
  assert.equal(value.duplicate, undefined)
  assert.equal(value.foreign, undefined)
})

test('storage compare-and-swap rejects another move on the same scope but keeps unrelated scopes', async () => {
  const value = await run(() => {
    const api = window.orderStorage
    api.saveManualSongOrder('a', ['a', 'b'], undefined)
    api.saveManualSongOrder('other', ['x', 'y'], undefined)
    api.saveManualSongOrder('a', ['b', 'a'], ['a', 'b'])
    const before = localStorage.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY)
    let error
    try { api.saveManualSongOrder('a', ['a', 'b'], ['a', 'b']) } catch (failure) { error = failure.message }
    return { error, unchanged: before === localStorage.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY), orders: [...api.readManualSongOrders().orders] }
  })
  assert.match(value.error, /更改/)
  assert(value.unchanged)
  assert.deepEqual(value.orders, [['a', ['b', 'a']], ['other', ['x', 'y']]])
})

test('corrupt, future and duplicated documents remain untouched and never become successful empty storage', async () => {
  const values = await run(() => {
    const api = window.orderStorage
    return ['not json', JSON.stringify({ version: 2, orders: [] }), JSON.stringify({ version: 1, orders: [{ scope: null, paths: ['a', 'a'] }] }),
      JSON.stringify({ version: 1, orders: [{ scope: 'a', paths: ['x'] }, { scope: 'a', paths: ['y'] }] })].map(raw => {
      localStorage.setItem(api.MANUAL_SONG_ORDER_STORAGE_KEY, raw)
      const read = api.readManualSongOrders()
      let error
      try { api.saveManualSongOrder(null, ['valid'], undefined) } catch (failure) { error = failure.message }
      return { readError: Boolean(read.error), writeError: Boolean(error), unchanged: raw === localStorage.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY) }
    })
  })
  assert(values.every(value => value.readError && value.writeError && value.unchanged))
})

test('quota and unavailable storage report failures without overwriting the previous order', async () => {
  const value = await run(() => {
    const api = window.orderStorage
    api.saveManualSongOrder(null, ['a', 'b'], undefined)
    const target = window.localStorage, before = target.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY)
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, text) { if (key === api.MANUAL_SONG_ORDER_STORAGE_KEY) throw new DOMException('fixture quota', 'QuotaExceededError'); return original.call(this, key, text) }
    let quota
    try { api.saveManualSongOrder(null, ['b', 'a'], ['a', 'b']) } catch (failure) { quota = failure.message }
    Storage.prototype.setItem = original
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('fixture unavailable', 'SecurityError') } })
    const unavailable = api.readManualSongOrders()
    return { quota, unchanged: target.getItem(api.MANUAL_SONG_ORDER_STORAGE_KEY) === before, unavailable: Boolean(unavailable.error) }
  })
  assert.match(value.quota, /无法保存歌曲排序.*存储.*空间/)
  assert(value.unchanged)
  assert(value.unavailable)
})
