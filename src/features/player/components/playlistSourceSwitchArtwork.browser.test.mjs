// Run with the Vite dev server on :5173 and SPMUSIC_PLAYWRIGHT pointing to a
// Playwright package, for example (PowerShell):
//   $env:SPMUSIC_PLAYWRIGHT = "$env:TEMP\spmusic-pw\node_modules\playwright-core"
//   node src/features/player/components/playlistSourceSwitchArtwork.browser.test.mjs
// `localhost` is used because the dev server may listen on ::1 only;
// SPMUSIC_TEST_ORIGIN overrides it. SPMUSIC_TEST_SCENARIO can run one comma
// separated subset: cross-source, reverse-folder, same-source, all-songs.
// The real shell, player hook and panels run against a deterministic native
// transport; only native I/O is mocked. Covers for this fixture always exist and
// are read through the real SPXR pixel protocol, and native cover reads carry a
// fixed latency so a regressed clear-then-reload gap cannot be missed by frame
// timing. Every scenario asserts, per animation frame, that already-painted
// artwork (card `data-cover-state="ready"` and decoded hero images) survives the
// playback-source switch, and that nothing painted before the click disappears.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = (process.env.SPMUSIC_TEST_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
const COVER_LATENCY_MS = 120
const SAMPLE_MS = 900

