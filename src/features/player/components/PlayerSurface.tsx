import '@/features/player/styles/player.css'
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance, useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { ControlDock } from '@/features/player/components/ControlDock'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
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
import type { PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'

export type PlayerSurfaceDevAudioTools = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  content: ReactNode
}

export type PlayerSurfaceProps = {
  viewModel: PlayerUiViewModel
  devAudioTools?: PlayerSurfaceDevAudioTools
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
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const lyricLayoutKey = [
    appearance.player.lyricsFontScale,
    appearance.player.lyricsTightSpacing,
    appearance.player.lyricsNormalSpacing,
    appearance.player.lyricsTightThresholdSeconds,
  ].join(':')

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
          <section className="player-stage" aria-label={appCopy.shellLabel}>
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
                  onLineSelect={timeline.onCommit}
                />

                <AnimatePresence initial={false}>
                  {queue.isOpen ? (
                    <QueuePanel
                      tracks={queue.tracks}
                      unavailableTrackIds={queue.unavailableTrackIds}
                      currentTrackId={track.id}
                      playlistName={queue.playlistName}
                      onTrackSelect={queue.onTrackSelect}
                    />
                  ) : null}
                </AnimatePresence>
              </>
            ) : <EmptyPlayerState state={contentState === 'track' ? 'empty' : contentState} statusText={playback.statusText} />}

            <ControlDock
              playback={playback}
              timeline={timeline}
              volume={volume}
              queue={queue}
            />
          </section>
        </ResponsivePlayerLayout>
      </main>
    </TooltipProvider>
  )
}
