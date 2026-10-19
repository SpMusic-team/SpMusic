export type StartupPage = 'player' | 'media-library'

const STARTUP_PAGE_STORAGE_KEY = 'spmusic.player.startup-page.v1'

export function readStartupPage(): StartupPage {
  if (typeof window === 'undefined') return 'player'
  try {
    const stored = window.localStorage.getItem(STARTUP_PAGE_STORAGE_KEY)
    return stored === 'media-library' ? 'media-library' : 'player'
  } catch {
    return 'player'
  }
}

export function persistStartupPage(page: StartupPage): void {
  try {
    window.localStorage.setItem(STARTUP_PAGE_STORAGE_KEY, page)
  } catch {
    // A blocked or full store must not interrupt the settings interaction.
  }
}
