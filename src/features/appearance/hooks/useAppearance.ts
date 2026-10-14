import { useContext } from 'react'
import { AppearanceContext } from '../model/appearanceContext'

export function useAppearance() {
  const context = useContext(AppearanceContext)

  if (!context) {
    throw new Error('useAppearance must be used within AppearanceProvider')
  }

  return context
}

export function useSystemIcons() {
  return useAppearance().icons
}

export function useAppearanceMotion() {
  return useAppearance().motion
}
