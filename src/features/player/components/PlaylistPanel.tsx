import { useCallback, useMemo, useState, type SyntheticEvent } from 'react'
import { motion } from 'motion/react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { IconButton } from '@/features/player/components/IconButton'
import { PlaylistCard } from '@/features/player/components/PlaylistCard'
import { coverToneForTrackId } from '@/features/player/model/audioTrackModel'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ShuffleMode } from '@/features/player/model/playbackModes'
import type { PlaylistHeroArtwork, PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

type PlaylistPanelProps = {
  tracks: PlaylistTrackItemViewModel[]
  heroArtwork?: PlaylistHeroArtwork | null
  unavailableTrackIds?: ReadonlySet<string>
  playlistName?: string
  currentTrackId?: string | null
  totalDurationSeconds?: number
  shuffleMode: ShuffleMode
  onShuffleCycle: () => void
  isOpenAudioDisabled?: boolean
  onOpenAudio?: () => void
  onTrackSelect?: (trackId: string) => void
  onClose: () => void
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
  heroArtwork,
  unavailableTrackIds,
  playlistName,
  currentTrackId,
  totalDurationSeconds,
  shuffleMode,
  onShuffleCycle,
  isOpenAudioDisabled,
  onOpenAudio,
  onTrackSelect,
  onClose,
}: PlaylistPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const unavailable = useMemo(
    () => unavailableTrackIds ?? new Set<string>(),
    [unavailableTrackIds],
  )
  const firstTrack = tracks[0]
  const establishedHeroArtwork = heroArtwork?.trackId === firstTrack?.id ? heroArtwork : null
  const heroCoverImage = establishedHeroArtwork?.coverImage
  const heroCoverFallback = establishedHeroArtwork?.coverImageFallback
  const heroImageSource = heroCoverImage ?? heroCoverFallback
  const heroTone = establishedHeroArtwork?.coverTone
    ?? coverToneForTrackId(firstTrack?.id ?? playlistName ?? '')
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

  const handleActivate = useCallback((trackId: string) => {
    onTrackSelect?.(trackId)
    onClose()
  }, [onClose, onTrackSelect])

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
    onClose()
  }, [currentTrackId, filteredTracks, onClose, onTrackSelect, unavailable])

  const playableTrackId = currentTrackId && !unavailable.has(currentTrackId)
    ? currentTrackId
    : filteredTracks.find((track) => !unavailable.has(track.id))?.id

  const handleHeroCoverError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (heroCoverFallback && image.src !== heroCoverFallback) {
      image.src = heroCoverFallback
      return
    }
    image.hidden = true
  }, [heroCoverFallback])

  const handleShuffle = useCallback(() => {
    onShuffleCycle()
  }, [onShuffleCycle])

  const handleMore = useCallback(() => {
    onOpenAudio?.()
  }, [onOpenAudio])

  const selectedCount = selectedIds.size

  return (
    <motion.section
      className="playlist-panel"
      data-select-mode={selectMode ? 'true' : undefined}
      variants={appearanceMotion.variants.panel}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-label={appCopy.playlistPage.title}
    >
      <header className="playlist-hero" data-tone={heroTone}>
        {heroImageSource ? (
          <img
            key={firstTrack?.id}
            className="playlist-hero-image"
            src={heroImageSource}
            alt=""
            onError={handleHeroCoverError}
          />
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
            onChange={(event) => setFilter(event.target.value)}
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
        <div className="playlist-grid">
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
              onActivate={handleActivate}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      ) : (
        <Empty className="playlist-empty">
          <EmptyHeader>
            <EmptyTitle>{appCopy.playlistPage.emptyTitle}</EmptyTitle>
            <EmptyDescription>{appCopy.playlistPage.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </motion.section>
  )
}
