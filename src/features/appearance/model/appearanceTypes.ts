import type { CSSProperties } from 'react'
import type { IconProviderId } from '@/icons/systemIcons'

export type AppearanceThemeId = 'default'
export type MotionLevel = 'off' | 'subtle' | 'expressive'

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
  easing: string
}

export type AppearancePreset = {
  id: AppearanceThemeId
  name: string
  colors: AppearanceColors
  radii: AppearanceRadii
  motion: AppearanceMotion
  icons: {
    provider: IconProviderId
  }
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
  '--player-blue': string
  '--player-blue-soft': string
  '--player-blue-ink': string
  '--player-ink': string
  '--player-muted': string
}
