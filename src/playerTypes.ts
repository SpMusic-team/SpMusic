export type PlaybackStatus = 'paused' | 'playing'

export type Track = {
  id: string
  title: string
  artist: string
  album: string
  category?: string
  durationSeconds: number
  coverTone: string
  coverImage?: string
  lyrics: DemoLyricLine[]
}

export type DemoLyricLine = {
  id: string
  timeSeconds: number
  original: string
  translation: string
}

export type SpectrumBar = {
  id: string
  level: number
}

export type PlayerState = {
  tracks: Track[]
  currentTrackId: string | null
  playbackStatus: PlaybackStatus
  progressSeconds: number
  spectrumBars: SpectrumBar[]
}
