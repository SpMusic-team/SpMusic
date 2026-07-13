import type { AppearanceCssVars, AppearancePreset, ResolvedColorScheme } from './appearanceTypes'

const fontFamilies = {
  geist: "'Geist Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "ui-monospace, 'Cascadia Code', Consolas, monospace",
} as const

function scaleDuration(baseMs: number, scale: number) {
  return scale === 0 ? '0ms' : `${Math.max(1, Math.round(baseMs * scale))}ms`
}

export function createAppearanceCssVars(appearance: AppearancePreset, resolvedColorScheme: ResolvedColorScheme): AppearanceCssVars {
  const durationScale = appearance.motion.level === 'off' ? 0 : appearance.motion.durationScale
  const colors = appearance.colorSchemes[resolvedColorScheme]

  return {
    '--app-bg': colors.background,
    '--app-surface': colors.surface,
    '--app-surface-muted': colors.surfaceMuted,
    '--app-text': colors.text,
    '--app-text-muted': colors.textMuted,
    '--app-text-strong': colors.textStrong,
    '--app-border': colors.border,
    '--app-accent': colors.accent,
    '--app-accent-soft': colors.accentSoft,
    '--app-accent-contrast': colors.accentContrast,
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
    '--player-blue': colors.playerBlue,
    '--player-blue-soft': colors.playerBlueSoft,
    '--player-blue-ink': colors.playerBlueInk,
    '--player-ink': colors.playerInk,
    '--player-muted': colors.playerMuted,
    '--player-overlay': colors.playerOverlay,
    '--player-dock': colors.playerDock,
    '--background': colors.background,
    '--foreground': colors.textStrong,
    '--card': colors.surface,
    '--card-foreground': colors.text,
    '--popover': colors.surface,
    '--popover-foreground': colors.text,
    '--primary': colors.accent,
    '--primary-foreground': colors.accentContrast,
    '--secondary': colors.surfaceMuted,
    '--secondary-foreground': colors.textStrong,
    '--muted': colors.surfaceMuted,
    '--muted-foreground': colors.textMuted,
    '--accent': colors.accentSoft,
    '--accent-foreground': colors.textStrong,
    '--border': colors.border,
    '--input': colors.border,
    '--ring': colors.accent,
    '--radius': appearance.radii.md,
  }
}
