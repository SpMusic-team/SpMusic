import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { motion, useAnimationControls, useIsPresent } from 'motion/react'
import { useLibraryDockBinding } from '@/features/player/hooks/useLibraryDockBinding'
import { readLibraryLayoutRect } from '@/features/player/model/libraryNavigationGeometry'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { useAllSongsCoverUrl, useAllSongsWindow, type AllSongsCoverStore } from '@/features/player/hooks/useAllSongsWindow'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistMetadataLoading } from '@/features/player/components/PlaylistPanel'
import { PLAYLIST_SONG_LAYOUTS, ALL_SONGS_LAYOUT_STORAGE_KEY, defaultAllSongsLevel } from '@/features/player/model/playlistSongLayouts'
import { PLAYLIST_MANAGEMENT_LAYOUTS, PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY, defaultPlaylistManagementLevel } from '@/features/player/model/playlistManagementLayouts'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LibraryCover, PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import type { AllSongsItem, PlayerPlaybackViewModel, PlayerPlaylistViewModel, PlayerTimelineViewModel } from '@/features/player/model/playerUiViewModel'
import musicLarge from '@/assets/playlist-library/e5527.svg'
import musicSmall from '@/assets/playlist-library/de6be.svg'
import parentIcon from '@/assets/playlist-library/2d425.svg'
import shuffleIcon from '@/assets/playlist-library/ce103.svg'
import playIcon from '@/assets/playlist-library/a31d0.svg'
import searchIcon from '@/assets/playlist-library/514fd.svg'
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
const QUICK_INDEX_KEYS = ['0', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const
const QUICK_INDEX_COUNT = QUICK_INDEX_KEYS.length + 1

function quickIndexKey(name: string): string {
  const trimmed = name.trimStart()
  const firstCode = trimmed.charCodeAt(0)
  if (firstCode >= 65 && firstCode <= 90) return trimmed.charAt(0)
  if (firstCode >= 97 && firstCode <= 122) return String.fromCharCode(firstCode - 32)
  if (firstCode >= 48 && firstCode <= 64) return '0'
  if (firstCode >= 33 && firstCode <= 47) return 'top'
  return '#'
}

function compareByQuickIndex(left: string, right: string): number {
  const leftKey = quickIndexKey(left)
  const rightKey = quickIndexKey(right)
  const order = (key: string) => key === 'top' ? -1 : key === '0' ? 0 : key === '#' ? 27 : key.charCodeAt(0) - 64
  const group = order(leftKey) - order(rightKey)
  if (!group && leftKey === 'top') {
    const leftName = left.trimStart()
    const rightName = right.trimStart()
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0
  }
  if (!group && leftKey === '0') {
    const leftCode = left.trimStart().charCodeAt(0)
    const rightCode = right.trimStart().charCodeAt(0)
    const leftIsDigit = leftCode <= 57
    const rightIsDigit = rightCode <= 57
    if (leftIsDigit !== rightIsDigit) return leftIsDigit ? -1 : 1
  }
  if (!group && leftKey === '#') {
    const leftCode = left.trimStart().charCodeAt(0)
    const rightCode = right.trimStart().charCodeAt(0)
    const leftIsAscii = leftCode <= 127
    const rightIsAscii = rightCode <= 127
    if (leftIsAscii !== rightIsAscii) return leftIsAscii ? -1 : 1
  }
  return group || left.localeCompare(right, undefined, { numeric: true })
}

type Props = {
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
}

const AllSongsCard = memo(function AllSongsCard({ item, index, store, current, canActivate, selectMode, selected,
  artworkVisible, showExtendedMetadata, coverFailed, onCoverFailed, onActivate, onToggleSelect }: AllSongsCardProps) {
  const coverUrl = useAllSongsCoverUrl(store, item.key, item.trackId, item.sourcePath)
  const track = item.track
  const bitDepth = track.audioFormat?.bitDepth
  const hasFormat = Boolean((track.durationSeconds ?? 0) > 0 || track.fileExtension || (bitDepth != null && bitDepth >= 24))
  const contentShape = Number(Boolean(track.title)) | (Number(Boolean(track.artist)) << 1)
    | (Number(Boolean(track.artist || track.album)) << 2) | (Number(hasFormat) << 3)
  return <PlaylistCard songKey={item.key} track={track} index={index} coverUrl={coverUrl}
    current={current} unavailable={!item.available} canSelectUnavailable canActivate={canActivate}
    selectMode={selectMode} selected={selected} artworkVisible={artworkVisible}
    showExtendedMetadata={showExtendedMetadata} contentVisible contentRepresentative={false}
    contentShape={contentShape} coverFailed={coverFailed} onCoverFailed={onCoverFailed}
    onActivate={onActivate} onToggleSelect={onToggleSelect} />
})

export function PlaylistLibraryPanel({ playlist, allSongsCoverStore, librarySidebarOpen, onLibrarySidebarOpenChange, searchRequestId = 0 }: Props) {
  const appearanceMotion = useAppearanceMotion()
  const isPresent = useIsPresent()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const atomicOverview = chromeTransition.overviewBoundary
  const [entrySession, setEntrySession] = useState({ isPresent, offscreen: chromeTransition.offscreenReturn,
    sharedReady: !chromeTransition.offscreenReturn || appearanceMotion.disabled })
  const currentEntry = entrySession.isPresent === isPresent ? entrySession : {
    isPresent, offscreen: isPresent ? chromeTransition.offscreenReturn : entrySession.offscreen,
    sharedReady: isPresent ? !chromeTransition.offscreenReturn || appearanceMotion.disabled : entrySession.sharedReady,
  }
  if (currentEntry !== entrySession) setEntrySession(currentEntry)
  const offscreenEntry = currentEntry.offscreen
  const entryPending = offscreenEntry && !currentEntry.sharedReady
  const sharedProjection = !appearanceMotion.disabled && !entryPending
  const projectionKey = sharedProjection ? 'shared' : 'local'
  const entryControls = useAnimationControls()
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [createError, setCreateError] = useState('')
  const playlistNameId = useId()
  const [activeQuickIndex, setActiveQuickIndex] = useState<string | null>(null)
  const [quickIndexPreview, setQuickIndexPreview] = useState<{ key: string; top: number; visible: boolean } | null>(null)
  const quickIndexPointer = useRef<number | null>(null)
  const quickIndexPointerKey = useRef<string | null>(null)
  const quickIndexPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const songsListRef = useRef<HTMLDivElement | null>(null)
  const managementPanelRef = useRef<HTMLElement | null>(null)
  const [failedSongCovers, setFailedSongCovers] = useState<ReadonlySet<string>>(new Set())
  const headingRef = useRef<HTMLElement | null>(null)
  const toolbarControls = useAnimationControls()
  const navigationMotion = appearanceMotion.libraryNavigation
  useLayoutEffect(() => {
    // Retain the last active heading geometry during departure. Reentry
    // measures and subscribes again instead of letting the outgoing page
    // continue publishing geometry while its successor enters.
    if (!isPresent) return
    const heading = headingRef.current
    if (!heading || !chromeTransition.geometry) return
    const measure = () => chromeTransition.geometry!.current.items.set(`heading:${categoryId}`, readLibraryLayoutRect(heading))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [categoryId, chromeTransition.geometry, isPresent])
  useLayoutEffect(() => {
    if (atomicOverview && isPresent) {
      toolbarControls.set('initial')
      void toolbarControls.start('animate')
    } else if (isPresent) toolbarControls.set('animate')
    return () => toolbarControls.stop()
  }, [atomicOverview, isPresent, navigationMotion, toolbarControls])
  useLayoutEffect(() => {
    if (!isPresent) return
    let cancelled = false
    const enableSharedProjection = () => {
      if (!cancelled) setEntrySession((previous) => previous.sharedReady ? previous : { ...previous, sharedReady: true })
    }
    if (entryPending && !appearanceMotion.disabled) {
      entryControls.set('initial')
      void entryControls.start('animate').then(enableSharedProjection)
    } else {
      entryControls.set('animate')
      if (entryPending) enableSharedProjection()
    }
    return () => { cancelled = true; entryControls.stop() }
  }, [entryPending, appearanceMotion.disabled, isPresent, navigationMotion, entryControls])
  const toolbarOffset = () => {
    if (appearanceMotion.disabled) return { x: 0, y: 0 }
    const source = chromeTransition.geometry?.current.items.get(categoryId)
    const target = chromeTransition.geometry?.current.items.get(`heading:${categoryId}`)
    return source && target ? { x: source.x - target.x, y: source.y - target.y } : { x: 0, y: 0 }
  }
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
  const visible = categoryItems
    .filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => compareByQuickIndex(left.name, right.name))
  const visibleSongs = useMemo(() => (library.allSongs ?? [])
    .filter((item) => `${item.track.title} ${item.track.artist} ${item.track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => compareByQuickIndex(left.track.title, right.track.title)), [library.allSongs, query])
  const coverStore = useAllSongsWindow(visibleSongs, panelRef, songsListRef,
    isSongs && songsLayout.showArtwork, library.allSongsMetadataStatus === 'loading', allSongsCoverStore)
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
  const handleSongCoverFailed = useCallback((key: string) => {
    setFailedSongCovers((previous) => {
      if (previous.has(key)) return previous
      return new Set(previous).add(key)
    })
  }, [])
  const quickIndexTargets = new Map<string, number>()
  ;(isSongs ? visibleSongs.map((item) => item.track.title) : visible.map((item) => item.name)).forEach((name, index) => {
    const key = quickIndexKey(name)
    if (!quickIndexTargets.has(key)) quickIndexTargets.set(key, index)
  })
  const selectedItems = visible.filter((item) => selected.has(item.scope))
  const playTarget = selectMode ? selectedItems[0] : visible[0]
  const selectedSongs = visibleSongs.filter((item) => selected.has(item.key) && item.available)
  const playableSongs = visibleSongs.filter((item) => item.available)
  const songPlayTarget = selectMode ? selectedSongs[0] : playableSongs[0]
  // An in-flight playback command locks interaction; it is not unavailability.
  const playbackCommandLocked = Boolean(playlist.isOpenAudioDisabled)
  useEffect(() => {
    if (searchRequestId > 0) {
      // Focus after the input has mounted, with no timing-dependent delay.
      searchRef.current?.focus()
    }
  }, [searchRequestId, searchOpen])
  useEffect(() => () => {
    if (quickIndexPreviewTimer.current) clearTimeout(quickIndexPreviewTimer.current)
  }, [])
  const showSearch = hasDataSource && (searchOpen || searchRequestId > dismissedSearchRequestId)
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
    if (showSearch) {
      setQuery('')
      setSearchOpen(false)
      setDismissedSearchRequestId(searchRequestId)
    } else {
      setSearchOpen(true)
      queueMicrotask(() => searchRef.current?.focus())
    }
  }
  function jumpToIndex(key: string) {
    setActiveQuickIndex(key)
    const panel = panelRef.current
    if (!panel) return
    if (key === 'top') {
      panel.scrollTop = 0
      return
    }
    const index = quickIndexTargets.get(key)
    const card = index === undefined ? null : (isSongs ? songsListRef.current : gridRef.current)?.children.item(index)
    if (!card) return
    panel.scrollTop += card.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8
  }
  function showQuickIndexPreview(key: string, clientY: number, nav: HTMLElement) {
    if (quickIndexPreviewTimer.current) clearTimeout(quickIndexPreviewTimer.current)
    const navRect = nav.getBoundingClientRect()
    const panelRect = nav.parentElement!.getBoundingClientRect()
    const previewSize = 100
    const dockTop = document.querySelector<HTMLElement>('.playlist-playback-dock:not([data-dock-superseded])')?.getBoundingClientRect().top
    const previewBottom = Math.min(navRect.bottom, dockTop ?? navRect.bottom)
    const maxTop = Math.max(navRect.top, previewBottom - previewSize)
    const top = Math.max(navRect.top, Math.min(clientY - previewSize / 2, maxTop)) - panelRect.top
    setQuickIndexPreview({ key, top, visible: true })
  }
  function hideQuickIndexPreview() {
    if (quickIndexPreviewTimer.current) clearTimeout(quickIndexPreviewTimer.current)
    quickIndexPreviewTimer.current = setTimeout(() => {
      setQuickIndexPreview((previous) => previous ? { ...previous, visible: false } : null)
      quickIndexPreviewTimer.current = null
    }, 240)
  }
  function updateQuickIndexPointer(event: ReactPointerEvent<HTMLElement>) {
    const nav = event.currentTarget
    const rect = nav.getBoundingClientRect()
    const position = Math.max(0, Math.min(QUICK_INDEX_COUNT - 1,
      Math.floor((event.clientY - rect.top) / (rect.height / QUICK_INDEX_COUNT))))
    const key = position === 0 ? 'top' : QUICK_INDEX_KEYS[position - 1]
    showQuickIndexPreview(key, event.clientY, nav)
    if (key !== quickIndexPointerKey.current) {
      quickIndexPointerKey.current = key
      jumpToIndex(key)
    }
  }
  function endQuickIndexPointer(event: ReactPointerEvent<HTMLElement>) {
    if (quickIndexPointer.current !== event.pointerId) return
    quickIndexPointer.current = null
    quickIndexPointerKey.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    hideQuickIndexPreview()
  }
  function activateQuickIndexByKeyboard(key: string, event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0) return
    const nav = event.currentTarget.parentElement
    if (!nav) return
    const rect = event.currentTarget.getBoundingClientRect()
    jumpToIndex(key)
    showQuickIndexPreview(key, rect.top + rect.height / 2, nav)
    hideQuickIndexPreview()
  }
  useLibraryDockBinding(`category:${categoryId}`, { searchOpen: showSearch, onSearchToggle: hasDataSource ? toggleSearch : undefined })
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
    <motion.section ref={(node) => { panelRef.current = node; managementPanelRef.current = isSongs ? null : node }} className="playlist-management-content" aria-label={`${category.label}管理`}
      data-metadata-loading={isSongs && library.allSongsMetadataStatus === 'loading' || undefined}
      variants={offscreenEntry ? navigationMotion.detailReturn.incoming : appearanceMotion.variants.backdrop}
      transition={offscreenEntry ? navigationMotion.transition : atomicOverview ? { duration: 0 } : returnTransition}
      initial={atomicOverview ? false : 'initial'} animate={offscreenEntry ? entryControls : 'animate'} exit={atomicOverview ? 'animate' : 'exit'}>
      <motion.div className="playlist-management-parent" variants={navigationMotion.chrome}
        initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
        <Button variant="outline" onClick={library.onOpenOverview} aria-label="返回媒体库"><img src={parentIcon} alt="" />媒体库</Button>
      </motion.div>
      <header ref={headingRef} className="playlist-management-heading">
        <motion.span key={`category-icon:${projectionKey}`} className="playlist-management-category" aria-hidden="true" style={{ background: `var(--playlist-category-${categoryId})` }}
          layoutId={sharedProjection ? `library-category-icon:${categoryId}` : undefined} layoutCrossfade={false}
          transition={{ layout: navigationMotion.transition }}><span className="media-library-category-glyph" style={{ width: category.glyphWidth, height: category.glyphHeight, maskImage: `url("${category.overviewIcon}")`, WebkitMaskImage: `url("${category.overviewIcon}")` }} /></motion.span>
        <motion.h2 key={`category-label:${projectionKey}`} layoutId={sharedProjection ? `library-category-label:${categoryId}` : undefined} layoutCrossfade={false}
          transition={{ layout: navigationMotion.transition }}>{isSongs ? '全部歌曲' : category.label}</motion.h2>
      </header>
      <motion.div className="playlist-management-toolbar" custom={toolbarOffset} variants={navigationMotion.toolbar}
        initial={false} animate={toolbarControls} exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
        {hasDataSource ? <motion.div key={`actions:${projectionKey}`} className="playlist-management-actions"
          layout={sharedProjection ? 'position' : undefined}
          layoutId={sharedProjection && library.currentScope ? `playlist-library-actions:${library.currentScope}` : undefined}
          transition={{ layout: returnTransition }}>
          <Button variant="outline" aria-label={`随机播放${category.label}`} data-playback-command-lock={playbackCommandLocked || undefined} disabled={isSongs ? !playableSongs.length || playlist.isOpenAudioDisabled : !playTarget || playlist.isOpenAudioDisabled} onClick={() => {
            if (isSongs) {
              const candidates = selectMode ? selectedSongs : playableSongs
              const target = candidates[Math.floor(Math.random() * candidates.length)]
              if (target) library.onPlaySong?.(target.scope, target.trackId)
              return
            }
            const candidates = selectMode ? selectedItems : visible
            const target = candidates[Math.floor(Math.random() * candidates.length)]
            if (target) library.onPlay(target.scope)
          }}><img src={shuffleIcon} alt="" /></Button>
          <Button variant="outline" aria-label={`播放${category.label}`} data-playback-command-lock={playbackCommandLocked || undefined} disabled={isSongs ? !songPlayTarget || playlist.isOpenAudioDisabled : !playTarget || playlist.isOpenAudioDisabled} onClick={() => {
            if (isSongs) { if (songPlayTarget) library.onPlaySong?.(songPlayTarget.scope, songPlayTarget.trackId) }
            else if (playTarget) library.onPlay(playTarget.scope)
          }}><img src={playIcon} alt="" /></Button>
          <Button variant="outline" aria-label={`搜索${category.label}`} aria-expanded={showSearch} onClick={() => { setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()) }}><img src={searchIcon} alt="" /></Button>
          <Button variant="outline" aria-pressed={selectMode} disabled={isSongs ? !(library.allSongs?.length) : !categoryItems.length} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}>{selectMode ? '取消选择' : '选择'}</Button>
          {selectMode ? <span role="status">已选择 {selected.size} 项</span> : null}
          {isSongs && selectMode ? <Button variant="outline" disabled={!selected.size || !library.onCreatePlaylist} onClick={() => { setPlaylistName(''); setCreateError(''); setCreateOpen(true) }}>新建播放列表</Button> : null}
        </motion.div> : <div />}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="playlist-management-more" variant="outline" aria-label="更多列表操作"><img src={moreIcon} alt="" /></Button>} />
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuItem disabled={library.isImportPending} onClick={library.onSelectFolders}>选择文件夹</DropdownMenuItem>
            <DropdownMenuItem disabled={library.isImportPending} onClick={library.onImportPlaylist}>导入 M3U8 播放列表</DropdownMenuItem>
            <DropdownMenuItem disabled={isSongs ? !visibleSongs.length : !visible.length} onClick={() => { setSelectMode(true); setSelected(new Set(isSongs ? visibleSongs.map((item) => item.key) : visible.map((item) => item.scope))) }}>选择全部可见{isSongs ? '歌曲' : '列表'}</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
      {showSearch ? <motion.div className="playlist-management-search" variants={navigationMotion.chrome}
        initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><Input ref={searchRef} type="search" aria-label={isSongs ? '搜索歌曲标题、艺术家或专辑' : `搜索${category.label}名称`} placeholder={isSongs ? '搜索歌曲' : `搜索${category.label}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedSearchRequestId(searchRequestId) } }} /></motion.div> : null}
      <span className="sr-only" role="status" aria-live="polite">{isSongs ? songsAnnouncement : announcement}</span>
      {isSongs ? (library.allSongsMetadataStatus === 'loading' ? <PlaylistMetadataLoading layout={songsLayout} trackCount={library.allSongs?.length ?? 0} /> : visibleSongs.length ? <div ref={songsListRef} className="playlist-grid all-songs-list" aria-label="全部歌曲列表"
        data-layout-level={songsLayout.level} data-layout-flow={songsLayout.flow} data-layout-columns={songsLayout.columns}
        data-content-window="full" data-cover-motion={appearanceMotion.disabled ? 'off' : undefined}
        style={{ ...songsLayout.style, touchAction: 'pan-y' }}>
        {visibleSongs.map((item, index) => <AllSongsCard key={item.key} item={item} index={index} store={coverStore}
            current={item.trackId === playlist.currentTrackId}
            canActivate={!playlist.isOpenAudioDisabled}
            selectMode={selectMode} selected={selected.has(item.key)}
            artworkVisible={songsLayout.showArtwork} showExtendedMetadata={songsLayout.flow !== 'tile'}
            coverFailed={failedSongCovers.has(item.key)}
            onCoverFailed={handleSongCoverFailed}
            onActivate={handleSongActivate}
            onToggleSelect={handleSongToggleSelect} />)}
      </div> : <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={false} animate="animate"><EmptyHeader><EmptyTitle>{(library.allSongs?.length ?? 0) ? '没有匹配的歌曲' : '暂无歌曲'}</EmptyTitle><EmptyDescription>{(library.allSongs?.length ?? 0) ? '尝试其他名称，或清空搜索。' : '选择音乐文件夹后，这里会汇总其中及子文件夹内的歌曲；不会自动创建播放列表。下次启动会重新扫描。'}</EmptyDescription></EmptyHeader><Button disabled={library.isImportPending} onClick={(library.allSongs?.length ?? 0) ? () => setQuery('') : library.onSelectFolders}>{(library.allSongs?.length ?? 0) ? '清空搜索' : '选择文件夹'}</Button></MotionEmpty>) : categoryId === 'playlists' && library.isPlaylistRestorePending && !visible.length ? <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>正在恢复播放列表</EmptyTitle><EmptyDescription>正在读取已保存的 M3U8 清单。</EmptyDescription></EmptyHeader></Empty> : visible.length ? <div ref={gridRef} className="playlist-management-grid"
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
              <span className="playlist-management-meta"><img src={layout.level === 2 ? musicLarge : musicSmall} alt="" aria-hidden="true" /><span>{item.trackCount}{item.totalClock ? ` | ${item.totalClock}` : ''}</span></span>
              </span>
            </Button>
        </motion.div>)}
      </div> : <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{!hasDataSource ? `${category.label}尚未接入数据` : categoryItems.length ? `没有匹配的${category.label}` : `暂无${category.label}`}</EmptyTitle><EmptyDescription>{!hasDataSource ? '此分类的数据管理能力尚未接入。可返回媒体库浏览已导入的列表。' : categoryItems.length ? '尝试其他名称，或清空搜索。' : categoryId === 'folder' ? '导入本地音频文件夹后，可在这里浏览；下次启动会重新扫描。M3U8 列表显示在播放列表分类。' : '导入 M3U8 后会自动保存，重启可继续使用；从全部歌曲新建的播放列表仅在本次会话中保留。'}</EmptyDescription></EmptyHeader><Button disabled={library.isImportPending} onClick={!hasDataSource ? library.onOpen : categoryItems.length ? () => setQuery('') : categoryId === 'folder' ? library.onSelectFolders : library.onImportPlaylist}>{!hasDataSource ? '打开播放列表' : categoryItems.length ? '清空搜索' : categoryId === 'folder' ? '选择文件夹' : '导入 M3U8 播放列表'}</Button></MotionEmpty>}
    </motion.section>
    {(categoryId === 'playlists' || (isSongs && library.allSongsMetadataStatus !== 'loading')) ? <>
    {quickIndexPreview ? <div className="playlist-management-quick-index-preview" data-visible={quickIndexPreview.visible} style={{ top: quickIndexPreview.top }} aria-hidden="true">
      {quickIndexPreview.key === 'top' ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 6-6 6 6M2 14l6-6 6 6" /></svg> : quickIndexPreview.key}
    </div> : null}
    <nav className="playlist-management-quick-index" aria-label={isSongs ? '歌曲快速查找' : '播放列表快速查找'}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        event.preventDefault()
        quickIndexPointer.current = event.pointerId
        quickIndexPointerKey.current = null
        event.currentTarget.setPointerCapture(event.pointerId)
        updateQuickIndexPointer(event)
      }}
      onPointerMove={(event) => { if (quickIndexPointer.current === event.pointerId) updateQuickIndexPointer(event) }}
      onPointerUp={endQuickIndexPointer} onPointerCancel={endQuickIndexPointer}
      onLostPointerCapture={(event) => { if (quickIndexPointer.current === event.pointerId) endQuickIndexPointer(event) }}>
      <button type="button" aria-label="返回列表顶部" aria-current={activeQuickIndex === 'top' ? 'true' : undefined} title="返回顶部" onClick={(event) => activateQuickIndexByKeyboard('top', event)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m2 7 6-6 6 6M2 14l6-6 6 6" />
        </svg>
      </button>
      {QUICK_INDEX_KEYS.map((key) => <button key={key} type="button" aria-label={key === '0' ? `查找数字开头的${isSongs ? '歌曲' : '播放列表'}` : key === '#' ? `查找其他字符开头的${isSongs ? '歌曲' : '播放列表'}` : `查找 ${key} 开头的${isSongs ? '歌曲' : '播放列表'}`}
        aria-current={activeQuickIndex === key ? 'true' : undefined} title={key === '0' ? '数字' : key === '#' ? '其他字符' : key}
        onClick={(event) => activateQuickIndexByKeyboard(key, event)}>{key}</button>)}
    </nav></> : null}
  </motion.div>
}
