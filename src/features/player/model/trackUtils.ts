import type { Track } from './playerTypes'

export function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function resolveTrack(tracks: Track[], id: string | null) {
  return tracks.find((track) => track.id === id) ?? tracks[0] ?? null
}
