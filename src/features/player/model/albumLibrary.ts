import { parentFolder } from './folderHierarchy'
import { compareByQuickIndex } from './quickIndex'
import type { AllSongsItem } from './playerUiViewModel'

export type AlbumEntry = Readonly<{
  key: string
  name: string
  artist: string
  year: number | null
  songs: readonly AllSongsItem[]
  coverSong?: AllSongsItem
}>

/** Only the approved slash delimiter is parsed. Preserve known names containing it. */
export function splitArtists(value: string): string[] {
  const parts = value.split('/').map(part => part.trim())
  const names: string[] = []
  for (let index = 0; index < parts.length; index++) {
    const pair = `${parts[index]}/${parts[index + 1]}`
    if (pair === 'AC/DC' || pair === '+/-') { names.push(pair); index++ }
    else names.push(parts[index])
  }
  return [...new Set(names.map(name => name.trim()).filter(Boolean))]
}

function creditNames(song: AllSongsItem): string[] {
  return splitArtists(song.track.albumArtist?.trim() || song.track.libraryArtistName || '')
}

/** Named albums use final identity; unknown albums return a directory base key.
 * albumEntries refines unknown keys after checking the complete directory group. */
export function albumKey(song: AllSongsItem): string | null {
  const name = song.track.libraryAlbumName
  if (name === undefined) return null
  const names = creditNames(song)
  return name?.trim() ? JSON.stringify(['album', name.trim(), names.length ? names.sort() : null])
    : JSON.stringify([null, ['directory', parentFolder(song.sourcePath)]])
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
  const finalGroups = [...groups].flatMap(([key, items]): [string, AllSongsItem[]][] => {
    if (items[0].track.libraryAlbumName?.trim() || items.some(item => item.track.albumArtist?.trim())) return [[key, items]]
    const credits = new Map<string, AllSongsItem[]>()
    for (const item of items) {
      const names = creditNames(item)
      const refinedKey = JSON.stringify(['album', key, names.length ? names.sort() : null])
      const members = credits.get(refinedKey) ?? []
      members.push(item)
      credits.set(refinedKey, members)
    }
    return [...credits]
  })
  return finalGroups.map(([key, items]) => {
    const artists = items[0].track.libraryAlbumName?.trim() ? creditNames(items[0])
      : [...new Set(items.flatMap(creditNames))]
    const artist = items[0].track.libraryAlbumName?.trim() ? artists.join('/') || '未知艺术家'
      : items[0].track.albumArtist?.trim() || artists.join('/') || '未知艺术家'
    const years = items.map(item => item.track.libraryYear).filter((year): year is number =>
      typeof year === 'number' && Number.isSafeInteger(year) && year > 0 && year <= 0xffff_ffff)
    const year = years.reduce<number | null>((earliest, value) => earliest === null || value < earliest ? value : earliest, null)
    return { key, name: items[0].track.libraryAlbumName?.trim() || '未知专辑', artist, year,
      songs: [...items].sort((a, b) => compareByQuickIndex(a.track.title, b.track.title) || a.key.localeCompare(b.key)),
      coverSong: items.find(item => item.available) ?? items[0] }
  }).sort((a, b) => compareByQuickIndex(a.name, b.name) || compareByQuickIndex(a.artist, b.artist) || a.key.localeCompare(b.key))
}
