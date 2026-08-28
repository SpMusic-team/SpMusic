import '@/features/player/styles/player.css'
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance, useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { ControlDock } from '@/features/player/components/ControlDock'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { PlaybackInfoButton } from '@/features/player/components/PlaybackInfoButton'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { ResponsivePlayerLayout } from '@/features/player/components/ResponsivePlayerLayout'
import { TrackMeta } from '@/features/player/components/TrackMeta'
import { WindowBar, type WindowLayoutState } from '@/features/player/components/WindowBar'
import { ArtworkCanvas } from '@/features/player/components/ArtworkCanvas'
import { appCopy } from '@/features/player/model/playerCopy'
import type { TrackFeedback } from '@/features/player/model/playerTypes'
import {
  useArtworkResourceConsumer,
  useArtworkVisualResource,
  type ArtworkVisualLayer,
} from '@/features/player/hooks/useArtworkVisualResource'
import type { PlayerPlaybackViewModel, PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'

export type PlayerSurfaceDevAudioTools = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  content: ReactNode
}

export type PlayerSurfaceProps = {
  viewModel: PlayerUiViewModel
  devAudioTools?: PlayerSurfaceDevAudioTools
}

type PlaybackVisualState = 'playing' | 'paused'

type PlaybackTransitionRequest = {
  requestId: number
  target: PlaybackVisualState
  trackId: string
  durationMs: number
  visualComplete: boolean
}

type PlaybackTransitionStyle = CSSProperties & {
  '--player-playback-transition-duration': string
}

const PLAYBACK_VISUAL_TRANSITION_MS = 500
let lastPlaybackTransitionRequestId = 0

function nextPlaybackTransitionRequestId(): number {
  const candidate = Math.max(lastPlaybackTransitionRequestId + 1, Date.now() * 1000)
  lastPlaybackTransitionRequestId = Number.isSafeInteger(candidate) ? candidate : lastPlaybackTransitionRequestId + 1
  return lastPlaybackTransitionRequestId
}

type AmbientArtworkProps = {
  layer: ArtworkVisualLayer | null
  onExitComplete: (layerId: number) => void
}

const AmbientArtwork = memo(function AmbientArtwork({ layer, onExitComplete }: AmbientArtworkProps) {
  const appearanceMotion = useAppearanceMotion()
  useArtworkResourceConsumer(layer?.resource)
  const handleExitComplete = useCallback(() => {
    if (layer?.phase === 'exiting') onExitComplete(layer.id)
  }, [layer, onExitComplete])
  useEffect(() => {
    if (!appearanceMotion.disabled || layer?.phase !== 'exiting') return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) handleExitComplete()
    })
    return () => { cancelled = true }
  }, [appearanceMotion.disabled, handleExitComplete, layer?.phase])
  return (
    <motion.div
      className="ambient-cover"
      data-tone={layer?.artwork.coverTone ?? 'blue'}
      data-has-image={Boolean(layer?.resource.view)}
      style={layer ? undefined : { display: 'none' }}
      variants={appearanceMotion.variants.backdrop}
      initial={false}
      animate={!layer || layer.phase === 'exiting' ? 'exit' : layer.phase === 'incoming' ? 'initial' : 'animate'}
      onAnimationComplete={(definition) => {
        if (definition === 'exit') handleExitComplete()
      }}
      aria-hidden="true"
    >
      <ArtworkCanvas
        className="ambient-cover-image"
        source={layer?.resource.view}
        hidden
        maxBackingEdge={1024}
      />
    </motion.div>
  )
})
type ArtworkCoverLayerProps = {
  layer: ArtworkVisualLayer | null
  feedbackValue?: TrackFeedback
  onFeedbackToggle: (feedback: TrackFeedback) => void
  onReady: (layerId: number) => void
  onLoadError: (layerId: number) => void
  onExitComplete: (layerId: number) => void
}

