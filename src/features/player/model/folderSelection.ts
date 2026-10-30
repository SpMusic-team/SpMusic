import type { AudioFolderPlaylist, RootSelection } from '@/features/player/services/audioCommands'
export type { DirectorySelectionRule, RootSelection, LibraryFolderSettings, DirectoryChildren, LibraryError } from '@/features/player/services/audioCommands'

export function folderSelectionPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isRootSelectionActive(root: RootSelection): boolean {
  return root.selected || root.directoryRules.some(rule => rule.selected)
}

export function isDirectorySelected(root: RootSelection, relativePath: string): boolean {
  const path = folderSelectionPath(relativePath)
  let selected = root.selected
  let depth = -1
  for (const rule of root.directoryRules) {
    const candidate = folderSelectionPath(rule.relativePath)
    if ((path === candidate || path.startsWith(`${candidate}/`)) && candidate.length > depth) {
      selected = rule.selected
      depth = candidate.length
    }
  }
  return selected
}

export function toggleDirectorySelection(root: RootSelection, relativePath: string, selected: boolean): RootSelection {
  const path = folderSelectionPath(relativePath)
  if (!path) return { ...root, selected, directoryRules: [] }
  return { ...root, directoryRules: [
    ...root.directoryRules.filter(rule => {
      const candidate = folderSelectionPath(rule.relativePath)
      return candidate !== path && !candidate.startsWith(`${path}/`)
    }), { relativePath: relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), selected },
  ] }
}

export function getDirectorySelectionState(root: RootSelection, relativePath: string): boolean | 'indeterminate' {
  const path = folderSelectionPath(relativePath)
  const selected = isDirectorySelected(root, relativePath)
  return root.directoryRules.some(rule => {
    const candidate = folderSelectionPath(rule.relativePath)
    return (!path || candidate.startsWith(`${path}/`)) && rule.selected !== selected
  }) ? 'indeterminate' : selected
}

export function projectSelectedFolder(playlist: AudioFolderPlaylist, root: RootSelection): AudioFolderPlaylist {
  const base = folderSelectionPath(root.path)
  const relativeDirectory = (path: string) => folderSelectionPath(path).slice(base.length + 1)
  const tracks = playlist.tracks.filter(track => {
    const normalized = folderSelectionPath(track.sourcePath)
    if (!normalized.startsWith(`${base}/`)) return false
    const relative = relativeDirectory(track.sourcePath)
    return isDirectorySelected(root, relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '')
  })
  return { ...playlist, tracks, directoryPaths: playlist.directoryPaths?.filter(path => {
    if (folderSelectionPath(path) === base) return isRootSelectionActive(root)
    const relative = relativeDirectory(path)
    return isDirectorySelected(root, relative) || root.directoryRules.some(rule => rule.selected
      && folderSelectionPath(rule.relativePath).startsWith(`${relative}/`))
  }) }
}
