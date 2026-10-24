import type { CoverTone } from './playerTypes'
import type { PlaylistCoverImage } from './playerUiViewModel'

export type PlaylistArtworkSnapshot = Readonly<{
  coverTone?: CoverTone
  hasLocalArtwork?: boolean
  coverThumbnail?: PlaylistCoverImage
}>

export type PlaylistArtworkStore = ReturnType<typeof createPlaylistArtworkStore>
export type PlaylistArtworkSource = Readonly<{
  store: PlaylistArtworkStore
  keyByTrackId: ReadonlyMap<string, string>
}>

export function playlistArtworkKey(scope: string, id: string, sourcePath: string): string {
  return JSON.stringify([scope, id, sourcePath.replaceAll('\\', '/')])
}

// This is a notification bridge over an existing owner's canonical rows. It
// never holds a second artwork cache or creates/revokes an object URL.
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