const ArtworkCoverLayer = memo(function ArtworkCoverLayer({
  layer,
  feedbackValue,
  onFeedbackToggle,
  onReady,
  onLoadError,
  onExitComplete,
}: ArtworkCoverLayerProps) {
  const systemIcons = useSystemIcons()
  useArtworkResourceConsumer(layer?.resource)
  const handleReady = useCallback(() => {
    if (layer?.phase === 'incoming') onReady(layer.id)
  }, [layer, onReady])
  const handleLoadError = useCallback(() => {
    if (layer?.phase === 'incoming') onLoadError(layer.id)
  }, [layer, onLoadError])
  const handleExitComplete = useCallback(() => {
    if (layer?.phase === 'exiting') onExitComplete(layer.id)
  }, [layer, onExitComplete])
  const handleLike = useCallback(() => onFeedbackToggle('liked'), [onFeedbackToggle])
  const handleDislike = useCallback(() => onFeedbackToggle('disliked'), [onFeedbackToggle])
  const LikeIcon = feedbackValue === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = feedbackValue === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike

  return (
    <CoverPanel
      layer={layer}
      likeIcon={LikeIcon}
      dislikeIcon={DislikeIcon}
      liked={feedbackValue === 'liked'}
      disliked={feedbackValue === 'disliked'}
      onLike={handleLike}
      onDislike={handleDislike}
      onReady={handleReady}
      onLoadError={handleLoadError}
      onExitComplete={handleExitComplete}
    />
  )
})
export function PlayerSurface({
  viewModel,
  devAudioTools,
}: PlayerSurfaceProps) {
  const { playback, timeline, volume, queue, feedback } = viewModel
  const { track } = playback
  const {
    slots: artworkSlots,
    currentArtworkReady,
    markReady: markArtworkReady,
    markLoadError: markArtworkLoadError,
    markExitComplete: markArtworkExitComplete,
  } = useArtworkVisualResource(
    playback.artwork ?? null,
    track,
    playback.detailsPending ?? false,
    playback.artworkPrefetchCandidate ?? null,
    playback.selectionActivitySequence ?? 0,
  )
  const handleAmbientExitComplete = useCallback(
    (layerId: number) => markArtworkExitComplete(layerId, 'ambient'),
    [markArtworkExitComplete],
  )
  const handleCoverExitComplete = useCallback(
    (layerId: number) => markArtworkExitComplete(layerId, 'cover'),
    [markArtworkExitComplete],
  )
  const toneLayer = artworkSlots.find((layer) => layer?.phase === 'active')
    ?? artworkSlots.find((layer) => layer?.phase === 'incoming')
    ?? artworkSlots.find((layer) => layer?.phase === 'exiting')
  const contentState = playback.contentState ?? (track ? 'track' : 'empty')
  const { appearance } = useAppearance()
  const appearanceMotion = useAppearanceMotion()
  const reduceMotion = useReducedMotion()
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const realPlaybackState: PlaybackVisualState = playback.isPlaying ? 'playing' : 'paused'
  const [pendingVisualPlaybackState, setPendingVisualPlaybackState] = useState<PlaybackVisualState | null>(null)
  const visualPlaybackState = pendingVisualPlaybackState ?? realPlaybackState
  const [playbackTransitionPending, setPlaybackTransitionPending] = useState(false)
  const playerStageRef = useRef<HTMLElement>(null)
  const playbackTransitionRequestRef = useRef<PlaybackTransitionRequest | null>(null)
  const playbackTransitionDuration = appearanceMotion.disabled || reduceMotion
    ? 0
    : PLAYBACK_VISUAL_TRANSITION_MS
  const playbackTransitionStyle: PlaybackTransitionStyle = {
    '--player-playback-transition-duration': `${playbackTransitionDuration}ms`,
  }
  const lyricLayoutKey = [
    appearance.player.lyricsFontScale,
    appearance.player.lyricsTightSpacing,
    appearance.player.lyricsNormalSpacing,
    appearance.player.lyricsTightThresholdSeconds,
  ].join(':')

  const cancelPlaybackTransition = useCallback(() => {
    playbackTransitionRequestRef.current = null
    setPlaybackTransitionPending(false)
    setPendingVisualPlaybackState(null)
  }, [])

  const settlePlaybackTransitionIfComplete = useCallback(() => {
    const request = playbackTransitionRequestRef.current
    const backendPhaseMatches = playback.isPlaying === (request?.target === 'playing')
    if (
      !request?.visualComplete
      || (playback.transportTransition ?? null) !== null
      || playback.transportSettledRequestId !== request.requestId
      || !backendPhaseMatches
    ) return
    playbackTransitionRequestRef.current = null
    setPlaybackTransitionPending(false)
    setPendingVisualPlaybackState(null)
  }, [playback.isPlaying, playback.transportSettledRequestId, playback.transportTransition])

  const completePlaybackVisualTransition = useCallback((requestId: number) => {
    const request = playbackTransitionRequestRef.current
    if (!request || request.requestId !== requestId) return
    request.visualComplete = true
    settlePlaybackTransitionIfComplete()
  }, [settlePlaybackTransitionIfComplete])

  const playbackCoverTransitionTarget = useCallback((event: TransitionEvent<HTMLElement>) => {
    const target = event.target
    if (
      event.propertyName !== 'width'
      || !(target instanceof HTMLElement)
      || !target.classList.contains('cover-frame')
    ) return null
    return target
  }, [])

  const handlePlaybackVisualTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    const target = playbackCoverTransitionTarget(event)
    if (!target) return
    const request = playbackTransitionRequestRef.current
    if (request) completePlaybackVisualTransition(request.requestId)
  }, [completePlaybackVisualTransition, playbackCoverTransitionTarget])

  const handlePlayToggle = useCallback(() => {
    const trackId = track?.id
    const busy = playback.isAudioBusy || playback.isSelectionPending
    if (!trackId || busy || timeline.interaction === 'seeking' || !currentArtworkReady) return

    const source = playbackTransitionRequestRef.current?.target ?? visualPlaybackState
    const target = source === 'playing' ? 'paused' : 'playing'
    const layout = playerStageRef.current
      ?.closest<HTMLElement>('.responsive-player-layout')
      ?.dataset.playerLayout
    const durationMs = layout === 'full' ? playbackTransitionDuration : 0
    const request: PlaybackTransitionRequest = {
      requestId: nextPlaybackTransitionRequestId(),
      target,
      trackId,
      durationMs,
      visualComplete: false,
    }
    playbackTransitionRequestRef.current = request
    setPlaybackTransitionPending(true)
    setPendingVisualPlaybackState(target)

    if (durationMs === 0) {
      queueMicrotask(() => completePlaybackVisualTransition(request.requestId))
    }

    let transitionResult: ReturnType<PlayerPlaybackViewModel['onPlayToggle']>
    try {
      transitionResult = playback.onPlayToggle({
        requestId: request.requestId,
        expectedTrackId: trackId,
        target,
        durationMs,
      })
    } catch {
      cancelPlaybackTransition()
      return
    }
    void Promise.resolve(transitionResult)
      .then((result) => {
        const activeRequest = playbackTransitionRequestRef.current
        if (!activeRequest || activeRequest.requestId !== request.requestId) return
        if (result && result.requestId !== request.requestId) return
        settlePlaybackTransitionIfComplete()
      })
      .catch(() => {
        if (playbackTransitionRequestRef.current?.requestId === request.requestId) {
          cancelPlaybackTransition()
        }
      })
  }, [
    cancelPlaybackTransition,
    completePlaybackVisualTransition,
    playback,
    playbackTransitionDuration,
    currentArtworkReady,
    settlePlaybackTransitionIfComplete,
    timeline.interaction,
    track?.id,
    visualPlaybackState,
  ])

  useEffect(() => {
    const request = playbackTransitionRequestRef.current
    if (!request) return
    settlePlaybackTransitionIfComplete()
  }, [
    playback.isPlaying,
    playback.transportSettledRequestId,
    playback.transportTransition,
    settlePlaybackTransitionIfComplete,
  ])

  useEffect(() => {
    const request = playbackTransitionRequestRef.current
    if (!request) return

    const contextInvalidated = request.trackId !== (track?.id ?? null)
      || playback.isAudioBusy
      || playback.isSelectionPending
      || timeline.interaction === 'seeking'
      || !currentArtworkReady
    if (contextInvalidated) cancelPlaybackTransition()
  }, [
    cancelPlaybackTransition,
    playback.isAudioBusy,
    playback.isSelectionPending,
    playbackTransitionPending,
    currentArtworkReady,
    timeline.interaction,
    track?.id,
  ])

  useEffect(() => () => {
    playbackTransitionRequestRef.current = null
  }, [])

  return (
    <TooltipProvider>
      <main
        className="player-shell"
        data-cover={toneLayer?.artwork.coverTone ?? track?.coverTone ?? 'empty'}
        data-content-state={contentState}
        data-window-fullscreen={nativeWindowState.fullscreen}
        aria-busy={contentState === 'loading'}
        aria-labelledby="app-title"
      >
        {artworkSlots.map((layer, slot) => (
          <AmbientArtwork
            key={`ambient-slot:${slot}`}
            layer={layer}
            onExitComplete={handleAmbientExitComplete}
          />
        ))}
        {devAudioTools?.content}

        <ResponsivePlayerLayout
          nativeWindowState={nativeWindowState}
          windowBar={(
            <WindowBar
              onWindowStateChange={setNativeWindowState}
              debugToolsEnabled={devAudioTools !== undefined}
              debugToolsOpen={devAudioTools?.isOpen ?? false}
              onDebugToolsOpenChange={devAudioTools?.onOpenChange}
            />
          )}
        >
          <section
            ref={playerStageRef}
            className="player-stage"
            data-playback-state={visualPlaybackState}
            style={playbackTransitionStyle}
            onTransitionEnd={handlePlaybackVisualTransitionEnd}
            aria-label={appCopy.shellLabel}
          >
            {track ? (
              <>
                {artworkSlots.map((layer, slot) => (
                  <ArtworkCoverLayer
                    key={`cover-slot:${slot}`}
                    layer={layer}
                    feedbackValue={feedback.value}
                    onFeedbackToggle={feedback.onToggle}
                    onReady={markArtworkReady}
                    onLoadError={markArtworkLoadError}
                    onExitComplete={handleCoverExitComplete}
                  />
                ))}

                <AnimatePresence initial={false}>
                  <TrackMeta key={`meta:${track.id}`} track={track} />
                </AnimatePresence>

                <LyricsPanel
                  track={track}
                  detailsPending={playback.detailsPending}
                  positionSeconds={timeline.positionSeconds}
                  interaction={timeline.interaction}
                  visualClock={timeline.visualClock}
                  lyricLayoutKey={lyricLayoutKey}
                  tightThresholdSeconds={appearance.player.lyricsTightThresholdSeconds}
                  onLineSelect={playbackTransitionPending ? () => undefined : timeline.onCommit}
                />

                <AnimatePresence initial={false}>
                  {queue.isOpen ? (
                    <QueuePanel
                      tracks={queue.tracks}
                      unavailableTrackIds={queue.unavailableTrackIds}
                      currentTrackId={track.id}
                      playlistName={queue.playlistName}
                      onTrackSelect={playbackTransitionPending ? undefined : queue.onTrackSelect}
                    />
                  ) : null}
                </AnimatePresence>
              </>
            ) : <EmptyPlayerState state={contentState === 'track' ? 'empty' : contentState} statusText={playback.statusText} />}

            <div className="player-control-region">
              <PlaybackInfoButton visible={Boolean(track)} />
              <ControlDock
                playback={playback}
                timeline={timeline}
                volume={volume}
                queue={queue}
                visualIsPlaying={visualPlaybackState === 'playing'}
                playbackTransitionPending={playbackTransitionPending}
                playbackVisualReady={currentArtworkReady}
                onPlayToggle={handlePlayToggle}
              />
            </div>
          </section>
        </ResponsivePlayerLayout>
      </main>
    </TooltipProvider>
  )
}
