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
import {PlayerSurface as RealSurface} from '/__library_folder_import_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.choice='a';window.folderSelection=['/audio/a'];window.importCancel=false;window.importMissing=false;window.importFail=false;window.scanGate=sessionStorage.getItem('library-test-scan-gate')==='1';window.pendingScans=[];window.registryGetGate=sessionStorage.getItem('library-test-get-gate')==='1';window.pendingGets=[];
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
 if(command==='library_select_folders'){if(window.importFail)throw {code:'INVALID_PATH',message:'injected picker failure',recoverable:true};return window.folderSelection;}
 if(command==='audio_import_playlist'){if(window.importCancel)return null;const result=folder('m3u8','m3u8');if(window.importMissing){result.sourcePath='/lists/missing.m3u8';result.sourceName='Missing list';result.tracks=result.tracks.map(row=>({...row,available:false}));}return result;}
 if(command==='library_get_playlists')return [];
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
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__library_folder_import_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 640, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__library_folder_import_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__library_folder_import_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__library_folder_import_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))

const library = () => page.evaluate(() => ({
  songs: window.viewModel.playlist.library.allSongs.map(row => row.trackId),
  lists: window.viewModel.playlist.library.items.filter(item=>item.sourceKind!=='folder').map(item=>({scope:item.scope,name:item.name,kind:item.sourceKind,count:item.trackCount})),
  track: window.viewModel.playback.track?.id ?? null,
  queue: window.viewModel.queue.tracks.map(row=>row.id),
}))
const settled = () => page.waitForFunction(() => !window.viewModel.playlist.library.isImportPending && !window.viewModel.playback.isSelectionPending)
const songPage = async () => {
  await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await page.getByRole('heading', {name:'全部歌曲'}).waitFor()
}
const selectFolders = async paths => {
  await page.evaluate(paths => { window.folderSelection=paths }, paths)
  if(await page.locator('.playlist-management-empty').count()) await page.locator('.playlist-management-empty').getByRole('button',{name:'选择文件夹',exact:true}).click()
  else {await page.getByRole('button',{name:'更多列表操作'}).click();await page.getByRole('menuitem',{name:'选择文件夹',exact:true}).click()}
  await settled()
}
const playbackCommands = () => page.evaluate(() => window.calls.filter(call=>['audio_load_file','audio_load_and_play','audio_play','audio_transition_playback'].includes(call.command)).length)
try {
  await page.goto(origin+'/__library_folder_import_test?run=1')
  await page.waitForFunction(() => Boolean(window.viewModel) && window.viewModel.playlist.library.allSongsMetadataStatus==='ready')
  await songPage()
  await page.locator('.playlist-management-empty').getByRole('button',{name:'选择文件夹',exact:true}).waitFor()
  assert.equal(await page.locator('.playlist-management-toolbar').getByRole('button',{name:'选择文件夹',exact:true}).count(),0, 'toolbar has no duplicate folder import button')
  await selectFolders(null)
  assert.deepEqual((await library()).songs,[], 'cancel leaves library unchanged')
  await page.evaluate(() => {window.importFail=true})
  await selectFolders(['/audio/a'])
  assert.deepEqual((await library()).songs,[], 'picker failure leaves library unchanged')
  await page.evaluate(() => {window.importFail=false})
  await selectFolders(['/audio/missing'])
  assert.deepEqual((await library()).songs,[], 'failed scan does not register songs')
  await page.evaluate(() => {window.saveFail=true})
  await selectFolders(['/audio/a'])
  assert.deepEqual((await library()).songs,[], 'failed registry save does not register songs')
  await page.evaluate(() => {window.saveFail=false})
  await selectFolders(['/audio/a','/audio/b','/audio/a'])
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongsMetadataStatus==='ready' && window.viewModel.playlist.library.allSongs.length===3)
  assert.deepEqual((await library()).songs,['a-0','shared','b-0'], 'multiple selected folders aggregate and dedupe')
  assert.deepEqual((await library()).lists,[], 'folder selection creates no user playlist')
  assert.equal((await library()).track,null, 'folder selection does not load the first song')
  assert.equal(await playbackCommands(),0, 'folder import performs no playback mutation')
  await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('playlists'))
  await page.getByRole('heading',{name:'播放列表',exact:true}).waitFor()
  assert.equal(await page.locator('.playlist-management-card').count(),0, 'playlist category renders no folder cards')
  await songPage()
  assert.equal(await page.locator('.all-songs-list .playlist-card').count(),3, 'ready summaries and durations produce all rows')
  await selectFolders(['/audio/a'])
  assert.deepEqual((await library()).songs,['a-0','shared','b-0'], 'reimport is idempotent')
  await page.locator('.all-songs-list .playlist-card').filter({hasText:'a-0'}).click()
  await page.waitForFunction(() => window.viewModel.playback.track?.id==='a-0' && !window.viewModel.playback.isSelectionPending)
  const playing=await library()
  const beforeImportCommands=await playbackCommands()
  await selectFolders(['/audio/sidecar'])
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongsMetadataStatus==='ready')
  assert.equal((await library()).track,playing.track, 'folder selection retains current track')
  assert.deepEqual((await library()).queue,playing.queue, 'folder selection retains active queue')
  assert.equal(await playbackCommands(),beforeImportCommands, 'adding another folder does not restart playback')
  assert.equal((await library()).lists.length,0, 'playing folder songs does not register a user playlist')
  const songsBeforeList=(await library()).songs
  await page.evaluate(() => window.viewModel.playlist.library.onImportPlaylist())
  await settled()
  assert.deepEqual((await library()).songs,songsBeforeList, 'M3U8 references do not expand library')
  assert.equal((await library()).lists.length,1, 'M3U8 registers one user list')
  assert.equal((await library()).track,playing.track, 'M3U8 import retains track')
  assert.deepEqual((await library()).queue,playing.queue, 'M3U8 import retains queue')
  assert.equal(await playbackCommands(),beforeImportCommands, 'M3U8 import does not load or play entries')
  await page.evaluate(() => window.viewModel.playlist.library.onImportPlaylist())
  await settled()
  assert.equal((await library()).lists.length,1, 'reimport replaces same list without duplicates')
  await page.evaluate(() => {window.importCancel=true;window.viewModel.playlist.library.onImportPlaylist()})
  await settled()
  assert.equal((await library()).lists.length,1, 'cancelled M3U8 picker retains lists')
  await page.evaluate(() => {window.importCancel=false;window.importMissing=true;window.viewModel.playlist.library.onImportPlaylist()})
  await settled()
  assert.equal((await library()).lists.length,2, 'all-missing M3U8 still registers a list')
  assert.deepEqual((await library()).songs,songsBeforeList, 'missing references do not expand library')
  await page.getByRole('button',{name:'选择',exact:true}).click()
  await page.locator('.all-songs-list .playlist-card').filter({hasText:'shared'}).click()
  for (const width of [640,800]) {
    await page.setViewportSize({width,height:1000})
    await page.getByRole('button',{name:'新建播放列表',exact:true}).waitFor()
    const geometry=await page.evaluate(() => {
      const toolbar=document.querySelector('.playlist-management-toolbar')
      const rect=toolbar.getBoundingClientRect()
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,
        buttons:[...toolbar.querySelectorAll('button')].filter(button=>button.textContent==='选择文件夹'||button.textContent==='新建播放列表').map(button=>{const r=button.getBoundingClientRect();return {name:button.textContent,left:r.left,right:r.right}})}
    })
    assert(geometry.scrollWidth<=geometry.width, 'selected toolbar does not cause horizontal page overflow at '+width)
    assert.equal(geometry.buttons.length,1, 'only create control remains in selected toolbar at '+width)
    assert(geometry.buttons.every(button=>button.left>=geometry.left&&button.right<=geometry.right&&button.right<=geometry.width), 'folder and create controls fit toolbar at '+width)
  }
  await page.getByRole('button',{name:'新建播放列表',exact:true}).click()
  await page.getByRole('textbox',{name:'播放列表名称',exact:true}).fill('Selected songs')
  await page.getByRole('button',{name:'创建',exact:true}).click()
  await page.waitForFunction(() => window.viewModel.playlist.library.items.some(item=>item.sourceKind==='custom'&&item.name==='Selected songs'))
  const custom=(await library()).lists.find(item=>item.kind==='custom')
  assert.equal(custom.count,1, 'self-created list contains only the selected song')
  assert.deepEqual((await library()).songs,songsBeforeList, 'self-created list leaves library unchanged')
  assert.equal((await library()).track,playing.track, 'self-created list leaves playback unchanged')
  await page.evaluate(scope=>window.viewModel.playlist.library.onSelect(scope),custom.scope)
  await page.locator('.playlist-grid:not(.all-songs-list)').waitFor()
  assert.equal(await page.locator('.playlist-grid:not(.all-songs-list) .playlist-card').count(),1, 'custom detail contains exactly selected reference')
  assert.match(await page.locator('.playlist-grid:not(.all-songs-list)').innerText(),/shared/)
  await page.locator('.playlist-grid:not(.all-songs-list) .playlist-card').click()
  await page.waitForFunction(() => window.viewModel.playback.track?.id==='shared' && !window.viewModel.playback.isSelectionPending)
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'清空歌曲选择',exact:true}).click()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length===0)
  assert.equal((await library()).lists.length,3, 'clearing folder selection preserves imported and custom lists')
  assert.equal((await library()).track,'shared', 'clearing folder selection preserves current playback')
  await page.keyboard.press('Escape')
  await songPage()
  await selectFolders(['/audio/a'])
  await page.evaluate(() => {window.scanGate=true;window.folderSelection=['/audio/b']})
  const pickerCount=await page.evaluate(() => window.calls.filter(call=>call.command==='library_select_folders').length)
  await page.getByRole('button',{name:'更多列表操作'}).click()
  await page.getByRole('menuitem',{name:'选择文件夹',exact:true}).click()
  await page.waitForFunction(() => window.pendingScans.length===1)
  await page.evaluate(() => window.viewModel.playlist.library.onSelectFolders())
  assert.equal(await page.evaluate(() => window.calls.filter(call=>call.command==='library_select_folders').length),pickerCount+1, 'repeated import while pending launches only one picker')
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'清空歌曲选择',exact:true}).click()
  await page.waitForFunction(() => window.viewModel.playlist.library.allSongs.length===0)
  await page.evaluate(() => {window.scanGate=false;window.pendingScans.splice(0).forEach(resolve=>resolve())})
  await settled()
  assert.deepEqual((await library()).songs,[], 'late interactive scan cannot repopulate cleared library')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('spmusic-test-native-library-registry')).length),0, 'late interactive scan cannot reregister a cleared folder')
  assert.equal((await library()).lists.length,3, 'interactive scan cancellation leaves user lists intact')
  assert.deepEqual(errors,[], 'no browser page errors')
  console.log('folder/library separation: real picker button, cancellation/error, multi-folder dedupe, no automatic playback/list, M3U8 reference lists, missing entries, custom selected list, and clear isolation passed')
} finally {
  await browser.close()
}
