import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import type { AllSongsItem } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow } from '@/features/player/services/audioCommands'
import { scheduleFolderThumbnail, scheduleTrackThumbnail } from '@/features/player/services/playlistCoverScheduler'
import { orderPlaylistArtworkRows, type PlaylistArtworkDirection } from '@/features/player/model/playlistArtworkOrder'

export type FolderCoverItem = Readonly<{ kind: 'folder'; key: string; rootPath: string; directoryPath: string; available: boolean }>
type TrackCoverItem = Pick<AllSongsItem, 'key' | 'trackId' | 'sourcePath' | 'available' | 'artworkRevision'>
export type AllSongsCoverItem = TrackCoverItem | FolderCoverItem
type WindowRow = (Readonly<{ trackId: string; sourcePath: string; artworkRevision?: number }> | Readonly<{ kind: 'folder'; rootPath: string; directoryPath: string }>) & Readonly<{ coverUrl?: string; transientFailure?: boolean }>

function coverIdentity(item: AllSongsCoverItem | WindowRow, revision = true): string {
  return 'kind' in item && item.kind === 'folder'
    ? JSON.stringify(['folder', item.rootPath, item.directoryPath])
    : JSON.stringify(['track', (item as TrackCoverItem).trackId, (item as TrackCoverItem).sourcePath, ...(revision ? [(item as TrackCoverItem).artworkRevision ?? 0] : [])])
}

function cacheDescriptor(item: AllSongsCoverItem): WindowRow {
  return 'kind' in item ? { kind: 'folder', rootPath: item.rootPath, directoryPath: item.directoryPath }
    : { trackId: item.trackId, sourcePath: item.sourcePath, ...(item.artworkRevision === undefined ? {} : { artworkRevision: item.artworkRevision }) }
}
export type AllSongsCoverStore = {
  cache: Map<string, WindowRow>
  listeners: Map<string, Set<() => void>>
  folderRevisions?: Map<string, { token?: readonly string[]; status: string; revision: number }>
  folderScanRevisions?: WeakMap<readonly string[], number>
  nextFolderRevision?: number
  notify: (key: string) => void
  leases: Map<string, number>
  retire: (key: string, url: string) => void
  retain: (key: string) => () => void
  sweep: () => void
}
type WindowRuntime = {
  mounted: boolean
  controller: AbortController
  desired: Set<string>
  // Demand that is actually inside the panel bounds, as opposed to the observer
  // overscan that `desired` also admits. Only dispatch priority reads this.
  visible: Set<string>
  cache: AllSongsCoverStore['cache']
  coverQueued: Set<string>
  coverActive: number
  pump: () => void
}

const WINDOW_CONCURRENCY = 2
const CACHE_LIMIT = 60

