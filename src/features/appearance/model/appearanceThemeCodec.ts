import { iconProviders, type IconProviderId } from '@/icons/systemIcons'
import { defaultAppearance } from './defaultAppearance'
import type {
  AppearanceColors,
  AppearanceComponents,
  AppearanceEasing,
  AppearancePreset,
  AppearanceRadii,
  AppearanceResource,
  AppearanceThemeMetadata,
  AppearanceTypography,
  MotionLevel,
} from './appearanceTypes'

export const APPEARANCE_THEME_SCHEMA_VERSION = 2 as const

export type AppearanceThemeDocumentV1 = {
  schemaVersion: 1
  theme: Record<string, unknown>
}

export type AppearanceThemeDocumentV2 = {
  schemaVersion: typeof APPEARANCE_THEME_SCHEMA_VERSION
  format: 'spmusic-theme'
  exportedAt: string
  theme: AppearancePreset
}

export type AppearanceThemeDocument = AppearanceThemeDocumentV2

export type AppearanceThemeParseResult =
  | { ok: true; appearance: AppearancePreset; warnings: string[]; migratedFrom?: number }
  | { ok: false; appearance: AppearancePreset; error: string }

type JsonObject = Record<string, unknown>

const colorKeys = [
  'background', 'surface', 'surfaceMuted', 'text', 'textMuted', 'textStrong', 'border',
  'accent', 'accentSoft', 'accentContrast', 'playerBlue', 'playerBlueSoft', 'playerBlueInk',
  'playerInk', 'playerMuted', 'playerOverlay', 'playerDock',
] as const satisfies readonly (keyof AppearanceColors)[]
const radiusKeys = ['sm', 'md', 'lg', 'pill'] as const satisfies readonly (keyof AppearanceRadii)[]
const motionLevels = ['off', 'subtle', 'expressive'] as const satisfies readonly MotionLevel[]
const easingValues = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.65, 0, .35, 1)'] as const satisfies readonly AppearanceEasing[]
const fontFamilies = ['geist', 'system', 'serif', 'monospace'] as const
const surfaces = ['glass', 'solid', 'flat'] as const
const buttonVariants = ['soft', 'outline', 'minimal'] as const
const windowControlVariants = ['standard', 'compact', 'traffic-lights'] as const
const tiers = ['standard', 'advanced', 'experimental'] as const
const capabilities = ['tokens', 'custom-css', 'layout-overrides', 'local-resources'] as const
const resourceKinds = ['font', 'image'] as const
const themeKeys = ['id', 'name', 'colors', 'radii', 'motion', 'typography', 'components', 'icons', 'advanced', 'experimental', 'metadata'] as const
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
    colors: { ...appearance.colors },
    radii: { ...appearance.radii },
    motion: { ...appearance.motion },
    typography: { ...appearance.typography },
    components: { ...appearance.components },
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

function cssText(input: unknown, fallback: string, path: string, warnings: string[]) {
  if (input === undefined) return fallback
  if (typeof input === 'string' && input.length <= 100_000 && !blockedCssPattern.test(input)) return input
  warnings.push(`${path} 包含不支持的内容或超过 100KB，已使用默认值`)
  return fallback
}

function parseColors(input: JsonObject, fallback: AppearanceColors, warnings: string[]): AppearanceColors {
  reportUnknownKeys(input, colorKeys, 'theme.colors', warnings)
  const result = { ...fallback }
  colorKeys.forEach((key) => {
    result[key] = text(input, key, fallback[key], (value) => hexColorPattern.test(value), 'theme.colors', warnings)
  })
  return result
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

function migrateDocument(input: JsonObject): { document: JsonObject; migratedFrom?: number } | null {
  if (input.schemaVersion === APPEARANCE_THEME_SCHEMA_VERSION) return { document: input }
  if (input.schemaVersion === 1 && isObject(input.theme)) {
    return {
      migratedFrom: 1,
      document: { schemaVersion: 2, format: 'spmusic-theme', exportedAt: new Date(0).toISOString(), theme: input.theme },
    }
  }
  // Future migrations are added here in ascending, one-version-at-a-time order.
  return null
}

export function createAppearanceThemeDocument(appearance: AppearancePreset): AppearanceThemeDocumentV2 {
  return {
    schemaVersion: APPEARANCE_THEME_SCHEMA_VERSION,
    format: 'spmusic-theme',
    exportedAt: new Date().toISOString(),
    theme: cloneAppearance(appearance),
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
  const provider = typeof iconCandidate === 'string' && Object.hasOwn(iconProviders, iconCandidate)
    ? iconCandidate as IconProviderId
    : fallback.icons.provider
  if (iconCandidate !== undefined && provider !== iconCandidate) warnings.push('theme.icons.provider 未安装，已使用默认图标包')

  const appearance: AppearancePreset = {
    id: text(theme, 'id', fallback.id, (value) => themeIdPattern.test(value), 'theme', warnings),
    name: text(theme, 'name', fallback.name, (value) => value.trim().length > 0 && value.length <= 80, 'theme', warnings),
    colors: parseColors(section(theme, 'colors', warnings), fallback.colors, warnings),
    radii: parseRadii(section(theme, 'radii', warnings), fallback.radii, warnings),
    motion: {
      level: enumValue(motionInput.level, motionLevels, fallback.motion.level, 'theme.motion.level', warnings),
      durationScale: boundedNumber(motionInput.durationScale, fallback.motion.durationScale, 0.25, 3, 'theme.motion.durationScale', warnings),
      easing: enumValue(motionInput.easing, easingValues, fallback.motion.easing, 'theme.motion.easing', warnings),
    },
    typography: parseTypography(section(theme, 'typography', warnings), fallback.typography, warnings),
    components: parseComponents(section(theme, 'components', warnings), fallback.components, warnings),
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
