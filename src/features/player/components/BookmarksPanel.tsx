import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CollectionManagementHeader } from './CollectionManagementHeader'
import { PlaylistCard } from './PlaylistCard'
import { PlaylistLibrarySidebar } from './PlaylistLibrarySidebar'
import { useCollectionManagementChrome } from '../hooks/useCollectionManagementChrome'
import { useLibraryDockBinding } from '../hooks/useLibraryDockBinding'
import { useAllSongsCoverUrl, useAllSongsWindow, type AllSongsCoverStore } from '../hooks/useAllSongsWindow'
import { useCollectionLayout } from '../hooks/useCollectionLayout'
import { PLAYLIST_SONG_LAYOUTS, ALL_SONGS_LAYOUT_STORAGE_KEY, defaultAllSongsLevel } from '../model/playlistSongLayouts'
import { projectBookmarks, type BookmarkEntry } from '../model/bookmarks'
import { mediaLibraryCategories } from '../model/mediaLibraryCategories'
import type { AllSongsItem, PlayerPlaylistViewModel } from '../model/playerUiViewModel'
import '../styles/player/bookmarks.css'

const BOOKMARK_LAYOUT_SELECTORS = {
  item: '[data-song-key]', cover: '.playlist-card-cover', copy: '.playlist-card-copy',
  getId: (element: HTMLElement) => element.dataset.songKey,
}

function BookmarkCard({ bookmark, item, playlist, store, selected, selecting, busy, active, artworkVisible, showExtendedMetadata, onPlay, onSelect }: {
  bookmark: BookmarkEntry; item?: AllSongsItem; playlist: PlayerPlaylistViewModel; store: AllSongsCoverStore
  artworkVisible: boolean; showExtendedMetadata: boolean
  selected: boolean; selecting: boolean; busy: boolean; active: boolean; onPlay: () => void; onSelect: () => void
}) {
  const coverUrl = useAllSongsCoverUrl(store, bookmark.id, item?.trackId ?? '', bookmark.sourcePath)
  const track = item?.track ?? { id: bookmark.id, title: bookmark.sourcePath.split(/[\\/]/).at(-1) ?? bookmark.sourcePath,
    artist: '歌曲不在当前媒体库中', album: '', hasLocalArtwork: false }
  return <PlaylistCard track={track} songKey={bookmark.id} positionMs={showExtendedMetadata ? bookmark.positionMs : undefined} coverUrl={coverUrl}
    artworkSource={playlist.artworkSource} fallbackArtworkSource={playlist.fallbackArtworkSource}
    current={active} unavailable={!item?.available} canSelectUnavailable canActivate={!busy}
    selectMode={selecting} showReorderHandle={false} selected={selected} artworkVisible={artworkVisible} showExtendedMetadata={showExtendedMetadata}
    contentVisible contentRepresentative={false} contentShape={15} coverFailed={false} onCoverFailed={() => {}}
    onActivate={onPlay} onToggleSelect={onSelect} />
}

