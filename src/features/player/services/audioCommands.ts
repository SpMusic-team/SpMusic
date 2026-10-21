import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
// Single source of truth for the duration batch bound. It is declared in the
// duration model (next to the scanner that chunks by it) and re-exported here so
// every caller keeps importing it from this service. It MUST stay identical to
// the Rust constant `MAX_DURATION_BATCH_PATHS`
// (`src-tauri/src/audio/playlist_duration.rs`); both sides change in the same
// commit (see `docs/architecture/playlist-duration-cache.md`, ruling 7 / risk R7).
import { AUDIO_PLAYLIST_DURATION_BATCH_LIMIT } from '../model/playlistDuration'

export { AUDIO_PLAYLIST_DURATION_BATCH_LIMIT }

export const AUDIO_STATE_CHANGED_EVENT = 'audio_state_changed'
export const AUDIO_TRACK_DETAILS_CHANGED_EVENT = 'audio_track_details_changed'

export type AudioPlaybackPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'ended'
  | 'error'

export type AudioErrorCode =
  | 'USER_CANCELLED'
  | 'SUPERSEDED'
  | 'NO_TRACK_LOADED'
  | 'INVALID_PATH'
  | 'FILE_NOT_FOUND'
  | 'UNREADABLE_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'PLAYBACK_INIT_FAILED'
  | 'PLAYBACK_FAILED'
  | 'UNSUPPORTED_OPERATION'
  | 'INVALID_VOLUME'
  | 'INTERNAL_ERROR'

export type AudioTrackRef = {
  id: string
  sourcePath: string
  fileName: string
  durationMs: number | null
  metadata: AudioTrackMetadata
}

export type AudioOutputInfo = {
  method: string
  deviceName: string
  bitDepth: number
  sampleRateHz: number
}

export type AudioTrackMetadata = {
  title: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  discNumber: number | null
  comment: string | null
  lyrics: string | null
  coverArt: AudioCoverArt | null
  audioFormat: AudioFormatMetadata | null
}

export type AudioFormatMetadata = {
  bitDepth: number | null
  sampleRateHz: number | null
  bitrateKbps: number | null
  codec: string | null
}

export type AudioCoverArt = {
  mimeType: string
  filePath: string | null
  dataUrl: string | null
  byteLen: number
}

export type AudioPlaylistCoverSource = {
  id: string
  sourcePath: string
  coverArt: AudioCoverArt | null
}

export type AudioLoadCoverPixelsInput = {
  filePath: string
  maxEdge: 1024 | 1536 | 2048 | 3072
  requestId: number
}

export type AudioLoadPlaylistCoverPixelsInput = {
  clientId: string
  filePath: string
  maxEdge: 128 | 256 | 512
  windowGeneration: number
}

export type AudioCoverPixels = {
  width: number
  height: number
  stride: number
  flags: number
  sourceWidth: number
  sourceHeight: number
  pixels: Uint8ClampedArray<ArrayBuffer>
}

export type AudioCoverPixelsError = {
  code: string
  message: string
  recoverable: boolean
}

export type AudioCommandError = {
  code: AudioErrorCode
  message: string
  recoverable: boolean
}

export type AudioPlaylistDuration = {
  sourcePath: string
  durationMs: number | null
  error: AudioCommandError | null
}

class PlaylistDurationProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaylistDurationProtocolError'
  }
}

/**
 * Read-only tag snapshot of one local audio file. Every field is `null` when the
 * file carries no such tag or property; the batch channel never reports cover
 * art, lyrics, sidecar data or a duration (duration stays authoritative on
 * `probeAudioPlaylistDurations` / the hydration path).
 */
export type PlaylistTrackTagSummary = {
  title: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  bitDepth: number | null
  sampleRateHz: number | null
  bitrateKbps: number | null
  codec: string | null
}

export type AudioPlaylistTrackSummaryItem = {
  sourcePath: string
  summary: PlaylistTrackTagSummary | null
  error: AudioCommandError | null
}

/** Upper bound per batch, mirroring the Rust command's own limit. */
export const AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT = 256

class PlaylistTrackSummaryProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaylistTrackSummaryProtocolError'
  }
}

function nullableSummaryText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  throw new PlaylistTrackSummaryProtocolError('Playlist track summary text field is invalid')
}

function nullableSummaryNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  throw new PlaylistTrackSummaryProtocolError('Playlist track summary numeric field is invalid')
}

