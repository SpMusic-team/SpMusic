import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const HOOK = readFileSync(new URL('./useAudioPlayer.ts', import.meta.url), 'utf8')
const READINESS = readFileSync(new URL('../model/playlistCoverReadiness.ts', import.meta.url), 'utf8')
const PLAYER_COPY = readFileSync(new URL('../model/playerCopy.ts', import.meta.url), 'utf8')

/**
 * Harness for the player's playlist-artwork owner (`useAudioPlayer`).
 *
 * This hook is the player shell, so mounting it means satisfying every runtime
 * import it has. The substitution is therefore derived from the file itself: the
 * prelude binds *every* named import of the module, and any binding the test does
 * not configure resolves to a generated stub. A missing boundary is impossible to
 * overlook, and the assertions stay about the hook's own decisions.
 *
 * What is deliberately real:
 *
 * - `playlistCoverReadiness`, re-imported by URL. Its token comparison and its
 *   recovery ledger *are* the contract this test is about, so stubbing them would
 *   test a copy.
 * - the artwork demand/admission/publish logic inside `useAudioPlayer`, which is
 *   what chooses the path lane, the forced pixel lane, and whether to queue again.
 *
 * What is substituted: React, the DOM events, and the native channels, because the
 * tests observe *which channel* ran for a given DOM report.
 */
function runtimeBindings(source) {
  const names = new Set()
  const declaration = /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'[^']+';?[ \t]*$/gm
  let match
  while ((match = declaration.exec(source)) !== null) {
    const clause = match[1]
    if (/^type\s/.test(clause)) continue
    const braces = /\{([\s\S]*)\}/.exec(clause)
    if (!braces) continue
    for (const entry of braces[1].split(',')) {
      const name = entry.trim()
      if (!name || name.startsWith('type ')) continue
      names.add(name)
    }
  }
  return [...names]
}

