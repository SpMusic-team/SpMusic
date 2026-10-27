// Run with Vite and SPMUSIC_PLAYWRIGHT pointing to an existing Playwright package.
// Real PlaylistPanel / AllSongs parents own selection; only native IO is replaced.
// Browser clock advances the 400 ms gesture without wall-clock timing margins.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const dependency = name => {
  const match = (entry + realSurface).match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const shared = readFileSync(new URL('./allSongs.browser.test.mjs', import.meta.url), 'utf8')
const literal = shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal, 'reuse deterministic native fixture without running the other suite')
const shellFixture = runInNewContext(literal[1], { dependency })
  .replace("ReactDOM.createRoot(document.getElementById('root')).render(", "const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(")
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__long_press_surface.js';export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(Surface,props)}`
const cardFixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import ReactDOMCore from '${dependency('react-dom.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlaylistCard} from '/src/features/player/components/PlaylistCard.tsx';
import '/src/index.css';import '/src/features/player/styles/player.css';
window.entries=[];window.actions=[];
function Fixture(){
 const [options,setOptions]=React.useState({id:'first',songKey:'first-key',mode:false,selected:false,canActivate:true,unavailable:false,canSelectUnavailable:false,contentVisible:true,callback:true});
 window.setCardOptions=next=>ReactDOMCore.flushSync(()=>setOptions(previous=>({...previous,...next})));
 const enter=React.useCallback(id=>{window.entries.push(id);setOptions(previous=>({...previous,mode:true,selected:true}))},[]);
 return React.createElement('div',{className:'player-shell'},React.createElement('div',{className:'playlist-panel'},React.createElement('div',{className:'playlist-grid','data-layout-flow':'row','data-layout-level':4},React.createElement(PlaylistCard,{track:{id:options.id,title:'Gesture target',artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',hasLocalArtwork:false},songKey:options.songKey,current:false,unavailable:options.unavailable,canSelectUnavailable:options.canSelectUnavailable,canActivate:options.canActivate,selectMode:options.mode,selected:options.selected,artworkVisible:true,contentVisible:options.contentVisible,contentRepresentative:true,contentShape:15,showExtendedMetadata:true,coverFailed:false,onCoverFailed:()=>{},onEnterSelectMode:options.callback?enter:undefined,onActivate:id=>window.actions.push('play:'+id),onToggleSelect:id=>{window.actions.push('toggle:'+id);setOptions(previous=>({...previous,selected:!previous.selected}))}}))));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__long_press_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0

async function open(kind = 'playlist', sources = ['many']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' })
  page.setDefaultTimeout(5000)
  const errors = []
  const pendingRequests = new Set()
  page.on('request', request => pendingRequests.add(request.url()))
  page.on('requestfinished', request => pendingRequests.delete(request.url()))
  page.on('requestfailed', request => pendingRequests.delete(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '4')
    window.pressEvents = []
    for (const type of ['pointerdown', 'pointercancel', 'click']) document.addEventListener(type, event => {
      window.pressEvents.push({ type, trusted: event.isTrusted, pointerType: event.pointerType, pointerId: event.pointerId, isPrimary: event.isPrimary, detail: event.detail })
    }, true)
  })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__long_press_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__long_press_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: kind === 'card' ? cardFixture : shellFixture }))
  await page.route('**/__long_press_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  try {
    await page.goto(origin + '/__long_press_test')
  } catch (error) {
    console.error('LONG_PRESS_SETUP_DIAGNOSTIC', JSON.stringify({ kind, pendingRequests: [...pendingRequests],
      ready: await page.evaluate(() => ({ state: document.readyState, app: Boolean(document.querySelector('.playlist-card')), model: Boolean(window.viewModel) })).catch(() => null) }))
    throw error
  }
  if (kind !== 'card') {
    await page.waitForFunction(() => Boolean(window.viewModel))
    for (const choice of sources) {
      await page.evaluate(choice => { window.choice = choice; window.viewModel.playlist.library.onSelectFolders() }, choice)
      await page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
    }
    await page.evaluate(kind => {
      if (kind === 'songs') window.viewModel.playlist.library.onSelectCategory('songs')
      else window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope)
    }, kind)
  }
  const gridSelector = kind === 'songs' ? '.all-songs-list' : '.playlist-grid:not(.all-songs-list)'
  const grid = page.locator(gridSelector)
  await grid.locator('.playlist-card').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await grid.locator('.playlist-card').first().scrollIntoViewIfNeeded()
  await page.clock.install({ time: Date.now() })
  await page.clock.pauseAt(Date.now() + 1000)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) })
  const panelSelector = kind === 'songs' ? '.playlist-management-content' : '.playlist-panel'
  const card = index => grid.locator('.playlist-card').nth(index)
  return { page, errors, grid, card, touch, panelSelector }
}
async function at(card) {
  const box = await card.boundingBox()
  assert(box && box.width > 0 && box.height > 0)
  return { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2 }
}
async function down(context, index = 0, pointer = 'mouse') {
  const point = await at(context.card(index))
  if (pointer === 'touch') await context.touch('touchStart', [[0, point.x, point.y]])
  else { await context.page.mouse.move(point.x, point.y); await context.page.mouse.down() }
  return point
}
const release = context => context.page.mouse.up()
const advance = (context, ms) => context.page.clock.runFor(ms)
const playCalls = page => page.evaluate(() => (window.calls ?? []).filter(call => ['audio_load_and_play', 'audio_load_file'].includes(call.command)).length)
async function selected(context, index = 0, value = true) {
  assert.equal(await context.card(index).getAttribute('aria-pressed'), String(value))
}
async function notSelecting(context) { assert.equal(await context.grid.locator('.playlist-card[data-select-mode="true"]').count(), 0) }
async function check(name, kind, run, sources) {
  if (process.env.SPMUSIC_LONG_PRESS_FILTER && !name.includes(process.env.SPMUSIC_LONG_PRESS_FILTER)) return
  const context = await open(kind, sources)
  try { await run(context); assert.deepEqual(context.errors, [], 'no uncaught browser errors'); passed++; console.log('PASS', name) }
  finally { await context.page.close() }
}

