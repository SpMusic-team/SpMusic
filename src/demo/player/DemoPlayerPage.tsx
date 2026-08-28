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
import type { PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'
import type { TrackFeedback } from '@/features/player/model/playerTypes'
import type { AudioTransportTransition } from '@/features/player/services/audioCommands'
import { demoTracks } from './demoTracks'

export function DemoPlayerPage() {
  const [currentTrackId, setCurrentTrackId] = useState(demoTracks[0]?.id ?? null)
  const [playing, setPlaying] = useState(false)
  const [transportTransition, setTransportTransition] = useState<AudioTransportTransition | null>(null)
  const [transportSettledRequestId, setTransportSettledRequestId] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [timelineInteraction, setTimelineInteraction] = useState<'following' | 'previewing'>('following')
  const [volume, setVolume] = useState(72)
  const [queueOpen, setQueueOpen] = useState(false)
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>('none')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('list-loop')
  const [feedbackByTrackId, setFeedbackByTrackId] = useState<Record<string, TrackFeedback>>({})
  const lastFrameRef = useRef<number | null>(null)
  const endingTrackRef = useRef<string | null>(null)
  const previewStartProgressRef = useRef(0)
  const transportTimerRef = useRef<number | null>(null)
  const transportEnvelopeRef = useRef({ source: 0, target: 0, startedAt: 0, durationMs: 0 })
  const track = demoTracks.find((candidate) => candidate.id === currentTrackId) ?? demoTracks[0] ?? null
  const duration = track?.durationSeconds ?? 0

  useEffect(() => () => {
    if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current)
  }, [])

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
    if (!playing || !track || timelineInteraction !== 'following') return
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
  }, [changeTrack, playing, timelineInteraction, track])

  function toggleTrackFeedback(trackId: string, feedback: TrackFeedback) {
    setFeedbackByTrackId((previous) => {
      if (previous[trackId] !== feedback) return { ...previous, [trackId]: feedback }
      const next = { ...previous }
      delete next[trackId]
      return next
    })
  }

  const viewModel: PlayerUiViewModel = {
    playback: {
      track,
      isPlaying: playing,
      shuffleMode,
      repeatMode,
      isAudioBusy: false,
      isTransportBusy: transportTransition !== null,
      transportTransition,
      transportSettledRequestId,
      statusText: '演示模式：不调用 Tauri 音频后端',
      onOpenAudio: () => toast.info('独立演示页不会打开本地音频'),
      onPrevious: () => changeTrack(-1),
      onNext: () => changeTrack(1),
      onPlayToggle: (request) => {
        if (request.expectedTrackId !== track?.id) {
          return Promise.reject(new Error('Demo playback transition context is stale'))
        }
        if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current)
        const now = window.performance.now()
        const previousEnvelope = transportEnvelopeRef.current
        const elapsed = Math.max(0, now - previousEnvelope.startedAt)
        const previousProgress = previousEnvelope.durationMs > 0
          ? Math.min(1, elapsed / previousEnvelope.durationMs)
          : 1
        const currentLevel = previousEnvelope.source
          + (previousEnvelope.target - previousEnvelope.source) * previousProgress
        const targetLevel = request.target === 'playing' ? 1 : 0
        const actualDurationMs = request.durationMs * Math.abs(targetLevel - currentLevel)
        transportEnvelopeRef.current = {
          source: currentLevel,
          target: targetLevel,
          startedAt: now,
          durationMs: actualDurationMs,
        }
        setTransportSettledRequestId(null)
        if (request.target === 'playing') setPlaying(true)
        if (request.durationMs <= 0) {
          setPlaying(request.target === 'playing')
          setTransportTransition(null)
          setTransportSettledRequestId(request.requestId)
          return Promise.resolve({ requestId: request.requestId, completed: true })
        }
        setTransportTransition({
          requestId: request.requestId,
          target: request.target,
          durationMs: actualDurationMs,
        })
        transportTimerRef.current = window.setTimeout(() => {
          transportTimerRef.current = null
          setPlaying(request.target === 'playing')
          setTransportTransition(null)
          setTransportSettledRequestId(request.requestId)
        }, actualDurationMs)
        return Promise.resolve({ requestId: request.requestId, completed: false })
      },
      onShuffleCycle: () => setShuffleMode((value) => nextShuffleMode[value]),
      onRepeatCycle: () => setRepeatMode((value) => nextRepeatMode[value]),
    },
    timeline: {
      positionSeconds: Math.min(progress, duration),
      durationSeconds: duration,
      interaction: timelineInteraction,
      onPreviewStart: () => {
        previewStartProgressRef.current = progress
        setTimelineInteraction('previewing')
      },
      onPreview: setProgress,
      onCommit: (positionSeconds) => {
        setProgress(positionSeconds)
        setTimelineInteraction('following')
      },
      onCancelPreview: () => {
        setProgress(previewStartProgressRef.current)
        setTimelineInteraction('following')
      },
    },
    volume: {
      valuePercent: volume,
      isBusy: false,
      isDisabled: false,
      onChange: setVolume,
    },
    queue: {
      tracks: demoTracks,
      playlistName: '独立界面演示',
      isOpen: queueOpen,
      onToggle: () => setQueueOpen((value) => !value),
      onTrackSelect: (trackId) => {
        endingTrackRef.current = null
        setCurrentTrackId(trackId)
        setProgress(0)
      },
    },
    feedback: {
      value: track ? feedbackByTrackId[track.id] : undefined,
      onToggle: (feedback) => {
        if (track) toggleTrackFeedback(track.id, feedback)
      },
    },
  }

  return <PlayerSurface viewModel={viewModel} />
}
