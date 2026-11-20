// Page-side fixture for the search-add → playlist latency harness.
//
// ---------------------------------------------------------------------------
// Which layer is fake (the Lead asked for this to be explicit)
// ---------------------------------------------------------------------------
// REAL:   index.html, src/main.tsx, App, AppearanceProvider, PlayerShell,
//         PlayerSurface, SearchPanel, PlaylistLibraryPanel, PlaylistPanel,
//         PlaylistCard, useAudioPlayer, useLibraryArtwork, useAllSongsWindow,
//         playlistCoverScheduler, playlistCoverPixels (the SPXR decoder and the
//         BMP/object-URL pipeline), plus the genuine `audioCommands.ts` parsers
//         and their response validators.
//
// FAKE:   exactly two statements inside `audioCommands.ts` are swapped for
//         `window.backendInvoke` / a local `listen`, and the native transport
//         behind them. No other module is rewritten.
//
// That is the same boundary the repo's own browser tests use
// (playlistCoverLoadingLatency.browser.test.mjs, playlistSelectionAdd.browser.test.mjs,
// moreActionsIntegration.browser.test.mjs), so "which layer is fake" is the
// documented, already-reviewed one: the Rust process and the real filesystem.
// Everything above the IPC boundary is the shipped program.
//
// The rewrite is anchored on the import SHAPE that Vite emits, not on exact
// source text, so it survives unrelated edits in that file:
//     import { convertFileSrc, invoke } from "/node_modules/.vite/deps/@tauri-apps_api_core.js?v=..."
//     import { listen } from "/node_modules/.vite/deps/@tauri-apps_api_event.js?v=..."
// If either import is absent, the harness aborts loudly instead of silently
// measuring an un-mocked native layer.
//
// ---------------------------------------------------------------------------
// Mocked latency model (a MODEL, not a claim about real disk)
// ---------------------------------------------------------------------------
// Every mocked native command awaits a deterministic delay, then returns
// fixture data. The app's own cover scheduler caps native cover concurrency at
// 4 (src/features/player/services/playlistCoverScheduler.ts MAX_CONCURRENT), so
// a fixed per-call delay yields realistic queueing: N visible covers cost about
// ceil(N / 4) * perCall. The harness reports per-command counts and the summed
// modelled cost so every number is auditable, and the model is written into
// results.json under engine.mockedLatencyModel.

/** The mocked per-command latency model. Fields: ms, or {batch:{field,baseMs,perItemMs}}. */
export const MODEL = {
  unknownCommandMs: 0,
  commands: {
    // Cover pixels are the expensive native reads; this is the dial that makes
    // "covers take time to appear" observable at all.
    audio_load_track_thumbnail: { ms: 18 },
    audio_load_playlist_cover_pixels: { ms: 22 },
    audio_load_folder_thumbnail: { ms: 22 },
    audio_load_cover_pixels: { ms: 22 },
    // Per-track metadata hydration.
    audio_hydrate_track: { ms: 6 },
    audio_probe_playlist_cover: { ms: 4 },
    // Batched metadata probes: cost grows with the batch, like real tag reads.
    audio_probe_playlist_track_summaries: { batch: { field: 'paths', baseMs: 2, perItemMs: 0.35 } },
    audio_probe_playlist_durations: { batch: { field: 'paths', baseMs: 2, perItemMs: 0.35 } },
    // Library/backlog work.
    library_scan_folder: { ms: 12 },
    library_get_playlists: { ms: 3 },
    library_get_folders: { ms: 3 },
    library_add_playlist_tracks: { ms: 10 },
    library_warm_cover_thumbnails: { batch: { field: 'paths', baseMs: 2, perItemMs: 0.2 } },
    library_cancel_cover_warmup: { ms: 0 },
    library_delete_tracks: { ms: 8 },
    library_reorder_playlist_tracks: { ms: 8 },
    library_replace_folders: { ms: 4 },
    library_add_folder: { ms: 4 },
    library_clear_folders: { ms: 4 },
    library_select_folders: { ms: 0 },
    library_list_folder_directories: { ms: 4 },
    audio_import_playlist: { ms: 4 },
    audio_get_state: { ms: 0 },
    audio_get_current_track: { ms: 0 },
    audio_get_output_info: { ms: 0 },
    audio_open_source: { ms: 6 },
    audio_open_file: { ms: 6 },
    audio_begin_playlist_cover_window: { ms: 1 },
    audio_load_file: { ms: 8 },
    audio_load_and_play: { ms: 10 },
    audio_play: { ms: 2 },
    audio_pause: { ms: 2 },
    audio_stop: { ms: 2 },
    audio_seek: { ms: 2 },
    audio_set_volume: { ms: 1 },
    audio_transition_playback: { ms: 2 },
    audio_embed_lyrics: { ms: 6 },
  },
}

