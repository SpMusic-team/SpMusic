import type { AllSongsItem } from './playerUiViewModel'
import type { TrackRating } from './playerTypes'
import { compareByQuickIndex } from './quickIndex'
import { normalizeAudioSourcePath } from './playlistTrackSummary'

export const ALL_SONGS_SORT_OPTIONS = [
  { value: 'track', label: '根据音轨号' },
  { value: 'disc', label: '根据碟片和音轨号' },
  { value: 'title', label: '根据标题' },
  { value: 'filename', label: '根据文件名' },
  { value: 'path', label: '根据路径' },
  { value: 'artist', label: '根据艺术家' },
  { value: 'album', label: '根据专辑' },
  { value: 'year', label: '根据年份' },
  { value: 'year-album', label: '根据年份/专辑' },
  { value: 'added', label: '根据添加到媒体库的日期' },
  { value: 'modified', label: '根据添加/修改日期', note: '文件系统日期/时间' },
  { value: 'rating', label: '根据星级' },
  { value: 'duration', label: '根据持续时间' },
  { value: 'last-played', label: '根据最后播放的时间', note: '以该排序方式播放时，播放时间不会更新' },
  { value: 'play-count', label: '根据播放次数', note: '以该排序方式播放时，播放次数不会更新' },
  { value: 'random', label: '根据随机顺序', note: '匹配实际随机播放顺序' },
] as const
export type AllSongsSort = typeof ALL_SONGS_SORT_OPTIONS[number]['value']
export const ALL_SONGS_VIEW_OPTIONS = [
  '网格-紧凑一行', '紧凑单行', '单行', '列表-不显示图像', '列表-极小',
  '列表-小', '列表', '网格-极小', '网格-小', '网格',
] as const

type AllSongsOptions = Readonly<{
  sort: AllSongsSort
  reverse: boolean
  titleOnly: boolean
  shuffleSeed: number
}>

const OPTIONS_KEY = 'spmusic.all-songs.options.v1'
const LIBRARY_ADDED_TIMES_KEY = 'spmusic.library-added-times.v1'

export function newAllSongsShuffleSeed() {
  return Math.floor(Math.random() * 0x1_0000_0000)
}

export function readAllSongsOptions(): AllSongsOptions {
  const defaults = { sort: 'title', reverse: false, titleOnly: false, shuffleSeed: newAllSongsShuffleSeed() } as const
  try {
    const value = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null') as Partial<AllSongsOptions> | null
    if (value && ALL_SONGS_SORT_OPTIONS.some(option => option.value === value.sort)
      && typeof value.reverse === 'boolean' && typeof value.titleOnly === 'boolean'
      && typeof value.shuffleSeed === 'number' && Number.isSafeInteger(value.shuffleSeed)
      && value.shuffleSeed >= 0 && value.shuffleSeed <= 0xffff_ffff) return value as AllSongsOptions
  } catch { /* Use defaults when storage is unavailable. */ }
  return defaults
}

export function writeAllSongsOptions(options: AllSongsOptions) {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)) } catch { /* Retain session preferences. */ }
}

export function readLibraryAddedTimes(): ReadonlyMap<string, number> {
  const times = new Map<string, number>()
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(LIBRARY_ADDED_TIMES_KEY) ?? 'null')
    if (!Array.isArray(stored)) return times
    for (const entry of stored) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].trim()
        || typeof entry[1] !== 'number' || !Number.isSafeInteger(entry[1]) || entry[1] < 0) continue
      const path = normalizeAudioSourcePath(entry[0])
      times.set(path, Math.min(times.get(path) ?? Infinity, entry[1]))
    }
  } catch { /* Start a new ledger when storage is unavailable. */ }
  return times
}

export function writeLibraryAddedTimes(times: ReadonlyMap<string, number>) {
  try { localStorage.setItem(LIBRARY_ADDED_TIMES_KEY, JSON.stringify([...times])) } catch { /* Retain session timestamps. */ }
}

export function isAllSongsSingleLineLayout(level: number) {
  return level >= 7
}

