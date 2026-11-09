import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { PlaylistSongLayoutDescriptor } from '@/features/player/model/playlistSongLayouts'

type Viewport = { top: number; height: number; stride: number; level: number }

// Keep native scrolling on the panel. Only the small grid inside this spacer
// is transformed during navigation; the full collection never becomes a layer.
export function useAllSongsRenderWindow(count: number, layout: PlaylistSongLayoutDescriptor, panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, spaceRef: RefObject<HTMLDivElement | null>, loading: boolean) {
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 1000, stride: 0, level: -1 })
  const enabled = count > 100 && layout.flow !== 'tile'
  const minHeight = Number.parseFloat(String(layout.style['--playlist-card-min-height' as keyof typeof layout.style] ?? 0))
  const cover = Number.parseFloat(String(layout.style['--playlist-cover-size' as keyof typeof layout.style] ?? 0))
  const gap = layout.level <= 4 ? 20 : layout.level === 5 ? 8 : layout.level === 6 ? 6 : layout.level === 7 ? 3 : 1
  const stride = viewport.level === layout.level && viewport.stride ? viewport.stride : Math.max(minHeight, layout.showArtwork ? cover + 30 : 0) + gap
  const firstRow = enabled ? Math.min(Math.max(0, Math.ceil(count / layout.columns) - 1), Math.max(0, Math.floor(viewport.top / stride) - 2)) : 0
  const first = firstRow * layout.columns
  const end = enabled ? Math.min(count, (Math.ceil((viewport.top + viewport.height) / stride) + 2) * layout.columns) : count
  // Everything a row's rendered height depends on, computed without touching the
  // DOM. The measured stride is only re-read when this key or a ResizeObserver
  // report changes; scrolling itself never invalidates it.
  const strideKey = `${layout.level}\u0001${layout.columns}\u0001${layout.showArtwork ? 1 : 0}\u0001${minHeight}\u0001${cover}\u0001${gap}\u0001${count}`
  const strideRef = useRef<{ key: string; value: number } | null>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current, list = listRef.current, space = spaceRef.current
    if (!enabled || !panel || !list || !space) return
    let frame: number | null = null
    const readStride = (invalidate: boolean) => {
      const cached = strideRef.current
      if (!invalidate && cached?.key === strideKey) return cached.value
      // One query, one box read and one style read per invalidation, instead of
      // one of each per scroll event.
      const row = list.querySelector<HTMLElement>('[data-song-key]')
      const value = row ? row.offsetHeight + Number.parseFloat(getComputedStyle(list).rowGap) : stride
      strideRef.current = { key: strideKey, value }
      return value
    }
    // Read all geometry first, then commit once. Running the setViewport write
    // between the scroll reads is what forced a second synchronous layout.
    const measure = (invalidateStride: boolean) => {
      const measuredStride = readStride(invalidateStride)
      const top = Math.max(0, panel.getBoundingClientRect().top - space.getBoundingClientRect().top)
      const height = panel.clientHeight
      setViewport(previous => previous.top === top && previous.height === height && previous.stride === measuredStride && previous.level === layout.level
        ? previous : { top, height, stride: measuredStride, level: layout.level })
    }
    // One scroll frame delivers several events; measure at most once per frame.
    const scheduleMeasure = () => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure(false) })
    }
    measure(true)
    const observer = new ResizeObserver(() => { measure(true) })
    observer.observe(panel)
    if (list.firstElementChild) observer.observe(list.firstElementChild)
    panel.addEventListener('scroll', scheduleMeasure, { passive: true })
    return () => {
      observer.disconnect()
      panel.removeEventListener('scroll', scheduleMeasure)
      if (frame !== null) { cancelAnimationFrame(frame); frame = null }
    }
  }, [enabled, loading, layout.level, panelRef, listRef, spaceRef, stride, strideKey, count])
  return { enabled, first, end, stride,
    spaceStyle: enabled ? { position: 'relative' as const, height: Math.ceil(count / layout.columns) * stride + 56 } : undefined,
    gridStyle: enabled ? { position: 'absolute' as const, insetInline: 0, top: firstRow * stride } : undefined }
}
