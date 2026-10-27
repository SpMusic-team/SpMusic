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
import {PlayerSurface as RealSurface} from '/__flat_folders_real_surface.js';
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
const roots=large?['/big']:['/music','/music/Album','/empty','/missing','/music-else','/branch','/legacy','/external','/container'];
const rows=[['root','/music/root.flac'],['root2','/music/root2.flac'],['album','/music/Album/album.flac'],['deep','/music/Album/Disc/deep.flac'],['other','/music-else/other.flac']];
rows.push(['same','/external/Album/same.flac'],['container','/container/Deep/only.flac'],['onlychild','/music/Parent/OnlyChild/only.flac'],...Array.from({length:32},(_,i)=>['zed-'+i,'/music/Zed'+String(i).padStart(2,'0')+'/song.flac']));
if(large)rows.push(...Array.from({length:180},(_,index)=>['big-'+index,'/big/'+index+'.flac']));
const descriptor=([id,sourcePath])=>({id,sourcePath,fileName:sourcePath.split('/').at(-1),available:true});
const descriptors=rows.map(descriptor);
const all=new Map(descriptors.map(row=>[row.sourcePath,row]));
const folder=path=>({directoryPath:path,directoryName:path.split('/').at(-1),sourceKind:'folder',sourcePath:path,sourceName:path.split('/').at(-1),selectedIndex:0,
 directoryPaths:path==='/legacy'?undefined:path==='/branch'?['/branch','/branch/child']:path==='/music'?['/music','/music/Album','/music/Album/Disc','/music/Silent']:path==='/music/Album'?['/music/Album','/music/Album/Disc']:[path],
 tracks:descriptors.filter(row=>row.sourcePath.startsWith(path+'/'))});
const track=path=>{const row=all.get(path);if(!row)throw Error('Unknown path '+path);return {...row,durationMs:180000,metadata:{title:'Title '+row.id,artist:'Artist '+row.id,album:'Album '+row.id,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,args});
 if(command==='library_get_playlists')return [];
 if(command==='library_get_folders')return {revision:0,roots:roots.map(path=>({path,selected:true,directoryRules:[]}))};
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
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__flat_folders_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 640, height: 1440 }, reducedMotion: 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
const consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.error('BROWSER_CONSOLE', message.text()) } })
page.on('requestfailed', request => console.error('BROWSER_REQUEST_FAILED', request.url(), request.failure()?.errorText))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__flat_folders_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__flat_folders_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__flat_folders_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
})

const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const rootPaths = async () => page.locator('[data-folder-path]').evaluateAll(nodes => nodes.filter(node => !node.closest('[inert]')).map(node => node.dataset.folderPath))
const rowAt = path => page.locator(`[data-folder-path="${path}"]`).filter({ visible: true })
const songKeys = async () => page.locator('.folder-song-slot .playlist-card[data-song-key]').evaluateAll(nodes => nodes.filter(node => !node.closest('[inert]')).map(node => node.dataset.songKey))
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: `${evidence}/${name}.png` }) }
const expectedPaths = ['/music','/music/Album','/music/Album/Disc','/music-else','/external/Album','/container/Deep','/music/Parent/OnlyChild',...Array.from({ length: 32 }, (_, i) => '/music/Zed' + String(i).padStart(2, '0'))]
const returnToFlat = async (directoryPath = '/music') => {
  await page.evaluate(() => window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true))
  await page.waitForFunction(() => window.vm.playlist.isOpen)
  await page.waitForFunction(directoryPath => document.querySelector('.folder-hierarchy-content:not([inert])')?.dataset.directoryPath === directoryPath, directoryPath)
}
const queueIds = async () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const readyForPlayback = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)

