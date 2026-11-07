// Independent acceptance: actual PlayerShell/PlayerSurface; native transport alone is controlled.
// Real network decoding is separately exercised by audio/network_tests.rs.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const main = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = main.match(new RegExp('"(/[^"\\n]+/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__streams_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import {Toaster} from '/src/components/ui/sonner.tsx';
import '/src/index.css';
window.calls=[];window.failAdd=false;window.failRead=false;window.pendingLoads=[];window.gatePath=null;
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const initial=[
 {id:'alpha',sourceKind:'stream',sourcePath:'https://example.test/Radio?Token=UPPER',fileName:'Alpha Radio',title:'Alpha Radio',createdAtMs:100,available:true},
 {id:'beta',sourceKind:'stream',sourcePath:'https://example.test/radio?Token=lower',fileName:'Beta Radio',title:'Beta Radio',createdAtMs:300,available:true},
 {id:'gamma',sourceKind:'stream',sourcePath:'https://example.test/Gamma',fileName:'Gamma Radio',title:'Gamma Radio',createdAtMs:200,available:true}
];
const local={id:'local',sourceKind:'file',sourcePath:'/music/local.wav',fileName:'local.wav',fileCreatedAtMs:10,available:true};
if(!localStorage.getItem('streams.acceptance.registry'))localStorage.setItem('streams.acceptance.registry',JSON.stringify(initial));
const streams=()=>JSON.parse(localStorage.getItem('streams.acceptance.registry'));
const save=rows=>localStorage.setItem('streams.acceptance.registry',JSON.stringify(rows));
const snapshot=()=>({directoryPath:'',directoryName:'流',sourceKind:'streams',sourcePath:'streams:library',sourceName:'流',selectedIndex:0,tracks:streams()});
const imported=()=>JSON.parse(localStorage.getItem('streams.acceptance.imported')||'[]');
const fullTrack=path=>{
 const descriptor=[local,...streams(),...imported().flatMap(item=>item.tracks)].find(row=>row.sourcePath===path);
 if(!descriptor)throw Error('Unknown path '+path);
 return {...descriptor,durationMs:descriptor.sourceKind==='stream'?null:60000,metadata:{title:descriptor.title||'Local song',artist:descriptor.sourceKind==='stream'?null:'Local artist',album:descriptor.sourceKind==='stream'?null:'Local album',albumArtist:null,composer:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}};
};
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_streams'){if(window.failRead)throw {code:'STORAGE',message:'fixture registry unavailable'};return snapshot()}
 if(command==='library_add_stream'){
  if(window.failAdd)throw {code:'STORAGE',message:'fixture save failure'};
  const url=new URL(input.url);url.hash='';const rows=streams();const old=rows.find(row=>row.sourcePath===url.href);
  if(old){if(input.title){old.title=input.title;old.fileName=input.title}}else rows.push({id:'added-'+rows.length,sourceKind:'stream',sourcePath:url.href,title:input.title||url.href,fileName:input.title||url.href,available:true,createdAtMs:500});
  save(rows);return snapshot();
 }
 if(command==='library_remove_streams'){save(streams().filter(row=>!input.ids.includes(row.id)));return snapshot()}
 if(command==='library_get_playlists')return imported();
 if(command==='library_get_folders')return {revision:0,roots:[{path:'/music',selected:true,directoryRules:[]}]};
 if(command==='library_scan_folder')return {directoryPath:'/music',directoryName:'music',sourceKind:'folder',sourcePath:'/music',sourceName:'music',selectedIndex:0,directoryPaths:['/music'],tracks:[local]};
 if(command==='audio_import_playlist'){
  const added={id:'imported',sourceKind:'stream',sourcePath:'https://example.test/Imported?X=Y',title:'Imported Radio',fileName:'Imported Radio',createdAtMs:600,available:true};
  if(!streams().some(row=>row.id===added.id))save([...streams(),added]);
  const playlist={directoryPath:'/lists',directoryName:'Mixed',sourceKind:'m3u8',sourcePath:'/lists/mixed.m3u8',sourceName:'Mixed',selectedIndex:0,tracks:[local,added]};
  localStorage.setItem('streams.acceptance.imported',JSON.stringify([playlist]));return playlist;
 }
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:0,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  if(command==='audio_load_and_play'&&window.gatePath===input.path){
   const delayedTrack=fullTrack(input.path),delayedGeneration=++generation;
   const delayedState={...state,phase:'playing',generation:delayedGeneration,currentTrackId:delayedTrack.id,durationMs:delayedTrack.durationMs,positionMs:0};
   return new Promise((resolve,reject)=>window.pendingLoads.push({
    reject:error=>reject(error),
    resolve:()=>{window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:delayedGeneration,track:delayedTrack}});resolve({requestId:input.requestId,generation:delayedGeneration,trackId:delayedTrack.id,fileName:delayedTrack.fileName,state:delayedState})}
   }));
  }
  const result=fullTrack(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return fullTrack(input.path);
 if(command==='audio_probe_playlist_cover')return {id:fullTrack(input.path).id,sourcePath:input.path,coverArt:null};
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:fullTrack(sourcePath).durationMs,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const row=fullTrack(sourcePath);return {sourcePath,summary:{title:row.metadata.title,artist:row.metadata.artist,album:row.metadata.album,albumArtist:null,composer:null,genre:null,year:null,bitDepth:null,sampleRateHz:null,bitrateKbps:null,codec:null},error:null}});
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_stop'){state={...state,phase:'stopped',positionMs:0};return {...state}}
 if(command==='audio_seek')throw Error('network seek must never be requested');
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell),React.createElement(Toaster)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__streams_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
// Keep independent acceptance stable while other agents edit unrelated files;
// every explicit navigation still fetches the current production modules.
await page.routeWebSocket('ws://'+new URL(origin).host+'/**', socket=>socket.close())
page.setDefaultTimeout(15000)
page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if(message.type()==='error') console.error('browser:',message.text()) })
page.on('requestfailed', request => console.error('request failed:',request.url(),request.failure()?.errorText))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__streams_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__streams_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__streams_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  if(!localStorage.getItem('streams.acceptance.seeded')){
    localStorage.setItem('streams.acceptance.seeded','1')
    localStorage.removeItem('spmusic.player.session.v1')
    localStorage.setItem('spmusic.most-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'https://example.test/Gamma',playCount:5,lastPlayedAt:200},{sourcePath:'https://example.test/radio?Token=lower',playCount:2,lastPlayedAt:300}]}))
    localStorage.setItem('spmusic.recently-played.v1',JSON.stringify({version:1,entries:[{sourcePath:'https://example.test/Radio?Token=UPPER',lastPlayedAt:1000},{sourcePath:'https://example.test/Gamma',lastPlayedAt:500}]}))
  }
})
const active = () => page.locator('.playlist-management-content:not([inert])')
const card = id => active().locator('[data-playlist-track-id="'+id+'"]')
const toastItems = () => page.locator('[data-sonner-toast]')
const current = id => page.waitForFunction(id=>!window.vm.playback.isSelectionPending&&window.vm.playback.track?.id===id,id)
const gateAlpha = async () => {
  await page.evaluate(()=>{window.gatePath='https://example.test/Radio?Token=UPPER'})
  await card('alpha').click()
  await page.waitForFunction(()=>window.pendingLoads.length===1&&window.vm.playback.isSelectionPending)
}
try {
  await page.goto(origin+'/__streams_test?case=selection-recovery',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.vm?.playlist.library.streamSongs?.length===3&&!window.vm.playlist.library.streamsLoading)
  await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('streams'))
  await card('alpha').waitFor()

  // A live source awaiting its first frame must be replaceable by another row.
  await gateAlpha()
  await card('beta').click()
  await page.waitForFunction(()=>window.calls.some(row=>row.command==='audio_load_and_play'&&row.input.path==='https://example.test/radio?Token=lower'),null,{timeout:2500})
  await current('beta')
  await page.evaluate(()=>{window.pendingLoads.shift().reject({code:'PLAYBACK_FAILED',message:'stale first stream failure',recoverable:true});window.gatePath=null})
  await current('beta')
  assert.equal(await page.getByText('stale first stream failure',{exact:true}).count(),0,'superseded failure is not surfaced')

  // A late success/details reply from A must likewise not replace the newer B.
  await gateAlpha()
  await card('beta').click()
  await current('beta')
  await page.evaluate(()=>{window.pendingLoads.shift().resolve();window.gatePath=null})
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(()=>window.vm.playback.track.id),'beta')
  assert.equal(await page.evaluate(()=>window.vm.playback.isSelectionPending),false)

  // A current decode failure is visible exactly once and releases the selection.
  await gateAlpha()
  await page.evaluate(()=>{window.pendingLoads.shift().reject({code:'UNSUPPORTED_FORMAT',message:'流没有可解码的音频（测试）',recoverable:true});window.gatePath=null})
  await page.waitForFunction(()=>!window.vm.playback.isSelectionPending)
  const visibleFailure=page.getByText('流没有可解码的音频（测试）',{exact:true})
  await visibleFailure.waitFor({state:'visible'})
  assert.equal(await visibleFailure.count(),1)
  assert.equal(await toastItems().filter({hasText:'流没有可解码的音频（测试）'}).count(),1)
  await card('gamma').click()
  await current('gamma')

  // Once a queue exists, the main controller's next button can also replace
  // an unresolved live-source selection instead of leaving transport stuck.
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click()
  const nextButton=page.locator('.control-dock .next-button')
  await nextButton.waitFor({state:'visible'})
  assert.equal(await nextButton.isDisabled(),false)
  await page.evaluate(()=>{window.gatePath='https://example.test/Radio?Token=UPPER'})
  await nextButton.click()
  await page.waitForFunction(()=>window.pendingLoads.length===1&&window.vm.playback.isSelectionPending)
  assert.equal(await nextButton.isDisabled(),false)
  await nextButton.click()
  await current('beta')
  await page.evaluate(()=>{window.pendingLoads.shift().reject({code:'SUPERSEDED',message:'cancelled old stream',recoverable:true});window.gatePath=null})
  await current('beta')
  assert.equal(await page.getByText('cancelled old stream',{exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log('stream selection recovery passed: pending row/next replacement, stale success/error fencing, visible current failure and unlocked subsequent playback')
} catch(error) {
  console.error(await page.evaluate(()=>({vm:Boolean(window.vm),route:window.vm?.playlist.library.route,loading:window.vm?.playlist.library.streamsLoading,rows:window.vm?.playlist.library.streamSongs?.length,body:document.body.innerText.slice(0,1000),calls:window.calls?.slice(-8)})),errors)
  throw error
} finally { await browser.close() }
