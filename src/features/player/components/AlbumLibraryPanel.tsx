import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { CornerLeftUp } from 'lucide-react'
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
import { PlaylistCard } from './PlaylistCard'
import { getShuffleModePresentation } from './playbackModePresentation'
import { useCollectionEntryProjection } from '../hooks/useCollectionEntryProjection'
import { useCollectionDetailPresence } from '../hooks/useCollectionDetailPresence'
import { useCollectionManagementChrome } from '../hooks/useCollectionManagementChrome'
import { useLibraryChromeTransition, LibraryChromeTransitionContext } from '../hooks/useLibraryChromeTransition'
import { LibraryDockContext, useLibraryDockBinding } from '../hooks/useLibraryDockBinding'
import { useCollectionHeroMotion, useCollectionHeroVisibility } from '../hooks/useCollectionHeroMotion'
import { useCollectionLayout } from '../hooks/useCollectionLayout'
import { useAllSongsRenderWindow } from '../hooks/useAllSongsRenderWindow'
import { useCollectionCoverUrl, useAllSongsCoverUrl, useAllSongsCoverLease, useAllSongsWindow, type AllSongsCoverStore } from '../hooks/useAllSongsWindow'
import { albumEntries, type AlbumEntry } from '../model/albumLibrary'
import { FOLDER_CARD_LAYOUTS } from '../model/folderCardLayouts'
import { PLAYLIST_SONG_LAYOUTS } from '../model/playlistSongLayouts'
import { mediaLibraryCategories } from '../model/mediaLibraryCategories'
import type { AllSongsItem, PlayerPlaylistViewModel, PlayerTimelineViewModel } from '../model/playerUiViewModel'
import type { PlaylistControllerMode } from '../model/playlistControllerMode'
import albumIcon from '@/assets/library-root-menu/afb47.svg'

const EMPTY: readonly AllSongsItem[] = []
const CATEGORY = { ...mediaLibraryCategories.find(item => item.id === 'album')!, overviewIcon: albumIcon }
const SELECTORS = { item: '[data-collection-key]', cover: '.folder-cover, .playlist-card-cover', copy: '.folder-copy, .playlist-card-copy', getId: (node: HTMLElement) => node.dataset.collectionKey }
const rootLevel = () => 0
const detailLevel = () => 3
type Props = { playlist: PlayerPlaylistViewModel; allSongsCoverStore: AllSongsCoverStore; librarySidebarOpen: boolean; onLibrarySidebarOpenChange: (open: boolean) => void; searchRequestId?: number; controllerMode?: PlaylistControllerMode; timelineInteraction?: PlayerTimelineViewModel['interaction'] }

