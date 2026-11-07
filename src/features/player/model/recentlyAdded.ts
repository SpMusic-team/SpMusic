import { normalizeAudioSourcePath } from './playlistTrackSummary'

/** Current library songs ordered by filesystem creation time; unknown times sort last. */
export function recentlyAddedSongs<T extends { sourcePath: string; fileCreatedAtMs?: number | null }>(songs: readonly T[]): T[] {
  const timestamp = (song: T) => Number.isSafeInteger(song.fileCreatedAtMs) && song.fileCreatedAtMs! >= 0
    ? song.fileCreatedAtMs! : -1
  return [...songs].sort((a, b) => timestamp(b) - timestamp(a)
    || normalizeAudioSourcePath(a.sourcePath).localeCompare(normalizeAudioSourcePath(b.sourcePath)))
}
