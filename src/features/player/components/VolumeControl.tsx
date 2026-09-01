import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { Slider } from '@/components/ui/slider'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { IconButton } from './IconButton'

type VolumeControlProps = {
  volume: number
  disabled?: boolean
  busy?: boolean
  onVolumeChange: (volume: number) => void
}

const VOLUME_WHEEL_STEP = 3

type VolumeOverscroll = 'above' | 'below' | null

export function VolumeControl({
  volume,
  disabled = false,
  busy = false,
  onVolumeChange,
}: VolumeControlProps) {
  const systemIcons = useSystemIcons()
  const panelId = useId()
  const controlRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const latestVolumeRef = useRef(volume)
  const disabledRef = useRef(disabled)
  const onVolumeChangeRef = useRef(onVolumeChange)
  const activeSliderPointerRef = useRef<number | null>(null)
  const sliderBoundsRef = useRef<{ top: number; bottom: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [sliderDragging, setSliderDragging] = useState(false)
  const [overscroll, setOverscroll] = useState<VolumeOverscroll>(null)
  const panelOpen = open && !disabled
  const muted = volume === 0
  const volumeIcon = volume >= 50
    ? systemIcons.volume
    : volume >= 30
      ? systemIcons.volumeMedium
      : volume > 0
        ? systemIcons.volumeLow
        : systemIcons.volumeMuted
  const buttonLabel = appCopy.volume.groupLabel

  function handleValueChange(value: number | readonly number[]) {
    const nextVolume = Array.isArray(value) ? value[0] : value
    onVolumeChange(nextVolume ?? 0)
  }

  function togglePanel() {
    if (disabled) return
    if (open) resetSliderOverscroll()
    setOpen(!open)
  }

  useEffect(() => {
    latestVolumeRef.current = volume
    disabledRef.current = disabled
    onVolumeChangeRef.current = onVolumeChange
  }, [disabled, onVolumeChange, volume])

  useEffect(() => {
    if (!panelOpen) return undefined

    function handlePointerDown(event: PointerEvent) {
      if (controlRef.current?.contains(event.target as Node)) return
      resetSliderOverscroll()
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        resetSliderOverscroll()
        setOpen(false)
      }
    }

    // The cover deck takes pointer capture while it is dragged and may suppress
    // the follow-up click. Close on the initial capture-phase press instead of
    // relying on that later bubbling/click path, while keeping presses inside
    // the volume control owned by this component.
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [panelOpen])

  function resetSliderOverscroll() {
    activeSliderPointerRef.current = null
    sliderBoundsRef.current = null
    setSliderDragging(false)
    setOverscroll(null)
  }

  useEffect(() => {
    window.addEventListener('blur', resetSliderOverscroll)
    return () => window.removeEventListener('blur', resetSliderOverscroll)
  }, [])

  function handleSliderPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return

    const slider = (event.target as Element).closest<HTMLElement>('[data-slot="slider"]')
    if (!slider || !event.currentTarget.contains(slider)) return

    const { top, bottom } = slider.getBoundingClientRect()
    activeSliderPointerRef.current = event.pointerId
    sliderBoundsRef.current = { top, bottom }
    setSliderDragging(true)
    setOverscroll(null)
  }

  function handleSliderPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerId !== activeSliderPointerRef.current) return

    const bounds = sliderBoundsRef.current
    if (!bounds) return

    // Keep the bounds captured at drag start. Once the panel shifts, reading
    // its new box would make the overscroll state oscillate under the pointer.
    const nextOverscroll: VolumeOverscroll = event.clientY < bounds.top
      ? 'above'
      : event.clientY > bounds.bottom
        ? 'below'
        : null
    setOverscroll((current) => current === nextOverscroll ? current : nextOverscroll)
  }

  function handleSliderPointerEndCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerId !== activeSliderPointerRef.current) return
    resetSliderOverscroll()
  }

  function adjustVolumeForWheel(delta: number) {
    if (disabledRef.current || !Number.isFinite(delta) || delta === 0) return

    const currentVolume = Number.isFinite(latestVolumeRef.current)
      ? Math.min(100, Math.max(0, Math.round(latestVolumeRef.current)))
      : 0
    const nextVolume = Math.min(
      100,
      Math.max(0, currentVolume + (delta < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP)),
    )
    if (nextVolume === currentVolume) return

    // Keep the local value ahead of React's next render so a rapid wheel
    // sequence remains incremental while useAudioPlayer coalesces commands.
    latestVolumeRef.current = nextVolume
    onVolumeChangeRef.current(nextVolume)
  }

  function handleButtonWheel(event: WheelEvent<HTMLButtonElement>) {
    if (disabled) return
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX
    if (!Number.isFinite(delta) || delta === 0) return

    // The pointer is over the volume button, so this gesture belongs to the
    // player rather than the page beneath the fixed control dock.
    event.preventDefault()
    adjustVolumeForWheel(delta)
  }

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    function handleWheel(event: globalThis.WheelEvent) {
      if (disabledRef.current) return
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX
      if (!Number.isFinite(delta) || delta === 0) return

      // Keep wheel input owned by the open volume surface, including at 0/100,
      // so a boundary gesture cannot scroll an underlying player surface.
      event.preventDefault()
      adjustVolumeForWheel(delta)
    }

    panel.addEventListener('wheel', handleWheel, { passive: false })
    return () => panel.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div className="volume-control" data-muted={muted} data-open={panelOpen} ref={controlRef}>
      <IconButton
        icon={volumeIcon}
        label={buttonLabel}
        selected={panelOpen}
        aria-controls={panelId}
        aria-expanded={panelOpen}
        disabled={disabled}
        onClick={togglePanel}
        onWheel={handleButtonWheel}
      />
      <div
        ref={panelRef}
        className="volume-panel"
        data-overscroll={overscroll ?? undefined}
        data-slider-dragging={sliderDragging || undefined}
        id={panelId}
        role="group"
        aria-busy={busy}
        aria-label={appCopy.volume.groupLabel}
        aria-hidden={!panelOpen}
        onLostPointerCapture={handleSliderPointerEndCapture}
        onPointerCancel={handleSliderPointerEndCapture}
        onPointerDownCapture={handleSliderPointerDownCapture}
        onPointerMoveCapture={handleSliderPointerMoveCapture}
        onPointerUpCapture={handleSliderPointerEndCapture}
      >
        <Slider
          className="volume-slider"
          disabled={disabled}
          getAriaLabel={() => appCopy.volume.label}
          getAriaValueText={(_, value) => appCopy.volume.value(value)}
          max={100}
          min={0}
          onValueChange={handleValueChange}
          orientation="vertical"
          step={1}
          value={[volume]}
        />
        <output className="volume-value">{appCopy.volume.value(volume)}</output>
      </div>
    </div>
  )
}
