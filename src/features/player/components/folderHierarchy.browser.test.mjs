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
import {PlayerSurface as RealSurface} from '/__folder_hierarchy_real_surface.js';
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
const roots=large?['/big']:['/music','/music/Album','/empty','/missing','/music-else','/branch','/legacy'];
const rows=[['root','/music/root.flac'],['root2','/music/root2.flac'],['album','/music/Album/album.flac'],['deep','/music/Album/Disc/deep.flac'],['other','/music-else/other.flac']];
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
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__folder_hierarchy_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 640, height: 1440 }, reducedMotion: 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__folder_hierarchy_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__folder_hierarchy_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__folder_hierarchy_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  // Gate scenarios isolate library restoration from the previous playback session.
  if (/large|Gate|cover/.test(location.search)) localStorage.removeItem('spmusic.player.session.v1')
})

const selectCategory = async category => page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
const rootPaths = async () => page.locator('[data-folder-path]').evaluateAll(nodes => nodes.map(node => node.dataset.folderPath))
const rowAt = path => page.locator(`[data-folder-path="${path}"]`)
const songKeys = async () => page.locator('.folder-hierarchy .playlist-card[data-song-key]').evaluateAll(nodes => nodes.map(node => node.dataset.songKey))
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: `${evidence}/${name}.png` }) }
const heroSelector = '.folder-hierarchy-content > .playlist-hero, .folder-hierarchy-content .folder-hero'
const verifyHeroWidths = async stage => {
  const measurements = []
  // Optional browser-only reproduction of the previous fixed-width rule.
  if (process.env.SPMUSIC_FOLDER_PREVIOUS_WIDTH) await page.addStyleTag({ content: '.folder-hierarchy-content header { max-width: 920px !important; }' })
  for (const width of [640, 1920, 2560]) {
    await page.setViewportSize({ width, height: width === 640 ? 1440 : 1080 })
    const geometry = await page.locator(heroSelector).evaluate(hero => {
      const panel = document.querySelector('.folder-hierarchy-content')
      const style = getComputedStyle(hero)
      const heroRect = hero.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const panelStyle = getComputedStyle(panel)
      return { width: innerWidth, heroWidth: heroRect.width, availableWidth: panel.clientWidth - Number.parseFloat(panelStyle.paddingLeft) - Number.parseFloat(panelStyle.paddingRight) - Number.parseFloat(style.marginLeft) - Number.parseFloat(style.marginRight), heroLeft: heroRect.left, panelLeft: panelRect.left + panel.clientLeft + Number.parseFloat(panelStyle.paddingLeft), marginLeft: Number.parseFloat(style.marginLeft) }
    })
    measurements.push(geometry)
    await screenshot(`folder-${stage}-${width}`)
  }
  console.log(`FOLDER_HERO_WIDTHS ${stage}`, JSON.stringify(measurements))
  for (const geometry of measurements) {
    assert(Math.abs(geometry.heroWidth - geometry.availableWidth) <= 1, `${stage} hero fills its content width at ${geometry.width}: ${JSON.stringify(geometry)}`)
    assert(Math.abs(geometry.heroLeft - geometry.panelLeft - geometry.marginLeft) <= 1, `${stage} hero keeps its left margin at ${geometry.width}`)
  }
  await page.setViewportSize({ width: 640, height: 1440 })
}
const motionGeometry = async () => page.evaluate(() => {
  const panel = document.querySelector('.folder-hierarchy-content')
  const hero = panel.querySelector(':scope > .playlist-hero')
  const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
  return { panel: box(panel), hero: box(hero), sidebar: box(document.querySelector('.folder-hierarchy > .playlist-library-sidebar')), scrollHeight: panel.scrollHeight, offset: Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0,
    rows: [...panel.querySelectorAll('.folder-row,.folder-song-slot')].map(box), controls: [...hero.querySelectorAll('button,.playlist-hero-title,.playlist-hero-meta')].map(box) }
})
const waitForRebound = async height => page.waitForFunction(height => {
  const panel = document.querySelector('.folder-hierarchy-content'), hero = panel?.querySelector(':scope > .playlist-hero')
  return hero && Math.abs(hero.getBoundingClientRect().height - height) < .2 && Math.abs(Number.parseFloat(getComputedStyle(panel).getPropertyValue('--playlist-overscroll-offset')) || 0) < .1
}, height, { timeout: 3000 })
const verifySharedHeroMotion = async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('.folder-hierarchy-content').evaluate(node => { node.scrollTop = 0 })
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content > .playlist-hero').getAnimations({ subtree: true }).length === 0)
  const before = await motionGeometry()
  const point = { x: before.panel.x + 8, y: before.hero.y + before.hero.height + 10 }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 96, { steps: 8 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const held = await motionGeometry()
  assert(held.hero.height > before.hero.height + 2, 'the shared hero stretches under trusted mouse drag')
  assert.equal(held.scrollHeight, before.scrollHeight, 'elastic feedback does not increase the native scroll range')
  assert.deepEqual(held.panel, before.panel, 'the folder scrollport remains fixed during stretch')
  assert.deepEqual(held.sidebar, before.sidebar, 'the sidebar remains fixed during stretch')
  held.rows.forEach((row, index) => {
    const delta = row.y - before.rows[index].y
    assert(delta >= held.offset - 1 && delta <= held.offset * 2 + 1, `each folder/song row receives one elastic translation: ${JSON.stringify({ index, delta, before, held })}`)
  })
  held.controls.forEach((control, index) => {
    assert(Math.abs(control.width - before.controls[index].width) < 1 && Math.abs(control.height - before.controls[index].height) < 1, 'shared inverse scale keeps title and control geometry stable')
  })
  await page.mouse.up()
  await waitForRebound(before.hero.height)
  await page.mouse.wheel(0, -180)
  await page.waitForFunction(height => document.querySelector('.folder-hierarchy-content > .playlist-hero').getBoundingClientRect().height > height + 1, before.hero.height)
  await waitForRebound(before.hero.height)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y === undefined ? [] : [{ id: 0, x: point.x, y, radiusX: 2, radiusY: 2, force: 1 }] })
  await touch('touchStart', point.y)
  for (const delta of [30, 65, 110]) await touch('touchMove', point.y + delta)
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert((await motionGeometry()).hero.height > before.hero.height + 2, 'trusted touch shares the elastic hero behavior')
  await touch('touchEnd')
  await waitForRebound(before.hero.height)
  await cdp.detach()
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 96, { steps: 6 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await waitForRebound(before.hero.height)
  await page.mouse.up()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 96, { steps: 6 })
  await page.evaluate(() => window.vm.playlist.library.onFolderLocationChange({ rootPath: '/music', directoryPath: '/music/Album' }))
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy-content')?.dataset.directoryPath === '/music/Album')
  await waitForRebound(before.hero.height)
  await page.evaluate(() => window.vm.playlist.library.onFolderLocationChange({ rootPath: '/music', directoryPath: '/music' }))
  await rowAt('/music/Album').waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 96, { steps: 6 })
  const reduced = await motionGeometry()
  assert(Math.abs(reduced.hero.height - before.hero.height) < .2, 'reduced motion cancels and disables elastic feedback')
  await page.mouse.up()
  console.log('FOLDER_SHARED_HERO_MOTION', JSON.stringify({ baseHeight: before.hero.height, heldHeight: held.hero.height, offset: held.offset, rowCount: held.rows.length, scrollHeight: held.scrollHeight }))
}
try {
  await page.goto(origin + '/__folder_hierarchy_test?run=1')
  const pathChecks = await page.evaluate(async () => {
    const { insideFolder, folderEntries, folderPath } = await import('/src/features/player/model/folderHierarchy.ts')
    return {
      sibling: insideFolder('/music-else/file.flac', '/music'),
      nested: insideFolder('C:\\Music\\Album\\track.flac', 'C:\\Music\\'),
      unc: folderPath('\\\\server\\share\\Music\\'),
      emptyChildren: folderEntries([{ path: '/empty', directoryPaths: ['/empty', '/empty/a', '/empty/a/b'], status: 'ready' }], [], { rootPath: '/empty', directoryPath: '/empty' }).map(item => item.path),
    }
  })
  assert.deepEqual(pathChecks, { sibling: false, nested: true, unc: '//server/share/Music', emptyChildren: [] }, 'path segments, Windows separators, UNC identity and empty-tree filtering')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 5 && !window.vm.playlist.library.isImportPending)
  await selectCategory('folders')
  await page.getByRole('heading', { name: '文件夹层次结构', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 5)
  assert.deepEqual((await rootPaths()).sort(), ['/missing','/music','/music-else','/music/Album','/legacy'].sort(), 'confirmed audio-free trees are hidden; selected roots with songs, errors or incomplete metadata remain')
  assert.equal(await page.locator('.folder-hierarchy .playlist-card[data-song-key]').count(), 0, 'root page does not flatten songs')
  assert.equal(await page.evaluate(() => window.vm.playlist.library.folderRoots.find(root => root.path === '/missing').status), 'error', 'failed root exposes error status')
  assert((await rowAt('/missing').innerText()).includes('Folder is missing'), 'native error object preserves its readable message')
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.allSongs.map(row => row.key).sort()), ['/music/root.flac','/music/root2.flac','/music/Album/album.flac','/music/Album/Disc/deep.flac','/music-else/other.flac'].sort(), 'overlapping selected roots dedupe all songs and keep adjacent root distinct')
  const rootLabels = { nonEmpty: await rowAt('/music').locator('.folder-meta').innerText(), failed: await rowAt('/missing').locator('.folder-meta').innerText(), legacy: await rowAt('/legacy').locator('.folder-meta').innerText() }
  console.log('FOLDER_ROOT_LABELS', JSON.stringify(rootLabels))
  assert.equal(await rowAt('/empty').count(), 0, 'a completely scanned empty leaf is hidden')
  assert.equal(await rowAt('/branch').count(), 0, 'a scanned tree containing only empty descendants is hidden')
  assert.equal(rootLabels.failed, '扫描失败', 'failed scan remains visible with its failure state')
  assert.equal(await rowAt('/legacy').count(), 1, 'missing directory metadata does not prove emptiness')
  await screenshot('folder-roots-640')
  await rowAt('/missing').click()
  await page.getByText('无法读取文件夹', { exact: true }).waitFor()
  assert((await page.locator('.folder-hierarchy-content').innerText()).includes('Folder is missing'))
  await page.getByRole('button', { name: '返回上一级文件夹', exact: true }).click()
  await page.evaluate(() => window.vm.playlist.library.onFolderLocationChange({ rootPath: '/empty', directoryPath: '/empty' }))
  await page.getByText('文件夹为空', { exact: true }).waitFor()
  assert.equal(await page.locator('.folder-hierarchy .playlist-card').count(), 0)
  await page.getByRole('button', { name: '返回上一级文件夹', exact: true }).click()
  await rowAt('/music').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 1)
  assert.deepEqual((await rootPaths()).sort(), ['/music/Album'], 'middle page contains immediate audio-bearing child folders only')
  await page.waitForFunction(() => [...document.querySelectorAll('.folder-hierarchy .playlist-card[data-song-key]')].length === 2)
  assert.deepEqual((await songKeys()).sort(), ['/music/root.flac','/music/root2.flac'], 'middle page contains direct songs only')
  assert((await page.locator('.folder-hierarchy-content').innerText()).includes('Title root'), 'real summary metadata is hydrated for folder cards')
  assert.equal(await rowAt('/music/Silent').count(), 0, 'confirmed empty subfolder is hidden from the mixed folder/song list')
  await verifyHeroWidths('mixed')
  await verifySharedHeroMotion()
  await screenshot('folder-mixed-640')
  await page.locator('.folder-hierarchy-content .playlist-search-button').click()
  await page.getByRole('searchbox', { name: '搜索文件夹和歌曲名称', exact: true }).fill('root2')
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 0)
  assert.deepEqual(await songKeys(), ['/music/root2.flac'], 'search filters both files and folders within the current directory')
  await page.getByRole('searchbox').press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 1)
  await page.locator('.folder-hierarchy-content .playlist-select-toggle').click()
  await rowAt('/music/Album').click()
  assert.equal(await rowAt('/music/Album').getAttribute('aria-pressed'), 'true', 'selection marks folders without navigating')
  await page.locator('.folder-hierarchy .playlist-card[data-song-key]').first().click()
  await page.getByText('已选择 2 项', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_and_play').length), 0, 'selection never starts playback')
  await page.locator('.folder-hierarchy-content .playlist-select-toggle').click()
  await rowAt('/music/Album').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 1)
  assert.deepEqual(await rootPaths(), ['/music/Album/Disc'])
  assert.deepEqual(await songKeys(), ['/music/Album/album.flac'])
  await rowAt('/music/Album/Disc').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-folder-path]').length === 0)
  await page.locator('.folder-hierarchy .playlist-card[data-song-key]').waitFor()
  assert.deepEqual(await songKeys(), ['/music/Album/Disc/deep.flac'], 'leaf page contains songs only')
  await verifyHeroWidths('leaf')
  await screenshot('folder-leaf-640')
  await page.locator('.folder-hierarchy .playlist-card[data-song-key]').click()
  await page.waitForFunction(() => window.vm.playback.track?.id === 'deep' && !window.vm.playback.isSelectionPending)
  assert.deepEqual(await page.evaluate(() => window.vm.queue.tracks.map(track => track.id)), ['deep'], 'leaf playback only queues the visible songs')
  await page.evaluate(() => window.vm.playlist.onOpenChange(false))
  await page.waitForFunction(() => !window.vm.playlist.isOpen)
  await page.evaluate(() => window.vm.playlist.onOpenChange(true))
  await page.waitForFunction(() => window.vm.playlist.isOpen)
  await page.locator('.folder-hierarchy .playlist-card[data-song-key]').waitFor()
  assert.deepEqual(await page.evaluate(() => window.vm.playlist.library.folderLocation), { rootPath: '/music', directoryPath: '/music/Album/Disc' }, 'return from player retains folder location')
  assert.deepEqual(await songKeys(), ['/music/Album/Disc/deep.flac'])
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.playlist-library-sidebar')
    return sidebar && sidebar.getBoundingClientRect().width > 0 && getComputedStyle(sidebar).display !== 'none'
  })
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.folder-hierarchy-content')
    const sidebar = document.querySelector('.playlist-library-sidebar')
    return { panelLeft: panel.getBoundingClientRect().left, sidebarRight: sidebar.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert(layout.panelLeft >= layout.sidebarRight - 1, 'full view content sits beside the shared sidebar')
  assert.equal(layout.overflow, false)
  await screenshot('folder-leaf-full')
  await page.getByRole('button', { name: '返回上一级文件夹', exact: true }).click()
  await rowAt('/music/Album/Disc').waitFor()
  await page.getByRole('button', { name: '返回上一级文件夹', exact: true }).click()
  await rowAt('/music/Album').waitFor()
  await page.locator('.folder-directory-list').hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await page.waitForFunction(() => localStorage.getItem('spmusic.folder-hierarchy.layout-level.v1') === '2')
  assert.deepEqual(await page.locator('.folder-hierarchy [data-layout-flow]').evaluateAll(nodes => nodes.map(node => node.dataset.layoutFlow)), ['tile','tile'], 'folders and songs switch their collection view together')
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  assert.equal(await page.locator('[data-folder-path]').count(), 0, 'clearing roots removes hierarchy entries')
  assert.equal(await page.locator('.folder-hierarchy .playlist-card[data-song-key]').count(), 0, 'clearing selected roots removes stale directory songs')
  assert.deepEqual(await page.evaluate(() => window.vm.queue.tracks.map(track => track.id)), ['deep'], 'library clearing retains active playback queue')
  await page.evaluate(() => { localStorage.removeItem('spmusic.player.session.v1'); localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1', '3') })
  await page.goto(origin + '/__folder_hierarchy_test?large=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 180 && !window.vm.playlist.library.isImportPending)
  await selectCategory('folders')
  await rowAt('/big').click()
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.locator('.folder-hierarchy .playlist-card').first().waitFor()
  assert(await page.locator('.folder-hierarchy .playlist-card').count() < 30, 'large leaf uses a bounded DOM render window')
  const boundary = page.locator('.folder-hierarchy .playlist-card').last()
  const boundaryIndex = Number((await boundary.getAttribute('data-song-key')).match(/\/(\d+)\.flac$/)[1])
  await boundary.evaluate(node => node.focus({ preventScroll: true }))
  await page.keyboard.press('Tab')
  await page.waitForFunction(expected => document.activeElement?.getAttribute('data-song-key') === expected, `/big/${boundaryIndex + 1}.flac`)
  await page.keyboard.press('Shift+Tab')
  await page.waitForFunction(expected => document.activeElement?.getAttribute('data-song-key') === expected, `/big/${boundaryIndex}.flac`)
  await page.locator('.folder-hierarchy-content').evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.locator('.folder-hierarchy .playlist-card[data-song-key="/big/179.flac"]').waitFor()
  assert(await page.locator('.folder-hierarchy .playlist-card').count() < 30, 'scrolling to the last song retains bounded DOM')
  await page.evaluate(() => localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1', '6'))
  await page.goto(origin + '/__folder_hierarchy_test?large=1&cover=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 180)
  await selectCategory('folders')
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.command === 'audio_load_track_thumbnail' || call.command === 'audio_load_folder_thumbnail').length), 0, 'text root page does not load hidden folder artwork')
  await rowAt('/big').click()
  await page.waitForFunction(() => {
    const image = document.querySelector('.folder-hierarchy-content > .playlist-hero img.playlist-hero-image')
    return image?.complete && image.naturalWidth > 0
  })
  assert(await page.evaluate(() => window.calls.some(call => call.command === 'audio_load_folder_thumbnail' && call.input.rootPath === '/big' && call.input.directoryPath === '/big')), 'entering a metadata-ready text directory still requests its folder hero thumbnail')
  const compact = page.locator('.folder-hierarchy > .playlist-controller-actions')
  assert.equal(await compact.getAttribute('aria-hidden'), 'true', 'compact actions are inaccessible while hero remains in view')
  await page.setViewportSize({ width: 640, height: 320 })
  assert.equal(await compact.getAttribute('data-actions-visible'), 'false', 'hero controls below the viewport bottom do not trigger an offscreen-top handoff')
  await page.setViewportSize({ width: 640, height: 1440 })
  await page.locator('.folder-hierarchy-content').evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy > .playlist-controller-actions')?.dataset.actionsVisible === 'true')
  assert.equal(await compact.getAttribute('inert'), null)
  await compact.locator('.playlist-search-button').focus()
  await page.locator('.folder-hierarchy-content').evaluate(node => { node.scrollTop = 0 })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.folder-hierarchy-content > .playlist-hero .playlist-search-button'))
  assert.equal(await compact.getAttribute('aria-hidden'), 'true', 'returning hero disables compact actions and transfers focus back to its matching control')
  await page.waitForFunction(() => {
    const image = document.querySelector('.folder-hierarchy-content > .playlist-hero img.playlist-hero-image')
    return image?.complete && image.naturalWidth > 0
  })
  await page.locator('.folder-hierarchy-content').evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.waitForFunction(() => document.querySelector('.folder-hierarchy > .playlist-controller-actions')?.dataset.actionsVisible === 'true')
  const firstLocationFrame = await page.evaluate(() => new Promise(resolve => {
    const shell = document.querySelector('.folder-hierarchy')
    const observer = new MutationObserver(() => {
      if (!shell.querySelector('.folder-hierarchy-content[data-directory-path="/big/old-empty"]:not([inert])')) return
      observer.disconnect()
      requestAnimationFrame(() => {
      const panel = shell.querySelector('.folder-hierarchy-content[data-directory-path="/big/old-empty"]:not([inert])'), actions = [...shell.querySelectorAll(':scope > .playlist-controller-actions')].find(node=>!node.hasAttribute('inert')||node.dataset.actionsVisible==='false')
      resolve({ directory: panel.dataset.directoryPath, scrollTop: panel.scrollTop, compactVisible: actions.dataset.actionsVisible, compactInert: actions.hasAttribute('inert') })
      })
    })
    observer.observe(shell, { attributes: true, attributeFilter: ['data-directory-path','inert'],childList:true,subtree:true })
    window.vm.playlist.library.onFolderLocationChange({ rootPath: '/big', directoryPath: '/big/old-empty' })
  }))
  assert.deepEqual(firstLocationFrame, { directory: '/big/old-empty', scrollTop: 0, compactVisible: 'false', compactInert: true }, 'location changes reset scroll and compact accessibility before the first painted frame')
  await page.getByText('文件夹为空', { exact: true }).waitFor()
  console.log('FOLDER_HERO_COVER_AND_HANDOFF metadata-ready text hero decoded, offscreen controls/focus and scroll return passed')
  await page.goto(origin + '/__folder_hierarchy_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 5)
  await selectCategory('folders')
  await rowAt('/music').click()
  await rowAt('/music/Album').click()
  await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await page.locator('.folder-hierarchy .playlist-card').count(), 0, 'pending metadata shows loading state instead of filename placeholder songs')
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await page.locator('.folder-hierarchy .playlist-card').waitFor()
  assert.deepEqual(await songKeys(), ['/music/Album/album.flac'], 'late metadata renders the currently browsed directory')
  await page.goto(origin + '/__folder_hierarchy_test?scanGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.folderRoots?.length === 7 && window.pendingScans.length > 0)
  await selectCategory('folders')
  await rowAt('/empty').waitFor()
  assert.equal(await rowAt('/empty').locator('.folder-meta').innerText(), '正在扫描…', 'pending scan is not mislabeled empty')
  await rowAt('/music').click()
  await page.getByText('正在扫描文件夹', { exact: true }).waitFor()
  await page.evaluate(() => window.settings.onClear())
  await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await page.evaluate(() => ({ roots: window.vm.playlist.library.folderRoots, songs: window.vm.playlist.library.allSongs })), { roots: [], songs: [] }, 'late scan completions cannot resurrect cleared folder selection')
  assert.deepEqual(errors, [], 'no browser runtime errors')
  console.log('folder hierarchy: root, mixed, leaf, search, selection, shared layouts, playback return, empty/error roots, full view, 180-song window/Tab, and stale scan/metadata acceptance passed')
} catch (error) {
  await screenshot('folder-failure')
  console.error(await page.evaluate(() => ({ route: window.vm?.playlist.library.route, location: window.vm?.playlist.library.folderLocation, metadata: window.vm?.playlist.library.allSongsMetadataStatus, roots: window.vm?.playlist.library.folderRoots, rows: window.vm?.playlist.library.allSongs.map(row => ({ key: row.key, title: row.track.title })), text: document.querySelector('.folder-hierarchy-content')?.innerText, rendered: [...document.querySelectorAll('.folder-songs,.folder-song-slot')].map(node => ({ class: node.className, count: node.childElementCount, height: node.getBoundingClientRect().height, style: node.getAttribute('style') })), errors: window.calls?.filter(call => ['audio_load_file','audio_load_and_play'].includes(call.command)) })))
  throw error
} finally {
  await browser.close()
}
