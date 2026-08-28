import { isIconProviderId } from '@/icons/iconProviderIds'
import { defaultAppearance } from './defaultAppearance'
import type {
  AppearanceColors,
  AppearanceColorSchemes,
  AppearanceComponents,
  AppearanceEasing,
  AppearancePreset,
  AppearancePlayer,
  AppearancePlayerControls,
  AppearanceRadii,
  AppearanceResource,
  AppearanceThemeMetadata,
  AppearanceTypography,
  MotionLevel,
} from './appearanceTypes'

export const APPEARANCE_THEME_SCHEMA_VERSION = 5 as const

export type AppearanceThemeDocumentV1 = {
  schemaVersion: 1
  theme: Record<string, unknown>
}

export type AppearanceThemeDocumentV2 = {
  schemaVersion: 2
  format: 'spmusic-theme'
  exportedAt: string
  theme: Record<string, unknown>
}

export type AppearanceThemeDocumentV3 = {
  schemaVersion: 3
  format: 'spmusic-theme'
  exportedAt: string
  theme: Record<string, unknown>
}

export type AppearanceThemeColorSchemesV4 = Record<'light' | 'dark', Omit<AppearanceColors, 'playerSurfaceVariant' | 'playerProgressPlayed' | 'playerProgressUnplayed'>>
export type AppearanceThemePayloadV4 = Record<string, unknown>
export type AppearanceThemeDocumentV4 = {
  schemaVersion: 4
  format: 'spmusic-theme'
  exportedAt: string
  theme: AppearanceThemePayloadV4
}

export type AppearanceThemeColorSchemesV5 =
  | { light: AppearanceColors; dark?: AppearanceColors }
  | { light?: AppearanceColors; dark: AppearanceColors }

export type AppearanceThemePayloadV5 = Omit<AppearancePreset, 'colorSchemes'> & (
  | { colors: AppearanceColors; colorSchemes?: never }
  | { colors?: never; colorSchemes: AppearanceThemeColorSchemesV5 }
)

export type AppearanceThemeDocumentV5 = {
  schemaVersion: typeof APPEARANCE_THEME_SCHEMA_VERSION
  format: 'spmusic-theme'
  exportedAt: string
  theme: AppearanceThemePayloadV5
}

export type AppearanceThemeDocument = AppearanceThemeDocumentV5

export type AppearanceThemeParseResult =
  | { ok: true; appearance: AppearancePreset; warnings: string[]; migratedFrom?: number }
  | { ok: false; appearance: AppearancePreset; error: string }

type JsonObject = Record<string, unknown>