export function createAllSongsCoverStore(): AllSongsCoverStore {
  const listeners = new Map<string, Set<() => void>>()
  const leases = new Map<string, number>()
  const retired = new Map<string, Set<string>>()
  const sweep = () => {
    const used = new Set([...document.querySelectorAll<HTMLImageElement>('img')].map(image => image.src))
    for (const [key, urls] of retired) {
      if (leases.has(key)) continue
      for (const url of urls) {
        if (used.has(url)) continue
        URL.revokeObjectURL(url)
        urls.delete(url)
      }
      if (!urls.size) retired.delete(key)
    }
  }
  const retire = (key: string, url: string) => {
    const urls = retired.get(key) ?? new Set<string>()
    urls.add(url)
    retired.set(key, urls)
    sweep()
  }
  const retain = (key: string) => {
    leases.set(key, (leases.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (leases.get(key) ?? 1) - 1
      if (remaining > 0) { leases.set(key, remaining); return }
      leases.delete(key)
      sweep()
    }
  }
  return { cache: new Map(), listeners, leases, retain, retire, sweep, notify: (key) => {
    for (const listener of listeners.get(key) ?? []) listener()
  } }
}

export function disposeAllSongsCoverStore(store: AllSongsCoverStore): void {
  for (const [key, row] of store.cache) if (row.coverUrl) store.retire(key, row.coverUrl)
  const keys = [...store.cache.keys()]
  store.cache.clear()
  store.folderRevisions?.clear()
  store.folderScanRevisions = undefined
  for (const key of keys) store.notify(key)
}

// A completed scan returns a fresh directoryPaths array even if only an image
// changed. Keep its version with the shared cache across folder-panel visits.
export function folderCoverRevisions(store: AllSongsCoverStore, roots: readonly { path: string; directoryPaths?: readonly string[]; status: string }[]): ReadonlyMap<string, number> {
  const versions = store.folderRevisions ??= new Map()
  const scans = store.folderScanRevisions ??= new WeakMap()
  const next = () => (store.nextFolderRevision = (store.nextFolderRevision ?? 0) + 1)
  const active = new Set(roots.map(root => root.path))
  for (const path of versions.keys()) if (!active.has(path)) versions.delete(path)
  for (const root of roots) {
    const previous = versions.get(root.path)
    let revision = previous?.revision ?? 0
    if (root.status === 'ready' && root.directoryPaths) {
      const known = scans.get(root.directoryPaths)
      revision = known ?? next()
      if (known === undefined) scans.set(root.directoryPaths, revision)
    } else if (!previous || root.status === 'ready' && previous.status === 'loading') revision = next()
    versions.set(root.path, { token: root.status === 'ready' ? root.directoryPaths : previous?.token, status: root.status, revision })
  }
  return new Map([...versions].map(([path, value]) => [path, value.revision]))
}

export function useAllSongsCoverUrl(store: AllSongsCoverStore, key: string, trackId: string, sourcePath: string): string | undefined {
  return useCoverUrl(store, key, JSON.stringify(['track', trackId, sourcePath]), false)
}

export function useFolderCoverUrl(store: AllSongsCoverStore, item?: FolderCoverItem): string | undefined {
  return useCoverUrl(store, item?.key ?? '', item ? coverIdentity(item) : '')
}

function useCoverUrl(store: AllSongsCoverStore, key: string, identity: string, revision = true): string | undefined {
  const subscribe = useCallback((listener: () => void) => {
    const listeners = store.listeners.get(key) ?? new Set<() => void>()
    listeners.add(listener)
    store.listeners.set(key, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) store.listeners.delete(key)
    }
  }, [store, key])
  const getSnapshot = useCallback(() => {
    const row = store.cache.get(key)
    return row && coverIdentity(row, revision) === identity ? row.coverUrl : undefined
  }, [store, key, identity, revision])
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined)
}

