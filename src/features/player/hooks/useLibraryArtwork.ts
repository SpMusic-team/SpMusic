import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import type { PlaylistArtworkDemand, PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'
import {
  selectArtworkEvictionKey,
  type ReadOnlyArtworkRow,
} from '@/features/player/model/playlistArtworkFallback'
import {
  beginAudioPlaylistCoverWindow, probeAudioPlaylistCover,
  type AudioFolderPlaylist, type AudioFolderTrackRef,
} from '@/features/player/services/audioCommands'
import { schedulePlaylistCoverPixels } from '@/features/player/services/playlistCoverScheduler'

type ArtworkRow = ReadOnlyArtworkRow
type CacheEntry = { row: ArtworkRow; edge: number; trackId: string }
type Runtime = {
  mounted: boolean
  visible: boolean
  controller: AbortController
  revision: number
  descriptors: Map<string, AudioFolderTrackRef>
  previews: Map<Element, string>
  desired: Map<string, 128 | 256 | 512>
  pinned: Set<string>
  detail: AudioFolderPlaylist | null
  detailPaths: Map<string, 128 | 256 | 512>
  cache: Map<string, CacheEntry>
  queued: Set<string>
  active: number
  pump: () => void
  refresh: () => void
}

const EMPTY_ROWS: ReadonlyMap<string, ArtworkRow> = new Map()
const MAX_RESIDENT = 80
const MAX_DETAIL = 40
const CONCURRENCY = 2

async function dataUrlThumbnail(dataUrl: string, maxEdge: number): Promise<PlaylistCoverImage> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const canvas = document.createElement('canvas')
  try {
    if (!bitmap.width || !bitmap.height || Math.max(bitmap.width, bitmap.height) > 16_384) throw new Error('封面尺寸不受支持')
    const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建封面缩略图')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return playlistCoverImageFromPixels({ width: canvas.width, height: canvas.height, stride: canvas.width * 4,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data })
  } finally {
    bitmap.close()
    canvas.width = 0
    canvas.height = 0
  }
}

