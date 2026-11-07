import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LibraryCover } from '@/features/player/components/PlaylistLibrarySidebar'
import type { LibraryDockSelection } from '@/features/player/hooks/useLibraryDockBinding'
import type { PlaylistAddRequest, PlaylistAddTarget, PlaylistInsertionPosition } from '@/features/player/model/playerUiViewModel'
import type { PlaylistArtworkSource } from '@/features/player/model/playlistArtworkStore'
import { cn } from '@/lib/utils'
import playlistAdd from '@/assets/selection-panel/playlist-add/add.svg'
import playlistSort from '@/assets/selection-panel/playlist-add/sort.svg'
import playlistAscending from '@/assets/selection-panel/playlist-add/ascending.svg'
import playlistFilter from '@/assets/selection-panel/playlist-add/check-circle.svg'
import playlistChecked from '@/assets/selection-panel/playlist-add/checked.svg'
import menuCheck from '@/assets/selection-panel/playlist-add/menu-check.svg'
import sortName from '@/assets/selection-panel/playlist-add/sort-name.svg'
import sortLibraryDate from '@/assets/selection-panel/playlist-add/sort-library-date.svg'
import sortModified from '@/assets/selection-panel/playlist-add/sort-modified.svg'
import sortTrack from '@/assets/selection-panel/playlist-add/sort-track.svg'
import insertStart from '@/assets/selection-panel/playlist-add/insert-start.svg'
import insertEnd from '@/assets/selection-panel/playlist-add/insert-end.svg'
import insertRandom from '@/assets/selection-panel/playlist-add/insert-random.svg'
import modeSingle from '@/assets/selection-panel/playlist-add/mode-single.svg'
import modeMultiple from '@/assets/selection-panel/playlist-add/mode-multiple.svg'
import modeSwitch from '@/assets/selection-panel/playlist-add/mode-switch.svg'
import multipleAdded from '@/assets/selection-panel/playlist-add/multiple-added.svg'
function OptionalPortal({ container, children }: { container?: RefObject<HTMLElement | null>; children: ReactNode }) {
  return container ? <DialogPortal container={container}>{children}</DialogPortal> : children
}
function StandalonePopup({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent {...props} className={cn(className, 'player-more-song-dialog')} overlayClassName="more-actions-overlay" showCloseButton={false} />
}
export function SelectionIcon({ source, size, height = size }: { source: string; size: number; height?: number }) {
  return <span aria-hidden="true" data-slot="icon" className="playlist-selection-icon"
    style={{ '--selection-icon-source': `url("${source}")`, '--selection-icon-size': `${size}px`, '--selection-icon-height': `${height}px` } as CSSProperties} />
}

function PlaylistAddCover({ target, source }: { target: PlaylistAddTarget; source?: PlaylistArtworkSource }) {
  const key = source?.keyByTrackId.get(target.scope)
  const subscribe = useCallback((listener: () => void) => key && source ? source.store.subscribe(key, listener) : () => {}, [key, source])
  const read = useCallback(() => key && source ? source.store.getSnapshot(key) : undefined, [key, source])
  const visual = useSyncExternalStore(subscribe, read, () => undefined)
  const coverRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = coverRef.current
    const root = element?.closest('.playlist-add-list')
    if (!element || !root || !key || !source || !visual?.coverThumbnail) return
    let release: (() => void) | undefined
    const update = (visible: boolean) => {
      if (visible && !release) release = source.store.retain(key)
      else if (!visible && release) { release(); release = undefined }
    }
    const box = element.getBoundingClientRect()
    const viewport = root.getBoundingClientRect()
    update(box.bottom > viewport.top && box.top < viewport.bottom)
    const observer = new IntersectionObserver(entries => update(entries.some(entry => entry.isIntersecting)), { root })
    observer.observe(element)
    return () => { observer.disconnect(); release?.() }
  }, [visual?.coverThumbnail, key, source])
  const coverTrack = target.coverTrack && visual ? { ...target.coverTrack, ...visual } : target.coverTrack
  return <span ref={coverRef} className="playlist-add-cover" data-library-cover-source={target.coverSourcePath}><LibraryCover coverTrack={coverTrack} /></span>
}

