export const PLAYLIST_ARTWORK_GRACE_MS = 5000

export type PlaylistArtworkResident = Readonly<{ id: string; source: string; bytes: number }>
type GraceClock = { now: () => number; schedule: (callback: () => void, delay: number) => () => void }
const defaultClock: GraceClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => {
    const timer = setTimeout(callback, delay)
    return () => clearTimeout(timer)
  },
}

export function createPlaylistArtworkGrace(onExpire: () => void = () => {}, clock: GraceClock = defaultClock) {
  const leases = new Map<string, { source: string; expiresAt: number }>()
  let cancelTimer: (() => void) | undefined
  let revision = 0
  const cancel = () => {
    revision += 1
    cancelTimer?.()
    cancelTimer = undefined
  }
  const reset = () => {
    cancel()
    leases.clear()
  }
  return {
    setExpiryHandler(handler: () => void) { onExpire = handler },
    reset,
    dispose: reset,
    // Returns inactive resident IDs only, never new worker/decode demand.
    retain(residents: readonly PlaylistArtworkResident[], demanded: ReadonlySet<string>, spareBytes: number): ReadonlySet<string> {
      cancel()
      const now = clock.now()
      const residentIds = new Set(residents.map((resident) => resident.id))
      for (const id of leases.keys()) if (!residentIds.has(id) || demanded.has(id)) leases.delete(id)
      const inactive = residents.filter((resident) => {
        if (demanded.has(resident.id)) return false
        const lease = leases.get(resident.id)
        if (lease && lease.source !== resident.source) return false
        if (!lease) {
          // A changed source must never inherit the previous resource's lease.
          leases.set(resident.id, { source: resident.source, expiresAt: now + PLAYLIST_ARTWORK_GRACE_MS })
        }
        // Keep expired leases until the resource leaves the owner store. A
        // second budget pass must not mistake expiry for a newly inactive URL.
        return leases.get(resident.id)!.expiresAt > now
      }).sort((a, b) => leases.get(b.id)!.expiresAt - leases.get(a.id)!.expiresAt)
      const retained = new Set<string>()
      let remainingBytes = Math.max(0, spareBytes)
      let nearestExpiry = Infinity
      for (const resident of inactive) {
        if (!Number.isFinite(resident.bytes) || resident.bytes < 0 || resident.bytes > remainingBytes) continue
        remainingBytes -= resident.bytes
        retained.add(resident.id)
        nearestExpiry = Math.min(nearestExpiry, leases.get(resident.id)!.expiresAt)
      }
      if (Number.isFinite(nearestExpiry)) {
        const token = revision
        cancelTimer = clock.schedule(() => {
          if (token !== revision) return
          cancelTimer = undefined
          onExpire()
        }, nearestExpiry - now)
      }
      return retained
    },
  }
}
