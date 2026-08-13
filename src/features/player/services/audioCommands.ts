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
