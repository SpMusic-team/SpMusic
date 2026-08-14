import '@/features/player/styles/player.css'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
import { appCopy } from '@/features/player/model/playerCopy'
import type { CoverTone, Track, TrackArtwork, TrackFeedback } from '@/features/player/model/playerTypes'
import type { PlayerUiViewModel } from '@/features/player/model/playerUiViewModel'

type PlayerBackgroundStyle = CSSProperties & { '--player-background-art': string }
type CoverStyle = CSSProperties & { '--cover-art': string }

export type PlayerSurfaceDevAudioTools = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  content: ReactNode
}

export type PlayerSurfaceProps = {
  viewModel: PlayerUiViewModel
  devAudioTools?: PlayerSurfaceDevAudioTools
}

type ArtworkLoadAttempt = {
  resourceKey: string
  primary: string
  fallback?: string
  token: { cancelled: boolean }
  status: 'loading' | 'settled' | 'cancelled'
  image: HTMLImageElement | null
  result: TrackArtwork | null
}

function releaseArtworkImage(attempt: ArtworkLoadAttempt) {
  const image = attempt.image
  if (!image) return
  image.onload = null
  image.onerror = null
  image.src = ''
  attempt.image = null
}

function cancelArtworkAttempt(attempt: ArtworkLoadAttempt) {
  attempt.token.cancelled = true
  attempt.status = 'cancelled'
  releaseArtworkImage(attempt)
  attempt.result = null
}

function useLoadedArtwork(
  artwork: TrackArtwork | null,
  currentTrackId: string | null,
  detailsPending: boolean,
): TrackArtwork | null {
  const [loadedArtwork, setLoadedArtwork] = useState(artwork)
  const loadAttemptRef = useRef<ArtworkLoadAttempt | null>(null)
  const artworkId = artwork?.id
  const coverTone = artwork?.coverTone
  const primarySource = artwork?.coverImage
  const fallbackSource = artwork?.coverImageFallback
  const resourceKey = artwork?.resourceKey

  useEffect(() => {
    if (detailsPending) return
    if (!artworkId || !coverTone || !resourceKey) {
      const existingAttempt = loadAttemptRef.current
      if (existingAttempt?.status === 'loading') cancelArtworkAttempt(existingAttempt)
      loadAttemptRef.current = null
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setLoadedArtwork((previous) => previous === null ? previous : null)
      })
      return () => { cancelled = true }
    }
    if (!primarySource) {
      const existingAttempt = loadAttemptRef.current
      if (existingAttempt?.status === 'loading') cancelArtworkAttempt(existingAttempt)
      loadAttemptRef.current = null
      let cancelled = false
      queueMicrotask(() => {
        if (cancelled) return
        setLoadedArtwork((previous) => (
          previous?.resourceKey === resourceKey
          && previous.id === artworkId
          && previous.coverTone === coverTone
          && !previous.coverImage
          && !previous.coverImageFallback
            ? previous
            : {
                id: artworkId,
                coverTone,
                coverImage: undefined,
                coverImageFallback: undefined,
                resourceKey,
              }
        ))
      })
      return () => { cancelled = true }
    }
    if (artworkId !== currentTrackId) return

    const existingAttempt = loadAttemptRef.current
    const matchesExistingAttempt = existingAttempt
      && existingAttempt.resourceKey === resourceKey
      && existingAttempt.primary === primarySource
      && existingAttempt.fallback === fallbackSource
    if (matchesExistingAttempt && existingAttempt.status === 'settled') {
      if (existingAttempt.result) setLoadedArtwork(existingAttempt.result)
      return
    }
    if (matchesExistingAttempt && existingAttempt.status === 'loading') return
    if (existingAttempt?.status === 'loading') cancelArtworkAttempt(existingAttempt)

    const sources = [primarySource, fallbackSource].filter(
      (source, index, all): source is string => Boolean(source) && all.indexOf(source) === index,
    )
    const attempt: ArtworkLoadAttempt = {
      resourceKey,
      primary: primarySource,
      fallback: fallbackSource,
      token: { cancelled: false },
      status: 'loading',
      image: null,
      result: null,
    }
    loadAttemptRef.current = attempt

    const isCurrent = () => (
      !attempt.token.cancelled
      && loadAttemptRef.current === attempt
    )

    const settle = (source?: string) => {
      if (!isCurrent()) return
      releaseArtworkImage(attempt)
      const result: TrackArtwork = source
        ? {
            id: artworkId,
            coverTone,
            coverImage: source,
            coverImageFallback: undefined,
            resourceKey,
          }
        : {
            id: artworkId,
            coverTone,
            coverImage: undefined,
            coverImageFallback: undefined,
            resourceKey,
          }
      attempt.status = 'settled'
      attempt.result = result
      setLoadedArtwork(result)
    }

    const loadSource = (index: number) => {
      if (!isCurrent()) return
      const source = sources[index]
      if (!source) {
        settle()
        return
      }

      const image = new Image()
      attempt.image = image
      const tryFallback = () => {
        if (!isCurrent() || attempt.image !== image) return
        releaseArtworkImage(attempt)
        loadSource(index + 1)
      }
      image.onload = () => {
        if (!isCurrent() || attempt.image !== image) return
        image.onload = null
        image.onerror = null
        if (typeof image.decode !== 'function') {
          settle(source)
          return
        }
        void image.decode().then(() => settle(source), tryFallback)
      }
      image.onerror = tryFallback
      image.src = source
    }

    // Deferring allocation prevents React StrictMode's probe effect from starting a duplicate decode.
    queueMicrotask(() => loadSource(0))
    return () => {
      if (loadAttemptRef.current === attempt && attempt.status === 'loading') {
        cancelArtworkAttempt(attempt)
      }
    }
  }, [
    artworkId,
    coverTone,
    currentTrackId,
    detailsPending,
    fallbackSource,
    primarySource,
    resourceKey,
  ])

  return artwork?.coverImage ? loadedArtwork : artwork
}

