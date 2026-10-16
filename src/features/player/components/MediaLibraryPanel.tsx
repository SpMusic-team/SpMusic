import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import type { PlayerPlaylistViewModel } from '@/features/player/model/playerUiViewModel'
import logo from '@/assets/playlist-library/f8690.png'
import more from '@/assets/playlist-library/94abf.svg'

export function MediaLibraryPanel({ playlist, onOpenPlayer }: { playlist: PlayerPlaylistViewModel; onOpenPlayer: () => void }) {
  const library = playlist.library!
  return <section className="media-library-overview" aria-label="媒体库总览">
    <header className="media-library-heading">
      <div className="media-library-brand"><img src={logo} alt="" /><h2>SPMusic</h2></div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="media-library-more" aria-label="更多媒体库操作"><span aria-hidden="true" style={{ maskImage: `url("${more}")`, WebkitMaskImage: `url("${more}")` }} /></Button>} />
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem disabled={playlist.isOpenAudioDisabled} onClick={playlist.onOpenAudio}>导入音频或播放列表</DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenPlayer}>打开播放界面</DropdownMenuItem>
          <DropdownMenuItem onClick={() => library.onSelectCategory?.('playlists')}>管理播放列表</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </header>
    <nav className="media-library-grid" aria-label="媒体库分类">
      {mediaLibraryCategories.map((category) => <Button key={category.id} variant="ghost" className="media-library-category"
        data-category-id={category.id} onClick={() => library.onSelectCategory?.(category.id)}>
        <span className="media-library-category-disc" aria-hidden="true" style={{ '--media-library-category-color': `var(--playlist-category-${category.id})` } as CSSProperties}>
          <span className="media-library-category-glyph" style={{ width: category.glyphWidth, height: category.glyphHeight, maskImage: `url("${category.overviewIcon}")`, WebkitMaskImage: `url("${category.overviewIcon}")` }} />
        </span>
        <span className="media-library-category-label">{category.label}</span>
      </Button>)}
    </nav>
  </section>
}
