import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
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
import type { PlayerTimelineInteraction } from '@/features/player/model/playerUiViewModel'
import type { Track, TrackFeedback } from '@/features/player/model/playerTypes'
import {
  getAudioState,
  getCurrentAudioTrack,
  hydrateAudioTrack,
  isAudioCommandError,
  listAudioFolderTracks,
  listenAudioStateChanged,
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
} from '@/features/player/services/audioCommands'

type TransportIntentPhase = 'playing' | 'paused'
type TransportRequest = { phase: TransportIntentPhase; restart: boolean }

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
  const [folderPlaylist, setFolderPlaylist] = useState<AudioFolderPlaylist | null>(null)
  const [audioError, setAudioError] = useState<AudioCommandError | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [autoplayInFlight, setAutoplayInFlight] = useState(false)
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
  const hydratedAudioTrackCacheRef = useRef(new Map<string, AudioTrackRef>())
  const hydrationInFlightRef = useRef(new Map<string, Promise<AudioTrackRef>>())
  const latestAudioStateRef = useRef<AudioPlaybackState | null>(null)
  const folderPlaylistRef = useRef<AudioFolderPlaylist | null>(null)

  const currentTrackId = audioState?.currentTrackId ?? null
  const track = useMemo(
    () => currentTrackId ? tracks.find((candidate) => candidate.id === currentTrackId) ?? null : null,
    [currentTrackId, tracks],
  )
  const currentAudioTrack = audioTrack?.id === currentTrackId ? audioTrack : null
  const playing = audioState?.phase === 'playing' || autoplayInFlight
  const duration = audioState?.durationMs != null ? audioState.durationMs / 1000 : track?.durationSeconds ?? 0
  const progress = Math.min(Math.max(timelinePosition, 0), duration)
  const statusText = audioStatusText(audioState, audioError, currentAudioTrack)
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
      })
      .catch((error: unknown) => {
        if (audioTrackRequestIdRef.current === requestId) setAudioError(commandError(error))
      })
      .finally(() => {
        if (audioTrackRequestIdRef.current === requestId) audioTrackRequestTrackIdRef.current = null
      })
  }, [])

  const applyAudioState = useCallback((
    nextAudioState: AudioPlaybackState,
    settleTransportIntent = false,
    acceptSeekPosition = false,
  ) => {
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

    if (!nextAudioState.currentTrackId) {
      audioTrackRef.current = null
      setAudioTrack(null)
    } else if (audioTrackRef.current?.id === nextAudioState.currentTrackId) {
      const loadedTrack = audioTrackRef.current
      setTracks((previous) => upsertTrack(previous, loadedTrack, nextAudioState.durationMs))
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
  }, [hydrateCurrentAudioTrack])

  const loadFolderAudioTrack = useCallback(async (folderTrack: AudioFolderTrackRef, autoplay: boolean) => {
    if (audioSelectionInProgressRef.current || transportCommandRunningRef.current) return false

    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    audioSelectionInProgressRef.current = true
    setAudioBusy(true)
    setAudioError(null)
    try {
      if (!folderTrack.available) {
        const missingError = missingPlaylistTrackError(folderTrack.fileName)
        setAudioError(missingError)
        toast.error(missingError.message)
        return false
      }

      setAutoplayInFlight(autoplay)
      const nextAudioTrack = await loadAudioFile(folderTrack.sourcePath)
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = nextAudioTrack
      setAudioTrack(nextAudioTrack)
      setTracks((previous) => upsertTrack(previous, nextAudioTrack))

      const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
      applyAudioState(confirmedAudioState)
      prefetchNextPlaylistTrack(nextAudioTrack.id)
      endingTrackRef.current = null
      return true
    } catch (error) {
      const nextError = commandError(error)
      setAudioError(nextError)
      if (nextError.code === 'FILE_NOT_FOUND') toast.error(missingPlaylistTrackError(folderTrack.fileName).message)
      return false
    } finally {
      setAutoplayInFlight(false)
      audioSelectionInProgressRef.current = false
      setAudioBusy(false)
    }
  }, [applyAudioState, prefetchNextPlaylistTrack])

  const loadPlaylistTrackOrSkip = useCallback(async (
    playlist: AudioFolderPlaylist,
    startIndex: number,
    autoplay: boolean,
    direction: Direction = 1,
    allowWrap = false,
    skipMissing = true,
  ) => {
    if (!playlist.tracks.length) return false

    const step = direction < 0 ? -1 : 1
    let index = Math.min(Math.max(startIndex, 0), playlist.tracks.length - 1)
    for (let attempts = 0; attempts < playlist.tracks.length; attempts += 1) {
      const target = playlist.tracks[index]
      if (!target) return false
      if (await loadFolderAudioTrack(target, autoplay)) return true
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

  const loadFolderPlaylistSelection = useCallback(async (playlist: AudioFolderPlaylist, autoplay: boolean) => {
    folderPlaylistRef.current = playlist
    setFolderPlaylist(playlist)
    const target = playlist.tracks[playlist.selectedIndex] ?? playlist.tracks[0]
    if (!target) {
      setAudioError({
        code: 'NO_TRACK_LOADED',
        message: '选择的文件夹没有可播放的本地音频。',
        recoverable: true,
      })
      return
    }

    setQueueOpen(true)
    await loadPlaylistTrackOrSkip(playlist, playlist.selectedIndex, autoplay, 1, false)
  }, [loadPlaylistTrackOrSkip])

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

    void listenAudioStateChanged(applyAudioState)
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch((error: unknown) => setAudioError(commandError(error)))

    void getAudioState()
      .then((nextAudioState) => {
        if (!disposed) applyAudioState(nextAudioState)
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
    if (audioBusy) return
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    setAudioBusy(true)
    setAudioError(null)
    audioSelectionInProgressRef.current = true

    try {
      const source = await openAudioSource()
      if (source.kind === 'playlist') {
        audioSelectionInProgressRef.current = false
        setAudioBusy(false)
        await loadFolderPlaylistSelection(source.playlist, autoplay)
        endingTrackRef.current = null
        return
      }

      const nextAudioTrack = source.track
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = nextAudioTrack
      setAudioTrack(nextAudioTrack)
      setTracks((previous) => upsertTrack(previous, nextAudioTrack))

      const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
      applyAudioState(confirmedAudioState)

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
      setAudioError(commandError(error))
    } finally {
      audioSelectionInProgressRef.current = false
      setAudioBusy(false)
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
    if (!track || duration <= 0 || timelineInteractionRef.current === 'seeking') return
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'previewing'
    setTimelineInteraction('previewing')
    seekTargetGuardRef.current = null
  }

  function setProgress(nextProgress: number) {
    if (!track || duration <= 0 || timelineInteractionRef.current === 'seeking') return
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
    if (track && duration > 0) requestRealAudioSeek(nextProgress)
  }

  function togglePlayback() {
    if (audioBusy) return
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
        const nextAudioState = await setAudioVolume(requestedVolume)
        lastConfirmedVolume = volumeScalarToPercent(nextAudioState.volume)
        confirmedVolumeRef.current = lastConfirmedVolume
        if (desiredVolumeRef.current === null) {
          setVolume(lastConfirmedVolume)
          applyAudioState(nextAudioState)
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
    if (!folderPlaylist) return
    const targetIndex = folderPlaylist.tracks.findIndex((candidate) => candidate.id === trackId)
    if (targetIndex >= 0) void loadPlaylistTrackOrSkip(folderPlaylist, targetIndex, true, 1, false, false)
  }

  function refreshAudioState() {
    void getAudioState().then(applyAudioState).catch((error: unknown) => setAudioError(commandError(error)))
  }

  function stopAudioPlayback() {
    seekRequestIdRef.current += 1
    audioStateRequestGenerationRef.current += 1
    timelineInteractionRef.current = 'following'
    setTimelineInteraction('following')
    seekTargetGuardRef.current = null
    void stopAudio().then(applyAudioState).catch((error: unknown) => setAudioError(commandError(error)))
  }

  return {
    track,
    queueTracks,
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
    volumeDisabled: audioBusy && audioState?.phase !== 'loading',
    audioBusy,
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