export function BookmarksPanel({ playlist, allSongsCoverStore, librarySidebarOpen, onLibrarySidebarOpenChange }: {
  playlist: PlayerPlaylistViewModel; allSongsCoverStore: AllSongsCoverStore; librarySidebarOpen?: boolean; onLibrarySidebarOpenChange?: (open: boolean) => void
}) {
  const library = playlist.library!
  const present = useIsPresent()
  const appearance = useAppearanceMotion()
  const icons = useSystemIcons()
  const chrome = useCollectionManagementChrome('bookmarks', present)
  const panelRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { layout, announcement } = useCollectionLayout({
    panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS,
    storageKey: ALL_SONGS_LAYOUT_STORAGE_KEY, defaultLevel: defaultAllSongsLevel,
    selectors: BOOKMARK_LAYOUT_SELECTORS, gestureArea: 'panel', wheelGestureArea: 'panel',
    announce: nextLayout => `歌曲视图已切换为${nextLayout.label}`,
    onBeforeTransition: (snapshot, grid) => {
      if (snapshot) grid.dataset.layoutTransition = 'active'
    },
    onSettled: () => { if (gridRef.current) delete gridRef.current.dataset.layoutTransition },
  })
  useLayoutEffect(() => {
    if (appearance.disabled && gridRef.current) delete gridRef.current.dataset.layoutTransition
  }, [appearance.disabled])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const rows = useMemo(() => projectBookmarks(library.allSongs ?? [], library.bookmarks ?? []), [library.allSongs, library.bookmarks])
  const visible = useMemo(() => rows.filter(({ bookmark, item }) => `${item?.track.title ?? bookmark.sourcePath} ${item?.track.artist ?? ''} ${item?.track.album ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [rows, query])
  const coverItems = useMemo(() => visible.flatMap(row => row.item ? [{ ...row.item, key: row.bookmark.id }] : []), [visible])
  const store = useAllSongsWindow(coverItems, panelRef, gridRef, layout.showArtwork, library.allSongsMetadataStatus === 'loading', allSongsCoverStore)
  const candidates = visible.filter(row => row.item?.available && (!selecting || selected.has(row.bookmark.id)))
  const busy = playlist.isOpenAudioDisabled || library.allSongsMetadataStatus === 'loading'
  const play = async (row: typeof rows[number]) => {
    if (row.item && !busy && await library.onRestoreBookmark?.(row.bookmark, row.item)) setActiveId(row.bookmark.id)
  }
  const remove = () => { if (library.onDeleteBookmarks?.([...selected])) { setSelected(new Set()); setSelecting(false) } }
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  useLibraryDockBinding('category:bookmarks', { searchOpen: search, onSearchToggle: () => { setSearch(!search); setQuery('') }, selection: {
    active: selecting, limitedActions: true, count: selected.size, total: rows.length,
    allSelected: visible.length > 0 && visible.every(row => selected.has(row.bookmark.id)), canSelectAll: visible.length > 0,
    canPlay: !busy && candidates.length > 0, canCreatePlaylist: false,
    onSelectAll: () => setSelected(new Set(visible.map(row => row.bookmark.id))), onClear: () => setSelected(new Set()),
    onExit: () => { setSelecting(false); setSelected(new Set()) }, onPlay: () => { if (candidates[0]) void play(candidates[0]) },
  } })
  return <motion.div className="playlist-management bookmarks-management" inert={!present || undefined} aria-hidden={!present || undefined}>
    <PlaylistLibrarySidebar library={library} playlistName="书签" trackCount={rows.length} totalClock="" onCurrentPlaylist={() => panelRef.current?.focus()} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}>
      <DialogContent className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" showCloseButton={false} aria-describedby={undefined}
        style={{ translate: '0 0' }}><DialogTitle className="sr-only">媒体库</DialogTitle>
        <PlaylistLibrarySidebar overlay library={{ ...library,
          onOpenOverview: () => { onLibrarySidebarOpenChange?.(false); library.onOpenOverview?.() },
          onSelectCategory: id => { onLibrarySidebarOpenChange?.(false); library.onSelectCategory?.(id) },
          onSelect: scope => { onLibrarySidebarOpenChange?.(false); library.onSelect(scope) },
        }} playlistName="书签" trackCount={rows.length} totalClock="" onCurrentPlaylist={() => onLibrarySidebarOpenChange?.(false)} />
      </DialogContent>
    </Dialog>
    <motion.section ref={panelRef} className="playlist-management-content bookmarks-content" aria-label="书签" tabIndex={-1}>
      <CollectionManagementHeader chrome={chrome} category={mediaLibraryCategories.find(category => category.id === 'bookmarks')!}
        sharedProjection={!appearance.disabled} onOverview={library.onOpenOverview} returnTransition={appearance.layoutTransition}
        more={<DropdownMenu><DropdownMenuTrigger render={<Button className="playlist-hero-icon playlist-hero-more-button" variant="outline" aria-label="更多书签操作"><icons.more /></Button>} />
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuItem disabled={!visible.length} onClick={() => { setSelecting(true); setSelected(new Set(visible.map(row => row.bookmark.id))) }}>选择全部可见书签</DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.size || busy} onClick={remove}>删除所选书签</DropdownMenuItem>
            <DropdownMenuItem onClick={() => library.onToggleCategoryPin?.('bookmarks')}>{library.pinnedCategoryIds?.includes('bookmarks') ? '取消侧栏置顶' : '在侧栏置顶'}</DropdownMenuItem>
          </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
        actions={{ shuffleLabel: '随机播放书签', shuffleDisabled: busy || !candidates.length, onShuffle: () => { void play(candidates[Math.floor(Math.random() * candidates.length)]) },
          playLabel: '播放书签', playDisabled: busy || !candidates.length, onPlay: () => { void play(candidates[0]) },
          searchLabel: '搜索书签', searchOpen: search, onSearch: () => { setSearch(!search); setQuery('') },
          selectMode: selecting, selectDisabled: !rows.length, selectedCount: selected.size, onSelect: () => { setSelecting(!selecting); setSelected(new Set()) },
          extra: selecting ? <Button variant="outline" disabled={!selected.size || busy} onClick={remove}>删除书签</Button> : null }} />
      {search ? <div className="playlist-management-search"><Input autoFocus aria-label="搜索书签" placeholder="搜索歌曲、艺术家或专辑" value={query} onChange={event => setQuery(event.target.value)} /></div> : null}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {library.allSongsMetadataStatus === 'loading' ? <p role="status" className="playlist-management-empty">正在读取书签歌曲…</p> : visible.length ?
        <div ref={gridRef} className="playlist-grid all-songs-list bookmarks-list" aria-label="书签歌曲列表"
          data-layout-flow={layout.flow} data-layout-level={layout.level} data-layout-columns={layout.columns}
          style={{ ...layout.style, touchAction: 'pan-y', transformOrigin: 'left top' }}>
          {visible.map(row => <BookmarkCard key={row.bookmark.id} {...row} playlist={playlist} store={store} selecting={selecting} selected={selected.has(row.bookmark.id)}
            artworkVisible={layout.showArtwork} showExtendedMetadata={layout.flow !== 'tile'}
            busy={Boolean(busy)} active={row.bookmark.id === activeId && row.item?.trackId === playlist.currentTrackId} onPlay={() => { void play(row) }} onSelect={() => toggle(row.bookmark.id)} />)}
        </div> : <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>{rows.length ? '未找到书签' : '暂无书签'}</EmptyTitle><EmptyDescription>{rows.length ? '试试其他歌曲、艺术家或专辑名称。' : '在当前曲目的更多菜单中添加书签，保存此刻的播放位置。'}</EmptyDescription></EmptyHeader></Empty>}
    </motion.section>
  </motion.div>
}
