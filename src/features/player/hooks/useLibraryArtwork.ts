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
import {
  createPlaylistArtworkStore,
  heroDisplayIdentity,
  heroPlaylistArtworkKey,
  heroSlotId,
  isHeroArtworkKey,
  isHeroSlotId,
  playlistArtworkKey,
  type PlaylistHeroSource,
} from '@/features/player/model/playlistArtworkStore'
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
import { HERO_MAX_EDGE, isHeroEdge, selectHeroEdge, type HeroEdge } from '@/features/player/services/heroCoverEdge'

type ArtworkRow = ReadOnlyArtworkRow

/**
 * Edge the PIXEL lane may be asked for.
 *
 * The original playlist set, deliberately: `audio_load_playlist_cover_pixels` never widened,
 * so a hero tier there is an ERROR, not a fallback (plan §4.3, T1/T4).
 */
type PixelFallbackEdge = 128 | 256 | 512

/** Step a path-lane edge down to something the pixel lane accepts. */
function pixelFallbackEdge(edge: number): PixelFallbackEdge {
  if (edge <= 128) return 128
  if (edge <= 256) return 256
  return 512
}

/** Narrow a plain number to a cover edge within the documented tier set. */
function toPlaylistCoverEdge(edge: number): PlaylistCoverEdge {
  if (edge <= 128) return 128
  if (edge <= 256) return 256
  if (edge <= 512) return 512
  // Pass through whichever hero tier was requested. Hard-coding 1536 here would truncate a
  // legitimate 2048 request once that tier is enabled.
  return isHeroEdge(edge) ? edge : HERO_MAX_EDGE
}

/**
 * Edge a detail/row cover may be read at.
 *
 * Rows and prefetch entries stay at 256; the hero may be promoted to a measured tier. The
 * union is named so the three maps below cannot drift apart (plan §5.3 T7).
 */
type PlaylistCoverEdge = 128 | 256 | 512 | HeroEdge

/**
 * Tier the hero should take, from the caller's measured demand.
 *
 * Two levels on purpose: the continuously measured value when the caller supplies
 * one, and `selectHeroEdge()` when it does not. `undefined` means "no hero" —
 * `useHeroTier(enabled: false)` produces exactly that when the panel leaves or
 * goes offscreen, so withdrawal needs no separate callback.
 */
function wantedHeroEdge(demand: PlaylistArtworkDemand | undefined): PlaylistCoverEdge | undefined {
  const measured = demand?.heroEdge
  if (typeof measured === 'number') {
    if (measured <= 256) return undefined
    return isHeroEdge(measured) ? measured : HERO_MAX_EDGE
  }
  return demand ? undefined : selectHeroEdge()
}
type CacheEntry = { row: ArtworkRow; edge: number; trackId: string; artworkRevision: number }
/**
 * The browse owner's hero publication.
 *
 * A single slot beside `cache`, never inside it: the row table must not be
 * indexable to a high-tier image. Mirrors `useAudioPlayer`'s hero slot so the two
 * owners publish the same identity for the same detail page (plan R6).
 */
