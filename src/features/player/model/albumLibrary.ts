import { parentFolder } from './folderHierarchy'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type AlbumEntry = Readonly<{
  key: string
  name: string
  artist: string
  songs: readonly AllSongsItem[]
  coverSong?: AllSongsItem
}>

/** Album identity uses raw tags, never the display fallback "本地音频". */
export function albumKey(song: AllSongsItem): string | null {
  const name = song.track.libraryAlbumName
  if (name === undefined) return null
  const artist = song.track.albumArtist?.trim()
  return JSON.stringify([name?.trim() || null,
    name?.trim() && artist ? ['artist', artist] : ['directory', parentFolder(song.sourcePath)]])
}

export function albumEntries(songs: readonly AllSongsItem[]): AlbumEntry[] {
  const groups = new Map<string, AllSongsItem[]>()
  const seen = new Set<string>()
  for (const song of songs) {
    const key = albumKey(song)
    if (key === null || seen.has(song.key)) continue
    seen.add(song.key)
    const group = groups.get(key) ?? []
    group.push(song)
    groups.set(key, group)
  }
  return [...groups].map(([key, items]) => {
    const artists = new Set(items.flatMap(item => item.track.artist.split('/'))
      .map(value => value.trim()).filter(value => value && value !== '本地音频'))
    const artist = items[0].track.albumArtist?.trim() || (artists.size ? [...artists].join('/') : '未知艺术家')
    return { key, name: items[0].track.libraryAlbumName?.trim() || '未知专辑', artist,
      songs: [...items].sort((a, b) => compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key)),
      coverSong: items.find(item => item.available) ?? items[0] }
  }).sort((a, b) => compareByQuickIndex(a.name, b.name) || compareByQuickIndex(a.artist, b.artist) || a.key.localeCompare(b.key))
}
