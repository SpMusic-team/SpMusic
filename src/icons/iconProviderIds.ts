export const iconProviderIds = ['default', 'ios', 'fluent', 'windows', 'fallback'] as const

export type IconProviderId = (typeof iconProviderIds)[number]

export function isIconProviderId(value: unknown): value is IconProviderId {
  return typeof value === 'string' && iconProviderIds.includes(value as IconProviderId)
}
