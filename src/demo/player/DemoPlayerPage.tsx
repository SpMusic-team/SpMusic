import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlayerSurface } from '@/features/player/components/PlayerSurface'
import {
  nextRepeatMode,
  nextShuffleMode,
  resolveNextTrackIndex,
  type Direction,
  type RepeatMode,
  type ShuffleMode,
} from '@/features/player/model/playbackModes'
import type { TrackFeedback } from '@/features/player/model/playerTypes'
import { demoTracks } from './demoTracks'

export function DemoPlayerPage() {
  const [currentTrackId, setCurrentTrackId] = useState(demoTracks[0]?.id ?? null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const lastFrameRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const track = demoTracks.find((candidate) => candidate.id === currentTrackId) ?? demoTracks[0] ?? null
  const duration = track?.durationSeconds ?? 0

  const changeTrack = useCallback((direction: Direction, automatic = false) => {
    if (!demoTracks.length) return
    endingTrackRef.current = null
    const currentIndex = Math.max(0, demoTracks.findIndex((candidate) => candidate.id === currentTrackId))
    if (automatic && repeatMode === 'repeat-one') {
      setProgress(0)
      setPlaying(true)
      return
    }
    if (
      automatic
      && (repeatMode === 'sequential' || repeatMode === 'all-categories-until-stop')
      && currentIndex >= demoTracks.length - 1
    ) {
      setProgress(demoTracks[currentIndex]?.durationSeconds ?? 0)
      setPlaying(false)
      return
    }

    const nextIndex = resolveNextTrackIndex(demoTracks, currentIndex, direction, shuffleMode)
    setCurrentTrackId(demoTracks[nextIndex]?.id ?? null)
    setProgress(0)
  }, [currentTrackId, repeatMode, shuffleMode])

  useEffect(() => {
    if (!playing || !track) return
    let frameId = 0

    function step(timestamp: number) {
      const lastFrame = lastFrameRef.current ?? timestamp
      const elapsedSeconds = (timestamp - lastFrame) / 1000
      lastFrameRef.current = timestamp
      setProgress((current) => {
        const next = current + elapsedSeconds
        if (next < track.durationSeconds) return next
        if (endingTrackRef.current !== track.id) {
          endingTrackRef.current = track.id
          window.setTimeout(() => changeTrack(1, true), 0)
        }
        return track.durationSeconds
      })
      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frameId)
      lastFrameRef.current = null
    }
  }, [changeTrack, playing, track])

  function toggleTrackFeedback(trackId: string, feedback: TrackFeedback) {
    setFeedbackByTrackId((previous) => {
      if (previous[trackId] !== feedback) return { ...previous, [trackId]: feedback }
      const next = { ...previous }
      delete next[trackId]
      return next
    })
  }

  return (
    <PlayerSurface
      track={track}
      queueTracks={demoTracks}
      playlistName="独立界面演示"
      currentFeedback={track ? feedbackByTrackId[track.id] : undefined}
      shuffleMode={shuffleMode}
      repeatMode={repeatMode}
      queueOpen={queueOpen}
      playing={playing}
      progress={Math.min(progress, duration)}
      duration={duration}
      volume={volume}
      volumeBusy={false}
      volumeDisabled={false}
      audioBusy={false}
      audioStatusText="演示模式：不调用 Tauri 音频后端"
      transportBusy={false}
      onProgressChange={setProgress}
      onProgressCommit={setProgress}
      onOpenAudio={() => toast.info('独立演示页不会打开本地音频')}
      onPrevious={() => changeTrack(-1)}
      onNext={() => changeTrack(1)}
      onPlayToggle={() => setPlaying((value) => !value)}
      onShuffleCycle={() => setShuffleMode((value) => nextShuffleMode[value])}
      onRepeatCycle={() => setRepeatMode((value) => nextRepeatMode[value])}
      onFeedbackChange={toggleTrackFeedback}
      onVolumeChange={setVolume}
      onQueueToggle={() => setQueueOpen((value) => !value)}
      onQueueTrackSelect={(trackId) => {
        endingTrackRef.current = null
        setCurrentTrackId(trackId)
        setProgress(0)
      }}
    />
  )
}
