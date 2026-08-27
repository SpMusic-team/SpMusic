import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Track, TrackArtwork, TrackArtworkPrefetchCandidate } from '@/features/player/model/playerTypes'
import {
  isAudioCoverPixelsError,
  loadAudioCoverPixels,
  noteWebviewUiBurstSettled,
  type AudioCoverPixels,
  type AudioLoadCoverPixelsInput,
} from '@/features/player/services/audioCommands'

export type ArtworkLayerPhase = 'incoming' | 'active' | 'exiting'
export type ArtworkLayerConsumer = 'ambient' | 'cover'

export type ArtworkSourceView = Readonly<{
  source: HTMLCanvasElement
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  contentRevision: number
}>

export type OwnedArtworkResource = {
  view?: ArtworkSourceView
  retain: () => () => void
  releaseCache: () => void
}

type ArtworkCanvasPoolDebug = {
  created: number
  leased: number
  peakLeased: number
  waiters: number
  maxWaiters: number
  staleWrites: number
  useAfterRelease: number
  backingResizeCount: number
  backingEdges: number[]
}

type ArtworkCanvasPoolEntry = {
  canvas: HTMLCanvasElement
  backingEdge: number
  debugIndex: number
}

type ArtworkCanvasLease = {
  canvas: HTMLCanvasElement
  backingEdge: number
  isActive: () => boolean
  release: () => void
  recordUseAfterRelease: () => void
}

type ArtworkCanvasPool = {
  acquire: (
    signal: AbortSignal,
    backingEdge: AudioLoadCoverPixelsInput['maxEdge'],
  ) => Promise<ArtworkCanvasLease | null>
  dispose: () => void
}

function createArtworkCanvasPool(): ArtworkCanvasPool {
  const entries = Array.from({ length: 3 }, (_, debugIndex): ArtworkCanvasPoolEntry => ({
    canvas: document.createElement('canvas'),
    backingEdge: 0,
    debugIndex,
  }))
  const available = [...entries]
  const debug: ArtworkCanvasPoolDebug = {
    created: entries.length,
    leased: 0,
    peakLeased: 0,
    waiters: 0,
    maxWaiters: 0,
    staleWrites: 0,
    useAfterRelease: 0,
    backingResizeCount: 0,
    backingEdges: entries.map(() => 0),
  }
  if (import.meta.env.DEV) {
    ;(window as Window & { __SPMUSIC_ARTWORK_CANVAS_POOL__?: ArtworkCanvasPoolDebug })
      .__SPMUSIC_ARTWORK_CANVAS_POOL__ = debug
  }

  let disposed = false
  let waiter: {
    signal: AbortSignal
    backingEdge: AudioLoadCoverPixelsInput['maxEdge']
    resolve: (lease: ArtworkCanvasLease | null) => void
    abort: () => void
  } | null = null

  const prepareEntry = (
    entry: ArtworkCanvasPoolEntry,
    requestedEdge: AudioLoadCoverPixelsInput['maxEdge'],
  ) => {
    if (entry.backingEdge >= requestedEdge) return
    entry.canvas.width = requestedEdge
    entry.canvas.height = requestedEdge
    entry.backingEdge = requestedEdge
    debug.backingResizeCount += 1
    debug.backingEdges[entry.debugIndex] = requestedEdge
  }

  const makeLease = (
    entry: ArtworkCanvasPoolEntry,
    requestedEdge: AudioLoadCoverPixelsInput['maxEdge'],
  ): ArtworkCanvasLease => {
    prepareEntry(entry, requestedEdge)
    let active = true
    debug.leased += 1
    debug.peakLeased = Math.max(debug.peakLeased, debug.leased)
    return {
      canvas: entry.canvas,
      backingEdge: entry.backingEdge,
      isActive: () => active && !disposed,
      recordUseAfterRelease: () => { debug.useAfterRelease += 1 },
      release: () => {
        if (!active) return
        active = false
        debug.leased -= 1
        if (disposed) return
        const pending = waiter
        if (pending) {
          waiter = null
          debug.waiters = 0
          pending.signal.removeEventListener('abort', pending.abort)
          if (!pending.signal.aborted) {
            pending.resolve(makeLease(entry, pending.backingEdge))
            return
          }
          pending.resolve(null)
        }
        available.push(entry)
      },
    }
  }

  return {
    acquire: (signal, backingEdge) => {
      if (disposed || signal.aborted) return Promise.resolve(null)
      const entry = available.pop()
      if (entry) return Promise.resolve(makeLease(entry, backingEdge))
      if (waiter) {
        const superseded = waiter
        waiter = null
        superseded.signal.removeEventListener('abort', superseded.abort)
        superseded.resolve(null)
      }
      return new Promise((resolve) => {
        const abort = () => {
          if (waiter?.resolve !== resolve) return
          waiter = null
          debug.waiters = 0
          resolve(null)
        }
        waiter = { signal, backingEdge, resolve, abort }
        debug.waiters = 1
        debug.maxWaiters = Math.max(debug.maxWaiters, debug.waiters)
        signal.addEventListener('abort', abort, { once: true })
      })
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      if (waiter) {
        const pending = waiter
        waiter = null
        debug.waiters = 0
        pending.signal.removeEventListener('abort', pending.abort)
        pending.resolve(null)
      }
      for (const entry of entries) {
        entry.canvas.width = 0
        entry.canvas.height = 0
        entry.backingEdge = 0
        debug.backingEdges[entry.debugIndex] = 0
      }
    },
  }
}

type ArtworkResourceRegistryEntry = {
  resource: OwnedArtworkResource
  fallbackSource?: string
}

export type ArtworkVisualLayer = {
  id: number
  identity: string
  track: Track
  artwork: TrackArtwork
  phase: ArtworkLayerPhase
  resource: OwnedArtworkResource
  requestedArtwork: TrackArtwork
  fallbackSource?: string
  slot: 0 | 1 | null
  releaseLayerLease: () => void
}

