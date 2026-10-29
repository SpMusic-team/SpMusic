import { LibraryRootMenu } from './LibraryRootMenu'
import { compareByQuickIndex } from '../model/quickIndex'
import { formatDurationClock } from '../model/playlistDuration'
import { CollectionQuickIndex } from './CollectionQuickIndex'
import { readLibraryLayoutRect } from '../model/libraryNavigationGeometry'
import { useCollectionEntryProjection } from '../hooks/useCollectionEntryProjection'
import { useCollectionDetailPresence } from '../hooks/useCollectionDetailPresence'
import { FolderHierarchyCard } from './FolderHierarchyCard'
import { FolderHierarchyRootMenu } from './FolderHierarchyRootMenu'
import { FOLDER_CARD_LAYOUTS } from '../model/folderCardLayouts'
import { CollectionManagementHeader } from './CollectionManagementHeader'
import { useCollectionManagementChrome } from '../hooks/useCollectionManagementChrome'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { CollectionReturnIcon } from './CollectionReturnIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistLibrarySidebar } from './PlaylistLibrarySidebar'
import { PlaylistCard } from './PlaylistCard'
import { PlaylistMetadataLoading } from './PlaylistPanel'
import { useLibraryChromeTransition, LibraryChromeTransitionContext } from '../hooks/useLibraryChromeTransition'
import { LibraryDockContext, useLibraryDockBinding } from '../hooks/useLibraryDockBinding'
import { useCollectionHeroMotion, useCollectionHeroVisibility } from '../hooks/useCollectionHeroMotion'
import { CollectionHero } from './CollectionHero'
import { PlaylistActionButtons } from './PlaylistActionButtons'
import { getShuffleModePresentation } from './playbackModePresentation'
import { useCollectionLayout } from '../hooks/useCollectionLayout'
import { useAllSongsRenderWindow } from '../hooks/useAllSongsRenderWindow'
import { folderCoverRevisions, useAllSongsCoverUrl, useCollectionCoverUrl, useAllSongsCoverLease, useAllSongsWindow, type AllSongsCoverStore, type AllSongsCoverItem, type TrackCandidatesCoverItem } from '../hooks/useAllSongsWindow'
import { flatFolderEntries, folderNavigationKey, folderEntries, folderRootSongs, folderName, folderPath, insideFolder, parentFolder, type FolderHierarchyEntry } from '../model/folderHierarchy'
import { PLAYLIST_SONG_LAYOUTS } from '../model/playlistSongLayouts'
import { mediaLibraryCategories } from '../model/mediaLibraryCategories'
import type { AllSongsItem, PlayerPlaylistViewModel } from '../model/playerUiViewModel'
import type { PlaylistControllerMode } from '../model/playlistControllerMode'
import type { PlayerTimelineViewModel } from '../model/playerUiViewModel'
import folderIcon from '@/assets/playlist-library/fece3.svg'

const EMPTY_SONGS: readonly AllSongsItem[] = []
const MotionEmpty = motion.create(Empty)
const EMPTY_ROOTS: NonNullable<PlayerPlaylistViewModel['library']>['folderRoots'] = []
const SELECTORS = { item: '[data-collection-key]', cover: '.folder-cover, .playlist-card-cover', copy: '.folder-copy, .playlist-card-copy', getId: (node: HTMLElement) => node.dataset.collectionKey }
function flatFolderCover(directoryPath: string, songs: readonly AllSongsItem[]): TrackCandidatesCoverItem {
  return { kind: 'track-candidates', key: `flat-folder:${folderPath(directoryPath)}`,
    candidates: songs.map(({ key, trackId, sourcePath, available, artworkRevision }) => ({ key, trackId, sourcePath, available, artworkRevision })),
    available: songs.some(song => song.available) }
}
const defaultLevel = () => 3

function totalClock(songs: readonly AllSongsItem[]) {
  if (songs.some(item => item.available && !(Number(item.track.durationSeconds) > 0))) return null
  const total = Math.floor(songs.reduce((sum, item) => sum + (item.available ? item.track.durationSeconds ?? 0 : 0), 0))
  return formatDurationClock(total)
}

