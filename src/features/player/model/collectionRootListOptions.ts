import type { AlbumEntry } from './albumLibrary'
import type { ContributorCategoryId } from './artistLibrary'
import { readGenreSort } from './genreLibrary'
import { compareByQuickIndex } from './quickIndex'
import { readYearSort } from './yearLibrary'

type RootCategory = 'album' | 'genre' | 'year' | ContributorCategoryId
type RootSort = 'name' | 'artist' | 'year' | 'added' | 'count'

type RootListOptions = Readonly<{
  sort: RootSort
  descending: boolean
  titleOnly: boolean
}>

const byName = { value: 'name', label: '根据名称' } as const
const byYear = { value: 'year', label: '根据年份' } as const
const byAdded = { value: 'added', label: '根据添加到媒体库的日期' } as const
const byCount = { value: 'count', label: '根据歌曲数量' } as const
const nameAddedCount = [byName, byAdded, byCount]

export const COLLECTION_ROOT_SORT_OPTIONS: Record<RootCategory, readonly { value: RootSort; label: string }[]> = {
  album: [byName, { value: 'artist', label: '根据艺术家' }, byYear, byAdded, byCount],
  artist: nameAddedCount,
  'album-artist': [byName, byAdded],
  composer: nameAddedCount,
  genre: nameAddedCount,
  year: [byYear, byAdded, byCount],
}

export function readCollectionRootListOptions(category: RootCategory): RootListOptions {
  const fallback: RootListOptions = { sort: category === 'year' ? 'year' : 'name', descending: false, titleOnly: false }
  try {
    const saved = JSON.parse(localStorage.getItem(`spmusic.${category}-root.list-options.v1`) ?? 'null')
    const sort = COLLECTION_ROOT_SORT_OPTIONS[category].find(option => option.value === saved?.sort)
    if (sort) return { sort: sort.value, descending: saved.descending === true, titleOnly: saved.titleOnly === true }
  } catch { /* Storage is optional. */ }
  if (category === 'genre') {
    const saved = readGenreSort('root')
    return { ...fallback, sort: saved.field === 'count' ? 'count' : 'name', descending: saved.direction === 'desc' }
  }
  if (category === 'year') {
    const saved = readYearSort('root')
    return saved.field === 'count'
      ? { ...fallback, sort: 'count', descending: saved.direction === 'desc' }
      : { ...fallback, descending: saved.direction === 'asc' }
  }
  return fallback
}

export function writeCollectionRootListOptions(category: RootCategory, options: RootListOptions) {
  try { localStorage.setItem(`spmusic.${category}-root.list-options.v1`, JSON.stringify(options)) } catch { /* Storage is optional. */ }
}

function firstAddedAt(entry: AlbumEntry): number | undefined {
  let earliest: number | undefined
  for (const item of entry.songs) {
    const time = item.libraryAddedAtMs
    if (typeof time === 'number' && Number.isFinite(time) && time >= 0 && (earliest === undefined || time < earliest)) earliest = time
  }
  return earliest
}

export function sortCollectionRoot(entries: readonly AlbumEntry[], category: RootCategory, { sort, descending }: RootListOptions): readonly AlbumEntry[] {
  // Group builders already produce the default order.
  if (!descending && sort === (category === 'year' ? 'year' : 'name')) return entries
  const naturalDirection = category === 'year' && sort === 'year' ? -1 : 1
  const direction = descending ? -naturalDirection : naturalDirection
  const addedTimes = sort === 'added' ? new Map(entries.map(entry => [entry.key, firstAddedAt(entry)])) : undefined
  const value = (entry: AlbumEntry) => sort === 'artist' ? entry.artist
    : sort === 'year' ? entry.year : sort === 'count' ? entry.songs.length : sort === 'added' ? addedTimes?.get(entry.key) : entry.name
  return [...entries].sort((a, b) => {
    const left = value(a), right = value(b)
    if (left == null && right != null) return 1
    if (right == null && left != null) return -1
    const primary = left == null || right == null ? 0 : typeof left === 'number' && typeof right === 'number'
      ? left - right : compareByQuickIndex(String(left), String(right))
    return primary * direction || compareByQuickIndex(a.name, b.name) || compareByQuickIndex(a.artist, b.artist) || a.key.localeCompare(b.key)
  })
}
