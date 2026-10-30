// Independent acceptance test: actual PlayerShell and filesystem transport fixture.
// Run with Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

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
import {PlayerSurface as RealSurface} from '/__album_library_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const large=new URLSearchParams(location.search).has('large');
const covers=new URLSearchParams(location.search).has('cover');
const roots=['/music','/music/Box','/external','/empty','/missing','/hidden'];
const rows=[
 ['echo-a','/music/A/one.flac','Echo','Ann','Ann'],
 ['echo-b','/external/B/two.flac','Echo','Bob','Bob'],
 ['disc1','/music/Box/Disc1/a.flac','Box','Singer A','Ensemble'],
 ['disc2','/music/Box/Disc2/b.flac','Box','Singer B','Ensemble'],
 ['mix-a','/music/Compilation/a.flac','Mixed','Singer A',null],
 ['mix-b','/music/Compilation/b.flac','Mixed','Singer B',null],
 ['home-a','/music/Fallback/a.flac','Home','Solo A',null],
 ['home-b','/external/Fallback/b.flac','Home','Solo B',null],
 ['unknown-a','/music/U/a.flac',null,null,null],
 ['unknown-b','/external/U/b.flac',null,null,null],
 ['literal','/music/Literal/a.flac','本地音频','Literal','Literal'],
 ['bad','/music/Bad/a.flac',null,null,null],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden','Hidden'],
 ...Array.from({length:1000},(_,i)=>['zed-'+i,'/music/Zed'+String(i).padStart(2,'0')+'/song.flac','Zed '+String(i).padStart(2,'0'),'Zed Artist','Zed Artist'])
];
if(large)rows.push(...Array.from({length:180},(_,i)=>['large-'+i,'/music/Large/'+i+'.flac','Large','Large Singer','Large Artist']));
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor);
const all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,
 directoryPaths:path==='/legacy'?undefined:path==='/branch'?['/branch','/branch/child']:path==='/music'?['/music','/music/Album','/music/Album/Disc','/music/Silent']:path==='/music/Album'?['/music/Album','/music/Album/Disc']:[path],
 tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:(row.id.startsWith('zed-')?'Zed song ':'Title ')+row.id,artist:tags[3],album:tags[2],albumArtist:tags[4],genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){
  if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));
  if(args.path==='/missing')throw {code:'FILE_NOT_FOUND',message:'Folder is missing',recoverable:true};
  return folder(args.path);
 }
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_folder_thumbnail'){
  if(!covers)return new Uint8Array(0);
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);view.setUint32(8,1,true);view.setUint32(12,1,true);view.setUint32(16,4,true);view.setUint32(20,1,true);view.setUint32(24,4,true);view.setUint32(32,1,true);view.setUint32(36,1,true);bytes.set([255,0,0,255],40);return bytes;
 }
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);if(item.id==='bad')return {sourcePath,summary:null,error:{code:'DECODE_FAILED',message:'Unreadable tags',recoverable:true}};return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__album_library_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
const consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.error('BROWSER_CONSOLE', message.text()) } })
page.on('requestfailed', request => console.error('BROWSER_REQUEST_FAILED', request.url(), request.failure()?.errorText))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__album_library_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__album_library_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__album_library_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
})


if (process.env.SPMUSIC_ALBUM_BASELINE) {
 await page.route('**/src/features/player/components/AlbumLibraryPanel.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(process.env.SPMUSIC_ALBUM_BASELINE, 'utf8') }));
}
try {
 await page.goto(origin+'/__album_library_test?cover=1');
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===1012&&!window.vm.playlist.library.isImportPending);
 const samples=await page.evaluate(async()=>{
  const gaps=[];let running=true,last=performance.now();
  function tick(now){gaps.push(now-last);last=now;if(running)requestAnimationFrame(tick)}requestAnimationFrame(tick);
  const start=performance.now();window.vm.playlist.library.onSelectCategory('album');
  while(!document.querySelector('.album-card')||window.vm.playlist.library.allSongsMetadataStatus!=='ready')await new Promise(requestAnimationFrame);
  await new Promise(resolve=>setTimeout(resolve,750));running=false;
  return {elapsed:performance.now()-start,maxGap:Math.max(...gaps),longFrames:gaps.filter(v=>v>50).length,cards:document.querySelectorAll('.album-card').length};
 });
 console.log(JSON.stringify(samples));assert.deepEqual(errors,[]);
 if (!process.env.SPMUSIC_ALBUM_BASELINE) {
  assert(samples.cards < 100, 'first screen mounts a bounded album window');
  await page.getByRole('button', { name: '查找 Z 开头的专辑', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.album-card')].some(card=>card.textContent.includes('Zed')));
  await page.evaluate(() => { const panel=document.querySelector('.album-library-content:not([inert])');panel.scrollTop=panel.scrollHeight; });
  await page.waitForFunction(() => [...document.querySelectorAll('.album-card')].some(card=>card.textContent.includes('Zed 999')));
  const last=page.locator('.album-card').last();
  await last.click();
  await page.locator('.album-hero').waitFor();
  await page.getByRole('button', {name:'返回专辑',exact:true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.album-card')].some(card=>card.textContent.includes('Zed 999')));
  assert(await page.locator('.album-card').count()<100, 'return restores a bounded window at previous scroll');
 }
} finally {await browser.close()}
