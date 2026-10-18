import { memo, type CSSProperties, type SyntheticEvent } from 'react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistCoverImage } from '@/features/player/components/PlaylistCoverImage'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'

type PlaylistCardProps = {
  track: PlaylistTrackItemViewModel
  index?: number
  current: boolean
  unavailable: boolean
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

function formatTrackClock(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const seconds = Math.floor(durationSeconds)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const PlaylistCard = memo(function PlaylistCard({
  track,
  index = 0,
  current,
  unavailable,
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
}: PlaylistCardProps) {
  const handleClick = () => {
    if (selectMode) onToggleSelect(track.id)
    else onActivate(track.id)
  }
  const title = track.title
  const label = unavailable ? `${title} · ${appCopy.playlistPage.moreUnavailable}` : title
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
  const coverState: PlaylistCardCoverState = track.coverThumbnail
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
      disabled={unavailable || (!selectMode && !canActivate)}
      title={label}
      aria-label={label}
      onClick={handleClick}
    >
      {contentVisible ? <PlaylistCardContent track={track} artworkVisible={artworkVisible}
        selectMode={selectMode} unavailable={unavailable} showExtendedMetadata={showExtendedMetadata}
        coverState={coverState} coverFailed={coverFailed} onCoverFailed={onCoverFailed} /> : null}
    </button>
  )
})

function PlaylistCardContent({ track, artworkVisible, selectMode, unavailable, showExtendedMetadata, coverState, coverFailed, onCoverFailed }: Pick<PlaylistCardProps, 'track' | 'artworkVisible' | 'selectMode' | 'unavailable' | 'showExtendedMetadata' | 'coverFailed' | 'onCoverFailed'> & { coverState: PlaylistCardCoverState }) {
  const systemIcons = useSystemIcons()
  const coverSource = track.coverImage ?? track.coverImageFallback
  const coverMarkVisible = coverState === 'empty' || coverState === 'error'
  const artistAlbum = showExtendedMetadata && track.album && track.album !== track.artist ? `${track.artist} - ${track.album}` : track.artist
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
      if (coverSource) onCoverFailed(track.id, `${coverSource}\0${fallback ?? ''}`)
    }
  }
  return <>
      <span className="playlist-card-cover" aria-hidden="true">
        {track.coverThumbnail ? (
          <PlaylistCoverImage className="playlist-card-cover-image" image={track.coverThumbnail} />
        ) : !coverFailed && artworkVisible && track.hasLocalArtwork === false && coverSource ? (
          // This eager <img> has no thumbnail pipeline and therefore no load
          // signal, so it opts out of the cross-dissolve: without its own class
          // it would inherit the dissolve's opacity 0 and never appear. It is
          // gated on a *known* "no local artwork" so an unhydrated track cannot
          // fail here and latch the card into the error state.
          <img key={`${coverSource}\0${track.coverImageFallback ?? ''}`} className="playlist-card-cover-image playlist-card-cover-image-eager" src={coverSource} alt="" onError={handleCoverError} />
        ) : null}
        {coverMarkVisible ? (
          <span className="playlist-card-cover-mark">
            <systemIcons.music />
          </span>
        ) : null}
        {unavailable ? <span className="playlist-card-cover-state">{appCopy.playlistPage.moreUnavailable}</span> : null}
        {selectMode ? <span className="playlist-card-checkbox" /> : null}
      </span>
      <span className="playlist-card-copy">
        <span className="playlist-card-title">{track.title}</span>
        <span className="playlist-card-artist">{artistAlbum}</span>
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
  </>
}
