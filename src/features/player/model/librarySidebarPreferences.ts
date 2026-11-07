import { mediaLibraryCategories, type MediaLibraryCategoryId } from '@/features/player/model/mediaLibraryCategories'

export const LIBRARY_SIDEBAR_PREFERENCES_KEY = 'spmusic.library.sidebar.folders-pinned.v1'

export function readFoldersPinnedToTop(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(LIBRARY_SIDEBAR_PREFERENCES_KEY) === '1'
  } catch {
    return false
  }
}

export function writeFoldersPinnedToTop(pinned: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LIBRARY_SIDEBAR_PREFERENCES_KEY, pinned ? '1' : '0')
    }
  } catch {
    // Keep this session usable when local storage is unavailable or full.
  }
}

export const LIBRARY_CATEGORY_PINS_KEY = 'spmusic.library.sidebar.category-pins.v1'

function validPins(value: unknown): MediaLibraryCategoryId[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is MediaLibraryCategoryId => mediaLibraryCategories.some(category => category.id === id)))]
}

export function readPinnedCategoryIds(): MediaLibraryCategoryId[] {
  try {
    if (typeof window === 'undefined') return []
    const saved = window.localStorage.getItem(LIBRARY_CATEGORY_PINS_KEY)
    if (saved !== null) return validPins(JSON.parse(saved))
  } catch { /* Fall back to the previous folder preference when unavailable. */ }
  return readFoldersPinnedToTop() ? ['folders'] : []
}

export function writePinnedCategoryIds(pins: readonly MediaLibraryCategoryId[]): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LIBRARY_CATEGORY_PINS_KEY, JSON.stringify(validPins(pins)))
  } catch { /* Keep in-memory preferences usable if storage is unavailable. */ }
  writeFoldersPinnedToTop(pins.includes('folders'))
}

export function sidebarLibraryCategories(pinned: boolean | readonly MediaLibraryCategoryId[]) {
  const pins = typeof pinned === 'boolean' ? pinned ? ['folders'] : [] : pinned
  return [
    ...pins.flatMap(id => mediaLibraryCategories.filter(category => category.id === id)),
    ...mediaLibraryCategories.filter(category => !pins.includes(category.id)),
  ]
}
