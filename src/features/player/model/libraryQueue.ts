import type { AudioFolderTrackRef } from '../services/audioCommands'
import { normalizeAudioSourcePath } from './playlistTrackSummary'
export const LIBRARY_QUEUE_STORAGE_KEY = 'spmusic.library-queue.v1'
export type LibraryQueueEntry = Readonly<{ entryId: string; sourcePath: string; descriptor: AudioFolderTrackRef; createdAt: number; playedAt: number | null }>
function descriptorReference(track: AudioFolderTrackRef): AudioFolderTrackRef {
 return { id: track.id, sourcePath: track.sourcePath, fileName: track.fileName, available: track.available,
  ...(track.sourceKind === 'stream' || track.sourceKind === 'file' ? { sourceKind: track.sourceKind } : {}),
  ...(typeof track.stationName === 'string' ? { stationName: track.stationName } : {}),
  ...(typeof track.title === 'string' ? { title: track.title } : {}) }
}
export function readLibraryQueue(): LibraryQueueEntry[] {
 try {
  const value = JSON.parse(localStorage.getItem(LIBRARY_QUEUE_STORAGE_KEY) ?? 'null')
  const seen = new Set<string>()
  if (value?.version !== 1 || !Array.isArray(value.entries)) return []
  return value.entries.filter((e: LibraryQueueEntry) => {
   if (!e || typeof e.entryId !== 'string' || !e.entryId || seen.has(e.entryId) || typeof e.sourcePath !== 'string' || !e.sourcePath || !e.descriptor || typeof e.descriptor.id !== 'string' || !e.descriptor.id || typeof e.descriptor.fileName !== 'string' || typeof e.descriptor.available !== 'boolean' || e.descriptor.sourcePath !== e.sourcePath || !Number.isSafeInteger(e.createdAt) || e.createdAt <= 0 || e.playedAt !== null && (!Number.isSafeInteger(e.playedAt) || e.playedAt < e.createdAt)) return false
   seen.add(e.entryId); return true
  }).map((e: LibraryQueueEntry) => ({ entryId: e.entryId, sourcePath: e.sourcePath, descriptor: descriptorReference(e.descriptor), createdAt: e.createdAt, playedAt: e.playedAt }))
 } catch { return [] }
}
export function writeLibraryQueue(entries: readonly LibraryQueueEntry[]) { localStorage.setItem(LIBRARY_QUEUE_STORAGE_KEY, JSON.stringify({ version: 1, entries })) }
export function appendLibraryQueue(entries: readonly LibraryQueueEntry[], tracks: readonly AudioFolderTrackRef[], now = Date.now()): LibraryQueueEntry[] {
 const seen = new Set<string>()
 return [...entries, ...tracks.filter(track => { const path = normalizeAudioSourcePath(track.sourcePath); if (!track.available || seen.has(path)) return false; seen.add(path); return true }).map(descriptor => ({ entryId: crypto.randomUUID(), sourcePath: descriptor.sourcePath, descriptor: descriptorReference(descriptor), createdAt: now, playedAt: null }))]
}
export function markLibraryQueuePlayed(entries: readonly LibraryQueueEntry[], sourcePath: string, now = Date.now()): readonly LibraryQueueEntry[] {
 const path = normalizeAudioSourcePath(sourcePath)
 if (!entries.some(e => e.playedAt === null && normalizeAudioSourcePath(e.sourcePath) === path)) return entries
 return entries.map(e => e.playedAt === null && normalizeAudioSourcePath(e.sourcePath) === path ? { ...e, playedAt: Math.max(now, e.createdAt) } : e)
}