type UseArtworkVisualResourceResult = {
  slots: readonly [ArtworkVisualLayer | null, ArtworkVisualLayer | null]
  currentArtworkReady: boolean
  markReady: (layerId: number) => void
  markLoadError: (layerId: number) => void
  markExitComplete: (layerId: number, consumer: ArtworkLayerConsumer) => void
}

type LoadedArtworkResource = {
  resource: OwnedArtworkResource
  fallbackSource?: string
}

type PreparedArtwork = {
  identity: string
  afterTrackId: string
  track: Track
  artwork: TrackArtwork
  controller: AbortController
  promise: Promise<LoadedArtworkResource | null>
  resource?: OwnedArtworkResource
  promoted: boolean
}

type ArtworkPrefetchDebug = {
  prepared: number
  inFlight: number
  peakPrepared: number
  started: number
  ready: number
  promoted: number
  promotedInFlight: number
  evicted: number
  foregroundLoads: number
  foregroundInFlight: number
  foregroundDeduplicated: number
  coldDebounceWaits: number
  coldDebounced: number
  uiBurstReports: number
  uiBurstActivityUnits: number[]
  uiBurstLastSequence: number
  uiBurstReportErrors: number
  foregroundPreemptions: number
  foregroundRetries: number
  coverPixelInvokes: number
}

function createOwnedArtworkResource(
  lease?: ArtworkCanvasLease,
  view?: ArtworkSourceView,
  cacheOwned = false,
): OwnedArtworkResource {
  let referenceCount = cacheOwned ? 1 : 0
  let cacheReleased = !cacheOwned
  let released = false

  const releaseIfUnused = () => {
    if (referenceCount !== 0 || released) return
    released = true
    lease?.release()
  }

  return {
    get view() {
      if (!lease || !view) return undefined
      if (released || !lease.isActive()) {
        lease.recordUseAfterRelease()
        return undefined
      }
      return view
    },
    retain: () => {
      if (released) {
        lease?.recordUseAfterRelease()
        return () => undefined
      }
      let leaseReleased = false
      referenceCount += 1
      return () => {
        if (leaseReleased) return
        leaseReleased = true
        referenceCount -= 1
        releaseIfUnused()
      }
    },
    releaseCache: () => {
      if (cacheReleased) return
      cacheReleased = true
      referenceCount -= 1
      releaseIfUnused()
    },
  }
}

function artworkIdentity(track: Track, artwork: TrackArtwork): string {
  return [
    track.id,
    artwork.id,
    artwork.coverTone,
    artwork.coverFilePath ?? '',
    artwork.coverImage ?? '',
    artwork.coverImageFallback ?? '',
  ].join('\u0000')
}

function artworkResourceIdentity(
  track: Track,
  artwork: TrackArtwork,
): string {
  // Decode size is a resource-production detail, not visible artwork identity.
  // Keeping it out of the layer key lets a resize retain the current active
  // layer and its first decoded resource instead of fabricating a crossfade.
  return artworkIdentity(track, artwork)
}

async function fetchArtworkBlob(source: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error(`Artwork request failed with ${response.status}`)
  return response.blob()
}

const COVER_EDGE_BUCKETS: AudioLoadCoverPixelsInput['maxEdge'][] = [1024, 1536, 2048, 3072]
// Load-shed only fully cold artwork during rapid selection. Without trailing debounce,
// 10 selections at 80 ms drove foreground invokes from 2 to 12 and the final cover to
// 4.47 s; the trailing strategy previously brought the final cover to about 2.55 s.
const COLD_ARTWORK_RAPID_SELECTION_DEBOUNCE_MS = 110
const COVER_REQUEST_ID_STORAGE_KEY = 'spmusic.audio.cover-pixels.request-id'
let lastCoverRequestId = 0

try {
  const stored = Number.parseInt(window.sessionStorage.getItem(COVER_REQUEST_ID_STORAGE_KEY) ?? '', 10)
  if (Number.isSafeInteger(stored) && stored > 0) lastCoverRequestId = stored
} catch {
  // sessionStorage can be disabled; the wall-clock seed still survives ordinary HMR.
}

function nextCoverRequestId(): number {
  const wallClockSeed = Date.now() * 1000
  const next = Math.max(lastCoverRequestId + 1, wallClockSeed)
  if (!Number.isSafeInteger(next) || next <= 0 || next > Number.MAX_SAFE_INTEGER) {
    throw new Error('Cover requestId exceeded the JavaScript safe integer range')
  }
  lastCoverRequestId = next
  try {
    window.sessionStorage.setItem(COVER_REQUEST_ID_STORAGE_KEY, String(next))
  } catch {
    // Best-effort persistence only; monotonicity within this module remains enforced.
  }
  return next
}

function selectCoverMaxEdge(): AudioLoadCoverPixelsInput['maxEdge'] {
  const frames = Array.from(document.querySelectorAll<HTMLElement>('.cover-frame'))
  const measuredCssEdge = frames.reduce(
    (largest, frame) => Math.max(largest, frame.clientWidth, frame.clientHeight),
    0,
  )
  const estimatedCssEdge = measuredCssEdge || Math.min(window.innerWidth, window.innerHeight) * 0.8
  const physicalEdge = Math.ceil(estimatedCssEdge * Math.max(1, window.devicePixelRatio || 1))
  return COVER_EDGE_BUCKETS.find((bucket) => bucket >= physicalEdge) ?? 3072
}

function waitForColdArtworkRapidSelection(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const settle = (isTrailingSelection: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timerId)
      signal.removeEventListener('abort', abort)
      resolve(isTrailingSelection)
    }
    const abort = () => settle(false)
    const timerId = window.setTimeout(
      () => settle(true),
      COLD_ARTWORK_RAPID_SELECTION_DEBOUNCE_MS,
    )
    signal.addEventListener('abort', abort, { once: true })
  })
}

type ArtworkContentRect = Pick<
  ArtworkSourceView,
  'contentX' | 'contentY' | 'contentWidth' | 'contentHeight'
