import { useId, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { DEFAULT_LONG_TRACKS_MIN_DURATION_MS, MAX_LONG_TRACKS_MIN_DURATION_MS } from '../model/longTracks'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import type { MediaLibraryCategoryId } from '@/features/player/model/mediaLibraryCategories'
import { mediaLibraryCategories } from '@/features/player/model/mediaLibraryCategories'
import type { PlaylistLibraryViewModel } from '@/features/player/model/playerUiViewModel'
import selectIcon from '@/assets/folder-root-menu/9b161.svg'
import rescanIcon from '@/assets/folder-root-menu/9b2af.svg'
import pinIcon from '@/assets/folder-root-menu/b969c.svg'
import settingsIcon from '@/assets/folder-root-menu/e41ce.svg'
import exportIcon from '@/assets/library-root-menu/fe2f6.svg'
import addIcon from '@/assets/library-root-menu/323da.svg'
import sortIcon from '@/assets/library-root-menu/b9f3f.svg'
import clearQueueIcon from '@/assets/library-root-menu/bbf7d.svg'
import historyIcon from '@/assets/library-root-menu/da4f9.svg'
import clearIcon from '@/assets/library-root-menu/27546.svg'
import category0 from '@/assets/media-library/b0f4f.svg'
import category1 from '@/assets/media-library/71c3e.svg'
import category2 from '@/assets/playlist-library/cbd63.svg'
import category3 from '@/assets/library-root-menu/afb47.svg'
import category4 from '@/assets/media-library/feb56.svg'
import category5 from '@/assets/media-library/09ad8.svg'
import category6 from '@/assets/library-root-menu/00729.svg'
import category7 from '@/assets/library-root-menu/28671.svg'
import category8 from '@/assets/media-library/80c3a.svg'
import category9 from '@/assets/playlist-library/dc9e8.svg'
import category10 from '@/assets/media-library/1acd5.svg'
import category11 from '@/assets/media-library/8e7f7.svg'
import category12 from '@/assets/media-library/01c3e.svg'
import category13 from '@/assets/library-root-menu/c95de.svg'
import category14 from '@/assets/media-library/31d62.svg'
import category15 from '@/assets/media-library/fb051.svg'
import category16 from '@/assets/library-root-menu/4b745.svg'
import category17 from '@/assets/media-library/30267.svg'
import category18 from '@/assets/media-library/18e82.svg'

const categoryIcons: Record<MediaLibraryCategoryId, string> = {
  'songs': category0,
  'folder': category1,
  'folders': category2,
  'album': category3,
  'artist': category4,
  'album-artist': category5,
  'genre': category6,
  'year': category7,
  'composer': category8,
  'playlists': category9,
  'streams': category10,
  'queue': category11,
  'bookmarks': category12,
  'most-played': category13,
  'highest-rated': category14,
  'lowest-rated': category15,
  'recent-played': category16,
  'recent-added': category17,
  'long-tracks': category18,
}

type Action = { label: string; icon: string; kind: 'select' | 'rescan' | 'pin' | 'placeholder'; description?: string }
const select: Action = { label: '选择文件夹', icon: selectIcon, kind: 'select' }
const rescan: Action = { label: '重新扫描', icon: rescanIcon, kind: 'rescan' }
const pin: Action = { label: '在侧栏置顶', icon: pinIcon, kind: 'pin' }
const settings: Action = { label: '列表选项', icon: settingsIcon, kind: 'placeholder', description: '此分类的列表选项尚未接入，后续可在这里调整列表显示。' }
const sort: Action = { label: '重新排序', icon: sortIcon, kind: 'placeholder', description: '此分类的排序功能尚未接入。' }
function actionsFor(id: MediaLibraryCategoryId): Action[] {
  if (id === 'playlists') return [
    { label: '导出', icon: exportIcon, kind: 'placeholder', description: '批量导出播放列表尚未接入。' },
    { label: '重新扫描/解析播放列表', icon: rescanIcon, kind: 'placeholder', description: '重新扫描和解析播放列表尚未接入。' },
    pin, settings,
    { label: '新增', icon: addIcon, kind: 'placeholder', description: '空白播放列表尚未接入。现在可从所有歌曲中选择歌曲，再新建播放列表；也可在媒体库总览导入 M3U8。' },
  ]
  if (id === 'queue') return [rescan, sort, pin, settings,
    { label: '清空队列', icon: clearQueueIcon, kind: 'placeholder', description: '队列清空功能尚未接入，当前播放队列未改变。' }]
  if (id === 'streams') return [select, rescan,
    { label: '添加地址', icon: addIcon, kind: 'placeholder', description: '流地址的添加与播放尚未接入。' }, pin, settings]
  if (id === 'bookmarks') return [select, rescan, sort, pin, settings]
  if (id === 'most-played' || id === 'recent-played' || id === 'recent-added') return [select, rescan, pin, settings,
    { label: '查看全部', icon: historyIcon, kind: 'placeholder', description: '此分类的完整记录尚未接入。' },
    { label: '清空', icon: clearIcon, kind: 'placeholder', description: '此分类的记录清空功能尚未接入，现有媒体库未改变。' }]
  return [select, rescan, pin, settings]
}

export function LibraryRootMenu({ categoryId, library }: { categoryId: MediaLibraryCategoryId; library: PlaylistLibraryViewModel }) {
  const icons = useSystemIcons()
  const [open, setOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [notice, setNotice] = useState<Action | null>(null)
  const [durationOptions, setDurationOptions] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState('')
  const [durationError, setDurationError] = useState('')
  const durationId = useId()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const category = mediaLibraryCategories.find(item => item.id === categoryId)!
  const pinned = library.pinnedCategoryIds?.includes(categoryId) ?? false
  const busy = library.isImportPending || library.isFolderRescanPending
  const run = (action: Action) => {
    if (action === settings && categoryId === 'long-tracks' && library.onLongTracksMinDurationChange) {
      setDurationMinutes(String((library.longTracksMinDurationMs ?? DEFAULT_LONG_TRACKS_MIN_DURATION_MS) / 60000))
      setDurationError('')
      setDurationOptions(true)
      return
    }
    if (action.kind === 'placeholder') { setNotice(action); return }
    if (action.kind === 'select') {
      // The existing folder editor owns the next focus trap.
      trigger.current?.focus({ preventScroll: true })
      const transfer = () => { setTransferring(true); setOpen(false); library.onSelectFolders?.() }
      if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.startViewTransition(() => flushSync(transfer))
      } else transfer()
      return
    }
    setOpen(false)
    if (action.kind === 'pin') library.onToggleCategoryPin?.(categoryId)
    if (action.kind === 'rescan') library.onRescanFolders?.()
  }
  return <Dialog open={open} onOpenChange={value => { setTransferring(false); setNotice(null); setDurationOptions(false); setOpen(value) }}>
    <DialogTrigger render={<Button ref={trigger} className="playlist-hero-icon playlist-hero-more-button" variant="ghost" size="icon" aria-label="更多列表操作"><icons.more aria-hidden="true" /></Button>} />
    {!transferring && (durationOptions ? <DialogContent finalFocus={trigger}>
      <form className="flex flex-col gap-4" onSubmit={event => {
        event.preventDefault()
        const minutes = Number(durationMinutes)
        if (!durationMinutes.trim() || !Number.isInteger(minutes) || minutes < 0 || minutes > Math.floor(MAX_LONG_TRACKS_MIN_DURATION_MS / 60000)) {
          setDurationError(`请输入 0–${Math.floor(MAX_LONG_TRACKS_MIN_DURATION_MS / 60000)} 之间的整数分钟。`)
          return
        }
        library.onLongTracksMinDurationChange?.(minutes * 60000)
        setDurationOptions(false)
        setOpen(false)
      }}>
        <DialogHeader><DialogTitle>长 · 列表选项</DialogTitle><DialogDescription>显示时长达到最小时长的歌曲。</DialogDescription></DialogHeader>
        <FieldGroup><Field data-invalid={Boolean(durationError)}>
          <FieldLabel htmlFor={durationId}>最小时长（分钟）</FieldLabel>
          <Input id={durationId} type="number" min={0} max={Math.floor(MAX_LONG_TRACKS_MIN_DURATION_MS / 60000)} step={1} autoFocus value={durationMinutes} aria-invalid={Boolean(durationError)} onChange={event => { setDurationMinutes(event.target.value); setDurationError('') }} />
          <FieldDescription>包含恰好达到此时长的歌曲，未知时长的歌曲不显示。</FieldDescription>
          {durationError ? <FieldError>{durationError}</FieldError> : null}
        </Field></FieldGroup>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setDurationOptions(false)}>取消</Button><Button type="submit">保存</Button></DialogFooter>
      </form>
    </DialogContent> : notice ? <DialogContent finalFocus={trigger} className="library-root-menu-notice">
      <DialogHeader><DialogTitle>{notice.label}</DialogTitle><DialogDescription>{notice.description}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setNotice(null)}>返回更多操作</Button><Button onClick={() => setOpen(false)}>知道了</Button></DialogFooter>
    </DialogContent> : <DialogContent className="folder-root-menu library-root-menu" overlayClassName="folder-root-menu-overlay" showCloseButton={false} aria-describedby={undefined}>
      <header className="folder-root-menu-header">
        <span className="folder-root-menu-category" style={{ background: `var(--playlist-category-${categoryId})` } as CSSProperties}><img src={categoryIcons[categoryId]} alt="" /></span>
        <DialogTitle className="folder-root-menu-title">{category.label}</DialogTitle>
      </header>
      <Separator className="folder-root-menu-divider" />
      <div className="folder-root-menu-actions">
        {actionsFor(categoryId).map(action => <Button key={action.label} className="folder-root-menu-action" variant="ghost"
          disabled={action.kind === 'select' ? busy || !library.onSelectFolders : action.kind === 'rescan' ? busy || !library.onRescanFolders : action.kind === 'pin' ? !library.onToggleCategoryPin : false}
          aria-pressed={action.kind === 'pin' ? pinned : undefined}
          onClick={() => run(action)}>
          <img className={action === settings ? 'folder-root-menu-settings' : undefined} src={action.icon} alt="" /><span>{action.kind === 'pin' && pinned ? '取消侧栏置顶' : action.label}</span>
        </Button>)}
      </div>
    </DialogContent>)}
  </Dialog>
}

