import { DataHistogram24Filled, Grid24Filled } from '@fluentui/react-icons'
import { Menu, Search } from 'lucide-react'
import { motion, type MotionValue } from 'motion/react'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { ProgressControl } from '@/features/player/components/ControlDock'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { usePlaylistControllerSwipe } from '@/features/player/hooks/usePlaylistControllerSwipe'
import type { Track, TrackArtwork } from '@/features/player/model/playerTypes'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'

type PlaylistPlaybackDockProps = {
  controllerRef?: RefObject<HTMLElement | null>
  controllerOffsetY?: MotionValue<number>
  controllerHidden?: boolean
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  playlistTrack?: PlaylistTrackItemViewModel
  playlistTracks?: readonly PlaylistTrackItemViewModel[]
  onPlayToggle: () => void
  searchOpen: boolean
  onSearchToggle: () => void
  onClose: () => void
}

// Presence can retain an old dock while a replacement mounts in the same shell.
const controllerBackgroundOwners = new WeakMap<HTMLElement, number>()

export function PlaylistPlaybackDock({
  controllerRef,
  controllerOffsetY,
  controllerHidden = false,
  playback,
  timeline,
  visualIsPlaying,
  playbackTransitionPending,
  playlistTrack,
  playlistTracks,
  onPlayToggle,
  searchOpen,
  onSearchToggle,
  onClose,
}: PlaylistPlaybackDockProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const track = playback.track
  const disabled = !track
  const commandBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || playbackTransitionPending
    || playback.isTransportBusy

  const { viewportRef: swipeViewportRef, x: swipeX, highlight: swipeHighlight, preview: swipePreview, active: swipeActive, pageStride: swipePageStride, onClickCapture: onSwipeClickCapture } = usePlaylistControllerSwipe(playback, disabled || commandBusy || controllerHidden)
  function renderTrackRow(track: Track | null, artwork: TrackArtwork | null | undefined, playlistTrack: PlaylistTrackItemViewModel | undefined, neighbor = false) {
    const imageFallback = artwork?.coverImageFallback ?? track?.coverImageFallback
    const imageSource = artwork?.coverImage ?? track?.coverImage ?? imageFallback
    const localArtwork = playlistTrack?.hasLocalArtwork ?? Boolean(artwork?.coverFilePath ?? track?.coverFilePath)
    const coverThumbnail = playlistTrack?.coverThumbnail
    const showImageSource = Boolean(imageSource && (!localArtwork || neighbor))
    // Mirrors the playlist card language: a real cover, a still-loading local
    // artwork slot, or no artwork at all.
    const coverState = coverThumbnail || showImageSource
      ? 'ready'
      : localArtwork ? 'loading' : 'empty'
    const coverLayoutId = neighbor ? undefined : playerViewTransitionLayoutId('cover', track?.id)
    const copyLayoutId = neighbor ? undefined : playerViewTransitionLayoutId('copy', track?.id)

    return (
      <motion.div className="playlist-playback-track" data-cover-state={coverState} data-swipe-plane={neighbor ? 'neighbor' : 'current'} style={{ x: swipeX, left: neighbor ? `${(swipePreview?.direction ?? 1) * swipePageStride}px` : undefined }} aria-hidden={neighbor || undefined} inert={neighbor || undefined}>
        {!neighbor ? <motion.span className="playlist-controller-swipe-highlight" style={{ opacity: swipeHighlight }} aria-hidden="true" /> : null}
        <button
          type="button"
          className="playlist-playback-track-button"
          aria-label={track ? `打开播放界面：${track.title}` : '打开播放界面'}
          onClick={onClose}
          tabIndex={neighbor ? -1 : undefined}
          draggable={false}
        >
          <motion.span
            key={coverLayoutId ?? 'unshared-cover'}
            className="playlist-playback-cover"
            layoutId={coverLayoutId}
            transition={{ layout: appearanceMotion.layoutTransition }}
            aria-hidden="true"
          >
            {coverThumbnail ? (
              <PlaylistCoverImage className="playlist-playback-cover-image" image={coverThumbnail} />
            ) : showImageSource ? (
              <img
                src={imageSource}
                draggable={false}
                alt=""
                onError={(event) => {
                  const image = event.currentTarget
                  if (imageFallback && image.dataset.fallbackApplied !== 'true') {
                    image.dataset.fallbackApplied = 'true'
                    image.src = imageFallback
                    return
                  }
                  image.hidden = true
                }}
              />
            ) : null}
            {coverState === 'empty' ? (
              <span className="playlist-playback-cover-mark">
                <systemIcons.music />
              </span>
            ) : null}
          </motion.span>
          <motion.span
            key={copyLayoutId ?? 'unshared-copy'}
            className="playlist-playback-copy"
            layoutId={copyLayoutId}
            transition={{ layout: appearanceMotion.layoutTransition }}
          >
            <strong>{track?.title ?? '未在播放'}</strong>
            <span>{track ? `${track.artist}/${track.album}` : '选择一首歌曲开始播放'}</span>
          </motion.span>
        </button>
        <PressFeedbackButton
          key={swipeActive ? 'swiping' : 'resting'}
          className={cn(buttonVariants({ size: 'icon-lg', variant: 'ghost' }), 'playlist-playback-toggle')}
          tone="surface-variant"
          aria-label={visualIsPlaying ? '暂停' : '播放'}
          aria-pressed={visualIsPlaying}
          disabled={neighbor || disabled || commandBusy}
          onClick={onPlayToggle}
        >
          {visualIsPlaying ? <systemIcons.pause aria-hidden="true" /> : <systemIcons.play aria-hidden="true" />}
        </PressFeedbackButton>
      </motion.div>
    )
  }

  useLayoutEffect(() => {
    const shell = dockRef.current?.closest<HTMLElement>('.player-shell')
    if (!shell) return
    const owners = controllerBackgroundOwners.get(shell) ?? 0
    controllerBackgroundOwners.set(shell, owners + 1)
    if (owners === 0) shell.setAttribute('data-controller-background-present', '')
    return () => {
      const remaining = (controllerBackgroundOwners.get(shell) ?? 1) - 1
      if (remaining > 0) {
        controllerBackgroundOwners.set(shell, remaining)
      } else {
        controllerBackgroundOwners.delete(shell)
        shell.removeAttribute('data-controller-background-present')
      }
    }
  }, [])

  useLayoutEffect(() => {
    // AnimatePresence initial=false can begin directly at opacity 1 without an
    // update callback. Read Motion's inline value, not the opaque surface CSS.
    if (contentRef.current && dockRef.current) {
      contentRef.current.style.opacity = dockRef.current.style.opacity || '1'
    }
  }, [appearanceMotion.disabled])

  return (
    <motion.aside
      ref={(element) => {
        dockRef.current = element
        if (controllerRef) controllerRef.current = element
      }}
      className="playlist-playback-dock"
      style={{ y: controllerOffsetY }}
      data-controller-hidden={controllerHidden ? 'true' : undefined}
      inert={controllerHidden || undefined}
      aria-hidden={controllerHidden || undefined}
      data-playback-command-busy={commandBusy && !disabled ? '' : undefined}
      data-playback-track-present={track ? '' : undefined}
      variants={appearanceMotion.variants.backdrop}
      initial="initial"
      animate="animate"
      exit="exit"
      onUpdate={(latest) => {
        if (contentRef.current && typeof latest.opacity === 'number') {
          contentRef.current.style.opacity = String(latest.opacity)
        }
      }}
      aria-label="当前播放"
    >
      <motion.div
        className="controller-shared-background"
        layoutId="player-view-controller-background"
        layoutCrossfade
        transition={{ layout: appearanceMotion.layoutTransition }}
        aria-hidden="true"
      />
      <div
        ref={contentRef}
        className="playlist-playback-content"
        style={{ opacity: appearanceMotion.disabled ? 1 : 0 }}
      >
      <div ref={swipeViewportRef} className="playlist-controller-swipe-viewport" data-swipe-active={swipeActive ? 'true' : undefined} onClickCapture={onSwipeClickCapture} onDragStart={(event) => event.preventDefault()}>
        {renderTrackRow(track, playback.artwork, playlistTrack)}
        {swipePreview ? renderTrackRow(swipePreview.track, swipePreview.artwork, playlistTracks?.find((item) => item.id === swipePreview?.targetTrackId), true) : null}
      </div>

      <ProgressControl
        key={track?.id ?? 'playlist-empty'}
        className="playlist-playback-progress"
        timeline={timeline}
        disabled={disabled || commandBusy}
        isPlaying={playback.isPlaying}
        showTimes={false}
      />

      {/* Reset only the shortcut tooltips at the offscreen boundary. Keep the
          transport, progress interaction, and shared artwork nodes mounted. */}
      <nav key={controllerHidden ? 'hidden' : 'visible'} className="playlist-playback-nav" aria-label="播放列表快捷操作">
        <IconButton
          className="playlist-playback-nav-button is-active"
          icon={Grid24Filled}
          label="播放列表"
          selected
          aria-current="page"
          pressFeedback
          pressFeedbackTone="surface-variant"
        />
        <IconButton
          className="playlist-playback-nav-button playlist-playback-statistics-button"
          icon={DataHistogram24Filled}
          label="播放统计"
          disabled
          pressFeedback
          pressFeedbackTone="surface-variant"
        />
        <IconButton
          className="playlist-playback-nav-button"
          icon={Search}
          label="搜索"
          selected={searchOpen}
          pressFeedback
          pressFeedbackTone="surface-variant"
          onClick={onSearchToggle}
        />
        <IconButton
          className="playlist-playback-nav-button"
          icon={Menu}
          label="打开播放界面"
          pressFeedback
          pressFeedbackTone="surface-variant"
          onClick={onClose}
        />
      </nav>
      </div>
    </motion.aside>
  )
}