try {
  for (const kind of ['playlist', 'songs']) {
    await check(kind + ': mouse 399/400ms, release click, next click and keyboard', kind, async context => {
      const { page, card } = context
      const loads = await playCalls(page)
      await down(context); await advance(context, 399); await notSelecting(context)
      await advance(context, 1); await selected(context)
      assert.equal(await context.grid.locator('[aria-pressed="true"]').count(), 1)
      await advance(context, 800); await selected(context)
      await release(context); await selected(context); assert.equal(await playCalls(page), loads)
      const point = await at(card(0)); await page.mouse.click(point.x, point.y); await selected(context, 0, false)
      await card(0).focus(); await page.keyboard.press('Enter'); await selected(context)
      await down(context); await advance(context, 700); await selected(context)
      await release(context); await selected(context, 0, false) // Existing select mode keeps its ordinary click toggle.
    })
    await check(kind + ': keyboard during fired hold does not spend pointer release token', kind, async context => {
      await down(context); await advance(context, 400); await selected(context)
      await context.card(0).focus(); await context.page.keyboard.press('Enter'); await selected(context, 0, false)
      await release(context); await selected(context, 0, false)
      const point = await at(context.card(0)); await context.page.mouse.click(point.x, point.y); await selected(context)
      assert.equal(await playCalls(context.page), 0)
    })
    await check(kind + ': trusted touch, scoped context menu and compatibility click', kind, async context => {
      await down(context, 0, 'touch')
      await advance(context, 400); await selected(context)
      assert.equal(await context.card(0).evaluate(node => !node.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch', button: 2 }))), true)
      await context.touch('touchEnd'); await selected(context)
      assert.equal(await playCalls(context.page), 0)
      assert(await context.page.evaluate(() => window.pressEvents.some(event => event.type === 'pointerdown' && event.trusted && event.pointerType === 'touch')))
      const tapPoint = await at(context.card(0)) // Entering selection inserts the parent's selection bar.
      await context.touch('touchStart', [[0, tapPoint.x, tapPoint.y]]); await context.touch('touchEnd'); await selected(context, 0, false)
      await context.card(0).evaluate(node => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 99, pointerType: 'mouse', button: 2, isPrimary: true })))
      assert.equal(await context.card(0).evaluate(node => !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))), false, 'ordinary right-click remains native')
    })
    await check(kind + ': short pointer and keyboard keep playback behavior', kind, async context => {
      const point = await down(context); await advance(context, 100); await release(context); await advance(context, 1)
      await notSelecting(context); assert.equal(await playCalls(context.page), 1)
      await context.card(1).focus(); await context.page.keyboard.press('Enter'); await advance(context, 1)
      await notSelecting(context); assert.equal(await playCalls(context.page), 2)
      assert(point.x > 0)
    })
  }
  await check('all songs: long press selects source-path key rather than track ID', 'songs', async context => {
    const target = context.grid.locator('[data-song-key="/audio/common/shared.flac"]')
    const point = await at(target); await context.page.mouse.move(point.x, point.y); await context.page.mouse.down(); await advance(context, 400)
    assert.equal(await target.getAttribute('aria-pressed'), 'true')
    assert.equal(await context.grid.locator('[aria-pressed="true"]').count(), 1)
    await release(context); assert.equal(await target.getAttribute('aria-pressed'), 'true'); assert.equal(await playCalls(context.page), 0)
  }, ['a', 'b'])
  await check('fired touch hold retains release token across a same-card second contact', 'playlist', async context => {
    const first = await down(context, 0, 'touch'); await advance(context, 400); await selected(context)
    const second = await at(context.card(0))
    const clicksBefore = await context.page.evaluate(() => window.pressEvents.filter(event => event.type === 'click' && event.detail > 0).length)
    await context.touch('touchStart', [[0, first.x, first.y], [1, second.x + 5, second.y]])
    assert(await context.page.evaluate(() => window.pressEvents.some(event => event.type === 'pointerdown' && event.pointerType === 'touch' && event.isPrimary === false)))
    await context.touch('touchEnd', [[0, first.x, first.y]])
    await context.touch('touchEnd')
    const clicksAfter = await context.page.evaluate(() => window.pressEvents.filter(event => event.type === 'click' && event.detail > 0).length)
    // Chromium may omit the compatibility click after multi-touch. Exercise
    // that public click path explicitly when no native click was generated.
    if (clicksAfter === clicksBefore) await context.card(0).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    await selected(context); assert.equal(await playCalls(context.page), 0)
  })
  await check('playlist: 6px boundary drag cancels without native scrolling', 'playlist', async context => {
    await context.page.locator(context.panelSelector).evaluate(panel => { panel.scrollTop = 0 })
    await advance(context, 16)
    const before = await context.page.locator(context.panelSelector).evaluate(panel => panel.scrollTop)
    const point = await down(context); await context.page.mouse.move(point.x, point.y + 6)
    assert.equal(await context.page.locator(context.panelSelector).getAttribute('data-dragging'), 'true')
    assert.equal(await context.page.locator(context.panelSelector).evaluate(panel => panel.scrollTop), before)
    await advance(context, 600); await notSelecting(context); await release(context); assert.equal(await playCalls(context.page), 0)
  })
  for (const kind of ['playlist', 'songs']) {
    await check(kind + ': native touch movement, second contact and cancel disarm hold', kind, async context => {
      let point = await down(context, 0, 'touch')
      await context.touch('touchMove', [[0, point.x + 11, point.y]]); await advance(context, 600); await notSelecting(context); await context.touch('touchCancel')
      point = await down(context, 0, 'touch')
      await context.touch('touchStart', [[0, point.x, point.y], [1, point.x + 50, point.y]])
      await advance(context, 600); await notSelecting(context); await context.touch('touchCancel')
      point = await down(context, 0, 'touch'); await context.touch('touchCancel'); await advance(context, 600); await notSelecting(context)
      assert.equal(await playCalls(context.page), 0)
    })
    await check(kind + ': real scroll cancels while pointer remains down', kind, async context => {
      await down(context)
      const before = await context.page.locator(context.panelSelector).evaluate(panel => panel.scrollTop)
      // CSSOM scroll updates synchronously, but the browser emits `scroll` on
      // its rendering clock. Observe that event before advancing JS timers.
      await context.page.locator(context.panelSelector).evaluate(panel => new Promise(resolve => {
        panel.addEventListener('scroll', () => resolve(), { once: true })
        panel.scrollTop += 30
      }))
      assert(await context.page.locator(context.panelSelector).evaluate((panel, before) => panel.scrollTop !== before, before))
      await advance(context, 600); await notSelecting(context); await release(context)
    })
  }
  const cancellations = {
    blur: () => window.dispatchEvent(new Event('blur')),
    visibility: () => document.dispatchEvent(new Event('visibilitychange')),
    dragstart: () => document.querySelector('.playlist-card').dispatchEvent(new Event('dragstart', { bubbles: true })),
    selectstart: () => document.querySelector('.playlist-card').dispatchEvent(new Event('selectstart', { bubbles: true })),
    mouseChordMove: () => {
      const card = document.querySelector('.playlist-card'), rect = card.getBoundingClientRect()
      const down = window.pressEvents.findLast(event => event.type === 'pointerdown')
      card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: down.pointerId,
        pointerType: 'mouse', isPrimary: true, buttons: 3, clientX: rect.x + 40, clientY: rect.y + rect.height / 2 }))
    },
    mouseContextMenu: () => {
      const prevented = !document.querySelector('.playlist-card').dispatchEvent(new PointerEvent('contextmenu', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 2, buttons: 3,
      }))
      if (prevented) throw Error('ordinary mouse context menu must keep its default behavior')
    },
    wheel: () => window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })),
    identity: () => window.setCardOptions({ songKey: 'other-key', id: 'other' }),
    hiddenContent: () => window.setCardOptions({ contentVisible: false }),
    disabled: () => window.setCardOptions({ canActivate: false }),
    missingCallback: () => window.setCardOptions({ callback: false }),
    externalSelectMode: () => window.setCardOptions({ mode: true }),
    unmount: () => window.unmountFixture(),
  }
  for (const [name, cancel] of Object.entries(cancellations)) {
    await check('active gesture cleanup: ' + name, 'card', async context => {
      await down(context); await advance(context, 200); await context.page.evaluate(cancel); await advance(context, 600)
      assert.deepEqual(await context.page.evaluate(() => window.entries), [], 'no stale callback after cancellation')
      await release(context)
      if (name === 'externalSelectMode') await selected(context, 0, true)
    })
  }
  await check('disabled and unavailable preserve original native-button semantics', 'card', async context => {
    for (const options of [{ canActivate: false }, { canActivate: true, unavailable: true, canSelectUnavailable: true }]) {
      await context.page.evaluate(options => window.setCardOptions(options), options)
      assert.equal(await context.card(0).isDisabled(), true)
      await down(context); await advance(context, 600); await release(context)
      assert.deepEqual(await context.page.evaluate(() => window.entries), [])
      assert.deepEqual(await context.page.evaluate(() => window.actions), [])
    }
    await context.page.evaluate(() => window.setCardOptions({ mode: true }))
    assert.equal(await context.card(0).isDisabled(), false, 'unavailable all-songs rows remain selectable in existing select mode')
    await context.card(0).focus(); await context.page.keyboard.press('Space'); await selected(context)
  })
  console.log('LONG_PRESS_REGRESSION_PASS', passed)
} finally { await browser.close() }
