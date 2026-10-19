// Independent browser acceptance test for the playlist tag summary channel.
// Start Vite, then provide an existing Playwright package with SPMUSIC_PLAYWRIGHT.
// Real PlayerShell, useAudioPlayer, PlayerSurface, PlaylistPanel and command
// parsers are used; only the native command/event transport is replaced.
//
// The regression this file locks in: the playlist detail and the queue panel used
// to show the playlist name as every row's artist/album (and `本地音频` while
// browsing another session list) until the expensive hydration pump reached that
// row. Rows must now be either an explicit loading state or real tag text.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
assert(service.includes('window.backendInvoke'), 'retain real audio command parser')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__summary_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
window.calls=[];window.config={scope:'a',count:3,gate:false,summaryGate:false,failSummaries:false};window.pending=[];window.pendingSummaries=[];
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0,currentTrack=null;
const descriptor=(scope,i)=>({id:scope+'-'+i,sourcePath:'/audio/'+scope+'/'+i+'.flac',fileName:i+'.flac',available:true});
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:'Folder '+window.config.scope,sourceKind:'m3u8',sourcePath:'/lists/'+window.config.scope+'.m3u8',sourceName:'Playlist '+window.config.scope,selectedIndex:0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
const track=path=>{const parts=path.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {...descriptor(scope,i),durationMs:180000,metadata:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,time:performance.now()});
 if(command==='audio_get_state')return {...state};
 if(command==='audio_get_current_track')return currentTrack;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:playlist()}
 if(command==='audio_load_file'||command==='audio_load_and_play'){
  const result=track(input.path);currentTrack=result;state={...state,phase:command==='audio_load_and_play'?'playing':'ready',generation:++generation,currentTrackId:result.id,durationMs:180000,positionMs:0};
  if(command==='audio_load_file')return result;
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state:{...state}};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;
 }
 if(command==='audio_hydrate_track')return track(input.path);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations')return input.paths.map(sourcePath=>({sourcePath,durationMs:180000,error:null}));
 if(command==='audio_probe_playlist_track_summaries'){
  if(window.config.summaryGate)await new Promise(resolve=>window.pendingSummaries.push(resolve));
  if(window.config.failSummaries)throw {code:'INTERNAL_ERROR',message:'injected summary failure',recoverable:true};
  return input.paths.map(sourcePath=>{const parts=sourcePath.replaceAll('\\\\','/').split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {sourcePath,summary:{title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null,bitDepth:24,sampleRateHz:96000,bitrateKbps:null,codec:'FLAC'},error:null}});
 }
 if(command==='audio_load_playlist_cover_pixels')throw {code:'NO_COVER_ART',message:'fixture has no artwork',recoverable:false};
 if(command==='audio_transition_playback'||command==='audio_play'||command==='audio_pause'){state={...state,phase:command==='audio_pause'?'paused':input?.target??'playing',transportSettledRequestId:input?.requestId??null};return {...state}}
 if(command==='audio_seek'){state={...state,positionMs:input.positionMs};return {...state}}
 throw new Error('Unexpected native command '+command);
};
window.emitPosition=positionMs=>{state={...state,positionMs};window.listeners?.audio_state_changed?.({payload:{...state}})};
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(AppearanceProvider,null,React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__summary_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const screenshotDirectory = process.env.SPMUSIC_SCREENSHOT_DIR || join(tmpdir(), 'spmusic-playlist-summaries')
mkdirSync(screenshotDirectory, { recursive: true })
const report = []

async function open(width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message) })
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__summary_real_surface.js', route => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__summary_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__summary_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__summary_test')
  await page.waitForFunction(() => Boolean(window.viewModel))
  return { page, errors }
}

async function importScope(page, scope, patch = {}) {
  await page.evaluate(({ scope, patch }) => {
    Object.assign(window.config, { scope, count: 3, ...patch })
    window.viewModel.playback.onOpenAudio()
  }, { scope, patch })
  await page.waitForFunction(() => !window.viewModel.playback.isAudioBusy && !window.viewModel.playback.isSelectionPending)
}

const openDetail = page => page.locator('.window-bar').getByRole('button', { name: '播放列表', exact: true }).click()

// Text of every row, split into the fields the regression is about.
const rowText = page => page.evaluate(() => ({
  loading: document.querySelectorAll('.playlist-loading').length,
  cards: [...document.querySelectorAll('.playlist-card')].map(card => ({
    title: card.querySelector('.playlist-card-title')?.textContent ?? null,
    artist: card.querySelector('.playlist-card-artist')?.textContent ?? null,
    label: card.getAttribute('aria-label'),
  })),
  queueRows: [...document.querySelectorAll('.debug-queue-panel li')].map(row => ({
    title: row.querySelector('.queue-row-title, strong')?.textContent ?? null,
    artist: row.querySelector('small')?.textContent ?? null,
  })),
}))

