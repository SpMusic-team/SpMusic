import type { AppearanceCssVars, AppearancePreset, ResolvedColorScheme } from './appearanceTypes'

const fontFamilies = {
  geist: "'Geist Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "ui-monospace, 'Cascadia Code', Consolas, monospace",
} as const

function compactNumber(value: number) {
  return Number(value.toFixed(3))
}

function prototypeLength(value: number) {
  return value === 0 ? '0px' : `calc(${compactNumber(value)} * var(--prototype-unit))`
}

function controlLength(value: number) {
  return value === 0 ? '0px' : `calc(${compactNumber(value)} * var(--control-unit, var(--prototype-unit)))`
}

function playerCoverShadow(value: number, responsive = false) {
  if (value === 0) return 'none'
  const scale = value / 50
  const x = compactNumber(-6 * scale)
  const y = compactNumber(6 * scale)
  const blur = compactNumber(4 * scale ** 3)
  const alpha = compactNumber(Math.min(0.5, 0.25 * scale))
  return responsive
    ? `${x}px ${y}px ${blur}px rgba(0, 0, 0, ${alpha})`
    : `${prototypeLength(x)} ${prototypeLength(y)} ${prototypeLength(blur)} rgba(0, 0, 0, ${alpha})`
}

function scaleDuration(baseMs: number, scale: number) {
  return scale === 0 ? '0ms' : `${Math.max(1, Math.round(baseMs * scale))}ms`
}

export function createAppearanceCssVars(appearance: AppearancePreset, resolvedColorScheme: ResolvedColorScheme): AppearanceCssVars {
  const durationScale = appearance.motion.level === 'off' ? 0 : appearance.motion.durationScale
  const colors = appearance.colorSchemes[resolvedColorScheme]
  const coverRadius = prototypeLength(appearance.player.coverRadius * 0.75)
  const coverRadiusResponsive = `${compactNumber(appearance.player.coverRadius * 0.6)}px`
  const coverShadow = playerCoverShadow(appearance.player.coverShadow)
  const coverShadowResponsive = playerCoverShadow(appearance.player.coverShadow, true)
  const lyricEmphasis = appearance.player.activeLyricEmphasis

  return {
    '--prototype-unit': 'min(0.0390625vw, 0.0694444svh)',
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
    '--app-motion-prototype-press': scaleDuration(200, durationScale),
    '--app-motion-prototype-smart': scaleDuration(300, durationScale),
    '--app-motion-duration-scale': durationScale,
    '--app-motion-easing': appearance.motion.easing,
    '--app-font-family': fontFamilies[appearance.typography.fontFamily],
    '--app-font-scale': appearance.typography.fontScale,
    '--player-blue': colors.playerBlue,
    '--player-blue-soft': colors.playerBlueSoft,
    '--player-blue-ink': colors.playerBlueInk,
    '--player-ink': colors.playerInk,
    '--player-muted': colors.playerMuted,
    '--player-lyrics-color': colors.playerLyrics,
    '--player-overlay': colors.playerOverlay,
    '--player-dock': colors.playerDock,
    '--player-surface-variant': colors.playerSurfaceVariant,
    '--player-controls-radius': controlLength(appearance.player.controls.radius * 0.6),
    '--player-controls-radius-short': `${compactNumber(appearance.player.controls.radius * 0.52)}px`,
    '--player-controls-shadow': appearance.player.controls.shadow / 200,
    '--player-primary-size-scale': appearance.player.controls.primaryButton.sizeScale / 100,
    '--player-progress-played': colors.playerProgressPlayed,
    '--player-progress-unplayed': colors.playerProgressUnplayed,
    '--player-progress-track-thickness': controlLength(appearance.player.controls.progress.trackThickness),
    '--player-progress-thumb-size': controlLength(appearance.player.controls.progress.thumbSize),
    '--player-background-blur': prototypeLength(appearance.player.backgroundBlur * 0.9),
    '--player-background-brightness': `${appearance.player.backgroundBrightness}%`,
    '--player-background-saturation': `${appearance.player.backgroundSaturation}%`,
    '--player-background-mask-opacity': appearance.player.backgroundMaskOpacity / 100,
    '--player-background-vignette-opacity': appearance.player.backgroundVignette / 100,
    '--player-cover-radius': coverRadius,
    '--player-cover-radius-responsive': coverRadiusResponsive,
    '--player-cover-shadow': coverShadow,
    '--player-cover-shadow-responsive': coverShadowResponsive,
    '--player-lyrics-font-scale': appearance.player.lyricsFontScale,
    '--player-lyrics-tight-spacing': appearance.player.lyricsTightSpacing,
    '--player-lyrics-normal-spacing': appearance.player.lyricsNormalSpacing,
    '--player-lyrics-item-height': `calc(${84 * appearance.player.lyricsFontScale} * var(--prototype-unit))`,
    '--player-lyrics-font-size': `calc(${24 * appearance.player.lyricsFontScale} * var(--prototype-unit))`,
    '--player-lyrics-line-height': `calc(${32 * appearance.player.lyricsFontScale} * var(--prototype-unit))`,
    '--player-lyrics-translation-font-size': `calc(${20 * appearance.player.lyricsFontScale} * var(--prototype-unit))`,
    '--player-lyrics-translation-line-height': `calc(${28 * appearance.player.lyricsFontScale} * var(--prototype-unit))`,
    '--player-active-lyric-color': lyricEmphasis === 'accent' ? colors.playerBlue : colors.playerInk,
    '--player-active-lyric-font-weight': lyricEmphasis === 'bold' || lyricEmphasis === 'combined' ? 500 : 400,
    '--player-active-lyric-scale': lyricEmphasis === 'scale' || lyricEmphasis === 'combined' ? 1.08 : 1,
    '--player-track-title-max-width': prototypeLength(appearance.player.trackMetadata.titleMaxWidth),
    '--player-track-details-max-width': prototypeLength(appearance.player.trackMetadata.detailsMaxWidth),
    '--player-theme-gradient': `linear-gradient(145deg, ${colors.accent}, ${colors.accentSoft} 48%, ${colors.surfaceMuted})`,
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
