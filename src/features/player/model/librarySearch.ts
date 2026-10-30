import { albumEntries } from './albumLibrary'
import { artistEntries } from './artistLibrary'
import { flatFolderEntries } from './folderHierarchy'
import { normalizeAudioSourcePath } from './playlistTrackSummary'
import type { AllSongsItem, PlaylistLibraryViewModel } from './playerUiViewModel'

export const SEARCH_CATEGORIES = [
  ['album', '专辑'], ['artist', '艺术家'], ['album-artist', '专辑艺术家'], ['folder', '文件夹'],
  ['genre', '流派'], ['year', '年份'], ['composer', '作曲家'], ['playlists', '播放列表'], ['songs', '所有歌曲'], ['streams', '流'],
] as const
export type SearchCategory = typeof SEARCH_CATEGORIES[number][0]
export type SearchCollection = { key: string; name: string; subtitle: string; songs: readonly AllSongsItem[]; scope?: string; path?: string }
export type SearchSection = { category: SearchCategory; label: string; songs: readonly AllSongsItem[]; collections: readonly SearchCollection[] }

export function uniqueSearchSongs(songs: readonly AllSongsItem[]): AllSongsItem[] {
  const seen = new Set<string>()
  return songs.filter(song => { const key = normalizeAudioSourcePath(song.sourcePath); if (seen.has(key)) return false; seen.add(key); return true })
}

export function searchLibrary(library: PlaylistLibraryViewModel | undefined, query: string, selected: readonly SearchCategory[]): SearchSection[] {
  const songs = uniqueSearchSongs(library?.allSongs ?? [])
  const needle = query.trim().toLocaleLowerCase()
  const matches = (...text: (string | number | null | undefined)[]) => text.some(value => String(value ?? '').toLocaleLowerCase().includes(needle))
  const groups = (field: 'libraryGenreName' | 'libraryYear', label: string): SearchCollection[] => {
    const map = new Map<string, AllSongsItem[]>()
    for (const song of songs) {
      const value = song.track[field]
      if (value === undefined) continue
      const name = value == null || value === '' ? `未知${label}` : String(value)
      const members = map.get(name) ?? []; members.push(song); map.set(name, members)
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true })).map(([name, members]) => ({ key: name, name, subtitle: '', songs: members }))
  }
  return SEARCH_CATEGORIES.filter(([id]) => selected.includes(id)).map(([category, label]) => {
    let collections: SearchCollection[] = []
    if (category === 'album') collections = albumEntries(songs).map(item => ({ ...item, subtitle: item.artist }))
    if (category === 'artist' || category === 'album-artist' || category === 'composer') collections = artistEntries(songs, category).map(item => ({ ...item, subtitle: '' }))
    if (category === 'folder') collections = flatFolderEntries(songs).map(item => ({ key: item.path, path: item.path, name: item.name, subtitle: item.parentName, songs: item.songs }))
    if (category === 'genre' || category === 'year') collections = groups(category === 'genre' ? 'libraryGenreName' : 'libraryYear', label)
    if (category === 'playlists') collections = (library?.items ?? []).filter(item => item.sourceKind !== 'folder').map(item => ({ key: item.scope, scope: item.scope, name: item.name, subtitle: '', songs: uniqueSearchSongs((library?.allSongs ?? []).filter(song => song.scope === item.scope)) }))
    return { category, label, collections: collections.filter(item => matches(item.name, item.subtitle)),
      songs: category === 'songs' ? songs.filter(item => matches(item.track.title, item.track.artist, item.track.album, item.track.libraryComposerName, item.track.libraryGenreName, item.track.libraryYear)) : [] }
  })
}
