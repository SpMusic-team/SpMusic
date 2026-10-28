import { useEffect, useMemo, useRef, useState, type RefObject, type PointerEvent, type MouseEvent } from 'react'
import { quickIndexKey } from '../model/quickIndex'

const KEYS = ['top', '0', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']
const TopIcon = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 7 6-6 6 6M2 14l6-6 6 6" /></svg>

export function CollectionQuickIndex({ panelRef, names, label = '文件夹', itemSelector = '[data-folder-path]', onJump }: { panelRef: RefObject<HTMLElement | null>; names: readonly string[]; label?: string; itemSelector?: string; onJump?: (key: string, index: number | undefined) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; top: number; visible: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerId = useRef<number | null>(null)
  const pointerKey = useRef<string | null>(null)
  const targets = useMemo(() => {
    const result = new Map<string, number>()
    names.forEach((name, index) => { const key = quickIndexKey(name); if (!result.has(key)) result.set(key, index) })
    return result
  }, [names])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function jump(key: string) {
    setActive(key)
    const index = targets.get(key)
    if (onJump) { onJump(key, index); return }
    const panel = panelRef.current
    if (!panel) return
    if (key === 'top') { panel.scrollTop = 0; return }
    const row = index === undefined ? undefined : panel.querySelectorAll<HTMLElement>(itemSelector)[index]
    if (row) panel.scrollTop += row.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8
  }
  function show(key: string, y: number, nav: HTMLElement) {
    if (timer.current) clearTimeout(timer.current)
    const bounds = nav.getBoundingClientRect()
    const dockTop = document.querySelector<HTMLElement>('.playlist-playback-dock:not([data-dock-superseded])')?.getBoundingClientRect().top
    const maxTop = Math.max(bounds.top, Math.min(bounds.bottom, dockTop ?? bounds.bottom) - 100)
    const top = Math.max(bounds.top, Math.min(y - 50, maxTop)) - nav.parentElement!.getBoundingClientRect().top
    setPreview({ key, top, visible: true })
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setPreview(previous => previous ? { ...previous, visible: false } : null); timer.current = null }, 240)
  }
  function pointer(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const key = KEYS[Math.min(KEYS.length - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * KEYS.length)))]
    show(key, event.clientY, event.currentTarget)
    if (pointerKey.current !== key) { pointerKey.current = key; jump(key) }
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (pointerId.current !== event.pointerId) return
    pointerId.current = null
    pointerKey.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    hide()
  }
  function keyboard(key: string, event: MouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0) return
    const nav = event.currentTarget.parentElement
    if (!nav) return
    const bounds = event.currentTarget.getBoundingClientRect()
    jump(key)
    show(key, bounds.top + bounds.height / 2, nav)
    hide()
  }
  return <>
    {preview ? <div className="playlist-management-quick-index-preview" data-visible={preview.visible} style={{ top: preview.top }} aria-hidden="true">{preview.key === 'top' ? <TopIcon /> : preview.key}</div> : null}
    <nav className="playlist-management-quick-index" aria-label={label + '快速查找'}
      onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); pointerId.current = event.pointerId; pointerKey.current = null; event.currentTarget.setPointerCapture(event.pointerId); pointer(event) }}
      onPointerMove={event => { if (pointerId.current === event.pointerId) pointer(event) }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      {KEYS.map(key => <button key={key} type="button" aria-current={active === key ? 'true' : undefined} title={key === 'top' ? '返回顶部' : key === '0' ? '数字' : key === '#' ? '其他字符' : key} aria-label={key === 'top' ? '返回列表顶部' : key === '0' ? '查找数字开头的' + label : key === '#' ? '查找其他字符开头的' + label : '查找 ' + key + ' 开头的' + label} onClick={event => keyboard(key, event)}>{key === 'top' ? <TopIcon /> : key}</button>)}
    </nav>
  </>
}