function clock(songs: readonly AllSongsItem[]) {
  if (songs.some(item => item.available && !(Number(item.track.durationSeconds) > 0))) return null
  const seconds = Math.floor(songs.reduce((sum, item) => sum + (item.available ? item.track.durationSeconds ?? 0 : 0), 0))
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function AlbumCover({ song, store, hero = false }: { song?: AllSongsItem; store: AllSongsCoverStore; hero?: boolean }) {
  const cover = useCollectionCoverUrl(store, song)
  return cover ? <img className={hero ? 'playlist-hero-image' : 'folder-cover-image'} src={cover} alt="" decoding="async" />
    : hero ? null : <span className="album-cover-placeholder" style={{ maskImage: `url("${albumIcon}")` }} aria-hidden="true" />
}

function AlbumCard({ album, store, level, selected, selectMode, sharedProjection, projectionKey, transition, onActivate }: {
  album: AlbumEntry; store: AllSongsCoverStore; level: number; selected: boolean; selectMode: boolean;
  sharedProjection: boolean; projectionKey: string; transition: ReturnType<typeof useAppearanceMotion>['layoutTransition']; onActivate: () => void
}) {
  const layout = FOLDER_CARD_LAYOUTS[level]
  const style = { ...layout.style, ...(layout.flow === 'tile' ? { '--folder-title-size': '32px', '--folder-title-line': '40px', '--folder-parent-size': '24px', '--folder-parent-line': '32px' } : {}) } as CSSProperties
  return <Button variant="ghost" className="folder-row album-card" data-album-key={album.key} data-collection-key={album.key}
    data-song-key={album.coverSong?.key} data-folder-variant={layout.variant} data-folder-size={layout.size} style={style}
    aria-label={`${selectMode ? '选择' : '打开'}专辑 ${album.name}`} aria-pressed={selectMode ? selected : undefined} onClick={onActivate}>
    {layout.coverWidth ? <motion.span className="folder-cover" key={`cover:${projectionKey}`} layoutId={sharedProjection ? `album-cover:${album.key}` : undefined} layoutCrossfade={false} transition={{ layout: transition }}>
      <AlbumCover song={album.coverSong} store={store} />
    </motion.span> : null}
    <span className="folder-copy">
      <motion.span key={`title:${projectionKey}`} className="folder-name" title={album.name} layout={sharedProjection ? 'position' : undefined} layoutId={sharedProjection ? `album-name:${album.key}` : undefined} transition={{ layout: transition }}>{album.name}</motion.span>
      <span className="folder-parent-name" title={album.artist}>{album.artist}</span>
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
  const { playlist, librarySidebarOpen, onLibrarySidebarOpenChange } = props
  const library = playlist.library!
  const outerChrome = useContext(LibraryChromeTransitionContext)
  const outerPresent = useIsPresent()
  const route = library.albumLocation ? `tracks:album:${library.albumLocation}` : 'category:album'
  const [navigation, setNavigation] = useState({ route, internal: Boolean(library.albumLocation) })
  const internal = navigation.internal || navigation.route !== route
  if (navigation.route !== route) setNavigation({ route, internal: true })
  const localChrome = useLibraryChromeTransition(route, false, 'category:album')
  const chrome = { ...outerChrome, handoff: outerChrome.handoff || localChrome.handoff,
    overviewBoundary: outerPresent && internal ? false : outerChrome.overviewBoundary,
    offscreenReturn: outerPresent && internal ? localChrome.offscreenReturn : outerChrome.offscreenReturn,
    publishDetailVisibility: localChrome.publishDetailVisibility }
  const positions = useRef(new Map<string, number>())
  const sidebar = { playlistName: playlist.playlistName ?? '', trackCount: playlist.tracks.length, totalClock: null, onCurrentPlaylist: library.onOpen, library }
  return <motion.div className="playlist-management album-library" inert={!outerPresent || undefined} aria-hidden={!outerPresent || undefined}>
    <PlaylistLibrarySidebar {...sidebar} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}><DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" aria-describedby={undefined}><DialogTitle className="sr-only">媒体库</DialogTitle><PlaylistLibrarySidebar {...sidebar} overlay /></DialogContent></Dialog>
    <LibraryChromeTransitionContext.Provider value={chrome}><AnimatePresence mode="wait" propagate>
      <AlbumScene key={route} {...props} outerPresent={outerPresent} positions={positions} />
    </AnimatePresence></LibraryChromeTransitionContext.Provider>
  </motion.div>
}

