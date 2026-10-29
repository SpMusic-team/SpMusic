import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { CollectionReturnIcon } from './CollectionReturnIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CollectionManagementHeader } from './CollectionManagementHeader'
import { CollectionHero } from './CollectionHero'
import { CollectionQuickIndex } from './CollectionQuickIndex'
import { LibraryRootMenu } from './LibraryRootMenu'
import { PlaylistLibrarySidebar } from './PlaylistLibrarySidebar'
import { PlaylistActionButtons } from './PlaylistActionButtons'
import { PlaylistHeroMoreMenu, type PlaylistHeroMoreAction } from './PlaylistHeroMoreMenu'
import { PlaylistCard } from './PlaylistCard'
import { getShuffleModePresentation } from './playbackModePresentation'
import { useCollectionEntryProjection } from '../hooks/useCollectionEntryProjection'
import { useCollectionDetailPresence } from '../hooks/useCollectionDetailPresence'
import { useCollectionManagementChrome } from '../hooks/useCollectionManagementChrome'
import { useLibraryChromeTransition, LibraryChromeTransitionContext } from '../hooks/useLibraryChromeTransition'
import { LibraryDockContext, useLibraryDockBinding } from '../hooks/useLibraryDockBinding'
import { useCollectionHeroMotion, useCollectionHeroVisibility } from '../hooks/useCollectionHeroMotion'
import { useCollectionLayout } from '../hooks/useCollectionLayout'
import { useAlbumRenderWindow } from '../hooks/useAlbumRenderWindow'
import { useAllSongsRenderWindow } from '../hooks/useAllSongsRenderWindow'
import { useCollectionCoverUrl, useAllSongsCoverUrl, useAllSongsCoverLease, useAllSongsWindow, type AllSongsCoverStore, type AllSongsCoverItem, type TrackCandidatesCoverItem } from '../hooks/useAllSongsWindow'
import { albumEntries, type AlbumEntry } from '../model/albumLibrary'
import { formatDurationClock } from '../model/playlistDuration'
import { artistEntries, artistAlbums, artistRoute, uniqueArtistSongs, CONTRIBUTOR_LABELS, type ContributorCategoryId } from '../model/artistLibrary'
import { FOLDER_CARD_LAYOUTS } from '../model/folderCardLayouts'
import { PLAYLIST_SONG_LAYOUTS } from '../model/playlistSongLayouts'
import { mediaLibraryCategories } from '../model/mediaLibraryCategories'
import type { AllSongsItem, PlayerPlaylistViewModel, PlayerTimelineViewModel } from '../model/playerUiViewModel'
import type { PlaylistControllerMode } from '../model/playlistControllerMode'
import albumIcon from '@/assets/library-root-menu/afb47.svg'
import artistIcon from '@/assets/media-library/feb56.svg'
import artistMusicNote from '@/assets/artist-library/24b9a.svg'
import artistSongsMusicNote from '@/assets/playlist-library/77262.svg'
import selectFoldersIcon from '@/assets/folder-root-menu/9b161.svg'
import rescanIcon from '@/assets/playlist-hero-menu/9b2af.svg'
import coverIcon from '@/assets/playlist-hero-menu/66817.svg'
import pinIcon from '@/assets/playlist-hero-menu/b969c.svg'
import listOptionsIcon from '@/assets/playlist-hero-menu/e41ce.svg'

const EMPTY: readonly AllSongsItem[] = []
const MotionEmpty = motion.create(Empty)
const CATEGORY = { ...mediaLibraryCategories.find(item => item.id === 'album')!, overviewIcon: albumIcon }
const SELECTORS = { item: '[data-collection-key]', cover: '.folder-cover, .playlist-card-cover', copy: '.folder-copy, .playlist-card-copy', getId: (node: HTMLElement) => node.dataset.collectionKey }
const rootLevel = () => 0
const detailLevel = () => 3
type Props = { categoryId?: 'album' | ContributorCategoryId; playlist: PlayerPlaylistViewModel; allSongsCoverStore: AllSongsCoverStore; librarySidebarOpen: boolean; onLibrarySidebarOpenChange: (open: boolean) => void; searchRequestId?: number; controllerMode?: PlaylistControllerMode; timelineInteraction?: PlayerTimelineViewModel['interaction'] }

function contributorNavigation(library: NonNullable<PlayerPlaylistViewModel['library']>, categoryId: NonNullable<Props['categoryId']>) {
  if (categoryId === 'album-artist') return { location: library.albumArtistLocation, change: library.onAlbumArtistLocationChange }
  if (categoryId === 'composer') return { location: library.composerLocation, change: library.onComposerLocationChange }
  return { location: library.artistLocation, change: library.onArtistLocationChange }
}