const colorKeys = [
  'background', 'surface', 'surfaceMuted', 'text', 'textMuted', 'textStrong', 'border',
  'accent', 'accentSoft', 'accentContrast', 'playerBlue', 'playerBlueSoft', 'playerBlueInk',
  'playerInk', 'playerMuted', 'playerLyrics', 'playerOverlay', 'playerDock',
  'playerSurfaceVariant',
  'playerProgressPlayed', 'playerProgressUnplayed',
] as const satisfies readonly (keyof AppearanceColors)[]
const radiusKeys = ['sm', 'md', 'lg', 'pill'] as const satisfies readonly (keyof AppearanceRadii)[]
const motionLevels = ['off', 'subtle', 'expressive'] as const satisfies readonly MotionLevel[]
const easingValues = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.65, 0, .35, 1)'] as const satisfies readonly AppearanceEasing[]
const fontFamilies = ['geist', 'system', 'serif', 'monospace'] as const
const surfaces = ['glass', 'solid', 'flat'] as const
const buttonVariants = ['soft', 'outline', 'minimal'] as const
const windowControlVariants = ['standard', 'compact', 'traffic-lights'] as const
const playerBackgroundEffects = ['cover-ambient', 'theme-gradient', 'solid', 'off'] as const
const legacyPlayerBackgroundBlurs = { off: 0, light: 27, medium: 62, strong: 100 } as const
const legacyPlayerCoverRadii = { square: 0, small: 17, medium: 40, large: 100 } as const
const legacyPlayerCoverShadows = { off: 0, light: 25, standard: 50, prominent: 100 } as const
const playerActiveLyricEmphases = ['bold', 'scale', 'accent', 'combined'] as const
const playerControlMaterials = ['inherit', 'glass', 'solid', 'flat'] as const
const playerControlDensities = ['compact', 'standard', 'comfortable'] as const
const playerPrimaryButtonStyles = ['filled', 'soft', 'outline'] as const
const playerAuxiliaryButtonStyles = ['tiered', 'minimal', 'soft', 'outline'] as const
const tiers = ['standard', 'advanced', 'experimental'] as const
const capabilities = ['tokens', 'custom-css', 'layout-overrides', 'local-resources'] as const
const resourceKinds = ['font', 'image'] as const
const themeKeys = ['id', 'name', 'colors', 'colorSchemes', 'radii', 'motion', 'typography', 'components', 'player', 'icons', 'advanced', 'experimental', 'metadata'] as const
const hexColorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i
const lengthPattern = /^(?:0|(?:\d|[1-9]\d|[1-8]\d{2}|9\d{2})(?:\.\d{1,3})?)px$/
const themeIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const resourceIdPattern = /^[a-z][a-z0-9_-]{0,31}$/
const resourceSourcePattern = /^(?:data:|blob:|https?:\/\/|file:)/i
const blockedCssPattern = /(?:<\/style|javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding)/i

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneAppearance(appearance: AppearancePreset): AppearancePreset {
  return {
    ...appearance,
    colorSchemes: {
      light: { ...appearance.colorSchemes.light },
      dark: { ...appearance.colorSchemes.dark },
    },
    radii: { ...appearance.radii },
    motion: { ...appearance.motion },
    typography: { ...appearance.typography },
    components: { ...appearance.components },
    player: {
      ...appearance.player,
      controls: {
        ...appearance.player.controls,
        primaryButton: { ...appearance.player.controls.primaryButton },
        auxiliaryButtons: { ...appearance.player.controls.auxiliaryButtons },
        progress: { ...appearance.player.controls.progress },
        visibility: { ...appearance.player.controls.visibility },
      },
      trackMetadata: { ...appearance.player.trackMetadata },
    },
    icons: { ...appearance.icons },
    advanced: { ...appearance.advanced },
    experimental: {
      ...appearance.experimental,
      resources: appearance.experimental.resources.map((resource) => ({ ...resource })),
    },
    metadata: {
      ...appearance.metadata,
      capabilities: [...appearance.metadata.capabilities],
    },
  }
}

function reportUnknownKeys(object: JsonObject, allowed: readonly string[], path: string, warnings: string[]) {
  Object.keys(object).forEach((key) => {
    if (!allowed.includes(key)) warnings.push(`${path}.${key} 未受支持，已忽略`)
  })
}

function section(root: JsonObject, key: string, warnings: string[]): JsonObject {
  if (root[key] === undefined) return {}
  if (isObject(root[key])) return root[key]
  warnings.push(`theme.${key} 必须是对象，已使用默认值`)
  return {}
}

function text(input: JsonObject, key: string, fallback: string, valid: (value: string) => boolean, path: string, warnings: string[]) {
  const value = input[key]
  if (value === undefined) return fallback
  if (typeof value === 'string' && valid(value)) return value
  warnings.push(`${path}.${key} 无效，已使用默认值`)
  return fallback
}

function enumValue<T extends string>(input: unknown, allowed: readonly T[], fallback: T, path: string, warnings: string[]): T {
  if (input === undefined) return fallback
  if (typeof input === 'string' && allowed.includes(input as T)) return input as T
  warnings.push(`${path} 无效，已使用默认值`)
  return fallback
}

function boundedNumber(input: unknown, fallback: number, min: number, max: number, path: string, warnings: string[]) {
  if (input === undefined) return fallback
  if (typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max) return input
  warnings.push(`${path} 必须在 ${min} 到 ${max} 之间，已使用默认值`)
  return fallback
}

function steppedNumber(input: unknown, fallback: number, min: number, max: number, step: number, path: string, warnings: string[]) {
  if (input === undefined) return fallback
  if (
    typeof input === 'number'
    && Number.isFinite(input)
    && input >= min
    && input <= max
    && Math.abs((input - min) / step - Math.round((input - min) / step)) < Number.EPSILON * 10
  ) return input
  warnings.push(`${path} 必须在 ${min} 到 ${max} 之间且步长为 ${step}，已使用默认值`)
  return fallback
}

