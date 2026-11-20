// Native continuous-input regression. The caller owns the already-running app.
// No routing/native IO replacement, startup/shutdown, library or appearance edits.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
async function fixtureOverlap() {
  const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
  const entry = await (await fetch(origin + '/src/main.tsx')).text()
  const dependency = name => { const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"')); assert(match, name); return match[1] }
  const shared = readFileSync(new URL('./playlistControllerSwipe.browser.test.mjs', import.meta.url), 'utf8')
  const literal = shared.match(/const fixture = (`[^]*?`)\r?\nconst html/)
  assert(literal, 'reuse real Panel/hook fixture without executing another suite')
  const fixture = runInNewContext(literal[1], { dependency }).replace('const appearance=useAppearance();', 'const appearance=useAppearance();window.continuousSettleMs=appearance.appearance.player.controllerSwipe.settleDurationMs*appearance.appearance.motion.durationScale;')
  const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__continuous_fixture.js"')
  const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = [], report = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)
  const row = '.playlist-playback-track[data-swipe-plane="current"]'
  const state = () => page.evaluate(() => ({ phase: document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase, calls: window.calls }))
  const startHeldSecond = async () => {
    await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle')
    await page.evaluate(() => { window.calls = [] })
    const box = await page.locator('.playlist-controller-swipe-viewport').boundingBox(), y = box.y + box.height * .5
    await page.mouse.move(box.x + box.width * .85, y); await page.mouse.down()
    await page.mouse.move(box.x + box.width * .53, y, { steps: 4 }); await page.mouse.up()
    assert.equal((await state()).phase, 'settling', 'held second pointer starts during the accepted first gesture')
    await page.mouse.move(box.x + box.width * .4, y); await page.mouse.down()
    await page.mouse.move(box.x + box.width * .1, y, { steps: 4 })
    return { box, y }
  }
  try {
    await page.route('**/__continuous_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__continuous_fixture', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(origin + '/__continuous_fixture')
    await page.locator(row).waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.playlist-panel')).transform === 'none')
    for (const secondFraction of (process.env.SPMUSIC_CONTINUOUS_SECOND_FRACTION ? [Number(process.env.SPMUSIC_CONTINUOUS_SECOND_FRACTION)] : [.12, .3])) {
      await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle')
      await page.evaluate(() => { window.calls = [] })
      const b = await page.locator('.playlist-controller-swipe-viewport').boundingBox(), y = b.y + b.height * .5
      await page.mouse.move(b.x + b.width * .85, y); await page.mouse.down()
      await page.mouse.move(b.x + b.width * .53, y, { steps: 4 }); await page.mouse.up()
      const beforeSecond = await state()
      assert.equal(beforeSecond.phase, 'settling', 'second input starts before the first gesture settles')
      const startFraction = secondFraction < .2 ? .15 : .4
      await page.mouse.move(b.x + b.width * startFraction, y); await page.mouse.down()
      await page.mouse.move(b.x + b.width * (startFraction - secondFraction), y, { steps: 4 })
      if (secondFraction < .2) await page.waitForTimeout(130) // Expire the intentional fling threshold.
      await page.mouse.up()
      const expectedCommits = secondFraction < .2 ? 1 : 2
      let settled = false
      try { await page.waitForFunction(count => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle' && window.calls.filter(call => call.type === 'commit').length === count, expectedCommits, { timeout: 2500 }); settled = true } catch { /* Preserve the failure. */ }
      const after = await state(), commits = after.calls.filter(call => call.type === 'commit'), closes = after.calls.filter(call => call.type === 'close')
      report.push({ secondFraction, expectedCommits, settled, beforeSecond, after })
      console.log('CONTINUOUS_OVERLAP_FIXTURE', JSON.stringify({ secondFraction, expectedCommits, commits: commits.length, closes: closes.length, settled }))
      assert.equal(closes.length, 0, 'a second drag never activates the ordinary open-player click')
      assert(settled, 'accepted threshold drags commit once each and return to idle')
      assert.equal(commits.length, expectedCommits, 'two threshold gestures produce two ordered commits')
    }
    await page.evaluate(() => { window.calls = [] })
    const rollbackBox = await page.locator('.playlist-controller-swipe-viewport').boundingBox(), rollbackY = rollbackBox.y + rollbackBox.height * .5
    await page.mouse.move(rollbackBox.x + rollbackBox.width * .85, rollbackY); await page.mouse.down()
    await page.mouse.move(rollbackBox.x + rollbackBox.width * .73, rollbackY, { steps: 4 })
    await page.waitForTimeout(130); await page.mouse.up()
    assert.equal((await state()).phase, 'settling', 'first short drag is still returning when the second starts')
    await page.mouse.move(rollbackBox.x + rollbackBox.width * .4, rollbackY); await page.mouse.down()
    await page.mouse.move(rollbackBox.x + rollbackBox.width * .1, rollbackY, { steps: 4 }); await page.mouse.up()
    let rollbackRecovered = false
    try { await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle' && window.calls.filter(call => call.type === 'commit').length === 1, null, { timeout: 2500 }); rollbackRecovered = true } catch { /* Preserve failed continuation. */ }
    const rollbackAfter = await state()
    report.push({ case: 'first-short-rollback-then-threshold-second', recovered: rollbackRecovered, after: rollbackAfter })
    console.log('CONTINUOUS_ROLLBACK_OVERLAP_FIXTURE', JSON.stringify({ commits: rollbackAfter.calls.filter(call => call.type === 'commit').length, closes: rollbackAfter.calls.filter(call => call.type === 'close').length, recovered: rollbackRecovered }))
    assert(rollbackRecovered, 'second threshold drag commits after first short rollback')
    assert.equal(rollbackAfter.calls.filter(call => call.type === 'close').length, 0, 'rollback overlap never navigates')
    await page.evaluate(() => { window.config.busyOnCommit = true })
    const held = await startHeldSecond()
    await page.waitForFunction(() => window.calls.filter(call => call.type === 'commit').length === 1)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => { window.config.busyOnCommit = false; window.updateFixture({ busy: false }) })
    await page.mouse.move(held.box.x + held.box.width * .03, held.y, { steps: 3 }); await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.playlist-controller-swipe-viewport')?.dataset.swipePhase === 'idle' && window.calls.filter(call => call.type === 'commit').length === 2)
    const heldAfter = await state()
    report.push({ case: 'held-second-crosses-owned-track-and-busy-effects', after: heldAfter })
    assert.equal(heldAfter.calls.filter(call => call.type === 'close').length, 0, 'held second drag never navigates')
    for (const boundary of ['external', 'seek', 'escape']) {
      await startHeldSecond()
      if (boundary === 'escape') await page.keyboard.press('Escape')
      else await page.evaluate(boundary => window.updateFixture(boundary === 'external' ? { index: 4, sequence: 500, intent: null } : { interaction: 'seeking' }), boundary)
      await page.mouse.up()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (boundary === 'seek') await page.evaluate(() => window.updateFixture({ interaction: 'following' }))
      // A bounded negative observation after cancellation, not a successful-input wait.
      await page.waitForTimeout(await page.evaluate(() => window.continuousSettleMs * 2 + 100))
      const cancelled = await state()
      report.push({ case: boundary + '-cancels-pending-second', after: cancelled })
      assert(cancelled.calls.filter(call => call.type === 'commit').length <= 1, boundary + ' prevents pending second replay')
      assert.equal(cancelled.calls.filter(call => call.type === 'close').length, 0, boundary + ' release never activates open-player click')
    }
    await page.evaluate(() => { window.calls = [] })
    await page.locator(row + ' .playlist-playback-track-button').click()
    await page.locator(row + ' .playlist-playback-track-button').focus(); await page.keyboard.press('Enter')
    assert.equal((await state()).calls.filter(call => call.type === 'close').length, 2, 'idle click and keyboard still open the player')
    await startHeldSecond()
    await page.evaluate(() => window.unmountFixture())
    await page.mouse.up()
    await page.waitForTimeout(await page.evaluate(() => window.continuousSettleMs * 2 + 100))
    const unmounted = await state()
    report.push({ case: 'unmount-cancels-pending-second', after: unmounted })
    assert(unmounted.calls.filter(call => call.type === 'commit').length <= 1, 'unmount never replays pending second')
    assert.deepEqual(errors, [])
  } finally {
    if (process.env.SPMUSIC_PROBE_OUTPUT) { mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)), { recursive: true }); writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT, JSON.stringify({ errors, report }, null, 2)) }
    await page.close(); await browser.close()
  }
}
if (process.env.SPMUSIC_CONTINUOUS_FIXTURE === '1') { await fixtureOverlap(); process.exit(0) }
assert(process.env.SPMUSIC_NATIVE_CDP && process.env.SPMUSIC_PROBE_OUTPUT, 'explicit native endpoint and evidence path required')
const browser = await chromium.connectOverCDP(process.env.SPMUSIC_NATIVE_CDP)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length, 1, 'one existing native target')
const page = pages[0]
page.setDefaultTimeout(15000)
const result = { label: process.env.SPMUSIC_PROBE_LABEL || 'native-continuous', engine: browser.version(), gestures: [], sequences: [] }
await page.evaluate(() => {
  if (window.__controllerContinuousProbe) throw Error('a continuous recorder already exists')
  const digest = value => { let hash = 2166136261; for (const c of String(value ?? '')) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619) } return (hash >>> 0).toString(16) }
  const surface = () => {
    const node = document.querySelector('.player-shell')
    let root = node?.[Object.keys(node).find(key => key.startsWith('__reactFiber$'))]
    while (root?.return) root = root.return
    const stack = [root?.stateNode?.current || root]
    while (stack.length) { const f = stack.pop(); if (!f) continue; if (f.memoizedProps?.viewModel?.playback) return f; if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child) }
    throw Error('current native React surface unavailable')
  }
  const vm = () => surface().memoizedProps.viewModel
  const model = vm()
  const saved = { id: model.playback.track.id, playing: model.playback.isPlaying, open: model.playlist.isOpen, position: model.timeline.positionSeconds }
  const frameTimes = [], events = [], states = [], longTasks = []
  let running = true, lastKey = ''
  const snapshot = () => {
    const fiber = surface(), model = fiber.memoizedProps.viewModel, p = model.playback, values = []
    for (let hook = fiber.memoizedState, i = 0; hook && i < 700; hook = hook.next, i++) { const value = hook.memoizedState; values.push(value); if (value && typeof value === 'object' && 'current' in value) values.push(value.current) }
    const layers = values.find(value => Array.isArray(value) && value.some(layer => layer?.resource && layer?.track && typeof layer.phase === 'string'))
    const pool = values.find(value => value && typeof value.hasAvailable === 'function' && typeof value.waitForAvailable === 'function')
    const gesture = values.find(value => value && typeof value === 'object' && 'gestureId' in value && 'originTrackId' in value)
    const token = values.find(value => value && typeof value === 'object' && 'targetTrackId' in value && 'artwork' in value && 'originTrackId' in value)
    const viewport = document.querySelector('.playlist-controller-swipe-viewport')
    return { time: performance.now(), logical: digest(p.track?.id), playing: p.isPlaying, playlistOpen: model.playlist.isOpen,
      busy: p.isAudioBusy, transport: p.isTransportBusy, selectionPending: p.isSelectionPending, details: p.detailsPending, selectionSequence: p.selectionActivitySequence,
      phase: viewport?.dataset.swipePhase, poolAvailable: pool?.hasAvailable() ?? null,
      preview: token ? { id: token.id, origin: digest(token.originTrackId), target: digest(token.targetTrackId) } : null,
      slots: layers?.filter(Boolean).map(layer => ({ id: layer.id, track: digest(layer.track.id), phase: layer.phase, token: layer.previewTokenId ?? null, view: Boolean(layer.resource.view), released: layer.resource.isReleased() })) ?? [],
      gesture: gesture ? { id: gesture.gestureId, origin: digest(gesture.originTrackId), released: gesture.released, targetReady: gesture.targetReady, progress: gesture.progress, token: gesture.token?.id ?? null } : null,
      dock: [...document.querySelectorAll('.playlist-playback-track')].map(row => ({ phase: row.dataset.swipePlane, title: digest(row.querySelector('strong')?.textContent), canvas: Boolean(row.querySelector('canvas')), transform: row.style.transform })),
      full: [...document.querySelectorAll('.track-card-plane')].map(row => ({ phase: row.dataset.trackCardPhase, transform: row.style.transform })) }
  }
  const mark = label => { const state = snapshot(); events.push({ type: 'mark', label, time: state.time }); states.push({ label, ...state }); return state }
  const raw = event => {
    const zone = event.target?.closest?.('.playlist-controller-swipe-viewport') ? 'dock' : event.target?.closest?.('.cover-input-region,.cover-frame') ? 'cover' : 'other'
    if (zone === 'other') return
    events.push({ type: event.type, zone, time: performance.now(), trusted: event.isTrusted,
      trackButton: Boolean(event.target?.closest?.('.playlist-playback-track-button')) })
    states.push({ label: event.type, ...snapshot() })
    if (event.type === 'click') queueMicrotask(() => states.push({ label: 'click-after', ...snapshot() }))
  }
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, raw, true)
  const observer = new PerformanceObserver(list => { for (const task of list.getEntries()) longTasks.push({ time: task.startTime, duration: task.duration }) })
  observer.observe({ type: 'longtask', buffered: false })
  const sample = time => {
    if (!running) return
    frameTimes.push(time)
    const viewport = document.querySelector('.playlist-controller-swipe-viewport'), current = document.querySelector('.playlist-playback-track[data-swipe-plane="current"]')
    const key = [viewport?.dataset.swipePhase, current?.querySelector('strong')?.textContent, document.querySelectorAll('.track-card-plane[data-track-card-phase="incoming"]').length, document.querySelectorAll('.track-card-plane[data-track-card-phase="preview"]').length].join('|')
    if (key !== lastKey) { lastKey = key; states.push({ label: 'visual-change', ...snapshot() }) }
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
  window.__controllerContinuousProbe = { vm, saved, digest, snapshot, mark, initial: { track: digest(saved.id), playing: saved.playing, open: saved.open }, read: () => ({ frameTimes, events, states, longTasks }), dispose: () => {
    running = false; observer.disconnect(); for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.removeEventListener(type, raw, true); delete window.__controllerContinuousProbe
  } }
})
async function setPlaying(target) {
  const state = await page.evaluate(() => { const p = window.__controllerContinuousProbe.vm(); return { playing: p.playback.isPlaying, open: p.playlist.isOpen } })
  if (state.playing === target) return
  if (state.open) await page.locator('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-toggle').click()
  else await page.locator('.control-dock').getByRole('button', { name: target ? '播放' : '暂停', exact: true }).click()
  await page.waitForFunction(target => { const p = window.__controllerContinuousProbe.vm().playback; return p.isPlaying === target && !p.isTransportBusy }, target)
}
async function show(open) {
  await page.evaluate(open => { const p = window.__controllerContinuousProbe.vm(); if (p.playlist.isOpen !== open) p.playlist.onOpenChange(open) }, open)
  await page.waitForFunction(open => window.__controllerContinuousProbe.vm().playlist.isOpen === open, open)
  if (open) await page.locator('.playlist-playback-track[data-swipe-plane="current"]').waitFor()
  else await page.locator('.cover-input-region').waitFor()
}
async function gesture(zone, direction, label) {
  const before = await page.evaluate(label => window.__controllerContinuousProbe.mark(label + '-down'), label)
  const selector = zone === 'dock' ? '.playlist-controller-swipe-viewport' : '.cover-input-region'
  const box = await page.locator(selector).boundingBox()
  assert(box, 'stable input viewport exists')
  const start = Date.now(), x = box.x + box.width * (direction > 0 ? .85 : .15), y = box.y + box.height * (zone === 'dock' ? .5 : .35)
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x - direction * box.width * .65, y, { steps: 5 })
  await page.mouse.up()
  const after = await page.evaluate(label => window.__controllerContinuousProbe.mark(label + '-up'), label)
  const data = { zone, direction, label, inputMs: Date.now() - start, before, after }
  result.gestures.push(data)
  return data
}
async function continuous(zone) {
  await show(zone === 'dock')
  // One boundary wait before a sequence; no settling wait between burst inputs.
  await page.waitForTimeout(700)
  const count = Number(process.env.SPMUSIC_CONTINUOUS_COUNT || 12), interval = Number(process.env.SPMUSIC_CONTINUOUS_INTERVAL || 180)
  const start = Date.now(), first = await page.evaluate(zone => window.__controllerContinuousProbe.mark(zone + '-burst-start'), zone)
  for (let i = 0; i < count; i++) {
    const remaining = start + i * interval - Date.now()
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
    await gesture(zone, i % 2 ? -1 : 1, zone + '-burst-' + i)
  }
  // Tail observes recovery; it is never used to claim an input was accepted.
  await page.waitForTimeout(1000)
  const last = await page.evaluate(zone => window.__controllerContinuousProbe.mark(zone + '-burst-end'), zone)
  result.sequences.push({ zone, kind: 'fixed-cadence', count, interval, first, last })
  for (const delay of [0, 16, 50, 0, 16, 50]) {
    await page.waitForFunction(zone => {
      const p = window.__controllerContinuousProbe.snapshot()
      return !p.busy && !p.selectionPending && (zone === 'dock' ? p.phase === 'idle' : !p.full.some(row => row.phase === 'incoming' || row.phase === 'exiting'))
    }, zone)
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const index = result.gestures.length, direction = index % 2 ? -1 : 1
    const input = await gesture(zone, direction, `${zone}-idle-${delay}-${index}`)
    let committed = false
    try { await page.waitForFunction(before => { const p = window.__controllerContinuousProbe; return p.digest(p.vm().playback.track.id) !== before }, input.before.logical, { timeout: 2500 }); committed = true } catch { /* Failure remains evidence. */ }
    result.sequences.push({ zone, kind: 'idle-boundary', delay, committed, label: input.label })
  }
}
async function overlap() {
  await show(true)
  await page.waitForTimeout(700)
  const box = await page.locator('.playlist-controller-swipe-viewport').boundingBox()
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForFunction(() => { const s = window.__controllerContinuousProbe.snapshot(); return s.playlistOpen && s.phase === 'idle' && !s.busy && !s.selectionPending })
    const kind = ['short', 'threshold', 'held', 'rollback-first'][attempt % 4]
    const y = box.y + box.height * .5
    const first = await page.evaluate(attempt => window.__controllerContinuousProbe.mark('overlap-first-' + attempt), attempt)
    await page.mouse.move(box.x + box.width * .85, y); await page.mouse.down()
    await page.mouse.move(box.x + box.width * (kind === 'rollback-first' ? .73 : .53), y, { steps: 4 })
    if (kind === 'rollback-first') await page.waitForTimeout(130)
    await page.mouse.up()
    // Start on the still-visible outgoing button before its settling ends.
    const second = await page.evaluate(attempt => window.__controllerContinuousProbe.mark('overlap-second-' + attempt), attempt)
    const fraction = kind === 'short' ? .12 : .3, startX = kind === 'short' ? .15 : .4
    await page.mouse.move(box.x + box.width * startX, y); await page.mouse.down()
    await page.mouse.move(box.x + box.width * (startX - fraction), y, { steps: 4 })
    if (kind === 'short') await page.waitForTimeout(130) // Ensure this is not a velocity-qualified fling.
    if (kind === 'held') {
      await page.waitForFunction(sequence => window.__controllerContinuousProbe.snapshot().selectionSequence > sequence, first.selectionSequence)
      await page.mouse.move(box.x + box.width * .03, y, { steps: 3 })
    }
    await page.mouse.up()
    const released = await page.evaluate(attempt => window.__controllerContinuousProbe.mark('overlap-released-' + attempt), attempt)
    // The second gesture was already sent without waiting. Now observe either
    // unintended navigation or completion of the first accepted gesture.
    let recovered = false
    try {
      await page.waitForFunction(({ sequence, expected }) => { const p = window.__controllerContinuousProbe.snapshot(); return !p.playlistOpen || p.phase === 'idle' && !p.selectionPending && !p.busy && p.selectionSequence >= sequence + expected }, { sequence: first.selectionSequence, expected: kind === 'short' || kind === 'rollback-first' ? 1 : 2 }, { timeout: 3000 })
      recovered = true
    } catch { /* A stuck first gesture remains a failed acceptance check. */ }
    const final = await page.evaluate(attempt => window.__controllerContinuousProbe.mark('overlap-result-' + attempt), attempt)
    const advances = final.selectionSequence - first.selectionSequence
    result.sequences.push({ kind: 'overlap', inputKind: kind, attempt, first, second, released, final, recovered, advances })
    console.log('NATIVE_OVERLAP', JSON.stringify({ attempt, kind, phaseAtSecond: second.phase, advances, open: final.playlistOpen, recovered }))
    if (!final.playlistOpen) { result.navigationFailure = { attempt, second, released, final }; break }
    if (!recovered || advances !== (kind === 'short' || kind === 'rollback-first' ? 1 : 2)) { result.stuckGesture = { attempt, first, second, released, final }; break }
  }
}
try {
  result.initial = await page.evaluate(() => window.__controllerContinuousProbe.initial)
  result.assets = await page.evaluate(() => [...document.scripts].filter(script => script.src.includes('/assets/')).map(script => new URL(script.src).pathname))
  await setPlaying(true)
  if (process.env.SPMUSIC_CONTINUOUS_OVERLAP === '1') await overlap()
  else for (const zone of (process.env.SPMUSIC_CONTINUOUS_ZONE ? [process.env.SPMUSIC_CONTINUOUS_ZONE] : ['dock'])) await continuous(zone)
} catch (error) { result.error = String(error) }
finally {
  try {
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await page.evaluate(() => { const p = window.__controllerContinuousProbe, model = p.vm(); if (model.playback.track.id !== p.saved.id) model.playlist.onTrackSelect(p.saved.id) })
    await page.waitForFunction(() => { const p = window.__controllerContinuousProbe, playback = p.vm().playback; return playback.track.id === p.saved.id && !playback.isSelectionPending && !playback.isAudioBusy })
    await setPlaying(result.initial.playing)
    await page.evaluate(() => { const p = window.__controllerContinuousProbe, model = p.vm(); model.timeline.onCommit(p.saved.position); if (model.playlist.isOpen !== p.saved.open) model.playlist.onOpenChange(p.saved.open) })
    result.restored = await page.evaluate(() => { const p = window.__controllerContinuousProbe, model = p.vm(); return { track: p.digest(model.playback.track.id), playing: model.playback.isPlaying, open: model.playlist.isOpen } })
  } catch (error) { result.restoreError = String(error) }
  Object.assign(result, await page.evaluate(() => window.__controllerContinuousProbe.read()))
  await page.evaluate(() => window.__controllerContinuousProbe.dispose())
  const intervals = result.frameTimes.slice(1).map((time, i) => time - result.frameTimes[i]).sort((a, b) => a - b)
  result.summary = { inputs: result.gestures.length + result.sequences.filter(sequence => sequence.kind === 'overlap').length * 2, idleFailures: result.sequences.filter(sequence => sequence.kind === 'idle-boundary' && !sequence.committed).length,
    frameIntervals: { p50: intervals[Math.floor(intervals.length * .5)], p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), over50ms: intervals.filter(value => value > 50).length },
    longTasks: { count: result.longTasks.length, max: Math.max(0, ...result.longTasks.map(task => task.duration)), total: result.longTasks.reduce((sum, task) => sum + task.duration, 0) } }
  mkdirSync(dirname(resolve(process.env.SPMUSIC_PROBE_OUTPUT)), { recursive: true })
  writeFileSync(process.env.SPMUSIC_PROBE_OUTPUT, JSON.stringify(result, null, 2))
  console.log('NATIVE_CONTINUOUS_RESULT', JSON.stringify({ ...result.summary, navigationFailure: Boolean(result.navigationFailure), stuckGesture: Boolean(result.stuckGesture), error: result.error, restoreError: result.restoreError, initial: result.initial, restored: result.restored, output: process.env.SPMUSIC_PROBE_OUTPUT }))
}
process.exit(result.error || result.restoreError || result.summary.idleFailures || result.navigationFailure || result.stuckGesture ? 1 : 0)
