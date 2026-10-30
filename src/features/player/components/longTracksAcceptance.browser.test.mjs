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
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__long_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.durationGate=true;window.pendingDurations=[];window.calls=[];window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingSummaries=[];window.scanGate=false;window.pendingScans=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/hidden'];
window.pulse=(positionMs,phase=state.phase)=>{state={...state,positionMs,phase};window.listeners?.audio_state_changed?.({payload:{...state}})};
window.nativeState=()=>({...state});
const rows=[
 ['below',899999],['equal',900000],['above',900001],['hour',3600000],
 ['unknown',null],['negative',-1],['nan',NaN],['hidden',7200000],
 ...Array.from({length:96},(_,i)=>['filler'+i,60000]),['tail',1800000]
];
const descriptors=rows.map(([id])=>({id,sourcePath:(id==='hidden'?'/hidden/':'/music/')+id+'.flac',fileName:id+'.flac',available:true}));
const track=path=>{const descriptor=descriptors.find(row=>row.sourcePath===path);if(!descriptor)throw Error('Unknown path '+path);const row=rows.find(row=>row[0]===descriptor.id);return {...descriptor,durationMs:row[1],metadata:{title:'Song '+row[0],artist:'Singer',album:'Album',albumArtist:'Singer',composer:'Composer',genre:null,year:2023,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
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
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:result.durationMs,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations'){if(window.durationGate)await new Promise(resolve=>window.pendingDurations.push(resolve));return input.paths.map(sourcePath=>({sourcePath,durationMs:Number.isFinite(track(sourcePath).durationMs)&&track(sourcePath).durationMs>=0?track(sourcePath).durationMs:null,error:null}));}
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
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__long_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__long_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__long_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__long_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
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
const play = async id => { await songs().filter({hasText:'Song '+id}).first().click(); await ready() }
const longIds = () => page.evaluate(() => window.vm.playlist.library.longSongs?.map(song=>song.trackId))
const options = async () => {
  await page.getByRole('button', { name: '更多列表操作', exact: true }).click()
  await page.getByRole('button', { name: '列表选项', exact: true }).click()
  await page.getByRole('dialog', { name: '长 · 列表选项' }).waitFor()
}
const setMinimum = async minutes => {
  await options()
  await page.getByLabel('最小时长（分钟）', { exact: true }).fill(String(minutes))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('dialog', { name: '长 · 列表选项' }).waitFor({ state: 'hidden' })
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })
}
try {
  await page.goto(origin + '/__long_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 104 && !window.vm.playlist.library.isImportPending)
  await selectCategory('long-tracks')
  await page.waitForFunction(() => window.pendingDurations.length > 0)
  assert.deepEqual(await longIds(), [], 'unknown durations cannot be inferred from pending rows')
  assert.equal(await songs().count(), 0)
  await page.evaluate(() => { window.durationGate=false; window.pendingDurations.splice(0).forEach(resolve=>resolve()) })
  await page.waitForFunction(() => window.vm.playlist.library.longSongs?.length === 4)
  await songs().first().waitFor()
  assert.deepEqual((await longIds()).sort(), ['above', 'equal', 'hour', 'tail'], 'inclusive 15 minute bound and offscreen tail discovered without visiting all songs')
  assert.deepEqual((await songIds()).sort(), ['above', 'equal', 'hour', 'tail'])
  assert.equal(await page.evaluate(() => window.vm.playlist.library.longTracksMinDurationMs), 900000)
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(), 1, 'long page reuses right alphabet index')
  assert.equal(await page.locator('.playlist-playback-dock:not([data-dock-superseded])').count(), 1, 'long page reuses bottom playback controller')
  assert(await page.getByRole('button', { name: '播放长', exact: true }).isEnabled(), 'play action above controller present')
  assert(await page.getByRole('button', { name: '随机播放长', exact: true }).isEnabled(), 'shuffle action above controller present')
  const geometry = await songs().first().evaluate(node => ({ className: node.className, coverRadius: getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius }))
  await screenshot('long-tracks-list')
  await selectCategory('songs'); await songs().first().waitFor()
  assert.deepEqual(await songs().first().evaluate(node => ({ className: node.className, coverRadius: getComputedStyle(node.querySelector('.playlist-card-cover')).borderRadius })), geometry, 'same AllSongsCard styles')
  assert.equal(await page.locator('.playlist-management:not([inert]) .playlist-management-quick-index').count(), 1)
  await selectCategory('long-tracks')
  await play('equal')
  assert.deepEqual((await queueIds()).sort(), ['above', 'equal', 'hour', 'tail'], 'row playback snapshots only long songs')
  const queueBefore = await queueIds()
  await backFromPlayer()
  await page.waitForFunction(() => window.vm.playlist.library.route.categoryId === 'long-tracks')
  await setMinimum(30)
  await page.waitForFunction(() => window.vm.playlist.library.longSongs.length === 2)
  assert.deepEqual((await longIds()).sort(), ['hour', 'tail'])
  assert.deepEqual(await queueIds(), queueBefore, 'threshold changes cannot mutate current queue snapshot')
  await options()
  await page.getByLabel('最小时长（分钟）', { exact: true }).fill('-1')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  assert.equal(await page.getByRole('dialog', { name: '长 · 列表选项' }).count(), 1, 'invalid threshold does not close settings')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.longTracksMinDurationMs), 1800000)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '随机播放长', exact: true }).click(); await ready()
  assert.deepEqual((await queueIds()).sort(), ['hour', 'tail'], 'shuffle uses new threshold')
  await backFromPlayer()
  await setMinimum(120)
  await page.waitForFunction(() => window.vm.playlist.library.longSongs.length === 0)
  assert.equal(await songs().count(), 0)
  assert(await page.getByRole('button', { name: '播放长', exact: true }).isDisabled(), 'empty filtered list cannot play')
  await screenshot('long-tracks-empty')
  await setMinimum(15)
  await page.waitForFunction(() => window.vm.playlist.library.longSongs.length === 4)
  await page.reload()
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 104)
  await selectCategory('long-tracks')
  await page.evaluate(() => { window.durationGate=false; window.pendingDurations.splice(0).forEach(resolve=>resolve()) })
  await page.waitForFunction(() => window.vm.playlist.library.longSongs.length === 4)
  assert.equal(await page.evaluate(() => window.vm.playlist.library.longTracksMinDurationMs), 900000, 'saved threshold survives reload')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const search = page.getByRole('searchbox', { name: '聚合搜索' })
  await search.fill('tail')
  await page.locator('.search-page:not([hidden]) .search-songs .playlist-card').filter({ hasText: 'Song tail' }).waitFor()
  await page.getByRole('button', { name: '播放搜索结果', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['tail'], 'shared aggregate search plays its matching result')
  await backFromPlayer()
  await page.evaluate(() => window.vm.search.onOpenChange(false))
  await selectCategory('long-tracks')
  await active().getByRole('button', { name: '选择', exact: true }).click()
  const beforeReorder = await songIds()
  const fullBefore = await page.evaluate(() => [...window.vm.playlist.library.allSongs].sort((a, b) => new Intl.Collator(undefined, { numeric: true }).compare(a.track.title, b.track.title)).map(song => song.sourcePath))
  await songs().first().focus()
  await songs().first().press('Alt+ArrowDown')
  await page.waitForFunction(() => Boolean(localStorage.getItem('spmusic.song-manual-order.v1')))
  const savedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('spmusic.song-manual-order.v1')).orders.find(order => order.scope === null).paths)
  assert.equal(savedOrder.length, 104, 'filtered reorder retains every library song')
  assert.equal(new Set(savedOrder).size, 104)
  assert(savedOrder.includes('/music/below.flac'), 'short songs remain in the full saved order')
  const longPaths = new Set(beforeReorder.map(id => '/music/' + id + '.flac'))
  fullBefore.forEach((path, index) => { if (!longPaths.has(path)) assert.equal(savedOrder[index], path, 'non-long songs retain their full-list positions') })
  const expected = [...beforeReorder]; [expected[0], expected[1]] = [expected[1], expected[0]]
  await page.waitForFunction(expected => {
    const nodes = document.querySelectorAll('.playlist-management-content:not([inert]) .all-songs-list [data-song-key]')
    return JSON.stringify([...nodes].map(node => node.dataset.songKey.split('/').at(-1).replace('.flac', ''))) === JSON.stringify(expected)
  }, expected)
  await page.getByRole('button', { name: '退出选择', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('long tracks: delayed whole-library duration discovery, inclusive 15-minute filter, shared card/index/controller/actions, row/shuffle/search scope, stable queue, invalid settings, empty state, return, reload and filtered reorder passed')
} catch(error) {
  await screenshot('long-tracks-failure')
  console.error(await page.evaluate(()=>({route:window.vm?.playlist.library.route,text:document.querySelector('.playlist-management-content:not([inert])')?.innerText,keys:Object.keys(window.vm?.playlist.library??{}),calls:window.calls.slice(-8)})),errors)
  throw error
} finally {await browser.close()}
