import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const server=await createServer({cacheDir:mkdtempSync(path.join(tmpdir(),'song-rating-display-vite-')),server:{host:'127.0.0.1',port:5196,strictPort:true}})
const evidence=path.join(tmpdir(),'spmusic-song-rating-display-evidence');mkdirSync(evidence,{recursive:true})
let browser
try {
 await server.listen();const origin='http://127.0.0.1:5196'
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
 await page.addInitScript(()=>{if(!sessionStorage.getItem('rating.persistence.initialized')){localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.player.rating-mode.v1','stars');sessionStorage.setItem('rating.persistence.initialized','1');localStorage.setItem('spmusic.bookmarks.v1',JSON.stringify({version:1,entries:[{id:'bookmark-a',sourcePath:'/music/a.flac',positionMs:1000,createdAt:1,sort:0}]}));localStorage.setItem('spmusic.most-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'/music/a.flac',playCount:3,lastPlayedAt:100}]}))}})
 const active=()=>page.locator('.playlist-management-content:not([inert]),.album-library-content:not([inert]),.folder-hierarchy-content:not([inert]),.bookmarks-content:not([inert])').filter({visible:true})
 const category=async id=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(id=>window.vm.playlist.library.route.categoryId===id,id)}
 const card=id=>page.locator(`.playlist-card[data-playlist-track-id="${id}"]:visible`).first()
 const expectBadge=async(id,n)=>{const row=card(id);await row.waitFor();assert.equal(await row.locator('.playlist-card-rating:visible').getAttribute('data-rating'),String(n));return row}
 const mode=async label=>{await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:label,exact:true}).click();await page.keyboard.press('Escape')}
 const covered=[]
 try{
  await page.goto(origin+'/__highest_test');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  await page.evaluate(()=>{window.vm.feedback.onRatingChange('a',5);window.vm.feedback.onRatingChange('b',1);window.vm.feedback.onRatingChange('duet',3)})
  await category('songs');await expectBadge('a',5);await expectBadge('b',1);await expectBadge('duet',3);covered.push('all-songs')
  const zero=card('other');await zero.scrollIntoViewIfNeeded();assert.equal(await zero.locator('.playlist-card-rating').count(),0);assert.equal(await zero.getAttribute('data-has-play-count'),null,'unrated row has no badge layout marker')
  await mode('赞／踩');await card('a').scrollIntoViewIfNeeded();assert.equal(await card('a').locator('.playlist-card-rating-thumb:visible').count(),1)
  assert.equal(await card('b').locator('.playlist-card-rating-thumb.is-disliked:visible').count(),1)
  assert.equal(await card('duet').locator('.playlist-card-rating').count(),0,'intermediate rating has no thumbs badge');assert.equal(await card('duet').getAttribute('data-has-play-count'),null,'hidden thumbs badge adds no layout')
  await mode('五星评分')
  // Standard playlist renderer is reached using a session playlist, not mocked components.
  await page.evaluate(()=>{const lib=window.vm.playlist.library;const keys=lib.allSongs.filter(s=>['a','b','duet','other'].includes(s.trackId)).map(s=>s.key);const scope=lib.onCreatePlaylist('评级测试',keys);lib.onSelect(scope)})
  await expectBadge('a',5);covered.push('playlist')
  await category('bookmarks');await expectBadge('a',5);covered.push('bookmarks')
  await category('folder');const folders=page.locator('.folder-row:visible');await folders.first().waitFor();assert.equal(await folders.locator('.playlist-card-rating').count(),0,'folder collection cards have no rating')
  await page.evaluate(()=>window.vm.playlist.library.onFlatFolderLocationChange({rootPath:'/music',directoryPath:'/music'}));await expectBadge('a',5);covered.push('flat-folder-songs')
  await category('folders');await page.evaluate(()=>window.vm.playlist.library.onFolderLocationChange({rootPath:'/music',directoryPath:'/music'}));await expectBadge('a',5);covered.push('hierarchy-folder-songs')
  await category('album');const albums=page.locator('.album-library-content:not([inert]) .album-card');await albums.first().waitFor();assert.equal(await albums.locator('.playlist-card-rating').count(),0,'album collection cards have no rating')
  await albums.filter({hasText:'Shared'}).first().click();await expectBadge('a',5);covered.push('album-detail')
  await category('artist');const artists=page.locator('.album-library-content:not([inert]) .artist-card');await artists.first().waitFor();assert.equal(await artists.locator('.playlist-card-rating').count(),0)
  await artists.filter({hasText:'Singer A'}).first().click();await page.locator('.artist-all-songs:visible').click();await expectBadge('duet',3);covered.push('artist-songs')
  await page.evaluate(()=>window.vm.search.onOpenChange(true));const search=page.locator('.search-page');await search.waitFor();await page.getByRole('searchbox',{name:'聚合搜索'}).fill('Song a');await expectBadge('a',5);covered.push('search-song')
  assert.equal(await search.locator('.folder-row .playlist-card-rating').count(),0,'search collection rows have no rating')
  await page.evaluate(()=>window.vm.search.onOpenChange(false));await category('most-played');await card('a').waitFor();assert.equal(await card('a').locator('.playlist-card-rating').count(),0,'most-played remains count-only');assert.equal(await card('a').locator('.playlist-card-play-count:visible').innerText(),'3');covered.push('most-played-count-only')
  await category('songs');await card('a').click();await page.waitForFunction(()=>window.vm.playback.track?.id==='a'&&!window.vm.playback.isSelectionPending)
  await page.setViewportSize({width:1920,height:1080});await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click();await page.evaluate(()=>{if(!window.vm.queue.isOpen)window.vm.queue.onToggle()})
  const queue=page.locator('.debug-queue-panel');await queue.waitFor();const queueA=queue.locator('li').filter({hasText:'Song a'}).first();assert.equal(await queueA.locator('[data-rating="5"]').count(),1);covered.push('queue')
  await page.screenshot({path:path.join(evidence,'song-rating-queue.png')})
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,covered,evidence}))
 }catch(e){await page.screenshot({path:path.join(evidence,'failure.png')});console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,text:document.body.innerText.slice(-1800)})));throw e}
}finally{if(browser)await browser.close();await server.close()}