// Unknown extra fields are ignored on purpose: the command may grow additive
// fields without forcing every playlist into the fallback path.
function parsePlaylistTrackTagSummary(value: unknown): PlaylistTrackTagSummary {
  if (!value || typeof value !== 'object') {
    throw new PlaylistTrackSummaryProtocolError('Playlist track summary response item is invalid')
  }
  const summary = value as Partial<PlaylistTrackTagSummary>
  return {
    title: nullableSummaryText(summary.title),
    artist: nullableSummaryText(summary.artist),
    album: nullableSummaryText(summary.album),
    albumArtist: nullableSummaryText(summary.albumArtist),
    bitDepth: nullableSummaryNumber(summary.bitDepth),
    sampleRateHz: nullableSummaryNumber(summary.sampleRateHz),
    bitrateKbps: nullableSummaryNumber(summary.bitrateKbps),
    codec: nullableSummaryText(summary.codec),
  }
}

export async function probeAudioPlaylistTrackSummaries(
  paths: string[],
): Promise<AudioPlaylistTrackSummaryItem[]> {
  if (paths.length > AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT) {
    throw new PlaylistTrackSummaryProtocolError('Playlist track summary batch exceeds 256 paths')
  }
  const response = await invoke<unknown>('audio_probe_playlist_track_summaries', { input: { paths } })
  if (!Array.isArray(response) || response.length !== paths.length) {
    throw new PlaylistTrackSummaryProtocolError('Playlist track summary response count is invalid')
  }
  return response.map((value: unknown, index) => {
    if (!value || typeof value !== 'object') {
      throw new PlaylistTrackSummaryProtocolError('Playlist track summary response item is invalid')
    }
    const item = value as Partial<AudioPlaylistTrackSummaryItem>
    if (item.sourcePath !== paths[index]) {
      throw new PlaylistTrackSummaryProtocolError('Playlist track summary response path echo is invalid')
    }
    if (item.error !== null && item.error !== undefined
      && (!isAudioCommandError(item.error) || typeof item.error.recoverable !== 'boolean')) {
      throw new PlaylistTrackSummaryProtocolError('Playlist track summary response error is invalid')
    }
    return {
      sourcePath: item.sourcePath,
      summary: item.summary === null || item.summary === undefined
        ? null
        : parsePlaylistTrackTagSummary(item.summary),
      error: item.error ?? null,
    }
  })
}

export async function probeAudioPlaylistDurations(paths: string[]): Promise<AudioPlaylistDuration[]> {
  if (paths.length > AUDIO_PLAYLIST_DURATION_BATCH_LIMIT) {
    throw new PlaylistDurationProtocolError(`Playlist duration batch exceeds ${AUDIO_PLAYLIST_DURATION_BATCH_LIMIT} paths`)
  }
  const response = await invoke<unknown>('audio_probe_playlist_durations', { input: { paths } })
  if (!Array.isArray(response) || response.length !== paths.length) throw new PlaylistDurationProtocolError('Playlist duration response count is invalid')
  return response.map((value: unknown, index) => {
    if (!value || typeof value !== 'object') throw new PlaylistDurationProtocolError('Playlist duration response item is invalid')
    const item = value as Partial<AudioPlaylistDuration>
    if (item.sourcePath !== paths[index]
      || (item.durationMs !== null && (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0))
      || (item.error !== null && (!isAudioCommandError(item.error) || typeof item.error.recoverable !== 'boolean'))) {
      throw new PlaylistDurationProtocolError('Playlist duration response fields are invalid')
    }
    return { sourcePath: item.sourcePath, durationMs: item.durationMs, error: item.error }
  })
}

export type AudioPlaybackState = {
  phase: AudioPlaybackPhase
  generation: number | null
  currentTrackId: string | null
  positionMs: number
  durationMs: number | null
  volume: number
  error: AudioCommandError | null
  transportTransition: AudioTransportTransition | null
  transportSettledRequestId: number | null
}

export type AudioTransportTarget = 'playing' | 'paused'

export type AudioTransportTransition = {
  requestId: number
  target: AudioTransportTarget
  durationMs: number
}

export type AudioTransitionPlaybackInput = AudioTransportTransition & {
  expectedTrackId: string
}

export type AudioOpenFileInput = {
  filters?: Array<{ name: string; extensions: string[] }>
}

export type AudioFolderTrackRef = {
  id: string
  sourcePath: string
  fileName: string
  available: boolean
}

export type AudioPlaylistSourceKind = 'folder' | 'm3u8'

export type AudioFolderPlaylist = {
  directoryPath: string
  directoryName: string
  sourceKind: AudioPlaylistSourceKind
  sourcePath: string
  sourceName: string
  selectedIndex: number
  tracks: AudioFolderTrackRef[]
}

export type AudioOpenSourceResult =
  | { kind: 'track'; track: AudioTrackRef }
  | { kind: 'playlist'; playlist: AudioFolderPlaylist }

export type AudioPlayInput = {
  restart?: boolean
}

export type AudioLoadAndPlayInput = {
  path: string
  requestId: number
}

export type AudioLoadAndPlayResult = {
  requestId: number
  generation: number
  trackId: string
  fileName: string
  state: AudioPlaybackState
}

