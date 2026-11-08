import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { normalizeAudioSourcePath } from '@/features/player/model/playlistTrackSummary'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import {
  coverImageEventDetail,
  createCoverPresentation,
  createCoverRecoveryLedger,
  decodePlaylistCover,
  isCurrentCoverReport,
  isPlaylistCoverDecoded,
  nextCoverSessionGeneration,
  releasePlaylistCoverUrl,
  type CoverRecoveryLedger,
} from '@/features/player/model/playlistCoverReadiness'
import { createPlaylistArtworkStore, playlistArtworkKey } from '@/features/player/model/playlistArtworkStore'
import { admitLibraryArtwork } from '@/features/player/model/libraryArtworkAdmission'
import { playlistArtworkRevision } from '@/features/player/model/playlistArtworkRevision'
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
import {
  attemptPlaylistCoverThumbnailPath,
  attemptTrackThumbnailPath,
  type AttemptOptions,
} from '@/features/player/services/playlistCoverPathLane'

type ArtworkRow = ReadOnlyArtworkRow
type CacheEntry = { row: ArtworkRow; edge: number; trackId: string; artworkRevision: number }
type Runtime = {
  mounted: boolean
  visible: boolean
  controller: AbortController
  revision: number
  /** Owner lifetime id. A report is only accepted for the owner that published it. */
  sessionGeneration: number
  descriptors: Map<string, AudioFolderTrackRef & { artworkRevision: number }>
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
  /**
   * Recovery bookkeeping, shared with the other two cover owners.
   *
   * `queued` is the single automatic pixel recovery for a key/epoch/edge. It is
   * claimed synchronously by the first qualifying DOM failure and spent only when
   * the forced job is admitted. A record that stays present is what keeps the
   * opportunity gone: a later DOM load does not restore it, and the forced job's
   * own failure settles the epoch instead of queueing another.
   */
  recovery: CoverRecoveryLedger
  /** Publish sequence per key; every actual commit replaces the generation. */
  publishSequences: Map<string, number>
  /**
   * Edge the epoch's forced job must use.
   *
   * The recovery has to re-read at the *failing* edge: a 512 hero that failed in
   * the DOM must not be recovered with a 256 list thumbnail, and a 256 row must
   * not pay for a 512 read.
   */
  recoveryEdge: Map<string, 128 | 256 | 512>
  /**
   * Rows whose single automatic recovery already ended without an image.
   *
   * Without this the pump would immediately re-admit a settled row through the
   * *normal* lane, which starts with the path helper and would therefore loop
   * path → pixels → path for as long as the row stays visible. The value is the
   * identity the verdict describes, so a revision change re-admits naturally, and
   * a row that leaves demand drops the verdict with the rest of its state.
   */
  transientFailures: Map<string, string>
  queued: Set<string>
  active: number
  pump: () => void
  refresh: () => void
}

const EMPTY_ROWS: ReadonlyMap<string, ArtworkRow> = new Map()
const MAX_RESIDENT = 80
const MAX_DETAIL = 40
const CONCURRENCY = 2

/**
 * Full source identity for one library artwork row.
 *
 * The artwork revision belongs in it: a rescan replaces the image behind the same
 * `sourcePath`, so a revision-less identity would let an element still painting
 * the pre-rescan cover report against the new publication.
 */
function artworkIdentity(key: string, descriptor: AudioFolderTrackRef & { artworkRevision: number }): string {
  return JSON.stringify(['library', key, descriptor.id, descriptor.artworkRevision])
}

