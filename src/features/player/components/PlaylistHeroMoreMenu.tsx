import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

type Props = { title: string; count: number; totalClock: string; durationDetail?: string; artwork: ReactNode }

// The content viewport starts below the fixed header. Its scrollbar uses the
// whole dialog, so thumb travel must be measured independently of that viewport.
function PlaylistMenuScrollbar({ scroll, controls }: { scroll: HTMLDivElement | null; controls: string }) {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; grabOffset: number } | null>(null)
  const [value, setValue] = useState({ max: 0, position: 0 })
  useLayoutEffect(() => {
    const rail = track.current
    const marker = thumb.current
    if (!scroll || !rail || !marker) return
    const sync = () => {
      const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
      const position = Math.max(0, Math.min(max, scroll.scrollTop))
      const travel = Math.max(0, rail.clientHeight - marker.offsetHeight)
      marker.style.transform = `translateY(${max ? position / max * travel : 0}px)`
      setValue(previous => previous.max === max && previous.position === position ? previous : { max, position })
    }
    sync()
    scroll.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(scroll)
    observer.observe(rail)
    return () => { scroll.removeEventListener('scroll', sync); observer.disconnect(); drag.current = null }
  }, [scroll])
  const moveTo = (clientY: number, grabOffset: number) => {
    const rail = track.current
    const marker = thumb.current
    if (!scroll || !rail || !marker) return
    const travel = rail.clientHeight - marker.offsetHeight
    const fraction = travel > 0 ? (clientY - rail.getBoundingClientRect().top - grabOffset) / travel : 0
    scroll.scrollTo({ top: Math.max(0, Math.min(1, fraction)) * Math.max(0, scroll.scrollHeight - scroll.clientHeight), behavior: 'instant' })
  }
  return <div ref={track} className="playlist-hero-more-scrollbar" role="scrollbar" tabIndex={value.max > 0 ? 0 : -1}
    aria-label="播放列表操作滚动条" aria-controls={controls} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={value.max ? Math.round(value.position / value.max * 100) : 0} data-overflow={value.max > 0 || undefined}
    onPointerDown={event => {
      if (event.button !== 0 || !thumb.current || value.max <= 0) return
      event.preventDefault()
      const onThumb = thumb.current.contains(event.target as Node)
      const grabOffset = onThumb ? event.clientY - thumb.current.getBoundingClientRect().top : thumb.current.offsetHeight / 2
      drag.current = { pointerId: event.pointerId, grabOffset }
      event.currentTarget.setPointerCapture(event.pointerId)
      if (!onThumb) moveTo(event.clientY, grabOffset)
    }}
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) moveTo(event.clientY, drag.current.grabOffset) }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
    onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      if (!scroll) return
      const keys: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: scroll.clientHeight, PageUp: -scroll.clientHeight }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scroll.scrollTo({ top: event.key === 'Home' ? 0 : value.max, behavior: 'instant' }) }
      else if (event.key in keys) { event.preventDefault(); scroll.scrollTo({ top: scroll.scrollTop + keys[event.key]!, behavior: 'instant' }) }
    }}>
    <div ref={thumb} className="playlist-hero-more-scrollbar-thumb" />
  </div>
}

export function PlaylistHeroMoreMenu({ title, count, totalClock, durationDetail, artwork }: Props) {
  const icons = useSystemIcons()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<(typeof actions)[number] | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const lastAction = useRef<HTMLButtonElement | null>(null)
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null)
  const scrollId = useId()
  return <Dialog open={open} onOpenChange={value => { setNotice(null); setOpen(value) }}>
    <DialogTrigger render={<Button ref={trigger} className="playlist-hero-icon playlist-hero-more-button" variant="ghost" size="icon" aria-label={appCopy.playlistPage.more}><icons.more aria-hidden="true" /></Button>} />
    {notice ? <DialogContent finalFocus={trigger} className="playlist-hero-more-notice">
      <DialogHeader><DialogTitle>{notice.label}</DialogTitle><DialogDescription>{notice.description}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setNotice(null)}>返回更多操作</Button><Button onClick={() => setOpen(false)}>知道了</Button></DialogFooter>
    </DialogContent> : <DialogContent className="playlist-hero-more-menu" overlayClassName="playlist-hero-more-overlay" showCloseButton={false} aria-describedby={undefined}
      initialFocus={() => lastAction.current?.isConnected ? lastAction.current : false}>
      <DialogTitle className="sr-only">播放列表更多操作</DialogTitle>
      <header className="playlist-hero-more-header">
        <div className="playlist-hero-more-artwork" aria-hidden="true">{artwork || <icons.music />}</div>
        <div className="playlist-hero-more-info"><h2 title={title}>{title}</h2>
          <p title={durationDetail}><img src={musicIcon} alt="" /><span>{count} | {totalClock}</span></p>
        </div>
      </header>
      <Separator className="playlist-hero-more-divider" />
      <div ref={setScroll} id={scrollId} className="playlist-hero-more-scroll" tabIndex={0} role="group" aria-label="播放列表操作">
        {actions.map(action => <Button key={action.label} variant="ghost" className="playlist-hero-more-action" onClick={event => { lastAction.current = event.currentTarget; setNotice(action) }}>
          <img src={action.icon} className={'flip' in action ? 'playlist-hero-more-flipped' : undefined} alt="" /><span>{action.label}</span>
        </Button>)}
      </div>
      <PlaylistMenuScrollbar scroll={scroll} controls={scrollId} />
    </DialogContent>}
  </Dialog>
}