function booleanValue(input: unknown, fallback: boolean, path: string, warnings: string[]) {
  if (input === undefined) return fallback
  if (typeof input === 'boolean') return input
  warnings.push(`${path} 必须是布尔值，已使用默认值`)
  return fallback
}

function boundedPlayerNumber(
  input: unknown,
  legacyValues: Record<string, number>,
  fallback: number,
  path: string,
  warnings: string[],
) {
  if (typeof input === 'string' && Object.hasOwn(legacyValues, input)) {
    warnings.push(`${path} 已从旧版预设迁移为连续数值`)
    return legacyValues[input]
  }
  return boundedNumber(input, fallback, 0, 100, path, warnings)
}

function cssText(input: unknown, fallback: string, path: string, warnings: string[]) {
  if (input === undefined) return fallback
  if (typeof input === 'string' && input.length <= 100_000 && !blockedCssPattern.test(input)) return input
  warnings.push(`${path} 包含不支持的内容或超过 100KB，已使用默认值`)
  return fallback
}

function parseColors(input: JsonObject, fallback: AppearanceColors, path: string, warnings: string[]): AppearanceColors {
  reportUnknownKeys(input, colorKeys, path, warnings)
  const result = { ...fallback }
  colorKeys.forEach((key) => {
    if (key === 'playerLyrics' && input[key] === undefined) {
      result[key] = result.playerMuted
      return
    }
    result[key] = text(input, key, fallback[key], (value) => hexColorPattern.test(value), path, warnings)
  })
  return result
}

function optionalObject(root: JsonObject, key: string, path: string, warnings: string[]) {
  if (root[key] === undefined) return undefined
  if (isObject(root[key])) return root[key]
  warnings.push(`${path} 必须是对象，已忽略`)
  return undefined
}

function parseThemeColorSchemes(theme: JsonObject, fallback: AppearanceColorSchemes, warnings: string[]): AppearanceColorSchemes {
  const singleColorsInput = optionalObject(theme, 'colors', 'theme.colors', warnings)
  const colorSchemesInput = optionalObject(theme, 'colorSchemes', 'theme.colorSchemes', warnings)
  if (colorSchemesInput) reportUnknownKeys(colorSchemesInput, ['light', 'dark'], 'theme.colorSchemes', warnings)

  const sharedColors = singleColorsInput
    ? parseColors(singleColorsInput, fallback.light, 'theme.colors', warnings)
    : undefined
  const lightInput = colorSchemesInput
    ? optionalObject(colorSchemesInput, 'light', 'theme.colorSchemes.light', warnings)
    : undefined
  const darkInput = colorSchemesInput
    ? optionalObject(colorSchemesInput, 'dark', 'theme.colorSchemes.dark', warnings)
    : undefined

  if (sharedColors) {
    return {
      light: lightInput ? parseColors(lightInput, sharedColors, 'theme.colorSchemes.light', warnings) : { ...sharedColors },
      dark: darkInput ? parseColors(darkInput, sharedColors, 'theme.colorSchemes.dark', warnings) : { ...sharedColors },
    }
  }
  if (lightInput && !darkInput) {
    const light = parseColors(lightInput, fallback.light, 'theme.colorSchemes.light', warnings)
    return { light, dark: { ...light } }
  }
  if (darkInput && !lightInput) {
    const dark = parseColors(darkInput, fallback.dark, 'theme.colorSchemes.dark', warnings)
    return { light: { ...dark }, dark }
  }

  return {
    light: lightInput ? parseColors(lightInput, fallback.light, 'theme.colorSchemes.light', warnings) : { ...fallback.light },
    dark: darkInput ? parseColors(darkInput, fallback.dark, 'theme.colorSchemes.dark', warnings) : { ...fallback.dark },
  }
}

function parseRadii(input: JsonObject, fallback: AppearanceRadii, warnings: string[]): AppearanceRadii {
  reportUnknownKeys(input, radiusKeys, 'theme.radii', warnings)
  const result = { ...fallback }
  radiusKeys.forEach((key) => {
    result[key] = text(input, key, fallback[key], (value) => lengthPattern.test(value), 'theme.radii', warnings)
  })
  return result
}