try {
  // 1. Gated summary: the queue panel (auto-opened by the import) and the detail
  //    page never show placeholder text while the tags are still unknown.
  const { page, errors } = await open()
  await page.evaluate(() => { window.config.summaryGate = true })
  await importScope(page, 'a')
  await page.locator('.debug-queue-panel').waitFor({ state: 'attached' })
  await page.locator('.debug-queue-panel li').first().waitFor({ state: 'attached' })
  const queuePending = await page.evaluate(() => ({
    header: document.querySelector('.debug-queue-panel header')?.innerText ?? null,
    rows: [...document.querySelectorAll('.debug-queue-panel li')].map(row => ({
      title: row.querySelector('strong')?.textContent ?? null,
      artist: row.querySelector('small')?.textContent ?? null,
    })),
    artists: document.querySelectorAll('.debug-queue-panel li small').length,
  }))
  // The currently playing row, and any row the visible-window hydration has
  // already refined, may carry the real artist; no row may invent one.
  assert(queuePending.rows.every(row => row.artist === null || row.artist === 'Artist a'), 'queue rows never show an unknown artist')
  assert(queuePending.rows.every(row => row.artist !== 'Playlist a'), 'queue rows never use the playlist name as an artist')
  assert(queuePending.rows.every(row => row.title !== 'Playlist a'), 'queue rows never borrow the playlist name as a title')
  assert(queuePending.rows.every(row => Boolean(row.title) && row.title !== 'Playlist a'), 'queue rows always keep a real title')
  assert(String(queuePending.header).includes('Playlist a'), 'the queue header keeps showing the playlist name')

  await openDetail(page)
  await page.locator('.playlist-panel').waitFor()
  await page.waitForFunction(() => window.viewModel.playlist.metadataStatus === 'loading')
  await page.locator('.playlist-loading').waitFor()
  const status = page.locator('.playlist-loading')
  assert.equal(await status.getAttribute('role'), 'status', 'loading state is announced as a status')
  assert.equal(await status.getAttribute('aria-busy'), 'true', 'loading state reports busy')
  assert.equal(await page.locator('.playlist-card').count(), 0, 'no fabricated card is rendered while tags are unknown')
  const pending = await rowText(page)
  assert.equal(pending.loading, 1)
  assert.equal(await page.locator('.playlist-card-artist').count(), 0)
  assert(await page.evaluate(() => !document.querySelector('.playlist-panel')?.textContent.includes('本地音频')), 'no 本地音频 fallback text while loading')
  assert(await page.evaluate(() => !document.querySelector('.playlist-loading')?.textContent.includes('Playlist a')), 'the loading state carries no playlist-derived song text')
  await page.screenshot({ path: join(screenshotDirectory, 'summaries-loading.png') })
  report.push('gated summary: explicit loading state, no placeholder artist/album text')

  // 2. Summaries arrive: real title/artist/album in the detail grid and in the queue.
  await page.evaluate(() => { window.config.summaryGate = false; window.pendingSummaries.splice(0).forEach(resolve => resolve()) })
  await page.waitForFunction(() => window.viewModel.playlist.metadataStatus === 'ready')
  await page.locator('[data-playlist-track-id="a-1"]').waitFor()
  assert.equal(await page.locator('.playlist-loading').count(), 0, 'loading state disappears once rows are real')
  const ready = await rowText(page)
  assert.deepEqual(
    ready.cards.slice(0, 3).map(card => [card.title, card.artist]),
    [['Song a 0', 'Artist a'], ['Song a 1', 'Artist a'], ['Song a 2', 'Artist a']],
    'detail rows show the real song and artist tags',
  )
  assert(ready.cards.every(card => card.label?.startsWith('Song a ')), 'card labels use the real title')
  assert(ready.cards.every(card => card.artist !== 'Playlist a'), 'the playlist name is never used as an artist')
  assert.equal(await page.locator('.playlist-hero-title').textContent(), 'Playlist a', 'the hero keeps the playlist name')
  await page.screenshot({ path: join(screenshotDirectory, 'summaries-ready.png') })
  // The queue panel lives in the player stage, so return there before checking it.
  await page.evaluate(() => window.viewModel.playlist.onOpenChange(false))
  await page.locator('.debug-queue-panel').waitFor({ state: 'attached' })
  await page.locator('.debug-queue-panel li').first().waitFor({ state: 'attached' })
  const queueReady = await page.evaluate(() => [...document.querySelectorAll('.debug-queue-panel li')].map(row => ({
    title: row.querySelector('strong')?.textContent ?? null,
    artist: row.querySelector('small')?.textContent ?? null,
  })))
  assert(queueReady.every(row => row.title?.startsWith('Song a ')), 'queue rows show the real title')
  assert(queueReady.every(row => row.artist === 'Artist a'), 'queue rows show the real artist')
  assert.deepEqual(errors, [])
  report.push('ready summary: detail grid and queue rows carry the real title/artist/album')
  await page.close()

  // 3. A failing command degrades to the file-name row instead of a permanent
  //    loading state, and still never fabricates an artist from the list name.
  //    Visible rows may still be refined by the existing hydration pump, so only
  //    the invariants that hold either way are asserted here.
  const degraded = await open()
  await degraded.page.evaluate(() => { window.config.failSummaries = true })
  await importScope(degraded.page, 'b')
  await openDetail(degraded.page)
  await degraded.page.locator('.playlist-panel').waitFor()
  await degraded.page.waitForFunction(() => window.viewModel.playlist.metadataStatus === 'ready')
  await degraded.page.locator('[data-playlist-track-id="b-1"]').waitFor()
  assert.equal(await degraded.page.locator('.playlist-loading').count(), 0, 'a failed pass cannot stay in the loading state')
  const degradedText = await rowText(degraded.page)
  assert.equal(degradedText.cards.length, 3, 'every row is still rendered after a failed summary pass')
  assert(degradedText.cards.every(card => card.artist !== 'Playlist b'), 'degraded rows never borrow the playlist name')
  assert(degradedText.cards.every(card => card.label && card.label !== 'Playlist b'), 'degraded labels keep the file name')
  await degraded.page.evaluate(() => window.viewModel.playlist.onOpenChange(false))
  await degraded.page.locator('.debug-queue-panel li').first().waitFor({ state: 'attached' })
  const degradedQueue = await degraded.page.evaluate(() => ({
    artists: [...document.querySelectorAll('.debug-queue-panel li small')].map(node => node.textContent),
    titles: [...document.querySelectorAll('.debug-queue-panel li strong')].map(node => node.textContent),
  }))
  assert(degradedQueue.artists.every(artist => artist === 'Artist b'), 'degraded queue rows keep unknown artists hidden and only show real ones')
  assert(degradedQueue.titles.every(title => title !== 'Playlist b'), 'degraded queue rows never borrow the playlist name')
  assert(degradedQueue.titles.every(title => Boolean(title) && title !== 'Playlist b'), 'degraded queue rows keep a real title')
  assert.deepEqual(degraded.errors, [])
  await degraded.page.screenshot({ path: join(screenshotDirectory, 'summaries-degraded.png') })
  report.push('failed summary pass: no loading hang, no fabricated artist, rows stay real')
  await degraded.page.close()

  // 4. Browsing another session list uses that scope's summaries, not 本地音频.
  const browsing = await open()
  await importScope(browsing.page, 'a')
  await importScope(browsing.page, 'b')
  await browsing.page.waitForFunction(() => window.viewModel.playlist.metadataStatus === 'ready')
  await browsing.page.evaluate(scope => window.viewModel.playlist.library.onSelect(scope),
    await browsing.page.evaluate(() => window.viewModel.playlist.library.items.find(item => item.name === 'Playlist a').scope))
  await browsing.page.waitForFunction(() => window.viewModel.playlist.playlistName === 'Playlist a')
  await browsing.page.locator('[data-playlist-track-id="a-1"]').waitFor()
  const browsed = await rowText(browsing.page)
  assert.deepEqual(browsed.cards.slice(0, 2).map(card => [card.title, card.artist]), [['Song a 0', 'Artist a'], ['Song a 1', 'Artist a']], 'a browsed non-active list shows its own real tags')
  assert(browsed.cards.every(card => card.artist !== '本地音频'), 'browsing never falls back to the fabricated 本地音频 text')
  assert(browsed.cards.every(card => card.artist !== 'Playlist a'), 'browsing never falls back to the playlist name')
  assert.deepEqual(browsing.errors, [])
  report.push('browsed session list: own scope summaries, no 本地音频 placeholder')
  await browsing.page.close()

  console.log(JSON.stringify({ browser: browser.version(), report, screenshots: screenshotDirectory }))
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(screenshotDirectory, 'summaries-failure-' + index + '.png') }).catch(() => {})
  }
  throw error
} finally {
  await browser.close()
}