export function useAllSongsWindow(items: readonly AllSongsCoverItem[], panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>, enabled: boolean, metadataLoading: boolean, store: AllSongsCoverStore, warmCount = 8, renderedItems: readonly AllSongsCoverItem[] = items) {
  const runtimeRef = useRef<WindowRuntime | null>(null)
  const itemsByKeyRef = useRef<ReadonlyMap<string, AllSongsCoverItem>>(new Map())
  const metadataLoadingRef = useRef(false)
  // Order identity only decides whether the scroll direction state is still valid.
  // Build it by concatenation: the previous nested `JSON.stringify` allocated one
  // JSON string per row on every list update.
  const itemOrderKey = useMemo(() => items.map(item => 'kind' in item
    ? `f\u0001${item.key}\u0001${item.rootPath}\u0001${item.directoryPath}`
    : `t\u0001${item.key}\u0001${item.trackId}\u0001${item.sourcePath}\u0001${item.artworkRevision ?? 0}`)
    .join('\u0000'), [items])
  const directionRef = useRef<{ items: string; layout?: string; top: number; direction: PlaylistArtworkDirection } | null>(null)
  // Lets a rendered-window change update the observed card set without rebuilding
  // the observer; the effect below owns the node map this closes over.
  const observeRenderedRef = useRef<((renderedItems: readonly AllSongsCoverItem[]) => void) | null>(null)
  // Keys of the mounted window. Anything else the observer admits came in through
  // its rootMargin overscan, so it must not compete with the rows on screen. Kept
  // in a ref because dispatch runs from effects and async completions that do not
  // re-run when only the window changes.
  const renderedKeysRef = useRef<ReadonlySet<string>>(new Set())
  // Declared before the window effect so the first pump already knows the window.
  useEffect(() => { renderedKeysRef.current = new Set(renderedItems.map((item) => item.key)) }, [renderedItems])

  useEffect(() => {
    if (!enabled) return
    // Retry failed reads on the next visit, while genuine missing artwork and
    // prepared covers remain warm across visits.
    for (const [key, row] of store.cache) {
      if (row.transientFailure) {
        if (row.coverUrl) store.retire(key, row.coverUrl)
        store.cache.delete(key)
      }
    }
    const runtime: WindowRuntime = {
      mounted: true, controller: new AbortController(), desired: new Set(), visible: new Set(), cache: store.cache,
      coverQueued: new Set(), coverActive: 0, pump: () => {},
    }
    runtimeRef.current = runtime
    directionRef.current = null
    const clientId = `all-songs-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const coverReady = beginAudioPlaylistCoverWindow(clientId).catch(() => null)
    // Every published cover writes an <img src>, so a scrolling list can deliver
    // hundreds of these mutations per frame. Coalesce the document-wide scan into
    // one animation frame; retire() and retain() keep their own synchronous sweep,
    // which is what releases a URL as soon as it is no longer displayed.
    let sweepFrame: number | null = null
    const scheduleSweep = () => {
      if (sweepFrame === null) sweepFrame = requestAnimationFrame(() => { sweepFrame = null; store.sweep() })
    }
    const replacements = new MutationObserver(scheduleSweep)
    replacements.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    store.sweep()

    const trimCache = () => {
      // The viewport plus observer overscan can exceed the warm-cache budget.
      // Demanded rows own their URLs until they leave that window; evicting one
      // here would make the pump immediately load it again and evict another.
      const limit = Math.max(CACHE_LIMIT, runtime.desired.size)
      for (const [key, evicted] of runtime.cache) {
        if (runtime.cache.size <= limit) break
        if (runtime.desired.has(key) || store.leases.has(key)) continue
        if (evicted?.coverUrl) store.retire(key, evicted.coverUrl)
        runtime.cache.delete(key)
        store.notify(key)
      }
    }

    const publish = (key: string, row: WindowRow) => {
      if (!runtime.mounted || !runtime.desired.has(key)) return false
      const previous = runtime.cache.get(key)
      if (previous?.coverUrl && previous.coverUrl !== row.coverUrl) store.retire(key, previous.coverUrl)
      runtime.cache.delete(key)
      runtime.cache.set(key, row)
      trimCache()
      store.notify(key)
      return true
    }

    // The scheduler admits strictly by priority, so classify demand when it is
    // dispatched: the row inside the viewport first, a mounted row just offscreen
    // next, overscan-only prefetch last.
    const coverPriority = (key: string): 0 | 1 | 2 =>
      runtime.visible.has(key) ? 0 : renderedKeysRef.current.has(key) ? 1 : 2

    const pump = () => {
      if (!runtime.mounted) return
      // Demand can shrink without a publication (all remaining rows cached).
      trimCache()
      // Cover work is independent of the whole-library summary/duration pass.
      // Keep a small first-screen demand alive while that pass hides the list.
      while (runtime.coverActive < WINDOW_CONCURRENCY) {
        let item: AllSongsCoverItem | undefined
        for (const key of runtime.desired) {
          const candidate = itemsByKeyRef.current.get(key)
          const cached = runtime.cache.get(key)
          if (candidate?.available && (!cached || coverIdentity(cached) !== coverIdentity(candidate)) && !runtime.coverQueued.has(key)) {
            item = candidate
            break
          }
        }
        if (!item) break
        runtime.coverQueued.add(item.key)
        runtime.coverActive += 1
        void (async () => {
          let coverUrl: string | undefined
          const itemIsCurrent = () => {
            const current = itemsByKeyRef.current.get(item.key)
            return runtime.mounted && runtime.desired.has(item.key)
              && current !== undefined && coverIdentity(current) === coverIdentity(item)
          }
          try {
            const coverGeneration = await coverReady
            if (coverGeneration == null) {
              if (itemIsCurrent()) publish(item.key, { ...cacheDescriptor(item), coverUrl: runtime.cache.get(item.key)?.coverUrl, transientFailure: true })
              return
            }
            if (!itemIsCurrent()) return
            const options = { priority: coverPriority(item.key), signal: runtime.controller.signal, isCurrent: itemIsCurrent }
            const pixels = await ('kind' in item
              ? scheduleFolderThumbnail({ clientId, rootPath: item.rootPath, directoryPath: item.directoryPath, maxEdge: 256, windowGeneration: coverGeneration }, options)
              : scheduleTrackThumbnail({ clientId, sourcePath: item.sourcePath, maxEdge: 256, windowGeneration: coverGeneration }, options))
            if (!itemIsCurrent()) return
            if (pixels) {
              if (!itemIsCurrent()) return
              const thumbnail = playlistCoverImageFromPixels(pixels)
              coverUrl = thumbnail.src
              await decodePlaylistCover(thumbnail)
              if (!itemIsCurrent()) return
            }
            if (itemIsCurrent() && publish(item.key, { ...cacheDescriptor(item), coverUrl })) {
              coverUrl = undefined
            }
          } catch {
            // Missing artwork leaves the prepared text and duration untouched.
            // Terminal failures share the bounded cache with successful and
            // missing artwork, and cannot suppress a replacement descriptor.
            if (itemIsCurrent()) publish(item.key, { ...cacheDescriptor(item), coverUrl: runtime.cache.get(item.key)?.coverUrl, transientFailure: true })
          } finally {
            if (coverUrl) store.retire(item.key, coverUrl)
            runtime.coverQueued.delete(item.key)
            runtime.coverActive -= 1
            runtime.pump()
          }
        })()
      }
    }
    runtime.pump = pump
    pump()
    return () => {
      runtime.mounted = false
      runtime.controller.abort()
      runtime.desired.clear()
      runtime.visible.clear()
      replacements.disconnect()
      if (sweepFrame !== null) { cancelAnimationFrame(sweepFrame); sweepFrame = null }
      store.sweep()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [enabled, store])

  useEffect(() => {
    itemsByKeyRef.current = new Map(items.map((item) => [item.key, item]))
    for (const item of items) {
      const cached = store.cache.get(item.key)
      if (!cached) continue
      // Player thumbnails have a separate, shorter-lived owner. Their arrival
      // must not discard this window's cover when the descriptor is unchanged.
      if (coverIdentity(cached) === coverIdentity(item)) continue
      // Keep the previous scan painted until the replacement has decoded.
      // Its stale identity still admits a fresh native request in pump().
      if (coverIdentity(cached, false) === coverIdentity(item, false)) continue
      if (cached.coverUrl) store.retire(item.key, cached.coverUrl)
      store.cache.delete(item.key)
      store.notify(item.key)
    }
    runtimeRef.current?.pump()
  }, [items, store])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!enabled || !runtime) return
    if (!metadataLoading && !metadataLoadingRef.current) return
    const firstScreen = new Set(items.filter((item) => item.available).slice(0, warmCount).map((item) => item.key))
    for (const key of runtime.desired) if (!firstScreen.has(key)) runtime.desired.delete(key)
    for (const key of firstScreen) runtime.desired.add(key)
    runtime.pump()
    if (!metadataLoading) {
      metadataLoadingRef.current = false
      return
    }
    metadataLoadingRef.current = true
  }, [enabled, items, metadataLoading, warmCount])

  // The observer outlives a rendered-window change. Only the descriptor set (via
  // `itemOrderKey`) or the loading gate rebuild it, because those replace the
  // nodes themselves; adding or removing rows only adjusts the observed set.
  useEffect(() => {
    if (!enabled) return
    const panel = panelRef.current
    const list = listRef.current
    const runtime = runtimeRef.current
    if (!panel || !list || !runtime) return
    let observing = true
    let frame: number | null = null
    // Collect nodes once per rendered window, then measure only IO-admitted
    // demand on scroll. A long tile library never gains a full-library scan.
    const nodes = new Map<string, { element: HTMLElement; domIndex: number }>()
    for (const [domIndex, element] of [...list.querySelectorAll<HTMLElement>('[data-song-key]')].entries()) {
      nodes.set(element.dataset.songKey!, { element, domIndex })
    }
    const identity = () => {
      const layout = list.dataset.layoutLevel
      let state = directionRef.current
      if (!state || state.items !== itemOrderKey || state.layout !== layout) {
        state = { items: itemOrderKey, layout, top: panel.scrollTop, direction: 0 }
        directionRef.current = state
      }
      return state
    }
    identity()
    const reorder = () => {
      if (!observing || !runtime.mounted) return
      const state = identity()
      const bounds = panel.getBoundingClientRect()
      const entries = []
      const unmeasured: string[] = []
      for (const key of runtime.desired) {
        const node = nodes.get(key)
        if (!node || !node.element.isConnected) { unmeasured.push(key); continue }
        const rect = node.element.getBoundingClientRect()
        const inViewport = rect.bottom > bounds.top && rect.top < bounds.bottom
        const side: -1 | 0 | 1 = inViewport ? 0 : rect.bottom <= bounds.top ? -1 : 1
        const viewportDistance = inViewport ? 0 : side < 0 ? bounds.top - rect.bottom : rect.top - bounds.bottom
        entries.push({ key, domIndex: node.domIndex, rowTop: node.element.offsetTop, inViewport, side, viewportDistance })
      }
      runtime.desired = new Set([...orderPlaylistArtworkRows(entries, state.direction).map(entry => entry.key), ...unmeasured])
      // Same pass already measured every demanded node, so the on-screen subset
      // costs no extra layout read.
      runtime.visible = new Set(entries.filter(entry => entry.inViewport).map(entry => entry.key))
      runtime.pump()
    }
    const scheduleReorder = () => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; reorder() })
    }
    const onScroll = () => {
      const state = identity()
      const top = panel.scrollTop
      const delta = top - state.top
      if (delta !== 0) state.direction = delta < 0 ? -1 : 1
      state.top = top
      scheduleReorder()
    }
    const observer = new IntersectionObserver((entries) => {
      if (!observing || !runtime.mounted) return
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.songKey
        if (!key) continue
        if (entry.isIntersecting) runtime.desired.add(key)
        else runtime.desired.delete(key)
      }
      reorder()
    }, { root: panel, rootMargin: '150px 0px' })
    for (const { element } of nodes.values()) observer.observe(element)
    // Rendered rows are the list's children in window order, so a new window can be
    // reconciled positionally against the retained node map. This is the same node
    // set the IntersectionObserver builds, reached without rescanning the document.
    const observeRendered = (nextRendered: readonly AllSongsCoverItem[]) => {
      if (!observing || !runtime.mounted) return
      const children = list.children
      if (!children || children.length !== nextRendered.length) return
      for (let index = 0; index < nextRendered.length; index += 1) {
        const key = nextRendered[index]!.key
        const element = children[index]
        if (!(element instanceof HTMLElement)) continue
        const existing = nodes.get(key)
        if (existing?.element === element) { existing.domIndex = index; continue }
        if (existing) observer.unobserve(existing.element)
        nodes.set(key, { element, domIndex: index })
        observer.observe(element)
      }
      if (nodes.size > nextRendered.length) {
        const wanted = new Set(nextRendered.map((item) => item.key))
        for (const [key, node] of nodes) {
          if (wanted.has(key)) continue
          observer.unobserve(node.element)
          nodes.delete(key)
        }
      }
    }
    observeRenderedRef.current = observeRendered
    panel.addEventListener('scroll', onScroll, { passive: true })
    const resize = new ResizeObserver(scheduleReorder)
    resize.observe(panel)
    resize.observe(list)
    // Retain visibility across list-summary updates. Clearing it dropped
    // in-flight covers and forced their full decode to run again.
    return () => {
      observing = false
      observeRenderedRef.current = null
      observer.disconnect()
      resize.disconnect()
      panel.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [itemOrderKey, panelRef, listRef, enabled, metadataLoading])

  // A rendered-window change only shrinks demand and re-observes the added cards.
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!enabled || !runtime) return
    const keys = new Set(renderedItems.map((item) => item.key))
    for (const key of runtime.desired) if (!keys.has(key)) runtime.desired.delete(key)
    observeRenderedRef.current?.(renderedItems)
  }, [enabled, renderedItems])

  return store
}

// Only transition participants retain decoded URLs across overlapping windows.
export function useAllSongsCoverLease(store: AllSongsCoverStore, key?: string) {
  useLayoutEffect(() => {
    if (!key) return
    return store.retain(key)
  }, [store, key])
}
