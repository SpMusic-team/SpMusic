import type { RatingMode } from './trackRating'
import type { TrackRating } from './playerTypes'
import { normalizeAudioSourcePath } from './playlistTrackSummary'
export function highestRatedSongs<T extends { trackId: string; sourcePath: string; track: { title: string } }>(songs: readonly T[], ratings: Readonly<Record<string, TrackRating>>, mode: RatingMode = 'stars'): T[] {
  return songs.filter(song => mode === 'thumbs' ? ratings[song.trackId] === 5 : (ratings[song.trackId] ?? 0) > 1).sort((a, b) => (ratings[b.trackId] ?? 0) - (ratings[a.trackId] ?? 0) || a.track.title.localeCompare(b.track.title) || normalizeAudioSourcePath(a.sourcePath).localeCompare(normalizeAudioSourcePath(b.sourcePath)))
}

export function lowestRatedSongs<T extends { trackId: string; sourcePath: string; track: { title: string } }>(songs: readonly T[], ratings: Readonly<Record<string, TrackRating>>): T[] {
  return songs.filter(song => ratings[song.trackId] === 1).sort((a, b) => a.track.title.localeCompare(b.track.title) || normalizeAudioSourcePath(a.sourcePath).localeCompare(normalizeAudioSourcePath(b.sourcePath)))
}