function clock(songs: readonly AllSongsItem[]) {
  if (songs.some(item => item.available && !(Number(item.track.durationSeconds) > 0))) return null
  const seconds = Math.floor(songs.reduce((sum, item) => sum + (item.available ? item.track.durationSeconds ?? 0 : 0), 0))
  return formatDurationClock(seconds)
}

function collectionCover(entry: AlbumEntry, identityPrefix: string): TrackCandidatesCoverItem {
  return { kind: 'track-candidates', key: JSON.stringify(['collection-cover', identityPrefix, entry.key]),
    candidates: entry.songs.map(({ key, trackId, sourcePath, available, artworkRevision }) => ({ key, trackId, sourcePath, available, artworkRevision })),
    available: entry.songs.some(song => song.available) }
}

function uniqueCovers(items: readonly AllSongsCoverItem[]): AllSongsCoverItem[] {
  return [...new Map(items.map(item => [item.key, item])).values()]
}

function AlbumCover({ song, store, hero = false, artist = false }: { song?: AllSongsCoverItem; store: AllSongsCoverStore; hero?: boolean; artist?: boolean }) {
  const cover = useCollectionCoverUrl(store, song)
  return cover ? <img className={hero ? 'playlist-hero-image' : 'folder-cover-image'} src={cover} alt="" decoding="async" />
    : hero ? null : <span className="album-cover-placeholder" style={{ maskImage: `url("${artist ? artistIcon : albumIcon}")` }} aria-hidden="true" />
}

function ArtistMenuArtwork({ item, store }: { item?: AllSongsCoverItem; store: AllSongsCoverStore }) {
  const frame = useRef<HTMLSpanElement>(null)
  const items = useMemo(() => item ? [item] : [], [item])
  useAllSongsCoverLease(store, item?.key)
  useAllSongsWindow(items, frame, frame, true, false, store, 1)
  return <span ref={frame} className="artist-menu-cover"><span className="artist-menu-cover" data-cover-key={item?.key}><AlbumCover song={item} store={store} artist /></span></span>
}

function AlbumCard({ album, store, level, selected, selectMode, sharedProjection, projectionKey, transition, onActivate, artist = false, categoryLabel = '艺术家', identityPrefix = 'album' }: {
  identityPrefix?: string; artist?: boolean; categoryLabel?: string; album: AlbumEntry; store: AllSongsCoverStore; level: number; selected: boolean; selectMode: boolean;
  sharedProjection: boolean; projectionKey: string; transition: ReturnType<typeof useAppearanceMotion>['layoutTransition']; onActivate: () => void
}) {
  const layout = FOLDER_CARD_LAYOUTS[level]
  const coverItem = useMemo(() => collectionCover(album, identityPrefix), [album, identityPrefix])
  const artistStyle = level === 0
    ? { '--folder-card-width': '100%', '--folder-cover-width': 'min(280px, 100%)', '--folder-cover-height': 'auto', '--folder-title-size': '32px', '--folder-title-line': '40px' }
    : { '--folder-cover-width': `${Math.min(layout.coverWidth, layout.coverHeight)}px`, '--folder-cover-height': `${Math.min(layout.coverWidth, layout.coverHeight)}px` }
  return <Button variant="ghost" className={`folder-row album-card${artist ? ' artist-card' : ''}`} data-artist-key={artist ? album.key : undefined} data-album-key={album.key} data-collection-key={album.key}
    data-song-key={album.coverSong?.key} data-cover-key={coverItem.key} data-folder-variant={layout.variant} data-folder-size={layout.size}
    style={artist ? { ...layout.style, ...artistStyle } as React.CSSProperties : layout.style}
    aria-label={`${selectMode ? '选择' : '打开'}${artist ? categoryLabel : '专辑'} ${album.name}`} aria-pressed={selectMode ? selected : undefined} onClick={onActivate}>
    {layout.coverWidth ? <motion.span className="folder-cover" key={`cover:${projectionKey}`} layoutId={sharedProjection ? `${identityPrefix}-cover:${album.key}` : undefined} layoutCrossfade={false} transition={{ layout: transition }}>
      <AlbumCover song={coverItem} store={store} artist={artist} />
    </motion.span> : null}
    <span className="folder-copy">
      <motion.span key={`title:${projectionKey}`} className="folder-name" title={album.name} layout={sharedProjection ? 'position' : undefined} layoutId={sharedProjection ? `${identityPrefix}-name:${album.key}` : undefined} transition={{ layout: transition }}>{album.name}</motion.span>
      {!artist ? <span className="folder-parent-name" title={album.artist}>{album.artist}</span> : null}
    </span>
  </Button>
}

