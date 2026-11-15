import { useLibrarySearch } from '../hooks/useLibrarySearch'
import { playlistCardContentShape } from '../model/playlistTrackSummary'
import { useCollectionDetailPresence } from '../hooks/useCollectionDetailPresence'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { PLAYLIST_SONG_LAYOUTS, PLAYLIST_LAYOUT_STORAGE_KEY, defaultPlaylistSongLevel, type PlaylistSongLayoutDescriptor } from '@/features/player/model/playlistSongLayouts'
import { motion, useIsPresent } from 'motion/react'
import { CollectionReturnIcon } from './CollectionReturnIcon'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { getShuffleModePresentation, showPlaybackModeToast } from '@/features/player/components/playbackModePresentation'
import { PlaylistActionButtons } from '@/features/player/components/PlaylistActionButtons'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { PlaylistPlaybackDock } from '@/features/player/components/PlaylistPlaybackDock'
import { PlaylistLibrarySidebar } from '@/features/player/components/PlaylistLibrarySidebar'
import { useCollectionLayout } from '@/features/player/hooks/useCollectionLayout'
import { usePlaylistSongReorder } from '@/features/player/hooks/usePlaylistSongReorder'
import { mergeFilteredSongOrder } from '@/features/player/model/manualSongOrderStorage'
import { CollectionHero } from '@/features/player/components/CollectionHero'
import { PlaylistHeroMoreMenu } from '@/features/player/components/PlaylistHeroMoreMenu'
import { useCollectionHeroMotion, useCollectionHeroVisibility } from '@/features/player/hooks/useCollectionHeroMotion'
import { useHeroTier } from '@/features/player/hooks/useHeroTier'
import { LibraryDockContext, useLibraryDockBinding } from '@/features/player/hooks/useLibraryDockBinding'
import { LibraryChromeTransitionContext } from '@/features/player/hooks/useLibraryChromeTransition'
import { readLibraryLayoutRect } from '@/features/player/model/libraryNavigationGeometry'
import type { PlaylistControllerMode } from '@/features/player/model/playlistControllerMode'
import { appCopy } from '@/features/player/model/playerCopy'
import { orderPlaylistArtworkRows, type PlaylistArtworkDirection } from '@/features/player/model/playlistArtworkOrder'
import type { ShuffleMode } from '@/features/player/model/playbackModes'
import { formatPlaylistDurationLabel, type PlaylistDurationStatus } from '@/features/player/model/playlistDuration'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlayerPlaylistViewModel, PlaylistLibraryViewModel, PlaylistArtworkDemand, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import { heroPlaylistArtworkKey, isHeroArtworkKey, type PlaylistArtworkSnapshot, type PlaylistArtworkSource } from '@/features/player/model/playlistArtworkStore'
import type { PlaylistCoverImage as PlaylistCoverImageResource } from '@/features/player/model/playerUiViewModel'
import type { CoverPresentation } from '@/features/player/model/playlistCoverReadiness'
import type { HeroDisplayLease, HeroLeasePublication } from '@/features/player/components/playlistHeroDisplayLease'

