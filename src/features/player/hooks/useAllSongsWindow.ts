import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import type { AllSongsItem } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow, probeAudioPlaylistCover } from '@/features/player/services/audioCommands'
import { schedulePlaylistCoverPixels } from '@/features/player/services/playlistCoverScheduler'

type WindowRow = Readonly<{ trackId: string; sourcePath: string; coverUrl?: string }>
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
  coverDone: Set<string>
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

export function useAllSongsWindow(items: readonly AllSongsItem[], panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, enabled: boolean, metadataLoading: boolean, store: AllSongsCoverStore) {
  const runtimeRef = useRef<WindowRuntime | null>(null)
  const itemsByKeyRef = useRef<ReadonlyMap<string, AllSongsItem>>(new Map())
  const metadataLoadingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const runtime: WindowRuntime = {
      mounted: true, controller: new AbortController(), desired: new Set(), cache: store.cache, coverDone: new Set(store.cache.keys()),
      coverQueued: new Set(), coverActive: 0, pump: () => {},
    }
    runtimeRef.current = runtime
    const clientId = `all-songs-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const coverReady = beginAudioPlaylistCoverWindow(clientId).catch(() => null)

    const publish = (key: string, row: WindowRow) => {
      if (!runtime.mounted || !runtime.desired.has(key)) return false
      const previous = runtime.cache.get(key)
      if (previous?.coverUrl && previous.coverUrl !== row.coverUrl) URL.revokeObjectURL(previous.coverUrl)
      runtime.cache.delete(key)
      runtime.cache.set(key, row)
      while (runtime.cache.size > CACHE_LIMIT) {
        const oldest = runtime.cache.keys().next().value
        if (!oldest) break
        const evicted = runtime.cache.get(oldest)
        if (evicted?.coverUrl) URL.revokeObjectURL(evicted.coverUrl)
        runtime.cache.delete(oldest)
        runtime.coverDone.delete(oldest)
        store.notify(oldest)
      }
      store.notify(key)
      return true
    }

    const pump = () => {
      if (!runtime.mounted) return
      // Cover work is independent of the whole-library summary/duration pass.
      // Keep a small first-screen demand alive while that pass hides the list.
      while (runtime.coverActive < WINDOW_CONCURRENCY) {
        let item: AllSongsItem | undefined
        for (const key of runtime.desired) {
          const candidate = itemsByKeyRef.current.get(key)
          if (candidate?.available && !candidate.track.coverThumbnail && !runtime.coverDone.has(key) && !runtime.coverQueued.has(key)) {
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
              && !current.track.coverThumbnail
          }
          try {
            const coverGeneration = await coverReady
            if (coverGeneration == null) {
              runtime.coverDone.add(item.key)
              return
            }
            if (!itemIsCurrent()) return
            const cover = await probeAudioPlaylistCover(item.sourcePath)
            if (cover.id !== item.trackId || normalizeAudioSourcePath(cover.sourcePath) !== item.key) throw new Error('Cover does not match its folder descriptor')
            if (!itemIsCurrent()) return
            if (cover.coverArt?.filePath) {
              const pixels = await schedulePlaylistCoverPixels(
                { clientId, filePath: cover.coverArt.filePath, maxEdge: 128, windowGeneration: coverGeneration },
                { priority: 1, signal: runtime.controller.signal,
                  isCurrent: itemIsCurrent },
              )
              if (!pixels) return
              if (!itemIsCurrent()) return
              const thumbnail = playlistCoverImageFromPixels(pixels)
              coverUrl = thumbnail.src
              await decodePlaylistCover(thumbnail)
              if (!itemIsCurrent()) return
            }
            if (itemIsCurrent() && publish(item.key, { trackId: item.trackId, sourcePath: item.sourcePath, coverUrl })) {
              runtime.coverDone.add(item.key)
              coverUrl = undefined
            }
          } catch {
            // Missing artwork leaves the prepared text and duration untouched.
            if (runtime.mounted && runtime.desired.has(item.key)) runtime.coverDone.add(item.key)
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
      if (!item.track.coverThumbnail && cached.trackId === item.trackId && cached.sourcePath === item.sourcePath) continue
      if (cached.coverUrl) URL.revokeObjectURL(cached.coverUrl)
      store.cache.delete(item.key)
      runtimeRef.current?.coverDone.delete(item.key)
      store.notify(item.key)
    }
    runtimeRef.current?.pump()
  }, [items, store])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!enabled || !runtime) return
    if (!metadataLoading && !metadataLoadingRef.current) return
    const firstScreen = new Set(items.filter((item) => item.available).slice(0, 8).map((item) => item.key))
    for (const key of runtime.desired) if (!firstScreen.has(key)) runtime.desired.delete(key)
    for (const key of firstScreen) runtime.desired.add(key)
    runtime.pump()
    if (!metadataLoading) {
      metadataLoadingRef.current = false
      return
    }
    metadataLoadingRef.current = true
  }, [enabled, items, metadataLoading])

  useEffect(() => {
    if (!enabled) return
    const panel = panelRef.current
    const list = listRef.current
    const runtime = runtimeRef.current
    if (!panel || !list || !runtime) return
    const keys = new Set(items.map((item) => item.key))
    for (const key of runtime.desired) if (!keys.has(key)) runtime.desired.delete(key)
    const observer = new IntersectionObserver((entries) => {
      if (!runtime.mounted) return
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.songKey
        if (!key) continue
        if (entry.isIntersecting) runtime.desired.add(key)
        else runtime.desired.delete(key)
      }
      runtime.pump()
    }, { root: panel, rootMargin: '150px 0px' })
    for (const row of list.querySelectorAll<HTMLElement>('[data-song-key]')) observer.observe(row)
    // Retain visibility across list-summary updates. Clearing it dropped
    // in-flight covers and forced their full decode to run again.
    return () => observer.disconnect()
  }, [items, panelRef, listRef, enabled, metadataLoading])

  return store
}
