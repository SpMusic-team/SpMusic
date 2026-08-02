import { FolderOpenIcon, PauseIcon, PlayIcon, RefreshCwIcon, SquareIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { formatDuration } from '@/features/player/model/trackUtils'

const copy = {
  ariaLabel: '\u4e34\u65f6\u97f3\u9891\u63a7\u5236\u53f0',
  close: '\u5173\u95ed\u4e34\u65f6\u97f3\u9891\u63a7\u5236\u53f0',
  empty: '\u672a\u9009\u62e9\u97f3\u9891',
  kicker: '\u4e34\u65f6\u97f3\u9891\u63a7\u5236\u53f0',
  open: '\u9009\u62e9\u6587\u4ef6',
  openAndPlay: '\u9009\u62e9\u5e76\u64ad\u653e',
  pause: '\u6682\u505c',
  play: '\u64ad\u653e',
  progress: '\u4e34\u65f6\u97f3\u9891\u63a7\u5236\u53f0\u64ad\u653e\u8fdb\u5ea6',
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
  onClose: () => void
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
  onClose,
}: TemporaryAudioControlBarProps) {
  const hasDuration = duration > 0
  const safeProgress = hasDuration ? Math.min(Math.max(progress, 0), duration) : 0
  const readProgressValue = (value: number | readonly number[]) => Array.isArray(value) ? (value[0] ?? 0) : value as number

  return (
    <Card className="temporary-audio-control-bar" role="region" aria-label={copy.ariaLabel} size="sm">
      <CardHeader>
        <CardTitle>{copy.kicker}</CardTitle>
        <CardDescription className="temporary-audio-control-copy">
          <strong>{title ?? fileName ?? copy.empty}</strong>
          <span>{statusText}</span>
        </CardDescription>
        <CardAction className="temporary-audio-control-heading-actions">
          <Badge variant="secondary">phase: {phase}</Badge>
          <Button aria-label={copy.close} onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="temporary-audio-control-actions">
        <Button type="button" size="sm" disabled={busy || transportBusy} onClick={onOpenAndPlay}>
          <PlayIcon data-icon="inline-start" />
          {copy.openAndPlay}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || transportBusy} onClick={onOpen}>
          <FolderOpenIcon data-icon="inline-start" />
          {copy.open}
        </Button>
        <Button type="button" size="sm" variant="outline" aria-busy={transportBusy} disabled={busy || !hasTrack} onClick={onPlayToggle}>
          {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {playing ? copy.pause : copy.play}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || transportBusy || !hasTrack} onClick={onStop}>
          <SquareIcon data-icon="inline-start" />
          {copy.stop}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || transportBusy} onClick={onRefresh}>
          <RefreshCwIcon data-icon="inline-start" />
          {copy.refresh}
        </Button>
      </CardContent>

      <CardFooter className="temporary-audio-control-progress">
        <output>{formatDuration(safeProgress)}</output>
        <Slider
          disabled={busy || transportBusy || !hasTrack || !hasDuration}
          getAriaLabel={() => copy.progress}
          max={hasDuration ? duration : 1}
          min={0}
          onValueChange={(value) => onProgressChange(readProgressValue(value))}
          onValueCommitted={(value) => onProgressCommit(readProgressValue(value))}
          step={0.01}
          value={[safeProgress]}
        />
        <output>{formatDuration(duration)}</output>
      </CardFooter>
    </Card>
  )
}
