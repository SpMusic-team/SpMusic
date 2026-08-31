import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
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

type LyricVisualLines = {
  original: string[]
  translation?: string[]
}

type LyricVisualLinesById = Record<string, LyricVisualLines>

function lyricPairSpacingForDelta(deltaSeconds: number | null, tightThresholdSeconds: number): LyricPairSpacing {
  if (deltaSeconds === null) return 'none'
  return Number.isFinite(deltaSeconds) && deltaSeconds >= 0 && deltaSeconds < tightThresholdSeconds
    ? 'tight'
    : 'normal'
}

function splitTextByRenderedLines(element: HTMLElement, text: string): string[] {
  const textNode = element.firstChild
  if (!(textNode instanceof Text) || !text) return text ? [text] : []

  const range = document.createRange()
  const segments: string[] = []
  let lineStart = 0
  let currentLineTop: number | null = null
  let offset = 0

  for (const character of text) {
    const nextOffset = offset + character.length
    range.setStart(textNode, offset)
    range.setEnd(textNode, nextOffset)
    const rect = range.getClientRects().item(0)
    const lineTop: number | null = rect ? rect.top : currentLineTop
    if (lineTop !== null && currentLineTop !== null && Math.abs(lineTop - currentLineTop) > 1) {
      segments.push(text.slice(lineStart, offset))
      lineStart = offset
    }
    if (lineTop !== null) currentLineTop = lineTop
    offset = nextOffset
  }

  segments.push(text.slice(lineStart))
  range.detach()
  return segments.filter((segment) => segment.length > 0)
}

