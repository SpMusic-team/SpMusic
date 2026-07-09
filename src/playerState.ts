import { demoTracks } from './demoTracks'
import { demoSpectrumBars } from './demoSpectrum'
import type { PlayerState } from './playerTypes'

export const initialPlayerState: PlayerState = {
  tracks: demoTracks,
  currentTrackId: demoTracks[0]?.id ?? null,
  playbackStatus: 'paused',
  progressSeconds: 0,
  spectrumBars: demoSpectrumBars,
}
