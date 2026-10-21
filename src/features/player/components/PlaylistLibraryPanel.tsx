import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { motion, useAnimationControls, useIsPresent } from 'motion/react'
import { useLibraryDockBinding } from '@/features/player/hooks/useLibraryDockBinding'
import { readLibraryLayoutRect } from '@/features/player/model/libraryNavigationGeometry'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { PLAYLIST_MANAGEMENT_LAYOUTS, PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY, defaultPlaylistManagementLevel } from '@/features/player/model/playlistManagementLayouts'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LibraryCover, PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
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
const MotionEmpty = motion.create(Empty)
const QUICK_INDEX_KEYS = ['0', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const
const QUICK_INDEX_COUNT = QUICK_INDEX_KEYS.length + 1

function quickIndexKey(name: string): string {
  const first = name.trimStart().charAt(0).toUpperCase()
  if (first >= 'A' && first <= 'Z') return first
  if (first >= '0' && first <= '9') return '0'
  return '#'
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

export function PlaylistLibraryPanel({ playlist, librarySidebarOpen, onLibrarySidebarOpenChange, searchRequestId = 0 }: Props) {
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
  const returnTransition = { ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.65) }
  const library = playlist.library!
  const categoryId = library.route?.view === 'category' ? library.route.categoryId : 'playlists'
  const category = mediaLibraryCategories.find((item) => item.id === categoryId)!
  const hasDataSource = categoryId === 'playlists' || categoryId === 'folder'
  const categoryItems = useMemo(() => categoryId === 'playlists' ? library.items : categoryId === 'folder' ? library.items.filter((item) => item.sourceKind === 'folder') : [], [categoryId, library.items])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dismissedSearchRequestId, setDismissedSearchRequestId] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [activeQuickIndex, setActiveQuickIndex] = useState<string | null>(null)
  const [quickIndexPreview, setQuickIndexPreview] = useState<{ key: string; top: number; visible: boolean } | null>(null)
  const quickIndexPointer = useRef<number | null>(null)
  const quickIndexPointerKey = useRef<string | null>(null)
  const quickIndexPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
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
    panelRef, gridRef, layouts: PLAYLIST_MANAGEMENT_LAYOUTS,
    storageKey: PLAYLIST_MANAGEMENT_LAYOUT_STORAGE_KEY,
    defaultLevel: defaultPlaylistManagementLevel, selectors: MANAGEMENT_LAYOUT_SELECTORS,
    gestureArea: 'panel',
    announce: (nextLayout) => `列表视图已切换为${nextLayout.label}`,
  })
  const visible = categoryItems.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const quickIndexTargets = new Map<string, number>()
  visible.forEach((item, index) => {
    const key = quickIndexKey(item.name)
    if (!quickIndexTargets.has(key)) quickIndexTargets.set(key, index)
  })
  const selectedItems = visible.filter((item) => selected.has(item.scope))
  const playTarget = selectMode ? selectedItems[0] : visible[0]
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
    const card = index === undefined ? null : gridRef.current?.children.item(index)
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
    <motion.section ref={panelRef} className="playlist-management-content" aria-label={`${category.label}管理`}
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
          transition={{ layout: navigationMotion.transition }}>{category.label}</motion.h2>
      </header>
      <motion.div className="playlist-management-toolbar" custom={toolbarOffset} variants={navigationMotion.toolbar}
        initial={false} animate={toolbarControls} exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
        {hasDataSource ? <motion.div key={`actions:${projectionKey}`} className="playlist-management-actions"
          layout={sharedProjection ? 'position' : undefined}
          layoutId={sharedProjection && library.currentScope ? `playlist-library-actions:${library.currentScope}` : undefined}
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
      </motion.div>
      {showSearch ? <motion.div className="playlist-management-search" variants={navigationMotion.chrome}
        initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><Input ref={searchRef} type="search" aria-label={`搜索${category.label}名称`} placeholder={`搜索${category.label}`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedSearchRequestId(searchRequestId) } }} /></motion.div> : null}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {visible.length ? <div ref={gridRef} className="playlist-management-grid"
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
                transition={{ layout: returnTransition }}><LibraryCover coverTrack={item.coverTrack} />{selectMode ? <span className="playlist-management-check">{selected.has(item.scope) ? '✓' : ''}</span> : null}</motion.span>
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
      </div> : <MotionEmpty className="playlist-management-empty" variants={navigationMotion.chrome} initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}><EmptyHeader><EmptyTitle>{!hasDataSource ? `${category.label}尚未接入数据` : categoryItems.length ? `没有匹配的${category.label}` : `暂无${category.label}`}</EmptyTitle><EmptyDescription>{!hasDataSource ? `此分类的数据管理能力尚未接入。可返回媒体库，或在播放列表中浏览本次会话已导入的列表。` : categoryItems.length ? '尝试其他名称，或清空搜索。' : categoryId === 'folder' ? '导入本地音频文件夹后，可在这里浏览。本次会话中的 M3U8 列表显示在播放列表分类。' : '导入本地音频文件夹或 M3U8 列表后，在这里选择要浏览的播放列表。列表保留在本次会话中。'}</EmptyDescription></EmptyHeader><Button disabled={playlist.isOpenAudioDisabled} onClick={!hasDataSource ? library.onOpen : categoryItems.length ? () => setQuery('') : playlist.onOpenAudio}>{!hasDataSource ? '打开播放列表' : categoryItems.length ? '清空搜索' : '导入音频或播放列表'}</Button></MotionEmpty>}
    </motion.section>
    {categoryId === 'playlists' ? <>
    {quickIndexPreview ? <div className="playlist-management-quick-index-preview" data-visible={quickIndexPreview.visible} style={{ top: quickIndexPreview.top }} aria-hidden="true">
      {quickIndexPreview.key === 'top' ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 6-6 6 6M2 14l6-6 6 6" /></svg> : quickIndexPreview.key}
    </div> : null}
    <nav className="playlist-management-quick-index" aria-label="播放列表快速查找"
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
      {QUICK_INDEX_KEYS.map((key) => <button key={key} type="button" aria-label={key === '0' ? '查找数字开头的播放列表' : key === '#' ? '查找其他字符开头的播放列表' : `查找 ${key} 开头的播放列表`}
        aria-current={activeQuickIndex === key ? 'true' : undefined} title={key === '0' ? '数字' : key === '#' ? '其他字符' : key}
        onClick={(event) => activateQuickIndexByKeyboard(key, event)}>{key}</button>)}
    </nav></> : null}
  </motion.div>
}
