// Independent acceptance: actual PlayerShell, simulated existing native transport.
// Requires Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__genre_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;let viewModel=new URLSearchParams(location.search).has('indexLocal')?{...props.viewModel,search:undefined}:props.viewModel;if(new URLSearchParams(location.search).has('playlistReference'))viewModel={...viewModel,playlist:{...viewModel.playlist,tracks:(viewModel.playlist.library.allSongs??[]).slice(0,3).map(item=>item.track),metadataStatus:'ready',library:{...viewModel.playlist.library,isOpen:false}}};return React.createElement(RealSurface,{...props,viewModel})}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.scanGate=new URLSearchParams(location.search).has('scanGate');window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingScans=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/music/Mixed','/external','/empty','/hidden'];
const rows=[
 ['mixed-a','/music/Mixed/a.flac','Mixed','Ensemble','Rock;Pop'],
 ['mixed-b','/music/Mixed/b.flac','Mixed','Ensemble','Jazz'],
 ['mixed-c','/external/Mixed/c.flac','Mixed','Ensemble','Rock//Electronic'],
 ['solo','/music/Solo/solo.flac','Solo','Solo','Electronic'],
 ['modern','/music/Modern/modern.flac','Modern','Modern','J-Pop'],
 ['older','/music/Older/older.flac','Older','Older','Pop/Rock'],
 ['unknown','/music/Unknown/unknown.flac','Unknown','Unknown',null],
 ['invalid','/music/Invalid/invalid.flac','Invalid','Invalid',' '],
 ['bad','/music/Bad/bad.flac','Bad','Bad','Absent'],
 ['hidden','/hidden/hidden.flac','Hidden','Hidden','Hidden']
];
const mixedArtists=false;window.summaryGenres=Object.fromEntries(rows.map(row=>[row[0],row[4]]));
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor),all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,directoryPaths:[path],tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path),tags=rows.find(value=>value[1]===path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:tags[5]??'Title '+row.id,artist:mixedArtists?tags[3]:'Singer '+tags[3],album:tags[2],albumArtist:mixedArtists?null:tags[3],genre:'Hydrated Wrong',year:1999,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:path!=='/hidden',directoryRules:[]}))};
 if(command==='library_clear_folders'){roots.length=0;return null}
 if(command==='library_cancel_cover_warmup')return null;
 if(command==='library_scan_folder'){if(window.scanGate)await new Promise(resolve=>window.pendingScans.push(resolve));return folder(args.path)}
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
 if(command==='audio_load_track_thumbnail'||command==='audio_load_playlist_cover_pixels'||command==='audio_load_folder_thumbnail')return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  return input.paths.map(sourcePath=>{const item=track(sourcePath);if(item.id==='bad')return {sourcePath,summary:null,error:{code:'DECODE_FAILED',message:'Unreadable tags',recoverable:true}};return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,genre:window.summaryGenres[item.id],year:2022,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__genre_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce' })
page.setDefaultTimeout(15000)
const errors = [], consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__genre_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__genre_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__genre_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
  if (new URLSearchParams(location.search).has('rootLevel')) localStorage.setItem('spmusic.genre-root.layout-level.v1', new URLSearchParams(location.search).get('rootLevel'))
  if (new URLSearchParams(location.search).has('indexSize')) localStorage.setItem('spmusic.genre-songs.sort.v1', JSON.stringify({ field: 'title', direction: 'asc' }))
  if (new URLSearchParams(location.search).has('entryHover')) {
    for (const scope of ['genre-albums', 'artist-albums', 'album-artist-albums', 'composer-albums']) localStorage.setItem('spmusic.' + scope + '.layout-level.v1', new URLSearchParams(location.search).get('entryLevel') ?? '5')
  }
  if (new URLSearchParams(location.search).has('playlistReference')) localStorage.setItem('spmusic.playlist.layout-level.v1', '4')
})
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }
const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.album-library-content:not([inert])')
const songs = () => active().locator('.album-songs .playlist-card[data-song-key]')
const songNames = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1)).sort())
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => {
  await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen)
}
const up = async () => {
  await active().locator('.playlist-hero-category').click()
  await page.waitForFunction(() => document.querySelectorAll('.album-library-content:not([inert])').length === 1)
}
const genres = () => active().locator('.genre-card[data-genre-key]')
const genre = value => genres().filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + value + '$') }) })
const albums = () => active().locator('.album-card:not(.genre-card)')
const album = name => albums().filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) })
const view = async expected => { await active().waitFor(); await page.waitForFunction(expected => document.querySelector('.album-library-content:not([inert])')?.dataset.genreView === expected, expected) }
const sort = async (scope, fieldLabel, directionLabel, value) => {
  await active().locator('.playlist-hero-more-button').first().click()
  await page.getByRole('dialog').getByRole('button', { name: '重新排序', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '流派 · 列表选项', exact: true })
  await dialog.waitFor()
  await dialog.getByRole('combobox', { name: '排序方式', exact: true }).click()
  await page.getByRole('option', { name: fieldLabel, exact: true }).click()
  await dialog.getByRole('combobox', { name: '排序方向', exact: true }).click()
  await page.getByRole('option', { name: directionLabel, exact: true }).click()
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(scope => JSON.parse(localStorage.getItem('spmusic.genre-' + scope + '.sort.v1')), scope), value)
}
const search = async query => {
  const box = page.getByRole('searchbox')
  if (!await box.count()) await active().locator('.playlist-search-button').click()
  await page.getByRole('searchbox').fill(query)
}
const clearSearch = async () => {
  await page.evaluate(() => window.vm.search.onOpenChange(false))
  await page.locator('.search-page').waitFor({ state: 'hidden' })
}

