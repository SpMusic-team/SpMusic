import '@/features/player/styles/player.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlDock } from '@/features/player/components/ControlDock'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { WindowBar } from '@/features/player/components/WindowBar'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import { nextRepeatMode, nextShuffleMode, resolveNextTrackIndex, type Direction, type RepeatMode, type ShuffleMode } from '@/features/player/model/playbackModes'
import { appCopy } from '@/features/player/model/playerCopy'
import { initialPlayerState } from '@/features/player/model/playerState'
import type { PlayerState } from '@/features/player/model/playerTypes'
import { resolveTrack } from '@/features/player/model/trackUtils'

type ProgressStyle = CSSProperties & { '--progress-percent': string }
type PlayerBackgroundStyle = CSSProperties & { '--player-background-art'?: string }
type CoverStyle = CSSProperties & { '--cover-art'?: string }
type TrackFeedback = 'liked' | 'disliked'

export function PlayerShell() {
  const systemIcons = useSystemIcons()
  const [state, setState] = useState<PlayerState>(initialPlayerState)
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [showTranslations, setShowTranslations] = useState(false)
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const lastFrameTimeRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const track = useMemo(() => resolveTrack(state.tracks, state.currentTrackId), [state.currentTrackId, state.tracks])
  const playing = state.playbackStatus === 'playing'
  const duration = track?.durationSeconds ?? 0
  const progress = Math.min(Math.max(state.progressSeconds, 0), duration)
  const activeLyric = track?.lyrics.reduce((active, line) => line.timeSeconds <= progress ? line : active, track.lyrics[0])
  const activeLyricId = activeLyric?.id
  const activeLyricIndex = track?.lyrics.findIndex((line) => line.id === activeLyricId) ?? -1
  const progressStyle: ProgressStyle = { '--progress-percent': `${duration ? progress / duration * 100 : 0}%` }
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined

  useActiveLyricScroll(activeLyricId, lyricListRef, lyricRefs)

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
    if (!playing || !track) return

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
  }, [changeTrack, playing, track])

  function setProgress(nextProgress: number) {
    endingTrackRef.current = null
    setState((previous) => ({ ...previous, progressSeconds: nextProgress }))
  }

  function togglePlayback() {
    setState((previous) => ({
      ...previous,
      playbackStatus: previous.playbackStatus === 'playing' ? 'paused' : 'playing',
      progressSeconds: previous.progressSeconds >= duration ? 0 : previous.progressSeconds,
    }))
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
      <main className="player-shell" data-cover={track?.coverTone ?? 'empty'} style={playerBackgroundStyle} aria-labelledby="app-title">
        <div className="ambient-cover" aria-hidden="true" />
        <WindowBar />

        {track ? (
          <section className="player-stage" aria-label={appCopy.shellLabel}>
            <CoverPanel
              track={track}
              coverStyle={coverStyle}
              likeIcon={LikeIcon}
              dislikeIcon={DislikeIcon}
              liked={currentFeedback === 'liked'}
              disliked={currentFeedback === 'disliked'}
              onLike={() => toggleTrackFeedback(track.id, 'liked')}
              onDislike={() => toggleTrackFeedback(track.id, 'disliked')}
            />

            <LyricsPanel
              track={track}
              activeLyricId={activeLyricId}
              activeLyricIndex={activeLyricIndex}
              showTranslations={showTranslations}
              lyricListRef={lyricListRef}
              lyricRefs={lyricRefs}
            />

            {queueOpen ? <QueuePanel tracks={state.tracks} currentTrackId={track.id} /> : null}
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
          onProgressChange={setProgress}
          onPrevious={() => changeTrack(-1)}
          onNext={() => changeTrack(1)}
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
