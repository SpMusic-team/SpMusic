// Start Vite; set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Independent regression: trusted browser input and visible geometry, no new dependency.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const panelPath = '/src/features/player/components/PlaylistPanel.tsx'
const source = await (await fetch(origin + panelPath)).text()
// Isolate the former mouse-only input boundary without changing repository
// production files. This A/B preserves current rendering and removes exactly
// the four touch listener registrations introduced by the defect fix.
const touchBaseline = process.env.SPMUSIC_TOUCH_BASELINE_ONLY === '1'
const imageBaseline = process.env.SPMUSIC_IMAGE_BASELINE_ONLY === '1'
const nativeBoundaryBaseline = process.env.SPMUSIC_NATIVE_BOUNDARY_BASELINE_ONLY === '1'
let baselineHook = null
if (touchBaseline) {
  const body = await (await fetch(origin + '/src/features/player/hooks/usePlaylistOverscroll.ts')).text()
  let removed = 0
  baselineHook = body.replace(/panel\.addEventListener\((['"])touch(?:start|move|end|cancel)\1,[^\n]+/g, () => { removed++; return '' })
  assert.equal(removed, 4, 'baseline removes exactly the new four touch listeners')
}
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = filename => {
  const match = (source + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + filename.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${filename}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlaylistPanel } from '${panelPath}';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const noop=()=>{};
const blob=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'],{type:'image/svg+xml'}));
const count=Number(new URLSearchParams(location.search).get('count')||120);
const tracks=Array.from({length:count},(_,i)=>({id:'track-'+i,title:'Test song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:true,coverThumbnail:{src:blob,width:128,height:128,encodedBytes:256}}));
window.actions=[];
const playback={track:{...tracks[0],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
const timeline={positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
const root=ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture=()=>root.unmount();
root.render(React.createElement(AppearanceProvider,null,React.createElement(PlaylistPanel,{tracks,currentTrackId:'track-0',shuffleMode:'none',onShuffleCycle:()=>window.actions.push('shuffle'),playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:()=>window.actions.push('play'),onTrackSelect:id=>window.actions.push(id),onClose:()=>window.actions.push('close')})));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__elastic_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
console.log('BROWSER', browser.version())
let passed = 0

async function open({ width = 1280, height = 1000, motion = 'no-preference', count = 120, level = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: motion })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', String(level))
    window.panelListeners = []
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    const types = new Set(['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'click', 'dragstart', 'blur', 'resize', 'touchstart', 'touchmove', 'touchend', 'touchcancel'])
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (types.has(type) && ((this instanceof Element && this.matches('.playlist-panel')) || this === window)) window.panelListeners.push({ target: this, type, listener, active: true })
      return add.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      for (const item of window.panelListeners) if (item.target === this && item.type === type && item.listener === listener) item.active = false
      return remove.call(this, type, listener, options)
    }
  }, level)
  await page.route('**/__elastic_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  if (baselineHook) await page.route('**/src/features/player/hooks/usePlaylistOverscroll.ts*', route => route.fulfill({ contentType: 'text/javascript', body: baselineHook }))
  await page.route('**/__elastic_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__elastic_test?count=' + count)
  await page.locator('.playlist-card').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
  await page.waitForTimeout(100)
  if (imageBaseline) await page.addStyleTag({ content: '.playlist-hero-image { height: 100% !important; scale: none !important; }' })
  if (nativeBoundaryBaseline) await page.addStyleTag({ content: '.playlist-panel { overscroll-behavior-y: contain !important; }' })
  return { page, errors }
}
async function geometry(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.playlist-panel')
    const hero = document.querySelector('.playlist-hero')
    const box = element => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const p = panel.getBoundingClientRect(), h = hero.getBoundingClientRect()
    const image = document.querySelector('.playlist-hero-image'), imageRect = image.getBoundingClientRect()
    const imageStyle = getComputedStyle(image)
    return {
      panel: box(panel), hero: box(hero), grid: box(document.querySelector('.playlist-grid')),
      firstCard: box(document.querySelector('.playlist-card')), lastCard: box(document.querySelector('.playlist-card:last-child')),
      sidebar: box(document.querySelector('.playlist-library-sidebar')),
      dock: box(document.querySelector('.playlist-playback-dock')),
      visibleWidth: Math.max(0, Math.min(h.right, p.right - (panel.offsetWidth - panel.clientWidth)) - Math.max(h.left, p.left)),
      visibleHeight: Math.max(0, Math.min(h.bottom, p.bottom) - Math.max(h.top, p.top)),
      image: { ...box(image), scaleX: imageRect.width / Number.parseFloat(imageStyle.width), scaleY: imageRect.height / Number.parseFloat(imageStyle.height),
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, objectFit: imageStyle.objectFit, opacity: Number(imageStyle.opacity) },
      controls: [...hero.querySelectorAll('.playlist-hero-category, .playlist-hero-title, .playlist-hero-meta, .playlist-hero-actions, .playlist-close')].map(box).filter(r => r.width > 0 && r.height > 0),
      scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, max: panel.scrollHeight - panel.clientHeight,
      offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0,
      animations: [...panel.querySelectorAll('*')].reduce((n, el) => n + el.getAnimations().length, 0),
    }
  })
}
const near = (a, b, message) => assert(Math.abs(a - b) < 0.75, `${message}: ${a} vs ${b}`)
function fixed(before, after) {
  for (const key of ['panel', 'sidebar', 'dock']) for (const axis of ['x', 'y', 'width', 'height']) near(before[key][axis], after[key][axis], `${key} ${axis} remains fixed`)
  assert.equal(after.scrollHeight, before.scrollHeight, 'feedback does not alter native scroll range')
}
function stretched(before, held) {
  near(held.hero.y, before.hero.y, 'hero top anchored')
  near(held.hero.width, before.hero.width, 'hero width stable')
  assert(held.hero.height > before.hero.height + 2, 'hero height grows')
  assert(held.visibleHeight > before.visibleHeight + 2, 'visible, unclipped hero height grows')
  assert(held.firstCard.y > before.firstCard.y + 2, 'actual first song visibly moves down')
  near(held.scrollTop, 0, 'native position stays at top')
  fixed(before, held)
  proportionalImage(held)
  for (let i = 0; i < before.controls.length; i++) {
    near(held.controls[i].width, before.controls[i].width, 'control width stays unchanged')
    near(held.controls[i].height, before.controls[i].height, 'control height stays unchanged')
    near(held.controls[i].y - before.controls[i].y, held.hero.height - before.hero.height, 'every hero overlay follows the full hero height gain')
  }
}
function proportionalImage(state) {
  assert(state.image.naturalWidth > 0 && state.image.naturalHeight > 0 && state.image.opacity > 0.99, 'real fixture image has decoded and paints')
  assert.equal(state.image.objectFit, 'cover', 'local image fit preserves intrinsic aspect ratio')
  assert(Math.abs(state.image.scaleX - state.image.scaleY) < 0.003, `composite image scaling stays proportional: ${state.image.scaleX} vs ${state.image.scaleY}`)
  assert(state.image.x <= state.hero.x + 0.75 && state.image.y <= state.hero.y + 0.75
    && state.image.x + state.image.width >= state.hero.x + state.hero.width - 0.75
    && state.image.y + state.image.height >= state.hero.y + state.hero.height - 0.75, 'painted image fills the expanded hero clip')
}
async function settled(page, before) {
  await page.waitForFunction(height => {
    const panel = document.querySelector('.playlist-panel')
    return Math.abs(document.querySelector('.playlist-hero').getBoundingClientRect().height - height) < 0.1
      && panel.getAnimations({ subtree: true }).length === 0
      && Math.abs(Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0) < 0.1
  }, before.hero.height, { timeout: 2000 })
  const after = await geometry(page)
  proportionalImage(after)
  near(after.hero.width, before.hero.width, 'hero width restored')
  near(after.hero.height, before.hero.height, 'hero height restored')
  near(after.grid.y, before.grid.y, 'content restored')
  near(after.firstCard.y, before.firstCard.y, 'actual first song restored')
  near(after.lastCard.y, before.lastCard.y, 'actual last song restored')
  fixed(before, after)
}
async function backgroundPoint(page) {
  const state = await geometry(page)
  // Blank band between hero and grid, away from controls and the dock.
  const point = { x: state.panel.x + state.panel.width / 2, y: (state.hero.y + state.hero.height + state.grid.y) / 2 }
  await page.mouse.move(point.x, point.y)
  return point
}
async function check(name, run, options) {
  if ((touchBaseline || imageBaseline) && !name.startsWith('trusted touch top')) return
  if (process.env.SPMUSIC_IMAGE_ONLY && !name.startsWith('image aspect')) return
  if (process.env.SPMUSIC_REFERENCE_ONLY && !name.startsWith('reference damping')) return
  if (process.env.SPMUSIC_WHEEL_ONLY && !name.startsWith('repeated wheel')) return
  if (process.env.SPMUSIC_LIFECYCLE_ONLY && !name.startsWith('pending presentation') && !name.startsWith('drag ownership')) return
  if ((nativeBoundaryBaseline || process.env.SPMUSIC_NATIVE_BOUNDARY_ONLY) && !name.startsWith('lower-origin touch')) return
  if (process.env.SPMUSIC_TOUCH_ONLY && !name.includes('touch')) return
  const context = await open(options)
  try {
    await run(context)
    assert.deepEqual(context.errors, [], 'no browser runtime errors')
    passed++
    console.log('PASS', name)
  } finally { await context.page.close() }
}

async function touchInput(page) {
  const cdp = await page.context().newCDPSession(page)
  await page.evaluate(() => {
    window.touchEvidence = []
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(type, event => window.touchEvidence.push({ type, trusted: event.isTrusted, canceled: event.defaultPrevented, cancelable: event.cancelable, fingers: event.touches.length }), { passive: true })
  })
  const dispatch = async (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) })
  const move = async (from, to, steps = 8) => {
    for (let i = 1; i <= steps; i++) await dispatch('touchMove', from.map(([id, x, y], j) => [id, x + (to[j][1] - x) * i / steps, y + (to[j][2] - y) * i / steps]))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  }
  return { dispatch, move }
}

try {
  await check('lower-origin touch stays anchored across native top boundary; browser local overscroll policy is disabled', async ({ page }) => {
    const base = await geometry(page)
    const policy = await page.locator('.playlist-panel').evaluate(panel => getComputedStyle(panel).overscrollBehaviorY)
    const input = await touchInput(page)
    for (const scrollTop of [0, 70, 120]) {
      await page.evaluate(scrollTop => { document.querySelector('.playlist-panel').scrollTop = scrollTop; window.touchEvidence = [] }, scrollTop)
      const point = await page.evaluate(desiredX => [...document.querySelectorAll('.playlist-card')].map(card => {
        const r = card.getBoundingClientRect(), y = Math.max(r.top + 10, Math.min(r.bottom - 10, 850)), x = r.x + r.width / 2
        return { x, y, score: Math.abs(y - 850) + Math.abs(x - desiredX) * .01 }
      }).filter(point => point.y >= 750 && point.y < 900).sort((a, b) => a.score - b.score)[0], base.panel.x + base.panel.width * .45)
      assert(point, 'a lower visible song card is available')
      const start = [[0, point.x, point.y]], end = [[0, point.x, 1035]]
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.playlist-card')?.className, start[0].slice(1))
      assert(hit, 'touch starts on an actual lower song card, away from hero and scrollbar')
      await input.dispatch('touchStart', start)
      await input.move(start, end, 20)
      const held = await geometry(page), events = await page.evaluate(() => window.touchEvidence)
      stretched(base, held)
      if (scrollTop) assert(events.some(event => event.type === 'touchmove' && event.trusted && !event.cancelable), 'lower-origin native pan reaches the noncancelable browser-owned continuation')
      console.log('LOWER_NATIVE_BOUNDARY_GEOMETRY', JSON.stringify({ scrollTop, policy, heroTop: held.hero.y, baseTop: base.hero.y, heightGain: held.hero.height - base.hero.height, panel: held.panel, nativeNoncancelableEvents: events.filter(event => event.type === 'touchmove' && !event.cancelable).length }))
      await input.dispatch('touchEnd')
      await settled(page, base)
    }
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 300; window.touchEvidence = [] })
    const normalStart = [[0, base.panel.x + base.panel.width * .45, 850]], normalEnd = [[0, normalStart[0][1], 600]]
    await input.dispatch('touchStart', normalStart)
    await input.move(normalStart, normalEnd, 10)
    const beforeLift = await geometry(page)
    assert(beforeLift.scrollTop > 400 && Math.abs(beforeLift.offset) < .1, 'lower-origin ordinary pan scrolls normally without custom displacement')
    assert(await page.evaluate(() => window.touchEvidence.filter(event => event.type === 'touchmove').every(event => !event.canceled)), 'ordinary native pan is not canceled')
    await input.dispatch('touchEnd')
    await page.waitForFunction(top => document.querySelector('.playlist-panel').scrollTop > top + 1, beforeLift.scrollTop, { timeout: 1500 })
    console.log('LOWER_NATIVE_INERTIA', JSON.stringify({ beforeLift: beforeLift.scrollTop, afterLift: (await geometry(page)).scrollTop, policy }))
    if (nativeBoundaryBaseline) console.log('NATIVE_POLICY_BASELINE: contain allows browser affordance; headless CDP did not reproduce the supplied WebView2 compositor bounce')
    assert.equal(policy, 'none', 'native local overscroll affordance must be disabled separately from custom presentation')
  }, { width: 1920, height: 1280, level: 2 })
  await check('pending presentation frame is flushed on release and canceled by resize', async ({ page }) => {
    const before = await geometry(page), p = await backgroundPoint(page)
    await page.evaluate(() => document.querySelector('.playlist-panel').addEventListener('pointerdown', event => { window.testPointerId = event.pointerId }, { once: true }))
    await page.mouse.down()
    // Native pointerdown establishes valid pointer capture. A synchronous move/
    // release batch guarantees no rAF can run between the final input and end.
    const gain = await page.evaluate(({ p, baseHeight }) => {
      for (const travel of [20, 40, 80]) window.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.testPointerId, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: p.x, clientY: p.y + travel, bubbles: true, cancelable: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: window.testPointerId, pointerType: 'mouse', isPrimary: true, buttons: 0, clientX: p.x, clientY: p.y + 80, bubbles: true, cancelable: true }))
      return document.querySelector('.playlist-hero').getBoundingClientRect().height - baseHeight
    }, { p, baseHeight: before.hero.height })
    const expected = .035 * before.hero.height * Math.log1p(80 / (.024 * before.hero.height))
    assert(Math.abs(gain - expected) < .75, 'release starts from final pending input rather than dropping its queued presentation')
    await page.mouse.up()
    await settled(page, before)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.evaluate(p => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.testPointerId, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: p.x, clientY: p.y + 80, bubbles: true, cancelable: true }))
      window.dispatchEvent(new Event('resize'))
    }, p)
    await page.mouse.up()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await settled(page, before)
    console.log('PENDING_FRAME_RELEASE_GAIN', JSON.stringify({ gain, expected }))
  })
  await check('drag ownership preserves click/focus and selection intent; outside-panel release clears capture', async ({ page }) => {
    const before = await geometry(page)
    const r = await page.locator('.playlist-card').first().boundingBox()
    await page.mouse.move(r.x + 30, r.y + 30)
    await page.mouse.down()
    const selectionCanceled = () => page.evaluate(() => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true })
      document.querySelector('.playlist-card').dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(await selectionCanceled(), false, 'down alone retains native selection candidate')
    await page.mouse.move(r.x + 75, r.y + 31, { steps: 3 })
    assert.equal(await selectionCanceled(), false, 'horizontal intent retains native selection candidate')
    await page.mouse.move(r.x + 75, r.y + 110, { steps: 5 })
    assert.equal(await selectionCanceled(), true, 'confirmed vertical drag suppresses selection')
    await page.mouse.move(50, r.y + 130, { steps: 6 })
    await page.mouse.up()
    await settled(page, before)
    assert.equal(await page.evaluate(() => document.querySelector('.playlist-panel').dataset.dragging), undefined)
    assert.equal(await page.evaluate(() => document.querySelector('.playlist-card').style.cursor), '', 'owned leaf cursor restored')
    assert.deepEqual(await page.evaluate(() => window.actions), [], 'outside release never activates playback')
    await page.locator('.playlist-card').first().click()
    assert.deepEqual(await page.evaluate(() => window.actions), ['track-0'], 'next normal click still activates')
  })
  await check('reference damping, overlay/row spacing and measured monotone release', async ({ page }) => {
    const before = await geometry(page), p = await backgroundPoint(page)
    const rowPositions = () => page.evaluate(() => [...document.querySelectorAll('.playlist-card')].slice(0, 5).map(el => el.getBoundingClientRect().y))
    const rowsBefore = await rowPositions()
    const samples = []
    await page.mouse.down()
    for (const travel of [20, 60, 120, 240, 400, 600]) {
      await page.mouse.move(p.x, p.y + travel, { steps: 4 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      const state = await geometry(page)
      stretched(before, state)
      samples.push({ travel, offset: state.hero.height - before.hero.height, heroGain: state.hero.height - before.hero.height })
    }
    const slopes = samples.slice(1).map((sample, i) => (sample.offset - samples[i].offset) / (sample.travel - samples[i].travel))
    assert(samples.every(sample => sample.offset > 0 && sample.offset < sample.travel), 'drag travel is resisted instead of copied directly')
    assert(slopes.every(slope => slope > 0.001), 'extra pull keeps adding travel without an abrupt hard cap')
    assert(slopes.every((slope, i) => !i || slope <= slopes[i - 1] + 0.01), 'progressively stronger damping gives a concave response')
    for (const sample of samples) {
      const fitted = 0.035 * before.hero.height * Math.log1p(sample.travel / (0.024 * before.hero.height))
      assert(Math.abs(sample.offset - fitted) < Math.max(2, before.hero.height * 0.006), 'drag response follows the measured reference fit within video sampling tolerance')
    }
    const held = await geometry(page), gain = held.hero.height - before.hero.height, rowsHeld = await rowPositions()
    for (let i = 0; i < rowsHeld.length; i++) near(rowsHeld[i] - rowsBefore[i], gain * (1 + 0.1 * (i + 1)), `reference row ${i + 1} gains an additional tenth of hero displacement`)
    await page.evaluate(height => {
      window.referenceFrames = []
      window.referenceTracing = true
      window.referenceReleaseAt = null
      window.addEventListener('pointerup', () => { window.referenceReleaseAt = performance.now() }, { once: true })
      const capture = time => {
        if (!window.referenceTracing) return
        if (window.referenceReleaseAt !== null) window.referenceFrames.push({ elapsed: time - window.referenceReleaseAt, gain: document.querySelector('.playlist-hero').getBoundingClientRect().height - height })
        requestAnimationFrame(capture)
      }
      requestAnimationFrame(capture)
    }, before.hero.height)
    await page.mouse.up()
    await settled(page, before)
    const frames = await page.evaluate(() => { window.referenceTracing = false; return window.referenceFrames })
    assert(frames.length >= 8, 'release geometry is sampled through intermediate frames')
    const closest250 = frames.reduce((best, frame) => Math.abs(frame.elapsed - 250) < Math.abs(best.elapsed - 250) ? frame : best)
    const remaining250 = closest250.gain / gain
    const closest100 = frames.reduce((best, frame) => Math.abs(frame.elapsed - 100) < Math.abs(best.elapsed - 100) ? frame : best)
    assert(Math.abs(closest100.elapsed - 100) < 40 && closest100.gain / gain >= 0.3 && closest100.gain / gain <= 0.55, 'around 100 ms the reference retains roughly 42% travel (sampling tolerance)')
    assert(Math.abs(closest250.elapsed - 250) < 40 && remaining250 >= 0.08 && remaining250 <= 0.22, 'around 250 ms the fine reference retains roughly 13% travel (sampling tolerance)')
    assert(frames.every((frame, i) => frame.gain >= -0.5 && (!i || frame.gain <= frames[i - 1].gain + 0.75)), 'release is monotone without negative overshoot or oscillation')
    const completion = frames.find(frame => Math.abs(frame.gain) < 0.5)
    assert(completion && completion.elapsed <= 550, 'reference release is complete by approximately 500 ms')
    console.log('REFERENCE_DAMPING_AND_RELEASE', JSON.stringify({ samples, slopes, gain, rowShifts: rowsHeld.map((row, i) => row - rowsBefore[i]), remaining100: closest100.gain / gain, remaining250, at250: closest250.elapsed, completionMs: completion.elapsed }))
  }, { level: 3 })
  await check('reference damping interruption continues from live displacement and releases cleanly', async ({ page }) => {
    const before = await geometry(page)
    const p = { x: before.panel.x + 8, y: 300 }
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 240, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(height => {
      const gain = document.querySelector('.playlist-hero').getBoundingClientRect().height - height
      return gain > 5 && gain < 25
    }, before.hero.height)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    const live = await geometry(page)
    await page.mouse.move(p.x, p.y + 30, { steps: 1 })
    const continued = await geometry(page)
    const liveGain = live.hero.height - before.hero.height, continuedGain = continued.hero.height - before.hero.height
    assert(continuedGain >= liveGain - 2 && continuedGain < liveGain + 30, 'new drag takes over live visual offset without reset jump')
    stretched(before, continued)
    await page.mouse.up()
    await settled(page, before)
    console.log('REFERENCE_INTERRUPT_GEOMETRY', JSON.stringify({ liveGain, continuedGain }))
  })
  await check('trusted touch top pull and bottom push visibly stretch/rebound with click safety', async ({ page }) => {
    const input = await touchInput(page), before = await geometry(page), p = await backgroundPoint(page)
    const from = [[0, p.x, p.y]], to = [[0, p.x, p.y + 100]]
    await input.dispatch('touchStart', from)
    await input.move(from, to)
    const held = await geometry(page)
    console.log('TOUCH_TOP_GEOMETRY', JSON.stringify({ before, held, events: await page.evaluate(() => window.touchEvidence) }))
    if (touchBaseline) {
      near(held.offset, 0, 'former mouse-only boundary has no touch feedback')
      near(held.hero.height, before.hero.height, 'former mouse-only boundary does not stretch')
      near(held.grid.y, before.grid.y, 'former mouse-only boundary does not translate content')
      await input.dispatch('touchEnd')
      console.log('TOUCH_BASELINE_REPRODUCED: trusted top pull produces zero feedback')
      return
    }
    if (imageBaseline) {
      assert(Math.abs(held.image.scaleX - held.image.scaleY) > 0.1, 'former uncorrected parent scale distorts real rendered image')
      console.log('IMAGE_BASELINE_REPRODUCED', JSON.stringify({ scaleX: held.image.scaleX, scaleY: held.image.scaleY }))
      await input.dispatch('touchEnd')
      return
    }
    stretched(before, held)
    assert(await page.evaluate(() => window.touchEvidence.some(e => e.type === 'touchmove' && e.trusted)), 'CDP produces trusted native touch input')
    await input.dispatch('touchEnd')
    await settled(page, before)
    assert.deepEqual(await page.evaluate(() => window.actions), [], 'pull never selects/plays')
    await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); p.scrollTop = p.scrollHeight })
    const bottom = await geometry(page), start = [[0, bottom.panel.x + 8, 400]], end = [[0, bottom.panel.x + 8, 300]]
    await input.dispatch('touchStart', start)
    await input.move(start, end)
    const bottomHeld = await geometry(page)
    assert(bottomHeld.lastCard.y < bottom.lastCard.y - 2, 'actual bottom song moves upward under single-finger input')
    near(bottomHeld.hero.height, bottom.hero.height, 'bottom does not stretch hero')
    near(bottomHeld.scrollTop, bottom.max, 'native bottom remains fixed')
    fixed(bottom, bottomHeld)
    await input.dispatch('touchEnd')
    await settled(page, bottom)
  })
  await check('touch native scrolling continues to top/bottom boundary through noncancelable moves', async ({ page }) => {
    const input = await touchInput(page), top = await geometry(page)
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 80 })
    const start = [[0, top.panel.x + 8, 300]], end = [[0, top.panel.x + 8, 650]]
    await input.dispatch('touchStart', start)
    await input.move(start, end, 20)
    const held = await geometry(page)
    console.log('NATIVE_TO_TOP', JSON.stringify({ held, events: await page.evaluate(() => window.touchEvidence) }))
    stretched(top, held)
    assert(await page.evaluate(() => window.touchEvidence.some(e => e.type === 'touchmove' && e.trusted && !e.cancelable)), 'normal native scrolling enters noncancelable touch path')
    await input.dispatch('touchEnd')
    await settled(page, top)
    await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); p.scrollTop = p.scrollHeight })
    const bottom = await geometry(page)
    await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); p.scrollTop -= 80; window.touchEvidence = [] })
    const bottomStart = [[0, bottom.panel.x + 8, 600]], bottomEnd = [[0, bottom.panel.x + 8, 200]]
    await input.dispatch('touchStart', bottomStart)
    await input.move(bottomStart, bottomEnd, 20)
    const bottomHeld = await geometry(page)
    console.log('NATIVE_TO_BOTTOM', JSON.stringify({ bottomHeld, events: await page.evaluate(() => window.touchEvidence) }))
    assert(bottomHeld.lastCard.y < bottom.lastCard.y - 2, 'continued native pan moves the actual bottom song upward')
    near(bottomHeld.scrollTop, bottom.max, 'continued native pan reaches bottom')
    fixed(bottom, bottomHeld)
    await input.dispatch('touchEnd')
    await settled(page, bottom)
  })
  await check('touch normal pan remains native; touch cancel resets and next single-finger pull works', async ({ page }) => {
    const input = await touchInput(page), top = await geometry(page)
    const start = [[0, top.panel.x + 8, 550]], end = [[0, top.panel.x + 8, 350]]
    await input.dispatch('touchStart', start)
    await input.move(start, end)
    assert((await geometry(page)).scrollTop > 50, 'single finger normally scrolls')
    assert(await page.evaluate(() => window.touchEvidence.some(e => e.type === 'touchmove' && e.trusted && !e.canceled)), 'ordinary pan retains native event ownership')
    near((await geometry(page)).offset, 0, 'ordinary range has no elastic offset')
    await input.dispatch('touchCancel')
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0; window.touchEvidence = [] })
    const from = [[0, top.panel.x + 8, 300]], to = [[0, top.panel.x + 8, 400]]
    await input.dispatch('touchStart', from)
    await input.move(from, to)
    stretched(top, await geometry(page))
    await input.dispatch('touchCancel')
    await settled(page, top)
    assert(await page.evaluate(() => window.touchEvidence.some(e => e.type === 'touchcancel' && e.trusted)), 'cancel is a trusted browser event')
    await input.dispatch('touchStart', from)
    await input.move(from, to)
    stretched(top, await geometry(page))
    await input.dispatch('touchEnd')
    await settled(page, top)
  })
  await check('touch single-finger pull hands off to pinch without stuck feedback; all fingers up restores pull', async ({ page }) => {
    const input = await touchInput(page), before = await geometry(page)
    const single = [[0, 650, 420]], moved = [[0, 650, 480]], pair = [[0, 650, 480], [1, 710, 480]]
    await input.dispatch('touchStart', single)
    await input.move(single, moved)
    stretched(before, await geometry(page))
    await input.dispatch('touchStart', pair)
    await page.waitForFunction(() => !(document.querySelector('.playlist-panel').dataset.touchDragging))
    near((await geometry(page)).offset, 0, 'adding second finger clears elastic feedback')
    await input.move(pair, [[0, 620, 480], [1, 740, 480]])
    await page.waitForFunction(() => document.querySelector('.playlist-grid').dataset.layoutLevel === '1')
    await input.dispatch('touchEnd', [[0, 620, 480]])
    await input.move([[0, 620, 480]], [[0, 620, 540]])
    near((await geometry(page)).offset, 0, 'remaining finger cannot restart elastic until all lifted')
    await input.dispatch('touchEnd')
    await page.waitForTimeout(300)
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
    const newBefore = await geometry(page), from = [[0, 330, 300]], to = [[0, 330, 400]]
    await input.dispatch('touchStart', from)
    await input.move(from, to)
    stretched(newBefore, await geometry(page))
    await input.dispatch('touchEnd')
    await settled(page, newBefore)
    assert.deepEqual(await page.evaluate(() => window.actions), [], 'touch gestures never activate playback')
  }, { level: 2 })
  await check('image aspect, filled expanded area and control geometry remain stable throughout outward/rebound frames', async ({ page }) => {
    const before = await geometry(page)
    await backgroundPoint(page)
    await page.evaluate(() => {
      window.imageFrames = []
      window.imageTracing = true
      const capture = () => {
        if (!window.imageTracing) return
        const hero = document.querySelector('.playlist-hero').getBoundingClientRect()
        const image = document.querySelector('.playlist-hero-image'), r = image.getBoundingClientRect(), style = getComputedStyle(image)
        window.imageFrames.push({ hero: { x: hero.x, y: hero.y, width: hero.width, height: hero.height },
          image: { x: r.x, y: r.y, width: r.width, height: r.height, scaleX: r.width / Number.parseFloat(style.width), scaleY: r.height / Number.parseFloat(style.height) },
          cardY: document.querySelector('.playlist-card').getBoundingClientRect().y,
          controls: [...document.querySelectorAll('.playlist-hero-category, .playlist-hero-title, .playlist-hero-meta, .playlist-hero-actions, .playlist-close')].map(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { y: r.y, width: r.width, height: r.height, scale: s.scale, transitionProperty: s.transitionProperty } }).filter(r => r.width > 0 && r.height > 0) })
        requestAnimationFrame(capture)
      }
      capture()
    })
    await page.mouse.wheel(0, -120)
    await page.waitForFunction(height => document.querySelector('.playlist-hero').getBoundingClientRect().height > height + 2, before.hero.height)
    await settled(page, before)
    const frames = await page.evaluate(() => { window.imageTracing = false; return window.imageFrames })
    const moving = frames.filter(frame => frame.hero.height > before.hero.height + 1)
    console.log('IMAGE_ANIMATION_DIAGNOSTIC', JSON.stringify({ maxImageAspectScaleDifference: Math.max(...frames.map(frame => Math.abs(frame.image.scaleX - frame.image.scaleY))),
      maxCategoryHeight: Math.max(...frames.map(frame => frame.controls[0].height)), category: frames.find(frame => Math.abs(frame.controls[0].height - before.controls[0].height) > 0.75)?.controls[0] }))
    assert(moving.length >= 4, 'captures actual outward and rebound intermediate geometry')
    for (const frame of frames) {
      near(frame.hero.y, before.hero.y, 'animation frame hero top anchored')
      near(frame.hero.width, before.hero.width, 'animation frame hero width fixed')
      assert(Math.abs(frame.image.scaleX - frame.image.scaleY) < 0.003, 'all intermediate frames preserve composite image aspect ratio')
      assert(frame.image.x <= frame.hero.x + 0.75 && frame.image.y <= frame.hero.y + 0.75
        && frame.image.x + frame.image.width >= frame.hero.x + frame.hero.width - 0.75
        && frame.image.y + frame.image.height >= frame.hero.y + frame.hero.height - 0.75, 'image covers every expanded animation frame')
      near(frame.cardY - before.firstCard.y, (frame.hero.height - before.hero.height) * 1.1, 'actual first song keeps reference displacement throughout animation')
      for (let i = 0; i < frame.controls.length; i++) {
        near(frame.controls[i].width, before.controls[i].width, 'frame control width stable')
        near(frame.controls[i].height, before.controls[i].height, 'frame control height stable')
        near(frame.controls[i].y - before.controls[i].y, frame.hero.height - before.hero.height, 'overlay follows the full hero height gain throughout animation')
      }
    }
    console.log('IMAGE_ANIMATION_GEOMETRY', JSON.stringify({ frames: frames.length, expandedFrames: moving.length,
      maxAspectScaleDifference: Math.max(...frames.map(frame => Math.abs(frame.image.scaleX - frame.image.scaleY))),
      minHeight: Math.min(...frames.map(frame => frame.hero.height)), maxHeight: Math.max(...frames.map(frame => frame.hero.height)) }))
  })
  for (const width of [1280, 900]) {
    await check(`top mouse drag ${width}: visible height, anchored top, fixed siblings and rebound`, async ({ page }) => {
      const before = await geometry(page), p = await backgroundPoint(page)
      await page.mouse.down()
      await page.mouse.move(p.x, p.y + 110, { steps: 8 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      const held = await geometry(page)
      stretched(before, held)
      await page.mouse.up()
      await settled(page, before)
      assert.deepEqual(await page.evaluate(() => window.actions), [], 'background gesture performs no playback action')
      console.log('GEOMETRY', JSON.stringify({ width, before, held, end: await geometry(page) }))
    }, { width })
  }
  await check('trusted wheel at top rebounds; normal scrolling and bottom edge retain native range', async ({ page }) => {
    const before = await geometry(page)
    await backgroundPoint(page)
    await page.mouse.wheel(0, -120)
    await page.waitForFunction(height => document.querySelector('.playlist-hero').getBoundingClientRect().height > height + 2, before.hero.height)
    stretched(before, await geometry(page))
    await settled(page, before)
    await page.mouse.wheel(0, 240)
    await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 100)
    const normal = await geometry(page)
    assert(normal.scrollTop > 100, 'positive wheel normally scrolls below top')
    near(normal.offset, 0, 'no elastic offset in normal scroll')
    near(normal.hero.height, before.hero.height, 'normal scroll leaves height intact')
    await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); p.scrollTop = p.scrollHeight })
    const bottom = await geometry(page)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(500)
    const end = await geometry(page)
    near(end.scrollTop, bottom.max, 'bottom input keeps native bottom')
    near(end.hero.height, before.hero.height, 'bottom edge does not stretch hero')
    fixed(bottom, end)
  })
  await check('card click retained; card drag never selects; hero controls and search remain usable', async ({ page }) => {
    const before = await geometry(page)
    const card = page.locator('.playlist-card').first()
    const r = await card.boundingBox()
    await page.mouse.move(r.x + r.width / 2, r.y + 30)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width / 2, r.y + 120, { steps: 8 })
    await page.mouse.up()
    await settled(page, before)
    assert.deepEqual(await page.evaluate(() => window.actions), [], 'drag does not activate card')
    await card.click()
    assert.deepEqual(await page.evaluate(() => window.actions), ['track-0'], 'ordinary card click activates')
    await page.locator('.playlist-hero-shuffle-button').click()
    assert((await page.evaluate(() => window.actions)).includes('shuffle'))
    await page.locator('.playlist-search-button').first().click()
    await page.locator('.playlist-filter-input').fill('Test song 11')
    assert.equal(await page.locator('.playlist-card').count(), 11, 'search input works normally')
  })
  await check('pointer cancel and active-gesture unmount clear presentation and listeners', async ({ page }) => {
    const before = await geometry(page), p = await backgroundPoint(page)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 96, { steps: 8 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    stretched(before, await geometry(page))
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    await settled(page, before)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 100, { steps: 5 })
    await page.evaluate(() => { window.oldPanel = document.querySelector('.playlist-panel'); window.unmountFixture() })
    await page.mouse.up()
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.panelListeners.filter(item => item.active && item.target !== window).length), 0, 'native panel gesture listeners removed')
    const globalListeners = await page.evaluate(() => window.panelListeners.filter(item => item.target === window && ['pointermove', 'pointerup', 'pointercancel'].includes(item.type)).map(item => ({ type: item.type, name: item.listener.name, active: item.active })))
    console.log('GLOBAL_LISTENERS_AFTER_UNMOUNT', JSON.stringify(globalListeners))
    // Motion may retain a process-wide pointer tracker. Scope ownership to this
    // hook's move/end callbacks rather than treating that singleton as a leak.
    assert.equal(globalListeners.filter(item => item.active && ['move', 'end'].includes(item.name)).length, 0, 'elastic global mouse gesture listeners removed')
    assert.equal(await page.evaluate(() => window.oldPanel.getAnimations({ subtree: true }).length), 0, 'no detached presentation animations')
  })
  await check('repeated wheel stays bounded, reverse input releases edge, and bottom mouse drag rebounds', async ({ page }) => {
    const before = await geometry(page)
    await backgroundPoint(page)
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120)
    const expectedPeak = 0.035 * before.hero.height * Math.log1p(720 / (0.024 * before.hero.height))
    await page.waitForFunction(({ height, expectedPeak }) => document.querySelector('.playlist-hero').getBoundingClientRect().height - height >= expectedPeak - 1.5, { height: before.hero.height, expectedPeak }, { timeout: 1500 })
    const peak = await geometry(page)
    assert(Math.abs(peak.hero.height - before.hero.height - expectedPeak) < 2, 'repeated wheel accumulates raw input using the reference damping response')
    await page.mouse.wheel(0, 1000)
    await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 10)
    const reversed = await geometry(page)
    near(reversed.offset, 0, 'reverse input releases elastic position before scrolling')
    assert(reversed.scrollTop <= 1000, 'reverse wheel scrolling stays bounded by actual input')
    console.log('REPEATED_WHEEL_GEOMETRY', JSON.stringify({ expectedPeak, peakGain: peak.hero.height - before.hero.height, reverseScrollTop: reversed.scrollTop }))
    await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); p.scrollTop = p.scrollHeight })
    const bottom = await geometry(page)
    await page.mouse.move(bottom.panel.x + 8, 300)
    await page.mouse.down()
    await page.mouse.move(bottom.panel.x + 8, 200, { steps: 8 })
    const held = await geometry(page)
    assert(held.lastCard.y < bottom.lastCard.y - 2, 'bottom drag moves actual songs upward')
    near(held.hero.height, bottom.hero.height, 'bottom drag does not stretch hero')
    near(held.scrollTop, bottom.max, 'bottom drag retains native bottom')
    fixed(bottom, held)
    await page.mouse.up()
    await settled(page, bottom)
  })
  await check('motion preference changing during drag cancels and next gesture can recover', async ({ page }) => {
    const before = await geometry(page), p = await backgroundPoint(page)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 90, { steps: 5 })
    stretched(before, await geometry(page))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await settled(page, before)
    await page.mouse.up()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 90, { steps: 5 })
    stretched(before, await geometry(page))
    await page.mouse.up()
    await settled(page, before)
  })
  await check('reduced motion disables elastic feedback and retains normal native scrolling', async ({ page }) => {
    const before = await geometry(page), p = await backgroundPoint(page)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 90, { steps: 5 })
    const held = await geometry(page)
    near(held.hero.width, before.hero.width, 'reduced motion keeps width')
    near(held.grid.y, before.grid.y, 'reduced motion keeps list position')
    near(held.firstCard.y, before.firstCard.y, 'reduced motion keeps actual songs stationary')
    await page.mouse.up()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    await settled(page, before)
    assert.equal((await geometry(page)).animations, 0, 'reduced motion leaves no running animation')
    await page.mouse.wheel(0, 180)
    await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 50)
  }, { motion: 'reduce' })
  console.log(`PASS ${passed} playlist elastic browser regressions`)
} finally { await browser.close() }
