import { useMemo, useState, type ReactNode } from 'react'
import { iconProviders } from '@/icons/systemIcons'
import { createAppearanceCssVars } from '../model/appearanceCss'
import { AppearanceContext, type AppearanceContextValue } from '../model/appearanceContext'
import { defaultAppearance } from '../model/defaultAppearance'
import type { AppearancePreset } from '../model/appearanceTypes'

type AppearanceProviderProps = {
  children: ReactNode
  initialAppearance?: AppearancePreset
}

export function AppearanceProvider({ children, initialAppearance = defaultAppearance }: AppearanceProviderProps) {
  const [appearance, setAppearance] = useState(initialAppearance)
  const icons = iconProviders[appearance.icons.provider] ?? iconProviders.default
  const style = useMemo(() => createAppearanceCssVars(appearance), [appearance])

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    icons,
    setAppearance,
  }), [appearance, icons])

  return (
    <AppearanceContext.Provider value={value}>
      <div
        className="spmusic-app"
        data-icon-pack={appearance.icons.provider}
        data-motion={appearance.motion.level}
        data-theme={appearance.id}
        style={style}
      >
        {children}
      </div>
    </AppearanceContext.Provider>
  )
}
