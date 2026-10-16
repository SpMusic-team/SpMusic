import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import { useContext, useEffect, useRef, useState } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { motion, useIsPresent } from 'motion/react'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { PLAYLIST_MANAGEMENT_LAYOUTS, PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY, defaultPlaylistManagementLevel } from '@/features/player/model/playlistManagementLayouts'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LibraryCover, PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import { PlaylistPlaybackDock } from '@/features/player/components/PlaylistPlaybackDock'
import type { PlayerPlaybackViewModel, PlayerPlaylistViewModel, PlayerTimelineViewModel } from '@/features/player/model/playerUiViewModel'
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

type Props = {
  playlist: PlayerPlaylistViewModel
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

export function PlaylistLibraryPanel({ playlist, librarySidebarOpen, onLibrarySidebarOpenChange, searchRequestId = 0, playback, timeline, visualIsPlaying, playbackTransitionPending, onPlayToggle, onOpenPlayer }: Props) {
  const appearanceMotion = useAppearanceMotion()
  const isPresent = useIsPresent()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const [retiredToOverview, setRetiredToOverview] = useState(false)
  const retiringToOverview = !isPresent && chromeTransition.overviewVisible
  if (isPresent && retiredToOverview) setRetiredToOverview(false)
  else if (retiringToOverview && !retiredToOverview) setRetiredToOverview(true)
  // Overview is a complete, opaque page. Retire this page atomically instead
  // of leaving its opaque background above overview while its children fade.
  const hiddenForOverview = !isPresent && (retiredToOverview || retiringToOverview)
  const pageChromeTransition = hiddenForOverview
    ? { ...chromeTransition, overviewBoundary: true, overviewVisible: true, playerVisible: false }
    : chromeTransition
  const atomicOverview = pageChromeTransition.overviewBoundary
  // Use a 250ms default, preserving theme scaling and the presence cleanup budget.
  const returnTransition = { ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.65) }
  const library = playlist.library!
  const categoryId = library.route?.view === 'category' ? library.route.categoryId : 'playlists'
  const category = mediaLibraryCategories.find((item) => item.id === categoryId)!
  const hasDataSource = categoryId === 'playlists' || categoryId === 'folder'
  const categoryItems = categoryId === 'playlists' ? library.items : categoryId === 'folder' ? library.items.filter((item) => item.sourceKind === 'folder') : []
  const activePlaylist = library.items.find((item) => item.scope === library.activeScope)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dismissedSearchRequestId, setDismissedSearchRequestId] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const { layout, announcement } = useCollectionLayout({
    panelRef, gridRef, layouts: PLAYLIST_MANAGEMENT_LAYOUTS,
    storageKey: PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY,
    defaultLevel: defaultPlaylistManagementLevel, selectors: MANAGEMENT_LAYOUT_SELECTORS,
    gestureArea: 'panel',
    announce: (nextLayout) => `列表视图已切换为${nextLayout.label}`,
  })
  const visible = categoryItems.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedItems = visible.filter((item) => selected.has(item.scope))
  const playTarget = selectMode ? selectedItems[0] : visible[0]
  useEffect(() => {
    if (searchRequestId > 0) {
      // Focus after the input has mounted, with no timing-dependent delay.
      searchRef.current?.focus()
    }
  }, [searchRequestId, searchOpen])
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
  return <LibraryChromeTransitionContext.Provider value={pageChromeTransition}><motion.div className="playlist-management" data-select-mode={selectMode || undefined}
    style={{ visibility: hiddenForOverview ? 'hidden' : undefined }}
    inert={!isPresent || undefined} aria-hidden={!isPresent || undefined}>
    <PlaylistLibrarySidebar {...sidebarProps} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}>
      <DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" style={{ translate: '0 0' }} aria-describedby={undefined}>
        <DialogTitle className="sr-only">媒体库</DialogTitle>
        <PlaylistLibrarySidebar {...sidebarProps} overlay />
      </DialogContent>
    </Dialog>
    <motion.section ref={panelRef} className="playlist-management-content" aria-label={`${category.label}管理`}
      variants={appearanceMotion.variants.backdrop} transition={atomicOverview ? { duration: 0 } : returnTransition}
      initial={atomicOverview ? false : 'initial'} animate="animate" exit={atomicOverview ? 'animate' : 'exit'}>
      <div className="playlist-management-parent">
        <Button variant="outline" onClick={library.onOpenOverview} aria-label="返回媒体库"><img src={parentIcon} alt="" />媒体库</Button>
      </div>
      <header className="playlist-management-heading">
        <span className="playlist-management-category" aria-hidden="true" style={{ background: `var(--playlist-category-${categoryId})` }}><span className="media-library-category-glyph" style={{ width: category.glyphWidth, height: category.glyphHeight, maskImage: `url("${category.overviewIcon}")`, WebkitMaskImage: `url("${category.overviewIcon}")` }} /></span>
        <h2>{category.label}</h2>
      </header>
      <div className="playlist-management-toolbar">
        {hasDataSource ? <motion.div className="playlist-management-actions"
          layout="position"
          layoutId={!appearanceMotion.disabled && library.currentScope ? `playlist-library-actions:${library.currentScope}` : undefined}
          transition={{ layout: returnTransition }}>
          <Button variant="outline" aria-label={`随机播放${category.label}`} disabled={!playTarget || playlist.isOpenAudioDisabled} onClick={() => {
            const candidates = selectMode ? selectedItems : visible
            const target = candidates[Math.floor(Math.random() * candidates.length)]
            if (target) library.onPlay(target.scope)
          }}><img src={shuffleIcon} alt="" /></Button>
          <Button variant="outline" aria-label={`${category.label}中的歌曲`} disabled={!playTarget || playlist.isOpenAudioDisabled} onClick={() => playTarget && library.onPlay(playTarget.scope)}><img src={playIcon} alt="" /></Button>
          <Button variant="outline" aria-label={`搜索${category.label}`} aria-expanded={showSearch} onClick={() => { setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()) }}><img src={searchIcon} alt="" /></Button>
          <Button variant="outline" aria-pressed={selectMode} disabled={!categoryItems.length} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}>{selectMode ? '取消选择' : '选择'}</Button>
          {selectMode ? <span role="status">已选择 {selected.size} 项</span> : null}
        </motion.div> : <div />}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="playlist-management-more" variant="outline" aria-label="更多列表操作"><img src={moreIcon} alt="" /></Button>} />
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuItem disabled={playlist.isOpenAudioDisabled} onClick={playlist.onOpenAudio}>导入音频或播放列表</DropdownMenuItem>
            <DropdownMenuItem disabled={!visible.length} onClick={() => { setSelectMode(true); setSelected(new Set(visible.map((item) => item.scope))) }}>选择全部可见列表</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </div>
      {showSearch ? <div className="playlist-management-search"><Input ref={searchRef} type="search" aria-label={`搜索${category.label}名称`} placeholder={`搜索${category.label}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedSearchRequestId(searchRequestId) } }} /></div> : null}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {visible.length ? <div ref={gridRef} className="playlist-management-grid"
        data-layout-level={layout.level} data-layout-flow={layout.flow} data-layout-artwork={layout.showArtwork}
        aria-label={layout.label} style={{ ...layout.style, touchAction: 'pan-y' }}>
        {visible.map((item) => <div key={item.scope} className="playlist-management-card">
            <Button variant="ghost" className="playlist-management-card-button" data-playlist-scope={item.scope}
              aria-label={selectMode ? `选择 ${item.name}` : `打开${category.label} ${item.name}`}
              aria-pressed={selectMode ? selected.has(item.scope) : undefined} onClick={() => activate(item.scope)}>
              <motion.span className="playlist-management-cover" aria-hidden="true"
                layoutDependency={item.scope}
                layoutId={appearanceMotion.disabled ? undefined : `playlist-library-cover:${item.scope}`}
                transition={{ layout: returnTransition }}><LibraryCover coverTrack={item.coverTrack} />{selectMode ? <span className="playlist-management-check">{selected.has(item.scope) ? '✓' : ''}</span> : null}</motion.span>
              <span className="playlist-management-copy">
              <motion.span className="playlist-management-name" title={item.name}
                layoutDependency={item.scope}
                layout="position"
                layoutId={appearanceMotion.disabled ? undefined : `playlist-library-name:${item.scope}`}
                transition={{ layout: returnTransition }}>{item.name}</motion.span>
              <span className="playlist-management-meta"><img src={layout.level === 2 ? musicLarge : musicSmall} alt="" aria-hidden="true" /><span>{item.trackCount}{item.totalClock ? ` | ${item.totalClock}` : ''}</span></span>
              </span>
            </Button>
        </div>)}
      </div> : <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>{!hasDataSource ? `${category.label}尚未接入数据` : categoryItems.length ? `没有匹配的${category.label}` : `暂无${category.label}`}</EmptyTitle><EmptyDescription>{!hasDataSource ? `此分类的数据管理能力尚未接入。可返回媒体库，或在播放列表中浏览本次会话已导入的列表。` : categoryItems.length ? '尝试其他名称，或清空搜索。' : categoryId === 'folder' ? '导入本地音频文件夹后，可在这里浏览。本次会话中的 M3U8 列表显示在播放列表分类。' : '导入本地音频文件夹或 M3U8 列表后，在这里选择要浏览的播放列表。列表保留在本次会话中。'}</EmptyDescription></EmptyHeader><Button disabled={playlist.isOpenAudioDisabled} onClick={!hasDataSource ? library.onOpen : categoryItems.length ? () => setQuery('') : playlist.onOpenAudio}>{!hasDataSource ? '打开播放列表' : categoryItems.length ? '清空搜索' : '导入音频或播放列表'}</Button></Empty>}
    </motion.section>
    <PlaylistPlaybackDock
      playback={playback}
      playlistTrack={playlist.playbackDockTrack}
      timeline={timeline}
      visualIsPlaying={visualIsPlaying}
      playbackTransitionPending={playbackTransitionPending}
      onPlayToggle={onPlayToggle}
      searchOpen={showSearch}
      onSearchToggle={hasDataSource ? toggleSearch : undefined}
      onClose={onOpenPlayer}
      playlistSelected={false}
      playlistLabel="打开当前播放列表"
      onOpenPlaylist={activePlaylist ? () => library.onSelect(activePlaylist.scope) : undefined}
    />
  </motion.div></LibraryChromeTransitionContext.Provider>
}
