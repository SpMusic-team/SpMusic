export type PlaylistControllerMode = 'movable' | 'fixed'

const storageKey = 'spmusic.player.playlist-controller-mode.v1'

export function readPlaylistControllerMode(): PlaylistControllerMode {
  try {
    return window.localStorage.getItem(storageKey) === 'fixed' ? 'fixed' : 'movable'
  } catch {
    return 'movable'
  }
}

export function persistPlaylistControllerMode(mode: PlaylistControllerMode): void {
  try {
    window.localStorage.setItem(storageKey, mode)
  } catch {
    // The current session still applies the preference when storage is blocked.
  }
}