export function PlaylistAddDialog({ selection, request: initialRequest, container, active, onCancel, onDone }: {
  selection: Pick<LibraryDockSelection, 'onAddToPlaylist' | 'onRemoveFromPlaylist' | 'onRefreshAddToPlaylist' | 'onCreateAddPlaylist'>
  request: PlaylistAddRequest
  container?: RefObject<HTMLElement | null>
  active: boolean
  onCancel: () => void
  onDone: (targetScope?: string, outcome?: 'added' | 'changed' | 'none') => void
}) {
  const [request, setRequest] = useState(initialRequest)
  const [view, setView] = useState<'main' | 'create' | 'sort' | 'position' | 'mode'>('main')
  const [mode, setMode] = useState<'single' | 'multiple' | 'switch'>('switch')
  const [position, setPosition] = useState<PlaylistInsertionPosition>('start')
  const [name, setName] = useState('')
  const nameId = useId()
  const popupRef = useRef<HTMLDivElement>(null)
  const returningTool = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const failedTargets = useRef(new Set<string>())
  const addedTargets = useRef<string[]>([])
  const changed = useRef(false)
  const targets = useMemo(() => [...request.targets].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })), [request.targets])
  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    const returning = view === 'main' && returningTool.current ? popup.querySelector<HTMLButtonElement>(`[data-picker-tool="${returningTool.current}"]`) : null
    ;(returning ?? popup.querySelector<HTMLElement>('input, button:not(:disabled)'))?.focus()
  }, [view])
  const openView = (next: typeof view) => {
    returningTool.current = next
    if (next === 'create') setName(request.suggestedName ?? '')
    setView(next)
    setError(null)
  }
  const finish = () => {
    if (failedTargets.current.size) { onDone(undefined, 'none'); return }
    const netAdded = [...addedTargets.current].reverse().find(scope => {
      const current = request.targets.find(target => target.scope === scope)?.containedCount ?? 0
      const original = initialRequest.targets.find(target => target.scope === scope)?.containedCount ?? 0
      return current > original
    })
    onDone(netAdded, netAdded ? 'added' : changed.current ? 'changed' : 'none')
  }
  const mutate = async (scope: string) => {
    const target = request.targets.find(item => item.scope === scope)
    if (!target || busyRef.current || !selection.onAddToPlaylist) return
    if (mode === 'multiple' && target.containsAll) return
    if (mode === 'single' && target.containsAll) { onDone(undefined, 'changed'); return }
    const remove = mode === 'switch' && target.containsAll
    if (remove && !selection.onRemoveFromPlaylist) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = remove
        ? await selection.onRemoveFromPlaylist!(request.snapshot, scope)
        : await selection.onAddToPlaylist(request.snapshot, scope, position)
      const refreshed = selection.onRefreshAddToPlaylist?.(request.snapshot)
      if (refreshed) setRequest(refreshed)
      if (result.failedKeys.length || result.errorMessage) {
        failedTargets.current.add(scope)
        setError(result.errorMessage || `${result.failedKeys.length} 首歌曲未能${remove ? '移除' : '添加'}，请重试。`)
      } else {
        failedTargets.current.delete(scope)
        if (result.addedCount) addedTargets.current.push(scope)
        if (result.addedCount || result.removedCount) changed.current = true
        if (mode === 'single') onDone(result.addedCount ? scope : undefined, result.addedCount ? 'added' : 'changed')
      }
    } catch (failure) {
      failedTargets.current.add(scope)
      setError(failure instanceof Error ? failure.message : '操作失败，请重试。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const create = () => {
    const next = selection.onCreateAddPlaylist?.(name, request.snapshot)
    if (!next) { setError('请填写名称，并确认所选歌曲仍然可用。'); return }
    const created = next.targets.find(target => target.containsAll && !request.targets.some(previous => previous.scope === target.scope))
    if (created) { addedTargets.current.push(created.scope); changed.current = true }
    setRequest(next)
    setView('main')
    setName('')
    setError(null)
  }
  const menuTitle = view === 'sort' ? '播放列表排序' : view === 'position' ? '插入位置' : '添加模式'
  const menuRows = view === 'sort' ? [
    { id: 'name', label: '根据名称', source: sortName, selected: true },
    { id: 'library-date', label: '根据添加到媒体库的日期', source: sortLibraryDate, disabled: true },
    { id: 'modified', label: '根据添加/修改日期', source: sortModified, disabled: true },
    { id: 'track', label: '根据音轨号', source: sortTrack, width: 22.6667, height: 26.6667, disabled: true },
  ] : view === 'position' ? [
    { id: 'start', label: '在开头插入', source: insertStart, selected: position === 'start' },
    { id: 'end', label: '添加到末尾', source: insertEnd, selected: position === 'end' },
    { id: 'random', label: '随机', source: insertRandom, selected: position === 'random' },
  ] : [
    { id: 'single', label: '添加到单个播放列表', source: modeSingle, selected: mode === 'single' },
    { id: 'multiple', label: '添加到多个播放列表', source: modeMultiple, selected: mode === 'multiple' },
    { id: 'switch', label: '切换', source: modeSwitch, selected: mode === 'switch' },
  ]
  const Popup = container ? DialogPrimitive.Popup : StandalonePopup
  return <Dialog open={active} onOpenChange={open => {
    if (open || busyRef.current) return
    if (view !== 'main') setView('main')
    else onCancel()
  }}>
    <OptionalPortal container={container}>
      <Popup ref={popupRef} className={cn('playlist-add-dialog', view !== 'main' && 'playlist-add-subdialog', view === 'create' && 'playlist-add-create-dialog', view === 'sort' && 'playlist-add-sort-dialog')}
        data-slot="dialog-content" data-picker-view={view} data-insertion-position={position} data-add-mode={mode} aria-busy={busy || undefined} hidden={!active}>
        {view === 'main' ? <>
        <header className="playlist-add-header">
          <DialogTitle className="playlist-add-title">播放列表</DialogTitle>
          <div className="playlist-add-tools">
            <Button variant="outline" aria-label="新增播放列表" data-picker-tool="create" disabled={busy || !selection.onCreateAddPlaylist} onClick={() => openView('create')}><SelectionIcon source={playlistAdd} size={32} /></Button>
            <Button variant="outline" aria-label="播放列表排序" data-picker-tool="sort" disabled={busy} onClick={() => openView('sort')}><SelectionIcon source={playlistSort} size={32} /></Button>
            <Button variant="outline" aria-label="插入位置" data-picker-tool="position" disabled={busy} onClick={() => openView('position')}><span className="playlist-add-direction"><SelectionIcon source={playlistAscending} size={32} /></span></Button>
            <Button variant="outline" aria-label="添加模式" data-picker-tool="mode" disabled={busy} onClick={() => openView('mode')}><SelectionIcon source={playlistFilter} size={32} /></Button>
          </div>
        </header>
        <DialogDescription className="sr-only">{mode === 'switch' ? '切换模式。勾选的列表可移除所选歌曲的列表关系，空心圆可添加缺少的歌曲，歌曲文件不会删除。' : mode === 'multiple' ? '可连续添加到多个列表，已添加的列表显示加号，不会重复添加。' : '选择一个播放列表后立即完成。'}</DialogDescription>
        <div className="playlist-add-list" aria-label="可添加的播放列表">
          {targets.length ? targets.map(target => <Button key={target.scope} variant="ghost" className="playlist-add-row" disabled={busy} aria-disabled={mode === 'multiple' && target.containsAll || undefined} aria-pressed={mode === 'single' ? undefined : target.containsAll}
            data-target-scope={target.scope} data-contains-all={target.containsAll} data-contained-count={target.containedCount}
            aria-label={`${target.name}，${target.containsAll ? mode === 'switch' ? '移除列表中的所选歌曲' : mode === 'single' ? '选择此列表' : '已添加' : target.containedCount ? `已包含 ${target.containedCount} 首，添加缺少的歌曲` : '添加到此列表'}`}
            onClick={() => { void mutate(target.scope) }}>
            <PlaylistAddCover target={target} source={request.artworkSource} />
            <span className="playlist-add-name">{target.name}</span>
            {mode !== 'single' ? target.containsAll ? <SelectionIcon source={mode === 'multiple' ? multipleAdded : playlistChecked} size={48} /> : <span className="playlist-add-empty-circle" aria-hidden="true" /> : null}
          </Button>) : <p className="playlist-add-empty">暂无播放列表，可使用上方按钮新建。</p>}
        </div>
        {error ? <p className="playlist-selection-error" role="alert">{error}</p> : null}
        <footer className="playlist-add-footer"><Button variant="outline" disabled={busy} onClick={finish}>完成</Button></footer>
        </> : view === 'create' ? <form className="playlist-add-create" onSubmit={event => { event.preventDefault(); create() }}>
          <DialogTitle className="playlist-add-create-title">新增播放列表</DialogTitle>
          <FieldGroup className="playlist-add-create-field"><Field data-invalid={Boolean(error)}><FieldLabel className="sr-only" htmlFor={nameId}>播放列表名称</FieldLabel><Input id={nameId} autoFocus value={name} maxLength={120} aria-invalid={Boolean(error)} onChange={event => { setName(event.target.value); setError(null) }} />{error ? <FieldError>{error}</FieldError> : null}</Field></FieldGroup>
          <DialogDescription className="playlist-add-create-description">选择音轨或其他项目后，使用下方带“播放列表”的 + 图标将音轨添加到媒体库列表</DialogDescription>
          <div className="playlist-add-create-actions"><Button variant="ghost" type="button" onClick={() => { setView('main'); setError(null) }}>取消</Button><Button variant="outline" type="submit">确定</Button></div>
        </form> : <>
          <DialogTitle className="sr-only">{menuTitle}</DialogTitle><DialogDescription className="sr-only">选择后返回播放列表。</DialogDescription>
          <div className="playlist-add-option-list">
            {menuRows.map(row => <Button key={row.id} variant="ghost" className="playlist-add-option" disabled={'disabled' in row && row.disabled} aria-pressed={Boolean('selected' in row && row.selected)}
              title={'disabled' in row && row.disabled ? '当前列表未提供此排序所需的数据' : undefined}
              onClick={() => {
                if (view === 'position') setPosition(row.id as PlaylistInsertionPosition)
                if (view === 'mode') setMode(row.id as typeof mode)
                setView('main')
              }}><span className="playlist-add-option-copy"><SelectionIcon source={row.source} size={'width' in row && row.width ? row.width : 32} height={'height' in row ? row.height : undefined} /><span>{row.label}</span></span>{'selected' in row && row.selected ? <SelectionIcon source={menuCheck} size={32} /> : null}</Button>)}
          </div>
        </>}
      </Popup>
    </OptionalPortal>
  </Dialog>
}