>

function writePixelsToCanvas(
  lease: ArtworkCanvasLease,
  pixels: AudioCoverPixels,
): ArtworkContentRect {
  if (pixels.width > lease.backingEdge || pixels.height > lease.backingEdge) {
    throw new Error('Artwork pixels exceed the fixed canvas backing')
  }
  const context = lease.canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Canvas 2D context is unavailable')
  context.putImageData(new ImageData(pixels.pixels, pixels.width, pixels.height), 0, 0)
  return { contentX: 0, contentY: 0, contentWidth: pixels.width, contentHeight: pixels.height }
}

async function writeImageToCanvas(
  source: string,
  lease: ArtworkCanvasLease,
  maxEdge: AudioLoadCoverPixelsInput['maxEdge'],
  signal: AbortSignal,
  canWrite: () => boolean,
): Promise<ArtworkContentRect | false> {
  const blob = await fetchArtworkBlob(source, signal)
  const objectUrl = URL.createObjectURL(blob)
  const image = new Image()
  const abort = () => { image.src = '' }
  signal.addEventListener('abort', abort, { once: true })
  try {
    image.src = objectUrl
    await image.decode()
    if (signal.aborted || !canWrite()) return false
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const contentWidth = Math.max(1, Math.round(image.naturalWidth * scale))
    const contentHeight = Math.max(1, Math.round(image.naturalHeight * scale))
    if (contentWidth > lease.backingEdge || contentHeight > lease.backingEdge) {
      throw new Error('Artwork image exceeds the fixed canvas backing')
    }
    const context = lease.canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Artwork image could not be drawn')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.clearRect(0, 0, contentWidth, contentHeight)
    context.drawImage(image, 0, 0, contentWidth, contentHeight)
    return { contentX: 0, contentY: 0, contentWidth, contentHeight }
  } finally {
    signal.removeEventListener('abort', abort)
    image.src = ''
    URL.revokeObjectURL(objectUrl)
  }
}

export function useArtworkResourceConsumer(resource?: OwnedArtworkResource) {
  useEffect(() => resource?.retain(), [resource])
}

