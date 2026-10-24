import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { PLAYLIST_SONG_LAYOUTS, PLAYLIST_LAYOUT_STORAGE_KEY, defaultPlaylistSongLevel, type PlaylistSongLayoutDescriptor } from '@/features/player/model/playlistSongLayouts'
import { motion, useAnimationControls, usePresence } from 'motion/react'
import { CornerLeftUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { getShuffleModePresentation, showPlaybackModeToast } from '@/features/player/components/playbackModePresentation'
import { PlaylistActionButtons } from '@/features/player/components/PlaylistActionButtons'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { PlaylistPlaybackDock } from '@/features/player/components/PlaylistPlaybackDock'
import { PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { usePlaylistOverscroll } from '@/features/player/hooks/usePlaylistOverscroll'
import { usePlaylistControllerMotion } from '@/features/player/hooks/usePlaylistControllerMotion'
import { LibraryDockContext, useLibraryDockBinding } from '@/features/player/hooks/useLibraryDockBinding'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { readLibraryLayoutRect } from '@/features/player/model/libraryNavigationGeometry'
import type { PlaylistControllerMode } from '@/features/player/model/playlistControllerMode'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ShuffleMode } from '@/features/player/model/playbackModes'
import { formatPlaylistDurationLabel, type PlaylistDurationStatus } from '@/features/player/model/playlistDuration'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlayerPlaylistViewModel, PlaylistLibraryViewModel, PlaylistArtworkDemand, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

type PlaylistPanelProps = {
  controllerMode?: PlaylistControllerMode
  entryPosition?: PlayerPlaylistViewModel['entryPosition']
  library?: PlaylistLibraryViewModel
  tracks: PlaylistTrackItemViewModel[]
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  metadataStatus?: PlayerPlaylistViewModel['metadataStatus']
  currentTrackId?: string | null
  totalDurationSeconds?: number
  totalDurationStatus?: PlaylistDurationStatus
  totalDurationDetail?: string
  shuffleMode: ShuffleMode
  onShuffleCycle: () => void
  onShufflePlay?: PlayerPlaylistViewModel['onShufflePlay']
  isOpenAudioDisabled?: boolean
  onOpenAudio?: () => void
  onTrackSelect?: (trackId: string, orderedTrackIds?: readonly string[]) => void
  onVisibleTrackIdsChange?: (trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean, demand?: PlaylistArtworkDemand) => void
  onEntrySettled?: () => void
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  onPlayToggle: () => void
  onClose: () => void
  librarySidebarOpen?: boolean
  onLibrarySidebarOpenChange?: (open: boolean) => void
  searchRequestId?: number
}

const DETAIL_LAYOUT_SELECTORS = {
  item: '[data-playlist-track-id]', cover: '.playlist-card-cover', copy: '.playlist-card-copy',
  getId: (element: HTMLElement) => element.dataset.playlistTrackId,
}

// Intrinsic line-count shapes cover both tile and extended metadata layouts.
function playlistCardContentShape(track: PlaylistTrackItemViewModel): number {
  const clock = Number.isFinite(track.durationSeconds) && (track.durationSeconds ?? 0) > 0
  const bitDepth = track.audioFormat?.bitDepth
  const format = clock || Boolean(track.fileExtension) || (Number.isFinite(bitDepth) && (bitDepth ?? 0) >= 24)
  return Number(Boolean(track.title)) | (Number(Boolean(track.artist)) << 1)
    | (Number(Boolean(track.artist || track.album)) << 2) | (Number(format) << 3)
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

// The list's real tags are not known yet. Show the shape of the list instead of
// any song text: a fabricated title, artist or album is indistinguishable from a
// real answer once the summary lands, and the hero already shows the true
// playlist name, song count and total duration.
export function PlaylistMetadataLoading({
  layout,
  trackCount,
}: {
  layout: PlaylistSongLayoutDescriptor
  trackCount: number
}) {
  const placeholderCount = layout.flow === 'tile'
    ? Math.min(12, Math.max(2, layout.columns * 3))
    : 8
  return (
    <div
      className="playlist-loading"
      data-layout-flow={layout.flow}
      data-layout-columns={layout.columns}
      style={layout.style}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="playlist-loading-label">
        <span>{appCopy.playlistPage.loadingMetadata}</span>
        {trackCount > 0 ? (
          <span className="playlist-loading-count">{appCopy.playlistPage.count(trackCount)}</span>
        ) : null}
      </p>
      <div className="playlist-loading-grid" aria-hidden="true">
        {Array.from({ length: placeholderCount }, (_, index) => (
          <div className="playlist-loading-card" key={index}>
            {layout.showArtwork ? <span className="playlist-loading-cover" /> : null}
            <span className="playlist-loading-line" />
            <span className="playlist-loading-line playlist-loading-line-short" />
            {layout.flow !== 'tile' ? (
              <span className="playlist-loading-line playlist-loading-line-shortest" />
            ) : null}
          </div>
        ))}
      </div>
      <span className="sr-only">{appCopy.playlistPage.loadingMetadataDescription}</span>
    </div>
  )
}

export function PlaylistPanel({
  controllerMode = 'movable',
  entryPosition,
  library,
  tracks,
  unavailableTrackIds,
  playlistName,
  metadataStatus = 'ready',
  currentTrackId,
  totalDurationSeconds,
  totalDurationStatus,
  totalDurationDetail,
  onShufflePlay,
  isOpenAudioDisabled,
  onOpenAudio,
  onTrackSelect,
  onVisibleTrackIdsChange,
  onEntrySettled,
  playback,
  timeline,
  visualIsPlaying,
  playbackTransitionPending,
  onPlayToggle,
  onClose,
  librarySidebarOpen = false,
  onLibrarySidebarOpenChange,
  searchRequestId = 0,
}: PlaylistPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  // Motion registers shared nodes at mount. Mode-specific keys below unmount
  // those nodes while their layoutId still identifies the old projection stack.
  const [heroOffscreen, setHeroOffscreen] = useState(false)
  const [isPresent, safeToRemove] = usePresence()
  const safeToRemoveRef = useRef(safeToRemove)
  useLayoutEffect(() => { safeToRemoveRef.current = safeToRemove }, [safeToRemove])
  const onEntrySettledRef = useRef(onEntrySettled)
  useLayoutEffect(() => { onEntrySettledRef.current = onEntrySettled }, [onEntrySettled])
  const entryMotionSettledRef = useRef(false)
  const entrySettledReportedRef = useRef(false)
  const metadataStatusRef = useRef(metadataStatus)
  useLayoutEffect(() => { metadataStatusRef.current = metadataStatus }, [metadataStatus])
  const reportEntrySettled = useCallback(() => {
    if (!entryMotionSettledRef.current || entrySettledReportedRef.current || metadataStatusRef.current === 'loading') return
    entrySettledReportedRef.current = true
    onEntrySettledRef.current?.()
  }, [])
  useEffect(() => {
    if (isPresent && metadataStatus !== 'loading') reportEntrySettled()
  }, [isPresent, metadataStatus, reportEntrySettled])
  const sectionControls = useAnimationControls()
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const publishDetailVisibility = chromeTransition.publishDetailVisibility
  // Use a 250ms default, preserving theme scaling and the presence cleanup budget.
  const returnTransition = useMemo(() => ({ ...appearanceMotion.layoutTransition, duration: Math.min((appearanceMotion.layoutTransition.duration ?? 0) * (5 / 6), 0.55) }), [appearanceMotion.layoutTransition])
  const sharedScope = appearanceMotion.disabled || heroOffscreen ? undefined : library?.currentScope
  const handledEntryPositionIdRef = useRef<number | undefined>(undefined)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [handledSearchRequestId, setHandledSearchRequestId] = useState(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // A request can arrive before this animated panel mounts. Apply it on render
  // so the input exists when the layout effect focuses it, without a timer.
  if (searchRequestId !== handledSearchRequestId) {
    setHandledSearchRequestId(searchRequestId)
    if (searchRequestId > 0) setSearchOpen(true)
  }
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
  const heroArtworkRef = useRef<HTMLDivElement | null>(null)
  const localPlaybackDockRef = useRef<HTMLElement | null>(null)
  const dockContext = useContext(LibraryDockContext)
  const playbackDockRef = dockContext?.dockRef ?? localPlaybackDockRef
  const dockRouteKey = `tracks:${library?.currentScope ?? ''}`
  const heroActionsRef = useRef<HTMLDivElement | null>(null)
  const controllerActionsRef = useRef<HTMLDivElement | null>(null)
  const [controllerActionsVisible, setControllerActionsVisible] = useState(false)
  const focusedSearchRequestIdRef = useRef(0)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const initialPositionAppliedRef = useRef(false)
  const artworkHoldIdsRef = useRef<ReadonlySet<string> | null>(null)
  const artworkWindowIdsRef = useRef<ReadonlySet<string>>(new Set())
  const artworkWindowKeyRef = useRef('')
  const metadataWindowKeyRef = useRef<string | null>(null)
  const loadingWindowKeyRef = useRef<string | null>(null)
  const [failedCoverSources, setFailedCoverSources] = useState<ReadonlyMap<string, string>>(() => new Map())
  const handleCoverFailed = useCallback((trackId: string, source: string) => {
    setFailedCoverSources(previous => previous.get(trackId) === source ? previous : new Map(previous).set(trackId, source))
  }, [])
  const query = filter.trim().toLowerCase()
  const filteredTracks = useMemo(() => {
    if (!query) return tracks
    return tracks.filter((track) => track.title.toLowerCase().includes(query)
      || track.artist.toLowerCase().includes(query) || track.album.toLowerCase().includes(query))
  }, [query, tracks])
  const filteredTrackIdsKey = useMemo(() => filteredTracks.map(track => track.id).join('\u0000'), [filteredTracks])
  const firstFilteredTrackId = filteredTracks[0]?.id
  const contentShapes = useMemo(() => new Map(filteredTracks.map(track => [track.id, playlistCardContentShape(track)])), [filteredTracks])
  const { level: layoutLevel, layout, announcement: layoutAnnouncement } = useCollectionLayout({
    panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS, storageKey: PLAYLIST_LAYOUT_STORAGE_KEY,
    defaultLevel: defaultPlaylistSongLevel, selectors: DETAIL_LAYOUT_SELECTORS,
    announce: (nextLayout) => `歌曲视图已切换为${nextLayout.label}`,
    onBeforeTransition: (snapshot, grid) => {
      artworkHoldIdsRef.current = snapshot ? new Set(
        [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')].flatMap((card) => {
          const trackId = card.dataset.playlistTrackId
          const image = card.querySelector<HTMLImageElement>('.playlist-card-cover-image')
          return trackId && snapshot.get(trackId)?.cover && image?.complete && image.naturalWidth > 0
            && image.src.startsWith('blob:') ? [trackId] : []
        }),
      ) : null
    },
    onSettled: () => { artworkHoldIdsRef.current = null; setArtworkWindowRevision((previous) => previous + 1) },
  })

  const unavailable = useMemo(
    () => unavailableTrackIds ?? new Set<string>(),
    [unavailableTrackIds],
  )
  const totalClock = formatPlaylistDurationLabel({
    status: totalDurationStatus, totalSeconds: totalDurationSeconds,
  }, tracks.length)

  usePlaylistOverscroll(panelRef, appearanceMotion.disabled, `${playlistName}:${layoutLevel}:${filteredTrackIdsKey}:${searchOpen}:${selectMode}`)
  const controllerMotion = usePlaylistControllerMotion(
    panelRef,
    playbackDockRef,
    controllerMode,
    timeline.interaction === 'seeking' || timeline.interaction === 'previewing',
    `${playlistName}:${layoutLevel}:${filteredTrackIdsKey}:${searchOpen}:${selectMode}`,
    controllerActionsVisible,
    appearanceMotion.layoutTransition,
    isPresent && (!dockContext || dockContext.activeRouteKey === dockRouteKey),
  )
  const rebaseController = controllerMotion.rebase

  const clearArtworkWindow = useCallback(() => {
    if (artworkWindowIdsRef.current.size === 0) return
    const emptyWindow = new Set<string>()
    artworkWindowIdsRef.current = emptyWindow
    artworkWindowKeyRef.current = ''
    setArtworkWindowIds(emptyWindow)
  }, [])

  // The player owns the bounded artwork window. Closing this temporary view
  // must not revoke its covers; playlist replacement/player disposal do that.

  const handleActivate = useCallback((trackId: string) => {
    onTrackSelect?.(trackId, filteredTracks.map((track) => track.id))
  }, [onTrackSelect, filteredTracks])

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
  useLibraryDockBinding(dockRouteKey, {
    searchOpen, onSearchToggle: handleSearchToggle,
    controllerOffsetY: controllerMotion.offsetY, controllerHidden: controllerMotion.hidden,
  })

  const handlePlay = useCallback(() => {
    const target = filteredTracks.find((track) => !unavailable.has(track.id))?.id
    if (!target) return
    onTrackSelect?.(target, filteredTracks.map((track) => track.id))
  }, [onTrackSelect, filteredTracks, unavailable])

  useLayoutEffect(() => {
    let cancelled = false
    const resting = { opacity: 1, x: 0, y: 0, scale: 1 }
    if (isPresent) {
      void sectionControls.start(resting, returnTransition).then(() => {
        if (cancelled) return
        entryMotionSettledRef.current = true
        reportEntrySettled()
      })
    } else if (appearanceMotion.disabled) {
      sectionControls.set(resting)
      safeToRemoveRef.current?.()
    } else {
      const leave = () => {
        if (cancelled) return
        const pose = { opacity: 0, x: 0, y: 0, scale: 1 }
        void sectionControls.start(chromeTransition.offscreenReturn ? 'exit' : pose,
          chromeTransition.offscreenReturn ? appearanceMotion.libraryNavigation.transition : returnTransition).then(() => {
          if (!cancelled) safeToRemoveRef.current?.()
        })
      }
      leave()
    }
    return () => {
      cancelled = true
      sectionControls.stop()
    }
  }, [isPresent, appearanceMotion.disabled, appearanceMotion.libraryNavigation.transition,
    chromeTransition.offscreenReturn, reportEntrySettled, returnTransition, sectionControls])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (entryPosition && handledEntryPositionIdRef.current !== entryPosition.requestId) {
      handledEntryPositionIdRef.current = entryPosition.requestId
      initialPositionAppliedRef.current = false
      if (entryPosition.target === 'top') {
        panel.scrollTo({ top: 0, behavior: 'instant' })
        rebaseController({ reveal: true })
        initialPositionAppliedRef.current = true
        return
      }
    }
    if (initialPositionAppliedRef.current || !currentTrackId) return
    const grid = gridRef.current
    if (!grid) return
    const currentCard = [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
      .find((card) => card.dataset.playlistTrackId === currentTrackId)
    if (!currentCard) return
    const panelRect = panel.getBoundingClientRect()
    const cardRect = currentCard.getBoundingClientRect()
    panel.scrollTop += cardRect.top - panelRect.top - (panel.clientHeight - cardRect.height) / 2
    rebaseController({ reveal: true })
    initialPositionAppliedRef.current = true
  }, [currentTrackId, filteredTrackIdsKey, entryPosition, metadataStatus, rebaseController])

  useLayoutEffect(() => {
    if (!searchOpen || searchRequestId <= 0 || focusedSearchRequestIdRef.current === searchRequestId) return
    const panel = panelRef.current
    const input = searchInputRef.current
    if (!panel || !input) return
    focusedSearchRequestIdRef.current = searchRequestId
    // An explicit search request wins over initial current-track positioning.
    // Consume each request once so ordinary search-button toggles keep their behavior.
    initialPositionAppliedRef.current = true
    panel.scrollTo({ top: 0, behavior: 'instant' })
    input.focus({ preventScroll: true })
    rebaseController({ reveal: true })
  }, [searchOpen, searchRequestId, rebaseController])

  useLayoutEffect(() => {
    rebaseController({ reveal: true })
  }, [playlistName, rebaseController])

  useLayoutEffect(() => {
    rebaseController()
  }, [layoutLevel, filteredTrackIdsKey, searchOpen, selectMode, rebaseController])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const heroActions = heroActionsRef.current
    const heroArtwork = heroArtworkRef.current
    if (!panel || !heroActions || !heroArtwork || !isPresent) return
    let disposed = false

    const measureVisibility = () => {
      if (disposed) return
      const heroRect = heroActions.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const offscreen = heroArtwork.getBoundingClientRect().bottom <= Math.max(0, panelRect.top + panel.clientTop)
      setHeroOffscreen(offscreen)
      publishDetailVisibility?.(dockRouteKey, offscreen)
      // A row below the viewport (for example in a short window) must not
      // summon its duplicate. Only a fully scrolled-past upper edge does.
      const visible = heroRect.height > 0 && heroRect.bottom <= Math.max(0, panelRect.top)
      if (!visible) {
        const compact = controllerActionsRef.current
        const focused = document.activeElement
        if (compact && focused instanceof HTMLElement && compact.contains(focused)) {
          const buttons = [...compact.querySelectorAll('button')]
          const index = buttons.indexOf(focused as HTMLButtonElement)
          const target = index > 0 ? heroActions.querySelectorAll('button')[index - 1] : null
          if (target && !target.disabled) target.focus({ preventScroll: true })
          else panel.focus({ preventScroll: true })
        }
      }
      setControllerActionsVisible((previous) => previous === visible ? previous : visible)
    }

    // Run after the current-song/search positioning layout effects above so
    // reopening a scrolled playlist starts in the correct state before paint.
    measureVisibility()
    const observer = new IntersectionObserver(measureVisibility, { root: panel, threshold: 0 })
    observer.observe(heroActions)
    observer.observe(heroArtwork)
    const resizeObserver = new ResizeObserver(measureVisibility)
    resizeObserver.observe(panel)
    resizeObserver.observe(heroActions)
    window.addEventListener('resize', measureVisibility)
    return () => {
      disposed = true
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', measureVisibility)
    }
  }, [currentTrackId, filteredTrackIdsKey, searchOpen, layoutLevel, isPresent, heroOffscreen,
    publishDetailVisibility, dockRouteKey])

  useEffect(() => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!panel || !onVisibleTrackIdsChange) return
    // While the tag summary is still loading the grid is not mounted. Publishing
    // an empty window here would drop the persistent hero/dock leases, so only
    // the leading row is reported and no stale card window is claimed.
    if (metadataStatus === 'loading') {
      const loadingIds = firstFilteredTrackId ? [firstFilteredTrackId] : []
      const loadingKey = `\u0003loading\u0000${loadingIds.join('\u0000')}\u0000${layout.showArtwork}`
      if (loadingWindowKeyRef.current === loadingKey) return
      loadingWindowKeyRef.current = loadingKey
      // Both reported-window keys are invalidated exactly once, so the grid
      // republishes its real window as soon as the rows exist.
      invalidateReportedWindows()
      onVisibleTrackIdsChange(loadingIds, true, layout.showArtwork)
      return
    }
    loadingWindowKeyRef.current = null
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
    // Hoisted so the loading branch above can reset both reported keys even
    // though their normal values are produced by card geometry further down.
    function invalidateReportedWindows() {
      artworkWindowKeyRef.current = ''
      metadataWindowKeyRef.current = null
    }
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
  }, [filteredTrackIdsKey, firstFilteredTrackId, layout.level, layout.showArtwork, metadataStatus, onVisibleTrackIdsChange, artworkWindowRevision, clearArtworkWindow])

  const playableTrackId = filteredTracks.find((track) => !unavailable.has(track.id))?.id
  const shuffleTracks = useMemo(() => filteredTracks.filter((track) => !unavailable.has(track.id)
    && (!selectMode || selectedIds.has(track.id))), [filteredTracks, unavailable, selectMode, selectedIds])

  const handleShuffle = useCallback(async () => {
    if (isOpenAudioDisabled || metadataStatus === 'loading' || !onShufflePlay || !shuffleTracks.length) return
    const succeeded = await onShufflePlay(shuffleTracks.map((track) => track.id))
    if (succeeded) showPlaybackModeToast({ ...getShuffleModePresentation('shuffle-all', systemIcons),
      label: `${appCopy.controls.shuffle} · ${appCopy.controls.playAllCategories}` }, { replay: true })
  }, [onShufflePlay, systemIcons, shuffleTracks, isOpenAudioDisabled, metadataStatus])

  const shufflePresentation = getShuffleModePresentation('shuffle-all', systemIcons)

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
      // Text and duration are prepared before this grid mounts. Keep them in
      // every card's first DOM frame; only the artwork window remains lazy.
      contentVisible
      contentRepresentative={false}
      contentShape={contentShapes.get(track.id)!}
      coverFailed={failedCoverSources.get(track.id) === `${track.coverImage ?? track.coverImageFallback}\0${track.coverImageFallback ?? ''}`}
      onCoverFailed={handleCoverFailed}
      onActivate={handleActivate}
      onToggleSelect={handleToggleSelect}
    />
  )), [filteredTracks, currentTrackId, unavailable, onTrackSelect, selectMode, selectedIds,
    artworkWindowIds, showExtendedMetadata, handleActivate, handleToggleSelect,
    contentShapes, failedCoverSources, handleCoverFailed])

  function renderPlaylistActions(compact = false) {
    const returning = compact && !isPresent && chromeTransition.offscreenReturn && controllerActionsVisible
    const returnGeometry = () => {
      const panel = panelRef.current
      const actions = controllerActionsRef.current
      if (!panel || !actions) return { width: 0, originX: 0, originY: 0 }
      const source = readLibraryLayoutRect(panel)
      const controls = readLibraryLayoutRect(actions)
      return { width: source.width, originX: source.x + source.width / 2 - controls.x,
        originY: source.y + source.height / 2 - controls.y - controllerMotion.offsetY.get() }
    }
    return (
      <motion.div
        key={compact ? 'controller-actions' : heroOffscreen ? 'hero-actions-local' : 'hero-actions-shared'}
        ref={compact ? controllerActionsRef : heroActionsRef}
        className={compact ? "playlist-hero-actions playlist-controller-actions" : "playlist-hero-actions"}
        layout={compact || heroOffscreen ? undefined : 'position'}
        layoutId={!compact && sharedScope ? `playlist-library-actions:${sharedScope}` : undefined}
        role="group"
        aria-label="播放列表操作"
        aria-hidden={compact && (!controllerActionsVisible || !isPresent) ? true : undefined}
        inert={compact && (!controllerActionsVisible || !isPresent) ? true : undefined}
        data-actions-visible={compact ? String(controllerActionsVisible && isPresent) : undefined}
        custom={compact ? returnGeometry : undefined}
        variants={compact ? { ...appearanceMotion.variants.controllerActions,
          ...appearanceMotion.libraryNavigation.detailReturn.controllerOutgoing } : undefined}
        initial={compact ? 'hidden' : false}
        animate={compact ? returning ? 'exit' : controllerActionsVisible && isPresent ? 'visible' : 'hidden' : undefined}
        transition={compact ? returning ? appearanceMotion.libraryNavigation.transition : appearanceMotion.layoutTransition : { layout: returnTransition }}
        style={compact ? { y: controllerMotion.offsetY } : undefined}
      >
        <PlaylistActionButtons
          compact={compact}
          onBack={compact ? library?.onOpen ?? (() => panelRef.current?.focus({ preventScroll: true })) : undefined}
          shuffle={shufflePresentation} onShuffle={handleShuffle}
          shuffleDisabled={!shuffleTracks.length || !onShufflePlay || isOpenAudioDisabled || metadataStatus === 'loading'}
          onPlay={handlePlay} playDisabled={!playableTrackId || !onTrackSelect} playbackLocked={isOpenAudioDisabled}
          searchOpen={searchOpen} onSearch={handleSearchToggle}
          selectMode={selectMode} onSelect={handleSelectModeToggle}
          more={<IconButton className="playlist-hero-icon playlist-hero-more-button" icon={systemIcons.more} label={appCopy.playlistPage.more} data-playback-command-lock={isOpenAudioDisabled || undefined} disabled={isOpenAudioDisabled || !onOpenAudio} onClick={handleMore} />}
        />
      </motion.div>
    )
  }

  return (
    <>
      <PlaylistLibrarySidebar
        library={library}
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
            library={library ? { ...library, onSelectCategory: (categoryId) => { onLibrarySidebarOpenChange?.(false); library.onSelectCategory?.(categoryId) }, onOpen: () => { onLibrarySidebarOpenChange?.(false); library.onOpen() }, onSelect: (scope) => { onLibrarySidebarOpenChange?.(false); library.onSelect(scope) } } : undefined}
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
        data-metadata-loading={metadataStatus === 'loading' || undefined}
        data-select-mode={selectMode ? 'true' : undefined}
        variants={chromeTransition.offscreenReturn ? appearanceMotion.libraryNavigation.detailReturn.outgoing : appearanceMotion.variants.backdrop}
        transition={returnTransition}
        initial="initial"
        animate={sectionControls}
        style={{ zIndex: !isPresent && chromeTransition.offscreenReturn ? 31 : undefined }}
        inert={!isPresent || undefined}
        aria-hidden={!isPresent || undefined}
        aria-label={appCopy.playlistPage.title}
        tabIndex={-1}
      >
      <header className="playlist-hero">
        <motion.div key={heroOffscreen ? 'hero-artwork-local' : 'hero-artwork-shared'} ref={heroArtworkRef} className="playlist-hero-artwork" aria-hidden="true"
          layoutId={sharedScope ? `playlist-library-cover:${sharedScope}` : undefined}
          layoutCrossfade={false}
          transition={{ layout: returnTransition }}>
          {firstTrack?.coverThumbnail ? (
            <PlaylistCoverImage className="playlist-hero-image" image={firstTrack.coverThumbnail} />
          ) : firstTrackCoverSource ? (
            <img className="playlist-hero-image" src={firstTrackCoverSource} alt="" aria-hidden="true" decoding="async" onError={handleHeroCoverError} />
          ) : null}
        </motion.div>
        <Button
          type="button"
          className="playlist-hero-category"
          size="sm"
          variant="ghost"
          aria-current="page"
          aria-label={library ? "返回播放列表管理" : undefined}
          onClick={library?.onOpen ?? (() => panelRef.current?.focus({ preventScroll: true }))}
        >
          <CornerLeftUp data-icon="inline-start" aria-hidden="true" />
          {appCopy.playlistPage.title}
        </Button>
        <button type="button" className="playlist-close" aria-label={library ? "返回播放列表管理" : appCopy.playlistPage.close} onClick={library?.onOpen ?? onClose}>
          <systemIcons.close />
        </button>
        <div className="playlist-hero-copy">
          <motion.h1 className="playlist-hero-title"
            key={heroOffscreen ? 'hero-title-local' : 'hero-title-shared'}
            layout={heroOffscreen ? undefined : 'position'}
            layoutId={sharedScope ? `playlist-library-name:${sharedScope}` : undefined}
            transition={{ layout: returnTransition }}>{playlistName ?? appCopy.playlistPage.title}</motion.h1>
          <p className="playlist-hero-meta">
            <systemIcons.music aria-hidden="true" />
            <span className="playlist-hero-count" aria-label={appCopy.playlistPage.count(tracks.length)}>{tracks.length}</span>
            <span className="playlist-hero-meta-sep" aria-hidden="true">|</span>
            <span className="playlist-hero-total" aria-live="polite" title={totalDurationDetail}>{totalClock}</span>
          </p>
          {renderPlaylistActions()}
        </div>
      </header>

      {searchOpen ? (
        <div className="playlist-filter">
          <Input
            ref={searchInputRef}
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

      {metadataStatus === 'loading' ? (
        <PlaylistMetadataLoading layout={layout} trackCount={tracks.length} />
      ) : filteredTracks.length ? (
        <>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{layoutAnnouncement}</p>
          <div
            ref={gridRef}
            className="playlist-grid"
            data-content-window="full"
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
      {renderPlaylistActions(true)}
      {!dockContext ? <PlaylistPlaybackDock
        controllerRef={playbackDockRef}
        controllerOffsetY={controllerMotion.offsetY}
        controllerHidden={controllerMotion.hidden}
        playback={playback}
        timeline={timeline}
        visualIsPlaying={visualIsPlaying}
        playbackTransitionPending={playbackTransitionPending}
        playlistTracks={tracks}
        playlistTrack={tracks.find((track) => track.id === currentTrackId)}
        onPlayToggle={onPlayToggle}
        searchOpen={searchOpen}
        onSearchToggle={handleSearchToggle}
        onClose={onClose}
      /> : null}
    </>
  )
}
