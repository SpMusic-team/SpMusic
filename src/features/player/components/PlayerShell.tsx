import { useCallback, useMemo, useState } from 'react'
import { DevAudioToolsAvailability, DevAudioToolsSlot } from '@/features/player/components/DevAudioToolsSlot'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import { useAudioPlayer } from '@/features/player/hooks/useAudioPlayer'
import type { DevAudioToolsViewModel, PlayerUiViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

export function PlayerShell() {
  const player = useAudioPlayer()
  const [isDevAudioToolsOpen, setIsDevAudioToolsOpen] = useState(false)
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false)
  const currentTrackId = player.track?.id ?? null
  const playlistTracks = useMemo<PlaylistTrackItemViewModel[]>(() => player.queueTracks.map((queueTrack) => {
    const windowedVisual = player.playlistTrackVisuals[queueTrack.id]
    const currentTrack = player.track
    if (!currentTrack || queueTrack.id !== currentTrack.id) return windowedVisual ?? queueTrack
    return {
      ...(windowedVisual ?? queueTrack),
      durationSeconds: currentTrack.durationSeconds,
      fileExtension: currentTrack.fileExtension,
      coverTone: currentTrack.coverTone,
      hasLocalArtwork: Boolean(currentTrack.coverFilePath || currentTrack.coverImage || currentTrack.coverImageFallback),
      audioFormat: currentTrack.audioFormat,
    }
  }), [player.playlistTrackVisuals, player.queueTracks, player.track])
  const playlistTotalSeconds = useMemo(() => {
    const knownDurations = playlistTracks
      .map((track) => track.durationSeconds)
      .filter((duration): duration is number => duration !== undefined && Number.isFinite(duration))
    return knownDurations.length === playlistTracks.length && knownDurations.length > 0
      ? knownDurations.reduce((total, duration) => total + duration, 0)
      : undefined
  }, [playlistTracks])
  const toggleTrackFeedback = player.toggleTrackFeedback
  const handleFeedbackToggle = useCallback((feedback: Parameters<typeof toggleTrackFeedback>[1]) => {
    if (currentTrackId) toggleTrackFeedback(currentTrackId, feedback)
  }, [currentTrackId, toggleTrackFeedback])
  const handleDevAudioToolsClose = useCallback(() => setIsDevAudioToolsOpen(false), [])

  const viewModel: PlayerUiViewModel = {
    playback: {
      track: player.track,
      audioOutputInfo: player.audioOutputInfo,
      artwork: player.artwork,
      artworkPrefetchCandidate: player.artworkPrefetchCandidate,
      artworkPrefetchCandidates: player.artworkPrefetchCandidates,
      selectionActivitySequence: player.selectionActivitySequence,
      selectionVisualIntent: player.selectionVisualIntent,
      detailsPending: player.detailsPending,
      contentState: player.contentState,
      isPlaying: player.playing,
      shuffleMode: player.shuffleMode,
      repeatMode: player.repeatMode,
      isAudioBusy: player.audioBusy,
      isSelectionPending: player.selectionPending,
      isTransportBusy: player.transportBusy,
      transportTransition: player.transportTransition,
      transportSettledRequestId: player.transportSettledRequestId,
      statusText: player.statusText,
      onOpenAudio: player.openAudio,
      onPrevious: player.previous,
      onNext: player.next,
      onPrepareTrackPreview: player.prepareTrackCardPreview,
      onPrimeTrackArtwork: player.primeTrackArtwork,
      onCommitTrackPreview: player.commitTrackCardPreview,
      onDiscardTrackPreview: player.discardTrackCardPreview,
      onPlayToggle: player.transitionPlayback,
      onShuffleCycle: player.cycleShuffleMode,
      onRepeatCycle: player.cycleRepeatMode,
    },
    timeline: {
      positionSeconds: player.progress,
      durationSeconds: player.duration,
      interaction: player.timelineInteraction,
      visualClock: player.visualTimelineClock,
      onPreviewStart: player.startProgressPreview,
      onPreview: player.setProgress,
      onCommit: player.commitProgress,
      onCancelPreview: player.cancelProgressPreview,
    },
    volume: {
      valuePercent: player.volume,
      isBusy: player.volumeBusy,
      isDisabled: player.volumeDisabled,
      onChange: player.changeVolume,
    },
    queue: {
      tracks: player.queueTracks,
      unavailableTrackIds: player.unavailableTrackIds,
      playlistName: player.playlistName,
      isOpen: player.queueOpen,
      onToggle: player.toggleQueue,
      onTrackSelect: player.audioBusy || player.transportBusy || player.timelineInteraction === 'seeking'
        ? undefined
        : player.selectQueueTrack,
    },
    playlist: {
      isOpen: isPlaylistOpen,
      onOpenChange: setIsPlaylistOpen,
      isOpenAudioDisabled: player.audioBusy
        || player.transportBusy
        || player.selectionPending
        || player.timelineInteraction === 'seeking',
      onOpenAudio: player.openAudio,
      tracks: playlistTracks,
      unavailableTrackIds: player.unavailableTrackIds,
      playlistName: player.playlistName,
      totalDurationSeconds: playlistTotalSeconds,
      currentTrackId: player.track?.id ?? null,
      shuffleMode: player.shuffleMode,
      onShuffleCycle: player.cycleShuffleMode,
      onTrackSelect: player.audioBusy || player.transportBusy || player.timelineInteraction === 'seeking'
        ? undefined
        : player.selectQueueTrack,
      onVisibleTrackIdsChange: player.setVisiblePlaylistTrackIds,
    },
    feedback: {
      value: player.currentFeedback,
      valuesByTrackId: player.feedbackByTrackId,
      onToggle: handleFeedbackToggle,
    },
  }

  const devAudioToolsViewModel: DevAudioToolsViewModel = {
    fileName: player.currentAudioTrack?.fileName ?? null,
    hasTrack: Boolean(player.audioState?.currentTrackId),
    phase: player.audioState?.phase ?? 'idle',
    title: player.track?.title ?? null,
    isPlaying: player.playing,
    isAudioBusy: player.audioBusy || player.selectionPending || player.timelineInteraction === 'seeking',
    isTransportBusy: player.transportBusy,
    statusText: player.statusText,
    positionSeconds: player.progress,
    durationSeconds: player.duration,
    onOpen: player.openAudio,
    onOpenAndPlay: player.openAudioAndPlay,
    onPlayToggle: player.togglePlayback,
    onPreview: player.setProgress,
    onCommit: player.commitProgress,
    onRefresh: player.refreshAudioState,
    onStop: player.stopAudioPlayback,
  }

  return (
    <DevAudioToolsAvailability>
      {(isAvailable) => (
        <PlayerSurface
          viewModel={viewModel}
          devAudioTools={isAvailable ? {
            isOpen: isDevAudioToolsOpen,
            onOpenChange: setIsDevAudioToolsOpen,
            content: (
              <DevAudioToolsSlot
                viewModel={devAudioToolsViewModel}
                isOpen={isDevAudioToolsOpen}
                onClose={handleDevAudioToolsClose}
              />
            ),
          } : undefined}
        />
      )}
    </DevAudioToolsAvailability>
  )
}

export default PlayerShell
