import { albumEntries, splitArtists, type AlbumEntry } from './albumLibrary'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type ArtistLocation = null
  | { artistKey: string; view: 'albums' | 'songs' }
  | { artistKey: string; view: 'album'; albumKey: string }

export type ArtistEntry = AlbumEntry

export { splitArtists } from './albumLibrary'

export function uniqueArtistSongs(songs: readonly AllSongsItem[]): AllSongsItem[] {
  const seen = new Set<string>()
  return songs.filter(song => { if (seen.has(song.key)) return false; seen.add(song.key); return true })
}

export function artistEntries(songs: readonly AllSongsItem[]): ArtistEntry[] {
  const groups = new Map<string, { name: string; songs: AllSongsItem[] }>()
  for (const song of uniqueArtistSongs(songs)) {
    const raw = song.track.libraryArtistName
    if (raw === undefined) continue
    const names = raw ? splitArtists(raw) : []
    for (const name of names.length ? names : [null]) {
      const key = JSON.stringify(['artist', name])
      const group = groups.get(key) ?? { name: name ?? '未知艺术家', songs: [] }
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

export function artistRoute(location: ArtistLocation): string {
  return location ? `artist:${JSON.stringify(location)}` : 'category:artist'
}
