import type { TrackSummary } from './playerTypes'

export type Direction = -1 | 1
export type ShuffleMode = 'none' | 'shuffle-all' | 'shuffle-category-order' | 'shuffle-category-random'
export type RepeatMode = 'list-loop' | 'repeat-one' | 'sequential' | 'all-categories-until-stop'

export const nextShuffleMode: Record<ShuffleMode, ShuffleMode> = {
  none: 'shuffle-all',
  'shuffle-all': 'shuffle-category-order',
  'shuffle-category-order': 'shuffle-category-random',
  'shuffle-category-random': 'none',
}

export const nextRepeatMode: Record<RepeatMode, RepeatMode> = {
  'list-loop': 'repeat-one',
  'repeat-one': 'sequential',
  sequential: 'all-categories-until-stop',
  'all-categories-until-stop': 'list-loop',
}

function getTrackCategory(track: TrackSummary) {
  return track.category ?? track.album
}

function getCategoryOrder(tracks: readonly TrackSummary[]) {
  return Array.from(new Set(tracks.map(getTrackCategory)))
}

function randomFromIndexes(indexes: number[], fallback: number, excludedIndex?: number) {
  const candidates = indexes.filter((index) => index !== excludedIndex)
  const pool = candidates.length ? candidates : indexes

  if (!pool.length) return fallback

  return pool[Math.floor(Math.random() * pool.length)]
}

function resolveShuffleAllIndex(tracks: readonly TrackSummary[], currentIndex: number) {
  return randomFromIndexes(tracks.map((_, index) => index), currentIndex, currentIndex)
}

function resolveCategoryOrderRandomIndex(tracks: readonly TrackSummary[], currentIndex: number, direction: Direction) {
  const current = tracks[currentIndex] ?? tracks[0]
  if (!current) return currentIndex

  const categories = getCategoryOrder(tracks)
  const currentCategoryIndex = Math.max(0, categories.indexOf(getTrackCategory(current)))
  const nextCategory = categories[(currentCategoryIndex + direction + categories.length) % categories.length]
  const indexes = tracks.map((track, index) => getTrackCategory(track) === nextCategory ? index : -1).filter((index) => index >= 0)

  return randomFromIndexes(indexes, currentIndex)
}

function resolveCategoryRandomSequentialIndex(tracks: readonly TrackSummary[], currentIndex: number, direction: Direction) {
  const current = tracks[currentIndex] ?? tracks[0]
  if (!current) return currentIndex

  const currentCategory = getTrackCategory(current)
  const categoryIndexes = tracks.map((track, index) => getTrackCategory(track) === currentCategory ? index : -1).filter((index) => index >= 0)
  const currentPosition = categoryIndexes.indexOf(currentIndex)
  const nextInCategory = categoryIndexes[currentPosition + direction]

  if (nextInCategory !== undefined) return nextInCategory

  const categories = getCategoryOrder(tracks)
  const category = randomFromIndexes(categories.map((_, index) => index), 0, categories.indexOf(currentCategory))
  const targetCategory = categories[category]
  const targetIndexes = tracks.map((track, index) => getTrackCategory(track) === targetCategory ? index : -1).filter((index) => index >= 0)

  return direction === 1 ? targetIndexes[0] ?? currentIndex : targetIndexes[targetIndexes.length - 1] ?? currentIndex
}

export function resolveNextTrackIndex(tracks: readonly TrackSummary[], currentIndex: number, direction: Direction, mode: ShuffleMode) {
  if (mode === 'shuffle-all') return resolveShuffleAllIndex(tracks, currentIndex)
  if (mode === 'shuffle-category-order') return resolveCategoryOrderRandomIndex(tracks, currentIndex, direction)
  if (mode === 'shuffle-category-random') return resolveCategoryRandomSequentialIndex(tracks, currentIndex, direction)

  return (currentIndex + direction + tracks.length) % tracks.length
}
