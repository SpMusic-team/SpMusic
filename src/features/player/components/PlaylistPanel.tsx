import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { motion } from 'motion/react'
import { CornerLeftUp, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { getShuffleModePresentation, showPlaybackModeToast } from '@/features/player/components/playbackModePresentation'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { PlaylistPlaybackDock } from '@/features/player/components/PlaylistPlaybackDock'
import { PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import { appCopy } from '@/features/player/model/playerCopy'
import { nextShuffleMode, type ShuffleMode } from '@/features/player/model/playbackModes'
import { formatPlaylistDurationLabel, type PlaylistDurationStatus } from '@/features/player/model/playlistDuration'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistArtworkDemand, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

type PlaylistPanelProps = {
  tracks: PlaylistTrackItemViewModel[]
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  currentTrackId?: string | null
  totalDurationSeconds?: number
  totalDurationStatus?: PlaylistDurationStatus
  totalDurationDetail?: string
  shuffleMode: ShuffleMode
  onShuffleCycle: () => void
  isOpenAudioDisabled?: boolean
  onOpenAudio?: () => void
  onTrackSelect?: (trackId: string) => void
  onVisibleTrackIdsChange?: (trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean, demand?: PlaylistArtworkDemand) => void
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  onPlayToggle: () => void
  onClose: () => void
  librarySidebarOpen?: boolean
  onLibrarySidebarOpenChange?: (open: boolean) => void
}

type PlaylistLayoutDescriptor = Readonly<{
  level: number
  label: string
  columns: number
  flow: 'tile' | 'row' | 'text'
  showArtwork: boolean
  style: CSSProperties
}>

const PLAYLIST_LAYOUTS: readonly PlaylistLayoutDescriptor[] = [
  { level: 0, label: '两列大封面视图', columns: 2, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '215px', '--playlist-card-title-size': '20px', '--playlist-card-artist-size': '15px', '--playlist-card-format-size': '13px' } as CSSProperties },
  { level: 1, label: '三列封面视图', columns: 3, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '155px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '12px' } as CSSProperties },
  { level: 2, label: '四列封面视图', columns: 4, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '110px', '--playlist-card-title-size': '15px', '--playlist-card-artist-size': '12px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 3, label: '单列大封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '135px', '--playlist-card-min-height': '165px', '--playlist-card-title-size': '30px', '--playlist-card-artist-size': '24px', '--playlist-card-format-size': '18px' } as CSSProperties },
  { level: 4, label: '单列中封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '96px', '--playlist-card-min-height': '120px', '--playlist-card-title-size': '23px', '--playlist-card-artist-size': '18px', '--playlist-card-format-size': '14px' } as CSSProperties },
  { level: 5, label: '单列小封面视图', columns: 1, flow: 'row', showArtwork: true, style: { '--playlist-cover-size': '58px', '--playlist-card-min-height': '76px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 6, label: '单列详细文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '64px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '11px' } as CSSProperties },
  { level: 7, label: '单列紧凑文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '48px', '--playlist-card-title-size': '15px', '--playlist-card-artist-size': '12px', '--playlist-card-format-size': '10px' } as CSSProperties },
  { level: 8, label: '单列极简文本视图', columns: 1, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '36px', '--playlist-card-title-size': '14px', '--playlist-card-artist-size': '11px', '--playlist-card-format-size': '9px' } as CSSProperties },
  { level: 9, label: '双列紧凑文本视图', columns: 2, flow: 'text', showArtwork: false, style: { '--playlist-card-min-height': '40px', '--playlist-card-title-size': '14px', '--playlist-card-artist-size': '11px', '--playlist-card-format-size': '9px' } as CSSProperties },
]

const DEFAULT_PLAYLIST_LAYOUT_LEVEL = 3
const PLAYLIST_LAYOUT_STORAGE_KEY = 'spmusic.playlist.layout-level.v1'
const PLAYLIST_WHEEL_THRESHOLD = 28
const PLAYLIST_WHEEL_STEP_LOCK_MS = 150
// Wheel events have no gesture-end signal; silence separates trackpad pinches.
const PLAYLIST_TRACKPAD_IDLE_MS = 350
const PLAYLIST_PINCH_MIN_DISTANCE = 24
const PLAYLIST_PINCH_DISTANCE_RATIO = 0.12
function readPlaylistLayoutLevel(): number {
  const defaultLevel = typeof window !== 'undefined' && window.innerWidth > 1024 ? 0 : DEFAULT_PLAYLIST_LAYOUT_LEVEL
  if (typeof window === 'undefined') return defaultLevel
  try {
    const stored = window.localStorage.getItem(PLAYLIST_LAYOUT_STORAGE_KEY)
    if (stored === null || !/^(0|[1-9]\d*)$/.test(stored)) return defaultLevel
    const level = Number(stored)
    return Number.isSafeInteger(level) && level < PLAYLIST_LAYOUTS.length
      ? level
      : defaultLevel
  } catch {
    return defaultLevel
  }
}

function persistPlaylistLayoutLevel(level: number): void {
  try {
    window.localStorage.setItem(PLAYLIST_LAYOUT_STORAGE_KEY, String(level))
  } catch {
    // A blocked or full store must not prevent changing the current view.
  }
}

type CardLayoutSnapshot = {
  cover: DOMRect | null
  copy: DOMRect
}

type PlaylistCardRow = {
  start: number
  end: number
  top: number
  height: number
  anchor: HTMLElement
}

type PlaylistCardIndex = {
  cards: HTMLElement[]
  rows: PlaylistCardRow[]
  gridWidth: number
  gridHeight: number
  panelWidth: number
  panelHeight: number
}

// Build only when the DOM or layout changes. CSS can place more columns than
// data-layout-columns says, so the actual card offsets define the rows.
function buildPlaylistCardIndex(grid: HTMLElement, panel: HTMLElement): PlaylistCardIndex | null {
  if (grid.dataset.layoutLevel !== '0' || getComputedStyle(grid).display !== 'grid') return null
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
  if (cards.length === 0 || cards.length !== grid.children.length) return null
  const rows: PlaylistCardRow[] = []
  let rowLeft = -Infinity
  let cardWidth = 0
  const offsetParent = cards[0]?.offsetParent
  for (const [index, card] of cards.entries()) {
    if (card.parentElement !== grid || card.offsetParent !== offsetParent || !card.dataset.playlistTrackId) return null
    const top = card.offsetTop
    const left = card.offsetLeft
    const height = card.offsetHeight
    const width = card.offsetWidth
    if (height <= 0 || width <= 0 || (cardWidth && Math.abs(width - cardWidth) > 1)) return null
    cardWidth = width
    const row = rows[rows.length - 1]
    if (!row || top > row.top + 1) {
      if (row && (top < row.top + row.height - 1 || left > rowLeft + 1)) return null
      rows.push({ start: index, end: index + 1, top, height, anchor: card })
      rowLeft = left
    } else {
      if (top < row.top - 1 || Math.abs(height - row.height) > 1 || left <= rowLeft) return null
      row.end = index + 1
      rowLeft = left
    }
  }
  const columns = rows[0]!.end - rows[0]!.start
  if (rows.some((row, index) => index < rows.length - 1 && row.end - row.start !== columns)) return null
  return { cards, rows, gridWidth: grid.clientWidth, gridHeight: grid.clientHeight, panelWidth: panel.clientWidth, panelHeight: panel.clientHeight }
}

// Return complete rows around both boundaries, then use each card's live rect
// and the original ordering rules. Null means the full scan must be used.
function indexedPlaylistCandidates(index: PlaylistCardIndex, grid: HTMLElement, panel: HTMLElement, upper: number, lower: number): { card: HTMLElement; domIndex: number }[] | null {
  const { cards, rows } = index
  if (
    grid.children.length !== cards.length || cards[0] !== grid.firstElementChild
    || cards[cards.length - 1] !== grid.lastElementChild
    || index.gridWidth !== grid.clientWidth || index.gridHeight !== grid.clientHeight
    || index.panelWidth !== panel.clientWidth || index.panelHeight !== panel.clientHeight
    || grid.querySelector('.playlist-card:active')
  ) return null

  const rects = new Map<number, DOMRect>()
  const rowRect = (at: number): DOMRect | null => {
    const row = rows[at]
    if (!row || !row.anchor.isConnected || row.anchor.parentElement !== grid || cards[row.start] !== row.anchor
      || Math.abs(row.anchor.offsetTop - row.top) > 1 || Math.abs(row.anchor.offsetHeight - row.height) > 1) return null
    let rect = rects.get(at)
    if (!rect) {
      rect = row.anchor.getBoundingClientRect()
      if (Math.abs(rect.height - row.height) > 1) return null
      rects.set(at, rect)
    }
    return rect
  }
  const firstRect = rowRect(0)
  const lastRect = rowRect(rows.length - 1)
  if (!firstRect || !lastRect || Math.abs((lastRect.top - firstRect.top) - (rows[rows.length - 1]!.top - rows[0]!.top)) > 1) return null

  const boundary = (edge: number, useBottom: boolean): number | null => {
    let low = 0
    let high = rows.length
    while (low < high) {
      const mid = (low + high) >>> 1
      const rect = rowRect(mid)
      if (!rect) return null
      if ((useBottom ? rect.bottom : rect.top) <= edge) low = mid + 1
      else high = mid
    }
    return low
  }
  const first = boundary(upper, true)
  const after = boundary(lower, false)
  if (first === null || after === null || first > after) return null
  const start = Math.max(0, first - 1)
  const end = Math.min(rows.length, after + 1)
  for (const at of [start - 1, start, first, first + 1, after - 1, after, end - 1, end]) {
    if (at < 0 || at >= rows.length) continue
    const rect = rowRect(at)
    if (!rect) return null
    for (const neighbor of [at - 1, at + 1]) {
      if (neighbor < 0 || neighbor >= rows.length) continue
      const neighborRect = rowRect(neighbor)
      if (!neighborRect || (neighbor < at ? neighborRect.bottom > rect.top + 1 : rect.bottom > neighborRect.top + 1)) return null
    }
  }
  const candidates: { card: HTMLElement; domIndex: number }[] = []
  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const row = rows[rowIndex]!
    for (let domIndex = row.start; domIndex < row.end; domIndex += 1) {
      const card = cards[domIndex]!
      if (!card.isConnected || card.parentElement !== grid) return null
      candidates.push({ card, domIndex })
    }
  }
  return candidates
}

function snapshotCardLayout(grid: HTMLElement, panel: HTMLElement): Map<string, CardLayoutSnapshot> {
  const bounds = panel.getBoundingClientRect()
  const snapshots = new Map<string, CardLayoutSnapshot>()
  for (const card of grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')) {
    const cardBounds = card.getBoundingClientRect()
    if (cardBounds.bottom < bounds.top - bounds.height * 2 || cardBounds.top > bounds.bottom + bounds.height * 2) continue
    const trackId = card.dataset.playlistTrackId
    const copy = card.querySelector<HTMLElement>('.playlist-card-copy')
    const cover = card.querySelector<HTMLElement>('.playlist-card-cover')
    if (!trackId || !copy) continue
    snapshots.set(trackId, {
      cover: cover && getComputedStyle(cover).display !== 'none' ? cover.getBoundingClientRect() : null,
      copy: copy.getBoundingClientRect(),
    })
  }
  return snapshots
}

function animateLayoutPart(element: HTMLElement, from: DOMRect, to: DOMRect, duration: number, easing: string): Animation | null {
  if (to.width <= 0 || to.height <= 0 || from.width <= 0 || from.height <= 0) return null
  const x = from.left - to.left
  const y = from.top - to.top
  const scaleX = from.width / to.width
  const scaleY = from.height / to.height
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(scaleX - 1) < 0.005 && Math.abs(scaleY - 1) < 0.005) return null
  return element.animate([
    { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], { duration, easing, fill: 'both' })
}

export function PlaylistPanel({
  tracks,
  unavailableTrackIds,
  playlistName,
  currentTrackId,
  totalDurationSeconds,
  totalDurationStatus,
  totalDurationDetail,
  shuffleMode,
  onShuffleCycle,
  isOpenAudioDisabled,
  onOpenAudio,
  onTrackSelect,
  onVisibleTrackIdsChange,
  playback,
  timeline,
  visualIsPlaying,
  playbackTransitionPending,
  onPlayToggle,
  onClose,
  librarySidebarOpen = false,
  onLibrarySidebarOpenChange,
}: PlaylistPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [layoutLevel, setLayoutLevel] = useState(readPlaylistLayoutLevel)
  const [layoutAnnouncement, setLayoutAnnouncement] = useState('')
  // The player owns the bounded thumbnail window across panel opens. Render
  // retained URLs on the first frame, before the new viewport report arrives.
  const [artworkWindowIds, setArtworkWindowIds] = useState<ReadonlySet<string>>(
    () => new Set(tracks.filter((track) => track.coverThumbnail).map((track) => track.id)),
  )
  const [artworkWindowRevision, setArtworkWindowRevision] = useState(0)
  // The failure state stays out of reach on purpose: the pipeline reports
  // nothing when artwork is dropped (see the note on PlaylistCardCoverState), and
  // every client-side heuristic for guessing it - per-src failure events, or a
  // grace deadline - reported "no cover" for artwork that was merely slow or
  // outside the decode window. A mute flat tile is the lesser artifact until the
  // visual pipeline can say "this one is gone".
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const initialPositionAppliedRef = useRef(false)
  const layoutLevelRef = useRef(layoutLevel)
  const wheelAccumulatedDeltaRef = useRef(0)
  const wheelLastAtRef = useRef(0)
  const wheelLockedUntilRef = useRef(0)
  const pendingLayoutSnapshotRef = useRef<Map<string, CardLayoutSnapshot> | null>(null)
  const activeLayoutAnimationsRef = useRef<Set<Animation>>(new Set())
  const artworkHoldIdsRef = useRef<ReadonlySet<string> | null>(null)
  const layoutTransitionGenerationRef = useRef(0)
  const artworkWindowIdsRef = useRef<ReadonlySet<string>>(new Set())
  const artworkWindowKeyRef = useRef('')
  const metadataWindowKeyRef = useRef<string | null>(null)
  const layout = PLAYLIST_LAYOUTS[layoutLevel] ?? PLAYLIST_LAYOUTS[DEFAULT_PLAYLIST_LAYOUT_LEVEL]

  const unavailable = useMemo(
    () => unavailableTrackIds ?? new Set<string>(),
    [unavailableTrackIds],
  )
  const totalClock = formatPlaylistDurationLabel({
    status: totalDurationStatus, totalSeconds: totalDurationSeconds,
  }, tracks.length)

  const query = filter.trim().toLowerCase()
  const filteredTracks = useMemo(() => {
    if (!query) return tracks
    return tracks.filter((track) => (
      track.title.toLowerCase().includes(query)
      || track.artist.toLowerCase().includes(query)
      || track.album.toLowerCase().includes(query)
    ))
  }, [query, tracks])
  const filteredTrackIdsKey = useMemo(
    () => filteredTracks.map((track) => track.id).join('\u0000'),
    [filteredTracks],
  )

  const clearArtworkWindow = useCallback(() => {
    if (artworkWindowIdsRef.current.size === 0) return
    const emptyWindow = new Set<string>()
    artworkWindowIdsRef.current = emptyWindow
    artworkWindowKeyRef.current = ''
    setArtworkWindowIds(emptyWindow)
  }, [])

  // The player owns the bounded artwork window. Closing this temporary view
  // must not revoke its covers; playlist replacement/player disposal do that.

  const stopLayoutAnimations = useCallback(() => {
    for (const animation of activeLayoutAnimationsRef.current) animation.cancel()
    activeLayoutAnimationsRef.current.clear()
  }, [])

  useLayoutEffect(() => {
    const snapshots = pendingLayoutSnapshotRef.current
    pendingLayoutSnapshotRef.current = null
    const grid = gridRef.current
    if (!snapshots || !grid || appearanceMotion.disabled) return
    const duration = Number(appearanceMotion.layoutTransition.duration ?? 0) * 1000
    if (duration <= 0) return
    const ease = appearanceMotion.layoutTransition.ease
    const easing = Array.isArray(ease) && ease.length === 4
      ? `cubic-bezier(${ease.join(', ')})`
      : typeof ease === 'string' ? ease : 'ease-out'
    const generation = layoutTransitionGenerationRef.current
    const animations: Animation[] = []
    const parts: { element: HTMLElement; from: DOMRect; to: DOMRect }[] = []
    // Read every destination before starting any animation. animate() installs
    // a transform immediately (fill: 'both'); interleaving it with the next
    // geometry read forces synchronous style updates for each cover/copy.
    for (const card of grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')) {
      const snapshot = snapshots.get(card.dataset.playlistTrackId ?? '')
      if (!snapshot) continue
      for (const [selector, from] of [
        ['.playlist-card-cover', snapshot.cover],
        ['.playlist-card-copy', snapshot.copy],
      ] as const) {
        if (!from) continue
        const element = card.querySelector<HTMLElement>(selector)
        if (!element || getComputedStyle(element).display === 'none') continue
        parts.push({ element, from, to: element.getBoundingClientRect() })
      }
    }
    for (const { element, from, to } of parts) {
      const animation = animateLayoutPart(element, from, to, duration, easing)
      if (!animation) continue
      animations.push(animation)
      activeLayoutAnimationsRef.current.add(animation)
      animation.onfinish = () => {
        activeLayoutAnimationsRef.current.delete(animation)
        animation.cancel()
      }
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (generation !== layoutTransitionGenerationRef.current) return
      artworkHoldIdsRef.current = null
      setArtworkWindowRevision((previous) => previous + 1)
    })
  }, [layoutLevel, appearanceMotion])

  useEffect(() => () => {
    layoutTransitionGenerationRef.current += 1
    stopLayoutAnimations()
  }, [stopLayoutAnimations])

  const handleActivate = useCallback((trackId: string) => {
    onTrackSelect?.(trackId)
  }, [onTrackSelect])

  const handleToggleSelect = useCallback((trackId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }, [])

  const handleSelectModeToggle = useCallback(() => {
    setSelectMode((previous) => {
      if (previous) setSelectedIds(new Set())
      return !previous
    })
  }, [])

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleSearchToggle = useCallback(() => {
    setSearchOpen((previous) => {
      if (previous) setFilter('')
      return !previous
    })
  }, [])

  const handlePlay = useCallback(() => {
    const target = tracks.find((track) => !unavailable.has(track.id))?.id
    if (!target) return
    onTrackSelect?.(target)
  }, [onTrackSelect, tracks, unavailable])

  useLayoutEffect(() => {
    if (initialPositionAppliedRef.current || !currentTrackId) return
    const panel = panelRef.current
    const grid = gridRef.current
    if (!panel || !grid) return
    const currentCard = [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
      .find((card) => card.dataset.playlistTrackId === currentTrackId)
    if (!currentCard) return
    const panelRect = panel.getBoundingClientRect()
    const cardRect = currentCard.getBoundingClientRect()
    panel.scrollTop += cardRect.top - panelRect.top - (panel.clientHeight - cardRect.height) / 2
    initialPositionAppliedRef.current = true
  }, [currentTrackId, filteredTrackIdsKey])

  useEffect(() => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!panel || !onVisibleTrackIdsChange) return
    // Invalidate before even an empty text grid reports metadata-only demand.
    if (!layout.showArtwork) artworkWindowKeyRef.current = ''
    if (!grid) {
      onVisibleTrackIdsChange([], true, layout.showArtwork)
      return
    }
    // Text metadata has its own window. Existing artwork follows the player's
    // bounded grace policy independently of these row geometry reports.
    metadataWindowKeyRef.current = null
    let frameId: number | null = null
    let disposed = false
    let cardIndex: PlaylistCardIndex | null = null
    let indexDirty = true
    const transformingCards = new Set<EventTarget>()
    const publish = () => {
      frameId = null
      if (disposed) return
      const panelRect = panel.getBoundingClientRect()
      const dock = panel.parentElement?.querySelector<HTMLElement>('.playlist-playback-dock')
      const dockTop = dock?.getBoundingClientRect().top ?? panelRect.bottom
      const viewportBottom = Math.min(panelRect.bottom, dockTop)
      if (indexDirty) {
        cardIndex = buildPlaylistCardIndex(grid, panel)
        indexDirty = false
      }
      const candidates = layout.level === 0 && cardIndex && transformingCards.size === 0
        ? indexedPlaylistCandidates(cardIndex, grid, panel, panelRect.top - panelRect.height, viewportBottom + panelRect.height)
        : null
      if (layout.level === 0 && cardIndex && !candidates && transformingCards.size === 0
        && !grid.querySelector('.playlist-card:active')) indexDirty = true
      const orderedEntries = (candidates ?? [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
        .map((card, domIndex) => ({ card, domIndex })))
        .map(({ card, domIndex }) => {
          const trackId = card.dataset.playlistTrackId
          if (!trackId) return null
          const rect = card.getBoundingClientRect()
          if (rect.bottom <= panelRect.top - panelRect.height || rect.top >= viewportBottom + panelRect.height) return null
          const inViewport = rect.bottom > panelRect.top && rect.top < viewportBottom
          const viewportDistance = inViewport
            ? 0
            : rect.bottom <= panelRect.top ? panelRect.top - rect.bottom : rect.top - viewportBottom
          return { trackId, domIndex, inViewport, viewportDistance }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => Number(right.inViewport) - Number(left.inViewport)
          || (left.inViewport ? left.domIndex - right.domIndex : left.viewportDistance - right.viewportDistance)
          || left.domIndex - right.domIndex)
      if (!layout.showArtwork) {
        // Returning to artwork must republish even if geometry/IDs are equal to
        // the last cover layout; the player may have expired its warm leases.
        artworkWindowKeyRef.current = ''
        const orderedIds = orderedEntries.map((entry) => entry.trackId)
        const windowKey = orderedIds.join('\u0000')
        if (metadataWindowKeyRef.current === windowKey) return
        metadataWindowKeyRef.current = windowKey
        onVisibleTrackIdsChange(orderedIds, true, false)
        return
      }
      // Geometry is recalculated on scroll as well as layout changes: the
      // prefetch observer alone cannot report motion inside its root margin.
      const heldIds = artworkHoldIdsRef.current
      const visibleTrackIds = orderedEntries.filter((entry) => entry.inViewport).map((entry) => entry.trackId)
      const prefetchTrackIds = orderedEntries.filter((entry) => !entry.inViewport).map((entry) => entry.trackId)
      const orderedIds = [...new Set([
        ...visibleTrackIds,
        ...(heldIds ? [...heldIds] : []),
        ...prefetchTrackIds,
      ])]
      const cover = grid.querySelector<HTMLElement>('.playlist-card-cover')
      const coverCssPixels = cover?.getBoundingClientRect().width ?? 128
      const dpr = window.devicePixelRatio || 1
      const windowKey = `${coverCssPixels}\u0000${dpr}\u0000${visibleTrackIds.join('\u0000')}\u0001${orderedIds.join('\u0000')}`
      if (artworkWindowKeyRef.current === windowKey) return
      const nextWindow = new Set(orderedIds)
      artworkWindowKeyRef.current = windowKey
      artworkWindowIdsRef.current = nextWindow
      setArtworkWindowIds(nextWindow)
      onVisibleTrackIdsChange(orderedIds, true, true, {
        visibleIds: visibleTrackIds,
        prefetchIds: prefetchTrackIds,
        heldIds: heldIds ? [...heldIds] : [],
        coverCssPixels,
        dpr,
      })
    }
    const schedulePublish = () => {
      if (frameId === null) frameId = requestAnimationFrame(publish)
    }
    const invalidateIndex = () => {
      indexDirty = true
      schedulePublish()
    }
    const onTransformStart = (event: TransitionEvent) => {
      if (event.propertyName !== 'transform' || !(event.target instanceof Element)
        || !event.target.matches('.playlist-card')) return
      transformingCards.add(event.target)
      schedulePublish()
    }
    const onTransformEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'transform' || !event.target) return
      transformingCards.delete(event.target)
      schedulePublish()
    }

    const cards = grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')
    if (cards.length === 0) {
      if (layout.showArtwork) clearArtworkWindow()
      onVisibleTrackIdsChange([], true, layout.showArtwork)
    }
    if (cards.length > 0) schedulePublish()
    panel.addEventListener('scroll', schedulePublish, { passive: true })
    grid.addEventListener('transitionrun', onTransformStart)
    grid.addEventListener('transitionend', onTransformEnd)
    grid.addEventListener('transitioncancel', onTransformEnd)
    const mutationObserver = new MutationObserver(invalidateIndex)
    mutationObserver.observe(grid, { childList: true })
    const resizeObserver = new ResizeObserver(invalidateIndex)
    resizeObserver.observe(panel)
    resizeObserver.observe(grid)
    window.addEventListener('resize', invalidateIndex)
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onResolutionChange = () => {
      resolution.removeEventListener('change', onResolutionChange)
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      resolution.addEventListener('change', onResolutionChange)
      schedulePublish()
    }
    resolution.addEventListener('change', onResolutionChange)
    return () => {
      disposed = true
      panel.removeEventListener('scroll', schedulePublish)
      grid.removeEventListener('transitionrun', onTransformStart)
      grid.removeEventListener('transitionend', onTransformEnd)
      grid.removeEventListener('transitioncancel', onTransformEnd)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', invalidateIndex)
      resolution.removeEventListener('change', onResolutionChange)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [filteredTrackIdsKey, layout.level, layout.showArtwork, onVisibleTrackIdsChange, artworkWindowRevision, clearArtworkWindow])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const changeLayout = (direction: -1 | 1, now: number) => {
      const grid = gridRef.current
      if (!grid || now < wheelLockedUntilRef.current) return
      const currentLevel = layoutLevelRef.current
      const nextLevel = Math.max(0, Math.min(PLAYLIST_LAYOUTS.length - 1, currentLevel + direction))
      if (nextLevel === currentLevel) return
      const nextLayout = PLAYLIST_LAYOUTS[nextLevel]
      if (!nextLayout) return
      // Capture the current painted position, including an interrupted in-flight
      // animation, before changing the grid. The same cover/image DOM nodes then
      // animate from these pixels to their new layout in useLayoutEffect.
      const snapshot = appearanceMotion.disabled ? null : snapshotCardLayout(grid, panel)
      pendingLayoutSnapshotRef.current = snapshot
      artworkHoldIdsRef.current = snapshot ? new Set(
        [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')].flatMap((card) => {
          const trackId = card.dataset.playlistTrackId
          const image = card.querySelector<HTMLImageElement>('.playlist-card-cover-image')
          return trackId && snapshot.get(trackId)?.cover && image?.complete && image.naturalWidth > 0
            && image.src.startsWith('blob:') ? [trackId] : []
        }),
      ) : null
      layoutTransitionGenerationRef.current += 1
      stopLayoutAnimations()
      wheelLockedUntilRef.current = now + PLAYLIST_WHEEL_STEP_LOCK_MS
      layoutLevelRef.current = nextLevel
      setLayoutLevel(nextLevel)
      persistPlaylistLayoutLevel(nextLevel)
      setLayoutAnnouncement(`歌曲视图已切换为${nextLayout.label}`)
    }

    const pressedControlKeys = new Set<string>()
    let wheelInput: 'control' | 'trackpad' | null = null
    let trackpadLastAt = -Infinity
    let trackpadConsumed = false
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') pressedControlKeys.add(event.code || event.key)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') pressedControlKeys.delete(event.code || event.key)
    }
    const handleWheel = (event: WheelEvent) => {
      const grid = gridRef.current
      if (!grid || !(event.target instanceof Node) || !grid.contains(event.target) || !event.ctrlKey) return
      event.preventDefault()
      const now = performance.now()
      // Chromium emits ctrlKey wheel for a trackpad pinch without pressing Ctrl.
      const nextInput = pressedControlKeys.size > 0 ? 'control' : 'trackpad'
      if (wheelInput !== nextInput) wheelAccumulatedDeltaRef.current = 0
      wheelInput = nextInput
      if (nextInput === 'trackpad') {
        if (now - trackpadLastAt > PLAYLIST_TRACKPAD_IDLE_MS) {
          trackpadConsumed = false
          wheelAccumulatedDeltaRef.current = 0
        }
        // Refresh even after consumption or during the layout step lock. A long
        // stream remains one gesture regardless of its duration or direction.
        trackpadLastAt = now
        if (trackpadConsumed) return
      }
      if (now < wheelLockedUntilRef.current) return
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? panel.clientHeight : 1
      const delta = event.deltaY * multiplier
      if (
        now - wheelLastAtRef.current > 250
        || Math.sign(delta) !== Math.sign(wheelAccumulatedDeltaRef.current)
      ) wheelAccumulatedDeltaRef.current = 0
      wheelLastAtRef.current = now
      wheelAccumulatedDeltaRef.current += delta
      if (Math.abs(wheelAccumulatedDeltaRef.current) < PLAYLIST_WHEEL_THRESHOLD) return

      const direction = wheelAccumulatedDeltaRef.current < 0 ? -1 : 1
      wheelAccumulatedDeltaRef.current = 0
      if (nextInput === 'trackpad') trackpadConsumed = true
      changeLayout(direction, now)
    }

    let pinch: { identifiers: readonly number[]; distance: number } | null = null
    let touchBlocked = false
    const touchDistance = (first: Touch, second: Touch) => Math.hypot(
      second.clientX - first.clientX, second.clientY - first.clientY,
    )
    const insidePanel = (touch: Touch) => {
      const bounds = panel.getBoundingClientRect()
      return touch.clientX >= bounds.left && touch.clientX <= bounds.right
        && touch.clientY >= bounds.top && touch.clientY <= bounds.bottom
    }
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 2) {
        pinch = null
        touchBlocked = true
        return
      }
      const grid = gridRef.current
      if (touchBlocked || event.touches.length !== 2 || !grid) return
      const [first, second] = Array.from(event.touches)
      if (![first!, second!].every((touch) => touch.target instanceof Node
        && grid.contains(touch.target) && insidePanel(touch))) return
      // Reserve only the two-finger gesture; one-finger scrolling stays native.
      if (event.cancelable) event.preventDefault()
      pinch = { identifiers: [first!.identifier, second!.identifier], distance: touchDistance(first!, second!) }
      wheelAccumulatedDeltaRef.current = 0
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (touchBlocked) {
        if (event.touches.length === 2 && event.cancelable) event.preventDefault()
        return
      }
      if (!pinch) return
      const touches = Array.from(event.touches)
      if (touches.length !== 2 || !touches.every((touch) => pinch!.identifiers.includes(touch.identifier)
        && insidePanel(touch))) {
        pinch = null
        touchBlocked = true
        return
      }
      if (event.cancelable) event.preventDefault()
      const distance = touchDistance(touches[0]!, touches[1]!)
      const delta = distance - pinch.distance
      const threshold = Math.max(PLAYLIST_PINCH_MIN_DISTANCE, pinch.distance * PLAYLIST_PINCH_DISTANCE_RATIO)
      const now = performance.now()
      if (Math.abs(delta) < threshold || now < wheelLockedUntilRef.current) return
      // Translation leaves the separation unchanged; spreading matches Ctrl+wheel up.
      changeLayout(delta > 0 ? -1 : 1, now)
      // Consume this gesture even at a layout boundary. Only lifting every
      // touch unlocks it, so continuing or replacing one finger cannot repeat.
      pinch = null
      touchBlocked = true
    }
    const handleTouchEnd = (event: TouchEvent) => {
      pinch = null
      if (event.touches.length === 0) touchBlocked = false
    }
    const handleTouchCancel = (event: TouchEvent) => {
      pinch = null
      touchBlocked = event.touches.length > 0
    }
    const handleBlur = () => {
      pressedControlKeys.clear()
      wheelInput = null
      trackpadLastAt = -Infinity
      trackpadConsumed = false
      wheelAccumulatedDeltaRef.current = 0
      wheelLastAtRef.current = 0
      pinch = null
      touchBlocked = false
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    panel.addEventListener('wheel', handleWheel, { passive: false })
    panel.addEventListener('touchstart', handleTouchStart, { passive: false })
    panel.addEventListener('touchmove', handleTouchMove, { passive: false })
    panel.addEventListener('touchend', handleTouchEnd)
    panel.addEventListener('touchcancel', handleTouchCancel)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      panel.removeEventListener('wheel', handleWheel)
      panel.removeEventListener('touchstart', handleTouchStart)
      panel.removeEventListener('touchmove', handleTouchMove)
      panel.removeEventListener('touchend', handleTouchEnd)
      panel.removeEventListener('touchcancel', handleTouchCancel)
      pinch = null
      pendingLayoutSnapshotRef.current = null
      stopLayoutAnimations()
    }
  }, [appearanceMotion, stopLayoutAnimations])

  const playableTrackId = tracks.find((track) => !unavailable.has(track.id))?.id

  const handleShuffle = useCallback(() => {
    const nextMode = nextShuffleMode[shuffleMode]
    onShuffleCycle()
    showPlaybackModeToast(getShuffleModePresentation(nextMode, systemIcons))
  }, [onShuffleCycle, shuffleMode, systemIcons])

  const shufflePresentation = getShuffleModePresentation(shuffleMode, systemIcons)

  const handleMore = useCallback(() => {
    onOpenAudio?.()
  }, [onOpenAudio])

  const selectedCount = selectedIds.size
  const firstTrack = tracks[0]
  const firstTrackCoverSource = firstTrack?.coverImage ?? firstTrack?.coverImageFallback
  const handleHeroCoverError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const fallback = firstTrack?.coverImageFallback
    if (fallback && image.src !== fallback) {
      image.src = fallback
      return
    }
    image.hidden = true
  }, [firstTrack?.coverImageFallback])
  const showExtendedMetadata = layout.flow !== 'tile'
  const cards = useMemo(() => filteredTracks.map((track, index) => (
    <PlaylistCard
      key={track.id}
      track={track}
      index={index}
      current={track.id === currentTrackId}
      unavailable={unavailable.has(track.id)}
      canActivate={onTrackSelect !== undefined}
      selectMode={selectMode}
      selected={selectedIds.has(track.id)}
      artworkVisible={artworkWindowIds.has(track.id)}
      showExtendedMetadata={showExtendedMetadata}
      onActivate={handleActivate}
      onToggleSelect={handleToggleSelect}
    />
  )), [filteredTracks, currentTrackId, unavailable, onTrackSelect, selectMode, selectedIds,
    artworkWindowIds, showExtendedMetadata, handleActivate, handleToggleSelect])

  return (
    <>
      <PlaylistLibrarySidebar
        playlistName={playlistName ?? appCopy.playlistPage.title}
        trackCount={tracks.length}
        totalClock={totalClock}
        coverTrack={firstTrack}
        onCurrentPlaylist={() => panelRef.current?.focus({ preventScroll: true })}
      />
      <Dialog open={librarySidebarOpen} onOpenChange={onLibrarySidebarOpenChange}>
        <DialogContent
          id="playlist-library-overlay"
          showCloseButton={false}
          className="playlist-library-dialog"
          overlayClassName="playlist-library-backdrop"
          // Keep the longhand inline: CSS optimization folds `translate: none`
          // into transform, leaving the shared Dialog's centering translate active.
          style={{ translate: '0 0', animationDuration: appearanceMotion.disabled ? '0s' : 'var(--app-motion-prototype-smart)' }}
          finalFocus={() => {
            const menu = document.getElementById('playlist-library-menu')
            return menu?.getClientRects().length ? menu : false
          }}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">媒体库</DialogTitle>
          <PlaylistLibrarySidebar
            overlay
            playlistName={playlistName ?? appCopy.playlistPage.title}
            trackCount={tracks.length}
            totalClock={totalClock}
            coverTrack={firstTrack}
            onCurrentPlaylist={() => onLibrarySidebarOpenChange?.(false)}
          />
        </DialogContent>
      </Dialog>
      <motion.section
        ref={panelRef}
        className="playlist-panel"
        data-select-mode={selectMode ? 'true' : undefined}
        variants={appearanceMotion.variants.backdrop}
        transition={appearanceMotion.layoutTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        aria-label={appCopy.playlistPage.title}
        tabIndex={-1}
      >
      <header className="playlist-hero">
        {firstTrack?.coverThumbnail ? (
          <PlaylistCoverImage className="playlist-hero-image" image={firstTrack.coverThumbnail} />
        ) : firstTrackCoverSource ? (
          <img className="playlist-hero-image" src={firstTrackCoverSource} alt="" aria-hidden="true" decoding="async" onError={handleHeroCoverError} />
        ) : null}
        <Button
          type="button"
          className="playlist-hero-category"
          size="sm"
          variant="ghost"
          aria-current="page"
          onClick={() => panelRef.current?.focus({ preventScroll: true })}
        >
          <CornerLeftUp data-icon="inline-start" aria-hidden="true" />
          {appCopy.playlistPage.title}
        </Button>
        <button type="button" className="playlist-close" aria-label={appCopy.playlistPage.close} onClick={onClose}>
          <systemIcons.close />
        </button>
        <div className="playlist-hero-copy">
          <h1 className="playlist-hero-title">{playlistName ?? appCopy.playlistPage.title}</h1>
          <p className="playlist-hero-meta">
            <systemIcons.music aria-hidden="true" />
            <span className="playlist-hero-count" aria-label={appCopy.playlistPage.count(tracks.length)}>{tracks.length}</span>
            <span className="playlist-hero-meta-sep" aria-hidden="true">|</span>
            <span className="playlist-hero-total" aria-live="polite" title={totalDurationDetail}>{totalClock}</span>
          </p>
          <div className="playlist-hero-actions">
            <IconButton
              className="playlist-hero-icon playlist-hero-shuffle-button"
              icon={shufflePresentation.icon}
              label={shufflePresentation.label}
              selected={shufflePresentation.pressed}
              onClick={handleShuffle}
            />
            <IconButton
              className="playlist-hero-icon playlist-hero-play-button"
              icon={systemIcons.play}
              label={appCopy.playlistPage.play}
              disabled={!playableTrackId || !onTrackSelect}
              pressFeedback
              pressFeedbackTone="surface-variant"
              onClick={handlePlay}
            />
            <Button
              className="playlist-search-button playlist-hero-icon"
              aria-label={appCopy.playlistPage.search}
              aria-pressed={searchOpen}
              data-selected={searchOpen ? 'true' : undefined}
              size="icon"
              variant="ghost"
              onClick={handleSearchToggle}
            >
              <Search aria-hidden="true" />
            </Button>
            <Button
              className="playlist-select-toggle"
              aria-pressed={selectMode}
              data-selected={selectMode ? 'true' : undefined}
              onClick={handleSelectModeToggle}
            >
              {selectMode ? appCopy.playlistPage.done : appCopy.playlistPage.select}
            </Button>
            <IconButton className="playlist-hero-icon playlist-hero-more-button" icon={systemIcons.more} label={appCopy.playlistPage.more} disabled={isOpenAudioDisabled || !onOpenAudio} onClick={handleMore} />
          </div>
        </div>
      </header>

      {searchOpen ? (
        <div className="playlist-filter">
          <Input
            className="playlist-filter-input"
            autoFocus
            value={filter}
            onChange={(event) => {
              clearArtworkWindow()
              setFilter(event.target.value)
            }}
            placeholder={appCopy.playlistPage.filterPlaceholder}
            aria-label={appCopy.playlistPage.filterPlaceholder}
          />
        </div>
      ) : null}

      {selectMode ? (
        <div className="playlist-selection-bar">
          <span className="playlist-selection-count">{appCopy.playlistPage.selected(selectedCount)}</span>
          <Button variant="ghost" size="sm" disabled={selectedCount === 0} onClick={handleClearSelection}>
            {appCopy.playlistPage.clearSelection}
          </Button>
        </div>
      ) : null}

      {filteredTracks.length ? (
        <>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{layoutAnnouncement}</p>
          <div
            ref={gridRef}
            className="playlist-grid"
            data-layout-level={layout.level}
            data-layout-flow={layout.flow}
            data-layout-columns={layout.columns}
            data-cover-motion={appearanceMotion.disabled ? 'off' : undefined}
            style={{ ...layout.style, touchAction: 'pan-y' }}
          >
            {cards}
          </div>
        </>
      ) : (
        <Empty className="playlist-empty">
          <EmptyHeader>
            <EmptyTitle>{appCopy.playlistPage.emptyTitle}</EmptyTitle>
            <EmptyDescription>{appCopy.playlistPage.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      </motion.section>
      <PlaylistPlaybackDock
        playback={playback}
        timeline={timeline}
        visualIsPlaying={visualIsPlaying}
        playbackTransitionPending={playbackTransitionPending}
        playlistTrack={tracks.find((track) => track.id === currentTrackId)}
        onPlayToggle={onPlayToggle}
        searchOpen={searchOpen}
        onSearchToggle={handleSearchToggle}
        onClose={onClose}
      />
    </>
  )
}
