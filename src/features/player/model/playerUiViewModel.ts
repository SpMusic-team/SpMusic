import type { RepeatMode, ShuffleMode } from '@/features/player/model/playbackModes'
import type { Track, TrackArtwork, TrackArtworkPrefetchCandidate, TrackFeedback, TrackSummary } from '@/features/player/model/playerTypes'
import type { PlayerVisualTimelineClock } from '@/features/player/model/visualTimelineClock'
import type { AudioTransportTarget, AudioTransportTransition } from '@/features/player/services/audioCommands'

export type PlayerContentState = 'empty' | 'loading' | 'track' | 'error'

export type PlayerPlaybackViewModel = {
  track: Track | null
  artwork?: TrackArtwork | null
  artworkPrefetchCandidate?: TrackArtworkPrefetchCandidate | null
  selectionActivitySequence?: number
  detailsPending?: boolean
  contentState?: PlayerContentState
  isPlaying: boolean
  shuffleMode: ShuffleMode
  repeatMode: RepeatMode
  isAudioBusy: boolean
  isSelectionPending?: boolean
  isTransportBusy: boolean
  transportTransition?: AudioTransportTransition | null
  transportSettledRequestId?: number | null
  statusText: string
  onOpenAudio: () => void
  onPrevious: () => void
  onNext: () => void
  onPlayToggle: (request: PlayerPlaybackTransitionRequest) => Promise<PlayerPlaybackTransitionResult>
  onShuffleCycle: () => void
  onRepeatCycle: () => void
}

export type PlayerPlaybackTransitionRequest = {
  requestId: number
  expectedTrackId: string
  target: AudioTransportTarget
  durationMs: number
}

export type PlayerPlaybackTransitionResult = {
  requestId: number
  completed: boolean
}

export type PlayerTimelineInteraction = 'following' | 'previewing' | 'seeking'

export type PlayerTimelineViewModel = {
  positionSeconds: number
  durationSeconds: number
  interaction: PlayerTimelineInteraction
  visualClock?: PlayerVisualTimelineClock
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
  tracks: TrackSummary[]
  unavailableTrackIds?: ReadonlySet<string>
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
