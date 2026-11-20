import { lazy, Suspense, type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { DevAudioToolsViewModel } from '@/features/player/model/playerUiViewModel'

const devAudioToolsEnabled = import.meta.env.DEV

const TemporaryAudioControlBar = devAudioToolsEnabled
  ? lazy(() => import('@/features/player/components/TemporaryAudioControlBar').then((module) => ({
      default: module.TemporaryAudioControlBar,
    })))
  : null

type DevAudioToolsSlotProps = {
  viewModel: DevAudioToolsViewModel
  isOpen: boolean
  onClose: () => void
}

type DevAudioToolsAvailabilityProps = {
  children: (isAvailable: boolean) => ReactNode
}

export function DevAudioToolsAvailability({ children }: DevAudioToolsAvailabilityProps) {
  return children(devAudioToolsEnabled)
}

export function DevAudioToolsSlot({ viewModel, isOpen, onClose }: DevAudioToolsSlotProps) {
  if (!devAudioToolsEnabled || !isOpen || !TemporaryAudioControlBar) return null

  return (
    <Suspense
      fallback={(
        <Skeleton
          aria-label="正在加载临时音频控制台"
          className="temporary-audio-control-bar h-32"
          role="status"
        />
      )}
    >
      <TemporaryAudioControlBar
        busy={viewModel.isAudioBusy}
        duration={viewModel.durationSeconds}
        fileName={viewModel.fileName}
        hasTrack={viewModel.hasTrack}
        phase={viewModel.phase}
        playing={viewModel.isPlaying}
        progress={viewModel.positionSeconds}
        statusText={viewModel.statusText}
        title={viewModel.title}
        transportBusy={viewModel.isTransportBusy}
        onOpen={viewModel.onOpen}
        onOpenAndPlay={viewModel.onOpenAndPlay}
        onPlayToggle={viewModel.onPlayToggle}
        onProgressChange={viewModel.onPreview}
        onProgressCommit={viewModel.onCommit}
        onRefresh={viewModel.onRefresh}
        onStop={viewModel.onStop}
        onClose={onClose}
      />
    </Suspense>
  )
}
