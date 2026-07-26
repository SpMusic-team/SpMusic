import '@/features/player/styles/player.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlDock } from '@/features/player/components/ControlDock'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { TemporaryAudioControlBar } from '@/features/player/components/TemporaryAudioControlBar'
import { WindowBar } from '@/features/player/components/WindowBar'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import { nextRepeatMode, nextShuffleMode, resolveNextTrackIndex, type Direction, type RepeatMode, type ShuffleMode } from '@/features/player/model/playbackModes'
import { splitLyricTranslation } from '@/features/player/model/lyrics'
import { appCopy } from '@/features/player/model/playerCopy'
import { initialPlayerState } from '@/features/player/model/playerState'
import type { DemoLyricLine, PlayerState, Track } from '@/features/player/model/playerTypes'
import {
  getAudioState,
  getCurrentAudioTrack,
  isAudioCommandError,
  listenAudioStateChanged,
  openAudioFile,
  pauseAudio,
  playAudio,
  seekAudio,
  stopAudio,
  type AudioCommandError,
  type AudioPlaybackState,
  type AudioTrackRef,
} from '@/features/player/services/audioCommands'
import { resolveTrack } from '@/features/player/model/trackUtils'

type ProgressStyle = CSSProperties & { '--progress-percent': string }
type PlayerBackgroundStyle = CSSProperties & { '--player-background-art'?: string }
type CoverStyle = CSSProperties & { '--cover-art'?: string }
type TrackFeedback = 'liked' | 'disliked'
type TransportIntentPhase = 'playing' | 'paused'
type TransportRequest = {
  phase: TransportIntentPhase
  restart: boolean
}

function nonEmptyText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || fileName
}

function parseLyricTimestamp(timestamp: string): number {
  const [minutes = '0', seconds = '0'] = timestamp.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

function metadataLyricsToLines(track: AudioTrackRef, durationSeconds: number): DemoLyricLine[] {
  const lyrics = nonEmptyText(track.metadata.lyrics)
  if (!lyrics) return []

  const rawLines = lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!rawLines.length) return []

  const timedLines = rawLines.flatMap((line, lineIndex) => {
    const matches = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g)]
    const text = line.replace(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g, '').trim()

    if (!matches.length || !text) return []

    return matches.map((match, matchIndex) => {
      const lyricText = splitLyricTranslation(text)
      return {
        id: `${track.id}-lyric-${lineIndex}-${matchIndex}`,
        timeSeconds: parseLyricTimestamp(match[1]),
        ...lyricText,
      }
    })
  })

  if (timedLines.length) {
    return timedLines.sort((left, right) => left.timeSeconds - right.timeSeconds)
  }

  const step = durationSeconds > 0 ? durationSeconds / rawLines.length : 0
  return rawLines.map((line, index) => {
    const lyricText = splitLyricTranslation(line)
    return {
      id: `${track.id}-lyric-${index}`,
      timeSeconds: Math.max(0, index * step),
      ...lyricText,
    }
  })
}

function audioTrackToTrack(track: AudioTrackRef): Track {
  const durationSeconds = track.durationMs ? track.durationMs / 1000 : 0
  const title = nonEmptyText(track.metadata.title) ?? fileNameTitle(track.fileName)
  const artist = nonEmptyText(track.metadata.artist) ?? nonEmptyText(track.metadata.albumArtist) ?? '本地音频'
  const album = nonEmptyText(track.metadata.album) ?? '本地音频'

  return {
    id: track.id,
    title,
    artist,
    album,
    category: 'local-audio',
    durationSeconds,
    coverTone: 'blue',
    coverImage: track.metadata.coverArt?.dataUrl,
    lyrics: metadataLyricsToLines(track, durationSeconds),
  }
}

function upsertAudioTrack(state: PlayerState, track: AudioTrackRef, playbackState?: AudioPlaybackState): PlayerState {
  const localTrack = audioTrackToTrack({
    ...track,
    durationMs: playbackState?.durationMs ?? track.durationMs,
  })
  const tracks = state.tracks.some((item) => item.id === localTrack.id)
    ? state.tracks.map((item) => item.id === localTrack.id ? localTrack : item)
    : [localTrack, ...state.tracks]

  return {
    ...state,
    tracks,
    currentTrackId: localTrack.id,
    playbackStatus: playbackState?.phase === 'playing' ? 'playing' : 'paused',
    progressSeconds: playbackState ? playbackState.positionMs / 1000 : 0,
  }
}

