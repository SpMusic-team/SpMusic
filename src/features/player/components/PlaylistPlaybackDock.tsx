import { DataHistogram24Filled, Grid24Filled } from '@fluentui/react-icons'
import { Menu, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { ProgressControl } from '@/features/player/components/ControlDock'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'

type PlaylistPlaybackDockProps = {
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  playlistTrack?: PlaylistTrackItemViewModel
  onPlayToggle: () => void
  searchOpen: boolean
  onSearchToggle: () => void
  onClose: () => void
}

// Presence can retain an old dock while a replacement mounts in the same shell.
const controllerBackgroundOwners = new WeakMap<HTMLElement, number>()

export function PlaylistPlaybackDock({
  playback,
  timeline,
  visualIsPlaying,
  playbackTransitionPending,
  playlistTrack,
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
  const artwork = playback.artwork
  const imageFallback = artwork?.coverImageFallback ?? track?.coverImageFallback
  const imageSource = artwork?.coverImage ?? track?.coverImage ?? imageFallback
  const localArtwork = playlistTrack?.hasLocalArtwork ?? Boolean(artwork?.coverFilePath ?? track?.coverFilePath)
  const coverThumbnail = playlistTrack?.coverThumbnail
  // Mirrors the playlist card language: a real cover, a still-loading local
  // artwork slot, or no artwork at all.
  const coverState = coverThumbnail || (!localArtwork && imageSource)
    ? 'ready'
    : localArtwork ? 'loading' : 'empty'
  const coverLayoutId = playerViewTransitionLayoutId('cover', track?.id)
  const copyLayoutId = playerViewTransitionLayoutId('copy', track?.id)
  const disabled = !track
  const commandBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || playbackTransitionPending
    || playback.isTransportBusy

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
      ref={dockRef}
      className="playlist-playback-dock"
      data-playback-command-busy={commandBusy && !disabled ? '' : undefined}
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
      <div className="playlist-playback-track" data-cover-state={coverState}>
        <button
          type="button"
          className="playlist-playback-track-button"
          aria-label={track ? `返回播放界面：${track.title}` : '返回播放界面'}
          onClick={onClose}
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
            ) : !localArtwork && imageSource ? (
              <img
                src={imageSource}
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
        <Button
          className="playlist-playback-toggle"
          size="icon-lg"
          variant="ghost"
          aria-label={visualIsPlaying ? '暂停' : '播放'}
          aria-pressed={visualIsPlaying}
          disabled={disabled || commandBusy}
          onClick={onPlayToggle}
        >
          {visualIsPlaying ? <systemIcons.pause aria-hidden="true" /> : <systemIcons.play aria-hidden="true" />}
        </Button>
      </div>

      <ProgressControl
        key={track?.id ?? 'playlist-empty'}
        className="playlist-playback-progress"
        timeline={timeline}
        disabled={disabled || commandBusy}
        isPlaying={playback.isPlaying}
        showTimes={false}
      />

      <nav className="playlist-playback-nav" aria-label="播放列表快捷操作">
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
          label="返回播放界面"
          pressFeedback
          pressFeedbackTone="surface-variant"
          onClick={onClose}
        />
      </nav>
      </div>
    </motion.aside>
  )
}
