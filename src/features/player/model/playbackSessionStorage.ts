import type { AudioFolderPlaylist } from '@/features/player/services/audioCommands'
import { isPlaybackQueueOrigin, type PlaybackQueuePlaylist } from './playbackQueue.ts'

const STORAGE_KEY = 'spmusic.player.session.v1'

export type SavedPlaybackSession = {
  version: 1
  sourcePath: string
  playlist: Pick<AudioFolderPlaylist, 'sourceKind' | 'sourcePath'> & {
    customPlaylist?: AudioFolderPlaylist | PlaybackQueuePlaylist
    folderMode?: 'library' | 'file'
  }
  positionMs: number
  wasPlaying: boolean
  wasPaused: boolean
  queueOpen: boolean
  volume: number
}

export function readPlaybackSession(): SavedPlaybackSession | null {
  if (typeof window === 'undefined') return null
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const session = value as Partial<SavedPlaybackSession>
    const playlist = session.playlist
    if (session.version !== 1 || typeof session.sourcePath !== 'string' || !session.sourcePath
      || !playlist || !['folder', 'm3u8', 'custom'].includes(playlist.sourceKind ?? '')
      || typeof playlist.sourcePath !== 'string' || !playlist.sourcePath
      || !Number.isFinite(session.positionMs) || (session.positionMs ?? -1) < 0
      || typeof session.wasPlaying !== 'boolean' || typeof session.wasPaused !== 'boolean'
      || (session.wasPlaying && session.wasPaused) || typeof session.queueOpen !== 'boolean'
      || !Number.isFinite(session.volume) || (session.volume ?? -1) < 0 || (session.volume ?? 101) > 100) return null
    if (playlist.sourceKind === 'custom') {
      const custom = playlist.customPlaylist
      if (!custom || custom.sourceKind !== 'custom' || custom.sourcePath !== playlist.sourcePath
        || !Array.isArray(custom.tracks) || custom.tracks.some((track) => !track
          || typeof track.id !== 'string' || typeof track.sourcePath !== 'string'
          || typeof track.fileName !== 'string' || typeof track.available !== 'boolean')) return null
      if ('playbackQueue' in custom && (!isPlaybackQueueOrigin(custom.playbackQueue)
        || !custom.sourcePath.startsWith('queue:'))) return null
      if (custom.sourcePath.startsWith('queue:') && !('playbackQueue' in custom)) return null
    }
    if (playlist.folderMode !== undefined && (playlist.sourceKind !== 'folder'
      || !['library', 'file'].includes(playlist.folderMode))) return null
    return session as SavedPlaybackSession
  } catch {
    return null
  }
}

export function persistPlaybackSession(session: SavedPlaybackSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Playback must remain usable when local storage is unavailable or full.
  }
}

export function clearPlaybackSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // An unavailable store is already equivalent to an empty saved session.
  }
}
