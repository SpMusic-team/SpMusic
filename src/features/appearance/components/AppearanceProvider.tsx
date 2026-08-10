import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { defaultSystemIcons } from '@/icons/providers/defaultIcons'
import { loadIconProvider } from '@/icons/systemIcons'
import type { IconProviderId } from '@/icons/iconProviderIds'
import type { SystemIconProvider } from '@/icons/types'
import { cn } from '@/lib/utils'
import { applyAppearanceRuntime } from '../model/appearanceRuntime'
import { createAppearanceMotionRuntime } from '../model/appearanceMotion'
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
import type { AppearancePreset, ColorSchemePreference } from '../model/appearanceTypes'

type AppearanceProviderProps = {
  children: ReactNode
}

type LoadedIconProvider = {
  id: IconProviderId
  icons: SystemIconProvider
}

function resolveAppearance(library: AppearanceStorageState, id: string) {
  return library.userThemes.find((theme) => theme.id === id) ?? findBuiltinAppearance(id) ?? defaultAppearance
}

export function AppearanceProvider({ children }: AppearanceProviderProps) {
  const [library, setLibrary] = useState(() => loadAppearanceStorage())
  const [appearance, setAppearance] = useState(() => cloneAppearance(resolveAppearance(library, library.currentThemeId)))
  const [colorSchemePreference, setRuntimeColorSchemePreference] = useState<ColorSchemePreference>(library.colorSchemePreference)
  const [storageWarning, setStorageWarning] = useState(library.warning)
  const [loadedIconProvider, setLoadedIconProvider] = useState<LoadedIconProvider>({
    id: 'default',
    icons: defaultSystemIcons,
  })
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const appRootRef = useRef<HTMLDivElement>(null)
  const resolvedColorScheme = colorSchemePreference === 'system' ? (systemDark ? 'dark' : 'light') : colorSchemePreference
  const requestedIconProvider = appearance.icons.provider
  const icons = loadedIconProvider.id === requestedIconProvider
    ? loadedIconProvider.icons
    : defaultSystemIcons
  const motion = useMemo(
    () => createAppearanceMotionRuntime(appearance.motion, systemReducedMotion),
    [appearance.motion, systemReducedMotion],
  )
  const themes = useMemo(() => [
    ...builtinAppearances.map((theme) => {
      const override = library.userThemes.find((candidate) => candidate.id === theme.id)
      return override
        ? { appearance: override, builtin: false }
        : { appearance: theme, builtin: true }
    }),
    ...library.userThemes
      .filter((theme) => !builtinAppearanceIds.has(theme.id))
      .map((theme) => ({ appearance: theme, builtin: false })),
  ], [library.userThemes])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(
    () => applyAppearanceRuntime(appearance, systemReducedMotion, resolvedColorScheme, appRootRef.current),
    [appearance, systemReducedMotion, resolvedColorScheme],
  )

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
      setRuntimeColorSchemePreference(next.colorSchemePreference)
      setStorageWarning(next.warning)
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, [])

  const cancelPreview = useCallback(() => {
    setAppearance(cloneAppearance(resolveAppearance(library, library.currentThemeId)))
    setRuntimeColorSchemePreference(library.colorSchemePreference)
  }, [library])

  const setColorSchemePreference = useCallback((preference: ColorSchemePreference) => {
    setRuntimeColorSchemePreference(preference)
    setLibrary((previous) => ({ ...previous, colorSchemePreference: preference }))
  }, [])

  const selectTheme = useCallback((id: string) => {
    const selected = resolveAppearance(library, id)
    setAppearance(cloneAppearance(selected))
    setLibrary((previous) => ({ ...previous, currentThemeId: selected.id }))
  }, [library])

  const saveAndApplyAppearance = useCallback((candidate: AppearancePreset) => {
    const saved = cloneAppearance(candidate)
    setLibrary((previous) => ({
      ...previous,
      currentThemeId: saved.id,
      userThemes: [...previous.userThemes.filter((theme) => theme.id !== saved.id), saved],
    }))
    setAppearance(cloneAppearance(saved))
    return saved
  }, [])

  useEffect(() => {
    let cancelled = false

    void loadIconProvider(requestedIconProvider)
      .then((nextIcons) => {
        if (!cancelled) setLoadedIconProvider({ id: requestedIconProvider, icons: nextIcons })
      })
      .catch((error: unknown) => {
        console.warn(`Unable to load icon provider "${requestedIconProvider}"`, error)
        if (!cancelled) setLoadedIconProvider({ id: 'default', icons: defaultSystemIcons })
      })

    return () => {
      cancelled = true
    }
  }, [requestedIconProvider])

  const deleteAppearance = useCallback((id: string) => {
    if (!library.userThemes.some((theme) => theme.id === id)) return false
    const nextLibrary = {
      ...library,
      currentThemeId: library.currentThemeId === id
        ? (builtinAppearanceIds.has(id) ? id : defaultAppearance.id)
        : library.currentThemeId,
      userThemes: library.userThemes.filter((theme) => theme.id !== id),
    }
    setLibrary(nextLibrary)
    setAppearance(cloneAppearance(resolveAppearance(nextLibrary, nextLibrary.currentThemeId)))
    return true
  }, [library])

  const resetDefault = useCallback(() => {
    setLibrary((previous) => ({
      ...previous,
      currentThemeId: defaultAppearance.id,
      userThemes: previous.userThemes.filter((theme) => theme.id !== defaultAppearance.id),
    }))
    setAppearance(cloneAppearance(defaultAppearance))
  }, [])

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    icons,
    themes,
    activeThemeId: library.currentThemeId,
    colorSchemePreference,
    resolvedColorScheme,
    motion,
    storageWarning,
    previewAppearance: (next) => setAppearance(cloneAppearance(next)),
    previewColorSchemePreference: setRuntimeColorSchemePreference,
    cancelPreview,
    setColorSchemePreference,
    selectTheme,
    saveAndApplyAppearance,
    deleteAppearance,
    resetDefault,
  }), [appearance, icons, themes, library.currentThemeId, colorSchemePreference, resolvedColorScheme, motion, storageWarning, cancelPreview, setColorSchemePreference, selectTheme, saveAndApplyAppearance, deleteAppearance, resetDefault])

  return (
    <MotionConfig reducedMotion={motion.reducedMotion} transition={motion.transition}>
      <AppearanceContext.Provider value={value}>
        <div
          ref={appRootRef}
          className={cn('spmusic-app', resolvedColorScheme === 'dark' && 'dark')}
          data-button-variant={appearance.components.buttons}
          data-color-scheme={resolvedColorScheme}
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
    </MotionConfig>
  )
}