function protectedArtworkPaths(runtime: Runtime): Set<string> {
  const paths = new Set([...runtime.detailVisiblePaths, ...runtime.pinned, ...runtime.consumerPins.keys()])
  for (const key of runtime.previews.values()) if (runtime.descriptors.get(key)?.available) paths.add(key)
  const hero = runtime.detail?.tracks[0]
  if (hero?.available) {
    const key = normalizeAudioSourcePath(hero.sourcePath)
    if (runtime.detailPaths.has(key)) paths.add(key)
  }
  return paths
}

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
    const previous = runtime.consumerPins.get(path) ?? 0
    runtime.consumerPins.set(path, previous + 1)
    if (previous === 0) runtime.refresh()
    return () => {
      const count = runtime.consumerPins.get(path) ?? 0
      if (count > 1) runtime.consumerPins.set(path, count - 1)
      else if (runtime.consumerPins.delete(path) && runtime.mounted) runtime.refresh()
    }
  }) }, [artworkStore])
  const artworkSource = useMemo(() => ({ store: artworkStore,
    keyByTrackId: new Map(sources.flatMap(source => source.tracks.map(item => [item.id,
      playlistArtworkKey(`${source.sourceKind}\u0000${normalizeAudioSourcePath(source.sourcePath)}`, item.id, item.sourcePath)] as const))),
  }), [sources, artworkStore])


  useEffect(() => {
    const runtime: Runtime = {
      mounted: true, visible: false, controller: new AbortController(), revision: 0, sessionGeneration: nextCoverSessionGeneration(),
      descriptors: new Map(), previews: new Map(), desired: new Map(),
      pinned: new Set(), consumerPins: new Map(), rows: EMPTY_ROWS,
      detail: null, detailPaths: new Map(), detailVisiblePaths: new Set(), cache: new Map(), pendingReplacements: new Map(), failedUpgrades: new Set(),
      recovery: createCoverRecoveryLedger(), recoveryEdge: new Map(), transientFailures: new Map(), publishSequences: new Map(), queued: new Set(), active: 0,
      pump: () => {}, refresh: () => {},
    }
    runtimeRef.current = runtime
    const clientId = `library-artwork-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const ready = beginAudioPlaylistCoverWindow(clientId).catch((error: unknown) => {
      console.warn('无法创建媒体库封面窗口', error)
      return null
    })
    const trimCache = () => {
      const desired = new Set(runtime.desired.keys())
      const protectedPaths = protectedArtworkPaths(runtime)
      let changed = false
      while (runtime.cache.size > MAX_RESIDENT) {
        // The cap applies to optional residents. Dense viewports may need more
        // than 80 live thumbnails; evicting one would leave a visible blank.
        const candidates = [...runtime.cache.keys()].filter((key) => !protectedPaths.has(key))
        const key = selectArtworkEvictionKey(candidates, desired, runtime.pinned)
        if (key === undefined) break
        const entry = runtime.cache.get(key)
        if (entry?.row.coverThumbnail) releasePlaylistCoverUrl(entry.row.coverThumbnail.src)
        runtime.cache.delete(key)
        changed = true
        for (const [src, pending] of runtime.pendingReplacements) {
          if (pending.key !== key) continue
          if (pending.previous.row.coverThumbnail) releasePlaylistCoverUrl(pending.previous.row.coverThumbnail.src)
          for (const older of pending.older) if (older.row.coverThumbnail) releasePlaylistCoverUrl(older.row.coverThumbnail.src)
          runtime.pendingReplacements.delete(src)
        }
      }
      // A row that is no longer wanted and holds no image is only a placeholder. It
      // must not stay resident with the edge of a failed read, because that edge is
      // exactly what the admission predicate compares against: keeping it would make
      // a returning row look already-satisfied and it would never be read again.
      for (const [key, entry] of runtime.cache) {
        if (runtime.desired.has(key) || entry.row.coverThumbnail) continue
        runtime.cache.delete(key)
        changed = true
      }
      // The recovery record is per key and must not outlive its row: a record for a
      // key that is no longer resident or desired would suppress a future
      // legitimate read, which is exactly the permanent blacklist this mechanism
      // must not become. In-flight records are kept by `prune` on purpose.
      runtime.recovery.prune((key) => runtime.cache.has(key) || desired.has(key))
      for (const key of [...runtime.recoveryEdge.keys()]) {
        if (!runtime.cache.has(key) && !desired.has(key)) runtime.recoveryEdge.delete(key)
      }
      // Leaving demand is the documented retry trigger, so a row that is no longer
      // wanted loses both its transient verdict and its spent epoch. Keeping either
      // would turn "not on screen right now" into a permanent blacklist, and a row
      // that never re-enters is dropped by the owner's lifetime anyway.
      for (const key of [...runtime.transientFailures.keys()]) {
        if (!desired.has(key)) runtime.transientFailures.delete(key)
      }
      for (const key of [...runtime.publishSequences.keys()]) {
        if (!desired.has(key) && !runtime.cache.has(key)) runtime.publishSequences.delete(key)
      }
      for (const record of [...runtime.recovery.entries()]) {
        if (desired.has(record.key)) continue
        // An in-flight job is settled by its own finally block; what must not
        // survive is the *opportunity* record, which would suppress the next visit.
        runtime.recovery.forget(record.key)
      }
      for (const key of [...runtime.failedUpgrades]) {
        if (!runtime.cache.has(key) && !desired.has(key)) runtime.failedUpgrades.delete(key)
      }
      return changed
    }
    const publish = () => {
      trimCache()
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
          if (!descriptor?.available || runtime.queued.has(key)) return false
          // A queued recovery bypasses the cache-hit short circuit: the entry it
          // just discarded is exactly why plain admission would skip this key.
          const record = runtime.recovery.get(key)
          if (record?.phase === 'queued' && !record.attempted) return true
          // A spent epoch settles as a transient failure. Re-admitting it through
          // the normal lane would start with the path helper again, which is the
          // URL the DOM just rejected — that is the path↔pixels loop this guard
          // exists to prevent.
          if (runtime.transientFailures.get(key) === artworkIdentity(key, descriptor)) return false
          return !entry || entry.edge < edge
            || entry.artworkRevision !== descriptor.artworkRevision && !runtime.failedUpgrades.has(key)
        })
        if (!next) break
        const [key, edge] = next
        const descriptor = runtime.descriptors.get(key)!
        const revision = runtime.revision
        const current = () => runtime.mounted && runtime.visible && runtime.revision === revision && runtime.desired.has(key)
        const record = runtime.recovery.get(key)
        // A queued recovery is admitted only through `begin`, which is the single
        // place the opportunity is spent. A job that is cancelled before admission
        // therefore leaves the epoch unspent.
        const forcePixels = record?.phase === 'queued' && runtime.recovery.begin(key)
        // The forced read has to happen at the edge that failed, never at whatever
        // edge the view currently prefers: a 512 hero failure must not be answered
        // with a 256 list thumbnail, and a list row must not pay for a 512 read.
        const forceEdge = forcePixels ? runtime.recoveryEdge.get(key) : undefined
        runtime.queued.add(key)
        runtime.active += 1
        void (async () => {
          let thumbnail: PlaylistCoverImage | undefined
          try {
            const generation = await ready
            if (!current()) return
            if (generation === null) throw new Error('媒体库封面窗口不可用')
            let hasLocalArtwork = false
            // The edge this job reads at. Forced recovery reads the failing edge.
            const readEdge: 128 | 256 | 512 = forcePixels ? (forceEdge ?? edge) : edge
            if (readEdge <= 256) {
              // Asset path lane first; the pixel lane below is entered only after a
              // real failure. `missing` from the path lane is a confirmed-absent
              // verdict and is published as a placeholder, never as a reason to
              // spend a second decode on the same absence.
              const priority = [...runtime.previews.values()].includes(key) ? 0
                : runtime.detailVisiblePaths.has(key) ? 1 : 2
              // `current` is the positive predicate: it is `true` while this
              // descriptor/window may still publish.
              const attemptOptions: AttemptOptions = { priority, signal: runtime.controller.signal, isCurrent: current }
              if (forcePixels) {
                // Recovery for a first publish that failed in the DOM: the path lane
                // produced exactly the URL the element could not display, so it is
                // not attempted again — the pixel command is the only channel left.
                const pixels = await scheduleTrackThumbnail(
                  { clientId, sourcePath: descriptor.sourcePath, maxEdge: 256, windowGeneration: generation },
                  attemptOptions,
                )
                if (!current()) return
                hasLocalArtwork = pixels !== null
                if (pixels) thumbnail = playlistCoverImageFromPixels(pixels)
              } else {
                const attempt = await attemptTrackThumbnailPath(
                  { clientId, sourcePath: descriptor.sourcePath, maxEdge: 256, windowGeneration: generation },
                  attemptOptions,
                )
                if (attempt.status === 'dropped') return
                if (!current()) return
                if (attempt.status === 'missing') {
                  // Confirmed absent artwork: settle this descriptor as "no artwork"
                  // and stop. The pixel lane would decode once more only to learn the
                  // same thing.
                  hasLocalArtwork = false
                } else if (attempt.status === 'ready') {
                  thumbnail = attempt.image
                  hasLocalArtwork = true
                } else {
                  const pixels = await scheduleTrackThumbnail(
                    { clientId, sourcePath: descriptor.sourcePath, maxEdge: 256, windowGeneration: generation },
                    attemptOptions,
                  )
                  if (!current()) return
                  hasLocalArtwork = pixels !== null
                  if (pixels) thumbnail = playlistCoverImageFromPixels(pixels)
                }
              }
            } else {
              const cover = await probeAudioPlaylistCover(descriptor.sourcePath)
              if (!current()) return
              if (cover.id !== descriptor.id || normalizeAudioSourcePath(cover.sourcePath) !== key) {
                throw new Error('媒体库封面与歌曲来源不一致')
              }
              hasLocalArtwork = cover.coverArt !== null
              if (cover.coverArt?.filePath) {
                const attemptOptions: AttemptOptions = { priority: 2, signal: runtime.controller.signal, isCurrent: current }
                if (forcePixels) {
                  // Forced recovery for the 512 hero. The probe still supplies the
                  // validated cover-file identity (id + normalized source already
                  // checked above), because the pixel command needs the file path.
                  // What is skipped is `thumbnail_path`: it produced exactly the URL
                  // the element could not display.
                  const pixels = await schedulePlaylistCoverPixels(
                    { clientId, filePath: cover.coverArt.filePath, maxEdge: readEdge, windowGeneration: generation },
                    attemptOptions,
                  )
                  if (!current()) return
                  hasLocalArtwork = pixels !== null
                  if (pixels) thumbnail = playlistCoverImageFromPixels(pixels)
                } else {
                  // The 512 hero shares the path lane with the list rows. `missing`
                  // is definitive (no fallback, like the 256 branch); a real failure
                  // falls back to the existing pixel command unchanged.
                  const attempt = await attemptPlaylistCoverThumbnailPath(
                    { clientId, filePath: cover.coverArt.filePath, maxEdge: readEdge, windowGeneration: generation },
                    attemptOptions,
                  )
                  if (attempt.status === 'dropped') return
                  if (!current()) return
                  if (attempt.status === 'missing') {
                    // Confirmed absent: settle nothing, exactly as an empty pixel
                    // response did before this lane existed.
                    return
                  }
                  if (attempt.status === 'ready') {
                    thumbnail = attempt.image
                  } else {
                    const pixels = await schedulePlaylistCoverPixels(
                      { clientId, filePath: cover.coverArt.filePath, maxEdge: readEdge, windowGeneration: generation },
                      attemptOptions,
                    )
                    if (!pixels) return
                    if (!current()) return
                    thumbnail = playlistCoverImageFromPixels(pixels)
                  }
                }
              } else if (cover.coverArt?.dataUrl) {
                thumbnail = await dataUrlThumbnail(cover.coverArt.dataUrl, readEdge)
              }
            }
            if (thumbnail) {
              // A path-lane image is already predecoded; repeating the decode would
              // only spend a second protocol request on the same URL.
              if (!isPlaylistCoverDecoded(thumbnail)) await decodePlaylistCover(thumbnail)
              if (!current()) return
            }
            const previous = runtime.cache.get(key)
            runtime.cache.delete(key)
            // The published row carries the token of exactly the image it shows, so
            // a consumer's report can be attributed to this publication instead of
            // being matched by URL across owners.
            const presentation = thumbnail ? createCoverPresentation({
              key,
              identity: artworkIdentity(key, descriptor),
              sessionGeneration: runtime.sessionGeneration,
              publishGeneration: (runtime.publishSequences.get(key) ?? 0) + 1,
              src: thumbnail.src,
              image: thumbnail,
            }) : undefined
            if (presentation) runtime.publishSequences.set(key, presentation.token.publishGeneration)
            runtime.cache.set(key, { edge: hasLocalArtwork ? Math.max(readEdge, 256) : 512, trackId: descriptor.id, artworkRevision: descriptor.artworkRevision,
              row: { hasLocalArtwork, coverThumbnail: thumbnail, ...(presentation ? { presentation } : {}) } })
            if (previous?.row.coverThumbnail) {
              if (thumbnail) {
                const older = runtime.pendingReplacements.get(previous.row.coverThumbnail.src)
                runtime.pendingReplacements.delete(previous.row.coverThumbnail.src)
                runtime.pendingReplacements.set(thumbnail.src, {
                  key, previous, older: older ? [older.previous, ...older.older] : [],
                })
              } else releasePlaylistCoverUrl(previous.row.coverThumbnail.src)
            }
            thumbnail = undefined
            // A forced recovery now waits for the DOM verdict on its replacement.
            // The epoch is spent either way; only its phase changes.
            if (forcePixels) runtime.recovery.published(key)
            publish()
            // The sidebar and hero share the first source. Publish its 256px
            // thumbnail before admitting the optional 512px hero upgrade.
            runtime.refresh()
          } catch (error) {
            if (current()) {
              // Settle this descriptor/window without claiming absent artwork
              // when a real I/O or protocol error prevented the read.
              console.warn('读取媒体库封面失败', { sourcePath: descriptor.sourcePath, error })
              // A forced recovery that fails terminates its epoch. It must not fall
              // back to the path lane (that is the URL the DOM just rejected) and it
              // must not queue another job while the row stays visible.
              if (forcePixels) runtime.recovery.settle(key)
              const previous = runtime.cache.get(key)
              runtime.cache.set(key, { edge: 512, trackId: descriptor.id, artworkRevision: descriptor.artworkRevision, row: previous?.row ?? {} })
              publish()
            } else if (forcePixels) {
              runtime.recovery.settle(key)
            }
          } finally {
            if (thumbnail) releasePlaylistCoverUrl(thumbnail.src)
            runtime.queued.delete(key)
            runtime.active -= 1
            runtime.pump()
          }
        })()
      }
    }
    runtime.refresh = () => {
      const required = new Map<string, 128 | 256 | 512>()
      const hero = runtime.detail?.tracks[0]
      const heroKey = hero ? normalizeAudioSourcePath(hero.sourcePath) : undefined
      const heroReady = heroKey ? Boolean(runtime.cache.get(heroKey)?.row.coverThumbnail)
        && runtime.cache.get(heroKey)?.artworkRevision === runtime.descriptors.get(heroKey)?.artworkRevision : false
      const heroUpgradeReady = heroReady && !runtime.failedUpgrades.has(heroKey ?? '') && (runtime.detail?.tracks.length === 1
        || (runtime.detailVisiblePaths.size > 1 && [...runtime.detailVisiblePaths].every((key) =>
          key === heroKey || runtime.cache.has(key))))
      // First load the persisted thumbnail even when the same source also
      // needs a 512px hero. Admit every visible card and sidebar tile before
      // the hero upgrade and offscreen prefetch.
      for (const [key, edge] of runtime.detailPaths) {
        if ((runtime.detailVisiblePaths.has(key) || key === heroKey) && (key !== heroKey || !heroUpgradeReady)) {
          required.set(key, key === heroKey ? 256 : edge)
        }
      }
      for (const key of runtime.previews.values()) {
        if (runtime.descriptors.get(key)?.available && !required.has(key)
          && !(key === heroKey && heroUpgradeReady)) required.set(key, 256)
      }
      if (heroKey && heroUpgradeReady && runtime.detailPaths.has(heroKey)) {
        required.set(heroKey, runtime.detailPaths.get(heroKey)!)
      }
      // Required viewport/preview images may exceed the nominal resident cap.
      // Only spare capacity admits prefetch; otherwise the cache would evict
      // a still-desired optional image and immediately read it again forever.
      runtime.desired = runtime.visible
        ? admitLibraryArtwork(required, runtime.detailPaths, protectedArtworkPaths(runtime), MAX_RESIDENT, MAX_DETAIL)
        : new Map()
      if (trimCache()) publish()
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
      for (const oldSource of oldSources) releasePlaylistCoverUrl(oldSource)
    }
    const onImageLoad = (event: Event) => {
      const detail = coverImageEventDetail(event)
      if (!detail || typeof detail.url !== 'string') return
      // A token-bearing report confirms one publication of this owner; record it
      // on the epoch so the opportunity stays spent, but never forget the epoch: a
      // DOM load is evidence about this moment, not a guarantee that the managed
      // file remains readable after the shared cache evicts it.
      const token = detail.token
      if (token && token.sessionGeneration === runtime.sessionGeneration) {
        const entry = runtime.cache.get(token.key)
        if (entry?.row.presentation?.token.publishGeneration === token.publishGeneration) {
          runtime.recovery.loaded(token.key)
        }
      }
      retireReplacement(detail.url)
    }
    const onImageError = (event: Event) => {
      const detail = coverImageEventDetail(event)
      if (!detail || typeof detail.url !== 'string') return
      const { url: src, token } = detail
      const pending = runtime.pendingReplacements.get(src)
      if (pending) {
        const current = runtime.cache.get(pending.key)
        if (current?.row.coverThumbnail?.src !== src) return
        const descriptor = runtime.descriptors.get(pending.key)
        // An upgrade restore is a real state change too, so a token-bearing report
        // must name the publication it is actually about. A stale element finishing
        // late must not roll a newer, healthy replacement back to an older image.
        if (token && descriptor && !isCurrentCoverReport({
          presentation: current.row.presentation,
          identity: artworkIdentity(pending.key, descriptor),
          sessionGeneration: runtime.sessionGeneration,
        }, { token, actualUrl: detail.actualUrl, outcome: 'failed' })) return
        runtime.pendingReplacements.delete(src)
        runtime.failedUpgrades.add(pending.key)
        runtime.cache.set(pending.key, pending.previous)
        if (pending.older.length && pending.previous.row.coverThumbnail) {
          runtime.pendingReplacements.set(pending.previous.row.coverThumbnail.src, {
            key: pending.key, previous: pending.older[0]!, older: pending.older.slice(1),
          })
        }
        releasePlaylistCoverUrl(src)
        publish()
        runtime.refresh()
        return
      }
      // A tokenless report comes from a consumer that never opted into the token
      // protocol. It may still be a genuine failure of this owner's image, but it
      // cannot be attributed to a publication, so it must not open a recovery
      // epoch: the transition period explicitly forbids URL-only events from
      // driving recovery state.
      if (!token) return
      if (token.sessionGeneration !== runtime.sessionGeneration) return
      const key = token.key
      const entry = runtime.cache.get(key)
      const descriptor = runtime.descriptors.get(key)
      if (!entry || !descriptor) return
      if (!isCurrentCoverReport({
        presentation: entry.row.presentation,
        identity: artworkIdentity(key, descriptor),
        sessionGeneration: runtime.sessionGeneration,
      }, { token, actualUrl: detail.actualUrl, outcome: 'failed' })) return
      // Restoring a previous image is impossible for a first publish, so the one
      // remaining channel is a forced pixel read at the edge that failed. The lane
      // selection is the same for 256 list rows and the 512 hero: the path lane is
      // skipped because it already produced exactly this URL.
      const claim = runtime.recovery.claim(key, token.identity, token.publishGeneration, src)
      if (claim === 'spent') {
        // The epoch's single recovery is already gone. Terminate here: a transient
        // failure and the ordinary placeholder, never a broken element and never
        // another automatic job.
        runtime.recovery.settle(key)
        runtime.recoveryEdge.delete(key)
        runtime.transientFailures.set(key, artworkIdentity(key, descriptor))
        runtime.failedUpgrades.delete(key)
        runtime.cache.delete(key)
        publish()
        runtime.refresh()
        return
      }
      const failedEdge: 128 | 256 | 512 = entry.edge <= 256 ? 256 : 512
      runtime.recoveryEdge.set(key, failedEdge)
      runtime.transientFailures.delete(key)
      runtime.failedUpgrades.delete(key)
      // The failing URL must stop being the current cache hit so the pump re-admits
      // the key through the queued forced read. The ledger record is what makes that
      // admission forced, not a second flag that could be cleared independently.
      releasePlaylistCoverUrl(src)
      runtime.cache.delete(key)
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
      for (const entry of runtime.cache.values()) if (entry.row.coverThumbnail) releasePlaylistCoverUrl(entry.row.coverThumbnail.src)
      for (const pending of runtime.pendingReplacements.values()) {
        if (pending.previous.row.coverThumbnail) releasePlaylistCoverUrl(pending.previous.row.coverThumbnail.src)
        for (const older of pending.older) if (older.row.coverThumbnail) releasePlaylistCoverUrl(older.row.coverThumbnail.src)
      }
      runtime.cache.clear()
      runtime.rows = EMPTY_ROWS
      artworkStore.notifyAll()
      runtime.consumerPins.clear()
      runtime.pendingReplacements.clear()
      runtime.failedUpgrades.clear()
      runtime.recovery.clear()
      runtime.recoveryEdge.clear()
      runtime.publishSequences.clear()
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
      if (!runtime.descriptors.get(key)?.available) runtime.descriptors.set(key, { ...descriptor, artworkRevision: playlistArtworkRevision(source) })
    }
    for (const [key, entry] of runtime.cache) {
      const descriptor = runtime.descriptors.get(key)
      if (descriptor?.available && descriptor.id === entry.trackId) {
        if (descriptor.artworkRevision !== entry.artworkRevision) {
          // A new revision describes a different resource: the previous failure
          // verdict and the spent recovery must not gate the new one. Re-arm by
          // identity, which is also what the upgrade-restore path checks.
          runtime.failedUpgrades.delete(key)
          runtime.recovery.forget(key)
          runtime.recoveryEdge.delete(key)
        }
        continue
      }
      if (entry.row.coverThumbnail) releasePlaylistCoverUrl(entry.row.coverThumbnail.src)
      runtime.cache.delete(key)
      runtime.failedUpgrades.delete(key)
      runtime.recovery.forget(key)
      runtime.recoveryEdge.delete(key)
      runtime.publishSequences.delete(key)
      for (const [src, pending] of runtime.pendingReplacements) {
        if (pending.key !== key) continue
        if (pending.previous.row.coverThumbnail) releasePlaylistCoverUrl(pending.previous.row.coverThumbnail.src)
        for (const older of pending.older) if (older.row.coverThumbnail) releasePlaylistCoverUrl(older.row.coverThumbnail.src)
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
    const next = new Set(sourcePaths)
    if (next.size === runtime.pinned.size && [...next].every(path => runtime.pinned.has(path))) return
    runtime.pinned = next
    runtime.refresh()
  }, [])

  return { get rows() { return runtimeRef.current?.rows ?? rows }, artworkSource, setVisibleTrackIds, retainSourcePaths }
}
