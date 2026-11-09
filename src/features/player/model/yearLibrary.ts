import { albumEntries, type AlbumEntry } from './albumLibrary'
import { uniqueArtistSongs } from './artistLibrary'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type YearLocation = null
  | { year: number | null; view: 'albums' | 'songs' }
  | { year: number | null; view: 'album'; albumKey: string }
export type YearEntry = AlbumEntry
export type YearSortScope = 'root' | 'songs' | 'albums' | 'album-tracks'
export type YearSort = { field: string; direction: 'asc' | 'desc' }
export const YEAR_SORT_FIELDS: Record<YearSortScope, readonly { value: string; label: string }[]> = {
  root: [{ value: 'year', label: '年份' }, { value: 'count', label: '歌曲数' }],
  albums: [{ value: 'name', label: '专辑名称' }, { value: 'artist', label: '专辑作者' }, { value: 'year', label: '年份' }, { value: 'count', label: '歌曲数' }],
  songs: [{ value: 'title', label: '歌曲名称' }, { value: 'artist', label: '艺术家' }, { value: 'album', label: '专辑' }, { value: 'year', label: '年份' }, { value: 'duration', label: '时长' }],
  'album-tracks': [{ value: 'title', label: '歌曲名称' }, { value: 'artist', label: '艺术家' }, { value: 'album', label: '专辑' }, { value: 'year', label: '年份' }, { value: 'duration', label: '时长' }],
}

export function normalizeYear(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff ? value : null
}
/** Keep the original tag untouched: only completed missing years inherit their
 * complete album's year. The final album member sets also preserve refined
 * identities for unnamed albums, which cannot be recovered from albumKey alone. */
export function yearEffectiveYears(songs: readonly AllSongsItem[], albums: readonly AlbumEntry[] = albumEntries(songs)): ReadonlyMap<string, number | null | undefined> {
  const albumYears = new Map<string, number | null>()
  for (const album of albums) for (const song of album.songs) albumYears.set(song.key, album.year)
  return new Map(uniqueArtistSongs(songs).map(song => {
    const rawYear = normalizeYear(song.track.libraryYear)
    return [song.key, rawYear === null ? albumYears.get(song.key) ?? null : rawYear]
  }))
}
export function yearEntries(songs: readonly AllSongsItem[], effectiveYears: ReadonlyMap<string, number | null | undefined> = yearEffectiveYears(songs)): YearEntry[] {
  const groups = new Map<number, AllSongsItem[]>()
  for (const song of uniqueArtistSongs(songs)) {
    const year = effectiveYears.get(song.key)
    if (year == null) continue
    const members = groups.get(year) ?? []; members.push(song); groups.set(year, members)
  }
  return sortYearEntries([...groups].map(([year, members]) => ({ key: JSON.stringify(['year', year]), name: String(year), artist: '', year,
    songs: sortYearSongs(members, { field: 'title', direction: 'asc' }), coverSong: members.find(item => item.available) ?? members[0] })), { field: 'year', direction: 'desc' })
}
export function yearAlbums(albums: readonly AlbumEntry[], year: number | null): AlbumEntry[] {
  return year === null ? [] : albums.filter(album => album.year === year)
}
export function yearRoute(location: YearLocation): string { return location ? `year:${JSON.stringify(location)}` : 'category:year' }
export function readYearSort(scope: YearSortScope): YearSort {
  const fallback: YearSort = scope === 'root' ? { field: 'year', direction: 'desc' } : { field: scope === 'albums' ? 'name' : 'title', direction: 'asc' }
  try {
    const value = JSON.parse(localStorage.getItem(`spmusic.year-${scope}.sort.v1`) ?? 'null')
    return value && YEAR_SORT_FIELDS[scope].some(field => field.value === value.field) && ['asc', 'desc'].includes(value.direction) ? { field: value.field, direction: value.direction } : fallback
  } catch { return fallback }
}
export function writeYearSort(scope: YearSortScope, sort: YearSort): void {
  if (!YEAR_SORT_FIELDS[scope].some(field => field.value === sort.field) || !['asc', 'desc'].includes(sort.direction)) return
  try { localStorage.setItem(`spmusic.year-${scope}.sort.v1`, JSON.stringify(sort)) } catch { /* Storage may be unavailable. */ }
}
function compareValue(left: string | number | null | undefined, right: string | number | null | undefined, direction: YearSort['direction']): number {
  if (left == null || right == null) return left == null ? right == null ? 0 : 1 : -1
  return (typeof left === 'number' && typeof right === 'number' ? left - right : compareByQuickIndex(String(left), String(right))) * (direction === 'desc' ? -1 : 1)
}
export function sortYearEntries(entries: readonly YearEntry[], sort: YearSort): YearEntry[] { return sortYearAlbums(entries, sort) }
export function sortYearAlbums(entries: readonly AlbumEntry[], sort: YearSort): AlbumEntry[] {
  const value = (entry: AlbumEntry) => sort.field === 'count' ? entry.songs.length : sort.field === 'year' ? entry.year : sort.field === 'artist' ? entry.artist : entry.name
  return [...entries].sort((a, b) => compareValue(value(a), value(b), sort.direction) || compareByQuickIndex(a.name, b.name) || a.key.localeCompare(b.key))
}
export function sortYearSongs(songs: readonly AllSongsItem[], sort: YearSort, effectiveYears?: ReadonlyMap<string, number | null | undefined>): AllSongsItem[] {
  const years = sort.field === 'year' ? effectiveYears ?? yearEffectiveYears(songs) : undefined
  const value = (item: AllSongsItem) => sort.field === 'duration' ? item.track.durationSeconds : sort.field === 'year' ? years?.get(item.key) : sort.field === 'artist' ? item.track.artist : sort.field === 'album' ? item.track.album : item.track.title
  return [...songs].sort((a, b) => compareValue(value(a), value(b), sort.direction) || compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key))
}