type HeroSlot = {
  visual?: ArtworkRow
  edge?: PlaylistCoverEdge
  source?: PlaylistHeroSource
  /** Hero identity whose single automatic recovery already ended. */
  settledIdentity?: string
}
type Runtime = {
  mounted: boolean
  visible: boolean
  controller: AbortController
  revision: number
  /** Owner lifetime id. A report is only accepted for the owner that published it. */
  sessionGeneration: number
  descriptors: Map<string, AudioFolderTrackRef & { artworkRevision: number }>
  previews: Map<Element, string>
  desired: Map<string, PlaylistCoverEdge>
  pinned: Set<string>
  consumerPins: Map<string, number>
  rows: ReadonlyMap<string, ArtworkRow>
  detail: AudioFolderPlaylist | null
  detailPaths: Map<string, PlaylistCoverEdge>
  detailVisiblePaths: Set<string>
  cache: Map<string, CacheEntry>
  pendingReplacements: Map<string, { key: string; previous: CacheEntry; older: CacheEntry[] }>
  failedUpgrades: Set<string>
  /** Hero slot: the one high-tier publication this owner holds. */
  hero: HeroSlot
  /**
   * Playlist scope of the current detail, in the SAME form the row keys use.
   *
   * Resolved from `sources` rather than from `detail` because `detail` may be a
   * bare projection without `sourceKind`. The hero key must equal the row key's
   * first tuple element by construction, otherwise the panel would derive a hero
   * key the owner never publishes (plan R6).
   */
  detailScope?: string
  /** Tier the current demand wants for the hero, or undefined for "no hero". */
  heroDesiredEdge?: PlaylistCoverEdge
  /** Monotonic hero request generation; drops a late reply. */
  heroGeneration: number
  /** In-flight hero read, so a refresh cannot start it twice. */
  heroActive: boolean
  /** Superseded hero URLs awaiting DOM confirmation, keyed by the new URL. */
  heroPendingReplacements: Map<string, { previous: ArtworkRow; older: ArtworkRow[] }>
  /** Drop the hero slot and release its URL. Set by the mount effect. */
  clearHero: () => void
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
  recoveryEdge: Map<string, PlaylistCoverEdge>
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
    const tuple = JSON.parse(key) as [string, string, string, string?]
    const runtime = runtimeRef.current
    if (isHeroArtworkKey(tuple)) {
      const hero = runtime?.hero
      const source = hero?.source
      // The hero triple must equal the slot's own resource; the first three
      // elements come from the row key, so this only fails when the slot
      // describes a different playlist/track/path.
      if (!hero?.visual || !source
        || source.scope !== tuple[0] || source.trackId !== tuple[1] || source.sourcePath !== tuple[2]) return undefined
      return hero.visual
    }
    const [, id, path] = tuple
    const descriptor = runtime?.descriptors.get(path)
    const entry = runtime?.cache.get(path)
    return descriptor?.id === id && entry?.trackId === id ? entry.row : undefined
  }, (key) => {
    const tuple = JSON.parse(key) as [string, string, string, string?]
    const runtime = runtimeRef.current
    // The hero never enters `runtime.cache`, so it must not pin a row path: a
    // pin would keep a row-key lease for a resource this lane does not own.
    if (isHeroArtworkKey(tuple)) return () => {}
    const [, , path] = tuple
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
      detailScope: undefined,
      hero: {}, heroDesiredEdge: undefined, heroGeneration: 0, heroActive: false, heroPendingReplacements: new Map(), clearHero: () => {},
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
    /**
     * Notify the hero key.
     *
     * Derived from the slot's own source, so a subscriber can never be notified
     * for a key describing a different resource. With no source (a cleared slot)
     * the whole store is notified, because the old key is not known any more by
     * the time this runs.
     */
    const notifyHero = (source: PlaylistHeroSource | undefined) => {
      if (!source) {
        artworkStore.notifyAll()
        return
      }
      artworkStore.notify([heroPlaylistArtworkKey(
        playlistArtworkKey(source.scope, source.trackId, source.sourcePath))])
    }
    /** Drop the hero slot, release its URL, then let its subscribers see `undefined`. */
    const clearHero = () => {
      const previous = runtime.hero
      runtime.hero = {}
      runtime.heroGeneration += 1
      runtime.heroActive = false
      if (previous.visual?.coverThumbnail) releasePlaylistCoverUrl(previous.visual.coverThumbnail.src)
      for (const pending of runtime.heroPendingReplacements.values()) {
        if (pending.previous.coverThumbnail) releasePlaylistCoverUrl(pending.previous.coverThumbnail.src)
        for (const older of pending.older) if (older.coverThumbnail) releasePlaylistCoverUrl(older.coverThumbnail.src)
      }
      runtime.heroPendingReplacements.clear()
      notifyHero(previous.source)
    }
    runtime.clearHero = clearHero
    /**
     * Retire a superseded hero URL once every consumer loaded its replacement.
     *
     * The same rule as `retireReplacement`, over the hero's own map: a hero image
     * is only released when nothing is still painting the older one.
     */
    const retireHeroReplacement = (src: string) => {
      const pending = runtime.heroPendingReplacements.get(src)
      if (!pending) return
      const images = [...document.querySelectorAll<HTMLImageElement>('img')]
      const consumers = images.filter((image) => image.src === src)
      if (consumers.some((image) => !image.complete || image.naturalWidth === 0)) return
      const oldSources = [pending.previous, ...pending.older]
        .map((entry) => entry.coverThumbnail?.src).filter((url): url is string => Boolean(url))
      if (images.some((image) => oldSources.includes(image.src))) return
      runtime.heroPendingReplacements.delete(src)
      for (const oldSource of oldSources) releasePlaylistCoverUrl(oldSource)
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
          if (!entry) return true
          if (entry.edge < edge) return true
          // A viewport shrink lowers the hero's demand; without this the oversized image would
          // stay published because a "smaller demand" is not a cache miss under the old rule.
          // Rows are always demanded at 256, so this is the defensive form of the rule the hero
          // slot applies for real in `startHeroJob`.
          if (entry.edge > edge && edge > 256) return true
          return entry.artworkRevision !== descriptor.artworkRevision && !runtime.failedUpgrades.has(key)
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
            const readEdge: PlaylistCoverEdge = forcePixels ? (forceEdge ?? edge) : edge
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
                    { clientId, filePath: cover.coverArt.filePath, maxEdge: pixelFallbackEdge(readEdge), windowGeneration: generation },
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
                    { clientId, filePath: cover.coverArt.filePath, maxEdge: pixelFallbackEdge(readEdge), windowGeneration: generation },
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
                      { clientId, filePath: cover.coverArt.filePath, maxEdge: pixelFallbackEdge(readEdge), windowGeneration: generation },
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
    /**
     * Start one hero read when the slot does not already describe what is wanted.
     *
     * The triggers mirror the row pump's: the wanted identity/tier changed, the
     * slot is empty, or the previous attempt settled without an image. There is no
     * queue: one detail page has exactly one hero, so a second read only ever
     * replaces the first, and the generation is what makes the first one's reply
     * harmless.
     */
    const startHeroJob = () => {
      if (!runtime.mounted || !runtime.visible) return
      if (runtime.heroActive) return
      const detail = runtime.detail
      const edge = runtime.heroDesiredEdge
      if (!detail || edge === undefined) {
        // The demand withdrew: release the high-tier image and fall back to the
        // row preview. Same moment the old code dropped the first row to 256.
        //
        // Unconditional, and that matters: leaving demand is the documented retry
        // trigger, so a settled verdict must be dropped here even when the slot
        // holds no image. Otherwise one DOM failure would blacklist the identity
        // for the session — resizing the hero away and back would never re-read it.
        clearHero()
        return
      }
      const first = detail.tracks.find((candidate) => candidate.available)
      if (!first || !runtime.detailScope) return
      const scope = runtime.detailScope
      const normalizedSourcePath = normalizeAudioSourcePath(first.sourcePath)
      const revision = runtime.descriptors.get(normalizedSourcePath)?.artworkRevision
        ?? playlistArtworkRevision(detail)
      const source: PlaylistHeroSource = { scope, trackId: first.id, sourcePath: normalizedSourcePath, artworkRevision: revision }
      const identity = heroDisplayIdentity(source)
      const current = runtime.hero
      const satisfied = Boolean(current.visual?.coverThumbnail)
        && current.edge === edge
        && current.source
        && heroDisplayIdentity(current.source) === identity
      // A settled identity must not be re-admitted by the next refresh; only a
      // new identity (other track, other scope, other revision) re-arms it.
      if (satisfied || current.settledIdentity === identity) return
      const generation = ++runtime.heroGeneration
      runtime.heroActive = true
      // Full currentness: owner lifetime, visibility, the request generation, AND
      // the resource identity this read was started for. The last clause is what
      // makes a reply that arrives after the detail page changed harmless — the
      // owner may still be mounted and visible, describing a different list.
      const isCurrent = () => runtime.mounted && runtime.visible
        && runtime.heroGeneration === generation
        && runtime.detailScope === scope
        && runtime.descriptors.get(normalizedSourcePath)?.artworkRevision === revision
      void (async () => {
        let thumbnail: PlaylistCoverImage | undefined
        try {
          const coverGeneration = await ready
          if (!isCurrent()) return
          if (coverGeneration === null) throw new Error('媒体库封面窗口不可用')
          const cover = await probeAudioPlaylistCover(first.sourcePath)
          if (!isCurrent()) return
          if (cover.id !== first.id || normalizeAudioSourcePath(cover.sourcePath) !== normalizedSourcePath) {
            throw new Error('媒体库封面与歌曲来源不一致')
          }
          const hasLocalArtwork = cover.coverArt !== null
          if (!cover.coverArt?.filePath) return
          // The hero is an OPTIONAL upgrade over the row's 256 preview, so a
          // deterministic "too large at this tier" refusal falls back locally
          // instead of charging the shared breaker (plan R1).
          const attemptOptions: AttemptOptions = {
            priority: 0, signal: runtime.controller.signal, isCurrent, optionalHeroRead: true,
          }
          const attempt = await attemptPlaylistCoverThumbnailPath({
            clientId, filePath: cover.coverArt.filePath, maxEdge: edge, windowGeneration: coverGeneration,
          }, attemptOptions)
          if (attempt.status === 'dropped') return
          if (!isCurrent()) return
          if (attempt.status === 'missing') return
          if (attempt.status === 'ready') {
            thumbnail = attempt.image
          } else {
            // Playlist pixel reads stop at 512 (plan D2 / §4.3).
            const pixels = await schedulePlaylistCoverPixels({
              clientId, filePath: cover.coverArt.filePath, maxEdge: pixelFallbackEdge(edge),
              windowGeneration: coverGeneration,
            }, attemptOptions)
            if (!pixels || !isCurrent()) return
            thumbnail = playlistCoverImageFromPixels(pixels)
          }
          if (thumbnail && !isPlaylistCoverDecoded(thumbnail)) {
            await decodePlaylistCover(thumbnail)
            if (!isCurrent()) { thumbnail = undefined; return }
          }
          if (!thumbnail) return
          const presentation = createCoverPresentation({
            key: heroSlotId(first.id),
            identity,
            sessionGeneration: runtime.sessionGeneration,
            publishGeneration: (runtime.publishSequences.get(heroSlotId(first.id)) ?? 0) + 1,
            src: thumbnail.src,
            image: thumbnail,
          })
          runtime.publishSequences.set(heroSlotId(first.id), presentation.token.publishGeneration)
          const previous = runtime.hero
          runtime.hero = {
            visual: { hasLocalArtwork, coverThumbnail: thumbnail, presentation },
            edge,
            source,
          }
          thumbnail = undefined
          // The superseded hero URL retires exactly like a superseded row URL.
          if (previous.visual?.coverThumbnail) {
            runtime.heroPendingReplacements.set(runtime.hero.visual!.coverThumbnail!.src, {
              previous: previous.visual, older: [],
            })
          }
          notifyHero(source)
        } catch (error) {
          if (isCurrent()) console.warn('读取头图封面失败', { sourcePath: first.sourcePath, error })
          // A failed read ends in the row preview, never a broken element.
          if (isCurrent()) runtime.hero.settledIdentity = identity
        } finally {
          if (thumbnail) releasePlaylistCoverUrl(thumbnail.src)
          if (runtime.heroGeneration === generation) runtime.heroActive = false
        }
      })()
    }
    runtime.refresh = () => {
      const required = new Map<string, PlaylistCoverEdge>()
      // Rows — the first row included — are always read at the persisted 256px
      // thumbnail. The first track no longer carries a promoted edge: that edge is
      // what the hero lane owns, and keeping it on the row is exactly what let the
      // hero's high tier leak into the ordinary first card (plan §2).
      for (const key of runtime.detailPaths.keys()) {
        if (runtime.detailVisiblePaths.has(key)) required.set(key, 256)
      }
      for (const key of runtime.previews.values()) {
        if (runtime.descriptors.get(key)?.available && !required.has(key)) required.set(key, 256)
      }
      // Required viewport/preview images may exceed the nominal resident cap.
      // Only spare capacity admits prefetch; otherwise the cache would evict
      // a still-desired optional image and immediately read it again forever.
      runtime.desired = runtime.visible
        ? admitLibraryArtwork(required, runtime.detailPaths, protectedArtworkPaths(runtime), MAX_RESIDENT, MAX_DETAIL)
        : new Map()
      if (trimCache()) publish()
      runtime.pump()
      // The hero is a single independent slot, so it has no admission window: it
      // either has to be (re)read for its current identity, or it does not.
      startHeroJob()
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
      // A hero report and a row report must never be attributed to each other. The
      // hero owns a slot id that is not a resource path, so this is structural: a
      // hero element failing must not consume a ROW's single recovery epoch
      // (plan R9).
      if (isHeroSlotId(token.key)) {
        const hero = runtime.hero
        if (!hero.visual?.presentation || !hero.source) return
        if (token.key !== hero.visual.presentation.token.key) return
        if (!isCurrentCoverReport({
          presentation: hero.visual.presentation,
          identity: heroDisplayIdentity(hero.source),
          sessionGeneration: runtime.sessionGeneration,
        }, { token, actualUrl: detail.actualUrl, outcome: 'failed' })) return
        // The hero read already spent its one fallback inside the attempt chain
        // (path lane → one ≤512 pixel read). A DOM failure of the published hero
        // therefore ends this identity's epoch: settle it and drop the publication
        // so the hero renders the row preview, never a broken element.
        runtime.heroGeneration += 1
        runtime.heroActive = false
        runtime.hero = { settledIdentity: heroDisplayIdentity(hero.source) }
        releasePlaylistCoverUrl(src)
        notifyHero(hero.source)
        return
      }
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
      // The recovery must re-read at the edge that actually failed. Clamping anything
      // above 256 down to 512 violated that contract for hero tiers: a 1536 failure would
      // have been retried at 512 and, if that also failed, pinned the row at the wrong
      // edge forever. `entry.edge` is the edge the failed publication was produced at, so
      // for tiers above 256 it is the correct retry edge (plan §5.4 L4).
      const failedEdge: PlaylistCoverEdge = entry.edge <= 256 ? 256 : toPlaylistCoverEdge(entry.edge)
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
      for (const src of runtime.heroPendingReplacements.keys()) retireHeroReplacement(src)
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
      // The hero slot owns its URL exactly like a row entry does; an unmount must
      // not leave it to the WebView to reclaim.
      if (runtime.hero.visual?.coverThumbnail) releasePlaylistCoverUrl(runtime.hero.visual.coverThumbnail.src)
      for (const pending of runtime.heroPendingReplacements.values()) {
        if (pending.previous.coverThumbnail) releasePlaylistCoverUrl(pending.previous.coverThumbnail.src)
        for (const older of pending.older) if (older.coverThumbnail) releasePlaylistCoverUrl(older.coverThumbnail.src)
      }
      runtime.hero = {}
      runtime.heroPendingReplacements.clear()
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
    // The detail's scope, resolved from the source list the row keys are built
    // from. Falling back to the detail object itself covers a projection that
    // still carries its own identity.
    const matchedSource = detail
      ? sources.find((source) => normalizeAudioSourcePath(source.sourcePath) === normalizeAudioSourcePath(detail.sourcePath))
      : undefined
    runtime.detailScope = detail
      ? `${matchedSource?.sourceKind ?? detail.sourceKind ?? 'folder'}\u0000${normalizeAudioSourcePath(detail.sourcePath)}`
      : undefined
    const detailPaths = new Set(detail?.tracks.map((descriptor) => normalizeAudioSourcePath(descriptor.sourcePath)))
    for (const key of runtime.detailPaths.keys()) if (!detailPaths.has(key)) runtime.detailPaths.delete(key)
    for (const key of runtime.detailVisiblePaths) if (!detailPaths.has(key)) runtime.detailVisiblePaths.delete(key)
    // The first row is seeded as an ORDINARY row. It used to be seeded at a
    // measured hero tier here, which made the first row and the hero share one
    // source-path key and one cache entry: whichever read finished last won, and
    // the ordinary first card rendered the hero's high tier (plan §2).
    const first = detail?.tracks[0]
    if (first?.available && first.id !== warmTrackId) {
      runtime.detailPaths.set(normalizeAudioSourcePath(first.sourcePath), 256)
    }
    // The hero's own tier is set by `setVisibleTrackIds`, which is the only place
    // the caller's demand object arrives. Entering or leaving a detail page is a
    // new hero problem: an identity whose epoch settled belongs to the previous
    // visit, so it must not gate the new one.
    if (runtime.hero.source) {
      const stillSameDetail = runtime.detail?.sourcePath === detail?.sourcePath
      if (!stillSameDetail) runtime.clearHero()
    }
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
    const paths = new Map<string, PlaylistCoverEdge>()
    const first = available[0]
    if (first && first.id !== warmTrackId) paths.set(normalizeAudioSourcePath(first.sourcePath), 256)
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
    const paths = new Map<string, PlaylistCoverEdge>()
    const visiblePaths = new Set<string>()
    // The pinned first row is an ordinary row here: its artwork is the same 256px
    // thumbnail every other card reads. `keepPersistentArtwork` now decides only
    // whether the HERO asks for a high tier, never whether the first row does.
    const first = keepPersistentArtwork ? playlist.tracks[0] : undefined
    if (first?.available) visiblePaths.add(normalizeAudioSourcePath(first.sourcePath))
    if (showArtwork) {
      const descriptors = new Map(playlist.tracks.map((descriptor) => [descriptor.id, descriptor]))
      const visibleIds = demand?.visibleIds ?? trackIds
      for (const id of visibleIds) {
        const descriptor = descriptors.get(id)
        if (descriptor?.available) {
          const key = normalizeAudioSourcePath(descriptor.sourcePath)
          // Detail cards share the persisted 256px thumbnail lane with All Songs.
          paths.set(key, 256)
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
    // The hero's tier comes from the caller's continuously measured value with
    // `selectHeroEdge()` as the documented fallback. Keeping that two-level
    // source matters: dropping it would silently disable every hero read whose
    // caller does not measure (plan R5).
    runtime.heroDesiredEdge = keepPersistentArtwork ? wantedHeroEdge(demand) : undefined
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
