import type { TrackRating } from './playerTypes'

export const TRACK_RATINGS_STORAGE_KEY = 'spmusic.track-ratings.v1'
export type TrackRatings = Readonly<Record<string, TrackRating>>
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
export function readTrackRatings(): Record<string, TrackRating> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TRACK_RATINGS_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return {}
    const stored = value as { version?: unknown; entries?: unknown }
    if (stored.version !== 1 || !Array.isArray(stored.entries)) return {}
    const entries = new Map<string, TrackRating>()
    for (const entry of stored.entries) {
      if (!entry || typeof entry !== 'object') continue
      const { trackId, rating } = entry as { trackId?: unknown; rating?: unknown }
      if (!validId(trackId) || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) continue
      entries.set(trackId, rating as TrackRating)
    }
    return Object.fromEntries(entries)
  } catch { return {} }
}
export function writeTrackRatings(ratings: TrackRatings): void {
  const entries = Object.entries(ratings).filter(([trackId, rating]) => validId(trackId) && Number.isInteger(rating) && rating >= 1 && rating <= 5).map(([trackId, rating]) => ({ trackId, rating }))
  localStorage.setItem(TRACK_RATINGS_STORAGE_KEY, JSON.stringify({ version: 1, entries }))
}
export function updateTrackRating(ratings: TrackRatings, trackId: string, rating: TrackRating): Record<string, TrackRating> {
  if (!validId(trackId) || !Number.isInteger(rating) || rating < 0 || rating > 5) return { ...ratings }
  const next = { ...ratings }
  if (rating === 0) delete next[trackId]
  else Object.defineProperty(next, trackId, { value: rating, writable: true, enumerable: true, configurable: true })
  return next
}