function Cover({ item, store, hero = false }: { item?: AllSongsCoverItem; store: AllSongsCoverStore; hero?: boolean }) {
  const cover = useCollectionCoverUrl(store, item)
  if (hero) return cover ? <img className="playlist-hero-image" src={cover} alt="" decoding="async" /> : null
  return cover ? <img src={cover} alt="" decoding="async" /> : <img className="folder-cover-placeholder" src={folderIcon} alt="" />
}

function Song({ item, store, playlist, selectMode, selected, artworkVisible, showExtendedMetadata, onSelect, onPlay }: { item: AllSongsItem; store: AllSongsCoverStore; playlist: PlayerPlaylistViewModel; selectMode: boolean; selected: boolean; artworkVisible: boolean; showExtendedMetadata: boolean; onSelect: (key: string) => void; onPlay: (key: string) => void }) {
  const coverUrl = useAllSongsCoverUrl(store, item.key, item.trackId, item.sourcePath)
  const [failed, setFailed] = useState(false)
  return <PlaylistCard songKey={item.key} track={item.track} coverUrl={coverUrl}
    current={playlist.currentTrackId === item.trackId} unavailable={!item.available} canSelectUnavailable
    canActivate={!playlist.isOpenAudioDisabled} selectMode={selectMode} selected={selected}
    artworkVisible={artworkVisible} showExtendedMetadata={showExtendedMetadata} contentVisible contentRepresentative={false} contentShape={15}
    coverFailed={failed} onCoverFailed={() => setFailed(true)} onActivate={onPlay} onToggleSelect={onSelect} />
}

type Props = { categoryId?: 'folder' | 'folders'; playlist: PlayerPlaylistViewModel; allSongsCoverStore: AllSongsCoverStore; librarySidebarOpen: boolean; onLibrarySidebarOpenChange: (open: boolean) => void; searchRequestId?: number; controllerMode?: PlaylistControllerMode; timelineInteraction?: PlayerTimelineViewModel['interaction'] }

export function FolderHierarchyPanel(props: Props) {
  const { categoryId = 'folders', playlist, librarySidebarOpen, onLibrarySidebarOpenChange } = props
  const library = playlist.library!
  const flat = categoryId === 'folder'

  const coverRevisions = useMemo(() => folderCoverRevisions(props.allSongsCoverStore, (library.folderRoots ?? EMPTY_ROOTS!).map(root => ({ ...root, path: folderPath(root.path) }))), [props.allSongsCoverStore, library.folderRoots])
  const outerChrome = useContext(LibraryChromeTransitionContext)
  const outerPresent = useIsPresent()
  const scrollPositions = useRef(new Map<string, number>())
  const requested = flat ? library.flatFolderLocation : library.folderLocation
  const location = flat ? requested : library.folderRoots?.some(root => folderPath(root.path) === folderPath(requested?.rootPath ?? '')) ? requested : null
  const route = location ? `tracks:${categoryId}:` + folderNavigationKey(location.rootPath, location.directoryPath) : `category:${categoryId}`
  const parentRoute = location && !flat && folderPath(location.directoryPath) !== folderPath(location.rootPath)
    ? `tracks:${categoryId}:` + folderNavigationKey(location.rootPath, parentFolder(location.directoryPath)) : `category:${categoryId}`
  const [navigation, setNavigation] = useState({ route, parentRoute })
  const [internalNavigation, setInternalNavigation] = useState(Boolean(location))
  const internalBoundary = internalNavigation || navigation.route !== route
  if (navigation.route !== route) {
    setNavigation({ route, parentRoute })
    if (!internalNavigation) setInternalNavigation(true)
  }
  const localChrome = useLibraryChromeTransition(route, false, navigation.parentRoute)
  const chrome = { ...outerChrome,
    handoff: outerChrome.handoff || localChrome.handoff,
    overviewBoundary: outerPresent && internalBoundary ? false : outerChrome.overviewBoundary,
    offscreenReturn: outerPresent && internalBoundary ? localChrome.offscreenReturn : outerChrome.offscreenReturn,
    publishDetailVisibility: localChrome.publishDetailVisibility,
  }
  const sidebar = { playlistName: playlist.playlistName ?? '', trackCount: playlist.tracks.length, totalClock: null, onCurrentPlaylist: library.onOpen, library }
  return <motion.div className="playlist-management folder-hierarchy" inert={!outerPresent || undefined} aria-hidden={!outerPresent || undefined}>
    <PlaylistLibrarySidebar {...sidebar} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}><DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" aria-describedby={undefined}><DialogTitle className="sr-only">媒体库</DialogTitle><PlaylistLibrarySidebar {...sidebar} overlay /></DialogContent></Dialog>
    <LibraryChromeTransitionContext.Provider value={chrome}>
      <AnimatePresence mode="wait" propagate>
        <FolderHierarchyScene key={route} {...props} categoryId={categoryId} coverRevisions={coverRevisions} scrollPositions={scrollPositions} outerPresent={outerPresent} />
      </AnimatePresence>
    </LibraryChromeTransitionContext.Provider>
  </motion.div>
}