function visualLinesEqual(left: LyricVisualLinesById, right: LyricVisualLinesById): boolean {
  const leftIds = Object.keys(left)
  const rightIds = Object.keys(right)
  if (leftIds.length !== rightIds.length) return false
  return leftIds.every((id) => {
    const leftLine = left[id]
    const rightLine = right[id]
    return rightLine
      && leftLine.original.join('\n') === rightLine.original.join('\n')
      && (leftLine.translation ?? []).join('\n') === (rightLine.translation ?? []).join('\n')
  })
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
  const [visualLinesById, setVisualLinesById] = useState<LyricVisualLinesById>({})
  const visualLinesLayoutKey = useMemo(() => JSON.stringify(visualLinesById), [visualLinesById])
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

  const { navigateToLyric, prepareFollowingStep } = useActiveLyricScroll(
    activePositionSeconds,
    interaction,
    track.lyrics,
    lyricListRef,
    `${lyricLayoutKey}:${visualLinesLayoutKey}`,
    track.id,
  )

  const measureStableVisualLines = useCallback(() => {
    const lyricList = lyricListRef.current
    if (!lyricList || lyricList.children.length !== track.lyrics.length) return

    const nextVisualLines: LyricVisualLinesById = {}
    track.lyrics.forEach((line, index) => {
      const renderedLine = lyricList.children.item(index)
      if (!(renderedLine instanceof HTMLLIElement)) return

      const measurementLine = renderedLine.cloneNode(true)
      if (!(measurementLine instanceof HTMLLIElement)) return
      measurementLine.dataset.active = 'true'
      measurementLine.dataset.position = 'active'
      measurementLine.setAttribute('aria-hidden', 'true')
      measurementLine.style.position = 'fixed'
      measurementLine.style.inset = '0 auto auto -100000px'
      measurementLine.style.width = `${renderedLine.clientWidth}px`
      measurementLine.style.height = 'auto'
      measurementLine.style.minHeight = '0'
      measurementLine.style.pointerEvents = 'none'
      measurementLine.style.transition = 'none'

      const originalElement = measurementLine.querySelector<HTMLElement>('.lyric-original-line')
      const translationElement = measurementLine.querySelector<HTMLElement>('.translation-line')
      if (!originalElement) return
      originalElement.textContent = line.original
      if (translationElement) translationElement.textContent = line.translation ?? ''
      lyricList.append(measurementLine)

      nextVisualLines[line.id] = {
        original: splitTextByRenderedLines(originalElement, line.original),
        translation: line.translation && translationElement
          ? splitTextByRenderedLines(translationElement, line.translation)
          : undefined,
      }
      measurementLine.remove()
    })

    setVisualLinesById((current) => visualLinesEqual(current, nextVisualLines) ? current : nextVisualLines)
  }, [track.lyrics])

  useLayoutEffect(() => {
    const lyricList = lyricListRef.current
    if (!lyricList) return
    let disposed = false
    let measurementFrame: number | null = null
    const scheduleMeasurement = () => {
      if (disposed) return
      if (measurementFrame !== null) window.cancelAnimationFrame(measurementFrame)
      measurementFrame = window.requestAnimationFrame(() => {
        if (disposed) return
        measurementFrame = null
        measureStableVisualLines()
      })
    }

    measureStableVisualLines()
    const observer = new ResizeObserver(scheduleMeasurement)
    observer.observe(lyricList)
    const appearanceRoot = document.querySelector('.spmusic-app') ?? document.documentElement
    const appearanceObserver = new MutationObserver(scheduleMeasurement)
    appearanceObserver.observe(appearanceRoot, { attributes: true })
    document.fonts?.addEventListener('loadingdone', scheduleMeasurement)
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleMeasurement()
    })
    return () => {
      disposed = true
      observer.disconnect()
      appearanceObserver.disconnect()
      document.fonts?.removeEventListener('loadingdone', scheduleMeasurement)
      if (measurementFrame !== null) window.cancelAnimationFrame(measurementFrame)
    }
  }, [lyricLayoutKey, measureStableVisualLines])

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
      prepareFollowingStep(nextActiveIndex)
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
  }, [interaction, prepareFollowingStep, track.lyrics, visualClock])

  function lyricLineFromEventTarget(
    list: HTMLOListElement,
    target: EventTarget | null,
  ): HTMLLIElement | null {
    const targetElement = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
    const line = targetElement?.closest('li[data-lyric-index]')
    return line instanceof HTMLLIElement && list.contains(line) ? line : null
  }

  function lyricForEventTarget(list: HTMLOListElement, target: EventTarget | null) {
    const line = lyricLineFromEventTarget(list, target)
    if (!line) return null
    const index = Number.parseInt(line.dataset.lyricIndex ?? '', 10)
    const lyric = Number.isInteger(index) ? track.lyrics[index] : undefined
    return lyric ? { line, lyric, index } : null
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = lyricForEventTarget(event.currentTarget, event.target)
    if (!target) return
    event.preventDefault()
    navigateToLyric(target.index, () => onLineSelect(target.lyric.timeSeconds))
  }

  function handleListClick(event: MouseEvent<HTMLOListElement>) {
    const target = lyricForEventTarget(event.currentTarget, event.target)
    if (!target) return
    navigateToLyric(target.index, () => onLineSelect(target.lyric.timeSeconds))
    if (event.detail > 0) target.line.blur()
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
        <ol
          ref={lyricListRef}
          onClick={handleListClick}
          onKeyDown={handleListKeyDown}
        >
          {track.lyrics.map((line, index) => {
            const nextLine = track.lyrics[index + 1]
            const pairDeltaSeconds = nextLine ? nextLine.timeSeconds - line.timeSeconds : null
            const visualLines = visualLinesById[line.id]

            return (
              <li
                key={line.id}
                role="button"
                tabIndex={0}
                aria-label={line.translation ? `${line.original}\n${line.translation}` : line.original}
                aria-current={line.id === activeLyricId ? 'true' : undefined}
                data-active={line.id === activeLyricId}
                data-lyric-id={line.id}
                data-lyric-index={index}
                data-line-content={line.translation ? 'bilingual' : 'single'}
                data-pair-delta-seconds={pairDeltaSeconds ?? undefined}
                data-pair-spacing={lyricPairSpacingForDelta(pairDeltaSeconds, tightThresholdSeconds)}
                data-position={index < activeLyricIndex ? 'past' : index === activeLyricIndex ? 'active' : 'future'}
              >
                <span className="lyric-original-line">
                  {(visualLines?.original ?? [line.original]).map((visualLine, visualLineIndex) => (
                    <span className="lyric-visual-line" aria-hidden="true" key={`${line.id}:original:${visualLineIndex}`}>{visualLine}</span>
                  ))}
                </span>
                {line.translation ? (
                  <span className="translation-line" lang="zh-CN">
                    {(visualLines?.translation ?? [line.translation]).map((visualLine, visualLineIndex) => (
                      <span className="lyric-visual-line" aria-hidden="true" key={`${line.id}:translation:${visualLineIndex}`}>{visualLine}</span>
                    ))}
                  </span>
                ) : null}
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
