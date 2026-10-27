import { motion, type Transition } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useCollectionCoverUrl, type AllSongsCoverStore, type AllSongsCoverItem } from '../hooks/useAllSongsWindow'
import type { FolderHierarchyEntry } from '../model/folderHierarchy'
import type { FolderCardLayout } from '../model/folderCardLayouts'
import folder48 from '@/assets/playlist-library/fece3.svg'
import folder32 from '@/assets/playlist-library/1633d.svg'
import folder16 from '@/assets/playlist-library/ba3db.svg'
import badge28 from '@/assets/playlist-library/97a18.svg'
import badge24 from '@/assets/playlist-library/dd04a.svg'
import badge16 from '@/assets/playlist-library/a13ec.svg'
import musicLarge from '@/assets/playlist-library/e5527.svg'
import musicMedium from '@/assets/playlist-library/de6be.svg'
import musicSmall from '@/assets/playlist-library/16dbd.svg'

type Props = {
  flat?: boolean
  navigationKey: string
  sharedProjection: boolean
  projectionKey: string
  transition: Transition
  directory: FolderHierarchyEntry
  layout: FolderCardLayout
  coverItem?: AllSongsCoverItem
  store: AllSongsCoverStore
  selectMode: boolean
  selected: boolean
  onActivate: () => void
}

function summary(directory: FolderHierarchyEntry) {
  if (directory.status === 'error') return '扫描失败'
  if (directory.status === 'loading') return '正在扫描…'
  const count = directory.songs.length
  if (directory.songs.some(item => item.available && !(Number(item.track.durationSeconds) > 0))) return String(count)
  const seconds = Math.floor(directory.songs.reduce((sum, item) => sum + (item.available ? item.track.durationSeconds ?? 0 : 0), 0))
  return `${count} | ${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function FolderHierarchyCard({ flat = false, navigationKey, sharedProjection, projectionKey, transition, directory, layout, coverItem, store, selectMode, selected, onActivate }: Props) {
  const cover = useCollectionCoverUrl(store, coverItem)
  const folder = layout.folderGlyph === 48 ? folder48 : layout.folderGlyph === 32 ? folder32 : folder16
  const badge = layout.folderGlyph === 28 ? badge28 : layout.folderGlyph === 24 ? badge24 : badge16
  const music = layout.musicGlyph === 'large' ? musicLarge : layout.musicGlyph === 'medium' ? musicMedium : musicSmall
  const tile = layout.variant === 'tile'
  const twoLine = layout.variant === 'row-compact' || layout.variant === 'text-two-line'
  const folderGlyph = flat ? null : <img className="folder-row-icon" src={folder} alt="" />
  const name = <motion.span key={`name:${projectionKey}`} className="folder-name" title={directory.name} layout={sharedProjection ? 'position' : undefined} layoutId={sharedProjection ? `folder-name:${navigationKey}` : undefined} transition={{ layout: transition }}>{directory.name}</motion.span>
  const parent = layout.showParent ? <span className="folder-parent-name" title={directory.parentName}>{directory.parentName}</span> : null
  const statistics = layout.showStatistics ? <span className="folder-meta"><span className="folder-music-icon" data-music-glyph={layout.musicGlyph} style={{ maskImage: `url("${music}")` }} aria-hidden="true" /><span className="folder-meta-text">{summary(directory)}</span>{!tile && !twoLine && layout.variant !== 'row-wide' ? folderGlyph : null}</span> : null
  return <Button variant="ghost" className="folder-row" data-folder-path={directory.path}
    data-folder-kind={flat ? 'flat' : 'hierarchy'} data-folder-variant={layout.variant} data-folder-size={layout.size} data-folder-level={layout.level}
    data-collection-key={`folder:${directory.path}`} data-song-key={coverItem?.key}
    aria-label={selectMode ? `选择文件夹 ${directory.name}` : `打开文件夹 ${directory.name}`}
    aria-pressed={selectMode ? selected : undefined} onClick={onActivate} style={layout.style}>
    {layout.coverWidth ? <motion.span key={`cover:${projectionKey}`} className="folder-cover" layoutId={sharedProjection ? `folder-cover:${navigationKey}` : undefined} layoutCrossfade={false} transition={{ layout: transition }}>
      {cover ? <img className="folder-cover-image" src={cover} alt="" decoding="async" /> : <img className="folder-cover-placeholder" src={folder48} alt="" />}
      {tile && !flat ? <span className="folder-badge"><img className="folder-row-icon" src={badge} alt="" /></span> : null}
    </motion.span> : null}
    <span className="folder-copy">
      {twoLine ? <><span className="folder-primary-row">{name}{folderGlyph}</span><span className="folder-secondary-row">{parent}{statistics}</span></>
        : tile ? <>{name}{parent}</> : layout.variant === 'row-wide' ? <>{name}{parent}{statistics}</> : <>{name}{statistics}</>}
      {directory.error ? <span className="folder-error">{directory.error}</span> : null}
    </span>
    {layout.variant === 'row-wide' ? folderGlyph : null}
  </Button>
}