function FolderHierarchyScene({ categoryId = 'folders', playlist, allSongsCoverStore: store, searchRequestId = 0, controllerMode = 'movable', timelineInteraction, scrollPositions, outerPresent, coverRevisions }: Props & { scrollPositions: RefObject<Map<string, number>>; outerPresent: boolean; coverRevisions: ReadonlyMap<string, number> }) {
  const library = playlist.library!
  const flat = categoryId === 'folder'
  const changeLocation = flat ? library.onFlatFolderLocationChange : library.onFolderLocationChange
  const appearance = useAppearanceMotion()
  const icons = useSystemIcons()
  const dockContext = useContext(LibraryDockContext)
  const chrome = useContext(LibraryChromeTransitionContext)
  const scenePresent = useIsPresent()
  const present = scenePresent && outerPresent
  const roots = library.folderRoots ?? EMPTY_ROOTS!
  const requestedLocation = flat ? library.flatFolderLocation : library.folderLocation
  const root = roots.find(item => folderPath(item.path) === folderPath(requestedLocation?.rootPath ?? ''))
  const location = flat ? requestedLocation : root ? requestedLocation : null
  const managementChrome = useCollectionManagementChrome(categoryId, present && !location)
  const { atomicOverview, navigationMotion } = managementChrome
  const locationKey = categoryId + ':' + (location ? folderNavigationKey(location.rootPath, location.directoryPath) : 'roots')
  const routeKey = location ? 'tracks:' + locationKey : `category:${categoryId}`
  const { offscreenEntry, sharedProjection, projectionKey, entryControls } = useCollectionEntryProjection(present, chrome.offscreenReturn)
  const [participant, setParticipant] = useState<{ present: boolean; key?: string }>({ present })
  // AnimatePresence can reuse a returning key. Cancelled departures release
  // their selected-card lease before the scene becomes interactive again.
  const currentParticipant = participant.present === present ? participant
    : { present, key: present ? undefined : participant.key }
  if (currentParticipant !== participant) setParticipant(currentParticipant)
  useAllSongsCoverLease(store, present ? undefined : currentParticipant.key)
  const panelRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const songsRef = useRef<HTMLDivElement>(null)
  const spaceRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const heroArtworkRef = useRef<HTMLDivElement>(null)
  const heroActionsRef = useRef<HTMLDivElement>(null)
  const compactActionsRef = useRef<HTMLDivElement>(null)
  const fallbackDockRef = useRef<HTMLElement>(null)
  const [heroOffscreen, setHeroOffscreen] = useState(false)
  const [actionsPassed, setActionsPassed] = useState(false)
  const [search, setSearch] = useState({ locationKey, query: '', open: false, dismissedRequest: searchRequestId })
  const currentSearch = search.locationKey === locationKey ? search : { locationKey, query: '', open: false, dismissedRequest: searchRequestId }
  if (currentSearch !== search) setSearch(currentSearch)
  const [selection, setSelection] = useState({ locationKey, active: false, keys: new Set<string>() })
  const currentSelection = useMemo(() => selection.locationKey === locationKey ? selection : { locationKey, active: false, keys: new Set<string>() }, [selection, locationKey])
  if (currentSelection !== selection) setSelection(currentSelection)
  const query = currentSearch.query.trim().toLocaleLowerCase()
  const showSearch = currentSearch.open || searchRequestId > currentSearch.dismissedRequest
  const toggleSearch = useCallback(() => setSearch(previous => ({ ...previous, open: !showSearch, dismissedRequest: searchRequestId })), [showSearch, searchRequestId])
  const songs = library.allSongs ?? EMPTY_SONGS
  const directories = useMemo(() => (flat ? location ? [] : flatFolderEntries(songs) : folderEntries(roots, songs, location)).sort((a, b) => compareByQuickIndex(a.name, b.name)), [flat, roots, songs, location])
  const visibleDirectories = useMemo(() => directories.filter(item => `${item.name} ${item.parentName}`.toLocaleLowerCase().includes(query)), [directories, query])
  const ownerSongs = useMemo(() => location && !flat ? folderRootSongs(root, songs) : songs, [flat, location, root, songs])
  const directSongs = useMemo(() => location ? ownerSongs.filter(item => parentFolder(item.sourcePath) === folderPath(location.directoryPath)) : EMPTY_SONGS, [ownerSongs, location])
  const visibleSongs = useMemo(() => directSongs.filter(item => `${item.track.title} ${item.track.artist} ${item.track.album}`.toLocaleLowerCase().includes(query)).sort((a, b) => a.track.title.localeCompare(b.track.title, 'zh-CN', { numeric: true })), [directSongs, query])
  const recursiveSongs = useMemo(() => flat ? directSongs : location ? ownerSongs.filter(item => insideFolder(item.sourcePath, location.directoryPath)) : ownerSongs, [flat, directSongs, location, ownerSongs])
  const { layout, announcement } = useCollectionLayout({ panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS, storageKey: flat ? 'spmusic.flat-folders.layout-level.v1' : 'spmusic.folder-hierarchy.layout-level.v1', defaultLevel: flat ? () => 0 : defaultLevel, selectors: SELECTORS, gestureArea: location ? 'grid' : 'panel', announce: next => `文件夹和歌曲视图已切换为${next.label}` })
  const folderLayout = FOLDER_CARD_LAYOUTS[layout.level]
  useEffect(() => {
    if (present && flat && requestedLocation && !library.isFolderRestorePending && !library.isFolderRescanPending && !library.isImportPending && !songs.some(item => parentFolder(item.sourcePath) === folderPath(requestedLocation.directoryPath))) changeLocation?.(null)
  }, [present, flat, requestedLocation, library.isFolderRestorePending, library.isFolderRescanPending, library.isImportPending, songs, changeLocation])
  const metadataLoading = library.allSongsMetadataStatus === 'loading'
  const layoutKey = `${locationKey}:${layout.level}:${query}:${visibleSongs.length}:${showSearch}:${currentSelection.active}:${metadataLoading}:${visibleDirectories.map(item => item.path).join('\u0000')}`
  const { controllerMotion, returnTransition } = useCollectionHeroMotion({
    panelRef,
    dockRef: dockContext?.dockRef ?? fallbackDockRef, mode: controllerMode,
    seeking: timelineInteraction === 'seeking' || timelineInteraction === 'previewing',
    layoutKey,
    controllerEnabled: Boolean(location && present && (!dockContext || dockContext.activeRouteKey === `category:${categoryId}`)),
    actionsPassed,
    rowSelector: '.folder-directory-list > .folder-row, .folder-songs > .folder-song-slot',
  })
  useLibraryDockBinding(`category:${categoryId}`, { searchOpen: showSearch, onSearchToggle: toggleSearch,
    controllerOffsetY: location ? controllerMotion.offsetY : undefined, controllerHidden: location ? controllerMotion.hidden : undefined })
  const songWindow = useAllSongsRenderWindow(visibleSongs.length, layout, panelRef, songsRef, spaceRef, metadataLoading)
  const renderedSongs = useMemo(() => visibleSongs.slice(songWindow.first, songWindow.end), [visibleSongs, songWindow.first, songWindow.end])
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const node = [...(songsRef.current?.querySelectorAll<HTMLButtonElement>('[data-song-key]') ?? [])].find(item => item.dataset.songKey === pendingFocus.current)
    if (node) { pendingFocus.current = null; node.focus({ preventScroll: true }) }
  }, [renderedSongs])
  const coverKey = useCallback((rootPath: string, directoryPath: string) => `folder:${folderNavigationKey(rootPath, directoryPath)}:${coverRevisions.get(folderPath(rootPath)) ?? 0}`, [coverRevisions])
  const folderCovers = useMemo<AllSongsCoverItem[]>(() => visibleDirectories.map(item => flat ? flatFolderCover(item.path, item.songs) : ({
    kind: 'folder', key: coverKey(location?.rootPath ?? item.path, item.path),
    rootPath: location?.rootPath ?? item.path, directoryPath: item.path, available: item.status === 'ready',
  })), [flat, visibleDirectories, location, coverKey])
  const heroCover = useMemo<AllSongsCoverItem | undefined>(() => flat ? location ? flatFolderCover(location.directoryPath, directSongs) : undefined : location ? {
    kind: 'folder', key: coverKey(location.rootPath, location.directoryPath), rootPath: location.rootPath,
    directoryPath: location.directoryPath, available: root?.status === 'ready',
  } : undefined, [flat, directSongs, location, coverKey, root?.status])
  useAllSongsCoverLease(store, heroCover?.key)
  const coverItems = useMemo(() => [...(heroCover ? [heroCover] : []), ...(layout.showArtwork ? [...folderCovers, ...visibleSongs] : [])], [heroCover, folderCovers, visibleSongs, layout.showArtwork])
  const renderedCoverItems = useMemo(() => [...(heroCover ? [heroCover] : []), ...(layout.showArtwork ? [...folderCovers, ...renderedSongs] : [])], [heroCover, folderCovers, renderedSongs, layout.showArtwork])
  useAllSongsWindow(coverItems, panelRef, panelRef, present, metadataLoading, store, 8, renderedCoverItems)
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel) panel.scrollTop = scrollPositions.current.get(locationKey) ?? 0
  }, [locationKey, scrollPositions])
  useLayoutEffect(() => { if (showSearch) searchRef.current?.focus() }, [showSearch])
  useCollectionHeroVisibility({ panelRef, artworkRef: heroArtworkRef, actionsRef: heroActionsRef,
    compactActionsRef, present, heroOffscreen, onHeroOffscreen: setHeroOffscreen,
    onActionsPassed: setActionsPassed, visibilityKey: layoutKey, routeKey,
    publishDetailVisibility: chrome.publishDetailVisibility,
  })
  const rebaseController = controllerMotion.rebase
  useLayoutEffect(() => { if (showSearch) rebaseController({ reveal: true }) }, [showSearch, rebaseController])
  const toggleSelect = (key: string) => setSelection(previous => { const keys = new Set(previous.keys); if (keys.has(key)) keys.delete(key); else keys.add(key); return { ...previous, keys } })
  const candidates = useMemo(() => {
    const candidates = location ? [...visibleSongs] : []
    for (const directory of visibleDirectories) if (!currentSelection.active || currentSelection.keys.has(`folder:${directory.path}`)) candidates.push(...directory.songs)
    const seen = new Set<string>()
    return candidates.filter(item => {
      if (!item.available || (currentSelection.active && location && !currentSelection.keys.has(item.key) && !visibleDirectories.some(dir => currentSelection.keys.has(`folder:${dir.path}`) && insideFolder(item.sourcePath, dir.path))) || seen.has(item.key)) return false
      seen.add(item.key); return true
    })
  }, [location, visibleSongs, visibleDirectories, currentSelection])
  const play = (key?: string) => {
    const entries = key ? visibleSongs.filter(item => item.available) : candidates
    const target = key ? entries.find(item => item.key === key) : entries[0]
    if (target && !playlist.isOpenAudioDisabled) library.onPlaySong?.(target.scope, target.trackId, entries.map(({ scope, trackId }) => ({ scope, trackId })))
  }
  const goUp = () => {
    if (!location) library.onOpenOverview?.()
    else if (flat) changeLocation?.(null)
    else if (folderPath(location.directoryPath) === folderPath(location.rootPath)) changeLocation?.(null)
    else changeLocation?.({ rootPath: location.rootPath, directoryPath: parentFolder(location.directoryPath) })
  }
  const enter = (directory: FolderHierarchyEntry) => {
    if (currentSelection.active) toggleSelect(`folder:${directory.path}`)
    else {
      setParticipant(previous => ({ ...previous, key: flat ? flatFolderCover(directory.path, directory.songs).key : coverKey(location?.rootPath ?? directory.path, directory.path) }))
      changeLocation?.({ rootPath: flat ? roots.find(root => insideFolder(directory.path, root.path))?.path ?? directory.path : location?.rootPath ?? directory.path, directoryPath: directory.path })
    }
  }
  const renderRootMore = () => flat ? <LibraryRootMenu categoryId="folder" library={library} /> : <FolderHierarchyRootMenu onSelectFolders={library.onSelectFolders}
    onRescan={library.onRescanFolders} onTogglePinned={library.onToggleFoldersPin} pinned={library.foldersPinnedInSidebar}
    busy={library.isImportPending || library.isFolderRestorePending || library.isFolderRescanPending}
    rescanDisabled={!library.folderRoots?.length} />
  const returning = !present && chrome.offscreenReturn && actionsPassed
  const returnGeometry = () => {
    const panel = panelRef.current, actions = compactActionsRef.current
    if (!panel || !actions) return { width: 0, originX: 0, originY: 0 }
    const source = readLibraryLayoutRect(panel), controls = readLibraryLayoutRect(actions)
    return { width: source.width, originX: source.x + source.width / 2 - controls.x,
      originY: source.y + source.height / 2 - controls.y - controllerMotion.offsetY.get() }
  }
  const renderHeroActions = (compact = false) => <motion.div ref={compact ? compactActionsRef : heroActionsRef}
    className={compact ? 'playlist-hero-actions playlist-controller-actions' : 'playlist-hero-actions'}
    role="group" aria-label="文件夹歌曲操作"
    aria-hidden={compact && (!location || !actionsPassed || !present) || undefined}
    inert={compact && (!location || !actionsPassed || !present) || undefined}
    data-actions-visible={compact ? String(Boolean(location && actionsPassed && present)) : undefined}
    custom={compact ? returnGeometry : undefined}
    variants={compact ? { ...appearance.variants.controllerActions, ...appearance.libraryNavigation.detailReturn.controllerOutgoing } : undefined}
    initial={compact ? 'hidden' : false} animate={compact ? returning ? 'exit' : location && actionsPassed && present ? 'visible' : 'hidden' : undefined}
    transition={compact ? returning ? appearance.libraryNavigation.transition : appearance.layoutTransition : { layout: returnTransition }}
    style={compact ? { y: controllerMotion.offsetY } : undefined}>
    <PlaylistActionButtons compact={compact} onBack={compact ? goUp : undefined}
      shuffle={{ ...getShuffleModePresentation('shuffle-all', icons), label: '随机播放文件夹歌曲' }}
      onShuffle={() => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) }}
      shuffleDisabled={playlist.isOpenAudioDisabled || metadataLoading || !candidates.length || !library.onShufflePlay}
      onPlay={() => play()} playDisabled={playlist.isOpenAudioDisabled || metadataLoading || !candidates.length || !library.onPlaySong}
      playbackLocked={playlist.isOpenAudioDisabled} searchOpen={showSearch} onSearch={toggleSearch}
      selectMode={currentSelection.active} onSelect={() => setSelection(previous => ({ ...previous, active: !previous.active, keys: new Set() }))}
      more={location ? <FolderHierarchyRootMenu onSelectFolders={library.onSelectFolders}
        busy={library.isImportPending || library.isFolderRestorePending || library.isFolderRescanPending}
        detail={{ title: folderName(location.directoryPath), parent: folderName(parentFolder(location.directoryPath)),
          artwork: <Cover item={heroCover} store={store} />, triggerIcon: <icons.more aria-hidden="true" />,
          metadata: <><icons.music aria-hidden="true" />{recursiveSongs.length}{totalClock(recursiveSongs) ? ` | ${totalClock(recursiveSongs)}` : ''}</> }} /> : null} />
  </motion.div>
  const { sectionControls } = useCollectionDetailPresence(chrome.offscreenReturn, returnTransition, undefined, Boolean(location))
  const category = mediaLibraryCategories.find(item => item.id === categoryId)!
  return <>
    <motion.section ref={panelRef} className="playlist-management-content folder-hierarchy-content" aria-label={category.label} data-folder-category={categoryId}
      data-directory-path={location?.directoryPath ?? ''} data-folder-root={location?.rootPath ?? ''} data-navigation-key={routeKey}
      onScroll={event => { if (present) scrollPositions.current.set(locationKey, event.currentTarget.scrollTop) }}
      data-select-mode={currentSelection.active || undefined} inert={!present || undefined} aria-hidden={!present || undefined}
      data-has-hero={Boolean(location) || undefined}
      variants={offscreenEntry && present ? appearance.libraryNavigation.detailReturn.incoming : chrome.offscreenReturn ? appearance.libraryNavigation.detailReturn.outgoing : appearance.variants.backdrop}
      transition={offscreenEntry ? appearance.libraryNavigation.transition : !location && managementChrome.atomicOverview ? { duration: 0 } : returnTransition}
      initial={!location && managementChrome.atomicOverview ? false : 'initial'} animate={present && offscreenEntry ? entryControls : location ? sectionControls : 'animate'}
      exit={location ? undefined : managementChrome.atomicOverview ? 'animate' : 'exit'} tabIndex={-1}>
      {location ? <CollectionHero className="folder-hero" artworkRef={heroArtworkRef} localProjection={heroOffscreen || !sharedProjection}
        artworkLayoutId={!sharedProjection || heroOffscreen ? undefined : `folder-cover:${locationKey}`}
        titleLayoutId={!sharedProjection || heroOffscreen ? undefined : `folder-name:${locationKey}`}
        transition={returnTransition} songKey={heroCover?.key} artwork={<Cover item={heroCover} store={store} hero />}
        category={<Button className="playlist-hero-category" size="sm" variant="ghost" aria-label="返回上一级文件夹" onClick={goUp}><CollectionReturnIcon data-icon="inline-start" aria-hidden="true" />{flat ? '文件夹' : folderPath(location.directoryPath) === folderPath(location.rootPath) ? '文件夹层次结构' : folderName(parentFolder(location.directoryPath))}</Button>}
        title={folderName(location.directoryPath)}
        extraMetadata={<p className="playlist-hero-meta collection-hero-parent-meta">{folderName(parentFolder(location.directoryPath))}</p>}
        metadata={<p className="playlist-hero-meta"><icons.music aria-hidden="true" />{recursiveSongs.length}{totalClock(recursiveSongs) ? ` | ${totalClock(recursiveSongs)}` : ''}</p>}
        actions={renderHeroActions()} /> : null}
      <div ref={gridRef} data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-artwork={layout.showArtwork} style={{ ...layout.style, '--folder-columns': layout.columns } as CSSProperties}>
        {!location ? <CollectionManagementHeader chrome={managementChrome} category={category}
          sharedProjection={sharedProjection} onOverview={goUp} returnTransition={returnTransition} more={renderRootMore()}
          actions={{
            shuffleLabel: '随机播放文件夹歌曲', shuffleDisabled: playlist.isOpenAudioDisabled || metadataLoading || !candidates.length || !library.onShufflePlay,
            onShuffle: () => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) },
            playLabel: '播放文件夹歌曲', playDisabled: playlist.isOpenAudioDisabled || metadataLoading || !candidates.length || !library.onPlaySong,
            onPlay: () => play(), playbackLocked: playlist.isOpenAudioDisabled,
            searchLabel: '搜索文件夹和歌曲', searchOpen: showSearch,
            onSearch: () => setSearch(previous => ({ ...previous, open: true })),
            selectMode: currentSelection.active, selectDisabled: !visibleDirectories.length,
            onSelect: () => setSelection(previous => ({ ...previous, active: !previous.active, keys: new Set() })), selectedCount: currentSelection.keys.size,
          }} /> : null}
        {showSearch ? <motion.div className="playlist-management-search" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><Input ref={searchRef} type="search" aria-label="搜索文件夹和歌曲名称" placeholder="搜索文件夹和歌曲" value={currentSearch.query} onChange={event => setSearch(previous => ({ ...previous, query: event.target.value }))} onKeyDown={event => { if (event.key === 'Escape') setSearch(previous => ({ ...previous, query: '', open: false, dismissedRequest: searchRequestId })) }} /></motion.div> : null}
        {location && currentSelection.active ? <p className="folder-selection-status" role="status">已选择 {currentSelection.keys.size} 项</p> : null}
        {library.folderError ? <p className="folder-selection-status" role="alert">{library.folderError}</p> : null}
        {location && root?.status === 'ready' && root.directoryPaths === undefined ? <p className="folder-selection-status" role="status">当前目录由歌曲路径还原；重新选择文件夹可读取完整目录。</p> : null}
        <span className="sr-only" role="status">{announcement}</span>
        {location && !flat && root?.status !== 'ready' ? <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{root?.status === 'error' ? '无法读取文件夹' : '正在扫描文件夹'}</EmptyTitle><EmptyDescription>{root?.error ?? '正在读取目录及其中的音频文件。'}</EmptyDescription></EmptyHeader><Button onClick={goUp} variant="outline">返回上一级</Button></MotionEmpty> : <>
          <div className="folder-directory-list" aria-label="文件夹列表" data-folder-flow={folderLayout.flow} data-folder-level={folderLayout.level} style={folderLayout.style}>
            {visibleDirectories.map((directory, index) => <motion.div key={directory.path} style={{ minWidth: 0, transformOrigin: 'left top' }} variants={navigationMotion.cover}
              initial={!location && atomicOverview ? 'initial' : false} animate="animate" exit={!location && atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><FolderHierarchyCard flat={flat} directory={directory} layout={folderLayout}
              navigationKey={categoryId + ':' + folderNavigationKey(flat ? roots.find(root => insideFolder(directory.path, root.path))?.path ?? directory.path : location?.rootPath ?? directory.path, directory.path)} sharedProjection={sharedProjection} projectionKey={projectionKey} transition={returnTransition}
              coverItem={folderCovers[index]} store={store} selectMode={currentSelection.active}
              selected={currentSelection.keys.has(`folder:${directory.path}`)} onActivate={() => enter(directory)} /></motion.div>)}
          </div>
          {location && metadataLoading && directSongs.length ? <PlaylistMetadataLoading layout={layout} trackCount={directSongs.length} /> : visibleSongs.length ? <div ref={spaceRef} style={songWindow.spaceStyle}><div ref={songsRef} className="playlist-grid folder-songs" data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-columns={layout.columns} style={{ ...layout.style, ...songWindow.gridStyle }} onKeyDown={event => {
            if (!songWindow.enabled || event.key !== 'Tab') return
            const row = (event.target as HTMLElement).closest<HTMLElement>('[data-song-key]')
            if (!row) return
            const direction = event.shiftKey ? -1 : 1
            let next = visibleSongs.findIndex(item => item.key === row.dataset.songKey) + direction
            while (next >= 0 && next < visibleSongs.length && !currentSelection.active && (!visibleSongs[next].available || playlist.isOpenAudioDisabled)) next += direction
            if (next < 0 || next >= visibleSongs.length || (next >= songWindow.first && next < songWindow.end)) return
            const panel = panelRef.current, space = spaceRef.current
            if (!panel || !space) return
            event.preventDefault(); pendingFocus.current = visibleSongs[next].key
            panel.scrollTop += space.getBoundingClientRect().top - panel.getBoundingClientRect().top + Math.floor(next / layout.columns) * songWindow.stride
          }}>
            {renderedSongs.map(item => <div key={item.key} className="folder-song-slot" data-collection-key={item.key}><Song item={item} store={store} playlist={playlist} artworkVisible={layout.showArtwork} showExtendedMetadata={layout.flow !== 'tile'} selectMode={currentSelection.active} selected={currentSelection.keys.has(item.key)} onSelect={toggleSelect} onPlay={play} /></div>)}
          </div></div> : null}
          {!visibleDirectories.length && !visibleSongs.length && !(metadataLoading && directSongs.length) ? <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{query ? '没有匹配的文件夹或歌曲' : !location && (library.isImportPending || library.isFolderRestorePending) ? '正在扫描文件夹' : location ? '文件夹为空' : '尚未选择文件夹'}</EmptyTitle><EmptyDescription>{query ? '尝试其他名称，或清空搜索。' : location ? flat ? '此目录没有直接包含的歌曲。' : '此目录没有子文件夹或可识别的音频文件。' : flat ? '选择存储后，这里会列出所有直接含有歌曲的文件夹。' : '选择音乐文件夹后，在这里逐层浏览；所有歌曲会汇总其中及子目录内的音频。'}</EmptyDescription></EmptyHeader>{!location ? <Button disabled={library.isImportPending || library.isFolderRestorePending} onClick={library.onSelectFolders}>选择文件夹</Button> : null}</MotionEmpty> : null}
        </>}
      </div>
    </motion.section>
    {!location && present ? <CollectionQuickIndex panelRef={panelRef} names={visibleDirectories.map(item => item.name)} /> : null}
    {location ? renderHeroActions(true) : null}
  </>
}