export function PlaylistDeleteDialog({ open, container, mode: deleteMode, canRemoveFromList: deleteCanRemoveFromList, canDeleteFiles = true, busy: deleteBusy, error: deleteError, onCancel, onModeChange, onConfirm }: {
  open: boolean; container?: RefObject<HTMLElement | null>; mode: 'list' | 'files'; canRemoveFromList: boolean; canDeleteFiles?: boolean; busy: boolean; error: string | null
  onCancel: () => void; onModeChange: (mode: 'list' | 'files') => void; onConfirm: () => void
}) {
  const Popup = container ? DialogPrimitive.Popup : StandalonePopup
  return <Dialog open={open} onOpenChange={next => { if (!next && !deleteBusy) onCancel() }}>
      <OptionalPortal container={container}>
      <Popup className="playlist-selection-delete-dialog" data-slot="dialog-content" hidden={!open}>
        <DialogTitle className="playlist-selection-delete-title">{deleteMode === 'files' ? '确定删除歌曲文件？' : '确定删除多个条目？'}</DialogTitle>
        <DialogDescription className="playlist-selection-delete-description">{deleteMode === 'files'
          ? '歌曲文件将移至回收站，并从所有列表中移除'
          : deleteCanRemoveFromList ? canDeleteFiles ? '列表条目将被删除，歌曲文件将保留' : '只移除流列表中的地址，其他播放列表中的引用将保留' : '文件夹扫描视图不支持仅移除列表条目，可选择删除文件'}</DialogDescription>
        {deleteError ? <p className="playlist-selection-error" role="alert">{deleteError}</p> : null}
        <div className="playlist-selection-delete-actions">
          <Button variant="ghost" disabled={deleteBusy || !canDeleteFiles} onClick={() => { onModeChange(deleteMode === 'list' ? 'files' : 'list') }}>{deleteMode === 'list' ? '删除文件' : '仅移除条目'}</Button>
          <div>
            <Button variant="ghost" disabled={deleteBusy} onClick={() => { onCancel() }}>取消</Button>
            <Button variant="outline" className="playlist-selection-delete-confirm" disabled={deleteBusy || deleteMode === 'list' && !deleteCanRemoveFromList} onClick={() => { onConfirm() }}>{deleteBusy ? '删除中…' : '删除'}</Button>
          </div>
        </div>
      </Popup>
      </OptionalPortal>
    </Dialog>
}
