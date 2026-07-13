import type { CSSProperties } from 'react'
import type { IconProviderId } from '@/icons/systemIcons'

export type AppearanceThemeId = string
export type MotionLevel = 'off' | 'subtle' | 'expressive'
export type AppearanceEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier(.65, 0, .35, 1)'
export type AppearanceTier = 'standard' | 'advanced' | 'experimental'
export type SurfaceVariant = 'glass' | 'solid' | 'flat'
export type ButtonVariant = 'soft' | 'outline' | 'minimal'
export type WindowControlVariant = 'standard' | 'compact' | 'traffic-lights'

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
  colors: AppearanceColors
  radii: AppearanceRadii
  motion: AppearanceMotion
  typography: AppearanceTypography
  components: AppearanceComponents
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
