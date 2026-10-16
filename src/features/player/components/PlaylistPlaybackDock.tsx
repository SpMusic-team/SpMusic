import { DataHistogram24Filled, Grid24Filled } from '@fluentui/react-icons'
import { Menu, Search } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent, type MotionValue } from 'motion/react'
import { Fragment, useCallback, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { buttonVariants } from '@/components/ui/button'
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { ProgressControl } from '@/features/player/components/ControlDock'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { usePlaylistControllerSwipe } from '@/features/player/hooks/usePlaylistControllerSwipe'
import type { Track, TrackArtwork } from '@/features/player/model/playerTypes'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'
import { cn } from '@/lib/utils'

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
  onSearchToggle?: () => void
  onClose: () => void
  onOpenPlaylist?: () => void
  playlistSelected?: boolean
  playlistLabel?: string
}

// Presence can retain an old dock while a replacement mounts in the same shell.
type DockOwners = {
  members: Map<HTMLElement, boolean>
  owner: HTMLElement | null
  listeners: Set<() => void>
}
const controllerBackgroundOwners = new WeakMap<HTMLElement, DockOwners>()

function publishDockOwner(shell: HTMLElement, owners: DockOwners) {
  shell.toggleAttribute('data-controller-background-present', owners.owner !== null)
  for (const dock of owners.members.keys()) dock.toggleAttribute('data-dock-superseded', dock !== owners.owner)
  for (const listener of owners.listeners) listener()
}

