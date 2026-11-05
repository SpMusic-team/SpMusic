import { normalizeAudioSourcePath } from './playlistTrackSummary'
import type { AllSongsItem } from './playerUiViewModel'

export const BOOKMARKS_STORAGE_KEY = 'spmusic.bookmarks.v1'
export type BookmarkEntry = Readonly<{ id: string; sourcePath: string; positionMs: number; createdAt: number; sort: number }>
export function readBookmarks(): BookmarkEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) ?? 'null')
    if (value?.version !== 1 || !Array.isArray(value.entries)) return []
    const seen = new Set<string>()
    return value.entries.filter((entry: BookmarkEntry) => {
      if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)
        || typeof entry.sourcePath !== 'string' || !entry.sourcePath.trim()
        || !Number.isSafeInteger(entry.positionMs) || entry.positionMs < 0
        || !Number.isSafeInteger(entry.createdAt) || entry.createdAt <= 0
        || !Number.isSafeInteger(entry.sort) || entry.sort < 0) return false
      seen.add(entry.id)
      return true
    }).map((entry: BookmarkEntry) => ({ id: entry.id, sourcePath: normalizeAudioSourcePath(entry.sourcePath),
      positionMs: entry.positionMs, createdAt: entry.createdAt, sort: entry.sort }))
      .sort((a: BookmarkEntry, b: BookmarkEntry) => a.sort - b.sort || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  } catch { return [] }
}
export function writeBookmarks(entries: readonly BookmarkEntry[]) {
  localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify({ version: 1, entries }))
}
export function projectBookmarks(songs: readonly AllSongsItem[], entries: readonly BookmarkEntry[]) {
  const byPath = new Map(songs.map(item => [normalizeAudioSourcePath(item.sourcePath), item]))
  return entries.map(bookmark => ({ bookmark, item: byPath.get(normalizeAudioSourcePath(bookmark.sourcePath)) }))
}