function randomRank(key: string, seed: number) {
  let hash = seed | 0
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

type SortInputs = {
  ratings?: Readonly<Record<string, TrackRating>>
  counts?: ReadonlyMap<string, number>
  lastPlayedAt?: ReadonlyMap<string, number>
  shuffleSeed?: number
  shuffleOrder?: readonly string[]
}

const numericValue = (value: number | null | undefined, minimum = 1) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null

export function sortAllSongs(songs: readonly AllSongsItem[], sort: AllSongsSort, reverse: boolean, inputs: SortInputs = {}) {
  const direction = reverse ? -1 : 1
  const ascending = (left: number | null, right: number | null, sign = direction) => {
    // Keep missing metadata after known values in either direction.
    if (left === null || right === null) return Number(left === null) - Number(right === null)
    return (left - right) * sign
  }
  const text = (left: string, right: string) => compareByQuickIndex(left, right) * direction
  const trackNumber = (song: AllSongsItem) => numericValue(song.track.libraryTrackNumber)
  const discNumber = (song: AllSongsItem) => numericValue(song.track.libraryDiscNumber) ?? (trackNumber(song) === null ? null : 1)
  const year = (song: AllSongsItem) => numericValue(song.track.libraryYear)
  const modifiedAt = (song: AllSongsItem) => numericValue(song.fileModifiedAtMs, 0) ?? numericValue(song.fileCreatedAtMs, 0)
  const path = (song: AllSongsItem) => normalizeAudioSourcePath(song.sourcePath)
  const directory = (song: AllSongsItem) => { const value = path(song); return value.slice(0, Math.max(0, value.lastIndexOf('/'))) }
  const filename = (song: AllSongsItem) => { const value = path(song); return value.slice(value.lastIndexOf('/') + 1) }
  const shuffleOrder = new Map<string, number>(inputs.shuffleOrder?.map((trackId, index) => [trackId, index]))
  const ranks = sort === 'random' ? new Map(songs.map(song => [song.key, randomRank(song.key, inputs.shuffleSeed ?? 1)])) : null
  const compareTitle = (left: AllSongsItem, right: AllSongsItem) => compareByQuickIndex(left.track.title, right.track.title)

  function compare(left: AllSongsItem, right: AllSongsItem): number {
    switch (sort) {
      case 'track': return ascending(trackNumber(left), trackNumber(right)) || compareTitle(left, right) * direction
      case 'disc': return ascending(discNumber(left), discNumber(right)) || ascending(trackNumber(left), trackNumber(right)) || compareTitle(left, right) * direction
      case 'title': return compareTitle(left, right) * direction
      case 'filename': return text(filename(left), filename(right))
      case 'path': return text(directory(left), directory(right)) || text(filename(left), filename(right))
      case 'artist': return text(left.track.artist, right.track.artist) || text(left.track.album, right.track.album) || compareTitle(left, right) * direction
      case 'album': return text(left.track.album, right.track.album) || ascending(trackNumber(left), trackNumber(right)) || compareTitle(left, right) * direction
      case 'year': return ascending(year(left), year(right))
      case 'year-album': return ascending(year(left), year(right)) || text(left.track.album, right.track.album) || ascending(trackNumber(left), trackNumber(right)) || compareTitle(left, right) * direction
      case 'added': return ascending(numericValue(left.libraryAddedAtMs, 0), numericValue(right.libraryAddedAtMs, 0), -direction)
      case 'modified': return ascending(modifiedAt(left), modifiedAt(right), -direction)
      case 'rating': return ascending(inputs.ratings?.[left.trackId] ?? 0, inputs.ratings?.[right.trackId] ?? 0, -direction)
      case 'duration': return ascending(numericValue(left.track.durationSeconds, Number.EPSILON), numericValue(right.track.durationSeconds, Number.EPSILON), -direction) || compareTitle(left, right) * direction
      case 'last-played': return ascending(numericValue(inputs.lastPlayedAt?.get(path(left)), 0), numericValue(inputs.lastPlayedAt?.get(path(right)), 0), -direction)
      case 'play-count': return ascending(inputs.counts?.get(path(left)) ?? 0, inputs.counts?.get(path(right)) ?? 0, -direction)
      case 'random': return ascending(shuffleOrder.get(left.trackId) ?? null, shuffleOrder.get(right.trackId) ?? null)
        || ascending(ranks!.get(left.key)!, ranks!.get(right.key)!)
    }
  }

  return [...songs].sort((left, right) => compare(left, right) || compareTitle(left, right) || left.key.localeCompare(right.key))
}
