import { useContext, useId, type SyntheticEvent } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import type { PlaylistLibraryViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import logo from '@/assets/playlist-library/f8690.png'
import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'

type PlaylistLibrarySidebarProps = {
  playlistName: string
  trackCount: number
  totalClock: string | null
  coverTrack?: PlaylistTrackItemViewModel
  onCurrentPlaylist: () => void
  overlay?: boolean
  library?: PlaylistLibraryViewModel
}

export function PlaylistLibrarySidebar({ playlistName, trackCount, totalClock, coverTrack, onCurrentPlaylist, overlay = false, library }: PlaylistLibrarySidebarProps) {
  const appearanceMotion = useAppearanceMotion()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const isPresent = useIsPresent()
  const atomicOverview = !overlay && chromeTransition.overviewBoundary
  const stationaryHandoff = atomicOverview || !overlay && chromeTransition.handoff && !chromeTransition.playerVisible
  const headingId = useId()
  const systemIcons = useSystemIcons()
  const items = library?.items.filter((item) => item.sourceKind !== 'folder') ?? (trackCount > 0 ? [{ scope: 'current', name: playlistName, trackCount, coverTrack, totalClock }] : [])
  return (
    <motion.aside
      className="playlist-library-sidebar"
      data-overlay={overlay || undefined}
      inert={!overlay && !isPresent || undefined}
      aria-hidden={!overlay && !isPresent || undefined}
      aria-label="媒体库"
      variants={atomicOverview ? appearanceMotion.libraryNavigation.sidebar : appearanceMotion.variants.backdrop}
      transition={atomicOverview ? appearanceMotion.libraryNavigation.transition : { ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.65) }}
      initial={overlay || !atomicOverview && stationaryHandoff ? false : 'initial'}
      animate="animate"
      exit={atomicOverview ? 'exit' : stationaryHandoff ? 'animate' : 'exit'}
    >
      <div className="playlist-library-brand">
        <img className="playlist-library-logo" src={logo} alt="" />
        <span>SPMusic</span>
      </div>
      <nav className="playlist-library-categories" aria-label="媒体库分类" tabIndex={0}>
        {mediaLibraryCategories.map((category) => {
          const current = library?.route?.view === 'category' ? library.route.categoryId === category.id : category.id === 'playlists'
          return (
            <Button
              key={category.id}
              className="playlist-library-category"
              variant="ghost"
              aria-current={current ? 'page' : undefined}

              title={category.label}
              onClick={() => library?.onSelectCategory ? library.onSelectCategory(category.id) : current ? (library?.onOpen ?? onCurrentPlaylist)() : undefined}
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

            </Button>
          )
        })}
      </nav>
      <Separator className="playlist-library-separator" />
      <section className="playlist-library-lists" aria-labelledby={headingId}>
        <h2 id={headingId}>播放列表</h2>
        <div className="playlist-library-list-scroll">
          {items.length > 0 ? items.map((item) => (
            <Button key={item.scope} className="playlist-library-list" variant="ghost"
              aria-current={!library || (!library.isOpen && library.currentScope === item.scope) ? 'page' : undefined}
              onClick={() => library ? library.onSelect(item.scope) : onCurrentPlaylist()}>
              <span className="playlist-library-list-cover" aria-hidden="true" data-library-cover-source={item.coverSourcePath}>
                <LibraryCover coverTrack={item.coverTrack} />
              </span>
              <span className="playlist-library-list-copy">
                <span className="playlist-library-list-name">{item.name}</span>
                <span className="playlist-library-list-meta"><systemIcons.music aria-hidden="true" />{item.trackCount}{item.totalClock ? ` | ${item.totalClock}` : ''}</span>
              </span>
            </Button>
          )) : (
            <Empty className="playlist-library-empty">
              <EmptyHeader>
                <EmptyTitle>{library?.isPlaylistRestorePending ? '正在恢复播放列表' : '暂无播放列表'}</EmptyTitle>
                <EmptyDescription>{library?.isPlaylistRestorePending ? '正在读取已保存的 M3U8 清单。' : '导入 M3U8 后会自动保存，也可从全部歌曲中选择歌曲新建临时播放列表。'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </section>
    </motion.aside>
  )
}

export function LibraryCover({ coverTrack }: { coverTrack?: PlaylistTrackItemViewModel }) {
  const systemIcons = useSystemIcons()
  const source = coverTrack?.coverImage ?? coverTrack?.coverImageFallback
  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const fallback = coverTrack?.coverImageFallback
    if (fallback && image.dataset.fallbackAttempted !== 'true' && image.src !== new URL(fallback, window.location.href).href) {
      image.dataset.fallbackAttempted = 'true'
      image.src = fallback
    } else image.hidden = true
  }
  return coverTrack?.coverThumbnail ? <PlaylistCoverImage className="playlist-library-cover-image" image={coverTrack.coverThumbnail} />
    : source ? <img key={source} className="playlist-library-cover-image" src={source} alt="" decoding="async" onError={handleError} />
      : <systemIcons.music />
}
