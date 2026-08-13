import '@/features/player/styles/player.css'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import { locateLyricTimeline } from '@/features/player/model/lyricTimeline'
import { appCopy } from '@/features/player/model/playerCopy'
import type { TrackArtwork } from '@/features/player/model/playerTypes'
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

function useLoadedArtwork(
  artwork: TrackArtwork | null,
  currentTrackId: string | null,
  detailsPending: boolean,
): TrackArtwork | null {
  const [loadedArtwork, setLoadedArtwork] = useState(artwork)
  const candidateTokenRef = useRef(0)

  useEffect(() => {
    const candidateToken = candidateTokenRef.current + 1
    candidateTokenRef.current = candidateToken
    if (
      !artwork?.coverImage
      || detailsPending
      || artwork.id !== currentTrackId
    ) return

    let cancelled = false
    const sources = [artwork.coverImage, artwork.coverImageFallback].filter(
      (source, index, all): source is string => Boolean(source) && all.indexOf(source) === index,
    )

    const loadSource = (index: number) => {
      if (cancelled || candidateTokenRef.current !== candidateToken) return
      const source = sources[index]
      if (!source) {
        if (!cancelled && candidateTokenRef.current === candidateToken) {
          setLoadedArtwork({ ...artwork, coverImage: undefined, coverImageFallback: undefined })
        }
        return
      }

      const image = new Image()
      image.onload = () => {
        const commit = () => {
          if (!cancelled && candidateTokenRef.current === candidateToken) {
            setLoadedArtwork({ ...artwork, coverImage: source, coverImageFallback: undefined })
          }
        }
        if (typeof image.decode !== 'function') {
          commit()
          return
        }
        void image.decode().then(commit, () => loadSource(index + 1))
      }
      image.onerror = () => loadSource(index + 1)
      image.src = source
    }

    loadSource(0)
    return () => { cancelled = true }
  }, [artwork, currentTrackId, detailsPending])

  return artwork?.coverImage ? loadedArtwork : artwork
}

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
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const { appearance } = useAppearance()
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const lyricTimeline = track ? locateLyricTimeline(track.lyrics, timeline.positionSeconds) : null
  const activeLyricIndex = lyricTimeline?.currentIndex ?? -1
  const activeLyricId = activeLyricIndex >= 0 ? track?.lyrics[activeLyricIndex]?.id : undefined
  const albumArt = artwork?.coverImage ? `url("${artwork.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined
  const lyricLayoutKey = [
    appearance.player.lyricsFontScale,
    appearance.player.lyricsTightSpacing,
    appearance.player.lyricsNormalSpacing,
    appearance.player.lyricsTightThresholdSeconds,
  ].join(':')

  useActiveLyricScroll(
    timeline.positionSeconds,
    timeline.interaction,
    track?.lyrics ?? [],
    lyricListRef,
    lyricRefs,
    lyricLayoutKey,
  )

  const LikeIcon = feedback.value === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = feedback.value === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike

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
        <AnimatePresence initial={false}>
          {track ? (
            <motion.div
              key={artwork?.id ?? track.id}
              className="ambient-cover"
              data-tone={artwork?.coverTone ?? track.coverTone}
              style={playerBackgroundStyle}
              variants={appearanceMotion.variants.backdrop}
              initial="initial"
              animate="animate"
              exit="exit"
              aria-hidden="true"
            />
          ) : null}
        </AnimatePresence>

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
                <AnimatePresence initial={false}>
                  <CoverPanel
                    key={`${artwork?.id ?? track.id}:${artwork?.coverImage ?? ''}`}
                    track={track}
                    artwork={artwork ?? {
                      id: track.id,
                      coverTone: track.coverTone,
                      coverImage: track.coverImage,
                      coverImageFallback: track.coverImageFallback,
                    }}
                    coverStyle={coverStyle}
                    likeIcon={LikeIcon}
                    dislikeIcon={DislikeIcon}
                    liked={feedback.value === 'liked'}
                    disliked={feedback.value === 'disliked'}
                    onLike={() => feedback.onToggle('liked')}
                    onDislike={() => feedback.onToggle('disliked')}
                  />
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  <TrackMeta key={`meta:${track.id}`} track={track} />
                </AnimatePresence>

                <LyricsPanel
                  track={track}
                  detailsPending={playback.detailsPending}
                  activeLyricId={activeLyricId}
                  activeLyricIndex={activeLyricIndex}
                  lyricListRef={lyricListRef}
                  lyricRefs={lyricRefs}
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
