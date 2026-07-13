import { builtinAppearanceIds } from './builtinAppearances'
import { createAppearanceThemeDocument, deserializeAppearanceTheme } from './appearanceThemeCodec'
import { defaultAppearance } from './defaultAppearance'
import type { AppearancePreset, ColorSchemePreference } from './appearanceTypes'

export const APPEARANCE_STORAGE_KEY = 'spmusic.appearance.v2'
const STORAGE_SCHEMA_VERSION = 2
const colorSchemePreferences: ColorSchemePreference[] = ['system', 'light', 'dark']

export type AppearanceStorageState = {
  currentThemeId: string
  colorSchemePreference: ColorSchemePreference
  userThemes: AppearancePreset[]
}

export type AppearanceStorageLoadResult = AppearanceStorageState & { warning?: string }

export function defaultAppearanceStorage(): AppearanceStorageState {
  return { currentThemeId: defaultAppearance.id, colorSchemePreference: 'system', userThemes: [] }
}

export function parseAppearanceStorage(source: string): AppearanceStorageLoadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ...defaultAppearanceStorage(), warning: '已忽略损坏的主题存储并恢复默认主题' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...defaultAppearanceStorage(), warning: '主题存储结构无效，已恢复默认主题' }
  }

  const record = parsed as Record<string, unknown>
  if ((record.schemaVersion !== 1 && record.schemaVersion !== STORAGE_SCHEMA_VERSION) || !Array.isArray(record.userThemes)) {
    return { ...defaultAppearanceStorage(), warning: '主题存储版本不受支持，已恢复默认主题' }
  }

  const userThemes = record.userThemes.flatMap((document) => {
    const result = deserializeAppearanceTheme(JSON.stringify(document))
    return result.ok && !builtinAppearanceIds.has(result.appearance.id) ? [result.appearance] : []
  })
  const requestedId = typeof record.currentThemeId === 'string' ? record.currentThemeId : defaultAppearance.id
  const currentThemeId = builtinAppearanceIds.has(requestedId) || userThemes.some((theme) => theme.id === requestedId)
    ? requestedId
    : defaultAppearance.id

  const colorSchemePreference = record.schemaVersion === STORAGE_SCHEMA_VERSION
    && typeof record.colorSchemePreference === 'string'
    && colorSchemePreferences.includes(record.colorSchemePreference as ColorSchemePreference)
    ? record.colorSchemePreference as ColorSchemePreference
    : 'system'

  return { currentThemeId, colorSchemePreference, userThemes }
}

export function loadAppearanceStorage(): AppearanceStorageLoadResult {
  if (typeof window === 'undefined') return defaultAppearanceStorage()
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY)
    return stored ? parseAppearanceStorage(stored) : defaultAppearanceStorage()
  } catch {
    return { ...defaultAppearanceStorage(), warning: '无法读取本地主题存储，已使用默认主题' }
  }
}

export function saveAppearanceStorage(state: AppearanceStorageState) {
  if (typeof window === 'undefined') return
  const payload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    currentThemeId: state.currentThemeId,
    colorSchemePreference: state.colorSchemePreference,
    userThemes: state.userThemes.map(createAppearanceThemeDocument),
  }
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(payload))
}