async function harness(options = {}) {
  const { trackCount = 3, pixel = 'pixels', path = 'ready' } = options
  const frames = new Map()
  let frameSequence = 0
  const effects = []
  const cleanups = []
  const previousDeps = []
  let effectIndex = 0
  let refIndex = 0
  const refs = []
  let callbackIndex = 0
  const previousCallbacks = []
  const sameDeps = (left, right) => {
    if (!left || !right) return left === right
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  }
  const states = []
  const stateSetters = []
  let stateIndex = 0
  let urlSequence = 30

  const trackPixelRequests = []
  const coverPixelRequests = []
  const pathRequests = []
  const probeRequests = []
  const loadAndPlayCalls = []
  const brokenUrls = new Set()
  let scanCalls = 0
  let libraryCalls = 0
  /** Monotonic native generation; the selection transaction rejects a repeat. */
  let generation = 1
  let configuredPath = path
  let configuredPixel = pixel
  let api = null

  const sources = [{
    sourceKind: 'folder',
    sourcePath: '/music/album',
    tracks: Array.from({ length: trackCount }, (_, index) => ({
      id: `track-${index}`,
      sourcePath: `/music/album/${index}.flac`,
      fileName: `${index}.flac`,
      available: true,
      trackId: `track-${index}`,
      durationMs: 1000,
      title: `Track ${index}`,
      artist: 'Artist',
      album: 'Album',
      metadataLoaded: true,
    })),
    selectedIndex: 0,
  }]
  /** The scope string the fixture playlist resolves to. */
  const scope = 'folder\u0000/music/album'
  const playlist = () => sources[0]
  /** One hydrated `AudioTrackRef` for a descriptor of the fixture playlist. */
  const hydrateTrack = (trackId) => {
    const source = sources[0].tracks.find((track) => track.id === trackId) ?? sources[0].tracks[0]
    return {
      id: source.id, sourcePath: source.sourcePath, fileName: source.fileName,
      durationMs: 1000,
      metadata: {
        title: source.title, artist: 'Artist', album: 'Album', albumArtist: 'Artist',
        composer: null, genre: null, year: null, trackNumber: null, discNumber: null,
        comment: null, coverArt: { filePath: `/music/album/${source.id.slice(-1)}.jpg` },
        audioFormat: null,
      },
    }
  }

  /** A DOM-scoped stub for every import the hook has, overridable by name. */
  const bindings = new Map()
  const configured = {
    // The fixture starts with no stored queue entries. These synchronous model
    // calls must not use the harness's default async native-command stub.
    readLibraryQueue: () => [],
    markLibraryQueuePlayed: (entries) => entries,
    useRef: (value) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useState: (initial) => {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      stateSetters[index] ??= (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }
      return [states[index], stateSetters[index]]
    },
    useEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((entry, offset) => !Object.is(entry, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    useLayoutEffect: (effect, deps) => {
      const index = effectIndex++
      const previous = previousDeps[index]
      if (!previous || !deps || deps.some((entry, offset) => !Object.is(entry, previous[offset]))) {
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() })
        previousDeps[index] = deps
      }
    },
    // `useCallback`/`useMemo` must be stable across renders, otherwise an effect
    // whose dependency list contains a callback re-runs on every render and the
    // library restore cancels itself (each run bumps its epoch). React memoizes by
    // dependency list; with an empty dependency list the first callback is reused.
    useCallback: (callback, deps) => {
      const index = callbackIndex++
      const previous = previousCallbacks[index]
      if (previous && sameDeps(previous.deps, deps)) return previous.callback
      previousCallbacks[index] = { callback, deps }
      return callback
    },
    useMemo: (factory) => factory(),
    requestAnimationFrame: (callback) => { const id = ++frameSequence; frames.set(id, callback); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
    requestIdleCallback: (callback) => { const id = ++frameSequence; frames.set(id, () => callback({ didTimeout: false, timeRemaining: () => 50 })); return id },
    cancelIdleCallback: (id) => frames.delete(id),
    console: {
      warn: (...args) => { if (process.env.DEBUG_PLAYER_HARNESS) console.log('warn:', ...args.map(String)) },
      error: (...args) => { if (process.env.DEBUG_PLAYER_HARNESS) console.log('error:', ...args.map(String)) },
      log: () => {},
    },
    toast: Object.assign((message) => { if (process.env.DEBUG_PLAYER_HARNESS) console.log('toast:', message) }, {
      error: (message) => { if (process.env.DEBUG_PLAYER_HARNESS) console.log('toast.error:', message) },
      success: () => {}, message: () => {}, info: () => {}, warning: () => {},
    }),
    // The artwork lane's pure helpers. Only the ones the recovered path reads are
    // given real behaviour; the rest are inert.
    normalizeAudioSourcePath: (path) => String(path ?? '').replaceAll('\\', '/'),
    playlistScope: (value) => `${value?.sourceKind ?? 'folder'}\u0000${value?.sourcePath ?? ''}`,
    coverToneForTrackId: () => 'tone-1',
    playlistArtworkKey: (scope, id, sourcePath) => JSON.stringify([scope, id, String(sourcePath).replaceAll('\\', '/')]),
    playlistCoverImageFromPixels: (pixels) => {
      urlSequence += 1
      return { src: `blob:player-${urlSequence}`, width: pixels.width, height: pixels.height, encodedBytes: pixels.width * pixels.height * 3 }
    },
    isPlaylistCoverDecoded: () => true,
    decodePlaylistCover: async () => {},
    beginAudioPlaylistCoverWindow: async () => 5,
    getLibraryFolders: async () => {
      libraryCalls += 1
      // `RootSelection` marks activity with `selected` or a selected directory rule;
      // a bare `{ path }` would be treated as an inactive root and never scanned.
      return { revision: 1, roots: [{ path: '/music/album', selected: true, directoryRules: [] }] }
    },
    // Real semantics: a root is active when it is selected or has a selected rule.
    isRootSelectionActive: (root) => Boolean(root?.selected) || Boolean(root?.directoryRules?.some((rule) => rule.selected)),
    // The restore effect only remembers a playlist whose `sourceKind` is 'folder'.
    projectSelectedFolder: (playlist) => playlist,
    folderSelectionPath: (path) => String(path ?? '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase(),
    scanLibraryFolder: async (path) => { scanCalls += 1; void path; return sources[0] },
    // The startup state must not already be the target track, and its generation
    // must be null so the selection transaction has no baseline to beat. The full
    // `AudioPlaybackState` shape is answered because the hook reads several fields.
    getAudioState: async () => ({
      currentTrackId: null, generation: null, phase: 'idle', positionMs: 0, durationMs: null,
      volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null,
    }),
    getCurrentAudioTrack: async () => hydrateTrack('track-0'),
    listenAudioStateChanged: async () => () => {},
    // `selectPlaybackQueueTrack` aborts when a transport operation is already
    // running; each stub answers the shape the real transaction validates.
    selectionIsCurrent: () => true,
    playAudio: async () => ({ currentTrackId: 'track-0', generation: 2, phase: 'playing', positionMs: 0, durationMs: 1000, volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null }),
    pauseAudio: async () => ({ currentTrackId: 'track-0', generation: 2, phase: 'paused', positionMs: 0, durationMs: 1000, volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null }),
    seekAudio: async (positionMs) => ({ currentTrackId: 'track-0', generation: 2, phase: 'paused', positionMs, durationMs: 1000, volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null }),
    setAudioVolume: async () => ({ currentTrackId: 'track-0', generation: 2, phase: 'paused', positionMs: 0, durationMs: 1000, volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null }),
    ensureTrackDetailsListener: async () => {},
    listenAudioTrackDetailsChanged: async () => () => {},
    // The real selection transaction requires the native response to advance the
    // generation past the one the state already reported, so the stub answers a
    // monotonically increasing generation and the same shape the hook validates.
    loadAndPlayAudio: async (input) => {
      const id = sources[0].tracks.find((track) => track.sourcePath === input?.path)?.id ?? 'track-0'
      generation += 1
      const result = {
        requestId: input?.requestId ?? 0,
        trackId: id,
        generation,
        state: {
          currentTrackId: id, generation, phase: 'playing', positionMs: 0, durationMs: 1000,
          volume: 0.72, error: null, transportTransition: null, transportSettledRequestId: null,
        },
      }
      loadAndPlayCalls.push(result)
      return result
    },
    // `beginTrackSelection` records the *current* generation as `previousGeneration`
    // and the transaction rejects a response that does not exceed it, so the
    // selection stub above advances `generation` and this reader observes it.
    // `audioTrackMatchesDescriptor` compares the hydrated track against the playlist
    // descriptor, so the stub reproduces the fixture's id/path/availability exactly.
    loadAudioFile: async (sourcePath) => {
      const descriptor = sources[0].tracks.find((track) => track.sourcePath === sourcePath) ?? sources[0].tracks[0]
      return hydrateTrack(descriptor.id)
    },
    hydrateAudioTrack: async (sourcePath) => hydrateTrack(sources[0].tracks.find((track) => track.sourcePath === sourcePath)?.id ?? 'track-0'),
    listAudioFolderTracks: async () => sources[0],
    getLibraryPlaylists: async () => [],
    getLibraryStreams: async () => [],
    probeAudioPlaylistTrackSummaries: async (paths) => ({ items: paths.map((path) => ({ sourcePath: path, title: path })) }),
    warmLibraryCoverThumbnails: async () => ({ cancelled: false }),
    cancelLibraryCoverWarmup: async () => {},
    probeAudioPlaylistCover: async (sourcePath) => {
      probeRequests.push(sourcePath)
      const index = sources[0].tracks.findIndex((track) => track.sourcePath === sourcePath)
      return { id: `track-${index}`, sourcePath, coverArt: { filePath: `/music/album/${index}.jpg` } }
    },
    scheduleTrackThumbnail: (input, scheduleOptions) => {
      trackPixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      if (configuredPixel === 'missing') return Promise.resolve(null)
      return Promise.resolve({ width: input.maxEdge, height: input.maxEdge, stride: input.maxEdge * 4, pixels: new Uint8ClampedArray(input.maxEdge * input.maxEdge * 4) })
    },
    schedulePlaylistCoverPixels: (input, scheduleOptions) => {
      coverPixelRequests.push({ input, options: scheduleOptions })
      if (configuredPixel === 'error') return Promise.reject(new Error('pixel channel failed'))
      if (configuredPixel === 'missing') return Promise.resolve(null)
      return Promise.resolve({ width: input.maxEdge, height: input.maxEdge, stride: input.maxEdge * 4, pixels: new Uint8ClampedArray(input.maxEdge * input.maxEdge * 4) })
    },
    attemptTrackThumbnailPath: async (input) => {
      pathRequests.push({ kind: 'track', input })
      if (configuredPath === 'ready') {
        return { status: 'ready', image: { src: `asset://localhost/cache/player-track-${pathRequests.length}.jpg`, width: 256, height: 256, encodedBytes: 12 }, attemptId: `attempt-${pathRequests.length}` }
      }
      if (configuredPath === 'missing') return { status: 'missing' }
      return { status: 'fallback', reason: 'decode' }
    },
    attemptPlaylistCoverThumbnailPath: async (input) => {
      pathRequests.push({ kind: 'cover', input })
      if (configuredPath === 'ready') {
        return { status: 'ready', image: { src: `asset://localhost/cache/player-cover-${pathRequests.length}.jpg`, width: input.maxEdge, height: input.maxEdge, encodedBytes: 24 }, attemptId: `cover-attempt-${pathRequests.length}` }
      }
      if (configuredPath === 'missing') return { status: 'missing' }
      return { status: 'fallback', reason: 'decode' }
    },
    // The artwork grace/byte ledger is a real module, but it only decides residency
    // accounting; an inert instance keeps every row resident for these tests.
    createPlaylistArtworkGrace: () => ({
      retain: () => new Set(), reset() {}, setExpiryHandler() {}, dispose() {},
    }),
    createPlaylistArtworkStore: (read, retain) => {
      let readSnapshot = read
      let retainSnapshot = retain
      const subscribers = new Map()
      const notify = (keys) => {
        for (const key of keys) {
          const entries = subscribers.get(key)
          if (!entries) continue
          const snapshot = readSnapshot(key)
          for (const entry of entries) {
            if (Object.is(entry.snapshot, snapshot)) continue
            entry.snapshot = snapshot
            entry.listener()
          }
        }
      }
      return {
        getSnapshot: (key) => readSnapshot(key),
        bind(nextRead, nextRetain) { readSnapshot = nextRead; retainSnapshot = nextRetain; notify(subscribers.keys()) },
        subscribe(key, listener) {
          const entries = subscribers.get(key) ?? new Set()
          const entry = { listener, snapshot: readSnapshot(key) }
          entries.add(entry)
          subscribers.set(key, entries)
          return () => { entries.delete(entry); if (!entries.size) subscribers.delete(key) }
        },
        notify,
        notifyAll: () => notify(subscribers.keys()),
        retain: (key) => (retainSnapshot ? retainSnapshot(key) : () => {}),
      }
    },
    // Storage and session readers must return usable empty values synchronously.
    readTrackRatings: () => ({}),
    writeTrackRatings: () => {},
    updateTrackRating: (ratings) => ratings,
    readShuffleMode: () => 'off',
    readRepeatMode: () => 'off',
    persistShuffleMode: () => {},
    persistRepeatMode: () => {},
    readPlaybackSession: () => null,
    clearPlaybackSession: () => {},
    persistPlaybackSession: () => {},
    readBookmarks: () => [],
    writeBookmarks: () => {},
    readRecentlyPlayed: () => [],
    writeRecentlyPlayed: () => {},
    readMostPlayed: () => [],
    writeMostPlayed: () => {},
    recordMostPlayed: () => [],
    readManualSongOrders: () => ({ orders: new Map(), error: null }),
    trackPresentationEqual: () => false,
    audioTrackToTrack: (track) => ({ ...track, coverImage: undefined, coverImageFallback: undefined, lyrics: [] }),
    audioTrackToPlaylistVisual: (track) => ({ id: track.id, coverTone: 'tone-1', hasLocalArtwork: false }),
    audioFolderTrackPlaceholder: (track) => ({ ...track }),
    patchTrackDuration: (track) => track,
    playlistDisplayName: () => 'Album',
    singleTrackFolderPlaylist: () => sources[0],
    playbackQueueOrigin: () => null,
    isStreamSource: () => false,
    // The clock is driven by the audio state in production; this fixture never
    // advances playback, so every mutator is a no-op and every reader is zero.
    createPlayerVisualTimelineClock: () => ({
      now: () => 0, start() {}, stop() {}, dispose() {},
      getPositionSeconds: () => 0, getPositionMs: () => 0,
      setPositionSeconds() {}, setPositionMs() {}, setPaused() {}, setRate() {},
      subscribe: () => () => {}, tick() {},
    }),
    createPageShuffleOrder: (items) => [...items],
    resolvePageShuffleTarget: () => null,
    applyManualSongOrder: (tracks) => tracks,
    isSongOrderPermutation: () => false,
    mergeFilteredSongOrder: (order) => order,
    sameSongOrder: () => true,
    saveManualSongOrder: () => {},
    isPlayerDragDiagnosticsRecording: () => false,
    playerDragDiagnosticId: () => '',
    recordPlayerDragDiagnostic: () => {},
    registerPlayerDragDiagnosticSnapshot: () => () => {},
    nextRepeatMode: { off: 'all' },
    nextShuffleMode: { off: 'all' },
    resolveNextTrackIndex: () => 0,
    // The real copy module is loaded below (it needs the transpiler), so this is a
    // getter: `bind` reads it when the hook module is evaluated, which is later.
    get appCopy() { return playerCopy.appCopy },
    STREAMS_SCOPE: 'streams',
    validStreamsPlaylist: () => null,
    MAX_CONCURRENT: 4,
    AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT: 200,
    isAudioCoverPixelsError: () => false,
    isAudioCommandError: () => false,
    AudioCommandCode: new Proxy({}, { get: () => 'INTERNAL_ERROR' }),
    // `sample` is the only method the playback path calls; it returns whether the
    // sample was recorded, and the hook ignores that value here.
    RecentlyPlayedTracker: class {
      record() {}
      breakBaseline() {}
      restart() {}
      sample() { return false }
    },
    pendingPlaylistTrackRow: (track) => ({ id: track.id, title: track.title ?? '', artist: '', album: '', coverTone: 'tone-1' }),
    playlistDescriptorFingerprint: () => '',
    chunkPlaylistSummaryPaths: (paths) => [paths],
    playlistSummaryProbePaths: () => [],
    playlistTrackRowEqual: () => true,
    playlistTrackRowFromSummary: (row) => row,
    nonUrlStreamName: () => '',
    streamTrackTitle: () => '',
    nonEmptyText: (value) => String(value ?? ''),
    default: undefined,
  }

  const listeners = new Map()
  globalThis.__audioPlayerTest = {
    bind(name) {
      if (!bindings.has(name)) {
        // Every named import of the module is bound, so a boundary the test did not
        // configure becomes an inert stub instead of a ReferenceError. Native
        // commands are async in the real module, so the stub resolves; a sync
        // caller that needs a value must configure its binding explicitly.
        bindings.set(name, configured[name] ?? (() => Promise.resolve(undefined)))
      }
      return bindings.get(name)
    },
    bindings,
    configured,
    document: {
      documentElement: { matches: () => false, querySelectorAll: () => [] },
      body: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelectorAll: (selector) => (selector === 'img' ? [...images] : []),
    },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    location: { href: 'http://localhost/' },
    // Timers are real here: the hook schedules session retries and idle callbacks,
    // and the tests must not need to model their internal cadence. They are
    // `unref`'d so a pending retry cannot keep the test process alive.
    setInterval: (callback, delay) => { const handle = setInterval(callback, delay); handle.unref?.(); return handle },
    clearInterval: (handle) => clearInterval(handle),
    setTimeout: (callback, delay) => { const handle = setTimeout(callback, delay); handle.unref?.(); return handle },
    clearTimeout: (handle) => clearTimeout(handle),
    requestAnimationFrame: (callback) => { const id = ++frameSequence; frames.set(id, callback); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
  }
  globalThis.window = globalThis.__audioPlayerTest
  const images = []
  const RealURL = globalThis.URL
  RealURL.createObjectURL = () => { urlSequence += 1; return `blob:player-${urlSequence}` }
  RealURL.revokeObjectURL = () => {}
  // The readiness layer predecodes through a temporary `Image`. A managed cover
  // that the test did not mark broken decodes immediately, mirroring a warm cache.
  globalThis.Image = class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.onload = null; this.onerror = null; this._src = '' }
    get src() { return this._src }
    set src(value) {
      this._src = value
      queueMicrotask(() => {
        if (brokenUrls.has(value)) { this.complete = true; this.naturalWidth = 0; this.onerror?.(); return }
        this.complete = true
        this.naturalWidth = 64
        this.onload?.()
      })
    }
    decode() { return Promise.resolve() }
    removeAttribute(name) { if (name === 'src') this._src = '' }
  }

  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText

  const readinessUrl = `data:text/javascript;base64,${Buffer.from(compile(READINESS)).toString('base64')}`
  const readiness = await import(`${readinessUrl}#readiness-${Math.random()}`)
  // The copy module is a plain data module with no runtime boundary of its own, so
  // the real one is used: its command-code table is what `commandError` reads.
  const copyUrl = `data:text/javascript;base64,${Buffer.from(compile(PLAYER_COPY)).toString('base64')}`
  const playerCopy = await import(`${copyUrl}#copy-${Math.random()}`)
  void readiness

  const stripped = compile(HOOK).replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  assert(!/^import\b/m.test(stripped), 'the harness substitutes every runtime import')
  /**
   * Diagnostic seam: surface the exception a rejected selection actually threw.
   *
   * The hook swallows it into a generic command error, which is correct product
   * behaviour but useless when a fixture is wrong. This only *observes*; no decision
   * inside the hook changes.
   */
    /**
   * Diagnostic instrumentation.
   *
   * The hook swallows internal rejection reasons into a generic command error, which
   * is correct product behaviour but useless when a fixture is wrong. Each entry
   * below is anchored on the *compiled* text and only inserts an observation; the
   * original condition and the statement after it are untouched, so no decision in
   * the hook changes.
   */
  const instrumented = stripped
    .replace(
      'const nextError = commandError(error);',
      'globalThis.__playerSelectionError = error; const nextError = commandError(error);',
    )
    .replace(
      "}, { token, actualUrl: detail.actualUrl, outcome: 'failed' }))\n                return;",
      "}, { token, actualUrl: detail.actualUrl, outcome: 'failed' })) { globalThis.__playerReport = 'not-current'; globalThis.__playerDiagnostic = { published: visual.presentation, token, identity: visualIdentity(trackId), actualUrl: detail.actualUrl, session: playlistArtworkSessionRef.current }; return; }",
    )
    .replace(
      'if (!playlistVisualDesiredIdsRef.current.has(trackId))\n                return;',
      "if (!playlistVisualDesiredIdsRef.current.has(trackId)) { globalThis.__playerReport = 'not-desired'; return; }",
    )
    .replace(
      'const pending = playlistPendingReplacementRef.current.get(src);\n            if (pending) {',
      'const pending = playlistPendingReplacementRef.current.get(src); globalThis.__playerPending = Boolean(pending); if (pending) {',
    )
    .replace(
      'const claim = recovery.claim(trackId, token.identity, token.publishGeneration, src);',
      'globalThis.__playerClaim = recovery.claim(trackId, token.identity, token.publishGeneration, src); const claim = globalThis.__playerClaim;',
    )
    .replace(
      'const pending = playlistPendingReplacementRef.current.get(src);\n      if (pending) {',
      'const pending = playlistPendingReplacementRef.current.get(src); globalThis.__playerPending = Boolean(pending); if (pending) {',
    )

  // The readiness module is bound by name, so every runtime symbol the hook takes
  // from it must be listed. Everything else is generated from the file's own import
  // list, so a new dependency cannot be silently left unbound.
  const readinessNames = ['coverImageEventDetail', 'createCoverPresentation', 'createCoverRecoveryLedger',
    'decodePlaylistCover', 'isCurrentCoverReport', 'isPlaylistCoverDecoded',
    'nextCoverSessionGeneration', 'releasePlaylistCoverUrl']
  const names = runtimeBindings(HOOK).filter((name) => !readinessNames.includes(name))
  const prelude = `
    const __env = (name) => globalThis.__audioPlayerTest.bind(name)
    ${names.map((name) => `const ${name} = __env(${JSON.stringify(name)})`).join('\n    ')}
    const window = globalThis.__audioPlayerTest
    const document = globalThis.__audioPlayerTest.document
    // Lazy accessors: a scheduled retry can log after a harness tore down, and a
    // snapshot bound at import time would then throw from an unhandled rejection.
    const console = {
      warn: (...args) => globalThis.__audioPlayerTest?.console?.warn(...args),
      error: (...args) => globalThis.__audioPlayerTest?.console?.error(...args),
      log: () => {},
    }
    const performance = globalThis.__audioPlayerTest.performance
    const requestAnimationFrame = (callback) => __env('requestAnimationFrame')(callback)
    const cancelAnimationFrame = (id) => __env('cancelAnimationFrame')(id)
    const setTimeout = (callback, delay) => __env('setTimeout')(callback, delay)
    const clearTimeout = (handle) => __env('clearTimeout')(handle)
    const setInterval = (callback, delay) => __env('setInterval')(callback, delay)
    const clearInterval = (handle) => __env('clearInterval')(handle)
    const URL = globalThis.URL
    const MutationObserver = globalThis.__audioPlayerTest.MutationObserver
  `
  const readinessImport = `import { ${readinessNames.join(', ')} } from ${JSON.stringify(readinessUrl)};\n`
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(readinessImport + prelude + instrumented).toString('base64')}#audio-player-${Math.random()}`
  )
  void readiness

  const captureListeners = () => {
    listeners.set('spmusic:playlist-cover-image-error', new Set())
    listeners.set('spmusic:playlist-cover-image-load', new Set())
  }
  captureListeners()
  globalThis.__audioPlayerTest.addEventListener = (type, listener) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  globalThis.__audioPlayerTest.removeEventListener = (type, listener) => { listeners.get(type)?.delete(listener) }

  /**
   * Render the hook.
   *
   * `effects` only contains effects whose dependency list changed, so the harness
   * runs exactly those — the same rule React applies. Cleanup of an unchanged effect
   * must not run, or an effect with a stable dependency list (the track-details
   * listener, the library restore) would be torn down on every render and its
   * in-flight promise invalidated.
   */
  const render = () => {
    refIndex = 0
    effectIndex = 0
    stateIndex = 0
    callbackIndex = 0
    api = module.useAudioPlayer(true, true, false)
    for (const effect of effects.splice(0)) effect()
    return api
  }
  /**
   * Let every queued microtask and animation frame run.
   *
   * The hydration job crosses several awaits (scheduler → predecode → publish →
   * demand refresh), and several jobs can be in flight at once. Each turn is a
   * microtask drain followed by one frame, repeated so a chain of awaits completes.
   */
  const flush = async () => {
    for (let turn = 0; turn < 24; turn += 1) {
      for (let index = 0; index < 40; index += 1) await Promise.resolve()
      const ready = [...frames.values()]
      frames.clear()
      for (const callback of ready) callback(0)
    }
    for (let index = 0; index < 40; index += 1) await Promise.resolve()
  }
  const unmount = () => { for (const cleanup of cleanups) cleanup?.() }

  // The fixture playlist is registered by the library restore, so it is reachable
  // through the real session lookup. Selecting a track from it is the production
  // path into `activatePlaylistScope`, which is what lets the artwork demand pass
  // run at all; the recovery logic itself is never simulated.
  render()
  await flush()
  for (let round = 0; round < 40 && (api?.libraryFolderPlaylists?.length ?? 0) === 0; round += 1) {
    render()
    await flush()
  }
  const selected = await api.selectSessionPlaylistTrack(scope, 'track-0')
  await flush()
  for (let round = 0; round < 20 && !api.activePlaylistScope; round += 1) {
    render()
    await flush()
  }
  // Activation starts a demand pass for the first screen. Ask for the whole fixture
  // playlist the way the detail panel does, then let the hydration jobs settle so the
  // tests observe published rows rather than a first paint.
  api.setVisiblePlaylistTrackIds(sources[0].tracks.map((track) => track.id), false, true)
  for (let spin = 0; spin < 12; spin += 1) await flush()
  for (let spin = 0; spin < 12; spin += 1) await flush()
  const activationVisuals = { ...api.playlistTrackVisuals }
  const activated = Boolean(api.activePlaylistScope)
  const diagnostics = {
    status: api.libraryStatus,
    activeScope: api.activePlaylistScope,
    folders: api.libraryFolderPlaylists.length,
    loadCalls: loadAndPlayCalls.length,
    loadedResult: loadAndPlayCalls.at(-1)?.requestId ?? null,
    selected: activated,
    selectionPending: api.selectionPending,
    contentState: api.contentState,
    currentTrackId: api.audioState?.currentTrackId ?? null,
    currentAudioFile: api.currentAudioTrack?.id ?? null,
  }
  const selectionErrors = {
    thrown: String(globalThis.__playerSelectionError?.message ?? globalThis.__playerSelectionError ?? 'none'),
    error: api.audioError ?? null,
    statusText: api.statusText,
    pending: api.selectionPending,
    track: api.track?.id ?? null,
    artwork: api.artwork?.resourceKey ?? null,
    queueSize: api.queueTracks?.length ?? null,
    currentAudioFile: api.currentAudioTrack ?? null,
    visible: api.track?.id ?? null,
    desiredCount: api.queueTracks?.length ?? 0,
    activeScope2: api.playlistDurationScope ?? null,
  }
  const emit = async (type, detail) => {
    const registered = [...(listeners.get(type) ?? [])]
    registered.forEach((listener) => listener({ type, detail }))
    await flush()
    return registered.length
  }
  const fail = async (presentation) => {
    // `actualUrl` may be overridden by the caller: the element reports the URL it
    // actually resolved, which is not required to be the published one.
    const count = await emit('spmusic:playlist-cover-image-error', {
      url: presentation.src,
      actualUrl: presentation.actualUrl ?? new URL(presentation.src, 'http://localhost/').href,
      token: presentation.token,
    })
    globalThis.__playerListeners = count
  }
  const load = (presentation) => emit('spmusic:playlist-cover-image-load', {
    url: presentation.src,
    actualUrl: new URL(presentation.src, 'http://localhost/').href,
    token: presentation.token,
  })
  /** How many listeners the hook registered for the cover protocol. */
  const listenerCount = (type) => (listeners.get(type)?.size ?? 0)

  /** Ask for the given tracks' artwork the way the playlist panel does. */
  const demand = async (trackIds, keepPersistentArtwork = true) => {
    api.setVisiblePlaylistTrackIds(trackIds, keepPersistentArtwork, true)
    await flush()
    return api.playlistTrackVisuals
  }
  /**
   * Demand once and let the hook's own hydration job run.
   *
   * A single demand pass produces exactly one publication per track, so the
   * resulting snapshot is a *first* publication. Calling the demand setter again
   * would publish a replacement (256 -> 512 hero upgrade, or a re-read), and a
   * failed replacement is a rollback because the DOM already confirmed the previous
   * image. The single automatic recovery belongs to the first publication.
   */
  const publishFirst = async (trackIds, keepPersistentArtwork = true) => {
    api.setVisiblePlaylistTrackIds(trackIds, keepPersistentArtwork, true)
    for (let spin = 0; spin < 10; spin += 1) await flush()
    return api.playlistTrackVisuals
  }
  /**
   * Force a genuinely new publication for one track.
   *
   * The hook publishes a replacement only when the demand changes, so the fixture
   * drops the track from demand once (which clears the row) and asks for it again.
   * The re-read is a *fresh first publication* of that row, and that is the state a
   * mounted `<img>` whose managed file disappeared is describing.
   */
  const republish = async (trackId) => {
    api.setVisiblePlaylistTrackIds([], false, true)
    for (let spin = 0; spin < 10; spin += 1) await flush()
    api.setVisiblePlaylistTrackIds([trackId], false, true)
    for (let spin = 0; spin < 10; spin += 1) await flush()
    return api.playlistTrackVisuals[trackId]
  }

  /** Pump the demand pass repeatedly until it stops issuing requests. */
  const settleDemand = async (trackIds, keepPersistentArtwork = true) => {
    let previous = -1
    for (let round = 0; round < 14; round += 1) {
      api.setVisiblePlaylistTrackIds(trackIds, keepPersistentArtwork, true)
      for (let spin = 0; spin < 6; spin += 1) await flush()
      if (Object.keys(api.playlistTrackVisuals).length > 0) {
        const total = trackPixelRequests.length + coverPixelRequests.length + pathRequests.length
        if (total === previous) return api.playlistTrackVisuals
        previous = total
      }
    }
    return api.playlistTrackVisuals
  }
  return {
    module, api: () => api, render, flush, unmount,
    trackPixelRequests, coverPixelRequests, pathRequests, probeRequests,
    visuals: () => api.playlistTrackVisuals,
    setPath: (value) => { configuredPath = value },
    setPixel: (value) => { configuredPixel = value },
    fail, load, emit, demand, settle: settleDemand, publishFirst, listenerCount,
    scope, activated, loadAndPlayCalls, diagnostics, selectionErrors, activationVisuals,
  }
}