export type AudioTrackDetailsChanged =
  | {
    kind: 'ready'
    requestId: number
    generation: number
    track: AudioTrackRef
  }
  | {
    kind: 'error'
    requestId: number
    generation: number
    trackId: string
    error: AudioCommandError
  }

export type AudioEmbedLyricsInput = {
  path: string
  lyrics: string
}

export async function openAudioFile(input?: AudioOpenFileInput): Promise<AudioTrackRef> {
  return invoke<AudioTrackRef>('audio_open_file', { input: input ?? null })
}

export async function openAudioSource(): Promise<AudioOpenSourceResult> {
  return invoke<AudioOpenSourceResult>('audio_open_source')
}

export async function loadAudioFile(path: string): Promise<AudioTrackRef> {
  return invoke<AudioTrackRef>('audio_load_file', { input: { path } })
}

export async function loadAndPlayAudio(input: AudioLoadAndPlayInput): Promise<AudioLoadAndPlayResult> {
  return invoke<AudioLoadAndPlayResult>('audio_load_and_play', { input })
}

export async function hydrateAudioTrack(path: string): Promise<AudioTrackRef> {
  return invoke<AudioTrackRef>('audio_hydrate_track', { input: { path } })
}

export async function probeAudioPlaylistCover(path: string): Promise<AudioPlaylistCoverSource> {
  const response = await invoke<unknown>('audio_probe_playlist_cover', { input: { path } })
  if (!response || typeof response !== 'object') throw new Error('Invalid playlist cover source response')
  const source = response as Partial<AudioPlaylistCoverSource>
  const cover = source.coverArt
  if (
    typeof source.id !== 'string' || !source.id
    || typeof source.sourcePath !== 'string' || !source.sourcePath
    || (cover !== null && (
      !cover || typeof cover !== 'object'
      || typeof cover.mimeType !== 'string'
      || !(cover.filePath === null || typeof cover.filePath === 'string')
      || !(cover.dataUrl === null || typeof cover.dataUrl === 'string')
      || !Number.isSafeInteger(cover.byteLen) || cover.byteLen <= 0 || cover.byteLen > 16 * 1024 * 1024
    ))
  ) throw new Error('Invalid playlist cover source response')
  return source as AudioPlaylistCoverSource
}

export async function embedAudioLyrics(input: AudioEmbedLyricsInput): Promise<AudioTrackRef> {
  return invoke<AudioTrackRef>('audio_embed_lyrics', { input })
}

const COVER_PIXELS_HEADER_LENGTH = 40
const COVER_PIXELS_MAX_SOURCE_EDGE = 16_384
const COVER_PIXELS_RGBA8 = 1
const COVER_PIXELS_KNOWN_FLAGS = 0b11

function coverPixelBytes(response: ArrayBuffer | Uint8Array): Uint8Array {
  if (response instanceof Uint8Array) return response
  if (response instanceof ArrayBuffer) return new Uint8Array(response)
  throw new Error('Cover pixel response is not binary data')
}

function parseCoverPixels(
  response: ArrayBuffer | Uint8Array,
  maxEdge: AudioLoadCoverPixelsInput['maxEdge'] | AudioLoadPlaylistCoverPixelsInput['maxEdge'],
): AudioCoverPixels {
  const bytes = coverPixelBytes(response)
  if (bytes.byteLength < COVER_PIXELS_HEADER_LENGTH) throw new Error('Cover pixel response header is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    view.getUint8(0) !== 0x53
    || view.getUint8(1) !== 0x50
    || view.getUint8(2) !== 0x58
    || view.getUint8(3) !== 0x52
  ) throw new Error('Cover pixel response magic is invalid')
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== COVER_PIXELS_HEADER_LENGTH) {
    throw new Error('Cover pixel response version is unsupported')
  }

  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const stride = view.getUint32(16, true)
  const pixelFormat = view.getUint32(20, true)
  const pixelLen = view.getUint32(24, true)
  const flags = view.getUint32(28, true)
  const sourceWidth = view.getUint32(32, true)
  const sourceHeight = view.getUint32(36, true)
  const expectedStride = width * 4
  const expectedPixelLen = expectedStride * height
  if (
    width === 0
    || height === 0
    || width > maxEdge
    || height > maxEdge
    || sourceWidth === 0
    || sourceHeight === 0
    || sourceWidth > COVER_PIXELS_MAX_SOURCE_EDGE
    || sourceHeight > COVER_PIXELS_MAX_SOURCE_EDGE
    || !Number.isSafeInteger(expectedStride)
    || !Number.isSafeInteger(expectedPixelLen)
    || stride !== expectedStride
    || pixelFormat !== COVER_PIXELS_RGBA8
    || pixelLen !== expectedPixelLen
    || flags !== (flags & COVER_PIXELS_KNOWN_FLAGS)
    || bytes.byteLength !== COVER_PIXELS_HEADER_LENGTH + pixelLen
  ) throw new Error('Cover pixel response metadata is inconsistent')
  if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error('Cover pixel response buffer is unsupported')

  return {
    width,
    height,
    stride,
    flags,
    sourceWidth,
    sourceHeight,
    pixels: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + COVER_PIXELS_HEADER_LENGTH, pixelLen),
  }
}

