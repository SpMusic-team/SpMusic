import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { locateLyricTimeline } from '@/features/player/model/lyricTimeline'
import type { PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { DemoLyricLine } from '@/features/player/model/playerTypes'

const FOLLOW_SCROLL_FALLBACK_MS = 240
const INTERACTIVE_SCROLL_FALLBACK_MS = 160
const USER_SCROLL_IDLE_MS = 5000
const FOLLOWING_STAGGER_VISIBLE_RANGE = 12
const LYRIC_NAVIGATION_SUPPRESSION_TIMEOUT_MS = 15000
const FOLLOWING_STEP_FAST_DURATION_MULTIPLIER = 1.625
const FOLLOWING_STEP_STAGGER_MULTIPLIER = 0.2
const FOLLOWING_STEP_MAX_STAGGERED_LINES = 6
const FOLLOWING_STEP_EASING = 'cubic-bezier(0, 0, 0.58, 1)'

type LyricVisualStyle = {
  color: string
  filter: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  opacity: string
  transform: string
}

type LyricVisualAnimation = {
  element: HTMLElement
  startStyle: LyricVisualStyle
  endStyle: LyricVisualStyle
}

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

function captureLyricVisualStyle(element: HTMLElement): LyricVisualStyle {
  const style = window.getComputedStyle(element)
  return {
    color: style.color,
    filter: style.filter,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    opacity: style.opacity,
    transform: style.transform,
  }
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
  const lyricNavigationSuppressionTimerRef = useRef<number | null>(null)
  const suppressedLyricNavigationIndexRef = useRef<number | null>(null)
  const followingLineAnimationsRef = useRef<Set<Animation>>(new Set())
  const followingLineAnimationStateTimerRef = useRef<number | null>(null)
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

  const cancelLyricNavigationSuppression = useCallback(() => {
    suppressedLyricNavigationIndexRef.current = null
    if (lyricNavigationSuppressionTimerRef.current !== null) {
      window.clearTimeout(lyricNavigationSuppressionTimerRef.current)
      lyricNavigationSuppressionTimerRef.current = null
    }
  }, [])

  const clearFollowingLineAnimationState = useCallback(() => {
    if (followingLineAnimationStateTimerRef.current !== null) {
      window.clearTimeout(followingLineAnimationStateTimerRef.current)
      followingLineAnimationStateTimerRef.current = null
    }
    const lyricList = lyricListRef.current
    if (!lyricList) return
    delete lyricList.dataset.followingStep
    lyricList.style.removeProperty('--lyrics-following-step-duration')
  }, [lyricListRef])

  const cancelFollowingLineAnimations = useCallback((preservePreparedTransition = false) => {
    followingLineAnimationsRef.current.forEach((animation) => animation.cancel())
    followingLineAnimationsRef.current.clear()
    if (followingLineAnimationStateTimerRef.current !== null) {
      window.clearTimeout(followingLineAnimationStateTimerRef.current)
      followingLineAnimationStateTimerRef.current = null
    }
    if (!preservePreparedTransition) clearFollowingLineAnimationState()
  }, [clearFollowingLineAnimationState])

  const notifyLyricNavigation = useCallback((targetIndex: number) => {
    cancelLyricNavigationSuppression()
    if (activeIndexRef.current === targetIndex) return

    cancelFollowingLineAnimations()
    const lyricList = lyricListRef.current
    if (lyricList) void lyricList.offsetHeight
    suppressedLyricNavigationIndexRef.current = targetIndex
    lyricNavigationSuppressionTimerRef.current = window.setTimeout(
      cancelLyricNavigationSuppression,
      LYRIC_NAVIGATION_SUPPRESSION_TIMEOUT_MS,
    )
  }, [cancelFollowingLineAnimations, cancelLyricNavigationSuppression, lyricListRef])

  const prepareFollowingTransitionState = useCallback(() => {
    const lyricList = lyricListRef.current
    if (!lyricList || prefersReducedMotion()) return

    const fastDurationMs = motionDurationMs('--app-motion-fast', INTERACTIVE_SCROLL_FALLBACK_MS)
    const baseDurationMs = motionDurationMs('--app-motion-standard', FOLLOW_SCROLL_FALLBACK_MS)
      + fastDurationMs * FOLLOWING_STEP_FAST_DURATION_MULTIPLIER
    const maximumDelayMs = fastDurationMs
      * FOLLOWING_STEP_STAGGER_MULTIPLIER
      * FOLLOWING_STEP_MAX_STAGGERED_LINES
    if (followingLineAnimationStateTimerRef.current !== null) {
      window.clearTimeout(followingLineAnimationStateTimerRef.current)
    }
    lyricList.dataset.followingStep = 'true'
    lyricList.style.setProperty('--lyrics-following-step-duration', `${baseDurationMs}ms`)
    followingLineAnimationStateTimerRef.current = window.setTimeout(
      clearFollowingLineAnimationState,
      baseDurationMs + maximumDelayMs,
    )
  }, [clearFollowingLineAnimationState, lyricListRef])

  const prepareFollowingStep = useCallback((targetIndex: number) => {
    const currentIndex = activeIndexRef.current
    if (
      currentIndex === null
      || latestInteractionRef.current !== 'following'
      || userScrollingRef.current
      || suppressedLyricNavigationIndexRef.current === targetIndex
      || targetIndex !== currentIndex + 1
    ) return

    prepareFollowingTransitionState()
  }, [prepareFollowingTransitionState])

  const targetScrollTop = useCallback((currentIndex: number) => {
    const lyricList = lyricListRef.current
    if (!lyricList) return null

    const currentLine = lyricList.children.item(currentIndex)
    const currentCenter = currentLine instanceof HTMLElement
      ? currentLine.offsetTop + currentLine.offsetHeight / 2
      : lineCentersRef.current[currentIndex] ?? 0
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
    cancelFollowingLineAnimations()
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
  }, [cancelFollowingLineAnimations, cancelScrollFrame, lyricListRef, scheduleDirectScroll])

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

  const animateFollowingStep = useCallback((targetTop: number, previousIndex: number, currentIndex: number) => {
    const lyricList = lyricListRef.current
    if (!lyricList) return

    const firstCandidateIndex = Math.max(0, Math.min(previousIndex, currentIndex) - FOLLOWING_STAGGER_VISIBLE_RANGE)
    const lastCandidateIndex = Math.min(
      lyricList.children.length - 1,
      Math.max(previousIndex, currentIndex) + FOLLOWING_STAGGER_VISIBLE_RANGE,
    )
    const startTops = new Map<HTMLElement, number>()
    for (let index = firstCandidateIndex; index <= lastCandidateIndex; index += 1) {
      const child = lyricList.children.item(index)
      if (child instanceof HTMLElement) startTops.set(child, child.getBoundingClientRect().top)
    }

    cancelScrollFrame()
    cancelFollowingLineAnimations(true)

    const previousLine = lyricList.children.item(previousIndex)
    const currentLine = lyricList.children.item(currentIndex)
    const visualAnimations: LyricVisualAnimation[] = []
    if (previousLine instanceof HTMLElement && currentLine instanceof HTMLElement) {
      const visualElements = [
        previousLine,
        previousLine.querySelector<HTMLElement>('.translation-line'),
        currentLine,
        currentLine.querySelector<HTMLElement>('.translation-line'),
      ].filter((element): element is HTMLElement => element !== null)
      const inlineTransitions = visualElements.map((element) => element.style.transition)
      const previousActive = previousLine.getAttribute('data-active')
      const previousPosition = previousLine.getAttribute('data-position')
      const currentActive = currentLine.getAttribute('data-active')
      const currentPosition = currentLine.getAttribute('data-position')

      visualElements.forEach((element) => { element.style.transition = 'none' })
      previousLine.dataset.active = 'true'
      previousLine.dataset.position = 'active'
      currentLine.dataset.active = 'false'
      currentLine.dataset.position = 'future'
      const startStyles = visualElements.map(captureLyricVisualStyle)

      if (previousActive === null) previousLine.removeAttribute('data-active')
      else previousLine.setAttribute('data-active', previousActive)
      if (previousPosition === null) previousLine.removeAttribute('data-position')
      else previousLine.setAttribute('data-position', previousPosition)
      if (currentActive === null) currentLine.removeAttribute('data-active')
      else currentLine.setAttribute('data-active', currentActive)
      if (currentPosition === null) currentLine.removeAttribute('data-position')
      else currentLine.setAttribute('data-position', currentPosition)
      const endStyles = visualElements.map(captureLyricVisualStyle)

      visualElements.forEach((element, index) => {
        const inlineTransition = inlineTransitions[index]
        if (inlineTransition) element.style.transition = inlineTransition
        else element.style.removeProperty('transition')
        visualAnimations.push({ element, startStyle: startStyles[index], endStyle: endStyles[index] })
      })
    }

    lyricList.scrollTop = targetTop
    if (prefersReducedMotion()) {
      clearFollowingLineAnimationState()
      return
    }

    const listRect = lyricList.getBoundingClientRect()
    const fastDurationMs = motionDurationMs('--app-motion-fast', INTERACTIVE_SCROLL_FALLBACK_MS)
    const baseDurationMs = motionDurationMs('--app-motion-standard', FOLLOW_SCROLL_FALLBACK_MS)
      + fastDurationMs * FOLLOWING_STEP_FAST_DURATION_MULTIPLIER
    const perLineDelayMs = fastDurationMs * FOLLOWING_STEP_STAGGER_MULTIPLIER
    const maximumDelayMs = perLineDelayMs * FOLLOWING_STEP_MAX_STAGGERED_LINES
    lyricList.dataset.followingStep = 'true'
    lyricList.style.setProperty('--lyrics-following-step-duration', `${baseDurationMs}ms`)
    followingLineAnimationStateTimerRef.current = window.setTimeout(
      clearFollowingLineAnimationState,
      baseDurationMs + maximumDelayMs,
    )

    visualAnimations.forEach((visual) => {
      if (!lyricList.contains(visual.element)) return
      const animation = visual.element.animate(
        [visual.startStyle, visual.endStyle],
        { duration: baseDurationMs, easing: FOLLOWING_STEP_EASING },
      )
      followingLineAnimationsRef.current.add(animation)
      const forgetAnimation = () => followingLineAnimationsRef.current.delete(animation)
      animation.addEventListener('finish', forgetAnimation, { once: true })
      animation.addEventListener('cancel', forgetAnimation, { once: true })
    })

    startTops.forEach((startTop, child) => {
      const index = Number.parseInt(child.dataset.lyricIndex ?? '', 10)
      if (!Number.isInteger(index)) return
      const lineRect = child.getBoundingClientRect()
      if (lineRect.bottom < listRect.top || lineRect.top > listRect.bottom) return
      const inverseOffset = startTop - lineRect.top
      if (Math.abs(inverseOffset) < 0.5) return
      const delay = index > currentIndex
        ? Math.min((index - currentIndex) * perLineDelayMs, maximumDelayMs)
        : 0
      const animation = child.animate(
        [
          { translate: `0 ${inverseOffset}px` },
          { translate: '0 0' },
        ],
        { duration: baseDurationMs, delay, easing: FOLLOWING_STEP_EASING, fill: 'backwards' },
      )
      followingLineAnimationsRef.current.add(animation)
      const forgetAnimation = () => followingLineAnimationsRef.current.delete(animation)
      animation.addEventListener('finish', forgetAnimation, { once: true })
      animation.addEventListener('cancel', forgetAnimation, { once: true })
    })
  }, [cancelFollowingLineAnimations, cancelScrollFrame, clearFollowingLineAnimationState, lyricListRef])

  const scheduleMeasurement = useCallback(() => {
    cancelScrollFrame()
    cancelLyricNavigationSuppression()
    cancelFollowingLineAnimations()
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      measureAndRecenterRef.current()
    })
  }, [cancelFollowingLineAnimations, cancelLyricNavigationSuppression, cancelScrollFrame])

  useLayoutEffect(() => {
    latestPositionRef.current = positionSeconds
    latestLyricsRef.current = lyrics
    latestInteractionRef.current = interaction
  }, [interaction, lyrics, positionSeconds])

  useLayoutEffect(() => {
    const lyricList = lyricListRef.current
    const currentLyrics = latestLyricsRef.current
    cancelScrollFrame()
    cancelLyricNavigationSuppression()
    cancelFollowingLineAnimations()
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
  }, [cancelFollowingLineAnimations, cancelLyricNavigationSuppression, cancelScrollFrame, lyricLayoutSignature, lyricListRef, scheduleMeasurement, targetScrollTop])

  useLayoutEffect(() => {
    scheduleMeasurement()
  }, [layoutKey, scheduleMeasurement])

  useEffect(() => {
    const lyricList = lyricListRef.current
    if (!lyricList) return

    const handleWheel = () => {
      cancelLyricNavigationSuppression()
      cancelFollowingLineAnimations()
      cancelScrollFrame()
      if (latestInteractionRef.current !== 'following') return

      userScrollingRef.current = true
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
  }, [cancelFollowingLineAnimations, cancelLyricNavigationSuppression, cancelScrollFrame, cancelUserScrollTimer, lyricLayoutSignature, lyricListRef, resumeFollowingAfterUserScroll])

  useLayoutEffect(() => {
    if (interaction === 'previewing') cancelLyricNavigationSuppression()
    if (interaction === 'previewing' || interaction === 'seeking') {
      userScrollingRef.current = false
      cancelUserScrollTimer()
      cancelFollowingLineAnimations()
    }

    const currentLyrics = latestLyricsRef.current
    const timeline = locateLyricTimeline(currentLyrics, positionSeconds)
    if (!timeline || lineCentersRef.current.length !== currentLyrics.length) return

    const previousInteraction = previousInteractionRef.current
    previousInteractionRef.current = interaction
    const suppressFollowingStep = suppressedLyricNavigationIndexRef.current === timeline.currentIndex
    if (suppressFollowingStep) cancelLyricNavigationSuppression()

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

    const previousActiveIndex = activeIndexRef.current
    activeIndexRef.current = timeline.currentIndex
    const targetTop = targetScrollTop(timeline.currentIndex)
    if (targetTop === null) return
    const isNaturalFollowingStep = previousInteraction === 'following'
      && interaction === 'following'
      && !userScrollingRef.current
      && !suppressFollowingStep
      && timeline.currentIndex === previousActiveIndex + 1
    if (isNaturalFollowingStep) {
      animateFollowingStep(targetTop, previousActiveIndex, timeline.currentIndex)
      return
    }
    animateFollowingScroll(targetTop)
  }, [animateFollowingScroll, animateFollowingStep, animateInteractiveScroll, cancelFollowingLineAnimations, cancelLyricNavigationSuppression, cancelScrollFrame, cancelUserScrollTimer, interaction, lyricLayoutSignature, lyricListRef, positionSeconds, scheduleDirectScroll, targetScrollTop])

  useEffect(() => () => {
    cancelScrollFrame()
    cancelUserScrollTimer()
    cancelLyricNavigationSuppression()
    cancelFollowingLineAnimations()
  }, [cancelFollowingLineAnimations, cancelLyricNavigationSuppression, cancelScrollFrame, cancelUserScrollTimer])

  return { notifyLyricNavigation, prepareFollowingStep }
}
