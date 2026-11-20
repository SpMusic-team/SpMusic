export type TrackCardInteractionPhase = 'idle' | 'dragging' | 'settling'

export type TrackCardPointerState = {
  latestX: number
  latestAt: number
  velocityX: number
  viewportPosition: number
}

export type TrackCardPointerSample = {
  clientX: number
  at: number
}

export const TRACK_CARD_MAX_RELEASE_VELOCITY = 3200
export const TRACK_CARD_MAX_VIEWPORT_POSITION = 0.96

export function integrateTrackCardPointer(
  state: TrackCardPointerState,
  sample: TrackCardPointerSample,
  coverWidth: number,
): TrackCardPointerState {
  const deltaX = sample.clientX - state.latestX
  const elapsedSeconds = Math.max(0.001, (sample.at - state.latestAt) / 1000)
  const instantaneousVelocity = Math.min(
    TRACK_CARD_MAX_RELEASE_VELOCITY,
    Math.max(-TRACK_CARD_MAX_RELEASE_VELOCITY, deltaX / elapsedSeconds),
  )
  const nextPosition = state.viewportPosition - deltaX / (Math.max(1, coverWidth) * 0.55)

  return {
    latestX: sample.clientX,
    latestAt: sample.at,
    // A short low-pass window is less sensitive to one sparse WebView event,
    // while pointerup still contributes the final physical coordinate.
    velocityX: state.velocityX === 0
      ? instantaneousVelocity
      : state.velocityX * 0.35 + instantaneousVelocity * 0.65,
    // Excess distance is deliberately discarded. Reversing the pointer starts
    // reducing the position immediately instead of paying back hidden overrun.
    viewportPosition: Math.min(
      TRACK_CARD_MAX_VIEWPORT_POSITION,
      Math.max(-TRACK_CARD_MAX_VIEWPORT_POSITION, nextPosition),
    ),
  }
}

export function trackCardDirection(
  viewportPosition: number,
  coverWidth: number,
  lockPixels: number,
): -1 | 1 | null {
  const lockProgress = lockPixels / (Math.max(1, coverWidth) * 0.55)
  if (Math.abs(viewportPosition) <= lockProgress) return null
  return viewportPosition > 0 ? 1 : -1
}
