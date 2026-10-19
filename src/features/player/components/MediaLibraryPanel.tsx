import { useContext, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { LibraryChromeTransitionContext, type LibraryNavigationGeometry } from '@/features/player/hooks/useLibraryChromeTransition'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import { readLibraryLayoutRect } from '@/features/player/model/libraryNavigationGeometry'
import type { PlayerPlaylistViewModel } from '@/features/player/model/playerUiViewModel'
import logo from '@/assets/playlist-library/f8690.png'
import more from '@/assets/playlist-library/94abf.svg'

const MotionButton = motion.create(Button)

function captureOverviewGeometry(overview: HTMLElement | null, geometry: LibraryNavigationGeometry | undefined) {
  if (!overview || !geometry) return
  const measured = [...overview.querySelectorAll<HTMLElement>('[data-category-id]')]
    .map((item) => [item.dataset.categoryId!, readLibraryLayoutRect(item)] as const)
  for (const [id, rect] of measured) geometry.items.set(id, rect)
  geometry.items.set('overview-scroll', new DOMRect(overview.scrollLeft, overview.scrollTop, 0, 0))
}

function MediaLibraryCategory({ category, onSelect }: { category: typeof mediaLibraryCategories[number]; onSelect: () => void }) {
  const appearance = useAppearanceMotion()
  const chrome = useContext(LibraryChromeTransitionContext)
  const ref = useRef<HTMLButtonElement>(null)
  const selected = chrome.categoryId === category.id
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !chrome.geometry) return
    const measure = () => chrome.geometry!.current.items.set(category.id, readLibraryLayoutRect(node))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [category.id, chrome.geometry])
  const departure = () => {
    if (appearance.disabled || selected) return { x: 0, y: 0, opacity: 1 }
    const geometry = chrome.geometry?.current
    const item = geometry?.items.get(category.id)
    const anchor = geometry?.items.get(chrome.categoryId ?? '')
    if (!item || !anchor) return { x: 0, y: 0, opacity: 0 }
    const relativeX = item.x - anchor.x
    const relativeY = item.y - anchor.y
    const sameColumn = Math.abs(relativeX) < Math.max(item.width * 0.25, 8)
    const heading = geometry?.items.get(`heading:${chrome.categoryId}`)
    const anchorTravelX = heading ? heading.x - anchor.x : 0
    const anchorTravelY = heading ? heading.y - anchor.y : 0
    return {
      x: anchorTravelX + (sameColumn ? 0 : Math.sign(relativeX) * Math.max(window.innerWidth * appearance.libraryNavigation.columnTravel, Math.abs(relativeX) * 0.8)),
      y: anchorTravelY + relativeY * appearance.libraryNavigation.expansion,
      opacity: 0,
    }
  }
  return <MotionButton ref={ref} variant="ghost" className="media-library-category"
    data-category-id={category.id} data-navigation-anchor={selected || undefined} onClick={onSelect}
    variants={{ initial: departure, animate: { x: 0, y: 0, opacity: 1 }, exit: departure }}
    initial={chrome.overviewBoundary && !selected ? 'initial' : false} animate="animate" exit="exit"
    transition={appearance.libraryNavigation.transition}>
    <motion.span className="media-library-category-disc" aria-hidden="true"
      layoutId={appearance.disabled ? undefined : `library-category-icon:${category.id}`} layoutCrossfade={false}
      transition={{ layout: appearance.libraryNavigation.transition }}
      style={{ '--media-library-category-color': `var(--playlist-category-${category.id})` } as CSSProperties}>
      <span className="media-library-category-glyph" style={{ width: category.glyphWidth, height: category.glyphHeight, maskImage: `url("${category.overviewIcon}")`, WebkitMaskImage: `url("${category.overviewIcon}")` }} />
    </motion.span>
    <motion.span className="media-library-category-label"
      layoutId={appearance.disabled ? undefined : `library-category-label:${category.id}`} layoutCrossfade={false}
      transition={{ layout: appearance.libraryNavigation.transition }}>{category.label}</motion.span>
  </MotionButton>
}

export function MediaLibraryPanel({ playlist, onOpenPlayer }: { playlist: PlayerPlaylistViewModel; onOpenPlayer: () => void }) {
  const appearanceMotion = useAppearanceMotion()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const isPresent = useIsPresent()
  const overviewRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const overview = overviewRef.current
    const scroll = chromeTransition.geometry?.current.items.get('overview-scroll')
    if (overview && scroll) {
      overview.scrollLeft = scroll.x
      overview.scrollTop = scroll.y
    }
    captureOverviewGeometry(overview, chromeTransition.geometry?.current)
  }, [chromeTransition.geometry])
  const library = playlist.library!
  return <motion.section ref={overviewRef} className="media-library-overview" aria-label="媒体库总览"
    onScroll={() => captureOverviewGeometry(overviewRef.current, chromeTransition.geometry?.current)}
    inert={!isPresent || undefined} aria-hidden={!isPresent || undefined}>
    <motion.header className="media-library-heading"
      variants={appearanceMotion.libraryNavigation.chrome}
      initial={chromeTransition.overviewBoundary ? 'initial' : false} animate="animate" exit="exit"
      transition={appearanceMotion.libraryNavigation.transition}>
      <div className="media-library-brand"><img src={logo} alt="" /><h2>SPMusic</h2></div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="media-library-more" aria-label="更多媒体库操作"><span aria-hidden="true" style={{ maskImage: `url("${more}")`, WebkitMaskImage: `url("${more}")` }} /></Button>} />
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem disabled={playlist.isOpenAudioDisabled} onClick={playlist.onOpenAudio}>导入音频或播放列表</DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenPlayer}>打开播放界面</DropdownMenuItem>
          <DropdownMenuItem onClick={() => library.onSelectCategory?.('playlists')}>管理播放列表</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </motion.header>
    <nav className="media-library-grid" aria-label="媒体库分类">
      {mediaLibraryCategories.map((category) => <MediaLibraryCategory key={category.id} category={category} onSelect={() => {
        captureOverviewGeometry(overviewRef.current, chromeTransition.geometry?.current)
        library.onSelectCategory?.(category.id)
      }} />)}
    </nav>
  </motion.section>
}
