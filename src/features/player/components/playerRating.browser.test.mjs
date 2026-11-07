// Real PlayerShell/PlayerSurface pointer path; only native transport is controlled.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const server = await createServer({ cacheDir: mkdtempSync(path.join(tmpdir(), 'spmusic-player-rating-vite-')), server: { host: '127.0.0.1', port: 5187, strictPort: true } })
const evidenceDir = path.join(tmpdir(), 'spmusic-player-rating-evidence')
mkdirSync(evidenceDir, { recursive: true })
let browser
const report = [], errors = []
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5187'
  const main = await (await fetch(origin + '/src/main.tsx')).text()
  const dependency = name => {
    const match = main.match(new RegExp('"(/[^"\\n]+/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
    assert(match, `resolve Vite dependency ${name}`)
    return match[1]
  }
  const shared = readFileSync(new URL('./streamAuthor.browser.test.mjs', import.meta.url), 'utf8')
  const literal = shared.match(/const fixture = (`[^]*?`)\r?\nconst html/)
  assert(literal, 'reuse native transport fixture, not another test suite')
  const fixture = runInNewContext(literal[1], { dependency })
    + "\nimport * as diagnostics from '/src/features/player/diagnostics/playerDragDiagnostics.ts';window.diag=diagnostics;"
  const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
    .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
    .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
  assert(service.includes('window.backendInvoke'))
  const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
  const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__real_stream_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
  const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__stream_player_fixture.js"')
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' })
  page.setDefaultTimeout(10000)
  await page.routeWebSocket(origin.replace('http:', 'ws:') + '/**', socket => socket.close())
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__real_stream_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__stream_player_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__stream_player_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
    localStorage.setItem('spmusic.streams.layout-level.v1', '4')
  })

  const active = category => page.locator(`.playlist-management-content[data-library-category="${category}"]:not([inert])`)
  const cover = () => page.locator('.track-card-plane[data-track-card-phase="active"] .cover-feedback').last()
  async function select(category, id) {
    await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
    await active(category).locator(`[data-playlist-track-id="${id}"]`).click()
    await page.waitForFunction(id => window.vm.playback.track?.id === id && !window.vm.playback.isSelectionPending, id)
  }
  async function openFull() {
    await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click()
    await cover().waitFor({state:'visible'})
  }

  async function setMode(mode) {
    await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click()
    await page.locator('#player-rating-mode').click()
    await page.getByRole('option',{name:mode==='stars'?'五星评分':'赞／踩',exact:true}).click()
    await page.keyboard.press('Escape')
    await page.waitForFunction(mode=>localStorage.getItem('spmusic.player.rating-mode.v1')===mode,mode)
  }

  const rating = scope => scope.locator('.star-rating').last()
  const root = () => rating(cover())
  async function expectRating(id,n) { await page.waitForFunction(({id,n})=>(window.vm.feedback.ratingsByTrackId?.[id]??0)===n,{id,n}) }
  async function setRating(n) { await page.evaluate(n=>window.vm.feedback.onRatingChange(window.vm.playback.track.id,n),n);await expectRating('station',n) }
  async function waitCollapsed() { await page.waitForFunction(()=>{const n=[...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .star-rating')].at(-1);return n&&n.dataset.expanded!=='true'}) }
  async function sizeOf() { return root().evaluate(n=>n.getBoundingClientRect().toJSON()) }

  async function blurRating() { await page.locator('.track-card-plane[data-track-card-phase="active"] .title-pill').last().focus() }
  async function traceWidths(node, duration=330) {
    return node.evaluate((n,duration)=>new Promise(resolve=>{const rows=[],start=performance.now();function frame(t){rows.push({t:t-start,width:n.querySelector('.star-rating-track').getBoundingClientRect().width,expanded:n.dataset.expanded,pressed:n.dataset.pressed});if(t-start<duration)requestAnimationFrame(frame);else resolve(rows)}requestAnimationFrame(frame)}),duration)
  }
  async function pointerStart(scope=root()) {
    const first=scope.locator('[data-rating-score="1"]');const b=await first.boundingBox();assert(b&&b.width>0)
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down()
    return {x:b.x,y:b.y,pitch:b.width,centerY:b.y+b.height/2}
  }
  async function moveTo(g,n) {await page.mouse.move(g.x+g.pitch*(n===0?-.2:n-.5),g.centerY,{steps:4})}
  await page.goto(origin + '/__stream_player_test')
  await page.waitForFunction(() => window.vm?.playlist?.library)
  await select('streams', 'station');await openFull();await setMode('stars')
  await setRating(0);await blurRating()
  assert.equal(await root().getAttribute('data-rating-count'),'1')
  assert.equal(await root().locator('[data-rating-score="1"] .rating-star-outline').count(),1)
  await page.waitForTimeout(300)
  const before=await root().locator('.star-rating-track').boundingBox()
  const captureEvents=[]
  await root().evaluate(n=>{window.ratingCapture=[];for(const type of ['gotpointercapture','lostpointercapture'])n.addEventListener(type,e=>window.ratingCapture.push({type,id:e.pointerId}))})
  const g=await pointerStart()
  const openingPromise=traceWidths(root())
  await page.waitForTimeout(110)
  await page.screenshot({path:path.join(evidenceDir,'rating-opening-midframe.png')})
  const opening=await openingPromise
  assert(opening.some(row=>row.width>before.width+1)&&new Set(opening.map(row=>Math.round(row.width))).size>3,'non-reduced opening contains intermediate animated widths')
  assert.equal(await root().getAttribute('data-expanded'),'true')
  await moveTo(g,4);await expectRating('station',4)
  await moveTo(g,2);await expectRating('station',2)
  await moveTo(g,0);await expectRating('station',0)
  await moveTo(g,3);await expectRating('station',3)
  await page.mouse.up()
  const closing=await traceWidths(root())
  assert.equal(await root().getAttribute('data-rating-count'),'3')
  assert.equal(await root().locator('[data-rating-score="1"] svg').count(),1)
  const clip=await root().evaluate(n=>{
    const track=n.querySelector('.star-rating-track'),next=n.querySelector('[data-rating-score="4"] .rating-star-outline')
    return {right:track.getBoundingClientRect().right,nextLeft:next.getBoundingClientRect().left,overflow:getComputedStyle(track).overflow}
  })
  assert.equal(clip.overflow,'hidden')
  assert(clip.nextLeft>=clip.right-1,'collapsed three-star state clips the entire fourth-star glyph')
  assert(closing.some(row=>row.width>closing.at(-1).width+1),'release animates contraction')
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'station','rating drag does not switch cover track')
  captureEvents.push(...await page.evaluate(()=>window.ratingCapture))
  assert(captureEvents.some(e=>e.type==='gotpointercapture')&&captureEvents.some(e=>e.type==='lostpointercapture'))
  writeFileSync(path.join(evidenceDir,'gesture-motion.json'),JSON.stringify({opening,closing,captureEvents},null,2))
  report.push('real-pointer-expand-drag-zero-to-five-capture-and-contraction')
  // Hold deliberately crosses the documented timer, then observe after release for accidental click.
  for(const [original,expected] of [[3,5],[5,0]]) {
    await setRating(original);await blurRating();await pointerStart()
    await page.waitForTimeout(460);await expectRating('station',expected)
    await page.mouse.up();await page.waitForTimeout(300);await expectRating('station',expected)
    assert.equal(await root().getAttribute('data-pressed'),'false')
  }
  report.push('long-press-five-zero-once-with-no-following-click-write')
  await setRating(2);await blurRating();await pointerStart();await page.mouse.up()
  await expectRating('station',1)
  await page.waitForTimeout(460);await expectRating('station',1)
  // Cancel and lost capture must clear their long-press timers without a second commit.
  for(const kind of ['pointercancel','lostpointercapture']) {
    await setRating(3);await blurRating();await pointerStart()
    await root().evaluate((n,kind)=>{
      const id=window.ratingCapture.at(-1).id
      if(kind==='lostpointercapture')n.releasePointerCapture(id)
      else n.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:id,isPrimary:true}))
    },kind)
    await page.mouse.up();await page.waitForTimeout(460)
    await expectRating('station',1)
    assert.equal(await root().getAttribute('data-expanded'),'false')
  }
  report.push('cancel-and-lostcapture-stop-longpress-and-collapse')
  await root().locator('[data-rating-score="1"]').focus()
  assert.equal(await root().getAttribute('data-expanded'),'true')
  await page.keyboard.press('End');await expectRating('station',5)
  await page.keyboard.press('ArrowLeft');await expectRating('station',4)
  await page.keyboard.press('Home');await expectRating('station',0)
  await page.keyboard.press('ArrowRight');await expectRating('station',1)
  await page.keyboard.press('Delete');await expectRating('station',0)
  await blurRating();assert.equal(await root().getAttribute('data-expanded'),'false')
  report.push('keyboard-focus-expansion-arrows-home-end-delete')
  for(const n of [2,3,4]) {
    await setRating(n);await blurRating();assert.equal(await root().getAttribute('data-rating-count'),String(n))
    await setMode('thumbs')
    for(const name of ['喜欢','不喜欢'])assert.equal(await cover().getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'false')
    await setMode('stars');await expectRating('station',n)
  }
  report.push('integer-score-preserved-across-mode-switch')
  await setRating(3);await blurRating()
  await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button:visible').last().click()
  const menu=page.locator('.more-actions-menu:visible'),menuRating=rating(menu)
  await menu.locator('.more-track-title').click()
  assert.equal(await menuRating.getAttribute('data-rating-count'),'3')
  const summary=await menuRating.evaluate(n=>{const s=getComputedStyle(n);const probe=document.createElement('span');probe.style.color='var(--player-inverse-primary)';n.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {background:s.backgroundColor,shadow:s.boxShadow,padding:s.padding,color:s.color,expected}})
  assert.equal(summary.background,'rgba(0, 0, 0, 0)');assert.equal(summary.shadow,'none');assert.equal(summary.padding,'0px');assert.equal(summary.color,summary.expected)
  const mg=await pointerStart(menuRating);await page.waitForTimeout(280);await moveTo(mg,4);await page.mouse.up();await expectRating('station',4)
  await page.waitForTimeout(280);await page.screenshot({path:path.join(evidenceDir,'rating-more.png')})
  await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'})
  assert.equal(await root().getAttribute('data-rating-count'),'4')
  report.push('more-overlay-same-gesture-with-transparent-inverse-primary')
  await setRating(3);await blurRating();await pointerStart()
  await page.evaluate(()=>window.vm.playback.onNext())
  await page.waitForFunction(()=>window.vm.playback.track?.id!=='station'&&!window.vm.playback.isSelectionPending)
  const nextId=await page.evaluate(()=>window.vm.playback.track.id)
  await page.mouse.up();await page.waitForTimeout(460)
  assert.equal(await page.evaluate(id=>window.vm.feedback.ratingsByTrackId[id]??0,nextId),0,'old layer longpress cannot write new track')
  await page.evaluate(()=>window.vm.playback.onPrevious())
  await page.waitForFunction(()=>window.vm.playback.track?.id==='station'&&!window.vm.playback.isSelectionPending)
  await expectRating('station',1)
  report.push('track-key-cancels-outgoing-layer-timer')
  for(const size of [{width:1280,height:900},{width:640,height:1024},{width:420,height:900}]) {
    await page.setViewportSize(size);await setRating(5);await blurRating();await page.waitForTimeout(300)
    const r=await sizeOf(),art=await cover().locator('..').locator('..').boundingBox()
    const ratio=await root().evaluate(n=>parseFloat(getComputedStyle(n).width)/parseFloat(getComputedStyle(n.closest('.cover-art')).width))
    assert(art&&ratio<=1/3+.005,'expanded layout maximum remains one third of cover')
    await page.screenshot({path:path.join(evidenceDir,`rating-${size.width}.png`)})
    report.push({size,r,art})
  }
  await page.emulateMedia({reducedMotion:'reduce'});await setRating(0);await blurRating();await pointerStart()
  assert.equal(await root().evaluate(n=>getComputedStyle(n).transitionDuration),'0s')
  await page.mouse.up();await expectRating('station',1)
  report.push('reduced-motion-retains-pointer-behavior-without-animation')
  await page.emulateMedia({reducedMotion:'no-preference'})
  await setRating(0);await blurRating();await page.waitForTimeout(300)
  const touchBox=await root().locator('[data-rating-score="1"]').boundingBox()
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true})
  const point={x:touchBox.x+touchBox.width/2,y:touchBox.y+touchBox.height/2,id:9}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await page.waitForTimeout(280)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:touchBox.x+touchBox.width*3.5}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expectRating('station',4)
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'station')
  assert.equal(await root().getAttribute('data-pressed'),'false')
  report.push('trusted-touch-drag-keeps-cover-track-and-releases-capture')
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false})
  await page.evaluate(async ({react,client})=>{
    const React=(await import(react)).default, ReactDOM=(await import(client)).default
    const {StarRating}=await import('/src/features/player/components/StarRating.tsx')
    const {AppearanceProvider}=await import('/src/features/appearance/components/AppearanceProvider.tsx')
    const host=document.createElement('div');host.id='rating-lifecycle';host.style.cssText='position:fixed;top:10px;left:10px;z-index:9999;--prototype-unit:1px';document.body.append(host)
    window.lifecycleWrites=[]
    function Harness(){const [disabled,setDisabled]=React.useState(false),[mounted,setMounted]=React.useState(true),[value,setValue]=React.useState(3);window.lifecycle={setDisabled,setMounted,setValue};return mounted?React.createElement(StarRating,{value,disabled,onChange:n=>{window.lifecycleWrites.push(n);setValue(n)}}):null}
    ReactDOM.createRoot(host).render(React.createElement(AppearanceProvider,null,React.createElement(Harness)))
  },{react:dependency('react.js'),client:dependency('react-dom_client.js')})
  const isolated=page.locator('#rating-lifecycle .star-rating')
  await isolated.waitFor()
  for(const action of ['disabled','unmount']) {
    await page.evaluate(()=>{window.lifecycle.setDisabled(false);window.lifecycle.setMounted(true);window.lifecycle.setValue(3);window.lifecycleWrites=[]})
    await isolated.waitFor();await pointerStart(isolated)
    await page.evaluate(action=>{if(action==='disabled')window.lifecycle.setDisabled(true);else window.lifecycle.setMounted(false)},action)
    await page.mouse.up();await page.waitForTimeout(460)
    assert.deepEqual(await page.evaluate(()=>window.lifecycleWrites),[1],`${action} prevents pending longpress second write`)
    if(action==='disabled'){assert.equal(await isolated.getAttribute('data-expanded'),'false');assert.equal(await isolated.locator('button:disabled').count(),5)}
  }
  report.push('disabled-and-unmount-clear-captured-gesture-timer')
  assert.deepEqual(errors,[])
  writeFileSync(path.join(evidenceDir,'final.json'),JSON.stringify({report,errors},null,2))
  console.log(JSON.stringify({passed:true,report,evidenceDir},null,2))
} catch(error) {
  if(browser){const p=browser.contexts()[0]?.pages()[0];if(p)await p.screenshot({path:path.join(evidenceDir,'failure.png')})}
  throw error
} finally { if(browser)await browser.close();await server.close() }