function AlbumSong({ item, store, playlist, selected, selectMode, artworkVisible, onSelect, onPlay }: { item: AllSongsItem; store: AllSongsCoverStore; playlist: PlayerPlaylistViewModel; selected: boolean; selectMode: boolean; artworkVisible: boolean; onSelect: (key: string) => void; onPlay: (key: string) => void }) {
  const cover = useAllSongsCoverUrl(store, item.key, item.trackId, item.sourcePath)
  const [failedSource, setFailedSource] = useState<string | undefined>()
  return <PlaylistCard songKey={item.key} track={item.track} coverUrl={cover} current={playlist.currentTrackId === item.trackId}
    unavailable={!item.available} canSelectUnavailable canActivate={!playlist.isOpenAudioDisabled}
    selectMode={selectMode} selected={selected} artworkVisible={artworkVisible} showExtendedMetadata
    contentVisible contentRepresentative={false} contentShape={15} coverFailed={Boolean(cover && failedSource === cover)}
    onCoverFailed={() => setFailedSource(cover)} onActivate={onPlay} onToggleSelect={onSelect} />
}

export function AlbumLibraryPanel(props: Props) {
  const { playlist, librarySidebarOpen, onLibrarySidebarOpenChange, categoryId = 'album' } = props
  const library = playlist.library!
  const albums = useMemo(() => categoryId !== 'album' ? artistEntries(library.allSongs ?? EMPTY, categoryId) : albumEntries(library.allSongs ?? EMPTY), [library.allSongs, categoryId])
  const outerChrome = useContext(LibraryChromeTransitionContext)
  const outerPresent = useIsPresent()
  const contributorLocation = contributorNavigation(library, categoryId).location
  const route = categoryId !== 'album' ? artistRoute(contributorLocation ?? null, categoryId) : library.albumLocation ? `tracks:album:${library.albumLocation}` : 'category:album'
  const [navigation, setNavigation] = useState({ route, internal: Boolean(categoryId !== 'album' ? contributorLocation : library.albumLocation) })
  const internal = navigation.internal || navigation.route !== route
  if (navigation.route !== route) setNavigation({ route, internal: true })
  const localChrome = useLibraryChromeTransition(route, false, `category:${categoryId}`)
  const chrome = { ...outerChrome, handoff: outerChrome.handoff || localChrome.handoff,
    overviewBoundary: outerPresent && internal ? false : outerChrome.overviewBoundary,
    offscreenReturn: outerPresent && internal ? localChrome.offscreenReturn : outerChrome.offscreenReturn,
    publishDetailVisibility: localChrome.publishDetailVisibility }
  const positions = useRef(new Map<string, number>())
  const sidebar = { playlistName: playlist.playlistName ?? '', trackCount: playlist.tracks.length, totalClock: null, onCurrentPlaylist: library.onOpen, library }
  return <motion.div className={`playlist-management album-library${categoryId !== 'album' ? ' artist-library' : ''}`} data-contributor-category={categoryId !== 'album' ? categoryId : undefined} inert={!outerPresent || undefined} aria-hidden={!outerPresent || undefined}>
    <PlaylistLibrarySidebar {...sidebar} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}><DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" aria-describedby={undefined}><DialogTitle className="sr-only">媒体库</DialogTitle><PlaylistLibrarySidebar {...sidebar} overlay /></DialogContent></Dialog>
    <LibraryChromeTransitionContext.Provider value={chrome}><AnimatePresence mode="wait" propagate>
      <AlbumScene key={route} {...props} albums={albums} outerPresent={outerPresent} positions={positions} />
    </AnimatePresence></LibraryChromeTransitionContext.Provider>
  </motion.div>
}

