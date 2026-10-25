import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import type { AllSongsItem } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow } from '@/features/player/services/audioCommands'
import { scheduleTrackThumbnail } from '@/features/player/services/playlistCoverScheduler'
import { orderPlaylistArtworkRows, type PlaylistArtworkDirection } from '@/features/player/model/playlistArtworkOrder'

type WindowRow = Readonly<{ trackId: string; sourcePath: string; coverUrl?: string; transientFailure?: boolean }>
export type AllSongsCoverStore = {
  cache: Map<string, WindowRow>
  listeners: Map<string, Set<() => void>>
  notify: (key: string) => void
}
type WindowRuntime = {
  mounted: boolean
  controller: AbortController
  desired: Set<string>
  cache: AllSongsCoverStore['cache']
  coverQueued: Set<string>
  coverActive: number
  pump: () => void
}

const WINDOW_CONCURRENCY = 2
const CACHE_LIMIT = 60

export function createAllSongsCoverStore(): AllSongsCoverStore {
  const listeners = new Map<string, Set<() => void>>()
  return { cache: new Map(), listeners, notify: (key) => {
    for (const listener of listeners.get(key) ?? []) listener()
  } }
}

export function disposeAllSongsCoverStore(store: AllSongsCoverStore): void {
  for (const row of store.cache.values()) if (row.coverUrl) URL.revokeObjectURL(row.coverUrl)
  const keys = [...store.cache.keys()]
  store.cache.clear()
  for (const key of keys) store.notify(key)
}

export function useAllSongsCoverUrl(store: AllSongsCoverStore, key: string, trackId: string, sourcePath: string): string | undefined {
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
    return row?.trackId === trackId && row.sourcePath === sourcePath ? row.coverUrl : undefined
  }, [store, key, trackId, sourcePath])
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined)
}

export function useAllSongsWindow(items: readonly AllSongsItem[], panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, enabled: boolean, metadataLoading: boolean, store: AllSongsCoverStore, warmCount = 8, renderedItems: readonly AllSongsItem[] = items) {
  const runtimeRef = useRef<WindowRuntime | null>(null)
  const itemsByKeyRef = useRef<ReadonlyMap<string, AllSongsItem>>(new Map())
  const metadataLoadingRef = useRef(false)
  const itemOrderKey = useMemo(() => items.map(item => `${item.key}\u0001${item.trackId}`).join('\u0000'), [items])
  const directionRef = useRef<{ items: string; layout?: string; top: number; direction: PlaylistArtworkDirection } | null>(null)

  useEffect(() => {
    if (!enabled) return
    // Retry failed reads on the next visit, while genuine missing artwork and
    // prepared covers remain warm across visits.
    for (const [key, row] of store.cache) {
      if (row.transientFailure) store.cache.delete(key)
    }
    const runtime: WindowRuntime = {
      mounted: true, controller: new AbortController(), desired: new Set(), cache: store.cache,
      coverQueued: new Set(), coverActive: 0, pump: () => {},
    }
    runtimeRef.current = runtime
    directionRef.current = null
    const clientId = `all-songs-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const coverReady = beginAudioPlaylistCoverWindow(clientId).catch(() => null)

    const trimCache = () => {
      // The viewport plus observer overscan can exceed the warm-cache budget.
      // Demanded rows own their URLs until they leave that window; evicting one
      // here would make the pump immediately load it again and evict another.
      const limit = Math.max(CACHE_LIMIT, runtime.desired.size)
      for (const [key, evicted] of runtime.cache) {
        if (runtime.cache.size <= limit) break
        if (runtime.desired.has(key)) continue
        if (evicted?.coverUrl) URL.revokeObjectURL(evicted.coverUrl)
        runtime.cache.delete(key)
        store.notify(key)
      }
    }

    const publish = (key: string, row: WindowRow) => {
      if (!runtime.mounted || !runtime.desired.has(key)) return false
      const previous = runtime.cache.get(key)
      if (previous?.coverUrl && previous.coverUrl !== row.coverUrl) URL.revokeObjectURL(previous.coverUrl)
      runtime.cache.delete(key)
      runtime.cache.set(key, row)
      trimCache()
      store.notify(key)
      return true
    }

    const pump = () => {
      if (!runtime.mounted) return
      // Demand can shrink without a publication (all remaining rows cached).
      trimCache()
      // Cover work is independent of the whole-library summary/duration pass.
      // Keep a small first-screen demand alive while that pass hides the list.
      while (runtime.coverActive < WINDOW_CONCURRENCY) {
        let item: AllSongsItem | undefined
        for (const key of runtime.desired) {
          const candidate = itemsByKeyRef.current.get(key)
          if (candidate?.available && !runtime.cache.has(key) && !runtime.coverQueued.has(key)) {
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
              && current?.trackId === item.trackId && current.sourcePath === item.sourcePath
          }
          try {
            const coverGeneration = await coverReady
            if (coverGeneration == null) {
              if (itemIsCurrent()) publish(item.key, { trackId: item.trackId, sourcePath: item.sourcePath, transientFailure: true })
              return
            }
            if (!itemIsCurrent()) return
            const pixels = await scheduleTrackThumbnail(
              { clientId, sourcePath: item.sourcePath, maxEdge: 256, windowGeneration: coverGeneration },
              { priority: 1, signal: runtime.controller.signal, isCurrent: itemIsCurrent },
            )
            if (!itemIsCurrent()) return
            if (pixels) {
              if (!itemIsCurrent()) return
              const thumbnail = playlistCoverImageFromPixels(pixels)
              coverUrl = thumbnail.src
              await decodePlaylistCover(thumbnail)
              if (!itemIsCurrent()) return
            }
            if (itemIsCurrent() && publish(item.key, { trackId: item.trackId, sourcePath: item.sourcePath, coverUrl })) {
              coverUrl = undefined
            }
          } catch {
            // Missing artwork leaves the prepared text and duration untouched.
            // Terminal failures share the bounded cache with successful and
            // missing artwork, and cannot suppress a replacement descriptor.
            if (itemIsCurrent()) publish(item.key, { trackId: item.trackId, sourcePath: item.sourcePath, transientFailure: true })
          } finally {
            if (coverUrl) URL.revokeObjectURL(coverUrl)
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
      if (cached.trackId === item.trackId && cached.sourcePath === item.sourcePath) continue
      if (cached.coverUrl) URL.revokeObjectURL(cached.coverUrl)
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

  useEffect(() => {
    if (!enabled) return
    const panel = panelRef.current
    const list = listRef.current
    const runtime = runtimeRef.current
    if (!panel || !list || !runtime) return
    const keys = new Set(renderedItems.map((item) => item.key))
    for (const key of runtime.desired) if (!keys.has(key)) runtime.desired.delete(key)
    let observing = true
    let frame: number | null = null
    // Collect nodes once per rendered window, then measure only IO-admitted
    // demand on scroll. A long tile library never gains a full-library scan.
    const nodes = new Map([...list.querySelectorAll<HTMLElement>('[data-song-key]')]
      .map((element, domIndex) => [element.dataset.songKey!, { element, domIndex }] as const))
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
    panel.addEventListener('scroll', onScroll, { passive: true })
    const resize = new ResizeObserver(scheduleReorder)
    resize.observe(panel)
    resize.observe(list)
    // Retain visibility across list-summary updates. Clearing it dropped
    // in-flight covers and forced their full decode to run again.
    return () => {
      observing = false
      observer.disconnect()
      resize.disconnect()
      panel.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [items, itemOrderKey, renderedItems, panelRef, listRef, enabled, metadataLoading])

  return store
}
