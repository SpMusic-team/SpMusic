import { normalizeAudioSourcePath } from './audioTrackModel'

export const MANUAL_SONG_ORDER_STORAGE_KEY = 'spmusic.song-manual-order.v1'
const MAX_TRACKS = 100_000

export type ManualSongOrders = ReadonlyMap<string | null, readonly string[]>

function storage(): Storage {
  if (typeof window === 'undefined') throw new Error('当前环境无法保存歌曲排序。')
  try { return window.localStorage }
  catch { throw new Error('当前环境无法访问本地歌曲排序存储。') }
}

function parseOrders(raw: string | null): Map<string | null, readonly string[]> {
  if (raw === null) return new Map()
  let document: unknown
  try { document = JSON.parse(raw) as unknown }
  catch { throw new Error('保存的歌曲排序已损坏，未覆盖原数据。') }
  if (!document || typeof document !== 'object' || !('version' in document) || document.version !== 1
    || !('orders' in document) || !Array.isArray(document.orders)) throw new Error('保存的歌曲排序格式不受支持，未覆盖原数据。')
  const result = new Map<string | null, readonly string[]>()
  for (const entry of document.orders) {
    if (!entry || typeof entry !== 'object' || !('scope' in entry) || !(entry.scope === null || typeof entry.scope === 'string' && entry.scope.length > 0)
      || !('paths' in entry) || !Array.isArray(entry.paths) || entry.paths.length > MAX_TRACKS
      || entry.paths.some((path: unknown) => typeof path !== 'string' || !path.length || path.includes('\0'))
      || result.has(entry.scope)) throw new Error('保存的歌曲排序已损坏，未覆盖原数据。')
    const paths: string[] = entry.paths.map(normalizeAudioSourcePath)
    if (new Set(paths).size !== paths.length) throw new Error('保存的歌曲排序包含重复条目，未覆盖原数据。')
    result.set(entry.scope, paths)
  }
  return result
}

export function readManualSongOrders(): { orders: ManualSongOrders; error?: string } {
  try { return { orders: parseOrders(storage().getItem(MANUAL_SONG_ORDER_STORAGE_KEY)) } }
  catch (error) { return { orders: new Map(), error: error instanceof Error ? error.message : '无法读取保存的歌曲排序。' } }
}

export function sameSongOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}

export function isSongOrderPermutation(expected: readonly string[], ordered: readonly string[]): boolean {
  const keys = new Set(expected)
  return expected.length === ordered.length && keys.size === expected.length && new Set(ordered).size === ordered.length
    && ordered.every(key => keys.has(key))
}

// Unknown/deleted paths are ignored; newly discovered songs append in the
// source's order. Metadata completion never changes a stored manual prefix.
export function applyManualSongOrder<T>(rows: readonly T[], paths: readonly string[] | undefined, getPath: (row: T) => string): T[] {
  if (!paths) return [...rows]
  const byPath = new Map(rows.map(row => [normalizeAudioSourcePath(getPath(row)), row]))
  const ordered: T[] = []
  for (const path of paths) {
    const row = byPath.get(path)
    if (row !== undefined) { ordered.push(row); byPath.delete(path) }
  }
  for (const row of rows) {
    const path = normalizeAudioSourcePath(getPath(row))
    if (byPath.has(path)) { ordered.push(row); byPath.delete(path) }
  }
  return ordered
}

export function saveManualSongOrder(scope: string | null, paths: readonly string[], expectedStored: readonly string[] | undefined): ManualSongOrders {
  if (paths.length > MAX_TRACKS || paths.some(path => !path || path.includes('\0'))) throw new Error('歌曲排序条目无效。')
  const canonical = paths.map(normalizeAudioSourcePath)
  if (new Set(canonical).size !== canonical.length) throw new Error('歌曲排序包含重复条目。')
  const target = storage()
  const orders = parseOrders(target.getItem(MANUAL_SONG_ORDER_STORAGE_KEY))
  const current = orders.get(scope)
  if (Boolean(current) !== Boolean(expectedStored) || current && expectedStored && !sameSongOrder(current, expectedStored)) {
    throw new Error('保存的歌曲排序已更改，请重新打开列表后重试。')
  }
  orders.set(scope, canonical)
  try {
    target.setItem(MANUAL_SONG_ORDER_STORAGE_KEY, JSON.stringify({ version: 1,
      orders: [...orders].map(([savedScope, savedPaths]) => ({ scope: savedScope, paths: savedPaths })) }))
  } catch { throw new Error('无法保存歌曲排序，请检查本地存储是否可用或空间是否足够。') }
  return orders
}

// A filtered drag replaces only the filtered slots. Hidden songs retain their
// positions, and the full order captured when the handle was pressed is kept.
export function mergeFilteredSongOrder(full: readonly string[], expected: readonly string[], ordered: readonly string[]): string[] | undefined {
  if (!isSongOrderPermutation(expected, ordered)) return undefined
  const visible = new Set(expected)
  if (!sameSongOrder(full.filter(key => visible.has(key)), expected)) return undefined
  let index = 0
  return full.map(key => visible.has(key) ? ordered[index++] : key)
}