try {
  for (const file of ['00729.svg', '86e1e.svg']) assert(statSync(new URL('../../../assets/genre-library/' + file, import.meta.url)).size > 0)
  if (!process.env.SPMUSIC_TEST_GEOMETRY) {
  await page.goto(origin + '/__genre_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
  await selectCategory('genre')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('root'); await genre('Rock').waitFor()
  const genreIndex = page.getByRole('navigation', { name: '流派快速查找' })
  assert.equal(await genreIndex.count(), 1, 'genre root shows the quick index')
  const rockIndex = genreIndex.getByRole('button', { name: '查找 R 开头的流派' })
  await rockIndex.focus(); await page.keyboard.press('Enter')
  assert.equal(await rockIndex.getAttribute('aria-current'), 'true', 'genre index supports keyboard navigation')
  await genreIndex.getByRole('button', { name: '返回列表顶部' }).focus(); await page.keyboard.press('Enter')
  assert.deepEqual((await genres().locator('.folder-name').allTextContents()).sort(), ['Electronic', 'J-Pop', 'Jazz', 'Pop', 'Pop/Rock', 'Rock', '未知流派'].sort())
  assert.match(await genre('Rock').locator('.genre-card-meta').innerText(), /2\s*\|\s*6:00/)
  assert.equal(await genre('Hidden').count(), 0, 'unchecked folder cannot contribute genres')
  assert.equal(await genre('Hydrated Wrong').count(), 0, 'playback metadata is not the classification source')
  await active().locator('.playlist-hero-more-button').click()
  const rootMenu = page.locator('.library-root-menu')
  await rootMenu.waitFor()
  const rootActions = await rootMenu.locator('.folder-root-menu-action span').allTextContents()
  for (const label of ['选择文件夹', '重新扫描', '列表选项']) assert(rootActions.includes(label))
  await page.keyboard.press('Escape'); await rootMenu.waitFor({ state: 'hidden' })
  await screenshot('genre-root-640')

  await genre('Rock').click(); await view('albums'); await album('Mixed').waitFor()
  assert.deepEqual(await albums().locator('.folder-name').allTextContents(), ['Mixed'])
  assert.match(await active().locator('.genre-all-songs').innerText(), /2\s*首歌曲/)
  await album('Mixed').click(); await view('album'); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'c.flac'], 'mixed-genre album detail is restricted to the current genre')
  await sort('album-tracks', '歌曲名称', '降序', { field: 'title', direction: 'desc' })
  assert.deepEqual(await songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1))), ['c.flac', 'a.flac'])
  await active().locator('.playlist-hero-play-button').click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c'])
  assert(await page.evaluate(() => window.calls.some(call => call.command === 'audio_load_and_play' && call.input.path.endsWith('/c.flac'))))
  await backFromPlayer(); await view('album')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.genreLocation.view), 'album')
  await screenshot('genre-album-tracks')
  await up(); await view('albums')
  await sort('albums', '专辑名称', '降序', { field: 'name', direction: 'desc' })
  await active().locator('.genre-all-songs').click(); await view('songs')
  const songMetadata = active().locator('.playlist-hero-meta')
  assert.equal((await songMetadata.innerText()).trim(), '2 首歌曲', 'genre songs hero shows only the song count')
  assert.equal(await songMetadata.locator('.artist-songs-meta-icon').count(), 1, 'genre songs hero shows a music note')
  assert.deepEqual(await songNames(), ['a.flac', 'c.flac'])
  await sort('songs', '歌曲名称', '降序', { field: 'title', direction: 'desc' })
  await active().locator('.playlist-hero-play-button').click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c'])
  await backFromPlayer(); await view('songs')
  assert.equal(await genre('Hydrated Wrong').count(), 0)
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.find(item => item.trackId === 'mixed-c').track.libraryGenreName), 'Rock//Electronic')
  await screenshot('genre-all-songs')
  await up(); await view('albums'); await up(); await view('root')

  await active().locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await genre('Rock').click(); await genre('Pop').click()
  await page.getByRole('button', { name: '选择帮助', exact: true }).click()
  await page.getByRole('dialog', { name: '选择帮助', exact: true }).getByRole('button', { name: '播放选中', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c'], 'overlapping selected genres enqueue every physical track once')
  await backFromPlayer(); await selectCategory('genre'); await view('root')
  const cancelSelection = active().getByRole('button', { name: '取消选择', exact: true })
  if (await cancelSelection.count()) await cancelSelection.click()
  await genre('Electronic').click(); await view('albums')
  assert.deepEqual((await albums().locator('.folder-name').allTextContents()).sort(), ['Mixed', 'Solo'])
  await active().locator('.genre-all-songs').click(); await view('songs')
  assert.deepEqual(await songNames(), ['c.flac', 'solo.flac'])
  await search('mixed-c')
  await page.waitForFunction(() => document.querySelectorAll('.search-page .playlist-card[data-song-key]').length === 1)
  await page.locator('.search-page').getByRole('button', { name: '随机播放搜索结果', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-c'])
  await clearSearch(); await backFromPlayer(); await view('songs')
  await search('Rock')
  const genreResults = page.locator('.search-page [data-search-category="genre"] .search-collection-row')
  await genreResults.first().waitFor()
  assert.deepEqual((await genreResults.locator('.folder-name').allTextContents()).sort(), ['Pop/Rock', 'Rock'])
  await page.getByRole('button', { name: '打开流派 Rock', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.search-page .playlist-card[data-song-key]').length === 2)
  assert.deepEqual(await page.locator('.search-page .playlist-card[data-song-key]').evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1)).sort()), ['a.flac', 'c.flac'])
  await page.locator('.search-page').getByRole('button', { name: '随机播放搜索结果', exact: true }).click(); await ready()
  assert.deepEqual(await queueIds(), ['mixed-a', 'mixed-c'])
  await clearSearch(); await backFromPlayer(); await view('songs')
  await up(); await view('albums')
  const retained = await page.evaluate(() => window.vm.playlist.library.genreLocation)
  await page.evaluate(() => { window.scanGate = true; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => window.pendingScans.length > 0)
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.genreLocation), retained)
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await view('albums')
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.genreLocation), retained)
  await page.evaluate(() => { window.summaryGenres['mixed-c'] = 'Rock'; window.summaryGenres.solo = null; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready' && window.vm.playlist.library.genreLocation === null)
  await view('root')
  assert.equal(await genre('Electronic').count(), 0, 'stable removed classification falls back to the genre root')

  // Shared panel: global albums retain all genres and contributor paths remain scoped.
  await selectCategory('album'); await album('Mixed').click(); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'])
  for (const [category, name] of [['artist', 'Singer Ensemble'], ['album-artist', 'Ensemble'], ['composer', '未知作曲家']]) {
    await selectCategory(category)
    await active().locator('.artist-card').filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) }).click()
    await album('Mixed').click(); await songs().first().waitFor()
    assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'], category + ' preserves shared-panel navigation and full member scope')
  }
  await selectCategory('year')
  await active().locator('.year-card').filter({ has: page.locator('.folder-name', { hasText: /^2022$/ }) }).click()
  await album('Mixed').click(); await songs().first().waitFor()
  assert.deepEqual(await songNames(), ['a.flac', 'b.flac', 'c.flac'], 'year retains its complete-album path, distinct from the genre intersection')
  }

  for (const width of [640, 456, 1440]) {
    await page.setViewportSize({ width, height: width === 640 ? 1440 : 1024 })
    await page.goto(origin + '/__genre_test?geometry=' + width)
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
    await selectCategory('genre'); await genre('Rock').waitFor()
    await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
    await page.mouse.move(width - 1, 1)
    await page.evaluate(() => document.activeElement?.blur())
    await screenshot('genre-root-' + width)
    const geometry = await active().evaluate(node => {
      const rect = node.getBoundingClientRect()
      const bad = [...node.querySelectorAll('button, .folder-name, .folder-cover')].filter(element => { const r = element.getBoundingClientRect(); return r.width && (r.left < rect.left - 1 || r.right > rect.right + 1) }).map(element => element.className)
      const glyph = node.querySelector('.media-library-category-glyph'), style = glyph && getComputedStyle(glyph)
      const category = node.querySelector('.playlist-management-category')?.getBoundingClientRect(), cover = node.querySelector('.genre-card .folder-cover')?.getBoundingClientRect()
      const controls = [...node.querySelectorAll('.playlist-management-actions button')].map(element => element.getBoundingClientRect()).filter(rect => rect.width)
      return { bad, icon: style?.maskImage, width: glyph?.getBoundingClientRect().width, height: glyph?.getBoundingClientRect().height, category: category?.width, cover: cover?.width, controlTops: controls.map(rect => rect.top) }
    })
    assert.deepEqual(geometry.bad, [], 'interactive and row content stays inside the window at ' + width)
    assert(geometry.icon && geometry.icon !== 'none', 'genre root uses its local Guitar artwork')
    assert.equal(geometry.width, geometry.height)
    assert(Math.max(...geometry.controlTops) - Math.min(...geometry.controlTops) < 1, 'root action buttons stay on one row at ' + width)
    const scale = Math.min(1, width / 640)
    const metaFontSize = await genre('Rock').locator('.genre-card-meta').evaluate(node => parseFloat(getComputedStyle(node).fontSize))
    assert(Math.abs(metaFontSize - 14 * scale) < 0.1, 'default genre statistics follow year typography and narrow scaling at ' + width)
    const metaGeometry = await genre('Rock').locator('.genre-card-meta').evaluate(node => ({ gap: parseFloat(getComputedStyle(node).gap), width: node.firstElementChild.getBoundingClientRect().width, height: node.firstElementChild.getBoundingClientRect().height }))
    assert(Math.abs(metaGeometry.gap - 8 * scale) < 0.1 && Math.abs(metaGeometry.width - 16 * scale) < 0.1 && Math.abs(metaGeometry.height - 16 * scale) < 0.1, 'default genre statistics icon and spacing follow year sizing and narrow scaling at ' + width)
    assert(Math.abs(geometry.category - 84 * scale) < 0.1, 'root category size matches the 640px design or its proportional narrow layout')
    assert(Math.abs(geometry.cover - 165 * scale) < 0.1, 'default row artwork matches the 640px design or its proportional narrow layout')
    console.log('GENRE_ROOT_GEOMETRY', width, JSON.stringify(geometry))
    await genre('Rock').click(); await view('albums'); await screenshot('genre-albums-' + width)
    const assertHeroMetaLeft = async () => {
      const positions = await active().locator('.playlist-hero-copy').evaluate(copy => ({
        title: copy.querySelector('.playlist-hero-title').getBoundingClientRect().left,
        meta: copy.querySelector('.playlist-hero-meta').getBoundingClientRect().left,
      }))
      assert(Math.abs(positions.title - positions.meta) < 1, 'genre hero metadata aligns with its title at ' + width)
    }
    await assertHeroMetaLeft()
    await active().locator('.genre-all-songs').click(); await view('songs')
    await assertHeroMetaLeft()
  }

  for (const level of [0, 3, 4, 5, 6, 9]) {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await page.goto(origin + '/__genre_test?rootLevel=' + level)
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
    await selectCategory('genre'); await genre('Rock').waitFor()
    const card = genre('Rock')
    assert.equal(await card.getAttribute('data-folder-level'), String(level))
    assert.equal(await card.locator('.genre-card-meta').evaluate(node => getComputedStyle(node).fontSize), '14px', 'genre statistics match year statistics at level ' + level)
    const metaGeometry = await card.locator('.genre-card-meta').evaluate(node => ({ gap: getComputedStyle(node).gap, width: node.firstElementChild.getBoundingClientRect().width, height: node.firstElementChild.getBoundingClientRect().height }))
    assert.deepEqual(metaGeometry, { gap: '8px', width: 16, height: 16 }, 'genre statistics icon and spacing match year at level ' + level)
  }

  if (!process.env.SPMUSIC_TEST_GEOMETRY) {
  await page.goto(origin + '/__genre_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
  await selectCategory('genre'); await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await genres().count(), 0, 'pending metadata is not materialized as unknown genres')
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await genres().count(), 0, 'late metadata cannot resurrect a cleared library')
  await page.getByText('暂无流派', { exact: true }).waitFor(); await screenshot('genre-empty')
  }
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
  console.log(process.env.SPMUSIC_TEST_GEOMETRY ? 'genre library: 640/456/1440 design geometry and single-row toolbar passed' : 'genre library: real shell grouping, double-filtered albums, playback dedupe, scoped sorts, navigation, pending/rescan cleanup, shared panel and responsive geometry passed')
} catch (error) {
  await screenshot('genre-failure')
  console.error(await page.evaluate(() => ({ location: window.vm?.playlist.library.genreLocation, route: window.vm?.playlist.library.route, text: document.querySelector('.album-library-content:not([inert])')?.innerText })), errors, consoleErrors)
  throw error
} finally { await browser.close() }
