import '@/features/player/styles/player.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlDock } from '@/features/player/components/ControlDock'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { WindowBar } from '@/features/player/components/WindowBar'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import { nextRepeatMode, nextShuffleMode, resolveNextTrackIndex, type Direction, type RepeatMode, type ShuffleMode } from '@/features/player/model/playbackModes'
import { appCopy } from '@/features/player/model/playerCopy'
import { initialPlayerState } from '@/features/player/model/playerState'
import type { PlayerState, Track } from '@/features/player/model/playerTypes'
import {
  getAudioState,
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

function audioTrackToTrack(track: AudioTrackRef): Track {
  const title = track.fileName.replace(/\.[^/.]+$/, '') || track.fileName

  return {
    id: track.id,
    title,
    artist: '本地音频',
    album: '真实播放后端',
    category: 'local-audio',
    durationSeconds: track.durationMs ? track.durationMs / 1000 : 0,
    coverTone: 'blue',
    lyrics: [],
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

function audioErrorText(error: AudioCommandError | null): string | null {
  if (!error) return null
  return appCopy.audio.errors[error.code] ?? error.message
}

function audioStatusText(state: AudioPlaybackState | null, error: AudioCommandError | null): string {
  const errorText = audioErrorText(error ?? state?.error ?? null)
  if (errorText) return errorText

  if (!state) return appCopy.audio.idle

  const fileName = state.currentTrack?.fileName ?? '本地音频'

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
  const [audioError, setAudioError] = useState<AudioCommandError | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null)
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const lastFrameTimeRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const seekRequestIdRef = useRef(0)
  const lastSeekCommitRef = useRef<{ positionMs: number; at: number } | null>(null)
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const realAudioTrackId = audioState?.currentTrack?.id ?? null
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
  const realAudioStatusText = audioStatusText(audioState, audioError)
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined

  useActiveLyricScroll(activeLyricId, lyricListRef, lyricRefs)

  const applyAudioState = useCallback((nextAudioState: AudioPlaybackState) => {
    setAudioState(nextAudioState)
    setAudioError(nextAudioState.error)

    if (!nextAudioState.currentTrack) {
      setState((previous) => ({
        ...previous,
        playbackStatus: nextAudioState.phase === 'playing' ? 'playing' : 'paused',
        progressSeconds: nextAudioState.positionMs / 1000,
      }))
      return
    }

    setState((previous) => upsertAudioTrack(previous, nextAudioState.currentTrack!, nextAudioState))
  }, [])

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
      void getAudioState()
        .then(applyAudioState)
        .catch((error: unknown) => {
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

    try {
      const audioTrack = await openAudioFile()
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
      setAudioBusy(false)
    }
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
      const clampedProgress = Math.min(Math.max(nextProgress, 0), duration)
      const positionMs = Math.round(clampedProgress * 1000)
      const now = window.performance.now()
      const previousCommit = lastSeekCommitRef.current

      if (previousCommit && previousCommit.positionMs === positionMs && now - previousCommit.at < 360) {
        return
      }

      lastSeekCommitRef.current = { positionMs, at: now }

      if (Math.abs(clampedProgress - backendProgress) < 0.08) {
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
      return
    }

    setState((previous) => ({ ...previous, progressSeconds: nextProgress }))
  }

  async function togglePlayback() {
    if (audioBusy) return

    if (!usingRealAudio) {
      await openAndMaybePlay(true)
      return
    }

    setAudioBusy(true)
    setAudioError(null)

    try {
      const nextState = playing
        ? await pauseAudio()
        : await playAudio({ restart: duration > 0 && progress >= duration })
      applyAudioState(nextState)
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
