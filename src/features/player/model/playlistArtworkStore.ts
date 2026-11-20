import type { CoverTone } from './playerTypes'
import type { PlaylistCoverImage } from './playerUiViewModel'
import type { CoverPresentation } from './playlistCoverReadiness'

export type PlaylistArtworkSnapshot = Readonly<{
  coverTone?: CoverTone
  hasLocalArtwork?: boolean
  coverThumbnail?: PlaylistCoverImage
  /**
   * The owner's published snapshot for `coverThumbnail`.
   *
   * A consumer must render the URL and report back the token of the *same*
   * snapshot. Without it the report carries only a URL, which the owner cannot
   * attribute to a publication — and an unattributable report must never be
   * allowed to evict a replacement or open a recovery.
   */
  presentation?: CoverPresentation
}>

export type PlaylistArtworkStore = ReturnType<typeof createPlaylistArtworkStore>
export type PlaylistArtworkSource = Readonly<{
  store: PlaylistArtworkStore
  keyByTrackId: ReadonlyMap<string, string>
}>

/**
 * Publication lane of a playlist artwork key.
 *
 * A detail page has two artwork surfaces over the same cover source: the
 * ordinary 256px rows, and the hero above them, which may take a measured high
 * tier. They must not share a publication record — one record per trackId is
 * what let the hero's 1536 image reach the first row's card. They *do* share the
 * store, the scheduler and the already-ready low-tier preview.
 */
export type PlaylistArtworkLane = 'row' | 'hero'

/**
 * Row key. The tuple is `[scope, id, sourcePath]` and must stay byte-identical:
 * the owners destructure it positionally and existing publications are keyed by
 * it.
 */
export function playlistArtworkKey(scope: string, id: string, sourcePath: string): string {
  return JSON.stringify([scope, id, sourcePath.replaceAll('\\', '/')])
}

/**
 * Hero key, derived from an existing **row** key by appending the lane marker.
 *
 * Deriving instead of rebuilding `[scope, id, path, 'hero']` from the raw parts
 * makes it structurally impossible for a panel to compute a scope the owner
 * would not: the first three elements are the row's own, by construction.
 *
 * The tier and the artwork revision are deliberately absent. A tier change
 * (window resize) has to replace the image **in place** on the same
 * subscription, and a revision change is carried by the publication token, not
 * by the key.
 */
export function heroPlaylistArtworkKey(rowKey: string): string {
  const tuple: unknown = JSON.parse(rowKey)
  if (!Array.isArray(tuple) || tuple.length !== 3) {
    throw new Error('heroPlaylistArtworkKey expects a 3-element row key')
  }
  return JSON.stringify([...tuple, 'hero'])
}

/** Whether a key belongs to the hero lane. A 3-tuple (including legacy keys) is a row. */
export function isHeroArtworkKey(key: string | readonly unknown[]): boolean {
  const tuple: unknown = typeof key === 'string' ? JSON.parse(key) : key
  return Array.isArray(tuple) && tuple.length === 4 && tuple[3] === 'hero'
}

/**
 * Slot id of the hero publication.
 *
 * Used as the presentation token's `key` and as the recovery-ledger key. It is
 * never a real track id, so it can never address a row publication — and a row
 * id can never address the hero.
 */
export function heroSlotId(trackId: string): string {
  return `${trackId}\u0000hero`
}

/** Whether a presentation/recovery key belongs to the hero lane. */
export function isHeroSlotId(key: string): boolean {
  return key.endsWith('\u0000hero')
}

/**
 * Full display identity of one hero publication.
 *
 * Scheme §3 reuses exactly this string to decide whether an already-published
 * hero may keep being displayed across an owner handover. It contains every
 * element that makes a different image, and nothing that a viewport change
 * alters: the tier is a property of the publication, not of the identity.
 */
export function heroDisplayIdentity(source: PlaylistHeroSource): string {
  return JSON.stringify([
    'playlist-hero', source.scope, source.trackId, source.sourcePath, source.artworkRevision,
  ])
}

/** The resource one hero publication describes. */
export type PlaylistHeroSource = Readonly<{
  /** Scope of the displayed playlist. */
  scope: string
  /** Real track id of the owner's first available track. */
  trackId: string
  /** Normalized source path of that track. */
  sourcePath: string
  /** Artwork revision the image was read for. A rescan changes it. */
  artworkRevision: number
}>

// This is a notification bridge over an existing owner's canonical rows. It
// never holds a second artwork cache or creates/revokes an object URL.
//
// Hero keys live in the same store but never in the same record: an owner keeps
// the hero publication in a separate single slot, and a hero key must never be
// placed in any `keyByTrackId` map. That is what makes "a row can read the
// hero's high tier" unreachable rather than merely discouraged.
export function createPlaylistArtworkStore(
  read: (key: string) => PlaylistArtworkSnapshot | undefined,
  retain?: (key: string) => () => void,
) {
  let readSnapshot = read
  let retainSnapshot = retain
  const listeners = new Map<string, Set<{ listener: () => void; snapshot: PlaylistArtworkSnapshot | undefined }>>()
  const notify = (keys: Iterable<string>) => {
    for (const key of keys) {
      const subscribers = listeners.get(key)
      if (!subscribers) continue
      const snapshot = readSnapshot(key)
      for (const entry of subscribers) {
        if (Object.is(entry.snapshot, snapshot)) continue
        entry.snapshot = snapshot
        entry.listener()
      }
    }
  }
  return {
    getSnapshot: (key: string) => readSnapshot(key),
    bind(reader: typeof read, retainer?: typeof retain) {
      readSnapshot = reader
      retainSnapshot = retainer
      notify(listeners.keys())
    },
    subscribe(key: string, listener: () => void) {
      const entries = listeners.get(key) ?? new Set()
      const entry = { listener, snapshot: readSnapshot(key) }
      entries.add(entry)
      listeners.set(key, entries)
      return () => { entries.delete(entry); if (!entries.size) listeners.delete(key) }
    },
    notify,
    notifyAll: () => notify(listeners.keys()),
    retain: (key: string) => retainSnapshot?.(key) ?? (() => {}),
  }
}
