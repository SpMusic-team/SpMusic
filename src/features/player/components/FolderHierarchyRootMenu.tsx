import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import folderIcon from '@/assets/playlist-library/cbd63.svg'
import selectFoldersIcon from '@/assets/folder-root-menu/9b161.svg'
import rescanIcon from '@/assets/folder-root-menu/9b2af.svg'
import pinIcon from '@/assets/folder-root-menu/b969c.svg'
import settingsIcon from '@/assets/folder-root-menu/e41ce.svg'

type Props = {
  onSelectFolders?: () => void
  onRescan?: () => void
  onTogglePinned?: () => void
  busy?: boolean
  rescanDisabled?: boolean
  pinned?: boolean
  detail?: { title: string; parent: string; metadata: ReactNode; artwork: ReactNode; triggerIcon: ReactNode }
}

export function FolderHierarchyRootMenu({ onSelectFolders, onRescan, onTogglePinned, busy = false, rescanDisabled = false, pinned = false, detail }: Props) {
  const icons = useSystemIcons()
  const [open, setOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const run = (action?: () => void) => {
    setOpen(false)
    action?.()
  }
  const selectFolders = () => {
    // Remove this focus trap in the same update that mounts the editor.
    trigger.current?.focus({ preventScroll: true })
    const transfer = () => {
      setTransferring(true)
      setOpen(false)
      onSelectFolders?.()
    }
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(() => flushSync(transfer))
    } else transfer()
  }
  return <Dialog open={open} onOpenChange={value => { setTransferring(false); setOpen(value) }}>
    <DialogTrigger render={<Button ref={trigger} className="playlist-hero-icon playlist-hero-more-button" variant="ghost" size="icon" aria-label="更多文件夹操作">{detail ? detail.triggerIcon : <icons.more aria-hidden="true" />}</Button>} />
    {!transferring && <DialogContent className={detail ? "folder-root-menu folder-detail-menu" : "folder-root-menu"} overlayClassName="folder-root-menu-overlay" showCloseButton={false} aria-describedby={undefined}>
      <header className={detail ? "folder-root-menu-header folder-detail-menu-header" : "folder-root-menu-header"}>
        {detail ? <><span className="folder-detail-menu-artwork">{detail.artwork}</span><div className="folder-detail-menu-info"><DialogTitle className="folder-root-menu-title">{detail.title}</DialogTitle><p className="folder-detail-menu-parent">{detail.parent}</p><p className="folder-detail-menu-metadata">{detail.metadata}</p></div></> : <><span className="folder-root-menu-category"><img src={folderIcon} alt="" /></span><DialogTitle className="folder-root-menu-title">文件夹层次结构</DialogTitle></>}
      </header>
      <Separator className="folder-root-menu-divider" />
      <div className="folder-root-menu-actions">
        <Button className="folder-root-menu-action" variant="ghost" disabled={busy || !onSelectFolders} onClick={selectFolders}><img src={selectFoldersIcon} alt="" /><span>选择文件夹</span></Button>
        <Button className="folder-root-menu-action" variant="ghost" disabled={busy || rescanDisabled || !onRescan} title={detail ? "当前文件夹重新扫描暂不可用" : undefined} onClick={() => run(onRescan)}><img src={rescanIcon} alt="" /><span>重新扫描</span></Button>
        <Button className="folder-root-menu-action" variant="ghost" disabled={!onTogglePinned} title={detail ? "当前文件夹侧栏置顶暂不可用" : undefined} aria-pressed={pinned} onClick={() => run(onTogglePinned)}><img src={pinIcon} alt="" /><span>{pinned ? '取消侧栏置顶' : '在侧栏置顶'}</span></Button>
        <Button className="folder-root-menu-action" variant="ghost" disabled aria-label="列表选项，暂不可用" title="列表选项暂不可用"><img className="folder-root-menu-settings" src={settingsIcon} alt="" /><span>列表选项</span></Button>
      </div>
    </DialogContent>}
  </Dialog>
}
