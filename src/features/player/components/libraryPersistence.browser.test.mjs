// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright package.
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
import {PlayerSurface as RealSurface} from '/__library_persistence_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.choice='a';window.scanGate=sessionStorage.getItem('library-test-scan-gate')==='1';window.pendingScans=[];window.registryGetGate=sessionStorage.getItem('library-test-get-gate')==='1';window.pendingGets=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const registryKey='spmusic-test-native-library-registry';
const readRegistry=()=>JSON.parse(localStorage.getItem(registryKey)||'[]');
const writeRegistry=folders=>localStorage.setItem(registryKey,JSON.stringify(folders));
const entries={a:[['a-0','/audio/a/0.flac'],['shared','/audio/common/shared.flac']],b:[['b-0','/audio/b/0.flac'],['shared','/audio/common/shared.flac']],sidecar:[['sidecar-0','/audio/sidecar/0.flac']],m3u8:[['list-0','/audio/list/0.flac']]};
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const folder=(choice,sourceKind='folder')=>({directoryPath:'/audio/'+choice,directoryName:'Folder '+choice,sourceKind,sourcePath:sourceKind==='folder'?'/audio/'+choice:'/lists/'+choice+'.m3u8',sourceName:'List '+choice,selectedIndex:0,tracks:entries[choice].map(descriptor)});
const all=new Map(Object.values(entries).flat().map(pair=>[pair[1],descriptor(pair)]));
const track=path=>{const row=all.get(path);if(!row)throw Error('Unknown '+path);return {...row,durationMs:180000,metadata:{title:row.id,artist:'Artist '+row.id,album:'Album '+row.id,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_select_folders')return ['/audio/'+window.choice];
 if(command==='audio_import_playlist')return folder(window.choice,'m3u8');
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders'){
  const folders=readRegistry();
  if(window.registryGetGate)await new Promise(resolve=>window.pendingGets.push(resolve));
  return {folders};
 }
 if(command==='library_add_folder'){
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
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries')return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__library_persistence_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 640, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__library_persistence_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__library_persistence_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__library_persistence_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
const visit = async () => {
  await page.goto(origin + '/__library_persistence_test?run=' + Math.random())
  await page.waitForFunction(() => Boolean(window.viewModel))
  await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
}
const importChoice = async choice => {
  await page.evaluate(choice => {window.choice=choice;if(choice==='m3u8')window.viewModel.playlist.library.onImportPlaylist();else window.viewModel.playlist.library.onSelectFolders()}, choice)
  await page.waitForFunction(() => !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending && !window.viewModel.playlist.library.isImportPending)
}
const songs = () => page.evaluate(() => window.viewModel.playlist.library.allSongs.map(row => row.trackId))
const registry = () => page.evaluate(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry') || '[]'))
const clear = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const button = page.getByRole('button', { name: '清空歌曲选择' })
  await button.waitFor()
  await button.click()
  await page.waitForFunction(() => document.querySelector('.player-settings-library-row button')?.disabled)
  await page.keyboard.press('Escape')
}
try {
  await visit()
  await importChoice('a')
  await importChoice('b')
  await importChoice('m3u8')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry') || '[]').length === 2)
  assert.deepEqual(await registry(), ['/audio/a', '/audio/b'], 'only folders are saved')
  assert.deepEqual(await songs(), ['a-0', 'shared', 'b-0'], 'folder songs dedupe; m3u8 excluded')
  await importChoice('a')
  assert.deepEqual(await registry(), ['/audio/a', '/audio/b'], 'reimport does not duplicate folder')
  await visit()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 3)
  assert.deepEqual(await songs(), ['a-0', 'shared', 'b-0'], 'reloaded app rescans both folders')
  assert.equal(await page.evaluate(() => window.viewModel.playlist.library.items.filter(item=>item.sourceKind!=='folder').length), 0, 'folder restore creates no user playlists')
  assert.equal(await page.evaluate(() => window.viewModel.playback.track?.id ?? null), null, 'restore does not start playback')
  assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.command === 'library_scan_folder').map(call => call.args.path)), ['/audio/a', '/audio/b'], 'restore uses direct directory scan')
  await importChoice('sidecar')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry') || '[]').length === 3)
  await visit()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 4)
  assert((await songs()).includes('sidecar-0'), 'folder containing sidecar m3u8 restores via folder scan')
  await clear()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 0)
  assert.deepEqual(await registry(), [], 'clear removes persisted selection')
  assert.equal(await page.evaluate(() => window.viewModel.playback.track?.id ?? null), null, 'clear on restored library does not start playback')
  await visit()
  assert.deepEqual(await songs(), [], 'clear survives reload')
  await importChoice('a')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry') || '[]').length === 1)
  await page.evaluate(() => {const row=window.viewModel.playlist.library.allSongs[0];window.viewModel.playlist.library.onPlaySong(row.scope,row.trackId)})
  await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0' && !window.viewModel.playback.isSelectionPending)
  const activeId = await page.evaluate(() => window.viewModel.playback.track?.id)
  await clear()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 0)
  assert.equal(await page.evaluate(() => window.viewModel.playback.track?.id), activeId, 'clear preserves current playback')
  assert.deepEqual(await registry(), [], 'active playback does not immediately reregister folder')
  await visit()
  assert.deepEqual(await songs(), [], 'active folder stays cleared after reload')
  await page.evaluate(() => localStorage.setItem('spmusic-test-native-library-registry', JSON.stringify(['/audio/a','/audio/b'])))
  await page.evaluate(() => sessionStorage.setItem('library-test-scan-gate', '1'))
  await page.reload()
  await page.waitForFunction(() => window.pendingScans?.length === 2)
  await clear()
  await page.evaluate(() => {sessionStorage.removeItem('library-test-scan-gate');window.scanGate=false;window.pendingScans.splice(0).forEach(resolve => resolve())})
  await page.waitForTimeout(100)
  assert.deepEqual(await songs(), [], 'late scans cannot repopulate cleared library')
  assert.deepEqual(await registry(), [], 'late scans cannot restore registry')
  await page.evaluate(() => localStorage.setItem('spmusic-test-native-library-registry', JSON.stringify(['/audio/missing'])))
  await visit()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '/audio/missing' }).waitFor()
  assert.deepEqual(await registry(), ['/audio/missing'], 'unavailable folder remains selected')
  await page.evaluate(() => {
    localStorage.setItem('spmusic-test-native-library-registry', '[]')
    sessionStorage.setItem('library-test-get-gate', '1')
  })
  await visit()
  await page.waitForFunction(() => window.pendingGets.length === 1)
  await importChoice('a')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry') || '[]').length === 1)
  await page.evaluate(() => {
    sessionStorage.removeItem('library-test-get-gate')
    window.registryGetGate=false
    window.pendingGets.splice(0).forEach(resolve => resolve())
  })
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length === 2)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByText('已选择 1 个文件夹').waitFor()
  assert.deepEqual(errors, [], 'no browser page errors')
  console.log('library persistence: import, dedupe, reload, m3u8 exclusion, sidecar, clear, stale scan/get, playback, and errors passed')
} finally {
  await browser.close()
}
