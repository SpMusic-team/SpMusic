import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import {
  COVER_IMAGE_ERROR_EVENT,
  COVER_IMAGE_LOAD_EVENT,
  coverImageEventDetail,
  decodePlaylistCover,
  decodePlaylistCoverWithin,
  isSameCoverUrl,
  nextCoverSessionGeneration,
  releasePlaylistCoverUrl,
  type CoverPresentation,
  type CoverPresentationFailureStage,
  type CoverPresentationReport,
} from '@/features/player/model/playlistCoverReadiness'
import type { PlaylistCoverImage } from '@/features/player/model/playerUiViewModel'
import type { AllSongsItem } from '@/features/player/model/playerUiViewModel'
import { beginAudioPlaylistCoverWindow } from '@/features/player/services/audioCommands'
import { scheduleFolderThumbnail, scheduleTrackThumbnail } from '@/features/player/services/playlistCoverScheduler'
import {
  attemptFolderThumbnailPath,
  attemptTrackThumbnailPath,
  notePathLanePresentationFailure,
  type AttemptOptions,
} from '@/features/player/services/playlistCoverPathLane'
import { orderPlaylistArtworkRows, type PlaylistArtworkDirection } from '@/features/player/model/playlistArtworkOrder'
import { isStreamSource } from '../model/streams'

export type FolderCoverItem = Readonly<{ kind: 'folder'; key: string; rootPath: string; directoryPath: string; available: boolean }>
type TrackCoverItem = Pick<AllSongsItem, 'key' | 'trackId' | 'sourcePath' | 'available' | 'artworkRevision'>
export type TrackCandidatesCoverItem = Readonly<{ kind: 'track-candidates'; key: string; candidates: readonly TrackCoverItem[]; available: boolean }>
export type AllSongsCoverItem = TrackCoverItem | FolderCoverItem | TrackCandidatesCoverItem

/** Which channel produced a row's current URL. Recovery semantics depend on it. */
export type CoverSourceLane = 'path' | 'pixels'

/**
 * Lifecycle of one published presentation.
 *
 * - `pending`    committed, waiting for the DOM to confirm or reject it.
 * - `presented`  the DOM reported the *current* snapshot loaded.
 * - `recovering` the current snapshot failed in the DOM; one forced pixel job is
 *                the only thing that will run for this row until it settles.
 * - `failed`     settled without a usable image; shows a previous known-good
 *                image or the normal placeholder, never a broken element.
 */
export type PresentationState = 'pending' | 'presented' | 'recovering' | 'failed'

type WindowRow = (Readonly<{ trackId: string; sourcePath: string; artworkRevision?: number }> | Readonly<{ kind: 'folder'; rootPath: string; directoryPath: string }> | Pick<TrackCandidatesCoverItem, 'kind' | 'candidates'>) & Readonly<{
  coverUrl?: string
  transientFailure?: boolean
  /** What the DOM should render for this row. Absent means "render the placeholder". */
  presentation?: CoverPresentation
  presentationState?: PresentationState
  sourceLane?: CoverSourceLane
  /** Path-lane attempt id, so one DOM failure is charged at most once. */
  pathAttemptId?: string
  /** Candidate index that produced `coverUrl`, so recovery can start there. */
  candidateIndex?: number
  /** Pixel resource behind a blob URL. */
  image?: PlaylistCoverImage
}>

function coverIdentity(item: AllSongsCoverItem | WindowRow, revision = true): string {
  if ('kind' in item && item.kind === 'track-candidates') return JSON.stringify(['track-candidates', item.candidates.map(candidate => [candidate.trackId, candidate.sourcePath, candidate.available, ...(revision ? [candidate.artworkRevision ?? 0] : [])])])
  return 'kind' in item && item.kind === 'folder'
    ? JSON.stringify(['folder', item.rootPath, item.directoryPath])
    : JSON.stringify(['track', (item as TrackCoverItem).trackId, (item as TrackCoverItem).sourcePath, ...(revision ? [(item as TrackCoverItem).artworkRevision ?? 0] : [])])
}

function cacheDescriptor(item: AllSongsCoverItem): WindowRow {
  if ('kind' in item && item.kind === 'track-candidates') return { kind: item.kind, candidates: item.candidates }
  return 'kind' in item ? { kind: 'folder', rootPath: item.rootPath, directoryPath: item.directoryPath }
    : { trackId: item.trackId, sourcePath: item.sourcePath, ...(item.artworkRevision === undefined ? {} : { artworkRevision: item.artworkRevision }) }
}

/**
 * Owner-side handler for one presentation report.
 *
 * Registered per owner instance and addressed by `token.sessionGeneration`, so a
 * report can only ever reach the owner that published the snapshot it names.
 */
export type CoverPresentationOwner = Readonly<{ report: (report: CoverPresentationReport) => void }>

