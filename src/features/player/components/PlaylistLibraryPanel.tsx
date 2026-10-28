import { CollectionQuickIndex } from './CollectionQuickIndex'
import { useCollectionEntryProjection } from '../hooks/useCollectionEntryProjection'
import { CollectionManagementHeader } from '@/features/player/components/CollectionManagementHeader'
import { LibraryRootMenu } from '@/features/player/components/LibraryRootMenu'
import { useCollectionManagementChrome } from '@/features/player/hooks/useCollectionManagementChrome'
import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { motion, useIsPresent } from 'motion/react'
import { LibraryDockContext, useLibraryDockBinding } from '@/features/player/hooks/useLibraryDockBinding'
import { usePlaylistControllerMotion } from '@/features/player/hooks/usePlaylistControllerMotion'
import type { PlaylistControllerMode } from '@/features/player/model/playlistControllerMode'
import { PlaylistActionButtons } from '@/features/player/components/PlaylistActionButtons'
import { getShuffleModePresentation, showPlaybackModeToast } from '@/features/player/components/playbackModePresentation'
import { appCopy } from '@/features/player/model/playerCopy'
import { useAllSongsRenderWindow } from '@/features/player/hooks/useAllSongsRenderWindow'
import { useAllSongsTileNavigation } from '@/features/player/hooks/useAllSongsTileNavigation'
import { usePlaylistSongReorder } from '@/features/player/hooks/usePlaylistSongReorder'
import { mergeFilteredSongOrder } from '@/features/player/model/manualSongOrderStorage'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { useAllSongsCoverUrl, useAllSongsWindow, type AllSongsCoverStore } from '@/features/player/hooks/useAllSongsWindow'
import { compareByQuickIndex } from '@/features/player/model/quickIndex'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistMetadataLoading } from '@/features/player/components/PlaylistPanel'
import { PLAYLIST_SONG_LAYOUTS, ALL_SONGS_LAYOUT_STORAGE_KEY, defaultAllSongsLevel } from '@/features/player/model/playlistSongLayouts'
import { PLAYLIST_MANAGEMENT_LAYOUTS, PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY, defaultPlaylistManagementLevel } from '@/features/player/model/playlistManagementLayouts'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LibraryCover, PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import type { AllSongsItem, PlayerPlaybackViewModel, PlayerPlaylistViewModel, PlayerTimelineViewModel } from '@/features/player/model/playerUiViewModel'
import type { PlaylistArtworkSource } from '@/features/player/model/playlistArtworkStore'
import moreIcon from '@/assets/playlist-library/94abf.svg'

const MANAGEMENT_LAYOUT_SELECTORS = {
  item: '[data-playlist-scope]', cover: '.playlist-management-cover', copy: '.playlist-management-copy',
  getId: (element: HTMLElement) => element.dataset.playlistScope,
}
const ALL_SONGS_LAYOUT_SELECTORS = {
  item: '[data-song-key]', cover: '.playlist-card-cover', copy: '.playlist-card-copy',
  getId: (element: HTMLElement) => element.dataset.songKey,
}
const MotionEmpty = motion.create(Empty)
type Props = {
  controllerMode?: PlaylistControllerMode
  entryPosition?: PlayerPlaylistViewModel['entryPosition']
  playlist: PlayerPlaylistViewModel
  allSongsCoverStore: AllSongsCoverStore
  librarySidebarOpen: boolean
  onLibrarySidebarOpenChange: (open: boolean) => void
  searchRequestId?: number
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  onPlayToggle: () => void
  onOpenPlayer: () => void
}

type AllSongsCardProps = {
  item: AllSongsItem
  index: number
  store: AllSongsCoverStore
  artworkSource?: PlaylistArtworkSource
  fallbackArtworkSource?: PlaylistArtworkSource
  current: boolean
  canActivate: boolean
  selectMode: boolean
  selected: boolean
  artworkVisible: boolean
  showExtendedMetadata: boolean
  coverFailed: boolean
  onCoverFailed: (key: string, source: string) => void
  onActivate: (key: string) => void
  onToggleSelect: (key: string) => void
  onEnterSelectMode?: (key: string) => void
}

// Covers are layered in the card from the artwork stores instead of being merged
// into the aggregated rows. The rows therefore keep their identity while covers
// arrive, and only the card whose own store entry changed re-renders.
const AllSongsCard = memo(function AllSongsCard({ item, index, store, artworkSource, fallbackArtworkSource, current,
  canActivate, selectMode, selected, artworkVisible, showExtendedMetadata, coverFailed, onCoverFailed, onActivate,
  onToggleSelect, onEnterSelectMode }: AllSongsCardProps) {
  const coverUrl = useAllSongsCoverUrl(store, item.key, item.trackId, item.sourcePath)
  const track = item.track
  const bitDepth = track.audioFormat?.bitDepth
  const hasFormat = Boolean((track.durationSeconds ?? 0) > 0 || track.fileExtension || (bitDepth != null && bitDepth >= 24))
  const contentShape = Number(Boolean(track.title)) | (Number(Boolean(track.artist)) << 1)
    | (Number(Boolean(track.artist || track.album)) << 2) | (Number(hasFormat) << 3)
  return <PlaylistCard songKey={item.key} track={track} index={index} coverUrl={coverUrl}
    artworkSource={artworkSource} fallbackArtworkSource={fallbackArtworkSource}
    current={current} unavailable={!item.available} canSelectUnavailable canActivate={canActivate}
    selectMode={selectMode} selected={selected} artworkVisible={artworkVisible}
    showExtendedMetadata={showExtendedMetadata} contentVisible contentRepresentative={false}
    contentShape={contentShape} coverFailed={coverFailed} onCoverFailed={onCoverFailed}
    onActivate={onActivate} onToggleSelect={onToggleSelect} onEnterSelectMode={onEnterSelectMode} />
})

