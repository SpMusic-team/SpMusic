import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LibraryCover, PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import type { PlayerPlaylistViewModel } from '@/features/player/model/playerUiViewModel'
import parentIcon from '@/assets/playlist-library/2d425.svg'
import categoryIcon from '@/assets/playlist-library/dc9e8.svg'
import shuffleIcon from '@/assets/playlist-library/ce103.svg'
import playIcon from '@/assets/playlist-library/a31d0.svg'
import searchIcon from '@/assets/playlist-library/514fd.svg'
import moreIcon from '@/assets/playlist-library/94abf.svg'

type Props = {
  playlist: PlayerPlaylistViewModel
  librarySidebarOpen: boolean
  onLibrarySidebarOpenChange: (open: boolean) => void
  searchRequestId?: number
}

export function PlaylistLibraryPanel({ playlist, librarySidebarOpen, onLibrarySidebarOpenChange, searchRequestId = 0 }: Props) {
  const library = playlist.library!
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dismissedSearchRequestId, setDismissedSearchRequestId] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const visible = library.items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedItems = visible.filter((item) => selected.has(item.scope))
  const playTarget = selectMode ? selectedItems[0] : visible[0]
  useEffect(() => {
    if (searchRequestId > 0) {
      // Focus after the input has mounted, with no timing-dependent delay.
      searchRef.current?.focus()
    }
  }, [searchRequestId, searchOpen])
  const showSearch = searchOpen || searchRequestId > dismissedSearchRequestId
  const sidebarProps = {
    playlistName: '', trackCount: 0, totalClock: null,
    library: { ...library,
      onSelect: (scope: string) => { onLibrarySidebarOpenChange(false); library.onSelect(scope) },
      onOpen: () => { onLibrarySidebarOpenChange(false); library.onOpen() },
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
  return <div className="playlist-management" data-select-mode={selectMode || undefined}>
    <PlaylistLibrarySidebar {...sidebarProps} />
    <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}>
      <DialogContent id="playlist-library-overlay" showCloseButton={false} className="playlist-library-dialog" overlayClassName="playlist-library-backdrop" style={{ translate: '0 0' }} aria-describedby={undefined}>
        <DialogTitle className="sr-only">媒体库</DialogTitle>
        <PlaylistLibrarySidebar {...sidebarProps} overlay />
      </DialogContent>
    </Dialog>
    <section className="playlist-management-content" aria-label="播放列表管理">
      <div className="playlist-management-parent">
        <Button variant="outline" disabled title="媒体库暂未开放" aria-label="媒体库暂未开放"><img src={parentIcon} alt="" />媒体库</Button>
      </div>
      <header className="playlist-management-heading">
        <span className="playlist-management-category" aria-hidden="true"><img src={categoryIcon} alt="" /></span>
        <h2>播放列表</h2>
      </header>
      <div className="playlist-management-toolbar">
        <div className="playlist-management-actions">
          <Button variant="outline" aria-label="随机播放列表" disabled={!playTarget || playlist.isOpenAudioDisabled} onClick={() => {
            const candidates = selectMode ? selectedItems : visible
            const target = candidates[Math.floor(Math.random() * candidates.length)]
            if (target) library.onPlay(target.scope)
          }}><img src={shuffleIcon} alt="" /></Button>
          <Button variant="outline" aria-label="播放列表中的歌曲" disabled={!playTarget || playlist.isOpenAudioDisabled} onClick={() => playTarget && library.onPlay(playTarget.scope)}><img src={playIcon} alt="" /></Button>
          <Button variant="outline" aria-label="搜索播放列表" aria-expanded={showSearch} onClick={() => { setSearchOpen(true); queueMicrotask(() => searchRef.current?.focus()) }}><img src={searchIcon} alt="" /></Button>
          <Button variant="outline" aria-pressed={selectMode} disabled={!library.items.length} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}>{selectMode ? '取消选择' : '选择'}</Button>
          {selectMode ? <span role="status">已选择 {selected.size} 项</span> : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="playlist-management-more" variant="outline" aria-label="更多列表操作"><img src={moreIcon} alt="" /></Button>} />
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            <DropdownMenuGroup>
            <DropdownMenuItem disabled={playlist.isOpenAudioDisabled} onClick={playlist.onOpenAudio}>导入音频或播放列表</DropdownMenuItem>
            <DropdownMenuItem disabled={!visible.length} onClick={() => { setSelectMode(true); setSelected(new Set(visible.map((item) => item.scope))) }}>选择全部可见列表</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </div>
      {showSearch ? <div className="playlist-management-search"><Input ref={searchRef} type="search" aria-label="搜索播放列表名称" placeholder="搜索播放列表" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); setDismissedSearchRequestId(searchRequestId) } }} /></div> : null}
      {visible.length ? <div className="playlist-management-grid">
        {visible.map((item) => <div key={item.scope} className="playlist-management-card">
            <Button variant="ghost" className="playlist-management-card-button" data-playlist-scope={item.scope}
              aria-label={selectMode ? `选择 ${item.name}` : `打开播放列表 ${item.name}`}
              aria-pressed={selectMode ? selected.has(item.scope) : undefined} onClick={() => activate(item.scope)}>
              <span className="playlist-management-cover" aria-hidden="true"><LibraryCover coverTrack={item.coverTrack} />{selectMode ? <span className="playlist-management-check">{selected.has(item.scope) ? '✓' : ''}</span> : null}</span>
              <span className="playlist-management-name" title={item.name}>{item.name}</span>
            </Button>
        </div>)}
      </div> : <Empty className="playlist-management-empty"><EmptyHeader><EmptyTitle>{library.items.length ? '没有匹配的播放列表' : '暂无播放列表'}</EmptyTitle><EmptyDescription>{library.items.length ? '尝试其他名称，或清空搜索。' : '导入本地音频文件夹或 M3U8 列表后，在这里选择要浏览的播放列表。列表保留在本次会话中。'}</EmptyDescription></EmptyHeader><Button disabled={playlist.isOpenAudioDisabled} onClick={library.items.length ? () => setQuery('') : playlist.onOpenAudio}>{library.items.length ? '清空搜索' : '导入音频或播放列表'}</Button></Empty>}
    </section>
  </div>
}
