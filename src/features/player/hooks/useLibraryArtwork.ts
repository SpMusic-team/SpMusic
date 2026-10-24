import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import { createPlaylistArtworkStore, playlistArtworkKey } from '@/features/player/model/playlistArtworkStore'
import type { PlaylistArtworkDemand, PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'
import {
  selectArtworkEvictionKey,
  type ReadOnlyArtworkRow,
} from '@/features/player/model/playlistArtworkFallback'
import {
  beginAudioPlaylistCoverWindow, probeAudioPlaylistCover,
  type AudioFolderPlaylist, type AudioFolderTrackRef,
} from '@/features/player/services/audioCommands'
import { schedulePlaylistCoverPixels, scheduleTrackThumbnail } from '@/features/player/services/playlistCoverScheduler'

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
  consumerPins: Map<string, number>
  rows: ReadonlyMap<string, ArtworkRow>
  detail: AudioFolderPlaylist | null
  detailPaths: Map<string, 128 | 256 | 512>
  detailVisiblePaths: Set<string>
  cache: Map<string, CacheEntry>
  pendingReplacements: Map<string, { key: string; previous: CacheEntry; older: CacheEntry[] }>
  failedUpgrades: Set<string>
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
  const [artworkStore] = useState(() => createPlaylistArtworkStore(() => undefined))
  useLayoutEffect(() => { artworkStore.bind((key) => {
    const [, id, path] = JSON.parse(key) as [string, string, string]
    const runtime = runtimeRef.current
    const descriptor = runtime?.descriptors.get(path)
    const entry = runtime?.cache.get(path)
    return descriptor?.id === id && entry?.trackId === id ? entry.row : undefined
  }, (key) => {
    const [, , path] = JSON.parse(key) as [string, string, string]
    const runtime = runtimeRef.current
    if (!runtime?.mounted) return () => {}
    runtime.consumerPins.set(path, (runtime.consumerPins.get(path) ?? 0) + 1)
    return () => {
      const count = runtime.consumerPins.get(path) ?? 0
      if (count <= 1) runtime.consumerPins.delete(path)
      else runtime.consumerPins.set(path, count - 1)
    }
  }) }, [artworkStore])
  const artworkSource = useMemo(() => ({ store: artworkStore,
    keyByTrackId: new Map(sources.flatMap(source => source.tracks.map(item => [item.id,
      playlistArtworkKey(`${source.sourceKind}\u0000${normalizeAudioSourcePath(source.sourcePath)}`, item.id, item.sourcePath)] as const))),
  }), [sources, artworkStore])


  useEffect(() => {
    const runtime: Runtime = {
      mounted: true, visible: false, controller: new AbortController(), revision: 0, descriptors: new Map(), previews: new Map(), desired: new Map(),
      pinned: new Set(), consumerPins: new Map(), rows: EMPTY_ROWS,
      detail: null, detailPaths: new Map(), detailVisiblePaths: new Set(), cache: new Map(), pendingReplacements: new Map(), failedUpgrades: new Set(), queued: new Set(), active: 0,
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
        // The cap applies to optional residents. Dense viewports may need more
        // than 80 live thumbnails; evicting one would leave a visible blank.
        const protectedPaths = new Set([...runtime.detailVisiblePaths, ...runtime.previews.values(), ...runtime.pinned, ...runtime.consumerPins.keys()])
        const candidates = [...runtime.cache.keys()].filter((key) => !protectedPaths.has(key))
        const key = selectArtworkEvictionKey(candidates, desired, runtime.pinned)
        if (key === undefined) break
        const entry = runtime.cache.get(key)
        if (entry?.row.coverThumbnail) URL.revokeObjectURL(entry.row.coverThumbnail.src)
        runtime.cache.delete(key)
        for (const [src, pending] of runtime.pendingReplacements) {
          if (pending.key !== key) continue
          if (pending.previous.row.coverThumbnail) URL.revokeObjectURL(pending.previous.row.coverThumbnail.src)
          for (const older of pending.older) if (older.row.coverThumbnail) URL.revokeObjectURL(older.row.coverThumbnail.src)
          runtime.pendingReplacements.delete(src)
        }
      }
      const nextRows = new Map([...runtime.cache].map(([key, entry]) => [key, entry.row]))
      runtime.rows = nextRows
      artworkStore.notifyAll()
      const persistent = new Set([...runtime.previews.values()])
      const first = runtime.detail?.tracks[0]
      if (first) persistent.add(normalizeAudioSourcePath(first.sourcePath))
      setRows(previous => [...persistent].some(key => previous.get(key) !== nextRows.get(key)) ? nextRows : previous)
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
            let hasLocalArtwork = false
            if (edge <= 256) {
              const pixels = await scheduleTrackThumbnail(
                { clientId, sourcePath: descriptor.sourcePath, maxEdge: 256, windowGeneration: generation },
                { priority: [...runtime.previews.values()].includes(key) ? 0
                  : runtime.detailVisiblePaths.has(key) ? 1 : 2,
                  signal: runtime.controller.signal, isCurrent: current },
              )
              if (!current()) return
              hasLocalArtwork = pixels !== null
              if (pixels) thumbnail = playlistCoverImageFromPixels(pixels)
            } else {
              const cover = await probeAudioPlaylistCover(descriptor.sourcePath)
              if (!current()) return
              if (cover.id !== descriptor.id || normalizeAudioSourcePath(cover.sourcePath) !== key) {
                throw new Error('媒体库封面与歌曲来源不一致')
              }
              hasLocalArtwork = cover.coverArt !== null
              if (cover.coverArt?.filePath) {
                const pixels = await schedulePlaylistCoverPixels(
                  { clientId, filePath: cover.coverArt.filePath, maxEdge: edge, windowGeneration: generation },
                  { priority: 2,
                    signal: runtime.controller.signal, isCurrent: current },
                )
                if (!pixels) return
                if (!current()) return
                thumbnail = playlistCoverImageFromPixels(pixels)
              } else if (cover.coverArt?.dataUrl) {
                thumbnail = await dataUrlThumbnail(cover.coverArt.dataUrl, edge)
              }
            }
            if (thumbnail) {
              await decodePlaylistCover(thumbnail)
              if (!current()) return
            }
            const previous = runtime.cache.get(key)
            runtime.cache.delete(key)
            runtime.cache.set(key, { edge: hasLocalArtwork ? Math.max(edge, 256) : 512, trackId: descriptor.id,
              row: { hasLocalArtwork, coverThumbnail: thumbnail } })
            if (previous?.row.coverThumbnail) {
              if (thumbnail) {
                const older = runtime.pendingReplacements.get(previous.row.coverThumbnail.src)
                runtime.pendingReplacements.delete(previous.row.coverThumbnail.src)
                runtime.pendingReplacements.set(thumbnail.src, {
                  key, previous, older: older ? [older.previous, ...older.older] : [],
                })
              } else URL.revokeObjectURL(previous.row.coverThumbnail.src)
            }
            thumbnail = undefined
            publish()
            // The sidebar and hero share the first source. Publish its 256px
            // thumbnail before admitting the optional 512px hero upgrade.
            runtime.refresh()
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
      const hero = runtime.detail?.tracks[0]
      const heroKey = hero ? normalizeAudioSourcePath(hero.sourcePath) : undefined
      const heroReady = heroKey ? Boolean(runtime.cache.get(heroKey)?.row.coverThumbnail) : false
      const heroUpgradeReady = heroReady && !runtime.failedUpgrades.has(heroKey ?? '') && (runtime.detail?.tracks.length === 1
        || (runtime.detailVisiblePaths.size > 1 && [...runtime.detailVisiblePaths].every((key) =>
          key === heroKey || runtime.cache.has(key))))
      // First load the persisted thumbnail even when the same source also
      // needs a 512px hero. Admit every visible card and sidebar tile before
      // the hero upgrade and offscreen prefetch.
      for (const [key, edge] of runtime.detailPaths) {
        if ((runtime.detailVisiblePaths.has(key) || key === heroKey) && (key !== heroKey || !heroUpgradeReady)) {
          desired.set(key, key === heroKey ? 256 : edge)
        }
      }
      for (const key of runtime.previews.values()) {
        if (runtime.descriptors.get(key)?.available && !desired.has(key) && desired.size < MAX_RESIDENT
          && !(key === heroKey && heroUpgradeReady)) desired.set(key, 256)
      }
      for (const [key, edge] of runtime.detailPaths) {
        if (!desired.has(key)) desired.set(key, edge)
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
    const retireReplacement = (src: string) => {
      const pending = runtime.pendingReplacements.get(src)
      if (!pending) return
      const images = [...document.querySelectorAll<HTMLImageElement>('img')]
      const consumers = images.filter((image) => image.src === src)
      if (consumers.some((image) => !image.complete || image.naturalWidth === 0)) return
      const oldSources = [pending.previous, ...pending.older]
        .map((entry) => entry.row.coverThumbnail?.src).filter((url): url is string => Boolean(url))
      if (images.some((image) => oldSources.includes(image.src))) return
      runtime.pendingReplacements.delete(src)
      for (const oldSource of oldSources) URL.revokeObjectURL(oldSource)
    }
    const onImageLoad = (event: Event) => {
      const src = (event as CustomEvent<unknown>).detail
      if (typeof src === 'string') retireReplacement(src)
    }
    const onImageError = (event: Event) => {
      const src = (event as CustomEvent<unknown>).detail
      if (typeof src !== 'string') return
      const pending = runtime.pendingReplacements.get(src)
      if (!pending || runtime.cache.get(pending.key)?.row.coverThumbnail?.src !== src) return
      runtime.pendingReplacements.delete(src)
      runtime.failedUpgrades.add(pending.key)
      runtime.cache.set(pending.key, pending.previous)
      if (pending.older.length && pending.previous.row.coverThumbnail) {
        runtime.pendingReplacements.set(pending.previous.row.coverThumbnail.src, {
          key: pending.key, previous: pending.older[0]!, older: pending.older.slice(1),
        })
      }
      URL.revokeObjectURL(src)
      publish()
      runtime.refresh()
    }
    const replacementObserver = new MutationObserver(() => {
      for (const src of runtime.pendingReplacements.keys()) retireReplacement(src)
    })
    replacementObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    window.addEventListener('spmusic:playlist-cover-image-load', onImageLoad)
    window.addEventListener('spmusic:playlist-cover-image-error', onImageError)
    return () => {
      runtime.mounted = false
      runtime.controller.abort()
      mutations.disconnect()
      observer.disconnect()
      replacementObserver.disconnect()
      window.removeEventListener('spmusic:playlist-cover-image-load', onImageLoad)
      window.removeEventListener('spmusic:playlist-cover-image-error', onImageError)
      for (const entry of runtime.cache.values()) if (entry.row.coverThumbnail) URL.revokeObjectURL(entry.row.coverThumbnail.src)
      for (const pending of runtime.pendingReplacements.values()) {
        if (pending.previous.row.coverThumbnail) URL.revokeObjectURL(pending.previous.row.coverThumbnail.src)
        for (const older of pending.older) if (older.row.coverThumbnail) URL.revokeObjectURL(older.row.coverThumbnail.src)
      }
      runtime.cache.clear()
      runtime.rows = EMPTY_ROWS
      artworkStore.notifyAll()
      runtime.consumerPins.clear()
      runtime.pendingReplacements.clear()
      runtime.failedUpgrades.clear()
      runtime.previews.clear()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [artworkStore])

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
      runtime.failedUpgrades.delete(key)
      for (const [src, pending] of runtime.pendingReplacements) {
        if (pending.key !== key) continue
        if (pending.previous.row.coverThumbnail) URL.revokeObjectURL(pending.previous.row.coverThumbnail.src)
        for (const older of pending.older) if (older.row.coverThumbnail) URL.revokeObjectURL(older.row.coverThumbnail.src)
        runtime.pendingReplacements.delete(src)
      }
    }
    if (runtime.detail?.sourcePath !== detail?.sourcePath) {
      runtime.detailPaths.clear()
      runtime.detailVisiblePaths.clear()
    }
    runtime.detail = detail
    const detailPaths = new Set(detail?.tracks.map((descriptor) => normalizeAudioSourcePath(descriptor.sourcePath)))
    for (const key of runtime.detailPaths.keys()) if (!detailPaths.has(key)) runtime.detailPaths.delete(key)
    for (const key of runtime.detailVisiblePaths) if (!detailPaths.has(key)) runtime.detailVisiblePaths.delete(key)
    // Keep the first row's hero available while the table is still loading.
    const first = detail?.tracks[0]
    if (first?.available && first.id !== warmTrackId) runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), 512)
    runtime.refresh()
    runtime.rows = new Map([...runtime.cache].map(([key, entry]) => [key, entry.row]))
    artworkStore.notifyAll()
    setRows(runtime.rows)
  }, [sources, detail, warmTrackId, artworkStore])

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
    runtime.detailVisiblePaths = new Set()
    runtime.refresh()
  }, [detail, warmTrackId])

  const setVisibleTrackIds = useCallback((scopePath: string, trackIds: readonly string[], keepPersistentArtwork = false, showArtwork = true, demand?: PlaylistArtworkDemand) => {
    const runtime = runtimeRef.current
    const playlist = runtime?.detail
    if (!runtime || !playlist || playlist.sourcePath !== scopePath) return
    const paths = new Map<string, 128 | 256 | 512>()
    const visiblePaths = new Set<string>()
    const first = keepPersistentArtwork ? playlist.tracks[0] : undefined
    if (first?.available) {
      const key = normalizeAudioSourcePath(first.sourcePath)
      paths.set(key, 512)
      visiblePaths.add(key)
    }
    if (showArtwork) {
      const descriptors = new Map(playlist.tracks.map((descriptor) => [descriptor.id, descriptor]))
      const visibleIds = demand?.visibleIds ?? trackIds
      for (const id of visibleIds) {
        const descriptor = descriptors.get(id)
        if (descriptor?.available) {
          const key = normalizeAudioSourcePath(descriptor.sourcePath)
          // Detail cards share the persisted 256px thumbnail lane with All
          // Songs. The pinned first-track hero keeps its 512px request.
          paths.set(key, paths.get(key) ?? 256)
          visiblePaths.add(key)
        }
      }
      let prefetchCount = 0
      for (const id of trackIds) {
        if (prefetchCount >= MAX_DETAIL) break
        const descriptor = descriptors.get(id)
        if (!descriptor?.available) continue
        const key = normalizeAudioSourcePath(descriptor.sourcePath)
        if (paths.has(key)) continue
        paths.set(key, 256)
        prefetchCount += 1
      }
    }
    runtime.detailPaths = paths
    runtime.detailVisiblePaths = visiblePaths
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

  return { get rows() { return runtimeRef.current?.rows ?? rows }, artworkSource, setVisibleTrackIds, retainSourcePaths }
}
