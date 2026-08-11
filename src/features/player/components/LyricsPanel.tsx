import type { KeyboardEvent, RefObject } from 'react'
import { SettingsIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'
import { cn } from '@/lib/utils'

type LyricsPanelProps = {
  track: Track
  activeLyricId?: string
  activeLyricIndex: number
  lyricListRef: RefObject<HTMLOListElement | null>
  lyricRefs: RefObject<Map<string, HTMLLIElement>>
  tightThresholdSeconds: number
  onLineSelect: (timeSeconds: number) => void
}

type LyricPairSpacing = 'tight' | 'normal' | 'none'

function lyricPairSpacingForDelta(deltaSeconds: number | null, tightThresholdSeconds: number): LyricPairSpacing {
  if (deltaSeconds === null) return 'none'
  return Number.isFinite(deltaSeconds) && deltaSeconds >= 0 && deltaSeconds < tightThresholdSeconds
    ? 'tight'
    : 'normal'
}

export function LyricsPanel({ track, activeLyricId, activeLyricIndex, lyricListRef, lyricRefs, tightThresholdSeconds, onLineSelect }: LyricsPanelProps) {
  const appearanceMotion = useAppearanceMotion()

  function handleLineKeyDown(event: KeyboardEvent<HTMLLIElement>, timeSeconds: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onLineSelect(timeSeconds)
    }
  }

  return (
    <motion.section
      layout
      className={cn('lyrics-panel', !track.lyrics.length && 'track-lyrics-empty-panel')}
      variants={appearanceMotion.variants.track}
      initial="initial"
      animate="animate"
      aria-labelledby="lyrics-title"
    >
      <h2 id="lyrics-title" className="sr-only">{appCopy.lyrics.title}</h2>
      {track.lyrics.length ? (
        <ol ref={lyricListRef}>
          {track.lyrics.map((line, index) => {
            const nextLine = track.lyrics[index + 1]
            const pairDeltaSeconds = nextLine ? nextLine.timeSeconds - line.timeSeconds : null

            return (
              <li
                key={line.id}
                ref={(node) => {
                  if (node) lyricRefs.current.set(line.id, node)
                  else lyricRefs.current.delete(line.id)
                }}
                role="button"
                tabIndex={0}
                aria-current={line.id === activeLyricId ? 'true' : undefined}
                data-active={line.id === activeLyricId}
                data-line-content={line.translation ? 'bilingual' : 'single'}
                data-pair-delta-seconds={pairDeltaSeconds ?? undefined}
                data-pair-spacing={lyricPairSpacingForDelta(pairDeltaSeconds, tightThresholdSeconds)}
                data-position={index < activeLyricIndex ? 'past' : index === activeLyricIndex ? 'active' : 'future'}
                onClick={() => onLineSelect(line.timeSeconds)}
                onKeyDown={(event) => handleLineKeyDown(event, line.timeSeconds)}
              >
                <span>{line.original}</span>
                {line.translation ? <span className="translation-line" lang="zh-CN">{line.translation}</span> : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <Empty className="empty-lyrics-state track-lyrics-empty-state">
          <EmptyHeader>
            <EmptyTitle>{appCopy.lyrics.emptyTitle}</EmptyTitle>
            <EmptyDescription>{appCopy.lyrics.emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="track-lyrics-empty-actions">
              <Button
                type="button"
                variant="outline"
                disabled
                aria-describedby="lyrics-external-app-unavailable"
              >
                {appCopy.lyrics.openExternalApp}
              </Button>
              <Button
                className="track-lyrics-settings-button"
                type="button"
                variant="ghost"
                size="icon"
                disabled
                aria-label={appCopy.lyrics.settingsUnavailable}
                aria-describedby="lyrics-settings-unavailable"
              >
                <SettingsIcon data-icon="inline-start" aria-hidden="true" />
              </Button>
            </div>
            <div className="sr-only">
              <p id="lyrics-external-app-unavailable">{appCopy.lyrics.openExternalAppUnavailable}</p>
              <p id="lyrics-settings-unavailable">{appCopy.lyrics.settingsUnavailable}</p>
            </div>
          </EmptyContent>
        </Empty>
      )}
    </motion.section>
  )
}