export type AllSongsCoverStore = {
  cache: Map<string, WindowRow>
  listeners: Map<string, Set<() => void>>
  /** Owners by session generation. A report is routed by its token, never by key. */
  owners: Map<number, CoverPresentationOwner>
  folderRevisions?: Map<string, { token?: readonly string[]; status: string; revision: number }>
  folderScanRevisions?: WeakMap<readonly string[], number>
  nextFolderRevision?: number
  notify: (key: string) => void
  leases: Map<string, number>
  retire: (key: string, url: string) => void
  retain: (key: string) => () => void
  sweep: () => void
  /** Route a DOM report to the owner named by its token. */
  reportPresentation: (report: CoverPresentationReport) => void
}
type WindowRuntime = {
  mounted: boolean
  controller: AbortController
  sessionGeneration: number
  desired: Set<string>
  // Demand that is actually inside the panel bounds, as opposed to the observer
  // overscan that `desired` also admits. Only dispatch priority reads this.
  visible: Set<string>
  cache: AllSongsCoverStore['cache']
  coverQueued: Set<string>
  coverActive: number
  /** Per-key publish sequence; a new token on every actual commit. */
  publishSequences: Map<string, number>
  /** Recovery bookkeeping, bounded and cleared with the owner. */
  recovery: Map<string, RecoveryRecord>
  /** Keys currently inside (or last inside) the demanded set. */
  demandSeen: Set<string>
  /** Last presentation the DOM confirmed for a key, used as the failure fallback. */
  lastPresented: Map<string, CoverPresentation>
  pump: () => void
}

/** One bounded recovery opportunity for a row, per retry epoch. */
type RecoveryRecord = {
  key: string
  identity: string
  epoch: number
  attempted: boolean
  state: 'idle' | 'queued' | 'running' | 'settled'
  stage?: CoverPresentationFailureStage
  startIndex: number
  /** The presentation URL that failed in the DOM. Never reused as a fallback. */
  failingUrl: string
  /** Generation of the placeholder/fallback commit made while recovering. */
  recoveryGeneration?: number
}

const WINDOW_CONCURRENCY = 2
const CACHE_LIMIT = 60
/** Bound on recovery/publish bookkeeping; the owner's lifetime caps them all. */
const RECOVERY_RECORD_LIMIT = 128
/**
 * Deadline for the recovery job's own decode.
 *
 * Scoped to the recovery, not to every cover decode: raising the shared 3 s
 * predecode or the unbounded `decodePlaylistCover` would change unrelated
 * callers. A recovery that cannot decode in this window settles as failed and
 * restores the previous image instead of holding its admission slot.
 */
const RECOVERY_DECODE_TIMEOUT_MS = 4000

