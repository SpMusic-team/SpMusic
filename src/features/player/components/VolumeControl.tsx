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

export function VolumeControl({
  volume,
  disabled = false,
  busy = false,
  onVolumeChange,
}: VolumeControlProps) {
  const systemIcons = useSystemIcons()
  const panelId = useId()
  const controlRef = useRef<HTMLDivElement>(null)
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
