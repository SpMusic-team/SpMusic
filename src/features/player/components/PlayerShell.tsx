import { useState } from 'react'
import { DevAudioToolsAvailability, DevAudioToolsSlot } from '@/features/player/components/DevAudioToolsSlot'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import { useAudioPlayer } from '@/features/player/hooks/useAudioPlayer'
import type { DevAudioToolsViewModel, PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'

export function PlayerShell() {
  const player = useAudioPlayer()
  const [isDevAudioToolsOpen, setIsDevAudioToolsOpen] = useState(false)

  const viewModel: PlayerUiViewModel = {
    playback: {
      track: player.track,
      isPlaying: player.playing,
      shuffleMode: player.shuffleMode,
      repeatMode: player.repeatMode,
      isAudioBusy: player.audioBusy,
      isTransportBusy: player.transportBusy,
      statusText: player.statusText,
      onOpenAudio: player.openAudio,
      onPrevious: player.previous,
      onNext: player.next,
      onPlayToggle: player.togglePlayback,
      onShuffleCycle: player.cycleShuffleMode,
      onRepeatCycle: player.cycleRepeatMode,
    },
    timeline: {
      positionSeconds: player.progress,
      durationSeconds: player.duration,
      interaction: player.timelineInteraction,
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
      playlistName: player.playlistName,
      isOpen: player.queueOpen,
      onToggle: player.toggleQueue,
      onTrackSelect: player.selectQueueTrack,
    },
    feedback: {
      value: player.currentFeedback,
      onToggle: (feedback) => {
        if (player.track) player.toggleTrackFeedback(player.track.id, feedback)
      },
    },
  }

  const devAudioToolsViewModel: DevAudioToolsViewModel = {
    fileName: player.currentAudioTrack?.fileName ?? null,
    hasTrack: Boolean(player.audioState?.currentTrackId),
    phase: player.audioState?.phase ?? 'idle',
    title: player.track?.title ?? null,
    isPlaying: player.playing,
    isAudioBusy: player.audioBusy,
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
                onClose={() => setIsDevAudioToolsOpen(false)}
              />
            ),
          } : undefined}
        />
      )}
    </DevAudioToolsAvailability>
  )
}

export default PlayerShell
