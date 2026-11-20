type ShuffleTrack = Readonly<{ id: string; sourcePath: string; available: boolean }>

export type PageShuffleSession = Readonly<{ scope: string; order: readonly string[] }>

// Keep the display queue intact; only this runtime traversal is randomized.
export function createPageShuffleOrder(tracks: readonly ShuffleTrack[], currentPath?: string,
  random: () => number = Math.random): string[] {
  const candidates = tracks.filter((track) => track.available)
  const order = [...candidates]
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[order[index], order[target]] = [order[target], order[index]]
  }
  const normalizedCurrent = currentPath?.replaceAll('\\', '/')
  const first = order.findIndex((track) => track.sourcePath.replaceAll('\\', '/') !== normalizedCurrent)
  if (first > 0) [order[0], order[first]] = [order[first], order[0]]
  return order.map((track) => track.id)
}

export function resolvePageShuffleTarget(session: PageShuffleSession, tracks: readonly ShuffleTrack[],
  currentId: string, direction: -1 | 1): number | null {
  const current = session.order.indexOf(currentId)
  if (current < 0) return null
  const indexes = new Map(tracks.map((track, index) => [track.id, index]))
  for (let position = current + direction; position >= 0 && position < session.order.length; position += direction) {
    const index = indexes.get(session.order[position])
    if (index !== undefined && tracks[index].available) return index
  }
  return null
}