function parseTypography(input: JsonObject, fallback: AppearanceTypography, warnings: string[]): AppearanceTypography {
  reportUnknownKeys(input, ['fontFamily', 'fontScale'], 'theme.typography', warnings)
  return {
    fontFamily: enumValue(input.fontFamily, fontFamilies, fallback.fontFamily, 'theme.typography.fontFamily', warnings),
    fontScale: boundedNumber(input.fontScale, fallback.fontScale, 0.75, 1.5, 'theme.typography.fontScale', warnings),
  }
}

function parseComponents(input: JsonObject, fallback: AppearanceComponents, warnings: string[]): AppearanceComponents {
  reportUnknownKeys(input, ['surface', 'buttons', 'windowControls'], 'theme.components', warnings)
  return {
    surface: enumValue(input.surface, surfaces, fallback.surface, 'theme.components.surface', warnings),
    buttons: enumValue(input.buttons, buttonVariants, fallback.buttons, 'theme.components.buttons', warnings),
    windowControls: enumValue(input.windowControls, windowControlVariants, fallback.windowControls, 'theme.components.windowControls', warnings),
  }
}

function parsePlayerControls(input: JsonObject, fallback: AppearancePlayerControls, warnings: string[]): AppearancePlayerControls {
  reportUnknownKeys(input, [
    'material', 'radius', 'shadow', 'density', 'primaryButton', 'auxiliaryButtons', 'progress', 'visibility',
  ], 'theme.player.controls', warnings)
  const primaryButton = optionalObject(input, 'primaryButton', 'theme.player.controls.primaryButton', warnings) ?? {}
  const auxiliaryButtons = optionalObject(input, 'auxiliaryButtons', 'theme.player.controls.auxiliaryButtons', warnings) ?? {}
  const progress = optionalObject(input, 'progress', 'theme.player.controls.progress', warnings) ?? {}
  const visibility = optionalObject(input, 'visibility', 'theme.player.controls.visibility', warnings) ?? {}
  reportUnknownKeys(primaryButton, ['style', 'sizeScale'], 'theme.player.controls.primaryButton', warnings)
  reportUnknownKeys(auxiliaryButtons, ['style'], 'theme.player.controls.auxiliaryButtons', warnings)
  reportUnknownKeys(progress, ['trackThickness', 'thumbSize'], 'theme.player.controls.progress', warnings)
  reportUnknownKeys(visibility, ['timeLabels', 'volumePercent'], 'theme.player.controls.visibility', warnings)

  return {
    material: enumValue(input.material, playerControlMaterials, fallback.material, 'theme.player.controls.material', warnings),
    radius: boundedNumber(input.radius, fallback.radius, 0, 100, 'theme.player.controls.radius', warnings),
    shadow: boundedNumber(input.shadow, fallback.shadow, 0, 100, 'theme.player.controls.shadow', warnings),
    density: enumValue(input.density, playerControlDensities, fallback.density, 'theme.player.controls.density', warnings),
    primaryButton: {
      style: enumValue(primaryButton.style, playerPrimaryButtonStyles, fallback.primaryButton.style, 'theme.player.controls.primaryButton.style', warnings),
      sizeScale: steppedNumber(primaryButton.sizeScale, fallback.primaryButton.sizeScale, 75, 130, 5, 'theme.player.controls.primaryButton.sizeScale', warnings),
    },
    auxiliaryButtons: {
      style: enumValue(auxiliaryButtons.style, playerAuxiliaryButtonStyles, fallback.auxiliaryButtons.style, 'theme.player.controls.auxiliaryButtons.style', warnings),
    },
    progress: {
      trackThickness: steppedNumber(progress.trackThickness, fallback.progress.trackThickness, 2, 12, 1, 'theme.player.controls.progress.trackThickness', warnings),
      thumbSize: steppedNumber(progress.thumbSize, fallback.progress.thumbSize, 12, 36, 1, 'theme.player.controls.progress.thumbSize', warnings),
    },
    visibility: {
      timeLabels: booleanValue(visibility.timeLabels, fallback.visibility.timeLabels, 'theme.player.controls.visibility.timeLabels', warnings),
      volumePercent: booleanValue(visibility.volumePercent, fallback.visibility.volumePercent, 'theme.player.controls.visibility.volumePercent', warnings),
    },
  }
}

