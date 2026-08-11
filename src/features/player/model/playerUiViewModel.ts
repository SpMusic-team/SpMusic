import type { RepeatMode, ShuffleMode } from '@/features/player/model/playbackModes'
import type { Track, TrackFeedback } from '@/features/player/model/playerTypes'

export type PlayerPlaybackViewModel = {
  track: Track | null
  isPlaying: boolean
  shuffleMode: ShuffleMode
  repeatMode: RepeatMode
  isAudioBusy: boolean
  isTransportBusy: boolean
  statusText: string
  onOpenAudio: () => void
  onPrevious: () => void
  onNext: () => void
  onPlayToggle: () => void
  onShuffleCycle: () => void
  onRepeatCycle: () => void
}

export type PlayerTimelineInteraction = 'following' | 'previewing' | 'seeking'

export type PlayerTimelineViewModel = {
  positionSeconds: number
  durationSeconds: number
  interaction: PlayerTimelineInteraction
  onPreviewStart: () => void
  onPreview: (positionSeconds: number) => void
  onCommit: (positionSeconds: number) => void
  onCancelPreview: () => void
}

export type PlayerVolumeViewModel = {
  valuePercent: number
  isBusy: boolean
  isDisabled: boolean
  onChange: (valuePercent: number) => void
}

export type PlayerQueueViewModel = {
  tracks: Track[]
  playlistName?: string
  isOpen: boolean
  onToggle: () => void
  onTrackSelect?: (trackId: string) => void
}

export type PlayerFeedbackViewModel = {
  value?: TrackFeedback
  onToggle: (feedback: TrackFeedback) => void
}

export type PlayerUiViewModel = {
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  volume: PlayerVolumeViewModel
  queue: PlayerQueueViewModel
  feedback: PlayerFeedbackViewModel
}

export type DevAudioToolsViewModel = {
  fileName: string | null
  hasTrack: boolean
  phase: string
  title: string | null
  isPlaying: boolean
  isAudioBusy: boolean
  isTransportBusy: boolean
  statusText: string
  positionSeconds: number
  durationSeconds: number
  onOpen: () => void
  onOpenAndPlay: () => void
  onPlayToggle: () => void
  onPreview: (positionSeconds: number) => void
  onCommit: (positionSeconds: number) => void
  onRefresh: () => void
  onStop: () => void
}
