import { createContext } from 'react'
import type { SystemIconProvider } from '@/icons/systemIcons'
import type { AppearancePreset } from './appearanceTypes'

export type AppearanceContextValue = {
  appearance: AppearancePreset
  icons: SystemIconProvider
  themes: Array<{ appearance: AppearancePreset; builtin: boolean }>
  activeThemeId: string
  storageWarning?: string
  previewAppearance: (appearance: AppearancePreset) => void
  cancelPreview: () => void
  selectTheme: (id: string) => void
  saveAndApplyAppearance: (appearance: AppearancePreset) => AppearancePreset
  deleteAppearance: (id: string) => boolean
  resetDefault: () => void
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)