// The library owns only cover I/O. Its independent client/window never changes
// the active player's descriptors, metadata, artwork leases or playback queue.
export function useLibraryArtwork(sources: readonly AudioFolderPlaylist[], detail: AudioFolderPlaylist | null, visible: boolean, warmTrackId?: string) {
  const runtimeRef = useRef<Runtime | null>(null)
  const [rows, setRows] = useState<ReadonlyMap<string, ArtworkRow>>(EMPTY_ROWS)

  useEffect(() => {
    const runtime: Runtime = {
      mounted: true, visible: false, controller: new AbortController(), revision: 0, descriptors: new Map(), previews: new Map(), desired: new Map(),
      pinned: new Set(),
      detail: null, detailPaths: new Map(), cache: new Map(), queued: new Set(), active: 0,
      pump: () => {}, refresh: () => {},
    }
    runtimeRef.current = runtime
    const clientId = `library-artwork-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const ready = beginAudioPlaylistCoverWindow(clientId).catch((error: unknown) => {
      console.warn('无法创建媒体库封面窗口', error)
      return null
    })
    const publish = () => {
      const desired = new Set(runtime.desired.keys())
      while (runtime.cache.size > MAX_RESIDENT) {
        // Covers that are still on screen through a fallback layer are pinned by
        // their consumer and are not eviction candidates; when every other entry
        // is demanded, the bounded cache still drops its oldest resident.
        const key = selectArtworkEvictionKey([...runtime.cache.keys()], desired, runtime.pinned)
        if (key === undefined) break
        const entry = runtime.cache.get(key)
        if (entry?.row.coverThumbnail) URL.revokeObjectURL(entry.row.coverThumbnail.src)
        runtime.cache.delete(key)
      }
      setRows(new Map([...runtime.cache].map(([key, entry]) => [key, entry.row])))
    }
    runtime.pump = () => {
      if (!runtime.mounted || !runtime.visible) return
      while (runtime.active < CONCURRENCY) {
        const next = [...runtime.desired].find(([key, edge]) => {
          const descriptor = runtime.descriptors.get(key)
          const entry = runtime.cache.get(key)
          return descriptor?.available && !runtime.queued.has(key) && (!entry || entry.edge < edge)
        })
        if (!next) break
        const [key, edge] = next
        const descriptor = runtime.descriptors.get(key)!
        const revision = runtime.revision
        const current = () => runtime.mounted && runtime.visible && runtime.revision === revision && runtime.desired.has(key)
        runtime.queued.add(key)
        runtime.active += 1
        void (async () => {
          let thumbnail: PlaylistCoverImage | undefined
          try {
            const generation = await ready
            if (!current()) return
            if (generation === null) throw new Error('媒体库封面窗口不可用')
            const cover = await probeAudioPlaylistCover(descriptor.sourcePath)
            if (!current()) return
            if (cover.id !== descriptor.id || normalizeAudioSourcePath(cover.sourcePath) !== key) {
              throw new Error('媒体库封面与歌曲来源不一致')
            }
            if (cover.coverArt?.filePath) {
              const pixels = await schedulePlaylistCoverPixels(
                { clientId, filePath: cover.coverArt.filePath, maxEdge: edge, windowGeneration: generation },
                { priority: runtime.detail?.tracks[0]?.sourcePath === descriptor.sourcePath ? 0 : 1,
                  signal: runtime.controller.signal, isCurrent: current },
              )
              if (!pixels) return
              if (!current()) return
              thumbnail = playlistCoverImageFromPixels(pixels)
            } else if (cover.coverArt?.dataUrl) {
              thumbnail = await dataUrlThumbnail(cover.coverArt.dataUrl, edge)
            }
            if (thumbnail) {
              await decodePlaylistCover(thumbnail)
              if (!current()) return
            }
            const previous = runtime.cache.get(key)
            runtime.cache.delete(key)
            runtime.cache.set(key, { edge: cover.coverArt ? edge : 512, trackId: descriptor.id,
              row: { hasLocalArtwork: Boolean(cover.coverArt), coverThumbnail: thumbnail } })
            if (previous?.row.coverThumbnail) URL.revokeObjectURL(previous.row.coverThumbnail.src)
            thumbnail = undefined
            publish()
          } catch (error) {
            if (current()) {
              // Settle this descriptor/window without claiming absent artwork
              // when a real I/O or protocol error prevented the read.
              console.warn('读取媒体库封面失败', { sourcePath: descriptor.sourcePath, error })
              const previous = runtime.cache.get(key)
              runtime.cache.set(key, { edge: 512, trackId: descriptor.id, row: previous?.row ?? {} })
              publish()
            }
          } finally {
            if (thumbnail) URL.revokeObjectURL(thumbnail.src)
            runtime.queued.delete(key)
            runtime.active -= 1
            runtime.pump()
          }
        })()
      }
    }
    runtime.refresh = () => {
      const desired = new Map<string, 128 | 256 | 512>()
      // Detail hero and on-screen rows have priority over list previews.
      for (const [key, edge] of runtime.detailPaths) desired.set(key, edge)
      for (const key of runtime.previews.values()) {
        if (runtime.descriptors.get(key)?.available && !desired.has(key) && desired.size < MAX_RESIDENT) desired.set(key, 256)
      }
      runtime.desired = runtime.visible ? desired : new Map()
      runtime.pump()
    }
    const observed = new Set<Element>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const path = entry.target.getAttribute('data-library-cover-source')
        if (entry.isIntersecting && path) runtime.previews.set(entry.target, normalizeAudioSourcePath(path))
        else runtime.previews.delete(entry.target)
      }
      runtime.refresh()
    }, { rootMargin: '150px 0px' })
    const observe = (element: Element) => {
      if (observed.has(element)) return
      observed.add(element)
      observer.observe(element)
    }
    const observeTree = (element: Element) => {
      if (element.matches('[data-library-cover-source]')) observe(element)
      for (const child of element.querySelectorAll('[data-library-cover-source]')) observe(child)
    }
    observeTree(document.documentElement)
    const mutations = new MutationObserver((records) => {
      let removed = false
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          runtime.previews.delete(record.target)
          observer.unobserve(record.target)
          observed.delete(record.target)
          observeTree(record.target)
          removed = true
        }
        for (const node of record.addedNodes) if (node instanceof Element) observeTree(node)
        if (record.removedNodes.length) removed = true
      }
      if (removed) {
        for (const element of observed) {
          if (element.isConnected) continue
          observer.unobserve(element)
          observed.delete(element)
          runtime.previews.delete(element)
        }
        runtime.refresh()
      }
    })
    mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-library-cover-source'] })
    return () => {
      runtime.mounted = false
      runtime.controller.abort()
      mutations.disconnect()
      observer.disconnect()
      for (const entry of runtime.cache.values()) if (entry.row.coverThumbnail) URL.revokeObjectURL(entry.row.coverThumbnail.src)
      runtime.cache.clear()
      runtime.previews.clear()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || runtime.visible === visible) return
    runtime.visible = visible
    runtime.revision += 1
    if (!visible) runtime.controller.abort()
    else runtime.controller = new AbortController()
    runtime.refresh()
  }, [visible])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.revision += 1
    runtime.descriptors = new Map()
    for (const source of sources) for (const descriptor of source.tracks) {
      const key = normalizeAudioSourcePath(descriptor.sourcePath)
      if (!runtime.descriptors.get(key)?.available) runtime.descriptors.set(key, descriptor)
    }
    for (const [key, entry] of runtime.cache) {
      const descriptor = runtime.descriptors.get(key)
      if (descriptor?.available && descriptor.id === entry.trackId) continue
      if (entry.row.coverThumbnail) URL.revokeObjectURL(entry.row.coverThumbnail.src)
      runtime.cache.delete(key)
    }
    if (runtime.detail?.sourcePath !== detail?.sourcePath) runtime.detailPaths.clear()
    runtime.detail = detail
    const detailPaths = new Set(detail?.tracks.map((descriptor) => normalizeAudioSourcePath(descriptor.sourcePath)))
    for (const key of runtime.detailPaths.keys()) if (!detailPaths.has(key)) runtime.detailPaths.delete(key)
    // Keep the first row's hero available while the table is still loading.
    const first = detail?.tracks[0]
    if (first?.available && first.id !== warmTrackId) runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), 512)
    runtime.refresh()
    setRows(new Map([...runtime.cache].map(([key, entry]) => [key, entry.row])))
  }, [sources, detail, warmTrackId])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !detail || !warmTrackId) return
    const available = detail.tracks.filter((descriptor) => descriptor.available)
    const currentIndex = available.findIndex((descriptor) => descriptor.id === warmTrackId)
    const paths = new Map<string, 128 | 256 | 512>()
    const first = available[0]
    if (first && first.id !== warmTrackId) paths.set(normalizeAudioSourcePath(first.sourcePath), 512)
    for (let distance = 1; distance <= MAX_DETAIL && paths.size < MAX_DETAIL; distance += 1) {
      for (const descriptor of [available[currentIndex + distance], available[currentIndex - distance]]) {
        if (descriptor && descriptor.id !== warmTrackId) paths.set(normalizeAudioSourcePath(descriptor.sourcePath), 256)
      }
    }
    runtime.detailPaths = paths
    runtime.refresh()
  }, [detail, warmTrackId])

  const setVisibleTrackIds = useCallback((scopePath: string, trackIds: readonly string[], keepPersistentArtwork = false, showArtwork = true, demand?: PlaylistArtworkDemand) => {
    const runtime = runtimeRef.current
    const playlist = runtime?.detail
    if (!runtime || !playlist || playlist.sourcePath !== scopePath) return
    const paths = new Map<string, 128 | 256 | 512>()
    const first = keepPersistentArtwork ? playlist.tracks[0] : undefined
    if (first?.available) paths.set(normalizeAudioSourcePath(first.sourcePath), 512)
    if (showArtwork) {
      const pixels = (demand?.coverCssPixels ?? 128) * (demand?.dpr ?? 1)
      const edge = pixels <= 128 ? 128 : pixels <= 256 ? 256 : 512
      const descriptors = new Map(playlist.tracks.map((descriptor) => [descriptor.id, descriptor]))
      for (const id of trackIds.slice(0, MAX_DETAIL)) {
        const descriptor = descriptors.get(id)
        if (descriptor?.available) {
          const key = normalizeAudioSourcePath(descriptor.sourcePath)
          paths.set(key, Math.max(paths.get(key) ?? 0, edge) as 128 | 256 | 512)
        }
      }
    }
    runtime.detailPaths = paths
    runtime.refresh()
  }, [])

  // The player can show cached library thumbnails for the active scope while its
  // own visual lane rehydrates. Those object URLs belong to this cache, so the
  // caller reports the paths it is still displaying to keep them resident.
  const retainSourcePaths = useCallback((sourcePaths: readonly string[]) => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.pinned = new Set(sourcePaths)
  }, [])

  return { rows, setVisibleTrackIds, retainSourcePaths }
}
