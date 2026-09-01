import { createAppearanceCssVars } from './appearanceCss'
import type { AppearancePreset, ResolvedColorScheme } from './appearanceTypes'

const CUSTOM_STYLE_ID = 'spmusic-custom-theme-style'

const dataAttributes = [
  'data-theme',
  'data-color-scheme',
  'data-theme-tier',
  'data-icon-pack',
  'data-motion',
  'data-surface-variant',
  'data-button-variant',
  'data-window-controls',
  'data-player-background',
  'data-player-controls-material',
  'data-player-controls-material-source',
  'data-player-controls-density',
  'data-player-primary-button-style',
  'data-player-auxiliary-button-style',
  'data-player-controls-time-labels',
  'data-player-volume-percent',
  'data-spmusic-theme-scope',
] as const

export function applyAppearanceRuntime(
  appearance: AppearancePreset,
  systemReducedMotion: boolean,
  resolvedColorScheme: ResolvedColorScheme,
  appRoot?: HTMLElement | null,
) {
  const targets = [document.documentElement, document.body, ...(appRoot ? [appRoot] : [])]
  const cssVariables = createAppearanceCssVars(appearance, resolvedColorScheme) as unknown as Record<string, string | number>
  cssVariables['color-scheme'] = resolvedColorScheme
  if (systemReducedMotion || appearance.motion.level === 'off') {
    cssVariables['--app-motion-fast'] = '0ms'
    cssVariables['--app-motion-standard'] = '0ms'
    cssVariables['--app-motion-slow'] = '0ms'
    cssVariables['--app-motion-prototype-press'] = '0ms'
    cssVariables['--app-motion-prototype-smart'] = '0ms'
    cssVariables['--app-motion-duration-scale'] = 0
  }
  const resources = appearance.metadata.tier === 'experimental' ? appearance.experimental.resources : []
  resources.forEach((resource) => {
    cssVariables[`--theme-resource-${resource.id}`] = `url(${JSON.stringify(resource.source)})`
  })

  const previousStyles = targets.map((target) => new Map(Object.keys(cssVariables).map((key) => [key, target.style.getPropertyValue(key)])))
  const previousAttributes = targets.map((target) => new Map(dataAttributes.map((name) => [name, target.getAttribute(name)])))
  const previousDarkClasses = targets.map((target) => target.classList.contains('dark'))
  const attributes: Record<(typeof dataAttributes)[number], string> = {
    'data-theme': appearance.id,
    'data-color-scheme': resolvedColorScheme,
    'data-theme-tier': appearance.metadata.tier,
    'data-icon-pack': appearance.icons.provider,
    'data-motion': appearance.motion.level,
    'data-surface-variant': appearance.components.surface,
    'data-button-variant': appearance.components.buttons,
    'data-window-controls': appearance.components.windowControls,
    'data-player-background': appearance.player.backgroundEffect,
    'data-player-controls-material': appearance.player.controls.material === 'inherit'
      ? appearance.components.surface
      : appearance.player.controls.material,
    'data-player-controls-material-source': appearance.player.controls.material === 'inherit' ? 'inherit' : 'override',
    'data-player-controls-density': appearance.player.controls.density,
    'data-player-primary-button-style': appearance.player.controls.primaryButton.style,
    'data-player-auxiliary-button-style': appearance.player.controls.auxiliaryButtons.style,
    'data-player-controls-time-labels': String(appearance.player.controls.visibility.timeLabels),
    'data-player-volume-percent': String(appearance.player.controls.visibility.volumePercent),
    'data-spmusic-theme-scope': '',
  }

  targets.forEach((target) => {
    Object.entries(cssVariables).forEach(([key, value]) => target.style.setProperty(key, String(value)))
    Object.entries(attributes).forEach(([name, value]) => target.setAttribute(name, value))
    target.classList.toggle('dark', resolvedColorScheme === 'dark')
  })

  let styleElement = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null
  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.id = CUSTOM_STYLE_ID
    document.head.append(styleElement)
  }
  const customCss = appearance.metadata.tier === 'standard' ? '' : appearance.advanced.customCss
  const layoutCss = appearance.metadata.tier === 'experimental' ? appearance.experimental.layoutCss : ''
  styleElement.textContent = customCss || layoutCss
    ? `@scope ([data-spmusic-theme-scope]) {\n${customCss}\n}\n${layoutCss}`
    : ''

  return () => {
    targets.forEach((target, index) => {
      previousStyles[index].forEach((value, key) => value ? target.style.setProperty(key, value) : target.style.removeProperty(key))
      previousAttributes[index].forEach((value, name) => value === null ? target.removeAttribute(name) : target.setAttribute(name, value))
      target.classList.toggle('dark', previousDarkClasses[index])
    })
    if (styleElement?.parentNode) styleElement.remove()
  }
}
