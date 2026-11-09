export type CoverTone = 'lagoon' | 'violet' | 'rose' | 'amber' | 'blue'

export type Track = {
  id: string
  sourcePath?: string
  stream?: Readonly<{ url: string; stationName?: string }>
  title: string
  artist: string
  album: string
  category?: string
  fileExtension?: string
  durationSeconds: number
  coverTone: CoverTone
  coverFilePath?: string
  coverImage?: string
  coverImageFallback?: string
  /**
   * Token of the published snapshot `coverImage`/`coverThumbnail` came from.
   *
   * Optional because most rows carry plain URL artwork with no owner behind it.
   * A consumer must render the image and report the token of the *same* snapshot;
   * a report without one cannot be attributed to a publication.
   */
  coverPresentation?: import('./playlistCoverReadiness').CoverPresentation
  lyrics: DemoLyricLine[]
  audioFormat?: {
    bitDepth: number | null
    sampleRateHz: number | null
    bitrateKbps: number | null
    codec: string | null
  }
}

export type TrackSummary = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'category' | 'stream'>

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
export type TrackRating = 0 | 1 | 2 | 3 | 4 | 5
