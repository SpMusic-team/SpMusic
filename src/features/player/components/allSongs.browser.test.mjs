// Run with Vite on :5173 and SPMUSIC_PLAYWRIGHT pointing to a Playwright package.
// The real shell, UI, player hook and command parser run against a deterministic
// native transport. Covers aggregation and interaction across imported sources.
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
import {PlayerSurface as RealSurface} from '/__all_songs_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.choice='a';window.summaryGate=false;window.pendingSummaries=[];window.pendingHydrations=[];window.coverPerfHydrateGate=false;window.coverPerfPixelGate=false;window.pendingPixelLoads=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const boundaryTitles=['#Lov3 #Ngẫu Hứng','#ТАМАДА (DJ Mexx & DJ Dikson Remix)','(What Is) Love?','+ERABY+E CONNEC+1ON'];
const angleTitle='<<wr/d::maker>> ~Harmony in Re...';
const bracketTitle='[Bonus] Song';
const orderTitles=[boundaryTitles[3],boundaryTitles[2],boundaryTitles[1],boundaryTitles[0],'03-Can I be Survived','143 (extended mix)',...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ',letter=>letter+' Song'),'ýuarðina','βios','Вдох',angleTitle,bracketTitle];
const indexFolders={idxPlus:boundaryTitles[3],idxParen:boundaryTitles[2],idxHashCyrillic:boundaryTitles[1],idxHashLatin:boundaryTitles[0],idxZero:'03 Numbers',idxAngle:angleTitle,idxBracket:bracketTitle,idxA:'A Folder',idxB:'B Folder',idxC:'C Folder',idxZ:'Z Folder',idxAccent:'ýuarðina',idxGreek:'βios',idxCyrillic:'Вдох'};
const descriptors={
 a:[['a-0','/audio/a/0.flac'],['shared','/audio/common/shared.flac']],
 b:[['b-0','/audio/b/0.flac'],['shared','/audio/common/shared.flac']],
 c:[['c-0','/audio/c/0.flac']],
 many:Array.from({length:50},(_,i)=>['many-'+i,'/audio/many/'+i+'.flac']),
 order:orderTitles.map((_,i)=>['order-'+i,'/audio/order/'+i+'.flac']),
 ...Object.fromEntries(Object.keys(indexFolders).map(key=>[key,[[key,'/audio/'+key+'/0.flac']]]))
};
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const playlist=()=>({directoryPath:'/audio/'+window.choice,directoryName:indexFolders[window.choice]??'Folder '+window.choice,sourceKind:window.choice==='c'||window.playlistImport?'m3u8':'folder',sourcePath:window.choice==='c'||window.playlistImport?'/lists/'+window.choice+'.m3u8':'/audio/'+window.choice,sourceName:window.playlistImport?(indexFolders[window.choice]??'List '+window.choice):'List '+window.choice,selectedIndex:0,tracks:descriptors[window.choice].map(descriptor)});
const byPath=new Map(Object.values(descriptors).flat().map(pair=>[pair[1],descriptor(pair)]));
const names={'a-0':'A Song','b-0':'B Song','c-0':'C Playlist Song',shared:'Shared Song'};
const title=id=>names[id]??(id.startsWith('order-')?orderTitles[Number(id.slice(6))]:id.startsWith('many-')?(Number(id.slice(5))<25?'A Song ':'Z Song ')+id.slice(5):id);
const track=path=>{const row=byPath.get(path);if(!row)throw Error('Unknown '+path);return {...row,durationMs:180000,metadata:{title:title(row.id),artist:'Artist '+row.id,album:'Album '+row.id,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input});
 if(command==='library_select_folders')return ['/audio/'+window.choice];
 if(command==='audio_import_playlist')return playlist();
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {folders:window.savedLibraryFolders??[]};
 if(command==='library_add_folder'){window.savedLibraryFolders=[...new Set([...(window.savedLibraryFolders??[]),args.path])];return {folders:window.savedLibraryFolders};}
 if(command==='library_clear_folders'){window.savedLibraryFolders=[];return null;}
 if(command==='library_scan_folder'){const choice=args.path.split('/').at(-1);const before=window.choice;window.choice=choice;const result=playlist();window.choice=before;return result;}
 if(command==='library_warm_cover_thumbnails')return {attempted:input.paths.length,computed:0,persisted:0,warmed:0,skipped:input.paths.length,failed:0,cancelled:false};
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:playlist()};
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track'){
  if(window.summaryGate && input.path.endsWith('shared.flac'))await new Promise(resolve=>window.pendingHydrations.push(resolve));
  if(window.coverPerfHydrateGate && input.path.startsWith('/audio/many/'))await new Promise(resolve=>window.pendingHydrations.push(resolve));
  return track(input.path);
 }
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:input.path.startsWith('/audio/many/')?{mimeType:'image/png',filePath:'/covers/'+result.id+'.png',dataUrl:null,byteLen:64}:null}}
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_load_playlist_cover_pixels'){
  if(!input.filePath.startsWith('/covers/many-'))throw {code:'NO_COVER_ART',message:'fixture has no artwork',recoverable:false};
  if(window.coverPerfPixelGate && input.clientId?.startsWith('all-songs-'))await new Promise(resolve=>window.pendingPixelLoads.push(resolve));
  const bytes=new Uint8Array(44);const view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);
  view.setUint32(8,1,true);view.setUint32(12,1,true);view.setUint32(16,4,true);view.setUint32(20,1,true);view.setUint32(24,4,true);
  view.setUint32(32,1,true);view.setUint32(36,1,true);bytes.set([255,0,0,255],40);return bytes;
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__all_songs_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })

