import '@/features/player/styles/player.css'
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { ControlDock } from '@/features/player/components/ControlDock'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { ResponsivePlayerLayout } from '@/features/player/components/ResponsivePlayerLayout'
import { TrackMeta } from '@/features/player/components/TrackMeta'
import { WindowBar, type WindowLayoutState } from '@/features/player/components/WindowBar'
import { useActiveLyricScroll } from '@/features/player/hooks/useActiveLyricScroll'
import type { RepeatMode, ShuffleMode } from '@/features/player/model/playbackModes'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track, TrackFeedback } from '@/features/player/model/playerTypes'

type ProgressStyle = CSSProperties & { '--progress-percent': string }
type PlayerBackgroundStyle = CSSProperties & { '--player-background-art': string }
type CoverStyle = CSSProperties & { '--cover-art': string }

export type PlayerSurfaceProps = {
  track: Track | null
  queueTracks: Track[]
  playlistName?: string
  currentFeedback?: TrackFeedback
  shuffleMode: ShuffleMode
  repeatMode: RepeatMode
  queueOpen: boolean
  playing: boolean
  progress: number
  duration: number
  volume: number
  volumeBusy: boolean
  volumeDisabled: boolean
  audioBusy: boolean
  audioStatusText: string
  transportBusy: boolean
  debugToolsEnabled?: boolean
  debugToolsOpen?: boolean
  beforeLayout?: ReactNode
  onDebugToolsOpenChange?: (open: boolean) => void
  onProgressChange: (progress: number) => void
  onProgressCommit: (progress: number) => void
  onOpenAudio: () => void
  onPrevious: () => void
  onNext: () => void
  onPlayToggle: () => void
  onShuffleCycle: () => void
  onRepeatCycle: () => void
  onFeedbackChange: (trackId: string, feedback: TrackFeedback) => void
  onVolumeChange: (volume: number) => void
  onQueueToggle: () => void
  onQueueTrackSelect?: (trackId: string) => void
}

