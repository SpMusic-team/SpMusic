import { useRef, type ChangeEvent, type CSSProperties, type FocusEvent, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
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
  desktopCaptionsAvailable: boolean
  desktopCaptionsEnabled: boolean
  volume: number
  volumeBusy: boolean
  volumeDisabled: boolean
  queueOpen: boolean
  audioBusy: boolean
  audioStatusText: string
  transportBusy: boolean
  onProgressChange: (progress: number) => void
  onProgressCommit: (progress: number) => void
  onOpenAudio: () => void
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
  desktopCaptionsAvailable,
  desktopCaptionsEnabled,
  volume,
  volumeBusy,
  volumeDisabled,
  queueOpen,
  audioBusy,
  audioStatusText,
  transportBusy,
  onProgressChange,
  onProgressCommit,
  onOpenAudio,
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
  const appearanceMotion = useAppearanceMotion()
  const progressCommitRef = useRef<{ value: number; at: number } | null>(null)

  function handleProgressChange(event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) {
    onProgressChange(Number(event.currentTarget.value))
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLInputElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleProgressCommit(event: PointerEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>) {
    if ('key' in event && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      return
    }

    const value = Number(event.currentTarget.value)
    const now = window.performance.now()
    const previous = progressCommitRef.current

    if (previous && Math.abs(previous.value - value) < 0.01 && now - previous.at < 240) {
      return
    }

    progressCommitRef.current = { value, at: now }
    onProgressCommit(value)
  }

  return (
    <motion.footer
      layout
      className="control-dock"
      style={progressStyle}
    >
      <p className="audio-status" aria-live="polite">{audioStatusText}</p>
      <div className="progress-row control-progress" aria-label={appCopy.progress.label}>
        <time className="control-progress-time control-progress-time-start">{formatDuration(progress)}</time>
        <input
          aria-label={appCopy.progress.label}
          disabled={audioBusy || transportBusy || disabled || duration <= 0}
          max={duration}
          min="0"
          onChange={handleProgressChange}
          onInput={handleProgressChange}
          onBlur={handleProgressCommit}
          onKeyUp={handleProgressCommit}
          onPointerDown={handleProgressPointerDown}
          onPointerUp={handleProgressCommit}
          step="0.01"
          type="range"
          value={progress}
        />
        <time className="control-progress-time control-progress-time-end">{formatDuration(duration)}</time>
      </div>
      <div className="control-row">
        <div className="control-auxiliary control-auxiliary-start"><IconButton icon={systemIcons.audioWave} label={appCopy.controls.openAudio} disabled={audioBusy || transportBusy} onClick={onOpenAudio} /></div>
        <div className="control-primary">
          <IconButton className="control-optional" icon={shuffleIcon} label={shuffleLabel} selected={shuffleSelected} disabled={disabled} onClick={onShuffleCycle} />
          <IconButton className="previous-button" icon={systemIcons.previous} label={appCopy.controls.previous} disabled={disabled || transportBusy} onClick={onPrevious} />
          <Button className="play-button" aria-busy={transportBusy} aria-label={playing ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playing} disabled={audioBusy || disabled} size="icon-lg" onClick={onPlayToggle}>
            <span className="player-control-icon-swap">
              <AnimatePresence initial={false}>
                <motion.span
                  key={playing ? 'pause' : 'play'}
                  className="player-control-icon-frame"
                  variants={appearanceMotion.variants.glyph}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  aria-hidden="true"
                >
                  {playing ? <systemIcons.pause /> : <systemIcons.play />}
                </motion.span>
              </AnimatePresence>
            </span>
          </Button>
          <IconButton className="next-button" icon={systemIcons.next} label={appCopy.controls.next} disabled={disabled || transportBusy} onClick={onNext} />
          <IconButton className="control-optional" icon={repeatIcon} label={repeatLabel} selected={repeatSelected} disabled={disabled} onClick={onRepeatCycle} />
        </div>
        <div className="control-auxiliary control-auxiliary-end">
          <IconButton
            animated
            className="control-optional"
            icon={captionsIcon}
            label={desktopCaptionsAvailable ? appCopy.controls.captions : appCopy.controls.captionsUnavailable}
            selected={desktopCaptionsEnabled}
            disabled={!desktopCaptionsAvailable}
            onClick={onCaptionsToggle}
          />
          <VolumeControl
            volume={volume}
            busy={volumeBusy}
            disabled={volumeDisabled}
            onVolumeChange={onVolumeChange}
          />
          <IconButton className="control-optional" icon={systemIcons.queue} label={appCopy.controls.queue} selected={queueOpen} onClick={onQueueToggle} />
        </div>
      </div>
    </motion.footer>
  )
}
