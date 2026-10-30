// Scan results keep these arrays stable while summaries and durations update.
// A successful rescan replaces them even when only a sibling image changed.
const revisions = new WeakMap<object, number>()
let nextRevision = 0

export function playlistArtworkRevision(source: { directoryPaths?: readonly string[]; tracks: readonly unknown[] }): number {
  const token = source.directoryPaths ?? source.tracks
  let revision = revisions.get(token)
  if (revision === undefined) {
    revision = ++nextRevision
    revisions.set(token, revision)
  }
  return revision
}
