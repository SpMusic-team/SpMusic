export type PlaybackStatus = 'paused' | 'playing'

export type Track = {
  id: string
  title: string
  artist: string
  album: string
  durationSeconds: number
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
