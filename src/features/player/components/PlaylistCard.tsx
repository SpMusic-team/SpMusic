import { memo, useCallback, useLayoutEffect, useSyncExternalStore, type CSSProperties, type SyntheticEvent } from 'react'
import { EqualIcon } from 'lucide-react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { usePlaylistCardLongPress } from '@/features/player/hooks/usePlaylistCardLongPress'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import type { PlaylistArtworkSource } from '@/features/player/model/playlistArtworkStore'
import checkbox from '@/assets/song-card/checkbox-unchecked.svg'
import arrowMove from '@/assets/song-card/arrow-move.svg'

type PlaylistCardProps = {
  track: PlaylistTrackItemViewModel
  artworkSource?: PlaylistArtworkSource
  fallbackArtworkSource?: PlaylistArtworkSource
  songKey?: string
  coverUrl?: string
  index?: number
  current: boolean
  unavailable: boolean
  canSelectUnavailable?: boolean
  canActivate: boolean
  selectMode: boolean
  selected: boolean
  artworkVisible: boolean
  showExtendedMetadata: boolean
  contentVisible: boolean
  contentRepresentative: boolean
  contentShape: number
  coverFailed: boolean
  onCoverFailed: (trackId: string, source: string) => void
  onActivate: (trackId: string) => void
  onToggleSelect: (trackId: string) => void
  onEnterSelectMode?: (trackId: string) => void
}

// `idle` is off-window (nothing requested yet), `loading` waits for local
// artwork, `empty` has no artwork at all, `error` exhausted the fallback chain.
type PlaylistCardCoverState = 'ready' | 'loading' | 'empty' | 'idle' | 'error'

const COVER_STAGGER_STEP_MS = 120
const COVER_STAGGER_PHASES = 7
const cardStyles = Array.from({ length: 16 }, (_, shape) => Array.from({ length: COVER_STAGGER_PHASES }, (_, phase) => ({
  '--cover-placeholder-stagger': `${phase * COVER_STAGGER_STEP_MS}ms`,
  '--playlist-card-slot-min-height': `var(--playlist-content-height-${shape}, 0px)`,
}) as CSSProperties))

function SongCardGlyph({ src, className }: { src: string; className: string }) {
  return <span className={`playlist-card-glyph ${className}`} style={{ maskImage: `url("${src}")` }} />
}

function SongCardCheckbox() {
  return <span className="playlist-card-checkbox" aria-hidden="true">
    <SongCardGlyph className="playlist-card-checkbox-icon" src={checkbox} />
    <span className="playlist-card-checkbox-fill" />
    <svg className="playlist-card-checkbox-check" viewBox="0 0 24 24" fill="none"><path pathLength="1" d="m6 12 4 4 8-8" /></svg>
  </span>
}

