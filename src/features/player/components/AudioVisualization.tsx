import { useEffect, useRef } from 'react'
import { listenAudioVisualizationFrame } from '@/features/player/services/audioCommands'

const SOURCE_BAR_COUNT = 48
const DISPLAY_BAR_COUNT = 112
const BASELINE = .035
const EMPTY_SCALE = `scaleY(${BASELINE})`

function clampBand(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function updateSpectrumLevels(levels: Float32Array, bands: readonly number[]): void {
  for (let index = 0; index < DISPLAY_BAR_COUNT; index += 1) {
    // Every display column keeps one frequency position. Interpolation only
    // adds visual density between the 48 fixed low-to-high bands.
    const sourcePosition = index * (SOURCE_BAR_COUNT - 1) / (DISPLAY_BAR_COUNT - 1)
    const lowerIndex = Math.floor(sourcePosition)
    const upperIndex = Math.min(SOURCE_BAR_COUNT - 1, lowerIndex + 1)
    const mix = sourcePosition - lowerIndex
    const amplitude = clampBand(bands[lowerIndex]) * (1 - mix) + clampBand(bands[upperIndex]) * mix
    const target = Math.max(BASELINE, amplitude)
    const current = levels[index]
    const response = target > current ? .7 : .48
    levels[index] = current + (target - current) * response
  }
}

type AudioVisualizationProps = {
  variant: 'fullscreen' | 'ambient'
  trackId: string | null
  isPlaying: boolean
}

/** Updates only the bar elements, so incoming audio frames do not rerender the player. */
export function AudioVisualization({ variant, trackId, isPlaying }: AudioVisualizationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(-1)

  useEffect(() => {
    generationRef.current = -1
    const bars = rootRef.current?.querySelectorAll<HTMLElement>('.audio-visualization-bar')
    const levels = new Float32Array(DISPLAY_BAR_COUNT)
    levels.fill(BASELINE)
    bars?.forEach((bar) => { bar.style.transform = EMPTY_SCALE })
    if (!trackId || !isPlaying || !bars) return

    let disposed = false
    let unlisten: (() => void) | undefined
    void listenAudioVisualizationFrame((frame) => {
      if (disposed || frame.trackId !== trackId || !Number.isInteger(frame.generation)
        || frame.generation < generationRef.current || !Array.isArray(frame.bars)
        || frame.bars.length !== SOURCE_BAR_COUNT) return
      if (frame.generation > generationRef.current) levels.fill(BASELINE)
      generationRef.current = frame.generation
      updateSpectrumLevels(levels, frame.bars)
      bars.forEach((bar, index) => {
        bar.style.transform = `scaleY(${levels[index]})`
      })
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(() => {
      // The browser demo has no Tauri event bridge; the bars remain still.
    })
    return () => {
      disposed = true
      unlisten?.()
      bars.forEach((bar) => { bar.style.transform = EMPTY_SCALE })
    }
  }, [trackId, isPlaying])

  return (
    <div ref={rootRef} className={`audio-visualization audio-visualization-${variant}`} aria-hidden="true">
      <div className="audio-visualization-bars">
        {Array.from({ length: DISPLAY_BAR_COUNT }, (_, index) => (
          <span className="audio-visualization-bar" key={index} />
        ))}
      </div>
    </div>
  )
}
