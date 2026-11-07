import { PlaylistAddDialog, PlaylistDeleteDialog, SelectionIcon } from './PlaylistSongDialogs'
import { DataHistogram24Filled, Grid24Filled } from '@fluentui/react-icons'
import { Menu, Search, Play, ListPlus, ListX } from 'lucide-react'
import { AnimatePresence, animate, motion, useIsPresent, usePresence, useMotionValue, type MotionValue, type MotionStyle } from 'motion/react'
import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { buttonVariants } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import selectionCheckbox from '@/assets/selection-panel/checkbox.svg'
import selectionRange from '@/assets/selection-panel/range.svg'
import selectionHelp from '@/assets/selection-panel/help.svg'
import selectionClose from '@/assets/selection-panel/close.svg'
import selectionPlaylist from '@/assets/selection-panel/playlist.svg'
import selectionQueue from '@/assets/selection-panel/queue.svg'
import selectionNext from '@/assets/selection-panel/play-next.svg'
import selectionDelete from '@/assets/selection-panel/delete.svg'
import selectionShare from '@/assets/selection-panel/share.svg'
import selectionInfo from '@/assets/selection-panel/info.svg'
import selectionArtwork from '@/assets/selection-panel/artwork.svg'
import selectionCompleted from '@/assets/selection-panel/completed.svg'
import type { LibraryDockSelection } from '@/features/player/hooks/useLibraryDockBinding'
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import { useAppearance, useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { ProgressControl } from '@/features/player/components/ControlDock'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistPlaybackCoverImage } from '@/features/player/components/PlaylistPlaybackCoverImage'
import { ArtworkCanvas } from '@/features/player/components/ArtworkCanvas'
import { useArtworkResourceConsumer, type ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel, PlaylistDeleteSnapshot, PlaylistAddRequest } from '@/features/player/model/playerUiViewModel'
import { usePlaylistControllerSwipe } from '@/features/player/hooks/usePlaylistControllerSwipe'
import type { Track, TrackArtwork } from '@/features/player/model/playerTypes'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'
import { cn } from '@/lib/utils'
import streamGlyph from '@/assets/media-library/streams-root.svg'

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
  coverLayer?: ArtworkVisualLayer | null
  previewCoverLayer?: ArtworkVisualLayer | null
  previewCoverReady?: boolean
  previewCoverEmpty?: boolean
  requireCanvasPreview?: boolean
  onPreviewCoverReady?: () => void
  onPreviewCoverError?: () => void
  onPlayToggle: () => void
  searchOpen: boolean
  onSearchToggle?: () => void
  onClose: () => void
  onHome?: () => void
  homeSelected?: boolean
  selection?: LibraryDockSelection
}

