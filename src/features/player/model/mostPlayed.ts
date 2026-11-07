import { normalizeAudioSourcePath } from './playlistTrackSummary'
export const MOST_PLAYED_STORAGE_KEY = 'spmusic.most-played.v1'
export const MOST_PLAYED_OPTIONS_STORAGE_KEY = 'spmusic.most-played.options.v1'
export type MostPlayedEntry = { sourcePath: string; playCount: number; lastPlayedAt: number }
export type MostPlayedOptions = { limit: number; from: number; direction: 'asc' | 'desc' }
export const DEFAULT_MOST_PLAYED_OPTIONS: MostPlayedOptions = { limit: 100, from: 0, direction: 'desc' }
export function isMostPlayedOptions(value: unknown): value is MostPlayedOptions {
  if (!value || typeof value !== 'object') return false
  const item = value as MostPlayedOptions
  // Keep datetime-local within four-digit years, including local timezone conversion.
  return Number.isSafeInteger(item.limit) && item.limit >= 2 && Number.isFinite(item.from) && item.from >= 0 && item.from <= 253_402_214_399_999 && (item.direction === 'asc' || item.direction === 'desc')
}
export function readMostPlayed(): MostPlayedEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(MOST_PLAYED_STORAGE_KEY) ?? 'null')
    if (value?.version !== 1 || !Array.isArray(value.entries)) return []
    const entries = new Map<string, MostPlayedEntry>()
    for (const item of value.entries) {
      if (!item || typeof item.sourcePath !== 'string' || !item.sourcePath.trim() || !Number.isSafeInteger(item.playCount) || item.playCount <= 0 || !Number.isFinite(item.lastPlayedAt) || item.lastPlayedAt <= 0) continue
      const sourcePath = normalizeAudioSourcePath(item.sourcePath), previous = entries.get(sourcePath)
      if (!previous || item.lastPlayedAt > previous.lastPlayedAt || item.lastPlayedAt === previous.lastPlayedAt && item.playCount > previous.playCount) entries.set(sourcePath, { sourcePath, playCount: item.playCount, lastPlayedAt: item.lastPlayedAt })
    }
    return [...entries.values()]
  } catch { return [] }
}
export function writeMostPlayed(entries: readonly MostPlayedEntry[]): void {
  localStorage.setItem(MOST_PLAYED_STORAGE_KEY, JSON.stringify({ version: 1, entries }))
}
export function recordMostPlayed(entries: readonly MostPlayedEntry[], path: string, lastPlayedAt: number): MostPlayedEntry[] {
  const sourcePath = normalizeAudioSourcePath(path), previous = entries.find(item => item.sourcePath === sourcePath)
  return [...entries.filter(item => item.sourcePath !== sourcePath), { sourcePath, playCount: Math.min(Number.MAX_SAFE_INTEGER, (previous?.playCount ?? 0) + 1), lastPlayedAt }]
}
export function readMostPlayedOptions(): MostPlayedOptions {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MOST_PLAYED_OPTIONS_STORAGE_KEY) ?? 'null')
    if (isMostPlayedOptions(value)) return value
  } catch { /* Fall back when storage is unavailable. */ }
  return { ...DEFAULT_MOST_PLAYED_OPTIONS }
}
export function writeMostPlayedOptions(options: MostPlayedOptions): void {
  try { if (isMostPlayedOptions(options)) localStorage.setItem(MOST_PLAYED_OPTIONS_STORAGE_KEY, JSON.stringify(options)) } catch { /* Retain session options. */ }
}
export function mostPlayedSongs<T extends { sourcePath: string; track: { title: string } }>(songs: readonly T[], entries: readonly MostPlayedEntry[], options: MostPlayedOptions = DEFAULT_MOST_PLAYED_OPTIONS): T[] {
  const settings = isMostPlayedOptions(options) ? options : DEFAULT_MOST_PLAYED_OPTIONS
  const stats = new Map(entries.map(item => [normalizeAudioSourcePath(item.sourcePath), item])), seen = new Set<string>()
  const count = (song: T) => stats.get(normalizeAudioSourcePath(song.sourcePath))!.playCount
  const tie = (a: T, b: T) => a.track.title.localeCompare(b.track.title) || normalizeAudioSourcePath(a.sourcePath).localeCompare(normalizeAudioSourcePath(b.sourcePath))
  return songs.filter(song => {
    const path = normalizeAudioSourcePath(song.sourcePath), stat = stats.get(path)
    if (seen.has(path) || !stat || stat.playCount <= 0 || stat.lastPlayedAt <= settings.from) return false
    seen.add(path); return true
  }).sort((a, b) => count(b) - count(a) || tie(a, b)).slice(0, settings.limit)
    .sort((a, b) => (settings.direction === 'asc' ? count(a) - count(b) : count(b) - count(a)) || tie(a, b))
}