type PlaylistPanelProps = {
  deleteScope?: string | null
  canRemoveFromList?: boolean
  onDeleteSongs?: PlayerPlaylistViewModel['onDeleteSongs']
  onReorderSongs?: PlayerPlaylistViewModel['onReorderSongs']
  onAddToQueue?: PlayerPlaylistViewModel['onAddToQueue']
  onPreparePlaylistAdd?: PlayerPlaylistViewModel['onPreparePlaylistAdd']
  onAddToPlaylist?: PlayerPlaylistViewModel['onAddToPlaylist']
  onRemoveFromPlaylist?: PlayerPlaylistViewModel['onRemoveFromPlaylist']
  onCreateAddPlaylist?: PlayerPlaylistViewModel['onCreateAddPlaylist']
  isDeletePending?: boolean
  controllerMode?: PlaylistControllerMode
  entryPosition?: PlayerPlaylistViewModel['entryPosition']
  library?: PlaylistLibraryViewModel
  tracks: PlaylistTrackItemViewModel[]
  artworkSource?: PlayerPlaylistViewModel['artworkSource']
  fallbackArtworkSource?: PlayerPlaylistViewModel['fallbackArtworkSource']
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
  /**
   * A hero image the display layer is still allowed to show, from a publication
   * that an earlier owner made for this same detail page.
   *
   * Supplied only while an owner handover is in flight (`PlayerSurface` holds it
   * outside this component's remount key, so a `deleteScope` change cannot drop
   * it). `undefined` means "show whatever the current owner published", which is
   * the normal steady state.
   */
  heroLease?: HeroDisplayLease
  /**
   * Identity of the artwork owner currently supplying `artworkSource`.
   *
   * `PlayerShell` swaps the owner *and* the demand callback together when a track
   * click flips `isBrowsingActive`, but the callback this component receives is an
   * identity-stable wrapper (`OwnedPlaylistPanel`), and its own window key does not
   * contain the owner either. Measured before the fix: an owner handover produced
   * neither a demand effect re-run nor a dedupe miss, so the incoming owner never
   * received any demand and its hero lane issued no request at all — the hero stayed
   * at the row preview permanently.
   *
   * Carrying the owner identity into both the effect deps and the dedupe key makes
   * the handover re-report the window, which is what lets the incoming owner take
   * over the hero.
   */
  artworkOwnerKey?: unknown
  /**
   * Report the hero publication this panel is currently subscribed to.
   *
   * The display layer needs the owner's own snapshot — including its token and
   * hero key — to decide whether a held image still describes the page on screen,
   * and to know when the current owner has published and the hold may end. Never
   * called with a row fallback snapshot.
   */
  onHeroPublicationChange?: (publication: HeroLeasePublication | undefined) => void
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

/** What the hero renders, and the lane it came from. */
type HeroArtworkSnapshot = Readonly<{
  image?: PlaylistCoverImageResource
  presentation?: CoverPresentation
  /** `true` when the snapshot came from the hero lane, `false` from the row fallback. */
  heroLane: boolean
  /** Hero key derived from the first row's key. */
  heroKey: string | undefined
  /**
   * The owner's hero publication, and only that.
   *
   * Deliberately absent for the row fallback: a row snapshot carries the row's own
   * token and must never be handed to the display lease as if it were a hero
   * publication (lease §边界: only published hero images may be held).
   */
  publication: HeroLeasePublication | undefined
}>

const NO_HERO_ARTWORK: HeroArtworkSnapshot = {
  heroLane: false, heroKey: undefined, publication: undefined,
}

/**
 * Map an owner identity to a small stable integer.
 *
 * The panel only ever needs to know whether the owner *changed*, and the owner is
 * an opaque object it must not otherwise inspect. A module-level WeakMap keeps the
 * mapping stable across remounts (so a returning owner gets its old id back) and
 * lets collected owners be released with it.
 */
const artworkOwnerIds = new WeakMap<object, number>()
let nextArtworkOwnerId = 0
function artworkOwnerVersion(owner: unknown): number {
  if (owner === undefined || owner === null) return 0
  if (typeof owner !== 'object' && typeof owner !== 'function') return 0
  const key = owner as object
  const existing = artworkOwnerIds.get(key)
  if (existing !== undefined) return existing
  const id = ++nextArtworkOwnerId
  artworkOwnerIds.set(key, id)
  return id
}

/**
 * Subscribe to ONE artwork key and return the owner's own snapshot object.
 *
 * `useSyncExternalStore` compares the snapshot by identity on every read, so the
 * reader must return the owner's stored object rather than a projection. An
 * earlier version built a fresh object per call, which makes React re-render
 * forever. Projection happens in `useMemo` below instead.
 */
function useArtworkKeySnapshot(
  source: PlaylistArtworkSource | undefined,
  key: string | undefined,
): PlaylistArtworkSnapshot | undefined {
  const subscribe = useCallback((listener: () => void) => (
    source && key ? source.store.subscribe(key, listener) : () => {}
  ), [source, key])
  const snapshot = useCallback(() => (
    source && key ? source.store.getSnapshot(key) : undefined
  ), [source, key])
  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}

/**
 * The hero's artwork, and which lane it came from.
 *
 * The hero key is **derived from the row key**, never rebuilt from parts: the
 * first three tuple elements then equal the row's by construction, so this panel
 * cannot compute a hero key the owner would not publish (plan R6).
 *
 * One-way fallback: a hero record is used when it exists, otherwise the same
 * track's row record is rendered. That is how "ordinary rows and the hero may
 * share an already-ready low-tier preview" is expressed, and rows never read the
 * hero — they only have their own key.
 *
 * The `presentation` returned always belongs to the `image` returned, because
 * both come from the same owner snapshot.
 */
function useHeroArtwork(
  source: PlaylistArtworkSource | undefined,
  firstTrackId: string | undefined,
): HeroArtworkSnapshot {
  const rowKey = source && firstTrackId ? source.keyByTrackId.get(firstTrackId) : undefined
  // A caller that already holds a hero key (never expected) would double-append;
  // `isHeroArtworkKey` keeps that from silently producing a 5-tuple.
  const heroKey = rowKey ? (isHeroArtworkKey(rowKey) ? rowKey : heroPlaylistArtworkKey(rowKey)) : undefined
  const hero = useArtworkKeySnapshot(source, heroKey)
  const row = useArtworkKeySnapshot(source, rowKey)
  return useMemo(() => {
    // A hero publication is only a publication when it carries the owner's token:
    // the display lease has to be able to hand that token back to the owner when
    // the element settles, so an untokened snapshot is treated as a row preview.
    const publication: HeroLeasePublication | undefined = hero?.coverThumbnail && hero.presentation && heroKey
      ? {
          heroKey,
          identity: hero.presentation.token.identity,
          image: hero.coverThumbnail,
          presentation: hero.presentation,
        }
      : undefined
    if (hero?.coverThumbnail) {
      return { image: hero.coverThumbnail, presentation: hero.presentation, heroLane: true, heroKey, publication }
    }
    if (row?.coverThumbnail) {
      return { image: row.coverThumbnail, presentation: row.presentation, heroLane: false, heroKey, publication: undefined }
    }
    return { ...NO_HERO_ARTWORK, heroKey }
  }, [hero, row, heroKey])
}

/**
 * Whether a held hero image may still be rendered for the page on screen.
 *
 * The hero key is the whole test: it is derived from the first row's key, so two
 * owners describing the same detail page produce the same one (plan R6). A held
 * image is only ever shown for the key it was published under, which is why the hold
 * cannot leak into another playlist — or into a row, since rows never read this.
 *
 * `currentHeroKey === undefined` means the panel has no first track *at this instant*,
 * not that the page changed: that is exactly what a handover looks like for the frame
 * or two before the incoming owner has rows. Dropping the hold there is what produced
 * a single 256px frame in the middle of the transition, so it must stay.
 */
function useApplicableHeroHold(
  hold: HeroDisplayLease | undefined,
  currentHeroKey: string | undefined,
): HeroDisplayLease | undefined {
  return useMemo(() => (
    hold && (currentHeroKey === undefined || hold.heroKey === currentHeroKey) ? hold : undefined
  ), [hold, currentHeroKey])
}

// Intrinsic line-count shapes cover both tile and extended metadata layouts.
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
// Every layout uses the same validated grid geometry; irregular rows still
// fall back to live measurements instead of assuming a fixed card height.
function buildPlaylistCardIndex(grid: HTMLElement, panel: HTMLElement): PlaylistCardIndex | null {
  if (getComputedStyle(grid).display !== 'grid') return null
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
  deleteScope,
  canRemoveFromList = false,
  onDeleteSongs,
  onReorderSongs,
  onAddToQueue,
  onPreparePlaylistAdd,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreateAddPlaylist,
  isDeletePending = false,
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
  onTrackSelect,
  onVisibleTrackIdsChange,
  artworkSource,
  fallbackArtworkSource,
  heroLease,
  artworkOwnerKey,
  onHeroPublicationChange,
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
  const isPresent = useIsPresent()
  // Stable string id for the current artwork owner. Only its *change* matters, so a
  // WeakMap-based counter keeps this cheap and free of per-render allocation churn.
  const artworkOwnerId = useMemo(
    () => artworkOwnerVersion(artworkOwnerKey),
    [artworkOwnerKey],
  )
  // The hero's tier follows the viewport. Without this the tier is whatever the artwork hook
  // happened to measure when it first seeded its detail paths, so shrinking the window (or
  // dragging to a smaller display) keeps requesting the larger image indefinitely.
  //
  // Gated on presence so an exiting panel stops asking for a high tier.
  const heroTier = useHeroTier(isPresent && !heroOffscreen)
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
  const chromeTransition = useContext(LibraryChromeTransitionContext)
  const publishDetailVisibility = chromeTransition.publishDetailVisibility
  const sharedScope = appearanceMotion.disabled || heroOffscreen ? undefined : library?.currentScope
  const handledEntryPositionIdRef = useRef<number | undefined>(undefined)
  const [selectMode, setSelectMode] = useState(false)
  const [reorderPreviewKeys, setReorderPreviewKeys] = useState<readonly string[] | null>(null)
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
  const reorderHeldIdsRef = useRef(new Set<string>())
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
  const orderedTrackIds = useMemo(() => filteredTrackIdsKey ? filteredTrackIdsKey.split('\u0000') : [], [filteredTrackIdsKey])
  const displayedTracks = useMemo(() => {
    if (!reorderPreviewKeys) return filteredTracks
    const byId = new Map(filteredTracks.map(track => [track.id, track]))
    return reorderPreviewKeys.flatMap(key => { const track = byId.get(key); return track ? [track] : [] })
  }, [filteredTracks, reorderPreviewKeys])
  const firstFilteredTrackId = filteredTracks[0]?.id
  const contentShapes = useMemo(() => new Map(filteredTracks.map(track => [track.id, playlistCardContentShape(track)])), [filteredTracks])
  const { level: layoutLevel, layout, announcement: layoutAnnouncement } = useCollectionLayout({
    panelRef, gridRef, layouts: PLAYLIST_SONG_LAYOUTS, storageKey: PLAYLIST_LAYOUT_STORAGE_KEY,
    defaultLevel: defaultPlaylistSongLevel, selectors: DETAIL_LAYOUT_SELECTORS, gestureArea: 'panel',
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

  const fullReorderKeys = useMemo(() => tracks.map(track => track.id), [tracks])
  const reorderSourceVersion = useMemo(() => JSON.stringify([deleteScope, fullReorderKeys]), [deleteScope, fullReorderKeys])
  const songReorder = usePlaylistSongReorder({
    enabled: selectMode && isPresent && metadataStatus !== 'loading' && !isOpenAudioDisabled && !isDeletePending && Boolean(onReorderSongs && deleteScope),
    scopeKey: deleteScope ?? '', sourceVersion: reorderSourceVersion,
    layoutKey: `${layoutLevel}:${filter}:${searchOpen}`, orderedKeys: orderedTrackIds, selectedKeys: selectedIds,
    gridRef, scrollRef: panelRef,
    onPreview: setReorderPreviewKeys,
    onCommit: async draft => {
      const orderedKeys = mergeFilteredSongOrder(fullReorderKeys, draft.expectedKeys, draft.orderedKeys)
      return orderedKeys && onReorderSongs && deleteScope
        ? onReorderSongs({ scope: deleteScope, expectedKeys: fullReorderKeys, orderedKeys })
        : { ok: false, errorMessage: '列表已更改，请重新拖动排序。' }
    },
    retainArtwork: key => {
      const releases: (() => void)[] = []
      for (const source of [artworkSource, fallbackArtworkSource]) {
        const resourceKey = source?.keyByTrackId.get(key)
        if (source && resourceKey) releases.push(source.store.retain(resourceKey))
      }
      return () => { for (const release of releases.reverse()) release() }
    },
    holdContent: key => {
      reorderHeldIdsRef.current.add(key)
      setArtworkWindowRevision(previous => previous + 1)
      return () => { reorderHeldIdsRef.current.delete(key); setArtworkWindowRevision(previous => previous + 1) }
    },
  })

  const unavailable = useMemo(
    () => unavailableTrackIds ?? new Set<string>(),
    [unavailableTrackIds],
  )
  const totalClock = formatPlaylistDurationLabel({
    status: totalDurationStatus, totalSeconds: totalDurationSeconds,
  }, tracks.length)

  const { controllerMotion, returnTransition } = useCollectionHeroMotion({
    panelRef,
    dockRef: playbackDockRef, mode: controllerMode,
    seeking: selectMode || timeline.interaction === 'seeking' || timeline.interaction === 'previewing',
    layoutKey: `${playlistName}:${layoutLevel}:${filteredTrackIdsKey}:${searchOpen}:${selectMode}`,
    controllerEnabled: Boolean(isPresent && (!dockContext || dockContext.activeRouteKey === dockRouteKey)),
    actionsPassed: controllerActionsVisible,
  })
  const rebaseController = controllerMotion.rebase
  useLayoutEffect(() => { if (selectMode && isPresent) rebaseController({ reveal: true }) }, [selectMode, isPresent, rebaseController])

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
    onTrackSelect?.(trackId, orderedTrackIds)
  }, [onTrackSelect, orderedTrackIds])

  const handleToggleSelect = useCallback((trackId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }, [])

  const handleEnterSelectMode = useCallback((trackId: string) => {
    setSelectMode(true)
    setSelectedIds((previous) => previous.has(trackId) ? previous : new Set(previous).add(trackId))
  }, [])

  const handleSelectModeToggle = useCallback(() => {
    setSelectMode((previous) => {
      if (previous) setSelectedIds(new Set())
      return !previous
    })
  }, [])

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const globalSearch = useLibrarySearch()
  const handleSearchToggle = useCallback(() => {
    if (globalSearch) { globalSearch(); return }
    setSearchOpen((previous) => {
      if (previous) setFilter('')
      return !previous
    })
  }, [globalSearch])
  const selectableTracks = filteredTracks.filter((track) => !unavailable.has(track.id))
  const selectedPlayableTracks = tracks.filter((track) => selectedIds.has(track.id) && !unavailable.has(track.id))
  const allSelected = selectableTracks.length > 0 && selectableTracks.every((track) => selectedIds.has(track.id))
  const dockSelection = {
    scope: deleteScope ?? dockRouteKey,
    active: selectMode, count: selectedIds.size, total: tracks.length, allSelected,
    canSelectAll: selectableTracks.length > 0,
    canPlay: Boolean(onTrackSelect && !isOpenAudioDisabled && selectedPlayableTracks.length),
    canCreatePlaylist: false,
    canDelete: Boolean(onDeleteSongs && selectedIds.size && !isOpenAudioDisabled && !isDeletePending),
    canAddToPlaylist: Boolean(onPreparePlaylistAdd && onAddToPlaylist && selectedIds.size && !isOpenAudioDisabled && !isDeletePending),
    onAddToQueue: () => onAddToQueue?.({ scope: deleteScope ?? null, songKeys: [...selectedIds] }) ?? false,
    onPrepareAddToPlaylist: () => onPreparePlaylistAdd?.({ scope: deleteScope ?? null, songKeys: Object.freeze([...selectedIds]) }),
    onRefreshAddToPlaylist: onPreparePlaylistAdd,
    onAddToPlaylist,
    onRemoveFromPlaylist: onRemoveFromPlaylist ? async (...args: Parameters<NonNullable<PlayerPlaylistViewModel['onRemoveFromPlaylist']>>) => {
      const result = await onRemoveFromPlaylist(...args)
      const [snapshot, targetScope] = args
      if (targetScope === deleteScope) {
        const removedIds = new Set(snapshot.songKeys.filter(id => !result.failedKeys.includes(id)))
        setSelectedIds(previous => new Set([...previous].filter(id => !removedIds.has(id))))
      }
      return result
    } : undefined,
    onCreateAddPlaylist,
    onOpenPlaylistTarget: library?.onSelect,
    onPrepareDelete: () => onDeleteSongs && selectedIds.size ? {
      scope: deleteScope ?? null,
      songKeys: Object.freeze([...selectedIds]), canRemoveFromList,
    } : undefined,
    onDelete: onDeleteSongs ? async (...args: Parameters<NonNullable<PlayerPlaylistViewModel['onDeleteSongs']>>) => {
      const result = await onDeleteSongs(...args)
      setSelectedIds(previous => new Set([...previous].filter(id => !result.succeededKeys.includes(id))))
      return result
    } : undefined,
    onSelectAll: () => setSelectedIds(previous => {
      const next = new Set(previous)
      for (const track of selectableTracks) { if (allSelected) next.delete(track.id); else next.add(track.id) }
      return next
    }),
    onClear: handleClearSelection,
    onExit: () => { setSelectMode(false); setSelectedIds(new Set()) },
    onPlay: () => {
      if (isOpenAudioDisabled || !selectedPlayableTracks.length) return
      onTrackSelect?.(selectedPlayableTracks[0].id, selectedPlayableTracks.map(track => track.id))
    },
  }
  useLibraryDockBinding(dockRouteKey, {
    searchOpen, onSearchToggle: handleSearchToggle,
    controllerOffsetY: controllerMotion.offsetY, controllerHidden: selectMode ? false : controllerMotion.hidden,
    selection: dockSelection,
  })

  const handlePlay = useCallback(() => {
    const target = filteredTracks.find((track) => !unavailable.has(track.id))?.id
    if (!target) return
    onTrackSelect?.(target, filteredTracks.map((track) => track.id))
  }, [onTrackSelect, filteredTracks, unavailable])

  const { sectionControls } = useCollectionDetailPresence(chromeTransition.offscreenReturn, returnTransition, () => {
    entryMotionSettledRef.current = true
    reportEntrySettled()
  })

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


  useCollectionHeroVisibility({ panelRef, artworkRef: heroArtworkRef, actionsRef: heroActionsRef,
    compactActionsRef: controllerActionsRef, present: Boolean(isPresent), heroOffscreen,
    onHeroOffscreen: setHeroOffscreen, onActionsPassed: setControllerActionsVisible,
    visibilityKey: `${currentTrackId}:${filteredTrackIdsKey}:${searchOpen}:${layoutLevel}`,
    routeKey: dockRouteKey, publishDetailVisibility,
  })

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
    let previousScrollTop = panel.scrollTop
    let direction: PlaylistArtworkDirection = 0
    const transformingCards = new Set<EventTarget>()
    const publish = () => {
      frameId = null
      if (disposed) return
      const panelRect = panel.getBoundingClientRect()
      // The translucent playback dock overlays the scrollport; it does not
      // shorten it. Covers behind it remain physical viewport demand so they
      // are ready as the dock moves or a card emerges from underneath it.
      const viewportBottom = panelRect.bottom
      if (indexDirty) {
        cardIndex = buildPlaylistCardIndex(grid, panel)
        indexDirty = false
      }
      const candidates = cardIndex && transformingCards.size === 0
        ? indexedPlaylistCandidates(cardIndex, grid, panel, panelRect.top - panelRect.height, viewportBottom + panelRect.height)
        : null
      if (cardIndex && !candidates && transformingCards.size === 0
        && !grid.querySelector('.playlist-card:active')) indexDirty = true
      const entries = (candidates ?? [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
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
          const side = inViewport ? 0 : rect.bottom <= panelRect.top ? -1 : 1
          return { trackId, domIndex, inViewport, viewportDistance, rowTop: card.offsetTop, side: side as -1 | 0 | 1 }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      const orderedEntries = orderPlaylistArtworkRows(entries, direction)
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
      const heldIds = new Set([...(artworkHoldIdsRef.current ?? []), ...reorderHeldIdsRef.current])
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
      // The hero tier participates in the dedupe key: a tier-only change (same cards, same DPR,
      // smaller viewport) must still reach the artwork pipeline.
      //
      // The owner participates for the same reason: a track click hands the panel to a
      // different artwork owner without changing a single card, a DPR or a tier, and that
      // new owner needs the window or its hero lane never starts.
      const windowKey = `${coverCssPixels}\u0000${dpr}\u0000${heroTier ?? 0}\u0000${artworkOwnerId}\u0000${visibleTrackIds.join('\u0000')}\u0001${orderedIds.join('\u0000')}`
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
        heroEdge: heroTier,
      })
    }
    const schedulePublish = () => {
      if (frameId === null) frameId = requestAnimationFrame(publish)
    }
    const onScroll = () => {
      const top = panel.scrollTop
      const delta = top - previousScrollTop
      if (delta !== 0) direction = delta < 0 ? -1 : 1
      previousScrollTop = top
      schedulePublish()
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
    panel.addEventListener('scroll', onScroll, { passive: true })
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
      panel.removeEventListener('scroll', onScroll)
      grid.removeEventListener('transitionrun', onTransformStart)
      grid.removeEventListener('transitionend', onTransformEnd)
      grid.removeEventListener('transitioncancel', onTransformEnd)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', invalidateIndex)
      resolution.removeEventListener('change', onResolutionChange)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [filteredTrackIdsKey, firstFilteredTrackId, layout.level, layout.showArtwork, metadataStatus, onVisibleTrackIdsChange, artworkOwnerId, artworkWindowRevision, clearArtworkWindow, heroTier])

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

  const firstTrack = tracks[0]
  // The hero has its own publication record, so it reads that record instead of
  // the first row's visual. `firstTrack` is only the *identity* of the track whose
  // cover the hero shows; its `coverThumbnail` is the ordinary row image and is
  // never rendered at hero size (plan §2, invariant: no row record exceeds 256).
  const heroArtwork = useHeroArtwork(artworkSource, firstTrack?.id)
  // Hand the current owner's hero publication up to the display layer, which owns
  // the sticky hold across an owner handover (plan §3). Reported only when it is
  // really a hero publication: a row fallback carries the row's token and must
  // never be held as if the hero had published it.
  const heroPublication = heroArtwork.publication
  useEffect(() => {
    onHeroPublicationChange?.(heroPublication)
  }, [heroPublication, onHeroPublicationChange])
  useLayoutEffect(() => () => onHeroPublicationChange?.(undefined), [onHeroPublicationChange])
  // What the hero actually renders.
  //
  // Precedence is: the owner's own hero publication, then a hold from a previous
  // owner, then the owner's ordinary row preview. The row preview is last on purpose:
  // it is the 256px card image, so letting it win would reintroduce exactly the
  // downgrade the hold exists to cover — and it does win for a frame or two on every
  // handover, because the incoming owner publishes rows long before its hero tier
  // arrives. Only the hold's own hero key may be substituted, and only when it
  // describes the page on screen.
  const heldHero = useApplicableHeroHold(heroLease, heroArtwork.heroKey)
  const heroImage = heroArtwork.heroLane ? heroArtwork.image : (heldHero ?? heroArtwork).image
  const heroPresentation = heroArtwork.heroLane ? heroArtwork.presentation : (heldHero ?? heroArtwork).presentation
  // The hero and menu covers are the only surfaces that render `firstTrack`'s
  // snapshot directly instead of reading a card's artwork store, so they have to
  // hand the element the owner's published token themselves.
  //
  // A token is only ever paired with the image it actually names. `heroImage` and
  // `heroPresentation` come from one snapshot, so `firstTrack.presentation`
  // is deliberately not consulted here: it belongs to the row publication.
  // `firstTrackCoverSource` stays as the last link of the fallback chain.
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
  const cards = useMemo(() => displayedTracks.map((track, index) => (
    <PlaylistCard
      key={track.id}
      track={track}
      artworkSource={artworkSource}
      fallbackArtworkSource={fallbackArtworkSource}
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
      // Deliberately independent of presence. `useIsPresent` flips on the exact
      // frame this panel starts leaving AnimatePresence, so routing it through
      // this prop invalidated the memo on every one of N cards and made exit
      // animation start with a full-list reconciliation. Long-press during exit
      // is still impossible: the section is `inert` while `!isPresent`.
      onEnterSelectMode={handleEnterSelectMode}
    />
  )), [displayedTracks, artworkSource, fallbackArtworkSource, currentTrackId, unavailable, onTrackSelect, selectMode, selectedIds,
    artworkWindowIds, showExtendedMetadata, handleActivate, handleToggleSelect, handleEnterSelectMode,
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
        data-selection-hidden={selectMode || undefined}
        aria-hidden={selectMode || compact && (!controllerActionsVisible || !isPresent) ? true : undefined}
        inert={selectMode || compact && (!controllerActionsVisible || !isPresent) ? true : undefined}
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
          more={<PlaylistHeroMoreMenu title={playlistName ?? appCopy.playlistPage.title} count={tracks.length} totalClock={totalClock} durationDetail={totalDurationDetail}
            artwork={heroImage ? <PlaylistCoverImage image={heroImage} presentation={heroPresentation} />
              : firstTrackCoverSource ? <img src={firstTrackCoverSource} alt="" decoding="async" onError={handleHeroCoverError} /> : null} />}
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
      <CollectionHero artworkRef={heroArtworkRef} localProjection={heroOffscreen}
        artworkLayoutId={sharedScope ? `playlist-library-cover:${sharedScope}` : undefined}
        titleLayoutId={sharedScope ? `playlist-library-name:${sharedScope}` : undefined}
        transition={returnTransition}
        artwork={heroImage ? <PlaylistCoverImage className="playlist-hero-image" image={heroImage}
          presentation={heroPresentation} />
          : firstTrackCoverSource ? <img className="playlist-hero-image" src={firstTrackCoverSource} alt="" aria-hidden="true" decoding="async" onError={handleHeroCoverError} /> : null}
        category={<Button type="button" className="playlist-hero-category" size="sm" variant="ghost" aria-current="page"
          aria-label={library ? "返回播放列表管理" : undefined} onClick={library?.onOpen ?? (() => panelRef.current?.focus({ preventScroll: true }))}>
          <CollectionReturnIcon data-icon="inline-start" aria-hidden="true" />{appCopy.playlistPage.title}
        </Button>}
        close={<button type="button" className="playlist-close" aria-label={library ? "返回播放列表管理" : appCopy.playlistPage.close} onClick={library?.onOpen ?? onClose}><systemIcons.close /></button>}
        title={playlistName ?? appCopy.playlistPage.title}
        metadata={<p className="playlist-hero-meta"><systemIcons.music aria-hidden="true" />
          <span className="playlist-hero-count" aria-label={appCopy.playlistPage.count(tracks.length)}>{tracks.length}</span>
          <span className="playlist-hero-meta-sep" aria-hidden="true">|</span>
          <span className="playlist-hero-total" aria-live="polite" title={totalDurationDetail}>{totalClock}</span></p>}
        actions={renderPlaylistActions()} />

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



      {metadataStatus === 'loading' ? (
        <PlaylistMetadataLoading layout={layout} trackCount={tracks.length} />
      ) : filteredTracks.length ? (
        <>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{layoutAnnouncement}</p>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{songReorder.announcement}</p>
          <div
            ref={gridRef}
            className="playlist-grid"
            onPointerDownCapture={songReorder.onPointerDownCapture}
            onClickCapture={songReorder.onClickCapture}
            onKeyDownCapture={songReorder.onKeyDownCapture}
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
        controllerHidden={selectMode ? false : controllerMotion.hidden}
        selection={dockSelection}
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
        onHome={searchOpen ? handleSearchToggle : library?.onOpenOverview}
        homeSelected={!searchOpen}
      /> : null}
    </>
  )
}
