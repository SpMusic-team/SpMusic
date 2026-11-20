import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const server=await createServer({cacheDir:mkdtempSync(path.join(tmpdir(),'rating-persistence-vite-')),server:{host:'127.0.0.1',port:5195,strictPort:true}})
const evidence=path.join(tmpdir(),'spmusic-rating-persistence-evidence');mkdirSync(evidence,{recursive:true})
let browser
try {
 await server.listen();const origin='http://127.0.0.1:5195'
 const main=await(await fetch(origin+'/src/main.tsx')).text()
 const dependency=name=>{const m=main.match(new RegExp('"(/[^"\\n]+/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m);return m[1]}
 const shared=readFileSync(new URL('./mostPlayedAcceptance.browser.test.mjs',import.meta.url),'utf8')
 const literal=shared.match(/const fixture = (`[^]*?`)\r?\nconst html/);assert(literal)
  const fixture=runInNewContext(literal[1],{dependency})+`
import {Toaster} from '/src/components/ui/sonner.tsx';
const toastHost=document.createElement('div');document.body.append(toastHost);ReactDOM.createRoot(toastHost).render(React.createElement(Toaster));
`
 const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text()).replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;').replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{delete window.listeners[name]}};')
 assert(service.includes('window.backendInvoke'))
 const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
 const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__highest_real.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
 const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__highest_fixture.js"')
 browser=await chromium.launch({headless:true,channel:'msedge'})
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'})
 page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.routeWebSocket(origin.replace('http:','ws:')+'/**',socket=>socket.close())
 for(const [url,body] of [['**/src/features/player/services/audioCommands.ts*',service],['**/src/features/player/components/PlayerSurface.tsx*',surface],['**/__highest_real.js',realSurface],['**/__highest_fixture.js',fixture]])await page.route(url,r=>r.fulfill({contentType:'text/javascript',body}))
 await page.route('**/__highest_test*',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{if(!sessionStorage.getItem('rating.persistence.initialized')){localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.player.rating-mode.v1','stars');sessionStorage.setItem('rating.persistence.initialized','1')}})
 const active=()=>page.locator('.playlist-management-content:not([inert])')
 const songs=()=>active().locator('.all-songs-list [data-song-key]')
 const ids=()=>songs().evaluateAll(nodes=>nodes.map(n=>n.dataset.songKey.split('/').at(-1).replace('.flac','')))
 const category=async id=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(id=>window.vm.playlist.library.route.categoryId===id,id)}
 const ready=()=>page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
 const rate=async(id,n)=>{await page.evaluate(({id,n})=>window.vm.feedback.onRatingChange(id,n),{id,n});await page.waitForFunction(({id,n})=>(window.vm.feedback.ratingsByTrackId[id]??0)===n,{id,n})}
 const scores=()=>page.evaluate(()=>window.vm.feedback.ratingsByTrackId)
 const mode=async label=>{await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:label,exact:true}).click();await page.keyboard.press('Escape')}
 const reload=async()=>{await page.reload();await ready()}
 try {
  await page.goto(origin+'/__highest_test');await ready()
  const expected={a:0,b:1,duet:2,missing:3,literal:4,other:5}
  for(const [id,n]of Object.entries(expected))await rate(id,n)
  await reload()
  for(const [id,n]of Object.entries(expected))assert.equal((await scores())[id]??0,n,'reload restores integer rating '+id)
  await category('highest-rated');assert.deepEqual(await ids(),['other','literal','missing','duet'])
  await category('lowest-rated');assert.deepEqual(await ids(),['b'])
  await mode('赞／踩');await category('highest-rated');assert.deepEqual(await ids(),['other'])
  await songs().first().click();await page.waitForFunction(()=>window.vm.playback.track?.id==='other'&&!window.vm.playback.isSelectionPending)
  assert.equal(await page.evaluate(()=>window.vm.feedback.valuesByTrackId.other),'liked')
  await reload();await page.waitForFunction(()=>window.vm.playback.track?.id==='other')
  await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click()
  const cover=()=>page.locator('.track-card-plane[data-track-card-phase="active"] .cover-feedback').last()
  await cover().waitFor({state:'visible'})
  assert.equal(await cover().getByRole('button',{name:'喜欢',exact:true}).getAttribute('aria-pressed'),'true','real player restores liked state')
  // The existing feedback action is the same action used by player thumbs.
  await page.evaluate(()=>window.vm.feedback.onToggle('liked'))
  await page.waitForFunction(()=>(window.vm.feedback.ratingsByTrackId.other??0)===0)
  await page.waitForFunction(()=>window.vm.playback.track?.id==='a'&&!window.vm.playback.isSelectionPending)
  await reload();assert.equal((await scores()).other??0,0,'cancelled like stays cancelled after reload')
  await category('songs');await songs().filter({hasText:'Song other'}).first().click();await page.waitForFunction(()=>window.vm.playback.track?.id==='other'&&!window.vm.playback.isSelectionPending)
  await page.evaluate(()=>window.vm.feedback.onToggle('disliked'));await page.waitForFunction(()=>window.vm.feedback.ratingsByTrackId.other===1)
  await reload();assert.equal((await scores()).other,1,'dislike shares rating 1 across reload')
  await category('lowest-rated');assert.deepEqual(await ids(),['b','other'])
  await rate('other',5)
  // Native scan IDs are stable for the same canonical source path.
  await page.evaluate(()=>{window.vm.playlist.library.onRescanFolders()})
  await page.waitForFunction(()=>window.vm.playlist.library.allSongs.some(s=>s.trackId==='other')&&!window.vm.playlist.library.isImportPending)
  assert.equal((await scores()).other,5,'same-source rescan retains stable-ID rating')
  await reload();assert.equal((await scores()).other,5)
  await category('highest-rated');assert.deepEqual(await ids(),['other'])
  await mode('五星评分');assert.deepEqual(await ids(),['other','literal','missing','duet'])
  // Reload with delayed summaries, then overwrite a restored score before hydration resolves.
  await page.goto(origin+'/__highest_test?summaryGate=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  await category('highest-rated');await page.waitForFunction(()=>window.pendingSummaries.length>0)
  await rate('other',2)
  await page.evaluate(()=>{window.summaryGate=false;for(const resolve of window.pendingSummaries.splice(0))resolve()})
  await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus!=='loading')
  assert.equal((await scores()).other,2,'late metadata cannot overwrite newer user rating')
  await page.goto(origin+'/__highest_test');await ready();assert.equal((await scores()).other,2,'newer hydrated-path rating persists')
  // A failed write must retain memory and explicitly report non-durability.
  await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='spmusic.track-ratings.v1')throw new Error('test quota');return window.originalStorageSet.call(this,key,value)}})
  await rate('other',4)
  await page.getByText('评分保存失败，当前评分仅在本次会话中保留。请检查本地存储后重试。',{exact:true}).waitFor()
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet})
  await reload();assert.equal((await scores()).other,2,'failed write does not corrupt prior durable value')
  await page.waitForFunction(()=>window.vm.playback.track?.id==='other')
  await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click()
  await cover().waitFor({state:'visible'})
  assert.equal(await cover().locator('.star-rating').getAttribute('data-rating-count'),'2','real player restores intermediate star count')
  await page.screenshot({path:path.join(evidence,'rating-persistence-restored.png')})
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,evidence}))
 }catch(e){await page.screenshot({path:path.join(evidence,'failure.png')});console.error(await page.evaluate(()=>({ratings:window.vm?.feedback.ratingsByTrackId,route:window.vm?.playlist.library.route})));throw e}
}finally{if(browser)await browser.close();await server.close()}
