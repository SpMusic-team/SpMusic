import type { RepeatMode, ShuffleMode } from './playbackModes'

const REPEAT_MODE_STORAGE_KEY = 'spmusic.player.repeat-mode.v1'
const SHUFFLE_MODE_STORAGE_KEY = 'spmusic.player.shuffle-mode.v1'
const REPEAT_MODES: readonly RepeatMode[] = ['list-loop', 'repeat-one', 'sequential', 'all-categories-until-stop']
const SHUFFLE_MODES: readonly ShuffleMode[] = ['none', 'shuffle-all', 'shuffle-category-order', 'shuffle-category-random']

function readStoredMode<T extends string>(key: string, modes: readonly T[], defaultMode: T): T {
  if (typeof window === 'undefined') return defaultMode
  try {
    const stored = window.localStorage.getItem(key)
    return stored !== null && modes.includes(stored as T) ? stored as T : defaultMode
  } catch {
    return defaultMode
  }
}

function persistStoredMode(key: string, mode: string): void {
  try {
    window.localStorage.setItem(key, mode)
  } catch {
    // A blocked or full store must not prevent changing the current mode.
  }
}

export function readRepeatMode(): RepeatMode {
  return readStoredMode(REPEAT_MODE_STORAGE_KEY, REPEAT_MODES, 'list-loop')
}

export function readShuffleMode(): ShuffleMode {
  return readStoredMode(SHUFFLE_MODE_STORAGE_KEY, SHUFFLE_MODES, 'none')
}

export function persistRepeatMode(mode: RepeatMode): void {
  persistStoredMode(REPEAT_MODE_STORAGE_KEY, mode)
}

export function persistShuffleMode(mode: ShuffleMode): void {
  persistStoredMode(SHUFFLE_MODE_STORAGE_KEY, mode)
}
