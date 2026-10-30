import type { PlaylistCoverImage } from './playerUiViewModel'

// Readiness belongs to the resource, not to the temporary view displaying it.
// Weak ownership lets the bounded artwork store release an image normally.
const decodedCovers = new WeakSet<PlaylistCoverImage>()
// Decode readiness is not a presentation: workers prepare images before any
// card mounts. Keep first-reveal history separate and never retain image data.
const presentedCovers = new WeakSet<PlaylistCoverImage>()
const presentedUrls = new Set<string>()
const PRESENTED_URL_LIMIT = 512

export function isPlaylistCoverPresented(image: PlaylistCoverImage | string): boolean {
  return typeof image === 'string' ? presentedUrls.has(image)
    : presentedCovers.has(image) || presentedUrls.has(image.src)
}

export function markPlaylistCoverPresented(image: PlaylistCoverImage | string): void {
  if (typeof image !== 'string') presentedCovers.add(image)
  const src = typeof image === 'string' ? image : image.src
  presentedUrls.delete(src)
  presentedUrls.add(src)
  if (presentedUrls.size > PRESENTED_URL_LIMIT) presentedUrls.delete(presentedUrls.values().next().value!)
}

// Prepare the actual object URL before it reaches a temporary playlist view.
// The caller owns concurrency, staleness checks, and URL disposal.
export async function decodePlaylistCover(image: PlaylistCoverImage): Promise<void> {
  const element = new Image()
  element.decoding = 'async'
  try {
    if (typeof element.decode === 'function') {
      element.src = image.src
      await element.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        element.onload = () => resolve()
        element.onerror = () => reject(new Error('Playlist cover image could not load'))
        element.src = image.src
      })
    }
    if (!element.complete || element.naturalWidth === 0) throw new Error('Playlist cover image could not decode')
    markPlaylistCoverDecoded(image)
  } finally {
    element.onload = null
    element.onerror = null
    element.removeAttribute('src')
  }
}

export function isPlaylistCoverDecoded(image: PlaylistCoverImage): boolean {
  return decodedCovers.has(image)
}

export function markPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.add(image)
}

export function forgetPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.delete(image)
}
