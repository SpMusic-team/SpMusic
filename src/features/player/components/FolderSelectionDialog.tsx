import { useRef, useState, useEffect, useCallback, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import type { FolderSelectionViewModel } from '../model/playerUiViewModel'
import { folderSelectionPath, getDirectorySelectionState, toggleDirectorySelection, type RootSelection, type DirectoryChildren } from '../model/folderSelection'
import expandedIcon from '@/assets/folder-selection/ebf8b.svg'
import collapsedIcon from '@/assets/folder-selection/47c4a.svg'
import folderIcon from '@/assets/folder-selection/1633d.svg'
import dismissIcon from '@/assets/folder-selection/78f6b.svg'
import uncheckedIcon from '@/assets/folder-selection/0ffa0.svg'
import checkedIcon from '@/assets/folder-selection/f34de.svg'
import mixedIcon from '@/assets/folder-selection/1aee5.svg'

type Props = { folderSelection: FolderSelectionViewModel }
type DirectoryNode = DirectoryChildren['children'][number]
type DirectoryState = { loading: boolean; children?: DirectoryNode[]; error?: string }
const directoryKey = (root: string, path: string) => JSON.stringify([folderSelectionPath(root), folderSelectionPath(path)])
const pathName = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || path
const parentName = (path: string) => {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return clean.includes('/') ? pathName(clean.slice(0, clean.lastIndexOf('/'))) : ''
}
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '操作失败，请重试。'

/** An editor mount is one isolated draft session; closing always discards it. */
export function FolderSelectionDialog({ folderSelection }: Props) {
  return folderSelection.isOpen ? <FolderSelectionEditor folderSelection={folderSelection} /> : null
}

function FolderSelectionEditor({ folderSelection: vm }: Props) {
  const [draft, setDraft] = useState<RootSelection[]>(() => (vm.committed?.roots ?? []).map(root => ({ ...root, directoryRules: root.directoryRules.map(rule => ({ ...rule })) })))
  const [baseRevision] = useState(vm.committed?.revision ?? 0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [localError, setLocalError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorSessionId = useRef(0)
  const activeRoots = useRef(new Map(draft.map(root => [folderSelectionPath(root.path), 0])))
  const requests = useRef(new Set<string>())
  const probedRoots = useRef(new Map<string, number>())
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const pending = saving || vm.isSaving
  useEffect(() => () => { editorSessionId.current += 1; probedRoots.current.clear() }, [])

  const close = () => {
    if (pending) return
    editorSessionId.current += 1
    vm.onOpenChange(false)
  }
  const remove = (rootPath: string) => {
    const key = folderSelectionPath(rootPath)
    activeRoots.current.set(key, (activeRoots.current.get(key) ?? 0) + 1)
    setDraft(previous => previous.filter(root => folderSelectionPath(root.path) !== key))
    setExpanded(previous => new Set([...previous].filter(value => JSON.parse(value)[0] !== key)))
    setDirectories(previous => Object.fromEntries(Object.entries(previous).filter(([value]) => JSON.parse(value)[0] !== key)))
  }
  const toggle = (rootPath: string, relativePath: string, selected: boolean) => setDraft(previous => previous.map(root => root.path === rootPath ? toggleDirectorySelection(root, relativePath, selected) : root))

  const listDirectories = vm.onListDirectories
  const load = useCallback(async (rootPath: string, path: string) => {
    const key = directoryKey(rootPath, path)
    const version = activeRoots.current.get(folderSelectionPath(rootPath))
    const session = editorSessionId.current
    const requestKey = `${key}:${version}:${session}`
    if (requests.current.has(requestKey)) return
    requests.current.add(requestKey)
    setDirectories(previous => ({ ...previous, [key]: { loading: true } }))
    try {
      const result = await listDirectories({ rootPath, directoryPath: path })
      if (session !== editorSessionId.current || version !== activeRoots.current.get(folderSelectionPath(rootPath))) return
      if (folderSelectionPath(result.rootPath) !== folderSelectionPath(rootPath) || folderSelectionPath(result.directoryPath) !== folderSelectionPath(path)) throw new Error('文件夹内容已变化，请重试。')
      setDirectories(previous => ({ ...previous, [key]: { loading: false, children: result.children } }))
    } catch (error) {
      if (session === editorSessionId.current && version === activeRoots.current.get(folderSelectionPath(rootPath))) setDirectories(previous => ({ ...previous, [key]: { loading: false, error: errorMessage(error) } }))
    } finally { requests.current.delete(requestKey) }
  }, [listDirectories])
  const rootPathsKey = JSON.stringify(draft.map(root => root.path))
  useEffect(() => {
    for (const path of JSON.parse(rootPathsKey) as string[]) {
      const key = folderSelectionPath(path)
      const version = activeRoots.current.get(key) ?? 0
      if (probedRoots.current.get(key) === version) continue
      probedRoots.current.set(key, version)
      void load(path, path)
    }
  }, [rootPathsKey, load])
  const expand = (rootPath: string, path: string) => {
    const key = directoryKey(rootPath, path)
    const opening = !expanded.has(key)
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(key); else next.delete(key); return next })
    if (opening && !directories[key]?.children) void load(rootPath, path)
  }
  const pick = async () => {
    if (picking || pending) return
    const session = editorSessionId.current
    setPicking(true)
    setLocalError(undefined)
    try {
      const paths = await vm.onPickFolders()
      if (session !== editorSessionId.current || !paths) return
      setDraft(previous => {
        const next = [...previous]
        const seen = new Set(next.map(root => folderSelectionPath(root.path)))
        for (const path of paths) {
          const key = folderSelectionPath(path)
          if (!seen.has(key)) { next.push({ path, selected: true, directoryRules: [] }); seen.add(key); if (!activeRoots.current.has(key)) activeRoots.current.set(key, 0) }
        }
        return next
      })
    } catch (error) { if (session === editorSessionId.current) setLocalError(errorMessage(error)) }
    finally { if (session === editorSessionId.current) setPicking(false) }
  }
  const save = async () => {
    if (pending || picking) return
    const session = editorSessionId.current
    setSaving(true)
    setLocalError(undefined)
    try { await vm.onSave({ expectedRevision: baseRevision, roots: draft }) }
    catch (error) { if (session === editorSessionId.current) setLocalError(errorMessage(error)) }
    finally { if (session === editorSessionId.current) setSaving(false) }
  }
  const renderNode = (root: RootSelection, node: DirectoryNode, depth: number, isRoot = false) => {
    const key = directoryKey(root.path, node.path)
    const state = directories[key]
    const open = expanded.has(key)
    const relative = isRoot ? '' : node.path.replace(/\\/g, '/').slice(root.path.replace(/\\/g, '/').replace(/\/+$/, '').length + 1)
    const selection = getDirectorySelectionState(root, relative)
    const hasChildren = state?.children ? state.children.length > 0 : node.hasChildren !== false
    return <div key={key} className="folder-selection-node">
      <div className="folder-selection-row" data-root={isRoot || undefined} style={{ '--folder-selection-depth': depth } as CSSProperties}>
        <div className="folder-selection-main">
          <div className="folder-selection-line">
            {hasChildren ? <Button variant="ghost" className="folder-selection-expand" aria-label={`${open ? '收起' : '展开'} ${node.name}`} aria-expanded={open} disabled={pending} onClick={() => expand(root.path, node.path)}><img src={open ? expandedIcon : collapsedIcon} alt="" /></Button> : <span className="folder-selection-arrow-space" />}
            {isRoot && <img className="folder-selection-folder" src={folderIcon} alt="" />}
            <span className="folder-selection-name" title={node.path}>{node.name}</span>
          </div>
          {isRoot && <span className="folder-selection-parent" title={root.path}>{parentName(root.path)}</span>}
        </div>
        {isRoot && <Button variant="ghost" className="folder-selection-remove" aria-label={`移除 ${node.name}`} title="仅从此次选择移除文件夹" disabled={pending} onClick={() => remove(root.path)}><img src={dismissIcon} alt="" /></Button>}
        <Checkbox className="folder-selection-checkbox" aria-label={`选择 ${node.name}`} checked={selection === true} indeterminate={selection === 'indeterminate'} disabled={pending} onCheckedChange={checked => toggle(root.path, relative, checked)} style={{ '--folder-selection-check': `url("${selection === 'indeterminate' ? mixedIcon : selection ? checkedIcon : uncheckedIcon}")` } as CSSProperties} data-selection={selection === 'indeterminate' ? 'mixed' : String(selection)} />
      </div>
      {!open && isRoot && state?.error && <div className="folder-selection-status-line" role="alert">{state.error}<Button variant="ghost" onClick={() => void load(root.path, node.path)} disabled={pending}>重试</Button></div>}
      {open && <div className="folder-selection-children">
        {state?.loading && <p className="folder-selection-status-line" role="status">正在读取文件夹…</p>}
        {state?.error && <div className="folder-selection-status-line" role="alert">{state.error}<Button variant="ghost" onClick={() => void load(root.path, node.path)} disabled={pending}>重试</Button></div>}
        {state?.children?.map(child => renderNode(root, child, depth + 1))}
        {state?.children?.length === 0 && <p className="folder-selection-status-line">此文件夹没有子文件夹</p>}
      </div>}
    </div>
  }
  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="folder-selection-dialog" overlayClassName="folder-root-menu-overlay folder-selection-overlay" showCloseButton={false} finalFocus={opener} aria-busy={pending}>
      <header className="folder-selection-header"><DialogTitle className="folder-selection-title">文件夹选择</DialogTitle></header>
      <DialogDescription className="sr-only">选择需要扫描的文件夹。父文件夹控制整个子树，也可以单独调整子文件夹。关闭时放弃未保存的更改。</DialogDescription>
      <div className="folder-selection-tree" aria-label="扫描文件夹">
        {draft.map(root => renderNode(root, { path: root.path, name: pathName(root.path), hasChildren: null }, 0, true))}
        {!draft.length && <Empty className="folder-selection-empty"><EmptyDescription>尚未选择文件夹，请添加文件夹或存储。</EmptyDescription></Empty>}
      </div>
      {(localError || vm.error) && <p className="folder-selection-error" role="alert">{localError || vm.error}</p>}
      <footer className="folder-selection-footer"><Separator className="folder-selection-divider" /><Button variant="ghost" className="folder-selection-action" disabled={pending || picking} onClick={() => void pick()}>{picking ? '正在选择文件夹…' : '添加文件夹或存储'}</Button><Separator className="folder-selection-divider" /><Button variant="ghost" className="folder-selection-action" disabled={pending || picking || vm.committed === null} onClick={() => void save()}>{pending ? '正在保存…' : '保存并扫描'}</Button></footer>
    </DialogContent>
  </Dialog>
}