function parsePlayer(input: JsonObject, fallback: AppearancePlayer, warnings: string[]): AppearancePlayer {
  reportUnknownKeys(input, [
    'backgroundEffect',
    'backgroundBlur',
    'backgroundBrightness',
    'backgroundSaturation',
    'backgroundMaskOpacity',
    'backgroundVignette',
    'coverRadius',
    'coverShadow',
    'lyricsFontScale',
    'lyricsTightSpacing',
    'lyricsNormalSpacing',
    'lyricsTightThresholdSeconds',
    'activeLyricEmphasis',
    'controls',
    'trackMetadata',
  ], 'theme.player', warnings)
  const trackMetadataInput = optionalObject(input, 'trackMetadata', 'theme.player.trackMetadata', warnings) ?? {}
  const controlsInput = optionalObject(input, 'controls', 'theme.player.controls', warnings) ?? {}
  reportUnknownKeys(trackMetadataInput, [
    'titleMaxWidth',
    'detailsMaxWidth',
    'scrollPixelsPerSecond',
    'scrollStartDelayMs',
    'scrollEdgePauseMs',
  ], 'theme.player.trackMetadata', warnings)
  const lyricsTightSpacing = boundedNumber(input.lyricsTightSpacing, fallback.lyricsTightSpacing, 0, 48, 'theme.player.lyricsTightSpacing', warnings)
  let lyricsNormalSpacing = boundedNumber(input.lyricsNormalSpacing, fallback.lyricsNormalSpacing, 0, 120, 'theme.player.lyricsNormalSpacing', warnings)
  if (lyricsNormalSpacing < lyricsTightSpacing) {
    lyricsNormalSpacing = lyricsTightSpacing
    warnings.push('theme.player.lyricsNormalSpacing 不能小于 lyricsTightSpacing，已修复为紧密歌词间距')
  }

  return {
    backgroundEffect: enumValue(input.backgroundEffect, playerBackgroundEffects, fallback.backgroundEffect, 'theme.player.backgroundEffect', warnings),
    backgroundBlur: boundedPlayerNumber(input.backgroundBlur, legacyPlayerBackgroundBlurs, fallback.backgroundBlur, 'theme.player.backgroundBlur', warnings),
    backgroundBrightness: boundedNumber(input.backgroundBrightness, fallback.backgroundBrightness, 0, 200, 'theme.player.backgroundBrightness', warnings),
    backgroundSaturation: boundedNumber(input.backgroundSaturation, fallback.backgroundSaturation, 0, 200, 'theme.player.backgroundSaturation', warnings),
    backgroundMaskOpacity: boundedNumber(input.backgroundMaskOpacity, fallback.backgroundMaskOpacity, 0, 100, 'theme.player.backgroundMaskOpacity', warnings),
    backgroundVignette: boundedNumber(input.backgroundVignette, fallback.backgroundVignette, 0, 100, 'theme.player.backgroundVignette', warnings),
    coverRadius: boundedPlayerNumber(input.coverRadius, legacyPlayerCoverRadii, fallback.coverRadius, 'theme.player.coverRadius', warnings),
    coverShadow: boundedPlayerNumber(input.coverShadow, legacyPlayerCoverShadows, fallback.coverShadow, 'theme.player.coverShadow', warnings),
    lyricsFontScale: boundedNumber(input.lyricsFontScale, fallback.lyricsFontScale, 0.75, 1.5, 'theme.player.lyricsFontScale', warnings),
    lyricsTightSpacing,
    lyricsNormalSpacing,
    lyricsTightThresholdSeconds: boundedNumber(input.lyricsTightThresholdSeconds, fallback.lyricsTightThresholdSeconds, 0, 30, 'theme.player.lyricsTightThresholdSeconds', warnings),
    activeLyricEmphasis: enumValue(input.activeLyricEmphasis, playerActiveLyricEmphases, fallback.activeLyricEmphasis, 'theme.player.activeLyricEmphasis', warnings),
    controls: parsePlayerControls(controlsInput, fallback.controls, warnings),
    trackMetadata: {
      titleMaxWidth: boundedNumber(trackMetadataInput.titleMaxWidth, fallback.trackMetadata.titleMaxWidth, 120, 1200, 'theme.player.trackMetadata.titleMaxWidth', warnings),
      detailsMaxWidth: boundedNumber(trackMetadataInput.detailsMaxWidth, fallback.trackMetadata.detailsMaxWidth, 120, 1600, 'theme.player.trackMetadata.detailsMaxWidth', warnings),
      scrollPixelsPerSecond: boundedNumber(trackMetadataInput.scrollPixelsPerSecond, fallback.trackMetadata.scrollPixelsPerSecond, 8, 160, 'theme.player.trackMetadata.scrollPixelsPerSecond', warnings),
      scrollStartDelayMs: boundedNumber(trackMetadataInput.scrollStartDelayMs, fallback.trackMetadata.scrollStartDelayMs, 0, 10000, 'theme.player.trackMetadata.scrollStartDelayMs', warnings),
      scrollEdgePauseMs: boundedNumber(trackMetadataInput.scrollEdgePauseMs, fallback.trackMetadata.scrollEdgePauseMs, 0, 10000, 'theme.player.trackMetadata.scrollEdgePauseMs', warnings),
    },
  }
}

