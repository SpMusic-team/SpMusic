import type { SearchCategory } from './librarySearch.ts'

export const SEARCH_CATEGORIES_STORAGE_KEY = 'spmusic.search.categories.v1'

// The allowlist is a parameter instead of a value import of librarySearch so
// this preference stays a dependency-free module and cannot inherit the search
// model's runtime module graph. A whitelist lookup also keeps inherited object
// member names such as "__proto__" from ever counting as a known category.
function normalizeCategories(categories: readonly unknown[], allowed: readonly SearchCategory[]): SearchCategory[] {
  const allowedIds = new Set<string>(allowed)
  const kept = new Set<string>()
  for (const category of categories) if (typeof category === 'string' && allowedIds.has(category)) kept.add(category)
  const normalized: SearchCategory[] = []
  for (const category of allowed) {
    if (!kept.has(category) || normalized.includes(category)) continue
    normalized.push(category)
  }
  return normalized
}

export function readSearchCategories(allowed: readonly SearchCategory[]): SearchCategory[] {
  // Every fallback is a fresh copy so callers never alias the allowlist.
  const defaults = [...allowed]
  if (typeof window === 'undefined') return defaults
  try {
    const stored = window.localStorage.getItem(SEARCH_CATEGORIES_STORAGE_KEY)
    if (stored === null) return defaults
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return defaults
    // An explicit empty selection is a real preference: the search page already
    // explains it with its "请选择搜索分类" empty state, so it must not be
    // replaced by the default selection after a restart.
    if (parsed.length === 0) return []
    const normalized = normalizeCategories(parsed, allowed)
    // A non-empty value without a single known category is corrupt storage, not
    // a user's empty selection, so it falls back instead of restoring nothing.
    return normalized.length ? normalized : defaults
  } catch {
    return defaults
  }
}

export function persistSearchCategories(categories: readonly SearchCategory[], allowed: readonly SearchCategory[]): void {
  if (typeof window === 'undefined') return
  // Never replace a stored preference with a value that is not a category list.
  if (!Array.isArray(categories)) return
  try {
    window.localStorage.setItem(SEARCH_CATEGORIES_STORAGE_KEY, JSON.stringify(normalizeCategories(categories, allowed)))
  } catch {
    // A blocked or full store must not prevent changing the current selection.
  }
}
