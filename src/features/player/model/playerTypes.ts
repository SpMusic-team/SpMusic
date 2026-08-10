export type Track = {
  id: string
  title: string
  artist: string
  album: string
  category?: string
  durationSeconds: number
  coverTone: string
  coverImage?: string
  coverImageFallback?: string
  lyrics: DemoLyricLine[]
}

export type DemoLyricLine = {
  id: string
  timeSeconds: number
  original: string
  translation: string
}

export type TrackFeedback = 'liked' | 'disliked'
