import type { AppearancePreset } from './appearanceTypes'

export const defaultAppearance: AppearancePreset = {
  id: 'default',
  name: 'SpMusic Default',
  colors: {
    background: '#f7f8f4',
    surface: '#ffffff',
    surfaceMuted: '#eef3ec',
    text: '#4f5661',
    textMuted: '#707985',
    textStrong: '#101317',
    border: '#d9ded6',
    accent: '#0f8b7f',
    accentSoft: '#dff3ee',
    accentContrast: '#ffffff',
    playerBlue: '#276389',
    playerBlueSoft: '#cae6ff',
    playerBlueInk: '#276389',
    playerInk: '#17212b',
    playerMuted: '#72777f',
  },
  radii: {
    sm: '6px',
    md: '8px',
    lg: '12px',
    pill: '999px',
  },
  motion: {
    level: 'subtle',
    durationScale: 1,
    easing: 'cubic-bezier(.65, 0, .35, 1)',
  },
  icons: {
    provider: 'default',
  },
}
