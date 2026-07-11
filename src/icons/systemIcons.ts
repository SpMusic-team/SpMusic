import { fluentSystemIcons } from '@/icons/providers/fluentIcons'
import { iosSystemIcons } from '@/icons/providers/iosIcons'

export type { SystemIcon, SystemIconProvider } from '@/icons/types'

export const iconProviders = {
  ios: iosSystemIcons,
  fluent: fluentSystemIcons,
  windows: fluentSystemIcons,
  fallback: fluentSystemIcons,
} as const

export const systemIcons = iconProviders.windows
