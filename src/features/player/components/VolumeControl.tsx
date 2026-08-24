import { useEffect, useId, useRef, useState } from 'react'
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

const VOLUME_WHEEL_STEP = 1

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
  const [open, setOpen] = useState(false)
  const panelOpen = open && !disabled
  const muted = volume === 0
  const buttonLabel = appCopy.volume.groupLabel

  function handleValueChange(value: number | readonly number[]) {
    const nextVolume = Array.isArray(value) ? value[0] : value
    onVolumeChange(nextVolume ?? 0)
  }

  function togglePanel() {
    if (disabled) return
    setOpen((value) => !value)
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
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [panelOpen])

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
      const currentVolume = Number.isFinite(latestVolumeRef.current)
        ? Math.min(100, Math.max(0, Math.round(latestVolumeRef.current)))
        : 0
      const nextVolume = Math.min(
        100,
        Math.max(0, currentVolume + (delta < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP)),
      )
      if (nextVolume === currentVolume) return
      latestVolumeRef.current = nextVolume
      onVolumeChangeRef.current(nextVolume)
    }

    panel.addEventListener('wheel', handleWheel, { passive: false })
    return () => panel.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div className="volume-control" data-muted={muted} data-open={panelOpen} ref={controlRef}>
      <IconButton
        icon={systemIcons.volume}
        label={buttonLabel}
        selected={panelOpen}
        aria-controls={panelId}
        aria-expanded={panelOpen}
        disabled={disabled}
        onClick={togglePanel}
      />
      <div
        ref={panelRef}
        className="volume-panel"
        id={panelId}
        role="group"
        aria-busy={busy}
        aria-label={appCopy.volume.groupLabel}
        aria-hidden={!panelOpen}
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
