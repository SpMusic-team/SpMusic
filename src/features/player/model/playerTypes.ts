export type CoverTone = 'lagoon' | 'violet' | 'rose' | 'amber' | 'blue'

export type Track = {
  id: string
  title: string
  artist: string
  album: string
  category?: string
  durationSeconds: number
  coverTone: CoverTone
  coverFilePath?: string
  coverImage?: string
  coverImageFallback?: string
  lyrics: DemoLyricLine[]
}

export type TrackSummary = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'category'>

export type TrackArtwork = Pick<Track, 'id' | 'coverTone' | 'coverFilePath' | 'coverImage' | 'coverImageFallback'> & {
  resourceKey: string
}

export type TrackArtworkPrefetchCandidate = Readonly<{
  afterTrackId: string
  direction: -1 | 1
  track: Track
  artwork: TrackArtwork
}>

export type DemoLyricLine = {
  id: string
  timeSeconds: number
  original: string
  translation: string
}

export type TrackFeedback = 'liked' | 'disliked'