export async function loadAudioCoverPixels(input: AudioLoadCoverPixelsInput): Promise<AudioCoverPixels> {
  const response = await invoke<ArrayBuffer | Uint8Array>('audio_load_cover_pixels', { input })
  return parseCoverPixels(response, input.maxEdge)
}

export async function loadAudioPlaylistCoverPixels(
  input: AudioLoadPlaylistCoverPixelsInput,
): Promise<AudioCoverPixels> {
  const response = await invoke<ArrayBuffer | Uint8Array>('audio_load_playlist_cover_pixels', { input })
  return parseCoverPixels(response, input.maxEdge)
}

export async function beginAudioPlaylistCoverWindow(clientId: string): Promise<number> {
  return invoke<number>('audio_begin_playlist_cover_window', { input: { clientId } })
}

export function isAudioCoverPixelsError(error: unknown): error is AudioCoverPixelsError {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Partial<AudioCoverPixelsError>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}

export function audioCoverArtUrl(coverArt: AudioCoverArt | null): string | undefined {
  if (!coverArt) return undefined
  if (coverArt.filePath) return convertFileSrc(coverArt.filePath)
  return coverArt.dataUrl ?? undefined
}

export function audioCoverArtFallbackUrl(coverArt: AudioCoverArt | null): string | undefined {
  return coverArt?.dataUrl ?? undefined
}

export async function listAudioFolderTracks(selectedPath: string): Promise<AudioFolderPlaylist> {
  return invoke<AudioFolderPlaylist>('audio_list_folder_tracks', {
    input: { selectedPath },
  })
}

export type LibraryFolders = { folders: string[] }

export async function getLibraryFolders(): Promise<LibraryFolders> {
  return invoke<LibraryFolders>('library_get_folders')
}

export async function addLibraryFolder(path: string): Promise<LibraryFolders> {
  return invoke<LibraryFolders>('library_add_folder', { path })
}

export async function clearLibraryFolders(): Promise<void> {
  return invoke<void>('library_clear_folders')
}

export async function scanLibraryFolder(path: string): Promise<AudioFolderPlaylist> {
  return invoke<AudioFolderPlaylist>('library_scan_folder', { path })
}

export type LibraryCoverWarmupResult = {
  attempted: number
  warmed: number
  computed: number
  persisted: number
  skipped: number
  failed: number
  cancelled: boolean
}

export async function warmLibraryCoverThumbnails(paths: string[]): Promise<LibraryCoverWarmupResult> {
  return invoke<LibraryCoverWarmupResult>('library_warm_cover_thumbnails', { input: { paths } })
}

export async function cancelLibraryCoverWarmup(): Promise<void> {
  return invoke<void>('library_cancel_cover_warmup')
}

export async function playAudio(input?: AudioPlayInput): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_play', { input: input ?? null })
}

export async function pauseAudio(): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_pause')
}

export async function transitionAudioPlayback(
  input: AudioTransitionPlaybackInput,
): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_transition_playback', { input })
}

export async function stopAudio(): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_stop')
}

export async function seekAudio(positionMs: number): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_seek', { input: { positionMs } })
}

export async function setAudioVolume(volume: number): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_set_volume', { input: { volume } })
}

export async function getAudioState(): Promise<AudioPlaybackState> {
  return invoke<AudioPlaybackState>('audio_get_state')
}

export async function getCurrentAudioTrack(): Promise<AudioTrackRef | null> {
  return invoke<AudioTrackRef | null>('audio_get_current_track')
}

export async function getAudioOutputInfo(): Promise<AudioOutputInfo | null> {
  return invoke<AudioOutputInfo | null>('audio_get_output_info')
}

export async function listenAudioStateChanged(
  handler: (state: AudioPlaybackState) => void,
): Promise<UnlistenFn> {
  return listen<AudioPlaybackState>(AUDIO_STATE_CHANGED_EVENT, (event) => {
    handler(event.payload)
  })
}

export async function listenAudioTrackDetailsChanged(
  handler: (details: AudioTrackDetailsChanged) => void,
): Promise<UnlistenFn> {
  return listen<AudioTrackDetailsChanged>(AUDIO_TRACK_DETAILS_CHANGED_EVENT, (event) => {
    handler(event.payload)
  })
}

export function isAudioCommandError(error: unknown): error is AudioCommandError {
  if (!error || typeof error !== 'object') return false

  const candidate = error as Partial<AudioCommandError>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}