async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__all_songs_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__all_songs_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__all_songs_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__all_songs_test?width=' + width)
  await page.waitForFunction(() => Boolean(window.viewModel))
  return { page, errors }
}

async function importChoice(page, choice) {
  await page.evaluate(choice => { window.choice = choice; if(choice==='c'||window.playlistImport)window.viewModel.playlist.library.onImportPlaylist();else window.viewModel.playlist.library.onSelectFolders() }, choice)
  await page.waitForFunction(() => !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending && !window.viewModel.playlist.library.isImportPending)
}

try {
  for (const width of [640, 1440]) {
    const { page, errors } = await open(width)
    await importChoice(page, 'a')
    await importChoice(page, 'b')
    await importChoice(page, 'c')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.all-songs-list .playlist-card-title')].some(node => node.textContent === 'Shared Song'))
    assert.deepEqual(await page.evaluate(() => window.viewModel.playlist.library.allSongs.map(item => item.trackId)), ['a-0', 'shared', 'b-0'], 'folders aggregate and duplicate paths appear once; m3u8 excluded')
    assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 3)
    assert.equal(await page.getByRole('navigation', { name: '歌曲快速查找' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '查找 B 开头的歌曲' }).count(), 1)
    const songsGrid = page.locator('.all-songs-list')
    assert.equal(await songsGrid.getAttribute('data-layout-level'), '4', 'all songs starts in the medium row view at both window widths')
    assert.equal(await songsGrid.getAttribute('data-layout-flow'), 'row')
    assert.equal(await songsGrid.evaluate(node => node.style.getPropertyValue('--playlist-cover-size')), '96px', 'medium artwork size matches playlist level 4')
    assert.equal(await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'A Song' }).locator('.playlist-card-cover').count(), 1, 'medium row retains artwork')
    assert.match(await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'A Song' }).innerText(), /Artist a-0/, 'medium row retains artist metadata')
    assert.match(await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'A Song' }).innerText(), /FLAC/i, 'medium row retains format metadata')
    const geometry = await page.evaluate(() => {
      const row = document.querySelector('.all-songs-list .playlist-card').getBoundingClientRect()
      const index = document.querySelector('.playlist-management-quick-index').getBoundingClientRect()
      return { rowRight: row.right, indexLeft: index.left, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }
    })
    assert(geometry.rowRight <= geometry.indexLeft, 'song rows leave space for quick index')
    assert(geometry.scrollWidth <= geometry.viewport, 'layout does not overflow horizontally')
    await page.locator('.all-songs-list .playlist-card').first().hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, 60)
    await page.keyboard.up('Control')
    await page.waitForFunction(() => document.querySelector('.all-songs-list')?.getAttribute('data-layout-level') === '5')
    assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.all-songs.layout-level.v1')), '5', 'all-songs layout persists under its own key')
    assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.playlist.layout-level.v1')), null, 'changing all songs does not write the playlist-detail key')
    await page.getByRole('button', { name: '搜索所有歌曲' }).click()
    await page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' }).fill('shared')
    assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 1, 'search filters rows')
    await page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' }).fill('')
    assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 3, 'clearing search restores rows')
    await page.getByRole('button', { name: '选择', exact: true }).click()
    await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'Shared Song' }).click()
    assert.equal(await page.locator('.all-songs-list .playlist-card[aria-pressed="true"]').count(), 1)
    await page.getByRole('button', { name: '取消选择' }).click()
    await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'Shared Song' }).click()
    await page.waitForFunction(() => window.viewModel.playback.track?.id === 'shared')
    assert.equal(await page.evaluate(() => window.viewModel.playlist.library.activeScope?.includes('/audio/a')), true, 'song selection activates owning folder')
    const playlistDefault = width > 1024 ? '0' : '3'
    await page.evaluate(() => window.viewModel.playlist.library.onSelect(window.viewModel.playlist.library.items[0].scope))
    const detailGrid = page.locator('.playlist-grid:not(.all-songs-list)')
    await detailGrid.waitFor()
    assert.equal(await detailGrid.getAttribute('data-layout-level'), playlistDefault, 'playlist detail keeps its own width-dependent default')
    await detailGrid.locator('.playlist-card').first().hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, 60)
    await page.keyboard.up('Control')
    const playlistChanged = String(Number(playlistDefault) + 1)
    await page.waitForFunction(expected => document.querySelector('.playlist-grid:not(.all-songs-list)')?.getAttribute('data-layout-level') === expected, playlistChanged)
    assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.playlist.layout-level.v1')), playlistChanged, 'playlist detail persists under its own key')
    assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.all-songs.layout-level.v1')), '5', 'playlist detail does not overwrite all-songs layout')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    assert.equal(await page.locator('.all-songs-list').getAttribute('data-layout-level'), '5', 'all-songs view survives navigation through playlist detail')
    assert.deepEqual(errors, [], 'no browser errors')
    console.log(`all songs ${width}px: aggregation, dedupe, independent views, search, select, index, play passed`)
    await page.close()
  }
  {
    const { page, errors } = await open(640)
    await page.evaluate(() => { window.summaryGate = true })
    await importChoice(page, 'a')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    assert.equal(await page.locator('.all-songs-list .playlist-card').count(), 0, 'pending summary holds the list in a non-scrollable loading state')
    assert.equal(await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'Shared Song' }).count(), 0, 'unresolved tag title is not fabricated')
    await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()); window.pendingHydrations.splice(0).forEach(resolve => resolve()) })
    await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'Shared Song' }).waitFor()
    assert.deepEqual(errors, [], 'no browser errors during summary loading')
    await page.close()
    console.log('all songs summary loading: truthful pending row and resolved tag passed')
  }
  {
    const { page, errors } = await open(640)
    await importChoice(page, 'many')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    await page.waitForFunction(() => document.querySelector('.all-songs-list .playlist-card-title')?.textContent?.startsWith('A Song'))
    await page.getByRole('button', { name: '查找 Z 开头的歌曲' }).click()
    assert(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop) > 0, 'index jumps to Z group')
    await page.getByRole('button', { name: '返回列表顶部' }).click()
    assert.equal(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop), 0, 'index returns to top')
    assert.deepEqual(errors, [], 'no browser errors during index jump')
    await page.close()
    console.log('all songs quick index: jump to Z and top passed')
  }
  {
    const { page, errors } = await open(640)
    await importChoice(page, 'order')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.all-songs-list .playlist-card-title')].some(node => node.textContent === 'Вдох'))
    const titles = await page.locator('.all-songs-list .playlist-card-title').allTextContents()
    assert.deepEqual(titles.slice(0, 4), ['#Lov3 #Ngẫu Hứng', '#ТАМАДА (DJ Mexx & DJ Dikson Remix)', '(What Is) Love?', '+ERABY+E CONNEC+1ON'], 'exactly the four screenshot titles appear above numbers in the shown order')
    assert.deepEqual(titles.slice(4, 6), ['03-Can I be Survived', '143 (extended mix)'], 'numeric titles immediately follow the four screenshot titles')
    assert.equal(titles[6], '<<wr/d::maker>> ~Harmony in Re...', 'angle-bracket title follows numbers and precedes A')
    assert.deepEqual(titles.slice(7, 33), Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => letter + ' Song'), 'song numbers and angle-bracket title precede A–Z')
    assert.deepEqual(new Set(titles.slice(33)), new Set(['[Bonus] Song', 'ýuarðina', 'βios', 'Вдох']), 'bracket and non-ASCII songs follow Z')
    const songsIndex = page.getByRole('navigation', { name: '歌曲快速查找' })
    await songsIndex.getByRole('button', { name: '查找数字开头的歌曲' }).click()
    assert.equal(await songsIndex.getByRole('button', { name: '查找数字开头的歌曲' }).getAttribute('aria-current'), 'true')
    assert(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop) > 0, 'song 0 index moves beyond exactly four punctuation titles')
    assert(await page.locator('.all-songs-list .playlist-card').filter({ hasText: '03-Can I be Survived' }).evaluate(node => {
      const panel = document.querySelector('.playlist-management-content').getBoundingClientRect()
      const row = node.getBoundingClientRect()
      return row.top >= panel.top && row.top < panel.bottom
    }), 'song 0 index exposes first numeric title')
    await songsIndex.getByRole('button', { name: '查找其他字符开头的歌曲' }).click()
    assert.equal(await songsIndex.getByRole('button', { name: '查找其他字符开头的歌曲' }).getAttribute('aria-current'), 'true')
    assert(await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'ýuarðina' }).evaluate(node => {
      const panel = document.querySelector('.playlist-management-content').getBoundingClientRect()
      const row = node.getBoundingClientRect()
      return row.bottom > panel.top && row.top < panel.bottom
    }), 'song # index exposes accented Latin title after Z')
    await songsIndex.getByRole('button', { name: '返回列表顶部' }).click()
    assert.equal(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop), 0, 'song top index returns to punctuation')
    assert.deepEqual(errors, [], 'no browser errors during song boundary ordering')
    await page.close()
    console.log('all songs index boundaries: punctuation, 0, angle bracket, A–Z, non-ASCII, top and # passed')
  }
  {
    const { page, errors } = await open(640)
    await page.evaluate(() => { window.playlistImport = true })
    for (const choice of ['idxAccent', 'idxCyrillic', 'idxZ', 'idxB', 'idxGreek', 'idxZero', 'idxAngle', 'idxBracket', 'idxA', 'idxPlus', 'idxParen', 'idxHashCyrillic', 'idxHashLatin', 'idxC']) await importChoice(page, choice)
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('playlists'))
    await page.getByRole('heading', { name: '播放列表' }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.playlist-management-name').length === 14)
    const names = await page.locator('.playlist-management-name').allTextContents()
    assert.deepEqual(names.slice(0, 4), ['#Lov3 #Ngẫu Hứng', '#ТАМАДА (DJ Mexx & DJ Dikson Remix)', '(What Is) Love?', '+ERABY+E CONNEC+1ON'], 'playlist names follow the same four-title punctuation order')
    assert.deepEqual(names.slice(4, 10), ['03 Numbers', '<<wr/d::maker>> ~Harmony in Re...', 'A Folder', 'B Folder', 'C Folder', 'Z Folder'], 'playlist angle-bracket name falls between numbers and A')
    assert.deepEqual(new Set(names.slice(10)), new Set(['[Bonus] Song', 'ýuarðina', 'βios', 'Вдох']), 'playlist bracket and non-ASCII names follow Z')
    const playlistIndex = page.getByRole('navigation', { name: '播放列表快速查找' })
    await playlistIndex.getByRole('button', { name: '查找数字开头的播放列表' }).click()
    assert.equal(await playlistIndex.getByRole('button', { name: '查找数字开头的播放列表' }).getAttribute('aria-current'), 'true')
    assert(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop) > 0, 'playlist 0 index moves beyond punctuation')
    assert(await page.locator('.playlist-management-card').filter({ hasText: '03 Numbers' }).evaluate(node => {
      const panel = document.querySelector('.playlist-management-content').getBoundingClientRect()
      const row = node.getBoundingClientRect()
      return row.top >= panel.top && row.top < panel.bottom
    }), 'playlist 0 index exposes first numeric name')
    await playlistIndex.getByRole('button', { name: '查找其他字符开头的播放列表' }).click()
    assert.equal(await playlistIndex.getByRole('button', { name: '查找其他字符开头的播放列表' }).getAttribute('aria-current'), 'true')
    assert(await page.locator('.playlist-management-card').filter({ hasText: 'ýuarðina' }).evaluate(node => {
      const panel = document.querySelector('.playlist-management-content').getBoundingClientRect()
      const row = node.getBoundingClientRect()
      return row.bottom > panel.top && row.top < panel.bottom
    }), 'playlist # index exposes accented Latin name after Z')
    await playlistIndex.getByRole('button', { name: '返回列表顶部' }).click()
    assert.equal(await page.locator('.playlist-management-content').evaluate(node => node.scrollTop), 0, 'playlist top index returns to punctuation')
    assert.deepEqual(errors, [], 'no browser errors during playlist boundary ordering')
    await page.close()
    console.log('playlist index boundaries: punctuation, 0, angle bracket, A–Z, non-ASCII, top and # passed')
  }
  {
    const { page, errors } = await open(640)
    await importChoice(page, 'many')
    await page.evaluate(() => {
      window.coverObjectUrls = { created: [], createdRecords: [], revoked: [] }
      const create = URL.createObjectURL.bind(URL)
      const revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = blob => {
        const url = create(blob)
        window.coverObjectUrls.created.push(url)
        window.coverObjectUrls.createdRecords.push({ url, stack: new Error().stack })
        return url
      }
      URL.revokeObjectURL = url => {
        window.coverObjectUrls.revoked.push(url)
        return revoke(url)
      }
      HTMLCanvasElement.prototype.toBlob = () => { throw new Error('all-songs cover conversion must not serialize PNG on the main thread') }
      window.viewModel.playlist.library.onSelectCategory('songs')
    })
    await page.getByRole('heading', { name: '全部歌曲' }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.all-songs-list .playlist-card-format')].some(node => node.textContent?.includes('3:00')))
    await page.waitForFunction(() => [...document.querySelectorAll('.all-songs-list .playlist-card-cover-image')].some(image => image.complete && image.naturalWidth > 0), null, { timeout: 5000 })
    const evidence = await page.evaluate(() => ({
      coverProbes: window.calls.filter(call => call.command === 'audio_probe_playlist_cover' && call.input.path.startsWith('/audio/many/')).length,
      pixelLoads: window.calls.filter(call => call.command === 'audio_load_playlist_cover_pixels' && call.input.filePath.startsWith('/covers/many-')).length,
    }))
    assert(evidence.coverProbes >= 1 && evidence.pixelLoads >= 1, 'visible artwork uses the native cover probe and pixel path')
    const visibleCoverUrl = await page.locator('.all-songs-list .playlist-card-cover-image').first().evaluate(image => image.src)
    await page.getByRole('button', { name: '查找 Z 开头的歌曲' }).click()
    await page.waitForFunction(() => window.calls.some(call => call.command === 'audio_probe_playlist_cover' && call.input.path === '/audio/many/25.flac'))
    await page.locator('.all-songs-list .playlist-card').filter({ hasText: 'Z Song 25' }).locator('.playlist-card-cover-image').waitFor()
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('artist'))
    await page.waitForFunction(url => window.coverObjectUrls.revoked.includes(url), visibleCoverUrl)
    assert(await page.evaluate(url => window.coverObjectUrls.revoked.includes(url), visibleCoverUrl), 'leaving all songs revokes a published cover URL')
    await page.evaluate(() => {
      window.coverPerfPixelGate = true
      window.viewModel.playlist.library.onSelectCategory('songs')
    })
    await page.waitForFunction(() => window.pendingPixelLoads.length >= 1)
    assert.equal(await page.evaluate(() => window.pendingPixelLoads.length), 2, 'artwork lane has at most two native pixel loads in flight')
    await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('artist'))
    await page.getByRole('heading', { name: '艺术家' }).waitFor()
    const createdBeforeRelease = await page.evaluate(() => window.coverObjectUrls.created.length)
    await page.evaluate(() => {
      window.coverPerfPixelGate = false
      window.pendingPixelLoads.splice(0).forEach(resolve => resolve())
    })
    await page.waitForTimeout(50)
    const lateCreations = await page.evaluate(index => window.coverObjectUrls.createdRecords.slice(index), createdBeforeRelease)
    assert.equal(lateCreations.filter(record => record.stack.includes('useAllSongsWindow')).length, 0, 'late pixel result after leaving songs does not create an orphan URL: ' + JSON.stringify(lateCreations.map(record => record.stack)))
    assert.deepEqual(errors, [], 'delayed cover publication does not cause browser errors')
    await page.close()
    console.log('all songs artwork: preloaded metadata and independently arriving covers passed')
  }
} finally {
  await browser.close()
}
