import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

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
}

export type AudioCoverArt = {
  mimeType: string
  filePath: string | null
  dataUrl: string | null
  byteLen: number
}

export type AudioLoadCoverPixelsInput = {
  filePath: string
  maxEdge: 1024 | 1536 | 2048 | 3072
  requestId: number
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

export type AudioPlaybackState = {
  phase: AudioPlaybackPhase
  generation: number | null
  currentTrackId: string | null
  positionMs: number
  durationMs: number | null
  volume: number
  error: AudioCommandError | null
  transportTransition: AudioTransportTransition | null
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
  maxEdge: AudioLoadCoverPixelsInput['maxEdge'],
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

export type WebviewUiBurstSettledInput = {
  activityUnits: number
}

export async function noteWebviewUiBurstSettled(
  input: WebviewUiBurstSettledInput,
): Promise<void> {
  return invoke<void>('webview_note_ui_burst_settled', input)
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
