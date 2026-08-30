import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { locateLyricTimeline } from '@/features/player/model/lyricTimeline'
import type { PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { DemoLyricLine } from '@/features/player/model/playerTypes'

const FOLLOW_SCROLL_FALLBACK_MS = 240
const INTERACTIVE_SCROLL_FALLBACK_MS = 160
const USER_SCROLL_IDLE_MS = 5000

function prefersReducedMotion() {
  const motionRoot = document.querySelector('.spmusic-app') ?? document.documentElement
  return motionRoot.getAttribute('data-motion') === 'off'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function motionDurationMs(variableName: string, fallbackMs: number) {
  const motionRoot = document.querySelector('.spmusic-app') ?? document.documentElement
  const value = window.getComputedStyle(motionRoot).getPropertyValue(variableName).trim()
  const duration = Number.parseFloat(value)
  if (!Number.isFinite(duration)) return fallbackMs
  return value.endsWith('s') && !value.endsWith('ms') ? duration * 1000 : duration
}

export function useActiveLyricScroll(
  positionSeconds: number,
  interaction: PlayerTimelineInteraction,
  lyrics: readonly DemoLyricLine[],
  lyricListRef: RefObject<HTMLOListElement | null>,
  layoutKey: string,
) {
  const lineCentersRef = useRef<number[]>([])
  const scrollFrameRef = useRef<number | null>(null)
  const userScrollTimerRef = useRef<number | null>(null)
  const userScrollingRef = useRef(false)
  const activeIndexRef = useRef<number | null>(null)
  const previousInteractionRef = useRef<PlayerTimelineInteraction>(interaction)
  const latestInteractionRef = useRef<PlayerTimelineInteraction>(interaction)
  const latestPositionRef = useRef(positionSeconds)
  const latestLyricsRef = useRef(lyrics)
  const measureAndRecenterRef = useRef<() => void>(() => {})
  const lyricLayoutSignature = useMemo(
    () => JSON.stringify(lyrics.map((line) => [line.id, line.timeSeconds, line.original, line.translation])),
    [lyrics],
  )

  const cancelScrollFrame = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  const cancelUserScrollTimer = useCallback(() => {
    if (userScrollTimerRef.current !== null) {
      window.clearTimeout(userScrollTimerRef.current)
      userScrollTimerRef.current = null
    }
  }, [])

  const targetScrollTop = useCallback((currentIndex: number) => {
    const lyricList = lyricListRef.current
    if (!lyricList) return null

    const currentCenter = lineCentersRef.current[currentIndex] ?? 0
    const maximumScrollTop = Math.max(0, lyricList.scrollHeight - lyricList.clientHeight)
    return Math.min(
      Math.max(currentCenter - lyricList.clientHeight / 2, 0),
      maximumScrollTop,
    )
  }, [lyricListRef])

  const scheduleDirectScroll = useCallback((targetTop: number) => {
    cancelScrollFrame()
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const lyricList = lyricListRef.current
      if (lyricList) lyricList.scrollTop = targetTop
      scrollFrameRef.current = null
    })
  }, [cancelScrollFrame, lyricListRef])

  const animateScroll = useCallback((targetTop: number, durationMs: number, maximumTravelPx?: number) => {
    const lyricList = lyricListRef.current
    if (!lyricList) return

    cancelScrollFrame()
    if (prefersReducedMotion() || durationMs <= 0) {
      scheduleDirectScroll(targetTop)
      return
    }

    scrollFrameRef.current = window.requestAnimationFrame((startTime) => {
      const currentList = lyricListRef.current
      if (!currentList) {
        scrollFrameRef.current = null
        return
      }

      let startTop = currentList.scrollTop
      let distance = targetTop - startTop
      if (maximumTravelPx !== undefined && Math.abs(distance) > maximumTravelPx) {
        startTop = targetTop - Math.sign(distance) * maximumTravelPx
        currentList.scrollTop = startTop
        distance = targetTop - startTop
      }

      if (Math.abs(distance) < 0.5) {
        currentList.scrollTop = targetTop
        scrollFrameRef.current = null
        return
      }

      const animate = (now: number) => {
        const animatedList = lyricListRef.current
        if (!animatedList) {
          scrollFrameRef.current = null
          return
        }

        const progress = Math.min(Math.max((now - startTime) / durationMs, 0), 1)
        const easeOut = 1 - (1 - progress) ** 3
        animatedList.scrollTop = startTop + distance * easeOut
        scrollFrameRef.current = progress < 1
          ? window.requestAnimationFrame(animate)
          : null
      }

      scrollFrameRef.current = window.requestAnimationFrame(animate)
    })
  }, [cancelScrollFrame, lyricListRef, scheduleDirectScroll])

  const animateFollowingScroll = useCallback((targetTop: number) => {
    animateScroll(
      targetTop,
      motionDurationMs('--app-motion-standard', FOLLOW_SCROLL_FALLBACK_MS),
    )
  }, [animateScroll])

  const resumeFollowingAfterUserScroll = useCallback(() => {
    userScrollTimerRef.current = null
    if (!userScrollingRef.current) return

    userScrollingRef.current = false
    if (latestInteractionRef.current !== 'following') return

    const currentLyrics = latestLyricsRef.current
    const timeline = locateLyricTimeline(currentLyrics, latestPositionRef.current)
    if (!timeline || lineCentersRef.current.length !== currentLyrics.length) return

    const targetTop = targetScrollTop(timeline.currentIndex)
    if (targetTop !== null) animateFollowingScroll(targetTop)
    activeIndexRef.current = timeline.currentIndex
  }, [animateFollowingScroll, targetScrollTop])

  const animateInteractiveScroll = useCallback((targetTop: number, currentIndex: number) => {
    const lyricList = lyricListRef.current
    const currentCenter = lineCentersRef.current[currentIndex]
    const previousCenter = lineCentersRef.current[currentIndex - 1]
    const nextCenter = lineCentersRef.current[currentIndex + 1]
    const adjacentDistance = previousCenter !== undefined
      ? Math.abs(currentCenter - previousCenter)
      : nextCenter !== undefined
        ? Math.abs(nextCenter - currentCenter)
        : lyricList?.clientHeight ?? 0
    const maximumTravelPx = lyricList
      ? Math.max(1, Math.min(adjacentDistance, lyricList.clientHeight * 0.18))
      : 1

    animateScroll(
      targetTop,
      motionDurationMs('--app-motion-fast', INTERACTIVE_SCROLL_FALLBACK_MS),
      maximumTravelPx,
    )
  }, [animateScroll, lyricListRef])

  const scheduleMeasurement = useCallback(() => {
    cancelScrollFrame()
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      measureAndRecenterRef.current()
    })
  }, [cancelScrollFrame])

  useLayoutEffect(() => {
    latestPositionRef.current = positionSeconds
    latestLyricsRef.current = lyrics
    latestInteractionRef.current = interaction
  }, [interaction, lyrics, positionSeconds])

  useLayoutEffect(() => {
    const lyricList = lyricListRef.current
    const currentLyrics = latestLyricsRef.current
    cancelScrollFrame()
    activeIndexRef.current = null

    if (!lyricList || !currentLyrics.length) {
      lineCentersRef.current = []
      return
    }

    const measureLineCenters = () => {
      const measuredLyrics = latestLyricsRef.current
      const children = lyricList.children
      if (children.length !== measuredLyrics.length) {
        lineCentersRef.current = []
        return
      }
      const measuredCenters: number[] = []
      for (let index = 0; index < measuredLyrics.length; index += 1) {
        const element = children.item(index)
        if (
          !(element instanceof HTMLElement)
          || element.dataset.lyricIndex !== String(index)
        ) {
          lineCentersRef.current = []
          return
        }
        measuredCenters.push(element.offsetTop + element.offsetHeight / 2)
      }
      lineCentersRef.current = measuredCenters
      const timeline = locateLyricTimeline(measuredLyrics, latestPositionRef.current)
      if (!timeline || lineCentersRef.current.length !== measuredLyrics.length) return
      if (userScrollingRef.current) return

      const targetTop = targetScrollTop(timeline.currentIndex)
      if (targetTop !== null && lyricListRef.current) lyricListRef.current.scrollTop = targetTop
      activeIndexRef.current = timeline.currentIndex
    }

    measureAndRecenterRef.current = measureLineCenters
    scheduleMeasurement()
    const observer = new ResizeObserver(scheduleMeasurement)
    observer.observe(lyricList)

    return () => {
      observer.disconnect()
      if (measureAndRecenterRef.current === measureLineCenters) measureAndRecenterRef.current = () => {}
      cancelScrollFrame()
    }
  }, [cancelScrollFrame, lyricLayoutSignature, lyricListRef, scheduleMeasurement, targetScrollTop])

  useLayoutEffect(() => {
    scheduleMeasurement()
  }, [layoutKey, scheduleMeasurement])

  useEffect(() => {
    const lyricList = lyricListRef.current
    if (!lyricList) return

    const handleWheel = () => {
      if (latestInteractionRef.current !== 'following') return

      userScrollingRef.current = true
      cancelScrollFrame()
      cancelUserScrollTimer()
      userScrollTimerRef.current = window.setTimeout(
        resumeFollowingAfterUserScroll,
        USER_SCROLL_IDLE_MS,
      )
    }

    lyricList.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      lyricList.removeEventListener('wheel', handleWheel)
      cancelUserScrollTimer()
      userScrollingRef.current = false
    }
  }, [cancelScrollFrame, cancelUserScrollTimer, lyricLayoutSignature, lyricListRef, resumeFollowingAfterUserScroll])

  useEffect(() => {
    if (interaction === 'previewing' || interaction === 'seeking') {
      userScrollingRef.current = false
      cancelUserScrollTimer()
    }

    const currentLyrics = latestLyricsRef.current
    const timeline = locateLyricTimeline(currentLyrics, positionSeconds)
    if (!timeline || lineCentersRef.current.length !== currentLyrics.length) return

    const previousInteraction = previousInteractionRef.current
    previousInteractionRef.current = interaction

    if (interaction === 'previewing' || interaction === 'seeking') {
      const enteredInteractiveMode = previousInteraction === 'following'
      if (activeIndexRef.current === timeline.currentIndex) {
        if (enteredInteractiveMode) cancelScrollFrame()
        return
      }

      const targetTop = targetScrollTop(timeline.currentIndex)
      if (targetTop !== null) animateInteractiveScroll(targetTop, timeline.currentIndex)
      activeIndexRef.current = timeline.currentIndex
      return
    }

    if (userScrollingRef.current) return

    if (previousInteraction !== 'following') {
      if (activeIndexRef.current === timeline.currentIndex) return

      const targetTop = targetScrollTop(timeline.currentIndex)
      if (targetTop !== null) animateInteractiveScroll(targetTop, timeline.currentIndex)
      activeIndexRef.current = timeline.currentIndex
      return
    }

    if (activeIndexRef.current === null) {
      const targetTop = targetScrollTop(timeline.currentIndex)
      if (targetTop !== null) scheduleDirectScroll(targetTop)
      activeIndexRef.current = timeline.currentIndex
      return
    }

    if (activeIndexRef.current === timeline.currentIndex) return

    activeIndexRef.current = timeline.currentIndex
    const targetTop = targetScrollTop(timeline.currentIndex)
    if (targetTop !== null) animateFollowingScroll(targetTop)
  }, [animateFollowingScroll, animateInteractiveScroll, cancelScrollFrame, cancelUserScrollTimer, interaction, lyricLayoutSignature, lyricListRef, positionSeconds, scheduleDirectScroll, targetScrollTop])

  useEffect(() => () => {
    cancelScrollFrame()
    cancelUserScrollTimer()
  }, [cancelScrollFrame, cancelUserScrollTimer])
}
