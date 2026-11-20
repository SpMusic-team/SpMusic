import type { TrackFeedback, TrackRating } from './playerTypes'
export type RatingMode = 'thumbs' | 'stars'
export function feedbackFromRating(rating: TrackRating): TrackFeedback | undefined {
  return rating === 5 ? 'liked' : rating === 1 ? 'disliked' : undefined
}
export function readRatingMode(): RatingMode {
  try { return localStorage.getItem('spmusic.player.rating-mode.v1') === 'stars' ? 'stars' : 'thumbs' } catch { return 'thumbs' }
}
export function persistRatingMode(mode: RatingMode) {
  try { localStorage.setItem('spmusic.player.rating-mode.v1', mode) } catch { /* Retain session preference when storage is unavailable. */ }
}