export function createAllSongsCoverStore(): AllSongsCoverStore {
  const listeners = new Map<string, Set<() => void>>()
  const leases = new Map<string, number>()
  const owners = new Map<number, CoverPresentationOwner>()
  const retired = new Map<string, Set<string>>()
  // Releases the URLs a row no longer displays. `retire` receives URLs from both
  // lanes: blob object URLs from the pixel fallback, and asset-protocol URLs from
  // the path lane. Only the former has an explicit release step, so the call goes
  // through `releasePlaylistCoverUrl`, which is a no-op for asset URLs. Their
  // decoded bitmaps belong to the WebView and are freed when the `<img>` unmounts.
  // Do not "fix" this into a refcount: that would add bookkeeping to a URL whose
  // release does not happen here at all.
  const sweep = () => {
    const used = new Set([...document.querySelectorAll<HTMLImageElement>('img')].map(image => image.src))
    for (const [key, urls] of retired) {
      if (leases.has(key)) continue
      for (const url of urls) {
        if (used.has(url)) continue
        releasePlaylistCoverUrl(url)
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
  return { cache: new Map(), listeners, owners, leases, retain, retire, sweep, notify: (key) => {
    for (const listener of listeners.get(key) ?? []) listener()
  }, reportPresentation: (report) => {
    // Routed by the owner that published the snapshot. A report that names an
    // owner which has since unmounted is dropped: no surviving owner may inherit
    // it, which is the whole point of a non-reused session generation.
    owners.get(report.token.sessionGeneration)?.report(report)
  } }
}

export function disposeAllSongsCoverStore(store: AllSongsCoverStore): void {
  for (const [key, row] of store.cache) if (row.coverUrl) store.retire(key, row.coverUrl)
  const keys = [...store.cache.keys()]
  store.cache.clear()
  store.owners.clear()
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

export function useCollectionCoverUrl(store: AllSongsCoverStore, item?: AllSongsCoverItem): string | undefined {
 return useCoverUrl(store, item?.key ?? '', item ? coverIdentity(item) : '')
}

/**
 * Published presentation for one all-songs-style row.
 *
 * Its identity deliberately ignores `artworkRevision`, exactly like
 * `useAllSongsCoverUrl`: a rescanned descriptor keeps painting the previous cover
 * until its replacement decodes. The *token* still carries the full identity, so a
 * report from that stale snapshot is rejected by the owner even though the card
 * keeps displaying it.
 */
export function useAllSongsCoverPresentation(store: AllSongsCoverStore, key: string, trackId: string, sourcePath: string): CoverPresentation | undefined {
  return useCoverPresentation(store, key, JSON.stringify(['track', trackId, sourcePath]), false)
}

/** Published presentation for a collection/folder cover row. */
export function useCollectionCoverPresentation(store: AllSongsCoverStore, item?: AllSongsCoverItem): CoverPresentation | undefined {
  return useCoverPresentation(store, item?.key ?? '', item ? coverIdentity(item) : '')
}

function useCoverUrl(store: AllSongsCoverStore, key: string, identity: string, revision = true): string | undefined {
  return useCoverSnapshot(store, key, identity, revision)?.src
}

function useCoverPresentation(store: AllSongsCoverStore, key: string, identity: string, revision = true): CoverPresentation | undefined {
  return useCoverSnapshot(store, key, identity, revision)
}

/**
 * The one subscription both readers use.
 *
 * Returning the row's `presentation` object itself (not a fresh wrapper) keeps the
 * snapshot reference stable, which `useSyncExternalStore` requires: a new object
 * per read would re-render forever.
 */
function useCoverSnapshot(store: AllSongsCoverStore, key: string, identity: string, revision: boolean): CoverPresentation | undefined {
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
    return row && coverIdentity(row, revision) === identity ? row.presentation : undefined
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
  const itemOrderKey = useMemo(() => items.map(item => `${item.key}\u0001${coverIdentity(item)}`)
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
    // prepared covers remain warm across visits. A settled recovery failure is
    // written as `transientFailure` precisely so this is the retry path.
    for (const [key, row] of store.cache) {
      if (row.transientFailure) {
        if (row.coverUrl) store.retire(key, row.coverUrl)
        store.cache.delete(key)
      }
    }
    const runtime: WindowRuntime = {
      mounted: true, controller: new AbortController(), sessionGeneration: nextCoverSessionGeneration(),
      desired: new Set(), visible: new Set(), cache: store.cache,
      coverQueued: new Set(), coverActive: 0,
      publishSequences: new Map(), recovery: new Map(), demandSeen: new Set(), lastPresented: new Map(),
      pump: () => {},
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
      // Owner bookkeeping is bounded the same way the cache is: an entry that
      // outlives its row would be a leak, not a record.
      for (const key of runtime.publishSequences.keys()) if (!runtime.cache.has(key)) runtime.publishSequences.delete(key)
      for (const key of runtime.lastPresented.keys()) if (!runtime.cache.has(key)) runtime.lastPresented.delete(key)
      for (const key of runtime.recovery.keys()) if (!runtime.cache.has(key) && !runtime.desired.has(key)) runtime.recovery.delete(key)
    }

    /**
     * Commit one row and stamp its presentation token.
     *
     * A commit always replaces `publishGeneration`, which is what makes a late
     * report for the previous snapshot recognizable and ignorable. The full
     * descriptor identity — including `artworkRevision` — goes into the token, so a
     * card still painting a pre-rescan cover cannot report as if it were current.
     */
    const publish = (key: string, row: WindowRow, options: { lane?: CoverSourceLane; attemptId?: string; candidateIndex?: number; state?: PresentationState } = {}) => {
      if (!runtime.mounted || !runtime.desired.has(key)) return false
      const previous = runtime.cache.get(key)
      if (previous?.coverUrl && previous.coverUrl !== row.coverUrl) store.retire(key, previous.coverUrl)
      let next: WindowRow = { ...row, sourceLane: options.lane, pathAttemptId: options.attemptId, candidateIndex: options.candidateIndex }
      if (row.coverUrl) {
        const publishGeneration = (runtime.publishSequences.get(key) ?? 0) + 1
        runtime.publishSequences.set(key, publishGeneration)
        next = { ...next, presentationState: options.state ?? 'pending', presentation: {
          ...(row.image ? { image: row.image } : {}),
          src: row.coverUrl,
          token: {
            key,
            identity: coverIdentity(row),
            sessionGeneration: runtime.sessionGeneration,
            publishGeneration,
            url: row.coverUrl,
          },
        } }
      } else {
        // No usable URL: the row must render the placeholder, never a broken
        // element. Keeping the descriptor (and therefore the cache identity)
        // means the pump will not loop on it.
        next = { ...next, presentation: undefined, presentationState: options.state ?? 'failed' }
      }
      runtime.cache.delete(key)
      runtime.cache.set(key, next)
      trimCache()
      store.notify(key)
      return true
    }

    // The scheduler admits strictly by priority, so classify demand when it is
    // dispatched: the row inside the viewport first, a mounted row just offscreen
    // next, overscan-only prefetch last.
    const coverPriority = (key: string): 0 | 1 | 2 =>
      runtime.visible.has(key) ? 0 : renderedKeysRef.current.has(key) ? 1 : 2

    const dropRecovery = (key: string) => {
      const record = runtime.recovery.get(key)
      if (record?.state === 'running' || record?.state === 'queued') return
      runtime.recovery.delete(key)
    }

    /**
     * Open a new retry epoch when a key re-enters demand.
     *
     * Called from every pump, which is exactly "after any demand change". A key
     * that stays demanded is not re-queued: the recovery opportunity is per epoch,
     * not per render or per pump.
     *
     * Re-entering demand is the documented retry trigger, so the single recovery of
     * the previous epoch is re-armed here. Without this the row would stay failed
     * for the owner's whole lifetime, because the pump's normal admission skips a
     * key whose cached identity still matches.
     */
    const reconcileRecovery = () => {
      for (const key of runtime.desired) {
        if (runtime.demandSeen.has(key)) continue
        runtime.demandSeen.add(key)
        const record = runtime.recovery.get(key)
        if (!record) continue
        if (record.state === 'running' || record.state === 'queued') continue
        const current = itemsByKeyRef.current.get(key)
        if (!current || coverIdentity(current) !== record.identity) { runtime.recovery.delete(key); continue }
        record.epoch += 1
        record.attempted = false
        record.stage = undefined
        // A fresh epoch is a fresh opportunity, including one already spent.
        record.state = 'queued'
      }
      for (const key of [...runtime.demandSeen]) if (!runtime.desired.has(key)) runtime.demandSeen.delete(key)
      if (runtime.recovery.size > RECOVERY_RECORD_LIMIT) {
        for (const [key, record] of runtime.recovery) {
          if (runtime.recovery.size <= RECOVERY_RECORD_LIMIT) break
          if (record.state === 'running' || record.state === 'queued') continue
          runtime.recovery.delete(key)
        }
      }
    }

    /**
     * Take the next queued recovery that is still valid.
     *
     * This is the bypass the design requires: `pump()`'s normal admission skips a
     * key whose cached identity already matches, which is correct for a healthy
     * cache hit and wrong for a row whose published URL just failed in the DOM.
     * Recovery demand therefore has its own table and is admitted ahead of normal
     * work, but through the same `coverActive` ledger and the same scheduler, so
     * the concurrency and priority bounds are unchanged.
     */
    const takeRecoveryJob = (): { record: RecoveryRecord; item: AllSongsCoverItem } | undefined => {
      let best: { record: RecoveryRecord; item: AllSongsCoverItem; priority: 0 | 1 | 2 } | undefined
      for (const record of runtime.recovery.values()) {
        if (record.state !== 'queued' || record.attempted) continue
        const item = itemsByKeyRef.current.get(record.key)
        if (!item?.available || !runtime.desired.has(record.key)) { record.state = 'idle'; continue }
        if (coverIdentity(item) !== record.identity) { runtime.recovery.delete(record.key); continue }
        const priority = coverPriority(record.key)
        if (!best || priority < best.priority) best = { record, item, priority }
      }
      if (!best) return undefined
      best.record.state = 'running'
      best.record.attempted = true
      return { record: best.record, item: best.item }
    }

    /**
     * The forced pixel read for one recovery.
     *
     * Never touches the path lane and never waits on a path timeout: the path
     * attempt for this row already succeeded, which is why the row is here. The
     * command selection keeps the source semantics — 256 track/folder pixels for
     * list rows and candidate groups, matching what the normal lane would have
     * used — and the candidate order is preserved, starting at the candidate that
     * produced the failed image.
     */
    const readRecoveryPixels = async (
      item: AllSongsCoverItem,
      generation: number,
      priority: 0 | 1 | 2,
      isCurrent: () => boolean,
      startIndex: number,
    ): Promise<{ image: PlaylistCoverImage; candidateIndex?: number } | undefined> => {
      const options = { priority, signal: runtime.controller.signal, isCurrent }
      if ('kind' in item && item.kind === 'track-candidates') {
        for (let index = Math.max(0, Math.min(startIndex, item.candidates.length)); index < item.candidates.length; index += 1) {
          const candidate = item.candidates[index]!
          if (!candidate.available || isStreamSource(candidate)) continue
          if (!isCurrent()) return undefined
          const pixels = await scheduleTrackThumbnail(
            { clientId, sourcePath: candidate.sourcePath, maxEdge: 256, windowGeneration: generation },
            options,
          )
          if (!isCurrent()) return undefined
          if (!pixels) continue
          return { image: playlistCoverImageFromPixels(pixels), candidateIndex: index }
        }
        return undefined
      }
      if ('kind' in item || !isStreamSource(item)) {
        const pixels = 'kind' in item
          ? await scheduleFolderThumbnail({ clientId, rootPath: item.rootPath, directoryPath: item.directoryPath, maxEdge: 256, windowGeneration: generation }, options)
          : await scheduleTrackThumbnail({ clientId, sourcePath: item.sourcePath, maxEdge: 256, windowGeneration: generation }, options)
        if (!isCurrent() || !pixels) return undefined
        return { image: playlistCoverImageFromPixels(pixels) }
      }
      return undefined
    }

    /** Settle one recovery: commit a replacement, or a bounded, non-broken failure. */
    const runRecovery = (record: RecoveryRecord, item: AllSongsCoverItem) => {
      runtime.coverActive += 1
      /**
       * Terminal settlement for this recovery.
       *
       * `present` decides whether the row may still be written: a row that left
       * demand is cleaned up silently instead of publishing into a new epoch.
       */
      const settle = (present: () => boolean) => {
        record.state = 'settled'
        if (!present()) return
        const fallback = usableFallback(record)
        publish(item.key, { ...cacheDescriptor(item), coverUrl: fallback?.src, transientFailure: true },
          { lane: fallback ? 'pixels' : undefined, state: 'failed' })
      }
      void (async () => {
        // Snapshot the presentation this recovery was started for. The replacement
        // must not be committed over a presentation that changed in the meantime.
        // Compared by object identity, not by generation number: a row recovering
        // without a usable previous image has no presentation at all, and a numeric
        // comparison against `undefined` would either always fail or always pass.
        const startedPresentation = runtime.cache.get(item.key)?.presentation
        const itemIsCurrent = () => {
          const current = itemsByKeyRef.current.get(item.key)
          return runtime.mounted && runtime.desired.has(item.key)
            && current !== undefined && coverIdentity(current) === record.identity
        }
        let stagedUrl: string | undefined
        try {
          const coverGeneration = await coverReady
          if (!itemIsCurrent()) return
          if (coverGeneration == null) {
            record.stage = 'recovery-command'
            settle(itemIsCurrent)
            return
          }
          const priority = coverPriority(item.key)
          const read = await readRecoveryPixels(item, coverGeneration, priority, itemIsCurrent, record.startIndex)
          if (!itemIsCurrent()) {
            // Nobody to publish to: clean up the blob this attempt created.
            if (read?.image.src) releasePlaylistCoverUrl(read.image.src)
            return
          }
          if (!read) {
            record.stage = 'recovery-command'
            settle(itemIsCurrent)
            return
          }
          stagedUrl = read.image.src
          const decoded = await decodePlaylistCoverWithin(read.image, RECOVERY_DECODE_TIMEOUT_MS, runtime.controller.signal)
          if (!itemIsCurrent()) return
          if (decoded !== 'decoded') {
            record.stage = decoded === 'cancelled' ? 'recovery-command' : 'recovery-decode'
            settle(itemIsCurrent)
            return
          }
          // A commit that happened during the read wins; this result is dropped
          // rather than published over it.
          if (runtime.cache.get(item.key)?.presentation !== startedPresentation) {
            record.state = 'settled'
            return
          }
          // The row identity is unchanged, so `publish` stamps a new generation and
          // the path-lane URL stops being the current cache hit for this row.
          const committed = publish(item.key, { ...cacheDescriptor(item), coverUrl: read.image.src, image: read.image },
            { lane: 'pixels', candidateIndex: read.candidateIndex, state: 'pending' })
          if (committed) {
            stagedUrl = undefined
            record.state = 'idle'
            return
          }
          record.stage = 'recovery-command'
          settle(itemIsCurrent)
        } catch {
          record.stage = 'recovery-command'
          settle(itemIsCurrent)
        } finally {
          // Exactly one release for a blob that was never committed.
          if (stagedUrl) releasePlaylistCoverUrl(stagedUrl)
          // A cancelled or superseded job still ends its epoch: leaving the record
          // in `running` would block `takeRecoveryJob` and `reconcileRecovery` for
          // the rest of the owner's lifetime.
          if (record.state === 'running') record.state = 'settled'
          runtime.coverActive -= 1
          runtime.pump()
        }
      })()
    }

    /**
     * The previous presentation to restore when recovery fails.
     *
     * Only a snapshot the DOM actually confirmed *and* that is not the URL which
     * just failed counts as a fallback: restoring a broken URL would recreate the
     * broken element this path exists to avoid.
     */
    const usableFallback = (record: RecoveryRecord) => {
      const previous = runtime.lastPresented.get(record.key)
      if (!previous) return undefined
      if (isSameCoverUrl(previous.token.url, record.failingUrl)) return undefined
      return previous
    }

    const pump = () => {
      if (!runtime.mounted) return
      // Demand can shrink without a publication (all remaining rows cached).
      trimCache()
      // Re-entering demand opens a new retry epoch; staying in demand does not.
      reconcileRecovery()
      // Cover work is independent of the whole-library summary/duration pass.
      // Keep a small first-screen demand alive while that pass hides the list.
      while (runtime.coverActive < WINDOW_CONCURRENCY) {
        // Forced pixel recovery has its own admission table and runs ahead of
        // normal work, through the same concurrency slot.
        const recovery = takeRecoveryJob()
        if (recovery) { runRecovery(recovery.record, recovery.item); continue }
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
          // Two independent owners of a publishable URL:
          //
          // - `bitmapUrl` wraps a blob object URL created by the pixel fallback. It
          //   must be released unless it is published, which is why it is cleared
          //   only on a successful `publish`.
          // - `preparedUrl` is the URL that may be published. For the asset lane it
          //   is a protocol URL that must never be revoked: the decoded bitmap
          //   belongs to the WebView and is released when the `<img>` unmounts. Do
          //   not convert that into a reference count.
          let bitmapUrl: string | undefined
          let preparedUrl: string | undefined
          let preparedImage: PlaylistCoverImage | undefined
          let lane: CoverSourceLane | undefined
          let attemptId: string | undefined
          let candidateIndex: number | undefined
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
            // `isCurrent` states the positive contract: `true` means this row is
            // still the desired descriptor, so a prepared image may be published.
            const attemptOptions: AttemptOptions = {
              priority: coverPriority(item.key),
              signal: runtime.controller.signal,
              isCurrent: itemIsCurrent,
            }
            const pixelOptions = { priority: attemptOptions.priority, signal: attemptOptions.signal, isCurrent: itemIsCurrent }
            let hasArtwork = false
            // A candidate whose path attempt failed on a real error may still be
            // readable through the pixel lane. Tracked separately from `hasArtwork`
            // so a fully-failed row still settles as a transient failure.
            let candidateFailure = false
            if ('kind' in item && item.kind === 'track-candidates') {
              // A missing cover does not represent the whole directory: only an
              // exhausted candidate list confirms that the group has no artwork.
              for (let index = 0; index < item.candidates.length; index += 1) {
                const candidate = item.candidates[index]!
                if (!itemIsCurrent()) return
                if (!candidate.available || isStreamSource(candidate)) continue
                const attempt = await attemptTrackThumbnailPath(
                  { clientId, sourcePath: candidate.sourcePath, maxEdge: 256, windowGeneration: coverGeneration },
                  attemptOptions,
                )
                // A superseded candidate request ends this row without publishing
                // and without starting another candidate.
                if (attempt.status === 'dropped') return
                if (!itemIsCurrent()) return
                if (attempt.status === 'ready') {
                  preparedUrl = attempt.image.src
                  preparedImage = attempt.image
                  lane = 'path'
                  attemptId = attempt.attemptId
                  candidateIndex = index
                  hasArtwork = true
                  break
                }
                // Confirmed absent artwork is a verdict about this candidate only;
                // the next candidate may still have a cover.
                if (attempt.status === 'missing') continue
                // The path attempt already counted its failure. Retry this same
                // candidate once through the original pixel command, then move on.
                let pixels: Awaited<ReturnType<typeof scheduleTrackThumbnail>> = null
                try {
                  pixels = await scheduleTrackThumbnail(
                    { clientId, sourcePath: candidate.sourcePath, maxEdge: 256, windowGeneration: coverGeneration },
                    pixelOptions,
                  )
                } catch {
                  candidateFailure = true
                }
                if (!itemIsCurrent()) return
                if (pixels) {
                  const image = playlistCoverImageFromPixels(pixels)
                  bitmapUrl = image.src
                  await decodePlaylistCover(image)
                  if (!itemIsCurrent()) return
                  preparedUrl = image.src
                  preparedImage = image
                  lane = 'pixels'
                  candidateIndex = index
                  hasArtwork = true
                  break
                }
              }
            } else if ('kind' in item || !isStreamSource(item)) {
              const attempt = 'kind' in item
                ? await attemptFolderThumbnailPath(
                  { clientId, rootPath: item.rootPath, directoryPath: item.directoryPath, maxEdge: 256, windowGeneration: coverGeneration },
                  attemptOptions,
                )
                : await attemptTrackThumbnailPath(
                  { clientId, sourcePath: item.sourcePath, maxEdge: 256, windowGeneration: coverGeneration },
                  attemptOptions,
                )
              if (attempt.status === 'dropped') return
              if (!itemIsCurrent()) return
              if (attempt.status === 'ready') {
                preparedUrl = attempt.image.src
                preparedImage = attempt.image
                lane = 'path'
                attemptId = attempt.attemptId
                hasArtwork = true
              } else if (attempt.status === 'fallback') {
                // A real path failure, already counted once. The pixel lane below is
                // the single fallback; `missing` deliberately skips it, because the
                // pixel lane would decode once more only to re-learn an absence.
                const pixels = await ('kind' in item
                  ? scheduleFolderThumbnail({ clientId, rootPath: item.rootPath, directoryPath: item.directoryPath, maxEdge: 256, windowGeneration: coverGeneration }, pixelOptions)
                  : scheduleTrackThumbnail({ clientId, sourcePath: item.sourcePath, maxEdge: 256, windowGeneration: coverGeneration }, pixelOptions))
                if (!itemIsCurrent()) return
                if (pixels) {
                  const image = playlistCoverImageFromPixels(pixels)
                  bitmapUrl = image.src
                  await decodePlaylistCover(image)
                  if (!itemIsCurrent()) return
                  preparedUrl = image.src
                  preparedImage = image
                  lane = 'pixels'
                  hasArtwork = true
                }
              }
            }
            if (!itemIsCurrent()) return
            if (publish(item.key,
              { ...cacheDescriptor(item), coverUrl: preparedUrl, image: preparedImage, ...(!hasArtwork && candidateFailure ? { transientFailure: true } : {}) },
              { lane, attemptId, candidateIndex })) {
              // The store now owns the published URL, so the finally block must not
              // release it. Only an object URL needs that handoff.
              bitmapUrl = undefined
            }
          } catch {
            // Missing artwork leaves the prepared text and duration untouched.
            // Terminal failures share the bounded cache with successful and
            // missing artwork, and cannot suppress a replacement descriptor.
            if (itemIsCurrent()) publish(item.key, { ...cacheDescriptor(item), coverUrl: runtime.cache.get(item.key)?.coverUrl, transientFailure: true })
          } finally {
            if (bitmapUrl) store.retire(item.key, bitmapUrl)
            runtime.coverQueued.delete(item.key)
            runtime.coverActive -= 1
            runtime.pump()
          }
        })()
      }
    }
    runtime.pump = pump

    /**
     * Accept one DOM report for the exact snapshot this owner published.
     *
     * Every clause is a rejection reason that must not degrade into "treat it as
     * current": an unmounted owner, a superseded generation, a replaced URL, or a
     * descriptor whose identity (revision included) moved. Accepting any of those
     * would evict a good replacement and charge the cache a failure it did not
     * earn — the defect this contract exists to prevent.
     */
    const report: CoverPresentationOwner['report'] = (incoming) => {
      if (!runtime.mounted) return
      const { token } = incoming
      // Redundant with store routing, but stated here so the invariant survives a
      // future store that dispatches more loosely.
      if (token.sessionGeneration !== runtime.sessionGeneration) return
      const row = runtime.cache.get(token.key)
      const presentation = row?.presentation
      if (!presentation) return
      if (presentation.token.publishGeneration !== token.publishGeneration) return
      if (presentation.token.identity !== token.identity) return
      if (presentation.token.url !== token.url) return
      const current = itemsByKeyRef.current.get(token.key)
      if (!current || coverIdentity(current) !== token.identity) return
      if (!runtime.desired.has(token.key)) return
      // Compare browser-resolved URLs: the element reports its own resolved form,
      // which is not required to be string-identical to the published one.
      if (!isSameCoverUrl(incoming.actualUrl, presentation.token.url)) return
      if (incoming.outcome === 'loaded') {
        // A row already settled as failed has no current presentation left to
        // confirm, and a recovering row's old fallback is not a recovery success.
        if (row.presentationState === 'failed') return
        runtime.lastPresented.set(token.key, presentation)
        dropRecovery(token.key)
        if (row.presentationState !== 'presented') {
          runtime.cache.set(token.key, { ...row, presentationState: 'presented', transientFailure: undefined })
          store.notify(token.key)
        }
        return
      }
      // Failed, and current. Only the first report for this presentation acts.
      if (row.presentationState !== 'pending') return
      if (row.transientFailure) return
      const existing = runtime.recovery.get(token.key)
      const sameEpoch = existing?.identity === token.identity
      if (row.sourceLane === 'path' && row.pathAttemptId) {
        // A path attempt that predecoded and then failed in the DOM is a real
        // failure of that one attempt: charged once, never once per `<img>`.
        notePathLanePresentationFailure(row.pathAttemptId)
      }
      if (sameEpoch && existing.attempted) {
        // This epoch's single recovery is already spent — either it ran and the
        // replacement failed too, or the pixel lane was already the source. Settle
        // as a bounded failure instead of queueing another job.
        existing.state = 'settled'
        const spentFallback = usableFallback(existing)
        publish(token.key, { ...cacheDescriptor(current), coverUrl: spentFallback?.src, transientFailure: true },
          { lane: spentFallback ? 'pixels' : undefined, state: 'failed' })
        return
      }
      if (row.sourceLane !== 'path') {
        // Already the pixel lane: it is the last resort, so there is nothing left to
        // force. Record that the epoch is spent so a later report cannot reopen it.
        const record: RecoveryRecord = {
          key: token.key, identity: token.identity,
          epoch: sameEpoch ? existing.epoch : 0,
          attempted: true, state: 'settled', stage: 'dom',
          startIndex: row.candidateIndex ?? 0, failingUrl: token.url,
        }
        runtime.recovery.set(token.key, record)
        const pixelFallback = usableFallback(record)
        publish(token.key, { ...cacheDescriptor(current), coverUrl: pixelFallback?.src, transientFailure: true },
          { lane: pixelFallback ? 'pixels' : undefined, state: 'failed' })
        return
      }
      const record: RecoveryRecord = {
        key: token.key,
        identity: token.identity,
        epoch: sameEpoch ? existing.epoch : 0,
        // `takeRecoveryJob` flips this when the job is actually admitted, so a
        // recovery dropped before admission can be re-queued by the same epoch.
        attempted: false,
        state: 'queued',
        startIndex: row.candidateIndex ?? 0,
        failingUrl: token.url,
      }
      runtime.recovery.set(token.key, record)
      // Replace the failed URL on screen immediately: a broken element must not
      // stay mounted while the recovery runs. A DOM-confirmed previous image is
      // restored instead; a row without one falls back to the normal placeholder.
      // The committed fallback gets its own generation so the failed snapshot's
      // late reports can never be mistaken for this one.
      const fallback = usableFallback(record)
      if (fallback) {
        const publishGeneration = (runtime.publishSequences.get(token.key) ?? 0) + 1
        runtime.publishSequences.set(token.key, publishGeneration)
        record.recoveryGeneration = publishGeneration
        runtime.cache.set(token.key, {
          ...row,
          coverUrl: fallback.src,
          image: fallback.image,
          presentation: {
            ...(fallback.image ? { image: fallback.image } : {}),
            src: fallback.src,
            token: { ...fallback.token, key: token.key, identity: token.identity, publishGeneration },
          },
          presentationState: 'recovering',
          sourceLane: 'pixels',
          pathAttemptId: undefined,
        })
      } else {
        // No usable previous image: render the placeholder, but keep the cached
        // descriptor so the pump treats this as a settled row rather than a new one.
        record.recoveryGeneration = undefined
        runtime.cache.set(token.key, {
          ...row,
          coverUrl: undefined,
          image: undefined,
          presentation: undefined,
          presentationState: 'recovering',
          sourceLane: undefined,
          pathAttemptId: undefined,
        })
      }
      store.notify(token.key)
      pump()
    }
    store.owners.set(runtime.sessionGeneration, { report })

    const onReport = (event: Event) => {
      const detail = coverImageEventDetail(event)
      if (!detail?.token) return
      store.reportPresentation({ token: detail.token, actualUrl: detail.actualUrl, outcome: event.type === COVER_IMAGE_LOAD_EVENT ? 'loaded' : 'failed' })
    }
    window.addEventListener(COVER_IMAGE_LOAD_EVENT, onReport)
    window.addEventListener(COVER_IMAGE_ERROR_EVENT, onReport)

    pump()
    return () => {
      runtime.mounted = false
      runtime.controller.abort()
      runtime.desired.clear()
      runtime.visible.clear()
      replacements.disconnect()
      window.removeEventListener(COVER_IMAGE_LOAD_EVENT, onReport)
      window.removeEventListener(COVER_IMAGE_ERROR_EVENT, onReport)
      if (store.owners.get(runtime.sessionGeneration)?.report === report) store.owners.delete(runtime.sessionGeneration)
      runtime.recovery.clear()
      runtime.demandSeen.clear()
      runtime.lastPresented.clear()
      runtime.publishSequences.clear()
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
      // identity/revision changed: the old failure record describes a different
      // resource and must not gate the new one.
      runtimeRef.current?.recovery.delete(item.key)
      runtimeRef.current?.lastPresented.delete(item.key)
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
    // One resource may appear in a hero, entry row and several cards. Keep DOM
    // occurrences separate; an offscreen copy cannot cancel a visible owner.
    const nodes = new Map<HTMLElement, { key: string; domIndex: number }>()
    const nodesByKey = new Map<string, Set<HTMLElement>>()
    const intersectionsByKey = new Map<string, Set<HTMLElement>>()
    const nodeKey = (element: HTMLElement) => element.dataset.coverKey ?? element.dataset.songKey
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
        let closest: { key: string; domIndex: number; rowTop: number; inViewport: boolean; side: -1 | 0 | 1; viewportDistance: number } | undefined
        for (const element of nodesByKey.get(key) ?? []) {
          const node = nodes.get(element)
          if (!node || !element.isConnected) continue
          const rect = element.getBoundingClientRect()
          const inViewport = rect.bottom > bounds.top && rect.top < bounds.bottom
          const side: -1 | 0 | 1 = inViewport ? 0 : rect.bottom <= bounds.top ? -1 : 1
          const viewportDistance = inViewport ? 0 : side < 0 ? bounds.top - rect.bottom : rect.top - bounds.bottom
          const candidate = { key, domIndex: node.domIndex, rowTop: element.offsetTop, inViewport, side, viewportDistance }
          if (!closest || candidate.inViewport && !closest.inViewport || candidate.inViewport === closest.inViewport && candidate.viewportDistance < closest.viewportDistance) closest = candidate
        }
        if (closest) entries.push(closest)
        else unmeasured.push(key)
      }
      runtime.desired = new Set([...orderPlaylistArtworkRows(entries, state.direction).map(entry => entry.key), ...unmeasured])
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
      const changed = new Set<string>()
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        const node = nodes.get(element)
        if (!node) continue
        const intersections = intersectionsByKey.get(node.key) ?? new Set<HTMLElement>()
        if (entry.isIntersecting) intersections.add(element)
        else intersections.delete(element)
        intersectionsByKey.set(node.key, intersections)
        changed.add(node.key)
      }
      for (const key of changed) {
        if (intersectionsByKey.get(key)?.size) runtime.desired.add(key)
        else runtime.desired.delete(key)
      }
      reorder()
    }, { root: panel, rootMargin: '150px 0px' })
    // Reconcile actual mounted owners, including nested virtual grids and hero
    // siblings. Descriptor count never implies a matching direct-children shape.
    const observeRendered = (nextRendered: readonly AllSongsCoverItem[]) => {
      if (!observing || !runtime.mounted) return
      const wanted = new Set(nextRendered.map(item => item.key))
      const mounted = [...list.querySelectorAll<HTMLElement>('[data-cover-key], [data-song-key]')]
        .filter(element => wanted.has(nodeKey(element) ?? ''))
      const current = new Set(mounted)
      for (const [element, node] of nodes) {
        if (current.has(element) && nodeKey(element) === node.key) continue
        observer.unobserve(element)
        nodes.delete(element)
        nodesByKey.get(node.key)?.delete(element)
        intersectionsByKey.get(node.key)?.delete(element)
        if (!intersectionsByKey.get(node.key)?.size) runtime.desired.delete(node.key)
        if (!nodesByKey.get(node.key)?.size) { nodesByKey.delete(node.key); intersectionsByKey.delete(node.key) }
      }
      mounted.forEach((element, domIndex) => {
        const existing = nodes.get(element)
        if (existing) { existing.domIndex = domIndex; return }
        const key = nodeKey(element)!
        nodes.set(element, { key, domIndex })
        const occurrences = nodesByKey.get(key) ?? new Set<HTMLElement>()
        occurrences.add(element)
        nodesByKey.set(key, occurrences)
        observer.observe(element)
      })
      scheduleReorder()
    }
    observeRenderedRef.current = observeRendered
    observeRendered([...itemsByKeyRef.current.values()].filter(item => renderedKeysRef.current.has(item.key)))
    panel.addEventListener('scroll', onScroll, { passive: true })
    const resize = new ResizeObserver(scheduleReorder)
    resize.observe(panel)
    resize.observe(list)
    return () => {
      observing = false
      observeRenderedRef.current = null
      observer.disconnect()
      resize.disconnect()
      panel.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [itemOrderKey, panelRef, listRef, enabled, metadataLoading])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!enabled || !runtime) return
    const keys = new Set(renderedItems.map(item => item.key))
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
