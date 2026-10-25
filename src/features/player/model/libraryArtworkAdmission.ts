/** Reserve required/resident leases before admitting bounded cold prefetch. */
export function admitLibraryArtwork<TEdge>(
  required: ReadonlyMap<string, TEdge>,
  optional: ReadonlyMap<string, TEdge>,
  protectedPaths: ReadonlySet<string>,
  residentLimit: number,
  optionalLimit: number,
): Map<string, TEdge> {
  const reserved = new Set([...protectedPaths, ...required.keys()])
  const allowance = Math.max(0, Math.min(optionalLimit, residentLimit - reserved.size))
  const desired = new Map(required)
  let admitted = 0
  for (const [key, edge] of optional) {
    // Pins protect existing images; they do not create another cold read.
    if (reserved.has(key)) continue
    if (admitted >= allowance) break
    desired.set(key, edge)
    admitted += 1
  }
  return desired
}