export function PlaylistLibraryPanel({ playlist, entryPosition, allSongsCoverStore, librarySidebarOpen, onLibrarySidebarOpenChange, searchRequestId = 0, controllerMode = 'movable', timeline }: Props) {
  const appearanceMotion = useAppearanceMotion()
  const systemIcons = useSystemIcons()
  const MoreIcon = systemIcons.more
  const isPresent = useIsPresent()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const atomicOverview = chromeTransition.overviewBoundary
  const { offscreenEntry, sharedProjection, projectionKey, entryControls } = useCollectionEntryProjection(isPresent, chromeTransition.offscreenReturn)
  // Use a 250ms default, preserving theme scaling and the presence cleanup budget.
  const returnTransition = { ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.55) }
  const library = playlist.library!
  const categoryId = library.route?.view === 'category' ? library.route.categoryId : 'playlists'
  const category = mediaLibraryCategories.find((item) => item.id === categoryId)!
  const isSongs = categoryId === 'songs'
  const hasDataSource = isSongs || categoryId === 'playlists' || categoryId === 'folder'
  const categoryItems = useMemo(() => categoryId === 'playlists' ? library.items.filter((item) => item.sourceKind !== 'folder') : categoryId === 'folder' ? library.items.filter((item) => item.sourceKind === 'folder') : [], [categoryId, library.items])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dismissedSearchRequestId, setDismissedSearchRequestId] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [reorderPreviewKeys, setReorderPreviewKeys] = useState<readonly string[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [createError, setCreateError] = useState('')
  const playlistNameId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const songsListRef = useRef<HTMLDivElement | null>(null)
  const songsSpaceRef = useRef<HTMLDivElement | null>(null)
  const pendingSongFocus = useRef<string | null>(null)
  const handledEntryPositionId = useRef<number | null>(null)
  const pendingEntryPosition = useRef<{ requestId: number; cancelled: boolean } | null>(null)
  const managementPanelRef = useRef<HTMLElement | null>(null)
  const [failedSongCovers, setFailedSongCovers] = useState<ReadonlySet<string>>(new Set())
  const controllerActionsRef = useRef<HTMLDivElement | null>(null)
  const [toolbarPassed, setToolbarPassed] = useState(false)
  const dockContext = useContext(LibraryDockContext)
  const fallbackDockRef = useRef<HTMLElement | null>(null)
  const dockRouteKey = `category:${categoryId}`
  const managementChrome = useCollectionManagementChrome(categoryId, isPresent)
  const { toolbarRef, navigationMotion } = managementChrome
  const { layout, announcement } = useCollectionLayout({
    panelRef: managementPanelRef, gridRef, layouts: PLAYLIST_MANAGEMENT_LAYOUTS,
    storageKey: PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY,
    defaultLevel: defaultPlaylistManagementLevel, selectors: MANAGEMENT_LAYOUT_SELECTORS,
    gestureArea: 'panel',
    announce: (nextLayout) => `列表视图已切换为${nextLayout.label}`,
  })
  const { layout: songsLayout, announcement: songsAnnouncement } = useCollectionLayout({
    panelRef, gridRef: songsListRef, layouts: PLAYLIST_SONG_LAYOUTS,
    storageKey: ALL_SONGS_LAYOUT_STORAGE_KEY, defaultLevel: defaultAllSongsLevel,
    selectors: ALL_SONGS_LAYOUT_SELECTORS,
    announce: (nextLayout) => `歌曲视图已切换为${nextLayout.label}`,
  })
  const visible = useMemo(() => categoryItems
    .filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => compareByQuickIndex(left.name, right.name)), [categoryItems, query])
  // `library.allSongs` gets a fresh array whenever a row is republished (a cover,
  // a duration, a bit of metadata). The quick-index view is decided only by the
  // row keys and their titles, so keep the sorted key order while those are
  // unchanged instead of re-running `localeCompare` over the whole library.
  const songQuickIndexKey = useMemo(() => {
    const songs = library.allSongs ?? []
    let key = ''
    for (const item of songs) key += `${item.key}\u0001${item.track.title}\u0000`
    return key
  }, [library.allSongs])
  const orderedSongKeys = useMemo(() => {
    const songs = library.allSongs ?? []
    return [...songs].sort((left, right) => compareByQuickIndex(left.track.title, right.track.title)).map((item) => item.key)
    // The source array is intentionally not a dependency: only the key/title pair
    // above decides this order.
  }, [songQuickIndexKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const orderedSongs = useMemo(() => {
    const songs = library.allSongs ?? []
    if (library.allSongsManualOrder) return [...songs]
    const byKey = new Map(songs.map((item) => [item.key, item]))
    const ordered: AllSongsItem[] = []
    for (const key of orderedSongKeys) {
      const item = byKey.get(key)
      if (item) ordered.push(item)
    }
    // An unknown key would mean the caller replaced the list without changing the
    // quick-index fingerprint; never reorder silently on stale keys.
    return ordered.length === songs.length ? ordered
      : [...songs].sort((left, right) => compareByQuickIndex(left.track.title, right.track.title))
  }, [orderedSongKeys, library.allSongs, library.allSongsManualOrder])
  const visibleSongs = useMemo(() => orderedSongs
    .filter((item) => `${item.track.title} ${item.track.artist} ${item.track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [orderedSongs, query])
  const displayedSongs = useMemo(() => {
    if (!reorderPreviewKeys) return visibleSongs
    const byKey = new Map(visibleSongs.map(item => [item.key, item]))
    return reorderPreviewKeys.flatMap(key => { const item = byKey.get(key); return item ? [item] : [] })
  }, [visibleSongs, reorderPreviewKeys])
  const songsWindow = useAllSongsRenderWindow(displayedSongs.length, songsLayout, panelRef, songsListRef, songsSpaceRef, library.allSongsMetadataStatus === 'loading')
  const renderedSongs = useMemo(() => displayedSongs.slice(songsWindow.first, songsWindow.end), [displayedSongs, songsWindow.first, songsWindow.end])
  useLayoutEffect(() => {
    if (!isSongs || !entryPosition || !isPresent) return
    const panel = panelRef.current
    if (!panel) return
    if (handledEntryPositionId.current !== entryPosition.requestId) {
      handledEntryPositionId.current = entryPosition.requestId
      pendingEntryPosition.current = { requestId: entryPosition.requestId, cancelled: false }
    }
    const pending = pendingEntryPosition.current
    if (!pending || pending.cancelled || pending.requestId !== entryPosition.requestId) return
    if (entryPosition.target === 'top') {
      panel.scrollTo({ top: 0, behavior: 'instant' })
      pendingEntryPosition.current = null
      return
    }
    if (library.allSongsMetadataStatus === 'loading') return
    const index = visibleSongs.findIndex(item => item.trackId === playlist.currentTrackId)
    if (index < 0) { pendingEntryPosition.current = null; return }
    const card = [...(songsListRef.current?.querySelectorAll<HTMLElement>('[data-playlist-track-id]') ?? [])]
      .find(item => item.dataset.playlistTrackId === playlist.currentTrackId)
    if (!card) {
      const space = songsSpaceRef.current
      if (songsWindow.enabled && space) {
        panel.scrollTop += space.getBoundingClientRect().top - panel.getBoundingClientRect().top
          + Math.floor(index / songsLayout.columns) * songsWindow.stride
      }
      return
    }
    const panelRect = panel.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    panel.scrollTop += cardRect.top - panelRect.top - (panel.clientHeight - cardRect.height) / 2
    pendingEntryPosition.current = null
  }, [entryPosition, isPresent, isSongs, library.allSongsMetadataStatus, playlist.currentTrackId,
    visibleSongs, songsWindow.enabled, songsWindow.first, songsWindow.end, songsWindow.stride, songsLayout.columns])
  useEffect(() => {
    const panel = panelRef.current
    if (!isSongs || !panel) return
    const cancel = () => { if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true }
    panel.addEventListener('wheel', cancel, { passive: true })
    panel.addEventListener('pointerdown', cancel, { passive: true })
    panel.addEventListener('touchstart', cancel, { passive: true })
    panel.addEventListener('keydown', cancel)
    return () => {
      panel.removeEventListener('wheel', cancel)
      panel.removeEventListener('pointerdown', cancel)
      panel.removeEventListener('touchstart', cancel)
      panel.removeEventListener('keydown', cancel)
    }
  }, [isSongs])
  useLayoutEffect(() => {
    if (!pendingSongFocus.current) return
    const target = Array.from(songsListRef.current?.querySelectorAll<HTMLElement>('[data-song-key]') ?? []).find(row => row.dataset.songKey === pendingSongFocus.current)
    if (target) { target.focus({ preventScroll: true }); pendingSongFocus.current = null }
  }, [renderedSongs])
  const tileInitial = navigationMotion.cover.initial as { x: string; scale: number; opacity: number }
  const tileEase = navigationMotion.transition.ease
  useAllSongsTileNavigation(songsListRef, panelRef, isSongs && songsLayout.flow === 'tile' && atomicOverview && !appearanceMotion.disabled,
    library.allSongsMetadataStatus !== 'loading', isPresent, `translateX(${tileInitial.x}) scale(${tileInitial.scale})`, tileInitial.opacity,
    navigationMotion.transition.duration ?? 0, Array.isArray(tileEase) ? `cubic-bezier(${tileEase.join(',')})` : 'ease')
  const coverStore = useAllSongsWindow(visibleSongs, panelRef, songsListRef,
    isSongs && songsLayout.showArtwork, library.allSongsMetadataStatus === 'loading', allSongsCoverStore, 8, renderedSongs)
  const fullReorderKeys = useMemo(() => orderedSongs.map(item => item.key), [orderedSongs])
  const reorderSourceVersion = useMemo(() => JSON.stringify(fullReorderKeys), [fullReorderKeys])
  const visibleReorderKeys = useMemo(() => visibleSongs.map(item => item.key), [visibleSongs])
  const songReorder = usePlaylistSongReorder({
    enabled: isSongs && selectMode && isPresent && library.allSongsMetadataStatus !== 'loading' && !playlist.isOpenAudioDisabled
      && !library.isDeletePending && Boolean(library.onReorderSongs),
    scopeKey: 'all-songs', sourceVersion: reorderSourceVersion, layoutKey: `${songsLayout.level}:${query}:${searchOpen}:${searchRequestId}:${dismissedSearchRequestId}`,
    orderedKeys: visibleReorderKeys, selectedKeys: selected, gridRef: songsListRef, scrollRef: panelRef,
    onPreview: setReorderPreviewKeys,
    onCommit: async draft => {
      const orderedKeys = mergeFilteredSongOrder(fullReorderKeys, draft.expectedKeys, draft.orderedKeys)
      return orderedKeys && library.onReorderSongs ? library.onReorderSongs({ scope: null, expectedKeys: fullReorderKeys, orderedKeys })
        : { ok: false, errorMessage: '列表已更改，请重新拖动排序。' }
    },
    retainArtwork: key => {
      const releases = [coverStore.retain(key)]
      const item = orderedSongs.find(song => song.key === key)
      if (item) for (const source of [playlist.artworkSource, playlist.fallbackArtworkSource]) {
        const resourceKey = source?.keyByTrackId.get(item.trackId)
        if (source && resourceKey) releases.push(source.store.retain(resourceKey))
      }
      return () => { for (const release of releases.reverse()) release() }
    },
  })
  const songsByKey = useMemo(() => new Map(visibleSongs.map((item) => [item.key, item])), [visibleSongs])
  const songActionsRef = useRef({ songsByKey, visibleSongs, onPlaySong: library.onPlaySong })
  useLayoutEffect(() => { songActionsRef.current = { songsByKey, visibleSongs, onPlaySong: library.onPlaySong } }, [songsByKey, visibleSongs, library.onPlaySong])
  const handleSongActivate = useCallback((key: string) => {
    const item = songActionsRef.current.songsByKey.get(key)
    if (item) songActionsRef.current.onPlaySong?.(item.scope, item.trackId,
      songActionsRef.current.visibleSongs.map(({ scope, trackId }) => ({ scope, trackId })))
  }, [])
  const handleSongToggleSelect = useCallback((key: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])
  const handleSongEnterSelectMode = useCallback((key: string) => {
    setSelectMode(true)
    setSelected((previous) => previous.has(key) ? previous : new Set(previous).add(key))
  }, [])
  const handleSongCoverFailed = useCallback((key: string) => {
    setFailedSongCovers((previous) => {
      if (previous.has(key)) return previous
      return new Set(previous).add(key)
    })
  }, [])
  // Jump targets and the play/shuffle candidates are derived from the list, not
  // from the scroll window; keep them off the render path so a window step does
  // not rescan the whole library.
  const selectedItems = visible.filter((item) => selected.has(item.scope))
  const playTarget = selectMode ? selectedItems[0] : visible[0]
  const selectedSongs = useMemo(() => (library.allSongs ?? []).filter((item) => selected.has(item.key) && item.available)
    .sort((left, right) => compareByQuickIndex(left.track.title, right.track.title)), [library.allSongs, selected])
  const playableSongs = useMemo(() => visibleSongs.filter((item) => item.available), [visibleSongs])
  const songPlayTarget = selectMode ? selectedSongs[0] : playableSongs[0]
  // An in-flight playback command locks interaction; it is not unavailability.
  const playbackCommandLocked = Boolean(playlist.isOpenAudioDisabled)
  useEffect(() => {
    if (searchRequestId > 0) {
      if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true
      // Focus after the input has mounted, with no timing-dependent delay.
      searchRef.current?.focus()
    }
  }, [searchRequestId, searchOpen])
  const showSearch = hasDataSource && (searchOpen || searchRequestId > dismissedSearchRequestId)
  const controllerActive = isSongs && isPresent && dockContext?.activeRouteKey === dockRouteKey
  const controllerMotion = usePlaylistControllerMotion(panelRef, dockContext?.dockRef ?? fallbackDockRef,
    controllerMode, selectMode || timeline.interaction === 'seeking' || timeline.interaction === 'previewing',
    `${songsLayout.level}:${query}:${visibleSongs.length}:${showSearch}:${selectMode}`,
    toolbarPassed, appearanceMotion.layoutTransition, controllerActive)
  const rebaseController = controllerMotion.rebase
  useLayoutEffect(() => { if (isSongs && selectMode && isPresent) rebaseController({ reveal: true }) }, [isSongs, selectMode, isPresent, rebaseController])
  useLayoutEffect(() => {
    if (controllerActive && showSearch) rebaseController({ reveal: true })
  }, [controllerActive, showSearch, rebaseController])
  useLayoutEffect(() => {
    const panel = panelRef.current, toolbar = toolbarRef.current
    if (!controllerActive || !panel || !toolbar) return
    const measure = () => {
      const rect = toolbar.getBoundingClientRect()
      const passed = rect.height > 0 && rect.bottom <= Math.max(0, panel.getBoundingClientRect().top)
      if (!passed && controllerActionsRef.current?.contains(document.activeElement)) {
        const buttons = [...controllerActionsRef.current.querySelectorAll('button')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const target = index > 0 ? toolbar.querySelectorAll('button')[index - 1] : null
        if (target && !target.disabled) target.focus({ preventScroll: true })
        else panel.focus({ preventScroll: true })
      }
      setToolbarPassed(previous => previous === passed ? previous : passed)
    }
    measure()
    const intersection = new IntersectionObserver(measure, { root: panel, threshold: 0 })
    intersection.observe(toolbar)
    const resize = new ResizeObserver(measure)
    resize.observe(panel); resize.observe(toolbar)
    panel.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      intersection.disconnect(); resize.disconnect()
      panel.removeEventListener('scroll', measure); window.removeEventListener('resize', measure)
    }
  }, [controllerActive, songsLayout.level, showSearch, selectMode, toolbarRef])
  const sidebarProps = {
    playlistName: '', trackCount: 0, totalClock: null,
    library: { ...library,
      onSelect: (scope: string) => { onLibrarySidebarOpenChange(false); library.onSelect(scope) },
      onOpen: () => { onLibrarySidebarOpenChange(false); library.onOpen() },
      onSelectCategory: (id: typeof categoryId) => { onLibrarySidebarOpenChange(false); library.onSelectCategory?.(id) },
    },
    onCurrentPlaylist: library.onOpen,
  }
  function activate(scope: string) {
    if (!selectMode) { library.onSelect(scope); return }
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(scope)) next.delete(scope); else next.add(scope)
      return next
    })
  }
  function toggleSearch() {
    if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true
    if (showSearch) {
      setQuery('')
      setSearchOpen(false)
      setDismissedSearchRequestId(searchRequestId)
    } else {
      setSearchOpen(true)
      queueMicrotask(() => searchRef.current?.focus())
    }
  }
  const quickIndexNames = useMemo(() => isSongs ? displayedSongs.map(item => item.track.title) : visible.map(item => item.name), [isSongs, displayedSongs, visible])
  function jumpToIndex(key: string, index: number | undefined) {
    if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true
    const panel = panelRef.current
    if (!panel) return
    if (key === 'top') {
      panel.scrollTop = 0
      return
    }
    if (isSongs && songsWindow.enabled && index !== undefined && songsSpaceRef.current) {
      panel.scrollTop += songsSpaceRef.current.getBoundingClientRect().top - panel.getBoundingClientRect().top + Math.floor(index / songsLayout.columns) * songsWindow.stride
      return
    }
    const card = index === undefined ? null : (isSongs ? songsListRef.current : gridRef.current)?.children.item(index)
    if (!card) return
    panel.scrollTop += card.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8
  }
  const playSongs = useCallback(() => {
    const candidates = selectMode ? selectedSongs : playableSongs
    const target = candidates[0]
    if (target) library.onPlaySong?.(target.scope, target.trackId,
      candidates.map(({ scope, trackId }) => ({ scope, trackId })))
  }, [selectMode, selectedSongs, playableSongs, library])
  const shufflePresentation = getShuffleModePresentation('shuffle-all', systemIcons)
  const shuffleSongs = useCallback(async () => {
    if (playbackCommandLocked || library.allSongsMetadataStatus === 'loading' || !library.onShufflePlay) return
    const candidates = selectMode ? selectedSongs : playableSongs
    if (!candidates.length) return
    const succeeded = await library.onShufflePlay(candidates.map(({ scope, trackId }) => ({ scope, trackId })))
    if (succeeded) showPlaybackModeToast({ ...getShuffleModePresentation('shuffle-all', systemIcons),
      label: `${appCopy.controls.shuffle} · ${appCopy.controls.playAllCategories}` }, { replay: true })
  }, [playbackCommandLocked, library, selectMode, selectedSongs, playableSongs, systemIcons])
  const playListsRandomly = useCallback(() => {
    const candidates = selectMode ? selectedItems : visible
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    if (target) library.onPlay(target.scope)
  }, [selectMode, selectedItems, visible, library])
  function toggleSelection() { setSelectMode(!selectMode); setSelected(new Set()) }
  function openCreatePlaylist() { setPlaylistName(''); setCreateError(''); setCreateOpen(true) }
  function renderMore(compact = false) {
    if (!compact) return <LibraryRootMenu key={categoryId} categoryId={categoryId} library={library} />
    return <DropdownMenu>
      <DropdownMenuTrigger render={<Button className={compact ? 'playlist-hero-icon playlist-hero-more-button' : 'playlist-management-more'}
        variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'default'} aria-label="更多列表操作">
        {compact ? <MoreIcon aria-hidden="true" /> : <img src={moreIcon} alt="" />}
      </Button>} />
      <DropdownMenuContent align="end"><DropdownMenuGroup>
        <DropdownMenuItem disabled={library.isImportPending} onClick={library.onSelectFolders}>选择文件夹</DropdownMenuItem>
        <DropdownMenuItem disabled={library.isImportPending} onClick={library.onImportPlaylist}>导入 M3U8 播放列表</DropdownMenuItem>
        <DropdownMenuItem disabled={isSongs ? !visibleSongs.length : !visible.length} onClick={() => { setSelectMode(true); setSelected(new Set(isSongs ? visibleSongs.map((item) => item.key) : visible.map((item) => item.scope))) }}>选择全部可见{isSongs ? '歌曲' : '列表'}</DropdownMenuItem>
        {isSongs ? <DropdownMenuItem disabled={!selectMode || !selected.size || !library.onCreatePlaylist} onClick={openCreatePlaylist}>新建播放列表</DropdownMenuItem> : null}
      </DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu>
  }
  useLibraryDockBinding(dockRouteKey, { searchOpen: showSearch, onSearchToggle: hasDataSource ? toggleSearch : undefined,
    controllerOffsetY: isSongs ? controllerMotion.offsetY : undefined,
    controllerHidden: isSongs ? selectMode ? false : controllerMotion.hidden : undefined,
    selection: isSongs ? {
      scope: null,
      active: selectMode, count: selected.size, total: library.allSongs?.length ?? 0,
      allSelected: visibleSongs.length > 0 && visibleSongs.every(item => selected.has(item.key)),
      canSelectAll: visibleSongs.length > 0,
      canPlay: Boolean(selectedSongs.length && library.onPlaySong && !playbackCommandLocked),
      canCreatePlaylist: Boolean(library.onCreatePlaylist),
      canDelete: Boolean(library.onDeleteSongs && selected.size && !playbackCommandLocked && !library.isDeletePending),
      canAddToPlaylist: Boolean(library.onPreparePlaylistAdd && library.onAddToPlaylist && selected.size && !playbackCommandLocked && !library.isDeletePending),
      onPrepareAddToPlaylist: () => library.onPreparePlaylistAdd?.({ scope: null, songKeys: Object.freeze([...selected]) }),
      onRefreshAddToPlaylist: library.onPreparePlaylistAdd,
      onAddToPlaylist: library.onAddToPlaylist,
      onRemoveFromPlaylist: library.onRemoveFromPlaylist,
      onCreateAddPlaylist: library.onCreateAddPlaylist,
      onOpenPlaylistTarget: library.onSelect,
      onPrepareDelete: () => library.onDeleteSongs && selected.size ? {
        scope: null, songKeys: Object.freeze([...selected]), canRemoveFromList: false,
      } : undefined,
      onDelete: library.onDeleteSongs ? async (snapshot, mode) => {
        const result = await library.onDeleteSongs!(snapshot, mode)
        setSelected(previous => new Set([...previous].filter(key => !result.succeededKeys.includes(key))))
        return result
      } : undefined,
      onSelectAll: () => setSelected(previous => {
        const next = new Set(previous)
        const all = visibleSongs.length > 0 && visibleSongs.every(item => previous.has(item.key))
        for (const item of visibleSongs) { if (all) next.delete(item.key); else next.add(item.key) }
        return next
      }),
      onClear: () => setSelected(new Set()),
      onExit: () => { setSelectMode(false); setSelected(new Set()) },
      onPlay: () => { if (selectedSongs.length && !playbackCommandLocked) playSongs() },
      onCreatePlaylist: openCreatePlaylist,
    } : undefined,
  })
  return <motion.div className="playlist-management" data-select-mode={selectMode || undefined}
    inert={!isPresent || undefined} aria-hidden={!isPresent || undefined}>
    <PlaylistLibrarySidebar {...sidebarProps} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}>
      <DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" style={{ translate: '0 0' }} aria-describedby={undefined}>
        <DialogTitle className="sr-only">媒体库</DialogTitle>
        <PlaylistLibrarySidebar {...sidebarProps} overlay />
      </DialogContent>
    </Dialog>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent>
        <form onSubmit={(event) => {
          event.preventDefault()
          const scope = library.onCreatePlaylist?.(playlistName, [...selected])
          if (!scope) { setCreateError('请填写名称并选择曲库中的歌曲。'); return }
          setCreateOpen(false)
          setSelectMode(false)
          setSelected(new Set())
          library.onSelect(scope)
        }} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>新建播放列表</DialogTitle><DialogDescription>将已选择的 {selected.size} 首歌曲加入清单。播放列表仅在本次会话中保留。</DialogDescription></DialogHeader>
          <FieldGroup><Field data-invalid={Boolean(createError)}><FieldLabel htmlFor={playlistNameId}>播放列表名称</FieldLabel><Input id={playlistNameId} autoFocus value={playlistName} aria-invalid={Boolean(createError)} maxLength={120} onChange={(event) => { setPlaylistName(event.target.value); setCreateError('') }} />{createError ? <FieldError>{createError}</FieldError> : null}</Field></FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" disabled={!playlistName.trim() || !selected.size}>创建</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <motion.section ref={(node) => { panelRef.current = node; managementPanelRef.current = isSongs ? null : node }} className="playlist-management-content" tabIndex={-1} aria-label={`${category.label}管理`}
      data-metadata-loading={isSongs && library.allSongsMetadataStatus === 'loading' || undefined}
      variants={offscreenEntry ? navigationMotion.detailReturn.incoming : appearanceMotion.variants.backdrop}
      transition={offscreenEntry ? navigationMotion.transition : atomicOverview ? { duration: 0 } : returnTransition}
      initial={atomicOverview ? false : 'initial'} animate={offscreenEntry ? entryControls : 'animate'} exit={atomicOverview ? 'animate' : 'exit'}>
      <CollectionManagementHeader chrome={managementChrome} category={category} title={isSongs ? '全部歌曲' : category.label}
        sharedProjection={sharedProjection} onOverview={library.onOpenOverview} actionsScope={library.currentScope}
        returnTransition={returnTransition} more={renderMore()} hideActions={isSongs && selectMode}
        actions={hasDataSource ? {
          shuffleLabel: `随机播放${category.label}`, playbackLocked: playbackCommandLocked,
          shuffleDisabled: isSongs ? !songPlayTarget || !library.onShufflePlay || playlist.isOpenAudioDisabled || library.allSongsMetadataStatus === 'loading' : !playTarget || playlist.isOpenAudioDisabled,
          onShuffle: () => { if (isSongs) void shuffleSongs(); else playListsRandomly() },
          playLabel: `播放${category.label}`,
          playDisabled: isSongs ? !songPlayTarget || !library.onPlaySong || playlist.isOpenAudioDisabled : !playTarget || playlist.isOpenAudioDisabled,
          onPlay: () => { if (isSongs) playSongs(); else if (playTarget) library.onPlay(playTarget.scope) },
          searchLabel: `搜索${category.label}`, searchOpen: showSearch,
          onSearch: () => { if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true; setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()) },
          selectMode, selectDisabled: isSongs ? !(library.allSongs?.length) : !categoryItems.length,
          onSelect: toggleSelection, selectedCount: selected.size,
          extra: isSongs && selectMode ? <Button variant="outline" disabled={!selected.size || !library.onCreatePlaylist} onClick={openCreatePlaylist}>新建播放列表</Button> : undefined,
        } : undefined} />
      {showSearch ? <motion.div className="playlist-management-search" variants={navigationMotion.chrome}
        initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><Input ref={searchRef} type="search" aria-label={isSongs ? '搜索歌曲标题、艺术家或专辑' : `搜索${category.label}名称`} placeholder={isSongs ? '搜索歌曲' : `搜索${category.label}`} value={query} onChange={(event) => { if (pendingEntryPosition.current) pendingEntryPosition.current.cancelled = true; setQuery(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedSearchRequestId(searchRequestId) } }} /></motion.div> : null}
      <span className="sr-only" role="status" aria-live="polite">{isSongs ? songsAnnouncement : announcement}</span>
      {isSongs ? (library.allSongsMetadataStatus === 'loading' ? <PlaylistMetadataLoading layout={songsLayout} trackCount={library.allSongs?.length ?? 0} /> : visibleSongs.length ? <div ref={songsSpaceRef} style={songsWindow.spaceStyle}><p className="sr-only" aria-live="polite">{songReorder.announcement}</p><motion.div ref={songsListRef} className="playlist-grid all-songs-list" aria-label="全部歌曲列表"
        onPointerDownCapture={songReorder.onPointerDownCapture} onClickCapture={songReorder.onClickCapture} onKeyDownCapture={songReorder.onKeyDownCapture}
        data-layout-level={songsLayout.level} data-layout-flow={songsLayout.flow} data-layout-columns={songsLayout.columns}
        data-content-window={songsWindow.enabled ? 'bounded' : 'full'} data-cover-motion={appearanceMotion.disabled ? 'off' : undefined}
        variants={songsLayout.flow === 'tile' ? undefined : navigationMotion.cover} initial={atomicOverview && songsLayout.flow !== 'tile' ? 'initial' : false} animate="animate" exit={atomicOverview && songsLayout.flow !== 'tile' ? 'exit' : 'animate'} transition={navigationMotion.transition}
        onKeyDown={(event) => {
          if (!songsWindow.enabled || event.key !== 'Tab') return
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-song-key]')
          if (!row) return
          const index = visibleSongs.findIndex(item => item.key === row.dataset.songKey)
          const direction = event.shiftKey ? -1 : 1
          let next = index + direction
          while (next >= 0 && next < visibleSongs.length && !selectMode && (!visibleSongs[next].available || playlist.isOpenAudioDisabled)) next += direction
          if (next < 0 || next >= visibleSongs.length || (next >= songsWindow.first && next < songsWindow.end)) return
          event.preventDefault()
          const panel = panelRef.current, space = songsSpaceRef.current
          if (!panel || !space) return
          pendingSongFocus.current = visibleSongs[next].key
          panel.scrollTop += space.getBoundingClientRect().top - panel.getBoundingClientRect().top + Math.floor(next / songsLayout.columns) * songsWindow.stride
        }}
        style={{ ...songsLayout.style, touchAction: 'pan-y', transformOrigin: 'left top', ...songsWindow.gridStyle }}>
        {renderedSongs.map((item, index) => <AllSongsCard key={item.key} item={item} index={songsWindow.first + index} store={coverStore}
            artworkSource={playlist.artworkSource} fallbackArtworkSource={playlist.fallbackArtworkSource}
            current={item.trackId === playlist.currentTrackId}
            canActivate={!playlist.isOpenAudioDisabled}
            selectMode={selectMode} selected={selected.has(item.key)}
            artworkVisible={songsLayout.showArtwork} showExtendedMetadata={songsLayout.flow !== 'tile'}
            coverFailed={failedSongCovers.has(item.key)}
            onCoverFailed={handleSongCoverFailed}
            onActivate={handleSongActivate}
            // Deliberately independent of `useIsPresent`: that flips on the frame
            // this panel starts leaving, which would invalidate every rendered
            // card's memo on the exit animation's first frame. Long-press still
            // cannot enter selection mode while leaving; the section is `inert`.
            onToggleSelect={handleSongToggleSelect} onEnterSelectMode={handleSongEnterSelectMode} />)}
      </motion.div></div> : <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={false} animate="animate"><EmptyHeader><EmptyTitle>{(library.allSongs?.length ?? 0) ? '没有匹配的歌曲' : '暂无歌曲'}</EmptyTitle><EmptyDescription>{(library.allSongs?.length ?? 0) ? '尝试其他名称，或清空搜索。' : '选择音乐文件夹后，这里会汇总其中及子文件夹内的歌曲；不会自动创建播放列表。下次启动会重新扫描。'}</EmptyDescription></EmptyHeader><Button disabled={library.isImportPending} onClick={(library.allSongs?.length ?? 0) ? () => setQuery('') : library.onSelectFolders}>{(library.allSongs?.length ?? 0) ? '清空搜索' : '选择文件夹'}</Button></MotionEmpty>) : categoryId === 'playlists' && library.isPlaylistRestorePending && !visible.length ? <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>正在恢复播放列表</EmptyTitle><EmptyDescription>正在读取已保存的 M3U8 清单。</EmptyDescription></EmptyHeader></Empty> : visible.length ? <div ref={gridRef} className="playlist-management-grid"
        data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-artwork={layout.showArtwork}
        aria-label={layout.label} style={{ ...layout.style, touchAction: 'pan-y' }}>
        {visible.map((item) => <motion.div key={item.scope} className="playlist-management-card"
          variants={navigationMotion.cover} style={{ transformOrigin: 'left top' }}
          initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
            <Button variant="ghost" className="playlist-management-card-button" data-playlist-scope={item.scope}
              aria-label={selectMode ? `选择 ${item.name}` : `打开${category.label} ${item.name}`}
              aria-pressed={selectMode ? selected.has(item.scope) : undefined} onClick={() => activate(item.scope)}>
              <motion.span key={`cover:${projectionKey}`} className="playlist-management-cover" aria-hidden="true"
                layoutDependency={item.scope}
                layoutId={sharedProjection ? `playlist-library-cover:${item.scope}` : undefined}
                layoutCrossfade={false}
                transition={{ layout: returnTransition }} data-library-cover-source={item.coverSourcePath}><LibraryCover coverTrack={item.coverTrack} />{selectMode ? <span className="playlist-management-check">{selected.has(item.scope) ? '✓' : ''}</span> : null}</motion.span>
              <span className="playlist-management-copy">
              <motion.span key={`name:${projectionKey}`} className="playlist-management-name" title={item.name}
                layoutDependency={item.scope}
                layout={sharedProjection ? 'position' : undefined}
                layoutId={sharedProjection ? `playlist-library-name:${item.scope}` : undefined}
                transition={{ layout: returnTransition }}>{item.name}</motion.span>
              <span className="playlist-management-meta"><span className="playlist-management-meta-icon" aria-hidden="true" /><span>{item.trackCount}{item.totalClock ? ` | ${item.totalClock}` : ''}</span></span>
              </span>
            </Button>
        </motion.div>)}
      </div> : <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{!hasDataSource ? `${category.label}尚未接入数据` : categoryItems.length ? `没有匹配的${category.label}` : `暂无${category.label}`}</EmptyTitle><EmptyDescription>{!hasDataSource ? '此分类的数据管理能力尚未接入。可返回媒体库浏览已导入的列表。' : categoryItems.length ? '尝试其他名称，或清空搜索。' : categoryId === 'folder' ? '导入本地音频文件夹后，可在这里浏览；下次启动会重新扫描。M3U8 列表显示在播放列表分类。' : '导入 M3U8 后会自动保存，重启可继续使用；从全部歌曲新建的播放列表仅在本次会话中保留。'}</EmptyDescription></EmptyHeader><Button disabled={library.isImportPending} onClick={!hasDataSource ? library.onOpen : categoryItems.length ? () => setQuery('') : categoryId === 'folder' ? library.onSelectFolders : library.onImportPlaylist}>{!hasDataSource ? '打开播放列表' : categoryItems.length ? '清空搜索' : categoryId === 'folder' ? '选择文件夹' : '导入 M3U8 播放列表'}</Button></MotionEmpty>}
    </motion.section>
    {isSongs ? <motion.div ref={controllerActionsRef} className="playlist-hero-actions playlist-controller-actions"
      role="group" aria-label="全部歌曲操作"
      data-selection-hidden={selectMode || undefined}
      aria-hidden={selectMode || !toolbarPassed || !controllerActive || undefined} inert={selectMode || !toolbarPassed || !controllerActive || undefined}
      data-actions-visible={String(toolbarPassed && controllerActive)}
      variants={appearanceMotion.variants.controllerActions} initial="hidden"
      animate={toolbarPassed && controllerActive ? 'visible' : 'hidden'}
      transition={appearanceMotion.layoutTransition} style={{ y: controllerMotion.offsetY }}>
      <PlaylistActionButtons compact onBack={library.onOpenOverview}
        shuffle={{ ...shufflePresentation, label: '随机播放全部歌曲' }}
        onShuffle={() => { void shuffleSongs() }} shuffleDisabled={!songPlayTarget || !library.onShufflePlay || playbackCommandLocked || library.allSongsMetadataStatus === 'loading'}
        onPlay={() => playSongs()} playDisabled={!songPlayTarget || !library.onPlaySong || playbackCommandLocked} playbackLocked={playbackCommandLocked}
        searchOpen={showSearch} onSearch={toggleSearch}
        selectMode={selectMode} onSelect={toggleSelection} selectDisabled={!library.allSongs?.length}
        more={renderMore(true)} />
    </motion.div> : null}
    <CollectionQuickIndex panelRef={panelRef} names={quickIndexNames} label={isSongs ? '歌曲' : category.label} onJump={jumpToIndex} />
  </motion.div>
}
