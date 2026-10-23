// Run against Vite with SPMUSIC_PLAYWRIGHT set to an existing Playwright package.
// Independently exercises folder/library and user-playlist separation through real UI.
// The real shell, hook, settings, and command parser run against a controlled
// native transport. The registry mock survives reload like Tauri app data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__imported_playlist_artwork_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.pixelGate=sessionStorage.getItem('artwork-pixel-gate')==='1';window.pendingPixels=[];window.coverActive=0;window.maxCoverActive=0;window.created=[];window.revoked=[];window.listName='A';window.dataUrlOnly=sessionStorage.getItem('artwork-data-only')==='1';const dataCanvas=document.createElement('canvas');dataCanvas.width=1;dataCanvas.height=1;dataCanvas.getContext('2d').fillRect(0,0,1,1);window.coverDataUrl=dataCanvas.toDataURL('image/png');window.restoreGate=sessionStorage.getItem('playlist-restore-gate')==='1';window.pendingRestores=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.created.push(url);return url};URL.revokeObjectURL=url=>{window.revoked.push(url);return revoke(url)};window.calls=[];window.choice='a';window.folderSelection=['/audio/a'];window.importCancel=false;window.importMissing=false;window.importFail=false;window.scanGate=sessionStorage.getItem('library-test-scan-gate')==='1';window.pendingScans=[];window.registryGetGate=sessionStorage.getItem('library-test-get-gate')==='1';window.pendingGets=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const registryKey='spmusic-test-native-library-registry';
const readRegistry=()=>JSON.parse(localStorage.getItem(registryKey)||'[]');
const writeRegistry=folders=>localStorage.setItem(registryKey,JSON.stringify(folders));
const entries={a:[['a-0','/audio/a/0.flac'],['shared','/audio/common/shared.flac']],b:[['b-0','/audio/b/0.flac'],['shared','/audio/common/shared.flac']],sidecar:[['sidecar-0','/audio/sidecar/0.flac']],m3u8:Array.from({length:24},(_,i)=>['list-'+i,'/audio/list/'+i+'.flac'])};
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const folder=(choice,sourceKind='folder')=>({directoryPath:'/audio/'+choice,directoryName:'Folder '+choice,sourceKind,sourcePath:sourceKind==='folder'?'/audio/'+choice:'/lists/'+choice+'.m3u8',sourceName:'List '+choice,selectedIndex:0,tracks:entries[choice].map(descriptor)});
const all=new Map(Object.values(entries).flat().map(pair=>[pair[1],descriptor(pair)]));
const track=path=>{const row=all.get(path);if(!row)throw Error('Unknown '+path);return {...row,durationMs:180000,metadata:{title:row.id,artist:'Artist '+row.id,album:'Album '+row.id,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:{mimeType:'image/png',filePath:'/covers/'+row.id+'.png',dataUrl:null,byteLen:4}}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_select_folders'){if(window.importFail)throw {code:'INVALID_PATH',message:'injected picker failure',recoverable:true};return window.folderSelection;}
 if(command==='audio_import_playlist'){if(window.importCancel)return null;if(window.saveFail)throw {code:'INTERNAL_ERROR',message:'Cannot persist playlist snapshot',recoverable:true};const result=folder(window.listName==='B'?'b':'m3u8','m3u8');if(window.importMissing){result.sourcePath='/lists/missing.m3u8';result.sourceName='Missing list';result.tracks=result.tracks.map(row=>({...row,available:false}));}result.sourcePath='/lists/'+window.listName+'.m3u8';result.sourceName='List '+window.listName;const prior=JSON.parse(localStorage.getItem('test-playlist-snapshots')||'[]').filter(item=>item.sourcePath!==result.sourcePath);localStorage.setItem('test-playlist-snapshots',JSON.stringify([...prior,result]));return result;}
 if(command==='library_get_playlists'){const result=JSON.parse(localStorage.getItem('test-playlist-snapshots')||'[]');if(window.restoreGate)await new Promise(resolve=>window.pendingRestores.push(resolve));return result;}
 if(command==='library_get_folders'){
  const folders=readRegistry();
  if(window.registryGetGate)await new Promise(resolve=>window.pendingGets.push(resolve));
  return {folders};
 }
 if(command==='library_add_folder'){
  if(window.saveFail)throw {code:'LIBRARY_STORAGE_ERROR',message:'injected save failure',recoverable:true};
  const folders=readRegistry();if(!folders.includes(args.path))writeRegistry([...folders,args.path]);
  return {folders:readRegistry()};
 }
 if(command==='library_clear_folders'){writeRegistry([]);return null}
 if(command==='library_scan_folder'){
  if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));
  if(args.path==='/audio/missing')throw {code:'SOURCE_NOT_FOUND',message:'Folder is missing',recoverable:true};
  const choice=args.path.split('/').at(-1);return folder(choice);
 }
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:folder(window.choice,window.choice==='m3u8'?'m3u8':'folder')};
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:window.dataUrlOnly?{...result.metadata.coverArt,filePath:null,dataUrl:window.coverDataUrl}:result.metadata.coverArt}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_track_thumbnail'){
  window.coverActive++;window.maxCoverActive=Math.max(window.maxCoverActive,window.coverActive);
  try{if(window.pixelGate)await new Promise(resolve=>window.pendingPixels.push(resolve));
  const bytes=new Uint8Array(44),v=new DataView(bytes.buffer);bytes.set([83,80,88,82]);v.setUint16(4,1,true);v.setUint16(6,40,true);for(const [offset,value]of [[8,1],[12,1],[16,4],[20,1],[24,4],[32,1],[36,1]])v.setUint32(offset,value,true);bytes.set([255,0,0,255],40);return bytes;}finally{window.coverActive--;}
 }
 throw Error('Unexpected native command '+command);
};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__imported_playlist_artwork_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 640, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__imported_playlist_artwork_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__imported_playlist_artwork_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__imported_playlist_artwork_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))


