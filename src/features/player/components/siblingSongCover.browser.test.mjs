// The Rust sibling-art tests prove selection. This test proves the actual three UI consumers honor the effective cover contract.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const require=createRequire(import.meta.url),{chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const shared=readFileSync(new URL('./folderHierarchy.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(literal)
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace('coverArt:null}}};','coverArt:window.songArtwork(path)}}};')
assert(fixture.includes('window.songArtwork(path)'))
const extra=`
window.songImages={};for(const name of ['red','green','blue']){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=name==='green'?'#00ff00':name;ctx.fillRect(0,0,1,1);window.songImages[name]=canvas.toDataURL('image/png')}
window.sidecar='red';window.artworkGate=false;window.pendingArtwork=[];window.selectedScanPaths=['/music'];
window.songArtwork=path=>{const name=path.endsWith('/root2.flac')?'green':window.sidecar;return name?{mimeType:'image/png',filePath:'/sibling-covers/'+name+'.png',dataUrl:null,byteLen:70}:null};
const oldInvoke=window.backendInvoke;
window.backendInvoke=async(command,args)=>{
 const input=args?.input;
 if(command==='library_select_folders'){window.calls.push({command,input});return window.selectedScanPaths}
 if(command==='library_add_folder'){window.calls.push({command,input});return {folders:roots}}
 if(command==='audio_probe_playlist_cover'){
  window.calls.push({command,input});const row=track(input.path),coverArt=window.songArtwork(input.path);
  if(window.artworkGate)await new Promise(resolve=>window.pendingArtwork.push({path:input.path,coverArt,resolve}));
  return {id:row.id,sourcePath:row.sourcePath,coverArt};
 }
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'){
  window.calls.push({command,input});const cover=command==='audio_load_track_thumbnail'?window.songArtwork(input.sourcePath):{filePath:input.filePath};if(!cover)return new Uint8Array(0);
  const name=cover.filePath.split('/').at(-1).split('.')[0];
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);
  for(const [offset,value]of [[8,1],[12,1],[16,4],[20,1],[24,4],[32,1],[36,1]])view.setUint32(offset,value,true);
  bytes.set(name==='green'?[0,255,0,255]:name==='blue'?[0,0,255,255]:[255,0,0,255],40);return bytes;
 }
 const result=await oldInvoke(command,args);if(command==='library_scan_folder')window.completedScan=result;return result;
};
window.root=ReactDOM.createRoot(document.getElementById('root'));window.root.render(`
fixture=fixture.replace("ReactDOM.createRoot(document.getElementById('root')).render(",extra)
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface}from '/__song_sibling_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__song_sibling_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),errors=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000)
async function color(selector){
 await page.waitForFunction(selector=>{const node=document.querySelector(selector);if(node instanceof HTMLCanvasElement)return node.width>0&&node.getContext('2d').getImageData(Math.floor(node.width/2),Math.floor(node.height/2),1,1).data[3]>0;return node?.complete&&node.naturalWidth>0},selector)
 return page.locator(selector).first().evaluate(node=>{if(node instanceof HTMLCanvasElement)return [...node.getContext('2d').getImageData(Math.floor(node.width/2),Math.floor(node.height/2),1,1).data];const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(node,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]})
}
try{
 await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.removeItem('spmusic.player.session.v1');localStorage.setItem('spmusic.all-songs.layout-level.v1','3')})
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__song_sibling_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
 await page.route('**/__song_sibling_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__song_sibling_test',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.route('**/sibling-covers/*.png',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1).split('.')[0];const data=await page.evaluate(name=>window.songImages[name],name);await route.fulfill({contentType:'image/png',body:Buffer.from(data.split(',')[1],'base64')})})
 await page.goto(origin+'/__song_sibling_test')
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===5)
 await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
 const redSelector='[data-song-key="/music/root.flac"] .playlist-card-cover-image'
 const greenSelector='[data-song-key="/music/root2.flac"] .playlist-card-cover-image'
 assert.deepEqual(await color(redSelector),[255,0,0,255],'song without embedded cover renders effective sibling image')
 assert.deepEqual(await color(greenSelector),[0,255,0,255],'embedded cover stays distinct from sibling image in the same directory')
 for(const [id,expected]of [['root',[255,0,0,255]],['root2',[0,255,0,255]]]){
  await page.evaluate(id=>{const item=window.vm.playlist.library.allSongs.find(row=>row.trackId===id);window.vm.playlist.library.onPlaySong(item.scope,id)},id)
  await page.waitForFunction(id=>window.vm.playback.track?.id===id&&!window.vm.playback.isAudioBusy,id)
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
  await page.waitForFunction(()=>document.querySelector('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover'))
  const dockColor=await color('.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover canvas, .playlist-playback-track[data-swipe-plane="current"] img.playlist-playback-cover-image')
  assert.deepEqual(dockColor.slice(0,3),expected.slice(0,3),'playback dock agrees with list artwork source RGB')
 }
 const audioLoads=()=>page.evaluate(()=>window.calls.filter(call=>['audio_load_file','audio_load_and_play','audio_hydrate_track'].includes(call.command)).length)
 const play=async id=>{
  await page.evaluate(id=>{const item=window.vm.playlist.library.allSongs.find(row=>row.trackId===id);window.vm.playlist.library.onPlaySong(item.scope,id)},id)
  await page.waitForFunction(id=>window.vm.playback.track?.id===id&&!window.vm.playback.isAudioBusy,id)
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('songs'))
 }
 const rescan=async(name,paths=['/music'])=>{
  await page.evaluate(()=>{window.completedScan=null})
  await page.evaluate(async({name,paths})=>{window.sidecar=name;window.selectedScanPaths=paths;await window.vm.playlist.library.onSelectFolders()}, {name,paths})
  await page.waitForFunction(()=>window.completedScan&&window.vm.playlist.library.folderRoots.some(root=>root.path===window.completedScan.sourcePath&&root.directoryPaths===window.completedScan.directoryPaths))
 }
 const waitArtwork=async(name,id='root')=>page.waitForFunction(({name,id})=>window.vm.playback.artwork?.id===id&&(window.vm.playback.artwork.coverFilePath??null)===(name?'/sibling-covers/'+name+'.png':null),{name,id})
 const dock='.playlist-playback-track[data-swipe-plane="current"] .playlist-playback-cover canvas, .playlist-playback-track[data-swipe-plane="current"] img.playlist-playback-cover-image'
 await play('root')
 const loadsBeforeRescans=await audioLoads()
 for(const name of ['blue',null,'red']){
  await rescan(name);await waitArtwork(name)
  if(name){
   await page.waitForFunction(({selector,rgb})=>{const node=document.querySelector(selector);if(!(node instanceof HTMLImageElement)||!node.complete||!node.naturalWidth)return false;const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(node,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).join()===rgb}, {selector:redSelector,rgb:name==='blue'?'0,0,255':'255,0,0'})
   assert.deepEqual((await color(dock)).slice(0,3),name==='blue'?[0,0,255]:[255,0,0])
  }else{
   await page.waitForFunction(selector=>!document.querySelector(selector),redSelector)
   await page.waitForFunction(selector=>!document.querySelector(selector),dock)
  }
  assert.equal(await audioLoads(),loadsBeforeRescans,'replace/delete/add sidecar refreshes presentation without loading or hydrating audio')
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'root')
 }
 // Both selected roots contain album.flac. Hold their independent old/new
 // probes to force completion in the opposite order from successful scans.
 await play('album')
 await page.evaluate(()=>{window.artworkGate=true})
 const raceLoads=await audioLoads()
 await rescan('red',['/music'])
 await page.waitForFunction(()=>window.pendingArtwork.some(job=>job.path==='/music/Album/album.flac'))
 await rescan('blue',['/music/Album'])
 await page.waitForFunction(()=>window.pendingArtwork.some(job=>job.path==='/music/Album/album.flac'&&job.coverArt?.filePath.endsWith('/blue.png')))
 await page.evaluate(()=>{const ready=window.pendingArtwork.filter(job=>job.coverArt?.filePath.endsWith('/blue.png'));window.pendingArtwork=window.pendingArtwork.filter(job=>!ready.includes(job));ready.forEach(job=>job.resolve())})
 await waitArtwork('blue','album')
 await page.evaluate(async()=>{window.pendingArtwork.splice(0).forEach(job=>job.resolve());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
 assert.equal(await page.evaluate(()=>window.vm.playback.artwork.coverFilePath),'/sibling-covers/blue.png','late parent-root probe cannot overwrite newer overlapping-child scan')
 assert.equal(await audioLoads(),raceLoads,'overlapping-root scans leave native audio untouched')
 // A selection invalidates the pending rescan probe even when it resolves
 // after native playback has committed another song.
 await rescan('red',['/music'])
 await page.waitForFunction(()=>window.pendingArtwork.some(job=>job.path==='/music/Album/album.flac'))
 await play('root2');await waitArtwork('green','root2')
 const switchedLoads=await audioLoads()
 await page.evaluate(async()=>{window.artworkGate=false;window.pendingArtwork.splice(0).forEach(job=>job.resolve());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
 assert.equal(await page.evaluate(()=>window.vm.playback.artwork.id),'root2')
 assert.equal(await page.evaluate(()=>window.vm.playback.artwork.coverFilePath),'/sibling-covers/green.png')
 assert.equal(await audioLoads(),switchedLoads,'obsolete probe performs no native audio work after selection')
 await play('album')
 await page.evaluate(()=>{window.artworkGate=true})
 await rescan('red')
 await page.waitForFunction(()=>window.pendingArtwork.some(job=>job.path==='/music/Album/album.flac'))
 await page.evaluate(()=>{window.sidecar='blue'})
 await play('other');await waitArtwork('blue','other')
 const changedScopeLoads=await audioLoads()
 await page.evaluate(async()=>{window.artworkGate=false;window.pendingArtwork.splice(0).forEach(job=>job.resolve());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
 assert.equal(await page.evaluate(()=>window.vm.playback.artwork.id),'other','old root probe cannot overwrite a song loaded from another source scope')
 assert.equal(await page.evaluate(()=>window.vm.playback.artwork.coverFilePath),'/sibling-covers/blue.png')
 assert.equal(await audioLoads(),changedScopeLoads,'scope change invalidates pending artwork without additional native audio work')
 await play('root2');await waitArtwork('green','root2')
 const unmountLoads=await audioLoads()
 await page.evaluate(()=>{window.artworkGate=true})
 await rescan('blue')
 await page.waitForFunction(()=>window.pendingArtwork.some(job=>job.path==='/music/root2.flac'))
 await page.evaluate(async()=>{window.root.unmount();window.pendingArtwork.splice(0).forEach(job=>job.resolve());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
 assert.equal(await page.locator('#root').innerHTML(),'','unmounted Shell stays detached after pending artwork resolves')
 assert.equal(await audioLoads(),unmountLoads,'unmounted refresh performs no native audio work')
 const calls=await page.evaluate(()=>window.calls)
 assert(calls.some(call=>call.command==='audio_load_track_thumbnail'&&call.input.sourcePath==='/music/root.flac'))
 assert(calls.some(call=>call.command==='audio_load_and_play'&&call.input.path==='/music/root.flac'))
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({pass:true,listAndPlaybackSources:2,rescans:['replace','delete','add','overlap-old-last','selection','scope-change','unmount'],probeCalls:calls.filter(call=>call.command==='audio_probe_playlist_cover').length,pixelCalls:calls.filter(call=>call.command==='audio_load_playlist_cover_pixels').length}))
}finally{await browser.close()}
