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
  playerOverlay: string
  playerDock: string
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
  activeLyricEmphasis: PlayerActiveLyricEmphasis
  showVolumePercent: boolean
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
  '--player-overlay': string
  '--player-dock': string
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
