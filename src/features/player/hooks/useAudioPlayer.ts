import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  audioFolderTrackPlaceholder,
  audioTrackToTrack,
  fileNameTitle,
  playlistDisplayName,
  singleTrackFolderPlaylist,
  upsertTrack,
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
import type { PlayerContentState, PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { Track, TrackArtwork, TrackFeedback } from '@/features/player/model/playerTypes'
import {
  getAudioState,
  getCurrentAudioTrack,
  hydrateAudioTrack,
  isAudioCommandError,
  listAudioFolderTracks,
  listenAudioTrackDetailsChanged,
  listenAudioStateChanged,
  loadAndPlayAudio,
  loadAudioFile,
  openAudioSource,
  pauseAudio,
  playAudio,
  seekAudio,
  setAudioVolume,
  stopAudio,
  type AudioCommandError,
  type AudioFolderPlaylist,
  type AudioFolderTrackRef,
  type AudioPlaybackState,
  type AudioTrackRef,
  type AudioTrackDetailsChanged,
} from '@/features/player/services/audioCommands'

type TransportIntentPhase = 'playing' | 'paused'
type TransportRequest = { phase: TransportIntentPhase; restart: boolean }
type PendingTrackSelection = {
  requestId: number
  targetTrackId: string | null
  sourcePath: string | null
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

export function useAudioPlayer() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [audioState, setAudioState] = useState<AudioPlaybackState | null>(null)
  const [audioTrack, setAudioTrack] = useState<AudioTrackRef | null>(null)
  const [presentationTrack, setPresentationTrack] = useState<Track | null>(null)
  const [presentationArtwork, setPresentationArtwork] = useState<TrackArtwork | null>(null)
  const [detailsPending, setDetailsPending] = useState(false)
  const [contentState, setContentState] = useState<PlayerContentState>('empty')
  const [folderPlaylist, setFolderPlaylist] = useState<AudioFolderPlaylist | null>(null)
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
  const timelineAnchorRef = useRef({ positionSeconds: 0, at: 0, trackId: null as string | null })
  const seekTargetGuardRef = useRef<{ trackId: string; positionMs: number; expiresAt: number } | null>(null)
  const transportIntentRef = useRef<TransportIntentPhase | null>(null)
  const desiredTransportRequestRef = useRef<TransportRequest | null>(null)
  const transportCommandRunningRef = useRef(false)
  const transportRollbackStateRef = useRef<AudioPlaybackState | null>(null)
  const confirmedVolumeRef = useRef(volume)
  const desiredVolumeRef = useRef<number | null>(null)
  const volumeCommandRunningRef = useRef(false)
  const audioTrackRef = useRef<AudioTrackRef | null>(null)
  const audioTrackRequestIdRef = useRef(0)
  const audioTrackRequestTrackIdRef = useRef<string | null>(null)
  const audioSelectionInProgressRef = useRef(false)
  const selectionRequestIdRef = useRef(0)
  const pendingSelectionRef = useRef<PendingTrackSelection | null>(null)
  const presentationTrackRef = useRef<Track | null>(null)
  const presentationArtworkRef = useRef<TrackArtwork | null>(null)
  const detailsPendingRef = useRef(false)
  const hydratedAudioTrackCacheRef = useRef(new Map<string, AudioTrackRef>())
  const hydrationInFlightRef = useRef(new Map<string, Promise<AudioTrackRef>>())
  const latestAudioStateRef = useRef<AudioPlaybackState | null>(null)
  const folderPlaylistRef = useRef<AudioFolderPlaylist | null>(null)
  const trackDetailsHandlerRef = useRef<(details: AudioTrackDetailsChanged) => void>(() => undefined)
  const trackDetailsUnlistenRef = useRef<(() => void) | null>(null)
  const trackDetailsListenerPromiseRef = useRef<Promise<void> | null>(null)
  const trackDetailsListenerActiveRef = useRef(false)
  const trackDetailsListenerEpochRef = useRef(0)

  const currentTrackId = audioState?.currentTrackId ?? null
  const track = presentationTrack
  const currentAudioTrack = audioTrack?.id === currentTrackId ? audioTrack : null
  const playing = audioState?.phase === 'playing'
  const duration = audioState?.durationMs != null ? audioState.durationMs / 1000 : 0
  const progress = Math.min(Math.max(timelinePosition, 0), duration)
  const statusText = contentState === 'loading' && !audioError
    ? appCopy.audio.loading
    : audioStatusText(audioState, audioError, currentAudioTrack)
  const queueTracks = useMemo(() => {
    if (!folderPlaylist) return tracks
    const sourceName = playlistDisplayName(folderPlaylist)

    return folderPlaylist.tracks.map((folderTrack) => {
      const loadedTrack = tracks.find((candidate) => candidate.id === folderTrack.id)
      if (loadedTrack) return loadedTrack

      return {
        id: folderTrack.id,
        title: fileNameTitle(folderTrack.fileName),
        artist: folderTrack.available ? sourceName : `${sourceName} · 歌曲未找到`,
        album: sourceName,
        category: 'local-audio',
        durationSeconds: 0,
        coverTone: 'blue',
        lyrics: [],
      } satisfies Track
    })
  }, [folderPlaylist, tracks])
  const unavailableTrackIds = useMemo(
    () => new Set(folderPlaylist?.tracks.filter((candidate) => !candidate.available).map((candidate) => candidate.id)),
    [folderPlaylist],
  )

  const commitDetailsPending = useCallback((pending: boolean) => {
    detailsPendingRef.current = pending
    setDetailsPending(pending)
  }, [])

  const commitPresentationTrack = useCallback((
    nextAudioTrack: AudioTrackRef,
    durationMs?: number | null,
    commitArtwork = true,
  ) => {
    const nextTrack = audioTrackToTrack({
      ...nextAudioTrack,
      durationMs: durationMs ?? nextAudioTrack.durationMs,
    })
    presentationTrackRef.current = nextTrack
    setPresentationTrack(nextTrack)
    if (commitArtwork) {
      const nextArtwork = {
        id: nextTrack.id,
        coverTone: nextTrack.coverTone,
        coverImage: nextTrack.coverImage,
        coverImageFallback: nextTrack.coverImageFallback,
      }
      presentationArtworkRef.current = nextArtwork
      setPresentationArtwork(nextArtwork)
    }
    setContentState('track')
    return nextTrack
  }, [])

  const clearPresentationTrack = useCallback((nextContentState: Exclude<PlayerContentState, 'track'>) => {
    presentationTrackRef.current = null
    presentationArtworkRef.current = null
    setPresentationTrack(null)
    setPresentationArtwork(null)
    commitDetailsPending(false)
    setContentState(nextContentState)
  }, [commitDetailsPending])

  const beginTrackSelection = useCallback((
    targetTrackId: string | null,
    sourcePath: string | null,
    usesLoadAndPlay = false,
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
    selectionRequestIdRef.current = requestId
    pendingSelectionRef.current = {
      requestId,
      targetTrackId,
      sourcePath,
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
    setAudioError(null)
    setContentState('loading')
    commitDetailsPending(targetTrackId !== null)
    return requestId
  }, [commitDetailsPending])

  const selectionIsCurrent = useCallback((requestId: number, targetTrackId?: string) => {
    const pending = pendingSelectionRef.current
    return pending?.requestId === requestId
      && (targetTrackId === undefined || pending.targetTrackId === targetTrackId)
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

  const settleSelectionFailure = useCallback((requestId: number, error: AudioCommandError) => {
    if (!selectionIsCurrent(requestId)) return
    const pending = pendingSelectionRef.current
    pendingSelectionRef.current = null
    audioSelectionInProgressRef.current = false
    setSelectionPending(false)
    commitDetailsPending(false)
    if (
      !pending?.replacementStarted
      && pending?.previousPresentationTrack
      && latestAudioStateRef.current?.currentTrackId === pending.previousPresentationTrack.id
    ) {
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
        const restoreIsCurrent = () => (
          selectionRequestIdRef.current === requestId
          && pendingSelectionRef.current === null
          && latestAudioStateRef.current?.currentTrackId === restoredTrackId
        )
        const settleRestoredTrackFallback = () => {
          if (!restoreIsCurrent()) return
          const fallbackArtwork = {
            id: pending.previousPresentationTrack!.id,
            coverTone: pending.previousPresentationTrack!.coverTone,
            coverImage: undefined,
            coverImageFallback: undefined,
          }
          presentationArtworkRef.current = fallbackArtwork
          setPresentationArtwork(fallbackArtwork)
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
          hydratedAudioTrackCacheRef.current.set(restoredSourcePath, restoredAudioTrack)
          setTracks((previous) => upsertTrack(previous, restoredAudioTrack, restoredDuration))
          commitPresentationTrack(restoredAudioTrack, restoredDuration)
          commitDetailsPending(false)
        }

        commitDetailsPending(true)
        const cachedTrack = hydratedAudioTrackCacheRef.current.get(restoredSourcePath)
        if (cachedTrack) commitRestoredTrack(cachedTrack)
        else {
          void hydrateAudioTrack(restoredSourcePath)
            .then(commitRestoredTrack)
            .catch(settleRestoredTrackFallback)
        }
      } else {
        commitDetailsPending(false)
      }
    } else {
      clearPresentationTrack(error.code === 'USER_CANCELLED' ? 'empty' : 'error')
    }
    setAudioError(error)
  }, [clearPresentationTrack, commitDetailsPending, commitPresentationTrack, selectionIsCurrent])

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
      hydratedAudioTrackCacheRef.current.set(details.track.sourcePath, details.track)
      setTracks((previous) => upsertTrack(previous, details.track, currentDuration))
      commitPresentationTrack(details.track, currentDuration)
    } else {
      const currentTrack = presentationTrackRef.current
      if (currentTrack) {
        const fallbackArtwork = {
          id: currentTrack.id,
          coverTone: currentTrack.coverTone,
          coverImage: currentTrack.coverImage,
          coverImageFallback: currentTrack.coverImageFallback,
        }
        presentationArtworkRef.current = fallbackArtwork
        setPresentationArtwork(fallbackArtwork)
      }
      setContentState('track')
      toast.error(`歌曲详情加载失败：${details.error.message}`)
    }
    if (pendingSelection.commandConfirmed) pendingSelectionRef.current = null
  }, [commitDetailsPending, commitPresentationTrack, selectionTransactionIsCurrent])

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

  const requestHydratedAudioTrack = useCallback((sourcePath: string) => {
    const cached = hydratedAudioTrackCacheRef.current.get(sourcePath)
    if (cached) return Promise.resolve(cached)

    const inFlight = hydrationInFlightRef.current.get(sourcePath)
    if (inFlight) return inFlight

    const request = hydrateAudioTrack(sourcePath)
      .then((hydratedTrack) => {
        hydratedAudioTrackCacheRef.current.set(sourcePath, hydratedTrack)
        return hydratedTrack
      })
      .finally(() => hydrationInFlightRef.current.delete(sourcePath))

    hydrationInFlightRef.current.set(sourcePath, request)
    return request
  }, [])

  const prefetchNextPlaylistTrack = useCallback((trackId: string) => {
    const playlist = folderPlaylistRef.current
    if (!playlist?.tracks.length) return

    const currentIndex = playlist.tracks.findIndex((candidate) => candidate.id === trackId)
    if (currentIndex < 0) return
    const nextTrack = playlist.tracks.slice(currentIndex + 1).find((candidate) => candidate.available)
    if (!nextTrack || hydratedAudioTrackCacheRef.current.has(nextTrack.sourcePath)) return

    void requestHydratedAudioTrack(nextTrack.sourcePath).catch((error: unknown) => {
      console.debug('Audio metadata prefetch failed', error)
    })
  }, [requestHydratedAudioTrack])

  const hydrateCurrentAudioTrack = useCallback((trackId: string) => {
    if (audioTrackRef.current?.id === trackId || audioTrackRequestTrackIdRef.current === trackId) return

    const requestId = audioTrackRequestIdRef.current + 1
    audioTrackRequestIdRef.current = requestId
    audioTrackRequestTrackIdRef.current = trackId

    void getCurrentAudioTrack()
      .then((nextAudioTrack) => {
        const latestAudioState = latestAudioStateRef.current
        if (
          audioTrackRequestIdRef.current !== requestId
          || nextAudioTrack?.id !== trackId
          || latestAudioState?.currentTrackId !== trackId
        ) return

        audioTrackRef.current = nextAudioTrack
        setAudioTrack(nextAudioTrack)
        setTracks((previous) => upsertTrack(previous, nextAudioTrack, latestAudioState.durationMs))
        if (!pendingSelectionRef.current) {
          commitPresentationTrack(nextAudioTrack, latestAudioState.durationMs)
        }
      })
      .catch((error: unknown) => {
        if (audioTrackRequestIdRef.current === requestId) {
          setAudioError(commandError(error))
          if (!pendingSelectionRef.current && latestAudioStateRef.current?.currentTrackId === trackId) {
            clearPresentationTrack('error')
          }
        }
      })
      .finally(() => {
        if (audioTrackRequestIdRef.current === requestId) audioTrackRequestTrackIdRef.current = null
      })
  }, [clearPresentationTrack, commitPresentationTrack])

  const applyAudioState = useCallback((
    nextAudioState: AudioPlaybackState,
    settleTransportIntent = false,
    acceptSeekPosition = false,
    fromEvent = false,
  ) => {
    const pendingSelection = pendingSelectionRef.current
    if (fromEvent) {
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
    const isConflictingTransportState = transportIntent !== null
      && (nextAudioState.phase === 'playing' || nextAudioState.phase === 'paused')
      && nextAudioState.phase !== transportIntent
    if (!settleTransportIntent && isConflictingTransportState) return

    const previousTrackId = latestAudioStateRef.current?.currentTrackId ?? null
    const previousPhase = latestAudioStateRef.current?.phase
    const nextTrackId = nextAudioState.currentTrackId
    if (previousTrackId !== nextTrackId) {
      seekRequestIdRef.current += 1
      audioStateRequestGenerationRef.current += 1
      timelineInteractionRef.current = 'following'
      setTimelineInteraction('following')
      seekTargetGuardRef.current = null
    }

    latestAudioStateRef.current = nextAudioState
    setAudioState(nextAudioState)
    setAudioError(nextAudioState.error)

    const guard = seekTargetGuardRef.current
    const now = window.performance.now()
    const guardedOldPosition = !acceptSeekPosition
      && guard?.trackId === nextTrackId
      && now < guard.expiresAt
      && Math.abs(nextAudioState.positionMs - guard.positionMs) > 120
    if (acceptSeekPosition || (timelineInteractionRef.current === 'following' && !guardedOldPosition)) {
      const backendPositionSeconds = Math.max(0, nextAudioState.positionMs / 1000)
      const isNormalPlayingCalibration = !settleTransportIntent
        && transportIntentRef.current === null
        && previousTrackId === nextTrackId
        && previousPhase === 'playing'
        && nextAudioState.phase === 'playing'
      const positionSeconds = isNormalPlayingCalibration
        ? Math.max(backendPositionSeconds, timelinePositionRef.current)
        : backendPositionSeconds
      timelineAnchorRef.current = { positionSeconds, at: now, trackId: nextTrackId }
      timelinePositionRef.current = positionSeconds
      setTimelinePosition(positionSeconds)
    }

    const pendingOwnsLoadedTrack = pendingSelection?.loadedTrackId !== null
      && pendingSelection?.loadedTrackId === audioTrackRef.current?.id
    if (!nextAudioState.currentTrackId && !pendingOwnsLoadedTrack) {
      audioTrackRef.current = null
      setAudioTrack(null)
    } else if (audioTrackRef.current?.id === nextAudioState.currentTrackId) {
      const loadedTrack = audioTrackRef.current
      setTracks((previous) => upsertTrack(previous, loadedTrack, nextAudioState.durationMs))
    }

    if (nextTrackId) {
      const mayCommitTrack = !pendingSelection || pendingSelection.targetTrackId === nextTrackId
      if (mayCommitTrack && audioTrackRef.current?.id === nextTrackId) {
        const preserveArtwork = pendingSelection?.usesLoadAndPlay
          && !pendingSelection.detailsSettled
          && pendingSelection.targetTrackId === nextTrackId
        commitPresentationTrack(audioTrackRef.current, nextAudioState.durationMs, !preserveArtwork)
      } else if (!presentationTrackRef.current) {
        setContentState('loading')
      }
    } else if (nextAudioState.phase === 'loading') {
      setContentState('loading')
    } else {
      clearPresentationTrack(nextAudioState.phase === 'error' || nextAudioState.error ? 'error' : 'empty')
    }

    if (!volumeCommandRunningRef.current && desiredVolumeRef.current === null) {
      const confirmedVolume = volumeScalarToPercent(nextAudioState.volume)
      confirmedVolumeRef.current = confirmedVolume
      setVolume(confirmedVolume)
    }

    if (
      nextAudioState.currentTrackId
      && audioTrackRef.current?.id !== nextAudioState.currentTrackId
      && !audioSelectionInProgressRef.current
    ) hydrateCurrentAudioTrack(nextAudioState.currentTrackId)
  }, [clearPresentationTrack, commitPresentationTrack, hydrateCurrentAudioTrack])

  const loadFolderAudioTrack = useCallback(async (
    folderTrack: AudioFolderTrackRef,
    autoplay: boolean,
    legacyInitialSelection = false,
  ) => {
    if (
      transportCommandRunningRef.current
      || timelineInteractionRef.current === 'seeking'
    ) return false

    if (!folderTrack.available) {
      const missingError = missingPlaylistTrackError(folderTrack.fileName)
      setAudioError(missingError)
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
    )
    const placeholderAudioTrack = audioFolderTrackPlaceholder(folderTrack)
    audioTrackRequestIdRef.current += 1
    audioTrackRequestTrackIdRef.current = null
    audioTrackRef.current = placeholderAudioTrack
    setAudioTrack(placeholderAudioTrack)
    setTracks((previous) => upsertTrack(previous, placeholderAudioTrack))
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
        setTracks((previous) => upsertTrack(previous, nextAudioTrack))
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
        prefetchNextPlaylistTrack(nextAudioTrack.id)
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
      prefetchNextPlaylistTrack(result.trackId)
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
    commitPresentationTrack,
    commitDetailsPending,
    ensureTrackDetailsListener,
    prefetchNextPlaylistTrack,
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
  ) => {
    if (!playlist.tracks.length) return false

    const step = direction < 0 ? -1 : 1
    let index = Math.min(Math.max(startIndex, 0), playlist.tracks.length - 1)
    for (let attempts = 0; attempts < playlist.tracks.length; attempts += 1) {
      const target = playlist.tracks[index]
      if (!target) return false
      if (!target.available && playlist.sourceKind === 'm3u8' && skipMissing) {
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
      if (await loadFolderAudioTrack(target, autoplay, legacyInitialSelection)) return true
      if (selectionRequestIdRef.current !== expectedSelectionRequestId) return false
      if (playlist.sourceKind !== 'm3u8' || !skipMissing) return false

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

  const loadFolderPlaylistSelection = useCallback(async (
    playlist: AudioFolderPlaylist,
    autoplay: boolean,
    ownerRequestId?: number,
  ) => {
    folderPlaylistRef.current = playlist
    setFolderPlaylist(playlist)
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
        setAudioError(noPlayableTrackError)
      }
      return
    }

    if (ownerRequestId !== undefined && selectionIsCurrent(ownerRequestId)) {
      pendingSelectionRef.current = null
      audioSelectionInProgressRef.current = false
      setSelectionPending(false)
      setAudioBusy(false)
    }
    setQueueOpen(true)
    await loadPlaylistTrackOrSkip(playlist, playlist.selectedIndex, autoplay, 1, false, true, true)
  }, [clearPresentationTrack, loadPlaylistTrackOrSkip, selectionIsCurrent, settleSelectionFailure])

  const changeFolderTrack = useCallback(async (direction: Direction, automatic = false) => {
    const playlist = folderPlaylistRef.current
    if (!playlist?.tracks.length) return

    const activeTrackId = latestAudioStateRef.current?.currentTrackId ?? audioTrackRef.current?.id
    const currentIndex = Math.max(0, playlist.tracks.findIndex((candidate) => candidate.id === activeTrackId))
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
    await loadPlaylistTrackOrSkip(playlist, targetIndex, autoplay, direction, allowMissingSkipWrap)
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
    setAudioError(null)
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
      setAudioError(commandError(error))
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

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenAudioStateChanged((state) => applyAudioState(state, false, false, true))
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch((error: unknown) => setAudioError(commandError(error)))

    const initialStateRequestGeneration = audioStateRequestGenerationRef.current
    void getAudioState()
      .then((nextAudioState) => {
        if (!disposed && initialStateRequestGeneration === audioStateRequestGenerationRef.current) {
          applyAudioState(nextAudioState)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) setAudioError(commandError(error))
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyAudioState])

  useEffect(() => {
    trackDetailsHandlerRef.current = applyTrackDetails
  }, [applyTrackDetails])

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
          if (requestGeneration === audioStateRequestGenerationRef.current) setAudioError(commandError(error))
        })
    }, 500)
    return () => window.clearInterval(intervalId)
  }, [applyAudioState, audioState?.phase, timelineInteraction])

  useEffect(() => {
    if (audioState?.phase !== 'playing' || timelineInteraction !== 'following') return

    let frameId = 0
    const updateVisualClock = (now: number) => {
      const anchor = timelineAnchorRef.current
      const currentState = latestAudioStateRef.current
      if (currentState?.phase !== 'playing' || anchor.trackId !== currentState.currentTrackId) return

      const durationSeconds = currentState.durationMs != null
        ? currentState.durationMs / 1000
        : Number.POSITIVE_INFINITY
      const positionSeconds = Math.min(
        anchor.positionSeconds + Math.max(0, now - anchor.at) / 1000,
        durationSeconds,
      )
      timelinePositionRef.current = positionSeconds
      setTimelinePosition(positionSeconds)
      frameId = window.requestAnimationFrame(updateVisualClock)
    }

    frameId = window.requestAnimationFrame(updateVisualClock)
    return () => window.cancelAnimationFrame(frameId)
  }, [audioState?.phase, timelineInteraction])

  async function openAndMaybePlay(autoplay: boolean) {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
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
      pendingSelectionRef.current = {
        requestId: selectionRequestId,
        targetTrackId: nextAudioTrack.id,
        sourcePath: nextAudioTrack.sourcePath,
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
      setTracks((previous) => upsertTrack(previous, nextAudioTrack))

      const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
      if (!selectionIsCurrent(selectionRequestId, nextAudioTrack.id)) return
      if (confirmedAudioState.currentTrackId !== nextAudioTrack.id) {
        const mismatchError = commandError(new Error('Audio selection target mismatch'))
        applyAudioState(confirmedAudioState)
        pendingSelectionRef.current = null
        clearPresentationTrack('error')
        setAudioError(mismatchError)
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
      folderPlaylistRef.current = nextFolderPlaylist
      setFolderPlaylist(nextFolderPlaylist)
      prefetchNextPlaylistTrack(nextAudioTrack.id)
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
    setTimelinePosition(clampedProgress)
    seekTargetGuardRef.current = {
      trackId: requestTrackId,
      positionMs,
      expiresAt: window.performance.now() + 900,
    }
    setAudioError(null)
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
        ) setAudioError(commandError(error))
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
          setTimelinePosition(guardedPosition)
        }
      })
  }

  function startProgressPreview() {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
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
      || transportCommandRunningRef.current
      || !track
      || duration <= 0
      || timelineInteractionRef.current === 'seeking'
    ) return
    if (timelineInteractionRef.current !== 'previewing') startProgressPreview()
    const clampedProgress = Math.min(Math.max(nextProgress, 0), duration)
    timelinePositionRef.current = clampedProgress
    setTimelinePosition(clampedProgress)
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
    setTimelinePosition(clampedPosition)
  }

  function commitProgress(nextProgress: number) {
    endingTrackRef.current = null
    if (
      !audioSelectionInProgressRef.current
      && !transportCommandRunningRef.current
      && track
      && duration > 0
    ) requestRealAudioSeek(nextProgress)
  }

  function togglePlayback() {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
      || timelineInteractionRef.current === 'seeking'
    ) return
    if (!track || !currentTrackId) {
      void openAndMaybePlay(true)
      return
    }

    const targetPhase: TransportIntentPhase = playing ? 'paused' : 'playing'
    queueTransportRequest({
      phase: targetPhase,
      restart: targetPhase === 'playing' && duration > 0 && progress >= duration,
    })
  }

  function toggleTrackFeedback(trackId: string, feedback: TrackFeedback) {
    setFeedbackByTrackId((previous) => {
      if (previous[trackId] !== feedback) return { ...previous, [trackId]: feedback }
      const next = { ...previous }
      delete next[trackId]
      return next
    })
  }

  function changeVolume(nextVolume: number) {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
      || timelineInteractionRef.current === 'seeking'
    ) return
    const safeVolume = Math.min(100, Math.max(0, Math.round(nextVolume)))
    setVolume(safeVolume)
    desiredVolumeRef.current = volumePercentToScalar(safeVolume)
    setAudioError(null)
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
      setAudioError(commandError(error))
    } finally {
      volumeCommandRunningRef.current = false
      setVolumeBusy(false)
    }
  }

  function selectQueueTrack(trackId: string) {
    if (
      transportCommandRunningRef.current
      || timelineInteractionRef.current === 'seeking'
      || !folderPlaylist
    ) return
    const targetIndex = folderPlaylist.tracks.findIndex((candidate) => candidate.id === trackId)
    if (targetIndex >= 0) void loadPlaylistTrackOrSkip(folderPlaylist, targetIndex, true, 1, false, false)
  }

  function refreshAudioState() {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
      || timelineInteractionRef.current === 'seeking'
    ) return
    const requestGeneration = audioStateRequestGenerationRef.current
    void getAudioState()
      .then((nextAudioState) => {
        if (requestGeneration === audioStateRequestGenerationRef.current) applyAudioState(nextAudioState)
      })
      .catch((error: unknown) => {
        if (requestGeneration === audioStateRequestGenerationRef.current) setAudioError(commandError(error))
      })
  }

  function stopAudioPlayback() {
    if (
      audioSelectionInProgressRef.current
      || transportCommandRunningRef.current
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
        if (requestGeneration === audioStateRequestGenerationRef.current) setAudioError(commandError(error))
      })
      .finally(() => {
        if (requestGeneration !== audioStateRequestGenerationRef.current) return
        transportCommandRunningRef.current = false
        setTransportBusy(false)
      })
  }

  return {
    track,
    artwork: presentationArtwork,
    detailsPending,
    contentState,
    queueTracks,
    unavailableTrackIds,
    playlistName: folderPlaylist ? playlistDisplayName(folderPlaylist) : undefined,
    currentFeedback: track ? feedbackByTrackId[track.id] : undefined,
    shuffleMode,
    repeatMode,
    queueOpen,
    playing,
    progress,
    duration,
    timelineInteraction,
    volume,
    volumeBusy,
    volumeDisabled: audioBusy || selectionPending || transportBusy || volumeBusy || timelineInteraction === 'seeking',
    audioBusy,
    selectionPending,
    statusText,
    transportBusy,
    audioState,
    currentAudioTrack,
    startProgressPreview,
    setProgress,
    commitProgress,
    cancelProgressPreview,
    openAudio: () => void openAndMaybePlay(false),
    openAudioAndPlay: () => void openAndMaybePlay(true),
    previous: () => void changeFolderTrack(-1),
    next: () => void changeFolderTrack(1),
    togglePlayback,
    cycleShuffleMode: () => setShuffleMode((value) => nextShuffleMode[value]),
    cycleRepeatMode: () => setRepeatMode((value) => nextRepeatMode[value]),
    toggleTrackFeedback,
    changeVolume,
    toggleQueue: () => setQueueOpen((value) => !value),
    selectQueueTrack,
    refreshAudioState,
    stopAudioPlayback,
  }
}
