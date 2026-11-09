// Real PlayerShell/PlayerSurface pointer path; only native transport is controlled.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const server = await createServer({ cacheDir: mkdtempSync(path.join(tmpdir(), 'spmusic-player-rating-vite-')), server: { host: '127.0.0.1', port: 5189, strictPort: true } })
const evidenceDir = path.join(tmpdir(), 'spmusic-rating-hits-evidence')
mkdirSync(evidenceDir, { recursive: true })
let browser
const report = [], errors = []
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5189'
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
    return node.evaluate((n,duration)=>new Promise(resolve=>{const rows=[],start=performance.now();function frame(t){rows.push({t:t-start,width:n.getBoundingClientRect().width,expanded:n.dataset.expanded,pressed:n.dataset.pressed});if(t-start<duration)requestAnimationFrame(frame);else resolve(rows)}requestAnimationFrame(frame)}),duration)
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

  const findings=[]
  const state=()=>page.evaluate(()=>({score:window.vm.feedback.ratingsByTrackId.station??0,track:window.vm.playback.track?.id,playlistOpen:window.vm.playlist.isOpen,events:window.hitEvents}))
  async function prepare(){await page.reload();await page.waitForFunction(()=>window.vm?.playlist?.library);await select('streams','station');await openFull();await setMode('stars');await setRating(1);await blurRating();await page.waitForTimeout(400);await page.evaluate(()=>{window.hitEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','click'])document.addEventListener(type,e=>window.hitEvents.push({type,id:e.pointerId,target:e.target.className,score:window.vm.feedback.ratingsByTrackId.station,expanded:document.querySelector('.more-actions-menu .star-rating')?.dataset.expanded}),true)})}
  await prepare()
  let b=await root().locator('[data-rating-score="1"]').boundingBox()
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2)
  findings.push({scenario:'solid-one-tap-clears',expected:0,...await state()})
  await prepare()
  b=await root().locator('[data-rating-score="1"]').boundingBox()
  const blank={x:b.x+b.width*2.5,y:b.y+b.height/2}
  const hit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,250),blank)
  await page.mouse.click(blank.x,blank.y)
  await page.waitForTimeout(400)
  findings.push({scenario:'collapsed-third-slot-click',expected:3,hit,...await state()})
  await prepare()
  await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button:visible').last().click()
  const mr=page.locator('.more-actions-menu:visible .star-rating')
  await mr.waitFor()
  b=await mr.locator('[data-rating-score="1"]').boundingBox()
  const menuBlank={x:b.x+b.width*2.5,y:b.y+b.height/2}
  const menuBlankHit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,250),menuBlank)
  await page.mouse.click(menuBlank.x,menuBlank.y);await page.waitForTimeout(300)
  findings.push({scenario:'more-collapsed-third-slot-click',expected:3,hit:menuBlankHit,...await state()})
  await page.evaluate(()=>window.vm.feedback.onRatingChange('station',1));await page.waitForTimeout(400)
  b=await mr.locator('[data-rating-score="1"]').boundingBox()
  const menuInitial=await mr.evaluate(n=>({expanded:n.dataset.expanded,rect:n.getBoundingClientRect().toJSON()}))
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(270)
  await page.mouse.move(b.x+b.width*3.5,b.y+b.height/2,{steps:4});await page.mouse.up();await page.waitForTimeout(300)
  findings.push({scenario:'more-collapsed-mouse-drag-to-four',expected:4,menuInitial,...await state()})
  await page.screenshot({path:path.join(evidenceDir,'more-mouse.png')})
  await page.keyboard.press('Escape');await prepare()
  await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button:visible').last().click()
  await mr.waitFor();b=await mr.locator('[data-rating-score="1"]').boundingBox()
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true})
  const point={x:b.x+b.width/2,y:b.y+b.height/2,id:9}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await page.waitForTimeout(270)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:b.x+b.width*3.5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300)
  findings.push({scenario:'more-collapsed-touch-drag-to-four',expected:4,...await state()})
  await page.screenshot({path:path.join(evidenceDir,'more-touch.png')})
  // Smallest verified viewport: begin on invisible third slot, never pre-expand by keyboard.
  await page.keyboard.press('Escape');await page.setViewportSize({width:420,height:900});await prepare()
  b=await root().locator('[data-rating-score="1"]').boundingBox()
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:11}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300)
  findings.push({scenario:'small-cover-solid-one-touch-clears',expected:0,...await state()})
  await setRating(1);await blurRating();await page.waitForTimeout(400)
  b=await root().locator('[data-rating-score="1"]').boundingBox()
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*2.5,y:b.y+b.height/2,id:12}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300)
  findings.push({scenario:'small-cover-collapsed-third-slot-touch',expected:3,...await state()})
  await setRating(1);await blurRating();await page.waitForTimeout(400)
  await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button:visible').last().click();await mr.waitFor()
  await page.waitForFunction(()=>{
    const n=document.querySelector('.more-actions-menu .star-rating');if(!n)return false
    const key=JSON.stringify(n.getBoundingClientRect().toJSON())
    window.hitStable=window.hitLast===key?(window.hitStable??0)+1:0;window.hitLast=key
    return window.hitStable>=5
  },null,{polling:'raf'})
  b=await mr.locator('[data-rating-score="1"]').boundingBox()
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*2.5,y:b.y+b.height/2,id:13}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300)
  findings.push({scenario:'small-more-collapsed-third-slot-touch',expected:3,...await state()})
  writeFileSync(path.join(evidenceDir,'findings.json'),JSON.stringify(findings,null,2))
  console.log(JSON.stringify({findings,evidenceDir},null,2))
  if(!process.env.SPMUSIC_RATING_BASELINE)for(const finding of findings){assert.equal(finding.score,finding.expected,finding.scenario);assert.equal(finding.track,'station',finding.scenario);assert.equal(finding.playlistOpen,false,finding.scenario)}
  assert.deepEqual(errors,[])
}finally{if(browser)await browser.close();await server.close()}