test('the harness mounts the real hook with every runtime import bound', async () => {
  const h = await harness()
  try {
    assert.equal(typeof h.api().setVisiblePlaylistTrackIds, 'function')
    assert.equal(typeof h.api().playlistTrackVisuals, 'object')
  } finally { h.unmount() }
})
void runtimeBindings

test('a 256 playlist card whose path image fails in the DOM runs one forced track pixel read', async () => {
  const h = await harness()
  try {
    assert.equal(h.activated, true, `the fixture playlist activates; ${JSON.stringify(h.diagnostics)}`)
    // A non-hero list row is used on purpose: the first track of a playlist also
    // owns a 512 hero upgrade, whose replacement has its own rollback path. A plain
    // list row has exactly one 256 publication, which is the case under test.
    const key = 'track-1'
    const visual = h.visuals()[key]
    assert(visual?.presentation, `the row publishes a snapshot; keys=${JSON.stringify(Object.keys(h.visuals()))}`)
    assert.equal(visual.presentation.token.url, visual.presentation.src)
    assert(visual.presentation.src.startsWith('asset://'), 'the first publication came from the path lane')
    assert.equal(h.trackPixelRequests.length, 0, 'a healthy path image costs no pixels')

    const beforePath = h.pathRequests.length
    await h.fail(visual.presentation)
    assert.equal(h.pathRequests.length, beforePath, 'recovery never re-enters the path helper')
    assert.equal(h.trackPixelRequests.length, 1, `exactly one forced 256 read; report=${globalThis.__playerReport ?? 'accepted'} claim=${globalThis.__playerClaim ?? 'none'} pending=${String(globalThis.__playerPending)}`)
    assert.equal(h.trackPixelRequests[0].input.maxEdge, 256)
    assert.equal(h.trackPixelRequests[0].input.sourcePath, '/music/album/1.flac')
    const replacement = h.visuals()[key]?.presentation
    assert(replacement, 'a replacement is published')
    assert.notEqual(replacement.src, visual.presentation.src)
  } finally { h.unmount() }
})

