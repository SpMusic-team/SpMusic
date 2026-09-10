import { memo, type SyntheticEvent } from 'react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { PlaylistCoverCanvas } from '@/features/player/components/PlaylistCoverCanvas'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlaylistTrackItemViewModel } from '@/features/player/model/playerUiViewModel'
import type { CoverTone } from '@/features/player/model/playerTypes'

type PlaylistCardProps = {
  track: PlaylistTrackItemViewModel
  coverTone: CoverTone
  current: boolean
  unavailable: boolean
  canActivate: boolean
  selectMode: boolean
  selected: boolean
  artworkVisible: boolean
  onActivate: (trackId: string) => void
  onToggleSelect: (trackId: string) => void
}

function formatTrackClock(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const seconds = Math.floor(durationSeconds)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const PlaylistCard = memo(function PlaylistCard({
  track,
  coverTone,
  current,
  unavailable,
  canActivate,
  selectMode,
  selected,
  artworkVisible,
  onActivate,
  onToggleSelect,
}: PlaylistCardProps) {
  const systemIcons = useSystemIcons()
  const handleClick = () => {
    if (selectMode) onToggleSelect(track.id)
    else onActivate(track.id)
  }
  const title = track.title
  const label = unavailable ? `${title} · ${appCopy.playlistPage.moreUnavailable}` : title
  const artistAlbum = track.album && track.album !== track.artist
    ? `${track.artist} - ${track.album}`
    : track.artist
  const clock = formatTrackClock(track.durationSeconds)
  const coverSource = track.coverImage ?? track.coverImageFallback
  const formatParts = [clock, track.fileExtension?.toLowerCase()]
    .filter((part): part is string => Boolean(part))
  if (track.audioFormat?.bitDepth) formatParts.push(`${track.audioFormat.bitDepth}bit`)

  const handleCoverError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (track.coverImageFallback && image.src !== track.coverImageFallback) {
      image.src = track.coverImageFallback
      return
    }
    image.hidden = true
  }

  return (
    <button
      type="button"
      className="playlist-card"
      data-playlist-track-id={track.id}
      data-tone={coverTone}
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
      <span className="playlist-card-cover" aria-hidden="true">
        {artworkVisible && track.coverBitmap ? (
          <PlaylistCoverCanvas className="playlist-card-cover-image" bitmap={track.coverBitmap} />
        ) : artworkVisible && !track.hasLocalArtwork && coverSource ? (
          <img className="playlist-card-cover-image" src={coverSource} alt="" onError={handleCoverError} />
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
    </button>
  )
})
