export type PlayerVisualTimelineClock = {
  getPositionSeconds: () => number
  subscribe: (listener: () => void) => () => void
}

export type WritablePlayerVisualTimelineClock = PlayerVisualTimelineClock & {
  setPositionSeconds: (positionSeconds: number) => void
  dispose: () => void
}

export function createPlayerVisualTimelineClock(initialPositionSeconds = 0): WritablePlayerVisualTimelineClock {
  let positionSeconds = initialPositionSeconds
  const listeners = new Set<() => void>()

  return {
    getPositionSeconds: () => positionSeconds,
    setPositionSeconds: (nextPositionSeconds) => {
      if (positionSeconds === nextPositionSeconds) return
      positionSeconds = nextPositionSeconds
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        listeners.delete(listener)
      }
    },
    dispose: () => listeners.clear(),
  }
}
