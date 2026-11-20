import { visibleSongRating } from '../hooks/useSongRating'
import { Star48Filled } from '@fluentui/react-icons'
import ratingLiked from '@/assets/song-card/rating-liked.svg'
import type { TrackRating } from '../model/playerTypes'
import type { RatingMode } from '../model/trackRating'

export function SongRatingBadge({ rating, mode }: { rating: TrackRating; mode: RatingMode }) {
  if (!visibleSongRating(rating, mode)) return null
  return <span className="playlist-card-rating" data-rating={rating} aria-hidden="true">{mode === 'stars'
    ? Array.from({ length: rating }, (_, index) => <Star48Filled key={index} className="playlist-card-rating-star" aria-hidden="true" />)
    : <span className={rating === 1 ? 'playlist-card-glyph playlist-card-rating-thumb is-disliked' : 'playlist-card-glyph playlist-card-rating-thumb'} style={{ maskImage: `url("${ratingLiked}")` }} />}</span>
}
