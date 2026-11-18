import type { FolderHierarchyEntry } from './folderHierarchy'
import { compareByQuickIndex } from './quickIndex'

export const FLAT_FOLDER_SORT_OPTIONS = [
  { value: 'name', label: '根据名称' },
  { value: 'path-case-sensitive', label: '根据路径（区分大小写）' },
  { value: 'path', label: '根据路径' },
  { value: 'added', label: '根据添加到媒体库的日期' },
  { value: 'modified', label: '根据添加/修改日期', note: '文件系统日期/时间' },
  { value: 'count', label: '根据歌曲数量' },
] as const

type FolderRootCategory = 'folder' | 'folders'
export type FlatFolderSort = typeof FLAT_FOLDER_SORT_OPTIONS[number]['value']
export type FolderRootListOptions = Readonly<{ sort: FlatFolderSort; reverse: boolean; titleOnly: boolean }>

const DEFAULT_OPTIONS: FolderRootListOptions = { sort: 'name', reverse: false, titleOnly: false }

function optionsStorageKey(category: FolderRootCategory) {
  return category === 'folder' ? 'spmusic.flat-folders.options.v1' : 'spmusic.folder-hierarchy.options.v1'
}

export function readFolderRootListOptions(category: FolderRootCategory): FolderRootListOptions {
  try {
    const value = JSON.parse(localStorage.getItem(optionsStorageKey(category)) ?? 'null') as Partial<FolderRootListOptions> | null
    return {
      sort: category === 'folder' ? (FLAT_FOLDER_SORT_OPTIONS.find(option => option.value === value?.sort)?.value ?? 'name') : 'name',
      reverse: category === 'folder' && value?.reverse === true,
      titleOnly: value?.titleOnly === true,
    }
  } catch {
    return DEFAULT_OPTIONS
  }
}

export function writeFolderRootListOptions(category: FolderRootCategory, options: FolderRootListOptions) {
  try { localStorage.setItem(optionsStorageKey(category), JSON.stringify(options)) } catch { /* Retain session preferences. */ }
}

function timestamp(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function earliestAddition(directory: FolderHierarchyEntry): number | undefined {
  let earliest: number | undefined
  for (const song of directory.songs) {
    const addedAt = timestamp(song.libraryAddedAtMs)
    if (addedAt !== undefined && (earliest === undefined || addedAt < earliest)) earliest = addedAt
  }
  return earliest
}

function comparePath(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function sortFlatFolderEntries(
  directories: readonly FolderHierarchyEntry[], sort: FlatFolderSort, reverse: boolean,
  directoryModifiedAtMs?: ReadonlyMap<string, number>,
) {
  const direction = reverse ? -1 : 1
  if (sort === 'path' || sort === 'path-case-sensitive') {
    return directories.map(directory => ({ directory, path: sort === 'path' ? directory.path.toLowerCase() : directory.path }))
      .sort((a, b) => (comparePath(a.path, b.path) || comparePath(a.directory.path, b.directory.path)) * direction)
      .map(item => item.directory)
  }
  if (sort === 'name') {
    return [...directories].sort((a, b) => compareByQuickIndex(a.name, b.name) * direction || comparePath(a.path, b.path))
  }
  return directories.map(directory => ({
    directory,
    value: sort === 'count' ? directory.songs.length : sort === 'added' ? earliestAddition(directory) : timestamp(directoryModifiedAtMs?.get(directory.path)),
  })).sort((a, b) => {
    if (a.value === undefined && b.value !== undefined) return 1
    if (b.value === undefined && a.value !== undefined) return -1
    return ((a.value ?? 0) - (b.value ?? 0)) * direction
      || compareByQuickIndex(a.directory.name, b.directory.name) || comparePath(a.directory.path, b.directory.path)
  }).map(item => item.directory)
}
