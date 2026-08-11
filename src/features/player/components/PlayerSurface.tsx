import '@/features/player/styles/player.css'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

export function PlayerSurface({
  viewModel,
  devAudioTools,
}: PlayerSurfaceProps) {
  const { playback, timeline, volume, queue, feedback } = viewModel
  const { track } = playback
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const { appearance } = useAppearance()
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const lyricTimeline = track ? locateLyricTimeline(track.lyrics, timeline.positionSeconds) : null
  const activeLyricIndex = lyricTimeline?.currentIndex ?? -1
  const activeLyricId = activeLyricIndex >= 0 ? track?.lyrics[activeLyricIndex]?.id : undefined
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
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
        data-cover={track?.coverTone ?? 'empty'}
        data-window-fullscreen={nativeWindowState.fullscreen}
        aria-labelledby="app-title"
      >
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
                    key={`${track.id}:${track.coverImage ?? ''}`}
                    track={track}
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
                      currentTrackId={track.id}
                      playlistName={queue.playlistName}
                      onTrackSelect={queue.onTrackSelect}
                    />
                  ) : null}
                </AnimatePresence>
              </>
            ) : <EmptyPlayerState />}

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