function formatTrackClock(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const seconds = Math.floor(durationSeconds)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useCardArtwork(source: PlaylistArtworkSource | undefined, trackId: string) {
  const key = source?.keyByTrackId.get(trackId)
  const subscribe = useCallback((listener: () => void) => key && source
    ? source.store.subscribe(key, listener) : () => {}, [key, source])
  const snapshot = useCallback(() => key && source ? source.store.getSnapshot(key) : undefined, [key, source])
  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}

export const PlaylistCard = memo(function PlaylistCard({
  track: baseTrack,
  artworkSource,
  fallbackArtworkSource,
  songKey,
  coverUrl,
  index = 0,
  current,
  unavailable,
  canSelectUnavailable = false,
  canActivate,
  selectMode,
  selected,
  artworkVisible,
  showExtendedMetadata,
  contentVisible,
  contentRepresentative,
  contentShape,
  coverFailed,
  onCoverFailed,
  onActivate,
  onToggleSelect,
  onEnterSelectMode,
}: PlaylistCardProps) {
  const visual = useCardArtwork(artworkSource, baseTrack.id)
  const fallback = useCardArtwork(fallbackArtworkSource, baseTrack.id)
  const fallbackKey = fallbackArtworkSource?.keyByTrackId.get(baseTrack.id)
  useLayoutEffect(() => {
    if (!contentVisible || !artworkVisible || visual?.coverThumbnail || !fallback?.coverThumbnail
      || !fallbackKey || !fallbackArtworkSource) return
    // A newly displayed fallback needs a lease before paint even when its
    // owner deliberately skips a shell-wide render for this thumbnail.
    return fallbackArtworkSource.store.retain(fallbackKey)
  }, [contentVisible, artworkVisible, visual?.coverThumbnail, fallback, fallbackKey, fallbackArtworkSource])
  const track = artworkSource ? { ...baseTrack,
    coverTone: visual?.coverTone ?? baseTrack.coverTone,
    coverThumbnail: visual?.coverThumbnail ?? fallback?.coverThumbnail,
    hasLocalArtwork: visual?.hasLocalArtwork ?? baseTrack.hasLocalArtwork ?? fallback?.hasLocalArtwork,
  } : baseTrack
  const disabled = (unavailable && !(selectMode && canSelectUnavailable)) || (!selectMode && !canActivate)
  const longPress = usePlaylistCardLongPress({ identity: songKey ?? track.id,
    disabled: disabled || !contentVisible, selectMode, onEnterSelectMode })
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (longPress.consumeClick(event)) return
    if (selectMode) onToggleSelect(songKey ?? track.id)
    else onActivate(songKey ?? track.id)
  }
  const title = track.title
  const label = unavailable
    ? title ? `${title} · ${appCopy.playlistPage.moreUnavailable}` : appCopy.playlistPage.moreUnavailable
    : title
  // `hasLocalArtwork` is only written once metadata hydration lands, so an
  // undefined value means "not known yet" rather than "no artwork". Treating it
  // as missing flashed the note glyph on every card during fast scrolling and
  // then removed it again when hydration arrived. Unknown stays quiet: no glyph
  // and no pulse until we actually know which state the track is in.
  //
  // `error` currently has no producer in the real pipeline: artwork that never
  // arrives (retry budget spent, or a cover that only exists as a data URL and
  // never requests a thumbnail) is indistinguishable from artwork that is still
  // coming, so the card keeps the quiet surface instead of claiming there is no
  // cover. The state stays in the machine for the moment the visual pipeline can
  // report a dropped entry, and `error` outranks `loading` for that case.
  const coverState: PlaylistCardCoverState = coverUrl || track.coverThumbnail
    ? 'ready'
    : artworkVisible
      ? coverFailed
        ? 'error'
        : track.hasLocalArtwork === true
          ? 'loading'
          : track.hasLocalArtwork === false ? 'empty' : 'idle'
    : 'idle'

  return (
    <button
      type="button"
      className="playlist-card"
      data-playlist-track-id={track.id}
      data-song-key={songKey}
      data-cover-state={coverState}
      data-content-visible={contentVisible ? 'true' : 'false'}
      data-content-representative={contentRepresentative ? 'true' : undefined}
      data-content-shape={contentShape}
      style={cardStyles[contentShape]![Math.abs(index) % COVER_STAGGER_PHASES]}
      data-current={current ? 'true' : undefined}
      data-unavailable={unavailable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-select-mode={selectMode ? 'true' : undefined}
      aria-current={current ? 'true' : undefined}
      aria-pressed={selectMode ? selected : undefined}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={handleClick}
      onPointerDown={longPress.onPointerDown}
      onContextMenu={longPress.onContextMenu}
    >
      {contentVisible ? <PlaylistCardContent track={track} songKey={songKey} coverUrl={coverUrl} artworkVisible={artworkVisible}
        unavailable={unavailable} showExtendedMetadata={showExtendedMetadata}
        coverState={coverState} coverFailed={coverFailed} onCoverFailed={onCoverFailed} /> : null}
    </button>
  )
})

function PlaylistCardContent({ track, songKey, coverUrl, artworkVisible, unavailable, showExtendedMetadata, coverState, coverFailed, onCoverFailed }: Pick<PlaylistCardProps, 'track' | 'songKey' | 'coverUrl' | 'artworkVisible' | 'unavailable' | 'showExtendedMetadata' | 'coverFailed' | 'onCoverFailed'> & { coverState: PlaylistCardCoverState }) {
  const systemIcons = useSystemIcons()
  const coverSource = coverUrl ?? track.coverImage ?? track.coverImageFallback
  const coverMarkVisible = coverState === 'empty' || coverState === 'error'
  // Empty text means "unknown", so a missing artist/album must not leave an
  // empty line behind. `playlistCardContentShape` already counts these bits.
  const artistText = track.artist?.trim() ?? ''
  const albumText = track.album?.trim() ?? ''
  const artistAlbum = showExtendedMetadata && albumText && albumText !== artistText
    ? artistText ? `${artistText} - ${albumText}` : albumText
    : artistText
  const bitDepth = track.audioFormat?.bitDepth
  const formatParts = showExtendedMetadata ? [formatTrackClock(track.durationSeconds), track.fileExtension?.toLowerCase()].filter((part): part is string => Boolean(part)) : []
  if (showExtendedMetadata && bitDepth != null && Number.isFinite(bitDepth) && bitDepth >= 24) formatParts.push(`${bitDepth}bit`)
  const handleCoverError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const fallback = track.coverImageFallback
    if (fallback && image.dataset.fallbackAttempted !== 'true' && image.src !== new URL(fallback, window.location.href).href) {
      image.dataset.fallbackAttempted = 'true'
      image.src = fallback
    } else {
      image.hidden = true
      if (coverSource) onCoverFailed(songKey ?? track.id, `${coverSource}\0${fallback ?? ''}`)
    }
  }
  return <>
      <span className="playlist-card-cover" aria-hidden="true">
        {coverUrl ? (
          <PlaylistCoverImage className="playlist-card-cover-image" src={coverUrl} reveal onError={handleCoverError} />
        ) : track.coverThumbnail ? (
          <PlaylistCoverImage className="playlist-card-cover-image" image={track.coverThumbnail} reveal />
        ) : !coverFailed && artworkVisible && track.hasLocalArtwork === false && coverSource ? (
          <PlaylistCoverImage key={`${coverSource}\0${track.coverImageFallback ?? ''}`} className="playlist-card-cover-image" src={coverSource} reveal onError={handleCoverError} />
        ) : null}
        {coverMarkVisible ? (
          <span className="playlist-card-cover-mark">
            <systemIcons.music />
          </span>
        ) : null}
        {unavailable ? <span className="playlist-card-cover-state">{appCopy.playlistPage.moreUnavailable}</span> : null}
        <span className="playlist-card-cover-selection" aria-hidden="true">
          <SongCardCheckbox />
          <span className="playlist-card-move" data-reorder-handle><SongCardGlyph className="playlist-card-move-icon" src={arrowMove} /></span>
        </span>
      </span>
      <span className="playlist-card-copy">
        <span className="playlist-card-title">{track.title}</span>
        {artistAlbum ? <span className="playlist-card-artist">{artistAlbum}</span> : null}
        {formatParts.length ? (
          <span className="playlist-card-format">
            <systemIcons.music aria-hidden="true" />
            {formatParts.map((part, index) => (
              <span key={`${part}-${index}`}>
                {index > 0 ? <span className="playlist-card-format-separator" aria-hidden="true"> | </span> : null}
                {part}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="playlist-card-selection-actions" aria-hidden="true">
        <span className="playlist-card-row-move" data-reorder-handle><EqualIcon aria-hidden="true" strokeWidth={3} /></span>
        <SongCardCheckbox />
      </span>
  </>
}