function SelectionPanel({ selection }: { selection: LibraryDockSelection }) {
  const [present, safeToRemove] = usePresence()
  const [helpOpen, setHelpOpen] = useState(false)
  const [deleteSnapshot, setDeleteSnapshot] = useState<PlaylistDeleteSnapshot | null>(null)
  const [deleteCanRemoveFromList, setDeleteCanRemoveFromList] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'list' | 'files'>('list')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const deleteLock = useRef(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [addRequest, setAddRequest] = useState<PlaylistAddRequest | null>(null)
  const [addedTarget, setAddedTarget] = useState<string | null>(null)
  useEffect(() => {
    if (!completed || !present) return
    const timer = window.setTimeout(selection.onExit, 2000)
    return () => window.clearTimeout(timer)
  }, [completed, present, selection.onExit])
  const beginDelete = () => {
    const snapshot = selection.onPrepareDelete?.()
    if (!snapshot || !snapshot.songKeys.length) return
    setDeleteCanRemoveFromList(snapshot.canRemoveFromList)
    setDeleteSnapshot(snapshot)
    setDeleteMode('list')
    setDeleteError(null)
  }
  const beginAdd = () => {
    const request = selection.onPrepareAddToPlaylist?.()
    if (!request || !request.snapshot.songKeys.length) return
    setAddRequest(request)
    setDeleteError(null)
  }
  const confirmDelete = async () => {
    if (!deleteSnapshot || !selection.onDelete || deleteLock.current || deleteMode === 'list' && !deleteSnapshot.canRemoveFromList) return
    deleteLock.current = true
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await selection.onDelete(deleteSnapshot, deleteMode)
      if (!result.failedKeys.length && result.succeededKeys.length && !result.errorMessage) {
        setDeleteSnapshot(null)
        setCompleted(true)
      } else {
        setDeleteSnapshot(null)
        setDeleteError(`已删除 ${result.succeededKeys.length} 项，${result.failedKeys.length} 项未能删除。${result.errorMessage || '请重试。'}`)
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败，请重试。')
    } finally {
      deleteLock.current = false
      setDeleteBusy(false)
    }
  }
  const motionSettings = useAppearanceMotion()
  const panelRef = useRef<HTMLElement>(null)
  const y = useMotionValue(motionSettings.disabled ? '0%' : '100%')
  const opacity = useMotionValue(motionSettings.disabled ? 1 : 0)
  const [initialStyle] = useState(() => ({ transform: `translateY(${y.get()})`, opacity: opacity.get() }))
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const setY = (value: string) => { panel.style.transform = `translateY(${value})` }
    const setOpacity = (value: number) => { panel.style.opacity = String(value) }
    setY(y.get()); setOpacity(opacity.get())
    const stopY = y.on('change', setY)
    const stopOpacity = opacity.on('change', setOpacity)
    return () => { stopY(); stopOpacity() }
  }, [y, opacity])
  useLayoutEffect(() => {
    const targetY = present ? '0%' : '100%'
    const targetOpacity = present ? 1 : 0
    if (motionSettings.disabled) {
      y.set(targetY); opacity.set(targetOpacity)
      return
    }
    let cancelled = false
    const travel = animate(y, targetY, present ? motionSettings.selection.dockEnter : motionSettings.selection.dockExit)
    const fade = animate(opacity, targetOpacity, present ? motionSettings.selection.dockCrossfade : motionSettings.selection.dockExit)
    if (!present) void Promise.all([travel, fade]).then(() => { if (!cancelled) safeToRemove?.() })
    return () => { cancelled = true; travel.stop(); fade.stop() }
  }, [present, safeToRemove, motionSettings.disabled, motionSettings.selection, y, opacity])
  // AnimatePresence records the exiting key in its parent layout effect.
  // Publish completion after that registration, while pixels already snapped
  // synchronously above. A child layout-effect completion would be lost.
  useEffect(() => {
    if (!present && motionSettings.disabled) safeToRemove?.()
  }, [present, motionSettings.disabled, safeToRemove])
  return <section ref={panelRef}
    className={cn('playlist-selection-panel', completed && 'playlist-selection-completed', deleteSnapshot && 'playlist-selection-confirming', addRequest && 'playlist-selection-picking')}
    aria-label="歌曲选择操作"
    data-selection-phase={present ? 'active' : 'exiting'}
    inert={!present || undefined}
    aria-hidden={!present || undefined}
    style={initialStyle}
  >
    {completed ? <div className="playlist-selection-completed-content" role="status" aria-live="polite"><SelectionIcon source={selectionCompleted} size={56} /><span>{addedTarget ? '已添加' : '完成'}</span>{addedTarget ? <Button className="playlist-selection-completed-open" variant="outline" onClick={() => { selection.onExit(); selection.onOpenPlaylistTarget?.(addedTarget) }}>打开</Button> : null}</div> : <div className="playlist-selection-choices" hidden={Boolean(deleteSnapshot || addRequest)}>
    <div className="playlist-selection-panel-header">
      <div className="playlist-selection-scope">
        <Button variant="ghost" className="playlist-selection-all" disabled={!selection.canSelectAll} aria-pressed={selection.allSelected} onClick={selection.onSelectAll}>
          <span className="playlist-selection-all-icon" data-checked={selection.allSelected}><SelectionIcon source={selectionCheckbox} size={45} /><span className="playlist-selection-all-tick" /></span><span>全选</span>
        </Button>
        <Button variant="ghost" className="playlist-selection-range" disabled title="暂不支持按范围选择"><SelectionIcon source={selectionRange} size={32} /><span>按范围选择</span></Button>
      </div>
      <span className="playlist-selection-count" role="status" aria-live="polite" aria-label={`已选 ${selection.count} 项，共 ${selection.total} 项`}>{selection.count}/{selection.total}</span>
      <div className="playlist-selection-utilities">
        <Button variant="ghost" className="playlist-selection-utility" aria-label="选择帮助" onClick={() => setHelpOpen(true)}><SelectionIcon source={selectionHelp} size={32} /></Button>
        <Button variant="ghost" className="playlist-selection-utility" aria-label="退出选择" onClick={selection.onExit}><SelectionIcon source={selectionClose} size={28} /></Button>
      </div>
    </div>
    <div className="playlist-selection-panel-actions">
      {[
        [selectionPlaylist, '播放列表'], [selectionQueue, '队列'], [selectionNext, '下一首播放'],
        [selectionDelete, '删除'], [selectionShare, '分享'],
        ...(selection.imageAction ? [[selectionArtwork, '图像']] : []),
        ...(selection.limitedActions ? [] : [[selectionInfo, '信息/标签'], [selectionArtwork, '专辑封面']]),
      ].map(([source, label]) => <Button key={label} variant="ghost" className="playlist-selection-action" disabled={selection.count === 0 || deleteBusy || (label === '删除' ? !selection.onDelete || selection.canDelete === false : label === '播放列表' ? !selection.onAddToPlaylist || !selection.canAddToPlaylist : true)} onClick={label === '删除' ? beginDelete : label === '播放列表' ? beginAdd : undefined} title={label === '删除' ? '从列表移除或删除文件' : label === '播放列表' ? '添加到播放列表' : '暂未支持此操作'}><SelectionIcon source={source} size={28} /><span>{label}</span></Button>)}
    </div>
    {deleteError && !deleteSnapshot ? <p className="playlist-selection-error" role="alert">{deleteError}</p> : null}
    </div>}
    <PlaylistDeleteDialog open={Boolean(deleteSnapshot) && present} container={panelRef} mode={deleteMode} canRemoveFromList={deleteCanRemoveFromList} canDeleteFiles={deleteSnapshot?.canDeleteFiles} busy={deleteBusy} error={deleteError}
      onCancel={() => { setDeleteSnapshot(null); setDeleteError(null) }} onModeChange={mode => { setDeleteMode(mode); setDeleteError(null) }} onConfirm={() => { void confirmDelete() }} />
    {addRequest ? <PlaylistAddDialog selection={selection} request={addRequest} container={panelRef} active={present}
      onCancel={() => setAddRequest(null)} onDone={(targetScope, outcome) => {
        setAddRequest(null)
        if (outcome && outcome !== 'none') { setAddedTarget(outcome === 'added' ? targetScope ?? null : null); setCompleted(true) }
      }} /> : null}
    <Dialog open={helpOpen && present} onOpenChange={setHelpOpen}>
      <DialogContent className="playlist-selection-help">
        <DialogTitle>选择帮助</DialogTitle>
        <DialogDescription>长按歌曲卡片进入选择，点击卡片切换选中状态。使用全选选择当前列表，点击关闭退出选择。按范围选择暂未支持。</DialogDescription>
        <section aria-label="其他选择操作" className="playlist-selection-help-actions">
          <h3>其他选择操作</h3>
          <Button variant="ghost" disabled={!selection.canPlay} onClick={() => { setHelpOpen(false); selection.onPlay() }}><Play data-icon="inline-start" />播放选中</Button>
          <Button variant="ghost" disabled={selection.count === 0} onClick={() => { setHelpOpen(false); selection.onClear() }}><ListX data-icon="inline-start" />清除选中</Button>
          {selection.canCreatePlaylist ? <Button variant="ghost" disabled={selection.count === 0} onClick={() => { setHelpOpen(false); selection.onCreatePlaylist?.() }}><ListPlus data-icon="inline-start" />新建播放列表</Button> : null}
        </section>
      </DialogContent>
    </Dialog>
  </section>
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
  coverLayer,
  previewCoverLayer,
  previewCoverReady = false,
  previewCoverEmpty = false,
  requireCanvasPreview = false,
  onPreviewCoverReady,
  onPreviewCoverError,
  onPlayToggle,
  searchOpen,
  onSearchToggle,
  onClose,
  onHome,
  homeSelected = false,
  selection,
}: PlaylistPlaybackDockProps) {
  const selectionActive = Boolean(selection?.active)
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
  const sharedPlayerLayout = !chromeTransition.playerVisible || ownsDock
  const keepStationaryContent = !chromeTransition.playerVisible
  const systemIcons = useSystemIcons()
  const appearance = useAppearance().appearance
  const appearanceMotion = useAppearanceMotion()
  const playbackOpacity = useMotionValue(selectionActive ? 0 : 1)
  useLayoutEffect(() => {
    const target = selectionActive ? 0 : 1
    if (appearanceMotion.disabled) { playbackOpacity.set(target); return }
    const fade = animate(playbackOpacity, target, appearanceMotion.selection.dockCrossfade)
    return () => fade.stop()
  }, [selectionActive, appearanceMotion.disabled, appearanceMotion.selection.dockCrossfade, playbackOpacity])
  const layoutTransition = useMemo(() => ({ ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.65) }), [appearanceMotion.layoutTransition])
  // Keep one visual value when the route releases its controller binding.
  // Animate this dock-owned bridge, never the retiring page's motion value.
  const controllerVisualY = useMotionValue(0)
  useLayoutEffect(() => {
    if (controllerOffsetY) {
      controllerVisualY.set(selectionActive ? 0 : controllerOffsetY.get())
      return controllerOffsetY.on('change', (value) => controllerVisualY.set(selectionActive ? 0 : value))
    }
    if (appearanceMotion.disabled || !isPresent || chromeTransition.playerVisible) {
      controllerVisualY.set(0)
      return
    }
    if (controllerVisualY.get() === 0) return
    const settle = animate(controllerVisualY, 0, layoutTransition)
    return () => settle.stop()
  }, [controllerOffsetY, controllerVisualY, selectionActive, appearanceMotion.disabled, isPresent,
    chromeTransition.playerVisible, layoutTransition])
  const track = playback.track
  const selectionIntent = playback.selectionVisualIntent
  const selectionKey = selectionIntent
    ? `${selectionIntent.sequence}:${selectionIntent.requestId}:${selectionIntent.targetTrackId}` : null
  const [switchState, setSwitchState] = useState<{ observedKey: string | null; activeKey: string | null }>({
    observedKey: selectionKey,
    activeKey: null,
  })
  const intentOwnsSelection = Boolean(selectionIntent && selectionIntent.sequence === playback.selectionActivitySequence
    && (playback.isSelectionPending || selectionIntent.targetTrackId === track?.id))
  if (selectionKey && selectionKey !== switchState.observedKey && intentOwnsSelection) {
    setSwitchState({ observedKey: selectionKey, activeKey: selectionKey })
  }
  const activeSwitchKey = intentOwnsSelection && switchState.activeKey === selectionKey ? selectionKey : null
  const bookmarkMotion = timeline.bookmarkProgressMotion
  const [bookmarkSwitch, setBookmarkSwitch] = useState({ observed: bookmarkMotion?.key, active: null as string | null, suppressedSelectionKey: bookmarkMotion ? selectionKey : null })
  if (bookmarkMotion?.key !== bookmarkSwitch.observed) {
    setBookmarkSwitch({ observed: bookmarkMotion?.key, active: bookmarkMotion?.key ?? null,
      suppressedSelectionKey: bookmarkMotion ? selectionKey : bookmarkSwitch.suppressedSelectionKey })
  }
  const activeBookmarkMotion = bookmarkSwitch.active === bookmarkMotion?.key ? bookmarkMotion : null
  const keepPlayingVisual = Boolean(selectionIntent?.preservePlayingVisual
    && selectionIntent.sequence === playback.selectionActivitySequence
    && playback.isSelectionPending)
  const dockVisualIsPlaying = visualIsPlaying || playback.automaticContinuationVisual || keepPlayingVisual
  const targetHasArtwork = Boolean(track?.coverImage || track?.coverFilePath
    || playback.artwork?.coverImage || playback.artwork?.coverFilePath)
  // A committed swipe has already painted its target at the viewport origin.
  // Keep that exact preview through the artwork promotion barrier; restoring
  // the outgoing layer here would briefly put the old row back at x=0.
  const committedPreviewCoverLayer = selectionIntent?.previewTokenId !== undefined
    && selectionIntent.sequence === playback.selectionActivitySequence
    && selectionIntent.targetTrackId === track?.id
    && previewCoverLayer?.previewTokenId === selectionIntent.previewTokenId
    && previewCoverLayer.track.id === track?.id
    && previewCoverLayer.phase === 'preview'
    && (previewCoverReady || previewCoverEmpty)
    ? previewCoverLayer : null
  const displayedCoverLayer = coverLayer?.track.id === track?.id
    ? coverLayer : committedPreviewCoverLayer ?? coverLayer
  // A cold selection can commit before the decoded target canvas arrives.
  // Keep the outgoing cover and its own metadata together until the target
  // can paint; a genuinely empty target switches to its empty state at once.
  const displayedTrack = displayedCoverLayer && targetHasArtwork ? displayedCoverLayer.track : track
  const displayedArtwork = displayedCoverLayer?.track.id === displayedTrack?.id
    ? displayedCoverLayer?.artwork : playback.artwork
  const displayedPlaylistTrack = displayedTrack?.id === track?.id
    ? playlistTrack : playlistTracks?.find((item) => item.id === displayedTrack?.id)
  const matchingCoverResource = displayedCoverLayer && displayedTrack && displayedCoverLayer.track.id === displayedTrack.id
    ? displayedCoverLayer.resource : undefined
  useArtworkResourceConsumer(matchingCoverResource)
  useArtworkResourceConsumer(previewCoverLayer?.resource)
  const disabled = !track
  const commandBusy = playback.isAudioBusy
    || playback.isSelectionPending
    || timeline.interaction === 'seeking'
    || playbackTransitionPending
    || playback.isTransportBusy

  const { viewportRef: swipeViewportRef, x: swipeX, highlight: swipeHighlight, preview: swipePreview, active: swipeActive, pageStride: swipePageStride, onClickCapture: onSwipeClickCapture } = usePlaylistControllerSwipe(playback, disabled || controllerHidden || selectionActive || !isPresent,
    requireCanvasPreview ? (token) => !token.track.coverFilePath && !token.track.coverImage && !token.artwork.coverFilePath && !token.artwork.coverImage
      || Boolean(previewCoverLayer?.previewTokenId === token.id && (previewCoverEmpty || previewCoverReady && previewCoverLayer.resource.view)) : undefined, commandBusy)
  function renderTrackRow(track: Track | null, artwork: TrackArtwork | null | undefined, playlistTrack: PlaylistTrackItemViewModel | undefined, neighbor = false) {
    const matchingArtwork = artwork?.id === track?.id ? artwork : undefined
    const matchingPlaylistTrack = playlistTrack?.id === track?.id ? playlistTrack : undefined
    // Never render a dangling separator: an unknown artist or album is simply
    // omitted instead of leaving `/` or `-` in the row.
    const trackMeta = track?.stream ? track.artist?.trim() || track.stream.url : [track?.artist?.trim(), track?.album?.trim()].filter(
      (part): part is string => Boolean(part),
    ).join('/')
    const imageFallback = matchingArtwork?.coverImageFallback ?? track?.coverImageFallback
    const imageSource = matchingArtwork?.coverImage ?? track?.coverImage ?? imageFallback
    const localArtwork = matchingPlaylistTrack?.hasLocalArtwork ?? Boolean(matchingArtwork?.coverFilePath ?? track?.coverFilePath)
    const coverThumbnail = matchingPlaylistTrack?.coverThumbnail
    const showImageSource = Boolean(imageSource)
    const canvasSource = neighbor
      ? previewCoverLayer && track && previewCoverLayer.track.id === track.id ? previewCoverLayer.resource.view : undefined
      : matchingCoverResource?.view
    // Mirrors the playlist card language: a real cover, a still-loading local
    // artwork slot, or no artwork at all.
    const resolvedEmpty = !neighbor && Boolean(displayedCoverLayer && displayedCoverLayer.track.id === track?.id && !displayedCoverLayer.resource.view)
    const coverState = resolvedEmpty ? 'empty' : canvasSource || coverThumbnail || showImageSource
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
            {canvasSource ? <ArtworkCanvas className="playlist-playback-cover-canvas" source={canvasSource} hidden
              onReady={neighbor ? onPreviewCoverReady : undefined} onError={neighbor ? onPreviewCoverError : undefined} /> : null}
            {!resolvedEmpty && !canvasSource && track && (coverThumbnail || showImageSource) ? (
              <PlaylistPlaybackCoverImage
                key={track.id}
                trackId={track.id}
                thumbnail={coverThumbnail}
                source={imageSource}
                fallbackSource={coverThumbnail ? imageSource ?? imageFallback : imageFallback}
              />
            ) : null}
            {coverState === 'empty' ? (
              <span className="playlist-playback-cover-mark">
                {track?.stream ? <span className="playlist-playback-stream-mark" style={{ maskImage: `url("${streamGlyph}")` }} /> : <systemIcons.music />}
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
            {track?.stream ? <span className="playlist-playback-stream-details">
              <span className="playlist-playback-stream-url" title={trackMeta}>{trackMeta}</span>
            </span> : track ? (trackMeta ? <span>{trackMeta}</span> : null) : <span>选择一首歌曲开始播放</span>}
          </motion.span></DockProjectionPresence>
        </button>
        <PressFeedbackButton
          key={swipeActive ? 'swiping' : 'resting'}
          className={cn(buttonVariants({ size: 'icon-lg', variant: 'ghost' }), 'playlist-playback-toggle')}
          tone="surface-variant"
          aria-label={dockVisualIsPlaying ? '暂停' : '播放'}
          aria-pressed={dockVisualIsPlaying}
          disabled={neighbor || disabled || commandBusy}
          onClick={onPlayToggle}
        >
          {dockVisualIsPlaying ? <systemIcons.pause aria-hidden="true" /> : <systemIcons.play aria-hidden="true" />}
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
    owners.members.set(dock, isPresent)
    if (isPresent) owners.owner = dock
    // Without a successor this is the return to the player: retain the outgoing
    // shared surface until its real presence cleanup, including its original fade.
    else if (owners.owner === dock) owners.owner = [...owners.members].findLast(([, present]) => present)?.[0] ?? dock
    publishDockOwner(shell, owners)
  }, [isPresent])

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
      style={{ y: controllerVisualY }}
      data-controller-hidden={controllerHidden && !selectionActive ? 'true' : undefined}
      data-selection-active={selectionActive ? 'true' : undefined}
      inert={controllerHidden && !selectionActive || !isPresent || undefined}
      aria-hidden={controllerHidden && !selectionActive || !isPresent || undefined}
      data-playback-command-busy={commandBusy && !disabled ? '' : undefined}
      data-playback-track-present={track ? '' : undefined}
      data-playback-stream={track?.stream ? '' : undefined}
      variants={appearanceMotion.variants.backdrop}
      initial="initial"
      animate="animate"
      exit="exit"
      onUpdate={(latest) => {
        if (contentRef.current && typeof latest.opacity === 'number') {
          contentRef.current.style.opacity = keepStationaryContent || readHandoff() ? '1' : String(latest.opacity)
        }
      }}
      aria-label={selectionActive ? '歌曲选择' : '当前播放'}
    >
      <DockProjectionPresence><motion.div
        key={sharedPlayerLayout ? 'player-background' : 'library-background'}
        className="controller-shared-background"
        layoutId={sharedPlayerLayout ? 'player-view-controller-background' : undefined}
        layoutCrossfade={!stationaryHandoff}
        transition={{ layout: layoutTransition }}
        aria-hidden="true"
        style={{ '--selection-playback-opacity': playbackOpacity } as MotionStyle}
      /></DockProjectionPresence>
      <motion.div className="playlist-selection-playback-layer"
        style={{ opacity: playbackOpacity }}
        inert={selectionActive || undefined} aria-hidden={selectionActive || undefined}>
      <div
        ref={contentRef}
        className="playlist-playback-content"
        style={{ opacity: appearanceMotion.disabled ? 1 : 0 }}
      >
      <div ref={swipeViewportRef} className="playlist-controller-swipe-viewport" data-swipe-active={swipeActive ? 'true' : undefined} onClickCapture={onSwipeClickCapture} onDragStart={(event) => event.preventDefault()}>
        {renderTrackRow(displayedTrack, displayedArtwork, displayedPlaylistTrack)}
        {swipePreview ? renderTrackRow(swipePreview.track, swipePreview.artwork, playlistTracks?.find((item) => item.id === swipePreview?.targetTrackId), true) : null}
      </div>

      <ProgressControl
        className="playlist-playback-progress"
        timeline={timeline}
        disabled={disabled || commandBusy}
        isPlaying={playback.isPlaying}
        showTimes={false}
        trackSwitchMotion={activeBookmarkMotion ? {
          key: activeBookmarkMotion.key,
          startRatio: activeBookmarkMotion.startRatio,
          endRatio: timeline.durationSeconds > 0 ? Math.min(1, Math.max(0, activeBookmarkMotion.targetPositionMs / 1000 / timeline.durationSeconds)) : 0,
          bookmark: true,
          durationSeconds: appearanceMotion.trackCardCommitDurationSeconds * appearance.motion.durationScale,
          ease: appearanceMotion.trackCardCommitEase,
          disabled: appearanceMotion.disabled,
          ready: activeBookmarkMotion.ready,
        } : activeSwitchKey && bookmarkSwitch.suppressedSelectionKey !== selectionKey ? {
          key: activeSwitchKey,
          startRatio: selectionIntent?.progressStartRatio ?? 0,
          durationSeconds: appearanceMotion.trackCardCommitDurationSeconds * appearance.motion.durationScale,
          ease: appearanceMotion.trackCardCommitEase,
          disabled: appearanceMotion.disabled,
          ready: selectionIntent?.source !== 'automatic' || !playback.isSelectionPending,
        } : undefined}
      />

      {/* Reset only the shortcut tooltips at the offscreen boundary. Keep the
          transport, progress interaction, and shared artwork nodes mounted. */}
      <nav key={controllerHidden ? 'hidden' : 'visible'} className="playlist-playback-nav" aria-label="播放列表快捷操作">
        <IconButton
          className={cn('playlist-playback-nav-button', homeSelected && 'is-active')}
          icon={Grid24Filled}
          label={searchOpen ? '返回来源页面' : '打开媒体库'}
          selected={homeSelected}
          aria-current={homeSelected ? 'page' : undefined}
          disabled={!onHome}
          onClick={onHome}
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
          className={cn('playlist-playback-nav-button', searchOpen && 'is-active')}
          icon={Search}
          label="搜索"
          selected={searchOpen}
          aria-current={searchOpen ? 'page' : undefined}
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
      </motion.div>
      <AnimatePresence initial={false}>
        {selectionActive && selection ? <SelectionPanel key={`selection-panel:${selection.scope}`} selection={selection} /> : null}
      </AnimatePresence>
    </motion.aside>
  )
}
