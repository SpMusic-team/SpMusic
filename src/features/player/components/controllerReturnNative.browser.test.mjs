// Explicitly opt in to an already-running Tauri host. Never starts/stops the app
// or replaces native IO. Restores the original song, play state and list visibility.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

assert(process.env.SPMUSIC_NATIVE_CDP && process.env.SPMUSIC_PROBE_OUTPUT, 'explicit native endpoint and evidence path required')
const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const browser = await chromium.connectOverCDP(process.env.SPMUSIC_NATIVE_CDP)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length, 1, 'exactly one existing native Tauri page')
const page = pages[0]
page.setDefaultTimeout(20000)
const current = '.playlist-playback-track[data-swipe-plane="current"]'
const result = { engine: browser.version(), label: process.env.SPMUSIC_PROBE_LABEL || 'native', rounds: [] }
await page.evaluate(() => {
  const vm = () => {
    const node = document.querySelector('.player-shell')
    let fiber = node?.[Object.keys(node).find(key => key.startsWith('__reactFiber$'))]
    while (fiber?.return) fiber = fiber.return
    const stack = [fiber?.stateNode?.current || fiber]
    while (stack.length) {
      const next = stack.pop()
      if (!next) continue
      if (next.memoizedProps?.viewModel?.playback) return next.memoizedProps.viewModel
      if (next.sibling) stack.push(next.sibling)
      if (next.child) stack.push(next.child)
    }
    throw Error('native React view model unavailable')
  }
  const initial = vm()
  const digest = value => { let hash = 2166136261; for (const char of String(value ?? '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) } return (hash >>> 0).toString(16) }
  const saved = { id: initial.playback.track.id, playing: initial.playback.isPlaying, open: initial.playlist.isOpen, position: initial.timeline.positionSeconds }
  const events = [], originalInvoke = window.__TAURI_INTERNALS__.invoke
  let nextCall = 0
  const invoke = function (command, ...args) {
    const id = ++nextCall, time = performance.now()
    events.push({ type: 'start', command, id, time })
    return Promise.resolve(originalInvoke.call(this, command, ...args)).then(value => { events.push({ type: 'end', command, id, time: performance.now(), ms: performance.now() - time }); return value }, error => { events.push({ type: 'error', command, id, time: performance.now() }); throw error })
  }
  window.__TAURI_INTERNALS__.invoke = invoke
  window.__controllerReturnNative = { vm, saved, digest, events, initial: { track: digest(saved.id), playing: saved.playing, open: saved.open }, dispose: () => {
    if (window.__TAURI_INTERNALS__.invoke === invoke) window.__TAURI_INTERNALS__.invoke = originalInvoke
    delete window.__controllerReturnNative
  } }
})
async function setPlaying(target) {
  const state = await page.evaluate(() => { const model = window.__controllerReturnNative.vm(); return { playing: model.playback.isPlaying, open: model.playlist.isOpen } })
  if (state.playing === target) return
  if (state.open) await page.locator(current + ' .playlist-playback-toggle').click()
  else await page.locator('.control-dock').getByRole('button', { name: target ? '播放' : '暂停', exact: true }).click()
  await page.waitForFunction(target => { const p = window.__controllerReturnNative.vm().playback; return p.isPlaying === target && !p.isTransportBusy }, target)
}
async function round(direction) {
  await page.evaluate(() => {
    const probe = window.__controllerReturnNative
    probe.frames = []
    probe.sampling = true
    const ids = new WeakMap()
    let sequence = 0
    const identity = node => { if (!ids.has(node)) ids.set(node, ++sequence); return ids.get(node) }
    const sample = time => {
      if (!probe.sampling) return
      const p = probe.vm().playback
      const rows = [...document.querySelectorAll('.playlist-playback-track')].map(row => {
        const r = row.getBoundingClientRect(), cover = row.querySelector('.playlist-playback-cover'), copy = row.querySelector('.playlist-playback-copy'), canvas = row.querySelector('canvas')
        const part = node => { if (!node) return null; const b = node.getBoundingClientRect(), s = getComputedStyle(node); return { x: b.x - r.x, y: b.y - r.y, opacity: Number(s.opacity), transform: s.transform } }
        return { phase: row.dataset.swipePlane, title: probe.digest(row.querySelector('strong')?.textContent), x: r.x, cover: part(cover), copy: part(copy), canvas: canvas ? identity(canvas) : null,
          rgb: canvas?.width && canvas?.height ? [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data].join(',') : null }
      })
      probe.frames.push({ time, logical: probe.digest(p.track?.id), title: probe.digest(p.track?.title), busy: p.isAudioBusy, pending: p.isSelectionPending, details: p.detailsPending,
        phase: document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase, rows })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const before = await page.evaluate(() => window.__controllerReturnNative.digest(window.__controllerReturnNative.vm().playback.track.id))
  const b = await page.locator(current).boundingBox()
  assert(b, 'visible native controller row')
  const x = b.x + b.width * (direction > 0 ? .75 : .25), y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * b.width * .42, y, { steps: 6 })
  await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"]').waitFor()
  await page.waitForTimeout(180)
  const expected = await page.locator('.playlist-playback-track[data-swipe-plane="neighbor"] strong').evaluate(node => window.__controllerReturnNative.digest(node.textContent))
  await page.mouse.up()
  await page.waitForFunction(before => { const p = window.__controllerReturnNative; return p.digest(p.vm().playback.track.id) !== before && !p.vm().playback.isSelectionPending }, before)
  await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle')
  await page.waitForTimeout(500)
  const data = await page.evaluate(() => { const p = window.__controllerReturnNative; p.sampling = false; return { after: p.digest(p.vm().playback.track.id), frames: p.frames } })
  const committed = data.frames.filter(frame => frame.logical !== before)
  const stale = committed.filter(frame => frame.rows.find(row => row.phase === 'current')?.title !== expected)
  const baseline = data.frames[0]?.rows.find(row => row.phase === 'current')
  assert(baseline, 'native row establishes its own theme geometry')
  const projected = committed.filter(frame => frame.rows.some(row => row.phase === 'current' && (Math.abs((row.cover?.x ?? 0) - baseline.cover.x) > 1 || Math.abs((row.copy?.x ?? 0) - baseline.copy.x) > 1)))
  const summary = { direction, before, after: data.after, expected, committedFrames: committed.length, staleFrames: stale.length, projectedFrames: projected.length, firstStale: stale.slice(0, 4), frames: data.frames }
  result.rounds.push(summary)
  console.log('NATIVE_CONTROLLER_RETURN', JSON.stringify({ direction, before, after: data.after, committedFrames: committed.length, staleFrames: stale.length, projectedFrames: projected.length }))
}
try {
  result.initial = await page.evaluate(() => window.__controllerReturnNative.initial)
  await setPlaying(true)
  if (!result.initial.open) {
    await page.locator('.window-bar').getByRole('button', { name: '播放列表', exact: true }).click()
    await page.waitForFunction(() => window.__controllerReturnNative.vm().playlist.isOpen)
  }
  await page.locator(current).waitFor()
  await page.waitForTimeout(700)
  for (const direction of [1, -1, 1, -1]) await round(direction)
} catch (error) {
  result.error = String(error)
} finally {
  try {
    await page.evaluate(() => { const p = window.__controllerReturnNative, model = p.vm(); if (model.playback.track.id !== p.saved.id) model.playlist.onTrackSelect(p.saved.id) })
    await page.waitForFunction(() => { const p = window.__controllerReturnNative, playback = p.vm().playback; return playback.track?.id === p.saved.id && !playback.isSelectionPending && !playback.isAudioBusy })
    await setPlaying(result.initial.playing)
    await page.evaluate(() => { const p = window.__controllerReturnNative, model = p.vm(); model.timeline.onCommit(p.saved.position); if (model.playlist.isOpen !== p.saved.open) model.playlist.onOpenChange(p.saved.open) })
    result.restored = await page.evaluate(() => { const p = window.__controllerReturnNative, model = p.vm(); return { track: p.digest(model.playback.track.id), playing: model.playback.isPlaying, open: model.playlist.isOpen } })
  } catch (error) { result.restoreError = String(error) }
  result.events = await page.evaluate(() => window.__controllerReturnNative.events)
  result.regression = result.rounds.some(round => round.staleFrames || round.projectedFrames)
  await page.evaluate(() => window.__controllerReturnNative.dispose())
  mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)), { recursive: true })
  writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT, JSON.stringify(result, null, 2))
}
// Disconnect without closing the native host.
process.exit(result.error || result.restoreError || result.regression ? 1 : 0)
