import type { CSSProperties } from 'react'
import type { IconProviderId } from '@/icons/iconProviderIds'

export type AppearanceThemeId = string
export type ColorSchemePreference = 'system' | 'light' | 'dark'
export type ResolvedColorScheme = Exclude<ColorSchemePreference, 'system'>
export type MotionLevel = 'off' | 'subtle' | 'expressive'
export type AppearanceEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier(.65, 0, .35, 1)'
export type AppearanceTier = 'standard' | 'advanced' | 'experimental'
export type SurfaceVariant = 'glass' | 'solid' | 'flat'
export type ButtonVariant = 'soft' | 'outline' | 'minimal'
export type WindowControlVariant = 'standard' | 'compact' | 'traffic-lights'
export type PlayerBackgroundEffect = 'cover-ambient' | 'theme-gradient' | 'solid' | 'off'
export type PlayerActiveLyricEmphasis = 'bold' | 'scale' | 'accent' | 'combined'

export type AppearanceColors = {
  libraryIcon: string
  librarySongs: string
  libraryFolder: string
  libraryFolders: string
  libraryAlbum: string
  libraryArtist: string
  libraryAlbumArtist: string
  libraryGenre: string
  libraryYear: string
  libraryComposer: string
  libraryPlaylists: string
  libraryStreams: string
  libraryQueue: string
  libraryBookmarks: string
  libraryMostPlayed: string
  libraryHighestRated: string
  libraryLowestRated: string
  libraryRecentPlayed: string
  libraryRecentAdded: string
  libraryLongTracks: string
  background: string
  surface: string
  surfaceMuted: string
  text: string
  textMuted: string
  textStrong: string
  border: string
  accent: string
  accentSoft: string
  accentContrast: string
  playerBlue: string
  playerBlueSoft: string
  playerBlueInk: string
  playerInk: string
  playerMuted: string
  playerLyrics: string
  playerOverlay: string
  playerDock: string
  playerSurfaceVariant: string
  playerSecondaryContainer: string
  playerSecondaryFix: string
  playerProgressPlayed: string
  playerProgressUnplayed: string
}

export type AppearanceColorSchemes = Record<ResolvedColorScheme, AppearanceColors>

export type AppearanceRadii = {
  sm: string
  md: string
  lg: string
  pill: string
}

export type AppearanceMotion = {
  level: MotionLevel
  durationScale: number
  easing: AppearanceEasing
}

export type AppearanceTypography = {
  fontFamily: 'geist' | 'system' | 'serif' | 'monospace'
  fontScale: number
}

export type AppearanceComponents = {
  surface: SurfaceVariant
  buttons: ButtonVariant
  windowControls: WindowControlVariant
}

export type AppearancePlayerTrackMetadata = {
  titleMaxWidth: number
  detailsMaxWidth: number
  scrollPixelsPerSecond: number
  scrollStartDelayMs: number
  scrollEdgePauseMs: number
}

export type AppearancePlayerControls = {
  material: 'inherit' | SurfaceVariant
  radius: number
  shadow: number
  density: 'compact' | 'standard' | 'comfortable'
  primaryButton: {
    style: 'filled' | 'soft' | 'outline'
    sizeScale: number
  }
  auxiliaryButtons: {
    style: 'tiered' | 'minimal' | 'soft' | 'outline'
  }
  progress: {
    trackThickness: number
    thumbSize: number
  }
  visibility: {
    timeLabels: boolean
    volumePercent: boolean
  }
}

export type AppearancePlayer = {
  backgroundEffect: PlayerBackgroundEffect
  backgroundBlur: number
  backgroundBrightness: number
  backgroundSaturation: number
  backgroundMaskOpacity: number
  backgroundVignette: number
  coverRadius: number
  coverShadow: number
  lyricsFontScale: number
  lyricsTightSpacing: number
  lyricsNormalSpacing: number
  lyricsTightThresholdSeconds: number
  lyricsOverscrollDistance: number
  activeLyricEmphasis: PlayerActiveLyricEmphasis
  controls: AppearancePlayerControls
  controllerSwipe: {
    easing: AppearanceEasing
    pageGap: number
    toggleWidth: number
    toggleHeight: number
    toggleRadius: number
    toggleFeedbackOpacity: number
    holdDelayMs: number
    highlightInMs: number
    highlightOutMs: number
    settleDurationMs: number
    highlightOpacity: number
    radius: number
  }
  trackMetadata: AppearancePlayerTrackMetadata
}

export type AppearanceResource = {
  id: string
  kind: 'font' | 'image'
  source: string
}

