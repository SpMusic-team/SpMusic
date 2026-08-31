import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { locateLyricTimeline } from '@/features/player/model/lyricTimeline'
import type { PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { DemoLyricLine } from '@/features/player/model/playerTypes'

const FOLLOW_SCROLL_FALLBACK_MS = 240
const INTERACTIVE_SCROLL_FALLBACK_MS = 160
const USER_SCROLL_IDLE_MS = 5000
const FOLLOWING_STAGGER_VISIBLE_RANGE = 12
const LYRIC_NAVIGATION_TIMEOUT_MS = 15000
const FOLLOWING_STEP_FAST_DURATION_MULTIPLIER = 1.625
const FOLLOWING_STEP_STAGGER_MULTIPLIER = 0.2
const FOLLOWING_STEP_MAX_STAGGERED_LINES = 6
const FOLLOWING_STEP_EASING = 'cubic-bezier(0, 0, 0.58, 1)'
const NAVIGATION_STYLE_DURATION_MS = 180
const NAVIGATION_POSITION_DURATION_MS = 520
const NAVIGATION_POSITION_STAGGER_MS = 32
const NAVIGATION_POSITION_MAX_DELAY_MS = 256
const NAVIGATION_RIGID_FALLBACK_DURATION_MS = 460
const NAVIGATION_NEAR_ANCHOR_PX = 0
const NAVIGATION_EASING = 'cubic-bezier(0, 0, 0.58, 1)'

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

type NavigationCapturedLine = {
  element: HTMLElement
  id: string
  index: number
  top: number
  bottom: number
  style: LyricVisualStyle
  translationElement: HTMLElement | null
  translationStyle: LyricVisualStyle | null
}

type LyricNavigationSession = {
  requestId: number
  generation: number
  scopeKey: string
  lyrics: readonly DemoLyricLine[]
  layoutSignature: string
  targetId: string
  targetIndex: number
  listTop: number
  listBottom: number
  capturedLines: NavigationCapturedLine[]
  started: boolean
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

function captureFinalLyricVisualStyle(element: HTMLElement): LyricVisualStyle {
  const inlineTransition = element.style.transition
  element.style.transition = 'none'
  const style = captureLyricVisualStyle(element)
  if (inlineTransition) element.style.transition = inlineTransition
  else element.style.removeProperty('transition')
  return style
}

function standardEaseOut(progress: number) {
  // Solve cubic-bezier(0, 0, 0.58, 1) for x so the rigid fallback
  // follows the same curve as the WAAPI navigation motion.
  let lower = 0
  let upper = 1
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const time = (lower + upper) / 2
    const inverse = 1 - time
    const x = 3 * inverse * time * time * 0.58 + time ** 3
    if (x < progress) lower = time
    else upper = time
  }
  const time = (lower + upper) / 2
  const inverse = 1 - time
  return 3 * inverse * time * time + time ** 3
}

export function useActiveLyricScroll(
  positionSeconds: number,
  interaction: PlayerTimelineInteraction,
  lyrics: readonly DemoLyricLine[],
  lyricListRef: RefObject<HTMLOListElement | null>,
  layoutKey: string,
  scopeKey: string,
) {
  const lineCentersRef = useRef<number[]>([])
  const scrollFrameRef = useRef<number | null>(null)
  const userScrollTimerRef = useRef<number | null>(null)
  const navigationRequestIdRef = useRef(0)
  const navigationGenerationRef = useRef(0)
  const navigationSessionRef = useRef<LyricNavigationSession | null>(null)
  const navigationAnimationsRef = useRef<Set<Animation>>(new Set())
  const navigationStartFrameRef = useRef<number | null>(null)
  const navigationPositionFrameRef = useRef<number | null>(null)
  const navigationTimerRef = useRef<number | null>(null)
  const navigationMeasurementPendingRef = useRef(false)
  const followingLineAnimationsRef = useRef<Set<Animation>>(new Set())
  const followingLineAnimationStateTimerRef = useRef<number | null>(null)
  const userScrollingRef = useRef(false)
  const userScrollWaitForFollowingRef = useRef(false)
  const activeIndexRef = useRef<number | null>(null)
  const previousInteractionRef = useRef<PlayerTimelineInteraction>(interaction)
  const latestInteractionRef = useRef<PlayerTimelineInteraction>(interaction)
  const latestPositionRef = useRef(positionSeconds)
  const latestLyricsRef = useRef(lyrics)
  const latestScopeKeyRef = useRef(scopeKey)
  const latestNavigationLayoutSignatureRef = useRef('')
  const measureAndRecenterRef = useRef<() => void>(() => {})
  const lyricLayoutSignature = useMemo(
    () => JSON.stringify(lyrics.map((line) => [line.id, line.timeSeconds, line.original, line.translation])),
    [lyrics],
  )
  const navigationLayoutSignature = `${lyricLayoutSignature}:${layoutKey}`

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

  const cancelLyricNavigation = useCallback(() => {
    navigationGenerationRef.current += 1
    navigationSessionRef.current = null
    navigationMeasurementPendingRef.current = false
    if (navigationStartFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationStartFrameRef.current)
      navigationStartFrameRef.current = null
    }
    if (navigationPositionFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationPositionFrameRef.current)
      navigationPositionFrameRef.current = null
    }
    if (navigationTimerRef.current !== null) {
      window.clearTimeout(navigationTimerRef.current)
      navigationTimerRef.current = null
    }
    navigationAnimationsRef.current.forEach((animation) => animation.cancel())
    navigationAnimationsRef.current.clear()
  }, [])

  const isCurrentNavigationSession = useCallback((session: LyricNavigationSession) => {
    const currentLyrics = latestLyricsRef.current
    return navigationSessionRef.current === session
      && navigationRequestIdRef.current === session.requestId
      && navigationGenerationRef.current === session.generation
      && latestScopeKeyRef.current === session.scopeKey
      && latestNavigationLayoutSignatureRef.current === session.layoutSignature
      && currentLyrics === session.lyrics
      && currentLyrics[session.targetIndex]?.id === session.targetId
  }, [])

  const finalizeLyricNavigation = useCallback((session: LyricNavigationSession) => {
    if (!isCurrentNavigationSession(session)) return false
    navigationSessionRef.current = null
    if (navigationMeasurementPendingRef.current) {
      navigationMeasurementPendingRef.current = false
      measureAndRecenterRef.current()
    }
    return true
  }, [isCurrentNavigationSession])

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
      || navigationSessionRef.current?.targetIndex === targetIndex
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

  const startLyricNavigation = useCallback((session: LyricNavigationSession) => {
    const lyricList = lyricListRef.current
    if (!lyricList || session.started) return false
    if (!isCurrentNavigationSession(session)) {
      if (navigationSessionRef.current === session) cancelLyricNavigation()
      return false
    }

    const currentLyrics = latestLyricsRef.current
    const timeline = locateLyricTimeline(currentLyrics, latestPositionRef.current)
    if (!timeline || timeline.currentIndex !== session.targetIndex) return false
    if (currentLyrics[session.targetIndex]?.id !== session.targetId) {
      cancelLyricNavigation()
      return false
    }

    const targetLine = lyricList.children.item(session.targetIndex)
    if (
      !(targetLine instanceof HTMLElement)
      || targetLine.dataset.lyricId !== session.targetId
      || targetLine.dataset.lyricIndex !== String(session.targetIndex)
    ) {
      cancelLyricNavigation()
      return false
    }

    session.started = true
    if (navigationStartFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationStartFrameRef.current)
      navigationStartFrameRef.current = null
    }
    if (navigationTimerRef.current !== null) {
      window.clearTimeout(navigationTimerRef.current)
      navigationTimerRef.current = null
    }
    cancelScrollFrame()
    cancelFollowingLineAnimations()

    const finishSessionAfter = (delayMs: number) => {
      const completionTimer = window.setTimeout(() => {
        if (isCurrentNavigationSession(session)) finalizeLyricNavigation(session)
        else if (navigationSessionRef.current === session) cancelLyricNavigation()
        if (navigationTimerRef.current === completionTimer) navigationTimerRef.current = null
      }, delayMs)
      navigationTimerRef.current = completionTimer
    }

    if (prefersReducedMotion()) {
      const finalTop = targetScrollTop(session.targetIndex)
      if (finalTop !== null) lyricList.scrollTop = finalTop
      finalizeLyricNavigation(session)
      return true
    }

    const registerAnimation = (animation: Animation) => {
      navigationAnimationsRef.current.add(animation)
      const forgetAnimation = () => navigationAnimationsRef.current.delete(animation)
      animation.addEventListener('finish', forgetAnimation, { once: true })
      animation.addEventListener('cancel', forgetAnimation, { once: true })
    }

    // Visual state starts immediately. Its old values were captured before the
    // player commit, so the active/inactive styles cannot collapse into one frame.
    session.capturedLines.forEach((captured) => {
      if (!lyricList.contains(captured.element)) return
      const endStyle = captureFinalLyricVisualStyle(captured.element)
      if (JSON.stringify(captured.style) !== JSON.stringify(endStyle)) {
        registerAnimation(captured.element.animate(
          [captured.style, endStyle],
          { duration: NAVIGATION_STYLE_DURATION_MS, easing: NAVIGATION_EASING },
        ))
      }
      if (captured.translationElement && captured.translationStyle) {
        const translation = captured.translationElement
        if (!lyricList.contains(translation)) return
        const translationEndStyle = captureFinalLyricVisualStyle(translation)
        if (JSON.stringify(captured.translationStyle) !== JSON.stringify(translationEndStyle)) {
          registerAnimation(translation.animate(
            [captured.translationStyle, translationEndStyle],
            { duration: NAVIGATION_STYLE_DURATION_MS, easing: NAVIGATION_EASING },
          ))
        }
      }
    })

    const capturedTarget = session.capturedLines[session.targetIndex]
    const oldTargetCenter = capturedTarget
      ? (capturedTarget.top + capturedTarget.bottom) / 2
      : Number.NaN
    const oldListCenter = (session.listTop + session.listBottom) / 2
    if (
      Number.isFinite(oldTargetCenter)
      && Math.abs(oldTargetCenter - oldListCenter) <= NAVIGATION_NEAR_ANCHOR_PX
    ) {
      finishSessionAfter(NAVIGATION_STYLE_DURATION_MS)
      return true
    }

    // Position starts on the next paint after the visual-state animation is started.
    const positionFrame = window.requestAnimationFrame(() => {
      if (navigationPositionFrameRef.current === positionFrame) {
        navigationPositionFrameRef.current = null
      }
      if (!isCurrentNavigationSession(session)) {
        if (navigationSessionRef.current === session) cancelLyricNavigation()
        return
      }

      const finalTop = targetScrollTop(session.targetIndex)
      const geometryIsValid = finalTop !== null
        && Number.isFinite(finalTop)
        && Number.isFinite(session.listTop)
        && Number.isFinite(session.listBottom)
        && session.capturedLines.length === currentLyrics.length
        && session.capturedLines.every((captured, index) => (
          captured.element === lyricList.children.item(index)
          && captured.id === currentLyrics[index]?.id
          && captured.element.dataset.lyricId === captured.id
          && Number.isFinite(captured.top)
          && Number.isFinite(captured.bottom)
        ))

      if (!geometryIsValid || finalTop === null) {
        const fallbackTop = targetScrollTop(session.targetIndex)
        if (fallbackTop === null) {
          cancelLyricNavigation()
          return
        }
        const startTop = lyricList.scrollTop
        const distance = fallbackTop - startTop
        const fallbackStartFrame = window.requestAnimationFrame((startTime) => {
          if (!isCurrentNavigationSession(session)) {
            if (navigationSessionRef.current === session) cancelLyricNavigation()
            return
          }
          const animateRigidFallback = (now: number) => {
            if (!isCurrentNavigationSession(session)) {
              if (navigationSessionRef.current === session) cancelLyricNavigation()
              return
            }
            const progress = Math.min(Math.max(
              (now - startTime) / NAVIGATION_RIGID_FALLBACK_DURATION_MS,
              0,
            ), 1)
            lyricList.scrollTop = startTop + distance * standardEaseOut(progress)
            if (progress < 1) {
              navigationPositionFrameRef.current = window.requestAnimationFrame(animateRigidFallback)
              return
            }
            lyricList.scrollTop = fallbackTop
            navigationPositionFrameRef.current = null
            if (isCurrentNavigationSession(session)) finalizeLyricNavigation(session)
          }
          navigationPositionFrameRef.current = window.requestAnimationFrame(animateRigidFallback)
        })
        navigationPositionFrameRef.current = fallbackStartFrame
        return
      }

      lyricList.scrollTop = finalTop
      const finalListRect = lyricList.getBoundingClientRect()
      session.capturedLines.forEach((captured) => {
        const finalRect = captured.element.getBoundingClientRect()
        const wasVisible = captured.bottom >= session.listTop && captured.top <= session.listBottom
        const isVisible = finalRect.bottom >= finalListRect.top && finalRect.top <= finalListRect.bottom
        if (!wasVisible && !isVisible) return
        const inverseOffset = captured.top - finalRect.top
        if (Math.abs(inverseOffset) < 0.5) return
        const delay = captured.index > session.targetIndex
          ? Math.min(
            (captured.index - session.targetIndex) * NAVIGATION_POSITION_STAGGER_MS,
            NAVIGATION_POSITION_MAX_DELAY_MS,
          )
          : 0
        registerAnimation(captured.element.animate(
          [
            { translate: `0 ${inverseOffset}px` },
            { translate: '0 0' },
          ],
          {
            duration: NAVIGATION_POSITION_DURATION_MS,
            delay,
            easing: NAVIGATION_EASING,
            fill: 'backwards',
          },
        ))
      })
      finishSessionAfter(NAVIGATION_POSITION_DURATION_MS + NAVIGATION_POSITION_MAX_DELAY_MS)
    })
    navigationPositionFrameRef.current = positionFrame
    return true
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, finalizeLyricNavigation, isCurrentNavigationSession, lyricListRef, targetScrollTop])

  const navigateToLyric = useCallback((targetIndex: number, commit: () => void) => {
    if (targetIndex === activeIndexRef.current) {
      // Selecting the already-active lyric is semantic playback input only. In
      // particular, preserve a manually scrolled viewport instead of re-centering.
      cancelLyricNavigation()
      cancelFollowingLineAnimations()
      cancelScrollFrame()
      commit()
      return
    }

    cancelUserScrollTimer()
    userScrollWaitForFollowingRef.current = false
    userScrollingRef.current = false

    const lyricList = lyricListRef.current
    const currentLyrics = latestLyricsRef.current
    const target = currentLyrics[targetIndex]
    if (!lyricList || !target || lyricList.children.length !== currentLyrics.length) {
      cancelLyricNavigation()
      cancelFollowingLineAnimations()
      cancelScrollFrame()
      commit()
      return
    }

    const listRect = lyricList.getBoundingClientRect()
    const capturedLines: NavigationCapturedLine[] = []
    for (let index = 0; index < currentLyrics.length; index += 1) {
      const element = lyricList.children.item(index)
      const lyric = currentLyrics[index]
      if (
        !(element instanceof HTMLElement)
        || element.dataset.lyricIndex !== String(index)
        || element.dataset.lyricId !== lyric.id
      ) {
        cancelLyricNavigation()
        cancelFollowingLineAnimations()
        cancelScrollFrame()
        commit()
        return
      }
      const rect = element.getBoundingClientRect()
      const translationElement = element.querySelector<HTMLElement>('.translation-line')
      capturedLines.push({
        element,
        id: lyric.id,
        index,
        top: rect.top,
        bottom: rect.bottom,
        style: captureLyricVisualStyle(element),
        translationElement,
        translationStyle: translationElement ? captureLyricVisualStyle(translationElement) : null,
      })
    }

    // Capture the current presentation before cancelling an in-flight request;
    // a rapid A→B→C click therefore continues from what the user actually saw.
    cancelLyricNavigation()
    cancelFollowingLineAnimations()
    cancelScrollFrame()

    const session: LyricNavigationSession = {
      requestId: navigationRequestIdRef.current + 1,
      generation: navigationGenerationRef.current,
      scopeKey: latestScopeKeyRef.current,
      lyrics: currentLyrics,
      layoutSignature: latestNavigationLayoutSignatureRef.current,
      targetId: target.id,
      targetIndex,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      capturedLines,
      started: false,
    }
    navigationRequestIdRef.current = session.requestId
    navigationSessionRef.current = session
    const requestTimer = window.setTimeout(() => {
      if (isCurrentNavigationSession(session)) cancelLyricNavigation()
      else if (navigationSessionRef.current === session) cancelLyricNavigation()
    }, LYRIC_NAVIGATION_TIMEOUT_MS)
    navigationTimerRef.current = requestTimer

    try {
      commit()
    } catch (error) {
      cancelLyricNavigation()
      throw error
    }
    const startFrame = window.requestAnimationFrame(() => {
      if (navigationStartFrameRef.current === startFrame) navigationStartFrameRef.current = null
      startLyricNavigation(session)
    })
    navigationStartFrameRef.current = startFrame
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, cancelUserScrollTimer, isCurrentNavigationSession, lyricListRef, startLyricNavigation])

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
    const finishOrWaitForFollowing = () => {
      userScrollTimerRef.current = null
      if (!userScrollingRef.current) return

      if (latestInteractionRef.current !== 'following') {
        if (userScrollWaitForFollowingRef.current) {
          userScrollTimerRef.current = window.setTimeout(finishOrWaitForFollowing, 100)
          return
        }
        userScrollingRef.current = false
        return
      }

      userScrollWaitForFollowingRef.current = false
      userScrollingRef.current = false

      const currentLyrics = latestLyricsRef.current
      const timeline = locateLyricTimeline(currentLyrics, latestPositionRef.current)
      if (!timeline || lineCentersRef.current.length !== currentLyrics.length) return

      const targetTop = targetScrollTop(timeline.currentIndex)
      if (targetTop !== null) animateFollowingScroll(targetTop)
      activeIndexRef.current = timeline.currentIndex
    }

    finishOrWaitForFollowing()
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
    cancelLyricNavigation()
    cancelFollowingLineAnimations()
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      measureAndRecenterRef.current()
    })
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame])

  useLayoutEffect(() => {
    latestPositionRef.current = positionSeconds
    latestLyricsRef.current = lyrics
    latestScopeKeyRef.current = scopeKey
    latestInteractionRef.current = interaction
    latestNavigationLayoutSignatureRef.current = navigationLayoutSignature
  }, [interaction, lyrics, navigationLayoutSignature, positionSeconds, scopeKey])

  useLayoutEffect(() => {
    const lyricList = lyricListRef.current
    const currentLyrics = latestLyricsRef.current
    cancelScrollFrame()
    cancelLyricNavigation()
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
    let disposed = false
    const handleExternalLayoutChange = () => {
      if (!disposed) scheduleMeasurement()
    }
    const handleObservedLyricResize = () => {
      if (disposed) return
      if (navigationSessionRef.current) {
        // Active/inactive typography changes are part of the navigation FLIP.
        // Re-measure after it settles instead of cancelling before its first frame.
        navigationMeasurementPendingRef.current = true
        return
      }
      scheduleMeasurement()
    }
    const observer = new ResizeObserver(handleObservedLyricResize)
    observer.observe(lyricList)
    const appearanceRoot = document.querySelector('.spmusic-app') ?? document.documentElement
    const appearanceObserver = new MutationObserver(handleExternalLayoutChange)
    appearanceObserver.observe(appearanceRoot, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-color-scheme', 'data-theme-tier', 'data-motion'],
    })
    window.addEventListener('resize', handleExternalLayoutChange)
    document.fonts?.addEventListener('loadingdone', handleExternalLayoutChange)
    void document.fonts?.ready.then(handleExternalLayoutChange)

    return () => {
      disposed = true
      observer.disconnect()
      appearanceObserver.disconnect()
      window.removeEventListener('resize', handleExternalLayoutChange)
      document.fonts?.removeEventListener('loadingdone', handleExternalLayoutChange)
      if (measureAndRecenterRef.current === measureLineCenters) measureAndRecenterRef.current = () => {}
      cancelScrollFrame()
    }
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, lyricLayoutSignature, lyricListRef, scheduleMeasurement, scopeKey, targetScrollTop])

  useLayoutEffect(() => {
    scheduleMeasurement()
  }, [layoutKey, scheduleMeasurement])

  useEffect(() => {
    const lyricList = lyricListRef.current
    if (!lyricList) return

    const handleWheel = () => {
      const hadLyricNavigation = navigationSessionRef.current !== null
      cancelLyricNavigation()
      cancelFollowingLineAnimations()
      cancelScrollFrame()
      if (latestInteractionRef.current !== 'following' && !hadLyricNavigation) return

      userScrollWaitForFollowingRef.current = hadLyricNavigation
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
      userScrollWaitForFollowingRef.current = false
      userScrollingRef.current = false
    }
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, cancelUserScrollTimer, lyricLayoutSignature, lyricListRef, resumeFollowingAfterUserScroll])

  useLayoutEffect(() => {
    if (interaction === 'previewing') cancelLyricNavigation()
    if (interaction === 'previewing' || interaction === 'seeking') {
      const preserveNavigationWheel = interaction === 'seeking'
        && userScrollWaitForFollowingRef.current
      if (!preserveNavigationWheel) {
        userScrollWaitForFollowingRef.current = false
        userScrollingRef.current = false
        cancelUserScrollTimer()
      }
      cancelFollowingLineAnimations()
    }

    const currentLyrics = latestLyricsRef.current
    const timeline = locateLyricTimeline(currentLyrics, positionSeconds)
    if (!timeline) return

    const previousInteraction = previousInteractionRef.current
    previousInteractionRef.current = interaction
    let navigationSession = navigationSessionRef.current
    if (navigationSession && !isCurrentNavigationSession(navigationSession)) {
      cancelLyricNavigation()
      navigationSession = null
    }
    const navigationReachedExactTarget = navigationSession !== null
      && timeline.currentIndex === navigationSession.targetIndex
      && currentLyrics[timeline.currentIndex]?.id === navigationSession.targetId
    if (navigationSession && interaction === 'seeking' && !navigationReachedExactTarget) {
      // A seek that does not land in this request's exact lyric interval is an
      // external interaction; it must not inherit the click navigation session.
      cancelLyricNavigation()
      navigationSession = null
    }
    if (
      navigationSession
      && navigationReachedExactTarget
      && startLyricNavigation(navigationSession)
    ) {
      activeIndexRef.current = timeline.currentIndex
      return
    }
    if (navigationSession?.started) {
      if (timeline.currentIndex === navigationSession.targetIndex) {
        activeIndexRef.current = timeline.currentIndex
        return
      }
      cancelLyricNavigation()
    }
    // The player's optimistic clock may briefly publish intermediate positions.
    // Only the exact requested lyric is allowed to consume this navigation.
    if (navigationSession && !navigationSession.started) return
    if (lineCentersRef.current.length !== currentLyrics.length) return
    if (userScrollingRef.current && userScrollWaitForFollowingRef.current) return

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
      && navigationSessionRef.current === null
      && timeline.currentIndex === previousActiveIndex + 1
    if (isNaturalFollowingStep) {
      animateFollowingStep(targetTop, previousActiveIndex, timeline.currentIndex)
      return
    }
    animateFollowingScroll(targetTop)
  }, [animateFollowingScroll, animateFollowingStep, animateInteractiveScroll, cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, cancelUserScrollTimer, interaction, isCurrentNavigationSession, lyricLayoutSignature, lyricListRef, positionSeconds, scheduleDirectScroll, startLyricNavigation, targetScrollTop])

  useEffect(() => () => {
    cancelScrollFrame()
    cancelUserScrollTimer()
    userScrollWaitForFollowingRef.current = false
    cancelLyricNavigation()
    cancelFollowingLineAnimations()
  }, [cancelFollowingLineAnimations, cancelLyricNavigation, cancelScrollFrame, cancelUserScrollTimer])

  return { navigateToLyric, prepareFollowingStep }
}
