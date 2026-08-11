import { useRef, type ChangeEvent, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'
import { formatDuration } from '@/features/player/model/trackUtils'
import { IconButton } from './IconButton'
import { VolumeControl } from './VolumeControl'

type ProgressStyle = CSSProperties & { '--progress-percent': string }

type ControlDockProps = Pick<PlayerUiViewModel, 'playback' | 'timeline' | 'volume' | 'queue'>

export function ControlDock({
  playback,
  timeline,
  volume,
  queue,
}: ControlDockProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const pointerPreviewRef = useRef(false)
  const keyboardPreviewRef = useRef(false)
  const disabled = !playback.track
  const progressStyle: ProgressStyle = {
    '--progress-percent': `${timeline.durationSeconds ? timeline.positionSeconds / timeline.durationSeconds * 100 : 0}%`,
  }
  const ShuffleIcon = playback.shuffleMode === 'shuffle-all'
    ? systemIcons.shuffleOff
    : playback.shuffleMode === 'shuffle-category-order'
      ? systemIcons.shuffleCategoryOrder
      : playback.shuffleMode === 'shuffle-category-random'
        ? systemIcons.shuffleCategoryRandom
        : systemIcons.shuffle
  const shuffleLabel = playback.shuffleMode === 'shuffle-all'
    ? appCopy.controls.shuffleOff
    : playback.shuffleMode === 'shuffle-category-order'
      ? appCopy.controls.shuffleCategoryOrder
      : playback.shuffleMode === 'shuffle-category-random'
        ? appCopy.controls.shuffleCategoryRandom
        : appCopy.controls.shuffle
  const RepeatIcon = playback.repeatMode === 'repeat-one'
    ? systemIcons.repeatOne
    : playback.repeatMode === 'sequential'
      ? systemIcons.sequential
      : playback.repeatMode === 'all-categories-until-stop'
        ? systemIcons.playAllCategories
        : systemIcons.repeat
  const repeatLabel = playback.repeatMode === 'repeat-one'
    ? appCopy.controls.repeatOne
    : playback.repeatMode === 'sequential'
      ? appCopy.controls.sequential
      : playback.repeatMode === 'all-categories-until-stop'
        ? appCopy.controls.playAllCategories
        : appCopy.controls.repeat

  function handleProgressChange(event: ChangeEvent<HTMLInputElement>) {
    if (timeline.interaction === 'seeking') return
    if (!pointerPreviewRef.current && !keyboardPreviewRef.current) {
      keyboardPreviewRef.current = true
      timeline.onPreviewStart()
    }
    timeline.onPreview(Number(event.currentTarget.value))
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLInputElement>) {
    if (timeline.interaction === 'seeking') return
    pointerPreviewRef.current = true
    keyboardPreviewRef.current = false
    timeline.onPreviewStart()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function commitPointerPreview(event: PointerEvent<HTMLInputElement>) {
    if (!pointerPreviewRef.current) return
    pointerPreviewRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    timeline.onCommit(Number(event.currentTarget.value))
  }

  function cancelPointerPreview(event: PointerEvent<HTMLInputElement>) {
    if (!pointerPreviewRef.current) return
    pointerPreviewRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    timeline.onCancelPreview()
  }

  function handleProgressKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    if (!keyboardPreviewRef.current) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    keyboardPreviewRef.current = false
    timeline.onCommit(Number(event.currentTarget.value))
  }

  function handleProgressBlur(event: FocusEvent<HTMLInputElement>) {
    if (pointerPreviewRef.current || keyboardPreviewRef.current) {
      pointerPreviewRef.current = false
      keyboardPreviewRef.current = false
      timeline.onCommit(Number(event.currentTarget.value))
    }
  }

  return (
    <motion.footer
      layout
      className="control-dock"
      style={progressStyle}
    >
      <p className="audio-status" aria-live="polite">{playback.statusText}</p>
      <div className="progress-row control-progress" aria-label={appCopy.progress.label}>
        <time className="control-progress-time control-progress-time-start">{formatDuration(timeline.positionSeconds)}</time>
        <input
          aria-label={appCopy.progress.label}
          disabled={playback.isAudioBusy || playback.isTransportBusy || disabled || timeline.durationSeconds <= 0 || timeline.interaction === 'seeking'}
          max={timeline.durationSeconds}
          min="0"
          onChange={handleProgressChange}
          onBlur={handleProgressBlur}
          onKeyUp={handleProgressKeyUp}
          onPointerDown={handleProgressPointerDown}
          onPointerCancel={cancelPointerPreview}
          onPointerUp={commitPointerPreview}
          step="0.01"
          type="range"
          value={timeline.positionSeconds}
        />
        <time className="control-progress-time control-progress-time-end">{formatDuration(timeline.durationSeconds)}</time>
      </div>
      <div className="control-row">
        <div className="control-auxiliary control-auxiliary-start"><IconButton icon={systemIcons.audioWave} label={appCopy.controls.openAudio} disabled={playback.isAudioBusy || playback.isTransportBusy} onClick={playback.onOpenAudio} /></div>
        <div className="control-primary">
          <IconButton className="control-optional" icon={ShuffleIcon} label={shuffleLabel} selected={playback.shuffleMode !== 'none'} disabled={disabled} onClick={playback.onShuffleCycle} />
          <IconButton className="previous-button" icon={systemIcons.previous} label={appCopy.controls.previous} disabled={disabled || playback.isTransportBusy} onClick={playback.onPrevious} />
          <Button className="play-button" aria-busy={playback.isTransportBusy} aria-label={playback.isPlaying ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playback.isPlaying} disabled={playback.isAudioBusy || disabled} size="icon-lg" onClick={playback.onPlayToggle}>
            <span className="player-control-icon-swap">
              <AnimatePresence initial={false}>
                <motion.span
                  key={playback.isPlaying ? 'pause' : 'play'}
                  className="player-control-icon-frame"
                  variants={appearanceMotion.variants.glyph}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  aria-hidden="true"
                >
                  {playback.isPlaying ? <systemIcons.pause /> : <systemIcons.play />}
                </motion.span>
              </AnimatePresence>
            </span>
          </Button>
          <IconButton className="next-button" icon={systemIcons.next} label={appCopy.controls.next} disabled={disabled || playback.isTransportBusy} onClick={playback.onNext} />
          <IconButton className="control-optional" icon={RepeatIcon} label={repeatLabel} selected={playback.repeatMode !== 'list-loop'} disabled={disabled} onClick={playback.onRepeatCycle} />
        </div>
        <div className="control-auxiliary control-auxiliary-end">
          <IconButton
            animated
            className="control-optional"
            icon={systemIcons.captions}
            label={appCopy.controls.captionsUnavailable}
            selected={false}
            disabled
            onClick={() => undefined}
          />
          <VolumeControl
            volume={volume.valuePercent}
            busy={volume.isBusy}
            disabled={volume.isDisabled}
            onVolumeChange={volume.onChange}
          />
          <IconButton className="control-optional" icon={systemIcons.queue} label={appCopy.controls.queue} selected={queue.isOpen} onClick={queue.onToggle} />
        </div>
      </div>
    </motion.footer>
  )
}
