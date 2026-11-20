import { albumEntries, type AlbumEntry } from './albumLibrary'
import { uniqueArtistSongs } from './artistLibrary'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type GenreLocation = null
  | { genreKey: string; view: 'albums' | 'songs' }
  | { genreKey: string; view: 'album'; albumKey: string }
export type GenreEntry = AlbumEntry
export type GenreSortScope = 'root' | 'albums' | 'songs' | 'album-tracks'
export type GenreSort = { field: string; direction: 'asc' | 'desc' }
const SONG_FIELDS = [{ value: 'title', label: '歌曲名称' }, { value: 'artist', label: '艺术家' }, { value: 'album', label: '专辑' }, { value: 'year', label: '年份' }, { value: 'duration', label: '时长' }] as const
export const GENRE_SORT_FIELDS: Record<GenreSortScope, readonly { value: string; label: string }[]> = {
  root: [{ value: 'name', label: '流派名称' }, { value: 'count', label: '歌曲数' }],
  albums: [{ value: 'name', label: '专辑名称' }, { value: 'artist', label: '专辑作者' }, { value: 'year', label: '年份' }, { value: 'count', label: '歌曲数' }],
  songs: SONG_FIELDS,
  'album-tracks': SONG_FIELDS,
}

/** Initial SpMusic delimiters; a single slash remains part of a genre name. */
export function splitGenres(value: string): string[] {
  return [...new Set(value.split(/;|；|\/\/|\$/u).map(name => name.trim()).filter(Boolean))]
}
export function genreEntries(songs: readonly AllSongsItem[]): GenreEntry[] {
  const groups = new Map<string, { name: string; songs: AllSongsItem[] }>()
  for (const song of uniqueArtistSongs(songs)) {
    const raw = song.track.libraryGenreName
    if (raw === undefined) continue
    const names = raw ? splitGenres(raw) : []
    for (const name of names.length ? names : [null]) {
      const key = JSON.stringify(['genre', name])
      const group = groups.get(key) ?? { name: name ?? '未知流派', songs: [] }
      group.songs.push(song)
      groups.set(key, group)
    }
  }
  return sortGenreEntries([...groups].map(([key, group]) => ({ key, name: group.name, artist: '', year: null,
    songs: sortGenreSongs(group.songs, { field: 'title', direction: 'asc' }),
    coverSong: group.songs.find(song => song.available) ?? group.songs[0] })), { field: 'name', direction: 'asc' })
}
export function genreAlbums(genre: GenreEntry | undefined): AlbumEntry[] { return genre ? albumEntries(genre.songs) : [] }
export function genreRoute(location: GenreLocation): string { return location ? `genre:${JSON.stringify(location)}` : 'category:genre' }
export function readGenreSort(scope: GenreSortScope): GenreSort {
  const fallback: GenreSort = { field: scope === 'root' || scope === 'albums' ? 'name' : 'title', direction: 'asc' }
  try {
    const value = JSON.parse(localStorage.getItem(`spmusic.genre-${scope}.sort.v1`) ?? 'null')
    return value && GENRE_SORT_FIELDS[scope].some(field => field.value === value.field) && ['asc', 'desc'].includes(value.direction) ? { field: value.field, direction: value.direction } : fallback
  } catch { return fallback }
}
export function writeGenreSort(scope: GenreSortScope, sort: GenreSort): void {
  if (!GENRE_SORT_FIELDS[scope].some(field => field.value === sort.field) || !['asc', 'desc'].includes(sort.direction)) return
  try { localStorage.setItem(`spmusic.genre-${scope}.sort.v1`, JSON.stringify(sort)) } catch { /* Storage is optional. */ }
}
function compareValue(a: string | number | null | undefined, b: string | number | null | undefined, direction: GenreSort['direction']): number {
  if (a == null || b == null) return a == null ? b == null ? 0 : 1 : -1
  return (typeof a === 'number' && typeof b === 'number' ? a - b : compareByQuickIndex(String(a), String(b))) * (direction === 'desc' ? -1 : 1)
}
export function sortGenreEntries(entries: readonly GenreEntry[], sort: GenreSort): GenreEntry[] { return sortGenreAlbums(entries, sort) }
export function sortGenreAlbums(entries: readonly AlbumEntry[], sort: GenreSort): AlbumEntry[] {
  const value = (entry: AlbumEntry) => sort.field === 'count' ? entry.songs.length : sort.field === 'year' ? entry.year : sort.field === 'artist' ? entry.artist : entry.name
  return [...entries].sort((a, b) => compareValue(value(a), value(b), sort.direction) || compareByQuickIndex(a.name, b.name) || a.key.localeCompare(b.key))
}
export function sortGenreSongs(songs: readonly AllSongsItem[], sort: GenreSort): AllSongsItem[] {
  const value = (item: AllSongsItem) => sort.field === 'duration' ? item.track.durationSeconds : sort.field === 'year' ? item.track.libraryYear : sort.field === 'artist' ? item.track.artist : sort.field === 'album' ? item.track.album : item.track.title
  return [...songs].sort((a, b) => compareValue(value(a), value(b), sort.direction) || compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key))
}
