import { createContext } from 'react'
import type { SystemIconProvider } from '@/icons/systemIcons'
import type { AppearancePreset, ColorSchemePreference, ResolvedColorScheme } from './appearanceTypes'

export type AppearanceContextValue = {
  appearance: AppearancePreset
  icons: SystemIconProvider
  themes: Array<{ appearance: AppearancePreset; builtin: boolean }>
  activeThemeId: string
  colorSchemePreference: ColorSchemePreference
  resolvedColorScheme: ResolvedColorScheme
  storageWarning?: string
  previewAppearance: (appearance: AppearancePreset) => void
  previewColorSchemePreference: (preference: ColorSchemePreference) => void
  cancelPreview: () => void
  setColorSchemePreference: (preference: ColorSchemePreference) => void
  selectTheme: (id: string) => void
  saveAndApplyAppearance: (appearance: AppearancePreset) => AppearancePreset
  deleteAppearance: (id: string) => boolean
  resetDefault: () => void
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)
