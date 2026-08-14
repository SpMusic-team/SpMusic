export type CoverTone = 'lagoon' | 'violet' | 'rose' | 'amber' | 'blue'

export type Track = {
  id: string
  title: string
  artist: string
  album: string
  category?: string
  durationSeconds: number
  coverTone: CoverTone
  coverImage?: string
  coverImageFallback?: string
  lyrics: DemoLyricLine[]
}

export type TrackArtwork = Pick<Track, 'id' | 'coverTone' | 'coverImage' | 'coverImageFallback'> & {
  resourceKey: string
}

export type DemoLyricLine = {
  id: string
  timeSeconds: number
  original: string
  translation: string
}

export type TrackFeedback = 'liked' | 'disliked'
