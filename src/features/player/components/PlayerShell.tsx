import { lazy, Suspense, useState } from 'react'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import { useAudioPlayer } from '@/features/player/hooks/useAudioPlayer'

const DevAudioControlBar = import.meta.env.DEV
  ? lazy(() => import('@/features/player/components/TemporaryAudioControlBar').then((module) => ({
      default: module.TemporaryAudioControlBar,
    })))
  : null

export function PlayerShell() {
  const player = useAudioPlayer()
  const [debugToolsOpen, setDebugToolsOpen] = useState(false)

  const debugPanel = import.meta.env.DEV && debugToolsOpen && DevAudioControlBar ? (
    <Suspense fallback={null}>
      <DevAudioControlBar
        busy={player.audioBusy}
        duration={player.duration}
        fileName={player.currentAudioTrack?.fileName ?? null}
        hasTrack={Boolean(player.audioState?.currentTrackId)}
        phase={player.audioState?.phase ?? 'idle'}
        playing={player.playing}
        progress={player.progress}
        statusText={player.statusText}
        title={player.track?.title ?? null}
        transportBusy={player.transportBusy}
        onOpen={player.openAudio}
        onOpenAndPlay={player.openAudioAndPlay}
        onPlayToggle={player.togglePlayback}
        onProgressChange={player.setProgress}
        onProgressCommit={player.commitProgress}
        onRefresh={player.refreshAudioState}
        onStop={player.stopAudioPlayback}
        onClose={() => setDebugToolsOpen(false)}
      />
    </Suspense>
  ) : null

  return (
    <PlayerSurface
      track={player.track}
      queueTracks={player.queueTracks}
      playlistName={player.playlistName}
      currentFeedback={player.currentFeedback}
      shuffleMode={player.shuffleMode}
      repeatMode={player.repeatMode}
      queueOpen={player.queueOpen}
      playing={player.playing}
      progress={player.progress}
      duration={player.duration}
      volume={player.volume}
      volumeBusy={player.volumeBusy}
      volumeDisabled={player.volumeDisabled}
      audioBusy={player.audioBusy}
      audioStatusText={player.statusText}
      transportBusy={player.transportBusy}
      debugToolsEnabled={import.meta.env.DEV}
      debugToolsOpen={debugToolsOpen}
      beforeLayout={debugPanel}
      onDebugToolsOpenChange={setDebugToolsOpen}
      onProgressChange={player.setProgress}
      onProgressCommit={player.commitProgress}
      onOpenAudio={player.openAudio}
      onPrevious={player.previous}
      onNext={player.next}
      onPlayToggle={player.togglePlayback}
      onShuffleCycle={player.cycleShuffleMode}
      onRepeatCycle={player.cycleRepeatMode}
      onFeedbackChange={player.toggleTrackFeedback}
      onVolumeChange={player.changeVolume}
      onQueueToggle={player.toggleQueue}
      onQueueTrackSelect={player.selectQueueTrack}
    />
  )
}

export default PlayerShell
