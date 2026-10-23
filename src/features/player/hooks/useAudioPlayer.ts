import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  persistRepeatMode,
  persistShuffleMode,
  readRepeatMode,
  readShuffleMode,
} from '@/features/player/model/playbackModeStorage'
import {
  audioFolderTrackPlaceholder,
  audioTrackToPlaylistVisual,
  audioTrackToTrack,
  coverToneForTrackId,
  normalizeAudioSourcePath,
  patchTrackDuration,
  playlistDisplayName,
  singleTrackFolderPlaylist,
  trackPresentationEqual,
} from '@/features/player/model/audioTrackModel'
import {
  nextRepeatMode,
  nextShuffleMode,
  resolveNextTrackIndex,
  type Direction,
  type RepeatMode,
  type ShuffleMode,
} from '@/features/player/model/playbackModes'
import { appCopy } from '@/features/player/model/playerCopy'
import { playbackQueueOrigin, type PlaybackQueuePlaylist, type PlaybackQueueSelection } from '@/features/player/model/playbackQueue'
import {
  clearPlaybackSession,
  persistPlaybackSession,
  readPlaybackSession,
  type SavedPlaybackSession,
} from '@/features/player/model/playbackSessionStorage'
import { createPlaylistArtworkGrace } from '@/features/player/model/playlistArtworkGrace'
import { playlistCoverImageFromPixels } from '@/features/player/model/playlistCoverPixels'
import { decodePlaylistCover } from '@/features/player/model/playlistCoverReadiness'
import { schedulePlaylistCoverPixels } from '@/features/player/services/playlistCoverScheduler'
import {
  chunkPlaylistSummaryPaths,
  pendingPlaylistTrackRow,
  playlistDescriptorFingerprint,
  playlistSummaryProbePaths,
  playlistTrackRowEqual,
  playlistTrackRowFromSummary,
  type PlaylistSummaryStatus,
  type PlaylistTrackRow,
} from '@/features/player/model/playlistTrackSummary'
import type {
  PlayerContentState,
  PlayerTimelineInteraction,
  PlaylistArtworkDemand,
  PlaylistCoverImage,
  PlaylistTrackMetadata,
  PlaylistTrackVisual,
  TrackCardPreviewToken,
  TrackSelectionVisualIntent,
  TrackSelectionVisualSource,
} from '@/features/player/model/playerUiViewModel'
import type {
  Track,
  TrackArtwork,
  TrackArtworkPrefetchCandidate,
  TrackFeedback,
  TrackSummary,
} from '@/features/player/model/playerTypes'
import { createPlayerVisualTimelineClock } from '@/features/player/model/visualTimelineClock'
import {
  AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT,
  addLibraryFolder,
  beginAudioPlaylistCoverWindow,
  cancelLibraryCoverWarmup,
  clearLibraryFolders,
  getLibraryFolders,
  getLibraryPlaylists,
  getAudioState,
  getAudioOutputInfo,
  getCurrentAudioTrack,
  hydrateAudioTrack,
  importAudioPlaylist,
  isAudioCoverPixelsError,
  isAudioCommandError,
  listAudioFolderTracks,
  listenAudioTrackDetailsChanged,
  listenAudioStateChanged,
  loadAndPlayAudio,
  loadAudioFile,
  openAudioSource,
  pauseAudio,
  playAudio,
  probeAudioPlaylistCover,
  probeAudioPlaylistTrackSummaries,
  seekAudio,
  scanLibraryFolder,
  selectLibraryFolders,
  setAudioVolume,
  stopAudio,
  transitionAudioPlayback,
  type AudioCommandError,
  type AudioFolderPlaylist,
  type AudioFolderTrackRef,
  type AudioPlaybackState,
  type AudioPlaylistTrackSummaryItem,
  type AudioTransitionPlaybackInput,
  type AudioTrackRef,
  type AudioTrackDetailsChanged,
} from '@/features/player/services/audioCommands'

type TransportIntentPhase = 'playing' | 'paused'
type TransportRequest = { phase: TransportIntentPhase; restart: boolean }
type PendingTrackSelection = {
  requestId: number
  targetTrackId: string | null
  sourcePath: string | null
  targetScope: string | null
  previousGeneration: number | null
  generation: number | null
  usesLoadAndPlay: boolean
  commandConfirmed: boolean
  detailsSettled: boolean
  replacementStarted: boolean
  loadedTrackId: string | null
  previousPresentationTrack: Track | null
  previousArtwork: TrackArtwork | null
  previousDetailsPending: boolean
  previousSourcePath: string | null
  previousAudioTrack: AudioTrackRef | null
}

type PreparedTrackCardPreview = TrackCardPreviewToken & {
  hydratedTrack: AudioTrackRef
  playlistEpoch: number
  playlistScope: string
  targetIndex: number
}

type PlaylistVisualHydrationJob = {
  clientId: string
  generation: number
  backendGeneration: number
  playlistEpoch: number
  scope: string
  trackId: string
  sourcePath: string
  normalizedSourcePath: string
  maxEdge: 128 | 256 | 512
  attempt: number
  optional: boolean
}

type OptionalIdleHandle = { kind: 'idle' | 'timer'; id: number }

function scheduleOptionalArtworkIdle(run: () => void): OptionalIdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    return { kind: 'idle', id: window.requestIdleCallback(run) }
  }
  // WebViews without requestIdleCallback still yield two ordinary frames
  // between optional probes; current/visible covers never use this lane.
  return { kind: 'timer', id: window.setTimeout(run, 32) }
}

function cancelOptionalArtworkIdle(handle: OptionalIdleHandle): void {
  if (handle.kind === 'idle' && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle.id)
  else window.clearTimeout(handle.id)
}

type PlaylistMetadataHydrationJob = Pick<
  PlaylistVisualHydrationJob,
  'generation' | 'playlistEpoch' | 'scope' | 'trackId' | 'sourcePath' | 'normalizedSourcePath'
>

const HYDRATED_TRACK_CACHE_CAPACITY = 8
// Application-owned BMP URLs and in-flight RGBA buffers. Renderer/GPU memory
// still needs Release measurement; visible minimum quality is never truncated.
const PLAYLIST_ARTWORK_RESIDENT_BUDGET = 96 * 1024 * 1024
const PLAYLIST_ARTWORK_INFLIGHT_BUDGET = 2 * 512 * 512 * 4

function playlistImageBytes(image: PlaylistCoverImage): number {
  return image.encodedBytes + image.width * image.height * 4
}

function playlistArtworkEdge(cssPixels: number, dpr: number): 128 | 256 | 512 {
  const required = Math.max(1, cssPixels) * Math.max(1, dpr)
  return required <= 128 ? 128 : required <= 256 ? 256 : 512
}

function playlistArtworkBytes(edge: number): number {
  return edge * edge * 7 + 54
}

function createPlaylistCoverClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `playlist-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function releasePlaylistVisuals(visuals: Readonly<Record<string, PlaylistTrackVisual>>) {
  for (const visual of Object.values(visuals)) {
    if (visual.coverThumbnail) URL.revokeObjectURL(visual.coverThumbnail.src)
  }
}

function audioTrackMatchesDescriptor(
  track: AudioTrackRef | undefined,
  descriptor: AudioFolderTrackRef,
): track is AudioTrackRef {
  return track !== undefined
    && track.id === descriptor.id
    && normalizeAudioSourcePath(track.sourcePath) === normalizeAudioSourcePath(descriptor.sourcePath)
}

function hydratedCacheGet(cache: Map<string, AudioTrackRef>, sourcePath: string): AudioTrackRef | undefined {
  const cached = cache.get(sourcePath)
  if (!cached) return undefined
  cache.delete(sourcePath)
  cache.set(sourcePath, cached)
  return cached
}

function hydratedCacheSet(cache: Map<string, AudioTrackRef>, sourcePath: string, track: AudioTrackRef) {
  cache.delete(sourcePath)
  cache.set(sourcePath, track)
  while (cache.size > HYDRATED_TRACK_CACHE_CAPACITY) {
    const leastRecentlyUsedPath = cache.keys().next().value
    if (leastRecentlyUsedPath === undefined) break
    cache.delete(leastRecentlyUsedPath)
  }
}

export function playlistScope(playlist: AudioFolderPlaylist): string {
  return `${playlist.sourceKind}\u0000${normalizeAudioSourcePath(playlist.sourcePath)}`
}

function trackSummaryFromTrack(track: Track): TrackSummary {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    category: track.category,
  }
}

// Rows before any tag is known. Missing songs are expressed through
// `unavailableTrackIds`, so the artist/album fields never carry invented text
// (an empty string means "unknown", never the playlist name).
function playlistTrackSummaries(playlist: AudioFolderPlaylist): TrackSummary[] {
  return playlist.tracks.map((track) => {
    const { title } = pendingPlaylistTrackRow(track)
    return {
      id: track.id,
      title,
      artist: '',
      album: '',
      category: 'local-audio',
    }
  })
}

function resolveAvailablePlaylistTarget(
  playlist: AudioFolderPlaylist,
  tracks: readonly TrackSummary[],
  originIndex: number,
  originTrackId: string,
  direction: Direction,
  shuffleMode: ShuffleMode,
): { index: number; track: AudioFolderTrackRef } | null {
  let targetIndex = resolveNextTrackIndex(tracks, originIndex, direction, shuffleMode)
  const step = direction < 0 ? -1 : 1
  for (let attempts = 0; attempts < playlist.tracks.length; attempts += 1) {
    const candidate = playlist.tracks[targetIndex]
    if (candidate?.available && candidate.id !== originTrackId) {
      return { index: targetIndex, track: candidate }
    }
    targetIndex = (targetIndex + step + playlist.tracks.length) % playlist.tracks.length
  }
  return null
}

function trackSummaryEqual(left: TrackSummary, right: TrackSummary): boolean {
  return left === right || (
    left.id === right.id
    && left.title === right.title
    && left.artist === right.artist
    && left.album === right.album
    && left.category === right.category
  )
}

function artworkContentEqual(artwork: TrackArtwork, track: Track): boolean {
  return artwork.id === track.id
    && artwork.coverTone === track.coverTone
    && artwork.coverFilePath === track.coverFilePath
    && artwork.coverImage === track.coverImage
    && artwork.coverImageFallback === track.coverImageFallback
}

function prefetchArtworkFromTrack(track: Track): TrackArtwork {
  return {
    id: track.id,
    coverTone: track.coverTone,
    coverFilePath: track.coverFilePath,
    coverImage: track.coverImage,
    coverImageFallback: track.coverImageFallback,
    resourceKey: `prefetch:${track.id}`,
  }
}

function volumeScalarToPercent(volume: number): number {
  if (!Number.isFinite(volume)) return 100
  return Math.min(100, Math.max(0, Math.round(volume * 100)))
}

function volumePercentToScalar(volume: number): number {
  return Math.min(1, Math.max(0, volume / 100))
}

function commandError(error: unknown): AudioCommandError {
  return isAudioCommandError(error) ? error : {
    code: 'INTERNAL_ERROR',
    message: appCopy.audio.unavailable,
    recoverable: true,
  }
}

function missingPlaylistTrackError(fileName: string): AudioCommandError {
  return {
    code: 'FILE_NOT_FOUND',
    message: `歌曲未找到：${fileName}`,
    recoverable: true,
  }
}

function audioErrorText(error: AudioCommandError | null): string | null {
  if (!error) return null
  return appCopy.audio.errors[error.code] ?? error.message
}

function audioCommandErrorEqual(left: AudioCommandError | null, right: AudioCommandError | null): boolean {
  return left === right || (
    left !== null
    && right !== null
    && left.code === right.code
    && left.message === right.message
    && left.recoverable === right.recoverable
  )
}

function audioPlaybackUiStateEqual(left: AudioPlaybackState | null, right: AudioPlaybackState): boolean {
  const leftTransition = left?.transportTransition ?? null
  const rightTransition = right.transportTransition ?? null
  return left !== null
    && left.phase === right.phase
    && left.generation === right.generation
    && left.currentTrackId === right.currentTrackId
    && left.durationMs === right.durationMs
    && left.volume === right.volume
    && left.transportSettledRequestId === right.transportSettledRequestId
    && (leftTransition === rightTransition || (
      leftTransition !== null
      && rightTransition !== null
      && leftTransition.requestId === rightTransition.requestId
      && leftTransition.target === rightTransition.target
      && leftTransition.durationMs === rightTransition.durationMs
    ))
    && audioCommandErrorEqual(left.error, right.error)
}

function audioStatusText(
  state: AudioPlaybackState | null,
  error: AudioCommandError | null,
  track: AudioTrackRef | null,
): string {
  const errorText = audioErrorText(error ?? state?.error ?? null)
  if (errorText) return errorText
  if (!state) return appCopy.audio.idle

  const fileName = track?.fileName ?? '本地音频'
  switch (state.phase) {
    case 'loading': return appCopy.audio.loading
    case 'ready': return appCopy.audio.ready(fileName)
    case 'playing': return appCopy.audio.playing(fileName)
    case 'paused': return appCopy.audio.paused(fileName)
    case 'stopped': return appCopy.audio.stopped(fileName)
    case 'ended': return appCopy.audio.ended(fileName)
    case 'error': return appCopy.audio.unavailable
    default: return appCopy.audio.idle
  }
}

export function useAudioPlayer(libraryVisible = true, backgroundArtworkAllowed = true) {
  const [queueTracks, setQueueTracks] = useState<TrackSummary[]>([])
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>(readShuffleMode)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(readRepeatMode)

  useEffect(() => {
    persistShuffleMode(shuffleMode)
  }, [shuffleMode])

  useEffect(() => {
    persistRepeatMode(repeatMode)
  }, [repeatMode])
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [savedSession] = useState<SavedPlaybackSession | null>(readPlaybackSession)
  const savedSessionRef = useRef(savedSession)
  const sessionRestorePendingRef = useRef(savedSession !== null)
  const sessionRestoreStartedRef = useRef(false)
  const startupRestoreTimedOutRef = useRef(false)
  const [startupRestoreReady, setStartupRestoreReady] = useState(savedSession === null)
  const [audioState, setAudioState] = useState<AudioPlaybackState | null>(null)
  const [audioOutputInfo, setAudioOutputInfo] = useState<Awaited<ReturnType<typeof getAudioOutputInfo>>>(null)
  const [audioTrack, setAudioTrack] = useState<AudioTrackRef | null>(null)
  const [presentationTrack, setPresentationTrack] = useState<Track | null>(null)
  const [presentationArtwork, setPresentationArtwork] = useState<TrackArtwork | null>(null)
  type WindowedArtworkPrefetchCandidate = TrackArtworkPrefetchCandidate & Readonly<{
    distance: 1 | 2 | 3
  }>
  const [artworkPrefetchCandidates, setArtworkPrefetchCandidates] = useState<readonly WindowedArtworkPrefetchCandidate[]>([])
  const [selectionActivitySequence, setSelectionActivitySequence] = useState(0)
  const [selectionVisualIntent, setSelectionVisualIntent] = useState<TrackSelectionVisualIntent | null>(null)
  const [automaticContinuationVisual, setAutomaticContinuationVisual] = useState(false)
  const [detailsPending, setDetailsPending] = useState(false)
  const [contentState, setContentState] = useState<PlayerContentState>('empty')
  const [folderPlaylist, setFolderPlaylist] = useState<AudioFolderPlaylist | null>(null)
  // Descriptors of a playlist whose first track is still loading. The duration
  // channel reads this so the whole list is measured in parallel with that load
  // instead of waiting for the full scope activation.
  const [pendingDurationPlaylist, setPendingDurationPlaylist] = useState<AudioFolderPlaylist | null>(null)
  const [sessionPlaylists, setSessionPlaylists] = useState<readonly AudioFolderPlaylist[]>([])
  const [libraryFolderPlaylists, setLibraryFolderPlaylists] = useState<readonly AudioFolderPlaylist[]>([])
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<readonly string[]>([])
  const [libraryFolderErrors, setLibraryFolderErrors] = useState<Readonly<Record<string, string>>>({})
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'ready' | 'clearing' | 'error'>('loading')
  const [libraryRestorePending, setLibraryRestorePending] = useState(true)
  const [libraryImportPending, setLibraryImportPending] = useState(false)
  const [playlistRestorePending, setPlaylistRestorePending] = useState(true)
  const libraryImportPendingRef = useRef(false)
  const [playlistTrackVisuals, setPlaylistTrackVisuals] = useState<Readonly<Record<string, PlaylistTrackVisual>>>({})
  const [playlistTrackMetadata, setPlaylistTrackMetadata] = useState<Readonly<Record<string, PlaylistTrackMetadata>>>({})
  // Read-only tag summaries, keyed by playlist scope. This is a third channel:
  // it never writes `playlistTrackMetadata` (first-write-wins would truncate the
  // hydration pump) and never owns playlist identity.
  const [playlistTrackSummariesByScope, setPlaylistTrackSummariesByScope] = useState<
    Readonly<Record<string, Readonly<Record<string, PlaylistTrackRow>>>>
  >({})
  const [playlistSummaryStatusByScope, setPlaylistSummaryStatusByScope] = useState<
    Readonly<Record<string, PlaylistSummaryStatus>>
  >({})
  const [audioError, setAudioError] = useState<AudioCommandError | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [selectionPending, setSelectionPending] = useState(false)
  const [transportBusy, setTransportBusy] = useState(false)
  const [volumeBusy, setVolumeBusy] = useState(false)
  const [timelinePosition, setTimelinePosition] = useState(0)
  const [timelineInteraction, setTimelineInteraction] = useState<PlayerTimelineInteraction>('following')

  const endingTrackRef = useRef<string | null>(null)
  const seekRequestIdRef = useRef(0)
  const audioStateRequestGenerationRef = useRef(0)
  const timelineInteractionRef = useRef<PlayerTimelineInteraction>('following')
  const timelinePositionRef = useRef(0)
  const visualTimelineClock = useMemo(() => createPlayerVisualTimelineClock(), [])
  const timelineAnchorRef = useRef({ positionSeconds: 0, at: 0, trackId: null as string | null })
  const seekTargetGuardRef = useRef<{ trackId: string; positionMs: number; expiresAt: number } | null>(null)
  const transportIntentRef = useRef<TransportIntentPhase | null>(null)
  const desiredTransportRequestRef = useRef<TransportRequest | null>(null)
  const transportCommandRunningRef = useRef(false)
  const activePlaybackTransitionRef = useRef<AudioTransitionPlaybackInput | null>(null)
  const playbackTransitionCommandRequestIdRef = useRef<number | null>(null)
  const transportRollbackStateRef = useRef<AudioPlaybackState | null>(null)
  const confirmedVolumeRef = useRef(volume)
  const desiredVolumeRef = useRef<number | null>(null)
  const volumeCommandRunningRef = useRef(false)
  const audioTrackRef = useRef<AudioTrackRef | null>(null)
  const audioTrackRequestIdRef = useRef(0)
  const audioTrackRequestTrackIdRef = useRef<string | null>(null)
  const audioSelectionInProgressRef = useRef(false)
  const selectionRequestIdRef = useRef(0)
  const selectionActivitySequenceRef = useRef(0)
  const pendingSelectionRef = useRef<PendingTrackSelection | null>(null)
  const presentationTrackRef = useRef<Track | null>(null)
  const presentationArtworkRef = useRef<TrackArtwork | null>(null)
  const detailsPendingRef = useRef(false)
  const hydratedAudioTrackCacheRef = useRef(new Map<string, AudioTrackRef>())
  const hydrationInFlightRef = useRef(new Map<string, Promise<AudioTrackRef>>())
  const artworkPrefetchGenerationRef = useRef(0)
  const playlistVisualGenerationRef = useRef(0)
  const playlistVisualDesiredIdsRef = useRef<ReadonlySet<string>>(new Set())
  const visiblePlaylistTrackIdsRef = useRef<readonly string[]>([])
  const playlistArtworkDemandRef = useRef<PlaylistArtworkDemand | undefined>(undefined)
  const keepPersistentPlaylistArtworkRef = useRef(false)
  const showPlaylistArtworkRef = useRef(true)
  const libraryVisibleRef = useRef(libraryVisible)
  const backgroundArtworkAllowedRef = useRef(backgroundArtworkAllowed)
  useLayoutEffect(() => { backgroundArtworkAllowedRef.current = backgroundArtworkAllowed }, [backgroundArtworkAllowed])
  const playlistMetadataGenerationRef = useRef(0)
  const playlistMetadataWindowKeyRef = useRef<string | null>(null)
  const playlistTrackMetadataRef = useRef<Readonly<Record<string, PlaylistTrackMetadata>>>({})
  const playlistMetadataHydrationQueueRef = useRef<PlaylistMetadataHydrationJob[]>([])
  const playlistMetadataHydrationActiveRef = useRef(0)
  const playlistVisualWindowKeyRef = useRef<string | null>(null)
  const playlistTrackVisualsRef = useRef<Readonly<Record<string, PlaylistTrackVisual>>>({})
  const playlistVisualEdgeRef = useRef(new Map<string, 128 | 256 | 512>())
  const playlistVisualSourceRef = useRef(new Map<string, string>())
  const playlistDesiredEdgeRef = useRef(new Map<string, 128 | 256 | 512>())
  const playlistVisualHydrationQueueRef = useRef<PlaylistVisualHydrationJob[]>([])
  const playlistVisualHydrationActiveRef = useRef(0)
  const playlistVisualHydrationActiveJobsRef = useRef(new Map<string, PlaylistVisualHydrationJob>())
  const playlistVisualRequiredIdsRef = useRef<ReadonlySet<string>>(new Set())
  const playlistOptionalIdleRef = useRef<OptionalIdleHandle | null>(null)
  const playlistOptionalIdleReadyRef = useRef(false)
  const playlistCoverClientIdRef = useRef<string | null>(null)
  if (playlistCoverClientIdRef.current === null) {
    playlistCoverClientIdRef.current = createPlaylistCoverClientId()
  }
  const playlistCoverWindowBeginRef = useRef<Promise<void>>(Promise.resolve())
  const playlistCoverSessionRef = useRef<Promise<number> | null>(null)
  const playlistCoverSessionFailuresRef = useRef(0)
  const playlistCoverSessionRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshPlaylistVisualDemandRef = useRef<() => void>(() => undefined)
  const expirePlaylistArtworkGrace = useCallback(() => {
    playlistVisualWindowKeyRef.current = null
    refreshPlaylistVisualDemandRef.current()
  }, [])
  const [playlistArtworkGrace] = useState(() => createPlaylistArtworkGrace())
  useEffect(() => {
    playlistArtworkGrace.setExpiryHandler(expirePlaylistArtworkGrace)
  }, [expirePlaylistArtworkGrace, playlistArtworkGrace])
  const playlistVisualRetryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const playlistImageErrorCountsRef = useRef(new Map<string, number>())
  const playlistVisualFailedRef = useRef(new Map<string, string>())
  const playlistPendingReplacementRef = useRef(new Map<string, { trackId: string; previous: PlaylistTrackVisual; edge: 128 | 256 | 512; olderVisuals: Array<{ visual: PlaylistTrackVisual; edge: 128 | 256 | 512 }> }>())
  const artworkPrimeDirectionRef = useRef<Direction>(1)
  const stagedTrackDetailsRef = useRef<{
    requestId: number
    track: AudioTrackRef
  } | null>(null)
  const playlistScopeRef = useRef<string | null>(null)
  const playlistScopeEpochRef = useRef(0)
  // Descriptor snapshots per scope, so a pass can be started for a list the user
  // only browsed and survive an unrelated activation.
  const sessionPlaylistDescriptorsRef = useRef(new Map<string, AudioFolderPlaylist>())
  const libraryPlaylistObjectsRef = useRef(new WeakSet<AudioFolderPlaylist>())
  const libraryEpochRef = useRef(0)
  const selectedFolderPathsRef = useRef<readonly string[]>([])
  const libraryMutationRef = useRef<Promise<void>>(Promise.resolve())
  const playlistSummaryRowsRef = useRef<Readonly<Record<string, Readonly<Record<string, PlaylistTrackRow>>>>>({})
  const playlistSummaryStatusRef = useRef<Readonly<Record<string, PlaylistSummaryStatus>>>({})
  const playlistSummaryRunRef = useRef(new Map<string, { runId: number; fingerprint: string }>())
  const playlistSummaryRunIdRef = useRef(0)
  const playlistSummaryDisposedRef = useRef(false)
  const trackCardPreviewIdRef = useRef(0)
  const preparedTrackCardPreviewRef = useRef<PreparedTrackCardPreview | null>(null)
  // Visual navigation is intentionally ahead of the audio engine during a burst.
  // It is the origin for subsequent gestures; audioState remains the confirmed
  // backend cursor and requestId fencing reconciles the two independently.
  const logicalCursorTrackIdRef = useRef<string | null>(null)
  const desiredAudioTrackIdRef = useRef<string | null>(null)
  const artworkRevisionRef = useRef(0)
  const latestAudioStateRef = useRef<AudioPlaybackState | null>(null)
  const audioErrorRef = useRef<AudioCommandError | null>(null)
  const folderPlaylistRef = useRef<AudioFolderPlaylist | null>(null)
  const queueTrackIndexRef = useRef(new Map<string, number>())
  const trackDetailsHandlerRef = useRef<(details: AudioTrackDetailsChanged) => void>(() => undefined)
  const trackDetailsUnlistenRef = useRef<(() => void) | null>(null)
  const trackDetailsListenerPromiseRef = useRef<Promise<void> | null>(null)
  const trackDetailsListenerActiveRef = useRef(false)
  const trackDetailsListenerEpochRef = useRef(0)

  const requestPlaylistCoverWindowGeneration = useCallback(() => {
    const request = playlistCoverWindowBeginRef.current.then(
      () => beginAudioPlaylistCoverWindow(playlistCoverClientIdRef.current!),
      () => beginAudioPlaylistCoverWindow(playlistCoverClientIdRef.current!),
    )
    playlistCoverWindowBeginRef.current = request.then(() => undefined, () => undefined)
    return request
  }, [])

  const ensurePlaylistCoverSession = useCallback(() => {
    if (playlistCoverSessionRef.current) return playlistCoverSessionRef.current
    const pending = requestPlaylistCoverWindowGeneration().then((generation) => {
      playlistCoverSessionFailuresRef.current = 0
      return generation
    }).catch((error: unknown) => {
      if (playlistCoverSessionRef.current === pending) playlistCoverSessionRef.current = null
      throw error
    })
    playlistCoverSessionRef.current = pending
    return pending
  }, [requestPlaylistCoverWindowGeneration])

  useEffect(() => () => {
    playlistArtworkGrace.dispose()
    playlistScopeEpochRef.current += 1
    playlistVisualGenerationRef.current += 1
    playlistVisualDesiredIdsRef.current = new Set()
    visiblePlaylistTrackIdsRef.current = []
    playlistArtworkDemandRef.current = undefined
    keepPersistentPlaylistArtworkRef.current = false
    playlistMetadataGenerationRef.current += 1
    playlistMetadataHydrationQueueRef.current = []
    playlistVisualHydrationQueueRef.current = []
    if (playlistOptionalIdleRef.current !== null) cancelOptionalArtworkIdle(playlistOptionalIdleRef.current)
    playlistOptionalIdleRef.current = null
    playlistOptionalIdleReadyRef.current = false
    if (playlistCoverSessionRetryTimerRef.current) clearTimeout(playlistCoverSessionRetryTimerRef.current)
    playlistCoverSessionRetryTimerRef.current = null
    for (const timer of playlistVisualRetryTimersRef.current.values()) clearTimeout(timer)
    playlistVisualRetryTimersRef.current.clear()
    playlistImageErrorCountsRef.current.clear()
    playlistVisualFailedRef.current.clear()
    for (const pending of playlistPendingReplacementRef.current.values()) {
      for (const older of pending.olderVisuals) {
        if (older.visual.coverThumbnail) URL.revokeObjectURL(older.visual.coverThumbnail.src)
      }
      if (pending.previous.coverThumbnail) URL.revokeObjectURL(pending.previous.coverThumbnail.src)
    }
    playlistPendingReplacementRef.current.clear()
    void requestPlaylistCoverWindowGeneration().catch(() => undefined)
    releasePlaylistVisuals(playlistTrackVisualsRef.current)
    playlistTrackVisualsRef.current = {}
    playlistVisualEdgeRef.current.clear()
    playlistVisualSourceRef.current.clear()
    playlistDesiredEdgeRef.current.clear()
  }, [requestPlaylistCoverWindowGeneration, playlistArtworkGrace])

  // Summary caches are owned by scope, so they are only released on disposal.
  // The mount body resets the guard: a StrictMode remount must not leave every
  // future tag pass discarded.
  useEffect(() => {
    const disposed = playlistSummaryDisposedRef
    const runs = playlistSummaryRunRef
    const rows = playlistSummaryRowsRef
    const statuses = playlistSummaryStatusRef
    const descriptors = sessionPlaylistDescriptorsRef
    disposed.current = false
    return () => {
      disposed.current = true
      runs.current.clear()
      rows.current = {}
      statuses.current = {}
      descriptors.current.clear()
    }
  }, [])

  const currentTrackId = audioState?.currentTrackId ?? null
  const track = presentationTrack
  const currentAudioTrack = audioTrack?.id === currentTrackId ? audioTrack : null
  const playing = audioState?.phase === 'playing'
  const duration = audioState?.durationMs != null ? audioState.durationMs / 1000 : 0
  const progress = Math.min(Math.max(timelinePosition, 0), duration)
  const statusText = contentState === 'loading' && !audioError
    ? appCopy.audio.loading
    : audioStatusText(audioState, audioError, currentAudioTrack)
  const unavailableTrackIds = useMemo(
    () => new Set(folderPlaylist?.tracks.filter((candidate) => !candidate.available).map((candidate) => candidate.id)),
    [folderPlaylist],
  )

  const persistCurrentSession = useCallback(() => {
    if (sessionRestorePendingRef.current) return
    const state = latestAudioStateRef.current
    const current = audioTrackRef.current
    const playlist = folderPlaylistRef.current
    if (!state?.currentTrackId || !current || !playlist
      || current.id !== state.currentTrackId
      || !playlist.tracks.some((item) => item.id === current.id && item.sourcePath === current.sourcePath)) return
    const positionSeconds = timelinePositionRef.current
    persistPlaybackSession({
      version: 1,
      sourcePath: current.sourcePath,
      playlist: playlist.sourceKind === 'custom'
        ? { sourceKind: 'custom', sourcePath: playlist.sourcePath, customPlaylist: playlist }
        : playlist.sourceKind === 'folder'
          ? { sourceKind: 'folder', sourcePath: playlist.sourcePath,
            folderMode: libraryPlaylistObjectsRef.current.has(playlist) ? 'library' : 'file' }
          : { sourceKind: playlist.sourceKind, sourcePath: playlist.sourcePath },
      positionMs: Math.max(0, Math.min(state.durationMs ?? Number.POSITIVE_INFINITY,
        Math.round(positionSeconds * 1000))),
      wasPlaying: state.phase === 'playing',
      wasPaused: state.phase === 'paused',
      queueOpen,
      volume,
    })
  }, [queueOpen, volume])

  useEffect(() => {
    persistCurrentSession()
  }, [audioState, folderPlaylist, queueOpen, volume, persistCurrentSession])

  useEffect(() => {
    const checkpoint = window.setInterval(persistCurrentSession, 1000)
    const flush = () => persistCurrentSession()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.clearInterval(checkpoint)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [persistCurrentSession])

  function transportOperationInProgress() {
    return transportCommandRunningRef.current
      || activePlaybackTransitionRef.current !== null
      || Boolean(latestAudioStateRef.current?.transportTransition)
  }

  const commitDetailsPending = useCallback((pending: boolean) => {
    detailsPendingRef.current = pending
    setDetailsPending(pending)
  }, [])

  const commitAudioError = useCallback((nextError: AudioCommandError | null) => {
    if (audioCommandErrorEqual(audioErrorRef.current, nextError)) return
    audioErrorRef.current = nextError
    setAudioError(nextError)
  }, [])

  const commitQueueTrackSummary = useCallback((nextTrack: Track) => {
    const index = queueTrackIndexRef.current.get(nextTrack.id)
    if (index === undefined) return
    const nextSummary = trackSummaryFromTrack(nextTrack)
    setQueueTracks((previous) => {
      const current = previous[index]
      if (!current || trackSummaryEqual(current, nextSummary)) return previous
      const next = [...previous]
      next[index] = nextSummary
      return next
    })
  }, [])

  const commitPresentationArtwork = useCallback((nextTrack: Track) => {
    const currentArtwork = presentationArtworkRef.current
    if (currentArtwork && artworkContentEqual(currentArtwork, nextTrack)) return currentArtwork

    artworkRevisionRef.current += 1
    const nextArtwork: TrackArtwork = {
      id: nextTrack.id,
      coverTone: nextTrack.coverTone,
      coverFilePath: nextTrack.coverFilePath,
      coverImage: nextTrack.coverImage,
      coverImageFallback: nextTrack.coverImageFallback,
      resourceKey: `art-${artworkRevisionRef.current}`,
    }
    presentationArtworkRef.current = nextArtwork
    setPresentationArtwork(nextArtwork)
    return nextArtwork
  }, [])

  const commitPresentationTrack = useCallback((
    nextAudioTrack: AudioTrackRef,
    durationMs?: number | null,
    commitArtwork = true,
  ) => {
    const mappedTrack = audioTrackToTrack({
      ...nextAudioTrack,
      durationMs: durationMs ?? nextAudioTrack.durationMs,
    })
    const currentTrack = presentationTrackRef.current
    const nextTrack = currentTrack && trackPresentationEqual(currentTrack, mappedTrack)
      ? currentTrack
      : mappedTrack
    presentationTrackRef.current = nextTrack
    setPresentationTrack(nextTrack)
    commitQueueTrackSummary(nextTrack)
    if (commitArtwork) commitPresentationArtwork(nextTrack)
    setContentState('track')
    return nextTrack
  }, [commitPresentationArtwork, commitQueueTrackSummary])

  const patchPresentationDuration = useCallback((trackId: string, durationMs: number | null) => {
    const currentTrack = presentationTrackRef.current
    if (!currentTrack || currentTrack.id !== trackId) return
    const nextTrack = patchTrackDuration(currentTrack, durationMs)
    if (nextTrack === currentTrack) return
    presentationTrackRef.current = nextTrack
    setPresentationTrack(nextTrack)
  }, [])

  const commitPlaylistSummaryStatus = useCallback((scope: string, status: PlaylistSummaryStatus) => {
    if (playlistSummaryStatusRef.current[scope] === status) return
    playlistSummaryStatusRef.current = { ...playlistSummaryStatusRef.current, [scope]: status }
    setPlaylistSummaryStatusByScope(playlistSummaryStatusRef.current)
  }, [])

  const findPlaylistForScope = useCallback((scope: string): AudioFolderPlaylist | undefined => {
    const session = sessionPlaylistDescriptorsRef.current.get(scope)
    if (session) return session
    const active = folderPlaylistRef.current
    return active && playlistScope(active) === scope ? active : undefined
  }, [])

  const rememberLibraryPlaylist = useCallback((playlist: AudioFolderPlaylist, epoch: number) => {
    if (libraryEpochRef.current !== epoch || playlist.sourceKind !== 'folder') return
    libraryPlaylistObjectsRef.current.add(playlist)
    const scope = playlistScope(playlist)
    sessionPlaylistDescriptorsRef.current.set(scope, playlist)
    setLibraryFolderPlaylists((previous) => previous.some((item) => playlistScope(item) === scope)
      ? previous.map((item) => playlistScope(item) === scope ? playlist : item)
      : [...previous, playlist])
    setLibraryFolderErrors((previous) => {
      if (!(playlist.sourcePath in previous)) return previous
      const next = { ...previous }
      delete next[playlist.sourcePath]
      return next
    })
  }, [])

  const registerLibraryPlaylist = useCallback(async (playlist: AudioFolderPlaylist, epoch: number) => {
    if (playlist.sourceKind !== 'folder' || libraryEpochRef.current !== epoch) return
    const path = playlist.sourcePath
    const mutation = libraryMutationRef.current.then(async () => {
      if (libraryEpochRef.current !== epoch) return
      try {
        const result = await addLibraryFolder(path)
        if (libraryEpochRef.current !== epoch) return
        if (!Array.isArray(result.folders) || !result.folders.every((folder) => typeof folder === 'string')) throw new Error('歌曲文件夹列表格式错误')
        selectedFolderPathsRef.current = result.folders
        setSelectedFolderPaths(result.folders)
        rememberLibraryPlaylist(playlist, epoch)
        setLibraryStatus('ready')
      } catch (error) {
        if (libraryEpochRef.current !== epoch) return
        const message = commandError(error).message
        setLibraryFolderErrors((previous) => ({ ...previous, [path]: `无法保存选择：${message}` }))
        setLibraryStatus('error')
        toast.error(`无法保存文件夹选择：${message}`)
      }
    })
    libraryMutationRef.current = mutation.catch(() => undefined)
    await mutation
  }, [rememberLibraryPlaylist])

  const clearSelectedLibraryFolders = useCallback(async () => {
    const epoch = libraryEpochRef.current + 1
    libraryEpochRef.current = epoch
    const priorPaths = selectedFolderPathsRef.current
    selectedFolderPathsRef.current = []
    setLibraryStatus('clearing')
    setLibraryRestorePending(false)
    const mutation = libraryMutationRef.current.then(async () => {
      try {
        await clearLibraryFolders()
        if (libraryEpochRef.current !== epoch) return
        try { await cancelLibraryCoverWarmup() } catch (error) { console.warn('取消歌曲封面预热失败', error) }
        const activeScope = folderPlaylistRef.current ? playlistScope(folderPlaylistRef.current) : null
        for (const [scope, playlist] of sessionPlaylistDescriptorsRef.current) {
          if (playlist.sourceKind === 'folder' && scope !== activeScope) sessionPlaylistDescriptorsRef.current.delete(scope)
        }
        setSessionPlaylists((previous) => previous.filter((item) => item.sourceKind !== 'folder'))
        setLibraryFolderPlaylists([])
        setSelectedFolderPaths([])
        setLibraryFolderErrors({})
        setLibraryStatus('ready')
      } catch (error) {
        if (libraryEpochRef.current !== epoch) return
        try {
          const current = await getLibraryFolders()
          if (libraryEpochRef.current !== epoch) return
          selectedFolderPathsRef.current = current.folders
          setSelectedFolderPaths(current.folders)
        } catch {
          selectedFolderPathsRef.current = priorPaths
        }
        const message = error instanceof Error ? error.message : String(error)
        setLibraryStatus('error')
        setLibraryFolderErrors((previous) => ({ ...previous, '': `清空歌曲选择失败：${message}` }))
      }
    })
    libraryMutationRef.current = mutation.catch(() => undefined)
    await mutation
  }, [])

  useEffect(() => {
    const epoch = libraryEpochRef.current + 1
    libraryEpochRef.current = epoch
    let disposed = false
    void (async () => {
      try {
        const result = await getLibraryFolders()
        if (disposed || libraryEpochRef.current !== epoch) return
        if (!Array.isArray(result.folders) || !result.folders.every((path) => typeof path === 'string')) {
          throw new Error('歌曲文件夹列表格式错误')
        }
        selectedFolderPathsRef.current = [...new Set([...result.folders, ...selectedFolderPathsRef.current])]
        setSelectedFolderPaths(selectedFolderPathsRef.current)
        setLibraryStatus('ready')
        // Scanning two directories at a time lets a large library restore
        // progressively without monopolizing the backend's metadata path.
        let cursor = 0
        const scanNext = async () => {
          while (!disposed && libraryEpochRef.current === epoch && cursor < result.folders.length) {
            const path = result.folders[cursor++]
            try {
              const playlist = await scanLibraryFolder(path)
              if (disposed || libraryEpochRef.current !== epoch) return
              if (playlist.sourceKind !== 'folder') throw new Error('返回的歌曲来源不是文件夹')
              rememberLibraryPlaylist(playlist, epoch)
            } catch (error) {
              if (disposed || libraryEpochRef.current !== epoch) return
              const message = error instanceof Error ? error.message : String(error)
              setLibraryFolderErrors((previous) => ({ ...previous, [path]: message }))
            }
          }
        }
        await Promise.all([scanNext(), scanNext()])
      } catch (error) {
        if (disposed || libraryEpochRef.current !== epoch) return
        const message = error instanceof Error ? error.message : String(error)
        setLibraryFolderErrors((previous) => ({ ...previous, '': `读取歌曲选择失败：${message}` }))
        setLibraryStatus('error')
      } finally {
        if (!disposed && libraryEpochRef.current === epoch) setLibraryRestorePending(false)
      }
    })()
    return () => {
      disposed = true
      libraryEpochRef.current += 1
      void cancelLibraryCoverWarmup().catch(() => undefined)
    }
  }, [rememberLibraryPlaylist])

  // Publish one batch of tag rows. Every guard below is load-bearing: a stale
  // pass must never write another scope, another descriptor set, or a list the
  // user removed, and a replaced list must not keep rows for vanished songs.
  const commitPlaylistSummaryRows = useCallback((
    scope: string,
    runId: number,
    fingerprint: string,
    descriptorPaths: ReadonlyMap<string, string>,
    rows: Readonly<Record<string, PlaylistTrackRow>>,
  ) => {
    if (playlistSummaryDisposedRef.current) return false
    if (playlistSummaryRunRef.current.get(scope)?.runId !== runId) return false
    const playlist = findPlaylistForScope(scope)
    if (!playlist) {
      playlistSummaryRunRef.current.delete(scope)
      const nextStatuses = { ...playlistSummaryStatusRef.current }
      delete nextStatuses[scope]
      playlistSummaryStatusRef.current = nextStatuses
      setPlaylistSummaryStatusByScope(nextStatuses)
      return false
    }
    if (playlistDescriptorFingerprint(playlist.tracks) !== fingerprint) return false
    const currentPaths = new Map(playlist.tracks.map((descriptor) => [descriptor.id, descriptor.sourcePath]))
    for (const trackId of Object.keys(rows)) {
      const requestedPath = descriptorPaths.get(trackId)
      if (requestedPath === undefined || currentPaths.get(trackId) !== requestedPath) return false
    }

    const scopeRows = { ...(playlistSummaryRowsRef.current[scope] ?? {}) }
    let changed = false
    for (const [trackId, row] of Object.entries(rows)) {
      const existing = scopeRows[trackId]
      if (existing && playlistTrackRowEqual(existing, row)) continue
      scopeRows[trackId] = row
      changed = true
    }
    if (!changed) return true
    playlistSummaryRowsRef.current = { ...playlistSummaryRowsRef.current, [scope]: scopeRows }
    setPlaylistTrackSummariesByScope(playlistSummaryRowsRef.current)
    // `queueTracks` is deliberately left untouched: it is the dependency of the
    // next/previous and prefetch paths, so rewriting it would change identity
    // and re-trigger navigation work. The queue panel consumes the same merged
    // rows through the player view model instead.
    return true
  }, [findPlaylistForScope])

  const runPlaylistSummaryPass = useCallback(async (
    scope: string,
    runId: number,
    fingerprint: string,
    descriptors: readonly AudioFolderTrackRef[],
  ) => {
    const runIsCurrent = () => !playlistSummaryDisposedRef.current
      && playlistSummaryRunRef.current.get(scope)?.runId === runId
    const descriptorsById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
    const descriptorPaths = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor.sourcePath]))
    const { paths, descriptorsByPath } = playlistSummaryProbePaths(descriptors)
    // Accumulate the entire pass and publish it once. A 1791-track list would
    // otherwise re-render (and re-measure the whole grid) once per batch.
    const collected: Record<string, PlaylistTrackRow> = {}
    const harvest = (batch: readonly string[], items: readonly AudioPlaylistTrackSummaryItem[]) => {
      for (const [index, item] of items.entries()) {
        const sourcePath = batch[index]
        if (sourcePath === undefined || item.sourcePath !== sourcePath) continue
        for (const trackId of descriptorsByPath.get(sourcePath) ?? []) {
          const descriptor = descriptorsById.get(trackId)
          if (descriptor) collected[trackId] = playlistTrackRowFromSummary(descriptor, item.summary)
        }
      }
    }
    try {
      for (const batch of chunkPlaylistSummaryPaths(paths, AUDIO_PLAYLIST_TRACK_SUMMARY_BATCH_LIMIT)) {
        if (!runIsCurrent()) return
        let items: AudioPlaylistTrackSummaryItem[] | null = null
        let lastError: unknown = null
        // One automatic retry only: a missing or failing command must settle into
        // the file-name fallback instead of retrying on every render.
        for (let attempt = 0; attempt < 2 && items === null; attempt += 1) {
          try {
            items = await probeAudioPlaylistTrackSummaries(batch)
          } catch (error) {
            lastError = error
          }
        }
        if (!runIsCurrent()) return
        if (items === null) {
          console.warn('Playlist track tag summaries are unavailable; keeping file name rows', {
            scope,
            batchSize: batch.length,
            error: lastError,
          })
          // Degraded, not stuck: publish whatever real rows the earlier batches
          // produced so every row still renders truthful text.
          if (commitPlaylistSummaryRows(scope, runId, fingerprint, descriptorPaths, collected)) {
            commitPlaylistSummaryStatus(scope, 'ready')
          }
          return
        }
        harvest(batch, items)
      }
      if (!runIsCurrent()) return
      if (commitPlaylistSummaryRows(scope, runId, fingerprint, descriptorPaths, collected)) {
        commitPlaylistSummaryStatus(scope, 'ready')
      }
    } catch (error) {
      console.warn('Playlist track tag summary pass failed', { scope, error })
      if (runIsCurrent()) commitPlaylistSummaryStatus(scope, 'ready')
    }
  }, [commitPlaylistSummaryRows, commitPlaylistSummaryStatus])

  const ensurePlaylistSummaries = useCallback((scope: string, playlistHint?: AudioFolderPlaylist) => {
    const playlist = playlistHint ?? findPlaylistForScope(scope)
    if (!playlist) return
    if (playlist.tracks.length === 0) {
      commitPlaylistSummaryStatus(scope, 'ready')
      return
    }
    const fingerprint = playlistDescriptorFingerprint(playlist.tracks)
    const currentRun = playlistSummaryRunRef.current.get(scope)
    // Idempotent: an in-flight or already committed pass for this exact
    // descriptor set is reused, a replaced descriptor set is re-fetched once.
    if (currentRun?.fingerprint === fingerprint) return

    const runId = playlistSummaryRunIdRef.current + 1
    playlistSummaryRunIdRef.current = runId
    playlistSummaryRunRef.current.set(scope, { runId, fingerprint })
    if (currentRun) {
      const nextRows = { ...playlistSummaryRowsRef.current }
      delete nextRows[scope]
      playlistSummaryRowsRef.current = nextRows
      setPlaylistTrackSummariesByScope(nextRows)
    }
    commitPlaylistSummaryStatus(scope, 'loading')
    void runPlaylistSummaryPass(scope, runId, fingerprint, playlist.tracks)
  }, [commitPlaylistSummaryStatus, findPlaylistForScope, runPlaylistSummaryPass])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const playlists = await getLibraryPlaylists()
        if (disposed) return
        if (!Array.isArray(playlists) || playlists.some((playlist) => playlist.sourceKind !== 'm3u8'
          || typeof playlist.sourcePath !== 'string' || !playlist.sourcePath
          || typeof playlist.sourceName !== 'string' || typeof playlist.directoryName !== 'string'
          || !Array.isArray(playlist.tracks) || playlist.tracks.some((track) => !track || typeof track.id !== 'string'
            || typeof track.sourcePath !== 'string' || typeof track.fileName !== 'string' || typeof track.available !== 'boolean'))) {
          throw new Error('已保存的播放列表格式错误')
        }
        const restored: AudioFolderPlaylist[] = []
        for (const playlist of playlists) {
          const scope = playlistScope(playlist)
          // Imports completed during this read own their newer descriptors.
          if (sessionPlaylistDescriptorsRef.current.has(scope)) continue
          sessionPlaylistDescriptorsRef.current.set(scope, playlist)
          restored.push(playlist)
          ensurePlaylistSummaries(scope, playlist)
        }
        setSessionPlaylists((previous) => {
          const currentScopes = new Set(previous.map(playlistScope))
          return [...restored.filter((playlist) => !currentScopes.has(playlistScope(playlist))), ...previous]
        })
      } catch (error) {
        if (!disposed) toast.error(`恢复播放列表失败：${commandError(error).message}`)
      } finally {
        if (!disposed) setPlaylistRestorePending(false)
      }
    })()
    return () => { disposed = true }
  }, [ensurePlaylistSummaries])

  const selectFolders = useCallback(async () => {
    if (libraryImportPendingRef.current) return
    libraryImportPendingRef.current = true
    setLibraryImportPending(true)
    const epoch = libraryEpochRef.current
    try {
      const paths = await selectLibraryFolders()
      if (paths === null || libraryEpochRef.current !== epoch) return
      const seen = new Set<string>()
      for (const path of paths) {
        if (libraryEpochRef.current !== epoch) return
        const key = normalizeAudioSourcePath(path)
        if (seen.has(key)) continue
        seen.add(key)
        try {
          const source = await scanLibraryFolder(path)
          if (libraryEpochRef.current !== epoch) return
          if (source.sourceKind !== 'folder') throw new Error('返回的歌曲来源不是文件夹')
          await registerLibraryPlaylist(source, epoch)
          if (libraryEpochRef.current !== epoch) return
          if (sessionPlaylistDescriptorsRef.current.get(playlistScope(source)) === source) {
            ensurePlaylistSummaries(playlistScope(source), source)
          }
        } catch (error) {
          if (libraryEpochRef.current !== epoch) return
          const message = commandError(error).message
          setLibraryFolderErrors((previous) => ({ ...previous, [path]: message }))
          toast.error(`无法添加文件夹：${message}`)
        }
      }
    } catch (error) {
      if (libraryEpochRef.current === epoch) toast.error(`无法选择文件夹：${commandError(error).message}`)
    } finally {
      libraryImportPendingRef.current = false
      setLibraryImportPending(false)
    }
  }, [ensurePlaylistSummaries, registerLibraryPlaylist])

  const importPlaylist = useCallback(async () => {
    if (libraryImportPendingRef.current) return
    libraryImportPendingRef.current = true
    setLibraryImportPending(true)
    try {
      const playlist = await importAudioPlaylist()
      if (playlist === null || playlistSummaryDisposedRef.current) return
      if (playlist.sourceKind !== 'm3u8') throw new Error('返回的来源不是 M3U8 播放列表')
      const scope = playlistScope(playlist)
      sessionPlaylistDescriptorsRef.current.set(scope, playlist)
      setSessionPlaylists((previous) => previous.some((item) => playlistScope(item) === scope)
        ? previous.map((item) => playlistScope(item) === scope ? playlist : item)
        : [...previous, playlist])
      ensurePlaylistSummaries(scope, playlist)
    } catch (error) {
      if (!playlistSummaryDisposedRef.current) toast.error(`无法导入播放列表：${commandError(error).message}`)
    } finally {
      libraryImportPendingRef.current = false
      setLibraryImportPending(false)
    }
  }, [ensurePlaylistSummaries])

  const createPlaylist = useCallback((name: string, songKeys: readonly string[]): string | null => {
    const title = name.trim()
    if (!title) return null
    const descriptors = new Map(libraryFolderPlaylists.flatMap((source) => source.tracks.map((item) => [normalizeAudioSourcePath(item.sourcePath), item] as const)))
    const tracks = [...new Set(songKeys)].flatMap((key) => {
      const descriptor = descriptors.get(key)
      return descriptor ? [{ ...descriptor }] : []
    })
    if (!tracks.length) return null
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const playlist: AudioFolderPlaylist = {
      sourceKind: 'custom', sourcePath: `custom:${id}`, sourceName: title,
      directoryPath: '', directoryName: title, selectedIndex: 0, tracks,
    }
    const scope = playlistScope(playlist)
    sessionPlaylistDescriptorsRef.current.set(scope, playlist)
    setSessionPlaylists((previous) => [...previous, playlist])
    ensurePlaylistSummaries(scope, playlist)
    return scope
  }, [libraryFolderPlaylists, ensurePlaylistSummaries])

  const activatePlaylistScope = useCallback((playlist: AudioFolderPlaylist, summarySeed?: Readonly<Record<string, PlaylistTrackRow>>) => {
    const nextScope = playlistScope(playlist)
    const sourcePlaylist = playbackQueueOrigin(playlist)?.sourcePlaylist
    if (sourcePlaylist && !sessionPlaylistDescriptorsRef.current.has(playlistScope(sourcePlaylist))) {
      const sourceScope = playlistScope(sourcePlaylist)
      sessionPlaylistDescriptorsRef.current.set(sourceScope, sourcePlaylist)
      setSessionPlaylists((previous) => previous.some((item) => playlistScope(item) === sourceScope)
        ? previous : [...previous, sourcePlaylist])
      ensurePlaylistSummaries(sourceScope, sourcePlaylist)
    }
    // Snapshots only own the live playback queue. Keep source descriptors and
    // user playlists intact, and retire the previous snapshot's metadata lane.
    const previousPlaylist = folderPlaylistRef.current
    const previousScope = previousPlaylist ? playlistScope(previousPlaylist) : null
    if (previousScope && previousScope !== nextScope && playbackQueueOrigin(previousPlaylist)) {
      sessionPlaylistDescriptorsRef.current.delete(previousScope)
      playlistSummaryRunRef.current.delete(previousScope)
      const nextRows = { ...playlistSummaryRowsRef.current }
      const nextStatuses = { ...playlistSummaryStatusRef.current }
      delete nextRows[previousScope]
      delete nextStatuses[previousScope]
      playlistSummaryRowsRef.current = nextRows
      playlistSummaryStatusRef.current = nextStatuses
      setPlaylistTrackSummariesByScope(nextRows)
      setPlaylistSummaryStatusByScope(nextStatuses)
    }
    // Store descriptors only; thumbnail object URLs belong to the active scope.
    if (playlist.sourceKind !== 'folder' && !playbackQueueOrigin(playlist)) {
      setSessionPlaylists((previous) => previous.some((item) => playlistScope(item) === nextScope)
        ? previous.map((item) => playlistScope(item) === nextScope ? playlist : item)
        : [...previous, playlist])
    }
    sessionPlaylistDescriptorsRef.current.set(nextScope, playlist)
    // Start the read-only tag pass with the list itself, so the table is already
    // populated when the user looks at it. Cached rows are not cleared here.
    if (summarySeed) {
      playlistSummaryRowsRef.current = { ...playlistSummaryRowsRef.current, [nextScope]: summarySeed }
      setPlaylistTrackSummariesByScope(playlistSummaryRowsRef.current)
    }
    if (summarySeed && playlist.tracks.every((item) => summarySeed[item.id])) commitPlaylistSummaryStatus(nextScope, 'ready')
    else ensurePlaylistSummaries(nextScope)
    // The queue keeps neutral rows (filename title, unknown artist/album). The
    // tag rows reach both panels through the player view model, so `queueTracks`
    // is never rewritten by the summary pass.
    const nextQueueTracks = playlistTrackSummaries(playlist)
    const currentPresentation = presentationTrackRef.current
    const currentIndex = currentPresentation
      ? nextQueueTracks.findIndex((track) => track.id === currentPresentation.id)
      : -1
    if (currentPresentation && currentIndex >= 0) {
      nextQueueTracks[currentIndex] = trackSummaryFromTrack(currentPresentation)
    }
    queueTrackIndexRef.current = new Map(nextQueueTracks.map((track, index) => [track.id, index]))
    setQueueTracks((previous) => {
      if (previous.length !== nextQueueTracks.length) return nextQueueTracks
      let changed = false
      const reconciled = nextQueueTracks.map((nextTrack, index) => {
        const previousTrack = previous[index]
        if (previousTrack && trackSummaryEqual(previousTrack, nextTrack)) return previousTrack
        changed = true
        return nextTrack
      })
      return changed ? reconciled : previous
    })

    if (playlistScopeRef.current === nextScope) {
      folderPlaylistRef.current = playlist
      setFolderPlaylist(playlist)
      // The real activation owns the duration source now.
      setPendingDurationPlaylist(null)
      return
    }

    playlistScopeRef.current = nextScope
    playlistArtworkGrace.reset()
    playlistCoverSessionRef.current = null
    playlistCoverSessionFailuresRef.current = 0
    if (playlistCoverSessionRetryTimerRef.current) clearTimeout(playlistCoverSessionRetryTimerRef.current)
    playlistCoverSessionRetryTimerRef.current = null
    void ensurePlaylistCoverSession().catch(() => undefined)
    for (const timer of playlistVisualRetryTimersRef.current.values()) clearTimeout(timer)
    playlistVisualRetryTimersRef.current.clear()
    playlistImageErrorCountsRef.current.clear()
    playlistVisualFailedRef.current.clear()
    for (const pending of playlistPendingReplacementRef.current.values()) {
      for (const older of pending.olderVisuals) {
        if (older.visual.coverThumbnail) URL.revokeObjectURL(older.visual.coverThumbnail.src)
      }
      if (pending.previous.coverThumbnail) URL.revokeObjectURL(pending.previous.coverThumbnail.src)
    }
    playlistPendingReplacementRef.current.clear()
    playlistScopeEpochRef.current += 1
    playlistVisualGenerationRef.current += 1
    playlistVisualDesiredIdsRef.current = new Set()
    visiblePlaylistTrackIdsRef.current = []
    playlistArtworkDemandRef.current = undefined
    keepPersistentPlaylistArtworkRef.current = false
    showPlaylistArtworkRef.current = true
    playlistMetadataGenerationRef.current += 1
    playlistMetadataWindowKeyRef.current = null
    playlistTrackMetadataRef.current = {}
    playlistMetadataHydrationQueueRef.current = []
    setPlaylistTrackMetadata({})
    playlistVisualWindowKeyRef.current = null
    releasePlaylistVisuals(playlistTrackVisualsRef.current)
    playlistTrackVisualsRef.current = {}
    playlistVisualEdgeRef.current.clear()
    playlistVisualSourceRef.current.clear()
    playlistDesiredEdgeRef.current.clear()
    playlistVisualHydrationQueueRef.current = []
    setPlaylistTrackVisuals({})
    preparedTrackCardPreviewRef.current = null
    artworkPrefetchGenerationRef.current += 1
    setArtworkPrefetchCandidates([])
    hydratedAudioTrackCacheRef.current.clear()
    hydrationInFlightRef.current.clear()
    const stagedDetails = stagedTrackDetailsRef.current
    stagedTrackDetailsRef.current = null
    if (
      stagedDetails
      && stagedDetails.track.id === latestAudioStateRef.current?.currentTrackId
      && playlist.tracks.some((track) => (
        track.id === stagedDetails.track.id
        && normalizeAudioSourcePath(track.sourcePath) === normalizeAudioSourcePath(stagedDetails.track.sourcePath)
      ))
    ) {
      hydratedCacheSet(
        hydratedAudioTrackCacheRef.current,
        stagedDetails.track.sourcePath,
        stagedDetails.track,
      )
    }
    folderPlaylistRef.current = playlist
    setFolderPlaylist(playlist)
    // The real activation owns the duration source now.
    setPendingDurationPlaylist(null)
  }, [commitPlaylistSummaryStatus, ensurePlaylistCoverSession, ensurePlaylistSummaries, playlistArtworkGrace])

  const clearPresentationTrack = useCallback((nextContentState: Exclude<PlayerContentState, 'track'>) => {
    presentationTrackRef.current = null
    presentationArtworkRef.current = null
    setPresentationTrack(null)
    setPresentationArtwork(null)
    commitDetailsPending(false)
    setContentState(nextContentState)
  }, [commitDetailsPending])

  const recordAcceptedTrackSelectionActivity = useCallback(() => {
    const nextSequence = selectionActivitySequenceRef.current + 1
    selectionActivitySequenceRef.current = nextSequence
    setSelectionActivitySequence((current) => Math.max(current, nextSequence))
    return nextSequence
  }, [])

  const beginTrackSelection = useCallback((
    targetTrackId: string | null,
    sourcePath: string | null,
    usesLoadAndPlay = false,
    targetScope: string | null = null,
    visualNavigation?: { direction: Direction; source: TrackSelectionVisualSource; previewTokenId?: number },
  ) => {
    const existingPending = pendingSelectionRef.current
    const existingBackendStateMatches = Boolean(
      existingPending?.targetTrackId
      && existingPending.generation !== null
      && latestAudioStateRef.current?.currentTrackId === existingPending.targetTrackId
      && latestAudioStateRef.current.generation === existingPending.generation,
    )
    const existingTargetConfirmed = Boolean(
      existingBackendStateMatches
      && (existingPending?.commandConfirmed || existingPending?.detailsSettled),
    )
    const previousPresentationTrack = existingPending && !existingTargetConfirmed
      ? existingPending.previousPresentationTrack
      : presentationTrackRef.current
    const previousArtwork = existingPending && !existingTargetConfirmed
      ? existingPending.previousArtwork
      : presentationArtworkRef.current
    const previousDetailsPending = existingPending && !existingTargetConfirmed
      ? existingPending.previousDetailsPending
      : detailsPendingRef.current
    const currentPresentationIsBackendConfirmed = Boolean(
      presentationTrackRef.current
      && latestAudioStateRef.current?.currentTrackId === presentationTrackRef.current.id,
    )
    const previousAudioTrack = existingPending && !existingTargetConfirmed
      ? existingPending.previousAudioTrack
      : existingTargetConfirmed
        ? audioTrackRef.current?.id === existingPending?.targetTrackId
          ? audioTrackRef.current
          : null
        : currentPresentationIsBackendConfirmed
          && audioTrackRef.current?.id === presentationTrackRef.current?.id
          ? audioTrackRef.current
          : null
    const previousSourcePath = existingPending && !existingTargetConfirmed
      ? existingPending.previousSourcePath
      : existingTargetConfirmed
        ? previousAudioTrack?.sourcePath ?? existingPending?.sourcePath ?? null
        : previousAudioTrack?.sourcePath ?? null
    const requestId = selectionRequestIdRef.current + 1
    if (visualNavigation?.source !== 'automatic') setAutomaticContinuationVisual(false)
    startupRestoreTimedOutRef.current = false
    selectionRequestIdRef.current = requestId
    const selectionSequence = targetTrackId
      ? recordAcceptedTrackSelectionActivity()
      : selectionActivitySequenceRef.current
    if (targetTrackId && visualNavigation) {
      const outgoingState = latestAudioStateRef.current
      const outgoingDurationSeconds = (outgoingState?.durationMs ?? 0) / 1000
      const isDifferentTrack = Boolean(outgoingState?.currentTrackId
        && outgoingState.currentTrackId !== targetTrackId)
      const progressStartRatio = visualNavigation.source === 'automatic'
        ? 1
        : isDifferentTrack && outgoingDurationSeconds > 0
          ? Math.min(1, Math.max(0, visualTimelineClock.getPositionSeconds() / outgoingDurationSeconds))
          : 0
      setSelectionVisualIntent({
        requestId,
        sequence: selectionSequence,
        targetTrackId,
        direction: visualNavigation.direction,
        source: visualNavigation.source,
        progressStartRatio,
        preservePlayingVisual: Boolean(usesLoadAndPlay && (
          isDifferentTrack && outgoingState?.phase === 'playing'
          || visualNavigation.source === 'automatic' && outgoingState?.phase === 'ended'
        )),
        previewTokenId: visualNavigation.previewTokenId,
      })
    }
    if (targetTrackId) {
      logicalCursorTrackIdRef.current = targetTrackId
      desiredAudioTrackIdRef.current = targetTrackId
    }
    stagedTrackDetailsRef.current = null
    pendingSelectionRef.current = {
      requestId,
      targetTrackId,
      sourcePath,
      targetScope,
      previousGeneration: latestAudioStateRef.current?.generation ?? null,
      generation: null,
      usesLoadAndPlay,
      commandConfirmed: false,
      detailsSettled: false,
      replacementStarted: false,
      loadedTrackId: null,
      previousPresentationTrack,
      previousArtwork,
      previousDetailsPending,
      previousSourcePath,
      previousAudioTrack,
    }
    audioSelectionInProgressRef.current = true
    setSelectionPending(true)
    setAudioBusy(targetTrackId === null)
    commitAudioError(null)
    setContentState('loading')
    commitDetailsPending(targetTrackId !== null)
    return requestId
  }, [commitAudioError, commitDetailsPending, recordAcceptedTrackSelectionActivity, visualTimelineClock])

  const selectionIsCurrent = useCallback((requestId: number, targetTrackId?: string) => {
    const pending = pendingSelectionRef.current
    return pending?.requestId === requestId
      && (targetTrackId === undefined || pending.targetTrackId === targetTrackId)
      && (targetTrackId === undefined || desiredAudioTrackIdRef.current === targetTrackId)
  }, [])

  const selectionTransactionIsCurrent = useCallback((
    requestId: number,
    generation: number,
    targetTrackId: string,
  ) => {
    const pending = pendingSelectionRef.current
    if (
      pending?.requestId !== requestId
      || pending.targetTrackId !== targetTrackId
      || (pending.previousGeneration !== null && generation <= pending.previousGeneration)
      || (pending.generation !== null && pending.generation !== generation)
    ) return false
    pending.generation = generation
    return true
  }, [])

  const requestHydratedAudioTrack = useCallback((
    sourcePath: string,
    requestedEpoch = playlistScopeEpochRef.current,
  ) => {
    if (requestedEpoch === playlistScopeEpochRef.current) {
      const cached = hydratedCacheGet(hydratedAudioTrackCacheRef.current, sourcePath)
      if (cached) return Promise.resolve(cached)

      const inFlight = hydrationInFlightRef.current.get(sourcePath)
      if (inFlight) return inFlight
    }

    const request = hydrateAudioTrack(sourcePath)
      .then((hydratedTrack) => {
        if (requestedEpoch === playlistScopeEpochRef.current) {
          hydratedCacheSet(hydratedAudioTrackCacheRef.current, sourcePath, hydratedTrack)
        }
        return hydratedTrack
      })
      .finally(() => {
        if (hydrationInFlightRef.current.get(sourcePath) === request) {
          hydrationInFlightRef.current.delete(sourcePath)
        }
      })

    if (requestedEpoch === playlistScopeEpochRef.current) {
      hydrationInFlightRef.current.set(sourcePath, request)
    }
    return request
  }, [])

  const commitPlaylistTrackMetadata = useCallback((hydratedTrack: AudioTrackRef) => {
    if (playlistTrackMetadataRef.current[hydratedTrack.id]) return
    const visual = audioTrackToPlaylistVisual(hydratedTrack)
    const metadata: PlaylistTrackMetadata = {
      id: visual.id,
      title: visual.title,
      artist: visual.artist,
      album: visual.album,
      durationSeconds: visual.durationSeconds,
      fileExtension: visual.fileExtension,
      coverTone: visual.coverTone,
      audioFormat: visual.audioFormat,
      hasLocalArtwork: visual.hasLocalArtwork,
    }
    const nextMetadata = { ...playlistTrackMetadataRef.current, [hydratedTrack.id]: metadata }
    playlistTrackMetadataRef.current = nextMetadata
    setPlaylistTrackMetadata(nextMetadata)
  }, [])

  const pumpPlaylistMetadataHydration = useCallback(() => {
    function pump(): void {
      // Tag summaries and duration batches already cover every text row. The
      // full per-file hydration lane is optional during navigation motion.
      if (!backgroundArtworkAllowedRef.current) return
      while (
        playlistMetadataHydrationActiveRef.current < 2
        && playlistMetadataHydrationQueueRef.current.length > 0
      ) {
        const job = playlistMetadataHydrationQueueRef.current.shift()
        if (!job) break
        playlistMetadataHydrationActiveRef.current += 1
        void requestHydratedAudioTrack(job.sourcePath, job.playlistEpoch)
          .then((hydratedTrack) => {
            const activePlaylist = folderPlaylistRef.current
            const activeDescriptor = activePlaylist?.tracks.find((candidate) => candidate.id === job.trackId)
            if (
              playlistMetadataGenerationRef.current !== job.generation
              || playlistScopeEpochRef.current !== job.playlistEpoch
              || playlistScopeRef.current !== job.scope
              || !activePlaylist
              || playlistScope(activePlaylist) !== job.scope
              || activeDescriptor?.id !== job.trackId
              || normalizeAudioSourcePath(activeDescriptor.sourcePath) !== job.normalizedSourcePath
              || hydratedTrack.id !== job.trackId
              || normalizeAudioSourcePath(hydratedTrack.sourcePath) !== job.normalizedSourcePath
            ) return
            commitPlaylistTrackMetadata(hydratedTrack)
          })
          .catch(() => undefined)
          .finally(() => {
            playlistMetadataHydrationActiveRef.current -= 1
            pump()
          })
      }
    }
    pump()
  }, [commitPlaylistTrackMetadata, requestHydratedAudioTrack])

  const pumpPlaylistVisualHydration = useCallback(() => {
    function pump(): void {
      while (
        playlistVisualHydrationActiveRef.current < 2
        && playlistVisualHydrationQueueRef.current.length > 0
      ) {
        const urgentIndex = playlistVisualHydrationQueueRef.current.findIndex((candidate) =>
          !candidate.optional || playlistVisualRequiredIdsRef.current.has(candidate.trackId))
        if (urgentIndex < 0) {
          if (!backgroundArtworkAllowedRef.current || playlistVisualHydrationActiveRef.current > 0) return
          if (!playlistOptionalIdleReadyRef.current) {
            if (playlistOptionalIdleRef.current === null) {
              playlistOptionalIdleRef.current = scheduleOptionalArtworkIdle(() => {
                playlistOptionalIdleRef.current = null
                playlistOptionalIdleReadyRef.current = true
                pump()
              })
            }
            return
          }
          playlistOptionalIdleReadyRef.current = false
        } else {
          playlistOptionalIdleReadyRef.current = false
          if (playlistOptionalIdleRef.current !== null) {
            cancelOptionalArtworkIdle(playlistOptionalIdleRef.current)
            playlistOptionalIdleRef.current = null
          }
        }
        const job = playlistVisualHydrationQueueRef.current.splice(urgentIndex < 0 ? 0 : urgentIndex, 1)[0]
        if (!job) break
        playlistVisualHydrationActiveRef.current += 1
        playlistVisualHydrationActiveJobsRef.current.set(job.trackId, job)
        let published = false
        let loadingSource = true
        void probeAudioPlaylistCover(job.sourcePath)
          .then(async (coverSource) => {
            const jobIsStale = () => {
              const activePlaylist = folderPlaylistRef.current
              const activeDescriptor = activePlaylist?.tracks.find((candidate) => candidate.id === job.trackId)
              return playlistVisualGenerationRef.current !== job.generation
                || playlistScopeEpochRef.current !== job.playlistEpoch
                || playlistScopeRef.current !== job.scope
                || !playlistVisualDesiredIdsRef.current.has(job.trackId)
                || !activePlaylist
                || playlistScope(activePlaylist) !== job.scope
                || activeDescriptor?.id !== job.trackId
                || normalizeAudioSourcePath(activeDescriptor.sourcePath) !== job.normalizedSourcePath
                || coverSource.id !== job.trackId
                || normalizeAudioSourcePath(coverSource.sourcePath) !== job.normalizedSourcePath
            }
            if (jobIsStale()) return

            loadingSource = false
            let coverThumbnail: PlaylistCoverImage | undefined
            const coverFilePath = coverSource.coverArt?.filePath
            if (coverFilePath) {
              const firstPlaylistTrackId = folderPlaylistRef.current?.tracks[0]?.id
              const currentTrackId = logicalCursorTrackIdRef.current
                ?? presentationTrackRef.current?.id
                ?? latestAudioStateRef.current?.currentTrackId
              const pixels = await schedulePlaylistCoverPixels({
                clientId: job.clientId,
                filePath: coverFilePath,
                maxEdge: job.trackId === firstPlaylistTrackId ? 512 : job.maxEdge,
                windowGeneration: job.backendGeneration,
              }, {
                priority: job.trackId === currentTrackId ? 0
                  : libraryVisibleRef.current && visiblePlaylistTrackIdsRef.current.includes(job.trackId) ? 1 : 2,
                isCurrent: () => !jobIsStale(),
              })
              if (!pixels) return
              if (jobIsStale()) return
              coverThumbnail = playlistCoverImageFromPixels(pixels)
              try {
                await decodePlaylistCover(coverThumbnail)
              } catch (error) {
                URL.revokeObjectURL(coverThumbnail.src)
                throw error
              }
            }

            if (
              jobIsStale()
              || (playlistTrackVisualsRef.current[job.trackId]
                && (playlistVisualEdgeRef.current.get(job.trackId) ?? 0) >= job.maxEdge)
            ) {
              if (coverThumbnail) URL.revokeObjectURL(coverThumbnail.src)
              return
            }
            const previousVisual = playlistTrackVisualsRef.current[job.trackId]
            const previousThumbnail = previousVisual?.coverThumbnail
            const previousEdge = playlistVisualEdgeRef.current.get(job.trackId)
            const hasUnrenderableCover = coverSource.coverArt !== null && !coverFilePath
            if (hasUnrenderableCover) {
              // Keep the baseline's quiet data-URL-only state. Do not decode an
              // unchecked full-size original or advertise a successful upgrade.
              playlistVisualFailedRef.current.set(job.trackId, job.normalizedSourcePath)
              if (previousThumbnail) return
            }
            const visual: PlaylistTrackVisual = {
              id: coverSource.id,
              coverTone: coverToneForTrackId(coverSource.id),
              hasLocalArtwork: coverSource.coverArt !== null,
              coverThumbnail,
            }
            const nextVisuals = { ...playlistTrackVisualsRef.current, [job.trackId]: visual }
            playlistTrackVisualsRef.current = nextVisuals
            if (!hasUnrenderableCover) playlistVisualEdgeRef.current.set(job.trackId, job.maxEdge)
            playlistVisualSourceRef.current.set(job.trackId, job.normalizedSourcePath)
            setPlaylistTrackVisuals(nextVisuals)
            published = !hasUnrenderableCover
            if (previousThumbnail && previousVisual && previousEdge && coverThumbnail) {
              const pendingPrevious = playlistPendingReplacementRef.current.get(previousThumbnail.src)
              playlistPendingReplacementRef.current.delete(previousThumbnail.src)
              playlistPendingReplacementRef.current.set(coverThumbnail.src, {
                trackId: job.trackId,
                previous: previousVisual,
                edge: previousEdge,
                olderVisuals: pendingPrevious
                  ? [{ visual: pendingPrevious.previous, edge: pendingPrevious.edge }, ...pendingPrevious.olderVisuals]
                  : [],
              })
            } else if (previousThumbnail) {
              const pendingPrevious = playlistPendingReplacementRef.current.get(previousThumbnail.src)
              playlistPendingReplacementRef.current.delete(previousThumbnail.src)
              requestAnimationFrame(() => {
                URL.revokeObjectURL(previousThumbnail.src)
                if (pendingPrevious?.previous.coverThumbnail) URL.revokeObjectURL(pendingPrevious.previous.coverThumbnail.src)
                for (const older of pendingPrevious?.olderVisuals ?? []) {
                  if (older.visual.coverThumbnail) URL.revokeObjectURL(older.visual.coverThumbnail.src)
                }
              })
            }
          })
          .catch((error: unknown) => {
            const code = isAudioCoverPixelsError(error) ? error.code : 'WORKER_FAILED'
            const retryable = loadingSource
              ? (isAudioCommandError(error) ? error.code === 'INTERNAL_ERROR' && error.recoverable : code === 'WORKER_FAILED')
              : ['WORKER_FAILED', 'ALLOCATION_FAILED', 'STALE_REQUEST'].includes(code)
            if (
              job.attempt >= 2
              || !retryable
              || playlistScopeEpochRef.current !== job.playlistEpoch
              || !playlistVisualDesiredIdsRef.current.has(job.trackId)
            ) {
              if (playlistScopeEpochRef.current === job.playlistEpoch && code !== 'STALE_REQUEST') {
                playlistVisualFailedRef.current.set(job.trackId, job.normalizedSourcePath)
              }
              return
            }
            const delay = code === 'STALE_REQUEST' ? 0 : 500 * (2 ** job.attempt)
            const previousTimer = playlistVisualRetryTimersRef.current.get(job.trackId)
            if (previousTimer) clearTimeout(previousTimer)
            const timer = setTimeout(() => {
              playlistVisualRetryTimersRef.current.delete(job.trackId)
              if (
                playlistScopeEpochRef.current !== job.playlistEpoch
                || !playlistVisualDesiredIdsRef.current.has(job.trackId)
                || (playlistTrackVisualsRef.current[job.trackId]
                  && (playlistVisualEdgeRef.current.get(job.trackId) ?? 0) >= job.maxEdge)
              ) return
              if (playlistVisualHydrationActiveJobsRef.current.has(job.trackId)) return
              playlistVisualHydrationQueueRef.current.unshift({ ...job, attempt: job.attempt + 1 })
              pump()
            }, delay)
            playlistVisualRetryTimersRef.current.set(job.trackId, timer)
          })
          .finally(() => {
            playlistVisualHydrationActiveRef.current -= 1
            if (playlistVisualHydrationActiveJobsRef.current.get(job.trackId) === job) {
              playlistVisualHydrationActiveJobsRef.current.delete(job.trackId)
            }
            // A viewport can request a larger edge while its background 128px
            // job is decoding. Publish that prepared bitmap as a visible
            // fallback, then schedule the upgrade through the same worker pool.
            const desiredEdge = playlistDesiredEdgeRef.current.get(job.trackId)
            if (published && playlistScopeEpochRef.current === job.playlistEpoch
              && playlistVisualSourceRef.current.get(job.trackId) === job.normalizedSourcePath
              && desiredEdge && (playlistVisualEdgeRef.current.get(job.trackId) ?? 0) < desiredEdge) {
              playlistVisualWindowKeyRef.current = null
              refreshPlaylistVisualDemandRef.current()
            }
            pump()
          })
      }
    }
    pump()
  }, [])

  const setVisiblePlaylistTrackIds = useCallback((
    trackIds: readonly string[],
    keepPersistentArtwork = true,
    showArtwork = true,
    demand?: PlaylistArtworkDemand,
  ) => {
    visiblePlaylistTrackIdsRef.current = trackIds
    if (demand) playlistArtworkDemandRef.current = demand
    keepPersistentPlaylistArtworkRef.current = keepPersistentArtwork
    showPlaylistArtworkRef.current = showArtwork
    const playlist = folderPlaylistRef.current
    const descriptorsById = new Map(playlist?.tracks.map((descriptor) => [descriptor.id, descriptor]))
    const orderedDesiredIds: string[] = []
    const seenIds = new Set<string>()
    const firstTrackId = keepPersistentArtwork ? playlist?.tracks[0]?.id : undefined
    const dockTrackId = keepPersistentArtwork ? presentationTrackRef.current?.id : undefined
    if (firstTrackId && descriptorsById.has(firstTrackId) && !seenIds.has(firstTrackId)) {
      seenIds.add(firstTrackId)
      orderedDesiredIds.push(firstTrackId)
    }
    if (dockTrackId && descriptorsById.has(dockTrackId) && !seenIds.has(dockTrackId)) {
      seenIds.add(dockTrackId)
      orderedDesiredIds.push(dockTrackId)
    }
    for (const trackId of visiblePlaylistTrackIdsRef.current) {
      if (seenIds.has(trackId) || !descriptorsById.has(trackId)) continue
      seenIds.add(trackId)
      orderedDesiredIds.push(trackId)
    }
    const scope = playlist ? playlistScope(playlist) : ''
    const metadataWindowKey = `${playlistScopeEpochRef.current}\u0000${scope}\u0000${orderedDesiredIds.join('\u0000')}`
    if (playlistMetadataWindowKeyRef.current !== metadataWindowKey) {
      playlistMetadataWindowKeyRef.current = metadataWindowKey
      playlistMetadataHydrationQueueRef.current = []
      if (playlist) {
        const playlistEpoch = playlistScopeEpochRef.current
        playlistMetadataHydrationQueueRef.current = orderedDesiredIds.flatMap((trackId) => {
          const descriptor = descriptorsById.get(trackId)
          if (!descriptor?.available || playlistTrackMetadataRef.current[trackId]) return []
          return [{
            generation: playlistMetadataGenerationRef.current,
            playlistEpoch,
            scope,
            trackId,
            sourcePath: descriptor.sourcePath,
            normalizedSourcePath: normalizeAudioSourcePath(descriptor.sourcePath),
          }]
        })
        pumpPlaylistMetadataHydration()
      }
    }
    // Text rows hydrate metadata without requesting high-resolution artwork;
    // selected-list thumbnails continue as optional background work.
    const currentPlaybackTrackId = logicalCursorTrackIdRef.current
      ?? presentationTrackRef.current?.id
      ?? latestAudioStateRef.current?.currentTrackId
    const foregroundArtworkIds = !libraryVisibleRef.current
      ? currentPlaybackTrackId && playlist?.tracks.some((item) => item.id === currentPlaybackTrackId)
        ? [currentPlaybackTrackId] : []
      : showArtwork ? orderedDesiredIds
        : orderedDesiredIds.filter((id) => id === firstTrackId || id === dockTrackId)
    const foregroundIds = new Set(foregroundArtworkIds)
    // Selection, rather than mounting the playlist page, starts cover work.
    // Every available track is eligible at thumbnail quality; viewport work
    // stays first and the existing byte ledger bounds background admission.
    const artworkDesiredIds = [...foregroundArtworkIds, ...(libraryVisibleRef.current && backgroundArtworkAllowedRef.current ? playlist?.tracks ?? [] : [])
      .filter((descriptor) => descriptor.available && !foregroundIds.has(descriptor.id))
      .map((descriptor) => descriptor.id)]
    const currentDemand = showArtwork ? playlistArtworkDemandRef.current : undefined
    const visibleIds = new Set(showArtwork ? currentDemand?.visibleIds ?? trackIds : [])
    const heldIds = new Set(showArtwork ? currentDemand?.heldIds ?? [] : [])
    let cardEdge = playlistArtworkEdge(currentDemand?.coverCssPixels ?? 128, currentDemand?.dpr ?? 1)
    const firstEdge = 512
    const heldOnly = (id: string) => heldIds.has(id) && !visibleIds.has(id) && id !== firstTrackId && id !== dockTrackId
    const targetEdgeFor = (id: string, edge: 128 | 256 | 512): 128 | 256 | 512 => {
      if (id === firstTrackId) return firstEdge
      if (!foregroundIds.has(id)) return 128
      return heldOnly(id) ? playlistVisualEdgeRef.current.get(id) ?? edge : edge
    }
    // Reserve all screen items before offering spare bytes to prefetch. A dense
    // viewport can exceed the nominal cache target, but it never loses eligibility.
    const requiredBytesAt = (edge: 128 | 256 | 512) => artworkDesiredIds.reduce((total, id) => {
      if (!visibleIds.has(id) && !heldIds.has(id) && id !== firstTrackId && id !== dockTrackId) return total
      const targetEdge = targetEdgeFor(id, edge)
      const current = playlistTrackVisualsRef.current[id]?.coverThumbnail
      const currentEdge = playlistVisualEdgeRef.current.get(id) ?? 0
      const currentBytes = current ? playlistImageBytes(current) : 0
      // A replacement temporarily owns both images until every consumer has
      // loaded the new URL. Charge that overlap before optional prefetch.
      return total + Math.max(playlistArtworkBytes(targetEdge), currentBytes)
        + (currentEdge < targetEdge ? currentBytes : 0)
    }, 0)
    if (requiredBytesAt(cardEdge) + PLAYLIST_ARTWORK_INFLIGHT_BUDGET > PLAYLIST_ARTWORK_RESIDENT_BUDGET) cardEdge = 128
    const requiredBytes = requiredBytesAt(cardEdge)
    const oldReplacementBytes = [...playlistPendingReplacementRef.current.values()]
      .reduce((total, pending) => total
        + (pending.previous.coverThumbnail ? playlistImageBytes(pending.previous.coverThumbnail) : 0)
        + pending.olderVisuals.reduce((sum, older) => sum + (older.visual.coverThumbnail ? playlistImageBytes(older.visual.coverThumbnail) : 0), 0), 0)
    const activeBytes = [...playlistVisualHydrationActiveJobsRef.current.values()]
      .reduce((total, job) => total + job.maxEdge * job.maxEdge * 4, 0)
    if (requiredBytes + oldReplacementBytes + activeBytes > PLAYLIST_ARTWORK_RESIDENT_BUDGET) {
      console.warn('Playlist artwork viewport exceeds the 96 MiB managed-resource budget', {
        visibleCount: visibleIds.size,
        requiredBytes,
      })
    }
    let committedBytes = requiredBytes + oldReplacementBytes + activeBytes
    const currentVisuals = playlistTrackVisualsRef.current
    const residents = Object.entries(currentVisuals).flatMap(([id, visual]) => {
      const source = playlistVisualSourceRef.current.get(id)
      if (!visual.coverThumbnail || !source || source !== normalizeAudioSourcePath(descriptorsById.get(id)?.sourcePath ?? '')) return []
      return [{ id, source, bytes: playlistImageBytes(visual.coverThumbnail) }]
    })
    const requiredIds = new Set(artworkDesiredIds.filter((id) => visibleIds.has(id) || heldIds.has(id) || id === firstTrackId || id === dockTrackId))
    playlistVisualRequiredIdsRef.current = requiredIds
    // Reserve warm resources before optional cold prefetch. The final retain
    // below reconciles leases against the actual accepted worker demand.
    const reservedWarmIds = playlistArtworkGrace.retain(residents, requiredIds,
      PLAYLIST_ARTWORK_RESIDENT_BUDGET - committedBytes - PLAYLIST_ARTWORK_INFLIGHT_BUDGET)
    let reservedWarmBytes = residents.reduce((sum, resident) => sum + (reservedWarmIds.has(resident.id) ? resident.bytes : 0), 0)
    const budgetedIds = artworkDesiredIds.filter((id) => {
      if (requiredIds.has(id)) return true
      const current = playlistTrackVisualsRef.current[id]?.coverThumbnail
      const reservedBytes = reservedWarmIds.has(id) && current ? playlistImageBytes(current) : 0
      const bytes = Math.max(playlistArtworkBytes(targetEdgeFor(id, cardEdge)), current ? playlistImageBytes(current) : 0)
      if (committedBytes + reservedWarmBytes + bytes - reservedBytes + PLAYLIST_ARTWORK_INFLIGHT_BUDGET > PLAYLIST_ARTWORK_RESIDENT_BUDGET) return false
      reservedWarmBytes -= reservedBytes
      committedBytes += bytes
      return true
    })
    const desiredIds = new Set(budgetedIds)
    const warmIds = playlistArtworkGrace.retain(residents, desiredIds,
      PLAYLIST_ARTWORK_RESIDENT_BUDGET - committedBytes - PLAYLIST_ARTWORK_INFLIGHT_BUDGET)
    const residentIds = new Set([...desiredIds, ...warmIds])
    const windowKey = `${playlistScopeEpochRef.current}\u0000${scope}\u0000${keepPersistentArtwork}\u0000${cardEdge}\u0000${[...visibleIds].join('\u0000')}\u0001${[...heldIds].join('\u0000')}\u0002${budgetedIds.map((id) => `${id}:${normalizeAudioSourcePath(descriptorsById.get(id)?.sourcePath ?? '')}`).join('\u0000')}\u0003${[...warmIds].join('\u0000')}`
    if (playlistVisualWindowKeyRef.current === windowKey) return
    playlistVisualWindowKeyRef.current = windowKey
    const generation = playlistVisualGenerationRef.current
    playlistDesiredEdgeRef.current = new Map(budgetedIds.map((id) => [id, targetEdgeFor(id, cardEdge)]))
    playlistVisualDesiredIdsRef.current = desiredIds
    playlistVisualHydrationQueueRef.current = []
    const retained = Object.fromEntries(
      Object.entries(currentVisuals).filter(([trackId]) => residentIds.has(trackId)
        && playlistVisualSourceRef.current.get(trackId) === normalizeAudioSourcePath(descriptorsById.get(trackId)?.sourcePath ?? '')),
    )
    for (const [trackId, visual] of Object.entries(currentVisuals)) {
      const sourceChanged = playlistVisualSourceRef.current.get(trackId) !== normalizeAudioSourcePath(descriptorsById.get(trackId)?.sourcePath ?? '')
      if ((!residentIds.has(trackId) || sourceChanged) && visual.coverThumbnail) {
        URL.revokeObjectURL(visual.coverThumbnail.src)
      }
      if (!residentIds.has(trackId) || sourceChanged) {
        for (const [src, pending] of playlistPendingReplacementRef.current) {
          if (pending.trackId !== trackId) continue
          if (pending.previous.coverThumbnail) URL.revokeObjectURL(pending.previous.coverThumbnail.src)
          for (const older of pending.olderVisuals) {
            if (older.visual.coverThumbnail) URL.revokeObjectURL(older.visual.coverThumbnail.src)
          }
          playlistPendingReplacementRef.current.delete(src)
        }
      }
      if (!residentIds.has(trackId) || sourceChanged) {
        playlistVisualEdgeRef.current.delete(trackId)
        playlistVisualSourceRef.current.delete(trackId)
      }
    }
    const nextVisuals = Object.keys(retained).length === Object.keys(currentVisuals).length
      ? currentVisuals
      : retained
    playlistTrackVisualsRef.current = nextVisuals
    if (nextVisuals !== currentVisuals) setPlaylistTrackVisuals(nextVisuals)

    const backendWindowGeneration = ensurePlaylistCoverSession()
    if (!playlist || desiredIds.size === 0) {
      void backendWindowGeneration.catch(() => undefined)
      return
    }
    const playlistEpoch = playlistScopeEpochRef.current
    void backendWindowGeneration.then((backendGeneration) => {
      if (
        playlistVisualGenerationRef.current !== generation
        || playlistScopeEpochRef.current !== playlistEpoch
        || playlistScopeRef.current !== scope
      ) return
      const jobs: PlaylistVisualHydrationJob[] = []
      for (const trackId of budgetedIds) {
        const descriptor = descriptorsById.get(trackId)
        if (!descriptor) continue
        if (heldOnly(trackId) && !playlistTrackVisualsRef.current[trackId]) continue
        const activeJob = playlistVisualHydrationActiveJobsRef.current.get(descriptor.id)
        if (
          !descriptor.available
          || !desiredIds.has(descriptor.id)
          || playlistVisualFailedRef.current.get(descriptor.id) === normalizeAudioSourcePath(descriptor.sourcePath)
          || playlistVisualRetryTimersRef.current.has(descriptor.id)
          || (playlistTrackVisualsRef.current[descriptor.id]
            && (playlistVisualEdgeRef.current.get(descriptor.id) ?? 0) >= targetEdgeFor(descriptor.id, cardEdge))
          || (activeJob?.generation === generation
            && activeJob.normalizedSourcePath === normalizeAudioSourcePath(descriptor.sourcePath))
        ) continue
        jobs.push({
          clientId: playlistCoverClientIdRef.current!,
          generation,
          backendGeneration,
          playlistEpoch,
          scope,
          trackId: descriptor.id,
          sourcePath: descriptor.sourcePath,
          normalizedSourcePath: normalizeAudioSourcePath(descriptor.sourcePath),
          maxEdge: targetEdgeFor(descriptor.id, cardEdge),
          attempt: 0,
          optional: !requiredIds.has(descriptor.id),
        })
      }
      playlistVisualHydrationQueueRef.current = jobs
      pumpPlaylistVisualHydration()
    }).catch(() => {
      if (playlistScopeEpochRef.current !== playlistEpoch || playlistCoverSessionFailuresRef.current >= 2) return
      playlistCoverSessionFailuresRef.current += 1
      playlistCoverSessionRetryTimerRef.current = setTimeout(() => {
        playlistCoverSessionRetryTimerRef.current = null
        if (playlistScopeEpochRef.current !== playlistEpoch) return
        playlistVisualWindowKeyRef.current = null
        refreshPlaylistVisualDemandRef.current()
      }, 500 * playlistCoverSessionFailuresRef.current)
    })
  }, [pumpPlaylistMetadataHydration, pumpPlaylistVisualHydration, ensurePlaylistCoverSession, playlistArtworkGrace])

  useEffect(() => {
    refreshPlaylistVisualDemandRef.current = () => setVisiblePlaylistTrackIds(
      visiblePlaylistTrackIdsRef.current,
      keepPersistentPlaylistArtworkRef.current,
      showPlaylistArtworkRef.current,
      playlistArtworkDemandRef.current,
    )
  }, [setVisiblePlaylistTrackIds])

  useEffect(() => {
    if (libraryVisibleRef.current === libraryVisible) return
    libraryVisibleRef.current = libraryVisible
    playlistVisualWindowKeyRef.current = null
    refreshPlaylistVisualDemandRef.current()
  }, [libraryVisible])

  useEffect(() => {
    if (!backgroundArtworkAllowed) {
      if (playlistOptionalIdleRef.current !== null) cancelOptionalArtworkIdle(playlistOptionalIdleRef.current)
      playlistOptionalIdleRef.current = null
      playlistOptionalIdleReadyRef.current = false
    }
    playlistVisualWindowKeyRef.current = null
    refreshPlaylistVisualDemandRef.current()
    if (backgroundArtworkAllowed) pumpPlaylistMetadataHydration()
  }, [backgroundArtworkAllowed, pumpPlaylistMetadataHydration])

  useEffect(() => {
    const retireLoadedReplacement = (src: string) => {
      const pending = playlistPendingReplacementRef.current.get(src)
      if (!pending) return
      const consumers = [...document.querySelectorAll<HTMLImageElement>('img')]
        .filter((image) => image.src === src)
      if (consumers.length === 0 || consumers.some((image) => !image.complete || image.naturalWidth === 0)) return
      const oldUrls = [pending.previous.coverThumbnail?.src, ...pending.olderVisuals.map((older) => older.visual.coverThumbnail?.src)]
        .filter((url): url is string => Boolean(url) && url !== src)
      if ([...document.querySelectorAll<HTMLImageElement>('img')].some((image) => oldUrls.includes(image.src))) return
      playlistPendingReplacementRef.current.delete(src)
      if (pending.previous.coverThumbnail?.src !== src && pending.previous.coverThumbnail) URL.revokeObjectURL(pending.previous.coverThumbnail.src)
      for (const older of pending.olderVisuals) {
        if (older.visual.coverThumbnail) URL.revokeObjectURL(older.visual.coverThumbnail.src)
      }
    }
    const onImageLoad = (event: Event) => {
      const src = (event as CustomEvent<unknown>).detail
      if (typeof src === 'string') retireLoadedReplacement(src)
    }
    const observer = new MutationObserver(() => {
      for (const src of playlistPendingReplacementRef.current.keys()) retireLoadedReplacement(src)
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    const onImageError = (event: Event) => {
      const src = (event as CustomEvent<unknown>).detail
      if (typeof src !== 'string') return
      const match = Object.entries(playlistTrackVisualsRef.current).find(([, visual]) => visual.coverThumbnail?.src === src)
      if (!match) return
      const [trackId] = match
      const pending = playlistPendingReplacementRef.current.get(src)
      if (pending) {
        playlistPendingReplacementRef.current.delete(src)
        const restored = { ...playlistTrackVisualsRef.current, [trackId]: pending.previous }
        playlistTrackVisualsRef.current = restored
        playlistVisualEdgeRef.current.set(trackId, pending.edge)
        setPlaylistTrackVisuals(restored)
        const [nextFallback, ...remainingFallbacks] = pending.olderVisuals
        if (pending.previous.coverThumbnail && nextFallback?.visual.coverThumbnail) {
          playlistPendingReplacementRef.current.set(pending.previous.coverThumbnail.src, {
            trackId,
            previous: nextFallback.visual,
            edge: nextFallback.edge,
            olderVisuals: remainingFallbacks,
          })
        }
        URL.revokeObjectURL(src)
        return
      }
      const failures = (playlistImageErrorCountsRef.current.get(trackId) ?? 0) + 1
      playlistImageErrorCountsRef.current.set(trackId, failures)
      const next = { ...playlistTrackVisualsRef.current }
      delete next[trackId]
      playlistTrackVisualsRef.current = next
      playlistVisualEdgeRef.current.delete(trackId)
      playlistVisualSourceRef.current.delete(trackId)
      setPlaylistTrackVisuals(next)
      URL.revokeObjectURL(src)
      if (failures > 2) {
        const sourcePath = folderPlaylistRef.current?.tracks.find((track) => track.id === trackId)?.sourcePath
        if (sourcePath) playlistVisualFailedRef.current.set(trackId, normalizeAudioSourcePath(sourcePath))
        return
      }
      if (!playlistVisualDesiredIdsRef.current.has(trackId)) return
      playlistVisualWindowKeyRef.current = null
      setVisiblePlaylistTrackIds(
        visiblePlaylistTrackIdsRef.current,
        keepPersistentPlaylistArtworkRef.current,
        showPlaylistArtworkRef.current,
        playlistArtworkDemandRef.current,
      )
    }
    window.addEventListener('spmusic:playlist-cover-image-load', onImageLoad)
    window.addEventListener('spmusic:playlist-cover-image-error', onImageError)
    return () => {
      observer.disconnect()
      window.removeEventListener('spmusic:playlist-cover-image-load', onImageLoad)
      window.removeEventListener('spmusic:playlist-cover-image-error', onImageError)
    }
  }, [setVisiblePlaylistTrackIds])

  useEffect(() => {
    if (
      visiblePlaylistTrackIdsRef.current.length === 0
      && !keepPersistentPlaylistArtworkRef.current
    ) return
    setVisiblePlaylistTrackIds(
      visiblePlaylistTrackIdsRef.current,
      keepPersistentPlaylistArtworkRef.current,
      showPlaylistArtworkRef.current,
      playlistArtworkDemandRef.current,
    )
  }, [setVisiblePlaylistTrackIds, track?.id])

  useEffect(() => {
    if (!folderPlaylist) return
    setVisiblePlaylistTrackIds(
      visiblePlaylistTrackIdsRef.current,
      true,
      showPlaylistArtworkRef.current,
      playlistArtworkDemandRef.current,
    )
  }, [folderPlaylist, setVisiblePlaylistTrackIds])

  const settleSelectionFailure = useCallback((requestId: number, error: AudioCommandError) => {
    if (!selectionIsCurrent(requestId)) return
    const pending = pendingSelectionRef.current
    if (stagedTrackDetailsRef.current?.requestId === requestId) {
      stagedTrackDetailsRef.current = null
    }
    pendingSelectionRef.current = null
    setAutomaticContinuationVisual(false)
    setSelectionVisualIntent((current) => current?.requestId === requestId ? null : current)
    audioSelectionInProgressRef.current = false
    setSelectionPending(false)
    commitDetailsPending(false)
    if (
      !pending?.replacementStarted
      && pending?.previousPresentationTrack
      && latestAudioStateRef.current?.currentTrackId === pending.previousPresentationTrack.id
    ) {
      logicalCursorTrackIdRef.current = pending.previousPresentationTrack.id
      desiredAudioTrackIdRef.current = pending.previousPresentationTrack.id
      presentationTrackRef.current = pending.previousPresentationTrack
      presentationArtworkRef.current = pending.previousArtwork
      if (pending.previousAudioTrack?.id === pending.previousPresentationTrack.id) {
        audioTrackRef.current = pending.previousAudioTrack
        setAudioTrack(pending.previousAudioTrack)
      }
      setPresentationTrack(pending.previousPresentationTrack)
      setPresentationArtwork(pending.previousArtwork)
      setContentState('track')
      if (pending.previousDetailsPending && pending.previousSourcePath) {
        const restoredTrackId = pending.previousPresentationTrack.id
        const restoredSourcePath = pending.previousSourcePath
        const restoreEpoch = playlistScopeEpochRef.current
        const restoreIsCurrent = () => (
          selectionRequestIdRef.current === requestId
          && pendingSelectionRef.current === null
          && playlistScopeEpochRef.current === restoreEpoch
          && latestAudioStateRef.current?.currentTrackId === restoredTrackId
        )
        const settleRestoredTrackFallback = () => {
          if (!restoreIsCurrent()) return
          const fallbackTrack: Track = {
            ...pending.previousPresentationTrack!,
            coverImage: undefined,
            coverImageFallback: undefined,
          }
          commitPresentationArtwork(fallbackTrack)
          commitDetailsPending(false)
        }
        const commitRestoredTrack = (restoredAudioTrack: AudioTrackRef) => {
          if (!restoreIsCurrent()) return
          if (restoredAudioTrack.id !== restoredTrackId || restoredAudioTrack.sourcePath !== restoredSourcePath) {
            settleRestoredTrackFallback()
            return
          }
          const restoredDuration = latestAudioStateRef.current?.durationMs ?? restoredAudioTrack.durationMs
          audioTrackRef.current = restoredAudioTrack
          setAudioTrack(restoredAudioTrack)
          hydratedCacheSet(hydratedAudioTrackCacheRef.current, restoredSourcePath, restoredAudioTrack)
          commitPresentationTrack(restoredAudioTrack, restoredDuration)
          commitDetailsPending(false)
        }

        commitDetailsPending(true)
        const cachedTrack = hydratedCacheGet(hydratedAudioTrackCacheRef.current, restoredSourcePath)
        if (cachedTrack) commitRestoredTrack(cachedTrack)
        else {
          void requestHydratedAudioTrack(restoredSourcePath, restoreEpoch)
            .then(commitRestoredTrack)
            .catch(settleRestoredTrackFallback)
        }
      } else {
        commitDetailsPending(false)
      }
    } else {
      logicalCursorTrackIdRef.current = latestAudioStateRef.current?.currentTrackId ?? null
      desiredAudioTrackIdRef.current = latestAudioStateRef.current?.currentTrackId ?? null
      clearPresentationTrack(error.code === 'USER_CANCELLED' ? 'empty' : 'error')
    }
    if (error.code !== 'SUPERSEDED') commitAudioError(error)
  }, [
    clearPresentationTrack,
    commitAudioError,
    commitDetailsPending,
    commitPresentationArtwork,
    commitPresentationTrack,
    requestHydratedAudioTrack,
    selectionIsCurrent,
  ])

  const applyTrackDetails = useCallback((details: AudioTrackDetailsChanged) => {
    const trackId = details.kind === 'ready' ? details.track.id : details.trackId
    if (!selectionTransactionIsCurrent(details.requestId, details.generation, trackId)) return

    const pendingSelection = pendingSelectionRef.current
    if (!pendingSelection) return
    pendingSelection.detailsSettled = true
    commitDetailsPending(false)
    if (details.kind === 'ready') {
      const currentDuration = latestAudioStateRef.current?.currentTrackId === details.track.id
        ? latestAudioStateRef.current.durationMs
        : details.track.durationMs
      audioTrackRef.current = details.track
      setAudioTrack(details.track)
      if (
        pendingSelection.targetScope !== null
        && pendingSelection.targetScope === playlistScopeRef.current
      ) {
        hydratedCacheSet(hydratedAudioTrackCacheRef.current, details.track.sourcePath, details.track)
      } else {
        stagedTrackDetailsRef.current = {
          requestId: details.requestId,
          track: details.track,
        }
      }
      commitPresentationTrack(details.track, currentDuration)
    } else {
      const currentTrack = presentationTrackRef.current
      if (currentTrack) {
        commitPresentationArtwork(currentTrack)
      }
      setContentState('track')
      toast.error(`歌曲详情加载失败：${details.error.message}`)
    }
    if (pendingSelection.commandConfirmed) pendingSelectionRef.current = null
  }, [
    commitDetailsPending,
    commitPresentationArtwork,
    commitPresentationTrack,
    selectionTransactionIsCurrent,
  ])

  const ensureTrackDetailsListener = useCallback(() => {
    if (trackDetailsUnlistenRef.current) return Promise.resolve()
    const existingPromise = trackDetailsListenerPromiseRef.current
    if (existingPromise) return existingPromise

    const listenerEpoch = trackDetailsListenerEpochRef.current
    const listenerPromise = listenAudioTrackDetailsChanged((details) => {
      trackDetailsHandlerRef.current(details)
    }).then((unlisten) => {
      if (
        !trackDetailsListenerActiveRef.current
        || trackDetailsListenerEpochRef.current !== listenerEpoch
      ) {
        unlisten()
        throw new Error('Audio track details listener was disposed during registration')
      }
      trackDetailsUnlistenRef.current = unlisten
    }).catch((error: unknown) => {
      if (trackDetailsListenerPromiseRef.current === listenerPromise) {
        trackDetailsListenerPromiseRef.current = null
      }
      throw error
    })
    trackDetailsListenerPromiseRef.current = listenerPromise
    return listenerPromise
  }, [])

  const prefetchAdjacentPlaylistTracks = useCallback((trackId: string) => {
    if (shuffleMode !== 'none') {
      setArtworkPrefetchCandidates([])
      return
    }
    const generation = artworkPrefetchGenerationRef.current + 1
    artworkPrefetchGenerationRef.current = generation
    const playlist = folderPlaylistRef.current
    const originIndex = queueTrackIndexRef.current.get(trackId)
    if (!playlist?.tracks.length || originIndex === undefined) {
      setArtworkPrefetchCandidates([])
      return
    }
    const playlistEpoch = playlistScopeEpochRef.current
    const scope = playlistScope(playlist)
    const descriptors: Array<{
      direction: Direction
      distance: 1 | 2 | 3
      resolved: { index: number; track: AudioFolderTrackRef }
    }> = []
    const seenTrackIds = new Set([trackId])
    for (const direction of [-1, 1] as const) {
      let cursorIndex = originIndex
      let cursorTrackId = trackId
      for (const distance of [1, 2, 3] as const) {
        const resolved = resolveAvailablePlaylistTarget(
          playlist,
          queueTracks,
          cursorIndex,
          cursorTrackId,
          direction,
          shuffleMode,
        )
        if (!resolved || seenTrackIds.has(resolved.track.id)) break
        seenTrackIds.add(resolved.track.id)
        descriptors.push({ direction, distance, resolved })
        cursorIndex = resolved.index
        cursorTrackId = resolved.track.id
      }
    }

    void (async () => {
      const hydrated = await Promise.all(descriptors.map(async (descriptor) => {
          try {
            const hydratedTrack = await requestHydratedAudioTrack(descriptor.resolved.track.sourcePath, playlistEpoch)
            if (hydratedTrack.id !== descriptor.resolved.track.id) return null
            const presentationTrack = audioTrackToTrack(hydratedTrack)
            return {
              afterTrackId: trackId,
              direction: descriptor.direction,
              distance: descriptor.distance,
              track: presentationTrack,
              artwork: prefetchArtworkFromTrack(presentationTrack),
            } satisfies WindowedArtworkPrefetchCandidate
          } catch (error: unknown) {
            if (generation === artworkPrefetchGenerationRef.current) {
              console.debug(`${descriptor.direction < 0 ? 'Previous' : 'Next'}-track metadata prefetch failed`, error)
            }
            return null
          }
        }))
      if (
        generation !== artworkPrefetchGenerationRef.current
        || playlistScopeEpochRef.current !== playlistEpoch
        || playlistScopeRef.current !== scope
        || (logicalCursorTrackIdRef.current
          ?? presentationTrackRef.current?.id
          ?? latestAudioStateRef.current?.currentTrackId
          ?? audioTrackRef.current?.id) !== trackId
      ) return
      const ready = hydrated.filter((candidate): candidate is WindowedArtworkPrefetchCandidate => candidate !== null)
      const prime = artworkPrimeDirectionRef.current
      ready.sort((left, right) => left.distance - right.distance
        || Number(right.direction === prime) - Number(left.direction === prime))
      // Keep the previous window pinned until all six new descriptors settle,
      // then swap the complete window in one state publication.
      setArtworkPrefetchCandidates(ready.slice(0, 6))
    })()
  }, [queueTracks, requestHydratedAudioTrack, shuffleMode])

  const primeTrackArtwork = useCallback((direction: Direction) => {
    artworkPrimeDirectionRef.current = direction
    setArtworkPrefetchCandidates((current) => {
      if (current[0]?.direction === direction) return current
      const preferred = current.filter((candidate) => candidate.direction === direction)
      return preferred.length
        ? [...preferred, ...current.filter((candidate) => candidate.direction !== direction)].slice(0, 6)
        : current
    })
  }, [])

  const hydrateCurrentAudioTrack = useCallback((trackId: string) => {
    if (audioTrackRef.current?.id === trackId || audioTrackRequestTrackIdRef.current === trackId) return

    const requestId = audioTrackRequestIdRef.current + 1
    const requestEpoch = playlistScopeEpochRef.current
    audioTrackRequestIdRef.current = requestId
    audioTrackRequestTrackIdRef.current = trackId

    void getCurrentAudioTrack()
      .then((nextAudioTrack) => {
        const latestAudioState = latestAudioStateRef.current
        if (
          audioTrackRequestIdRef.current !== requestId
          || playlistScopeEpochRef.current !== requestEpoch
          || nextAudioTrack?.id !== trackId
          || latestAudioState?.currentTrackId !== trackId
        ) return

        audioTrackRef.current = nextAudioTrack
        setAudioTrack(nextAudioTrack)
        if (!pendingSelectionRef.current) {
          commitPresentationTrack(nextAudioTrack, latestAudioState.durationMs)
        }
      })
      .catch((error: unknown) => {
        if (audioTrackRequestIdRef.current === requestId) {
          commitAudioError(commandError(error))
          if (!pendingSelectionRef.current && latestAudioStateRef.current?.currentTrackId === trackId) {
            clearPresentationTrack('error')
          }
        }
      })
      .finally(() => {
        if (audioTrackRequestIdRef.current === requestId) audioTrackRequestTrackIdRef.current = null
      })
  }, [clearPresentationTrack, commitAudioError, commitPresentationTrack])

  const applyAudioState = useCallback((
    nextAudioState: AudioPlaybackState,
    settleTransportIntent = false,
    acceptSeekPosition = false,
    fromEvent = false,
  ) => {
    if (startupRestoreTimedOutRef.current) return
    const pendingSelection = pendingSelectionRef.current
    const activePlaybackTransition = activePlaybackTransitionRef.current
    const nextTransportTransition = nextAudioState.transportTransition ?? null
    if (fromEvent) {
      if (
        nextTransportTransition
        && activePlaybackTransition
        && nextTransportTransition.requestId !== activePlaybackTransition.requestId
      ) return
      if (
        !nextTransportTransition
        && activePlaybackTransition
        && nextAudioState.transportSettledRequestId !== activePlaybackTransition.requestId
      ) return
      if (pendingSelection?.usesLoadAndPlay) {
        const targetsPendingTrack = nextAudioState.currentTrackId === pendingSelection.targetTrackId
        const isNewerThanPrevious = pendingSelection.previousGeneration === null
          || (nextAudioState.generation !== null
            && nextAudioState.generation > pendingSelection.previousGeneration)
        if (pendingSelection.generation === null && !targetsPendingTrack) return
        if (
          nextAudioState.generation !== null
          && targetsPendingTrack
          && isNewerThanPrevious
          && pendingSelection.generation === null
        ) pendingSelection.generation = nextAudioState.generation
        if (nextAudioState.generation === null) return
        if (
          !isNewerThanPrevious
          || (pendingSelection.generation !== null
            && nextAudioState.generation !== pendingSelection.generation)
        ) return
      } else if (!pendingSelection) {
        const currentGeneration = latestAudioStateRef.current?.generation ?? null
        if (
          currentGeneration !== null
          && (nextAudioState.generation === null || nextAudioState.generation !== currentGeneration)
        ) return
      }
    }
    const pendingTargetTrackId = pendingSelection?.targetTrackId
    const isSelectionLoadingState = nextAudioState.phase === 'loading' && nextAudioState.currentTrackId === null
    const isSelectionTerminalState = nextAudioState.phase === 'error' && nextAudioState.currentTrackId === null
    const isPendingTargetState = pendingTargetTrackId !== null
      && nextAudioState.currentTrackId === pendingTargetTrackId
    const isConfirmedPresentationState = pendingTargetTrackId === null
      && nextAudioState.currentTrackId !== null
      && nextAudioState.currentTrackId === presentationTrackRef.current?.id
    if (
      pendingSelection
      && !isPendingTargetState
      && !isConfirmedPresentationState
      && !isSelectionLoadingState
      && !isSelectionTerminalState
    ) return
    if (
      pendingSelection
      && (isSelectionLoadingState || isSelectionTerminalState || isPendingTargetState)
    ) pendingSelection.replacementStarted = true

    const transportIntent = transportIntentRef.current
    const matchingPlaybackTransition = Boolean(
      activePlaybackTransition
      && nextTransportTransition?.requestId === activePlaybackTransition.requestId
      && nextTransportTransition.target === activePlaybackTransition.target,
    )
    const isConflictingTransportState = transportIntent !== null
      && (nextAudioState.phase === 'playing' || nextAudioState.phase === 'paused')
      && nextAudioState.phase !== transportIntent
    if (!settleTransportIntent && isConflictingTransportState && !matchingPlaybackTransition) return

    const previousAudioState = latestAudioStateRef.current
    const previousTrackId = previousAudioState?.currentTrackId ?? null
    const previousPhase = previousAudioState?.phase
    const previousDurationMs = previousAudioState?.durationMs ?? null
    const nextTrackId = nextAudioState.currentTrackId
    const isSamePlaybackGeneration = previousAudioState?.generation === nextAudioState.generation
    if (previousTrackId !== nextTrackId) {
      seekRequestIdRef.current += 1
      audioStateRequestGenerationRef.current += 1
      timelineInteractionRef.current = 'following'
      setTimelineInteraction('following')
      seekTargetGuardRef.current = null
      activePlaybackTransitionRef.current = null
      playbackTransitionCommandRequestIdRef.current = null
      transportIntentRef.current = null
    }

    latestAudioStateRef.current = nextAudioState
    const playlist = folderPlaylistRef.current
    const currentIndex = nextTrackId ? queueTrackIndexRef.current.get(nextTrackId) ?? 0 : 0
    const stopsAtPlaylistEnd = (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
      && currentIndex >= (playlist?.tracks.length ?? 0) - 1
    // Claim the icon in the same commit as the first ended state. Once the
    // selection starts, its visual intent carries this through native loading;
    // repeated ended events must not revoke the claim before that handoff.
    if (nextAudioState.phase !== 'ended') setAutomaticContinuationVisual(false)
    else if (previousPhase !== 'ended' || previousTrackId !== nextTrackId || !isSamePlaybackGeneration) {
      setAutomaticContinuationVisual(Boolean(nextTrackId && playlist?.tracks.length && !stopsAtPlaylistEnd
        && endingTrackRef.current !== nextTrackId))
    }
    if (!audioPlaybackUiStateEqual(previousAudioState, nextAudioState)) {
      setAudioState(nextAudioState)
    }
    const currentPlaybackTransition = activePlaybackTransitionRef.current
    if (
      currentPlaybackTransition
      && nextAudioState.currentTrackId === currentPlaybackTransition.expectedTrackId
      && nextTransportTransition === null
      && nextAudioState.transportSettledRequestId === currentPlaybackTransition.requestId
      && nextAudioState.phase === currentPlaybackTransition.target
    ) {
      activePlaybackTransitionRef.current = null
      transportIntentRef.current = null
    }
    setTransportBusy(
      transportOperationInProgress()
      || activePlaybackTransitionRef.current !== null
      || nextTransportTransition !== null,
    )
    if (nextAudioState.error?.code !== 'SUPERSEDED') commitAudioError(nextAudioState.error)

    const guard = seekTargetGuardRef.current
    const now = window.performance.now()
    const guardedOldPosition = !acceptSeekPosition
      && guard?.trackId === nextTrackId
      && now < guard.expiresAt
      && Math.abs(nextAudioState.positionMs - guard.positionMs) > 120
    if (acceptSeekPosition || (timelineInteractionRef.current === 'following' && !guardedOldPosition)) {
      const backendPositionSeconds = Math.max(0, nextAudioState.positionMs / 1000)
      const acceptedPausedSeekPosition = acceptSeekPosition
        && nextAudioState.phase !== 'playing'
        && guard?.trackId === nextTrackId
        ? guard.positionMs / 1000
        : null
      const isNormalPlayingCalibration = !settleTransportIntent
        && !acceptSeekPosition
        && transportIntentRef.current === null
        && previousTrackId === nextTrackId
        && isSamePlaybackGeneration
        && previousPhase === 'playing'
        && nextAudioState.phase === 'playing'
      const preservesActiveTransportPosition = !acceptSeekPosition
        && previousTrackId === nextTrackId
        && isSamePlaybackGeneration
        && (activePlaybackTransition !== null || nextTransportTransition !== null)
      const positionSeconds = acceptedPausedSeekPosition ?? (
        isNormalPlayingCalibration || preservesActiveTransportPosition
          ? Math.max(
              backendPositionSeconds,
              timelinePositionRef.current,
              visualTimelineClock.getPositionSeconds(),
            )
          : backendPositionSeconds
      )
      timelineAnchorRef.current = { positionSeconds, at: now, trackId: nextTrackId }
      timelinePositionRef.current = positionSeconds
      visualTimelineClock.setPositionSeconds(positionSeconds)
      if (!isNormalPlayingCalibration) setTimelinePosition(positionSeconds)
    }

    const pendingOwnsLoadedTrack = pendingSelection?.loadedTrackId !== null
      && pendingSelection?.loadedTrackId === audioTrackRef.current?.id
    if (!nextAudioState.currentTrackId && !pendingOwnsLoadedTrack) {
      audioTrackRef.current = null
      setAudioTrack(null)
    }

    if (nextTrackId) {
      const mayCommitTrack = !pendingSelection || pendingSelection.targetTrackId === nextTrackId
      const hasCurrentPresentation = presentationTrackRef.current?.id === nextTrackId
      if (
        previousTrackId !== nextTrackId
        && mayCommitTrack
        && audioTrackRef.current?.id === nextTrackId
        && !hasCurrentPresentation
      ) {
        const preserveArtwork = pendingSelection?.usesLoadAndPlay
          && !pendingSelection.detailsSettled
          && pendingSelection.targetTrackId === nextTrackId
        commitPresentationTrack(audioTrackRef.current, nextAudioState.durationMs, !preserveArtwork)
      } else if (hasCurrentPresentation && previousDurationMs !== nextAudioState.durationMs) {
        patchPresentationDuration(nextTrackId, nextAudioState.durationMs)
      } else if (!presentationTrackRef.current) {
        setContentState('loading')
      }
    } else if (nextAudioState.phase === 'loading') {
      setContentState('loading')
    } else {
      clearPresentationTrack(nextAudioState.phase === 'error' || nextAudioState.error ? 'error' : 'empty')
    }

    if (
      !volumeCommandRunningRef.current
      && desiredVolumeRef.current === null
      && nextTransportTransition === null
    ) {
      const confirmedVolume = volumeScalarToPercent(nextAudioState.volume)
      if (confirmedVolumeRef.current !== confirmedVolume) setVolume(confirmedVolume)
      confirmedVolumeRef.current = confirmedVolume
    }

    if (
      nextAudioState.currentTrackId
      && audioTrackRef.current?.id !== nextAudioState.currentTrackId
      && !audioSelectionInProgressRef.current
    ) hydrateCurrentAudioTrack(nextAudioState.currentTrackId)
  }, [
    clearPresentationTrack,
    commitAudioError,
    commitPresentationTrack,
    hydrateCurrentAudioTrack,
    patchPresentationDuration,
    repeatMode,
    visualTimelineClock,
  ])

  const loadFolderAudioTrack = useCallback(async (
    folderTrack: AudioFolderTrackRef,
    autoplay: boolean,
    legacyInitialSelection = false,
    targetScope: string | null = playlistScopeRef.current,
    visualNavigation?: { direction: Direction; source: TrackSelectionVisualSource; previewTokenId?: number },
    preparedPreview?: PreparedTrackCardPreview,
  ) => {
    if (
      transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return false

    if (!folderTrack.available) {
      const missingError = missingPlaylistTrackError(folderTrack.fileName)
      commitAudioError(missingError)
      toast.error(missingError.message)
      return false
    }

    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    const usesLoadAndPlay = autoplay && !legacyInitialSelection
    const selectionRequestId = beginTrackSelection(
      folderTrack.id,
      folderTrack.sourcePath,
      usesLoadAndPlay,
      targetScope,
      visualNavigation,
    )
    // A prepared preview owns its complete metadata independently of the small
    // hydration LRU. Visible-card hydration may evict it while the pointer is
    // held, but committing that preview must not downgrade it to a filename.
    const preparedAudioTrack = preparedPreview
      && preparedPreview.id === visualNavigation?.previewTokenId
      && preparedPreview.playlistEpoch === playlistScopeEpochRef.current
      && preparedPreview.playlistScope === targetScope
      && targetScope === playlistScopeRef.current
      && audioTrackMatchesDescriptor(preparedPreview.hydratedTrack, folderTrack)
      ? preparedPreview.hydratedTrack : undefined
    const cachedAudioTrack = preparedAudioTrack ? undefined : hydratedCacheGet(
      hydratedAudioTrackCacheRef.current,
      folderTrack.sourcePath,
    )
    const placeholderAudioTrack = preparedAudioTrack
      ?? (audioTrackMatchesDescriptor(cachedAudioTrack, folderTrack) ? cachedAudioTrack : undefined)
      ?? audioFolderTrackPlaceholder(folderTrack)
    audioTrackRequestIdRef.current += 1
    audioTrackRequestTrackIdRef.current = null
    audioTrackRef.current = placeholderAudioTrack
    setAudioTrack(placeholderAudioTrack)
    const placeholderTrack = audioTrackToTrack(placeholderAudioTrack)
    presentationTrackRef.current = placeholderTrack
    setPresentationTrack(placeholderTrack)
    setContentState('loading')

    try {
      if (!usesLoadAndPlay) {
        const nextAudioTrack = await loadAudioFile(folderTrack.sourcePath)
        if (!selectionIsCurrent(selectionRequestId, folderTrack.id)) return false
        if (nextAudioTrack.id !== folderTrack.id || nextAudioTrack.sourcePath !== folderTrack.sourcePath) {
          settleSelectionFailure(selectionRequestId, commandError(new Error('Audio selection target mismatch')))
          return false
        }
        const pendingSelection = pendingSelectionRef.current
        if (!pendingSelection || pendingSelection.requestId !== selectionRequestId) return false
        pendingSelection.loadedTrackId = nextAudioTrack.id
        audioTrackRef.current = nextAudioTrack
        setAudioTrack(nextAudioTrack)
        const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
        if (!selectionIsCurrent(selectionRequestId, folderTrack.id)) return false
        if (confirmedAudioState.currentTrackId !== folderTrack.id) {
          settleSelectionFailure(selectionRequestId, commandError(new Error('Audio selection target mismatch')))
          return false
        }
        applyAudioState(confirmedAudioState)
        commitPresentationTrack(nextAudioTrack, confirmedAudioState.durationMs)
        commitDetailsPending(false)
        pendingSelectionRef.current = null
        prefetchAdjacentPlaylistTracks(nextAudioTrack.id)
        endingTrackRef.current = null
        return true
      }

      await ensureTrackDetailsListener()
      if (!selectionIsCurrent(selectionRequestId, folderTrack.id)) return false
      const result = await loadAndPlayAudio({
        path: folderTrack.sourcePath,
        requestId: selectionRequestId,
      })
      if (!selectionIsCurrent(selectionRequestId, folderTrack.id)) return false
      if (result.requestId !== selectionRequestId || result.trackId !== folderTrack.id) {
        settleSelectionFailure(selectionRequestId, commandError(new Error('Audio selection target mismatch')))
        return false
      }
      if (!selectionTransactionIsCurrent(result.requestId, result.generation, result.trackId)) {
        settleSelectionFailure(selectionRequestId, commandError(new Error('Audio selection generation mismatch')))
        return false
      }
      if (result.state.currentTrackId !== result.trackId || result.state.generation !== result.generation) {
        const mismatchError = commandError(new Error('Audio selection target mismatch'))
        settleSelectionFailure(selectionRequestId, mismatchError)
        return false
      }
      const pendingSelection = pendingSelectionRef.current
      if (!pendingSelection || pendingSelection.requestId !== selectionRequestId) return false
      pendingSelection.commandConfirmed = true
      pendingSelection.loadedTrackId = result.trackId
      applyAudioState(result.state)
      setContentState('track')
      if (pendingSelection.detailsSettled) pendingSelectionRef.current = null
      audioSelectionInProgressRef.current = false
      setSelectionPending(false)
      setAudioBusy(false)
      prefetchAdjacentPlaylistTracks(result.trackId)
      endingTrackRef.current = null
      return true
    } catch (error) {
      const nextError = commandError(error)
      const isCurrentSelection = selectionIsCurrent(selectionRequestId, folderTrack.id)
      settleSelectionFailure(selectionRequestId, nextError)
      if (isCurrentSelection && nextError.code === 'FILE_NOT_FOUND') {
        toast.error(missingPlaylistTrackError(folderTrack.fileName).message)
      }
      return false
    } finally {
      if (selectionRequestIdRef.current === selectionRequestId) {
        audioSelectionInProgressRef.current = false
        setSelectionPending(false)
        setAudioBusy(false)
      }
    }
  }, [
    applyAudioState,
    beginTrackSelection,
    commitAudioError,
    commitPresentationTrack,
    commitDetailsPending,
    ensureTrackDetailsListener,
    prefetchAdjacentPlaylistTracks,
    selectionIsCurrent,
    selectionTransactionIsCurrent,
    settleSelectionFailure,
  ])

  const loadPlaylistTrackOrSkip = useCallback(async (
    playlist: AudioFolderPlaylist,
    startIndex: number,
    autoplay: boolean,
    direction: Direction = 1,
    allowWrap = false,
    skipMissing = true,
    legacyInitialSelection = false,
    visualSource?: TrackSelectionVisualSource,
  ) => {
    if (!playlist.tracks.length) return false

    const targetScope = playlistScope(playlist)
    const step = direction < 0 ? -1 : 1
    let index = Math.min(Math.max(startIndex, 0), playlist.tracks.length - 1)
    for (let attempts = 0; attempts < playlist.tracks.length; attempts += 1) {
      const target = playlist.tracks[index]
      if (!target) return false
      if (!target.available && playlist.sourceKind !== 'folder' && skipMissing) {
        const nextIndex = index + step
        if (nextIndex < 0 || nextIndex >= playlist.tracks.length) {
          if (!allowWrap) return false
          index = nextIndex < 0 ? playlist.tracks.length - 1 : 0
        } else {
          index = nextIndex
        }
        continue
      }
      const expectedSelectionRequestId = selectionRequestIdRef.current + 1
      if (await loadFolderAudioTrack(
        target,
        autoplay,
        legacyInitialSelection,
        targetScope,
        visualSource ? { direction, source: visualSource } : undefined,
      )) return true
      if (selectionRequestIdRef.current !== expectedSelectionRequestId) return false
      if (playlist.sourceKind === 'folder' || !skipMissing) return false

      const nextIndex = index + step
      if (nextIndex < 0 || nextIndex >= playlist.tracks.length) {
        if (!allowWrap) return false
        index = nextIndex < 0 ? playlist.tracks.length - 1 : 0
      } else {
        index = nextIndex
      }
    }
    return false
  }, [loadFolderAudioTrack])

  const discardTrackCardPreview = useCallback((tokenId: number) => {
    if (tokenId < 0) {
      trackCardPreviewIdRef.current += 1
      preparedTrackCardPreviewRef.current = null
      return
    }
    if (preparedTrackCardPreviewRef.current?.id === tokenId) {
      preparedTrackCardPreviewRef.current = null
    }
  }, [])

  const prepareTrackCardPreview = useCallback((
    direction: Direction,
  ): Promise<TrackCardPreviewToken | null> => {
    primeTrackArtwork(direction)
    const playlist = folderPlaylistRef.current
    const originTrackId = logicalCursorTrackIdRef.current
      ?? presentationTrackRef.current?.id
      ?? latestAudioStateRef.current?.currentTrackId
      ?? audioTrackRef.current?.id
    const originIndex = originTrackId ? queueTrackIndexRef.current.get(originTrackId) : undefined
    if (!playlist?.tracks.length || !originTrackId || originIndex === undefined) return Promise.resolve(null)

    const playlistEpoch = playlistScopeEpochRef.current
    const scope = playlistScope(playlist)
    const resolved = resolveAvailablePlaylistTarget(
      playlist,
      queueTracks,
      originIndex,
      originTrackId,
      direction,
      shuffleMode,
    )
    if (!resolved) return Promise.resolve(null)
    const { index: targetIndex, track: target } = resolved

    const previewId = trackCardPreviewIdRef.current + 1
    trackCardPreviewIdRef.current = previewId
    preparedTrackCardPreviewRef.current = null
    const createToken = (hydratedTrack: AudioTrackRef): PreparedTrackCardPreview => {
      const previewTrack = audioTrackToTrack(hydratedTrack)
      return {
        id: previewId,
        originTrackId,
        targetTrackId: target.id,
        direction,
        track: previewTrack,
        artwork: prefetchArtworkFromTrack(previewTrack),
        hydratedTrack,
        playlistEpoch,
        playlistScope: scope,
        targetIndex,
      }
    }
    const cachedTrack = hydratedCacheGet(hydratedAudioTrackCacheRef.current, target.sourcePath)
    if (audioTrackMatchesDescriptor(cachedTrack, target)) {
      const token = createToken(cachedTrack)
      preparedTrackCardPreviewRef.current = token
      return Promise.resolve(token)
    }
    if (cachedTrack) hydratedAudioTrackCacheRef.current.delete(target.sourcePath)
    // Never expose filename/tone placeholder metadata as a draggable card.
    return requestHydratedAudioTrack(target.sourcePath, playlistEpoch).then((hydratedTrack) => {
      if (
        trackCardPreviewIdRef.current !== previewId
        || playlistScopeEpochRef.current !== playlistEpoch
        || playlistScopeRef.current !== scope
        || !audioTrackMatchesDescriptor(hydratedTrack, target)
      ) return null
      const token = createToken(hydratedTrack)
      preparedTrackCardPreviewRef.current = token
      return token
    }).catch((error: unknown) => {
      if (trackCardPreviewIdRef.current === previewId) {
        console.debug('Track-card preview hydration failed', error)
      }
      return null
    })
  }, [primeTrackArtwork, queueTracks, requestHydratedAudioTrack, shuffleMode])

  const commitTrackCardPreview = useCallback((tokenId: number) => {
    const token = preparedTrackCardPreviewRef.current
    if (!token || token.id !== tokenId) return false
    const playlist = folderPlaylistRef.current
    const target = playlist?.tracks[token.targetIndex]
    const valid = Boolean(
      playlist
      && playlistScopeEpochRef.current === token.playlistEpoch
      && playlistScopeRef.current === token.playlistScope
      && (logicalCursorTrackIdRef.current
        ?? presentationTrackRef.current?.id
        ?? latestAudioStateRef.current?.currentTrackId
        ?? audioTrackRef.current?.id) === token.originTrackId
      && target?.available
      && target.id === token.targetTrackId
      && audioTrackMatchesDescriptor(token.hydratedTrack, target),
    )
    preparedTrackCardPreviewRef.current = null
    if (!valid || !playlist || !target
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking') return false
    const committedTrack = token.track
    const committedArtwork = token.artwork
    logicalCursorTrackIdRef.current = token.targetTrackId
    desiredAudioTrackIdRef.current = token.targetTrackId
    presentationTrackRef.current = committedTrack
    presentationArtworkRef.current = committedArtwork
    setPresentationTrack(committedTrack)
    setPresentationArtwork(committedArtwork)
    setContentState('track')
    prefetchAdjacentPlaylistTracks(token.targetTrackId)
    const autoplay = latestAudioStateRef.current?.phase === 'playing'
    void loadFolderAudioTrack(
      target,
      autoplay,
      false,
      token.playlistScope,
      {
        direction: token.direction,
        source: token.direction < 0 ? 'previous' : 'next',
        previewTokenId: token.id,
      },
      token,
    )
    return true
  }, [loadFolderAudioTrack, prefetchAdjacentPlaylistTracks])

  const loadFolderPlaylistSelection = useCallback(async (
    playlist: AudioFolderPlaylist,
    autoplay: boolean,
    ownerRequestId?: number,
  ) => {
    const target = playlist.tracks[playlist.selectedIndex] ?? playlist.tracks[0]
    if (!target || !playlist.tracks.some((candidate) => candidate.available)) {
      const noPlayableTrackError: AudioCommandError = {
        code: 'NO_TRACK_LOADED',
        message: '选择的文件夹没有可播放的本地音频。',
        recoverable: true,
      }
      if (ownerRequestId !== undefined) settleSelectionFailure(ownerRequestId, noPlayableTrackError)
      else {
        clearPresentationTrack('error')
        commitAudioError(noPlayableTrackError)
      }
      return
    }

    if (ownerRequestId !== undefined && selectionIsCurrent(ownerRequestId)) {
      pendingSelectionRef.current = null
      audioSelectionInProgressRef.current = false
      setSelectionPending(false)
      setAudioBusy(false)
    }
    // Start the read-only tag pass before the first track load. Loading the first
    // track opens a decoder and reads its metadata, so starting afterwards would
    // leave the list unread exactly while the user is waiting for it.
    ensurePlaylistSummaries(playlistScope(playlist), playlist)
    // Same reasoning for the duration channel, and it also has to survive the
    // load: the first probe opens decoders for the whole list, so it must start
    // before, not after, the first track's own decoder work. Publishing the
    // descriptors here is what lets `usePlaylistLibraryDurations` begin; the full
    // scope activation (epoch, queue, artwork) still happens after the load.
    if (playlistScopeRef.current !== playlistScope(playlist)) {
      setPendingDurationPlaylist(playlist)
    }
    const loaded = await loadPlaylistTrackOrSkip(playlist, playlist.selectedIndex, autoplay, 1, false, true, true)
    if (!loaded) {
      setPendingDurationPlaylist((previous) => (previous === playlist ? null : previous))
      return
    }
    activatePlaylistScope(playlist)
    setQueueOpen(true)
    const currentId = latestAudioStateRef.current?.currentTrackId
    if (currentId) prefetchAdjacentPlaylistTracks(currentId)
  }, [
    activatePlaylistScope,
    clearPresentationTrack,
    commitAudioError,
    ensurePlaylistSummaries,
    loadPlaylistTrackOrSkip,
    prefetchAdjacentPlaylistTracks,
    selectionIsCurrent,
    settleSelectionFailure,
  ])

  const changeFolderTrack = useCallback(async (direction: Direction, automatic = false) => {
    const playlist = folderPlaylistRef.current
    if (!playlist?.tracks.length) return

    const activeTrackId = logicalCursorTrackIdRef.current
      ?? presentationTrackRef.current?.id
      ?? latestAudioStateRef.current?.currentTrackId
      ?? audioTrackRef.current?.id
    const currentIndex = activeTrackId ? queueTrackIndexRef.current.get(activeTrackId) ?? 0 : 0
    if (
      automatic
      && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
      && currentIndex >= playlist.tracks.length - 1
    ) return

    const targetIndex = automatic && repeatMode === 'repeat-one'
      ? currentIndex
      : resolveNextTrackIndex(queueTracks, currentIndex, direction, shuffleMode)
    const autoplay = automatic || latestAudioStateRef.current?.phase === 'playing'
    const allowMissingSkipWrap = !(
      automatic && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
    )
    const visualSource: TrackSelectionVisualSource = automatic
      ? 'automatic'
      : direction < 0 ? 'previous' : 'next'
    await loadPlaylistTrackOrSkip(
      playlist,
      targetIndex,
      autoplay,
      direction,
      allowMissingSkipWrap,
      true,
      false,
      visualSource,
    )
  }, [loadPlaylistTrackOrSkip, queueTracks, repeatMode, shuffleMode])

  function applyOptimisticTransportPhase(phase: TransportIntentPhase) {
    transportIntentRef.current = phase
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    const now = window.performance.now()
    timelineAnchorRef.current = {
      positionSeconds: timelinePositionRef.current,
      at: now,
      trackId: latestAudioStateRef.current?.currentTrackId ?? null,
    }
    setAudioState((previous) => {
      if (!previous) return previous
      const optimisticState = { ...previous, phase, error: null }
      latestAudioStateRef.current = optimisticState
      return optimisticState
    })
    commitAudioError(null)
  }

  async function runTransportCommandQueue() {
    let lastConfirmedState = transportRollbackStateRef.current
    try {
      while (desiredTransportRequestRef.current) {
        const request = desiredTransportRequestRef.current
        desiredTransportRequestRef.current = null
        const nextState = request.phase === 'paused'
          ? await pauseAudio()
          : await playAudio({ restart: request.restart })
        lastConfirmedState = nextState

        const queuedRequest = desiredTransportRequestRef.current as TransportRequest | null
        if (queuedRequest?.phase === nextState.phase) desiredTransportRequestRef.current = null
        if (!desiredTransportRequestRef.current) applyAudioState(nextState, true)
      }
    } catch (error) {
      desiredTransportRequestRef.current = null
      if (lastConfirmedState) applyAudioState(lastConfirmedState, true)
      commitAudioError(commandError(error))
    } finally {
      transportIntentRef.current = null
      transportRollbackStateRef.current = null
      transportCommandRunningRef.current = false
      setTransportBusy(false)
    }
  }

  function queueTransportRequest(request: TransportRequest) {
    desiredTransportRequestRef.current = request
    applyOptimisticTransportPhase(request.phase)
    if (transportCommandRunningRef.current) return

    transportRollbackStateRef.current = audioState
    transportCommandRunningRef.current = true
    setTransportBusy(true)
    void runTransportCommandQueue()
  }

  async function transitionPlayback(
    request: AudioTransitionPlaybackInput,
  ): Promise<{ requestId: number; completed: boolean }> {
    if (
      audioSelectionInProgressRef.current
      || (transportCommandRunningRef.current && playbackTransitionCommandRequestIdRef.current === null)
      || timelineInteractionRef.current === 'seeking'
      || request.expectedTrackId !== latestAudioStateRef.current?.currentTrackId
    ) throw new Error('Playback transition context is stale')

    const rollbackState = latestAudioStateRef.current
    activePlaybackTransitionRef.current = request
    playbackTransitionCommandRequestIdRef.current = request.requestId
    transportIntentRef.current = request.target
    transportCommandRunningRef.current = true
    setTransportBusy(true)
    commitAudioError(null)

    try {
      const nextState = await transitionAudioPlayback(request)
      const nextTransition = nextState.transportTransition ?? null
      if (activePlaybackTransitionRef.current?.requestId !== request.requestId) {
        return { requestId: request.requestId, completed: false }
      }
      if (
        nextState.currentTrackId !== request.expectedTrackId
        || (nextTransition !== null && nextTransition.requestId !== request.requestId)
        || (nextTransition === null
          && nextState.transportSettledRequestId !== request.requestId)
      ) throw new Error('Playback transition response is stale')

      applyAudioState(nextState, nextTransition === null)
      return {
        requestId: request.requestId,
        completed: nextTransition === null
          && nextState.transportSettledRequestId === request.requestId
          && nextState.phase === request.target,
      }
    } catch (error) {
      if (activePlaybackTransitionRef.current?.requestId !== request.requestId) {
        return { requestId: request.requestId, completed: false }
      }
      activePlaybackTransitionRef.current = null
      transportIntentRef.current = null
      if (
        rollbackState
        && rollbackState.transportTransition === null
        && latestAudioStateRef.current?.currentTrackId === request.expectedTrackId
      ) applyAudioState(rollbackState, true)
      commitAudioError(commandError(error))
      try {
        const reconciledState = await getAudioState()
        if (reconciledState.currentTrackId === latestAudioStateRef.current?.currentTrackId) {
          applyAudioState(reconciledState, true)
        }
      } catch (refreshError) {
        commitAudioError(commandError(refreshError))
      }
      throw error
    } finally {
      if (playbackTransitionCommandRequestIdRef.current === request.requestId) {
        playbackTransitionCommandRequestIdRef.current = null
        transportCommandRunningRef.current = false
      }
      setTransportBusy(
        activePlaybackTransitionRef.current !== null
        || Boolean(latestAudioStateRef.current?.transportTransition),
      )
    }
  }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenAudioStateChanged((state) => applyAudioState(state, false, false, true))
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch((error: unknown) => commitAudioError(commandError(error)))

    const initialStateRequestGeneration = audioStateRequestGenerationRef.current
    void getAudioOutputInfo()
      .then((nextOutputInfo) => {
        if (!disposed) setAudioOutputInfo(nextOutputInfo)
      })
      .catch(() => undefined)
    void getAudioState()
      .then((nextAudioState) => {
        if (!disposed && initialStateRequestGeneration === audioStateRequestGenerationRef.current) {
          applyAudioState(nextAudioState)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) commitAudioError(commandError(error))
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyAudioState, commitAudioError])

  useEffect(() => {
    if (!savedSession) return
    const watchdog = window.setTimeout(() => {
      if (!sessionRestorePendingRef.current) return
      // Fence the outstanding native request before exposing a stable error
      // state. A late response must not repaint the startup placeholder.
      startupRestoreTimedOutRef.current = true
      sessionRestorePendingRef.current = false
      clearPlaybackSession()
      selectionRequestIdRef.current += 1
      audioStateRequestGenerationRef.current += 1
      pendingSelectionRef.current = null
      audioSelectionInProgressRef.current = false
      audioTrackRef.current = null
      latestAudioStateRef.current = null
      setAudioTrack(null)
      setAudioState(null)
      setFolderPlaylist(null)
      setPendingDurationPlaylist(null)
      setQueueTracks([])
      setSelectionPending(false)
      setAudioBusy(false)
      clearPresentationTrack('error')
      setStartupRestoreReady(true)
      console.warn('恢复上次播放超时')
    }, 15_000)
    return () => window.clearTimeout(watchdog)
  }, [clearPresentationTrack, savedSession])

  useEffect(() => {
    if (!sessionRestorePendingRef.current || sessionRestoreStartedRef.current) return
    const saved = savedSessionRef.current
    if (!saved) return
    // This effect owns one restore transaction. Settle its registry dependency
    // before issuing any native request, so a late registry result cannot run
    // cleanup halfway through restoring another source and abandon its queue.
    if (playlistRestorePending) return
    sessionRestoreStartedRef.current = true
    if (selectionRequestIdRef.current !== 0) {
      sessionRestorePendingRef.current = false
      setStartupRestoreReady(true)
      return
    }
    let disposed = false
    const cancelled = () => disposed || startupRestoreTimedOutRef.current
    let restoredPlaylist: AudioFolderPlaylist | null = null
    let restoreSelectionId: number | null = null
    void (async () => {
      try {
        // Let StrictMode's mount cleanup run before issuing a native command.
        await Promise.resolve()
        if (cancelled()) return
        let folderMode = saved.playlist.folderMode
        if (saved.playlist.sourceKind === 'folder' && !folderMode) {
          // Older snapshots did not record whether this was a recursive library
          // queue or the siblings of a file opened directly. The registered
          // library roots disambiguate those existing sessions.
          try {
            const libraryFolders = await getLibraryFolders()
            folderMode = libraryFolders.folders.some((path) => normalizeAudioSourcePath(path)
              === normalizeAudioSourcePath(saved.playlist.sourcePath)) ? 'library' : 'file'
          } catch {
            // Prefer the recursive source when the registry cannot be read: it
            // still contains a nested All Songs selection.
            folderMode = 'library'
          }
        }
        const playlist = saved.playlist.sourceKind === 'custom'
          ? saved.playlist.customPlaylist ?? null
          : saved.playlist.sourceKind === 'm3u8'
            ? sessionPlaylistDescriptorsRef.current.get(`${saved.playlist.sourceKind}\u0000${normalizeAudioSourcePath(saved.playlist.sourcePath)}`) ?? null
            : folderMode === 'file'
              ? await listAudioFolderTracks(saved.sourcePath)
              : await scanLibraryFolder(saved.playlist.sourcePath)
        if (cancelled() || selectionRequestIdRef.current !== 0) return
        if (playlist?.sourceKind === 'folder' && folderMode !== 'file') {
          libraryPlaylistObjectsRef.current.add(playlist)
        }
        const target = playlist?.tracks.find((item) => normalizeAudioSourcePath(item.sourcePath)
          === normalizeAudioSourcePath(saved.sourcePath))
        if (!playlist || playlist.sourceKind !== saved.playlist.sourceKind
          || normalizeAudioSourcePath(playlist.sourcePath) !== normalizeAudioSourcePath(saved.playlist.sourcePath)
          || !target?.available) {
          clearPlaybackSession()
          return
        }
        restoredPlaylist = playlist
        audioStateRequestGenerationRef.current += 1
        const loading = loadFolderAudioTrack(target, false, true, playlistScope(playlist))
        restoreSelectionId = selectionRequestIdRef.current
        const loaded = await loading
        if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId) return
        if (!loaded || latestAudioStateRef.current?.currentTrackId !== target.id) {
          throw new Error('上次播放的歌曲未能加载')
        }
        const positionMs = Math.min(saved.positionMs, latestAudioStateRef.current.durationMs ?? saved.positionMs)
        const positioned = await seekAudio(positionMs)
        if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId
          || positioned.currentTrackId !== target.id) return
        applyAudioState(positioned, false, true)
        if (saved.volume !== volumeScalarToPercent(positioned.volume)) {
          const adjusted = await setAudioVolume(volumePercentToScalar(saved.volume))
          if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId) return
          applyAudioState(adjusted)
        }
        // A saved transport state is historical. Startup always presents the
        // restored position paused, including sessions saved while playing.
        const pausedState = await pauseAudio()
        if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId
          || pausedState.currentTrackId !== target.id) return
        if (pausedState.phase !== 'paused' || Math.abs(pausedState.positionMs - positionMs) > 1000) {
          throw new Error('上次播放的暂停状态或进度未能确认')
        }
        applyAudioState(pausedState)
        if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId) return
        activatePlaylistScope(playlist)
        setQueueOpen(saved.queueOpen)
        setVolume(saved.volume)
        confirmedVolumeRef.current = saved.volume
      } catch (error) {
        if (!cancelled() && selectionRequestIdRef.current === (restoreSelectionId ?? 0)) {
          clearPlaybackSession()
          console.warn('恢复上次播放失败', error)
          // A partially restored native track must never become the first
          // visible loading frame. If possible, expose its confirmed paused
          // state; otherwise settle on the error view.
          const currentTrackId = latestAudioStateRef.current?.currentTrackId
          if (currentTrackId && restoredPlaylist) {
            try {
              const pausedState = await pauseAudio()
              if (cancelled() || selectionRequestIdRef.current !== restoreSelectionId) return
              if (pausedState.phase === 'paused' && pausedState.currentTrackId === currentTrackId) {
                applyAudioState(pausedState)
                activatePlaylistScope(restoredPlaylist)
                return
              }
            } catch (pauseError) {
              console.warn('恢复失败后暂停歌曲也失败', pauseError)
            }
          }
          clearPresentationTrack('error')
        }
      } finally {
        if (!cancelled()) {
          sessionRestorePendingRef.current = false
          setStartupRestoreReady(true)
        }
      }
    })()
    return () => {
      disposed = true
      if (sessionRestorePendingRef.current) sessionRestoreStartedRef.current = false
    }
  }, [
    activatePlaylistScope,
    applyAudioState,
    clearPresentationTrack,
    loadFolderAudioTrack,
    playlistRestorePending,
  ])

  useEffect(() => () => visualTimelineClock.dispose(), [visualTimelineClock])

  useEffect(() => {
    trackDetailsHandlerRef.current = applyTrackDetails
  }, [applyTrackDetails])

  useEffect(() => {
    if (detailsPending || !currentTrackId) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) prefetchAdjacentPlaylistTracks(currentTrackId)
    })
    return () => { cancelled = true }
  }, [currentTrackId, detailsPending, prefetchAdjacentPlaylistTracks])

  useEffect(() => {
    trackDetailsListenerActiveRef.current = true
    void ensureTrackDetailsListener()
      .catch((error: unknown) => {
        if (trackDetailsListenerActiveRef.current) {
          console.error('Failed to listen for audio track details', error)
        }
      })

    return () => {
      trackDetailsListenerActiveRef.current = false
      trackDetailsListenerEpochRef.current += 1
      trackDetailsUnlistenRef.current?.()
      trackDetailsUnlistenRef.current = null
      trackDetailsListenerPromiseRef.current = null
    }
  }, [ensureTrackDetailsListener])

  useEffect(() => {
    if (
      audioState?.phase !== 'ended'
      || !folderPlaylist
      || !currentTrackId
      || endingTrackRef.current === currentTrackId
    ) return

    endingTrackRef.current = currentTrackId
    void changeFolderTrack(1, true)
  }, [audioState?.phase, changeFolderTrack, currentTrackId, folderPlaylist])

  useEffect(() => {
    if (audioState?.phase !== 'playing' || timelineInteraction !== 'following') return
    const intervalId = window.setInterval(() => {
      const requestGeneration = audioStateRequestGenerationRef.current
      const requestTrackId = latestAudioStateRef.current?.currentTrackId ?? null
      void getAudioState()
        .then((nextAudioState) => {
          if (
            requestGeneration === audioStateRequestGenerationRef.current
            && requestTrackId === (latestAudioStateRef.current?.currentTrackId ?? null)
            && nextAudioState.currentTrackId === requestTrackId
          ) applyAudioState(nextAudioState)
        })
        .catch((error: unknown) => {
          if (requestGeneration === audioStateRequestGenerationRef.current) commitAudioError(commandError(error))
        })
    }, 500)
    return () => window.clearInterval(intervalId)
  }, [applyAudioState, audioState?.phase, commitAudioError, timelineInteraction])

  useEffect(() => {
    if (audioState?.phase !== 'playing' || timelineInteraction !== 'following') return

    let intervalId: number | null = null
    const updateVisualClock = () => {
      const anchor = timelineAnchorRef.current
      const currentState = latestAudioStateRef.current
      if (currentState?.phase !== 'playing' || anchor.trackId !== currentState.currentTrackId) return

      const now = window.performance.now()
      const durationSeconds = currentState.durationMs != null
        ? currentState.durationMs / 1000
        : Number.POSITIVE_INFINITY
      const positionSeconds = Math.min(
        anchor.positionSeconds + Math.max(0, now - anchor.at) / 1000,
        durationSeconds,
      )
      timelinePositionRef.current = positionSeconds
      visualTimelineClock.setPositionSeconds(positionSeconds)
    }

    const stopPublishing = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }
    const startPublishing = () => {
      if (document.hidden || intervalId !== null) return
      updateVisualClock()
      intervalId = window.setInterval(updateVisualClock, 100)
    }
    const handleVisibilityChange = () => {
      if (document.hidden) stopPublishing()
      else startPublishing()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    startPublishing()
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPublishing()
    }
  }, [audioState?.phase, timelineInteraction, visualTimelineClock])

  async function openAndMaybePlay(autoplay: boolean) {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    const selectionRequestId = beginTrackSelection(null, null)

    try {
      const source = await openAudioSource()
      if (!selectionIsCurrent(selectionRequestId)) return
      if (source.kind === 'playlist') {
        await loadFolderPlaylistSelection(source.playlist, autoplay, selectionRequestId)
        endingTrackRef.current = null
        return
      }

      const nextAudioTrack = source.track
      recordAcceptedTrackSelectionActivity()
      // The single-file path replaces the placeholder selection created above
      // instead of going through beginTrackSelection(target...). Keep both
      // cursors aligned with that replacement so the request remains current
      // when the playback command resolves.
      logicalCursorTrackIdRef.current = nextAudioTrack.id
      desiredAudioTrackIdRef.current = nextAudioTrack.id
      pendingSelectionRef.current = {
        requestId: selectionRequestId,
        targetTrackId: nextAudioTrack.id,
        sourcePath: nextAudioTrack.sourcePath,
        targetScope: null,
        previousGeneration: latestAudioStateRef.current?.generation ?? null,
        generation: null,
        usesLoadAndPlay: false,
        commandConfirmed: true,
        detailsSettled: true,
        replacementStarted: pendingSelectionRef.current?.replacementStarted ?? false,
        loadedTrackId: nextAudioTrack.id,
        previousPresentationTrack: pendingSelectionRef.current?.previousPresentationTrack ?? presentationTrackRef.current,
        previousArtwork: pendingSelectionRef.current?.previousArtwork ?? presentationArtworkRef.current,
        previousDetailsPending: pendingSelectionRef.current?.previousDetailsPending ?? detailsPendingRef.current,
        previousSourcePath: pendingSelectionRef.current?.previousSourcePath ?? null,
        previousAudioTrack: pendingSelectionRef.current?.previousAudioTrack ?? null,
      }
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = nextAudioTrack
      setAudioTrack(nextAudioTrack)

      const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
      if (!selectionIsCurrent(selectionRequestId, nextAudioTrack.id)) return
      if (confirmedAudioState.currentTrackId !== nextAudioTrack.id) {
        const mismatchError = commandError(new Error('Audio selection target mismatch'))
        applyAudioState(confirmedAudioState)
        pendingSelectionRef.current = null
        clearPresentationTrack('error')
        commitAudioError(mismatchError)
        return
      }
      applyAudioState(confirmedAudioState)
      if (!selectionIsCurrent(selectionRequestId, nextAudioTrack.id)) return
      pendingSelectionRef.current = null

      let nextFolderPlaylist: AudioFolderPlaylist
      try {
        nextFolderPlaylist = await listAudioFolderTracks(nextAudioTrack.sourcePath)
      } catch {
        nextFolderPlaylist = singleTrackFolderPlaylist(nextAudioTrack)
      }
      if (
        selectionRequestIdRef.current !== selectionRequestId
        || pendingSelectionRef.current !== null
        || latestAudioStateRef.current?.currentTrackId !== nextAudioTrack.id
        || audioTrackRef.current?.id !== nextAudioTrack.id
      ) return
      activatePlaylistScope(nextFolderPlaylist)
      prefetchAdjacentPlaylistTracks(nextAudioTrack.id)
      endingTrackRef.current = null
    } catch (error) {
      settleSelectionFailure(selectionRequestId, commandError(error))
    } finally {
      if (selectionRequestIdRef.current === selectionRequestId) {
        audioSelectionInProgressRef.current = false
        setSelectionPending(false)
        setAudioBusy(false)
      }
    }
  }

  function requestRealAudioSeek(nextProgress: number) {
    const clampedProgress = Math.min(Math.max(nextProgress, 0), duration)
    const positionMs = Math.round(clampedProgress * 1000)
    const requestTrackId = latestAudioStateRef.current?.currentTrackId
    if (!requestTrackId) return
    const requestId = seekRequestIdRef.current + 1
    seekRequestIdRef.current = requestId
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'seeking'
    setTimelineInteraction('seeking')
    timelinePositionRef.current = clampedProgress
    visualTimelineClock.setPositionSeconds(clampedProgress)
    setTimelinePosition(clampedProgress)
    seekTargetGuardRef.current = {
      trackId: requestTrackId,
      positionMs,
      expiresAt: window.performance.now() + 900,
    }
    commitAudioError(null)
    let seekSucceeded = false
    void seekAudio(positionMs)
      .then((nextAudioState) => {
        if (
          seekRequestIdRef.current === requestId
          && (latestAudioStateRef.current?.currentTrackId ?? null) === requestTrackId
          && nextAudioState.currentTrackId === requestTrackId
        ) {
          seekSucceeded = true
          applyAudioState(nextAudioState, false, true)
        }
      })
      .catch((error: unknown) => {
        if (
          seekRequestIdRef.current === requestId
          && (latestAudioStateRef.current?.currentTrackId ?? null) === requestTrackId
        ) commitAudioError(commandError(error))
      })
      .finally(() => {
        if (
          seekRequestIdRef.current !== requestId
          || (latestAudioStateRef.current?.currentTrackId ?? null) !== requestTrackId
        ) return

        timelineInteractionRef.current = 'following'
        setTimelineInteraction('following')
        const latestState = latestAudioStateRef.current
        if (latestState && latestState.currentTrackId === requestTrackId) {
          const guardedPosition = seekSucceeded && seekTargetGuardRef.current?.positionMs === positionMs
            ? positionMs / 1000
            : latestState.positionMs / 1000
          if (!seekSucceeded) seekTargetGuardRef.current = null
          timelineAnchorRef.current = {
            positionSeconds: guardedPosition,
            at: window.performance.now(),
            trackId: requestTrackId,
          }
          timelinePositionRef.current = guardedPosition
          visualTimelineClock.setPositionSeconds(guardedPosition)
          setTimelinePosition(guardedPosition)
        }
      })
  }

  function startProgressPreview() {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || !track
      || duration <= 0
      || timelineInteractionRef.current === 'seeking'
    ) return
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'previewing'
    setTimelineInteraction('previewing')
    seekTargetGuardRef.current = null
  }

  function setProgress(nextProgress: number) {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || !track
      || duration <= 0
      || timelineInteractionRef.current === 'seeking'
    ) return
    if (timelineInteractionRef.current !== 'previewing') startProgressPreview()
    const clampedProgress = Math.min(Math.max(nextProgress, 0), duration)
    timelinePositionRef.current = clampedProgress
    visualTimelineClock.setPositionSeconds(clampedProgress)
  }

  function cancelProgressPreview() {
    if (timelineInteractionRef.current !== 'previewing') return
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    const state = latestAudioStateRef.current
    if (!state) return
    const anchor = timelineAnchorRef.current
    const positionSeconds = anchor.trackId === state.currentTrackId
      ? anchor.positionSeconds
        + (state.phase === 'playing' ? Math.max(0, window.performance.now() - anchor.at) / 1000 : 0)
      : state.positionMs / 1000
    const clampedPosition = Math.min(Math.max(positionSeconds, 0), (state.durationMs ?? Number.POSITIVE_INFINITY) / 1000)
    timelineAnchorRef.current = {
      positionSeconds: clampedPosition,
      at: window.performance.now(),
      trackId: state.currentTrackId,
    }
    timelinePositionRef.current = clampedPosition
    visualTimelineClock.setPositionSeconds(clampedPosition)
    setTimelinePosition(clampedPosition)
  }

  function commitProgress(nextProgress: number) {
    endingTrackRef.current = null
    if (
      !audioSelectionInProgressRef.current
      && !transportOperationInProgress()
      && track
      && duration > 0
    ) requestRealAudioSeek(nextProgress)
  }

  function togglePlayback() {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return
    if (!track || !currentTrackId) {
      void openAndMaybePlay(true)
      return
    }

    const targetPhase: TransportIntentPhase = playing ? 'paused' : 'playing'
    const currentVisualPosition = visualTimelineClock.getPositionSeconds()
    queueTransportRequest({
      phase: targetPhase,
      restart: targetPhase === 'playing' && duration > 0 && currentVisualPosition >= duration,
    })
  }

  const toggleTrackFeedback = useCallback((trackId: string, feedback: TrackFeedback) => {
    setFeedbackByTrackId((previous) => {
      if (previous[trackId] !== feedback) return { ...previous, [trackId]: feedback }
      const next = { ...previous }
      delete next[trackId]
      return next
    })
  }, [])

  function changeVolume(nextVolume: number) {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return
    const safeVolume = Math.min(100, Math.max(0, Math.round(nextVolume)))
    setVolume(safeVolume)
    desiredVolumeRef.current = volumePercentToScalar(safeVolume)
    commitAudioError(null)
    if (volumeCommandRunningRef.current) return

    volumeCommandRunningRef.current = true
    setVolumeBusy(true)
    void runVolumeCommandQueue()
  }

  async function runVolumeCommandQueue() {
    let lastConfirmedVolume = confirmedVolumeRef.current
    try {
      while (desiredVolumeRef.current !== null) {
        const requestedVolume = desiredVolumeRef.current
        desiredVolumeRef.current = null
        const requestGeneration = audioStateRequestGenerationRef.current
        const nextAudioState = await setAudioVolume(requestedVolume)
        lastConfirmedVolume = volumeScalarToPercent(nextAudioState.volume)
        confirmedVolumeRef.current = lastConfirmedVolume
        if (desiredVolumeRef.current === null) {
          setVolume(lastConfirmedVolume)
          if (requestGeneration === audioStateRequestGenerationRef.current) applyAudioState(nextAudioState)
        }
      }
    } catch (error) {
      desiredVolumeRef.current = null
      setVolume(lastConfirmedVolume)
      commitAudioError(commandError(error))
    } finally {
      volumeCommandRunningRef.current = false
      setVolumeBusy(false)
    }
  }

  const selectQueueTrack = useCallback((trackId: string) => {
    if (
      transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
      || !folderPlaylist
    ) return
    const targetIndex = queueTrackIndexRef.current.get(trackId)
    if (targetIndex !== undefined) {
      const activeTrackId = latestAudioStateRef.current?.currentTrackId ?? audioTrackRef.current?.id
      const currentIndex = activeTrackId ? queueTrackIndexRef.current.get(activeTrackId) ?? targetIndex : targetIndex
      const direction: Direction = targetIndex < currentIndex ? -1 : 1
      void loadPlaylistTrackOrSkip(folderPlaylist, targetIndex, true, direction, false, false, false, 'queue')
    }
  }, [folderPlaylist, loadPlaylistTrackOrSkip])

  const selectSessionPlaylistTrack = useCallback(async (scope: string, trackId: string) => {
    if (audioSelectionInProgressRef.current || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking') return false
    const playlist = findPlaylistForScope(scope)
    const index = playlist?.tracks.findIndex((item) => item.id === trackId) ?? -1
    if (!playlist || index < 0) return false
    const expectedRequestId = selectionRequestIdRef.current + 1
    const loaded = await loadPlaylistTrackOrSkip(playlist, index, true, 1, false, false, false, 'queue')
    if (!loaded || selectionRequestIdRef.current !== expectedRequestId
      || latestAudioStateRef.current?.currentTrackId !== trackId) return false
    activatePlaylistScope(playlist)
    prefetchAdjacentPlaylistTracks(trackId)
    return true
  }, [findPlaylistForScope, loadPlaylistTrackOrSkip, activatePlaylistScope, prefetchAdjacentPlaylistTracks])

  const selectPlaybackQueueTrack = useCallback(async (selection: PlaybackQueueSelection, trackId: string) => {
    if (audioSelectionInProgressRef.current || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking') return false
    const sources = new Map<string, Map<string, AudioFolderTrackRef>>()
    const tracks: AudioFolderTrackRef[] = []
    const summaries: Record<string, PlaylistTrackRow> = {}
    for (const entry of selection.entries) {
      let source = sources.get(entry.scope)
      if (!source) {
        const playlist = findPlaylistForScope(entry.scope)
        if (!playlist) return false
        source = new Map(playlist.tracks.map((item) => [item.id, item]))
        sources.set(entry.scope, source)
      }
      const descriptor = source.get(entry.trackId)
      // A stale UI snapshot must never silently become a different sequence.
      if (!descriptor) return false
      tracks.push({ ...descriptor })
      const summary = playlistSummaryRowsRef.current[entry.scope]?.[entry.trackId]
      if (summary) summaries[entry.trackId] = summary
    }
    const index = tracks.findIndex((item) => item.id === trackId)
    if (index < 0) return false
    const source = selection.sourceScope ? findPlaylistForScope(selection.sourceScope) : undefined
    if (selection.kind === 'playlist' && !source) return false
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const name = selection.kind === 'all-songs' ? '所有歌曲' : playlistDisplayName(source!)
    const playlist: PlaybackQueuePlaylist = {
      sourceKind: 'custom', sourcePath: `queue:${selection.kind}:${id}`,
      sourceName: name, directoryPath: '', directoryName: name, selectedIndex: index, tracks,
      playbackQueue: selection.kind === 'all-songs' ? { kind: 'all-songs' }
        : { kind: 'playlist', sourceScope: selection.sourceScope,
          ...(source?.sourceKind === 'custom' && !playbackQueueOrigin(source)
            ? { sourcePlaylist: { ...source, tracks: source.tracks.map((item) => ({ ...item })) } } : {}) },
    }
    const expectedRequestId = selectionRequestIdRef.current + 1
    const loaded = await loadPlaylistTrackOrSkip(playlist, index, true, 1, false, false, false, 'queue')
    if (!loaded || selectionRequestIdRef.current !== expectedRequestId
      || latestAudioStateRef.current?.currentTrackId !== trackId) return false
    activatePlaylistScope(playlist, summaries)
    prefetchAdjacentPlaylistTracks(trackId)
    return true
  }, [findPlaylistForScope, loadPlaylistTrackOrSkip, activatePlaylistScope, prefetchAdjacentPlaylistTracks])

  function refreshAudioState() {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return
    const requestGeneration = audioStateRequestGenerationRef.current
    void getAudioState()
      .then((nextAudioState) => {
        if (requestGeneration === audioStateRequestGenerationRef.current) applyAudioState(nextAudioState)
      })
      .catch((error: unknown) => {
        if (requestGeneration === audioStateRequestGenerationRef.current) commitAudioError(commandError(error))
      })
  }

  function stopAudioPlayback() {
    if (
      audioSelectionInProgressRef.current
      || transportOperationInProgress()
      || timelineInteractionRef.current === 'seeking'
    ) return
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    const requestGeneration = audioStateRequestGenerationRef.current
    const requestTrackId = latestAudioStateRef.current?.currentTrackId ?? null
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    transportCommandRunningRef.current = true
    setTransportBusy(true)
    void stopAudio()
      .then((nextAudioState) => {
        if (
          requestGeneration === audioStateRequestGenerationRef.current
          && requestTrackId === (latestAudioStateRef.current?.currentTrackId ?? null)
          && nextAudioState.currentTrackId === requestTrackId
        ) applyAudioState(nextAudioState, true)
      })
      .catch((error: unknown) => {
        if (requestGeneration === audioStateRequestGenerationRef.current) commitAudioError(commandError(error))
      })
      .finally(() => {
        if (requestGeneration !== audioStateRequestGenerationRef.current) return
        transportCommandRunningRef.current = false
        setTransportBusy(false)
      })
  }

  return {
    startupRestoreReady,
    hadSavedSession: savedSession !== null,
    track,
    artwork: presentationArtwork,
    artworkPrefetchCandidate: artworkPrefetchCandidates[0] ?? null,
    artworkPrefetchCandidates,
    selectionActivitySequence,
    selectionVisualIntent,
    automaticContinuationVisual,
    detailsPending,
    contentState,
    queueTracks,
    unavailableTrackIds,
    // The duration channel must see the list as soon as it is known, not only
    // after the first track finishes loading.
    playlistDurationTracks: folderPlaylist?.tracks ?? pendingDurationPlaylist?.tracks,
    sessionPlaylists,
    libraryFolderPlaylists,
    selectedFolderPaths,
    libraryFolderErrors,
    libraryStatus,
    libraryRestorePending,
    libraryImportPending,
    playlistRestorePending,
    selectFolders,
    importPlaylist,
    createPlaylist,
    clearSelectedLibraryFolders,
    activePlaylistScope: folderPlaylist ? playlistScope(folderPlaylist) : null,
    playbackSourceScope: playbackQueueOrigin(folderPlaylist)?.sourceScope
      ?? (folderPlaylist && !playbackQueueOrigin(folderPlaylist) ? playlistScope(folderPlaylist) : null),
    playbackQueueKind: playbackQueueOrigin(folderPlaylist)?.kind,
    selectPlaybackQueueTrack,
    selectSessionPlaylistTrack,
    playlistDurationScope: folderPlaylist
      ? playlistScope(folderPlaylist)
      : pendingDurationPlaylist ? playlistScope(pendingDurationPlaylist) : currentAudioTrack?.sourcePath ?? '',
    playlistTrackMetadata,
    playlistTrackVisuals,
    playlistTrackSummariesByScope,
    playlistSummaryStatusByScope,
    ensurePlaylistSummaries,
    playlistName: folderPlaylist ? playlistDisplayName(folderPlaylist) : undefined,
    currentFeedback: track ? feedbackByTrackId[track.id] : undefined,
    feedbackByTrackId,
    shuffleMode,
    repeatMode,
    queueOpen,
    playing,
    progress,
    duration,
    timelineInteraction,
    visualTimelineClock,
    volume,
    volumeBusy,
    volumeDisabled: audioBusy || selectionPending || transportBusy || volumeBusy || timelineInteraction === 'seeking',
    audioBusy,
    selectionPending,
    statusText,
    transportBusy,
    transportTransition: audioState?.transportTransition ?? null,
    transportSettledRequestId: audioState?.transportSettledRequestId ?? null,
    audioState,
    audioOutputInfo,
    currentAudioTrack,
    startProgressPreview,
    setProgress,
    commitProgress,
    cancelProgressPreview,
    openAudio: () => void openAndMaybePlay(false),
    openAudioAndPlay: () => void openAndMaybePlay(true),
    previous: () => void changeFolderTrack(-1),
    next: () => void changeFolderTrack(1),
    prepareTrackCardPreview,
    primeTrackArtwork,
    commitTrackCardPreview,
    discardTrackCardPreview,
    togglePlayback,
    transitionPlayback,
    cycleShuffleMode: () => setShuffleMode((value) => nextShuffleMode[value]),
    cycleRepeatMode: () => setRepeatMode((value) => nextRepeatMode[value]),
    toggleTrackFeedback,
    changeVolume,
    toggleQueue: () => setQueueOpen((value) => !value),
    selectQueueTrack,
    setVisiblePlaylistTrackIds,
    refreshAudioState,
    stopAudioPlayback,
  }
}
