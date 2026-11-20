// Independent acceptance: actual PlayerShell, simulated existing native transport.
// Requires Vite at SPMUSIC_TEST_ORIGIN (default http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

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
import {PlayerSurface as RealSurface} from '/__insets_real_surface.js';
export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;let viewModel=new URLSearchParams(location.search).has('indexLocal')?{...props.viewModel,search:undefined}:props.viewModel;if(new URLSearchParams(location.search).has('playlistReference'))viewModel={...viewModel,playlist:{...viewModel.playlist,tracks:(viewModel.playlist.library.allSongs??[]).map(item=>item.track),metadataStatus:'ready',library:{...viewModel.playlist.library,isOpen:false,route:{view:'category',categoryId:'songs'}}}};return React.createElement(RealSurface,{...props,viewModel})}
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
const largeCount=Number(new URLSearchParams(location.search).get('count'));if(largeCount)rows.splice(0,rows.length,...Array.from({length:largeCount},(_,i)=>['track-'+i,'/music/Mixed/Track-'+String(i).padStart(3,'0')+'.flac','Mixed','Ensemble','Rock']));rows.forEach(row=>{row[2]='Mixed';row[3]='Ensemble';row[4]='Rock'});const mixedArtists=false;window.summaryGenres=Object.fromEntries(rows.map(row=>[row[0],row[4]]));
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
  return input.paths.map(sourcePath=>{const item=track(sourcePath);return {sourcePath,summary:{title:item.metadata.title,artist:item.metadata.artist,album:item.metadata.album,albumArtist:item.metadata.albumArtist,genre:window.summaryGenres[item.id],year:2022,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 if(command==='audio_set_volume'){state={...state,volume:input.volume};return {...state}}
 throw Error('Unexpected native command '+command);
};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__insets_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.SPMUSIC_TEST_WIDTH) || 640, height: 1440 }, reducedMotion: process.env.SPMUSIC_TEST_MOTION ? 'no-preference' : 'reduce' })
page.setDefaultTimeout(15000)
const errors = [], consoleErrors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
await page.route('**/__insets_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
await page.route('**/__insets_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
await page.route('**/__insets_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
await page.addInitScript(() => {
  localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
  localStorage.removeItem('spmusic.player.session.v1')
  const level = new URLSearchParams(location.search).get('level') ?? '3'
  for (const key of ['playlist', 'genre-songs', 'genre-album-tracks', 'year-songs', 'year-album-tracks']) localStorage.setItem('spmusic.' + key + '.layout-level.v1', level)
})
const output = process.env.SPMUSIC_TEST_SCREENSHOTS || 'D:/spmusic-artifacts/category-song-insets'
mkdirSync(output, { recursive: true })
const measurements = [], mismatches = []
const active = () => page.locator('.album-library-content:not([inert])')
const capture = async (kind, width, level) => {
  const panel = kind === 'playlist' ? page.locator('.playlist-panel:not([inert])').first() : active()
  await panel.waitFor()
  await panel.locator('.playlist-grid .playlist-card').first().waitFor()
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(width - 1, 1)
  const geometry = await panel.evaluate(node => {
    const grid = node.querySelector('.playlist-grid'), first = grid.querySelector('.playlist-card')
    const rect = element => {
      if (!element) return null
      const r = element.getBoundingClientRect(), s = getComputedStyle(element)
      return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height, display: s.display, overflowX: s.overflowX, overflowY: s.overflowY }
    }
    const cards = [...grid.querySelectorAll('.playlist-card')].filter(card => Math.abs(card.getBoundingClientRect().top - first.getBoundingClientRect().top) < 1)
    const panel = rect(node), cardRects = cards.map(rect)
    const backgrounds = { left: Math.min(...cardRects.map(r => r.left)), right: Math.max(...cardRects.map(r => r.right)) }
    const all = [...grid.querySelectorAll('.playlist-card')]
    const covers = cards.map(card => rect(card.querySelector('.playlist-card-cover'))).filter(r => r?.display !== 'none')
    const copies = cards.map(card => rect(card.querySelector('.playlist-card-copy')))
    return { panel, clientWidth: node.clientWidth, grid: rect(grid), level: grid.dataset.layoutLevel, flow: grid.dataset.layoutFlow, cardRects, covers, copies, backgrounds,
      leftInset: backgrounds.left - panel.left, rightInset: panel.right - backgrounds.right,
      unexpectedClip: [...grid.querySelectorAll('.playlist-card')].some(card => { const r = card.getBoundingClientRect(); return r.left < panel.left - .1 || r.right > panel.left + node.clientWidth + .1 }),
      cardCount: all.length }
  })
  assert.equal(geometry.level, String(level), kind + ' actual layout level')
  if (level === 3 || process.env.SPMUSIC_TEST_ALL_SCREENSHOTS) {
    const path = output + '/' + (process.env.SPMUSIC_TEST_BASELINE ? 'baseline-' : 'fixed-') + kind + '-' + width + '-level' + level
    await page.screenshot({ path: path + '.png' })
    await panel.locator('.playlist-grid .playlist-card').first().hover()
    await page.screenshot({ path: path + '-hover.png' })
  }
  const result = { kind, width, layout: level, ...geometry }
  measurements.push(result)
  return result
}
const enter = async (category, branch) => {
  await page.evaluate(category => window.vm.playlist.library.onSelectCategory(category), category)
  await page.waitForFunction(() => window.vm.playlist.library.allSongsMetadataStatus === 'ready')
  const root = active().locator(category === 'genre' ? '.genre-card' : '.year-card').filter({ has: page.locator('.folder-name', { hasText: category === 'genre' ? /^Rock$/ : /^2022$/ }) })
  await root.click()
  if (branch === 'songs') await active().locator(category === 'genre' ? '.genre-all-songs' : '.year-all-songs').click()
  else await active().locator('.album-card').filter({ has: page.locator('.folder-name', { hasText: /^Mixed$/ }) }).click()
  await page.waitForFunction(({ category, branch }) => document.querySelector('.album-library-content:not([inert])')?.dataset[category + 'View'] === branch, { category, branch })
}
const closeEnough = (left, right) => Math.abs(left - right) < .15
const compare = (actual, reference) => {
  for (const property of ['leftInset', 'rightInset']) if (!closeEnough(actual[property], reference[property])) mismatches.push({ kind: actual.kind, width: actual.width, level: actual.layout, property, actual: actual[property], expected: reference[property] })
  for (const field of ['cardRects', 'covers', 'copies']) {
    if (actual[field].length !== reference[field].length) { mismatches.push({ kind: actual.kind, width: actual.width, level: actual.layout, property: field + '.length', actual: actual[field].length, expected: reference[field].length }); continue }
    for (const [index, value] of actual[field].entries()) for (const side of ['left', 'right']) {
      const actualInset = side === 'left' ? value[side] - actual.panel.left : actual.panel.right - value[side]
      const expectedInset = side === 'left' ? reference[field][index][side] - reference.panel.left : reference.panel.right - reference[field][index][side]
      if (!closeEnough(actualInset, expectedInset)) mismatches.push({ kind: actual.kind, width: actual.width, level: actual.layout, property: field + '.' + index + '.' + side, actual: actualInset, expected: expectedInset })
    }
  }
  if (actual.unexpectedClip) mismatches.push({ kind: actual.kind, width: actual.width, level: actual.layout, property: 'card-outside-panel', actual: true, expected: false })
}
try {
  const widths = process.env.SPMUSIC_TEST_BASELINE ? [640] : [456, 640, 1440]
  const levels = process.env.SPMUSIC_TEST_BASELINE ? [3] : Array.from({ length: 10 }, (_, i) => i)
  for (const width of widths) for (const level of levels) {
    await page.setViewportSize({ width, height: 1440 })
    await page.goto(origin + '/__insets_test?playlistReference=1&level=' + level)
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
    await page.evaluate(() => window.vm.playlist.onOpenChange(true))
    const reference = await capture('playlist', width, level)
    await page.goto(origin + '/__insets_test?level=' + level)
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 9)
    for (const category of ['genre', 'year']) for (const branch of ['songs', 'album']) {
      await enter(category, branch)
      const actual = await capture(category + '-' + branch, width, level)
      compare(actual, reference)
    }
    console.log('INSETS', width, level, JSON.stringify(measurements.slice(-5).map(item => ({ kind: item.kind, left: item.leftInset, right: item.rightInset, cover: item.covers[0]?.left - item.panel.left, copy: item.copies[0]?.left - item.panel.left }))))
  }
  if (!process.env.SPMUSIC_TEST_BASELINE) for (const width of [456, 1440]) {
    await page.setViewportSize({ width, height: 1440 })
    await page.goto(origin + '/__insets_test?playlistReference=1&level=3&count=240')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 240)
    await page.evaluate(() => window.vm.playlist.onOpenChange(true))
    const reference = await capture('playlist', width, 3)
    reference.virtualReference = true
    await page.goto(origin + '/__insets_test?level=3&count=240')
    await page.waitForFunction(() => window.vm?.playlist.library.allSongs.length === 240)
    for (const category of ['genre', 'year']) for (const branch of ['songs', 'album']) {
      await enter(category, branch)
      const before = await capture(category + '-' + branch, width, 3)
      before.virtual = 'before-scroll'
      compare(before, reference)
      const firstKey = await active().locator('.playlist-card[data-song-key]').first().getAttribute('data-song-key')
      await active().evaluate(node => { node.scrollTop = 9000 })
      await page.waitForFunction(firstKey => document.querySelector('.album-library-content:not([inert]) .playlist-card[data-song-key]')?.getAttribute('data-song-key') !== firstKey, firstKey)
      const after = await capture(category + '-' + branch, width, 3)
      after.virtual = 'after-scroll'
      assert.equal(after.grid.width, before.grid.width)
      assert(after.cardCount < 240, 'large list renders a bounded row window')
      const position = await active().locator('.playlist-grid').evaluate(node => getComputedStyle(node).position)
      assert.equal(position, 'absolute', 'large collection uses the real virtual grid')
      compare(after, reference)
    }
    console.log('VIRTUAL_INSETS', width, '240-song absolute grids retain playlist boundaries before/after scroll')
  }
  writeFileSync(output + '/' + (process.env.SPMUSIC_TEST_BASELINE ? 'baseline' : 'fixed') + '-geometry.json', JSON.stringify({ measurements, mismatches, errors, consoleErrors }, null, 2))
  if (process.env.SPMUSIC_TEST_BASELINE) assert(mismatches.length > 0, 'baseline reproduces a real geometry mismatch')
  else assert.deepEqual(mismatches, [], 'genre/year song views match real playlist card, cover and copy geometry at every layout')
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
  console.log('category song inset geometry:', process.env.SPMUSIC_TEST_BASELINE ? 'baseline mismatch reproduced' : 'all 120 category comparisons passed')
} catch (error) {
  writeFileSync(output + '/failure-geometry.json', JSON.stringify({ measurements, mismatches, errors, consoleErrors }, null, 2))
  await page.screenshot({ path: output + '/failure.png' })
  console.error(await page.evaluate(() => ({ route: window.vm?.playlist.library.route, text: document.body.innerText })), errors, consoleErrors)
  throw error
} finally { await browser.close() }
