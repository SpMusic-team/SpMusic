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
const surface = `import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__contributor_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.summaryGate=new URLSearchParams(location.search).has('summaryGate');window.pendingSummaries=[];window.scanGate=false;window.pendingScans=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const roots=['/music','/hidden'];
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
const track=path=>{const descriptor=descriptors.find(row=>row.sourcePath===path);if(!descriptor)throw Error('Unknown path '+path);const row=rows.find(row=>row[0]===descriptor.id);return {...descriptor,durationMs:180000,metadata:{title:'Song '+row[0],artist:row[2],album:row[1],albumArtist:row[3],composer:row[4],genre:null,year:2023,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
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
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_probe_playlist_cover'){const result=track(input.path);return {id:result.id,sourcePath:result.sourcePath,coverArt:null}}
 if(['audio_load_track_thumbnail','audio_load_playlist_cover_pixels','audio_load_folder_thumbnail'].includes(command))return new Uint8Array(0);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
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
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__contributor_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce', hasTouch: true })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__contributor_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__contributor_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__contributor_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => { localStorage.setItem('spmusic.player.startup-page.v1', 'media-library'); localStorage.removeItem('spmusic.player.session.v1') })
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const screenshot = async name => { if (evidence) await page.screenshot({ path: evidence + '/' + name + '.png' }) }
const selectCategory = async category => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(category => window.vm.playlist.library.route.categoryId === category, category)
}
const active = () => page.locator('.album-library-content:not([inert])')
const cards = () => active().locator('.artist-card')
const card = name => cards().filter({ has: page.locator('.folder-name', { hasText: new RegExp('^' + name + '$') }) }).first()
const allSongs = () => active().locator('.artist-all-songs')
const songs = () => active().locator('.album-songs .playlist-card[data-song-key]')
const songIds = () => songs().evaluateAll(nodes => nodes.map(node => node.dataset.songKey.split('/').at(-1).replace('.flac', '')).sort())
const queueIds = () => page.evaluate(() => window.vm.queue.tracks.map(track => track.id).sort())
const locationProperty = category => category === 'album-artist' ? 'albumArtistLocation' : category === 'composer' ? 'composerLocation' : 'artistLocation'
const currentLocation = category => page.evaluate(property => window.vm.playlist.library[property], locationProperty(category))
const ready = () => page.waitForFunction(() => !window.vm.playback.isSelectionPending)
const backFromPlayer = async () => { await page.evaluate(() => window.vm.playlist.onOpenChange(false)); await page.waitForFunction(() => !window.vm.playlist.isOpen); await page.evaluate(() => window.vm.playlist.onOpenChange(true)); await page.waitForFunction(() => window.vm.playlist.isOpen) }
const rootGeometry = async () => cards().first().evaluate(node => { const cover = node.querySelector('.folder-cover'), label = node.querySelector('.folder-name'); const style = getComputedStyle(cover); return { width: cover.offsetWidth, height: cover.offsetHeight, radius: style.borderRadius, font: getComputedStyle(label).fontSize, className: node.className } })
const up = async () => { await active().locator('.playlist-hero-category').click(); await page.waitForFunction(() => document.querySelectorAll('.album-library-content:not([inert])').length === 1) }

try {
  await page.goto(origin + '/__contributor_test?normal=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 8 && !window.vm.playlist.library.isImportPending)
  await selectCategory('artist'); await card('Singer A').waitFor()
  const artistGeometry = await rootGeometry()
  for (const [category, label, member, expectedIds] of [
    ['album-artist', '专辑艺术家', 'Album Group', ['a', 'b', 'collab', 'duet']],
    ['composer', '作曲家', 'Writer One', ['a', 'collab', 'duet']],
  ]) {
    await selectCategory(category); await card(member).waitFor()
    assert.deepEqual(await rootGeometry(), artistGeometry, `${category} uses existing artist card geometry and styles`)
    const names = await cards().locator('.folder-name').allTextContents()
    assert(!names.includes('Performer Only') && !names.includes('Display fallback') && !names.some(name => name.startsWith('Hidden')), 'raw category ignores performer fallback and unselected storage')
    assert.equal(names.filter(name => name === '未知' + label).length, 2, 'missing and literally named unknown retain separate identities')
    assert(names.includes('AC/DC') && !names.includes('AC') && !names.includes('DC'))
    await screenshot(category + '-root')
    await card(member).click(); await allSongs().waitFor()
    assert.equal(await allSongs().locator('.artist-all-songs-title').textContent(), '所有' + label + '歌曲')
    assert.deepEqual(await currentLocation(category), { artistKey: JSON.stringify([category, member]), view: 'albums' })
    assert.equal(await allSongs().locator('.artist-song-count').textContent(), expectedIds.length + ' 首歌曲')
    await screenshot(category + '-overview')
    const trigger = active().locator('.playlist-hero-more-button')
    await trigger.click()
    const menu = page.getByRole('dialog', { name: label + '更多操作', exact: true })
    await menu.waitFor(); assert.equal(await menu.locator('.playlist-hero-more-info h2').textContent(), member)
    const pinsBefore = await page.evaluate(() => window.vm.playlist.library.pinnedCategoryIds)
    const pinned = pinsBefore.includes(category)
    await menu.getByRole('button', { name: pinned ? '取消侧栏置顶' : '在侧栏置顶', exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
    const pinsAfter = await page.evaluate(() => window.vm.playlist.library.pinnedCategoryIds)
    assert.equal(pinsAfter.includes(category), !pinned)
    assert.deepEqual(pinsAfter.filter(id => id !== category), pinsBefore.filter(id => id !== category), 'pin action changes only current category')
    await allSongs().click(); await songs().first().waitFor()
    assert.deepEqual(await songIds(), expectedIds)
    await songs().first().click(); await ready()
    assert.deepEqual(await queueIds(), expectedIds, 'song playback retains exactly the contributor scope')
    await backFromPlayer(); await songs().first().waitFor()
    assert.equal((await currentLocation(category)).view, 'songs', 'playback returns to exact contributor drilldown')
    const hydrated = await page.evaluate(() => window.vm.playlist.library.allSongs.find(song => song.trackId === 'a').track)
    assert.equal(hydrated.libraryArtistName, 'Singer A'); assert.equal(hydrated.albumArtist, 'Album Group'); assert.equal(hydrated.libraryComposerName, 'Writer One')
    await up(); await allSongs().waitFor()
    const entries = active().locator('button[data-album-key]:not(.artist-card)')
    await entries.first().click(); await songs().first().waitFor()
    assert((await songIds()).every(id => expectedIds.includes(id)), 'album songs never broaden contributor membership')
    const retained = await currentLocation(category)
    await selectCategory(category === 'composer' ? 'album-artist' : 'composer')
    assert.deepEqual(await currentLocation(category), retained, 'selecting another category does not overwrite inactive contributor state')
    await selectCategory(category); await card(member).waitFor()
    assert.equal(await currentLocation(category), null, 'explicit category menu entry resets that category to its root')
    await page.getByRole('button', { name: '搜索' + label + '和歌曲', exact: true }).click()
    await active().getByRole('searchbox').fill(category === 'composer' ? 'Writer ' : 'Album Group')
    await page.waitForFunction(() => !document.querySelector('.album-library-content:not([inert]) .folder-name')?.textContent?.includes('未知'))
    assert((await cards().locator('.folder-name').allTextContents()).every(name => name.includes(category === 'composer' ? 'Writer ' : 'Album Group')))
    await screenshot(category + '-search')
    await active().locator('.playlist-management-toolbar').getByRole('button', { name: '选择', exact: true }).click()
    await card(member).click()
    if (category === 'composer') await card('Writer Two').click()
    await page.getByRole('button', { name: '播放' + label + '歌曲', exact: true }).click(); await ready()
    assert.deepEqual(await queueIds(), ['a', 'b', 'collab', 'duet'], 'selected contributor union deduplicates collaboration songs')
    await backFromPlayer()
    await page.evaluate(category => window.vm.playlist.library[category === 'composer' ? 'onComposerLocationChange' : 'onAlbumArtistLocationChange'](null), category)
  }
  // Fresh mount avoids search state influencing pending/rescan lifecycle checks.
  await page.goto(origin + '/__contributor_test?summaryGate=1')
  await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 8)
  await selectCategory('composer'); await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await cards().count(), 0, 'pending metadata cannot fabricate unknown composers')
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await card('Writer One').waitFor(); await card('Writer One').click(); await allSongs().waitFor()
  const retained = await currentLocation('composer')
  await page.evaluate(() => { window.scanGate = true; window.vm.playlist.library.onRescanFolders() })
  await page.waitForFunction(() => window.pendingScans.length > 0)
  assert.deepEqual(await currentLocation('composer'), retained, 'rescan keeps active composer during temporary empty projection')
  await page.evaluate(() => { window.scanGate = false; window.pendingScans.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => !window.vm.playlist.library.isFolderRescanPending && window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  await allSongs().waitFor(); assert.deepEqual(await currentLocation('composer'), retained)
  await page.evaluate(() => window.settings.onClear()); await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0 && window.vm.playlist.library.composerLocation === null && window.vm.playlist.library.albumArtistLocation === null)
  await page.getByText('暂无作曲家', { exact: true }).waitFor()
  await selectCategory('album-artist'); await page.getByText('暂无专辑艺术家', { exact: true }).waitFor()
  await page.goto(origin + '/__contributor_test?summaryGate=1'); await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 8)
  await selectCategory('album-artist'); await page.waitForFunction(() => window.pendingSummaries.length > 0)
  assert.equal(await cards().count(), 0)
  await page.evaluate(() => window.settings.onClear()); await page.waitForFunction(() => window.vm.playlist.library.folderRoots.length === 0)
  await page.evaluate(() => { window.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await cards().count(), 0, 'late summaries cannot recreate cleared contributors')
  assert.deepEqual(errors, [])
  console.log('contributor library: independent raw tags, unknown/pending, splitting, scoped albums/playback, return, isolated navigation/pins, style parity, search, rescan and late summaries passed')
} catch (error) {
  await screenshot('contributor-failure')
  console.error(await page.evaluate(() => ({ route: window.vm?.playlist.library.route, albumArtistLocation: window.vm?.playlist.library.albumArtistLocation, composerLocation: window.vm?.playlist.library.composerLocation, text: document.querySelector('.album-library-content:not([inert])')?.innerText })), errors)
  throw error
} finally { await browser.close() }
