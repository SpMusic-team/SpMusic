import { ALL_SONGS_SORT_OPTIONS, newAllSongsShuffleSeed, type AllSongsSort } from './allSongsListOptions'
import { ALL_SONGS_LAYOUT_STORAGE_KEY, defaultAllSongsLevel } from './playlistSongLayouts'
import { compareByQuickIndex } from './quickIndex'
import type { PlaylistLibraryItem } from './playerUiViewModel'
import type { StreamSort } from './streams'

export const ROOT_LIST_DEFAULT_LIMIT = 200

export const PLAYLIST_ROOT_SORTS = [
  { value: 'name', label: '根据名称' },
  { value: 'added', label: '根据添加到媒体库的日期' },
  { value: 'modified', label: '根据添加/修改日期' },
  { value: 'count', label: '根据歌曲数量' },
] as const

export const STREAM_ROOT_SORTS = [
  { value: 'name', label: '根据URL' },
  { value: 'created', label: '根据添加到媒体库的日期' },
  { value: 'rating', label: '根据星级' },
  { value: 'last-played', label: '根据最后播放的时间', note: '以该排序方式播放时，播放时间不会更新' },
  { value: 'play-count', label: '根据播放次数', note: '以该排序方式播放时，播放次数不会更新' },
  { value: 'shuffle', label: '根据随机顺序', note: '匹配实际随机播放顺序' },
] as const satisfies readonly { value: StreamSort; label: string; note?: string }[]

export type PlaylistRootSort = typeof PLAYLIST_ROOT_SORTS[number]['value']

export type SongRootListOptions = Readonly<{
  songSort: AllSongsSort | null
  playlistSort: PlaylistRootSort
  reverse: boolean
  titleOnly: boolean
  limit: number
  shuffleSeed: number
}>

function storageKey(category: string) {
  return `spmusic.${category}.root-list-options.v1`
}

export function readSongRootListOptions(category: string): SongRootListOptions {
  let stored: Partial<SongRootListOptions> | null = null
  try { stored = JSON.parse(localStorage.getItem(storageKey(category)) ?? 'null') } catch { /* Use defaults when storage is unavailable. */ }
  const songSort = stored?.songSort
  const playlistSort = stored?.playlistSort
  const limit = stored?.limit
  const shuffleSeed = stored?.shuffleSeed
  return {
    songSort: songSort && ALL_SONGS_SORT_OPTIONS.some(option => option.value === songSort) ? songSort : null,
    playlistSort: playlistSort && PLAYLIST_ROOT_SORTS.some(option => option.value === playlistSort) ? playlistSort : 'name',
    reverse: stored?.reverse === true,
    titleOnly: stored?.titleOnly === true,
    limit: limit === 200 || limit === 500 || limit === 1000 || limit === Number.MAX_SAFE_INTEGER ? limit : ROOT_LIST_DEFAULT_LIMIT,
    shuffleSeed: typeof shuffleSeed === 'number' && Number.isSafeInteger(shuffleSeed) && shuffleSeed >= 0 && shuffleSeed <= 0xffff_ffff ? shuffleSeed : newAllSongsShuffleSeed(),
  }
}

export function writeSongRootListOptions(category: string, options: SongRootListOptions) {
  try { localStorage.setItem(storageKey(category), JSON.stringify(options)) } catch { /* Retain session preferences. */ }
}

export function defaultSongRootLayout(category: string) {
  try {
    const previous = localStorage.getItem(ALL_SONGS_LAYOUT_STORAGE_KEY)
    if (previous !== null && /^[0-9]$/.test(previous)) return Number(previous)
  } catch { /* Use the category default. */ }
  return category === 'most-played' ? 0 : defaultAllSongsLevel()
}

export function sortPlaylistRootItems(items: readonly PlaylistLibraryItem[], sort: PlaylistRootSort, reverse: boolean) {
  const direction = reverse ? -1 : 1
  const name = (a: PlaylistLibraryItem, b: PlaylistLibraryItem) => compareByQuickIndex(a.name, b.name)
  function order(a: PlaylistLibraryItem, b: PlaylistLibraryItem) {
    if (sort === 'name') return name(a, b) * direction
    if (sort === 'count') return (a.trackCount - b.trackCount) * direction
    const left = sort === 'added' ? a.libraryAddedAtMs : a.fileModifiedAtMs
    const right = sort === 'added' ? b.libraryAddedAtMs : b.fileModifiedAtMs
    if (left == null || right == null) return Number(left == null) - Number(right == null)
    return (left - right) * direction
  }
  return [...items].sort((a, b) => order(a, b) || name(a, b) || a.scope.localeCompare(b.scope))
}