export function useArtworkVisualResource(
  requestedArtwork: TrackArtwork | null,
  track: Track | null,
  detailsPending: boolean,
  prefetchCandidate: TrackArtworkPrefetchCandidate | null,
  selectionActivitySequence: number,
): UseArtworkVisualResourceResult {
  const [layers, setLayers] = useState<ArtworkVisualLayer[]>([])
  const [coverMaxEdge, setCoverMaxEdge] = useState(selectCoverMaxEdge)
  const [uiBurstReportRevision, setUiBurstReportRevision] = useState(0)
  const canvasPoolRef = useRef<ArtworkCanvasPool | null>(null)
  const contentRevisionRef = useRef(0)
  const layersRef = useRef<ArtworkVisualLayer[]>([])
  const queuedLayerRef = useRef<ArtworkVisualLayer | null>(null)
  const generationRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const foregroundRequestRef = useRef<{
    identity: string
    controller: AbortController
  } | null>(null)
  const preparedArtworkRef = useRef<PreparedArtwork | null>(null)
  const promotedArtworkRef = useRef<PreparedArtwork | null>(null)
  const lastReportedActivitySequenceRef = useRef(0)
  const latestActivitySequenceRef = useRef(selectionActivitySequence)
  const uiBurstReportInFlightRef = useRef(false)
  const resourceRegistryRef = useRef(new Map<string, ArtworkResourceRegistryEntry>())
  const slotFlushFrameRef = useRef<number | null>(null)
  const clearingSlotsRef = useRef(new Set<0 | 1>())
  const layerIdRef = useRef(0)
  const exitCompletionsRef = useRef(new Map<number, Set<ArtworkLayerConsumer>>())
  const matchingPrefetchCandidate = track && prefetchCandidate?.track.id === track.id
    ? prefetchCandidate
    : null
  const effectiveTrack = matchingPrefetchCandidate?.track ?? track
  const effectiveArtwork = matchingPrefetchCandidate?.artwork ?? requestedArtwork
  const latestRequestRef = useRef({ requestedArtwork: effectiveArtwork, track: effectiveTrack })
  const latestArtworkDetailsReadyRef = useRef(!detailsPending || Boolean(matchingPrefetchCandidate))
  const prefetchDebugRef = useRef<ArtworkPrefetchDebug>({
    prepared: 0,
    inFlight: 0,
    peakPrepared: 0,
    started: 0,
    ready: 0,
    promoted: 0,
    promotedInFlight: 0,
    evicted: 0,
    foregroundLoads: 0,
    foregroundInFlight: 0,
    foregroundDeduplicated: 0,
    coldDebounceWaits: 0,
    coldDebounced: 0,
    uiBurstReports: 0,
    uiBurstActivityUnits: [],
    uiBurstLastSequence: 0,
    uiBurstReportErrors: 0,
    foregroundPreemptions: 0,
    foregroundRetries: 0,
    coverPixelInvokes: 0,
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const devWindow = window as Window & { __SPMUSIC_ARTWORK_PREFETCH__?: ArtworkPrefetchDebug }
    devWindow.__SPMUSIC_ARTWORK_PREFETCH__ = prefetchDebugRef.current
    return () => { delete devWindow.__SPMUSIC_ARTWORK_PREFETCH__ }
  }, [])

  const getCanvasPool = useCallback(() => {
    if (!canvasPoolRef.current) canvasPoolRef.current = createArtworkCanvasPool()
    return canvasPoolRef.current
  }, [])

  const commitCanvasLease = useCallback((
    lease: ArtworkCanvasLease,
    contentRect: ArtworkContentRect,
  ) => {
    contentRevisionRef.current += 1
    const view: ArtworkSourceView = Object.freeze({
      source: lease.canvas,
      ...contentRect,
      contentRevision: contentRevisionRef.current,
    })
    return createOwnedArtworkResource(lease, view, true)
  }, [])

  const loadArtworkResource = useCallback(async (
    artwork: TrackArtwork,
    controller: AbortController,
    purpose: 'foreground' | 'prefetch',
  ): Promise<LoadedArtworkResource | null> => {
    const { signal } = controller
    const requestFilePath = artwork.coverFilePath
    const primary = artwork.coverImage ?? artwork.coverImageFallback
    const secondary = artwork.coverImage ? artwork.coverImageFallback : undefined
    if (!requestFilePath && !primary) {
      return { resource: createOwnedArtworkResource() }
    }

    const lease = await getCanvasPool().acquire(signal, coverMaxEdge)
    if (!lease || signal.aborted) {
      lease?.release()
      return null
    }

    // Tauri invokes are not cancellable from JavaScript. Return the bounded backing
    // canvas immediately so a foreground request never waits for an obsolete prefetch.
    const releaseLeaseOnAbort = () => lease.release()
    signal.addEventListener('abort', releaseLeaseOnAbort, { once: true })
    try {

      const loadImageFallback = async (): Promise<LoadedArtworkResource | null> => {
      if (!primary) {
        lease.release()
        return signal.aborted ? null : { resource: createOwnedArtworkResource() }
      }
      const sources = secondary && secondary !== primary ? [primary, secondary] : [primary]
      for (const candidate of sources) {
        try {
          const contentRect = await writeImageToCanvas(
            candidate,
            lease,
            coverMaxEdge,
            signal,
            () => !signal.aborted && lease.isActive(),
          )
          if (!contentRect || signal.aborted || !lease.isActive()) {
            lease.release()
            return null
          }
          return {
            resource: commitCanvasLease(lease, contentRect),
            fallbackSource: candidate === primary ? secondary : undefined,
          }
        } catch {
          if (signal.aborted || !lease.isActive()) {
            lease.release()
            return null
          }
        }
      }
      lease.release()
      return signal.aborted ? null : { resource: createOwnedArtworkResource() }
      }

      if (!requestFilePath) return loadImageFallback()

      let requestId: number
      try {
        requestId = nextCoverRequestId()
      } catch {
        return loadImageFallback()
      }
      prefetchDebugRef.current.coverPixelInvokes += 1
      if (purpose === 'foreground') prefetchDebugRef.current.foregroundLoads += 1
      try {
        const pixels = await loadAudioCoverPixels({
          filePath: requestFilePath,
          maxEdge: coverMaxEdge,
          requestId,
        })
        if (signal.aborted || !lease.isActive()) {
          lease.release()
          return null
        }
        const contentRect = writePixelsToCanvas(lease, pixels)
        if (signal.aborted || !lease.isActive()) {
          lease.release()
          return null
        }
        return {
          resource: commitCanvasLease(lease, contentRect),
          fallbackSource: primary ?? secondary,
        }
      } catch (error: unknown) {
        if (isAudioCoverPixelsError(error) && error.code === 'STALE_REQUEST') {
          lease.release()
          return null
        }
        if (signal.aborted || !lease.isActive()) {
          lease.release()
          return null
        }
        return loadImageFallback()
      }
    } finally {
      signal.removeEventListener('abort', releaseLeaseOnAbort)
    }
  }, [commitCanvasLease, coverMaxEdge, getCanvasPool])

  useLayoutEffect(() => {
    latestRequestRef.current = { requestedArtwork: effectiveArtwork, track: effectiveTrack }
    latestArtworkDetailsReadyRef.current = !detailsPending || Boolean(matchingPrefetchCandidate)
  }, [detailsPending, effectiveArtwork, effectiveTrack, matchingPrefetchCandidate])

  useLayoutEffect(() => {
    latestActivitySequenceRef.current = selectionActivitySequence
  }, [selectionActivitySequence])

  useLayoutEffect(() => {
    let frameId: number | null = null
    const update = () => {
      frameId = null
      setCoverMaxEdge(selectCoverMaxEdge())
    }
    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(scheduleUpdate)
    for (const frame of document.querySelectorAll('.cover-frame')) observer.observe(frame)
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [track?.id])

  const replaceLayers = useCallback((nextLayers: ArtworkVisualLayer[]) => {
    layersRef.current = nextLayers
    setLayers(nextLayers)
  }, [])

  const releaseLayerOwner = useCallback((layer: ArtworkVisualLayer) => {
    exitCompletionsRef.current.delete(layer.id)
    layer.releaseLayerLease()
  }, [])

  const registryGet = useCallback((identity: string) => {
    const registry = resourceRegistryRef.current
    const entry = registry.get(identity)
    if (!entry) return undefined
    registry.delete(identity)
    registry.set(identity, entry)
    return entry
  }, [])

  const registryDelete = useCallback((identity: string, resource?: OwnedArtworkResource) => {
    const registry = resourceRegistryRef.current
    const entry = registry.get(identity)
    if (!entry || (resource && entry.resource !== resource)) return
    registry.delete(identity)
    entry.resource.releaseCache()
  }, [])

  const registrySet = useCallback((
    identity: string,
    entry: ArtworkResourceRegistryEntry,
  ) => {
    const registry = resourceRegistryRef.current
    const previous = registry.get(identity)
    if (previous && previous.resource !== entry.resource) previous.resource.releaseCache()
    registry.delete(identity)
    registry.set(identity, entry)
    while (registry.size > 2) {
      const oldestIdentity = registry.keys().next().value
      if (oldestIdentity === undefined) break
      const oldest = registry.get(oldestIdentity)
      registry.delete(oldestIdentity)
      oldest?.resource.releaseCache()
    }
  }, [])

  const clearRegistry = useCallback(() => {
    for (const entry of resourceRegistryRef.current.values()) entry.resource.releaseCache()
    resourceRegistryRef.current.clear()
  }, [])

  const evictPreparedArtwork = useCallback((prepared = preparedArtworkRef.current) => {
    if (!prepared || preparedArtworkRef.current !== prepared) return
    preparedArtworkRef.current = null
    prepared.controller.abort()
    if (prepared.resource) registryDelete(prepared.identity, prepared.resource)
    const debug = prefetchDebugRef.current
    debug.prepared = 0
    debug.inFlight = 0
    debug.evicted += 1
  }, [registryDelete])

  const installQueuedLayer = useCallback((baseLayers: ArtworkVisualLayer[]) => {
    const queued = queuedLayerRef.current
    const availableSlot = ([0, 1] as const).find(
      (slot) => !clearingSlotsRef.current.has(slot) && !baseLayers.some((layer) => layer.slot === slot),
    )
    if (
      !queued
      || availableSlot === undefined
      || baseLayers.some((layer) => layer.phase === 'exiting')
    ) {
      return baseLayers
    }
    queuedLayerRef.current = null
    return [...baseLayers, { ...queued, slot: availableSlot }]
  }, [])

  const scheduleSlotRelease = useCallback((slot: 0 | 1) => {
    clearingSlotsRef.current.add(slot)
    if (slotFlushFrameRef.current !== null) return
    slotFlushFrameRef.current = requestAnimationFrame(() => {
      slotFlushFrameRef.current = null
      clearingSlotsRef.current.clear()
      replaceLayers(installQueuedLayer(layersRef.current))
    })
  }, [installQueuedLayer, replaceLayers])

  const enqueueOrInstall = useCallback((nextLayer: ArtworkVisualLayer) => {
    let currentLayers = layersRef.current
    const incoming = currentLayers.find((layer) => layer.phase === 'incoming')
    if (incoming) {
      currentLayers = currentLayers.filter((layer) => layer.id !== incoming.id)
      releaseLayerOwner(incoming)
      if (incoming.slot !== null) scheduleSlotRelease(incoming.slot)
    }

    const availableSlot = ([0, 1] as const).find(
      (slot) => !clearingSlotsRef.current.has(slot) && !currentLayers.some((layer) => layer.slot === slot),
    )
    if (availableSlot !== undefined && !currentLayers.some((layer) => layer.phase === 'exiting')) {
      replaceLayers([...currentLayers, { ...nextLayer, slot: availableSlot }])
      return
    }

    const previousQueued = queuedLayerRef.current
    if (previousQueued) releaseLayerOwner(previousQueued)
    queuedLayerRef.current = nextLayer
    if (currentLayers !== layersRef.current) replaceLayers(currentLayers)
  }, [releaseLayerOwner, replaceLayers, scheduleSlotRelease])

  const createLayer = useCallback((
    currentTrack: Track,
    artwork: TrackArtwork,
    identity: string,
    resource: OwnedArtworkResource,
    fallbackSource?: string,
  ): ArtworkVisualLayer => {
    layerIdRef.current += 1
    const releaseLayerLease = resource.retain()
    return {
      id: layerIdRef.current,
      identity,
      track: currentTrack,
      artwork: {
        ...artwork,
      },
      phase: 'incoming',
      resource,
      requestedArtwork: artwork,
      fallbackSource,
      slot: null,
      releaseLayerLease,
    }
  }, [])

  const markReady = useCallback((layerId: number) => {
    const currentLayers = layersRef.current
    const incoming = currentLayers.find((layer) => layer.id === layerId && layer.phase === 'incoming')
    if (!incoming) return

    const nextLayers = currentLayers.map((layer): ArtworkVisualLayer => {
      if (layer.id === layerId) return { ...layer, phase: 'active' }
      if (layer.phase === 'active') return { ...layer, phase: 'exiting' }
      return layer
    })
    replaceLayers(nextLayers)
  }, [replaceLayers])

  const markLoadError = useCallback((layerId: number) => {
    const failedLayer = layersRef.current.find(
      (layer) => layer.id === layerId && layer.phase === 'incoming',
    )
    if (!failedLayer) return

    registryDelete(failedLayer.identity, failedLayer.resource)
    releaseLayerOwner(failedLayer)
    replaceLayers(layersRef.current.filter((layer) => layer.id !== layerId))
    if (failedLayer.slot !== null) scheduleSlotRelease(failedLayer.slot)
    generationRef.current += 1
    const generation = generationRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller

    const isCurrent = () => {
      const latest = latestRequestRef.current
      const latestIdentity = latest.track && latest.requestedArtwork
        ? artworkResourceIdentity(latest.track, latest.requestedArtwork)
        : null
      return !controller.signal.aborted
        && generation === generationRef.current
        && latestIdentity === failedLayer.identity
    }

    const installFallback = (resource: OwnedArtworkResource) => {
      if (!isCurrent()) {
        resource.releaseCache()
        return
      }
      if (resource.view) registrySet(failedLayer.identity, { resource })
      enqueueOrInstall(createLayer(
        failedLayer.track,
        failedLayer.requestedArtwork,
        failedLayer.identity,
        resource,
      ))
    }

    if (!failedLayer.fallbackSource) {
      installFallback(createOwnedArtworkResource())
      return
    }

    const pool = getCanvasPool()
    void pool.acquire(controller.signal, coverMaxEdge).then(async (lease) => {
      if (!lease) return
      if (!isCurrent() || !lease.isActive()) {
        lease.release()
        return
      }
      try {
        const contentRect = await writeImageToCanvas(
          failedLayer.fallbackSource!,
          lease,
          coverMaxEdge,
          controller.signal,
          () => isCurrent() && lease.isActive(),
        )
        if (!contentRect || !isCurrent() || !lease.isActive()) {
          lease.release()
          return
        }
        installFallback(commitCanvasLease(lease, contentRect))
      } catch {
        lease.release()
        if (isCurrent()) installFallback(createOwnedArtworkResource())
      }
    })
  }, [commitCanvasLease, coverMaxEdge, createLayer, enqueueOrInstall, getCanvasPool, registryDelete, registrySet, releaseLayerOwner, replaceLayers, scheduleSlotRelease])

  const markExitComplete = useCallback((layerId: number, consumer: ArtworkLayerConsumer) => {
    const layer = layersRef.current.find((candidate) => candidate.id === layerId)
    if (!layer || layer.phase !== 'exiting') return

    const completedConsumers = exitCompletionsRef.current.get(layerId) ?? new Set<ArtworkLayerConsumer>()
    completedConsumers.add(consumer)
    exitCompletionsRef.current.set(layerId, completedConsumers)
    if (!completedConsumers.has('ambient') || !completedConsumers.has('cover')) return

    releaseLayerOwner(layer)
    const remainingLayers = layersRef.current.filter((candidate) => candidate.id !== layerId)
    replaceLayers(remainingLayers)
    if (layer.slot !== null) scheduleSlotRelease(layer.slot)
  }, [releaseLayerOwner, replaceLayers, scheduleSlotRelease])

  const requestTrackId = effectiveTrack?.id
  const requestArtworkId = effectiveArtwork?.id
  const requestTone = effectiveArtwork?.coverTone
  const requestFilePath = effectiveArtwork?.coverFilePath
  const requestPrimary = effectiveArtwork?.coverImage
  const requestFallback = effectiveArtwork?.coverImageFallback
  const requestIdentity = effectiveTrack && effectiveArtwork
    ? artworkResourceIdentity(effectiveTrack, effectiveArtwork)
    : null

  useEffect(() => {
    if (!effectiveTrack || !effectiveArtwork || !requestIdentity) return
    const currentLayers = layersRef.current
    let changed = false
    const nextLayers = currentLayers.map((layer): ArtworkVisualLayer => {
      if (layer.identity !== requestIdentity || (layer.track === effectiveTrack && layer.requestedArtwork === effectiveArtwork)) {
        return layer
      }
      changed = true
      return {
        ...layer,
        track: effectiveTrack,
        requestedArtwork: effectiveArtwork,
        artwork: {
          ...layer.artwork,
          id: effectiveArtwork.id,
          coverTone: effectiveArtwork.coverTone,
          resourceKey: effectiveArtwork.resourceKey,
        },
      }
    })
    if (changed) replaceLayers(nextLayers)
  }, [effectiveArtwork, effectiveTrack, replaceLayers, requestIdentity])

  useEffect(() => {
    const currentTrackId = track?.id
    const prepared = preparedArtworkRef.current
    const candidateStillRelevant = Boolean(
      prefetchCandidate
      && currentTrackId
      && (
        prefetchCandidate.afterTrackId === currentTrackId
        || prefetchCandidate.track.id === currentTrackId
      ),
    )
    if (!candidateStillRelevant || !prefetchCandidate || !currentTrackId) {
      if (prepared && prepared.track.id !== currentTrackId) evictPreparedArtwork(prepared)
      return
    }

    const identity = artworkResourceIdentity(
      prefetchCandidate.track,
      prefetchCandidate.artwork,
    )
    if (prepared?.identity === identity) return
    if (prepared) {
      prefetchDebugRef.current.foregroundPreemptions += 1
      evictPreparedArtwork(prepared)
    }

    // Do not compete with the foreground decode or either half of an artwork transition.
    const stableActiveLayer = layersRef.current.length === 1
      && layersRef.current[0]?.phase === 'active'
      && layersRef.current[0].track.id === currentTrackId
      && queuedLayerRef.current === null
    if (
      !stableActiveLayer
      || prefetchCandidate.afterTrackId !== currentTrackId
      || prefetchCandidate.track.id === currentTrackId
    ) return

    const controller = new AbortController()
    const nextPrepared: PreparedArtwork = {
      identity,
      afterTrackId: prefetchCandidate.afterTrackId,
      track: prefetchCandidate.track,
      artwork: prefetchCandidate.artwork,
      controller,
      promise: Promise.resolve(null),
      promoted: false,
    }
    const debug = prefetchDebugRef.current
    debug.prepared = 1
    debug.inFlight = 1
    debug.peakPrepared = Math.max(debug.peakPrepared, debug.prepared)
    debug.started += 1
    nextPrepared.promise = loadArtworkResource(
      nextPrepared.artwork,
      controller,
      'prefetch',
    ).then((loaded) => {
      debug.inFlight = 0
      if (!loaded) return null
      if (controller.signal.aborted) {
        loaded.resource.releaseCache()
        return null
      }
      nextPrepared.resource = loaded.resource
      registrySet(identity, loaded)
      debug.ready += 1
      return loaded
    })
    preparedArtworkRef.current = nextPrepared
  }, [
    coverMaxEdge,
    evictPreparedArtwork,
    layers,
    loadArtworkResource,
    prefetchCandidate,
    registrySet,
    track?.id,
  ])

  useEffect(() => {
    const latest = latestRequestRef.current
    const foregroundRequest = foregroundRequestRef.current
    if (foregroundRequest && foregroundRequest.identity !== requestIdentity) {
      foregroundRequestRef.current = null
      if (requestControllerRef.current === foregroundRequest.controller) {
        requestControllerRef.current = null
      }
      generationRef.current += 1
      prefetchDebugRef.current.foregroundInFlight = 0
      foregroundRequest.controller.abort()
    }
    const promotedArtwork = promotedArtworkRef.current
    if (promotedArtwork && promotedArtwork.identity !== requestIdentity) {
      promotedArtworkRef.current = null
      promotedArtwork.controller.abort()
    }
    if (!requestTrackId) {
      requestControllerRef.current?.abort()
      foregroundRequestRef.current = null
      requestControllerRef.current = null
      prefetchDebugRef.current.foregroundInFlight = 0
      evictPreparedArtwork()
      generationRef.current += 1
      const queued = queuedLayerRef.current
      if (queued) {
        queuedLayerRef.current = null
        releaseLayerOwner(queued)
      }
      for (const layer of layersRef.current) releaseLayerOwner(layer)
      clearRegistry()
      if (layersRef.current.length) replaceLayers([])
      return
    }
    if (
      (detailsPending && !matchingPrefetchCandidate)
      || !requestIdentity
      || !latest.track
      || !latest.requestedArtwork
      || latest.requestedArtwork.id !== latest.track.id
    ) return

    const identity = requestIdentity
    const matchingForegroundRequest = foregroundRequestRef.current
    if (
      matchingForegroundRequest?.identity === identity
      && !matchingForegroundRequest.controller.signal.aborted
    ) {
      prefetchDebugRef.current.foregroundDeduplicated += 1
      return
    }
    if (promotedArtworkRef.current?.identity === identity) return
    const existingActive = layersRef.current.find(
      (layer) => layer.phase === 'active' && layer.identity === identity,
    )
    if (existingActive) {
      registryGet(identity)
      const obsoleteIncoming = layersRef.current.find((layer) => layer.phase === 'incoming')
      if (obsoleteIncoming) {
        releaseLayerOwner(obsoleteIncoming)
        replaceLayers(layersRef.current.filter((layer) => layer.id !== obsoleteIncoming.id))
        if (obsoleteIncoming.slot !== null) scheduleSlotRelease(obsoleteIncoming.slot)
      }
      const queued = queuedLayerRef.current
      if (queued) {
        queuedLayerRef.current = null
        releaseLayerOwner(queued)
      }
      return
    }

    const existingExiting = layersRef.current.find(
      (layer) => layer.phase === 'exiting' && layer.identity === identity,
    )
    if (existingExiting) {
      registryGet(identity)
      const discardedIncoming = layersRef.current.find((layer) => layer.phase === 'incoming')
      if (discardedIncoming) releaseLayerOwner(discardedIncoming)
      const queued = queuedLayerRef.current
      if (queued) {
        queuedLayerRef.current = null
        releaseLayerOwner(queued)
      }
      exitCompletionsRef.current.delete(existingExiting.id)
      replaceLayers(layersRef.current
        .filter((layer) => layer.phase !== 'incoming')
        .map((layer): ArtworkVisualLayer => {
          if (layer.id === existingExiting.id) return { ...layer, phase: 'active' }
          if (layer.phase === 'active') return { ...layer, phase: 'exiting' }
          return layer
        }))
      return
    }

    const existingQueued = queuedLayerRef.current
    if (existingQueued?.identity === identity) {
      registryGet(identity)
      return
    }

    const prepared = preparedArtworkRef.current
    if (prepared?.identity === identity) {
      preparedArtworkRef.current = null
      prepared.promoted = true
      promotedArtworkRef.current = prepared
      const debug = prefetchDebugRef.current
      debug.prepared = 0
      debug.promoted += 1
      if (!prepared.resource) debug.promotedInFlight += 1
      const promotionGeneration = generationRef.current
      const installPromoted = (loaded: LoadedArtworkResource) => {
        const current = latestRequestRef.current
        const currentIdentity = current.track && current.requestedArtwork
          ? artworkResourceIdentity(current.track, current.requestedArtwork)
          : null
        if (promotionGeneration !== generationRef.current || currentIdentity !== identity) return false
        registryGet(identity)
        enqueueOrInstall(createLayer(
          current.track!,
          current.requestedArtwork!,
          identity,
          loaded.resource,
          loaded.fallbackSource,
        ))
        return true
      }
      void prepared.promise.then(async (loaded) => {
        if (loaded) {
          installPromoted(loaded)
          return
        }
        if (promotionGeneration !== generationRef.current) return
        const retryController = new AbortController()
        requestControllerRef.current = retryController
        foregroundRequestRef.current = { identity, controller: retryController }
        prefetchDebugRef.current.foregroundInFlight = 1
        let retried: LoadedArtworkResource | null = null
        while (
          !retried
          && !retryController.signal.aborted
          && promotionGeneration === generationRef.current
        ) {
          retried = await loadArtworkResource(
            prepared.artwork,
            retryController,
            'foreground',
          )
          if (!retried && !retryController.signal.aborted) {
            prefetchDebugRef.current.foregroundRetries += 1
          }
        }
        if (!retried) return
        registrySet(identity, retried)
        if (!installPromoted(retried)) registryDelete(identity, retried.resource)
        if (requestControllerRef.current === retryController) requestControllerRef.current = null
        if (foregroundRequestRef.current?.controller === retryController) {
          foregroundRequestRef.current = null
          prefetchDebugRef.current.foregroundInFlight = 0
        }
      }).finally(() => {
        if (promotedArtworkRef.current === prepared) promotedArtworkRef.current = null
      })
      return
    }

    const cached = registryGet(identity)
    if (cached) {
      enqueueOrInstall(createLayer(
        latest.track,
        latest.requestedArtwork,
        identity,
        cached.resource,
        cached.fallbackSource,
      ))
      return
    }

    // Foreground work has strict priority. An obsolete or newly-started future
    // candidate must not hold the final pool lease while this track is cold.
    if (prepared) evictPreparedArtwork(prepared)

    const obsoleteQueued = queuedLayerRef.current
    if (obsoleteQueued) {
      queuedLayerRef.current = null
      registryDelete(obsoleteQueued.identity, obsoleteQueued.resource)
      releaseLayerOwner(obsoleteQueued)
    }
    const obsoleteIncoming = layersRef.current.find((layer) => layer.phase === 'incoming')
    if (obsoleteIncoming) {
      registryDelete(obsoleteIncoming.identity, obsoleteIncoming.resource)
      releaseLayerOwner(obsoleteIncoming)
      replaceLayers(layersRef.current.filter((layer) => layer.id !== obsoleteIncoming.id))
      if (obsoleteIncoming.slot !== null) scheduleSlotRelease(obsoleteIncoming.slot)
    }

    generationRef.current += 1
    const generation = generationRef.current
    const controller = new AbortController()
    requestControllerRef.current = controller
    foregroundRequestRef.current = { identity, controller }
    prefetchDebugRef.current.foregroundInFlight = 1
    const currentTrack = latest.track
    const currentArtwork = latest.requestedArtwork
    const isCurrent = () => !controller.signal.aborted && generation === generationRef.current
    const coldRequestStillCurrent = () => {
      const current = latestRequestRef.current
      const currentIdentity = current.track && current.requestedArtwork
        ? artworkResourceIdentity(current.track, current.requestedArtwork)
        : null
      return isCurrent()
        && currentIdentity === identity
        && latestArtworkDetailsReadyRef.current
    }

    const install = (loaded: LoadedArtworkResource) => {
      if (!isCurrent()) {
        loaded.resource.releaseCache()
        return
      }
      if (loaded.resource.view) registrySet(identity, loaded)
      const nextLayer = createLayer(
        currentTrack,
        currentArtwork,
        identity,
        loaded.resource,
        loaded.fallbackSource,
      )
      enqueueOrInstall(nextLayer)
    }

    void (async () => {
      prefetchDebugRef.current.coldDebounceWaits += 1
      const isTrailingSelection = await waitForColdArtworkRapidSelection(controller.signal)
      if (!isTrailingSelection || !coldRequestStillCurrent()) {
        prefetchDebugRef.current.coldDebounced += 1
        return
      }
      while (isCurrent()) {
        const loaded = await loadArtworkResource(currentArtwork, controller, 'foreground')
        if (loaded) {
          install(loaded)
          return
        }
        if (isCurrent()) prefetchDebugRef.current.foregroundRetries += 1
      }
    })()
      .finally(() => {
        if (requestControllerRef.current === controller) requestControllerRef.current = null
        if (foregroundRequestRef.current?.controller === controller) {
          foregroundRequestRef.current = null
          prefetchDebugRef.current.foregroundInFlight = 0
        }
      })
  }, [
    commitCanvasLease,
    coverMaxEdge,
    createLayer,
    clearRegistry,
    detailsPending,
    enqueueOrInstall,
    evictPreparedArtwork,
    getCanvasPool,
    loadArtworkResource,
    matchingPrefetchCandidate,
    releaseLayerOwner,
    replaceLayers,
    registryGet,
    registryDelete,
    registrySet,
    requestArtworkId,
    requestFallback,
    requestFilePath,
    requestIdentity,
    requestPrimary,
    requestTone,
    requestTrackId,
    scheduleSlotRelease,
  ])

  useEffect(() => {
    const currentSequence = Math.max(0, Math.floor(selectionActivitySequence))
    if (
      currentSequence <= lastReportedActivitySequenceRef.current
      || uiBurstReportInFlightRef.current
      || detailsPending
      || !requestIdentity
      || foregroundRequestRef.current !== null
      || queuedLayerRef.current !== null
      || layersRef.current.length !== 1
    ) return

    const stableLayer = layersRef.current[0]
    if (stableLayer?.phase !== 'active' || stableLayer.identity !== requestIdentity) return

    const latest = latestRequestRef.current
    if (
      !latest.track
      || !latest.requestedArtwork
      || latest.track.id !== latest.requestedArtwork.id
    ) return

    const activityUnits = Math.min(
      8,
      Math.max(1, currentSequence - lastReportedActivitySequenceRef.current),
    )
    uiBurstReportInFlightRef.current = true
    void noteWebviewUiBurstSettled({ activityUnits })
      .then(() => {
        lastReportedActivitySequenceRef.current = Math.max(
          lastReportedActivitySequenceRef.current,
          currentSequence,
        )
        const debug = prefetchDebugRef.current
        debug.uiBurstReports += 1
        debug.uiBurstActivityUnits.push(activityUnits)
        if (debug.uiBurstActivityUnits.length > 32) debug.uiBurstActivityUnits.shift()
        debug.uiBurstLastSequence = lastReportedActivitySequenceRef.current
      })
      .catch((error: unknown) => {
        prefetchDebugRef.current.uiBurstReportErrors += 1
        console.debug('WebView UI burst settlement notification failed', error)
      })
      .finally(() => {
        uiBurstReportInFlightRef.current = false
        // A later selection can already be visually stable while this invoke is
        // pending. Re-evaluate only for genuinely newer activity; a failure for
        // the same sequence therefore cannot create an automatic retry loop.
        if (latestActivitySequenceRef.current > currentSequence) {
          setUiBurstReportRevision((revision) => revision + 1)
        }
      })
  }, [
    detailsPending,
    layers,
    requestIdentity,
    selectionActivitySequence,
    uiBurstReportRevision,
  ])

  useEffect(() => () => {
    generationRef.current += 1
    requestControllerRef.current?.abort()
    foregroundRequestRef.current = null
    prefetchDebugRef.current.foregroundInFlight = 0
    promotedArtworkRef.current?.controller.abort()
    promotedArtworkRef.current = null
    evictPreparedArtwork()
    if (slotFlushFrameRef.current !== null) cancelAnimationFrame(slotFlushFrameRef.current)
    for (const layer of layersRef.current) layer.releaseLayerLease()
    layersRef.current = []
    const queued = queuedLayerRef.current
    if (queued) queued.releaseLayerLease()
    queuedLayerRef.current = null
    exitCompletionsRef.current.clear()
    clearingSlotsRef.current.clear()
    clearRegistry()
    canvasPoolRef.current?.dispose()
    canvasPoolRef.current = null
  }, [clearRegistry, evictPreparedArtwork])

  const slots: readonly [ArtworkVisualLayer | null, ArtworkVisualLayer | null] = [
    layers.find((layer) => layer.slot === 0) ?? null,
    layers.find((layer) => layer.slot === 1) ?? null,
  ]
  const currentArtworkReady = !effectiveTrack
    || (!effectiveArtwork && !detailsPending)
    || Boolean(
      requestIdentity
      && layers.some((layer) => layer.identity === requestIdentity && layer.phase === 'active')
      && !layers.some((layer) => layer.identity === requestIdentity && layer.phase === 'incoming'),
    )
  return { slots, currentArtworkReady, markReady, markLoadError, markExitComplete }
}