try {
  await page.goto(origin + '/__flat_folders_test?cover=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 40 && !window.vm.playlist.library.isImportPending)
  await selectCategory('folder')
  await page.getByRole('heading', { name: '文件夹', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 39)
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  assert.deepEqual((await rootPaths()).sort(), expectedPaths.sort(), 'all depths are flat; empty, pure containers and failed roots are not invented as song folders')
  assert.equal(await page.locator('.folder-row-icon, .folder-badge').count(), 0, 'flat cards omit hierarchy folder glyphs and badges')
  assert.equal(await page.locator('.folder-song-slot').count(), 0, 'flat category contains directories, not aggregated song rows')
  assert.equal(await page.locator('.playlist-management-quick-index').count(), 1, 'flat root has quick index')
  await page.waitForFunction(() => window.calls.some(call => call.command === 'audio_load_track_thumbnail'))
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_folder_thumbnail').length), 0, 'flat artwork never invokes recursive folder thumbnail command')
  const cardGeometry = await page.locator('.folder-row').first().evaluate(card => {
    const box = node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height } }
    const cover = card.querySelector('.folder-cover'), name = card.querySelector('.folder-name'), parent = card.querySelector('.folder-parent-name')
    return { cover: box(cover), radius: getComputedStyle(cover).borderRadius, title: getComputedStyle(name).fontSize, titleLine: getComputedStyle(name).lineHeight, parent: getComputedStyle(parent).fontSize, parentLine: getComputedStyle(parent).lineHeight, gap: getComputedStyle(card).gap }
  })
  assert.deepEqual(cardGeometry.cover, { width: 240, height: 240 })
  assert.equal(cardGeometry.radius, '10px')
  assert.equal(cardGeometry.title, '32px')
  assert.equal(cardGeometry.titleLine, '40px')
  assert.equal(cardGeometry.parent, '24px')
  assert.equal(cardGeometry.parentLine, '32px')
  assert.equal(cardGeometry.gap, '26px')
  console.log('FLAT_FOLDER_CARD_GEOMETRY', JSON.stringify(cardGeometry))
  await screenshot('flat-folders-root-640')
  // Keyboard and pointer navigation exercise the same rail users see.
  const z = page.locator('.playlist-management-quick-index button').filter({ hasText: /^Z$/ })
  await z.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.textContent === 'Z' && document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'true')
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content')?.scrollTop > 100)
  const zGeometry = await rowAt('/music/Zed00').evaluate(node => ({ y: node.getBoundingClientRect().top, panelY: node.closest('.folder-hierarchy-content').getBoundingClientRect().top }))
  assert(Math.abs(zGeometry.y - zGeometry.panelY) < 120, `Z index targets first displayed Z directory: ${JSON.stringify(zGeometry)}`)
  const rail = page.locator('.playlist-management-quick-index')
  const railBox = await rail.boundingBox()
  const keyPoint = index => ({ x: railBox.x + railBox.width / 2, y: railBox.y + railBox.height * (index + .5) / 29 })
  const aPoint = keyPoint(2), zPoint = keyPoint(27)
  await page.mouse.move(aPoint.x, aPoint.y)
  await page.mouse.down()
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.textContent === 'A' && document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'true')
  await page.mouse.move(zPoint.x, zPoint.y, { steps: 8 })
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.textContent === 'Z' && document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'true')
  assert.equal(await z.getAttribute('aria-current'), 'true', 'dragging updates current index')
  await screenshot('flat-folders-index-drag-640')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.playlist-management-quick-index-preview')?.dataset.visible === 'false')
  await page.locator('.playlist-management-quick-index').getByRole('button', { name: '返回列表顶部', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content')?.scrollTop < 1)
  await page.locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
  await rowAt('/music').click()
  await rowAt('/music/Album').click()
  assert.equal(await rowAt('/music').getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '播放文件夹歌曲', exact: true }).click()
  await readyForPlayback()
  assert.deepEqual(await queueIds(), ['album','root','root2'], 'root multi-selection unions each selected directory direct songs without descendants')
  await returnToFlat('')
  await rowAt('/music').click()
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content:not([inert])')?.dataset.directoryPath === '/music')
  await page.waitForFunction(() => document.querySelectorAll('.folder-song-slot').length === 2)
  assert.deepEqual((await songKeys()).sort(), ['/music/root.flac','/music/root2.flac'])
  assert.deepEqual(await rootPaths(), [], 'flat detail does not reveal child directories')
  assert.equal(await page.locator('.playlist-management-quick-index').count(), 0, 'hero detail has no root index')
  const hero = page.locator('.folder-hierarchy-content:not([inert]) > .playlist-hero')
  assert((await hero.innerText()).includes('2 |'), 'hero counts direct songs only')
  await screenshot('flat-folders-detail-640')
  await hero.locator('.playlist-hero-play-button').click()
  await readyForPlayback()
  assert.deepEqual(await queueIds(), ['root','root2'], 'header playback queues only direct songs')
  await returnToFlat()
  await hero.locator('.playlist-hero-shuffle-button').click()
  await readyForPlayback()
  assert.deepEqual(await queueIds(), ['root','root2'], 'shuffle keeps the exact direct-song set')
  await returnToFlat()
  await hero.locator('.playlist-search-button').click()
  await page.getByRole('searchbox').fill('root2')
  await page.waitForFunction(() => document.querySelectorAll('.folder-song-slot').length === 1)
  assert.deepEqual(await songKeys(), ['/music/root2.flac'], 'detail search has no recursive matches')
  await hero.locator('.playlist-hero-play-button').click()
  await readyForPlayback()
  assert.deepEqual(await queueIds(), ['root2'], 'filtered detail playback respects visible direct songs')
  await returnToFlat()
  if (await page.getByRole('searchbox').count()) await page.getByRole('searchbox').press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('.folder-song-slot').length === 2)
  await hero.locator('.playlist-select-toggle').click()
  await page.locator('.folder-song-slot .playlist-card[data-song-key="/music/root2.flac"]').click()
  await hero.locator('.playlist-hero-play-button').click()
  await readyForPlayback()
  assert.deepEqual(await queueIds(), ['root2'], 'selected direct-song playback excludes unselected sibling and descendants')
  await returnToFlat()
  if (await hero.locator('.playlist-select-toggle').getAttribute('aria-pressed') === 'true') await hero.locator('.playlist-select-toggle').click()
  await hero.locator('.playlist-hero-category').click()
  await rowAt('/music/Album/Disc').waitFor()
  assert.deepEqual((await rootPaths()).sort(), expectedPaths.sort(), 'detail back returns to flat collection, not filesystem parent')
  await selectCategory('folders')
  await page.getByRole('heading', { name: '文件夹层次结构', exact: true }).waitFor()
  assert.equal(await page.locator('.playlist-management-quick-index').count(), 1, 'hierarchy root also has quick index')
  await rowAt('/music').click()
  await rowAt('/music/Album').waitFor()
  assert((await rootPaths()).includes('/music/Parent'), 'hierarchy still contains intermediate containers')
  assert.deepEqual((await songKeys()).sort(), ['/music/root.flac','/music/root2.flac'], 'hierarchy still separates direct songs from child folders')
  assert(await page.locator('.folder-row-icon').count() > 0, 'hierarchy retains folder glyphs')
  assert.equal(await page.locator('.playlist-management-quick-index').count(), 0)
  await selectCategory('folder')
  await page.getByRole('heading', { name: '文件夹', exact: true }).waitFor()
  await rowAt('/external/Album').click()
  await page.waitForFunction(() => document.querySelectorAll('.folder-song-slot').length === 1)
  assert.deepEqual(await songKeys(), ['/external/Album/same.flac'], 'same-named directories from separate storage remain separate')
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content:not([inert])')?.dataset.directoryPath === '')
  assert.deepEqual(await songKeys(), [], 'removed source invalidates flat detail')
  const otherCategories = await page.evaluate(async () => (await import('/src/features/player/model/mediaLibraryCategories.ts')).mediaLibraryCategories.map(category => category.id).filter(id => id !== 'folder' && id !== 'folders'))
  for (const category of otherCategories) {
    await selectCategory(category)
    await page.locator('.playlist-management-quick-index').waitFor()
    assert.equal(await page.locator('.playlist-management-quick-index').count(), 1, `hero-free ${category} root has index even when empty`)
  }
  await page.goto(origin + '/__flat_folders_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 40)
  await selectCategory('folder')
  await page.locator('.playlist-management-quick-index').waitFor()
  await rowAt('/music').click()
  await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.deepEqual(await songKeys(), [], 'pending labels use loading state rather than showing filename placeholders')
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.waitForFunction(() => document.querySelectorAll('.folder-song-slot').length === 2)
  assert.deepEqual((await songKeys()).sort(), ['/music/root.flac','/music/root2.flac'], 'late metadata applies only to current direct-song detail')
  await page.goto(origin + '/__flat_folders_test?scanGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.folderRoots.length === 9 && window.pendingScans.length > 0)
  await selectCategory('folder')
  await page.locator('.playlist-management-quick-index').waitFor()
  assert.deepEqual(await rootPaths(), [], 'pending scan never invents direct-song folders')
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => window.vm.playlist.library.allSongs.length), 0, 'late scans cannot resurrect cleared storage in flat collection')
  assert.deepEqual(errors, [], 'no browser runtime errors')
  assert.deepEqual(consoleErrors, [], 'navigation and cancellation produce no React reconciliation errors')
  console.log('flat folders: all depths, overlapping roots, direct counts/play/shuffle/search/selection, direct-only artwork, same-name identity, index keyboard/pointer, player return, hierarchy parity and removed-source invalidation passed')
} catch (error) {
  await screenshot('flat-folders-failure')
  console.error(await page.evaluate(() => ({ route: window.vm?.playlist.library.route, flatLocation: window.vm?.playlist.library.flatFolderLocation, hierarchyLocation: window.vm?.playlist.library.folderLocation, metadata: window.vm?.playlist.library.allSongsMetadataStatus, text: document.querySelector('.folder-hierarchy-content:not([inert])')?.innerText, queue: window.vm?.queue.tracks.map(track => track.id) })), errors)
  throw error
} finally {
  await browser.close()
}
