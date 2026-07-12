import { defaultSystemIcons } from '@/icons/providers/defaultIcons'
import { fluentSystemIcons } from '@/icons/providers/fluentIcons'
import { iosSystemIcons } from '@/icons/providers/iosIcons'

export type { SystemIcon, SystemIconProvider } from '@/icons/types'

export const iconProviders = {
  default: defaultSystemIcons,
  ios: iosSystemIcons,
  fluent: fluentSystemIcons,
  windows: defaultSystemIcons,
  fallback: fluentSystemIcons,
} as const

export type IconProviderId = keyof typeof iconProviders

export const systemIcons = iconProviders.default
