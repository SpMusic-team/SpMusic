import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

type Options = {
  panelRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  active: boolean
  representatives: ReadonlySet<string>
  shapeKey: string
  trackIdsKey: string
  entryTrackId?: string | null
  theme: object
}

const sameIds = (left: ReadonlySet<string>, right: ReadonlySet<string>) => left.size === right.size && [...left].every(id => right.has(id))

// Keep real, focusable roots for every song. Only their measured content window
// owns image/icon/components; this window does not own artwork leases or demand.
export function usePlaylistContentWindow(options: Options) {
  const { panelRef, gridRef, enabled, active } = options
  const latest = useRef(options)
  const held = useRef<ReadonlySet<string>>(new Set())
  const metrics = useRef<{ grid: HTMLDivElement; width: number; viewportWidth: number; level: string | undefined; theme: object; shapes: string } | null>(null)
  const commitGeometry = useRef<{ grid: HTMLDivElement; level: string | undefined; theme: object; shapes: string; tracks: string } | null>(null)
  const frame = useRef<number | null>(null)
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(options.representatives))
  useLayoutEffect(() => { latest.current = options })
  const refresh = useCallback(() => {
    const { panelRef, gridRef, enabled, active, representatives, shapeKey, entryTrackId, theme } = latest.current
    const panel = panelRef.current
    const grid = gridRef.current
    if (!enabled || !active || !panel || !grid) return
    const width = grid.clientWidth
    const viewportWidth = window.innerWidth
    const level = grid.dataset.layoutLevel
    const previous = metrics.current
    // Hydration can move the representative to another song without changing
    // intrinsic line counts. Cache dimensions by shapes, never by song IDs.
    if (!previous || previous.grid !== grid || previous.width !== width || previous.viewportWidth !== viewportWidth || previous.level !== level || previous.theme !== theme || previous.shapes !== shapeKey) {
      const samples = [...grid.querySelectorAll<HTMLElement>('[data-content-representative="true"]')]
      // Grid's stretch alignment is a row result, not this shape's intrinsic
      // size. Batch writes, then reads, then restore before measuring the window.
      const alignments = samples.map(card => card.style.alignSelf)
      for (const card of samples) card.style.alignSelf = 'start'
      const heights = samples.map(card => [card.dataset.contentShape!, Number.parseFloat(getComputedStyle(card).height)] as const)
      for (const [index, card] of samples.entries()) card.style.alignSelf = alignments[index]!
      if (!heights.length || heights.some(([, height]) => !Number.isFinite(height) || height <= 0)) {
        // Unmeasurable geometry must retain the complete layout, never collapse
        // an offscreen slot to a guessed height.
        const all = new Set([...grid.children].flatMap(card => card instanceof HTMLElement && card.dataset.playlistTrackId ? [card.dataset.playlistTrackId] : []))
        setIds(previousIds => sameIds(previousIds, all) ? previousIds : all)
        metrics.current = null
        return
      }
      for (const [shape, height] of heights) grid.style.setProperty(`--playlist-content-height-${shape}`, `${height}px`)
      metrics.current = { grid, width, viewportWidth, level, theme, shapes: shapeKey }
    }
    const bounds = panel.getBoundingClientRect()
    const next = new Set([...representatives, ...held.current])
    if (entryTrackId) next.add(entryTrackId)
    const focused = document.activeElement?.closest<HTMLElement>('[data-playlist-track-id]')
    if (focused && grid.contains(focused) && focused.dataset.playlistTrackId) next.add(focused.dataset.playlistTrackId)
    for (const card of grid.children) {
      if (!(card instanceof HTMLElement) || !card.dataset.playlistTrackId) continue
      const rect = card.getBoundingClientRect()
      if (rect.bottom > bounds.top - bounds.height && rect.top < bounds.bottom + bounds.height) next.add(card.dataset.playlistTrackId)
    }
    setIds(previousIds => sameIds(previousIds, next) ? previousIds : next)
  }, [])
  // Runs before the caller's collection FLIP effects and initial scroll effects.
  // A same-commit update supplies visible content before the browser can paint.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!enabled || !active || !grid) { commitGeometry.current = null; return }
    const next = { grid, level: grid.dataset.layoutLevel, theme: options.theme, shapes: options.shapeKey, tracks: options.trackIdsKey }
    const previous = commitGeometry.current
    // Artwork/timeline state commits do not change geometry. Avoid an O(N)
    // rect scan on each thumbnail arrival while the shared header is moving.
    if (previous && previous.grid === grid && previous.level === next.level && previous.theme === next.theme
      && previous.shapes === next.shapes && previous.tracks === next.tracks) return
    commitGeometry.current = next
    refresh()
  })
  useLayoutEffect(() => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!enabled || !active || !panel || !grid) return
    let disposed = false
    const schedule = () => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        if (!disposed) refresh()
      })
    }
    const focus = (event: FocusEvent) => {
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-playlist-track-id]') : null
      const id = card?.dataset.playlistTrackId
      if (id) setIds(previous => previous.has(id) ? previous : new Set([...previous, id]))
    }
    const fontsChanged = () => { metrics.current = null; schedule() }
    panel.addEventListener('scroll', schedule, { passive: true })
    grid.addEventListener('focusin', focus)
    window.addEventListener('resize', schedule)
    document.fonts.addEventListener('loadingdone', fontsChanged)
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    observer.observe(grid)
    return () => {
      disposed = true
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      panel.removeEventListener('scroll', schedule)
      grid.removeEventListener('focusin', focus)
      window.removeEventListener('resize', schedule)
      document.fonts.removeEventListener('loadingdone', fontsChanged)
      observer.disconnect()
    }
  }, [panelRef, gridRef, enabled, active, refresh])
  const hold = useCallback((trackIds: Iterable<string>) => { held.current = new Set(trackIds) }, [])
  const release = useCallback(() => { held.current = new Set(); refresh() }, [refresh])
  return { ids, refresh, hold, release }
}
