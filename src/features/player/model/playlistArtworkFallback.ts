import type { PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'

/**
 * The fields the read-only media-library artwork cache owns. Everything else in
 * a playlist row comes from the player's own summary/metadata/visual lanes.
 * `id` is not owned here; it lets an ordinary playlist row (which carries its
 * own text) satisfy the layer contract without inventing a second row type.
 */
export type ReadOnlyArtworkRow = Readonly<{
  id?: string
  hasLocalArtwork?: boolean
  coverThumbnail?: PlaylistCoverImage
}>

/**
 * Layers read-only library artwork below one playlist row.
 *
 * The player's lanes stay authoritative: a value the row already carries is
 * never replaced, so when the active visual pipeline publishes its thumbnail the
 * cached one is swapped in place on the same row. This is what lets a browsed
 * list keep its real covers while a newly activated scope rehydrates its own
 * artwork after a cross-source track selection.
 */
export function withReadOnlyArtworkFallback<T extends object>(
  row: T,
  artwork: ReadOnlyArtworkRow | undefined,
): T & ReadOnlyArtworkRow {
  const current = row as ReadOnlyArtworkRow
  if (!artwork) return row as T & ReadOnlyArtworkRow
  const coverThumbnail = current.coverThumbnail ?? artwork.coverThumbnail
  const hasLocalArtwork = current.hasLocalArtwork ?? artwork.hasLocalArtwork
  if (coverThumbnail === current.coverThumbnail && hasLocalArtwork === current.hasLocalArtwork) {
    return row as T & ReadOnlyArtworkRow
  }
  const layered: { coverThumbnail?: PlaylistCoverImage; hasLocalArtwork?: boolean } = {}
  if (coverThumbnail !== undefined) layered.coverThumbnail = coverThumbnail
  if (hasLocalArtwork !== undefined) layered.hasLocalArtwork = hasLocalArtwork
  return { ...row, ...layered }
}

/**
 * Source paths whose thumbnail a row currently shows only through the read-only
 * fallback. The library cache has to keep those object URLs resident: evicting
 * one while it is still rendered would revoke an image the user can see.
 * `sourcePathById` uses the same normalized keys as the artwork cache.
 */
export function readOnlyArtworkFallbackPaths(
  rows: readonly (ReadOnlyArtworkRow & { id: string })[],
  sourcePathById: ReadonlyMap<string, string>,
  artworkByPath: ReadonlyMap<string, ReadOnlyArtworkRow>,
): Set<string> {
  const paths = new Set<string>()
  for (const row of rows) {
    if (row.coverThumbnail) continue
    const sourcePath = sourcePathById.get(row.id)
    if (!sourcePath || !artworkByPath.get(sourcePath)?.coverThumbnail) continue
    paths.add(sourcePath)
  }
  return paths
}

/**
 * Picks the resident cover that must leave the bounded cache. A cover that is
 * still displayed through the fallback layer is never revoked while any unpinned
 * resident can leave instead. Only a cache made entirely of displayed covers
 * reclaims an on-screen one, because the memory bound is also a hard invariant.
 */
export function selectArtworkEvictionKey(
  keys: readonly string[],
  desired: ReadonlySet<string>,
  pinned: ReadonlySet<string>,
): string | undefined {
  return keys.find((key) => !desired.has(key) && !pinned.has(key))
    ?? keys.find((key) => !pinned.has(key))
    ?? keys.find((key) => !desired.has(key))
    ?? keys[0]
}