function AlbumScene({ albums: rootEntries, categoryId = 'album', playlist, allSongsCoverStore: store, searchRequestId = 0, controllerMode = 'movable', timelineInteraction, outerPresent, positions }: Props & { albums: readonly AlbumEntry[]; outerPresent: boolean; positions: RefObject<Map<string, number>> }) {
  const library = playlist.library!
  const artistMode = categoryId !== 'album'
  const contributor = contributorNavigation(library, categoryId)
  const artistLocation = artistMode ? contributor.location : null
  const artistRoot = artistMode && !artistLocation
  const artistOverview = artistMode && artistLocation?.view === 'albums'
  const artistSongs = artistMode && artistLocation?.view === 'songs'
  const currentArtist = artistMode ? rootEntries.find(item => item.key === artistLocation?.artistKey) : undefined
  const albums = useMemo(() => artistMode && artistLocation ? artistAlbums(currentArtist) : rootEntries, [artistMode, artistLocation, currentArtist, rootEntries])
  const location = artistMode ? artistLocation?.view === 'album' ? artistLocation.albumKey : null : library.albumLocation
  const changeLocation = library.onAlbumLocationChange
  const changeArtistLocation = contributor.change
  const detail = artistMode ? Boolean(artistLocation && artistLocation.view !== 'albums') : Boolean(location)
  const albumDetail = detail && !artistSongs
  const hasHero = detail || artistOverview
  const route = artistMode ? artistRoute(artistLocation ?? null, categoryId) : detail ? `tracks:album:${location}` : 'category:album'
  const categoryLabel = artistMode ? CONTRIBUTOR_LABELS[categoryId] : '专辑'
  const listLabel = artistRoot ? categoryLabel : '专辑'
  const category = artistMode ? mediaLibraryCategories.find(item => item.id === categoryId)! : CATEGORY
  const identityPrefix = artistRoot ? categoryId : artistMode ? `${categoryId}-album:${currentArtist?.key}` : 'album'
  const heroPrefix = artistMode && artistLocation?.view !== 'album' ? categoryId : identityPrefix
  const heroIdentity = artistMode && artistLocation?.view !== 'album' ? currentArtist?.key : location
  const appearance = useAppearanceMotion()
  const icons = useSystemIcons()
  const chrome = useContext(LibraryChromeTransitionContext)
  const dock = useContext(LibraryDockContext)
  const scenePresent = useIsPresent()
  const present = scenePresent && outerPresent
  const panelRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const songsRef = useRef<HTMLDivElement>(null)
  const spaceRef = useRef<HTMLDivElement>(null)
  const albumSpaceRef = useRef<HTMLDivElement>(null)
  const albumListRef = useRef<HTMLDivElement>(null)
  const pendingAlbumFocus = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const artworkRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const compactRef = useRef<HTMLDivElement>(null)
  const fallbackDock = useRef<HTMLElement>(null)
  const [heroOffscreen, setHeroOffscreen] = useState(false)
  const [actionsPassed, setActionsPassed] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dismissedRequest, setDismissedRequest] = useState(searchRequestId)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [departureCover, setDepartureCover] = useState<string>()
  const loading = library.allSongsMetadataStatus === 'loading' || artistMode && Boolean(library.isFolderRestorePending || library.isFolderRescanPending || library.isImportPending)
  const album = artistMode && artistLocation?.view !== 'album' ? currentArtist : albums.find(item => item.key === location)
  const visibleAlbums = useMemo(() => loading ? [] : albums.filter(item => `${item.name} ${item.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [albums, query, loading])
  const indexNames = useMemo(() => visibleAlbums.map(item => item.name), [visibleAlbums])
  const songs = album?.songs ?? EMPTY
  const visibleSongs = useMemo(() => songs.filter(item => `${item.track.title} ${item.track.artist} ${item.track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [songs, query])
  const candidates = useMemo(() => uniqueArtistSongs(detail ? visibleSongs.filter(item => !selectMode || selected.has(item.key)) : visibleAlbums.filter(item => !selectMode || selected.has(item.key)).flatMap(item => item.songs)).filter(item => item.available), [detail, visibleSongs, visibleAlbums, selectMode, selected])
  const showSearch = searchOpen || searchRequestId > dismissedRequest
  const toggleSearch = useCallback(() => { if (showSearch) setQuery(''); setSearchOpen(!showSearch); setDismissedRequest(searchRequestId) }, [showSearch, searchRequestId])
  const managementChrome = useCollectionManagementChrome(categoryId, present && !hasHero)
  const { atomicOverview, navigationMotion } = managementChrome
  const { offscreenEntry, sharedProjection, projectionKey, entryControls } = useCollectionEntryProjection(present, chrome.offscreenReturn)
  const { layout, announcement } = useCollectionLayout({ panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS,
    storageKey: artistMode ? `spmusic.${categoryId}-${artistRoot ? 'root' : artistOverview ? 'albums' : 'tracks'}.layout-level.v1` : detail ? 'spmusic.album-tracks.layout-level.v1' : 'spmusic.albums.layout-level.v1', defaultLevel: detail ? detailLevel : rootLevel,
    selectors: SELECTORS, gestureArea: detail ? 'grid' : 'panel', announce: next => `${categoryLabel}视图已切换为${next.label}` })
  const folderLayout = FOLDER_CARD_LAYOUTS[layout.level]
  const cardGridStyle = artistRoot && layout.level === 0 ? { ...folderLayout.style, '--folder-card-width': '310px' } : folderLayout.style
  const albumWindow = useAlbumRenderWindow(detail ? 0 : visibleAlbums.length, layout.level, panelRef, albumListRef, albumSpaceRef)
  const renderedAlbums = useMemo(() => visibleAlbums.slice(albumWindow.first, albumWindow.end), [visibleAlbums, albumWindow.first, albumWindow.end])
  const scrollToAlbum = (index: number) => {
    if (panelRef.current && albumSpaceRef.current) panelRef.current.scrollTop += albumSpaceRef.current.getBoundingClientRect().top - panelRef.current.getBoundingClientRect().top + Math.floor(index / albumWindow.columns) * albumWindow.stride
  }
  useLayoutEffect(() => {
    if (!pendingAlbumFocus.current) return
    const row = [...(albumListRef.current?.querySelectorAll<HTMLButtonElement>('[data-album-key]') ?? [])].find(node => node.dataset.albumKey === pendingAlbumFocus.current)
    if (row) { pendingAlbumFocus.current = null; row.focus({ preventScroll: true }) }
  }, [renderedAlbums])
  const layoutKey = `${route}:${layout.level}:${query}:${visibleSongs.length}:${showSearch}:${selectMode}:${loading}`
  const { controllerMotion, returnTransition } = useCollectionHeroMotion({ panelRef, dockRef: dock?.dockRef ?? fallbackDock,
    mode: controllerMode, seeking: !hasHero && selectMode || timelineInteraction === 'seeking' || timelineInteraction === 'previewing', layoutKey,
    controllerEnabled: present && (!dock || dock.activeRouteKey === `category:${categoryId}`), actionsPassed,
    rowSelector: '.album-song-slot' })
  useLibraryDockBinding(`category:${categoryId}`, { searchOpen: showSearch, onSearchToggle: toggleSearch,
    controllerOffsetY: controllerMotion.offsetY, controllerHidden: controllerMotion.hidden })
  const songWindow = useAllSongsRenderWindow(visibleSongs.length, layout, panelRef, songsRef, spaceRef, loading)
  const renderedSongs = useMemo(() => visibleSongs.slice(songWindow.first, songWindow.end), [visibleSongs, songWindow.first, songWindow.end])
  const heroCover = hasHero ? album?.coverSong : undefined
  const heroCoverItem = useMemo(() => hasHero && album ? collectionCover(album, heroPrefix) : undefined, [hasHero, album, heroPrefix])
  const artistCoverItem = useMemo(() => currentArtist ? collectionCover(currentArtist, categoryId) : undefined, [currentArtist, categoryId])
  const entryCovers = useMemo(() => new Map(visibleAlbums.map(entry => [entry.key, collectionCover(entry, identityPrefix)])), [visibleAlbums, identityPrefix])
  useAllSongsCoverLease(store, heroCoverItem?.key)
  useAllSongsCoverLease(store, present ? undefined : departureCover)
  const coverItems = useMemo(() => uniqueCovers([...(heroCoverItem ? [heroCoverItem] : []),
    ...(layout.showArtwork ? detail ? visibleSongs : [...entryCovers.values()] : [])]), [heroCoverItem, detail, visibleSongs, entryCovers, layout.showArtwork])
  const renderedCovers = useMemo(() => uniqueCovers([...(heroCoverItem ? [heroCoverItem] : []),
    ...(layout.showArtwork ? detail ? renderedSongs : renderedAlbums.flatMap(item => entryCovers.get(item.key) ?? []) : [])]), [heroCoverItem, detail, layout.showArtwork, renderedSongs, renderedAlbums, entryCovers])
  useAllSongsWindow(coverItems, panelRef, panelRef, present, loading, store, 8, renderedCovers)
  const { sectionControls } = useCollectionDetailPresence(chrome.offscreenReturn, returnTransition, undefined, hasHero)
  useEffect(() => {
    if (!present || loading || library.isFolderRestorePending || library.isFolderRescanPending || library.isImportPending) return
    if (artistMode && artistLocation) {
      if (!currentArtist) changeArtistLocation?.(null)
      else if (artistLocation.view === 'album' && !album) changeArtistLocation?.({ artistKey: artistLocation.artistKey, view: 'albums' })
    } else if (location && !album) changeLocation?.(null)
  }, [present, location, loading, library.isFolderRestorePending, library.isFolderRescanPending, library.isImportPending, album, changeLocation, artistMode, artistLocation, currentArtist, changeArtistLocation])
  useLayoutEffect(() => { if (panelRef.current) panelRef.current.scrollTop = positions.current.get(route) ?? 0 }, [route, positions])
  useCollectionHeroVisibility({ panelRef, artworkRef: hasHero ? artworkRef : managementChrome.toolbarRef,
    actionsRef: hasHero ? actionsRef : managementChrome.toolbarRef, compactActionsRef: compactRef, present,
    heroOffscreen, onHeroOffscreen: setHeroOffscreen, onActionsPassed: setActionsPassed,
    visibilityKey: layoutKey, routeKey: route, publishDetailVisibility: hasHero ? chrome.publishDetailVisibility : undefined })
  useLayoutEffect(() => { if (showSearch) searchRef.current?.focus() }, [showSearch])
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const row = [...(songsRef.current?.querySelectorAll<HTMLButtonElement>('[data-song-key]') ?? [])].find(node => node.dataset.songKey === pendingFocus.current)
    if (row) { pendingFocus.current = null; row.focus({ preventScroll: true }) }
  }, [renderedSongs])
  const rebase = controllerMotion.rebase
  useLayoutEffect(() => { if (showSearch || !hasHero && selectMode) rebase({ reveal: true }) }, [showSearch, hasHero, selectMode, rebase])
  const goUp = () => artistMode ? changeArtistLocation?.(artistLocation && artistLocation.view !== 'albums' ? { artistKey: artistLocation.artistKey, view: 'albums' } : null) : detail ? library.onAlbumLocationChange?.(null) : library.onOpenOverview?.()
  const goBack = () => artistRoot ? library.onOpenOverview?.() : goUp()
  const openEntry = (entry: AlbumEntry) => artistMode ? changeArtistLocation?.(artistRoot ? { artistKey: entry.key, view: 'albums' } : { artistKey: artistLocation!.artistKey, view: 'album', albumKey: entry.key }) : library.onAlbumLocationChange?.(entry.key)
  const toggleSelect = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const play = (key?: string) => {
    const entries = key ? visibleSongs.filter(item => item.available) : candidates
    const target = key ? entries.find(item => item.key === key) : entries[0]
    if (target && !loading && !playlist.isOpenAudioDisabled) library.onPlaySong?.(target.scope, target.trackId, entries.map(({ scope, trackId }) => ({ scope, trackId })))
  }
  const toggleSelection = () => { setSelectMode(!selectMode); setSelected(new Set()) }
  const more = <LibraryRootMenu categoryId={categoryId} library={library} />
  const menuCategoryId = categoryId
  const menuPinned = library.pinnedCategoryIds?.includes(menuCategoryId) ?? false
  const menuBusy = Boolean(library.isImportPending || library.isFolderRescanPending)
  const artistMenuActions: readonly PlaylistHeroMoreAction[] = [
    { label: '选择文件夹', icon: selectFoldersIcon, disabled: menuBusy || !library.onSelectFolders, onSelect: library.onSelectFolders },
    { label: '重新扫描', icon: rescanIcon, disabled: menuBusy || !library.onRescanFolders, onSelect: library.onRescanFolders },
    { label: '封面', icon: coverIcon, description: `${categoryLabel}封面设置尚未接入，当前封面继续使用本地歌曲封面。` },
    { label: menuPinned ? '取消侧栏置顶' : '在侧栏置顶', icon: pinIcon, disabled: !library.onToggleCategoryPin, pressed: menuPinned, onSelect: () => library.onToggleCategoryPin?.(menuCategoryId) },
    { label: '列表选项', icon: listOptionsIcon, flip: true, description: '此分类的列表选项尚未接入，后续可在这里调整列表显示。' },
  ]
  const menuSongs = artistMode ? currentArtist?.songs ?? EMPTY : songs
  const heroMore = hasHero ? <PlaylistHeroMoreMenu contextLabel={categoryLabel} title={artistMode ? currentArtist?.name ?? `未知${categoryLabel}` : album?.name ?? '未知专辑'}
    count={menuSongs.length} totalClock={clock(menuSongs) ?? '读取中'} actions={artistMenuActions}
    artwork={<ArtistMenuArtwork item={artistMode ? artistCoverItem : heroCoverItem} store={store} />} /> : more
  const renderActions = (compact = false) => <motion.div ref={compact ? compactRef : actionsRef}
    className={compact ? 'playlist-hero-actions playlist-controller-actions' : 'playlist-hero-actions'}
    role="group" aria-label={`${categoryLabel}歌曲操作`} aria-hidden={compact && (!actionsPassed || !present) || undefined} inert={compact && (!actionsPassed || !present) || undefined}
    data-actions-visible={compact ? String(actionsPassed && present) : undefined}
    variants={compact ? appearance.variants.controllerActions : undefined} initial={compact ? 'hidden' : false}
    animate={compact ? actionsPassed && present ? 'visible' : 'hidden' : undefined} transition={appearance.layoutTransition}
    style={compact ? { y: controllerMotion.offsetY } : undefined}>
    <PlaylistActionButtons compact={compact} onBack={compact ? goBack : undefined}
      shuffle={{ ...getShuffleModePresentation('shuffle-all', icons), label: `随机播放${categoryLabel}歌曲` }}
      onShuffle={() => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) }}
      shuffleDisabled={playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onShufflePlay}
      onPlay={() => play()} playDisabled={playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onPlaySong}
      playbackLocked={playlist.isOpenAudioDisabled} searchOpen={showSearch} onSearch={toggleSearch}
      selectMode={selectMode} onSelect={toggleSelection} selectDisabled={!hasHero && !visibleAlbums.length} more={heroMore} />
  </motion.div>
  return <>
    <motion.section ref={panelRef} className="playlist-management-content folder-hierarchy-content album-library-content" aria-label={categoryLabel}
      data-album-key={location ?? ''} data-album-detail={albumDetail || undefined} data-navigation-key={route} data-has-hero={hasHero || undefined} data-artist-root={artistRoot || undefined} data-artist-view={artistLocation?.view} data-select-mode={selectMode || undefined}
      inert={!present || undefined} aria-hidden={!present || undefined} onScroll={event => { if (present) positions.current.set(route, event.currentTarget.scrollTop) }}
      variants={offscreenEntry && present ? appearance.libraryNavigation.detailReturn.incoming : chrome.offscreenReturn ? appearance.libraryNavigation.detailReturn.outgoing : appearance.variants.backdrop}
      transition={offscreenEntry ? appearance.libraryNavigation.transition : !hasHero && managementChrome.atomicOverview ? { duration: 0 } : returnTransition}
      initial={!hasHero && managementChrome.atomicOverview ? false : 'initial'} animate={present && offscreenEntry ? entryControls : hasHero ? sectionControls : 'animate'}
      exit={hasHero ? undefined : managementChrome.atomicOverview ? 'animate' : 'exit'} tabIndex={-1}>
      {hasHero ? <CollectionHero className="album-hero" artworkRef={artworkRef} localProjection={heroOffscreen || !sharedProjection}
        artworkLayoutId={!sharedProjection || heroOffscreen ? undefined : `${heroPrefix}-cover:${heroIdentity}`}
        titleLayoutId={!sharedProjection || heroOffscreen ? undefined : `${heroPrefix}-name:${heroIdentity}`} transition={returnTransition}
        songKey={heroCover?.key} coverKey={heroCoverItem?.key} artwork={<AlbumCover song={heroCoverItem} store={store} hero />}
        category={<Button className="playlist-hero-category" size="sm" variant="ghost" aria-label={`返回${artistOverview ? categoryLabel : artistMode ? currentArtist?.name ?? categoryLabel : '专辑'}`} onClick={goBack}><CollectionReturnIcon data-icon="inline-start" aria-hidden="true" />{artistOverview ? categoryLabel : artistMode ? currentArtist?.name ?? categoryLabel : '专辑'}</Button>}
        title={artistSongs ? `所有${categoryLabel}歌曲` : album?.name ?? categoryLabel} extraMetadata={album?.artist ? <p className="playlist-hero-meta collection-hero-parent-meta">{album.artist}</p> : undefined}
        metadata={artistSongs ? <p className="playlist-hero-meta"><span className="artist-songs-meta-icon" style={{ maskImage: `url("${artistSongsMusicNote}")` }} aria-hidden="true" />{songs.length} 首歌曲</p>
          : <p className="playlist-hero-meta">{albumDetail ? <span className="album-detail-meta-icon" style={{ maskImage: `url("${artistSongsMusicNote}")` }} aria-hidden="true" /> : <icons.music aria-hidden="true" />}{songs.length}{clock(songs) ? ` | ${clock(songs)}` : ''}{albumDetail && album?.year != null ? ` | ${album.year}` : ''}</p>} actions={renderActions()} /> : null}
      <div ref={gridRef} data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-artwork={layout.showArtwork} style={layout.style}>
        {!hasHero ? <CollectionManagementHeader category={category} chrome={managementChrome} sharedProjection={sharedProjection} onOverview={goBack} returnTransition={returnTransition} more={more}
          actions={{ shuffleLabel: `随机播放${categoryLabel}歌曲`, onShuffle: () => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) },
            shuffleDisabled: playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onShufflePlay,
            playLabel: `播放${categoryLabel}歌曲`, onPlay: () => play(), playDisabled: playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onPlaySong,
            playbackLocked: playlist.isOpenAudioDisabled, searchLabel: `搜索${categoryLabel}和歌曲`, searchOpen: showSearch, onSearch: toggleSearch,
            selectMode, selectDisabled: !visibleAlbums.length, onSelect: toggleSelection, selectedCount: selected.size }} /> : null}
        {showSearch ? <motion.div className="playlist-management-search" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><Input ref={searchRef} type="search" aria-label={`搜索${categoryLabel}和歌曲`} placeholder={detail ? '搜索集合中的歌曲' : artistRoot ? `搜索${categoryLabel}` : '搜索专辑或专辑作者'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedRequest(searchRequestId) } }} /></motion.div> : null}
        <span className="sr-only" role="status">{announcement}</span>
        {detail && selectMode ? <p className="folder-selection-status" role="status">已选择 {selected.size} 项</p> : null}
        {artistOverview ? <Button variant="ghost" className="artist-all-songs" data-song-key={heroCover?.key} data-cover-key={heroCoverItem?.key} disabled={loading || selectMode}
          onClick={() => changeArtistLocation?.({ artistKey: artistLocation!.artistKey, view: 'songs' })}>
          <span className="artist-all-songs-cover" aria-hidden="true"><AlbumCover song={heroCoverItem} store={store} artist /></span>
          <span className="artist-all-songs-copy"><span className="artist-all-songs-title">所有{categoryLabel}歌曲</span>
            <span className="artist-song-count"><span className="artist-all-songs-music" style={{ maskImage: `url("${artistMusicNote}")` }} aria-hidden="true" /><span>{currentArtist?.songs.length ?? 0} 首歌曲</span></span>
          </span>
        </Button> : null}
        {loading ? <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>正在读取{categoryLabel}</EmptyTitle><EmptyDescription>正在读取曲库中的{categoryLabel}标签。</EmptyDescription></EmptyHeader></MotionEmpty>
          : !detail ? <div ref={albumSpaceRef} style={albumWindow.spaceStyle}><div ref={albumListRef} onKeyDown={event => {
            if (!albumWindow.enabled || event.key !== 'Tab') return
            const row = (event.target as HTMLElement).closest<HTMLElement>('[data-album-key]')
            if (!row) return
            const next = visibleAlbums.findIndex(item => item.key === row.dataset.albumKey) + (event.shiftKey ? -1 : 1)
            if (next < 0 || next >= visibleAlbums.length || next >= albumWindow.first && next < albumWindow.end) return
            event.preventDefault(); pendingAlbumFocus.current = visibleAlbums[next].key; scrollToAlbum(next)
          }} className="folder-directory-list album-list" aria-label={`${listLabel}列表`} data-folder-flow={folderLayout.flow} data-folder-level={layout.level} style={{ ...cardGridStyle, ...albumWindow.gridStyle }}>
            {renderedAlbums.map(item => <motion.div key={item.key} style={{ minWidth: 0, transformOrigin: 'left top' }} variants={navigationMotion.cover}
              initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><AlbumCard album={item} store={store} level={layout.level} sharedProjection={sharedProjection} projectionKey={projectionKey} transition={returnTransition} selected={selected.has(item.key)} selectMode={selectMode}
              artist={artistRoot} categoryLabel={categoryLabel} identityPrefix={identityPrefix} onActivate={() => { if (selectMode) toggleSelect(item.key); else { setDepartureCover(entryCovers.get(item.key)?.key); openEntry(item) } }} /></motion.div>)}
          </div></div> : <div ref={spaceRef} style={songWindow.spaceStyle}>
            <div ref={songsRef} className="playlist-grid folder-songs album-songs" data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-columns={layout.columns} style={{ ...layout.style, ...songWindow.gridStyle }} onKeyDown={event => {
              if (!songWindow.enabled || event.key !== 'Tab') return
              const row = (event.target as HTMLElement).closest<HTMLElement>('[data-song-key]')
              if (!row) return
              let next = visibleSongs.findIndex(item => item.key === row.dataset.songKey) + (event.shiftKey ? -1 : 1)
              while (next >= 0 && next < visibleSongs.length && !selectMode && (!visibleSongs[next].available || playlist.isOpenAudioDisabled)) next += event.shiftKey ? -1 : 1
              if (next < 0 || next >= visibleSongs.length || next >= songWindow.first && next < songWindow.end || !panelRef.current || !spaceRef.current) return
              event.preventDefault(); pendingFocus.current = visibleSongs[next].key
              panelRef.current.scrollTop += spaceRef.current.getBoundingClientRect().top - panelRef.current.getBoundingClientRect().top + Math.floor(next / layout.columns) * songWindow.stride
            }}>{renderedSongs.map(item => <div key={item.key} className="folder-song-slot album-song-slot" data-collection-key={item.key}><AlbumSong item={item} store={store} playlist={playlist} selected={selected.has(item.key)} selectMode={selectMode} artworkVisible={layout.showArtwork} onSelect={toggleSelect} onPlay={play} /></div>)}</div>
          </div>}
        {!loading && (detail ? !visibleSongs.length : !visibleAlbums.length) ? <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{query ? `没有匹配的${artistRoot ? categoryLabel : detail ? '歌曲' : '专辑'}` : detail ? '集合中没有歌曲' : `暂无${categoryLabel}`}</EmptyTitle><EmptyDescription>{query ? '尝试其他名称，或清空搜索。' : `选择音乐文件夹后，按歌曲的${categoryLabel}标签浏览。`}</EmptyDescription></EmptyHeader>{!detail && !query ? <Button onClick={library.onSelectFolders} disabled={library.isImportPending || library.isFolderRestorePending}>选择文件夹</Button> : null}</MotionEmpty> : null}
      </div>
    </motion.section>
    {!detail && present ? <CollectionQuickIndex panelRef={panelRef} names={indexNames} label={listLabel} itemSelector=".album-card[data-album-key]" onJump={albumWindow.enabled ? (key, index) => { if (key === 'top') { if (panelRef.current) panelRef.current.scrollTop = 0 } else if (index !== undefined) scrollToAlbum(index) } : undefined} /> : null}
    {renderActions(true)}
  </>
}
