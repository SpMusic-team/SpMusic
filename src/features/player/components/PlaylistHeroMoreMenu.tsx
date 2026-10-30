import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import musicIcon from '@/assets/playlist-hero-menu/3ae57.svg'
import scanIcon from '@/assets/playlist-hero-menu/9b2af.svg'
import coverIcon from '@/assets/playlist-hero-menu/66817.svg'
import duplicatesIcon from '@/assets/playlist-hero-menu/9a79e.svg'
import sortIcon from '@/assets/playlist-hero-menu/08f63.svg'
import addIcon from '@/assets/playlist-hero-menu/f277d.svg'
import pinIcon from '@/assets/playlist-hero-menu/b969c.svg'
import settingsIcon from '@/assets/playlist-hero-menu/e41ce.svg'

const actions = [
  { label: '重新扫描', icon: scanIcon, description: '当前播放列表的重新扫描尚未接入。列表内容未改变。' },
  { label: '专辑封面', icon: coverIcon, description: '当前播放列表的封面设置尚未接入。封面未改变。' },
  { label: '删除重复项', icon: duplicatesIcon, description: '播放列表去重尚未接入。列表中的歌曲未删除。' },
  { label: '重新排序', icon: sortIcon, description: '播放列表重新排序尚未接入。歌曲顺序未改变。' },
  { label: '添加地址', icon: addIcon, flip: true, description: '向当前播放列表添加地址尚未接入。列表内容未改变。' },
  { label: '在侧栏置顶', icon: pinIcon, description: '单个播放列表的侧栏置顶尚未接入。侧栏顺序未改变。' },
  { label: '列表选项', icon: settingsIcon, flip: true, description: '当前播放列表的列表选项尚未接入。显示设置未改变。' },
] as const

export type PlaylistHeroMoreAction = Readonly<{
  label: string
  icon: string
  description?: string
  flip?: boolean
  disabled?: boolean
  pressed?: boolean
  onSelect?: () => void
}>
type Props = { title: string; count: number; totalClock: string; durationDetail?: string; artwork: ReactNode; contextLabel?: string; actions?: readonly PlaylistHeroMoreAction[] }

export function PlaylistHeroMoreMenu({ title, count, totalClock, durationDetail, artwork, contextLabel = '播放列表', actions: menuActions = actions }: Props) {
  const icons = useSystemIcons()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<PlaylistHeroMoreAction | null>(null)
  const [transferring, setTransferring] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const lastAction = useRef<HTMLButtonElement | null>(null)
  return <Dialog open={open} onOpenChange={value => { setTransferring(false); setNotice(null); setOpen(value) }}>
    <DialogTrigger render={<Button ref={trigger} className="playlist-hero-icon playlist-hero-more-button" variant="ghost" size="icon" aria-label={appCopy.playlistPage.more}><icons.more aria-hidden="true" /></Button>} />
    {!transferring && (notice ? <DialogContent finalFocus={trigger} className="playlist-hero-more-notice">
      <DialogHeader><DialogTitle>{notice.label}</DialogTitle><DialogDescription>{notice.description}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setNotice(null)}>返回更多操作</Button><Button onClick={() => setOpen(false)}>知道了</Button></DialogFooter>
    </DialogContent> : <DialogContent className="playlist-hero-more-menu" overlayClassName="playlist-hero-more-overlay" showCloseButton={false} aria-describedby={undefined}
      initialFocus={() => lastAction.current?.isConnected ? lastAction.current : false}>
      <DialogTitle className="sr-only">{contextLabel}更多操作</DialogTitle>
      <header className="playlist-hero-more-header">
        <div className="playlist-hero-more-artwork" aria-hidden="true">{artwork || <icons.music />}</div>
        <div className="playlist-hero-more-info"><h2 title={title}>{title}</h2>
          <p title={durationDetail}><img src={musicIcon} alt="" /><span>{count} | {totalClock}</span></p>
        </div>
      </header>
      <Separator className="playlist-hero-more-divider" />
      <div className="playlist-hero-more-scroll" tabIndex={0} role="group" aria-label={`${contextLabel}操作`}>
        {menuActions.map(action => <Button key={action.label} variant="ghost" className="playlist-hero-more-action" disabled={action.disabled} aria-pressed={action.pressed}
          onClick={event => {
            lastAction.current = event.currentTarget
            if (!action.onSelect) { setNotice(action); return }
            // Suppress the old focus trap before another dialog takes ownership.
            trigger.current?.focus({ preventScroll: true })
            setTransferring(true)
            setOpen(false)
            action.onSelect()
          }}>
          <img src={action.icon} className={action.flip ? 'playlist-hero-more-flipped' : undefined} alt="" /><span>{action.label}</span>
        </Button>)}
      </div>
    </DialogContent>)}
  </Dialog>
}
