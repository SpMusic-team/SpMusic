import { useLayoutEffect, useState, type RefObject } from 'react'

export function useAlbumRenderWindow(count: number, level: number, panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, spaceRef: RefObject<HTMLDivElement | null>) {
  const enabled = count > 100
  const [view, setView] = useState({ top: 0, height: 1000, stride: 340, columns: 1, level: -1 })
  const estimated = [340, 255, 220, 195, 137, 94, 88, 56, 56, 56][level]
  const stride = view.level === level ? view.stride : estimated
  const columns = view.level === level ? view.columns : 1
  const rows = Math.ceil(count / columns)
  const firstRow = enabled ? Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(view.top / stride) - 2)) : 0
  const first = firstRow * columns
  const end = enabled ? Math.min(count, Math.max(first + columns, (Math.ceil((view.top + view.height) / stride) + 2) * columns)) : count
  useLayoutEffect(() => {
    const panel = panelRef.current, list = listRef.current, space = spaceRef.current
    if (!enabled || !panel || !list || !space) return
    let frame: number | null = null
    const measure = () => {
      const card = list.firstElementChild as HTMLElement | null
      const style = getComputedStyle(list)
      const columns = Math.max(1, style.gridTemplateColumns.split(' ').length)
      const stride = (card?.offsetHeight || estimated) + (parseFloat(style.rowGap) || 0)
      const top = Math.max(0, panel.getBoundingClientRect().top - space.getBoundingClientRect().top)
      const height = panel.clientHeight
      setView(old => old.top === top && old.height === height && old.stride === stride && old.columns === columns && old.level === level ? old : { top, height, stride, columns, level })
    }
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure() }) }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    if (list.firstElementChild) observer.observe(list.firstElementChild)
    panel.addEventListener('scroll', schedule, { passive: true })
    return () => { observer.disconnect(); panel.removeEventListener('scroll', schedule); if (frame !== null) cancelAnimationFrame(frame) }
  }, [enabled, count, level, estimated, panelRef, listRef, spaceRef])
  return { enabled, first, end, stride, columns,
    spaceStyle: enabled ? { position: 'relative' as const, height: rows * stride + 50 } : undefined,
    gridStyle: enabled ? { position: 'absolute' as const, insetInline: 0, top: firstRow * stride } : undefined }
}
