import { defaultSystemIcons } from '@/icons/providers/defaultIcons'
import type { IconProviderId } from '@/icons/iconProviderIds'
import type { SystemIconProvider } from '@/icons/types'

export type { IconProviderId } from '@/icons/iconProviderIds'
export type { SystemIcon, SystemIconProvider } from '@/icons/types'

const iconProviderLoaders: Record<IconProviderId, () => Promise<SystemIconProvider>> = {
  default: async () => defaultSystemIcons,
  windows: async () => defaultSystemIcons,
  ios: () => import('@/icons/providers/iosIcons').then((module) => module.iosSystemIcons),
  fluent: () => import('@/icons/providers/fluentIcons').then((module) => module.fluentSystemIcons),
  fallback: () => import('@/icons/providers/fluentIcons').then((module) => module.fluentSystemIcons),
}

const providerCache = new Map<IconProviderId, Promise<SystemIconProvider>>([
  ['default', Promise.resolve(defaultSystemIcons)],
  ['windows', Promise.resolve(defaultSystemIcons)],
])

export function loadIconProvider(id: IconProviderId) {
  const cached = providerCache.get(id)
  if (cached) return cached

  const request = iconProviderLoaders[id]().catch((error: unknown) => {
    providerCache.delete(id)
    throw error
  })
  providerCache.set(id, request)
  return request
}

export const systemIcons = defaultSystemIcons
