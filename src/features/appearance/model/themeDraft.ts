import type { AppearancePreset, AppearanceThemeMetadata } from './appearanceTypes'

export const hexColorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

export function inferThemeCapabilities(theme: AppearancePreset): AppearanceThemeMetadata['capabilities'] {
  const capabilities: AppearanceThemeMetadata['capabilities'] = ['tokens']
  if (theme.metadata.tier !== 'standard' || theme.advanced.customCss) capabilities.push('custom-css')
  if (theme.metadata.tier === 'experimental' || theme.experimental.layoutCss) capabilities.push('layout-overrides')
  if (theme.experimental.resources.length) capabilities.push('local-resources')
  return capabilities
}
