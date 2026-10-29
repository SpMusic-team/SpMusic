import { albumEntries, splitArtists, type AlbumEntry } from './albumLibrary'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type ArtistLocation = null
  | { artistKey: string; view: 'albums' | 'songs' }
  | { artistKey: string; view: 'album'; albumKey: string }

export type ArtistEntry = AlbumEntry

export type ContributorCategoryId = 'artist' | 'album-artist' | 'composer'

export const CONTRIBUTOR_LABELS: Record<ContributorCategoryId, string> = {
  artist: '艺术家',
  'album-artist': '专辑艺术家',
  composer: '作曲家',
}

export { splitArtists } from './albumLibrary'

export function uniqueArtistSongs(songs: readonly AllSongsItem[]): AllSongsItem[] {
  const seen = new Set<string>()
  return songs.filter(song => { if (seen.has(song.key)) return false; seen.add(song.key); return true })
}

export function artistEntries(songs: readonly AllSongsItem[], categoryId: ContributorCategoryId = 'artist'): ArtistEntry[] {
  const groups = new Map<string, { name: string; songs: AllSongsItem[] }>()
  for (const song of uniqueArtistSongs(songs)) {
    const raw = categoryId === 'artist' ? song.track.libraryArtistName
      : categoryId === 'album-artist' ? song.track.albumArtist : song.track.libraryComposerName
    if (raw === undefined) continue
    const names = raw ? splitArtists(raw) : []
    for (const name of names.length ? names : [null]) {
      const key = JSON.stringify([categoryId, name])
      const group = groups.get(key) ?? { name: name ?? `未知${CONTRIBUTOR_LABELS[categoryId]}`, songs: [] }
      group.songs.push(song)
      groups.set(key, group)
    }
  }
  return [...groups].map(([key, group]) => ({ key, name: group.name, artist: '', year: null,
    songs: group.songs.sort((a, b) => compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key)),
    coverSong: group.songs.find(song => song.available) ?? group.songs[0],
  })).sort((a, b) => compareByQuickIndex(a.name, b.name) || a.key.localeCompare(b.key))
}

export function artistAlbums(artist: ArtistEntry | undefined): AlbumEntry[] {
  return artist ? albumEntries(artist.songs) : []
}

export function artistRoute(location: ArtistLocation, categoryId: ContributorCategoryId = 'artist'): string {
  return location ? `${categoryId}:${JSON.stringify(location)}` : `category:${categoryId}`
}
