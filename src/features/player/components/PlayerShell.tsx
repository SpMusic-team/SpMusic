import '@/features/player/styles/player.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
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
  audioCoverArtFallbackUrl,
  audioCoverArtUrl,
  type AudioCommandError,
  type AudioFolderPlaylist,
  type AudioFolderTrackRef,
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

function volumeScalarToPercent(volume: number): number {
  if (!Number.isFinite(volume)) return 100
  return Math.round(Math.min(1, Math.max(0, volume)) * 100)
}

function volumePercentToScalar(volume: number): number {
  if (!Number.isFinite(volume)) return 1
  return Math.round(Math.min(100, Math.max(0, volume))) / 100
}

function nonEmptyText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || fileName
}

function playlistDisplayName(playlist: AudioFolderPlaylist): string {
  return playlist.sourceKind === 'm3u8' ? playlist.sourceName : playlist.directoryName
}

function singleTrackFolderPlaylist(track: AudioTrackRef): AudioFolderPlaylist {
  const lastSeparator = Math.max(track.sourcePath.lastIndexOf('/'), track.sourcePath.lastIndexOf('\\'))
  const directoryPath = lastSeparator >= 0 ? track.sourcePath.slice(0, lastSeparator) : ''
  const directoryName = directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '当前文件夹'

  return {
    directoryPath,
    directoryName,
    sourceKind: 'folder',
    sourcePath: directoryPath,
    sourceName: directoryName,
    selectedIndex: 0,
    tracks: [{
      id: track.id,
      sourcePath: track.sourcePath,
      fileName: track.fileName,
      available: true,
    }],
  }
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
    coverImage: audioCoverArtUrl(track.metadata.coverArt),
    coverImageFallback: audioCoverArtFallbackUrl(track.metadata.coverArt),
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

function missingPlaylistTrackError(fileName: string): AudioCommandError {
  return {
    code: 'FILE_NOT_FOUND',
    message: `\u6b4c\u66f2\u672a\u627e\u5230\uff1a${fileName}`,
    recoverable: true,
  }
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
  const [desktopCaptionsEnabled, setDesktopCaptionsEnabled] = useState(false)
  const [temporaryControlBarEnabled, setTemporaryControlBarEnabled] = useState(true)
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [audioState, setAudioState] = useState<AudioPlaybackState | null>(null)
  const [audioTrack, setAudioTrack] = useState<AudioTrackRef | null>(null)
  const [folderPlaylist, setFolderPlaylist] = useState<AudioFolderPlaylist | null>(null)
  const [audioError, setAudioError] = useState<AudioCommandError | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [transportBusy, setTransportBusy] = useState(false)
  const [volumeBusy, setVolumeBusy] = useState(false)
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
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const realAudioTrackId = audioState?.currentTrackId ?? null
  // Reserved for a future Tauri-backed desktop captions capability.
  const desktopCaptionsAvailable = false
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
  const queueTracks = useMemo(() => {
    if (!folderPlaylist) return state.tracks
    const sourceName = playlistDisplayName(folderPlaylist)

    return folderPlaylist.tracks.map((folderTrack) => {
      const loadedTrack = state.tracks.find((candidate) => candidate.id === folderTrack.id)
      if (loadedTrack) return loadedTrack

      return {
        id: folderTrack.id,
        title: fileNameTitle(folderTrack.fileName),
        artist: folderTrack.available ? sourceName : `${sourceName} · \u6b4c\u66f2\u672a\u627e\u5230`,
        album: sourceName,
        category: 'local-audio',
        durationSeconds: 0,
        coverTone: 'blue',
        lyrics: [],
      } satisfies Track
    })
  }, [folderPlaylist, state.tracks])

  useActiveLyricScroll(activeLyricId, lyricListRef, lyricRefs)

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
      .finally(() => {
        hydrationInFlightRef.current.delete(sourcePath)
      })

    hydrationInFlightRef.current.set(sourcePath, request)
    return request
  }, [])

  const prefetchNextPlaylistTrack = useCallback((trackId: string) => {
    const playlist = folderPlaylistRef.current
    if (!playlist?.tracks.length) return

    const currentIndex = playlist.tracks.findIndex((candidate) => candidate.id === trackId)
    if (currentIndex < 0) return

    const nextTrack = playlist.tracks
      .slice(currentIndex + 1)
      .find((candidate) => candidate.available)

    if (!nextTrack || hydratedAudioTrackCacheRef.current.has(nextTrack.sourcePath)) return

    void requestHydratedAudioTrack(nextTrack.sourcePath).catch((error: unknown) => {
      console.debug('Audio metadata prefetch failed', error)
    })
  }, [requestHydratedAudioTrack])

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
    if (!volumeCommandRunningRef.current && desiredVolumeRef.current === null) {
      const confirmedVolume = volumeScalarToPercent(nextAudioState.volume)
      confirmedVolumeRef.current = confirmedVolume
      setVolume(confirmedVolume)
    }

    if (
      nextAudioState.currentTrackId
      && audioTrackRef.current?.id !== nextAudioState.currentTrackId
      && !audioSelectionInProgressRef.current
    ) {
      hydrateCurrentAudioTrack(nextAudioState.currentTrackId)
    }
  }, [hydrateCurrentAudioTrack])

  const loadFolderAudioTrack = useCallback(async (
    folderTrack: AudioFolderTrackRef,
    autoplay: boolean,
  ) => {
    if (audioSelectionInProgressRef.current || transportCommandRunningRef.current) return false

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

      const nextAudioTrack = await loadAudioFile(folderTrack.sourcePath)
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = nextAudioTrack
      setAudioTrack(nextAudioTrack)
      setState((previous) => upsertAudioTrack(previous, nextAudioTrack))

      const confirmedAudioState = autoplay
        ? await playAudio({ restart: true })
        : await getAudioState()
      applyAudioState(confirmedAudioState)
      prefetchNextPlaylistTrack(nextAudioTrack.id)
      endingTrackRef.current = null
      return true
    } catch (error) {
      const commandError: AudioCommandError = isAudioCommandError(error) ? error : {
        code: 'INTERNAL_ERROR',
        message: appCopy.audio.unavailable,
        recoverable: true,
      }
      setAudioError(commandError)
      if (commandError.code === 'FILE_NOT_FOUND') {
        toast.error(missingPlaylistTrackError(folderTrack.fileName).message)
      }
      return false
    } finally {
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

      const loaded = await loadFolderAudioTrack(target, autoplay)
      if (loaded) return true
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
  ) => {
    folderPlaylistRef.current = playlist
    setFolderPlaylist(playlist)

    const target = playlist.tracks[playlist.selectedIndex] ?? playlist.tracks[0]
    if (!target) {
      setAudioError({
        code: 'NO_TRACK_LOADED',
        message: '\u9009\u62e9\u7684\u6587\u4ef6\u5939\u6ca1\u6709\u53ef\u64ad\u653e\u7684\u672c\u5730\u97f3\u9891\u3002',
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

    const currentTrackId = latestAudioStateRef.current?.currentTrackId ?? audioTrackRef.current?.id
    const currentIndex = Math.max(
      0,
      playlist.tracks.findIndex((candidate) => candidate.id === currentTrackId),
    )

    if (
      automatic
      && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
      && currentIndex >= playlist.tracks.length - 1
    ) {
      return
    }

    const targetIndex = automatic && repeatMode === 'repeat-one'
      ? currentIndex
      : resolveNextTrackIndex(queueTracks, currentIndex, direction, shuffleMode)
    const target = playlist.tracks[targetIndex]
    if (!target) return

    const autoplay = automatic || latestAudioStateRef.current?.phase === 'playing'
    const allowMissingSkipWrap = !(
      automatic
      && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
    )
    await loadPlaylistTrackOrSkip(playlist, targetIndex, autoplay, direction, allowMissingSkipWrap)
  }, [loadPlaylistTrackOrSkip, queueTracks, repeatMode, shuffleMode])

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

  useEffect(() => {
    if (
      !usingRealAudio
      || audioState?.phase !== 'ended'
      || !folderPlaylist
      || !realAudioTrackId
      || endingTrackRef.current === realAudioTrackId
    ) {
      return
    }

    endingTrackRef.current = realAudioTrackId
    void changeFolderTrack(1, true)
  }, [
    audioState?.phase,
    changeFolderTrack,
    folderPlaylist,
    realAudioTrackId,
    usingRealAudio,
  ])

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
      const source = await openAudioSource()

      if (source.kind === 'playlist') {
        audioSelectionInProgressRef.current = false
        setAudioBusy(false)
        await loadFolderPlaylistSelection(source.playlist, autoplay)
        endingTrackRef.current = null
        return
      }

      const { track: audioTrack } = source
      audioTrackRequestIdRef.current += 1
      audioTrackRequestTrackIdRef.current = null
      audioTrackRef.current = audioTrack
      setAudioTrack(audioTrack)
      setState((previous) => upsertAudioTrack(previous, audioTrack))

      const confirmedAudioState = autoplay ? await playAudio({ restart: true }) : await getAudioState()
      applyAudioState(confirmedAudioState)

      let nextFolderPlaylist: AudioFolderPlaylist
      try {
        nextFolderPlaylist = await listAudioFolderTracks(audioTrack.sourcePath)
      } catch {
        nextFolderPlaylist = singleTrackFolderPlaylist(audioTrack)
      }
      folderPlaylistRef.current = nextFolderPlaylist
      setFolderPlaylist(nextFolderPlaylist)
      prefetchNextPlaylistTrack(audioTrack.id)
      endingTrackRef.current = null
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
      setAudioError(isAudioCommandError(error) ? error : {
        code: 'INTERNAL_ERROR',
        message: appCopy.audio.unavailable,
        recoverable: true,
      })
    } finally {
      volumeCommandRunningRef.current = false
      setVolumeBusy(false)
    }
  }

  const currentFeedback = track ? feedbackByTrackId[track.id] : undefined
  const LikeIcon = currentFeedback === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = currentFeedback === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike
  const ShuffleIcon = shuffleMode === 'shuffle-all' ? systemIcons.shuffleOff : shuffleMode === 'shuffle-category-order' ? systemIcons.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? systemIcons.shuffleCategoryRandom : systemIcons.shuffle
  const shuffleLabel = shuffleMode === 'shuffle-all' ? appCopy.controls.shuffleOff : shuffleMode === 'shuffle-category-order' ? appCopy.controls.shuffleCategoryOrder : shuffleMode === 'shuffle-category-random' ? appCopy.controls.shuffleCategoryRandom : appCopy.controls.shuffle
  const RepeatIcon = repeatMode === 'repeat-one' ? systemIcons.repeatOne : repeatMode === 'sequential' ? systemIcons.sequential : repeatMode === 'all-categories-until-stop' ? systemIcons.playAllCategories : systemIcons.repeat
  const repeatLabel = repeatMode === 'repeat-one' ? appCopy.controls.repeatOne : repeatMode === 'sequential' ? appCopy.controls.sequential : repeatMode === 'all-categories-until-stop' ? appCopy.controls.playAllCategories : appCopy.controls.repeat
  const CaptionsIcon = desktopCaptionsAvailable && desktopCaptionsEnabled ? systemIcons.captionsSelected : systemIcons.captions
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
        <WindowBar
          temporaryControlBarEnabled={temporaryControlBarEnabled}
          onTemporaryControlBarEnabledChange={setTemporaryControlBarEnabled}
        />
        {temporaryControlBarEnabled ? (
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
        ) : null}

        {track ? (
          <section className="player-stage" aria-label={appCopy.shellLabel}>
            <AnimatePresence initial={false}>
              <CoverPanel
                key={`${track.id}:${track.coverImage ?? ''}`}
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
              lyricListRef={lyricListRef}
              lyricRefs={lyricRefs}
            />

            <AnimatePresence initial={false}>
              {queueOpen ? (
                <QueuePanel
                  tracks={queueTracks}
                  currentTrackId={track.id}
                  playlistName={folderPlaylist ? playlistDisplayName(folderPlaylist) : undefined}
                  onTrackSelect={folderPlaylist ? (trackId) => {
                    const targetIndex = folderPlaylist.tracks.findIndex((candidate) => candidate.id === trackId)
                    if (targetIndex >= 0) {
                      void loadPlaylistTrackOrSkip(folderPlaylist, targetIndex, true, 1, false, false)
                    }
                  } : undefined}
                />
              ) : null}
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
          desktopCaptionsAvailable={desktopCaptionsAvailable}
          desktopCaptionsEnabled={desktopCaptionsAvailable && desktopCaptionsEnabled}
          volume={volume}
          volumeBusy={volumeBusy}
          volumeDisabled={audioBusy || !hasRealAudioTrack}
          queueOpen={queueOpen}
          audioBusy={audioBusy}
          audioStatusText={realAudioStatusText}
          transportBusy={transportBusy}
          onProgressChange={setProgress}
          onProgressCommit={commitProgress}
          onOpenAudio={() => void openAndMaybePlay(false)}
          onPrevious={() => {
            if (usingRealAudio && folderPlaylist) {
              void changeFolderTrack(-1)
            } else {
              stopRealAudioBeforeDemoNavigation()
              changeTrack(-1)
            }
          }}
          onNext={() => {
            if (usingRealAudio && folderPlaylist) {
              void changeFolderTrack(1)
            } else {
              stopRealAudioBeforeDemoNavigation()
              changeTrack(1)
            }
          }}
          onPlayToggle={togglePlayback}
          onShuffleCycle={cycleShuffleMode}
          onRepeatCycle={cycleRepeatMode}
          onCaptionsToggle={() => {
            if (desktopCaptionsAvailable) setDesktopCaptionsEnabled((value) => !value)
          }}
          onVolumeChange={changeVolume}
          onQueueToggle={() => setQueueOpen((value) => !value)}
        />
      </main>
    </TooltipProvider>
  )
}

export default PlayerShell
