import { normalizeAudioSourcePath } from './playlistTrackSummary'
import type { AllSongsItem, PlaylistLibraryViewModel } from './playerUiViewModel'
import { folderSelectionPath, isDirectorySelected } from './folderSelection'

export function folderPath(path: string): string {
  const normalized = normalizeAudioSourcePath(path)
  return normalized.replace(/\/+$/, '') || '/'
}

export function parentFolder(path: string): string {
  const normalized = folderPath(path)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

export function folderName(path: string): string {
  const normalized = folderPath(path)
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized
}

export function insideFolder(path: string, directory: string): boolean {
  const root = folderPath(directory)
  const normalized = folderPath(path)
  return normalized === root || normalized.startsWith(root === '/' ? '/' : `${root}/`)
}

export type FolderHierarchyEntry = {
  path: string
  name: string
  parentName: string
  songs: readonly AllSongsItem[]
  status: 'loading' | 'ready' | 'error'
  error?: string
  complete: boolean
}

export function folderRootSongs(root: NonNullable<PlaylistLibraryViewModel['folderRoots']>[number] | undefined, songs: readonly AllSongsItem[]): readonly AllSongsItem[] {
  if (!root) return []
  if (!root.selection) return songs.filter(song => insideFolder(song.sourcePath, root.path))
  const base = folderSelectionPath(root.path)
  return songs.filter(song => {
    const path = folderSelectionPath(song.sourcePath)
    if (!path.startsWith(`${base}/`)) return false
    const relative = path.slice(base.length + 1)
    return !root.selection || isDirectorySelected(root.selection, relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '')
  })
}

export function folderEntries(roots: NonNullable<PlaylistLibraryViewModel['folderRoots']>, songs: readonly AllSongsItem[], location: PlaylistLibraryViewModel['folderLocation']): FolderHierarchyEntry[] {
  const root = roots.find(item => folderPath(item.path) === folderPath(location?.rootPath ?? ''))
  const paths = new Set<string>()
  if (!location) roots.forEach(item => paths.add(folderPath(item.path)))
  else if (root) {
    const current = folderPath(location.directoryPath)
    const addPath = (path: string) => {
      let candidate = folderPath(path)
      while (insideFolder(candidate, current) && candidate !== current) {
        if (parentFolder(candidate) === current) { paths.add(candidate); break }
        const parent = parentFolder(candidate)
        if (parent === candidate) break
        candidate = parent
      }
    }
    root.directoryPaths?.forEach(addPath)
    folderRootSongs(root, songs).forEach(item => addPath(parentFolder(item.sourcePath)))
  }
  return [...paths].map(path => {
    const owner = location ? root : roots.find(item => folderPath(item.path) === path)
    const seen = new Set<string>()
    const directorySongs = folderRootSongs(owner, songs).filter(item => {
      const key = folderPath(item.sourcePath)
      if (!insideFolder(item.sourcePath, path) || seen.has(key)) return false
      seen.add(key); return true
    })
    const complete = owner?.directoryPaths !== undefined
    return { path, name: folderName(path), parentName: folderName(parentFolder(path)),
      songs: directorySongs, status: owner?.status ?? 'loading', error: owner?.error, complete }
  }).filter(directory => !(directory.status === 'ready' && directory.complete && !directory.songs.length))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
}

// Both selected root and directory own projection/cache identity.
export function folderNavigationKey(rootPath: string, directoryPath: string): string {
  return JSON.stringify([folderPath(rootPath), folderPath(directoryPath)])
}

// Group the selected library union by immediate parent, never by scan root.
export function flatFolderEntries(songs: readonly AllSongsItem[]): FolderHierarchyEntry[] {
  const groups = new Map<string, AllSongsItem[]>()
  const seen = new Set<string>()
  for (const song of songs) {
    const key = folderPath(song.sourcePath)
    if (seen.has(key)) continue
    seen.add(key)
    const path = parentFolder(song.sourcePath)
    const group = groups.get(path) ?? []
    group.push(song)
    groups.set(path, group)
  }
  return [...groups].map(([path, songs]) => ({
    path,
    name: folderName(path),
    parentName: folderName(parentFolder(path)),
    songs,
    status: 'ready' as const,
    complete: true,
  }))
}
