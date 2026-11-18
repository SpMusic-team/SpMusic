import { flushSync } from 'react-dom'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { PlaylistTrackItemViewModel } from '../model/playerUiViewModel'

type Geometry = { columns: number; gap: number; heights: readonly number[] }
type Viewport = { first: number; end: number }
type TrackWindow = { first: number; end: number }
type Options = {
  enabled: boolean
  present: boolean
  panelRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLDivElement | null>
  tracks: readonly PlaylistTrackItemViewModel[]
  trackIdsKey: string
  firstFocusable: number
  lastFocusable: number
  appearance: object
}

const EMPTY_VIEWPORT: Viewport = { first: 0, end: 0 }
const FALLBACK = { columns: 0, gap: 0, heights: [] }
export const TILE_HEIGHT_SAMPLES = [
  { title: '', secondary: '' },
  { title: 'A', secondary: '' },
  { title: '', secondary: 'playlist-card-artist' },
  { title: 'A', secondary: 'playlist-card-artist' },
  { title: '', secondary: 'playlist-card-stream-url' },
  { title: 'A', secondary: 'playlist-card-stream-url' },
  { title: '', secondary: 'playlist-card-stream-url', empty: true },
  { title: 'A', secondary: 'playlist-card-stream-url', empty: true },
] as const

function tileHeightSample(track: PlaylistTrackItemViewModel) {
  // A nowrap title always has the same line height when it contains text.
  // Nonbreaking spaces still occupy a line. Artist text is trimmed by the card.
  const title = /[^\t\n\r\f ]/.test(track.title) ? 1 : 0
  const artist = track.artist.trim()
  if (track.stream) return (/[^\t\n\r\f ]/.test(artist || track.stream.url) ? 4 : 6) + title
  return (artist ? 2 : 0) + title
}

function readGeometry(grid: HTMLElement): Geometry {
  const style = getComputedStyle(grid)
  // Chromium resolves repeat(auto-fill, <length>) to the actual track list.
  const columns = style.gridTemplateColumns.trim().split(/\s+/)
  const gap = Number.parseFloat(style.rowGap)
  const measure = grid.querySelector<HTMLElement>('.playlist-tile-measure')
  const scale = measure ? measure.getBoundingClientRect().height / 64 : 0
  if (style.display !== 'grid' || !columns.every(column => /^[\d.]+px$/.test(column)) || !Number.isFinite(gap) || !scale) return FALLBACK
  // Normalize the height read against a ruler in the same transformed subtree.
  // Retain Chromium's fractional layout pixels so long spacers do not drift.
  const heights = [...measure!.children].map(element => Math.round(element.getBoundingClientRect().height / scale * 64) / 64)
  if (heights.length !== TILE_HEIGHT_SAMPLES.length || heights.some(height => !Number.isFinite(height) || height <= 0)) return FALLBACK
  return { columns: columns.length, gap, heights }
}

function rowOffsets(shapes: string, geometry: Geometry) {
  const offsets = [0]
  for (let start = 0; start < shapes.length; start += geometry.columns) {
    let height = 0
    for (let index = start; index < Math.min(shapes.length, start + geometry.columns); index += 1) {
      height = Math.max(height, geometry.heights[Number(shapes[index])])
    }
    offsets.push(offsets[offsets.length - 1] + height + geometry.gap)
  }
  return offsets
}

// Return the first row whose start lies strictly after the position.
function rowAfter(offsets: readonly number[], position: number) {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (offsets[mid] > position) high = mid
    else low = mid + 1
  }
  return low
}

function gridTop(panel: HTMLElement, grid: HTMLElement) {
  return grid.offsetParent === panel ? grid.offsetTop - panel.scrollTop
    : grid.getBoundingClientRect().top - panel.getBoundingClientRect().top
}

function buildWindows(viewport: Viewport, columns: number, count: number, extra: readonly number[]): TrackWindow[] {
  const rows = [
    { first: viewport.first, end: viewport.end },
    ...extra.filter(index => index >= 0 && index < count).map(index => {
      const row = Math.floor(index / columns)
      return { first: row, end: row + 1 }
    }),
  ].sort((left, right) => left.first - right.first)
  const windows: TrackWindow[] = []
  for (const row of rows) {
    const first = Math.min(row.first * columns, count)
    const end = Math.min(row.end * columns, count)
    if (first >= end) continue
    const next = { first, end }
    const previous = windows[windows.length - 1]
    if (previous && next.first <= previous.end) previous.end = Math.max(previous.end, next.end)
    else windows.push(next)
  }
  return windows
}

