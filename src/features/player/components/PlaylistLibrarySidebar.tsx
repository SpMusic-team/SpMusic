import type { SyntheticEvent } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import logo from '@/assets/playlist-library/f8690.png'
import songs from '@/assets/playlist-library/2705a.svg'
import folder from '@/assets/playlist-library/39148.svg'
import folders from '@/assets/playlist-library/eadad.svg'
import album from '@/assets/playlist-library/4c15f.svg'
import artist from '@/assets/playlist-library/65239.svg'
import albumArtist from '@/assets/playlist-library/7b1e7.svg'
import genre from '@/assets/playlist-library/371cc.svg'
import year from '@/assets/playlist-library/8993f.svg'
import composer from '@/assets/playlist-library/07ce2.svg'
import playlists from '@/assets/playlist-library/84ec1.svg'
import streams from '@/assets/playlist-library/5eeee.svg'
import queue from '@/assets/playlist-library/19c02.svg'
import bookmarks from '@/assets/playlist-library/e2f96.svg'
import mostPlayed from '@/assets/playlist-library/be8c7.svg'
import highestRated from '@/assets/playlist-library/196c7.svg'
import lowestRated from '@/assets/playlist-library/602f9.svg'
import recentPlayed from '@/assets/playlist-library/02e4a.svg'
import recentAdded from '@/assets/playlist-library/4b586.svg'
import longTracks from '@/assets/playlist-library/d3da6.svg'

const categories = [
  { id: 'songs', label: '所有歌曲', icon: songs },
  { id: 'folder', label: '文件夹', icon: folder },
  { id: 'folders', label: '文件夹层次结构', icon: folders },
  { id: 'album', label: '专辑', icon: album },
  { id: 'artist', label: '艺术家', icon: artist },
  { id: 'album-artist', label: '专辑艺术家', icon: albumArtist },
  { id: 'genre', label: '流派', icon: genre },
  { id: 'year', label: '年份', icon: year },
  { id: 'composer', label: '作曲家', icon: composer },
  { id: 'playlists', label: '播放列表', icon: playlists },
  { id: 'streams', label: '流', icon: streams },
  { id: 'queue', label: '队列', icon: queue },
  { id: 'bookmarks', label: '书签', icon: bookmarks },
  { id: 'most-played', label: '最常播放', icon: mostPlayed },
  { id: 'highest-rated', label: '最高评级', icon: highestRated },
  { id: 'lowest-rated', label: '最低评级', icon: lowestRated },
  { id: 'recent-played', label: '最近播放', icon: recentPlayed },
  { id: 'recent-added', label: '最近添加', icon: recentAdded },
  { id: 'long-tracks', label: '长', icon: longTracks },
] as const

type PlaylistLibrarySidebarProps = {
  playlistName: string
  trackCount: number
  totalClock: string | null
  coverTrack?: PlaylistTrackItemViewModel
  onCurrentPlaylist: () => void
}

export function PlaylistLibrarySidebar({ playlistName, trackCount, totalClock, coverTrack, onCurrentPlaylist }: PlaylistLibrarySidebarProps) {
  const appearanceMotion = useAppearanceMotion()
  const systemIcons = useSystemIcons()
  const coverSource = coverTrack?.coverImage ?? coverTrack?.coverImageFallback
  const handleCoverError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const fallback = coverTrack?.coverImageFallback
    if (fallback && image.dataset.fallbackAttempted !== 'true' && image.src !== new URL(fallback, window.location.href).href) {
      image.dataset.fallbackAttempted = 'true'
      image.src = fallback
    } else image.hidden = true
  }
  return (
    <motion.aside
      className="playlist-library-sidebar"
      aria-label="媒体库"
      variants={appearanceMotion.variants.backdrop}
      transition={appearanceMotion.layoutTransition}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="playlist-library-brand">
        <img className="playlist-library-logo" src={logo} alt="" />
        <span>SPMusic</span>
      </div>
      <nav className="playlist-library-categories" aria-label="媒体库分类" tabIndex={0}>
        {categories.map((category) => {
          const current = category.id === 'playlists'
          return (
            <Button
              key={category.id}
              className="playlist-library-category"
              variant="ghost"
              aria-current={current ? 'page' : undefined}
              aria-disabled={!current || undefined}
              title={current ? category.label : `${category.label}：暂不可用`}
              onClick={current ? onCurrentPlaylist : undefined}
            >
              <span className="playlist-library-category-icon" aria-hidden="true">
                <span
                  className="playlist-library-category-glyph"
                  style={{
                    width: category.id === 'songs' ? 24 : 32,
                    height: category.id === 'songs' ? 24 : 32,
                    maskImage: `url("${category.icon}")`,
                    WebkitMaskImage: `url("${category.icon}")`,
                  }}
                />
              </span>
              <span className="playlist-library-category-label">{category.label}</span>
              {!current ? <span className="sr-only">（暂不可用）</span> : null}
            </Button>
          )
        })}
      </nav>
      <Separator className="playlist-library-separator" />
      <section className="playlist-library-lists" aria-labelledby="playlist-library-list-heading">
        <h2 id="playlist-library-list-heading">播放列表</h2>
        <div className="playlist-library-list-scroll">
          {trackCount > 0 ? (
            <Button className="playlist-library-list" variant="ghost" aria-current="page" onClick={onCurrentPlaylist}>
              <span className="playlist-library-list-cover" aria-hidden="true">
                {coverTrack?.coverThumbnail ? <PlaylistCoverImage className="playlist-library-cover-image" image={coverTrack.coverThumbnail} />
                  : coverSource ? <img key={coverSource} className="playlist-library-cover-image" src={coverSource} alt="" decoding="async" onError={handleCoverError} />
                  : <systemIcons.music />}
              </span>
              <span className="playlist-library-list-copy">
                <span className="playlist-library-list-name">{playlistName}</span>
                <span className="playlist-library-list-meta"><systemIcons.music aria-hidden="true" />{trackCount}{totalClock ? ` | ${totalClock}` : ''}</span>
              </span>
            </Button>
          ) : (
            <Empty className="playlist-library-empty">
              <EmptyHeader>
                <EmptyTitle>暂无播放列表</EmptyTitle>
                <EmptyDescription>导入歌曲后，当前列表会显示在这里。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </section>
    </motion.aside>
  )
}
