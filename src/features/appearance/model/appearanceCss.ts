import type { AppearanceCssVars, AppearancePreset } from './appearanceTypes'

const fontFamilies = {
  geist: "'Geist Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "ui-monospace, 'Cascadia Code', Consolas, monospace",
} as const

function scaleDuration(baseMs: number, scale: number) {
  return scale === 0 ? '0ms' : `${Math.max(1, Math.round(baseMs * scale))}ms`
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
    '--app-font-family': fontFamilies[appearance.typography.fontFamily],
    '--app-font-scale': appearance.typography.fontScale,
    '--player-blue': appearance.colors.playerBlue,
    '--player-blue-soft': appearance.colors.playerBlueSoft,
    '--player-blue-ink': appearance.colors.playerBlueInk,
    '--player-ink': appearance.colors.playerInk,
    '--player-muted': appearance.colors.playerMuted,
    '--player-overlay': appearance.colors.playerOverlay,
    '--player-dock': appearance.colors.playerDock,
    '--background': appearance.colors.background,
    '--foreground': appearance.colors.textStrong,
    '--card': appearance.colors.surface,
    '--card-foreground': appearance.colors.text,
    '--popover': appearance.colors.surface,
    '--popover-foreground': appearance.colors.text,
    '--primary': appearance.colors.accent,
    '--primary-foreground': appearance.colors.accentContrast,
    '--secondary': appearance.colors.surfaceMuted,
    '--secondary-foreground': appearance.colors.textStrong,
    '--muted': appearance.colors.surfaceMuted,
    '--muted-foreground': appearance.colors.textMuted,
    '--accent': appearance.colors.accentSoft,
    '--accent-foreground': appearance.colors.textStrong,
    '--border': appearance.colors.border,
    '--input': appearance.colors.border,
    '--ring': appearance.colors.accent,
    '--radius': appearance.radii.md,
  }
}