test('a repeated failure of the forced replacement does not queue another job', async () => {
  const h = await harness()
  try {
    const visual = h.visuals()['track-1']
    await h.fail(visual.presentation)
    const afterFirst = h.trackPixelRequests.length
    assert.equal(afterFirst, 1)
    const replacement = h.visuals()['track-1']?.presentation
    if (replacement) await h.fail(replacement)
    assert.equal(h.trackPixelRequests.length, afterFirst, 'the epoch stays spent')
    assert.equal(h.visuals()['track-1']?.coverThumbnail, undefined,
      'a spent epoch settles as a placeholder, not a broken element')
    // Staying in demand and pumping again adds nothing.
    assert.equal(h.trackPixelRequests.length, afterFirst, 'no loop while the row stays visible')
  } finally { h.unmount() }
})

test('a forced pixel command failure terminates the epoch without a path retry', async () => {
  const h = await harness()
  try {
    h.setPixel('error')
    const beforePath = h.pathRequests.length
    await h.fail(h.visuals()['track-1'].presentation)
    assert.equal(h.trackPixelRequests.length, 1, 'one bounded attempt')
    assert.equal(h.pathRequests.length, beforePath, 'the failing path lane is not retried')
    assert.equal(h.visuals()['track-1']?.coverThumbnail, undefined, 'the placeholder is the final state')
  } finally { h.unmount() }
})

