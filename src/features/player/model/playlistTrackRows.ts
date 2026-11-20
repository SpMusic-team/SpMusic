import type { PlaylistTrackItemViewModel } from './playerUiViewModel'

/** Keep unchanged presentation rows shared when a single thumbnail arrives. */
export function sharePlaylistTrackRows(
  previous: PlaylistTrackItemViewModel[],
  next: PlaylistTrackItemViewModel[],
): PlaylistTrackItemViewModel[] {
  if (previous === next) return previous
  const byId = new Map(previous.map(row => [row.id, row]))
  const shared = next.map(row => {
    const old = byId.get(row.id)
    if (!old) return row
    const keys = Object.keys(row) as (keyof PlaylistTrackItemViewModel)[]
    return keys.length === Object.keys(old).length
      && keys.every(key => Object.hasOwn(old, key) && Object.is(old[key], row[key])) ? old : row
  })
  return shared.length === previous.length && shared.every((row, index) => row === previous[index])
    ? previous : shared
}
