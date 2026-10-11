import type { DemoLyricLine } from '@/features/player/model/playerTypes'

export type LyricTimelinePosition = {
  currentIndex: number
  nextIndex: number
  intervalProgress: number
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function locateLyricTimeline(
  lyrics: readonly DemoLyricLine[],
  positionSeconds: number,
): LyricTimelinePosition | null {
  if (!lyrics.length) return null

  let low = 0
  let high = lyrics.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (lyrics[middle].timeSeconds <= positionSeconds) low = middle + 1
    else high = middle
  }

  const currentIndex = Math.min(Math.max(low - 1, 0), lyrics.length - 1)
  const nextIndex = Math.min(currentIndex + 1, lyrics.length - 1)
  const currentTime = lyrics[currentIndex].timeSeconds
  const nextTime = lyrics[nextIndex].timeSeconds
  const intervalProgress = nextIndex === currentIndex || nextTime <= currentTime
    ? 0
    : clamp01((positionSeconds - currentTime) / (nextTime - currentTime))

  return { currentIndex, nextIndex, intervalProgress }
}
