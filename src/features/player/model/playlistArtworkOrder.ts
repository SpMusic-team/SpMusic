export type PlaylistArtworkDirection = -1 | 0 | 1

export type PlaylistArtworkOrderEntry = {
  rowTop: number
  domIndex: number
  inViewport: boolean
  viewportDistance: number
  side: -1 | 0 | 1
}

/**
 * Direction is the last nonzero scrollTop delta. The reference presents rows
 * bottom-first after a decrease, top-first after an increase. This is row
 * admission order, never a transform or a delay imposed on a ready image.
 */
export function orderPlaylistArtworkRows<T extends PlaylistArtworkOrderEntry>(
  entries: readonly T[],
  direction: PlaylistArtworkDirection,
): T[] {
  const rows: { entries: T[]; top: number; first: number; visible: boolean; distance: number; side: -1 | 0 | 1 }[] = []
  for (const entry of [...entries].sort((left, right) => left.domIndex - right.domIndex)) {
    const previous = rows[rows.length - 1]
    if (previous && Math.abs(previous.top - entry.rowTop) < 1) {
      previous.entries.push(entry)
      previous.visible ||= entry.inViewport
      previous.distance = Math.min(previous.distance, entry.viewportDistance)
    } else rows.push({ entries: [entry], top: entry.rowTop, first: entry.domIndex,
      visible: entry.inViewport, distance: entry.viewportDistance, side: entry.side })
  }
  rows.sort((left, right) => {
    if (left.visible !== right.visible) return Number(right.visible) - Number(left.visible)
    if (left.visible) return (direction ? direction * (left.top - right.top) : 0) || left.first - right.first
    // Prefetch follows actual travel, separately from the visible row order.
    const leftAhead = direction !== 0 && left.side === direction
    const rightAhead = direction !== 0 && right.side === direction
    return Number(rightAhead) - Number(leftAhead) || left.distance - right.distance || left.first - right.first
  })
  return rows.flatMap(row => row.entries)
}
