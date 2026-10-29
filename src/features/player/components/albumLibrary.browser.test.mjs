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
 ...Array.from({length:32},(_,i)=>['zed-'+i,'/music/Zed'+String(i).padStart(2,'0')+'/song.flac','Zed '+String(i).padStart(2,'0'),'Zed Artist','Zed Artist'])
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

const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const cards = () => page.locator('.album-library-content button[data-album-key]')
const albumCard = (name, author) => cards().filter({ hasText: name }).filter({ hasText: author }).first()
const keys = () => page.locator('.album-library-content .playlist-card[data-song-key]').evaluateAll(nodes => nodes.filter(node => !node.closest('[inert]')).map(node => node.dataset.songKey).sort())
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: `${evidence}/${name}.png` }) }
const activeKey = () => page.evaluate(() => window.vm.playlist.library.albumLocation)
const returnToAlbum = async key => {
  await page.evaluate(() => window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true))
  await page.waitForFunction(() => window.vm.playlist.isOpen)
  await page.waitForFunction(key => window.vm.playlist.library.route.categoryId === 'album' && window.vm.playlist.library.albumLocation === key, key)
}

try {
  await page.goto(origin + '/__album_library_test?cover=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 44 && !window.vm.playlist.library.isImportPending)
  await selectCategory('album')
  await page.getByRole('heading', { name: '专辑', exact: true }).waitFor()
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content button[data-album-key]').length === 43)
  assert.equal(await page.locator('.album-library-content > .playlist-hero').count(), 0, 'album root is hero-free')
  assert.equal(await page.getByRole('navigation', { name: '专辑快速查找' }).count(), 1, 'album reuses the shared index rail')
  assert.equal(await cards().filter({ hasText: 'Echo' }).count(), 2, 'same name by distinct album artists remains separate')
  assert.equal(await cards().filter({ hasText: 'Box' }).count(), 1, 'same album artist joins multiple discs')
  assert.equal(await cards().filter({ hasText: 'Mixed' }).count(), 2, 'complete track credits separate same-name albums')
  assert.equal(await albumCard('Mixed', 'Singer A').count(), 1, 'album subtitle reflects its actual members')
  assert.equal(await cards().filter({ hasText: 'Home' }).count(), 2, 'different complete credits remain separate')
  assert.equal(await cards().filter({ hasText: '未知专辑' }).count(), 3, 'absent and failed tags make directory-specific unknown entries')
  assert.equal(await cards().filter({ hasText: 'Hidden' }).count(), 0, 'deselected storage contributes no albums')
  assert.equal(await cards().filter({ hasText: '本地音频' }).count(), 1, 'literal album tag is distinct from missing album')
  await page.waitForFunction(() => window.calls.some(call => call.command === 'audio_load_track_thumbnail'))
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_folder_thumbnail').length), 0, 'album covers never use recursive directory thumbnails')
  const geometry = await cards().first().evaluate(card => {
    const cover = card.querySelector('.album-cover, .folder-cover'), name = card.querySelector('.album-name, .folder-name'), artist = card.querySelector('.album-artist, .folder-parent-name')
    const rect = cover.getBoundingClientRect()
    return { width: rect.width, height: rect.height, radius: getComputedStyle(cover).borderRadius, nameSize: getComputedStyle(name).fontSize, nameLine: getComputedStyle(name).lineHeight, artistSize: getComputedStyle(artist).fontSize, artistLine: getComputedStyle(artist).lineHeight, gap: getComputedStyle(card).gap }
  })
  assert.deepEqual(geometry, { width: 240, height: 240, radius: '10px', nameSize: '16px', nameLine: '24px', artistSize: '14px', artistLine: '20px', gap: '26px' })
  console.log('ALBUM_CARD_GEOMETRY', JSON.stringify(geometry))
  await screenshot('albums-root-640')

  const rail = page.getByRole('navigation', { name: '专辑快速查找' })
  const z = rail.getByRole('button', { name: /查找 Z/ })
  await z.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.album-library-content')?.scrollTop > 100)
  const target = await albumCard('Zed 00', 'Zed Artist').evaluate(node => ({ top: node.getBoundingClientRect().top, panelTop: node.closest('.album-library-content').getBoundingClientRect().top }))
  assert(Math.abs(target.top - target.panelTop) < 120, 'Z jumps to first displayed Z album')
  const box = await rail.boundingBox()
  const point = index => ({ x: box.x + box.width / 2, y: box.y + box.height * (index + .5) / 29 })
  const a = point(2), last = point(27)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(last.x, last.y, { steps: 8 })
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.textContent === 'Z' && document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'true')
  assert.equal(await z.getAttribute('aria-current'), 'true')
  await screenshot('albums-index-drag-640')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'false')
  await rail.getByRole('button', { name: '返回列表顶部', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.album-library-content')?.scrollTop < 1)

  // Root search and multi-selection restrict the union passed to real playback orchestration.
  await page.getByRole('button', { name: '搜索专辑和歌曲', exact: true }).click()
  await page.getByRole('searchbox').fill('Echo')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content button[data-album-key]').length === 2)
  await page.getByRole('button', { name: '搜索专辑和歌曲', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('input[type="search"]') && document.querySelectorAll('.album-library-content button[data-album-key]').length === 43)
  await page.getByRole('button', { name: '搜索专辑和歌曲', exact: true }).click()
  await page.getByRole('searchbox').fill('Echo')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content button[data-album-key]').length === 2)
  await page.getByRole('button', { name: '播放专辑歌曲', exact: true }).click()
  await ready()
  assert.deepEqual(await queueIds(), ['echo-a', 'echo-b'])
  await returnToAlbum(null)
  if (await page.getByRole('searchbox').count()) await page.getByRole('searchbox').press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content button[data-album-key]').length === 43)
  await page.locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await albumCard('Box', 'Ensemble').click()
  await albumCard('Echo', 'Ann').click()
  await page.getByRole('button', { name: '播放专辑歌曲', exact: true }).click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1', 'disc2', 'echo-a'], 'selected albums union their exact songs, deduplicated across roots')
  await returnToAlbum(null)
  const previousSelection = page.locator('.playlist-management-toolbar').getByRole('button', { name: '取消选择', exact: true })
  if (await previousSelection.count()) await previousSelection.click()
  await page.locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await albumCard('Box', 'Ensemble').click()
  await albumCard('Echo', 'Ann').click()
  await page.getByRole('button', { name: '随机播放专辑歌曲', exact: true }).click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1', 'disc2', 'echo-a'], 'root shuffle keeps only the selected album union')
  await returnToAlbum(null)
  const cancel = page.locator('.playlist-management-toolbar').getByRole('button', { name: '取消选择', exact: true })
  if (await cancel.count()) await cancel.click()
  await albumCard('Box', 'Ensemble').click()
  await page.waitForFunction(() => window.vm.playlist.library.albumLocation !== null)
  const boxKey = await activeKey()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content .playlist-card[data-song-key]').length === 2)
  assert.deepEqual(await keys(), ['/music/Box/Disc1/a.flac', '/music/Box/Disc2/b.flac'])
  assert.equal(await page.locator('.playlist-management-quick-index').count(), 0, 'hero detail omits root index')
  const hero = page.locator('.album-library-content > .playlist-hero')
  assert((await hero.innerText()).includes('2 |'), 'hero count uses full album across discs')
  await screenshot('albums-detail-640')
  await page.locator('.album-library-content .playlist-card[data-song-key="/music/Box/Disc2/b.flac"]').click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1', 'disc2'], 'activating one song keeps the album queue scope')
  assert.equal(await page.evaluate(() => window.vm.playlist.currentTrackId), 'disc2')
  await returnToAlbum(boxKey)
  await hero.locator('.playlist-hero-play-button').click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1', 'disc2'])
  await returnToAlbum(boxKey)
  await hero.locator('.playlist-hero-shuffle-button').click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1', 'disc2'])
  await returnToAlbum(boxKey)
  await hero.locator('.playlist-search-button').click()
  await page.getByRole('searchbox').fill('disc2')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content .playlist-card[data-song-key]').length === 1)
  await hero.locator('.playlist-hero-play-button').click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc2'])
  await returnToAlbum(boxKey)
  if (await page.getByRole('searchbox').count()) await page.getByRole('searchbox').press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content .playlist-card[data-song-key]').length === 2)
  await hero.locator('.playlist-select-toggle').click()
  await page.locator('.album-library-content .playlist-card[data-song-key="/music/Box/Disc1/a.flac"]').click()
  await hero.locator('.playlist-hero-play-button').click()
  await ready()
  assert.deepEqual(await queueIds(), ['disc1'])
  await returnToAlbum(boxKey)
  await selectCategory('songs')
  const songsRail = page.getByRole('navigation', { name: '歌曲快速查找' })
  await songsRail.waitFor()
  await songsRail.getByRole('button', { name: '查找 Z 开头的歌曲', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.playlist-management-content')?.scrollTop > 100)
  await page.locator('.all-songs-list .playlist-card[data-song-key="/music/Zed00/song.flac"]').waitFor()
  await songsRail.getByRole('button', { name: '返回列表顶部', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.playlist-management-content')?.scrollTop < 1)
  await selectCategory('album')
  await page.waitForFunction(() => window.vm.playlist.library.albumLocation === null)
  await albumCard('Echo', 'Bob').click()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content .playlist-card[data-song-key]').length === 1)
  assert.deepEqual(await keys(), ['/external/B/two.flac'], 'same-title other artist has independent detail')
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0 && window.vm.playlist.library.albumLocation === null)
  await page.getByRole('navigation', { name: '专辑快速查找' }).waitFor()
  assert.equal(await cards().count(), 0, 'removed storage invalidates active album')
  assert.equal(await page.getByRole('navigation', { name: '专辑快速查找' }).count(), 1, 'empty root keeps index')

  await page.goto(origin + '/__album_library_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 44)
  await selectCategory('album')
  await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await cards().count(), 0, 'unresolved metadata does not fabricate unknown albums')
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content button[data-album-key]').length === 43)
  await page.goto(origin + '/__album_library_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 44)
  await selectCategory('album')
  await page.waitForFunction(() => window.pendingSummaries.length > 0)
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.length), 0, 'late summary cannot resurrect cleared storage')
  assert.equal(await cards().count(), 0)
  await page.goto(origin + '/__album_library_test?large=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 224)
  await selectCategory('album')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await albumCard('Large', 'Large Artist').click()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content .playlist-card[data-song-key]').length > 0)
  assert(await page.locator('.album-library-content .playlist-card[data-song-key]').count() < 40, 'large album uses a bounded render window')
  const nextAlbumKey = await page.locator('.album-songs .playlist-card').last().evaluate(node => {
    node.focus({ preventScroll: true })
    return '/music/Large/' + (Number(node.dataset.songKey.match(/\/(\d+)\.flac$/)[1]) + 1) + '.flac'
  })
  await page.keyboard.press('Tab')
  await page.waitForFunction(key => document.activeElement?.dataset.songKey === key, nextAlbumKey)
  await selectCategory('songs')
  await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length > 0)
  assert(await page.locator('.all-songs-list .playlist-card').count() < 40, 'all songs keeps a bounded render window after index extraction')
  const nextSongKey = await page.locator('.all-songs-list .playlist-card').last().evaluate(node => {
    const keys = window.vm.playlist.library.allSongs.slice().sort((a,b) => a.track.title.localeCompare(b.track.title, undefined, { numeric: true })).map(item => item.key)
    node.focus({ preventScroll: true })
    return keys[keys.indexOf(node.dataset.songKey) + 1]
  })
  await page.keyboard.press('Tab')
  await page.waitForFunction(key => document.activeElement?.dataset.songKey === key, nextSongKey)
  const largeSongsRail = page.getByRole('navigation', { name: '歌曲快速查找' })
  await largeSongsRail.getByRole('button', { name: '查找 Z 开头的歌曲', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.locator('.all-songs-list .playlist-card[data-song-key="/music/Zed00/song.flac"]').waitFor()
  await largeSongsRail.getByRole('button', { name: '返回列表顶部', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.playlist-management-content')?.scrollTop < 1)
  assert.deepEqual(errors, [], 'no browser runtime errors')
  assert.deepEqual(consoleErrors, [], 'no React reconciliation errors')
  console.log('album library: raw identity, multi-disc/compilation, unknown/pending/error, deselected/overlap storage, root and detail play/search/select/shuffle, player return, shared index keyboard/drag/top and late completion cancellation passed')
} catch (error) {
  await screenshot('albums-failure')
  console.error(await page.evaluate(() => ({ route: window.vm?.playlist.library.route, location: window.vm?.playlist.library.albumLocation, metadata: window.vm?.playlist.library.allSongsMetadataStatus, allSongs: window.vm?.playlist.library.allSongs.length, text: document.querySelector('.album-library-content')?.innerText, queue: window.vm?.queue.tracks.map(track => track.id) })), errors)
  throw error
} finally {
  await browser.close()
}
