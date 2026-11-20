import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const server=await createServer({cacheDir:mkdtempSync(path.join(tmpdir(),'rated-cancellation-vite-')),server:{host:'127.0.0.1',port:5197,strictPort:true}})
const evidence=path.join(tmpdir(),'spmusic-rated-cancellation-evidence');mkdirSync(evidence,{recursive:true})
let browser
try {
 await server.listen();const origin='http://127.0.0.1:5197'
 const main=await(await fetch(origin+'/src/main.tsx')).text()
 const dependency=name=>{const m=main.match(new RegExp('"(/[^"\\n]+/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m);return m[1]}
 const shared=readFileSync(new URL('./mostPlayedAcceptance.browser.test.mjs',import.meta.url),'utf8')
 const literal=shared.match(/const fixture = (`[^]*?`)\r?\nconst html/);assert(literal)
  const fixture=runInNewContext(literal[1],{dependency})+`
import {Toaster} from '/src/components/ui/sonner.tsx';
const toastHost=document.createElement('div');document.body.append(toastHost);ReactDOM.createRoot(toastHost).render(React.createElement(Toaster));
const nativeBackend=window.backendInvoke;window.backendInvoke=async(command,args)=>{const hold=typeof window.holdResponsePath==='string'&&['audio_load_and_play','audio_load_file'].includes(command)&&window.holdResponsePath===args?.input?.path;if(hold)window.holdResponsePath=null;const result=await nativeBackend(command,args);if(hold){window.responseHeld=true;await new Promise(resolve=>window.releaseHeldResponse=resolve)}return result};
`
 const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text()).replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;').replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{delete window.listeners[name]}};')
 assert(service.includes('window.backendInvoke'))
 const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
 const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__highest_real.js';export function PlayerSurface(props){window.vm=props.viewModel;if(window.recordSelections)(window.selectionFrames??=[]).push({id:props.viewModel.playback.track?.id,intent:props.viewModel.playback.selectionVisualIntent});return React.createElement(RealSurface,props)}`
 const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__highest_fixture.js"')
 browser=await chromium.launch({headless:true,channel:'msedge'})
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'})
 page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.routeWebSocket(origin.replace('http:','ws:')+'/**',socket=>socket.close())
 for(const [url,body] of [['**/src/features/player/services/audioCommands.ts*',service],['**/src/features/player/components/PlayerSurface.tsx*',surface],['**/__highest_real.js',realSurface],['**/__highest_fixture.js',fixture]])await page.route(url,r=>r.fulfill({contentType:'text/javascript',body}))
 await page.route('**/__highest_test*',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{localStorage.clear();localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.player.rating-mode.v1','thumbs')})
 const category=async id=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(id=>window.vm.playlist.library.route.categoryId===id,id)}
 const ready=()=>page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
 const rate=async(id,n)=>{await page.evaluate(({id,n})=>window.vm.feedback.onRatingChange(id,n),{id,n});await page.waitForFunction(({id,n})=>(window.vm.feedback.ratingsByTrackId[id]??0)===n,{id,n})}
 const track=async id=>page.waitForFunction(id=>window.vm.playback.track?.id===id&&!window.vm.playback.isSelectionPending,id)
 const queue=()=>page.evaluate(()=>window.vm.queue.tracks.map(t=>t.id))
 const setup=async(cat,ratings,id)=>{
  await page.goto(origin+'/__highest_test');await ready()
  for(const [key,n]of Object.entries(ratings))await rate(key,n)
  await category(cat)
  await page.locator(`.playlist-card[data-playlist-track-id="${id}"]:visible`).first().click();await track(id)
  await page.locator('.playlist-playback-dock:not([inert]) .playlist-playback-track-button').click()
  await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-feedback').last().waitFor({state:'visible'})
 }
 const cancelThumb=async feedback=>{await page.locator('.track-card-plane[data-track-card-phase="active"] .cover-feedback').last().getByRole('button',{name:feedback==='liked'?'喜欢':'不喜欢',exact:true}).click()}
 const pause=async()=>{await page.evaluate(()=>window.vm.playback.onPlayToggle({requestId:909,expectedTrackId:window.vm.playback.track.id,target:'paused',durationMs:0}));await page.waitForFunction(()=>!window.vm.playback.isPlaying)}
 const results=[]
 try{
  await setup('highest-rated',{a:5,b:5,duet:5},'b')
  await page.waitForFunction(()=>!document.querySelector('.track-card-plane[data-track-card-phase="incoming"],.track-card-plane[data-track-card-phase="outgoing"]'))
  await page.evaluate(()=>{window.recordSelections=true;window.selectionFrames=[];window.cardTrace=[];window.traceRunning=true;const frame=()=>{if(!window.traceRunning)return;window.cardTrace.push([...document.querySelectorAll('.track-card-plane')].map(n=>({id:n.dataset.trackCardLayerId,phase:n.dataset.trackCardPhase,transform:getComputedStyle(n).transform,opacity:getComputedStyle(n.querySelector('.track-card-content')).opacity})));requestAnimationFrame(frame)};requestAnimationFrame(frame)})
  await cancelThumb('liked');await track('duet')
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)))
  const visual=await page.evaluate(()=>{window.traceRunning=false;window.recordSelections=false;return {frames:window.selectionFrames,trace:window.cardTrace,final:[...document.querySelectorAll('.track-card-plane')].map(n=>n.dataset.trackCardPhase)}})
  writeFileSync(path.join(evidence,'cancellation-visual-trace.json'),JSON.stringify(visual,null,2))
  assert(visual.frames.some(f=>f.id==='duet'),'replacement rendered during frame observation')
  assert(!visual.frames.some(f=>f.intent?.targetTrackId==='duet'),'cancellation does not create incoming selection visual intent')
  assert(visual.trace.every(frame=>frame.every(card=>card.transform==='none')),'cancellation performs no incoming or outgoing card rotation/translation')
  assert(visual.trace.every(frame=>frame.filter(card=>card.phase==='incoming').every(card=>Number(card.opacity)===0)),'resource preparation buffer stays invisible until direct activation')
  assert(!visual.final.includes('outgoing')&&!visual.final.includes('incoming'),'temporary layers are cleaned after cancellation')
  assert.equal(await page.evaluate(()=>window.vm.playback.isPlaying),true);assert.deepEqual(await queue(),['a','duet']);results.push('highest middle cancellation advances in page order while playing')
  await setup('highest-rated',{a:5,b:5},'b');await cancelThumb('liked');await track('a');assert.deepEqual(await queue(),['a']);results.push('tail wraps first remaining')
  await setup('highest-rated',{b:5},'b');await cancelThumb('liked');await track('a');assert.equal(await page.evaluate(()=>window.vm.playback.isPlaying),true);assert((await queue()).includes('band'));results.push('empty highest falls back to default library folder while playing')
  await setup('lowest-rated',{b:1,duet:1},'b');await pause();await cancelThumb('disliked');await track('duet')
  assert.equal(await page.evaluate(()=>window.vm.playback.isPlaying),false);assert.deepEqual(await queue(),['duet']);results.push('lowest cancellation advances and preserves paused')
  await cancelThumb('disliked');await track('a');assert.equal(await page.evaluate(()=>window.vm.playback.isPlaying),false);assert((await queue()).includes('band'));results.push('empty lowest fallback preserves paused')
  await setup('songs',{a:5,b:5},'a');await cancelThumb('liked');await page.waitForFunction(()=>(window.vm.feedback.ratingsByTrackId.a??0)===0)
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'a');results.push('ordinary playback cancellation does not auto-switch')
  await setup('highest-rated',{a:5,b:5},'a');await rate('b',0);assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'a');results.push('noncurrent cancellation does not auto-switch')
  await setup('highest-rated',{a:5,b:3,duet:2},'a')
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();await page.locator('#player-rating-mode').click();await page.getByRole('option',{name:'五星评分',exact:true}).click();await page.keyboard.press('Escape')
  const stars=page.locator('.track-card-plane[data-track-card-phase="active"] .cover-feedback .star-rating').last()
  await stars.locator('[data-rating-score="1"]').focus();await page.keyboard.press('Delete');await track('b');assert.deepEqual(await queue(),['b','duet']);results.push('five-star keyboard zero advances in star rating order')
  await setup('highest-rated',{a:5,b:5},'a');await rate('a',1);assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'a');results.push('nonzero rating change does not auto-switch even if membership changes')
  await setup('highest-rated',{a:5,b:5,duet:5},'a');await page.evaluate(()=>{window.holdResponsePath='/music/b.flac';window.responseHeld=false});await cancelThumb('liked');await page.waitForFunction(()=>window.responseHeld)
  await category('songs');await page.evaluate(()=>{const song=window.vm.playlist.library.allSongs.find(s=>s.trackId==='other');window.vm.playlist.library.onPlaySong(song.scope,song.trackId,[{scope:song.scope,trackId:song.trackId}])});await track('other')
  await page.evaluate(()=>window.releaseHeldResponse());await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)))
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'other');assert.deepEqual(await queue(),['other']);results.push('late cancellation selection response cannot override a later manual source selection')
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,evidence}))
 }catch(e){await page.screenshot({path:path.join(evidence,'failure.png')});console.error(await page.evaluate(()=>({ratings:window.vm?.feedback.ratingsByTrackId,track:window.vm?.playback.track?.id,playing:window.vm?.playback.isPlaying,queue:window.vm?.queue.tracks.map(t=>t.id)})));throw e}
}finally{if(browser)await browser.close();await server.close()}
