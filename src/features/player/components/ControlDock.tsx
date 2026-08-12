import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'
import { formatDuration } from '@/features/player/model/trackUtils'
import { IconButton } from './IconButton'
import { VolumeControl } from './VolumeControl'

type ControlDockProps = Pick<PlayerUiViewModel, 'playback' | 'timeline' | 'volume' | 'queue'>
type ProgressPressEndReason = 'pointerup' | 'pointercancel' | 'blur'

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
  const previewValueRef = useRef(timeline.positionSeconds)
  const progressSliderRef = useRef<HTMLDivElement>(null)
  const pressedPointerIdRef = useRef<number | null>(null)
  const pressEndRef = useRef<{ pointerId: number; reason: ProgressPressEndReason } | null>(null)
  const cancelProgressPreviewRef = useRef(timeline.onCancelPreview)
  const disabled = !playback.track
  const commandBusy = playback.isAudioBusy || playback.isTransportBusy || timeline.interaction === 'seeking'
  const progressDisabled = commandBusy || disabled || timeline.durationSeconds <= 0
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

  function readProgressValue(value: number | readonly number[]) {
    return Array.isArray(value) ? (value[0] ?? 0) : value as number
  }

  function handleProgressChange(value: number | readonly number[], reason: 'input-change' | 'track-press' | 'drag' | 'keyboard' | 'none') {
    if (timeline.interaction === 'seeking') return
    const nextValue = readProgressValue(value)
    previewValueRef.current = nextValue

    if (!pointerPreviewRef.current && !keyboardPreviewRef.current) {
      timeline.onPreviewStart()
    }
    if (reason === 'drag' || reason === 'track-press') {
      pointerPreviewRef.current = true
      keyboardPreviewRef.current = false
    } else {
      keyboardPreviewRef.current = true
    }
    timeline.onPreview(nextValue)
  }

  function commitPointerPreview(value: number | readonly number[]) {
    if (!pointerPreviewRef.current) return
    pointerPreviewRef.current = false
    timeline.onCommit(readProgressValue(value))
  }

  function cancelPointerPreview() {
    if (!pointerPreviewRef.current) return
    pointerPreviewRef.current = false
    timeline.onCancelPreview()
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (progressDisabled || !event.isPrimary || event.button !== 0 || pressedPointerIdRef.current !== null) return
    const target = event.target
    if (target instanceof Element && target.closest('[data-slot="slider-thumb"]')) {
      pressEndRef.current = null
      pressedPointerIdRef.current = event.pointerId
      progressSliderRef.current?.setAttribute('data-thumb-pressed', '')
    }
  }

  function finishProgressThumbPress(event: PointerEvent<HTMLDivElement>, reason: ProgressPressEndReason) {
    if (pressedPointerIdRef.current !== event.pointerId) return
    pressEndRef.current = { pointerId: event.pointerId, reason }
    pressedPointerIdRef.current = null
    progressSliderRef.current?.removeAttribute('data-thumb-pressed')
    if (reason === 'pointercancel') cancelPointerPreview()
  }

  function handleProgressLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
    if (pressedPointerIdRef.current !== event.pointerId) return
    const endedNormally = pressEndRef.current?.pointerId === event.pointerId
      && pressEndRef.current.reason === 'pointerup'
    pressedPointerIdRef.current = null
    pressEndRef.current = null
    progressSliderRef.current?.removeAttribute('data-thumb-pressed')
    if (!endedNormally) cancelPointerPreview()
  }

  function handleProgressKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (!keyboardPreviewRef.current) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    keyboardPreviewRef.current = false
    timeline.onCommit(previewValueRef.current)
  }

  function handleProgressBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    const pressedPointerId = pressedPointerIdRef.current
    if (pressedPointerId !== null) {
      pressEndRef.current = { pointerId: pressedPointerId, reason: 'blur' }
      pressedPointerIdRef.current = null
      progressSliderRef.current?.removeAttribute('data-thumb-pressed')
      cancelPointerPreview()
      return
    }
    if (pointerPreviewRef.current || keyboardPreviewRef.current) {
      pointerPreviewRef.current = false
      keyboardPreviewRef.current = false
      timeline.onCommit(previewValueRef.current)
    }
  }

  useEffect(() => {
    cancelProgressPreviewRef.current = timeline.onCancelPreview
  }, [timeline.onCancelPreview])

  useEffect(() => {
    const progressSliderElement = progressSliderRef.current

    function clearOwnedPointer(pointerId: number, reason: ProgressPressEndReason) {
      if (pressedPointerIdRef.current !== pointerId) return
      pressEndRef.current = { pointerId, reason }
      pressedPointerIdRef.current = null
      progressSliderElement?.removeAttribute('data-thumb-pressed')
      if (reason !== 'pointerup' && pointerPreviewRef.current) {
        pointerPreviewRef.current = false
        cancelProgressPreviewRef.current()
      }
    }

    function handleWindowPointerEnd(event: globalThis.PointerEvent) {
      clearOwnedPointer(event.pointerId, event.type === 'pointercancel' ? 'pointercancel' : 'pointerup')
    }

    function handleWindowBlur() {
      const pointerId = pressedPointerIdRef.current
      if (pointerId !== null) clearOwnedPointer(pointerId, 'blur')
    }

    window.addEventListener('pointerup', handleWindowPointerEnd)
    window.addEventListener('pointercancel', handleWindowPointerEnd)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointerup', handleWindowPointerEnd)
      window.removeEventListener('pointercancel', handleWindowPointerEnd)
      window.removeEventListener('blur', handleWindowBlur)
      pressedPointerIdRef.current = null
      pressEndRef.current = null
      progressSliderElement?.removeAttribute('data-thumb-pressed')
      if (pointerPreviewRef.current) {
        pointerPreviewRef.current = false
        cancelProgressPreviewRef.current()
      }
    }
  }, [])

  return (
    <motion.footer
      layout
      className="control-dock"
    >
      <p className="audio-status" aria-live="polite">{playback.statusText}</p>
      <div className="progress-row control-progress" aria-label={appCopy.progress.label}>
        <time className="control-progress-time control-progress-time-start">{formatDuration(timeline.positionSeconds)}</time>
        <Slider
          ref={progressSliderRef}
          className="control-progress-slider"
          data-seeking={timeline.interaction === 'seeking' ? '' : undefined}
          disabled={progressDisabled}
          getAriaLabel={() => appCopy.progress.label}
          max={timeline.durationSeconds}
          min={0}
          onBlur={handleProgressBlur}
          onKeyUp={handleProgressKeyUp}
          onLostPointerCapture={handleProgressLostPointerCapture}
          onPointerCancel={(event) => finishProgressThumbPress(event, 'pointercancel')}
          onPointerDown={handleProgressPointerDown}
          onPointerUp={(event) => finishProgressThumbPress(event, 'pointerup')}
          onValueChange={(value, eventDetails) => handleProgressChange(value, eventDetails.reason)}
          onValueCommitted={(value, eventDetails) => {
            if (eventDetails.reason !== 'keyboard') {
              const pressedPointerId = pressedPointerIdRef.current
              if (pressedPointerId !== null) {
                pressEndRef.current = { pointerId: pressedPointerId, reason: 'pointerup' }
              }
              commitPointerPreview(value)
            }
          }}
          step={0.01}
          value={timeline.positionSeconds}
        />
        <time className="control-progress-time control-progress-time-end">{formatDuration(timeline.durationSeconds)}</time>
      </div>
      <div className="control-row">
        <div className="control-auxiliary control-auxiliary-start"><IconButton icon={systemIcons.audioWave} label={appCopy.controls.openAudio} disabled={commandBusy} onClick={playback.onOpenAudio} /></div>
        <div className="control-primary">
          <IconButton className="control-optional" icon={ShuffleIcon} label={shuffleLabel} selected={playback.shuffleMode !== 'none'} disabled={disabled} onClick={playback.onShuffleCycle} />
          <IconButton className="previous-button" icon={systemIcons.previous} label={appCopy.controls.previous} disabled={disabled || commandBusy} onClick={playback.onPrevious} />
          <Button className="play-button" aria-busy={playback.isTransportBusy} aria-label={playback.isPlaying ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={playback.isPlaying} disabled={commandBusy || disabled} size="icon-lg" onClick={playback.onPlayToggle}>
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
          <IconButton className="next-button" icon={systemIcons.next} label={appCopy.controls.next} disabled={disabled || commandBusy} onClick={playback.onNext} />
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