export function PlayerSurface({
  track,
  queueTracks,
  playlistName,
  currentFeedback,
  shuffleMode,
  repeatMode,
  queueOpen,
  playing,
  progress,
  duration,
  volume,
  volumeBusy,
  volumeDisabled,
  audioBusy,
  audioStatusText,
  transportBusy,
  debugToolsEnabled = false,
  debugToolsOpen = false,
  beforeLayout,
  onDebugToolsOpenChange,
  onProgressChange,
  onProgressCommit,
  onOpenAudio,
  onPrevious,
  onNext,
  onPlayToggle,
  onShuffleCycle,
  onRepeatCycle,
  onFeedbackChange,
  onVolumeChange,
  onQueueToggle,
  onQueueTrackSelect,
}: PlayerSurfaceProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const lyricListRef = useRef<HTMLOListElement>(null)
  const lyricRefs = useRef(new Map<string, HTMLLIElement>())
  const activeLyric = track?.lyrics.reduce(
    (active, line) => line.timeSeconds <= progress ? line : active,
    track.lyrics[0],
  )
  const activeLyricId = activeLyric?.id
  const activeLyricIndex = track?.lyrics.findIndex((line) => line.id === activeLyricId) ?? -1
  const progressStyle: ProgressStyle = { '--progress-percent': `${duration ? progress / duration * 100 : 0}%` }
  const albumArt = track?.coverImage ? `url("${track.coverImage}") center / cover no-repeat` : undefined
  const playerBackgroundStyle: PlayerBackgroundStyle | undefined = albumArt ? { '--player-background-art': albumArt } : undefined
  const coverStyle: CoverStyle | undefined = albumArt ? { '--cover-art': albumArt } : undefined

  const visualControls = useMemo(() => {
    const ShuffleIcon = shuffleMode === 'shuffle-all'
      ? systemIcons.shuffleOff
      : shuffleMode === 'shuffle-category-order'
        ? systemIcons.shuffleCategoryOrder
        : shuffleMode === 'shuffle-category-random'
          ? systemIcons.shuffleCategoryRandom
          : systemIcons.shuffle
    const shuffleLabel = shuffleMode === 'shuffle-all'
      ? appCopy.controls.shuffleOff
      : shuffleMode === 'shuffle-category-order'
        ? appCopy.controls.shuffleCategoryOrder
        : shuffleMode === 'shuffle-category-random'
          ? appCopy.controls.shuffleCategoryRandom
          : appCopy.controls.shuffle
    const RepeatIcon = repeatMode === 'repeat-one'
      ? systemIcons.repeatOne
      : repeatMode === 'sequential'
        ? systemIcons.sequential
        : repeatMode === 'all-categories-until-stop'
          ? systemIcons.playAllCategories
          : systemIcons.repeat
    const repeatLabel = repeatMode === 'repeat-one'
      ? appCopy.controls.repeatOne
      : repeatMode === 'sequential'
        ? appCopy.controls.sequential
        : repeatMode === 'all-categories-until-stop'
          ? appCopy.controls.playAllCategories
          : appCopy.controls.repeat

    return { ShuffleIcon, shuffleLabel, RepeatIcon, repeatLabel }
  }, [repeatMode, shuffleMode, systemIcons])

  useActiveLyricScroll(activeLyricId, lyricListRef, lyricRefs)

  const LikeIcon = currentFeedback === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = currentFeedback === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike

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

        {beforeLayout}

        <ResponsivePlayerLayout
          nativeWindowState={nativeWindowState}
          windowBar={(
            <WindowBar
              onWindowStateChange={setNativeWindowState}
              debugToolsEnabled={debugToolsEnabled}
              debugToolsOpen={debugToolsOpen}
              onDebugToolsOpenChange={onDebugToolsOpenChange}
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
                    liked={currentFeedback === 'liked'}
                    disliked={currentFeedback === 'disliked'}
                    onLike={() => onFeedbackChange(track.id, 'liked')}
                    onDislike={() => onFeedbackChange(track.id, 'disliked')}
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
                  onLineSelect={onProgressCommit}
                />

                <AnimatePresence initial={false}>
                  {queueOpen ? (
                    <QueuePanel
                      tracks={queueTracks}
                      currentTrackId={track.id}
                      playlistName={playlistName}
                      onTrackSelect={onQueueTrackSelect}
                    />
                  ) : null}
                </AnimatePresence>
              </>
            ) : <EmptyPlayerState />}

            <ControlDock
              progress={progress}
              duration={duration}
              progressStyle={progressStyle}
              disabled={!track}
              playing={playing}
              shuffleIcon={visualControls.ShuffleIcon}
              shuffleLabel={visualControls.shuffleLabel}
              shuffleSelected={shuffleMode !== 'none'}
              repeatIcon={visualControls.RepeatIcon}
              repeatLabel={visualControls.repeatLabel}
              repeatSelected={repeatMode !== 'list-loop'}
              captionsIcon={systemIcons.captions}
              desktopCaptionsAvailable={false}
              desktopCaptionsEnabled={false}
              volume={volume}
              volumeBusy={volumeBusy}
              volumeDisabled={volumeDisabled}
              queueOpen={queueOpen}
              audioBusy={audioBusy}
              audioStatusText={audioStatusText}
              transportBusy={transportBusy}
              onProgressChange={onProgressChange}
              onProgressCommit={onProgressCommit}
              onOpenAudio={onOpenAudio}
              onPrevious={onPrevious}
              onNext={onNext}
              onPlayToggle={onPlayToggle}
              onShuffleCycle={onShuffleCycle}
              onRepeatCycle={onRepeatCycle}
              onCaptionsToggle={() => undefined}
              onVolumeChange={onVolumeChange}
              onQueueToggle={onQueueToggle}
            />
          </section>
        </ResponsivePlayerLayout>
      </main>
    </TooltipProvider>
  )
}