export function usePlaylistTileRenderWindow(options: Options) {
  const { enabled, present, panelRef, gridRef, tracks, trackIdsKey, firstFocusable, lastFocusable, appearance } = options
  const [measurement, setMeasurement] = useState<{ appearance: object; geometry: Geometry }>()
  const [viewport, setViewport] = useState(EMPTY_VIEWPORT)
  const committedViewport = useRef(EMPTY_VIEWPORT)
  useLayoutEffect(() => { committedViewport.current = viewport }, [viewport])
  const [focusedId, setFocusedId] = useState<string>()
  const pendingFocus = useRef<string>(undefined)
  const geometry = enabled && measurement?.appearance === appearance ? measurement.geometry : undefined
  const shapes = useMemo(() => enabled ? tracks.map(tileHeightSample).join('') : '', [enabled, tracks])
  const offsets = useMemo(() => geometry?.columns ? rowOffsets(shapes, geometry) : undefined, [geometry, shapes])
  const indexById = useMemo(() => enabled ? new Map(tracks.map((track, index) => [track.id, index])) : new Map<string, number>(), [enabled, tracks])
  const latestOffsets = useRef(offsets)
  useLayoutEffect(() => { latestOffsets.current = offsets }, [offsets])

  const refresh = useCallback((synchronous = false) => {
    const panel = panelRef.current
    const grid = gridRef.current
    const currentOffsets = latestOffsets.current
    if (!panel || !grid || !currentOffsets) return
    const top = -gridTop(panel, grid)
    const height = panel.clientHeight
    // Layout transitions snapshot two viewport heights on each side.
    const first = Math.max(0, rowAfter(currentOffsets, top - height * 2) - 1)
    const end = rowAfter(currentOffsets, top + height * 3)
    if (synchronous) {
      const committed = committedViewport.current
      if (committed.first === first && committed.end === end) return
      // The scroll event runs before the next RAF. A separate RAF commit can
      // leave the scrollport blank on a large thumb move or programmatic jump.
      flushSync(() => { setViewport({ first, end }) })
      return
    }
    setViewport(previous => previous.first === first && previous.end === end ? previous : { first, end })
  }, [panelRef, gridRef])
  const measure = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const next = readGeometry(grid)
    setMeasurement(previous => previous?.appearance === appearance && previous.geometry.columns === next.columns
      && previous.geometry.gap === next.gap && next.heights.every((height, index) => height === previous.geometry.heights[index])
      ? previous : { appearance, geometry: next })
  }, [appearance, gridRef])
  useLayoutEffect(() => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!enabled || !present || !panel || !grid) return
    const onScroll = () => refresh(true)
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      setFocusedId(target?.dataset.playlistTrackId)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !grid.contains(event.relatedTarget)) setFocusedId(undefined)
    }
    measure()
    const observer = new ResizeObserver(() => { measure(); refresh() })
    observer.observe(panel)
    observer.observe(grid)
    panel.addEventListener('scroll', onScroll, { passive: true })
    grid.addEventListener('focusin', onFocusIn)
    grid.addEventListener('focusout', onFocusOut)
    if (document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)) setFocusedId(document.activeElement.dataset.playlistTrackId)
    document.fonts.addEventListener('loadingdone', measure)
    return () => {
      observer.disconnect()
      panel.removeEventListener('scroll', onScroll)
      grid.removeEventListener('focusin', onFocusIn)
      grid.removeEventListener('focusout', onFocusOut)
      document.fonts.removeEventListener('loadingdone', measure)
    }
  }, [enabled, present, gridRef, panelRef, measure, refresh])
  // Track/filter changes can relocate the grid without resizing the panel.
  useLayoutEffect(() => { if (enabled && present) refresh() }, [enabled, present, offsets, trackIdsKey, refresh])
  const focusedIndex = focusedId === undefined ? -1 : indexById.get(focusedId) ?? -1
  const windows = useMemo(() => geometry?.columns
    ? buildWindows(viewport, geometry.columns, tracks.length, [firstFocusable, lastFocusable, focusedIndex])
    : [{ first: 0, end: geometry === undefined && enabled ? Math.min(60, tracks.length) : tracks.length }],
  [geometry, enabled, viewport, tracks.length, firstFocusable, lastFocusable, focusedIndex])

  const spacerHeight = useCallback((first: number, end: number) => offsets && geometry
    ? offsets[Math.ceil(end / geometry.columns)] - offsets[Math.floor(first / geometry.columns)] - geometry.gap
    : 0, [offsets, geometry])
  const moveToIndex = (index: number, center: boolean) => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!panel || !grid || !offsets || !geometry) return false
    const row = Math.floor(index / geometry.columns)
    const top = gridTop(panel, grid) + offsets[row]
    const height = offsets[row + 1] - offsets[row] - geometry.gap
    panel.scrollTop += center ? top - (panel.clientHeight - height) / 2
      : top < 0 ? top : Math.max(0, top + height - panel.clientHeight)
    refresh()
    return true
  }

  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (id === undefined) return
    const card = gridRef.current?.querySelector<HTMLButtonElement>(`[data-playlist-track-id="${CSS.escape(id)}"]`)
    if (!card) return
    pendingFocus.current = undefined
    card.focus({ preventScroll: true })
  })
  const focusIndex = (index: number) => {
    const id = tracks[index]?.id
    if (id === undefined || !moveToIndex(index, false)) return false
    pendingFocus.current = id
    return true
  }
  return {
    windows, spacerHeight, indexById, moveToIndex, focusIndex, refresh,
    bounded: Boolean(offsets), measuring: enabled && geometry === undefined,
  }
}