const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = (name) => {
  const match = entry.match(new RegExp('"(/[^"\\n]*/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve Vite dependency ${name}`)
  return match[1]
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'), 'audio command service is patched onto the mock transport')
const realSurface = await (await fetch(origin + '/src/features/player/components/PlayerSurface.tsx')).text()
const surface = `
import React from '${dependency('react.js')}';
import {PlayerSurface as RealSurface} from '/__source_switch_real_surface.js';
export function PlayerSurface(props){window.viewModel=props.viewModel;return React.createElement(RealSurface,props)}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';

// Two folder sources plus one imported M3U8 list. Every track owns native cover
// art, so "ready" is truthful and a missing image is a real regression rather
// than a fixture limitation.
const folders = {
  a: { name: 'Alpha Folder', dir: '/audio/a', tracks: [['a-0','/audio/a/0.flac'],['a-1','/audio/a/1.flac'],['a-2','/audio/a/2.flac']] },
  b: { name: 'Beta Folder', dir: '/audio/b', tracks: [['b-0','/audio/b/0.flac'],['b-1','/audio/b/1.flac'],['b-2','/audio/b/2.flac']] },
};
const titles = { 'a-0':'Alpha Song 0','a-1':'Alpha Song 1','a-2':'Alpha Song 2','b-0':'Beta Song 0','b-1':'Beta Song 1','b-2':'Beta Song 2' };
const descriptor = ([id, sourcePath]) => ({ id, sourcePath, fileName: sourcePath.split('/').at(-1), available: true });
const folderPlaylist = (key) => { const folder = folders[key]; return { directoryPath: folder.dir, directoryName: folder.name, sourceKind: 'folder', sourcePath: folder.dir, sourceName: folder.name, selectedIndex: 0, tracks: folder.tracks.map(descriptor) } };
const importedPlaylist = () => ({ directoryPath: '', directoryName: 'Imported Mix', sourceKind: 'm3u8', sourcePath: '/lists/mix.m3u8', sourceName: 'Imported Mix', selectedIndex: 0, tracks: [...folders.a.tracks, ...folders.b.tracks].map(descriptor) });
const byPath = new Map(Object.values(folders).flatMap((folder) => folder.tracks).map((pair) => [pair[1], descriptor(pair)]));
const byId = new Map([...byPath.values()].map((row) => [row.id, row]));
const trackFor = (path) => { const row = byPath.get(path); if (!row) throw new Error('Unknown fixture path ' + path); return { ...row, durationMs: 180000, metadata: { title: titles[row.id], artist: 'Artist ' + row.id, album: 'Album ' + row.id, albumArtist: null, genre: null, year: null, trackNumber: null, discNumber: null, comment: null, lyrics: null, audioFormat: null, coverArt: null } } };

let state = { phase: 'idle', generation: null, currentTrackId: null, positionMs: 0, durationMs: null, volume: .5, error: null, transportTransition: null, transportSettledRequestId: null };
let generation = 0, currentTrack = null;
const playbackState = () => ({ ...state });

window.calls = [];
window.backendInvoke = async (command, args) => {
  const input = args?.input; window.calls.push({ command, input, at: performance.now() });
  if (command === 'library_select_folders') return ['/audio/a', '/audio/b'];
  if (command === 'library_scan_folder') return folderPlaylist(args.path.split('/').at(-1));
  if (command === 'audio_import_playlist') return importedPlaylist();
  if (command === 'library_get_playlists') return [];
  if (command === 'library_get_folders') return { folders: [] };
  if (command === 'library_add_folder') return { folders: [] };
  if (command === 'library_clear_folders') return null;
  if (command === 'library_warm_cover_thumbnails') return { attempted: input.paths.length, computed: 0, persisted: 0, warmed: 0, skipped: input.paths.length, failed: 0, cancelled: false };
  if (command === 'library_cancel_cover_warmup') return null;
  if (command === 'audio_get_state') return playbackState();
  if (command === 'audio_get_current_track') return currentTrack;
  if (command === 'audio_get_output_info') return null;
  if (command === 'audio_open_source') return { kind: 'playlist', playlist: folderPlaylist('a') };
  if (command === 'audio_load_file' || command === 'audio_load_and_play') {
    const result = trackFor(input.path); currentTrack = result;
    state = { ...state, phase: command === 'audio_load_and_play' ? 'playing' : 'ready', generation: ++generation, currentTrackId: result.id, durationMs: 180000, positionMs: 0 };
    if (command === 'audio_load_file') return result;
    const response = { requestId: input.requestId, generation, trackId: result.id, fileName: result.fileName, state: { ...state } };
    setTimeout(() => window.listeners?.audio_track_details_changed?.({ payload: { kind: 'ready', requestId: input.requestId, generation: response.generation, track: result } }), 0);
    return response;
  }
  if (command === 'audio_hydrate_track') return trackFor(input.path);
  if (command === 'audio_probe_playlist_cover') {
    const row = byPath.get(input.path);
    if (!row) throw { code: 'INVALID_PATH', message: 'unknown path', recoverable: false };
    return { id: row.id, sourcePath: row.sourcePath, coverArt: { mimeType: 'image/png', filePath: '/covers/' + row.id + '.png', dataUrl: null, byteLen: 64 } };
  }
  if (command === 'audio_begin_playlist_cover_window') return 1;
  if (command === 'audio_probe_playlist_durations') return input.paths.map((sourcePath) => ({ sourcePath, durationMs: 180000, error: null }));
  if (command === 'audio_probe_playlist_track_summaries') return input.paths.map((sourcePath) => { const item = trackFor(sourcePath); return { sourcePath, summary: { title: item.metadata.title, artist: item.metadata.artist, album: item.metadata.album, albumArtist: null, bitDepth: 24, sampleRateHz: 96000, bitrateKbps: null, codec: 'FLAC' }, error: null } });
  if (command === 'audio_load_playlist_cover_pixels') {
    const id = (input.filePath.split('/').at(-1) || '').replace('.png', '');
    if (!byId.has(id)) throw { code: 'NO_COVER_ART', message: 'fixture has no artwork', recoverable: false };
    const size = 8, stride = size * 4, pixelLen = stride * size;
    const bytes = new Uint8Array(40 + pixelLen); const view = new DataView(bytes.buffer);
    bytes.set([83, 80, 88, 82]); view.setUint16(4, 1, true); view.setUint16(6, 40, true);
    view.setUint32(8, size, true); view.setUint32(12, size, true); view.setUint32(16, stride, true); view.setUint32(20, 1, true);
    view.setUint32(24, pixelLen, true); view.setUint32(28, 0, true); view.setUint32(32, 64, true); view.setUint32(36, 64, true);
    const base = id.startsWith('a-') ? [30, 140, 255] : [255, 90, 40];
    for (let index = 0; index < size * size; index += 1) { bytes[40 + index * 4] = base[0]; bytes[41 + index * 4] = base[1]; bytes[42 + index * 4] = base[2]; bytes[43 + index * 4] = 255 }
    if (window.__coverLatency) await new Promise((resolve) => setTimeout(resolve, window.__coverLatency));
    return bytes;
  }
  if (command === 'audio_transition_playback' || command === 'audio_play' || command === 'audio_pause') { state = { ...state, phase: command === 'audio_pause' ? 'paused' : (input?.target ?? 'playing'), transportSettledRequestId: input?.requestId ?? null }; return playbackState() }
  if (command === 'audio_seek') { state = { ...state, positionMs: input.positionMs }; return playbackState() }
  if (command === 'audio_stop') { state = { ...state, phase: 'idle', generation: null, currentTrackId: null }; currentTrack = null; return playbackState() }
  throw new Error('Unexpected native command ' + command);
};

// Per-frame DOM truth: how many card covers are really painted and whether the
// hero image is decoded. Sampling runs on requestAnimationFrame, so a React
// commit that drops artwork is visible even if it only lasts one frame.
window.__frames = [];
window.__marks = [];
window.__running = false;
const gridState = (selector) => {
  const grid = document.querySelector(selector);
  if (!grid) return { present: false, loaded: 0, cards: 0, states: {} };
  const cards = [...grid.querySelectorAll('.playlist-card')];
  const states = {};
  for (const card of cards) { const value = card.dataset.coverState || '?'; states[value] = (states[value] || 0) + 1 }
  return { present: true, cards: cards.length, loaded: cards.filter((card) => card.dataset.coverState === 'ready').length, states };
};
const heroState = () => {
  const hero = document.querySelector('.playlist-hero');
  if (!hero) return { present: false, loaded: 0 };
  const images = [...hero.querySelectorAll('img.playlist-hero-image')];
  return { present: true, loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length };
};
const snapshot = () => ({ t: performance.now(), detail: gridState('.playlist-panel:not([inert]) .playlist-grid:not(.all-songs-list)'), songs: gridState('.all-songs-list'), hero: heroState() });
window.__startSampling = () => { window.__frames = []; window.__marks = []; window.__running = true; const tick = () => { if (!window.__running) return; window.__frames.push(snapshot()); requestAnimationFrame(tick) }; requestAnimationFrame(tick) };
window.__stopSampling = () => { window.__running = false; return window.__frames };
document.addEventListener('click', (event) => { const card = event.target.closest?.('.playlist-card'); if (card) window.__marks.push({ t: performance.now(), id: card.dataset.playlistTrackId }) }, true);

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider, null, React.createElement(PlayerShell)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^"]+"/, 'src="/__source_switch_fixture.js"')

const browser = await chromium.launch({ headless: true, channel: 'msedge' })

async function open() {
  const context = await browser.newContext({ viewport: { width: 1120, height: 720 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  const isEnvNoise = (text) => /websocket|vite\] failed to connect|ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS/i.test(text)
  page.on('pageerror', (error) => { if (!isEnvNoise(error.message)) errors.push(error.message) })
  page.on('console', (message) => { if (message.type() === 'error' && !isEnvNoise(message.text())) errors.push('console: ' + message.text()) })
  await page.route('**/src/features/player/services/audioCommands.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', (route) => route.fulfill({ contentType: 'text/javascript', body: surface }))
  await page.route('**/__source_switch_real_surface.js', (route) => route.fulfill({ contentType: 'text/javascript', body: realSurface }))
  await page.route('**/__source_switch_fixture.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__source_switch_test?*', (route) => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__source_switch_test?width=1120')
  await page.waitForFunction(() => Boolean(window.viewModel))
  return { page, context, errors }
}

const waitIdle = (page) => page.waitForFunction(() => {
  const playback = window.viewModel?.playback
  return playback && !playback.isAudioBusy && !playback.isSelectionPending && !window.viewModel.playlist.library.isImportPending
})

async function importFolders(page) {
  await page.evaluate(() => window.viewModel.playlist.library.onSelectFolders())
  await waitIdle(page)
  await page.waitForFunction(() => window.viewModel.playlist.library.items.length >= 2)
}

async function importPlaylist(page) {
  await page.evaluate(() => window.viewModel.playlist.library.onImportPlaylist())
  await page.waitForFunction(() => window.viewModel.playlist.library.items.some((item) => item.sourceKind === 'm3u8'))
  await waitIdle(page)
}

async function openPlaylist(page, nameFragment) {
  const scope = await page.evaluate((fragment) => window.viewModel.playlist.library.items.find((item) => item.name.includes(fragment))?.scope, nameFragment)
  assert(scope, `playlist "${nameFragment}" exists`)
  await page.evaluate((target) => window.viewModel.playlist.library.onSelect(target), scope)
  await page.locator('.playlist-panel:not([inert])').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.playlist-panel:not([inert]) .playlist-card').length > 0)
}

async function openAllSongs(page) {
  await page.evaluate(() => window.viewModel.playlist.library.onSelectCategory('songs'))
  await page.locator('.all-songs-list').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length > 0)
}

const waitDetailPainted = (page) => page.waitForFunction(() => {
  const cards = [...document.querySelectorAll('.playlist-panel:not([inert]) .playlist-card')]
  return cards.length > 0 && cards.every((card) => card.dataset.coverState === 'ready')
    && [...document.querySelectorAll('.playlist-panel:not([inert]) .playlist-hero-image')].some((image) => image.complete && image.naturalWidth > 0)
})
// Some rows can sit outside the artwork window at the default 1120x720 window,
// so require the painted rows instead of every mounted row; measure() then uses
// the real painted count as its baseline.
const waitSongsPainted = (page) => page.waitForFunction(() => {
  const cards = [...document.querySelectorAll('.all-songs-list .playlist-card')]
  const ready = cards.filter((card) => card.dataset.coverState === 'ready').length
  return cards.length > 0 && ready >= Math.min(4, cards.length) && cards.every((card) => card.dataset.coverState !== 'loading')
})

// Baseline frames come from the same animation loop right before the click, so
// a regression cannot hide behind a frame that was never sampled.
async function measure(page, { targetSelector, grid, hero = false }) {
  await page.waitForTimeout(700)
  await page.evaluate((latency) => { window.__coverLatency = latency; window.__startSampling() }, COVER_LATENCY_MS)
  await page.waitForTimeout(140)
  await page.locator(targetSelector).click()
  await page.waitForTimeout(SAMPLE_MS)
  const frames = await page.evaluate(() => window.__stopSampling())
  const marks = await page.evaluate(() => window.__marks)
  assert(marks.length >= 1, 'click was recorded by the sampler')
  const click = marks.at(-1)
  const relative = frames.map((frame) => ({ ...frame, ms: frame.t - click.t }))
  const before = relative.filter((frame) => frame.ms < 0).slice(-6)
  const after = relative.filter((frame) => frame.ms >= 0)
  assert(before.length >= 2, 'sampler captured frames before the click')
  const baseline = before.at(-1)
  const targetBefore = baseline[grid]
  assert(targetBefore.present && targetBefore.loaded > 0, `${grid} list is painted before the click`)
  const lost = after.filter((frame) => frame[grid].present && frame[grid].loaded < targetBefore.loaded)
  const heroLost = hero ? after.filter((frame) => frame.hero.present && frame.hero.loaded < 1) : []
  return {
    baselineLoaded: targetBefore.loaded,
    baselineCards: targetBefore.cards,
    framesAfter: after.length,
    blankFrames: lost.length,
    firstBlankMs: lost[0]?.ms ?? null,
    lastBlankMs: lost.at(-1)?.ms ?? null,
    heroBlankFrames: heroLost.length,
    heroFirstBlankMs: heroLost[0]?.ms ?? null,
    minLoaded: Math.min(...after.map((frame) => frame[grid].loaded)),
    statesWhileBlank: lost.slice(0, 3).map((frame) => frame[grid].states),
  }
}

function assertPainted(result, label) {
  const detail = `${label}: baseline ready=${result.baselineLoaded}/${result.baselineCards}, ` +
    `blank frames=${result.blankFrames}/${result.framesAfter}, min ready=${result.minLoaded}` +
    (result.blankFrames ? `, first blank=${Math.round(result.firstBlankMs)}ms last blank=${Math.round(result.lastBlankMs)}ms, states=${JSON.stringify(result.statesWhileBlank)}` : '')
  assert.equal(result.blankFrames, 0, `list artwork must not go blank when switching playback source (${detail})`)
  assert.equal(result.minLoaded, result.baselineLoaded, `every painted cover stays painted (${detail})`)
}

const only = (process.env.SPMUSIC_TEST_SCENARIO || '').split(',').map((value) => value.trim()).filter(Boolean)
const selected = (name) => only.length === 0 || only.includes(name)

try {
  if (selected('cross-source')) {
    // Current track from 所有歌曲 (folder A) -> open the non-active playlist B
    // detail page -> click a B song, so the browsed playlist becomes active.
    const { page, context, errors } = await open()
    try {
      await importFolders(page)
      await openAllSongs(page)
      await page.locator('.all-songs-list .playlist-card[data-playlist-track-id="a-0"]').click()
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0')
      await waitIdle(page)
      await openPlaylist(page, 'Beta Folder')
      await waitDetailPainted(page)
      const result = await measure(page, { targetSelector: '.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="b-1"]', grid: 'detail', hero: true })
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'b-1')
      await waitIdle(page)
      assert.equal(await page.evaluate(() => window.viewModel.playlist.library.activeScope), 'folder\u0000/audio/b', 'playback source switched to the clicked playlist')
      assertPainted(result, '所有歌曲 -> 播放列表详情')
      assert.equal(result.heroBlankFrames, 0, `playlist hero must not lose its decoded image (${result.heroBlankFrames} blank frames, first at ${result.heroFirstBlankMs}ms)`)
      assert.deepEqual(errors, [], 'no browser errors while switching from 所有歌曲 to a playlist detail')
      console.log('cross-source 所有歌曲 -> 播放列表详情: artwork stayed painted', JSON.stringify(result))
    } finally { await context.close() }
  }
  if (selected('reverse-folder')) {
    // Reverse folder song page: current track from an imported playlist -> open
    // a folder detail page (non-active) -> click its song.
    const { page, context, errors } = await open()
    try {
      await importFolders(page)
      await importPlaylist(page)
      await openPlaylist(page, 'Imported Mix')
      await page.locator('.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="a-0"]').click()
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0')
      await waitIdle(page)
      await openPlaylist(page, 'Alpha Folder')
      await waitDetailPainted(page)
      const result = await measure(page, { targetSelector: '.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="a-2"]', grid: 'detail', hero: true })
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-2')
      await waitIdle(page)
      assert.equal(await page.evaluate(() => window.viewModel.playlist.library.activeScope), 'folder\u0000/audio/a', 'playback source switched to the clicked folder playlist')
      assertPainted(result, '播放列表 -> 文件夹歌曲页')
      assert.equal(result.heroBlankFrames, 0, `folder detail hero must not lose its decoded image (${result.heroBlankFrames} blank frames)`)
      assert.deepEqual(errors, [], 'no browser errors while switching from a playlist to a folder detail')
      console.log('reverse 播放列表 -> 文件夹歌曲页: artwork stayed painted', JSON.stringify(result))
    } finally { await context.close() }
  }
  if (selected('same-source')) {
    // Control: a same-source click must also keep the list painted. A fix that
    // only reacts to cross-source clicks, or that disables artwork, fails here.
    const { page, context, errors } = await open()
    try {
      await importFolders(page)
      await openPlaylist(page, 'Alpha Folder')
      await page.locator('.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="a-0"]').click()
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0')
      await waitIdle(page)
      await waitDetailPainted(page)
      const result = await measure(page, { targetSelector: '.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="a-2"]', grid: 'detail', hero: true })
      await waitIdle(page)
      assertPainted(result, '同来源点歌对照')
      assert.equal(result.heroBlankFrames, 0, 'same-source click keeps the hero image')
      assert.deepEqual(errors, [], 'no browser errors for same-source click')
      console.log('same-source control: artwork stayed painted', JSON.stringify(result))
    } finally { await context.close() }
  }
  if (selected('all-songs')) {
    // Aggregated 所有歌曲 page: current track from a playlist -> click a song of
    // another folder. That page owns an independent artwork window, so the same
    // source switch must also leave its covers painted.
    const { page, context, errors } = await open()
    try {
      await importFolders(page)
      await openPlaylist(page, 'Alpha Folder')
      await page.locator('.playlist-panel:not([inert]) .playlist-card[data-playlist-track-id="a-0"]').click()
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'a-0')
      await waitIdle(page)
      await openAllSongs(page)
      await waitSongsPainted(page)
      const result = await measure(page, { targetSelector: '.all-songs-list .playlist-card[data-playlist-track-id="b-2"]', grid: 'songs' })
      await page.waitForFunction(() => window.viewModel.playback.track?.id === 'b-2')
      await waitIdle(page)
      assertPainted(result, '播放列表 -> 所有歌曲聚合页')
      assert.deepEqual(errors, [], 'no browser errors while switching from a playlist to 所有歌曲')
      console.log('reverse 播放列表 -> 所有歌曲聚合页: artwork stayed painted', JSON.stringify(result))
    } finally { await context.close() }
  }
} finally {
  await browser.close()
}
