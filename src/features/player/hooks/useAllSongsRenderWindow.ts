import { useLayoutEffect, useState, type RefObject } from 'react'
import type { PlaylistSongLayoutDescriptor } from '@/features/player/model/playlistSongLayouts'

// Keep native scrolling on the panel. Only the small grid inside this spacer
// is transformed during navigation; the full collection never becomes a layer.
export function useAllSongsRenderWindow(count: number, layout: PlaylistSongLayoutDescriptor, panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, spaceRef: RefObject<HTMLDivElement | null>, loading: boolean) {
  const [viewport, setViewport] = useState({ top: 0, height: 1000, stride: 0, level: -1 })
  const enabled = count > 100 && layout.flow !== 'tile'
  const minHeight = Number.parseFloat(String(layout.style['--playlist-card-min-height' as keyof typeof layout.style] ?? 0))
  const cover = Number.parseFloat(String(layout.style['--playlist-cover-size' as keyof typeof layout.style] ?? 0))
  const gap = layout.level <= 4 ? 20 : layout.level === 5 ? 8 : layout.level === 6 ? 6 : layout.level === 7 ? 3 : 1
  const stride = viewport.level === layout.level && viewport.stride ? viewport.stride : Math.max(minHeight, layout.showArtwork ? cover + 30 : 0) + gap
  const firstRow = enabled ? Math.min(Math.max(0, Math.ceil(count / layout.columns) - 1), Math.max(0, Math.floor(viewport.top / stride) - 2)) : 0
  const first = firstRow * layout.columns
  const end = enabled ? Math.min(count, (Math.ceil((viewport.top + viewport.height) / stride) + 2) * layout.columns) : count
  useLayoutEffect(() => {
    const panel = panelRef.current, list = listRef.current, space = spaceRef.current
    if (!enabled || !panel || !list || !space) return
    const measure = () => {
      const row = list.querySelector<HTMLElement>('[data-song-key]')
      const measuredStride = row ? row.offsetHeight + Number.parseFloat(getComputedStyle(list).rowGap) : stride
      const top = Math.max(0, panel.getBoundingClientRect().top - space.getBoundingClientRect().top)
      setViewport(previous => previous.top === top && previous.height === panel.clientHeight && previous.stride === measuredStride && previous.level === layout.level
        ? previous : { top, height: panel.clientHeight, stride: measuredStride, level: layout.level })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    if (list.firstElementChild) observer.observe(list.firstElementChild)
    panel.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); panel.removeEventListener('scroll', measure) }
  }, [enabled, loading, layout.level, panelRef, listRef, spaceRef, stride, count])
  return { enabled, first, end, stride,
    spaceStyle: enabled ? { position: 'relative' as const, height: Math.ceil(count / layout.columns) * stride + 56 } : undefined,
    gridStyle: enabled ? { position: 'absolute' as const, insetInline: 0, top: firstRow * stride } : undefined }
}
