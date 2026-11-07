import type { RecentlyPlayedEntry } from './recentlyPlayed'
import type { AllSongsItem } from './playerUiViewModel'
import type { AudioFolderPlaylist, AudioFolderTrackRef } from '../services/audioCommands'
import type { MostPlayedEntry } from './mostPlayed'
import type { TrackRating } from './playerTypes'
import { compareByQuickIndex } from './quickIndex'

export const STREAMS_LAYOUT_STORAGE_KEY = 'spmusic.streams.layout-level.v1'
export const defaultStreamsLevel = () => 0
export const STREAMS_SCOPE = 'streams\u0000streams:library'
export const STREAM_SORTS = [
  ['name', '名称'], ['rating', '评分'], ['play-count', '播放次数'],
  ['last-played', '最近播放'], ['shuffle', '随机'], ['created', '添加时间'],
] as const
export type StreamSort = typeof STREAM_SORTS[number][0]
export function validateStreamAddress(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export function validStreamsPlaylist(value: AudioFolderPlaylist): boolean {
  return Boolean(value && value.sourceKind === 'streams' && value.sourcePath === 'streams:library'
    && Array.isArray(value.tracks) && value.tracks.every(item => typeof item.id === 'string'
      && typeof item.fileName === 'string' && typeof item.available === 'boolean'
      && typeof item.sourcePath === 'string' && validateStreamAddress(item.sourcePath)))
}
export function sortStreamSongs(songs: readonly AllSongsItem[], sort: StreamSort,
  counts: readonly MostPlayedEntry[], feedback: Readonly<Record<string, TrackRating>>,
  descriptors: readonly AudioFolderTrackRef[], shuffleKeys: readonly string[], recents: readonly RecentlyPlayedEntry[] = []): AllSongsItem[] {
  const statistics = new Map(counts.map(item => [item.sourcePath, item]))
  const recentTimes = new Map(recents.map(item => [item.sourcePath, item.lastPlayedAt]))
  const created = new Map(descriptors.map(item => [item.id, item.createdAtMs ?? 0]))
  const shuffle = new Map(shuffleKeys.map((key, index) => [key, index]))
  const rating = (id: string) => feedback[id] ?? 0
  return [...songs].sort((a, b) => {
    const delta = sort === 'rating' ? rating(b.trackId) - rating(a.trackId)
      : sort === 'play-count' ? (statistics.get(b.sourcePath)?.playCount ?? 0) - (statistics.get(a.sourcePath)?.playCount ?? 0)
      : sort === 'last-played' ? (recentTimes.get(b.sourcePath) ?? 0) - (recentTimes.get(a.sourcePath) ?? 0)
      : sort === 'created' ? (created.get(b.trackId) ?? 0) - (created.get(a.trackId) ?? 0)
      : sort === 'shuffle' ? (shuffle.get(a.key) ?? Infinity) - (shuffle.get(b.key) ?? Infinity) : 0
    return delta || compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key)
  })
}

export { isStreamSource, streamTrackTitle } from './playlistTrackSummary'
