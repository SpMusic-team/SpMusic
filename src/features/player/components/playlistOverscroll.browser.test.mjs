// Start Vite; set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
// Independent regression: trusted browser input and visible geometry, no new dependency.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
  const match = (source + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite[^/]*/deps/' + filename.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${filename}`)
  return match[1]
}
if (process.env.SPMUSIC_TOUCH_SEQUENCE_BASELINE || process.env.SPMUSIC_WHEEL_STREAM_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_TAIL_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_CROSSING_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_RETURN_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_SPEED_BASELINE_HOOK || process.env.SPMUSIC_HANDOFF_SPEED_BASELINE_HOOK || process.env.SPMUSIC_MATCH_RETURN_BASELINE_HOOK) {
  const ts = require('typescript')
  baselineHook = ts.transpileModule(readFileSync(process.env.SPMUSIC_TOUCH_SEQUENCE_BASELINE || process.env.SPMUSIC_WHEEL_STREAM_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_TAIL_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_CROSSING_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_RETURN_BASELINE_HOOK || process.env.SPMUSIC_WHEEL_SPEED_BASELINE_HOOK || process.env.SPMUSIC_HANDOFF_SPEED_BASELINE_HOOK || process.env.SPMUSIC_MATCH_RETURN_BASELINE_HOOK, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
  baselineHook = baselineHook.replace(/import \{([^}]+)\} from ['"]react['"];?/, (_line, names) => `import baselineReact from '${dependency('react.js')}'; const {${names}} = baselineReact;`)
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
const parameters=new URLSearchParams(location.search);
const count=Number(parameters.get('count')||120);
const bitmap=parameters.get('bitmap')==='1';
const makeBitmap=seed=>{const size=512,bytes=new Uint8Array(54+size*size*4),view=new DataView(bytes.buffer);view.setUint16(0,0x4d42,true);view.setUint32(2,bytes.length,true);view.setUint32(10,54,true);view.setUint32(14,40,true);view.setInt32(18,size,true);view.setInt32(22,-size,true);view.setUint16(26,1,true);view.setUint16(28,32,true);let value=seed+1;for(let i=54;i<bytes.length;i+=4){value=(value*1664525+1013904223)>>>0;bytes[i]=value&255;bytes[i+1]=(value>>>8)&255;bytes[i+2]=(value>>>16)&255;bytes[i+3]=255}return URL.createObjectURL(new Blob([bytes],{type:'image/bmp'}))};
const covers=bitmap?Array.from({length:24},(_,i)=>makeBitmap(i)):[blob];
const tracks=Array.from({length:count},(_,i)=>({id:'track-'+i,title:'Test song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:true,coverThumbnail:{src:covers[i%covers.length],width:bitmap?512:128,height:bitmap?512:128,encodedBytes:bitmap?1048630:256}}));
window.actions=[];
window.fixtureWindowReports=[];
const reportVisibleWindow=parameters.get('pipeline')==='1'?(...args)=>window.fixtureWindowReports.push(args):undefined;
const playback={track:{...tracks[0],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
const timeline={positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
const root=ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture=()=>root.unmount();
window.updateFixtureDuration=(seconds)=>root.render(React.createElement(AppearanceProvider,null,React.createElement(PlaylistPanel,{tracks,currentTrackId:'track-0',totalDurationSeconds:seconds,totalDurationStatus:seconds===undefined?'loading':'ready',shuffleMode:'none',onShuffleCycle:()=>window.actions.push('shuffle'),playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:()=>window.actions.push('play'),onTrackSelect:id=>window.actions.push(id),onClose:()=>window.actions.push('close'),onVisibleTrackIdsChange:reportVisibleWindow})));
window.updateFixtureDuration(undefined);
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__elastic_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
console.log('BROWSER', browser.version())
let passed = 0

async function open({ width = 1280, height = 1000, motion = 'no-preference', count = 120, level = 0, pipeline = false, bitmap = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: motion })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', String(level))
    window.panelListeners = []
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    const types = new Set(['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'click', 'dragstart', 'blur', 'resize', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'scroll'])
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
  await page.goto(origin + '/__elastic_test?count=' + count + '&pipeline=' + Number(pipeline) + '&bitmap=' + Number(bitmap))
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
const near = (a, b, message, tolerance = 0.75) => assert(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`)
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
  if (process.env.SPMUSIC_COAST_PEAK_ONLY && !name.startsWith('coast peak')) return
  if (process.env.SPMUSIC_COAST_PEAK_CASE && !name.startsWith(`coast peak ${process.env.SPMUSIC_COAST_PEAK_CASE}:`)) return
  if (process.env.SPMUSIC_TOUCH_FLING_ONLY && !name.startsWith('touch fling')) return
  if (process.env.SPMUSIC_LATE_BRIDGE_ONLY && !name.startsWith('late bridge')) return
  if (process.env.SPMUSIC_MATCH_RETURN_SKIP && name.startsWith('matched return')) return
  if (process.env.SPMUSIC_MATCH_RETURN_ONLY && !name.startsWith('matched return')) return
  if (process.env.SPMUSIC_HANDOFF_SPEED_ONLY && !name.startsWith('handoff speed')) return
  if (process.env.SPMUSIC_HANDOFF_SPEED_ONLY === 'controlled' && !name.startsWith('handoff speed controlled')) return
  if (process.env.SPMUSIC_WHEEL_SPEED_ONLY && !name.startsWith('return speed')) return
  if (process.env.SPMUSIC_WHEEL_RETURN_ONLY && !name.startsWith('wheel return')) return
  if (process.env.SPMUSIC_WHEEL_RETURN_CASE && !name.startsWith(`wheel return ${process.env.SPMUSIC_WHEEL_RETURN_CASE}:`)) return
  if (process.env.SPMUSIC_WHEEL_CROSSING_ONLY && !name.startsWith('wheel native crossing')) return
  if (process.env.SPMUSIC_WHEEL_CROSSING_ONLY === 'controlled' && !name.includes('late commit')) return
  if (process.env.SPMUSIC_WHEEL_TAIL_ONLY && !name.startsWith('wheel tail')) return
  if (process.env.SPMUSIC_WHEEL_STREAM_ONLY && !name.startsWith('wheel stream')) return
  if ((touchBaseline || imageBaseline) && !name.startsWith('trusted touch top')) return
  if (process.env.SPMUSIC_IMAGE_ONLY && !name.startsWith('image aspect')) return
  if (process.env.SPMUSIC_REFERENCE_ONLY && !name.startsWith('reference damping')) return
  if (process.env.SPMUSIC_WHEEL_ONLY && !name.startsWith('repeated wheel')) return
  if (process.env.SPMUSIC_LIFECYCLE_ONLY && !name.startsWith('pending presentation') && !name.startsWith('drag ownership')) return
  if ((nativeBoundaryBaseline || process.env.SPMUSIC_NATIVE_BOUNDARY_ONLY) && !name.startsWith('lower-origin touch')) return
  if (process.env.SPMUSIC_TOUCH_SEQUENCE_ONLY && !name.startsWith('late native scroll')) return
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
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(type, event => window.touchEvidence.push({ type, trusted: event.isTrusted, canceled: event.defaultPrevented, cancelable: event.cancelable, fingers: event.touches.length, y: event.touches[0]?.clientY, scrollTop: document.querySelector('.playlist-panel')?.scrollTop, time: performance.now() }), { passive: true })
    document.addEventListener('pointercancel', event => window.touchEvidence.push({ type: 'pointercancel', trusted: event.isTrusted, pointerType: event.pointerType, scrollTop: document.querySelector('.playlist-panel')?.scrollTop, time: performance.now() }))
  })
  const dispatch = async (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) })
  const move = async (from, to, steps = 8) => {
    for (let i = 1; i <= steps; i++) await dispatch('touchMove', from.map(([id, x, y], j) => [id, x + (to[j][1] - x) * i / steps, y + (to[j][2] - y) * i / steps]))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  }
  return { dispatch, move }
}

try {
  await check('coast peak seek: visible peak velocity converges continuously from both sides', async ({ page }) => {
    const evidence = await page.evaluate(async () => {
      const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero'), card = document.querySelector('.playlist-card')
      panel.addEventListener('scrollend', event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const commit = top => { panel.scrollTop = top; panel.dispatchEvent(new Event('scroll')) }
      const send = (type, y) => { const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]; panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches })) }
      const original = Element.prototype.animate, batches = []
      Element.prototype.animate = function (...args) {
        const animation = original.apply(this, args)
        if (this === panel) batches.push([])
        if (this === panel || panel.contains(this)) { animation.effect.updateTiming({ fill: 'both' }); animation.pause(); batches.at(-1)?.push(animation) }
        return animation
      }
      const read = () => ({ offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, hero: hero.getBoundingClientRect().height, card: card.getBoundingClientRect().y })
      const seek = (batch, time) => { for (const animation of batch) animation.currentTime = time; return read() }
      try {
        commit(180); await frame()
        let y = 600; send('touchstart', y)
        for (const top of [140, 100, 60]) { y += 40; send('touchmove', y); commit(top); await frame() }
        send('touchend'); await frame(); commit(0)
        const first = batches[0], keyframes = first[0].effect.getKeyframes(), duration = first[0].effect.getTiming().duration
        const peakFrame = keyframes.reduce((maximum, item) => Number.parseFloat(item['--playlist-overscroll-offset']) > Number.parseFloat(maximum['--playlist-overscroll-offset']) ? item : maximum)
        const peakTime = peakFrame.computedOffset * duration, origin = seek(first, 0), peak = seek(first, peakTime)
        const left = [4, 2, 1].map(h => ({ h, state: seek(first, peakTime - h) }))
        let returning = first, returnStart = peakTime
        if (peakTime === duration) {
          seek(first, duration)
          first.at(-1).finish()
          for (let i = 0; i < 5 && batches.length < 2; i++) await frame()
          returning = batches[1]; returnStart = 0
        }
        const samples = left.map(({ h, state }) => {
          const right = seek(returning, returnStart + h)
          const result = { h }
          for (const key of ['offset', 'hero', 'card']) {
            const amplitude = peak[key] - origin[key], vl = (peak[key] - state[key]) / h / amplitude, vr = (right[key] - peak[key]) / h / amplitude
            result[key] = { amplitude, leftVelocity: vl, rightVelocity: vr, jump: Math.abs(vr - vl) }
          }
          return result
        })
        return { duration, peakTime, batches: batches.length, samples }
      } finally {
        Element.prototype.animate = original
        window.unmountFixture()
        for (const batch of batches) for (const animation of batch) animation.cancel()
      }
    })
    console.log('COAST_PEAK_SEEK', JSON.stringify(evidence))
    for (const key of ['offset', 'hero', 'card']) {
      assert(evidence.samples[0][key].amplitude > 2, `${key} records real visible feedback`)
      const jumps = evidence.samples.map(sample => sample[key].jump)
      assert(jumps[2] < jumps[0] * .6, `${key}: shrinking 4ms to 1ms must approach continuous peak velocity (${jumps})`)
      assert(jumps[2] < jumps[1], `${key}: finer peak sampling reduces the left/right velocity difference`)
    }
  }, { width: 1920, height: 1280, level: 2 })
  for (const [edge, interval] of [['top', 16], ['bottom', 33]]) {
    await check(`coast peak raf${interval}: ${edge} geometry crosses its peak without a callback handoff`, async ({ page }) => {
      const evidence = await page.evaluate(async ({ edge, interval }) => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        const card = document.querySelector(edge === 'top' ? '.playlist-card' : '.playlist-card:last-child')
        const maximum = panel.scrollHeight - panel.clientHeight, direction = edge === 'top' ? 1 : -1
        panel.addEventListener('scrollend', event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        const commit = distance => { panel.scrollTop = edge === 'top' ? distance : maximum - distance; panel.dispatchEvent(new Event('scroll')) }
        const send = (type, y) => { const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]; panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches })) }
        const original = Element.prototype.animate, created = [], frames = []
        Element.prototype.animate = function (...args) {
          const animation = original.apply(this, args)
          if (this === panel) created.push({ time: performance.now(), duration: animation.effect.getTiming().duration })
          return animation
        }
        try {
          commit(180); await frame()
          let y = 600; send('touchstart', y)
          for (const distance of [140, 100, 60]) { y += direction * 40; send('touchmove', y); commit(distance); await frame() }
          send('touchend'); await frame(); commit(0)
          const baseHero = hero.getBoundingClientRect(), baseCard = card.getBoundingClientRect().y, start = performance.now()
          for (;;) {
            const time = await frame()
            if (frames.length && time - frames.at(-1).time < interval - .5) continue
            const h = hero.getBoundingClientRect()
            frames.push({ time, offset: direction * (Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0), hero: edge === 'top' ? h.height - baseHero.height : baseHero.y - h.y, card: direction * (card.getBoundingClientRect().y - baseCard), top: panel.scrollTop })
            if (time >= start + 500) break
          }
          return { edge, interval, frames, created, finalAnimations: panel.getAnimations({ subtree: true }).length }
        } finally { Element.prototype.animate = original }
      }, { edge, interval })
      const peak = Math.max(...evidence.frames.map(frame => frame.offset)), peakIndex = evidence.frames.findIndex(frame => frame.offset === peak)
      const gaps = evidence.frames.slice(1).map((frame, i) => frame.time - evidence.frames[i].time)
      const slopes = evidence.frames.slice(1).map((frame, i) => (frame.offset - evidence.frames[i].offset) / gaps[i])
      console.log('COAST_PEAK_RAF', JSON.stringify({ edge, interval, peak, peakNeighbors: evidence.frames.slice(Math.max(0, peakIndex - 2), peakIndex + 3), peakSlopes: slopes.slice(Math.max(0, peakIndex - 2), peakIndex + 2), maxFrameGap: Math.max(...gaps), created: evidence.created, final: evidence.frames.at(-1) }))
      assert(peak > 2 && peakIndex > 0 && peakIndex < evidence.frames.length - 2, 'real rendered geometry includes outward travel, a peak and return')
      assert(evidence.frames.slice(peakIndex + 1).every(frame => frame.offset <= peak + .1), 'the autonomous return cannot produce a second outward peak')
      assert(evidence.frames.every(frame => Math.abs(frame.hero - frame.offset) < .05), 'the visible hero follows the same continuous timeline')
      assert(evidence.frames.some(frame => frame.card > 2), 'actual song geometry moves during feedback')
      assert.equal(evidence.created.length, 1, 'crossing the peak requires no JavaScript finish callback to launch another animation')
      assert.equal(evidence.finalAnimations, 0, 'the complete coast timeline cleans up')
      near(evidence.frames.at(-1).offset, 0, 'coast geometry returns exactly to rest', .01)
    }, { width: 1920, height: 1280, level: 2 })
  }
  for (const edge of ['top', 'bottom']) {
    await check(`touch fling ${edge}: committed native inertia after touchend triggers one continuous outward and return cycle`, async ({ page }) => {
      const evidence = await page.evaluate(async edge => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        const card = document.querySelector(edge === 'top' ? '.playlist-card' : '.playlist-card:last-child')
        const maximum = panel.scrollHeight - panel.clientHeight, direction = edge === 'top' ? 1 : -1
        const position = distance => edge === 'top' ? distance : maximum - distance
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
        const hookWrites = [], frames = [], events = []
        // Each programmatic step emits its own browser scrollend. They belong
        // to one controlled continuous fling here; allow the final real end.
        let continuous = true
        panel.addEventListener('scrollend', event => {
          events.push({ type: 'scrollend', time: performance.now(), top: panel.scrollTop, suppressed: continuous })
          if (continuous) event.stopImmediatePropagation()
        }, true)
        let writing = false, running = true, edgeAt = null
        Object.defineProperty(panel, 'scrollTop', { configurable: true, get: () => descriptor.get.call(panel), set: value => { if (!writing) hookWrites.push(value); descriptor.set.call(panel, value) } })
        const commit = distance => { writing = true; panel.scrollTop = position(distance); writing = false; panel.dispatchEvent(new Event('scroll')) }
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        const send = (type, y) => {
          const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]
          const event = new TouchEvent(type, { bubbles: true, cancelable: type === 'touchstart', touches, targetTouches: touches, changedTouches: touches })
          panel.dispatchEvent(event)
          events.push({ type, time: performance.now(), top: panel.scrollTop, prevented: event.defaultPrevented, trusted: event.isTrusted })
        }
        try {
          commit(180); await frame()
          const base = hero.getBoundingClientRect().height, baseCard = card.getBoundingClientRect().y
          const sample = time => {
            if (!running) return
            frames.push({ time, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, gain: hero.getBoundingClientRect().height - base, card: card.getBoundingClientRect().y - baseCard, top: panel.scrollTop })
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
          let y = 600
          send('touchstart', y)
          for (const distance of [140, 100, 60]) { y += direction * 40; send('touchmove', y); commit(distance); await frame() }
          send('touchend')
          const releasedAt = performance.now(), releasedTop = panel.scrollTop
          for (const distance of (edge === 'top' ? [0] : [40, 20, 0])) { await frame(); commit(distance) }
          edgeAt = performance.now()
          continuous = false
          const immediate = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0
          await new Promise(resolve => setTimeout(resolve, 600))
          const completedAt = performance.now()
          for (let i = 0; i < 3; i++) panel.dispatchEvent(new Event('scroll'))
          await new Promise(resolve => setTimeout(resolve, 120))
          return { edgeAt, releasedAt, releasedTop, immediate, maximum, events, frames, hookWrites, completedAt }
        } finally { running = false; delete panel.scrollTop }
      }, edge)
      const returned = evidence.frames.filter(frame => frame.time >= evidence.edgeAt)
      const magnitude = frame => (edge === 'top' ? 1 : -1) * frame.offset
      const peak = Math.max(...returned.map(magnitude)), peakIndex = returned.findIndex(frame => magnitude(frame) === peak)
      const outgoing = returned.slice(0, peakIndex + 1)
      console.log('TOUCH_FLING_CONTROLLED', JSON.stringify({ edge, peak, immediate: evidence.immediate, releasedTop: evidence.releasedTop, edgeAfterReleaseMs: evidence.edgeAt - evidence.releasedAt, scrollEnds: evidence.events.filter(event => event.type === 'scrollend'), hookWrites: evidence.hookWrites, final: returned.at(-1)?.offset }))
      assert(evidence.events.filter(event => event.type === 'touchmove').every(event => !event.prevented && !event.trusted), 'the controlled sequence explicitly models native-owned touch with later commits')
      assert(evidence.releasedTop > 0 && evidence.releasedTop < evidence.maximum, 'contact ends in the interior before inertial travel reaches an edge')
      near(evidence.immediate, 0, 'the committed edge starts from rest instead of jumping presentation', .02)
      assert(peak > 2, 'post-release native travel reaching the edge produces visible feedback')
      assert(outgoing.some(frame => magnitude(frame) > .1 && magnitude(frame) < peak * .9), 'feedback has a visible outward entry before its peak')
      assert(returned.some((frame, i) => i > peakIndex && Math.abs(frame.offset) < .1), 'the inertia feedback returns to rest')
      assert(returned.filter(frame => frame.time >= evidence.completedAt).every(frame => Math.abs(frame.offset) < .1), 'duplicate edge notifications cannot start a second feedback cycle')
      assert.deepEqual(evidence.hookWrites, [], 'inertial edge feedback never writes native scrollTop')
    }, { width: 1920, height: 1280, level: 2 })
  }
  await check('touch fling pending edge: an observed edge commit immediately before release is consumed once before the pending frame is lost', async ({ page }) => {
    const evidence = await page.evaluate(async () => {
      const panel = document.querySelector('.playlist-panel'), frames = [], commits = []
      panel.addEventListener('scrollend', event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const commit = top => { panel.scrollTop = top; panel.dispatchEvent(new Event('scroll')); commits.push({ top, time: performance.now() }) }
      const send = (type, y) => { const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]; panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches })) }
      let running = true
      try {
        commit(180); await frame()
        let y = 600; send('touchstart', y)
        for (const top of [140, 100, 60]) { y += 40; send('touchmove', y); commit(top); await frame() }
        const sample = time => { if (!running) return; frames.push({ time, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0 }); requestAnimationFrame(sample) }
        requestAnimationFrame(sample)
        // All three operations intentionally share one task: no pending rAF
        // can consume the final native overflow between commit and contact-up.
        send('touchmove', y + 80); commit(0); send('touchend')
        const immediate = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0
        await new Promise(resolve => setTimeout(resolve, 600))
        for (let i = 0; i < 3; i++) panel.dispatchEvent(new Event('scroll'))
        const duplicateAt = performance.now()
        await new Promise(resolve => setTimeout(resolve, 100))
        return { frames, commits, immediate, duplicateAt }
      } finally { running = false }
    })
    const peak = Math.max(...evidence.frames.map(frame => frame.offset))
    console.log('TOUCH_FLING_PENDING_EDGE', JSON.stringify({ peak, immediate: evidence.immediate, commits: evidence.commits, final: evidence.frames.at(-1).offset }))
    assert(evidence.commits.slice(1, 4).every((commit, i) => commit.top < evidence.commits[i].top), 'the source contains observed same-direction interior motion')
    near(evidence.immediate, 0, 'the edge-release race still enters continuously from zero', .02)
    assert(peak > 2, 'a confirmed pending edge at release cannot lose its feedback')
    assert(evidence.frames.some(frame => frame.offset > .1 && frame.offset < peak * .9), 'the race uses the same continuous outward entry')
    assert(evidence.frames.filter(frame => frame.time >= evidence.duplicateAt).every(frame => Math.abs(frame.offset) < .1), 'the consumed pending edge cannot replay after return')
  }, { width: 1920, height: 1280, level: 2 })
  await check('touch fling cancellation: interior, scrollend, reverse, new owners, expiry, resize and unmount cannot invent feedback', async ({ page }) => {
    const evidence = await page.evaluate(async () => {
      const panel = document.querySelector('.playlist-panel'), results = []
      // These setters represent one continuous native scroll, not a sequence
      // of independent programmatic scrolls. Explicit test scrollend is kept.
      panel.addEventListener('scrollend', event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const commit = top => { panel.scrollTop = top; panel.dispatchEvent(new Event('scroll')) }
      const send = (type, y) => { const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]; panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches })) }
      const pointer = type => panel.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 33, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: 330, clientY: 300 }))
      for (const reason of ['interior', 'scrollend', 'reverse', 'keyboard', 'wheel', 'pointer', 'new touch', 'touchcancel', 'resize', 'expired', 'unmount']) {
        window.dispatchEvent(new Event('resize')); commit(180); await frame()
        let y = 600; send('touchstart', y)
        for (const top of [140, 100, 60]) { y += 40; send('touchmove', y); commit(top); await frame() }
        send(reason === 'touchcancel' ? 'touchcancel' : 'touchend')
        if (reason === 'scrollend') panel.dispatchEvent(new Event('scrollend'))
        if (reason === 'reverse') { commit(80); await frame() }
        if (reason === 'keyboard') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        if (reason === 'wheel') panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }))
        if (reason === 'pointer') { pointer('pointerdown'); pointer('pointerup') }
        if (reason === 'new touch') send('touchstart', 600)
        if (reason === 'resize') window.dispatchEvent(new Event('resize'))
        if (reason === 'expired') await new Promise(resolve => setTimeout(resolve, 2 * Number.parseFloat(getComputedStyle(panel).getPropertyValue('--app-motion-standard')) + 60))
        if (reason === 'unmount') window.unmountFixture()
        commit(reason === 'interior' ? 20 : 0)
        let peak = 0
        for (let i = 0; i < 8; i++) { await frame(); peak = Math.max(peak, Math.abs(Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0)) }
        results.push({ reason, peak, style: panel.style.getPropertyValue('--playlist-overscroll-offset'), detached: !panel.isConnected })
        if (reason === 'new touch') send('touchend')
      }
      return results
    })
    console.log('TOUCH_FLING_CANCEL', JSON.stringify(evidence))
    for (const result of evidence) assert(result.peak < .1, `${result.reason} prevents a fabricated inertial edge cycle`)
    assert.equal(evidence.at(-1).style, '', 'unmount removes presentation and cannot receive late writes')
  }, { width: 1920, height: 1280, level: 2 })
  await check('touch fling entry takeover: pointer or keyboard settles; bottom reverse wheel retains the real native range', async ({ page }) => {
    const evidence = await page.evaluate(async () => {
      const panel = document.querySelector('.playlist-panel'), results = [], maximum = panel.scrollHeight - panel.clientHeight
      panel.addEventListener('scrollend', event => { if (event.isTrusted) event.stopImmediatePropagation() }, true)
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const commit = distance => { panel.scrollTop = maximum - distance; panel.dispatchEvent(new Event('scroll')) }
      const offset = () => Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0
      const send = (type, y) => { const touches = y === undefined ? [] : [new Touch({ identifier: 7, target: panel, clientX: 1000, clientY: y })]; panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches })) }
      for (const owner of ['pointer', 'keyboard', 'wheel']) {
        window.dispatchEvent(new Event('resize')); commit(180); await frame()
        let y = 600; send('touchstart', y)
        for (const distance of [140, 100, 60]) { y -= 40; send('touchmove', y); commit(distance); await frame() }
        send('touchend'); commit(0)
        for (let i = 0; i < 12 && Math.abs(offset()) < 1; i++) await frame()
        const before = offset()
        if (owner === 'pointer') {
          for (const type of ['pointerdown', 'pointerup']) panel.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 35, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: 330, clientY: 300 }))
        } else if (owner === 'keyboard') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        else panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }))
        const takeoverTop = panel.scrollTop
        const deadline = performance.now() + 1000
        while ((Math.abs(offset()) > .1 || panel.getAnimations({ subtree: true }).length) && performance.now() < deadline) await frame()
        results.push({ owner, before, takeoverTop, maximum, final: offset(), animations: panel.getAnimations({ subtree: true }).length })
      }
      return results
    })
    console.log('TOUCH_FLING_ENTRY_OWNER', JSON.stringify(evidence))
    for (const result of evidence) {
      assert(result.before < -1, 'takeover happens during visible bottom-coast entry')
      assert(result.takeoverTop > result.maximum - 300, 'new input cannot clamp the bottom to an obsolete zero range')
      near(result.final, 0, `${result.owner} leaves no stuck offset`, .1)
      assert.equal(result.animations, 0, 'the replaced coast animation cannot restart after ownership changes')
    }
  }, { width: 1920, height: 1280, level: 2 })
  for (const edge of ['top', 'bottom']) {
    await check(`touch fling trusted ${edge}: real browser inertia reaches the boundary after release without injected commits`, async ({ page }) => {
      const input = await touchInput(page)
      const initial = await page.evaluate(edge => { const panel = document.querySelector('.playlist-panel'), maximum = panel.scrollHeight - panel.clientHeight; panel.scrollTop = edge === 'top' ? 420 : maximum - 420; return { maximum, x: panel.getBoundingClientRect().x + 8 } }, edge)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.evaluate(() => {
        const panel = document.querySelector('.playlist-panel'), trace = window.realTouchFling = { frames: [], events: [], running: true }
        for (const type of ['touchend', 'scroll', 'scrollend']) panel.addEventListener(type, event => trace.events.push({ type, time: performance.now(), top: panel.scrollTop, trusted: event.isTrusted }))
        const sample = time => { if (!trace.running) return; trace.frames.push({ time, top: panel.scrollTop, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0 }); requestAnimationFrame(sample) }
        requestAnimationFrame(sample)
      })
      const from = edge === 'top' ? 300 : 700, to = edge === 'top' ? 700 : 300
      await input.dispatch('touchStart', [[0, initial.x, from]])
      await input.move([[0, initial.x, from]], [[0, initial.x, to]], 20)
      await input.dispatch('touchEnd')
      await page.waitForTimeout(1100)
      const trace = await page.evaluate(() => { window.realTouchFling.running = false; return window.realTouchFling })
      const ended = trace.events.find(event => event.type === 'touchend')
      const boundary = trace.events.find(event => event.type === 'scroll' && event.time > ended.time && (edge === 'top' ? event.top === 0 : event.top === initial.maximum))
      const after = trace.frames.filter(frame => frame.time >= ended.time), peak = Math.max(...after.map(frame => Math.abs(frame.offset)))
      console.log('TOUCH_FLING_TRUSTED', JSON.stringify({ edge, releasedTop: ended.top, edgeAfterReleaseMs: boundary?.time - ended.time, peak, final: after.at(-1).offset }))
      assert(trace.events.every(event => event.trusted), 'the observed native travel and release are real browser events')
      assert(ended.top > 0 && ended.top < initial.maximum, 'the finger releases before the native boundary')
      assert(boundary, 'native inertia itself commits the edge after touchend')
      assert(peak > 2, 'real post-release native travel triggers visible feedback')
      near(after.at(-1).offset, 0, 'real inertial feedback completes its return', .1)
    }, { width: 1920, height: 1280, level: 2 })
  }
  for (const interval of [64, 160]) for (const frameMs of [16, 33]) {
    await check(`late bridge ${interval}ms input at ${frameMs}ms presentation: real cover geometry does not compress most of the return into one frame`, async ({ page }) => {
      assert(await page.evaluate(() => window.fixtureWindowReports.length > 0), 'the real visible-window effect and callback execute in this fixture')
      const evidence = await page.evaluate(({ interval, frameMs }) => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero'), card = document.querySelector('.playlist-card')
        const base = hero.getBoundingClientRect().height, cardY = card.getBoundingClientRect().y
        const duration = Number.parseFloat(getComputedStyle(panel).getPropertyValue('--app-motion-standard'))
        const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
        const descriptor = Object.getOwnPropertyDescriptor(performance, 'now'), pending = new Map(), frames = []
        let clock = 0, id = 0
        window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
        window.cancelAnimationFrame = key => pending.delete(key)
        Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
        try {
          window.dispatchEvent(new Event('resize'))
          const lastInput = 11 * interval, end = Math.ceil((lastInput + 1000) / frameMs) * frameMs
          for (clock = 0; clock <= end; clock++) {
            if (clock <= lastInput && clock % interval === 0) panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
            if (clock % frameMs === 0) {
              const callbacks = [...pending.values()]; pending.clear()
              for (const callback of callbacks) callback(clock)
              frames.push({ time: clock, gain: hero.getBoundingClientRect().height - base, card: card.getBoundingClientRect().y - cardY, offset: Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')) || 0 })
            }
          }
          return { duration, frames, imageWidth: hero.querySelector('img').naturalWidth }
        } finally {
          window.dispatchEvent(new Event('resize'))
          window.requestAnimationFrame = request
          window.cancelAnimationFrame = cancel
          if (descriptor) Object.defineProperty(performance, 'now', descriptor)
          else delete performance.now
        }
      }, { interval, frameMs })
      const remaining = [1, .69, .56, .42, .35, .27, .21, .15, .115, .077, .057, .038, .019, 0]
      const release = time => {
        const position = Math.max(0, Math.min(1, time / evidence.duration)) * (remaining.length - 1)
        const index = Math.min(remaining.length - 2, Math.floor(position))
        return remaining[index] + (remaining[index + 1] - remaining[index]) * (position - index)
      }
      // Maximize over every possible phase alignment of this frame window.
      const knots = remaining.map((_value, i) => i * evidence.duration / (remaining.length - 1))
      const starts = [0, ...knots, ...knots.map(time => time - frameMs)].filter(time => time >= 0 && time <= evidence.duration)
      const referenceFraction = Math.max(...starts.map(time => release(time) - release(time + frameMs)))
      const peak = Math.max(...evidence.frames.map(frame => frame.gain))
      const steps = evidence.frames.slice(1).map((frame, i) => ({ time: frame.time, drop: evidence.frames[i].gain - frame.gain }))
      const largest = steps.reduce((best, step) => step.drop > best.drop ? step : best, steps[0])
      const limit = 1.5 * peak * referenceFraction
      console.log('LATE_BRIDGE_GEOMETRY', JSON.stringify({ interval, frameMs, peak, largest, referenceDrop: peak * referenceFraction, limit, final: evidence.frames.at(-1).gain }))
      assert.equal(evidence.imageWidth, 512, 'this path paints representative decoded bitmap covers')
      assert(peak > 10, 'the sparse input creates a substantial visible pull')
      for (const frame of evidence.frames) {
        near(frame.gain, frame.offset, 'late return is measured from the visible hero', .02)
        near(frame.card, frame.offset * 1.1, 'the real first song shares the return trajectory', .03)
        assert(frame.gain >= -.02, 'the late return cannot overshoot inward past its rest geometry')
      }
      assert(largest.drop <= limit + .03, 'no frame exceeds 1.5 times the phase-aligned touch reference drop at the same visible peak')
      assert.equal(evidence.frames.at(-1).offset, 0, 'the sparse late return reaches exact zero')
    }, { width: 1920, height: 1280, level: 0, count: 1797, pipeline: true, bitmap: true })
  }
  await check('matched return visible-peak curves: wheel and touch share normalized recovery timing within two sampled frames', async ({ page }) => {
    const base = await geometry(page), point = { x: base.panel.x + 8, y: 300 }
    await page.mouse.move(point.x, point.y)
    const profiles = []
    for (const input of ['touch', 'wheel']) {
      let controlledFrames = null
      await page.evaluate(height => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        const trace = window.matchTrace = { frames: [], inputs: [], running: true }
        if (!window.matchInputObserver) {
          window.matchInputObserver = true
          panel.addEventListener('wheel', event => window.matchTrace.inputs.push({ time: performance.now(), delta: event.deltaY }), { passive: true })
        }
        const frame = time => {
          if (!trace.running) return
          trace.frames.push({ time, gain: hero.getBoundingClientRect().height - height, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0 })
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }, base.hero.height)
      if (input === 'touch') {
        const touch = await touchInput(page)
        await touch.dispatch('touchStart', [[0, point.x, point.y]])
        await touch.move([[0, point.x, point.y]], [[0, point.x, point.y + 180]], 12)
        await touch.dispatch('touchEnd')
      } else {
        // This assertion compares a short burst's curve. CDP acknowledgments
        // can turn requested 16ms gaps into sparse input (e.g. 64/104ms), which
        // legitimately follows the separately tested late-return path. Keep
        // this input clock exact; trusted wheel delivery has its own cases.
        controlledFrames = await page.evaluate(height => {
          window.matchTrace.running = false
          const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
          const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
          const descriptor = Object.getOwnPropertyDescriptor(performance, 'now')
          const pending = new Map(), frames = []
          let clock = 0, id = 0
          window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
          window.cancelAnimationFrame = key => pending.delete(key)
          Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
          try {
            window.dispatchEvent(new Event('resize'))
            const timeline = [64, 96, 128].map((delta, i) => ({ time: i * 16, delta }))
            for (let i = 0; i <= 36; i++) timeline.push({ time: i * 1000 / 60 })
            timeline.sort((left, right) => left.time - right.time || Number(!left.delta) - Number(!right.delta))
            for (const sample of timeline) {
              clock = sample.time
              if (sample.delta) panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -sample.delta, bubbles: true, cancelable: true }))
              else {
                const callbacks = [...pending.values()]
                pending.clear()
                for (const callback of callbacks) callback(clock)
                frames.push({ time: clock, gain: hero.getBoundingClientRect().height - height, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0 })
              }
            }
            return frames
          } finally {
            window.dispatchEvent(new Event('resize'))
            window.requestAnimationFrame = request
            window.cancelAnimationFrame = cancel
            if (descriptor) Object.defineProperty(performance, 'now', descriptor)
            else delete performance.now
          }
        }, base.hero.height)
      }
      await settled(page, base)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const frames = controlledFrames ?? await page.evaluate(() => { window.matchTrace.running = false; return window.matchTrace.frames })
      const peak = Math.max(...frames.map(frame => frame.gain))
      // A held touch can have a flat peak before release. Use its last visible
      // peak frame, never the first time the same held height was reached.
      let peakIndex = 0
      for (let i = 0; i < frames.length; i++) if (frames[i].gain >= peak - .02) peakIndex = i
      const returning = frames.slice(peakIndex), peakAt = returning[0].time
      const crossing = fraction => {
        const index = returning.findIndex(frame => frame.gain <= peak * fraction)
        if (index < 0) return NaN
        if (index === 0 || fraction === 0) return returning[index].time - peakAt
        const before = returning[index - 1], after = returning[index]
        const ratio = (before.gain - peak * fraction) / (before.gain - after.gain)
        return before.time + ratio * (after.time - before.time) - peakAt
      }
      const steps = returning.slice(1).map((frame, i) => frame.time - returning[i].time).sort((a, b) => a - b)
      const fractions = [.9, .75, .5, .25, .1, .01, 0]
      const profile = { input, peak, frameMs: steps[Math.floor(steps.length / 2)], curve: Object.fromEntries(fractions.map(fraction => [fraction, crossing(fraction)])), inputs: await page.evaluate(() => window.matchTrace.inputs), maxFrameGap: Math.max(...steps), peakAt }
      for (const frame of returning) near(frame.gain, frame.offset, 'matched curves use actual visible hero height', .02)
      assert(returning.every((frame, i) => frame.gain >= -.02 && (!i || frame.gain <= returning[i - 1].gain + .1)), 'the measured return is monotone without visible outward kicks or negative overshoot')
      profiles.push(profile)
    }
    const tolerance = 2 * Math.max(...profiles.map(profile => profile.frameMs))
    console.log('MATCHED_VISIBLE_PEAK_RETURN', JSON.stringify({ profiles, toleranceMs: tolerance }))
    assert(profiles.every(profile => profile.peak > 10), 'both normalized traces start from a substantial visible peak')
    // A wheel peak has near-zero velocity while a released touch immediately
    // follows its sampled decay. Keep early fractions as evidence; acceptance
    // compares the late curve and full cycle without requiring a velocity jump.
    for (const fraction of [.1, .01, 0]) {
      assert(Number.isFinite(profiles[1].curve[fraction]), 'wheel return reaches every normalized level and exact zero')
      assert(Math.abs(profiles[1].curve[fraction] - profiles[0].curve[fraction]) <= tolerance, `wheel and touch ${fraction} remaining time match within two median frames`)
    }
  }, { width: 1920, height: 1280, level: 2, count: 120 })
  await check('matched return interruption: input during the return contributes without a position jump and return-phase unmount cleans its driver', async ({ page }) => {
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel'), pending = new Map()
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const timeDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      let clock = 0, id = 0
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      const frame = () => { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(clock) }
      const offset = () => Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')) || 0
      const send = delta => panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, bubbles: true, cancelable: true }))
      const run = resume => {
        window.dispatchEvent(new Event('resize'))
        clock = 0; send(120); frame()
        let peak = 0
        for (clock = 8; clock <= 208; clock += 8) { frame(); peak = Math.max(peak, offset()) }
        clock = 208
        const before = offset()
        if (resume) { send(48); frame() }
        const immediate = offset(), later = []
        for (clock = 216; clock <= 480; clock += 8) {
          if (resume && clock === 224) send(72)
          if (resume && clock === 240) send(96)
          frame(); later.push(offset())
        }
        return { peak, before, immediate, later }
      }
      try {
        const control = run(false), resumed = run(true)
        window.dispatchEvent(new Event('resize'))
        clock = 0; send(120); frame()
        let finishedBefore = 0, afterThird = 0, finishedReclaimPeak = 0
        for (clock = 8; clock <= 1000; clock += 8) {
          // A quiet but ongoing tail keeps the third strong sample inside the
          // same stream. Its finished gate must wake without a fourth packet.
          if (clock >= 160 && clock <= 576 && (clock - 160) % 32 === 0) send(.2)
          if (clock === 608) finishedBefore = offset()
          if ([616, 648, 680].includes(clock)) send(100)
          frame()
          if (clock === 680) afterThird = offset()
          if (clock >= 680) finishedReclaimPeak = Math.max(finishedReclaimPeak, offset())
        }
        window.dispatchEvent(new Event('resize'))
        clock = 0; send(120); frame()
        for (clock = 8; clock <= 208; clock += 8) frame()
        const beforeUnmount = offset(), queuedBeforeUnmount = pending.size
        window.unmountFixture()
        clock = 400; frame()
        return { control, resumed, finishedBefore, afterThird, finishedReclaimPeak, beforeUnmount, queuedBeforeUnmount, queuedAfterUnmount: pending.size, afterUnmount: panel.style.getPropertyValue('--playlist-overscroll-offset') }
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (timeDescriptor) Object.defineProperty(performance, 'now', timeDescriptor)
        else delete performance.now
      }
    })
    const contribution = Math.max(...evidence.resumed.later.map((value, i) => value - evidence.control.later[i]))
    console.log('MATCHED_RETURN_INTERRUPTION', JSON.stringify({ before: evidence.resumed.before, immediate: evidence.resumed.immediate, contribution, finishedBefore: evidence.finishedBefore, afterThird: evidence.afterThird, finishedReclaimPeak: evidence.finishedReclaimPeak, beforeUnmount: evidence.beforeUnmount, queuedBeforeUnmount: evidence.queuedBeforeUnmount, queuedAfterUnmount: evidence.queuedAfterUnmount, afterUnmount: evidence.afterUnmount }))
    assert(evidence.resumed.before > .1 && evidence.resumed.before < evidence.resumed.peak * .8, 'the counterfactual input arrives during a visible declining return')
    near(evidence.resumed.immediate, evidence.resumed.before, 'resumed input cannot jump visible presentation at the same time', .001)
    assert(contribution > 4, 'return-phase input is preserved and measurably changes subsequent presentation')
    assert.equal(evidence.finishedBefore, 0, 'the second counterexample starts from the finished tail gate')
    assert(evidence.finishedReclaimPeak > 4, 'three sustained strong samples restart a finished stream without needing a fourth event')
    assert(evidence.beforeUnmount > .1 && evidence.queuedBeforeUnmount > 0, 'unmount exercises an active return phase')
    assert.equal(evidence.queuedAfterUnmount, 0, 'return-phase unmount cancels every scheduled presentation callback')
    assert.equal(evidence.afterUnmount, '', 'return-phase unmount removes its diagnostic presentation property')
  })
  await check('handoff speed controlled: historical overflow ages from its input time rather than its native commit', async ({ page }) => {
    const profiles = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
      const baseHeight = hero.getBoundingClientRect().height
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const timeDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      const pending = new Map(), profiles = []
      let top = 0, clock = 0, id = 0
      Object.defineProperty(panel, 'scrollTop', { configurable: true, get: () => top, set: value => { top = value } })
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      const frame = () => { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(clock) }
      const send = delta => panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, bubbles: true, cancelable: true }))
      try {
        const scenarios = [{ startTop: 0, commitAt: 32 }, ...[70, 120, 500].flatMap(startTop => [64, 256, 480].map(commitAt => ({ startTop, commitAt })))]
        for (const scenario of scenarios) {
          window.dispatchEvent(new Event('resize'))
          top = scenario.startTop
          const frames = [], lastInputAt = 32
          for (clock = 0; clock <= 1200; clock += 16) {
            // The native path spends startTop pixels on ordinary travel. Only
            // the final 120px at t=32 is equivalent to direct boundary input.
            if (clock === 0 && scenario.startTop) send(scenario.startTop / 2)
            if (clock === 16 && scenario.startTop) { top = scenario.startTop / 2; panel.dispatchEvent(new Event('scroll')) }
            if (clock === lastInputAt) send(scenario.startTop ? scenario.startTop / 2 + 120 : 120)
            if (clock === scenario.commitAt && scenario.startTop) { top = 0; panel.dispatchEvent(new Event('scroll')) }
            frame()
            frames.push({ time: clock, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, gain: hero.getBoundingClientRect().height - baseHeight })
          }
          const visible = frames.filter(sample => sample.time >= scenario.commitAt)
          const peak = visible.reduce((best, sample) => sample.offset > best.offset ? sample : best, visible[0])
          const returning = visible.filter(sample => sample.time >= peak.time)
          const t90At = returning.find(sample => sample.offset <= peak.offset * .1)?.time
          const zeroAt = returning.find(sample => sample.offset === 0)?.time
          clock = 1216
          send(50)
          let freshPeak = 0
          for (; clock <= 1456; clock += 16) { frame(); freshPeak = Math.max(freshPeak, Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')) || 0) }
          profiles.push({ ...scenario, lastInputAt, peakAt: peak.time, peak: peak.offset, t90At, zeroAt, freshPeak, frames })
        }
        return profiles
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (timeDescriptor) Object.defineProperty(performance, 'now', timeDescriptor)
        else delete performance.now
        delete panel.scrollTop
        descriptor.set.call(panel, 0)
      }
    })
    console.log('HANDOFF_SPEED_CONTROLLED', JSON.stringify(profiles.map(({ frames: _frames, ...profile }) => profile)))
    console.log('HANDOFF_DIRECT_TRAJECTORY_SHA256', createHash('sha256').update(JSON.stringify(profiles[0].frames.map(({ time, offset }) => [time, offset]))).digest('hex'))
    const direct = profiles[0]
    assert(direct.peak > 10 && direct.freshPeak > 10, 'the unchanged direct path retains its full visible response')
    for (const profile of profiles) {
      assert(Number.isFinite(profile.zeroAt), 'every native commit eventually returns to exact visible zero')
      assert(profile.freshPeak > 10, 'a real new boundary input is not mistaken for stale history')
      for (const sample of profile.frames) near(sample.gain, sample.offset, 'handoff timing is measured in real hero geometry', .02)
      if (profile.startTop && !process.env.SPMUSIC_HANDOFF_SPEED_RECORD) {
        assert(profile.zeroAt <= Math.max(profile.commitAt, direct.zeroAt) + 32, 'native delivery latency cannot restart a full quiet period for historical overflow')
        const remainingReferencePeak = Math.max(...direct.frames.filter(sample => sample.time >= profile.commitAt).map(sample => sample.offset))
        assert(profile.peak <= remainingReferencePeak + .1, 'aged native overflow cannot create a fresh-strength late peak')
      }
    }
  }, { width: 1920, height: 1280, level: 2, count: 120 })
  for (const startTop of [0, 70, 120, 500]) {
    await check(`handoff speed trusted from ${startTop}: native arrival and post-input return have separate timestamps`, async ({ page }) => {
      const base = await geometry(page), point = { x: base.panel.x + 8, y: 300 }
      await page.mouse.move(point.x, point.y)
      await page.evaluate(({ startTop, baseHeight }) => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        panel.scrollTop = startTop
        const trace = window.handoffTrace = { frames: [], events: [], commitAt: null, running: true }
        panel.addEventListener('wheel', event => { trace.before = { time: performance.now(), top: panel.scrollTop, delta: event.deltaY, trusted: event.isTrusted } }, true)
        panel.addEventListener('wheel', event => trace.events.push({ ...trace.before, prevented: event.defaultPrevented }))
        panel.addEventListener('scroll', () => { if (panel.scrollTop === 0 && trace.commitAt === null) trace.commitAt = performance.now() })
        const sample = time => {
          if (!trace.running) return
          trace.frames.push({ time, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, gain: hero.getBoundingClientRect().height - baseHeight, top: panel.scrollTop })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, { startTop, baseHeight: base.hero.height })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const cdp = await page.context().newCDPSession(page)
      for (const delta of [64, 96, 128, 192, 128]) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -delta })
        await page.waitForTimeout(16)
      }
      await page.waitForFunction(() => window.handoffTrace.events.length === 5 && window.handoffTrace.frames.some(frame => frame.offset > .1))
      await settled(page, base)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const trace = await page.evaluate(() => { window.handoffTrace.running = false; return window.handoffTrace })
      const firstInputAt = trace.events[0].time, lastInputAt = trace.events.at(-1).time
      const peak = trace.frames.reduce((best, frame) => frame.offset > best.offset ? frame : best, trace.frames[0])
      const returning = trace.frames.filter(frame => frame.time >= Math.max(peak.time, lastInputAt))
      const t90At = returning.find(frame => frame.offset <= peak.offset * .1)?.time
      const zeroAt = returning.find(frame => frame.offset === 0)?.time
      console.log('HANDOFF_SPEED_TRUSTED', JSON.stringify({ startTop, inputSpanMs: lastInputAt - firstInputAt, commitFromLastInputMs: trace.commitAt === null ? null : trace.commitAt - lastInputAt, peakFromLastInputMs: peak.time - lastInputAt, peak: peak.offset, t90FromLastInputMs: t90At - lastInputAt, zeroFromLastInputMs: zeroAt - lastInputAt, eventTimes: trace.events.map(event => ({ ...event, time: event.time - firstInputAt })) }))
      assert.equal(trace.events.length, 5, 'all five identical requested browser wheel deltas arrive')
      assert(trace.events.every(event => event.trusted), 'natural handoff timing uses trusted wheel input')
      if (startTop) assert(trace.commitAt !== null && trace.events.some(event => !event.prevented), 'interior starts retain an actual native commit phase')
      assert(peak.offset > 2 && Number.isFinite(zeroAt), 'the continued gesture produces feedback and completes its return')
      for (const frame of trace.frames) near(frame.gain, frame.offset, 'natural handoff timing refers to actual hero geometry', .02)
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  for (const input of ['mouse', 'touch', 'wheel burst', 'wheel tail']) {
    await check(`return speed ${input}: visible geometry reports release and last-input recovery separately`, async ({ page }) => {
      const base = await geometry(page), point = { x: base.panel.x + 8, y: 300 }
      await page.mouse.move(point.x, point.y)
      await page.evaluate(({ input, height }) => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        const token = getComputedStyle(panel).getPropertyValue('--app-motion-standard').trim()
        const trace = window.speedTrace = { frames: [], events: [], release: null, running: true, standardMs: Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) }
        const gain = () => hero.getBoundingClientRect().height - height
        const end = event => {
          if ((input === 'mouse' && event.type === 'pointerup') || (input === 'touch' && event.type === 'touchend')) trace.release = { time: performance.now(), gain: gain(), trusted: event.isTrusted }
        }
        window.addEventListener('pointerup', end, true)
        window.addEventListener('touchend', end, true)
        panel.addEventListener('wheel', event => trace.events.push({ time: performance.now(), delta: event.deltaY, trusted: event.isTrusted }))
        const frame = time => {
          if (!trace.running) return
          trace.frames.push({ time, gain: gain(), offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0 })
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }, { input, height: base.hero.height })
      if (input === 'mouse') {
        await page.mouse.down()
        await page.mouse.move(point.x, point.y + 240, { steps: 12 })
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        await page.mouse.up()
      } else if (input === 'touch') {
        const touch = await touchInput(page)
        await touch.dispatch('touchStart', [[0, point.x, point.y]])
        await touch.move([[0, point.x, point.y]], [[0, point.x, point.y + 240]], 12)
        await touch.dispatch('touchEnd')
      } else {
        const cdp = await page.context().newCDPSession(page)
        const deltas = input === 'wheel burst' ? [64, 96, 128] : [192, 96, 48, 24, 12, 6, 3, 1.5, .75, .3]
        for (const delta of deltas) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -delta })
          await page.waitForTimeout(input === 'wheel burst' ? 16 : 64)
        }
      }
      await settled(page, base)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const trace = await page.evaluate(() => { window.speedTrace.running = false; return window.speedTrace })
      const origin = trace.release?.time ?? trace.events.at(-1).time
      const frames = trace.frames.filter(frame => frame.time >= origin)
      const peak = trace.release?.gain ?? Math.max(...trace.frames.map(frame => frame.gain))
      const globalPeak = trace.frames.reduce((best, frame) => frame.gain > best.gain ? frame : best, trace.frames[0])
      const first = limit => frames.find(frame => frame.gain <= limit)?.time - origin
      // A threshold crossing is observed on the next sampled frame. Allow
      // one normal frame of quantization, not an extra recovery interval.
      const intervals = trace.frames.slice(1).map((frame, i) => frame.time - trace.frames[i].time).sort((a, b) => a - b)
      const sampleFrameMs = intervals[Math.floor(intervals.length / 2)]
      const measure = { input, standardMs: trace.standardMs, peak, peakFromLastInputMs: globalPeak.time - origin, inputSpanMs: trace.events.length ? trace.events.at(-1).time - trace.events[0].time : null, t50Ms: first(peak * .5), t90Ms: first(peak * .1), below1pxMs: first(1), zeroMs: first(0), maxFrameMs: Math.max(...trace.frames.slice(1).map((frame, i) => frame.time - trace.frames[i].time)) }
      console.log('VISIBLE_RETURN_SPEED', JSON.stringify(measure))
      assert(peak > 5, 'speed sample starts from a visible pull')
      assert(Number.isFinite(measure.zeroMs), 'visible geometry reaches exact zero, independently of animation lifecycle metadata')
      if (!process.env.SPMUSIC_WHEEL_SPEED_RECORD) {
        const explicitRelease = input === 'mouse' || input === 'touch'
        assert(measure.t90Ms <= trace.standardMs * (explicitRelease ? 1 : 1.5) + sampleFrameMs, 'visible ninety-percent return meets the approved theme-relative speed target within one sampled frame')
        assert(measure.zeroMs <= trace.standardMs * (explicitRelease ? 1.25 : 3) + sampleFrameMs, 'exact zero meets the speed target without enlarging the presentation cutoff')
      }
      assert(trace.release?.trusted ?? trace.events.every(event => event.trusted), 'release or wheel input is trusted browser input')
      for (const frame of frames) near(frame.gain, frame.offset, 'speed measurements refer to actual hero geometry', .02)
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  const returnTails = {
    sparse: [[160, 22], [280, 12], [400, 9], [530, 4.5], [680, 3], [820, 1.7], [980, .8], [1140, .4], [1330, .2]],
    decaying: Array.from({ length: 28 }, (_, i) => [80 + i * 32, 36 * .78 ** i]),
    grouped: Array.from({ length: 8 }, (_, i) => [[120 + i * 120, 18 * .65 ** i], [124 + i * 120, 10 * .65 ** i], [128 + i * 120, 6 * .65 ** i]]).flat(),
    groupedPackets: [[160, 22], [280, 12], ...Array.from({ length: 6 }, (_, i) => [400 + 4 * i, 8 - .4 * i]), ...Array.from({ length: 6 }, (_, i) => [520 + 4 * i, 4 - .2 * i])],
  }
  for (const [name, tail] of Object.entries(returnTails)) {
    await check(`wheel return ${name}: geometry and velocity during return never hide local outward kicks`, async ({ page }) => {
      const trace = await page.evaluate(tail => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero'), card = document.querySelector('.playlist-card')
        const baseHeight = hero.getBoundingClientRect().height, baseCardY = card.getBoundingClientRect().y
        const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
        const timeDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
        const pending = new Map(), frames = []
        let clock = 0, id = 0, eventIndex = 0
        const events = [[0, 192], [16, 96], [32, 48], [48, 24], ...tail].sort((a, b) => a[0] - b[0])
        window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
        window.cancelAnimationFrame = key => pending.delete(key)
        Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
        try {
          for (clock = 0; clock <= 2100; clock += 4) {
            while (eventIndex < events.length && events[eventIndex][0] <= clock) {
              panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -events[eventIndex++][1], bubbles: true, cancelable: true }))
            }
            if (clock % 16 === 0) {
              const callbacks = [...pending.values()]; pending.clear()
              for (const callback of callbacks) callback(clock)
              frames.push({ time: clock, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, hero: hero.getBoundingClientRect().height - baseHeight, card: card.getBoundingClientRect().y - baseCardY })
            }
          }
          const beforeAcceleration = frames.at(-1).offset
          const acceleration = []
          for (clock = 2112; clock <= 2416; clock += 16) {
            if (clock <= 2192) panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -(8 + (clock - 2112) / 2), bubbles: true, cancelable: true }))
            const callbacks = [...pending.values()]; pending.clear()
            for (const callback of callbacks) callback(clock)
            acceleration.push(Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0)
          }
          return { frames, beforeAcceleration, resumedPeak: Math.max(...acceleration) }
        } finally {
          window.dispatchEvent(new Event('resize'))
          window.requestAnimationFrame = request
          window.cancelAnimationFrame = cancel
          if (timeDescriptor) Object.defineProperty(performance, 'now', timeDescriptor)
          else delete performance.now
        }
      }, tail)
      const peak = Math.max(...trace.frames.map(frame => frame.offset))
      const peakIndex = trace.frames.findIndex(frame => frame.offset === peak)
      const returning = trace.frames.slice(peakIndex)
      const delta = returning.slice(1).map((frame, i) => frame.offset - returning[i].offset)
      const kicks = delta.filter(value => value > .1)
      const velocity = delta.map(value => value / 16)
      const maxVelocityJump = Math.max(0, ...velocity.slice(1).map((value, i) => Math.abs(value - velocity[i])))
      const firstZeroIndex = returning.findIndex(frame => frame.offset === 0)
      const postZeroPeak = firstZeroIndex < 0 ? NaN : Math.max(...returning.slice(firstZeroIndex).map(frame => frame.offset))
      console.log('WHEEL_RETURN_CONTROLLED', JSON.stringify({ name, frames: trace.frames.length, peak, end: trace.frames.at(-1).offset, firstZeroAt: returning[firstZeroIndex]?.time, postZeroPeak, outwardKicks: kicks.length, maxOutwardKick: Math.max(0, ...kicks), maxVelocityJump, resumedPeak: trace.resumedPeak, tailFrames: process.env.SPMUSIC_WHEEL_RETURN_VERBOSE ? returning.filter((_frame, i) => i % 4 === 0) : undefined }))
      assert(peak > 10, 'controlled input produces substantial visible extension')
      for (const frame of trace.frames) {
        near(frame.hero, frame.offset, 'hero and diagnostic offset describe the same visible frame', .02)
        near(frame.card, frame.offset * 1.1, 'actual first song follows the same presentation scalar', .03)
      }
      if (!process.env.SPMUSIC_WHEEL_RETURN_RECORD) assert.equal(kicks.length, 0, 'a decaying tail cannot repeatedly kick visible geometry outward during return')
      if (!process.env.SPMUSIC_WHEEL_RETURN_RECORD) assert(postZeroPeak <= .1, 'a grouped decaying tail cannot revive a completed return')
      assert(trace.frames.at(-1).offset < 1, 'return completes after the specified tail')
      assert(trace.resumedPeak > trace.beforeAcceleration + 2, 'renewed acceleration still starts a new visible pull')
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  await check('wheel return new gesture response is visible at 16, 50 and 100ms without an event-time presentation jump', async ({ page }) => {
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel'), pending = new Map()
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const timeDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      let clock = 0, id = 0
      const offset = () => Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      try {
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true }))
        const immediate = offset(), samples = []
        for (clock = 0; clock <= 800; clock += 2) {
          const callbacks = [...pending.values()]; pending.clear()
          for (const callback of callbacks) callback(clock)
          samples.push({ time: clock, offset: offset() })
        }
        const peak = samples.reduce((best, sample) => sample.offset > best.offset ? sample : best, samples[0])
        return { immediate, at16: samples.find(sample => sample.time === 16).offset, at50: samples.find(sample => sample.time === 50).offset, at100: samples.find(sample => sample.time === 100).offset, peak, final: samples.at(-1).offset }
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (timeDescriptor) Object.defineProperty(performance, 'now', timeDescriptor)
        else delete performance.now
      }
    })
    console.log('WHEEL_RETURN_RESPONSE', JSON.stringify(evidence))
    near(evidence.immediate, 0, 'input changes the drive without directly jumping visible presentation', .001)
    assert(evidence.at16 > 1, 'a new gesture produces visible first-frame response')
    assert(evidence.at50 > 5 && evidence.at100 > 10, 'smoothing retains timely response to a short pull')
    assert(evidence.peak.time <= 200, 'a short pull does not wait for a long low-pass delay to peak')
  })
  for (const count of (process.env.SPMUSIC_WHEEL_RETURN_DENSE ? [120, 1797] : [120])) {
    await check(`wheel return trusted ${count}: real browser frames distinguish event kicks from missed frame budgets`, async ({ page }) => {
      const base = await geometry(page), point = { x: base.panel.x + 8, y: 300 }
      await page.mouse.move(point.x, point.y)
      const cdp = await page.context().newCDPSession(page)
      await page.evaluate(() => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero'), card = document.querySelector('.playlist-card')
        const trace = window.returnTrace = { frames: [], events: [], running: true }
        panel.addEventListener('wheel', event => trace.events.push({ time: performance.now(), delta: event.deltaY, trusted: event.isTrusted, prevented: event.defaultPrevented }))
        const sample = time => {
          if (!trace.running) return
          trace.frames.push({ time, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, hero: hero.getBoundingClientRect().height, card: card.getBoundingClientRect().y, top: panel.scrollTop })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      for (const delta of [192, 96, 24, 18, 12, 8, 5, 3.3, 2, 1, .6, .3]) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -delta })
        await page.waitForTimeout(64)
      }
      await page.waitForTimeout(850)
      const trace = await page.evaluate(() => { window.returnTrace.running = false; return window.returnTrace })
      const peak = Math.max(...trace.frames.map(frame => frame.offset)), peakIndex = trace.frames.findIndex(frame => frame.offset === peak)
      const frames = trace.frames.slice(peakIndex), steps = frames.slice(1).map((frame, i) => ({ dt: frame.time - frames[i].time, delta: frame.offset - frames[i].offset }))
      const kicks = steps.filter(step => step.delta > .1)
      const sorted = steps.map(step => step.dt).sort((a, b) => a - b)
      const velocity = steps.map(step => step.delta / step.dt)
      console.log('WHEEL_RETURN_TRUSTED', JSON.stringify({ count, events: trace.events.length, frames: frames.length, peak, end: frames.at(-1).offset, outwardKicks: kicks.length, maxOutwardKick: Math.max(0, ...kicks.map(step => step.delta)), maxVelocityJump: Math.max(0, ...velocity.slice(1).map((value, i) => Math.abs(value - velocity[i]))), frameP95Ms: sorted[Math.floor(sorted.length * .95)], frameMaxMs: Math.max(...sorted), over33ms: sorted.filter(dt => dt > 33.4).length }))
      assert.equal(trace.events.length, 12, 'all trusted tail samples reach the browser handler')
      assert(trace.events.every(event => event.trusted && event.prevented), 'this sample uses trusted wheel input at the real boundary')
      for (const frame of frames) {
        near(frame.hero - base.hero.height, frame.offset, 'trusted hero geometry matches the presentation scalar', .02)
        near(frame.card - base.firstCard.y, frame.offset * 1.1, 'trusted actual first card matches the presentation scalar', .03)
        near(frame.top, 0, 'return irregularity cannot be attributed to a native scroll conflict')
      }
      if (!process.env.SPMUSIC_WHEEL_RETURN_RECORD) assert.equal(kicks.length, 0, 'the sampled trusted declining tail has no visible outward kicks after its peak')
      await settled(page, base)
    }, { width: 1920, height: 1280, level: 2, count })
  }
  for (const startTop of [70, 120, 500]) {
    await check(`wheel native crossing from ${startTop}: native commits never displace an owned elastic edge`, async ({ page }) => {
      const base = await geometry(page)
      const cdp = await page.context().newCDPSession(page)
      const point = { x: base.panel.x + 8, y: 300 }
      await page.mouse.move(point.x, point.y)
      await page.evaluate(startTop => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
        panel.scrollTop = startTop
        const trace = window.crossingTrace = { frames: [], events: [], scrolls: [], writes: [], running: true }
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
        Object.defineProperty(panel, 'scrollTop', {
          configurable: true,
          get() { return descriptor.get.call(this) },
          set(value) { trace.writes.push({ time: performance.now(), beforeTop: descriptor.get.call(this), value }); descriptor.set.call(this, value) },
        })
        const sample = () => ({ time: performance.now(), top: panel.scrollTop, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, heroY: hero.getBoundingClientRect().y, heroHeight: hero.getBoundingClientRect().height })
        panel.addEventListener('wheel', event => { trace.before = { ...sample(), delta: event.deltaY, trusted: event.isTrusted } }, true)
        panel.addEventListener('wheel', event => trace.events.push({ before: trace.before, after: sample(), prevented: event.defaultPrevented }))
        panel.addEventListener('scroll', () => trace.scrolls.push(sample()))
        const frame = () => { if (!trace.running) return; trace.frames.push(sample()); requestAnimationFrame(frame) }
        requestAnimationFrame(frame)
      }, startTop)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const deltaY = startTop === 500 ? -80 : -24
      for (let i = 0; i < 18; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY })
      await page.waitForTimeout(250)
      const trace = await page.evaluate(() => { window.crossingTrace.running = false; return window.crossingTrace })
      const owned = [...trace.frames, ...trace.scrolls].filter(sample => sample.offset > .5)
      const conflicts = owned.filter(sample => sample.top > .75 || Math.abs(sample.heroY - base.hero.y) > .75)
      const jumps = trace.scrolls.slice(1).filter((sample, i) => sample.top > trace.scrolls[i].top + .75)
      console.log('WHEEL_NATIVE_CROSSING', JSON.stringify({ startTop, deltaY, eventCount: trace.events.length, nativeEvents: trace.events.filter(event => !event.prevented).length, customEvents: trace.events.filter(event => event.prevented).length, frames: trace.frames.length, ownedFrames: owned.length, conflictCount: conflicts.length, scrollReversals: jumps.length, jsScrollWrites: trace.writes.length, writes: trace.writes, conflicts: conflicts.slice(0, 8), events: trace.events, scrolls: trace.scrolls }))
      assert.equal(trace.events.length, 18, 'all trusted crossing events are observed')
      assert(trace.events.every(event => event.before.trusted), 'crossing uses trusted browser wheel input')
      assert(trace.events.some(event => !event.prevented), 'the gesture starts with ordinary native scrolling')
      assert(trace.events.some(event => event.prevented), 'continued input reaches custom boundary ownership')
      assert(owned.length > 1, 'captures elastic feedback after native travel')
      assert.equal(trace.writes.length, 0, 'wheel boundary takeover never writes scrollTop or cancels queued native motion')
      assert.equal(conflicts.length, 0, 'native commits cannot scroll an already stretched top edge away from its anchor')
      assert.equal(jumps.length, 0, 'same-direction upward wheel never receives a stale positive scrollTop commit')
      await settled(page, base)
      await page.mouse.wheel(0, 240)
      await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 100)
      near((await geometry(page)).offset, 0, 'reverse returns to ordinary native scrolling after boundary takeover')
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  await check('wheel native crossing late commit keeps native ownership and consumes only the committed remainder once', async ({ page }) => {
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const timeDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      const pending = new Map(), writes = []
      let top = 70, clock = 0, id = 0
      Object.defineProperty(panel, 'scrollTop', { configurable: true, get: () => top, set: value => { writes.push({ time: clock, before: top, value }); top = value } })
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      const frame = () => { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(clock) }
      const offset = () => Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')) || 0
      const trajectory = () => {
        const values = []
        for (clock = 0; clock <= 160; clock += 16) { frame(); values.push(offset()) }
        return values
      }
      try {
        const first = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
        panel.dispatchEvent(first)
        const beforeCommit = { top, offset: offset(), prevented: first.defaultPrevented, writes: writes.slice() }
        frame(); frame()
        const pendingBeforeCommit = pending.size
        // The browser owns the native travel; the commit occurs after the last
        // wheel and after bounded frame checks, with no further wheel sample.
        top = 0
        panel.dispatchEvent(new Event('scroll'))
        frame(); frame()
        const committed = offset()
        panel.dispatchEvent(new Event('scroll'))
        panel.dispatchEvent(new Event('scroll'))
        frame()
        const duplicate = offset()
        const committedTrajectory = trajectory()
        window.dispatchEvent(new Event('resize'))
        clock = 0
        top = 70
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
        top = 0
        // The next boundary event may beat the native scroll notification.
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true, cancelable: true }))
        frame(); frame()
        const nextEventBeforeScroll = offset()
        const combinedTrajectory = trajectory()
        const direct = raw => {
          window.dispatchEvent(new Event('resize'))
          clock = 0
          top = 0
          panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -raw, bubbles: true, cancelable: true }))
          return trajectory()
        }
        const direct30 = direct(30), direct50 = direct(50)
        const forwardWrites = writes.slice()
        const reverse = new WheelEvent('wheel', { deltaY: 1000, bubbles: true, cancelable: true })
        panel.dispatchEvent(reverse)
        const reversePrevented = reverse.defaultPrevented
        top = 70
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
        window.dispatchEvent(new Event('resize'))
        top = 0
        panel.dispatchEvent(new Event('scroll'))
        frame()
        const afterResize = offset()
        const terminated = []
        for (const reason of ['reverse', 'pointer', 'scrollbar', 'touch']) {
          window.dispatchEvent(new Event('resize'))
          top = 70
          panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
          if (reason === 'reverse') panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }))
          else if (reason === 'touch') {
            const touch = new Touch({ identifier: 99, target: panel, clientX: 340, clientY: 300 })
            panel.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }))
          } else {
            const bounds = panel.getBoundingClientRect()
            panel.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 77, isPrimary: true, button: 0, buttons: 1, clientX: reason === 'scrollbar' ? bounds.right - 1 : bounds.left + 8, clientY: 300, bubbles: true }))
          }
          top = 0
          panel.dispatchEvent(new Event('scroll'))
          frame(); frame()
          terminated.push({ reason, offset: offset() })
        }
        window.dispatchEvent(new Event('resize'))
        top = 70
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
        window.unmountFixture()
        top = 0
        panel.dispatchEvent(new Event('scroll'))
        frame(); frame()
        return { beforeCommit, pendingBeforeCommit, committed, duplicate, nextEventBeforeScroll, committedTrajectory, combinedTrajectory, direct30, direct50, reversePrevented, afterResize, terminated, afterUnmount: panel.style.getPropertyValue('--playlist-overscroll-offset'), pendingAfterUnmount: pending.size, writes: forwardWrites }
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (timeDescriptor) Object.defineProperty(performance, 'now', timeDescriptor)
        else delete performance.now
        delete panel.scrollTop
        descriptor.set.call(panel, 0)
      }
    })
    console.log('WHEEL_CONTROLLED_LATE_COMMIT', JSON.stringify(evidence))
    assert.equal(evidence.beforeCommit.prevented, false, 'crossing projection retains native ownership until the real boundary commits')
    assert.equal(evidence.beforeCommit.top, 70, 'predicted crossing cannot snap the native scroll position')
    assert.equal(evidence.beforeCommit.offset, 0, 'interior input cannot fabricate elastic feedback')
    assert.equal(evidence.writes.length, 0, 'wheel lifecycle never assigns scrollTop')
    assert.equal(evidence.pendingBeforeCommit, 0, 'pending native commit does not cause idle polling')
    near(evidence.committed, 0, 'native excess changes the drive without immediately jumping visible geometry', .001)
    for (let i = 0; i < evidence.direct30.length; i++) near(evidence.committedTrajectory[i], evidence.direct30[i], 'late native remainder and duplicate notifications equal one direct 30px input at every presentation frame', .001)
    for (let i = 0; i < evidence.direct50.length; i++) near(evidence.combinedTrajectory[i], evidence.direct50[i], 'next boundary input plus native remainder equals exactly one direct 50px input trajectory', .001)
    assert(Math.max(...evidence.committedTrajectory) > 2, 'the retained native remainder produces a visible response')
    assert.equal(evidence.afterResize, 0, 'resize cancels an outstanding native wheel ledger')
    assert(evidence.terminated.every(item => item.offset === 0), 'reverse, pointer, scrollbar and touch ownership cancel stale wheel remainder')
    assert.equal(evidence.afterUnmount, '', 'unmount removes pending native wheel presentation')
    assert.equal(evidence.pendingAfterUnmount, 0, 'unmount leaves no native wheel polling or presentation callback')
  }, { width: 1920, height: 1280, level: 2, count: 120 })
  // DOM WheelEvents control event cadence independently of CDP acknowledgments.
  // They model a possible inertial tail, not physical finger-up detection.
  await check('wheel tail decaying nonzero input allows return before the last event, acceleration restarts and reverse restores native scrolling', async ({ page }) => {
    const base = await geometry(page)
    await backgroundPoint(page)
    const evidence = await page.evaluate(async baseHeight => {
      const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
      const events = [], samples = []
      const gain = () => hero.getBoundingClientRect().height - baseHeight
      const send = delta => {
        const event = new WheelEvent('wheel', { deltaY: -delta, deltaMode: 0, bubbles: true, cancelable: true })
        panel.dispatchEvent(event)
        events.push({ time: performance.now(), delta, canceled: event.defaultPrevented, trusted: event.isTrusted })
      }
      const wait = () => new Promise(resolve => setTimeout(resolve, 16))
      // A strong final pulse leaves a clear baseline even when the browser
      // delays the first measurement while recovery is already running.
      for (const delta of [4, 8, 16, 32, 192]) { send(delta); await wait() }
      await new Promise(resolve => requestAnimationFrame(resolve))
      const initialGain = gain(), tailStart = performance.now()
      for (let i = 0; i < 90; i++) {
        send(Math.max(.02, 48 * .78 ** (i + 1)))
        await wait()
        samples.push({ time: performance.now() - tailStart, gain: gain() })
      }
      const endGain = gain()
      const accelerationStartGain = endGain
      for (const delta of [1, 2, 4, 8, 16, 32]) { send(delta); await wait() }
      await new Promise(resolve => requestAnimationFrame(resolve))
      return { initialGain, endGain, accelerationStartGain, acceleratedGain: gain(), elapsed: performance.now() - tailStart, events, samples }
    }, base.hero.height)
    const gaps = evidence.events.slice(1).map((event, i) => event.time - evidence.events[i].time)
    const lastTailSamples = evidence.samples.filter(sample => sample.time >= 900)
    console.log('WHEEL_TAIL_RETURN', JSON.stringify({ initialGain: evidence.initialGain, endGain: evidence.endGain, acceleratedGain: evidence.acceleratedGain, tailSampleCount: evidence.samples.length, maxEventGapMs: Math.max(...gaps), firstNearZeroMs: evidence.samples.find(sample => sample.gain < .1)?.time ?? null, samples: evidence.samples.filter((_sample, i) => i % 10 === 0) }))
    assert(Math.max(...gaps) < 120, 'controlled tail has no gap capable of firing the old idle timer')
    assert(evidence.events.every(event => !event.trusted && event.canceled), 'controlled input is explicitly synthetic and reaches the boundary handler')
    const initialResponsePeak = Math.max(evidence.initialGain, ...evidence.samples.filter(sample => sample.time <= 200).map(sample => sample.gain))
    assert(initialResponsePeak > 20, 'initial strong input establishes visible stretch within the verified short-pull response window')
    assert(evidence.endGain < 1, 'continued nonzero decaying tail cannot indefinitely defer return')
    assert(lastTailSamples.every(sample => sample.gain < evidence.initialGain * .25), 'late tail does not repeatedly recreate the original stretch')
    assert(evidence.acceleratedGain > evidence.accelerationStartGain + 4, 'renewed acceleration can restart visible pulling')
    await page.mouse.wheel(0, 1000)
    await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 100)
    near((await geometry(page)).offset, 0, 'reverse ends tail handling and resumes native scroll')
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
    await settled(page, base)
  }, { width: 1920, height: 1280, level: 2, count: 120 })
  await check('wheel tail recovery follows elapsed time across frame rates and resize stops its driver', async ({ page }) => {
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const descriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      const pending = new Map()
      let clock = 0, id = 0
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      const offsets = []
      try {
        for (const endMs of [100, 333]) for (const frameMs of [13, 29]) {
          clock = 0
          window.dispatchEvent(new Event('resize'))
          panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true, cancelable: true }))
          const times = []
          for (let time = frameMs; time < endMs; time += frameMs) times.push(time)
          times.push(endMs)
          for (clock of times) {
            const callbacks = [...pending.values()]
            pending.clear()
            for (const callback of callbacks) callback(clock)
          }
          offsets.push(Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')))
          window.dispatchEvent(new Event('resize'))
          if (pending.size) throw new Error('resize left presentation callbacks pending')
        }
        return offsets
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (descriptor) Object.defineProperty(performance, 'now', descriptor)
        else delete performance.now
      }
    })
    console.log('WHEEL_TAIL_CADENCE', JSON.stringify({ at100: evidence.slice(0, 2), at333: evidence.slice(2) }))
    assert(evidence.slice(0, 2).every(offset => offset > 1), 'both cadences preserve substantial initial feedback')
    assert(evidence.slice(2).every((offset, i) => offset >= 0 && offset < evidence[i]), 'the later sample recovers without overshooting past zero')
    near(evidence[0], evidence[1], 'equal elapsed time produces equal recovery regardless of frame cadence', .001)
    near(evidence[2], evidence[3], 'crossing the quiet recovery boundary is independent of frame cadence', .001)
  })
  await check('wheel tail constant input resumes after a sub-fresh gap without requiring a larger packet', async ({ page }) => {
    const traces = await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero')
      const baseHeight = hero.getBoundingClientRect().height
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame
      const descriptor = Object.getOwnPropertyDescriptor(performance, 'now'), pending = new Map(), traces = []
      let clock = 0, id = 0
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id }
      window.cancelAnimationFrame = key => pending.delete(key)
      Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
      try {
        for (const gap of [16, 150]) {
          window.dispatchEvent(new Event('resize'))
          const times = Array.from({ length: 24 }, (_, i) => i * 16 + (i > 10 ? gap - 16 : 0))
          let event = 0, peak = 0
          const end = Math.ceil((times.at(-1) + 32) / 16) * 16
          for (clock = 0; clock <= end; clock += 2) {
            while (event < times.length && times[event] <= clock) {
              panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -8, bubbles: true, cancelable: true }))
              event++
            }
            if (clock % 16 === 0) {
              const callbacks = [...pending.values()]; pending.clear()
              for (const callback of callbacks) callback(clock)
              peak = Math.max(peak, hero.getBoundingClientRect().height - baseHeight)
            }
          }
          traces.push({ gap, events: event, peak, lastInputAt: times.at(-1), sampledAt: end, offset: Number.parseFloat(panel.style.getPropertyValue('--playlist-overscroll-offset')) || 0, gain: hero.getBoundingClientRect().height - baseHeight })
        }
        return traces
      } finally {
        window.dispatchEvent(new Event('resize'))
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        if (descriptor) Object.defineProperty(performance, 'now', descriptor)
        else delete performance.now
      }
    })
    console.log('WHEEL_TAIL_CONSTANT_GAP', JSON.stringify(traces))
    for (const trace of traces) {
      assert.equal(trace.events, 24, 'the same constant-strength input reaches both paths')
      near(trace.gain, trace.offset, 'resumed steady input is checked in actual visible hero geometry', .02)
      assert(trace.gain > 2, 'sustained constant input after a short gap retains visible feedback')
    }
  }, { width: 1920, height: 1280, level: 2, count: 120 })
  for (const delta of [.2, 1]) {
    await check(`wheel tail slow steady ${delta}px remains active without an absolute small-delta cutoff`, async ({ page }) => {
      const base = await geometry(page)
      await backgroundPoint(page)
      const evidence = await page.evaluate(async ({ delta, baseHeight }) => {
        const panel = document.querySelector('.playlist-panel'), hero = document.querySelector('.playlist-hero'), samples = []
        for (let i = 0; i < 80; i++) {
          panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, bubbles: true, cancelable: true }))
          await new Promise(resolve => setTimeout(resolve, 16))
          samples.push({ time: performance.now(), gain: hero.getBoundingClientRect().height - baseHeight })
        }
        return { samples, finalGain: samples.at(-1).gain }
      }, { delta, baseHeight: base.hero.height })
      const expected = .035 * base.hero.height * Math.log1p(80 * delta / (.024 * base.hero.height))
      const inward = evidence.samples.slice(1).filter((sample, i) => sample.gain < evidence.samples[i].gain - .1).length
      const elapsed = evidence.samples.at(-1).time - evidence.samples[0].time
      console.log('WHEEL_TAIL_SLOW_ACTIVE', JSON.stringify({ delta, expected, gain: evidence.finalGain, inward, elapsed }))
      assert(elapsed > 1000, 'active slow input outlasts the reported delayed-return window')
      assert(evidence.finalGain > .1, 'even fractional slow active delta maintains measurable positive feedback')
      assert(evidence.finalGain <= expected + .2, 'continuous recovery cannot amplify beyond the old accumulated-input response')
      const held = await geometry(page)
      near(held.hero.y, base.hero.y, 'slow fractional feedback remains anchored')
      fixed(base, held)
      proportionalImage(held)
      await settled(page, base)
      // Trusted browser input confirms the nearby native path. Synthetic wheel
      // dispatch alone cannot cause a browser default scrolling action.
      await page.mouse.wheel(0, 200)
      await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 100)
      const top = (await geometry(page)).scrollTop
      await page.mouse.wheel(0, 200)
      await page.waitForFunction(top => document.querySelector('.playlist-panel').scrollTop > top + 100, top)
      near((await geometry(page)).offset, 0, 'ordinary trusted native scrolling remains free of stretch')
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  for (const withDurationUpdate of [false, true]) {
    await check(`wheel stream ${withDurationUpdate ? 'duration update' : 'stable duration'}: continuous input, idle interruption, reverse and cleanup`, async ({ page }) => {
      const base = await geometry(page)
      const point = await backgroundPoint(page)
      const cdp = await page.context().newCDPSession(page)
      const wheelInput = deltaY => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY })
      await cdp.send('Performance.enable')
      const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
      await page.evaluate(() => {
        const panel = document.querySelector('.playlist-panel')
        window.wheelTrace = { frames: [], events: [], created: 0, canceled: 0, running: true, lastCreated: 0 }
        const trace = window.wheelTrace, animate = Element.prototype.animate, cancel = Animation.prototype.cancel
        Element.prototype.animate = function (...args) {
          if (this === panel || panel.contains(this)) trace.created++
          return animate.apply(this, args)
        }
        Animation.prototype.cancel = function (...args) { trace.canceled++; return cancel.apply(this, args) }
        const sample = time => {
          if (!trace.running) return
          trace.frames.push({ time, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0, phase: trace.phase })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        const startEvent = () => { trace.eventCreatedStart = trace.created }
        const endEvent = event => {
          trace.events.push({ time: performance.now(), delta: event.deltaY, trusted: event.isTrusted, prevented: event.defaultPrevented, phase: trace.phase, created: trace.created - trace.lastCreated, createdDuringEvent: trace.created - trace.eventCreatedStart })
          trace.lastCreated = trace.created
        }
        panel.addEventListener('wheel', startEvent, true)
        panel.addEventListener('wheel', endEvent)
        trace.cleanup = () => { panel.removeEventListener('wheel', startEvent, true); panel.removeEventListener('wheel', endEvent) }
        trace.phase = 'continuous'
      })
      const beforeMetrics = await metrics()
      const listeners = await page.evaluate(() => {
        window.originalWheelListeners = window.panelListeners.filter(item => item.active && item.type === 'wheel')
        return window.originalWheelListeners.length
      })
      for (let i = 0; i < 24; i++) {
        await wheelInput(-8)
        if (withDurationUpdate && i === 10) {
          const oldLabel = await page.locator('.playlist-hero-total').textContent()
          await page.evaluate(() => window.updateFixtureDuration(323460))
          await page.waitForFunction(oldLabel => document.querySelector('.playlist-hero-total').textContent !== oldLabel, oldLabel)
        }
        await page.waitForTimeout(8)
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const held = await geometry(page)
      const continuous = await page.evaluate(() => ({ created: window.wheelTrace.created, frames: window.wheelTrace.frames.filter(frame => frame.phase === 'continuous'), events: window.wheelTrace.events.slice(), wheelListeners: window.panelListeners.filter(item => item.active && item.type === 'wheel').length }))
      const eventGaps = continuous.events.slice(1).map((event, i) => event.time - continuous.events[i].time)
      const inward = continuous.frames.slice(1).filter((frame, i) => frame.offset < continuous.frames[i].offset - .1).length
      const createdDuringInput = continuous.events.reduce((sum, event) => sum + event.createdDuringEvent, 0)
      console.log('WHEEL_STREAM_CONTINUOUS', JSON.stringify({ withDurationUpdate, created: continuous.created, createdDuringInput, inwardFrames: inward, peak: held.offset, maxEventGapMs: Math.max(...eventGaps), eventCount: continuous.events.length, wheelListeners: continuous.wheelListeners }))
      assert.equal(continuous.events.reduce((sum, event) => sum + event.delta, 0), -192, 'all browser wheel input reached the panel, including compositor coalescing')
      assert(continuous.events.every(event => event.trusted && event.prevented), 'trusted boundary input is owned')
      assert.equal(continuous.wheelListeners, listeners, 'duration text commit does not rebuild gesture listeners')
      assert(await page.evaluate(() => window.originalWheelListeners.every(item => item.active)), 'the same listener identities survive duration commits')
      if (!process.env.SPMUSIC_WHEEL_STREAM_BASELINE) {
        assert.equal(createdDuringInput, 0, 'continuous wheel never restarts outward WAAPI easing')
        // Wheel recovery now runs continuously. Inward movement between input
        // events is expected; the earlier per-event WAAPI restart stays banned.
        if (!withDurationUpdate) stretched(base, held)
        else {
          // A new clock label legitimately changes the metadata row width.
          near(held.hero.y, base.hero.y, 'duration update preserves anchored hero top')
          assert(held.hero.height > base.hero.height + 2 && held.firstCard.y > base.firstCard.y + 2, 'duration update preserves visible stretch')
          fixed(base, held)
          proportionalImage(held)
        }
      }
      await page.evaluate(() => { window.wheelTrace.phase = 'gapped' })
      for (let i = 0; i < 4; i++) { await page.waitForTimeout(160); await wheelInput(-8) }
      const gapped = await page.evaluate(() => ({ events: window.wheelTrace.events.filter(event => event.phase === 'gapped'), created: window.wheelTrace.created, canceled: window.wheelTrace.canceled }))
      console.log('WHEEL_STREAM_GAPPED', JSON.stringify(gapped))
      if (!process.env.SPMUSIC_WHEEL_STREAM_BASELINE) {
        assert(gapped.events.every(event => event.createdDuringEvent === 0), 'gapped wheel interrupts rebound without restarting outward WAAPI')
      }
      await page.mouse.wheel(0, 1000)
      await page.waitForFunction(() => document.querySelector('.playlist-panel').scrollTop > 10)
      near((await geometry(page)).offset, 0, 'reverse consumes stretch then resumes native scroll')
      await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0; window.wheelTrace.phase = 'final' })
      await page.mouse.wheel(0, -40)
      await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.playlist-panel')).getPropertyValue('--playlist-overscroll-offset')) > .1)
      await settled(page, base)
      const afterMetrics = await metrics()
      console.log('WHEEL_STREAM_TIMING', JSON.stringify({ withDurationUpdate, metrics: Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key => [key, (afterMetrics[key] - beforeMetrics[key]) * (key.endsWith('Duration') ? 1000 : 1)])) }))
      await page.mouse.wheel(0, -40)
      await page.evaluate(() => { window.wheelTrace.running = false; window.wheelTrace.cleanup(); window.oldPanel = document.querySelector('.playlist-panel'); window.unmountFixture() })
      await page.waitForTimeout(300)
      assert.equal(await page.evaluate(() => window.oldPanel.getAnimations({ subtree: true }).length), 0, 'wheel unmount cancels pending presentation')
      assert.equal(await page.evaluate(() => window.oldPanel.style.getPropertyValue('--playlist-overscroll-offset')), '', 'wheel recovery cannot write presentation after unmount')
      assert.equal(await page.evaluate(() => window.panelListeners.filter(item => item.active && item.target === window.oldPanel).length), 0, 'wheel unmount removes input listeners')
    }, { width: 1920, height: 1280, level: 2, count: 120 })
  }
  // DOM TouchEvents + a later scrollTop commit control browser scheduling only.
  // This reconstructs the missed-commit race independently of CDP's compositor
  // timing; it is not evidence that physical WebView2 emits the same sequence.
  await check('late native scroll controlled commit with no later move consumes only actual excess once', async ({ page }) => {
    const base = await geometry(page)
    await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      panel.scrollTop = 70
      window.sequence = []
      window.nativeCheckFrames = 0
      const request = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = callback => {
        if (new Error().stack.includes('checkNativeBoundary')) window.nativeCheckFrames++
        return request(callback)
      }
      window.sequenceTouch = (type, points = [], cancelable = false) => {
        const touches = points.map(([identifier, clientY]) => new Touch({ identifier, target: panel, clientX: 1040, clientY }))
        const event = new TouchEvent(type, { bubbles: true, cancelable, touches, targetTouches: touches, changedTouches: touches })
        panel.dispatchEvent(event)
        window.sequence.push({ type, top: panel.scrollTop, prevented: event.defaultPrevented, time: performance.now() })
      }
      panel.addEventListener('scroll', () => window.sequence.push({ type: 'scroll', top: panel.scrollTop, time: performance.now() }))
      window.sequenceTouch('touchstart', [[9, 850]], true)
      window.sequenceTouch('touchmove', [[9, 1040]])
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForTimeout(80) // Commit after bounded pending rAF checks have stopped.
    const pendingChecks = await page.evaluate(() => window.nativeCheckFrames)
    if (!process.env.SPMUSIC_TOUCH_SEQUENCE_BASELINE) assert(pendingChecks > 0 && pendingChecks <= 2, `uncommitted outward input performs bounded native checks: ${pendingChecks}`)
    await page.waitForTimeout(80)
    assert.equal(await page.evaluate(() => window.nativeCheckFrames), pendingChecks, 'no idle native polling while waiting for scroll commit')
    near((await geometry(page)).offset, 0, 'no fabricated pull before native boundary commits')
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const held = await geometry(page), events = await page.evaluate(() => window.sequence)
    console.log('CONTROLLED_LATE_COMMIT', JSON.stringify({ heightGain: held.hero.height - base.hero.height, pendingChecks, events }))
    assert(events.some(e => e.type === 'touchmove' && e.top === 70 && !e.prevented), 'final move precedes native commit and retains native ownership')
    stretched(base, held)
    const expected = .035 * base.hero.height * Math.log1p(120 / (.024 * base.hero.height))
    near(held.hero.height - base.hero.height, expected, 'only physical input remaining after 70px native scroll is stretched', .15)
    await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      panel.dispatchEvent(new Event('scroll'))
      panel.dispatchEvent(new Event('scroll'))
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    near((await geometry(page)).offset, held.offset, 'duplicate scroll/frame notifications do not consume twice', .15)
    await page.evaluate(() => window.sequenceTouch('touchend'))
    await settled(page, base)
  }, { width: 1920, height: 1280, level: 2 })
  await check('late native scroll after end cancel pinch resize or unmount cannot invent a pull', async ({ page }) => {
    const base = await geometry(page)
    for (const termination of ['touchend', 'touchcancel', 'pinch', 'resize', 'reverse']) {
      await page.evaluate(termination => {
        const panel = document.querySelector('.playlist-panel')
        panel.scrollTop = 70
        const send = (type, points) => {
          const touches = points.map(([identifier, clientY]) => new Touch({ identifier, target: panel, clientX: 1040, clientY }))
          panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches }))
        }
        send('touchstart', [[9, 850]])
        send('touchmove', [[9, 1040]])
        if (termination === 'pinch') { send('touchstart', [[9, 1040], [10, 1100]]); send('touchend', []) }
        else if (termination === 'resize') { window.dispatchEvent(new Event('resize')); send('touchend', []) }
        else if (termination === 'reverse') send('touchmove', [[9, 1000]])
        else send(termination, [])
        panel.scrollTop = 0
        panel.dispatchEvent(new Event('scroll'))
      }, termination)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      near((await geometry(page)).offset, 0, `${termination} discards late native input`)
      near((await geometry(page)).hero.height, base.hero.height, `${termination} does not stretch from inertia`)
      if (termination === 'reverse') await page.evaluate(() => document.querySelector('.playlist-panel').dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [] })))
    }
    await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      panel.scrollTop = 70
      const send = (type, y) => { const t = new Touch({ identifier: 9, target: panel, clientX: 1040, clientY: y }); panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: [t], changedTouches: [t] })) }
      send('touchstart', 850); send('touchmove', 1040)
      window.unmountFixture()
      panel.scrollTop = 0
      panel.dispatchEvent(new Event('scroll'))
      window.detachedPanel = panel
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => window.detachedPanel.style.getPropertyValue('--playlist-overscroll-offset')), '', 'unmount cancels pending presentation and removes diagnostic property')
    assert.equal(await page.evaluate(() => window.panelListeners.filter(item => item.active && item.type === 'scroll').length), 0, 'native bridge scroll listener removed')
  }, { width: 1920, height: 1280, level: 2 })
  await check('late native scroll bottom commit uses remaining input and settled interior never fakes feedback', async ({ page }) => {
    await page.evaluate(() => {
      const panel = document.querySelector('.playlist-panel')
      panel.scrollTop = panel.scrollHeight
      window.boundarySend = (type, y) => {
        const touches = y === undefined ? [] : [new Touch({ identifier: 4, target: panel, clientX: 1040, clientY: y })]
        panel.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: touches }))
      }
    })
    const bottom = await geometry(page)
    await page.evaluate(() => { const panel = document.querySelector('.playlist-panel'); panel.scrollTop -= 70; window.boundarySend('touchstart', 850); window.boundarySend('touchmove', 660) })
    await page.waitForTimeout(80)
    near((await geometry(page)).offset, 0, 'bottom has no feedback before actual commit')
    await page.evaluate(() => { const panel = document.querySelector('.playlist-panel'); panel.scrollTop = panel.scrollHeight })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const held = await geometry(page)
    const expected = -.035 * bottom.hero.height * Math.log1p(120 / (.024 * bottom.hero.height))
    near(held.offset, expected, 'bottom consumes only190-70 physical excess', .15)
    near(held.lastCard.y - bottom.lastCard.y, expected, 'actual final song moves with bottom feedback', .15)
    near(held.hero.height, bottom.hero.height, 'bottom feedback does not grow header')
    fixed(bottom, held)
    await page.evaluate(() => window.boundarySend('touchend'))
    await settled(page, bottom)
    await page.evaluate(() => { const panel = document.querySelector('.playlist-panel'); panel.scrollTop = 300; window.boundarySend('touchstart', 850); window.boundarySend('touchmove', 875); panel.scrollTop = 291 })
    await page.waitForTimeout(80)
    await page.evaluate(() => { const panel = document.querySelector('.playlist-panel'); panel.scrollTop = 0; panel.dispatchEvent(new Event('scroll')) })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    near((await geometry(page)).offset, 0, 'settled native slop is discarded; unrelated scroll to edge does not fabricate pull')
    await page.evaluate(() => window.boundarySend('touchend'))
  }, { width: 1920, height: 1280, level: 2 })
  await check('late native scroll commit after the final crossing touchmove still presents custom stretch', async ({ page }) => {
    const base = await geometry(page), input = await touchInput(page)
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 70; window.touchEvidence = [] })
    const start = [[0, base.panel.x + base.panel.width * .45, 850]]
    await input.dispatch('touchStart', start)
    await input.dispatch('touchMove', [[0, start[0][1], 875]])
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    await input.dispatch('touchMove', [[0, start[0][1], 1040]])
    // No later touchmove exists to rescue a handler that reads a stale positive
    // scrollTop before the compositor commits this final native scroll step.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const held = await geometry(page), events = await page.evaluate(() => window.touchEvidence)
    console.log('FINAL_CROSSING_TOUCH_SEQUENCE', JSON.stringify({ held, events }))
    near(held.scrollTop, 0, 'real native gesture reached top')
    assert(events.some(event => event.type === 'touchmove' && !event.cancelable), 'crossing occurs in the native-owned touch path')
    stretched(base, held)
    await input.dispatch('touchEnd')
    await settled(page, base)
  }, { width: 1920, height: 1280, level: 2 })
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
    const duration = await page.evaluate(() => {
      const token = getComputedStyle(document.querySelector('.playlist-panel')).getPropertyValue('--app-motion-standard').trim()
      return Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    })
    const atQuarter = duration * .25, atSixtyPercent = duration * .6
    const closestQuarter = frames.reduce((best, frame) => Math.abs(frame.elapsed - atQuarter) < Math.abs(best.elapsed - atQuarter) ? frame : best)
    const closestSixty = frames.reduce((best, frame) => Math.abs(frame.elapsed - atSixtyPercent) < Math.abs(best.elapsed - atSixtyPercent) ? frame : best)
    const remainingQuarter = closestQuarter.gain / gain, remainingSixty = closestSixty.gain / gain
    assert(Math.abs(closestQuarter.elapsed - atQuarter) < 25 && remainingQuarter >= .3 && remainingQuarter <= .55, 'at one quarter of the faster release the same reference curve retains roughly forty percent travel')
    assert(Math.abs(closestSixty.elapsed - atSixtyPercent) < 25 && remainingSixty >= .08 && remainingSixty <= .22, 'at sixty percent of the faster release the same fine tail retains roughly thirteen percent travel')
    assert(frames.every((frame, i) => frame.gain >= -0.5 && (!i || frame.gain <= frames[i - 1].gain + 0.75)), 'release is monotone without negative overshoot or oscillation')
    const completion = frames.find(frame => Math.abs(frame.gain) < 0.5)
    assert(completion && completion.elapsed <= duration * 1.25, 'reference release completes within the approved faster theme-relative window')
    console.log('REFERENCE_DAMPING_AND_RELEASE', JSON.stringify({ samples, slopes, gain, rowShifts: rowsHeld.map((row, i) => row - rowsBefore[i]), duration, remainingQuarter, remainingSixty, completionMs: completion.elapsed }))
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
    await page.waitForFunction(height => document.querySelector('.playlist-hero').getBoundingClientRect().height - height > 2, before.hero.height, { timeout: 1500 })
    const peak = await geometry(page)
    assert(peak.hero.height - before.hero.height <= expectedPeak + 2, 'repeated wheel remains bounded by accumulated input while continuous recovery consumes earlier pull')
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
