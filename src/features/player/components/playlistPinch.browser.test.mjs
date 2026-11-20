// Optional browser regression. Start Vite, then set SPMUSIC_PLAYWRIGHT to an
// existing Playwright package and run: node src/features/player/components/playlistPinch.browser.test.mjs
// Uses Chromium touch and touchpad gesture input through CDP, without adding a
// project dependency. Browser coverage does not verify WebView2 host settings.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const nativeGestureSource = readFileSync(new URL('../../../../src-tauri/src/webview_gestures.rs', import.meta.url), 'utf8')
const nativePageZoomGuard = nativeGestureSource.match(/const PREVENT_PAGE_ZOOM: &str = r#"([\s\S]*?)"#;/)?.[1]
assert(nativePageZoomGuard, 'load the actual Windows page zoom guard')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const panelPath = '/src/features/player/components/PlaylistPanel.tsx'
const panelSource = await (await fetch(origin + panelPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = filename => {
  const match = (panelSource + '\n' + entry).match(new RegExp('"((?:/node_modules/\\.vite/deps/|/@fs/[^"\\n]+/deps/)' + filename.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${filename}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlaylistPanel } from '${panelPath}';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const noop = () => {};
const blob = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'], {type:'image/svg+xml'}));
const tracks = Array.from({length:120}, (_,i) => ({id:'track-'+i,title:'Test song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:true,coverThumbnail:{src:blob,width:128,height:128,encodedBytes:256}}));
window.actions = [];
const playback = {track:{...tracks[0],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
const timeline = {positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
const root = ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture = () => root.unmount();
root.render(React.createElement(AppearanceProvider,null,React.createElement(PlaylistPanel,{tracks,currentTrackId:'track-0',shuffleMode:'none',onShuffleCycle:noop,playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:()=>window.actions.push('play'),onTrackSelect:id=>window.actions.push(id),onClose:()=>window.actions.push('close')})));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__pinch_fixture.js"')
const browser = await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge'})
console.log('BROWSER', browser.version())
let passed = 0

async function open(level = 3, reducedMotion = 'no-preference') {
  const page = await browser.newPage({viewport:{width:1280,height:900},hasTouch:true,reducedMotion})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(nativePageZoomGuard)
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', String(level))
    window.touchEvidence = []
    window.wheelEvidence = []
    window.animationsStarted = 0
    window.cardAnimations = []
    window.panelListeners = []
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    const gestureTypes = new Set(['wheel','touchstart','touchmove','touchend','touchcancel'])
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this instanceof Element && this.matches('.playlist-panel') && gestureTypes.has(type)) window.panelListeners.push({target:this,type,listener,active:true})
      return add.call(this,type,listener,options)
    }
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      for (const entry of window.panelListeners) if (entry.target === this && entry.type === type && entry.listener === listener) entry.active = false
      return remove.call(this,type,listener,options)
    }
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args)
      if (this.matches('.playlist-card-cover,.playlist-card-copy')) {
        window.animationsStarted++
        window.cardAnimations.push(animation)
      }
      return animation
    }
    // Observe trusted events after panel handlers; this also proves that browser
    // page zoom was canceled rather than merely hidden by a layout assertion.
    for (const type of ['touchstart','touchmove','touchend','touchcancel']) {
      document.addEventListener(type, event => window.touchEvidence.push({type,trusted:event.isTrusted,canceled:event.defaultPrevented,touches:event.touches.length}), {passive:true})
    }
    document.addEventListener('wheel', event => window.wheelEvidence.push({trusted:event.isTrusted,ctrlKey:event.ctrlKey,cancelable:event.cancelable,canceled:event.defaultPrevented,deltaY:event.deltaY,inCollection:Boolean(event.target.closest('.playlist-grid'))}), {passive:true})
  }, level)
  await page.route('**/__pinch_fixture.js', route => route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__pinch_test', route => route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin + '/__pinch_test')
  await page.waitForSelector('.playlist-card')
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => {
    const panel = document.querySelector('.playlist-panel')
    panel.scrollTop = document.querySelector('.playlist-grid').offsetTop
    window.originalCards = [...document.querySelectorAll('.playlist-card')]
    window.retainedPanel = panel
  })
  await page.waitForFunction(() => document.querySelector('.playlist-grid').getBoundingClientRect().top < 200)
  const cdp = await page.context().newCDPSession(page)
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', {type,touchPoints:points.map(([id,x,y]) => ({id,x,y,radiusX:2,radiusY:2,force:1}))})
  }
  const points = (distance = 120, dx = 0, dy = 0) => [[0,640-distance/2+dx,320+dy],[1,640+distance/2+dx,320+dy]]
  const move = async (from, to, steps = 6) => {
    for (let step = 1; step <= steps; step++) {
      await touch('touchMove', from.map(([id,x,y],i) => [id,x+(to[i][1]-x)*step/steps,y+(to[i][2]-y)*step/steps]))
    }
  }
  const pinch = async direction => {
    const from = points()
    await touch('touchStart', from)
    await move(from, points(direction === 'out' ? 190 : 65))
    await touch('touchEnd', [])
  }
  return {page,errors,cdp,touch,points,move,pinch}
}
async function levelIs(page, level, message) {
  await page.waitForFunction(level => document.querySelector('.playlist-grid')?.dataset.layoutLevel === String(level), level, {timeout:1500})
  assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'), String(level), message)
}
async function unchanged(page, level) {
  // Covers the existing 150 ms step lock plus a browser rendering frame.
  await page.waitForTimeout(180)
  assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'), String(level))
}
async function check(name, run, level = 3, motion) {
  const context = await open(level, motion)
  try {
    await run(context)
    assert.deepEqual(context.errors, [], 'no uncaught browser errors')
    passed++
    console.log('PASS', name)
  } finally { await context.page.close() }
}

try {
  await check('trusted spread/contract reuse direction, animations, focus, nodes and persistence', async ({page,pinch}) => {
    await page.locator('.playlist-card').first().focus()
    await page.evaluate(() => { window.originalFocus = document.activeElement })
    await pinch('out')
    await levelIs(page, 2)
    assert(await page.evaluate(() => window.animationsStarted > 0), 'uses existing card transition animation')
    assert.equal(await page.evaluate(() => document.activeElement === window.originalFocus), true, 'keyboard focus retained')
    assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.playlist.layout-level.v1')), '2')
    assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'native page zoom suppressed')
    assert(await page.evaluate(() => window.touchEvidence.some(e => e.type === 'touchmove' && e.trusted && e.canceled)), 'real trusted touch path consumed')
    await page.waitForTimeout(180)
    await pinch('in')
    await levelIs(page, 3)
    assert.equal(await page.evaluate(() => window.originalCards.every((card,i) => card === document.querySelectorAll('.playlist-card')[i])), true)
    assert.deepEqual(await page.evaluate(() => window.actions), [], 'pinch never selects or plays a track')
  })
  await check('all ten layout levels and hard boundaries', async ({page,pinch}) => {
    for (let target = 1; target <= 9; target++) {
      await pinch('in'); await levelIs(page, target); await page.waitForTimeout(180)
    }
    await pinch('in'); await unchanged(page, 9)
    for (let target = 8; target >= 0; target--) {
      await pinch('out'); await levelIs(page, target); await page.waitForTimeout(180)
    }
    await pinch('out'); await unchanged(page, 0)
  }, 0)
  await check('ordinary wheel scroll remains native; Ctrl-wheel retains both directions', async ({page,cdp}) => {
    const before = await page.locator('.playlist-panel').evaluate(panel => panel.scrollTop)
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:130})
    await page.waitForFunction(before => document.querySelector('.playlist-panel').scrollTop > before, before)
    await unchanged(page, 3)
    await page.keyboard.down('Control')
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:-120,modifiers:2})
    await levelIs(page, 2)
    await page.waitForTimeout(180)
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:-120,modifiers:2})
    await levelIs(page, 1)
    await page.waitForTimeout(180)
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:120,modifiers:2})
    await levelIs(page, 2)
    await page.waitForTimeout(180)
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:120,modifiers:2})
    await levelIs(page, 3)
    await page.keyboard.up('Control')
    assert.equal(await page.evaluate(() => visualViewport.scale), 1)
  })
  await check('native Chromium touchpad pinch generates consumed wheel without physical Ctrl', async ({page,cdp}) => {
    // CDP calls the touchpad source "mouse" (its enum is default/touch/mouse).
    // This exercises Chromium's pinch conversion rather than injecting an
    // already-converted Ctrl+wheel event, which bypasses native recognition.
    const pinch = scaleFactor => cdp.send('Input.synthesizePinchGesture', {
      x:640,y:320,scaleFactor,relativeSpeed:400,gestureSourceType:'mouse',
    })
    await pinch(1.6)
    await levelIs(page,2)
    const evidence = await page.evaluate(() => window.wheelEvidence)
    assert(evidence.some(event => event.trusted && event.ctrlKey && event.cancelable && event.canceled && event.inCollection && event.deltaY < 0), 'native touchpad gesture reaches cancelable Ctrl+wheel path')
    assert.equal(await page.evaluate(() => visualViewport.scale),1,'native touchpad does not zoom page')
    await page.waitForTimeout(400)
    await pinch(0.6)
    await levelIs(page,3)
    assert.equal(await page.evaluate(() => visualViewport.scale),1)
    assert.deepEqual(await page.evaluate(() => window.actions),[],'native touchpad never selects or plays a track')
  })
  await check('host guard prevents page zoom outside collections without consuming ordinary wheel or single touch', async ({page,cdp}) => {
    await page.evaluate(() => {
      const outside = document.createElement('div')
      outside.id = 'outside-gesture-fixture'
      outside.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999'
      document.body.append(outside)
      window.hostGuardEvidence = []
      for (const type of ['wheel', 'touchmove']) window.addEventListener(type, event => window.hostGuardEvidence.push({type,ctrlKey:event.ctrlKey,touches:event.touches?.length,canceled:event.defaultPrevented}))
    })
    for (const gestureSourceType of ['mouse', 'touch']) {
      await cdp.send('Input.synthesizePinchGesture', {x:600,y:300,scaleFactor:1.7,relativeSpeed:400,gestureSourceType})
      assert.equal(await page.evaluate(() => visualViewport.scale),1,'outside pinch cannot zoom the page: ' + gestureSourceType)
      await levelIs(page,3)
    }
    const evidence = await page.evaluate(() => window.hostGuardEvidence)
    assert(evidence.some(event => event.type === 'wheel' && event.ctrlKey && event.canceled),'outside touchpad wheel reaches the host guard')
    assert(evidence.some(event => event.type === 'touchmove' && event.touches > 1 && event.canceled),'outside touchscreen pinch reaches the host guard')
    const ordinary = await page.locator('#outside-gesture-fixture').evaluate(element => {
      const wheel = new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:80})
      element.dispatchEvent(wheel)
      const touch = new Touch({identifier:1,target:element,clientX:100,clientY:100})
      const move = new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch]})
      element.dispatchEvent(move)
      return {wheelCanceled:wheel.defaultPrevented,singleTouchCanceled:move.defaultPrevented}
    })
    assert.deepEqual(ordinary,{wheelCanceled:false,singleTouchCanceled:false})
  })
  await check('converted trackpad wheel consumes one level across long burst and reversal; idle resets', async ({page,cdp}) => {
    const wheel = deltaY => cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY,modifiers:2})
    for (let i = 0; i < 4; i++) await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:640,y:320,deltaX:0,deltaY:-8,modifiers:2})
    await levelIs(page, 2)
    for (const delta of [-120,-120,120,120,-120]) {
      // Stay inside the 350 ms trackpad idle timeout while crossing the old
      // 150 ms level lock. A held gesture must not become a new session.
      await page.waitForTimeout(180)
      await wheel(delta)
      assert.equal(await page.locator('.playlist-grid').getAttribute('data-layout-level'),'2')
    }
    await page.waitForTimeout(400)
    await wheel(-120)
    await levelIs(page,1)
    assert.equal(await page.evaluate(() => visualViewport.scale), 1)
  })
  await check('single-finger pan still scrolls', async ({page,touch,move}) => {
    const before = await page.locator('.playlist-panel').evaluate(panel => panel.scrollTop)
    const from = [[0,640,600]], to = [[0,640,360]]
    await touch('touchStart', from); await move(from,to,10); await touch('touchEnd', [])
    await page.waitForFunction(before => document.querySelector('.playlist-panel').scrollTop > before, before)
    await unchanged(page, 3)
  })
  await check('two-finger translation and sub-threshold jitter never switch', async ({page,touch,points,move}) => {
    const from = points()
    await touch('touchStart',from); await move(from,points(120,40,-70)); await touch('touchEnd',[])
    await unchanged(page, 3)
    await touch('touchStart',from); await move(from,points(135)); await touch('touchEnd',[])
    await unchanged(page, 3)
  })
  await check('cancel resets gesture and next gesture succeeds', async ({page,touch,points,move,pinch}) => {
    await touch('touchStart',points()); await move(points(),points(130)); await touch('touchCancel',[])
    await unchanged(page, 3)
    await pinch('out'); await levelIs(page,2)
  })
  await check('third finger invalidates gesture until every finger is lifted', async ({page,touch,points,move,pinch}) => {
    await touch('touchStart',points())
    await touch('touchStart',[...points(),[2,800,320]])
    await touch('touchEnd',points())
    await move(points(),points(190)); await unchanged(page,3)
    await touch('touchEnd',[])
    await pinch('out'); await levelIs(page,2)
  })
  await check('after switching, replacing one finger cannot restart pinch; all fingers up resets', async ({page,touch,points,move,pinch}) => {
    await touch('touchStart',points())
    await move(points(),points(190)); await levelIs(page,2)
    await touch('touchEnd',[points(190)[0]])
    await touch('touchStart',points(190))
    await page.waitForTimeout(180)
    await move(points(190),points(300)); await unchanged(page,2)
    await touch('touchEnd',[])
    await pinch('out'); await levelIs(page,1)
  })
  await check('long spread and large initial-distance contract each switch only once, even reversed', async ({page,touch,points,move}) => {
    await touch('touchStart',points(60))
    await move(points(60),points(190)); await levelIs(page,2)
    await unchanged(page,2)
    await move(points(190),points(500),12); await unchanged(page,2)
    await move(points(500),points(40),12); await unchanged(page,2)
    await touch('touchEnd',[])
    await touch('touchStart',points(400))
    await move(points(400),points(250)); await levelIs(page,3)
    await unchanged(page,3)
    await move(points(250),points(40),12); await unchanged(page,3)
    await move(points(40),points(500),12); await unchanged(page,3)
    await touch('touchEnd',[])
  })
  await check('gesture beginning on an actual header button leaves layout alone', async ({page,touch,move}) => {
    await page.locator('.playlist-panel').evaluate(panel => { panel.scrollTop = 0 })
    const button = page.locator('.playlist-panel button').first()
    const box = await button.boundingBox()
    assert(box, 'header button has a hit-testable box')
    const x = box.x + box.width/2, y = box.y + box.height/2
    assert(await page.evaluate(({x,y}) => Boolean(document.elementFromPoint(x,y)?.closest('button')), {x,y}), 'touch starts on actual header control')
    const from = [[0,x-5,y],[1,x+5,y]], to = [[0,x-50,y],[1,x+50,y]]
    await touch('touchStart',from); await move(from,to); await touch('touchEnd',[])
    await unchanged(page,3)
  })
  await check('leaving panel invalidates pinch until all fingers lift', async ({page,touch,points,move,pinch}) => {
    await touch('touchStart',points())
    await touch('touchMove',[[0,-10,320],[1,700,320]])
    await touch('touchMove',points())
    await move(points(),points(190)); await unchanged(page,3)
    await touch('touchEnd',[])
    await pinch('out'); await levelIs(page,2)
  })
  await check('reduced-motion still switches with no card animation', async ({page,pinch}) => {
    await pinch('out'); await levelIs(page,2)
    assert.equal(await page.evaluate(() => window.animationsStarted),0)
  },3,'reduce')
  await check('unmount during active pinch removes handlers and animations', async ({page,touch,points,move}) => {
    await touch('touchStart',points()); await move(points(),points(190)); await levelIs(page,2)
    await page.evaluate(() => window.unmountFixture())
    await touch('touchCancel',[])
    const evidence = await page.evaluate(() => {
      const panel = window.retainedPanel
      const grid = panel.querySelector('.playlist-grid')
      const wheel = new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120})
      grid.dispatchEvent(wheel)
      const point = id => new Touch({identifier:id,target:grid,clientX:600+id*120,clientY:320})
      const start = new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[point(0),point(1)]})
      grid.dispatchEvent(start)
      return {wheelCanceled:wheel.defaultPrevented,touchCanceled:start.defaultPrevented,stored:localStorage.getItem('spmusic.playlist.layout-level.v1'),animations:window.cardAnimations.filter(a => a.playState === 'running' || a.pending).length,listeners:window.panelListeners.filter(entry => entry.active).length}
    })
    assert.deepEqual(evidence,{wheelCanceled:false,touchCanceled:false,stored:'2',animations:0,listeners:0})
  })
  console.log('PINCH_REGRESSION_PASS', passed)
} finally { await browser.close() }
