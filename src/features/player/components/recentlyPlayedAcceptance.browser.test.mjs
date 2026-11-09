// Independent acceptance: real PlayerShell and PlayerSurface, only native transport replaced.
// Vite must be running at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const main = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = main.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__recents_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingSummaries=[];window.scanGate=false;window.pendingScans=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/hidden'];
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.nativeState=()=>({...state});
const rows=[
 ['a','Shared','Singer A','Album Group','Writer One'],
 ['b','Shared','Singer B','Album Group','Writer Two'],
 ['duet','Shared','Singer A/Singer B','Album Group/Guest/Album Group','Writer One/Writer Two/Writer One'],
 ['missing','Missing','Performer Only',null,null],
 ['literal','Literal','Literal Performer','未知专辑艺术家','未知作曲家'],
 ['other','Other','Singer X','Another Album Credit','Writer Three'],
 ['collab','Other','Singer C','Album Group','Writer One'],
 ['band','Rock','Band Singer','AC/DC','AC/DC'],
 ['hidden','Hidden','Hidden Singer','Hidden Album Credit','Hidden Writer']
];
const descriptors=rows.map(([id])=>({id,sourcePath:(id==='hidden'?'/hidden/':'/music/')+id+'.flac',fileName:id+'.flac',available:true}));
const track=path=>{const descriptor=descriptors.find(row=>row.sourcePath===path);if(!descriptor)throw Error('Unknown path '+path);const row=rows.find(row=>row[0]===descriptor.id);return {...descriptor,durationMs:4000,metadata:{title:'Song '+row[0],artist:row[2],album:row[1],albumArtist:row[3],composer:row[4],genre:null,year:2023,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));const path=args.path;return {directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))}}
 if(command==='library_warm_cover_thumbnails')return {requested:input.paths.length,processed:input.paths.length,written:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:4000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:4000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,composer:item.metadata.composer,year:2023,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(['audio_transition_playback','audio_play','audio_pause'].includes(command)){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__recents_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__recents_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__recents_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__recents_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => { localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); localStorage.removeItem('spmusic.player.session.v1') })
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }

const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.playlist-management-content:not([inert])')
const songs = () => active().locator('.all-songs-list [data-song-key]')
const songIds = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1).replace('.flac', '')))
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id))
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => { await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen); await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen) }
const pulseFor = async (start, count, phase='playing') => page.evaluate(async ({start,count,phase})=>{
  window.pulse(start,phase)
  for(let i=1;i<=count;i++){await new Promise(resolve=>setTimeout(resolve,110));window.pulse(start+i*100,phase)}
}, {start,count,phase})
const play = async id => { await songs().filter({hasText:'Song '+id}).first().click(); await ready() }
const persisted = () => page.evaluate(()=>JSON.parse(localStorage.getItem('spmusic.recently-played.v1')||'{"entries":[]}').entries)
try {
  await page.goto(origin + '/__recents_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 8 && !window.vm.playlist.library.isImportPending)
  await selectCategory('recent-played')
  await page.getByText('暂无最近播放', {exact:true}).waitFor()
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(),0)
  assert(await page.getByRole('button',{name:'播放最近播放',exact:true}).isDisabled())
  await selectCategory('songs'); await songs().first().waitFor()
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(),1)
  const geometry=await songs().first().evaluate(node=>({className:node.className,coverRadius:getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius}))
  await play('a')
  await pulseFor(0,15)
  assert.equal((await persisted()).length,0,'less than 50% does not count')
  await pulseFor(1500,8)
  assert.deepEqual((await persisted()).map(entry=>entry.sourcePath),['/music/a.flac'])
  await pulseFor(2300,5)
  assert.equal((await persisted()).length,1,'same generation counts once')
  await backFromPlayer(); await selectCategory('songs'); await play('missing')
  await page.evaluate(()=>window.vm.timeline.onCommit(3)); await page.waitForFunction(()=>window.vm.timeline.interaction==='following')
  await pulseFor(3000,5)
  assert.equal((await persisted()).length,1,'seek to past half is not listening time')
  await backFromPlayer(); await selectCategory('songs'); await play('b')
  await pulseFor(0,8)
  await pulseFor(800,20,'paused')
  assert.equal((await persisted()).length,1,'paused position updates never count')
  await pulseFor(800,15)

  await backFromPlayer(); await selectCategory('recent-played'); await songs().first().waitFor()
  assert.deepEqual(await songIds(),['b','a'],'newest qualified song first')
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(),0,'recent page hides alphabet index')
  assert.deepEqual(await songs().first().evaluate(node=>({className:node.className,coverRadius:getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius})),geometry,'same song card styles')
  assert.equal(await page.locator('.playlist-playback-dock:not([data-dock-superseded])').count(),1,'shared playback controller present')
  await screenshot('recently-played-list')
  await play('a')
  assert.deepEqual(await queueIds(),['b','a'],'row playback uses recent scope order')
  const queueBefore=await queueIds()
  await pulseFor(0,23)
  assert.deepEqual(await queueIds(),queueBefore,'statistics reorder does not alter queue')
  await backFromPlayer(); await selectCategory('recent-played')
  assert.deepEqual(await songIds(),['a','b'],'replaying a song updates unique entry')
  assert.equal((await persisted()).length,2)
  await page.reload(); await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===8&&!window.vm.playlist.library.isImportPending)
  await selectCategory('recent-played'); await songs().first().waitFor()
  assert.deepEqual(await songIds(),['a','b'],'reload retains recent entries')
  await page.getByRole('button',{name:'随机播放最近播放',exact:true}).click();await ready()
  assert.deepEqual((await queueIds()).sort(),['a','b'],'shuffle remains scoped')
  await backFromPlayer();await selectCategory('songs');await play('band')
  await page.evaluate(()=>window.vm.timeline.onCommit(.1));await page.waitForFunction(()=>window.vm.timeline.interaction==='following')
  await page.waitForTimeout(1000)
  await pulseFor(100,23)
  assert((await persisted()).some(entry=>entry.sourcePath==='/music/band.flac'),'successful seek must not permanently disable subsequent listening stats')
  assert.deepEqual(errors,[])
  console.log('recently played: real page empty/full, shared card/controller, no index, true playback threshold, unique recency, stable scoped queue, shuffle and reload passed')
} catch(error) {
  await screenshot('recently-played-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,text:document.querySelector('.playlist-management-content:not([inert])')?.innerText,keys:Object.keys(window.vm?.playlist.library??{}),state:window.nativeState?.()})),errors)
  throw error
} finally {await browser.close()}
