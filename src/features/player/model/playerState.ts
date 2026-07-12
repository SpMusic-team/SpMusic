import { demoSpectrumBars } from '@/features/player/data/demoSpectrum'
import { demoTracks } from '@/features/player/data/demoTracks'
import type { PlayerState } from './playerTypes'

export const initialPlayerState: PlayerState = {
  tracks: demoTracks,
  currentTrackId: demoTracks[0]?.id ?? null,
  playbackStatus: 'paused',
  progressSeconds: 0,
  spectrumBars: demoSpectrumBars,
}
