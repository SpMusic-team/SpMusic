import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { iconProviders } from '@/icons/systemIcons'
import { applyAppearanceRuntime } from '../model/appearanceRuntime'
import { AppearanceContext, type AppearanceContextValue } from '../model/appearanceContext'
import { builtinAppearanceIds, builtinAppearances, findBuiltinAppearance } from '../model/builtinAppearances'
import { cloneAppearance } from '../model/appearanceThemeCodec'
import { defaultAppearance } from '../model/defaultAppearance'
import {
  APPEARANCE_STORAGE_KEY,
  loadAppearanceStorage,
  parseAppearanceStorage,
  saveAppearanceStorage,
  type AppearanceStorageState,
} from '../model/appearanceStorage'
import type { AppearancePreset } from '../model/appearanceTypes'

type AppearanceProviderProps = {
  children: ReactNode
}

function resolveAppearance(library: AppearanceStorageState, id: string) {
  return library.userThemes.find((theme) => theme.id === id) ?? findBuiltinAppearance(id) ?? defaultAppearance
}

function uniqueThemeId(baseId: string, themes: AppearancePreset[]) {
  const normalized = `${baseId.replace(/-custom(?:-\d+)?$/, '')}-custom`
  if (!themes.some((theme) => theme.id === normalized) && !builtinAppearanceIds.has(normalized)) return normalized
  let suffix = 2
  while (themes.some((theme) => theme.id === `${normalized}-${suffix}`) || builtinAppearanceIds.has(`${normalized}-${suffix}`)) suffix += 1
  return `${normalized}-${suffix}`
}

export function AppearanceProvider({ children }: AppearanceProviderProps) {
  const [library, setLibrary] = useState(() => loadAppearanceStorage())
  const [appearance, setAppearance] = useState(() => cloneAppearance(resolveAppearance(library, library.currentThemeId)))
  const [storageWarning, setStorageWarning] = useState(library.warning)
  const [systemReducedMotion, setSystemReducedMotion] = useState(false)
  const icons = iconProviders[appearance.icons.provider] ?? iconProviders.default
  const themes = useMemo(() => [
    ...builtinAppearances.map((theme) => ({ appearance: theme, builtin: true })),
    ...library.userThemes.map((theme) => ({ appearance: theme, builtin: false })),
  ], [library.userThemes])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => applyAppearanceRuntime(appearance, systemReducedMotion), [appearance, systemReducedMotion])

  useEffect(() => {
    let warningTimer: number | undefined
    try {
      saveAppearanceStorage(library)
    } catch {
      warningTimer = window.setTimeout(() => {
        setStorageWarning('无法写入本地主题存储，本次更改仅在当前会话有效')
      }, 0)
    }
    return () => window.clearTimeout(warningTimer)
  }, [library])

  useEffect(() => {
    function syncStorage(event: StorageEvent) {
      if (event.key !== APPEARANCE_STORAGE_KEY) return
      const next = event.newValue ? parseAppearanceStorage(event.newValue) : loadAppearanceStorage()
      setLibrary(next)
      setAppearance(cloneAppearance(resolveAppearance(next, next.currentThemeId)))
      setStorageWarning(next.warning)
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, [])

  const cancelPreview = useCallback(() => {
    setAppearance(cloneAppearance(resolveAppearance(library, library.currentThemeId)))
  }, [library])

  const selectTheme = useCallback((id: string) => {
    const selected = resolveAppearance(library, id)
    setAppearance(cloneAppearance(selected))
    setLibrary((previous) => ({ ...previous, currentThemeId: selected.id }))
  }, [library])

  const saveAndApplyAppearance = useCallback((candidate: AppearancePreset) => {
    let saved = cloneAppearance(candidate)
    const existingUserThemes = library.userThemes
    if (builtinAppearanceIds.has(saved.id)) {
      saved = {
        ...saved,
        id: uniqueThemeId(saved.id, existingUserThemes),
        name: `${saved.name} 自定义`,
        metadata: { ...saved.metadata, author: saved.metadata.author || '用户' },
      }
    }
    setLibrary((previous) => ({
      currentThemeId: saved.id,
      userThemes: [...previous.userThemes.filter((theme) => theme.id !== saved.id), saved],
    }))
    setAppearance(cloneAppearance(saved))
    return saved
  }, [library.userThemes])

  const deleteAppearance = useCallback((id: string) => {
    if (builtinAppearanceIds.has(id) || !library.userThemes.some((theme) => theme.id === id)) return false
    const nextLibrary = {
      currentThemeId: library.currentThemeId === id ? defaultAppearance.id : library.currentThemeId,
      userThemes: library.userThemes.filter((theme) => theme.id !== id),
    }
    setLibrary(nextLibrary)
    setAppearance(cloneAppearance(resolveAppearance(nextLibrary, nextLibrary.currentThemeId)))
    return true
  }, [library])

  const resetDefault = useCallback(() => {
    setLibrary((previous) => ({ ...previous, currentThemeId: defaultAppearance.id }))
    setAppearance(cloneAppearance(defaultAppearance))
  }, [])

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    icons,
    themes,
    activeThemeId: library.currentThemeId,
    storageWarning,
    previewAppearance: (next) => setAppearance(cloneAppearance(next)),
    cancelPreview,
    selectTheme,
    saveAndApplyAppearance,
    deleteAppearance,
    resetDefault,
  }), [appearance, icons, themes, library.currentThemeId, storageWarning, cancelPreview, selectTheme, saveAndApplyAppearance, deleteAppearance, resetDefault])

  return (
    <AppearanceContext.Provider value={value}>
      <div
        className="spmusic-app"
        data-button-variant={appearance.components.buttons}
        data-icon-pack={appearance.icons.provider}
        data-motion={appearance.motion.level}
        data-surface-variant={appearance.components.surface}
        data-theme={appearance.id}
        data-theme-tier={appearance.metadata.tier}
        data-window-controls={appearance.components.windowControls}
      >
        {children}
      </div>
    </AppearanceContext.Provider>
  )
}