const listItems = () => page.evaluate(() => window.viewModel.playlist.library.items.filter(item=>item.sourceKind==='m3u8'))
const noPlayback = async () => {
 assert.equal(await page.evaluate(() => window.viewModel.playback.track?.id??null),null,'no current track was loaded')
 assert.deepEqual(await page.evaluate(() => window.calls.filter(call=>['audio_load_file','audio_load_and_play','audio_open_source','audio_play','audio_transition_playback'].includes(call.command)).map(call=>call.command)),[],'read-only import/browsing makes no playback mutation')
}
const category = async id => {
 await page.evaluate(id=>window.viewModel.playlist.library.onSelectCategory(id),id)
 await page.getByRole('heading',{name:id==='songs'?'全部歌曲':'播放列表',exact:true}).waitFor()
}
const visit=async()=>{
 await page.goto(origin+'/__imported_playlist_artwork_test?run='+Math.random())
 await page.waitForFunction(()=>Boolean(window.viewModel))
 await category('playlists')
}
const waitDecoded = selector => page.waitForFunction(selector=>{
 const image=document.querySelector(selector);return image?.complete&&image.naturalWidth>0
},selector,{timeout:5000})
try {
 await visit()
 await page.locator('.playlist-management-empty').getByRole('button',{name:'导入 M3U8 播放列表',exact:true}).click()
 await page.waitForFunction(()=>!window.viewModel.playlist.library.isImportPending&&window.viewModel.playlist.library.items.some(item=>item.sourceKind==='m3u8'))
 await noPlayback()
 await waitDecoded('.playlist-management-card .playlist-library-cover-image')
 console.log('PASS cold import list artwork without playback')
 assert.equal(await page.locator('.playlist-management-toolbar').getByRole('button',{name:/^(选择文件夹|导入 M3U8 播放列表)$/}).count(),0,'list toolbar has no duplicate import buttons')
 const scope=(await listItems())[0].scope
 await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),scope)
 await page.locator('.playlist-grid').waitFor()
 await waitDecoded('.playlist-card .playlist-card-cover-image')
 assert(await page.locator('.playlist-card-cover-image').count()>0,'cold inactive detail has song artwork')
 await noPlayback()
 console.log('PASS cold imported detail artwork without playback')
 await category('songs')
 assert.equal(await page.locator('.playlist-management-toolbar').getByRole('button',{name:'选择文件夹',exact:true}).count(),0,'song toolbar has no duplicate import')
 assert.equal(await page.locator('.playlist-management-empty').getByRole('button',{name:'选择文件夹',exact:true}).count(),1,'empty songs retains exactly one central folder action')
 await visit()
 await page.waitForFunction(()=>window.viewModel.playlist.library.items.some(item=>item.sourceKind==='m3u8'))
 assert.equal((await listItems()).length,1,'snapshot restores list on restart without source import')
 await waitDecoded('.playlist-management-card .playlist-library-cover-image')
 await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),scope)
 await waitDecoded('.playlist-card .playlist-card-cover-image')
 await noPlayback()
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_import_playlist').length),0,'restart reads snapshot without opening import picker')
 console.log('PASS restart retains snapshot and list/song covers with zero playback')
 await page.evaluate(()=>{window.saveFail=true;window.listName='failed';window.viewModel.playlist.library.onImportPlaylist()})
 await page.waitForFunction(()=>!window.viewModel.playlist.library.isImportPending)
 assert.equal((await listItems()).length,1,'save failure does not publish a false successful import')
 await page.evaluate(()=>{window.saveFail=false;sessionStorage.setItem('playlist-restore-gate','1')})
 await visit()
 await page.waitForFunction(()=>window.pendingRestores.length===1)
 await page.evaluate(()=>{window.listName='B';window.viewModel.playlist.library.onImportPlaylist()})
 await page.waitForFunction(()=>!window.viewModel.playlist.library.isImportPending&&window.viewModel.playlist.library.items.some(item=>item.name==='List B'))
 await page.evaluate(()=>{sessionStorage.removeItem('playlist-restore-gate');window.restoreGate=false;window.pendingRestores.splice(0).forEach(resolve=>resolve())})
 await page.waitForFunction(()=>window.viewModel.playlist.library.items.filter(item=>item.sourceKind==='m3u8').length===2)
 assert.deepEqual(new Set((await listItems()).map(item=>item.name)),new Set(['List A','List B']),'late restore merges without overwriting new imports')
 await noPlayback()
 assert(await page.evaluate(()=>window.maxCoverActive<=2),'read-only artwork pixel loading uses bounded concurrency')
 assert.deepEqual(errors,[],'no browser page errors')
 console.log('PASS save failure and late restore preserve list identities')
 await page.evaluate(()=>sessionStorage.setItem('artwork-pixel-gate','1'))
 await visit()
 await page.waitForFunction(()=>window.pendingPixels.length>=1)
 const restoredItems=await listItems()
 const scopeA=restoredItems.find(item=>item.name==='List A').scope
 const scopeB=restoredItems.find(item=>item.name==='List B').scope
 await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),scopeA)
 await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),scopeB)
 await page.waitForFunction(()=>window.viewModel.playlist.playlistName==='List B')
 await page.evaluate(()=>{sessionStorage.removeItem('artwork-pixel-gate');window.pixelGate=false;window.pendingPixels.splice(0).reverse().forEach(resolve=>resolve())})
 await waitDecoded('.playlist-card .playlist-card-cover-image')
 assert.equal(await page.locator('.playlist-grid .playlist-card').count(),2,'rapid scope switch renders only B song references')
 assert.match(await page.locator('.playlist-grid').innerText(),/b-0/)
 await noPlayback()
 assert(await page.evaluate(()=>window.maxCoverActive<=2),'reverse completion keeps two-pixel concurrency bound')
 console.log('PASS rapid browse and reverse pixel completion retain descriptor identity')
 await visit()
 await waitDecoded('.playlist-management-card .playlist-library-cover-image')
 await page.evaluate(()=>{window.pixelGate=true;const item=window.viewModel.playlist.library.items.find(item=>item.name==='List A');window.viewModel.playlist.library.onSelect(item.scope)})
 await page.waitForFunction(()=>window.pendingPixels.length>=1)
 const createdBeforeUnmount=await page.evaluate(()=>window.created.length)
 assert(createdBeforeUnmount>0,'unmount scenario owns at least one previously published URL')
 await page.evaluate(()=>window.unmountFixture())
 await page.evaluate(()=>{sessionStorage.removeItem('artwork-pixel-gate');window.pixelGate=false;window.pendingPixels.splice(0).forEach(resolve=>resolve())})
 await page.waitForFunction(()=>window.coverActive===0)
 assert.equal(await page.evaluate(()=>window.created.length),createdBeforeUnmount,'late pixel completion after unmount creates no orphan URL')
 assert(await page.evaluate(()=>window.created.every(url=>window.revoked.includes(url))),'unmount revokes all published URLs')
 assert.deepEqual(errors,[],'no browser errors from stale work after unmount')
 console.log('PASS unmount cancels artwork publication and releases owned URLs')
 await page.evaluate(()=>sessionStorage.setItem('artwork-data-only','1'))
 await visit()
 await waitDecoded('.playlist-management-card .playlist-library-cover-image')
 await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),scopeA)
 await waitDecoded('.playlist-card .playlist-card-cover-image')
 await noPlayback()
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_load_playlist_cover_pixels').length),0,'data-URL-only covers decode without a native file-path pixel request')
 assert.deepEqual(errors,[],'data URL fallback does not cause browser errors')
 console.log('PASS data-URL-only list and detail artwork without playback')
 }catch(error){
 console.log('ARTWORK_FAILURE_STATE',JSON.stringify(await page.evaluate(()=>({track:window.viewModel?.playback.track?.id??null,items:window.viewModel?.playlist.library.items.map(item=>({name:item.name,kind:item.sourceKind,hasCover:Boolean(item.coverTrack?.coverThumbnail||item.coverTrack?.coverImage)})),commands:window.calls.map(call=>call.command),images:[...document.querySelectorAll('.playlist-library-cover-image,.playlist-card-cover-image')].map(image=>({src:image.src,decoded:image.complete&&image.naturalWidth>0}))}))))
 throw error
}finally{await browser.close()}