function parseResources(input: unknown, fallback: AppearanceResource[], warnings: string[]): AppearanceResource[] {
  if (input === undefined) return fallback.map((item) => ({ ...item }))
  if (!Array.isArray(input)) {
    warnings.push('theme.experimental.resources 必须是数组，已使用默认值')
    return fallback.map((item) => ({ ...item }))
  }

  return input.flatMap((value, index) => {
    if (!isObject(value)) {
      warnings.push(`theme.experimental.resources[${index}] 无效，已忽略`)
      return []
    }
    reportUnknownKeys(value, ['id', 'kind', 'source'], `theme.experimental.resources[${index}]`, warnings)
    const id = typeof value.id === 'string' && resourceIdPattern.test(value.id) ? value.id : null
    const kind = typeof value.kind === 'string' && resourceKinds.includes(value.kind as AppearanceResource['kind']) ? value.kind as AppearanceResource['kind'] : null
    const source = typeof value.source === 'string' && value.source.length <= 4096 && resourceSourcePattern.test(value.source) ? value.source : null
    if (!id || !kind || !source) {
      warnings.push(`theme.experimental.resources[${index}] 字段无效，已忽略`)
      return []
    }
    return [{ id, kind, source }]
  }).slice(0, 32)
}

function parseMetadata(input: JsonObject, fallback: AppearanceThemeMetadata, warnings: string[]): AppearanceThemeMetadata {
  reportUnknownKeys(input, ['tier', 'author', 'description', 'capabilities', 'riskAcknowledged'], 'theme.metadata', warnings)
  const capabilityInput = input.capabilities
  const parsedCapabilities = Array.isArray(capabilityInput)
    ? capabilityInput.filter((value): value is AppearanceThemeMetadata['capabilities'][number] => typeof value === 'string' && capabilities.includes(value as AppearanceThemeMetadata['capabilities'][number]))
    : [...fallback.capabilities]
  if (capabilityInput !== undefined && !Array.isArray(capabilityInput)) warnings.push('theme.metadata.capabilities 必须是数组，已使用默认值')
  if (Array.isArray(capabilityInput) && parsedCapabilities.length !== capabilityInput.length) warnings.push('theme.metadata.capabilities 含无效能力，已忽略')
  if (input.riskAcknowledged !== undefined && typeof input.riskAcknowledged !== 'boolean') warnings.push('theme.metadata.riskAcknowledged 必须是布尔值，已使用默认值')

  return {
    tier: enumValue(input.tier, tiers, fallback.tier, 'theme.metadata.tier', warnings),
    author: text(input, 'author', fallback.author, (value) => value.length <= 80, 'theme.metadata', warnings),
    description: text(input, 'description', fallback.description, (value) => value.length <= 500, 'theme.metadata', warnings),
    capabilities: [...new Set(parsedCapabilities)],
    riskAcknowledged: typeof input.riskAcknowledged === 'boolean' ? input.riskAcknowledged : fallback.riskAcknowledged,
  }
}

function addProgressColors(colors: JsonObject) {
  return {
    ...colors,
    playerProgressPlayed: colors.playerProgressPlayed ?? colors.playerBlue,
    playerProgressUnplayed: colors.playerProgressUnplayed ?? '#c1c7ce',
  }
}