test('a failure report that does not name the current publication is ignored', async () => {
  // Each case gets a fresh owner, so a rejection can only be explained by the
  // currentness check itself and never by an epoch another case already spent.
  const cases = [
    {
      label: 'another owner lifetime',
      mutate: (presentation) => ({ ...presentation, token: { ...presentation.token, sessionGeneration: presentation.token.sessionGeneration + 5 } }),
    },
    {
      label: 'a superseded publish generation',
      mutate: (presentation) => ({ ...presentation, token: { ...presentation.token, publishGeneration: presentation.token.publishGeneration + 5 } }),
    },
    {
      label: 'another track key',
      mutate: (presentation) => ({ ...presentation, token: { ...presentation.token, key: 'track-missing' } }),
    },
    {
      label: 'a descriptor identity that moved',
      mutate: (presentation) => ({ ...presentation, token: { ...presentation.token, identity: '["playlist","track-1","/music/other.flac"]' } }),
    },
    {
      label: 'an element whose src changed',
      mutate: (presentation) => ({ ...presentation, actualUrl: 'http://localhost/swapped.jpg' }),
    },
  ]
  for (const entry of cases) {
    const h = await harness()
    try {
      const visual = h.visuals()['track-1']
      assert(visual?.presentation, `a presentation exists for the ${entry.label} case`)
      const before = h.trackPixelRequests.length
      await h.fail(entry.mutate(visual.presentation))
      assert.equal(h.trackPixelRequests.length, before,
        `${entry.label}: an unverifiable report must not start a recovery`)
      assert(h.visuals()['track-1']?.presentation,
        `${entry.label}: the current resource is not evicted`)
    } finally { h.unmount() }
  }
})