/**
 * Build the `audioCommands.ts` replacement served to the page.
 *
 * `served` is the module text Vite returned for the real file. We only replace
 * the two `@tauri-apps/api` import statements; every other byte is the shipped
 * module, so all real parsing and validation still runs.
 */
export function patchedAudioCommands(served) {
  const coreImport = /import\s*\{\s*convertFileSrc\s*,\s*invoke\s*\}\s*from\s*["'][^"']*@tauri-apps_api_core[^"']*["'];?/
  const eventImport = /import\s*\{\s*listen\s*\}\s*from\s*["'][^"']*@tauri-apps_api_event[^"']*["'];?/
  if (!coreImport.test(served)) throw new Error('audioCommands.ts no longer imports convertFileSrc/invoke from @tauri-apps/api/core; update patchedAudioCommands')
  if (!eventImport.test(served)) throw new Error('audioCommands.ts no longer imports listen from @tauri-apps/api/event; update patchedAudioCommands')
  return served
    .replace(coreImport, 'const invoke = (...args) => window.backendInvoke(...args); const convertFileSrc = path => path;')
    .replace(eventImport, 'const listen = async (name, callback) => { (window.__EVENT_LISTENERS__ ??= {})[name] = callback; return () => { if (window.__EVENT_LISTENERS__[name] === callback) delete window.__EVENT_LISTENERS__[name]; }; };')
}

/**
 * The fixture module: installs the deterministic native transport and mounts
 * the real shell. `config` carries fixture shape, the latency model, and the
 * Vite-resolved React dep URLs.
 */
export function buildFixtureModule(config) {
  const json = JSON.stringify(config)
  return `import React from '${config.reactUrl}';
import ReactDOM from '${config.reactDomUrl}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlayerShell } from '/src/features/player/components/PlayerShell.tsx';
import '/src/index.css';
const CONFIG = ${json};
const MODEL = CONFIG.model;

// ---------------------------------------------------------------------------
// Deterministic latency model, in milliseconds.
// ---------------------------------------------------------------------------
function batchSize(args, field) {
  const input = args && args.input;
  const value = input ? input[field] : undefined;
  return Array.isArray(value) ? value.length : 0;
}
function modeledDelayMs(command, args) {
  const entry = MODEL.commands[command];
  if (!entry) return MODEL.unknownCommandMs;
  if (entry.batch) return entry.batch.baseMs + entry.batch.perItemMs * batchSize(args, entry.batch.field);
  return entry.ms;
}

// ---------------------------------------------------------------------------
// Fixture data. S1 and S2 MUST see identical descriptors so cover-cache hit
// rates are comparable; the harness asserts the sourcePath sets hash equal.
// ---------------------------------------------------------------------------
const ROOT = CONFIG.fixture.libraryRoot;
const TOTAL = CONFIG.fixture.folderTrackCount;
const descriptors = Array.from({ length: TOTAL }, (_, i) => ({
  id: 't' + i,
  sourcePath: ROOT + '/' + i + '.flac',
  fileName: i + '.flac',
  available: true,
}));
const bySourcePath = new Map(descriptors.map(d => [d.sourcePath, d]));

function titleFor(descriptor) {
  const n = Number(descriptor.id.slice(1));
  // Two blocks make the search filter meaningful and stable.
  return (n < Math.floor(TOTAL / 2) ? 'Alpha ' : 'Zeta ') + n;
}

// Distinct cover per track so a cached/wrong cover is visible, not masked.
function coverDataUrl(index) {
  const hue = (index * 37) % 360;
  return 'data:image/svg+xml,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
    "<rect width='160' height='160' fill='hsl(" + hue + ",55%,45%)'/></svg>");
}

function trackFor(sourcePath) {
  const descriptor = bySourcePath.get(sourcePath);
  if (!descriptor) return null;
  const index = Number(descriptor.id.slice(1));
  const coverArt = { mimeType: 'image/svg+xml', filePath: coverDataUrl(index), dataUrl: coverDataUrl(index), byteLen: 64 };
  return {
    ...descriptor,
    durationMs: 180000,
    coverThumbnail: coverArt,
    metadata: {
      title: titleFor(descriptor),
      trackNumber: index + 1,
      album: 'Album ' + (index % 3),
      albumArtist: 'Album Artist',
      artist: 'Artist ' + (index % 5),
      composer: 'Composer',
      genre: 'Genre',
      year: 2023,
      discNumber: 1,
      comment: null,
      lyrics: null,
      audioFormat: 'FLAC',
      coverArt,
    },
  };
}

// SPXR is the real cover-pixel wire format, so the unmodified decoder in
// audioCommands.ts really parses these bytes and the app's real BMP/object-URL
// pipeline produces the <img> src.
const SPXR_HEADER = 40;
function spxr(edge) {
  const bytes = new Uint8Array(SPXR_HEADER + edge * edge * 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x53, 0x50, 0x58, 0x52]);
  view.setUint16(4, 1, true);
  view.setUint16(6, SPXR_HEADER, true);
  view.setUint32(8, edge, true);
  view.setUint32(12, edge, true);
  view.setUint32(16, edge * 4, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, edge * edge * 4, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 160, true);
  view.setUint32(36, 160, true);
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const o = SPXR_HEADER + (y * edge + x) * 4;
      bytes[o] = 40 + ((x * 3) % 200);
      bytes[o + 1] = 60 + ((y * 5) % 180);
      bytes[o + 2] = 200;
      bytes[o + 3] = 255;
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Mutable fixture state.
// ---------------------------------------------------------------------------
const state = {
  playlists: [{
    directoryPath: CONFIG.fixture.playlist.directoryPath,
    directoryName: CONFIG.fixture.playlist.directoryName,
    sourceKind: 'm3u8',
    sourcePath: CONFIG.fixture.playlist.sourcePath,
    sourceName: CONFIG.fixture.playlist.name,
    selectedIndex: 0,
    tracks: CONFIG.fixture.playlist.trackPaths.map(path => ({ ...bySourcePath.get(path) })),
  }],
  folderSettings: { revision: 0, roots: [{ path: ROOT, selected: true, directoryRules: [] }] },
};
const playback = {
  state: { phase: 'idle', generation: null, currentTrackId: null, positionMs: 0, durationMs: null,
    volume: 0.5, error: null, transportTransition: null, transportSettledRequestId: null },
  generation: 0,
  currentTrack: null,
};

// ---------------------------------------------------------------------------
// Command accounting.
// ---------------------------------------------------------------------------
const meters = { calls: [], startedAt: performance.now() };
function dedupKey(command, args) {
  const input = args && args.input;
  if (!input) return command;
  if (typeof input.sourcePath === 'string') return command + '|' + input.sourcePath;
  if (typeof input.filePath === 'string') return command + '|' + input.filePath;
  if (typeof input.path === 'string') return command + '|' + input.path;
  if (typeof input.clientId === 'string') return command + '|' + input.clientId;
  if (Array.isArray(input.paths)) return command + '|batch:' + input.paths.length;
  return command;
}

function emit(name, payload) {
  const callback = window.__EVENT_LISTENERS__ && window.__EVENT_LISTENERS__[name];
  if (typeof callback === 'function') {
    try { callback({ event: name, id: 0, payload }); } catch (error) { console.error(error); }
  }
}

// Real add semantics, mirroring the Rust addition command contract.
const addLog = [];
function addPlaylistTracks(input, at) {
  const target = state.playlists.find(item => item.sourcePath === input.sourcePath);
  if (!target) throw { code: 'INVALID_PATH', message: 'fixture has no playlist ' + input.sourcePath };
  const existing = new Set(target.tracks.map(item => item.sourcePath));
  const accepted = [...new Set(input.trackPaths)];
  const alreadyPresentPaths = accepted.filter(path => existing.has(path));
  const addedPaths = accepted.filter(path => !existing.has(path));
  const additions = addedPaths.map(path => ({ ...bySourcePath.get(path) }));
  const tracks = input.position === 'start' ? [...additions, ...target.tracks] : [...target.tracks, ...additions];
  state.playlists = state.playlists.map(item => item === target ? { ...target, tracks } : item);
  addLog.push({ at, input: JSON.parse(JSON.stringify(input)), addedPaths: [...addedPaths] });
  return { playlist: { ...target, tracks }, addedPaths, alreadyPresentPaths, failures: [] };
}

// ---------------------------------------------------------------------------
// The native transport. This function IS the mocked layer.
// ---------------------------------------------------------------------------
window.backendInvoke = async (command, args) => {
  const delayMs = modeledDelayMs(command, args);
  const record = { command, key: dedupKey(command, args), t: performance.now() - meters.startedAt, delayMs };
  meters.calls.push(record);
  if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  const input = args && args.input;
  const result = handle(command, args, input, record.t);
  return result;
};

function handle(command, args, input, at) {
  // ---- library ----
  if (command === 'library_get_folders') {
    // The folder-settings wire shape changed between revisions: 2026-10-25 reads
    // result.folders (a string array) and later versions read result.roots.
    // Publish both so one fixture can drive every version under test. Each
    // reader validates only its own field, so the extra key is inert.
    // NOTE: this block lives inside a template string - never use backticks here.
    const settings = JSON.parse(JSON.stringify(state.folderSettings));
    settings.folders = settings.roots.filter(root => root.selected).map(root => root.path);
    return settings;
  }
  if (command === 'library_get_playlists') return JSON.parse(JSON.stringify(state.playlists));
  if (command === 'library_add_folder') return JSON.parse(JSON.stringify(state.folderSettings));
  if (command === 'library_clear_folders') { state.folderSettings = { revision: state.folderSettings.revision + 1, roots: [] }; return null; }
  if (command === 'library_replace_folders') {
    state.folderSettings = { revision: state.folderSettings.revision + 1, roots: JSON.parse(JSON.stringify(input.roots)) };
    return JSON.parse(JSON.stringify(state.folderSettings));
  }
  if (command === 'library_scan_folder') {
    const path = args.path;
    const name = path.split('/').filter(Boolean).pop() || path;
    return { directoryPath: path, directoryName: name, sourceKind: 'folder', sourcePath: path, sourceName: name,
      selectedIndex: 0, directoryPaths: [path], tracks: descriptors.map(item => ({ ...item })) };
  }
  if (command === 'library_warm_cover_thumbnails') {
    const n = input && Array.isArray(input.paths) ? input.paths.length : 0;
    return { attempted: n, warmed: n, computed: 0, persisted: 0, skipped: 0, failed: 0, cancelled: false };
  }
  if (command === 'library_cancel_cover_warmup') return null;
  if (command === 'library_select_folders') return [ROOT];
  if (command === 'library_add_playlist_tracks') return addPlaylistTracks(input, at);
  if (command === 'library_delete_tracks') {
    const target = state.playlists[0];
    const remove = new Set(input.trackPaths);
    const removedPaths = target.tracks.filter(item => remove.has(item.sourcePath)).map(item => item.sourcePath);
    const next = { ...target, tracks: target.tracks.filter(item => !remove.has(item.sourcePath)), selectedIndex: 0 };
    state.playlists = [next];
    return { removedPaths, failures: [], playlists: [JSON.parse(JSON.stringify(next))], state: null, storageError: null };
  }
  if (command === 'library_reorder_playlist_tracks') {
    const order = new Map(input.orderedTrackPaths.map((path, index) => [path, index]));
    const target = state.playlists[0];
    const next = { ...target, tracks: [...target.tracks].sort((a, b) => (order.get(a.sourcePath) ?? 0) - (order.get(b.sourcePath) ?? 0)) };
    state.playlists = [next];
    return JSON.parse(JSON.stringify(next));
  }
  if (command === 'library_list_folder_directories') return { rootPath: input.rootPath, directoryPath: input.directoryPath, children: [] };
  if (command === 'audio_import_playlist') return JSON.parse(JSON.stringify(state.playlists[0]));

  // ---- audio / metadata ----
  if (command === 'audio_get_state') return { ...playback.state };
  if (command === 'audio_get_current_track') return playback.currentTrack;
  if (command === 'audio_get_output_info') return null;
  if (command === 'audio_hydrate_track') return trackFor(input.path) || null;
  if (command === 'audio_embed_lyrics') return trackFor(input.path) || null;
  if (command === 'audio_probe_playlist_cover') {
    const track = trackFor(input.path);
    if (!track) throw { code: 'UNKNOWN_TRACK', message: 'fixture has no ' + input.path, recoverable: true };
    return { id: track.id, sourcePath: track.sourcePath, coverArt: track.metadata.coverArt };
  }
  if (command === 'audio_begin_playlist_cover_window') return 1;
  if (command === 'audio_probe_playlist_track_summaries') {
    return input.paths.map(sourcePath => {
      const track = trackFor(sourcePath);
      if (!track) return { sourcePath, summary: null, error: { code: 'UNKNOWN_TRACK', message: 'fixture' } };
      return { sourcePath, summary: {
        title: track.metadata.title, artist: track.metadata.artist, album: track.metadata.album,
        albumArtist: track.metadata.albumArtist, composer: track.metadata.composer, genre: track.metadata.genre,
        year: track.metadata.year, bitDepth: 24, sampleRateHz: 96000, bitrateKbps: null, codec: 'FLAC' }, error: null };
    });
  }
  if (command === 'audio_probe_playlist_durations') {
    return input.paths.map(sourcePath => ({ sourcePath, durationMs: 180000, error: null }));
  }
  if (command === 'audio_load_track_thumbnail' || command === 'audio_load_playlist_cover_pixels'
      || command === 'audio_load_folder_thumbnail' || command === 'audio_load_cover_pixels') {
    const requested = input && input.maxEdge ? input.maxEdge : 128;
    const edge = Math.max(32, Math.min(96, Math.round(requested)));
    return spxr(edge);
  }
  if (command === 'audio_load_file' || command === 'audio_load_and_play') {
    const track = trackFor(input.path);
    if (!track) throw { code: 'UNREADABLE_FILE', message: 'fixture has no ' + input.path, recoverable: true };
    playback.currentTrack = track;
    playback.state = { ...playback.state, phase: command === 'audio_load_and_play' ? 'playing' : 'ready',
      generation: ++playback.generation, currentTrackId: track.id, durationMs: 180000, positionMs: 0 };
    if (command === 'audio_load_file') return track;
    const response = { requestId: input.requestId, generation: playback.generation, trackId: track.id,
      fileName: track.fileName, state: { ...playback.state } };
    setTimeout(() => emit('audio_track_details_changed', { kind: 'ready', requestId: input.requestId,
      generation: response.generation, track }), 0);
    return response;
  }
  if (command === 'audio_transition_playback' || command === 'audio_play' || command === 'audio_pause') {
    playback.state = { ...playback.state, phase: command === 'audio_pause' ? 'paused' : (input && input.target) || 'playing',
      transportSettledRequestId: (input && input.requestId) || null };
    return { ...playback.state };
  }
  if (command === 'audio_stop') { playback.state = { ...playback.state, phase: 'stopped' }; return { ...playback.state }; }
  if (command === 'audio_seek') { playback.state = { ...playback.state, positionMs: input.positionMs }; return { ...playback.state }; }
  if (command === 'audio_set_volume') { playback.state = { ...playback.state, volume: input.volume }; return { ...playback.state }; }
  if (command === 'audio_open_source' || command === 'audio_open_file') {
    return { kind: 'playlist', playlist: JSON.parse(JSON.stringify(state.playlists[0])) };
  }

  // Unknown command: record and return null so a revision that adds a command
  // degrades to "no effect" instead of failing the run.
  record_unhandled(command);
  return null;
}
function record_unhandled(command) {
  const last = meters.calls[meters.calls.length - 1];
  if (last && last.command === command) last.unhandled = true;
}

// ---------------------------------------------------------------------------
// Meters for the harness.
// ---------------------------------------------------------------------------
window.__PERF__ = {
  config: CONFIG,
  calls: () => meters.calls.map(call => ({ ...call })),
  playlists: () => JSON.parse(JSON.stringify(state.playlists)),
  addLog: () => JSON.parse(JSON.stringify(addLog)),
  reset: () => { meters.calls.length = 0; meters.startedAt = performance.now(); },
  now: () => performance.now() - meters.startedAt,
  trackSources: () => descriptors.map(d => d.sourcePath),
};

// ---------------------------------------------------------------------------
// Open-playlist measurement.
//
// The visible-cover definition is ported from
// tools/thumbnail-benchmark/visible-measurement.mjs (the routine behind the
// 2026-10-24 acceptance numbers): a cover counts when its <img> is decoded AND
// fully opaque. We aggregate per initially-visible row and report T90 — the
// moment 90% of those rows are visible — plus p50/p90 of per-row arrival.
// ---------------------------------------------------------------------------
const OPEN = { state: 'idle', result: null };
// Set by __PERF_OPEN_START__ so the module-level helpers can honour the
// per-scenario card/image selectors without threading them everywhere.
let openCardSelector = '[data-playlist-track-id]';
let openImageSelector = 'img.playlist-card-cover-image, img.playlist-card-cover-image-eager, .playlist-card-cover img';
function cardKeyFor(card) {
  return card.dataset.playlistTrackId || card.dataset.collectionKey || card.dataset.albumKey
    || card.dataset.artistKey || card.dataset.searchKey || card.getAttribute('aria-label') || '';
}
function imageFor(card) {
  return card.querySelector(openImageSelector) || card.querySelector('img');
}
function visibleImage(image) {
  return Boolean(image && image.complete && image.naturalWidth > 0
    && Number(getComputedStyle(image).opacity) >= 0.99);
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

window.__PERF_OPEN_START__ = (options) => {
  if (OPEN.state === 'running') return;
  OPEN.state = 'running';
  OPEN.result = null;
  const dwellMs = (options && options.dwellMs) || 6000;
  const budgetMs = (options && options.budgetMs) || 25000;
  // Library views (all songs / albums / artists / folders) mount a different
  // container and grid than the playlist detail page. Without these the sampler
  // looks at a dormant playlist panel and reports no rows.
  const panelSelector = (options && options.panelSelector) || '.playlist-panel';
  const gridSelector = (options && options.gridSelector) || '.playlist-grid';
  // Collection views (albums, artists, folders) render [data-collection-key]
  // cards with folder-cover images rather than song rows.
  const cardSelector = (options && options.cardSelector) || '[data-playlist-track-id]';
  const imageSelector = (options && options.imageSelector)
    || 'img.playlist-card-cover-image, img.playlist-card-cover-image-eager, .playlist-card-cover img';
  openCardSelector = cardSelector;
  openImageSelector = imageSelector;
  const t0 = performance.now() - meters.startedAt;
  const rows = new Map();
  let initialIds = null;
  let firstRowAt = null;
  let done = false;

  function visibleCards() {
    // Multiple panels and grids can be mounted at once: the search page renders
    // a .search-songs grid, and library categories keep their own grids. Taking
    // the first global match samples a dormant grid and reports 0 visible rows
    // even though the target view is fully painted. Anchor on the panel that is
    // actually laid out.
    const panels = [].slice.call(document.querySelectorAll(panelSelector));
    const panel = panels.find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!panel) return null;
    // Collection views do not always wrap their cards in a .playlist-grid; fall
    // back to the laid-out panel itself so the card selector is still applied.
    const grid = panel.matches(gridSelector) ? panel
      : panel.querySelector(gridSelector) ?? panel;
    const bounds = panel.getBoundingClientRect();
    const dock = [].slice.call(document.querySelectorAll('.playlist-playback-dock')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom;
    })[0];
    const bottom = Math.min(bounds.bottom, dock ? dock.getBoundingClientRect().top : bounds.bottom);
    return [].slice.call(grid.querySelectorAll(cardSelector)).filter(card => {
      const r = card.getBoundingClientRect();
      return r.bottom > bounds.top && r.top < bottom && r.right > bounds.left && r.left < bounds.right;
    });
  }

  function finish(reason) {
    if (done) return;
    done = true;
    const values = [];
    rows.forEach(row => values.push(row));
    const arrivals = values.filter(row => row.firstVisibleMs !== null).map(row => row.firstVisibleMs).sort((a, b) => a - b);
    const total = values.length;
    const target = Math.ceil(total * 0.9);
    OPEN.result = {
      reason,
      rowsInitiallyVisible: total,
      resolvedRows: arrivals.length,
      // Time until the target view rendered its first row at all. For library
      // views that gate on metadata readiness, this is the "list is loading"
      // the user perceives, independent of cover arrival.
      firstRowAtMs: firstRowAt,
      t90FirstVisibleMs: arrivals.length >= target ? arrivals[target - 1] : null,
      p90FirstVisibleMs: percentile(arrivals, 90),
      p50FirstVisibleMs: percentile(arrivals, 50),
      firstRowMs: arrivals.length ? arrivals[0] : null,
      lastRowMs: arrivals.length ? arrivals[arrivals.length - 1] : null,
      elapsedMs: Math.max(0, performance.now() - meters.startedAt - t0),
      perRow: values,
    };
    OPEN.state = 'done';
  }

  function frame() {
    if (done) return;
    const elapsed = performance.now() - meters.startedAt - t0;
    const cards = visibleCards();
    if (cards && cards.length) {
      if (initialIds === null) {
        initialIds = cards.map(card => cardKeyFor(card));
        firstRowAt = Math.max(0, performance.now() - meters.startedAt - t0);
        for (const id of initialIds) rows.set(id, { id, firstVisibleMs: null });
      }
      const now = performance.now() - meters.startedAt;
      for (const card of cards) {
        const row = rows.get(cardKeyFor(card));
        if (!row || row.firstVisibleMs !== null) continue;
        if (visibleImage(imageFor(card))) row.firstVisibleMs = Math.max(0, now - t0);
      }
      let resolved = 0;
      rows.forEach(row => { if (row.firstVisibleMs !== null) resolved += 1; });
      if (resolved >= Math.ceil(initialIds.length * 0.9)) { finish('t90-reached'); return; }
      if (elapsed > dwellMs) { finish('dwell-exhausted'); return; }
    } else if (elapsed > budgetMs) { finish('no-rows'); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};
window.__PERF_OPEN_STATE__ = () => ({ state: OPEN.state, result: OPEN.result });

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(React.StrictMode, null,
  React.createElement(AppearanceProvider, null, React.createElement(PlayerShell))));
`
}

/**
 * A one-line interception of the REAL PlayerSurface that publishes its
 * `viewModel` prop.
 *
 * This is how the repo's own browser tests reach player state without importing
 * app internals (see playlistCoverLoadingLatency.browser.test.mjs and
 * playlistSelectionAdd.browser.test.mjs). Reaching into React's fiber tree was
 * the alternative and is far more brittle: field names differ by React version
 * and production/development builds.
 *
 * `servedSurface` is the Vite-transformed real module. We append the re-export
 * that records the prop, then the page imports THIS module instead.
 */
export function buildSurfaceProbeModule(config, servedSurface) {
  return `import React from '${config.reactUrl}';
import { PlayerSurface as RealPlayerSurface } from '/__perf_real_surface.js';
export function PlayerSurface(props) {
  window.__PERF_VM__ = props.viewModel;
  return React.createElement(RealPlayerSurface, props);
}
`
}
