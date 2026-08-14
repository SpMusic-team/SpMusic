import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { SettingsIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import { locateLyricTimeline } from '@/features/player/model/lyricTimeline'
import type { PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { Track } from '@/features/player/model/playerTypes'
import type { PlayerVisualTimelineClock } from '@/features/player/model/visualTimelineClock'
import { cn } from '@/lib/utils'

type LyricsPanelProps = {
  track: Track
  detailsPending?: boolean
  positionSeconds: number
  interaction: PlayerTimelineInteraction
  visualClock?: PlayerVisualTimelineClock
  lyricLayoutKey: string
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

export function LyricsPanel({
  track,
  detailsPending = false,
  positionSeconds,
  interaction,
  visualClock,
  lyricLayoutKey,
  tightThresholdSeconds,
  onLineSelect,
}: LyricsPanelProps) {
  const appearanceMotion = useAppearanceMotion()
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const semanticTimeline = useMemo(
    () => locateLyricTimeline(track.lyrics, positionSeconds),
    [positionSeconds, track.lyrics],
  )
  const [followingTimeline, setFollowingTimeline] = useState(() => ({
    lyrics: track.lyrics,
    activeIndex: semanticTimeline?.currentIndex ?? -1,
    positionSeconds: visualClock?.getPositionSeconds() ?? positionSeconds,
  }))
  const followingTimelineIdentityRef = useRef({
    lyrics: track.lyrics,
    activeIndex: semanticTimeline?.currentIndex ?? -1,
  })
  const useFollowingTimeline = Boolean(visualClock)
    && interaction === 'following'
    && followingTimeline.lyrics === track.lyrics
  const activeLyricIndex = useFollowingTimeline
    ? followingTimeline.activeIndex
    : semanticTimeline?.currentIndex ?? -1
  const activePositionSeconds = useFollowingTimeline
    ? followingTimeline.positionSeconds
    : positionSeconds
  const activeLyricId = activeLyricIndex >= 0 ? track.lyrics[activeLyricIndex]?.id : undefined

  useEffect(() => {
    if (!visualClock) return
    let disposed = false
    const updateActiveLyric = () => {
      if (disposed || interaction !== 'following') return
      const nextPositionSeconds = visualClock.getPositionSeconds()
      const nextTimeline = locateLyricTimeline(track.lyrics, nextPositionSeconds)
      const nextActiveIndex = nextTimeline?.currentIndex ?? -1
      const previousIdentity = followingTimelineIdentityRef.current
      if (previousIdentity.lyrics === track.lyrics && previousIdentity.activeIndex === nextActiveIndex) return
      followingTimelineIdentityRef.current = { lyrics: track.lyrics, activeIndex: nextActiveIndex }
      setFollowingTimeline({
        lyrics: track.lyrics,
        activeIndex: nextActiveIndex,
        positionSeconds: nextPositionSeconds,
      })
    }
    const unsubscribe = visualClock.subscribe(updateActiveLyric)
    queueMicrotask(updateActiveLyric)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [interaction, track.lyrics, visualClock])

  useActiveLyricScroll(
    activePositionSeconds,
    interaction,
    track.lyrics,
    lyricListRef,
    lyricRefs,
    lyricLayoutKey,
  )

  function handleLineKeyDown(event: KeyboardEvent<HTMLLIElement>, timeSeconds: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onLineSelect(timeSeconds)
    }
  }

  function handleLineClick(event: MouseEvent<HTMLLIElement>, timeSeconds: number) {
    onLineSelect(timeSeconds)
    if (event.detail > 0) event.currentTarget.blur()
  }

  return (
    <motion.section
      layout
      className={cn('lyrics-panel', (detailsPending || !track.lyrics.length) && 'track-lyrics-empty-panel')}
      variants={appearanceMotion.variants.track}
      initial="initial"
      animate="animate"
      aria-labelledby="lyrics-title"
      aria-busy={detailsPending}
    >
      <h2 id="lyrics-title" className="sr-only">{appCopy.lyrics.title}</h2>
      {detailsPending ? (
        <Empty className="empty-lyrics-state track-lyrics-empty-state" data-content-state="loading">
          <EmptyHeader>
            <div className="player-loading-lyrics" aria-hidden="true">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
            <EmptyTitle className="sr-only">{appCopy.audio.loading}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : track.lyrics.length ? (
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
                onClick={(event) => handleLineClick(event, line.timeSeconds)}
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