type AmbientArtworkProps = {
  trackId: string | null
  trackTone: CoverTone | null
  artwork: TrackArtwork | null
}

const AmbientArtwork = memo(function AmbientArtwork({ trackId, trackTone, artwork }: AmbientArtworkProps) {
  const appearanceMotion = useAppearanceMotion()
  const playerBackgroundStyle = useMemo<PlayerBackgroundStyle | undefined>(() => {
    if (!artwork?.coverImage) return undefined
    return { '--player-background-art': `url("${artwork.coverImage}") center / cover no-repeat` }
  }, [artwork?.coverImage])

  return (
    <AnimatePresence initial={false}>
      {trackId ? (
        <motion.div
          key={artwork?.id ?? trackId}
          className="ambient-cover"
          data-tone={artwork?.coverTone ?? trackTone ?? 'blue'}
          style={playerBackgroundStyle}
          variants={appearanceMotion.variants.backdrop}
          initial="initial"
          animate="animate"
          exit="exit"
          aria-hidden="true"
        />
      ) : null}
    </AnimatePresence>
  )
})

type StaticTrackPresentationProps = {
  track: Track
  artwork: TrackArtwork | null
  feedbackValue?: TrackFeedback
  onFeedbackToggle: (feedback: TrackFeedback) => void
}

const StaticTrackPresentation = memo(function StaticTrackPresentation({
  track,
  artwork,
  feedbackValue,
  onFeedbackToggle,
}: StaticTrackPresentationProps) {
  const systemIcons = useSystemIcons()
  const coverStyle = useMemo<CoverStyle | undefined>(() => {
    if (!artwork?.coverImage) return undefined
    return { '--cover-art': `url("${artwork.coverImage}") center / cover no-repeat` }
  }, [artwork?.coverImage])
  const resolvedArtwork = useMemo<TrackArtwork>(() => artwork ?? ({
    id: track.id,
    coverTone: track.coverTone,
    coverImage: track.coverImage,
    coverImageFallback: track.coverImageFallback,
    resourceKey: 'art-none',
  }), [artwork, track.coverImage, track.coverImageFallback, track.coverTone, track.id])
  const handleLike = useCallback(() => onFeedbackToggle('liked'), [onFeedbackToggle])
  const handleDislike = useCallback(() => onFeedbackToggle('disliked'), [onFeedbackToggle])
  const LikeIcon = feedbackValue === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = feedbackValue === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike

  return (
    <>
      <AnimatePresence initial={false}>
        <CoverPanel
          key={resolvedArtwork.resourceKey}
          track={track}
          artwork={resolvedArtwork}
          coverStyle={coverStyle}
          likeIcon={LikeIcon}
          dislikeIcon={DislikeIcon}
          liked={feedbackValue === 'liked'}
          disliked={feedbackValue === 'disliked'}
          onLike={handleLike}
          onDislike={handleDislike}
        />
      </AnimatePresence>

      <AnimatePresence initial={false}>
        <TrackMeta key={`meta:${track.id}`} track={track} />
      </AnimatePresence>
    </>
  )
})

export function PlayerSurface({
  viewModel,
  devAudioTools,
}: PlayerSurfaceProps) {
  const { playback, timeline, volume, queue, feedback } = viewModel
  const { track } = playback
  const artwork = useLoadedArtwork(
    playback.artwork ?? null,
    track?.id ?? null,
    playback.detailsPending ?? false,
  )
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
        data-cover={artwork?.coverTone ?? track?.coverTone ?? 'empty'}
        data-content-state={contentState}
        data-window-fullscreen={nativeWindowState.fullscreen}
        aria-busy={contentState === 'loading'}
        aria-labelledby="app-title"
      >
        <AmbientArtwork
          trackId={track?.id ?? null}
          trackTone={track?.coverTone ?? null}
          artwork={artwork}
        />

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
                <StaticTrackPresentation
                  track={track}
                  artwork={artwork}
                  feedbackValue={feedback.value}
                  onFeedbackToggle={feedback.onToggle}
                />

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