export type AppearanceThemeMetadata = {
  tier: AppearanceTier
  author: string
  description: string
  capabilities: Array<'tokens' | 'custom-css' | 'layout-overrides' | 'local-resources'>
  riskAcknowledged: boolean
}

export type AppearancePreset = {
  id: AppearanceThemeId
  name: string
  colorSchemes: AppearanceColorSchemes
  radii: AppearanceRadii
  motion: AppearanceMotion
  typography: AppearanceTypography
  components: AppearanceComponents
  player: AppearancePlayer
  icons: {
    provider: IconProviderId
  }
  advanced: {
    customCss: string
  }
  experimental: {
    layoutCss: string
    resources: AppearanceResource[]
  }
  metadata: AppearanceThemeMetadata
}

export type AppearanceCssVars = CSSProperties & {
  '--playlist-controller-swipe-page-gap': string
  '--playlist-controller-toggle-width': string
  '--playlist-controller-toggle-height': string
  '--playlist-controller-toggle-radius': string
  '--playlist-controller-toggle-feedback': string
  '--playlist-controller-swipe-radius': string
  '--playlist-controller-swipe-highlight': string
  '--library-icon': string
  '--playlist-category-songs': string
  '--playlist-category-folder': string
  '--playlist-category-folders': string
  '--playlist-category-album': string
  '--playlist-category-artist': string
  '--playlist-category-album-artist': string
  '--playlist-category-genre': string
  '--playlist-category-year': string
  '--playlist-category-composer': string
  '--playlist-category-playlists': string
  '--playlist-category-streams': string
  '--playlist-category-queue': string
  '--playlist-category-bookmarks': string
  '--playlist-category-most-played': string
  '--playlist-category-highest-rated': string
  '--playlist-category-lowest-rated': string
  '--playlist-category-recent-played': string
  '--playlist-category-recent-added': string
  '--playlist-category-long-tracks': string
  '--prototype-unit': string
  '--app-bg': string
  '--app-surface': string
  '--app-surface-muted': string
  '--app-text': string
  '--app-text-muted': string
  '--app-text-strong': string
  '--app-border': string
  '--app-accent': string
  '--app-accent-soft': string
  '--app-accent-contrast': string
  '--app-radius-sm': string
  '--app-radius-md': string
  '--app-radius-lg': string
  '--app-radius-pill': string
  '--app-motion-fast': string
  '--app-motion-standard': string
  '--app-motion-slow': string
  '--app-motion-prototype-press': string
  '--app-motion-prototype-smart': string
  '--app-motion-duration-scale': number
  '--app-motion-easing': string
  '--app-font-family': string
  '--app-font-scale': number
  '--player-blue': string
  '--player-blue-soft': string
  '--player-blue-ink': string
  '--player-ink': string
  '--player-muted': string
  '--player-lyrics-color': string
  '--player-overlay': string
  '--player-dock': string
  '--player-surface-variant': string
  '--player-secondary-container': string
  '--player-secondary-fix': string
  '--player-controls-radius': string
  '--player-controls-radius-short': string
  '--player-controls-shadow': number
  '--player-primary-size-scale': number
  '--player-progress-played': string
  '--player-progress-unplayed': string
  '--player-progress-track-thickness': string
  '--player-progress-thumb-size': string
  '--player-background-blur': string
  '--player-background-brightness': string
  '--player-background-saturation': string
  '--player-background-mask-opacity': number
  '--player-background-vignette-opacity': number
  '--player-cover-radius': string
  '--player-cover-radius-responsive': string
  '--player-cover-shadow': string
  '--player-cover-shadow-responsive': string
  '--player-lyrics-font-scale': number
  '--player-lyrics-tight-spacing': number
  '--player-lyrics-normal-spacing': number
  '--player-lyrics-overscroll-distance': string
  '--player-lyrics-item-height': string
  '--player-lyrics-font-size': string
  '--player-lyrics-line-height': string
  '--player-lyrics-translation-font-size': string
  '--player-lyrics-translation-line-height': string
  '--player-active-lyric-color': string
  '--player-active-lyric-font-weight': number
  '--player-active-lyric-scale': number
  '--player-track-title-max-width': string
  '--player-track-details-max-width': string
  '--player-theme-gradient': string
  '--cover-placeholder-surface': string
  '--cover-placeholder-sheen': string
  '--cover-placeholder-pulse': string
  '--background': string
  '--foreground': string
  '--card': string
  '--card-foreground': string
  '--popover': string
  '--popover-foreground': string
  '--primary': string
  '--primary-foreground': string
  '--secondary': string
  '--secondary-foreground': string
  '--muted': string
  '--muted-foreground': string
  '--accent': string
  '--accent-foreground': string
  '--border': string
  '--input': string
  '--ring': string
  '--radius': string
}
