import type { AppearanceCssVars, AppearancePreset } from './appearanceTypes'

function scaleDuration(baseMs: number, scale: number) {
  return `${Math.max(1, Math.round(baseMs * scale))}ms`
}

export function createAppearanceCssVars(appearance: AppearancePreset): AppearanceCssVars {
  const durationScale = appearance.motion.level === 'off' ? 0 : appearance.motion.durationScale

  return {
    '--app-bg': appearance.colors.background,
    '--app-surface': appearance.colors.surface,
    '--app-surface-muted': appearance.colors.surfaceMuted,
    '--app-text': appearance.colors.text,
    '--app-text-muted': appearance.colors.textMuted,
    '--app-text-strong': appearance.colors.textStrong,
    '--app-border': appearance.colors.border,
    '--app-accent': appearance.colors.accent,
    '--app-accent-soft': appearance.colors.accentSoft,
    '--app-accent-contrast': appearance.colors.accentContrast,
    '--app-radius-sm': appearance.radii.sm,
    '--app-radius-md': appearance.radii.md,
    '--app-radius-lg': appearance.radii.lg,
    '--app-radius-pill': appearance.radii.pill,
    '--app-motion-fast': scaleDuration(160, durationScale),
    '--app-motion-standard': scaleDuration(240, durationScale),
    '--app-motion-slow': scaleDuration(820, durationScale),
    '--app-motion-duration-scale': durationScale,
    '--app-motion-easing': appearance.motion.easing,
    '--player-blue': appearance.colors.playerBlue,
    '--player-blue-soft': appearance.colors.playerBlueSoft,
    '--player-blue-ink': appearance.colors.playerBlueInk,
    '--player-ink': appearance.colors.playerInk,
    '--player-muted': appearance.colors.playerMuted,
  }
}
