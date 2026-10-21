import { useEffect, useRef, useState, type RefObject } from 'react'
import { audioTrackToPlaylistVisual } from '@/features/player/model/audioTrackModel'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import type { AllSongsItem, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow, hydrateAudioTrack, loadAudioPlaylistCoverPixels, probeAudioPlaylistCover } from '@/features/player/services/audioCommands'

type WindowRow = Readonly<{ track: PlaylistTrackItemViewModel; coverUrl?: string }>

export function useAllSongsWindow(items: readonly AllSongsItem[], panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [resolved, setResolved] = useState<ReadonlyMap<string, WindowRow>>(new Map())
  const state = useRef({ active: 0, desired: new Set<string>(), queued: new Set<string>(), cache: new Map<string, WindowRow>(), mounted: false, generation: 0, pump: () => {} })
  const itemsRef = useRef(items)

  useEffect(() => {
    if (!enabled) return
    const runtime = state.current
    runtime.mounted = true
    runtime.generation += 1
    const generation = runtime.generation
    const clientId = `all-songs-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    let coverGeneration: number | null = null
    const coverReady = beginAudioPlaylistCoverWindow(clientId).then((value) => { coverGeneration = value }).catch(() => undefined)

    const pump = () => {
      if (!runtime.mounted || runtime.generation !== generation) return
      while (runtime.active < 2) {
        const item = itemsRef.current.find((candidate) => runtime.desired.has(candidate.key) && candidate.available && !runtime.cache.has(candidate.key) && !runtime.queued.has(candidate.key))
        if (!item) break
        runtime.queued.add(item.key)
        runtime.active += 1
        void (async () => {
          let coverUrl: string | undefined
          try {
            const hydrated = await hydrateAudioTrack(item.sourcePath)
            if (hydrated.id !== item.trackId || normalizeAudioSourcePath(hydrated.sourcePath) !== item.key) throw new Error('Hydrated song does not match its folder descriptor')
            const track = { ...item.track, ...audioTrackToPlaylistVisual(hydrated) }
            try {
              await coverReady
              if (coverGeneration != null && runtime.desired.has(item.key)) {
                const cover = await probeAudioPlaylistCover(item.sourcePath)
                if (cover.id === item.trackId && normalizeAudioSourcePath(cover.sourcePath) === item.key && cover.coverArt?.filePath) {
                  const pixels = await loadAudioPlaylistCoverPixels({ clientId, filePath: cover.coverArt.filePath, maxEdge: 128, windowGeneration: coverGeneration })
                  const canvas = document.createElement('canvas')
                  canvas.width = pixels.width
                  canvas.height = pixels.height
                  canvas.getContext('2d')?.putImageData(new ImageData(pixels.pixels, pixels.width, pixels.height), 0, 0)
                  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
                  if (blob) coverUrl = URL.createObjectURL(blob)
                }
              }
            } catch { /* Cover failure does not discard decoder-backed duration and tags. */ }
            if (!runtime.mounted || runtime.generation !== generation || !runtime.desired.has(item.key)) return
            runtime.cache.set(item.key, { track, coverUrl })
            while (runtime.cache.size > 60) {
              const oldest = runtime.cache.keys().next().value
              if (!oldest) break
              const old = runtime.cache.get(oldest)
              if (old?.coverUrl) URL.revokeObjectURL(old.coverUrl)
              runtime.cache.delete(oldest)
            }
            coverUrl = undefined
            setResolved(new Map(runtime.cache))
          } catch {
            // Keep the tag summary and an honest unknown duration when a file cannot hydrate.
            if (runtime.mounted && runtime.generation === generation) runtime.cache.set(item.key, { track: item.track })
          } finally {
            if (coverUrl) URL.revokeObjectURL(coverUrl)
            runtime.queued.delete(item.key)
            runtime.active -= 1
            runtime.pump()
          }
        })()
      }
    }
    runtime.pump = pump
    pump()
    return () => {
      runtime.mounted = false
      runtime.generation += 1
      runtime.desired.clear()
      for (const row of runtime.cache.values()) if (row.coverUrl) URL.revokeObjectURL(row.coverUrl)
      runtime.cache.clear()
    }
  }, [enabled])

  useEffect(() => {
    itemsRef.current = items
    state.current.pump()
  }, [items])

  useEffect(() => {
    if (!enabled) return
    const panel = panelRef.current
    const list = listRef.current
    if (!panel || !list) return
    const runtime = state.current
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.songKey
        if (!key) continue
        if (entry.isIntersecting) runtime.desired.add(key)
        else runtime.desired.delete(key)
      }
      runtime.pump()
    }, { root: panel, rootMargin: '150px 0px' })
    for (const row of list.querySelectorAll<HTMLElement>('[data-song-key]')) observer.observe(row)
    return () => { observer.disconnect(); runtime.desired.clear() }
  }, [items, panelRef, listRef, enabled])

  return resolved
}
