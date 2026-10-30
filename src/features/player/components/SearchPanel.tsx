import { useContext, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { motion } from 'motion/react'
import { Search48Regular } from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { useAllSongsCoverUrl, useCollectionCoverUrl, useAllSongsWindow, type AllSongsCoverStore, type AllSongsCoverItem } from '../hooks/useAllSongsWindow'
import { useCollectionLayout } from '../hooks/useCollectionLayout'
import { useAllSongsRenderWindow } from '../hooks/useAllSongsRenderWindow'
import { useAlbumRenderWindow } from '../hooks/useAlbumRenderWindow'
import { LibraryDockContext, useLibraryDockBinding } from '../hooks/useLibraryDockBinding'
import { useCollectionHeroVisibility } from '../hooks/useCollectionHeroMotion'
import { usePlaylistControllerMotion } from '../hooks/usePlaylistControllerMotion'
import { PLAYLIST_SONG_LAYOUTS, type PlaylistSongLayoutDescriptor } from '../model/playlistSongLayouts'
import { FOLDER_CARD_LAYOUTS } from '../model/folderCardLayouts'
import { searchLibrary, SEARCH_CATEGORIES, uniqueSearchSongs, type SearchCategory, type SearchCollection, type SearchSection } from '../model/librarySearch'
import type { AllSongsItem, PlayerUiViewModel } from '../model/playerUiViewModel'
import { PlaylistCard } from './PlaylistCard'
import { PlaylistActionButtons } from './PlaylistActionButtons'
import type { PlaylistControllerMode } from '../model/playlistControllerMode'
import { formatDurationClock } from '../model/playlistDuration'
import albumIcon from '@/assets/playlist-library/4c15f.svg'
import musicIcon from '@/assets/playlist-library/de6be.svg'

const LAYOUTS = PLAYLIST_SONG_LAYOUTS.filter(layout => layout.flow !== 'tile')
const defaultLevel = () => 1
const SELECTORS = { item: '[data-search-key]', cover: '.folder-cover, .playlist-card-cover', copy: '.folder-copy, .playlist-card-copy', getId: (element: HTMLElement) => element.dataset.searchKey }
const ALL_CATEGORIES = SEARCH_CATEGORIES.map(([id]) => id)

function collectionCover(item: SearchCollection, category: string): AllSongsCoverItem {
  return { kind: 'track-candidates', key: JSON.stringify(['search', category, item.key]), candidates: item.songs, available: item.songs.some(song => song.available) }
}

function SearchSong({ song, store, viewModel, selected, selectMode, artwork, onSelect, onPlay }: { song: AllSongsItem; store: AllSongsCoverStore; viewModel: PlayerUiViewModel; selected: boolean; selectMode: boolean; artwork: boolean; onSelect: () => void; onPlay: () => void }) {
  const cover = useAllSongsCoverUrl(store, song.key, song.trackId, song.sourcePath)
  const [failed, setFailed] = useState<string>()
  return <div data-search-key={`songs:${song.key}`} data-song-key={song.key}>
    <PlaylistCard track={song.track} songKey={song.key} coverUrl={cover} current={viewModel.playlist.currentTrackId === song.trackId}
      unavailable={!song.available} canSelectUnavailable canActivate={!viewModel.playlist.isOpenAudioDisabled}
      selectMode={selectMode} selected={selected} artworkVisible={artwork} showExtendedMetadata
      contentVisible contentRepresentative={false} contentShape={15} coverFailed={Boolean(cover && failed === cover)} onCoverFailed={() => setFailed(cover)}
      onActivate={onPlay} onToggleSelect={onSelect} />
  </div>
}

function SearchCollectionRow({ item, category, level, store, selected, selectMode, onClick }: { item: SearchCollection; category: string; level: number; store: AllSongsCoverStore; selected: boolean; selectMode: boolean; onClick: () => void }) {
  const coverItem = useMemo(() => collectionCover(item, category), [item, category])
  const cover = useCollectionCoverUrl(store, coverItem)
  const layout = FOLDER_CARD_LAYOUTS[level]
  const seconds = item.songs.reduce((sum, song) => sum + (song.available ? song.track.durationSeconds ?? 0 : 0), 0)
  const clock = item.songs.some(song => song.available && !song.track.durationSeconds) ? null : formatDurationClock(seconds)
  return <Button variant="ghost" className="folder-row search-collection-row" data-search-key={`${category}:${item.key}`} data-cover-key={coverItem.key}
    data-folder-variant={layout.variant} data-folder-size={layout.size} style={layout.style} aria-label={`${selectMode ? '选择' : '打开'}${SEARCH_CATEGORIES.find(([id]) => id === category)?.[1]} ${item.name}`}
    aria-pressed={selectMode ? selected : undefined} onClick={onClick}>
    {layout.coverWidth ? <span className="folder-cover">{cover ? <img className="folder-cover-image" src={cover} alt="" /> : <img className="search-cover-placeholder" src={albumIcon} alt="" />}</span> : null}
    <span className="folder-copy"><span className="folder-name">{item.name}</span>{item.subtitle && layout.showParent ? <span className="folder-parent-name">{item.subtitle}</span> : null}
      <span className="folder-meta"><span className="folder-music-icon" style={{ maskImage: `url("${musicIcon}")` }} aria-hidden="true" /><span>{item.songs.length}{clock ? ` | ${clock}` : ''}</span></span>
    </span>
  </Button>
}

function SearchResultsSection({ section, panelRef, layout, store, viewModel, selected, selectMode, onSelect, onNavigate, onPlay }: {
  section: SearchSection; panelRef: RefObject<HTMLElement | null>; layout: PlaylistSongLayoutDescriptor; store: AllSongsCoverStore;
  viewModel: PlayerUiViewModel; selected: ReadonlySet<string>; selectMode: boolean; onSelect: (key: string) => void;
  onNavigate: (category: SearchCategory, item: SearchCollection) => void; onPlay: (songs: readonly AllSongsItem[], song: AllSongsItem) => void;
}) {
  const coverRootRef = useRef<HTMLDivElement>(null)
  const collectionsRef = useRef<HTMLDivElement>(null)
  const collectionSpaceRef = useRef<HTMLDivElement>(null)
  const songsRef = useRef<HTMLDivElement>(null)
  const songSpaceRef = useRef<HTMLDivElement>(null)
  const collectionWindow = useAlbumRenderWindow(section.collections.length, layout.level, panelRef, collectionsRef, collectionSpaceRef)
  const songWindow = useAllSongsRenderWindow(section.songs.length, layout, panelRef, songsRef, songSpaceRef, false)
  const collections = useMemo(() => section.collections.slice(collectionWindow.first, collectionWindow.end), [section.collections, collectionWindow.first, collectionWindow.end])
  const songs = useMemo(() => section.songs.slice(songWindow.first, songWindow.end), [section.songs, songWindow.first, songWindow.end])
  const covers = useMemo<AllSongsCoverItem[]>(() => [...section.songs, ...section.collections.map(item => collectionCover(item, section.category))], [section])
  const renderedCovers = useMemo<AllSongsCoverItem[]>(() => [...songs, ...collections.map(item => collectionCover(item, section.category))], [songs, collections, section.category])
  // Each virtual section owns its mounted cover observers. Newly mounted rows
  // become owners on the same render, without rebuilding a whole-library cache.
  useAllSongsWindow(covers, panelRef, coverRootRef, Boolean(viewModel.search?.isOpen && layout.showArtwork), false, store, 0, renderedCovers)
  return <section data-search-category={section.category} aria-label={`${section.label}搜索结果`}>
    <div className="search-section-heading"><h2>{section.label}</h2><Separator /></div>
    <div ref={coverRootRef}>
      {section.collections.length ? <div ref={collectionSpaceRef} style={collectionWindow.spaceStyle} data-search-window={collectionWindow.enabled ? 'bounded' : undefined}>
        <div ref={collectionsRef} className="search-collections" data-layout-level={layout.level} data-folder-flow={layout.flow} style={collectionWindow.gridStyle}>
          {collections.map(item => <SearchCollectionRow key={item.key} item={item} category={section.category} level={layout.level} store={store} selected={selected.has(`${section.category}:${item.key}`)} selectMode={selectMode} onClick={() => selectMode ? onSelect(`${section.category}:${item.key}`) : onNavigate(section.category, item)} />)}
        </div>
      </div> : null}
      {section.songs.length ? <div ref={songSpaceRef} style={songWindow.spaceStyle} data-search-window={songWindow.enabled ? 'bounded' : undefined}>
        <div ref={songsRef} className="playlist-grid search-songs" data-layout-level={layout.level} data-layout-flow={layout.flow} style={{ ...layout.style, ...songWindow.gridStyle }}>
          {songs.map(song => <SearchSong key={song.key} song={song} store={store} viewModel={viewModel} selectMode={selectMode} selected={selected.has(`songs:${song.key}`)} artwork={layout.showArtwork} onSelect={() => onSelect(`songs:${song.key}`)} onPlay={() => onPlay(section.songs, song)} />)}
        </div>
      </div> : null}
    </div>
  </section>
}

export function SearchPanel({ viewModel, store, controllerMode = 'movable' }: { viewModel: PlayerUiViewModel; store: AllSongsCoverStore; controllerMode?: PlaylistControllerMode }) {
  const search = viewModel.search!
  const sourceLibrary = viewModel.playlist.library
  const library = useMemo(() => sourceLibrary ? { ...sourceLibrary, allSongs: search.allSongs ?? sourceLibrary.allSongs,
    allSongsMetadataStatus: search.metadataStatus ?? sourceLibrary.allSongsMetadataStatus } : undefined,
  [sourceLibrary, search.allSongs, search.metadataStatus])
  const icons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const dock = useContext(LibraryDockContext)
  const panelRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const controllerActionsRef = useRef<HTMLDivElement>(null)
  const fallbackDockRef = useRef<HTMLElement>(null)
  const [headerOffscreen, setHeaderOffscreen] = useState(false)
  const [toolbarPassed, setToolbarPassed] = useState(false)
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<readonly SearchCategory[]>(ALL_CATEGORIES)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [expanded, setExpanded] = useState<{ category: SearchCategory; item: SearchCollection } | null>(null)
  const layoutState = useCollectionLayout({ panelRef, gridRef, layouts: LAYOUTS, storageKey: 'spmusic.search.layout-level.v1', defaultLevel, selectors: SELECTORS, announce: layout => layout.label })
  const layout = layoutState.layout
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!search.isOpen || !panel) return
    const syncMarker = () => {
      const range = panel.scrollHeight - panel.clientHeight
      const progress = range > 0 ? panel.scrollTop / range : 0
      panel.style.setProperty('--more-scroll-progress', `${Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0}`)
    }
    syncMarker()
    panel.addEventListener('scroll', syncMarker, { passive: true })
    const observer = new ResizeObserver(syncMarker)
    for (const node of [panel, gridRef.current, toolbarRef.current, searchBoxRef.current]) if (node) observer.observe(node)
    return () => { panel.removeEventListener('scroll', syncMarker); observer.disconnect() }
  }, [search.isOpen])
  const controllerActive = search.isOpen && dock?.activeRouteKey === 'search'
  const controllerMotion = usePlaylistControllerMotion(panelRef, dock?.dockRef ?? fallbackDockRef,
    controllerMode, selectMode || viewModel.timeline.interaction === 'seeking' || viewModel.timeline.interaction === 'previewing',
    `${layout.level}:${query}:${categories.join(',')}:${expanded?.item.key ?? ''}:${selectMode}`, toolbarPassed,
    appearanceMotion.layoutTransition, controllerActive)
  useCollectionHeroVisibility({ panelRef, artworkRef: searchBoxRef, actionsRef: toolbarRef, compactActionsRef: controllerActionsRef,
    visibilityKey: `${layout.level}:${query}:${categories.join(',')}:${selectMode}`, routeKey: 'search', present: search.isOpen,
    heroOffscreen: headerOffscreen, onHeroOffscreen: setHeaderOffscreen, onActionsPassed: setToolbarPassed })
  const rebaseController = controllerMotion.rebase
  useLayoutEffect(() => { if (controllerActive && selectMode) rebaseController({ reveal: true }) }, [controllerActive, selectMode, rebaseController])
  const sections = useMemo(() => searchLibrary(library, query, categories), [library, query, categories])
  const displaySections = useMemo(() => {
    const item = expanded ? sections.find(section => section.category === expanded.category)?.collections.find(item => item.key === expanded.item.key) : undefined
    return expanded && item ? [{ category: expanded.category, label: item.name, collections: [], songs: item.songs }] : sections
  }, [expanded, sections])
  const queueSongs = useMemo(() => uniqueSearchSongs(displaySections.flatMap(section => [...section.songs, ...section.collections.flatMap(item => item.songs)])), [displaySections])
  const visibleKeys = displaySections.flatMap(section => [...section.songs.map(song => `songs:${song.key}`), ...section.collections.map(item => `${section.category}:${item.key}`)])
  const selectedSongs = uniqueSearchSongs(displaySections.flatMap(section => [...section.songs.filter(song => selected.has(`songs:${song.key}`)), ...section.collections.filter(item => selected.has(`${section.category}:${item.key}`)).flatMap(item => item.songs)]))
  const folderSongKeys = useMemo(() => new Set(sourceLibrary?.allSongs?.map(song => song.key)), [sourceLibrary?.allSongs])
  const canCreatePlaylist = Boolean(library?.onCreatePlaylist) && selectedSongs.length > 0 && selectedSongs.every(song => folderSongKeys.has(song.key))
  const playSongs = (songs: readonly AllSongsItem[], target?: AllSongsItem) => {
    const available = songs.filter(song => song.available)
    const first = target ?? available[0]
    if (first?.available) search.onPlaySong?.(first.scope, first.trackId, available.map(({ scope, trackId }) => ({ scope, trackId })))
  }
  useLayoutEffect(() => { if (search.isOpen) inputRef.current?.focus() }, [search.isOpen])
  useLibraryDockBinding('search', { searchOpen: true, onSearchToggle: () => search.onOpenChange(false),
    controllerOffsetY: controllerMotion.offsetY, controllerHidden: controllerMotion.hidden, selection: {
    active: selectMode, count: selected.size, total: visibleKeys.length, allSelected: visibleKeys.length > 0 && visibleKeys.every(key => selected.has(key)), canSelectAll: visibleKeys.length > 0,
    canPlay: selectedSongs.some(song => song.available) && !viewModel.playlist.isOpenAudioDisabled, canCreatePlaylist,
    onSelectAll: () => setSelected(new Set(visibleKeys)), onClear: () => setSelected(new Set()), onExit: () => { setSelectMode(false); setSelected(new Set()) },
    onPlay: () => playSongs(selectedSongs), onCreatePlaylist: () => { if (canCreatePlaylist) library?.onCreatePlaylist?.('搜索结果', selectedSongs.map(song => song.key)) },
  } })
  const toggleSelected = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const navigate = (category: SearchCategory, item: SearchCollection) => {
    // Existing library detail routes consume the registered folder projection.
    // Imported/session-only members stay in search so opening a collection can
    // never navigate to an empty or incomplete folder-only detail page.
    const needsSearchDetail = category !== 'playlists' && item.songs.some(song => !folderSongKeys.has(song.key))
    if (category === 'genre' || category === 'year' || needsSearchDetail) { setExpanded({ category, item }); return }
    search.onOpenChange(false)
    if (category === 'playlists' && item.scope) { library?.onSelect(item.scope); return }
    library?.onSelectCategory?.(category)
    if (category === 'album') library?.onAlbumLocationChange?.(item.key)
    if (category === 'artist') library?.onArtistLocationChange?.({ artistKey: item.key, view: 'albums' })
    if (category === 'album-artist') library?.onAlbumArtistLocationChange?.({ artistKey: item.key, view: 'albums' })
    if (category === 'composer') library?.onComposerLocationChange?.({ artistKey: item.key, view: 'albums' })
    if (category === 'folder' && item.path) library?.onFlatFolderLocationChange?.({ rootPath: item.path, directoryPath: item.path })
  }
  const loading = library?.allSongsMetadataStatus === 'loading'
  const nonempty = loading ? [] : displaySections.filter(section => section.songs.length || section.collections.length)
  const canPlay = !loading && !viewModel.playlist.isOpenAudioDisabled && queueSongs.some(song => song.available)
  const renderViewMenu = (compact = false) => <DropdownMenu><DropdownMenuTrigger render={<Button className={compact ? 'playlist-hero-icon playlist-hero-more-button' : 'playlist-management-more'} variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'default'} aria-label="搜索视图选项"><icons.more /></Button>} /><DropdownMenuContent><DropdownMenuGroup><DropdownMenuRadioGroup value={String(layout.level)} onValueChange={value => { const index = LAYOUTS.findIndex(item => item.level === Number(value)); layoutState.selectLevel(index) }}>
    {LAYOUTS.map(item => <DropdownMenuRadioItem key={item.level} value={String(item.level)}>{item.label}</DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
  const shuffleResults = () => { void search.onShufflePlay?.(queueSongs.filter(song => song.available).map(({ scope, trackId }) => ({ scope, trackId }))) }
  const toggleSelection = () => { setSelectMode(!selectMode); setSelected(new Set()) }
  return <><section ref={panelRef} className="search-page folder-hierarchy-content" aria-label="聚合搜索页面" hidden={!search.isOpen} inert={!search.isOpen || undefined} tabIndex={-1}>
    <header className="search-page-header"><div ref={searchBoxRef} className="search-page-input"><Search48Regular aria-hidden="true" /><Input ref={inputRef} type="search" aria-label="聚合搜索" placeholder="搜索" value={query} onChange={event => { setQuery(event.target.value); setExpanded(null); setSelected(new Set()) }} />
      {query ? <Button variant="ghost" size="icon" aria-label="清空搜索" onClick={() => { setQuery(''); setExpanded(null); setSelected(new Set()); inputRef.current?.focus() }}><icons.close /></Button> : null}
      </div>
      <div className="search-page-filters" role="group" aria-label="搜索分类"><Button variant="outline" aria-label="全选搜索分类" aria-pressed={categories.length === ALL_CATEGORIES.length} onClick={() => { setCategories(categories.length === ALL_CATEGORIES.length ? [] : ALL_CATEGORIES); setExpanded(null); setSelected(new Set()) }}>全选</Button>
        {SEARCH_CATEGORIES.map(([id, label]) => <Button key={id} variant="outline" aria-label={`筛选${label}`} aria-pressed={categories.includes(id)} onClick={() => { setCategories(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setExpanded(null); setSelected(new Set()) }}>{label}</Button>)}
      </div>
      <div ref={toolbarRef} className="search-page-actions"><div className="playlist-management-actions">
        {expanded ? <Button variant="outline" onClick={() => { setExpanded(null); setSelected(new Set()) }}>返回搜索结果</Button> : null}
        <Button variant="outline" aria-label="随机播放搜索结果" data-playback-action="shuffle" disabled={!canPlay} onClick={shuffleResults}><icons.shuffle aria-hidden="true" /></Button>
        <Button variant="outline" aria-label="播放搜索结果" data-playback-action="play" disabled={!canPlay} onClick={() => playSongs(queueSongs)}><icons.play aria-hidden="true" /></Button>
        <Button variant="outline" aria-pressed={selectMode} onClick={toggleSelection}>{selectMode ? '完成' : '选择'}</Button>
      </div>{renderViewMenu()}</div>
    </header>
    <div ref={gridRef} className="search-page-results" aria-busy={loading}>
      {loading ? <p role="status" className="search-page-status">正在读取音乐标签…</p> : null}
      {nonempty.map(section => <SearchResultsSection key={section.category} section={section} panelRef={panelRef} layout={layout} store={store} viewModel={viewModel}
        selected={selected} selectMode={selectMode} onSelect={toggleSelected} onNavigate={navigate} onPlay={playSongs} />)}
      {!loading && !nonempty.length ? <Empty><EmptyHeader><EmptyTitle>{!categories.length ? '请选择搜索分类' : query.trim() ? '没有找到匹配结果' : '暂无可搜索的内容'}</EmptyTitle><EmptyDescription>{categories.length === 1 && categories[0] === 'streams' ? '当前没有可搜索的流。' : '尝试其他关键词、分类，或将音乐添加到媒体库。'}</EmptyDescription></EmptyHeader></Empty> : null}
    </div><span className="sr-only" role="status">{layoutState.announcement}</span>
  </section>
    <motion.div ref={controllerActionsRef} className="playlist-hero-actions playlist-controller-actions" role="group" aria-label="搜索结果操作"
      data-actions-visible={String(toolbarPassed && controllerActive)} data-selection-hidden={selectMode || undefined}
      aria-hidden={!toolbarPassed || !controllerActive || selectMode || undefined} inert={!toolbarPassed || !controllerActive || selectMode || undefined}
      variants={appearanceMotion.variants.controllerActions} initial="hidden" animate={toolbarPassed && controllerActive ? 'visible' : 'hidden'}
      transition={appearanceMotion.layoutTransition} style={{ y: controllerMotion.offsetY }}>
      <PlaylistActionButtons compact onBack={() => { if (expanded) { setExpanded(null); setSelected(new Set()) } else search.onOpenChange(false) }}
        shuffle={{ icon: icons.shuffle, label: '随机播放搜索结果', pressed: false }} onShuffle={shuffleResults} shuffleDisabled={!canPlay}
        onPlay={() => playSongs(queueSongs)} playDisabled={!canPlay} playbackLocked={viewModel.playlist.isOpenAudioDisabled}
        searchOpen onSearch={() => { panelRef.current?.scrollTo({ top: 0, behavior: 'instant' }); inputRef.current?.focus() }}
        selectMode={selectMode} onSelect={toggleSelection} selectDisabled={!visibleKeys.length} more={renderViewMenu(true)} />
    </motion.div>
  </>
}