function migrateV4ToV5(input: JsonObject): JsonObject | null {
  if (input.schemaVersion !== 4 || !isObject(input.theme)) return null
  const theme = { ...input.theme }
  if (isObject(theme.colors)) theme.colors = addProgressColors(theme.colors)
  if (isObject(theme.colorSchemes)) {
    const schemes = { ...theme.colorSchemes }
    if (isObject(schemes.light)) schemes.light = addProgressColors(schemes.light)
    if (isObject(schemes.dark)) schemes.dark = addProgressColors(schemes.dark)
    theme.colorSchemes = schemes
  }

  const player = isObject(theme.player) ? { ...theme.player } : {}
  const legacyControls = isObject(player.controls) ? player.controls : {}
  const legacyVisibility = isObject(legacyControls.visibility) ? legacyControls.visibility : {}
  player.controls = {
    ...defaultAppearance.player.controls,
    ...legacyControls,
    primaryButton: {
      ...defaultAppearance.player.controls.primaryButton,
      ...(isObject(legacyControls.primaryButton) ? legacyControls.primaryButton : {}),
    },
    auxiliaryButtons: {
      ...defaultAppearance.player.controls.auxiliaryButtons,
      ...(isObject(legacyControls.auxiliaryButtons) ? legacyControls.auxiliaryButtons : {}),
    },
    progress: {
      ...defaultAppearance.player.controls.progress,
      ...(isObject(legacyControls.progress) ? legacyControls.progress : {}),
    },
    visibility: {
      ...defaultAppearance.player.controls.visibility,
      ...legacyVisibility,
      volumePercent: typeof player.showVolumePercent === 'boolean'
        ? player.showVolumePercent
        : (legacyVisibility.volumePercent ?? defaultAppearance.player.controls.visibility.volumePercent),
    },
  }
  delete player.showVolumePercent
  theme.player = player
  return { ...input, schemaVersion: 5, theme }
}

function migrateDocument(input: JsonObject): { document: JsonObject; migratedFrom?: number } | null {
  if (input.schemaVersion === APPEARANCE_THEME_SCHEMA_VERSION) return { document: input }
  const migratedFrom = typeof input.schemaVersion === 'number' ? input.schemaVersion : undefined
  let v4Document: JsonObject | null = null

  if (input.schemaVersion === 4) v4Document = input
  else if ((input.schemaVersion === 1 || input.schemaVersion === 2 || input.schemaVersion === 3) && isObject(input.theme)) {
    const legacyTheme = { ...input.theme }
    if (!isObject(legacyTheme.colorSchemes) && isObject(legacyTheme.colors)) {
      legacyTheme.colorSchemes = {
        light: { ...legacyTheme.colors },
        dark: { ...legacyTheme.colors },
      }
    }
    delete legacyTheme.colors
    const legacyPlayer = isObject(legacyTheme.player) ? legacyTheme.player : {}
    legacyTheme.player = {
      lyricsTightSpacing: 0,
      lyricsNormalSpacing: 53,
      lyricsTightThresholdSeconds: 15.5,
      ...legacyPlayer,
    }
    v4Document = {
      schemaVersion: 4,
      format: input.schemaVersion === 1 ? 'spmusic-theme' : input.format,
      exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date(0).toISOString(),
      theme: legacyTheme,
    }
  }

  const document = v4Document ? migrateV4ToV5(v4Document) : null
  return document ? { document, migratedFrom } : null
}

export function createAppearanceThemeDocument(appearance: AppearancePreset): AppearanceThemeDocumentV5 {
  const cloned = cloneAppearance(appearance)
  const { colorSchemes, ...theme } = cloned
  const usesSinglePalette = colorKeys.every((key) => colorSchemes.light[key] === colorSchemes.dark[key])
  return {
    schemaVersion: APPEARANCE_THEME_SCHEMA_VERSION,
    format: 'spmusic-theme',
    exportedAt: new Date().toISOString(),
    theme: usesSinglePalette
      ? { ...theme, colors: { ...colorSchemes.light } }
      : { ...theme, colorSchemes },
  }
}

