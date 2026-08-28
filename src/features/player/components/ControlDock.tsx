import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import {
  nextRepeatMode,
  nextShuffleMode,
  type RepeatMode,
  type ShuffleMode,
} from '@/features/player/model/playbackModes'
import type { PlayerTimelineViewModel, PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'
import { formatDuration } from '@/features/player/model/trackUtils'
import type { SystemIcon } from '@/icons/systemIcons'
import { IconButton } from './IconButton'
import { VolumeControl } from './VolumeControl'

type ControlDockProps = Pick<PlayerUiViewModel, 'playback' | 'timeline' | 'volume' | 'queue'> & {
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  playbackVisualReady: boolean
  onPlayToggle: () => void
}
type ProgressPressEndReason = 'pointerup' | 'pointercancel' | 'blur'

type ProgressControlProps = {
  timeline: PlayerTimelineViewModel
  disabled: boolean
  isPlaying: boolean
}

type PlaybackModePresentation = {
  icon: SystemIcon
  label: string
  pressed: boolean
}

const playbackModeToastId = 'player-playback-mode'

function showPlaybackModeToast({ icon: ModeIcon, label }: PlaybackModePresentation) {
  toast.custom(
    () => (
      <div className="playback-mode-toast">
        <ModeIcon aria-hidden="true" />
        <span>{label}</span>
      </div>
    ),
    {
      id: playbackModeToastId,
      className: 'playback-mode-toast-shell',
      duration: 2500,
      position: 'top-center',
      unstyled: true,
    },
  )
}

const ProgressControl = memo(function ProgressControl({ timeline, disabled, isPlaying }: ProgressControlProps) {
  const [semanticPosition, setSemanticPosition] = useState(timeline.positionSeconds)
  const pointerPreviewRef = useRef(false)
  const keyboardPreviewRef = useRef(false)
  const previewValueRef = useRef(timeline.positionSeconds)
  const progressSliderRef = useRef<HTMLDivElement>(null)
  const progressTimeRef = useRef<HTMLTimeElement>(null)
  const timelineInteractionRef = useRef(timeline.interaction)
  const timelineDurationRef = useRef(timeline.durationSeconds)
  const lastVisualSecondRef = useRef(Math.floor(timeline.positionSeconds))
  const pressedPointerIdRef = useRef<number | null>(null)
  const pressEndRef = useRef<{ pointerId: number; reason: ProgressPressEndReason } | null>(null)
  const cancelProgressPreviewRef = useRef(timeline.onCancelPreview)
  const progressDisabled = disabled || timeline.durationSeconds <= 0
  const sliderPosition = timeline.interaction === 'following' && timeline.visualClock
    ? semanticPosition
    : timeline.positionSeconds

  const updateVisualProgress = useCallback(() => {
    if (!timeline.visualClock || timelineInteractionRef.current !== 'following') return
    const durationSeconds = timelineDurationRef.current
    const positionSeconds = Math.min(
      Math.max(timeline.visualClock.getPositionSeconds(), 0),
      durationSeconds > 0 ? durationSeconds : 0,
    )
    const percentage = durationSeconds > 0 ? positionSeconds / durationSeconds * 100 : 0
    progressSliderRef.current?.style.setProperty('--player-visual-progress', `${percentage}%`)
    const wholeSecond = Math.floor(positionSeconds)
    if (wholeSecond === lastVisualSecondRef.current) return
    lastVisualSecondRef.current = wholeSecond
    if (progressTimeRef.current) progressTimeRef.current.textContent = formatDuration(positionSeconds)
  }, [timeline.visualClock])

  function readProgressValue(value: number | readonly number[]) {
    return Array.isArray(value) ? (value[0] ?? 0) : value as number
  }

  function handleProgressChange(value: number | readonly number[], reason: 'input-change' | 'track-press' | 'drag' | 'keyboard' | 'none') {
    if (timeline.interaction === 'seeking') return
    const nextValue = readProgressValue(value)
    previewValueRef.current = nextValue
    if (!pointerPreviewRef.current && !keyboardPreviewRef.current) timeline.onPreviewStart()
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
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setSemanticPosition(timeline.positionSeconds)
    })
    return () => { cancelled = true }
  }, [timeline.interaction, timeline.positionSeconds])

  useEffect(() => {
    const visualClock = timeline.visualClock
    if (!visualClock || !isPlaying || timeline.interaction !== 'following') return
    const sampleSemanticPosition = () => {
      const nextPosition = Math.min(
        Math.max(visualClock.getPositionSeconds(), 0),
        timeline.durationSeconds > 0 ? timeline.durationSeconds : 0,
      )
      setSemanticPosition((previous) => previous === nextPosition ? previous : nextPosition)
    }
    const intervalId = window.setInterval(sampleSemanticPosition, 500)
    return () => window.clearInterval(intervalId)
  }, [isPlaying, timeline.durationSeconds, timeline.interaction, timeline.visualClock])

  useEffect(() => {
    if (!timeline.visualClock) return
    updateVisualProgress()
    return timeline.visualClock.subscribe(updateVisualProgress)
  }, [timeline.visualClock, updateVisualProgress])

  useLayoutEffect(() => {
    timelineInteractionRef.current = timeline.interaction
    timelineDurationRef.current = timeline.durationSeconds
    if (timeline.interaction !== 'following') lastVisualSecondRef.current = Math.floor(timeline.positionSeconds)
    updateVisualProgress()
  }, [timeline.durationSeconds, timeline.interaction, timeline.positionSeconds, updateVisualProgress])

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
    <div className="progress-row control-progress" aria-label={appCopy.progress.label}>
      <time ref={progressTimeRef} className="control-progress-time control-progress-time-start">{formatDuration(sliderPosition)}</time>
      <Slider
        ref={progressSliderRef}
        className="control-progress-slider"
        data-visual-clock={timeline.visualClock ? '' : undefined}
        data-timeline-interaction={timeline.interaction}
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
            if (pressedPointerId !== null) pressEndRef.current = { pointerId: pressedPointerId, reason: 'pointerup' }
            commitPointerPreview(value)
          }
        }}
        step={0.01}
        value={sliderPosition}
      />
      <time className="control-progress-time control-progress-time-end">{formatDuration(timeline.durationSeconds)}</time>
    </div>
  )
})

