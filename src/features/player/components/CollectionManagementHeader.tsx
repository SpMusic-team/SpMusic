import type { ReactNode } from 'react'
import { motion, type Transition } from 'motion/react'
import { Button } from '@/components/ui/button'
import type { useCollectionManagementChrome } from '../hooks/useCollectionManagementChrome'
import type { mediaLibraryCategories } from '../model/mediaLibraryCategories'
import parentIcon from '@/assets/playlist-library/2d425.svg'
import shuffleIcon from '@/assets/playlist-library/ce103.svg'
import playIcon from '@/assets/playlist-library/a31d0.svg'
import searchIcon from '@/assets/playlist-library/514fd.svg'

type Actions = {
  shuffleLabel: string
  shuffleDisabled?: boolean
  onShuffle: () => void
  playLabel: string
  playDisabled?: boolean
  onPlay: () => void
  playbackLocked?: boolean
  searchLabel: string
  searchOpen: boolean
  onSearch: () => void
  selectMode: boolean
  selectDisabled?: boolean
  onSelect: () => void
  selectedCount: number
  extra?: ReactNode
}

// The same controls own sizing, hover/press behavior and disabled presentation.
export function ManagementActionButtons({ shuffleLabel, shuffleDisabled, onShuffle, playLabel, playDisabled, onPlay,
  playbackLocked, searchLabel, searchOpen, onSearch, selectMode, selectDisabled, onSelect, selectedCount, extra }: Actions) {
  return <>
    <Button variant="outline" aria-label={shuffleLabel} data-playback-command-lock={playbackLocked || undefined} disabled={shuffleDisabled} onClick={onShuffle}><img src={shuffleIcon} alt="" /></Button>
    <Button variant="outline" aria-label={playLabel} data-playback-command-lock={playbackLocked || undefined} disabled={playDisabled} onClick={onPlay}><img src={playIcon} alt="" /></Button>
    <Button variant="outline" aria-label={searchLabel} aria-expanded={searchOpen} onClick={onSearch}><img src={searchIcon} alt="" /></Button>
    <Button variant="outline" aria-pressed={selectMode} disabled={selectDisabled} onClick={onSelect}>{selectMode ? '取消选择' : '选择'}</Button>
    {selectMode ? <span role="status">已选择 {selectedCount} 项</span> : null}
    {extra}
  </>
}

type Props = {
  chrome: ReturnType<typeof useCollectionManagementChrome>
  category: typeof mediaLibraryCategories[number]
  title?: string
  sharedProjection: boolean
  onOverview?: () => void
  actions?: Actions
  more: ReactNode
  actionsScope?: string | null
  hideActions?: boolean
  returnTransition: Transition
}

export function CollectionManagementHeader({ chrome, category, title = category.label, sharedProjection,
  onOverview, actions, more, actionsScope, hideActions = false, returnTransition }: Props) {
  const { headingRef, toolbarRef, toolbarControls, toolbarOffset, navigationMotion, atomicOverview } = chrome
  const projectionKey = sharedProjection ? 'shared' : 'local'
  return <>
    <motion.div className="playlist-management-parent" variants={navigationMotion.chrome}
      initial={atomicOverview ? 'initial' : false} animate="animate" exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
      <Button variant="outline" onClick={onOverview} aria-label="返回媒体库"><img src={parentIcon} alt="" />媒体库</Button>
    </motion.div>
    <header ref={headingRef} className="playlist-management-heading">
      <motion.span key={`category-icon:${projectionKey}`} className="playlist-management-category" aria-hidden="true" style={{ background: `var(--playlist-category-${category.id})` }}
        layoutId={sharedProjection ? `library-category-icon:${category.id}` : undefined} layoutCrossfade={false}
        transition={{ layout: navigationMotion.transition }}><span className="media-library-category-glyph" style={{ width: category.glyphWidth, height: category.glyphHeight, maskImage: `url("${category.overviewIcon}")`, WebkitMaskImage: `url("${category.overviewIcon}")` }} /></motion.span>
      <motion.h2 key={`category-label:${projectionKey}`} layoutId={sharedProjection ? `library-category-label:${category.id}` : undefined} layoutCrossfade={false}
        transition={{ layout: navigationMotion.transition }}>{title}</motion.h2>
    </header>
    <motion.div ref={toolbarRef} className="playlist-management-toolbar" custom={toolbarOffset} variants={navigationMotion.toolbar}
      initial={false} animate={toolbarControls} exit={atomicOverview ? 'exit' : 'animate'} transition={navigationMotion.transition}>
      {actions ? <motion.div key={`actions:${projectionKey}`} className="playlist-management-actions"
        data-selection-hidden={hideActions || undefined} inert={hideActions || undefined} aria-hidden={hideActions || undefined}
        layout={sharedProjection ? 'position' : undefined} layoutId={sharedProjection && actionsScope ? `playlist-library-actions:${actionsScope}` : undefined}
        transition={{ layout: returnTransition }}><ManagementActionButtons {...actions} /></motion.div> : <div />}
      <span className="playlist-management-selection-more" data-selection-hidden={hideActions || undefined}
        inert={hideActions || undefined} aria-hidden={hideActions || undefined}>{more}</span>
    </motion.div>
  </>
}
