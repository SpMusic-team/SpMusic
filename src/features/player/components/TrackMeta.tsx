import { PingPongText } from '@/components/PingPongText'
import type { ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'

type TrackMetaProps = {
  layer: ArtworkVisualLayer | null
}

export function TrackMeta({ layer }: TrackMetaProps) {
  const track = layer?.track
  const phase = layer?.phase

  return (
    <div
      className="track-pills"
      aria-live={phase === 'active' ? 'polite' : undefined}
    >
      {track ? <>
        <PingPongText className="track-pill title-pill" text={track.title} />
        <PingPongText className="track-pill artist-pill" text={`${track.artist} - ${track.album}`} />
      </> : null}
    </div>
  )
}