function syncPlaybackState(
  state: PlayerState,
  playbackState: AudioPlaybackState,
  audioTrack: AudioTrackRef | null,
): PlayerState {
  const trackId = playbackState.currentTrackId
  const playbackStatus = playbackState.phase === 'playing' ? 'playing' : 'paused'
  const progressSeconds = playbackState.positionMs / 1000

  if (!trackId || audioTrack?.id !== trackId) {
    return {
      ...state,
      playbackStatus,
      progressSeconds,
    }
  }

  const existingTrack = state.tracks.find((item) => item.id === trackId)
  if (!existingTrack) return upsertAudioTrack(state, audioTrack, playbackState)

  const durationSeconds = playbackState.durationMs != null
    ? playbackState.durationMs / 1000
    : existingTrack.durationSeconds
  const tracks = durationSeconds === existingTrack.durationSeconds
    ? state.tracks
    : state.tracks.map((item) => item.id === trackId ? { ...item, durationSeconds } : item)

  return {
    ...state,
    tracks,
    currentTrackId: trackId,
    playbackStatus,
    progressSeconds,
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
    case 'loading':
      return appCopy.audio.loading
    case 'ready':
      return appCopy.audio.ready(fileName)
    case 'playing':
      return appCopy.audio.playing(fileName)
    case 'paused':
      return appCopy.audio.paused(fileName)
    case 'stopped':
      return appCopy.audio.stopped(fileName)
    case 'ended':
      return appCopy.audio.ended(fileName)
    case 'error':
      return appCopy.audio.unavailable
    case 'idle':
    default:
      return appCopy.audio.idle
  }
}

