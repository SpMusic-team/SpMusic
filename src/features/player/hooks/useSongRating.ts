import { createContext, useContext } from 'react'
import type { TrackRating } from '../model/playerTypes'
import type { RatingMode } from '../model/trackRating'

export const SongRatingContext = createContext<{ mode: RatingMode; ratings: Readonly<Record<string, TrackRating>> }>({ mode: 'thumbs', ratings: {} })
export function visibleSongRating(rating: TrackRating | undefined, mode: RatingMode): TrackRating | undefined {
  return rating && (mode === 'stars' || rating === 1 || rating === 5) ? rating : undefined
}
export function useSongRating(trackId: string) {
  const { mode, ratings } = useContext(SongRatingContext)
  return { mode, rating: visibleSongRating(Object.hasOwn(ratings, trackId) ? ratings[trackId] : undefined, mode) }
}
