// Real PlayerShell/PlayerSurface pointer path; only native transport is controlled.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const server = await createServer({ cacheDir: mkdtempSync(path.join(tmpdir(), 'spmusic-player-rating-vite-')), server: { host: '127.0.0.1', port: 5192, strictPort: true } })
const evidenceDir = path.join(tmpdir(), 'spmusic-cover-actions-scale-evidence')
mkdirSync(evidenceDir, { recursive: true })
let browser
const report = [], errors = []
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5192'
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


  await page.goto(origin+'/__stream_player_test');await page.waitForFunction(()=>window.vm?.playlist?.library)
  await select('streams','station');await openFull()
  await page.emulateMedia({reducedMotion:'reduce'})
  const cdp=await page.context().newCDPSession(page)
  const rows=[]
  for(const viewport of [{width:2560,height:1440,deviceScaleFactor:1},{width:1920,height:1080,deviceScaleFactor:1},{width:1440,height:960,deviceScaleFactor:2},{width:640,height:1024,deviceScaleFactor:1},{width:420,height:900,deviceScaleFactor:1}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height})
    await cdp.send('Emulation.setDeviceMetricsOverride',{...viewport,mobile:false})
    await page.waitForFunction(v=>innerWidth===v.width&&innerHeight===v.height&&devicePixelRatio===v.deviceScaleFactor,viewport)
    for(const mode of ['stars','thumbs']) {
      await setMode(mode)
      await page.waitForFunction(()=>{
        const c=[...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .cover-art')].find(n=>n.getBoundingClientRect().width>0)
        if(!c)return false
        const key=JSON.stringify([c.getBoundingClientRect().toJSON(),...Array.from(c.querySelectorAll('.more-button,.cover-feedback')).map(n=>n.getBoundingClientRect().toJSON())])
        window.scaleStable=window.scaleLast===key?(window.scaleStable??0)+1:0;window.scaleLast=key;return window.scaleStable>=5
      },null,{polling:'raf'})
      for(const playing of [true,false]) {
        if(await page.evaluate(()=>window.vm.playback.isPlaying)!==playing){await page.locator('.control-dock:visible').last().getByRole('button',{name:playing?'播放':'暂停',exact:true}).click();await page.waitForFunction(p=>window.vm.playback.isPlaying===p,playing)}
        await page.waitForFunction(()=>{
          const c=[...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .cover-art')].find(n=>n.getBoundingClientRect().width>0)
          if(!c)return false
          const key=JSON.stringify([c,...c.querySelectorAll('.cover-actions,.cover-feedback,.more-button,.more-button > svg,.cover-feedback > button')].map(n=>n.getBoundingClientRect().toJSON()))
          window.stateScaleStable=window.stateScaleLast===key?(window.stateScaleStable??0)+1:0;window.stateScaleLast=key;return window.stateScaleStable>=5
        },null,{polling:'raf'})
        const row=await page.evaluate(({viewport,mode,playing})=>{
          const l=document.querySelector('.responsive-player-layout'),c=[...document.querySelectorAll('.track-card-plane[data-track-card-phase="active"] .cover-art')].find(n=>n.getBoundingClientRect().width>0)
          const m=c.querySelector('.more-button'),icon=m.querySelector('svg'),f=c.querySelector('.cover-feedback'),a=c.querySelector('.cover-actions')
          const rect=n=>n?.getBoundingClientRect().toJSON(),cr=rect(c),mr=rect(m),fr=rect(f)
          const buttons=[...f.querySelectorAll(':scope > button')]
          return {viewport,mode,playing,layout:l.dataset.playerLayout,cover:cr,more:mr,icon:rect(icon),feedback:fr,thumbs:buttons.map(n=>({rect:rect(n),icon:rect(n.querySelector('svg'))})),offsets:{left:fr.x-cr.x,right:cr.right-mr.right,bottom:cr.bottom-rect(a).bottom,feedbackBottom:cr.bottom-fr.bottom,moreBottom:cr.bottom-mr.bottom,thumbGap:buttons.length===2?rect(buttons[1]).x-rect(buttons[0]).right:null},overlap:fr.right>mr.left+.5}
        },{viewport,mode,playing})
        assert(row.cover.width>0&&row.more.width>0&&row.more.height>0&&row.icon.width>0)
        assert.equal(row.overlap,false,'feedback never overlaps more')
        assert(row.more.right<=row.cover.right+1&&row.feedback.x>=row.cover.x-1)
        for(const edge of ['feedbackBottom','moreBottom'])assert(Math.abs(row.offsets[edge]-row.offsets.left)/row.cover.width<.001,`${mode}/${edge}: bottom equals feedback left`)
        if(mode==='thumbs')assert.equal(row.thumbs.length,2)
        rows.push(row)
      }
      await page.screenshot({path:path.join(evidenceDir,`${viewport.width}-${viewport.deviceScaleFactor}-${mode}.png`)})
    }
  }
  const normalize=r=>{
    const w=r.cover.width
    return {moreWidth:r.more.width/w,moreHeight:r.more.height/w,iconWidth:r.icon.width/w,iconHeight:r.icon.height/w,left:r.offsets.left/w,right:r.offsets.right/w,bottom:r.offsets.bottom/w,...r.mode==='thumbs'?{thumbWidth:r.thumbs[0].rect.width/w,thumbHeight:r.thumbs[0].rect.height/w,thumbIconWidth:r.thumbs[0].icon.width/w,thumbIconHeight:r.thumbs[0].icon.height/w,thumbGap:r.offsets.thumbGap/w}:{}}
  }
  const baseline={stars:normalize(rows.find(r=>r.mode==='stars')),thumbs:normalize(rows.find(r=>r.mode==='thumbs'))}
  for(const row of rows){row.ratios=normalize(row);for(const [key,value] of Object.entries(row.ratios))assert(Math.abs(value-baseline[row.mode][key])<.002,`${row.viewport.width}/${row.mode}/${row.playing}: ${key} ratio ${value} vs ${baseline[row.mode][key]}`)}
  // Popup uses its own theme/scale; cover overrides must not reach the summary stars.
  await setMode('stars');await page.locator('.track-card-plane[data-track-card-phase="active"] .more-button:visible').last().click()
  const popup=page.locator('.more-actions-menu:visible .star-rating')
  await popup.waitFor()
  const summary=await popup.evaluate(n=>{const s=getComputedStyle(n),probe=document.createElement('span');probe.style.color='var(--player-inverse-primary)';n.append(probe);const expected=getComputedStyle(probe).color;probe.remove();const p=getComputedStyle(n,'::before');return {color:s.color,expected,background:s.backgroundColor,shadow:s.boxShadow,pseudoBackground:p.backgroundColor,pseudoShadow:p.boxShadow,ratingUnit:s.getPropertyValue('--rating-unit')}})
  assert.equal(summary.color,summary.expected);assert.equal(summary.background,'rgba(0, 0, 0, 0)');assert.equal(summary.shadow,'none');assert.equal(summary.pseudoBackground,'rgba(0, 0, 0, 0)');assert.equal(summary.pseudoShadow,'none')
  await page.screenshot({path:path.join(evidenceDir,'more-popup.png')})
  assert.deepEqual(errors,[])
  writeFileSync(path.join(evidenceDir,'geometry.json'),JSON.stringify({baseline,rows,summary},null,2))
  console.log(JSON.stringify({passed:true,scenarios:rows.length,baseline,summary,evidenceDir},null,2))
}catch(error){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p)await p.screenshot({path:path.join(evidenceDir,'failure.png')})}throw error}
finally{if(browser)await browser.close();await server.close()}
