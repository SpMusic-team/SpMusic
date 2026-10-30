// Real PlayerShell regression for mixed artwork, virtual entity windows and overlay indices.
// SPMUSIC_ARTWORK_BASELINE=1 captures pre-fix failures without changing production code.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const baseline = process.env.SPMUSIC_ARTWORK_BASELINE === '1'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
 const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
 assert(match, name);return match[1]
}
const source=readFileSync(new URL('./artistLibrary.browser.test.mjs',import.meta.url),'utf8')
const literal=source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse actual shell native transport fixture')
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace('const descriptor=', `
roots.splice(0,roots.length,'/music');
rows.splice(0,rows.length,...Array.from({length:140},(_,i)=>['artist-'+i,'/music/Artist'+String(i).padStart(3,'0')+'/song.flac','Album '+String(i).padStart(3,'0'),'Artist '+String(i).padStart(3,'0'),null]),
 ['fallback-0','/music/Fallback/0.flac','Fallback Album','Fallback',null],['fallback-1','/music/Fallback/1.flac','Fallback Album','Fallback',null]);
const coverFor=path=>path.endsWith('/Fallback/0.flac')?null:{mimeType:'image/png',filePath:path+'.png',dataUrl:null,byteLen:44};
const descriptor=`)
 .replace('audioFormat:null,coverArt:null','audioFormat:null,coverArt:coverFor(path)')
 .replace('coverArt:null}}','coverArt:result.metadata.coverArt}}')
 .replace('if(!covers)return new Uint8Array(0);',"if(!covers||(input.sourcePath??input.filePath??'').includes('/Fallback/0.flac'))return new Uint8Array(0);")
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__artwork_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__artwork_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']})
const evidence=process.env.SPMUSIC_TEST_SCREENSHOTS
if(evidence)mkdirSync(evidence,{recursive:true})
const report=[]
async function open(height=600){
 const page=await browser.newPage({viewport:{width:640,height},reducedMotion:'reduce'});page.setDefaultTimeout(12000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(message.type()==='error')console.error('ARTWORK_CONSOLE',message.text())})
 page.on('requestfailed',request=>console.error('ARTWORK_REQUEST',request.url(),request.failure()?.errorText))
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__artwork_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
 await page.route('**/__artwork_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__artwork_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.removeItem('spmusic.player.session.v1')})
 await page.goto(origin+'/__artwork_test?cover=1');await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===142&&!window.vm.playlist.library.isImportPending).catch(async error=>{console.error('ARTWORK_STARTUP',errors,await page.evaluate(()=>({count:window.vm?.playlist.library.allSongs.length,calls:window.calls?.slice(-8),text:document.body.innerText.slice(0,500)})));throw error})
 return {page,errors}
}
const select=async(page,category)=>{await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category);await page.waitForFunction(category=>window.vm.playlist.library.route.categoryId===category,category)}
const callsFor=(page,path)=>page.evaluate(path=>window.calls.filter(c=>c.command==='audio_load_track_thumbnail'&&c.input.sourcePath===path).length,path)
const capture=async(page,name)=>{if(evidence)await page.screenshot({path:evidence+'/'+name+'.png'})}
try{
 if(!process.env.SPMUSIC_ARTWORK_CASE||process.env.SPMUSIC_ARTWORK_CASE==='virtual'){
  const {page,errors}=await open();await select(page,'artist');await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
  await page.locator('.artist-card').first().waitFor();assert(await page.locator('.artist-card').count()<140,'root uses the actual virtual entity window')
  const path='/music/Artist139/song.flac';assert.equal(await callsFor(page,path),0,'late entity starts cold')
  await page.locator('.album-library-content').evaluate(panel=>panel.scrollTop=panel.scrollHeight)
  const card=page.locator('.artist-card').filter({hasText:'Artist 139'});await card.waitFor();await card.scrollIntoViewIfNeeded()
  if(baseline)await page.waitForTimeout(500);else await card.locator('img').waitFor()
  const signal={chain:'virtual-mounted-entity',requests:await callsFor(page,path),images:await card.locator('img').count()};report.push(signal);console.log('ARTWORK_CASE',JSON.stringify(signal))
  if(baseline){assert.equal(signal.requests,0);assert.equal(signal.images,0)}else assert(signal.requests>0&&signal.images>0)
  await capture(page,'virtual-late-artist');assert.deepEqual(errors,[]);await page.close()
 }
 if(!process.env.SPMUSIC_ARTWORK_CASE||process.env.SPMUSIC_ARTWORK_CASE==='duplicate'){
  const {page,errors}=await open(320);await select(page,'songs');await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
  const path='/music/Artist139/song.flac';assert.equal(await callsFor(page,path),0)
  await page.evaluate(()=>{window.vm.playlist.library.onSelectCategory('artist');window.vm.playlist.library.onArtistLocationChange({artistKey:JSON.stringify(['artist','Artist 139']),view:'albums'})})
  await page.locator('.artist-all-songs').waitFor()
  if(baseline)await page.waitForTimeout(500);else await page.locator('.album-hero .playlist-hero-image').waitFor()
  const signal={chain:'duplicate-key-cold-overview',requests:await callsFor(page,path),heroImages:await page.locator('.album-hero .playlist-hero-image').count(),entryImages:await page.locator('.artist-all-songs img').count()};report.push(signal);console.log('ARTWORK_CASE',JSON.stringify(signal))
  if(!baseline)assert(signal.requests>0&&signal.heroImages>0)
  await capture(page,'cold-overview');assert.deepEqual(errors,[]);await page.close()
 }
 if(!process.env.SPMUSIC_ARTWORK_CASE||process.env.SPMUSIC_ARTWORK_CASE==='mixed'){
  const {page,errors}=await open(900);await select(page,'songs');await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
  await page.evaluate(()=>{window.vm.playlist.library.onSelectCategory('artist');window.vm.playlist.library.onArtistLocationChange({artistKey:JSON.stringify(['artist','Fallback']),view:'albums'})})
  await page.locator('.artist-all-songs').waitFor()
  if(baseline)await page.waitForTimeout(500);else await page.locator('.artist-all-songs img').waitFor()
  const signal={chain:'first-absent-second-cover',firstRequests:await callsFor(page,'/music/Fallback/0.flac'),secondRequests:await callsFor(page,'/music/Fallback/1.flac'),images:await page.locator('.artist-all-songs img').count()};report.push(signal);console.log('ARTWORK_CASE',JSON.stringify(signal))
  if(baseline){assert.equal(signal.secondRequests,0);assert.equal(signal.images,0)}else assert(signal.secondRequests>0&&signal.images>0)
  await capture(page,'mixed-cover');assert.deepEqual(errors,[]);await page.close()
 }
 console.log(baseline?'ARTWORK_FAILURE_BASELINE':'ARTWORK_REGRESSION',JSON.stringify(report))
}finally{await browser.close()}