// Projection nodes can change identity during a page's exit. Their local
// presence must not add a fresh, unfinished subscription to that exiting page.
function DockProjectionPresence({ children }: { children: ReactNode }) {
  return <AnimatePresence initial={false}><Fragment key="projection">{children}</Fragment></AnimatePresence>
}

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
  onOpenPlaylist,
  playlistSelected = true,
  playlistLabel = '播放列表',
}: PlaylistPlaybackDockProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const isPresent = useIsPresent()
  const dockRef = useRef<HTMLElement>(null)
  const readHandoff = useCallback(() => {
    const dock = dockRef.current
    const shell = dock?.closest<HTMLElement>('.player-shell')
    const owners = shell ? controllerBackgroundOwners.get(shell) : undefined
    return Boolean(dock && owners?.owner === dock && owners.members.get(dock) === true && owners.members.size > 1)
  }, [])
  const subscribeHandoff = useCallback((listener: () => void) => {
    const shell = dockRef.current?.closest<HTMLElement>('.player-shell')
    const owners = shell ? controllerBackgroundOwners.get(shell) : undefined
    owners?.listeners.add(listener)
    return () => { owners?.listeners.delete(listener) }
  }, [])
  const stationaryHandoff = useSyncExternalStore(subscribeHandoff, readHandoff, () => false)
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const readOwner = useCallback(() => {
    const dock = dockRef.current
    const shell = dock?.closest<HTMLElement>('.player-shell')
    return Boolean(dock && shell && controllerBackgroundOwners.get(shell)?.owner === dock)
  }, [])
  const ownsDock = useSyncExternalStore(subscribeHandoff, readOwner, () => false)
  // During browsing, Motion's shared-stack lead can differ from the visible
  // dock owner. Keep stationary replacements out of that stack altogether;
  // only the visible owner rejoins it for the real return to the player.
  // Projection keys below change with this membership: Motion registers
  // layoutId on mount, so changing the prop alone cannot rejoin the stack.
  const sharedPlayerLayout = !chromeTransition.handoff && !chromeTransition.overviewBoundary && !chromeTransition.overviewVisible
    && (!chromeTransition.playerVisible || ownsDock)
  const keepStationaryContent = (chromeTransition.handoff || chromeTransition.overviewBoundary) && !chromeTransition.playerVisible
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const layoutTransition = { ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.65) }
  const track = playback.track
  const disabled = !track
  const commandBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || playbackTransitionPending
    || playback.isTransportBusy

  const { viewportRef: swipeViewportRef, x: swipeX, highlight: swipeHighlight, preview: swipePreview, active: swipeActive, pageStride: swipePageStride, onClickCapture: onSwipeClickCapture } = usePlaylistControllerSwipe(playback, disabled || commandBusy || controllerHidden || !isPresent)
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
    const coverLayoutId = neighbor || !sharedPlayerLayout ? undefined : playerViewTransitionLayoutId('cover', track?.id)
    const copyLayoutId = neighbor || !sharedPlayerLayout ? undefined : playerViewTransitionLayoutId('copy', track?.id)

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
          <DockProjectionPresence><motion.span
            key={`${track?.id ?? 'empty'}:${coverLayoutId ? 'player' : 'library'}`}
            className="playlist-playback-cover"
            layoutId={coverLayoutId}
            layoutCrossfade={!stationaryHandoff}
            transition={{ layout: layoutTransition }}
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
          </motion.span></DockProjectionPresence>
          <DockProjectionPresence><motion.span
            key={`${track?.id ?? 'empty'}:${copyLayoutId ? 'player' : 'library'}`}
            className="playlist-playback-copy"
            layoutId={copyLayoutId}
            layoutCrossfade={!stationaryHandoff}
            transition={{ layout: layoutTransition }}
          >
            <strong>{track?.title ?? '未在播放'}</strong>
            <span>{track ? `${track.artist}/${track.album}` : '选择一首歌曲开始播放'}</span>
          </motion.span></DockProjectionPresence>
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
    const dock = dockRef.current
    const shell = dock?.closest<HTMLElement>('.player-shell')
    if (!dock || !shell) return
    const owners = controllerBackgroundOwners.get(shell) ?? { members: new Map<HTMLElement, boolean>(), owner: null, listeners: new Set<() => void>() }
    controllerBackgroundOwners.set(shell, owners)
    owners.members.set(dock, false)
    return () => {
      owners.members.delete(dock)
      if (owners.owner === dock) {
        owners.owner = [...owners.members].findLast(([, present]) => present)?.[0] ?? null
      }
      publishDockOwner(shell, owners)
      if (!owners.members.size) controllerBackgroundOwners.delete(shell)
    }
  }, [])

  useLayoutEffect(() => {
    const dock = dockRef.current
    const shell = dock?.closest<HTMLElement>('.player-shell')
    const owners = shell ? controllerBackgroundOwners.get(shell) : undefined
    if (!dock || !shell || !owners) return
    owners.members.set(dock, isPresent && !chromeTransition.overviewVisible)
    if (chromeTransition.overviewVisible) {
      if (owners.owner === dock) owners.owner = [...owners.members].findLast(([, present]) => present)?.[0] ?? null
    } else if (isPresent) owners.owner = dock
    // Without a successor this is the return to the player: retain the outgoing
    // shared surface until its real presence cleanup, including its original fade.
    else if (owners.owner === dock) owners.owner = [...owners.members].findLast(([, present]) => present)?.[0] ?? dock
    publishDockOwner(shell, owners)
  }, [chromeTransition.overviewVisible, isPresent])

  useLayoutEffect(() => {
    // AnimatePresence initial=false can begin directly at opacity 1 without an
    // update callback. Read Motion's inline value, not the opaque surface CSS.
    if (contentRef.current && dockRef.current) {
      contentRef.current.style.opacity = keepStationaryContent || readHandoff() ? '1' : dockRef.current.style.opacity || '1'
    }
  }, [appearanceMotion.disabled, keepStationaryContent, readHandoff, stationaryHandoff])

  return (
    <motion.aside
      ref={(element) => {
        dockRef.current = element
        if (controllerRef) controllerRef.current = element
      }}
      className="playlist-playback-dock"
      style={{ y: controllerOffsetY }}
      data-controller-hidden={controllerHidden ? 'true' : undefined}
      inert={controllerHidden || !isPresent || undefined}
      aria-hidden={controllerHidden || !isPresent || undefined}
      data-playback-command-busy={commandBusy && !disabled ? '' : undefined}
      data-playback-track-present={track ? '' : undefined}
      variants={appearanceMotion.variants.backdrop}
      initial={chromeTransition.overviewBoundary ? false : 'initial'}
      animate="animate"
      exit={chromeTransition.overviewBoundary ? 'animate' : 'exit'}
      transition={chromeTransition.overviewBoundary ? { duration: 0 } : undefined}
      onUpdate={(latest) => {
        if (contentRef.current && typeof latest.opacity === 'number') {
          contentRef.current.style.opacity = keepStationaryContent || readHandoff() ? '1' : String(latest.opacity)
        }
      }}
      aria-label="当前播放"
    >
      <DockProjectionPresence><motion.div
        key={sharedPlayerLayout ? 'player-background' : 'library-background'}
        className="controller-shared-background"
        layoutId={sharedPlayerLayout ? 'player-view-controller-background' : undefined}
        layoutCrossfade={!stationaryHandoff}
        transition={{ layout: layoutTransition }}
        aria-hidden="true"
      /></DockProjectionPresence>
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
          className={cn('playlist-playback-nav-button', playlistSelected && 'is-active')}
          icon={Grid24Filled}
          label={playlistLabel}
          selected={playlistSelected}
          aria-current={playlistSelected ? 'page' : undefined}
          disabled={!playlistSelected && !onOpenPlaylist}
          onClick={onOpenPlaylist}
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
          disabled={!onSearchToggle}
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
