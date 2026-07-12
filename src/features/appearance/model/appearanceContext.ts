import { createContext } from 'react'
import type { SystemIconProvider } from '@/icons/systemIcons'
import type { AppearancePreset } from './appearanceTypes'

export type AppearanceContextValue = {
  appearance: AppearancePreset
  icons: SystemIconProvider
  setAppearance: (appearance: AppearancePreset) => void
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)
