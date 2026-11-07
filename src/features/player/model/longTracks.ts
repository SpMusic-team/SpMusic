export const LONG_TRACKS_MIN_DURATION_STORAGE_KEY = 'spmusic.long-tracks.min-duration-ms.v1'
export const DEFAULT_LONG_TRACKS_MIN_DURATION_MS = 15 * 60 * 1000
export const MAX_LONG_TRACKS_MIN_DURATION_MS = 2_147_483_647

export function isLongTracksMinDurationMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LONG_TRACKS_MIN_DURATION_MS
}

export function readLongTracksMinDurationMs(): number {
  try {
    const saved = typeof window === 'undefined' ? null : window.localStorage.getItem(LONG_TRACKS_MIN_DURATION_STORAGE_KEY)
    const value: unknown = saved === null ? undefined : JSON.parse(saved)
    if (isLongTracksMinDurationMs(value)) return value
  } catch { /* Unavailable or invalid storage uses the product default. */ }
  return DEFAULT_LONG_TRACKS_MIN_DURATION_MS
}

export function writeLongTracksMinDurationMs(value: number): void {
  if (!isLongTracksMinDurationMs(value)) return
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LONG_TRACKS_MIN_DURATION_STORAGE_KEY, JSON.stringify(value))
  } catch { /* Keep the current session usable when storage is unavailable. */ }
}

export function longTracksSongs<T extends { scope: string; sourcePath: string }>(songs: readonly T[],
  durationsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>, minDurationMs: number): T[] {
  const minimum = isLongTracksMinDurationMs(minDurationMs) ? minDurationMs : DEFAULT_LONG_TRACKS_MIN_DURATION_MS
  return songs.filter(item => {
    const duration = durationsByScope.get(item.scope)?.get(item.sourcePath)
    return duration !== undefined && Number.isFinite(duration) && duration >= 0 && duration >= minimum
  })
}
