import type { ChangeEvent, CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { formatDuration } from '@/features/player/model/trackUtils'
import type { SystemIcon } from '@/icons/systemIcons'
import { IconButton } from './IconButton'
import { VolumeControl } from './VolumeControl'

type ProgressStyle = CSSProperties & { '--progress-percent': string }

type ControlDockProps = {
  progress: number
  duration: number
  progressStyle: ProgressStyle
  disabled: boolean
  playing: boolean
  shuffleIcon: SystemIcon
  shuffleLabel: string
  shuffleSelected: boolean
  repeatIcon: SystemIcon
  repeatLabel: string
  repeatSelected: boolean
  captionsIcon: SystemIcon
  showTranslations: boolean
  volume: number
  queueOpen: boolean
  onProgressChange: (progress: number) => void
  onPrevious: () => void
  onNext: () => void
  onPlayToggle: () => void
  onShuffleCycle: () => void
  onRepeatCycle: () => void
  onCaptionsToggle: () => void
  onVolumeChange: (volume: number) => void
  onQueueToggle: () => void
}

export function ControlDock({
  progress,
  duration,
  progressStyle,
  disabled,
  playing,
  shuffleIcon,
  shuffleLabel,
  shuffleSelected,
  repeatIcon,
  repeatLabel,
  repeatSelected,
  captionsIcon,
  showTranslations,
  volume,
  queueOpen,
  onProgressChange,
  onPrevious,
  onNext,
  onPlayToggle,
  onShuffleCycle,
  onRepeatCycle,
  onCaptionsToggle,
  onVolumeChange,
  onQueueToggle,
}: ControlDockProps) {
  const systemIcons = useSystemIcons()

  function handleProgressChange(event: ChangeEvent<HTMLInputElement>) {
    onProgressChange(Number(event.currentTarget.value))
  }

  return (
    <footer className="control-dock" style={progressStyle}>
      <div className="progress-row">
        <time>{formatDuration(progress)}</time>
        <input aria-label={appCopy.progress.label} disabled={disabled || duration <= 0} max={duration} min="0" onChange={handleProgressChange} step="0.01" type="range" value={progress} />
        <time>{formatDuration(duration)}</time>
      </div>
      <div className="control-row">
        <div className="control-side"><IconButton icon={systemIcons.audioWave} label={appCopy.spectrum.title} disabled={disabled} /></div>
        <div className="transport">
          <IconButton icon={shuffleIcon} label={shuffleLabel} selected={shuffleSelected} disabled={disabled} onClick={onShuffleCycle} />
          <IconButton icon={systemIcons.previous} label={appCopy.controls.previous} disabled={disabled} onClick={onPrevious} />
          <Button className="play-button" aria-label={playing ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playing} disabled={disabled} size="icon-lg" onClick={onPlayToggle}>{playing ? <systemIcons.pause /> : <systemIcons.play />}</Button>
          <IconButton icon={systemIcons.next} label={appCopy.controls.next} disabled={disabled} onClick={onNext} />
          <IconButton icon={repeatIcon} label={repeatLabel} selected={repeatSelected} disabled={disabled} onClick={onRepeatCycle} />
        </div>
        <div className="control-side control-side-end">
          <IconButton icon={captionsIcon} label={appCopy.controls.captions} selected={showTranslations} onClick={onCaptionsToggle} />
          <VolumeControl volume={volume} disabled={disabled} onVolumeChange={onVolumeChange} />
          <IconButton icon={systemIcons.queue} label={appCopy.controls.queue} selected={queueOpen} onClick={onQueueToggle} />
        </div>
      </div>
    </footer>
  )
}
