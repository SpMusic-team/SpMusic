import { useEffect, useRef, useState, type RefObject } from 'react'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import type { AllSongsItem } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow, loadAudioPlaylistCoverPixels, probeAudioPlaylistCover } from '@/features/player/services/audioCommands'

type WindowRow = Readonly<{ coverUrl?: string }>
type WindowRuntime = {
  mounted: boolean
  desired: Set<string>
  cache: Map<string, WindowRow>
  coverDone: Set<string>
  coverQueued: Set<string>
  coverActive: number
  pump: () => void
}

const WINDOW_CONCURRENCY = 2
const CACHE_LIMIT = 60
const EMPTY_ROWS: ReadonlyMap<string, WindowRow> = new Map()

export function useAllSongsWindow(items: readonly AllSongsItem[], panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [resolved, setResolved] = useState<ReadonlyMap<string, WindowRow>>(EMPTY_ROWS)
  const runtimeRef = useRef<WindowRuntime | null>(null)
  const itemsRef = useRef(items)

  useEffect(() => {
    if (!enabled) return
    const runtime: WindowRuntime = {
      mounted: true, desired: new Set(), cache: new Map(), coverDone: new Set(),
      coverQueued: new Set(), coverActive: 0, pump: () => {},
    }
    runtimeRef.current = runtime
    queueMicrotask(() => {
      if (runtime.mounted) setResolved(EMPTY_ROWS)
    })
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
      }
      setResolved(new Map(runtime.cache))
      return true
    }

    const pump = () => {
      if (!runtime.mounted) return
      // Text and durations are prepared before the scrollable list mounts.
      // Only artwork remains windowed, so scrolling never starts audio hydration.
      while (runtime.coverActive < WINDOW_CONCURRENCY) {
        // Rows already carrying a player thumbnail are skipped: the visual
        // pipeline has the same artwork, so reading it again here would only
        // replace one image with another and flash the cover. Pump re-runs when
        // `items` change, so a row becomes a candidate again if the thumbnail
        // disappears.
        const item = itemsRef.current.find((candidate) => runtime.desired.has(candidate.key) && candidate.available && !runtime.coverDone.has(candidate.key) && !runtime.coverQueued.has(candidate.key) && !candidate.track.coverThumbnail)
        if (!item) break
        runtime.coverQueued.add(item.key)
        runtime.coverActive += 1
        void (async () => {
          let coverUrl: string | undefined
          try {
            const coverGeneration = await coverReady
            if (coverGeneration == null) {
              runtime.coverDone.add(item.key)
              return
            }
            if (!runtime.mounted || !runtime.desired.has(item.key)) return
            const cover = await probeAudioPlaylistCover(item.sourcePath)
            if (cover.id !== item.trackId || normalizeAudioSourcePath(cover.sourcePath) !== item.key) throw new Error('Cover does not match its folder descriptor')
            if (!runtime.mounted || !runtime.desired.has(item.key)) return
            if (cover.coverArt?.filePath) {
              const pixels = await loadAudioPlaylistCoverPixels({ clientId, filePath: cover.coverArt.filePath, maxEdge: 128, windowGeneration: coverGeneration })
              if (!runtime.mounted || !runtime.desired.has(item.key)) return
              coverUrl = playlistCoverImageFromPixels(pixels).src
            }
            const row = runtime.cache.get(item.key) ?? {}
            if (publish(item.key, { ...row, coverUrl })) {
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
      runtime.desired.clear()
      for (const row of runtime.cache.values()) if (row.coverUrl) URL.revokeObjectURL(row.coverUrl)
      runtime.cache.clear()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    itemsRef.current = items
    runtimeRef.current?.pump()
  }, [items])

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
  }, [items, panelRef, listRef, enabled])

  return enabled ? resolved : EMPTY_ROWS
}
