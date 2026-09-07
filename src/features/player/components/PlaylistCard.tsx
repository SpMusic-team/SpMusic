import { memo } from 'react'
import { appCopy } from '@/features/player/model/playerCopy'
import type { CoverTone, TrackSummary } from '@/features/player/model/playerTypes'

type PlaylistCardProps = {
  track: TrackSummary
  coverTone: CoverTone
  current: boolean
  unavailable: boolean
  selectMode: boolean
  selected: boolean
  onActivate: (trackId: string) => void
  onToggleSelect: (trackId: string) => void
}

export const PlaylistCard = memo(function PlaylistCard({
  track,
  coverTone,
  current,
  unavailable,
  selectMode,
  selected,
  onActivate,
  onToggleSelect,
}: PlaylistCardProps) {
  const handleClick = () => {
    if (selectMode) onToggleSelect(track.id)
    else onActivate(track.id)
  }
  const title = track.title
  const label = unavailable ? `${title} · ${appCopy.playlistPage.moreUnavailable}` : title

  return (
    <button
      type="button"
      className="playlist-card"
      data-tone={coverTone}
      data-current={current ? 'true' : undefined}
      data-unavailable={unavailable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-select-mode={selectMode ? 'true' : undefined}
      aria-current={current ? 'true' : undefined}
      aria-pressed={selectMode ? selected : undefined}
      disabled={unavailable}
      title={label}
      aria-label={label}
      onClick={handleClick}
    >
      <span className="playlist-card-cover" aria-hidden="true">
        {unavailable ? <span className="playlist-card-cover-state">{appCopy.playlistPage.moreUnavailable}</span> : null}
        {selectMode ? <span className="playlist-card-checkbox" /> : null}
      </span>
      <span className="playlist-card-title">{track.title}</span>
      <span className="playlist-card-artist">{track.artist}</span>
    </button>
  )
})
