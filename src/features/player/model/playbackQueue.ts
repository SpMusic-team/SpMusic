import type { AudioFolderPlaylist } from '@/features/player/services/audioCommands'

export type PlaybackQueueEntry = Readonly<{ scope: string; trackId: string }>

export type PlaybackQueueOrigin = Readonly<{
  kind: 'all-songs' | 'recent-played' | 'recent-added' | 'long-tracks' | 'playlist'
  sourceScope?: string
  // Custom lists have no external registry to reload after an app restart.
  // Retain their complete source descriptors independently of a filtered queue.
  sourcePlaylist?: AudioFolderPlaylist
}>

export type PlaybackQueueSelection = PlaybackQueueOrigin & Readonly<{
  entries: readonly PlaybackQueueEntry[]
}>

// A playback snapshot is an internal descriptor, never a user-created playlist.
// Its unique scope also fences cached previews when the same source is selected again.
export type PlaybackQueuePlaylist = AudioFolderPlaylist & {
  playbackQueue: PlaybackQueueOrigin
}

export function playbackQueueOrigin(playlist: AudioFolderPlaylist | null | undefined): PlaybackQueueOrigin | undefined {
  return (playlist as Partial<PlaybackQueuePlaylist> | null | undefined)?.playbackQueue
}

export function isPlaybackQueueOrigin(value: unknown): value is PlaybackQueueOrigin {
  if (!value || typeof value !== 'object') return false
  const origin = value as Partial<PlaybackQueueOrigin>
  if (origin.kind === 'all-songs' || origin.kind === 'recent-played' || origin.kind === 'recent-added' || origin.kind === 'long-tracks') return origin.sourceScope === undefined && origin.sourcePlaylist === undefined
  if (origin.kind !== 'playlist' || typeof origin.sourceScope !== 'string' || !origin.sourceScope) return false
  const source = origin.sourcePlaylist
  return source === undefined || Boolean(source && source.sourceKind === 'custom'
    && typeof source.sourcePath === 'string' && source.sourcePath.startsWith('custom:')
    && origin.sourceScope === `custom\u0000${source.sourcePath.replaceAll('\\', '/')}`
    && typeof source.sourceName === 'string' && typeof source.directoryPath === 'string'
    && typeof source.directoryName === 'string' && Number.isInteger(source.selectedIndex)
    && Array.isArray(source.tracks) && !source.tracks.some((track) => !track
      || typeof track.id !== 'string' || typeof track.sourcePath !== 'string'
      || typeof track.fileName !== 'string' || typeof track.available !== 'boolean')
    && !('playbackQueue' in source))
}