function AlbumScene({ playlist, allSongsCoverStore: store, searchRequestId = 0, controllerMode = 'movable', timelineInteraction, outerPresent, positions }: Props & { outerPresent: boolean; positions: RefObject<Map<string, number>> }) {
  const library = playlist.library!
  const location = library.albumLocation
  const changeLocation = library.onAlbumLocationChange
  const detail = Boolean(location)
  const route = detail ? `tracks:album:${location}` : 'category:album'
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
  const loading = library.allSongsMetadataStatus === 'loading'
  const albums = useMemo(() => albumEntries(library.allSongs ?? EMPTY), [library.allSongs])
  const album = albums.find(item => item.key === location)
  const visibleAlbums = useMemo(() => loading ? [] : albums.filter(item => `${item.name} ${item.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [albums, query, loading])
  const indexNames = useMemo(() => visibleAlbums.map(item => item.name), [visibleAlbums])
  const songs = album?.songs ?? EMPTY
  const visibleSongs = useMemo(() => songs.filter(item => `${item.track.title} ${item.track.artist} ${item.track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [songs, query])
  const candidates = useMemo(() => (detail ? visibleSongs.filter(item => !selectMode || selected.has(item.key)) : visibleAlbums.filter(item => !selectMode || selected.has(item.key)).flatMap(item => item.songs)).filter(item => item.available), [detail, visibleSongs, visibleAlbums, selectMode, selected])
  const showSearch = searchOpen || searchRequestId > dismissedRequest
  const toggleSearch = useCallback(() => { if (showSearch) setQuery(''); setSearchOpen(!showSearch); setDismissedRequest(searchRequestId) }, [showSearch, searchRequestId])
  const managementChrome = useCollectionManagementChrome('album', present && !detail)
  const { offscreenEntry, sharedProjection, projectionKey, entryControls } = useCollectionEntryProjection(present, chrome.offscreenReturn)
  const { layout, announcement } = useCollectionLayout({ panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS,
    storageKey: detail ? 'spmusic.album-tracks.layout-level.v1' : 'spmusic.albums.layout-level.v1', defaultLevel: detail ? detailLevel : rootLevel,
    selectors: SELECTORS, gestureArea: detail ? 'grid' : 'panel', announce: next => `专辑视图已切换为${next.label}` })
  const folderLayout = FOLDER_CARD_LAYOUTS[layout.level]
  const layoutKey = `${route}:${layout.level}:${query}:${visibleSongs.length}:${showSearch}:${selectMode}:${loading}`
  const { controllerMotion, returnTransition } = useCollectionHeroMotion({ panelRef, dockRef: dock?.dockRef ?? fallbackDock,
    mode: controllerMode, seeking: timelineInteraction === 'seeking' || timelineInteraction === 'previewing', layoutKey,
    controllerEnabled: detail && present && (!dock || dock.activeRouteKey === 'category:album'), actionsPassed,
    rowSelector: '.album-song-slot' })
  useLibraryDockBinding('category:album', { searchOpen: showSearch, onSearchToggle: toggleSearch,
    controllerOffsetY: detail ? controllerMotion.offsetY : undefined, controllerHidden: detail ? controllerMotion.hidden : undefined })
  const songWindow = useAllSongsRenderWindow(visibleSongs.length, layout, panelRef, songsRef, spaceRef, loading)
  const renderedSongs = useMemo(() => visibleSongs.slice(songWindow.first, songWindow.end), [visibleSongs, songWindow.first, songWindow.end])
  const heroCover = album?.coverSong
  useAllSongsCoverLease(store, heroCover?.key)
  useAllSongsCoverLease(store, present ? undefined : departureCover)
  const coverItems = useMemo(() => detail ? [...(heroCover ? [heroCover] : []), ...(layout.showArtwork ? visibleSongs : [])]
    : layout.showArtwork ? visibleAlbums.flatMap(item => item.coverSong ? [item.coverSong] : []) : [], [detail, heroCover, visibleSongs, visibleAlbums, layout.showArtwork])
  const renderedCovers = useMemo(() => detail ? [...(heroCover ? [heroCover] : []), ...(layout.showArtwork ? renderedSongs : [])] : coverItems, [detail, heroCover, layout.showArtwork, renderedSongs, coverItems])
  useAllSongsWindow(coverItems, panelRef, panelRef, present, loading, store, 8, renderedCovers)
  useCollectionHeroVisibility({ panelRef, artworkRef, actionsRef, compactActionsRef: compactRef, present,
    heroOffscreen, onHeroOffscreen: setHeroOffscreen, onActionsPassed: setActionsPassed,
    visibilityKey: layoutKey, routeKey: route, publishDetailVisibility: chrome.publishDetailVisibility })
  const { sectionControls } = useCollectionDetailPresence(chrome.offscreenReturn, returnTransition, undefined, detail)
  useEffect(() => {
    if (present && location && !loading && !library.isFolderRestorePending && !library.isFolderRescanPending && !library.isImportPending && !album) changeLocation?.(null)
  }, [present, location, loading, library.isFolderRestorePending, library.isFolderRescanPending, library.isImportPending, album, changeLocation])
  useLayoutEffect(() => { if (panelRef.current) panelRef.current.scrollTop = positions.current.get(route) ?? 0 }, [route, positions])
  useLayoutEffect(() => { if (showSearch) searchRef.current?.focus() }, [showSearch])
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const row = [...(songsRef.current?.querySelectorAll<HTMLButtonElement>('[data-song-key]') ?? [])].find(node => node.dataset.songKey === pendingFocus.current)
    if (row) { pendingFocus.current = null; row.focus({ preventScroll: true }) }
  }, [renderedSongs])
  const rebase = controllerMotion.rebase
  useLayoutEffect(() => { if (showSearch) rebase({ reveal: true }) }, [showSearch, rebase])
  const goUp = () => detail ? library.onAlbumLocationChange?.(null) : library.onOpenOverview?.()
  const toggleSelect = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const play = (key?: string) => {
    const entries = key ? visibleSongs.filter(item => item.available) : candidates
    const target = key ? entries.find(item => item.key === key) : entries[0]
    if (target && !loading && !playlist.isOpenAudioDisabled) library.onPlaySong?.(target.scope, target.trackId, entries.map(({ scope, trackId }) => ({ scope, trackId })))
  }
  const toggleSelection = () => { setSelectMode(!selectMode); setSelected(new Set()) }
  const more = <LibraryRootMenu categoryId="album" library={library} />
  const renderActions = (compact = false) => <motion.div ref={compact ? compactRef : actionsRef}
    className={compact ? 'playlist-hero-actions playlist-controller-actions' : 'playlist-hero-actions'}
    role="group" aria-label="专辑歌曲操作" aria-hidden={compact && (!actionsPassed || !present) || undefined} inert={compact && (!actionsPassed || !present) || undefined}
    data-actions-visible={compact ? String(actionsPassed && present) : undefined}
    variants={compact ? appearance.variants.controllerActions : undefined} initial={compact ? 'hidden' : false}
    animate={compact ? actionsPassed && present ? 'visible' : 'hidden' : undefined} transition={appearance.layoutTransition}
    style={compact ? { y: controllerMotion.offsetY } : undefined}>
    <PlaylistActionButtons compact={compact} onBack={compact ? goUp : undefined}
      shuffle={{ ...getShuffleModePresentation('shuffle-all', icons), label: '随机播放专辑歌曲' }}
      onShuffle={() => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) }}
      shuffleDisabled={playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onShufflePlay}
      onPlay={() => play()} playDisabled={playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onPlaySong}
      playbackLocked={playlist.isOpenAudioDisabled} searchOpen={showSearch} onSearch={toggleSearch}
      selectMode={selectMode} onSelect={toggleSelection} more={more} />
  </motion.div>
  return <>
    <motion.section ref={panelRef} className="playlist-management-content folder-hierarchy-content album-library-content" aria-label="专辑"
      data-album-key={location ?? ''} data-navigation-key={route} data-has-hero={detail || undefined} data-select-mode={selectMode || undefined}
      inert={!present || undefined} aria-hidden={!present || undefined} onScroll={event => { if (present) positions.current.set(route, event.currentTarget.scrollTop) }}
      variants={offscreenEntry && present ? appearance.libraryNavigation.detailReturn.incoming : chrome.offscreenReturn ? appearance.libraryNavigation.detailReturn.outgoing : appearance.variants.backdrop}
      transition={offscreenEntry ? appearance.libraryNavigation.transition : !detail && managementChrome.atomicOverview ? { duration: 0 } : returnTransition}
      initial={!detail && managementChrome.atomicOverview ? false : 'initial'} animate={present && offscreenEntry ? entryControls : detail ? sectionControls : 'animate'}
      exit={detail ? undefined : managementChrome.atomicOverview ? 'animate' : 'exit'} tabIndex={-1}>
      {detail ? <CollectionHero className="album-hero" artworkRef={artworkRef} localProjection={heroOffscreen || !sharedProjection}
        artworkLayoutId={!sharedProjection || heroOffscreen ? undefined : `album-cover:${location}`}
        titleLayoutId={!sharedProjection || heroOffscreen ? undefined : `album-name:${location}`} transition={returnTransition}
        songKey={heroCover?.key} artwork={<AlbumCover song={heroCover} store={store} hero />}
        category={<Button className="playlist-hero-category" size="sm" variant="ghost" aria-label="返回专辑" onClick={goUp}><CornerLeftUp data-icon="inline-start" aria-hidden="true" />专辑</Button>}
        title={album?.name ?? '专辑'} extraMetadata={<p className="playlist-hero-meta collection-hero-parent-meta">{album?.artist}</p>}
        metadata={<p className="playlist-hero-meta"><icons.music aria-hidden="true" />{songs.length}{clock(songs) ? ` | ${clock(songs)}` : ''}</p>} actions={renderActions()} /> : null}
      <div ref={gridRef} data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-artwork={layout.showArtwork} style={layout.style}>
        {!detail ? <CollectionManagementHeader category={CATEGORY} chrome={managementChrome} sharedProjection={sharedProjection} onOverview={goUp} returnTransition={returnTransition} more={more}
          actions={{ shuffleLabel: '随机播放专辑歌曲', onShuffle: () => { void library.onShufflePlay?.(candidates.map(({ scope, trackId }) => ({ scope, trackId }))) },
            shuffleDisabled: playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onShufflePlay,
            playLabel: '播放专辑歌曲', onPlay: () => play(), playDisabled: playlist.isOpenAudioDisabled || loading || !candidates.length || !library.onPlaySong,
            playbackLocked: playlist.isOpenAudioDisabled, searchLabel: '搜索专辑和歌曲', searchOpen: showSearch, onSearch: toggleSearch,
            selectMode, selectDisabled: !visibleAlbums.length, onSelect: toggleSelection, selectedCount: selected.size }} /> : null}
        {showSearch ? <div className="playlist-management-search"><Input ref={searchRef} type="search" aria-label="搜索专辑和歌曲" placeholder={detail ? '搜索专辑中的歌曲' : '搜索专辑或专辑作者'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedRequest(searchRequestId) } }} /></div> : null}
        <span className="sr-only" role="status">{announcement}</span>
        {detail && selectMode ? <p className="folder-selection-status" role="status">已选择 {selected.size} 项</p> : null}
        {loading ? <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>正在读取专辑</EmptyTitle><EmptyDescription>正在读取曲库中的专辑标签。</EmptyDescription></EmptyHeader></Empty>
          : !detail ? <div className="folder-directory-list album-list" aria-label="专辑列表" data-folder-flow={folderLayout.flow} data-folder-level={layout.level} style={folderLayout.style}>
            {visibleAlbums.map(item => <AlbumCard key={item.key} album={item} store={store} level={layout.level} sharedProjection={sharedProjection} projectionKey={projectionKey} transition={returnTransition} selected={selected.has(item.key)} selectMode={selectMode}
              onActivate={() => { if (selectMode) toggleSelect(item.key); else { setDepartureCover(item.coverSong?.key); library.onAlbumLocationChange?.(item.key) } }} />)}
          </div> : <div ref={spaceRef} style={songWindow.spaceStyle}>
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
        {!loading && (detail ? !visibleSongs.length : !visibleAlbums.length) ? <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>{query ? '没有匹配的专辑或歌曲' : detail ? '专辑中没有歌曲' : '暂无专辑'}</EmptyTitle><EmptyDescription>{query ? '尝试其他名称，或清空搜索。' : '选择音乐文件夹后，按歌曲的专辑标签浏览。'}</EmptyDescription></EmptyHeader>{!detail && !query ? <Button onClick={library.onSelectFolders} disabled={library.isImportPending || library.isFolderRestorePending}>选择文件夹</Button> : null}</Empty> : null}
      </div>
    </motion.section>
    {!detail && present ? <CollectionQuickIndex panelRef={panelRef} names={indexNames} label="专辑" itemSelector=".album-card[data-album-key]" /> : null}
    {detail ? renderActions(true) : null}
  </>
}
