import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { motion } from 'motion/react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { PlaylistPlaybackDock } from '@/features/player/components/PlaylistPlaybackDock'
import { coverToneForTrackId } from '@/features/player/model/audioTrackModel'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ShuffleMode } from '@/features/player/model/playbackModes'
import type { PlayerPlaybackViewModel, PlayerTimelineViewModel, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

type PlaylistPanelProps = {
  tracks: PlaylistTrackItemViewModel[]
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  currentTrackId?: string | null
  totalDurationSeconds?: number
  shuffleMode: ShuffleMode
  onShuffleCycle: () => void
  isOpenAudioDisabled?: boolean
  onOpenAudio?: () => void
  onTrackSelect?: (trackId: string) => void
  onVisibleTrackIdsChange?: (trackIds: readonly string[], keepPersistentArtwork?: boolean, showArtwork?: boolean) => void
  playback: PlayerPlaybackViewModel
  timeline: PlayerTimelineViewModel
  visualIsPlaying: boolean
  playbackTransitionPending: boolean
  onPlayToggle: () => void
  onClose: () => void
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
  { level: 1, label: '三列封面视图', columns: 3, flow: 'tile', showArtwork: true, style: { '--playlist-cover-size': '145px', '--playlist-card-title-size': '17px', '--playlist-card-artist-size': '13px', '--playlist-card-format-size': '12px' } as CSSProperties },
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
const PLAYLIST_ARTWORK_WINDOW_LIMIT = 40

function readPlaylistLayoutLevel(): number {
  if (typeof window === 'undefined') return DEFAULT_PLAYLIST_LAYOUT_LEVEL
  try {
    const stored = window.localStorage.getItem(PLAYLIST_LAYOUT_STORAGE_KEY)
    if (stored === null || !/^(0|[1-9]\d*)$/.test(stored)) return DEFAULT_PLAYLIST_LAYOUT_LEVEL
    const level = Number(stored)
    return Number.isSafeInteger(level) && level < PLAYLIST_LAYOUTS.length
      ? level
      : DEFAULT_PLAYLIST_LAYOUT_LEVEL
  } catch {
    return DEFAULT_PLAYLIST_LAYOUT_LEVEL
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

function formatTotalClock(totalSeconds?: number): string | null {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return null
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function PlaylistPanel({
  tracks,
  unavailableTrackIds,
  playlistName,
  currentTrackId,
  totalDurationSeconds,
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
}: PlaylistPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [layoutLevel, setLayoutLevel] = useState(readPlaylistLayoutLevel)
  const [layoutAnnouncement, setLayoutAnnouncement] = useState('')
  const [artworkWindowIds, setArtworkWindowIds] = useState<ReadonlySet<string>>(new Set())
  const [artworkWindowRevision, setArtworkWindowRevision] = useState(0)
  const panelRef = useRef<HTMLElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
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
  const totalClock = formatTotalClock(totalDurationSeconds)

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
        const animation = animateLayoutPart(element, from, element.getBoundingClientRect(), duration, easing)
        if (!animation) continue
        animations.push(animation)
        activeLayoutAnimationsRef.current.add(animation)
        animation.onfinish = () => {
          activeLayoutAnimationsRef.current.delete(animation)
          animation.cancel()
        }
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
    const target = currentTrackId && !unavailable.has(currentTrackId)
      ? currentTrackId
      : filteredTracks.find((track) => !unavailable.has(track.id))?.id
    if (!target) return
    onTrackSelect?.(target)
  }, [currentTrackId, filteredTracks, onTrackSelect, unavailable])

  useEffect(() => () => {
    onVisibleTrackIdsChange?.([], false)
  }, [onVisibleTrackIdsChange])

  useEffect(() => {
    const panel = panelRef.current
    const grid = gridRef.current
    if (!panel || !onVisibleTrackIdsChange) return
    if (!grid) {
      onVisibleTrackIdsChange([], true, layout.showArtwork)
      return
    }
    // Text layouts still need visible-track metadata. Their reports must leave
    // the bounded artwork window untouched so decoded covers stay warm.
    metadataWindowKeyRef.current = null
    const visibleIds = new Set<string>()
    let frameId: number | null = null
    let disposed = false
    const publish = () => {
      frameId = null
      if (disposed) return
      const panelRect = panel.getBoundingClientRect()
      const orderedEntries = [...grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')]
        .map((card, domIndex) => {
          const trackId = card.dataset.playlistTrackId
          if (!trackId || !visibleIds.has(trackId)) return null
          const rect = card.getBoundingClientRect()
          const inViewport = rect.bottom > panelRect.top && rect.top < panelRect.bottom
          const viewportDistance = inViewport
            ? 0
            : rect.bottom <= panelRect.top ? panelRect.top - rect.bottom : rect.top - panelRect.bottom
          return { trackId, domIndex, inViewport, viewportDistance }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => Number(right.inViewport) - Number(left.inViewport)
          || (left.inViewport ? left.domIndex - right.domIndex : left.viewportDistance - right.viewportDistance)
          || left.domIndex - right.domIndex)
      if (!layout.showArtwork) {
        const orderedIds = orderedEntries.map((entry) => entry.trackId)
        const windowKey = orderedIds.join('\u0000')
        if (metadataWindowKeyRef.current === windowKey) return
        metadataWindowKeyRef.current = windowKey
        onVisibleTrackIdsChange(orderedIds, true, false)
        return
      }
      // Keep images that were already decoded alive while their covers fly to
      // the new grid. The consumer has a 40-cover budget, so in-viewport cards
      // take priority, then previously loaded cards, then nearby prefetches.
      const heldIds = artworkHoldIdsRef.current
      const orderedIds = [...new Set([
        ...orderedEntries.filter((entry) => entry.inViewport).map((entry) => entry.trackId),
        ...(heldIds ? [...heldIds] : []),
        ...orderedEntries.map((entry) => entry.trackId),
      ])].slice(0, PLAYLIST_ARTWORK_WINDOW_LIMIT)
      const windowKey = orderedIds.join('\u0000')
      if (artworkWindowKeyRef.current === windowKey) return
      const nextWindow = new Set(orderedIds)
      artworkWindowKeyRef.current = windowKey
      artworkWindowIdsRef.current = nextWindow
      setArtworkWindowIds(nextWindow)
      onVisibleTrackIdsChange(orderedIds, true)
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const trackId = (entry.target as HTMLElement).dataset.playlistTrackId
        if (!trackId) continue
        if (entry.isIntersecting) visibleIds.add(trackId)
        else visibleIds.delete(trackId)
      }
      if (frameId === null) frameId = requestAnimationFrame(publish)
    }, {
      root: panel,
      rootMargin: '100% 0px',
      threshold: 0.01,
    })

    const cards = grid.querySelectorAll<HTMLElement>('[data-playlist-track-id]')
    if (cards.length === 0) {
      if (layout.showArtwork) clearArtworkWindow()
      onVisibleTrackIdsChange([], true, layout.showArtwork)
    }
    // Seed the replacement observer from the current geometry. A layout change
    // must not publish an empty/partial window before IntersectionObserver has
    // delivered its first batch and revoke artwork that is still on screen.
    const panelRect = panel.getBoundingClientRect()
    const margin = panelRect.height
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      if (rect.bottom > panelRect.top - margin && rect.top < panelRect.bottom + margin) {
        const trackId = card.dataset.playlistTrackId
        if (trackId) visibleIds.add(trackId)
      }
    })
    if (cards.length > 0) frameId = requestAnimationFrame(publish)
    cards.forEach((card) => observer.observe(card))
    return () => {
      disposed = true
      observer.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [filteredTrackIdsKey, layout.level, layout.showArtwork, onVisibleTrackIdsChange, artworkWindowRevision, clearArtworkWindow])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handleWheel = (event: WheelEvent) => {
      const grid = gridRef.current
      if (!grid || !(event.target instanceof Node) || !grid.contains(event.target) || !event.ctrlKey) return
      event.preventDefault()
      const now = performance.now()
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
      const currentLevel = layoutLevelRef.current
      const nextLevel = Math.max(0, Math.min(PLAYLIST_LAYOUTS.length - 1, currentLevel + direction))
      if (nextLevel === currentLevel) return
      const nextLayout = PLAYLIST_LAYOUTS[nextLevel]
      if (!nextLayout) return
      // Capture the current painted position, including an interrupted in-flight
      // animation, before changing the grid. The same cover/image DOM nodes then
      // animate from these pixels to their new layout in useLayoutEffect.
      pendingLayoutSnapshotRef.current = appearanceMotion.disabled ? null : snapshotCardLayout(grid, panel)
      artworkHoldIdsRef.current = appearanceMotion.disabled ? null : new Set(artworkWindowIdsRef.current)
      layoutTransitionGenerationRef.current += 1
      stopLayoutAnimations()
      wheelLockedUntilRef.current = now + PLAYLIST_WHEEL_STEP_LOCK_MS
      layoutLevelRef.current = nextLevel
      setLayoutLevel(nextLevel)
      persistPlaylistLayoutLevel(nextLevel)
      setLayoutAnnouncement(`歌曲视图已切换为${nextLayout.label}`)
    }

    panel.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      panel.removeEventListener('wheel', handleWheel)
      pendingLayoutSnapshotRef.current = null
      stopLayoutAnimations()
    }
  }, [appearanceMotion, stopLayoutAnimations])

  const playableTrackId = currentTrackId && !unavailable.has(currentTrackId)
    ? currentTrackId
    : filteredTracks.find((track) => !unavailable.has(track.id))?.id

  const handleShuffle = useCallback(() => {
    onShuffleCycle()
  }, [onShuffleCycle])

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

  return (
    <motion.section
      ref={panelRef}
      className="playlist-panel"
      data-select-mode={selectMode ? 'true' : undefined}
      variants={appearanceMotion.variants.panel}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-label={appCopy.playlistPage.title}
    >
      <header className="playlist-hero">
        {firstTrack?.coverThumbnail ? (
          <PlaylistCoverImage className="playlist-hero-image" image={firstTrack.coverThumbnail} />
        ) : firstTrackCoverSource ? (
          <img className="playlist-hero-image" src={firstTrackCoverSource} alt="" aria-hidden="true" decoding="async" onError={handleHeroCoverError} />
        ) : null}
        <button type="button" className="playlist-close" aria-label={appCopy.playlistPage.close} onClick={onClose}>
          <systemIcons.close />
        </button>
        <div className="playlist-hero-copy">
          <h1 className="playlist-hero-title">{playlistName ?? appCopy.playlistPage.title}</h1>
          <p className="playlist-hero-meta">
            <systemIcons.music aria-hidden="true" />
            <span className="playlist-hero-count" aria-label={appCopy.playlistPage.count(tracks.length)}>{tracks.length}</span>
            {totalClock ? (
              <>
                <span className="playlist-hero-meta-sep" aria-hidden="true">|</span>
                <span className="playlist-hero-total">{totalClock}</span>
              </>
            ) : null}
          </p>
          <div className="playlist-hero-actions">
            <IconButton className="playlist-hero-icon" icon={systemIcons.shuffle} label={appCopy.controls.shuffle} selected={shuffleMode !== 'none'} onClick={handleShuffle} />
            <IconButton className="playlist-hero-icon" icon={systemIcons.play} label={appCopy.playlistPage.play} disabled={!playableTrackId || !onTrackSelect} onClick={handlePlay} />
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
            <IconButton className="playlist-hero-icon" icon={systemIcons.more} label={appCopy.playlistPage.more} disabled={isOpenAudioDisabled || !onOpenAudio} onClick={handleMore} />
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
            style={layout.style}
          >
            {filteredTracks.map((track) => (
              <PlaylistCard
                key={track.id}
                track={track}
                coverTone={coverToneForTrackId(track.id)}
                current={track.id === currentTrackId}
                unavailable={unavailable.has(track.id)}
                canActivate={onTrackSelect !== undefined}
                selectMode={selectMode}
                selected={selectedIds.has(track.id)}
                artworkVisible={artworkWindowIds.has(track.id)}
                showExtendedMetadata={layout.flow !== 'tile'}
                onActivate={handleActivate}
                onToggleSelect={handleToggleSelect}
              />
            ))}
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
    </motion.section>
  )
}
