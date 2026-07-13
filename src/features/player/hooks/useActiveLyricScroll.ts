import { useEffect, useRef, type RefObject } from 'react'

function getAppMotionDuration(variableName: string, fallbackMs: number) {
  const appRoot = document.querySelector('.spmusic-app') ?? document.documentElement
  const value = window.getComputedStyle(appRoot).getPropertyValue(variableName)
  const duration = Number.parseFloat(value)

  return Number.isFinite(duration) ? duration : fallbackMs
}

export function useActiveLyricScroll(
  activeLyricId: string | undefined,
  lyricListRef: RefObject<HTMLOListElement | null>,
  lyricRefs: RefObject<Map<string, HTMLLIElement>>,
) {
  const lyricScrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (lyricScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(lyricScrollFrameRef.current)
      lyricScrollFrameRef.current = null
    }

    if (!activeLyricId) return

    const activeLine = lyricRefs.current.get(activeLyricId)
    const lyricList = lyricListRef.current

    if (!activeLine || !lyricList) return

    const targetTop = Math.min(
      Math.max(
        activeLine.offsetTop - lyricList.clientHeight / 2 + activeLine.clientHeight / 2,
        0,
      ),
      lyricList.scrollHeight - lyricList.clientHeight,
    )
    const startTop = lyricList.scrollTop
    const distance = targetTop - startTop
    const appMotionOff = (document.querySelector('.spmusic-app') ?? document.documentElement).getAttribute('data-motion') === 'off'
    const reduceMotion = appMotionOff || window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || Math.abs(distance) < 0.5) {
      lyricList.scrollTop = targetTop
      return
    }

    const durationMs = getAppMotionDuration('--app-motion-slow', 820)
    if (durationMs <= 0) {
      lyricList.scrollTop = targetTop
      return
    }

    const startTime = performance.now()
    const easeInOutCubic = (progressValue: number) =>
      progressValue < 0.5
        ? 4 * progressValue ** 3
        : 1 - (-2 * progressValue + 2) ** 3 / 2

    const animateScroll = (now: number) => {
      const elapsed = Math.min((now - startTime) / durationMs, 1)

      lyricList.scrollTop = startTop + distance * easeInOutCubic(elapsed)

      if (elapsed < 1) {
        lyricScrollFrameRef.current = window.requestAnimationFrame(animateScroll)
      } else {
        lyricScrollFrameRef.current = null
      }
    }

    lyricScrollFrameRef.current = window.requestAnimationFrame(animateScroll)

    return () => {
      if (lyricScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(lyricScrollFrameRef.current)
        lyricScrollFrameRef.current = null
      }
    }
  }, [activeLyricId, lyricListRef, lyricRefs])
}