export function serializeAppearanceTheme(appearance: AppearancePreset): string {
  return JSON.stringify(createAppearanceThemeDocument(appearance), null, 2)
}

export function deserializeAppearanceTheme(source: string, fallback: AppearancePreset = defaultAppearance): AppearanceThemeParseResult {
  const safeFallback = cloneAppearance(fallback)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, appearance: safeFallback, error: '主题文件不是有效的 JSON' }
  }
  if (!isObject(parsed)) return { ok: false, appearance: safeFallback, error: '主题文档必须是对象' }

  const migration = migrateDocument(parsed)
  if (!migration) return { ok: false, appearance: safeFallback, error: `不支持的主题版本：${String(parsed.schemaVersion)}` }
  const { document, migratedFrom } = migration
  if (!isObject(document.theme)) return { ok: false, appearance: safeFallback, error: '主题文档缺少 theme 对象' }
  if (document.format !== 'spmusic-theme') return { ok: false, appearance: safeFallback, error: '文件不是 SpMusic 主题' }

  const warnings: string[] = []
  reportUnknownKeys(document, ['schemaVersion', 'format', 'exportedAt', 'theme'], 'document', warnings)
  if (typeof document.exportedAt !== 'string' || Number.isNaN(Date.parse(document.exportedAt))) warnings.push('document.exportedAt 无效，导入时已忽略')
  const theme = document.theme
  reportUnknownKeys(theme, themeKeys, 'theme', warnings)

  const motionInput = section(theme, 'motion', warnings)
  reportUnknownKeys(motionInput, ['level', 'durationScale', 'easing'], 'theme.motion', warnings)
  const iconInput = section(theme, 'icons', warnings)
  reportUnknownKeys(iconInput, ['provider'], 'theme.icons', warnings)
  const advancedInput = section(theme, 'advanced', warnings)
  reportUnknownKeys(advancedInput, ['customCss'], 'theme.advanced', warnings)
  const experimentalInput = section(theme, 'experimental', warnings)
  reportUnknownKeys(experimentalInput, ['layoutCss', 'resources'], 'theme.experimental', warnings)

  const iconCandidate = iconInput.provider
  const provider = isIconProviderId(iconCandidate)
    ? iconCandidate
    : fallback.icons.provider
  if (iconCandidate !== undefined && provider !== iconCandidate) warnings.push('theme.icons.provider 未安装，已使用默认图标包')

  const appearance: AppearancePreset = {
    id: text(theme, 'id', fallback.id, (value) => themeIdPattern.test(value), 'theme', warnings),
    name: text(theme, 'name', fallback.name, (value) => value.trim().length > 0 && value.length <= 80, 'theme', warnings),
    colorSchemes: parseThemeColorSchemes(theme, fallback.colorSchemes, warnings),
    radii: parseRadii(section(theme, 'radii', warnings), fallback.radii, warnings),
    motion: {
      level: enumValue(motionInput.level, motionLevels, fallback.motion.level, 'theme.motion.level', warnings),
      durationScale: boundedNumber(motionInput.durationScale, fallback.motion.durationScale, 0.25, 3, 'theme.motion.durationScale', warnings),
      easing: enumValue(motionInput.easing, easingValues, fallback.motion.easing, 'theme.motion.easing', warnings),
    },
    typography: parseTypography(section(theme, 'typography', warnings), fallback.typography, warnings),
    components: parseComponents(section(theme, 'components', warnings), fallback.components, warnings),
    player: parsePlayer(section(theme, 'player', warnings), fallback.player, warnings),
    icons: { provider },
    advanced: { customCss: cssText(advancedInput.customCss, fallback.advanced.customCss, 'theme.advanced.customCss', warnings) },
    experimental: {
      layoutCss: cssText(experimentalInput.layoutCss, fallback.experimental.layoutCss, 'theme.experimental.layoutCss', warnings),
      resources: parseResources(experimentalInput.resources, fallback.experimental.resources, warnings),
    },
    metadata: parseMetadata(section(theme, 'metadata', warnings), fallback.metadata, warnings),
  }

  if (migratedFrom) warnings.unshift(`已从主题格式 v${migratedFrom} 迁移到 v${APPEARANCE_THEME_SCHEMA_VERSION}`)
  return { ok: true, appearance, warnings, migratedFrom }
}