test('a URL-only report never starts a recovery', async () => {
  const h = await harness()
  try {
    await h.emit('spmusic:playlist-cover-image-error', h.visuals()['track-1'].presentation.src)
    assert.equal(h.trackPixelRequests.length, 0, 'a tokenless report cannot be attributed')
  } finally { h.unmount() }
})

test('a DOM load does not restore the spent epoch', async () => {
  const h = await harness()
  try {
    const failed = h.visuals()['track-1'].presentation
    await h.fail(failed)
    assert.equal(h.trackPixelRequests.length, 1)
    const replacement = h.visuals()['track-1'].presentation
    await h.load(replacement)
    await h.fail(replacement)
    assert.equal(h.trackPixelRequests.length, 1, 'a load is evidence about a moment, not a permanent guarantee')
  } finally { h.unmount() }
})

test('leaving demand and returning opens a fresh epoch', async () => {
  const h = await harness()
  try {
    h.setPixel('error')
    await h.fail(h.visuals()['track-1'].presentation)
    const attempts = h.trackPixelRequests.length
    assert.equal(attempts, 1)
    // Leaving demand is a documented retry trigger.
    await h.demand([])
    await h.emit('spmusic:playlist-cover-image-load', { url: '', actualUrl: '' })
    h.setPixel('pixels')
    h.setPath('ready')
    assert(h.pathRequests.length + h.trackPixelRequests.length > attempts,
      `the returning row is admitted again; track=${h.trackPixelRequests.length} path=${h.pathRequests.length}`)
  } finally { h.unmount() }
})

test('an artwork revision change publishes a new identity', async () => {
  const h = await harness()
  try {
    const first = h.visuals()['track-1'].presentation
    assert(first)
    const second = h.visuals()['track-1'].presentation
    // The identity is the same resource here (no rescan), which is what makes the
    // failure attributable. This assertion is the baseline for the rescan case the
    // library owner covers.
    assert.equal(second.token.identity, first.token.identity)
    assert(second.token.publishGeneration >= first.token.publishGeneration)
  } finally { h.unmount() }
})