export function PlayerShell() {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [state, setState] = useState<PlayerState>(initialPlayerState)
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [showTranslations, setShowTranslations] = useState(false)
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [audioState, setAudioState] = useState<AudioPlaybackState | null>(null)
  const [audioTrack, setAudioTrack] = useState<AudioTrackRef | null>(null)
  const [audioError, setAudioError] = useState<AudioCommandError | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [transportBusy, setTransportBusy] = useState(false)
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null)
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const lastFrameTimeRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const seekRequestIdRef = useRef(0)
  const lastSeekCommitRef = useRef<{ positionMs: number; at: number } | null>(null)
  const audioStateRequestGenerationRef = useRef(0)
  const transportIntentRef = useRef<TransportIntentPhase | null>(null)
  const desiredTransportRequestRef = useRef<TransportRequest | null>(null)
  const transportCommandRunningRef = useRef(false)
  const transportRollbackStateRef = useRef<AudioPlaybackState | null>(null)
  const audioTrackRef = useRef<AudioTrackRef | null>(null)
  const audioTrackRequestIdRef = useRef(0)
  const audioTrackRequestTrackIdRef = useRef<string | null>(null)
  const audioSelectionInProgressRef = useRef(false)
  const latestAudioStateRef = useRef<AudioPlaybackState | null>(null)
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const realAudioTrackId = audioState?.currentTrackId ?? null
  const currentAudioTrack = audioTrack?.id === realAudioTrackId ? audioTrack : null
  const hasRealAudioTrack = Boolean(currentAudioTrack)
  const realAudioPlaying = audioState?.phase === 'playing'
  const usingRealAudio = Boolean(track && realAudioTrackId && track.id === realAudioTrackId)
  const playing = usingRealAudio ? audioState?.phase === 'playing' : state.playbackStatus === 'playing'
  const realAudioDuration = audioState?.durationMs != null ? audioState.durationMs / 1000 : track?.durationSeconds ?? 0
  const duration = usingRealAudio ? realAudioDuration : track?.durationSeconds ?? 0
  const backendProgress = usingRealAudio ? (audioState?.positionMs ?? 0) / 1000 : state.progressSeconds
  const progress = Math.min(Math.max(seekPreviewSeconds ?? backendProgress, 0), duration)
  const activeLyric = track?.lyrics.reduce((active, line) => line.timeSeconds <= progress ? line : active, track.lyrics[0])
  const activeLyricId = activeLyric?.id
  const activeLyricIndex = track?.lyrics.findIndex((line) => line.id === activeLyricId) ?? -1
  const progressStyle: ProgressStyle = { '--progress-percent': `${duration ? progress / duration * 100 : 0}%` }
  const realAudioStatusText = audioStatusText(audioState, audioError, currentAudioTrack)
  const temporaryAudioFileName = currentAudioTrack?.fileName ?? null
  const temporaryAudioTitle = currentAudioTrack
    ? nonEmptyText(currentAudioTrack.metadata.title) ?? fileNameTitle(currentAudioTrack.fileName)
    : null
  const temporaryAudioDuration = audioState?.durationMs != null ? audioState.durationMs / 1000 : 0
  const temporaryAudioBackendProgress = (audioState?.positionMs ?? 0) / 1000
  const temporaryAudioProgress = Math.min(
    Math.max(seekPreviewSeconds ?? temporaryAudioBackendProgress, 0),
    temporaryAudioDuration,
  )
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined

  useActiveLyricScroll(activeLyricId, lyricListRef, lyricRefs)

  const hydrateCurrentAudioTrack = useCallback((trackId: string) => {
    if (
      audioTrackRef.current?.id === trackId
      || audioTrackRequestTrackIdRef.current === trackId
    ) {
      return
    }

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
        ) {
          return
        }

        audioTrackRef.current = nextAudioTrack
        setAudioTrack(nextAudioTrack)
        setState((previous) => upsertAudioTrack(previous, nextAudioTrack, latestAudioState))
      })
      .catch((error: unknown) => {
        if (audioTrackRequestIdRef.current !== requestId) return
        setAudioError(isAudioCommandError(error) ? error : {
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      })
      .finally(() => {
        if (audioTrackRequestIdRef.current === requestId) {
          audioTrackRequestTrackIdRef.current = null
        }
      })
  }, [])

  const applyAudioState = useCallback((nextAudioState: AudioPlaybackState, settleTransportIntent = false) => {
    const transportIntent = transportIntentRef.current
    const isConflictingTransportState = transportIntent !== null
      && (nextAudioState.phase === 'playing' || nextAudioState.phase === 'paused')
      && nextAudioState.phase !== transportIntent

    if (!settleTransportIntent && isConflictingTransportState) return

    latestAudioStateRef.current = nextAudioState
    setAudioState(nextAudioState)
    setAudioError(nextAudioState.error)
    setState((previous) => syncPlaybackState(previous, nextAudioState, audioTrackRef.current))

    if (
      nextAudioState.currentTrackId
      && audioTrackRef.current?.id !== nextAudioState.currentTrackId
      && !audioSelectionInProgressRef.current
    ) {
      hydrateCurrentAudioTrack(nextAudioState.currentTrackId)
    }
  }, [hydrateCurrentAudioTrack])

  function applyOptimisticTransportPhase(phase: TransportIntentPhase) {
    transportIntentRef.current = phase
    audioStateRequestGenerationRef.current += 1
    setAudioState((previous) => {
      if (!previous) return previous
      const optimisticState = { ...previous, phase, error: null }
      latestAudioStateRef.current = optimisticState
      return optimisticState
    })
    setAudioError(null)
    setState((previous) => ({ ...previous, playbackStatus: phase }))
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
        if (queuedRequest?.phase === nextState.phase) {
          desiredTransportRequestRef.current = null
        }

        if (!desiredTransportRequestRef.current) {
          applyAudioState(nextState, true)
        }
      }
    } catch (error) {
      desiredTransportRequestRef.current = null
      if (lastConfirmedState) applyAudioState(lastConfirmedState, true)
      setAudioError(isAudioCommandError(error) ? error : {
        code: 'INTERNAL_ERROR',
        message: appCopy.audio.unavailable,
        recoverable: true,
      })
    } finally {
      transportIntentRef.current = null
      transportRollbackStateRef.current = null
      transportCommandRunningRef.current = false
      setTransportBusy(false)
    }
  }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenAudioStateChanged((nextAudioState) => {
      applyAudioState(nextAudioState)
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten()
          return
        }

        unlisten = nextUnlisten
      })
      .catch((error: unknown) => {
        setAudioError(isAudioCommandError(error) ? error : {
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      })

    void getAudioState()
      .then((nextAudioState) => {
        if (!disposed) applyAudioState(nextAudioState)
      })
      .catch((error: unknown) => {
        if (disposed) return
        setAudioError(isAudioCommandError(error) ? error : {
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyAudioState])

  const changeTrack = useCallback((direction: Direction, automatic = false) => {
    endingTrackRef.current = null
    setState((previous) => {
      if (!previous.tracks.length) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
      const currentIndex = Math.max(0, previous.tracks.findIndex((item) => item.id === previous.currentTrackId))
      const currentTrack = previous.tracks[currentIndex] ?? previous.tracks[0]

      if (automatic && repeatMode === 'repeat-one') return { ...previous, playbackStatus: 'playing', progressSeconds: 0 }
      if (automatic && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop') && currentIndex >= previous.tracks.length - 1) {
        return { ...previous, playbackStatus: 'paused', progressSeconds: currentTrack.durationSeconds }
      }

      const nextIndex = resolveNextTrackIndex(previous.tracks, currentIndex, direction, shuffleMode)
      return { ...previous, currentTrackId: previous.tracks[nextIndex].id, playbackStatus: automatic ? 'playing' : previous.playbackStatus, progressSeconds: 0 }
    })
  }, [repeatMode, shuffleMode])

  useEffect(() => {
    if (!playing || !track || usingRealAudio) return

    let frameId = 0

    function step(timestamp: number) {
      const lastFrameTime = lastFrameTimeRef.current ?? timestamp
      const elapsedSeconds = (timestamp - lastFrameTime) / 1000

      lastFrameTimeRef.current = timestamp

      setState((previous) => {
        const current = resolveTrack(previous.tracks, previous.currentTrackId)
        if (!current) return { ...previous, playbackStatus: 'paused', progressSeconds: 0 }
        const nextProgress = previous.progressSeconds + elapsedSeconds

        if (nextProgress >= current.durationSeconds) {
          if (endingTrackRef.current !== current.id) {
            endingTrackRef.current = current.id
            window.setTimeout(() => {
              endingTrackRef.current = null
              changeTrack(1, true)
            }, 0)
          }

          return { ...previous, progressSeconds: current.durationSeconds }
        }

        return { ...previous, progressSeconds: nextProgress }
      })

      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)

    return () => {
      window.cancelAnimationFrame(frameId)
      lastFrameTimeRef.current = null
    }
  }, [changeTrack, playing, track, usingRealAudio])

  useEffect(() => {
    if (!usingRealAudio || audioState?.phase !== 'playing' || seekPreviewSeconds !== null) return

    const intervalId = window.setInterval(() => {
      const requestGeneration = audioStateRequestGenerationRef.current
      void getAudioState()
        .then((nextAudioState) => {
          if (requestGeneration !== audioStateRequestGenerationRef.current) return
          applyAudioState(nextAudioState)
        })
        .catch((error: unknown) => {
          if (requestGeneration !== audioStateRequestGenerationRef.current) return
          setAudioError(isAudioCommandError(error) ? error : {
            code: 'INTERNAL_ERROR',
            message: appCopy.audio.unavailable,
            recoverable: true,
          })
        })
    }, 500)

    return () => window.clearInterval(intervalId)
  }, [applyAudioState, audioState?.phase, seekPreviewSeconds, usingRealAudio])

  async function openAndMaybePlay(autoplay: boolean) {
    if (audioBusy) return

    setAudioBusy(true)
    setAudioError(null)
    audioSelectionInProgressRef.current = true

    try {
      const audioTrack = await openAudioFile()
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = audioTrack
      setAudioTrack(audioTrack)
      setState((previous) => upsertAudioTrack(previous, audioTrack))

      if (autoplay) {
        applyAudioState(await playAudio({ restart: true }))
      } else {
        applyAudioState(await getAudioState())
      }
    } catch (error) {
      if (isAudioCommandError(error)) {
        setAudioError(error)
      } else {
        setAudioError({
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      }
    } finally {
      audioSelectionInProgressRef.current = false
      setAudioBusy(false)
    }
  }

  function requestRealAudioSeek(nextProgress: number, targetDuration: number, targetBackendProgress: number) {
    const clampedProgress = Math.min(Math.max(nextProgress, 0), targetDuration)
    const positionMs = Math.round(clampedProgress * 1000)
    const now = window.performance.now()
    const previousCommit = lastSeekCommitRef.current

    if (previousCommit && previousCommit.positionMs === positionMs && now - previousCommit.at < 360) {
      return
    }

    lastSeekCommitRef.current = { positionMs, at: now }

    if (Math.abs(clampedProgress - targetBackendProgress) < 0.08) {
      setSeekPreviewSeconds(null)
      return
    }

    const requestId = seekRequestIdRef.current + 1
    seekRequestIdRef.current = requestId
    setSeekPreviewSeconds(clampedProgress)
    setAudioError(null)

    void seekAudio(positionMs)
      .then((nextAudioState) => {
        if (seekRequestIdRef.current === requestId) {
          applyAudioState(nextAudioState)
        }
      })
      .catch((error: unknown) => {
        setAudioError(isAudioCommandError(error) ? error : {
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      })
      .finally(() => {
        if (seekRequestIdRef.current === requestId) {
          setSeekPreviewSeconds(null)
        }
      })
  }

  function setProgress(nextProgress: number) {
    endingTrackRef.current = null

    if (usingRealAudio) {
      setSeekPreviewSeconds(nextProgress)
      return
    }

    setState((previous) => ({ ...previous, progressSeconds: nextProgress }))
  }

  function commitProgress(nextProgress: number) {
    endingTrackRef.current = null

    if (usingRealAudio) {
      requestRealAudioSeek(nextProgress, duration, backendProgress)
      return
    }

    setState((previous) => ({ ...previous, progressSeconds: nextProgress }))
  }

  function setTemporaryAudioProgress(nextProgress: number) {
    if (!hasRealAudioTrack) return

    endingTrackRef.current = null
    setSeekPreviewSeconds(nextProgress)
  }

  function commitTemporaryAudioProgress(nextProgress: number) {
    if (!hasRealAudioTrack) return

    endingTrackRef.current = null
    requestRealAudioSeek(nextProgress, temporaryAudioDuration, temporaryAudioBackendProgress)
  }

  function togglePlayback() {
    if (audioBusy) return

    if (!usingRealAudio) {
      void openAndMaybePlay(true)
      return
    }

    const targetPhase: TransportIntentPhase = playing ? 'paused' : 'playing'
    queueTransportRequest({
      phase: targetPhase,
      restart: targetPhase === 'playing' && duration > 0 && progress >= duration,
    })
  }

  function toggleRealAudioPlayback() {
    if (audioBusy) return

    if (!hasRealAudioTrack) {
      void openAndMaybePlay(true)
      return
    }

    const targetPhase: TransportIntentPhase = realAudioPlaying ? 'paused' : 'playing'
    queueTransportRequest({
      phase: targetPhase,
      restart: targetPhase === 'playing' && audioState?.phase === 'ended',
    })
  }

  async function stopRealAudioPlayback() {
    if (audioBusy || !hasRealAudioTrack) return

    setAudioBusy(true)
    setAudioError(null)

    try {
      applyAudioState(await stopAudio())
    } catch (error) {
      setAudioError(isAudioCommandError(error) ? error : {
        code: 'INTERNAL_ERROR',
        message: appCopy.audio.unavailable,
        recoverable: true,
      })
    } finally {
      setAudioBusy(false)
    }
  }

  async function refreshRealAudioState() {
    if (audioBusy) return

    setAudioBusy(true)
    setAudioError(null)

    try {
      applyAudioState(await getAudioState())
    } catch (error) {
      setAudioError(isAudioCommandError(error) ? error : {
        code: 'INTERNAL_ERROR',
        message: appCopy.audio.unavailable,
        recoverable: true,
      })
    } finally {
      setAudioBusy(false)
    }
  }

  function stopRealAudioBeforeDemoNavigation() {
    if (!usingRealAudio) return

    void stopAudio()
      .then(applyAudioState)
      .catch((error: unknown) => {
        setAudioError(isAudioCommandError(error) ? error : {
          code: 'INTERNAL_ERROR',
          message: appCopy.audio.unavailable,
          recoverable: true,
        })
      })
  }

  function cycleShuffleMode() {
    setShuffleMode((value) => nextShuffleMode[value])
  }

  function cycleRepeatMode() {
    setRepeatMode((value) => nextRepeatMode[value])
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
  }

  const currentFeedback = track ? feedbackByTrackId[track.id] : undefined
  const LikeIcon = currentFeedback === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = currentFeedback === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike
  const ShuffleIcon = shuffleMode === 'shuffle-all' ? systemIcons.shuffleOff : shuffleMode === 'shuffle-category-order' ? systemIcons.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? systemIcons.shuffleCategoryRandom : systemIcons.shuffle
  const shuffleLabel = shuffleMode === 'shuffle-all' ? appCopy.controls.shuffleOff : shuffleMode === 'shuffle-category-order' ? appCopy.controls.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? appCopy.controls.shuffleCategoryRandom : appCopy.controls.shuffle
  const RepeatIcon = repeatMode === 'repeat-one' ? systemIcons.repeatOne : repeatMode === 'sequential' ? systemIcons.sequential : repeatMode === 'all-categories-until-stop' ? systemIcons.playAllCategories : systemIcons.repeat
  const repeatLabel = repeatMode === 'repeat-one' ? appCopy.controls.repeatOne : repeatMode === 'sequential' ? appCopy.controls.sequential : repeatMode === 'all-categories-until-stop' ? appCopy.controls.playAllCategories : appCopy.controls.repeat
  const CaptionsIcon = showTranslations ? systemIcons.captionsSelected : systemIcons.captions
  const shuffleSelected = shuffleMode !== 'none'
  const repeatSelected = repeatMode !== 'list-loop'

  return (
    <TooltipProvider>
      <main className="player-shell" data-cover={track?.coverTone ?? 'empty'} aria-labelledby="app-title">
        <AnimatePresence initial={false}>
          {track ? (
            <motion.div
              key={track.id}
              className="ambient-cover"
              data-tone={track.coverTone}
              style={playerBackgroundStyle}
              variants={appearanceMotion.variants.backdrop}
              initial="initial"
              animate="animate"
              exit="exit"
              aria-hidden="true"
            />
          ) : null}
        </AnimatePresence>
        <WindowBar />
        <TemporaryAudioControlBar
          busy={audioBusy}
          duration={temporaryAudioDuration}
          fileName={temporaryAudioFileName}
          hasTrack={hasRealAudioTrack}
          phase={audioState?.phase ?? 'idle'}
          playing={realAudioPlaying}
          progress={temporaryAudioProgress}
          statusText={realAudioStatusText}
          title={temporaryAudioTitle}
          transportBusy={transportBusy}
          onOpen={() => void openAndMaybePlay(false)}
          onOpenAndPlay={() => void openAndMaybePlay(true)}
          onPlayToggle={() => void toggleRealAudioPlayback()}
          onProgressChange={setTemporaryAudioProgress}
          onProgressCommit={commitTemporaryAudioProgress}
          onRefresh={() => void refreshRealAudioState()}
          onStop={() => void stopRealAudioPlayback()}
        />

        {track ? (
          <section className="player-stage" aria-label={appCopy.shellLabel}>
            <AnimatePresence initial={false}>
              <CoverPanel
                key={track.id}
                track={track}
                coverStyle={coverStyle}
                likeIcon={LikeIcon}
                dislikeIcon={DislikeIcon}
                liked={currentFeedback === 'liked'}
                disliked={currentFeedback === 'disliked'}
                onLike={() => toggleTrackFeedback(track.id, 'liked')}
                onDislike={() => toggleTrackFeedback(track.id, 'disliked')}
              />
            </AnimatePresence>

            <LyricsPanel
              track={track}
              activeLyricId={activeLyricId}
              activeLyricIndex={activeLyricIndex}
              showTranslations={showTranslations}
              lyricListRef={lyricListRef}
              lyricRefs={lyricRefs}
            />

            <AnimatePresence initial={false}>
              {queueOpen ? <QueuePanel tracks={state.tracks} currentTrackId={track.id} /> : null}
            </AnimatePresence>
          </section>
        ) : <EmptyPlayerState />}

        <ControlDock
          progress={progress}
          duration={duration}
          progressStyle={progressStyle}
          disabled={!track}
          playing={playing}
          shuffleIcon={ShuffleIcon}
          shuffleLabel={shuffleLabel}
          shuffleSelected={shuffleSelected}
          repeatIcon={RepeatIcon}
          repeatLabel={repeatLabel}
          repeatSelected={repeatSelected}
          captionsIcon={CaptionsIcon}
          showTranslations={showTranslations}
          volume={volume}
          queueOpen={queueOpen}
          audioBusy={audioBusy}
          audioStatusText={realAudioStatusText}
          transportBusy={transportBusy}
          onProgressChange={setProgress}
          onProgressCommit={commitProgress}
          onOpenAudio={() => void openAndMaybePlay(false)}
          onPrevious={() => {
            stopRealAudioBeforeDemoNavigation()
            changeTrack(-1)
          }}
          onNext={() => {
            stopRealAudioBeforeDemoNavigation()
            changeTrack(1)
          }}
          onPlayToggle={togglePlayback}
          onShuffleCycle={cycleShuffleMode}
          onRepeatCycle={cycleRepeatMode}
          onCaptionsToggle={() => setShowTranslations((value) => !value)}
          onVolumeChange={changeVolume}
          onQueueToggle={() => setQueueOpen((value) => !value)}
        />
      </main>
    </TooltipProvider>
  )
}

export default PlayerShell
