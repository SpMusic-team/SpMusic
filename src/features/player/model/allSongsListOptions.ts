import type { AllSongsItem } from './playerUiViewModel'
import type { TrackRating } from './playerTypes'
import { compareByQuickIndex } from './quickIndex'
import { normalizeAudioSourcePath } from './playlistTrackSummary'

export const ALL_SONGS_SORT_OPTIONS = [
  { value: 'disc', label: '根据碟片和音轨号', unavailable: '尚无碟片和音轨号数据' },
  { value: 'title', label: '根据标题' },
  { value: 'filename', label: '根据文件名' },
  { value: 'path', label: '根据路径' },
  { value: 'artist', label: '根据艺术家' },
  { value: 'album', label: '根据专辑' },
  { value: 'year', label: '根据年份' },
  { value: 'year-album', label: '根据年份/专辑' },
  { value: 'added', label: '根据添加到媒体库的日期', unavailable: '尚无媒体库加入时间数据' },
  { value: 'modified', label: '根据添加/修改日期', unavailable: '尚无文件修改时间数据', note: '文件系统日期/时间' },
  { value: 'rating', label: '根据星级' },
  { value: 'duration', label: '根据持续时间' },
  { value: 'last-played', label: '根据最后播放的时间', unavailable: '尚无最后播放时间数据', note: '以该排序方式播放时，播放时间不会更新' },
  { value: 'play-count', label: '根据播放次数', note: '排序使用选择此方式时的播放次数；播放中保持顺序' },
  { value: 'random', label: '根据随机顺序' },
] as const
export type AllSongsSort = typeof ALL_SONGS_SORT_OPTIONS[number]['value']
export const ALL_SONGS_VIEW_OPTIONS = [
  '网格-紧凑一行', '紧凑单行', '单行', '列表-不显示图像', '列表-极小',
  '列表-小', '列表', '网格-极小', '网格-小', '网格',
] as const

function randomRank(key: string, seed: number) {
  let hash = seed | 0
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
  return hash >>> 0
}

export function sortAllSongs(songs: readonly AllSongsItem[], sort: AllSongsSort, descending: boolean,
  ratings: Readonly<Record<string, TrackRating>> = {}, counts: ReadonlyMap<string, number> = new Map(), seed = 1) {
  const text = (item: AllSongsItem) => sort === 'filename' ? item.sourcePath.split(/[\\/]/).pop() ?? ''
    : sort === 'path' ? item.sourcePath : sort === 'artist' ? item.track.artist : sort === 'album' ? item.track.album : item.track.title
  return [...songs].sort((left, right) => {
    let result: number
    if (sort === 'year' || sort === 'year-album') {
      const a = left.track.libraryYear, b = right.track.libraryYear
      if (a == null || b == null) result = a == null ? b == null ? 0 : 1 : -1
      else result = a - b
      if (!result && sort === 'year-album') result = compareByQuickIndex(left.track.album, right.track.album)
    } else if (sort === 'duration') result = (left.track.durationSeconds ?? 0) - (right.track.durationSeconds ?? 0)
    else if (sort === 'rating') result = (ratings[left.trackId] ?? 0) - (ratings[right.trackId] ?? 0)
    else if (sort === 'play-count') result = (counts.get(normalizeAudioSourcePath(left.sourcePath)) ?? 0) - (counts.get(normalizeAudioSourcePath(right.sourcePath)) ?? 0)
    else if (sort === 'random') result = randomRank(left.key, seed) - randomRank(right.key, seed)
    else result = compareByQuickIndex(text(left), text(right))
    return (result || compareByQuickIndex(left.track.title, right.track.title) || left.key.localeCompare(right.key)) * (descending ? -1 : 1)
  })
}
