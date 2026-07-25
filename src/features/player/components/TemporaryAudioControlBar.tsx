import { Button } from '@/components/ui/button'
import { formatDuration } from '@/features/player/model/trackUtils'

const copy = {
  ariaLabel: '\u4e34\u65f6\u97f3\u9891\u63a7\u5236\u680f',
  empty: '\u672a\u9009\u62e9\u97f3\u9891',
  kicker: '\u4e34\u65f6\u63a7\u5236\u680f',
  open: '\u9009\u62e9\u6587\u4ef6',
  openAndPlay: '\u9009\u62e9\u5e76\u64ad\u653e',
  pause: '\u6682\u505c',
  play: '\u64ad\u653e',
  progress: '\u4e34\u65f6\u63a7\u5236\u680f\u64ad\u653e\u8fdb\u5ea6',
  refresh: '\u5237\u65b0\u72b6\u6001',
  stop: '\u505c\u6b62',
}

type TemporaryAudioControlBarProps = {
  busy: boolean
  duration: number
  fileName: string | null
  hasTrack: boolean
  phase: string
  playing: boolean
  progress: number
  statusText: string
  title: string | null
  transportBusy: boolean
  onOpen: () => void
  onOpenAndPlay: () => void
  onPlayToggle: () => void
  onProgressChange: (progress: number) => void
  onProgressCommit: (progress: number) => void
  onRefresh: () => void
  onStop: () => void
}

export function TemporaryAudioControlBar({
  busy,
  duration,
  fileName,
  hasTrack,
  phase,
  playing,
  progress,
  statusText,
  title,
  transportBusy,
  onOpen,
  onOpenAndPlay,
  onPlayToggle,
  onProgressChange,
  onProgressCommit,
  onRefresh,
  onStop,
}: TemporaryAudioControlBarProps) {
  const hasDuration = duration > 0
  const commitProgress = (value: string) => onProgressCommit(Number(value))
  const updateProgress = (value: string) => onProgressChange(Number(value))

  return (
    <section className="temporary-audio-control-bar" aria-label={copy.ariaLabel}>
      <div className="temporary-audio-control-copy">
        <span className="temporary-audio-control-kicker">{copy.kicker}</span>
        <strong>{title ?? fileName ?? copy.empty}</strong>
        <span>{statusText}</span>
      </div>

      <div className="temporary-audio-control-actions">
        <Button type="button" size="sm" disabled={busy || transportBusy} onClick={onOpenAndPlay}>
          {copy.openAndPlay}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || transportBusy} onClick={onOpen}>
          {copy.open}
        </Button>
        <Button type="button" size="sm" variant="outline" aria-busy={transportBusy} disabled={busy || !hasTrack} onClick={onPlayToggle}>
          {playing ? copy.pause : copy.play}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || transportBusy || !hasTrack} onClick={onStop}>
          <span className="temporary-stop-icon" aria-hidden="true" />
          {copy.stop}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || transportBusy} onClick={onRefresh}>
          {copy.refresh}
        </Button>
      </div>

      <label className="temporary-audio-control-progress">
        <span>{formatDuration(progress)}</span>
        <input
          aria-label={copy.progress}
          disabled={busy || transportBusy || !hasTrack || !hasDuration}
          max={duration}
          min="0"
          onBlur={(event) => commitProgress(event.currentTarget.value)}
          onChange={(event) => updateProgress(event.currentTarget.value)}
          onInput={(event) => updateProgress(event.currentTarget.value)}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
              commitProgress(event.currentTarget.value)
            }
          }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerUp={(event) => commitProgress(event.currentTarget.value)}
          step="0.01"
          type="range"
          value={progress}
        />
        <span>{formatDuration(duration)}</span>
      </label>

      <span className="temporary-audio-control-phase">phase: {phase}</span>
    </section>
  )
}
