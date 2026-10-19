import { easingDefinitionToFunction, type Easing } from 'motion'

export type TrackCardMotionTail = {
  durationSeconds: number
  ease: Easing
}

// Continue the original theme timeline from the pose already painted by a
// pointer or an interrupted animation, rather than restarting its slow entry.
export function createTrackCardMotionTail(
  progress: number,
  durationSeconds: number,
  ease: Easing,
): TrackCardMotionTail {
  const p = Math.min(1, Math.max(0, progress))
  if (p === 0) return { durationSeconds, ease }
  if (p >= 1 - 1e-7) return { durationSeconds: 0, ease }

  const easing = easingDefinitionToFunction(ease)
  let low = 0
  let high = 1
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2
    if (easing(middle) < p) low = middle
    else high = middle
  }
  const startTime = (low + high) / 2
  const remainingTime = 1 - startTime
  return {
    durationSeconds: durationSeconds * remainingTime,
    ease: (value: number) => {
      if (value <= 0) return 0
      if (value >= 1) return 1
      return Math.min(1, Math.max(0,
        (easing(startTime + remainingTime * value) - p) / (1 - p),
      ))
    },
  }
}
