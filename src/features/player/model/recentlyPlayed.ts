import { normalizeAudioSourcePath } from './playlistTrackSummary'
import type { AudioPlaybackState } from '../services/audioCommands'

export const RECENTLY_PLAYED_STORAGE_KEY = 'spmusic.recently-played.v1'
export type RecentlyPlayedEntry = { sourcePath: string; lastPlayedAt: number }
export function readRecentlyPlayed(): RecentlyPlayedEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) ?? 'null')
    if (value?.version !== 1 || !Array.isArray(value.entries)) return []
    const entries = new Map<string, RecentlyPlayedEntry>()
    for (const item of value.entries) {
      if (!item || typeof item.sourcePath !== 'string' || !item.sourcePath.trim() || !Number.isFinite(item.lastPlayedAt) || item.lastPlayedAt <= 0) continue
      const sourcePath = normalizeAudioSourcePath(item.sourcePath)
      if ((entries.get(sourcePath)?.lastPlayedAt ?? 0) < item.lastPlayedAt) entries.set(sourcePath, { sourcePath, lastPlayedAt: item.lastPlayedAt })
    }
    return [...entries.values()]
  } catch { return [] }
}
export function writeRecentlyPlayed(entries: readonly RecentlyPlayedEntry[]): void {
  localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify({ version: 1, entries }))
}
export function recentlyPlayedSongs<T extends { sourcePath: string }>(songs: readonly T[], entries: readonly RecentlyPlayedEntry[]): T[] {
  const times = new Map(entries.map(item => [item.sourcePath, item.lastPlayedAt]))
  return songs.filter(item => times.has(normalizeAudioSourcePath(item.sourcePath))).sort((a, b) =>
    times.get(normalizeAudioSourcePath(b.sourcePath))! - times.get(normalizeAudioSourcePath(a.sourcePath))!
    || normalizeAudioSourcePath(a.sourcePath).localeCompare(normalizeAudioSourcePath(b.sourcePath)))
}
export class RecentlyPlayedTracker {
  private identity = ''
  private elapsed = 0
  private counted = false
  private phase = ''
  private baseline: { position: number; time: number } | null = null
  breakBaseline() { this.baseline = null }
  restart() { this.elapsed = 0; this.counted = false; this.baseline = null }
  sample(state: AudioPlaybackState, now: number, blocked = false, canCommit = true): boolean {
    const identity = `${state.currentTrackId}\u0000${state.generation}`
    if (identity !== this.identity) {
      this.identity = identity; this.elapsed = 0; this.counted = false; this.baseline = null
    }
    if (state.phase === 'playing' && (this.phase === 'ended' || this.phase === 'stopped')) this.restart()
    this.phase = state.phase
    const previous = this.baseline
    const eligible = !blocked && state.phase === 'playing' && !state.transportTransition && state.currentTrackId !== null && state.generation !== null
    // Poll responses can repeat the position from the preceding event. Keep
    // its time anchor so the next advancing event accounts for that interval.
    this.baseline = eligible
      ? previous?.position === state.positionMs ? previous : { position: state.positionMs, time: now }
      : null
    if ((eligible || (!blocked && state.phase === 'ended' && !state.transportTransition)) && previous) {
      const delta = state.positionMs - previous.position
      const elapsed = now - previous.time
      if (delta > 0 && elapsed >= 0 && delta <= elapsed + 250) this.elapsed += Math.min(delta, elapsed, 1500)
    }
    if (canCommit && !this.counted && state.durationMs !== null && state.durationMs > 0 && this.elapsed >= state.durationMs * 0.5) {
      this.counted = true
      return true
    }
    return false
  }
}
