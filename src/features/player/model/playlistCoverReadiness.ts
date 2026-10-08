import type { PlaylistCoverImage } from './playerUiViewModel'

// Readiness belongs to the resource, not to the temporary view displaying it.
// Weak ownership lets the bounded artwork store release an image normally.
const decodedCovers = new WeakSet<PlaylistCoverImage>()

export function isPlaylistCoverDecoded(image: PlaylistCoverImage): boolean {
  return decodedCovers.has(image)
}

export function markPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.add(image)
}

export function forgetPlaylistCoverDecoded(image: PlaylistCoverImage): void {
  decodedCovers.delete(image)
}