export function ControlDock({
  playback,
  timeline,
  volume,
  queue,
  visualIsPlaying,
  playbackTransitionPending,
  playbackVisualReady,
  onPlayToggle,
}: ControlDockProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const disabled = !playback.track
  const playbackCommandBusy = playback.isAudioBusy
    || playback.isTransportBusy
    || playback.isSelectionPending
  const navigationBusy = playback.isAudioBusy
    || playback.isTransportBusy
    || playbackTransitionPending
    || timeline.interaction === 'seeking'
  const commandBusy = navigationBusy || playback.isSelectionPending
  const playToggleBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || (playback.isTransportBusy && !playbackTransitionPending)
  const volumeControlDisabled = commandBusy
    || disabled
    || (volume.isDisabled && !volume.isBusy)
  const shuffleModePresentations: Record<ShuffleMode, PlaybackModePresentation> = {
    none: { icon: systemIcons.shuffleOff, label: appCopy.controls.shuffleOff, pressed: false },
    'shuffle-all': { icon: systemIcons.shuffle, label: appCopy.controls.shuffle, pressed: true },
    'shuffle-category-order': { icon: systemIcons.shuffleCategoryOrder, label: appCopy.controls.shuffleCategoryOrder, pressed: true },
    'shuffle-category-random': { icon: systemIcons.shuffleCategoryRandom, label: appCopy.controls.shuffleCategoryRandom, pressed: true },
  }
  const repeatModePresentations: Record<RepeatMode, PlaybackModePresentation> = {
    'list-loop': { icon: systemIcons.repeat, label: appCopy.controls.repeat, pressed: false },
    'repeat-one': { icon: systemIcons.repeatOne, label: appCopy.controls.repeatOne, pressed: true },
    sequential: { icon: systemIcons.sequential, label: appCopy.controls.sequential, pressed: true },
    'all-categories-until-stop': { icon: systemIcons.playAllCategories, label: appCopy.controls.playAllCategories, pressed: true },
  }
  const shufflePresentation = shuffleModePresentations[playback.shuffleMode]
  const repeatPresentation = repeatModePresentations[playback.repeatMode]

  function handleShuffleCycle() {
    const nextMode = nextShuffleMode[playback.shuffleMode]
    playback.onShuffleCycle()
    showPlaybackModeToast(shuffleModePresentations[nextMode])
  }

  function handleRepeatCycle() {
    const nextMode = nextRepeatMode[playback.repeatMode]
    playback.onRepeatCycle()
    showPlaybackModeToast(repeatModePresentations[nextMode])
  }

  return (
    <motion.footer
      className="control-dock"
      data-playback-transition-pending={playbackTransitionPending ? '' : undefined}
      data-playback-command-busy={playbackCommandBusy ? '' : undefined}
      data-playback-visual-ready={playbackVisualReady ? 'true' : 'false'}
      data-timeline-seeking={timeline.interaction === 'seeking' ? '' : undefined}
    >
      <p className="audio-status" aria-live="polite">{playback.statusText}</p>
      <ProgressControl
        key={playback.track?.id ?? 'empty'}
        timeline={timeline}
        disabled={commandBusy || disabled}
        isPlaying={playback.isPlaying}
      />
      <div className="control-row">
        <div className="control-auxiliary control-auxiliary-start"><IconButton icon={systemIcons.audioWave} label={appCopy.controls.openAudio} disabled={commandBusy} onClick={playback.onOpenAudio} /></div>
        <div className="control-primary" data-playback-state={visualIsPlaying ? 'playing' : 'paused'}>
          <IconButton className="control-optional" icon={shufflePresentation.icon} label={shufflePresentation.label} selected={shufflePresentation.pressed} disabled={disabled} onClick={handleShuffleCycle} />
          <div className="control-transport">
            <IconButton className="previous-button" icon={systemIcons.previous} label={appCopy.controls.previous} disabled={disabled || navigationBusy} onClick={playback.onPrevious} />
            <Button className="play-button" aria-busy={playback.isTransportBusy || playback.isSelectionPending || playbackTransitionPending || !playbackVisualReady} aria-label={visualIsPlaying ? appCopy.controls.pause : appCopy.controls.play} aria-pressed={visualIsPlaying} disabled={playToggleBusy || disabled || !playbackVisualReady} size="icon-lg" onClick={onPlayToggle}>
              <span className="player-control-icon-swap">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={visualIsPlaying ? 'pause' : 'play'}
                    className="player-control-icon-frame"
                    variants={appearanceMotion.variants.glyph}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    aria-hidden="true"
                  >
                    {visualIsPlaying ? <systemIcons.pause /> : <systemIcons.play />}
                  </motion.span>
                </AnimatePresence>
              </span>
            </Button>
            <IconButton className="next-button" icon={systemIcons.next} label={appCopy.controls.next} disabled={disabled || navigationBusy} onClick={playback.onNext} />
          </div>
          <IconButton className="control-optional" icon={repeatPresentation.icon} label={repeatPresentation.label} selected={repeatPresentation.pressed} disabled={disabled} onClick={handleRepeatCycle} />
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
            disabled={volumeControlDisabled}
            onVolumeChange={volume.onChange}
          />
          <IconButton className="control-optional" icon={systemIcons.queue} label={appCopy.controls.queue} selected={queue.isOpen} onClick={queue.onToggle} />
        </div>
      </div>
    </motion.footer>
  )
}
