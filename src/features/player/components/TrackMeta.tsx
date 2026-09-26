import { PingPongText } from '@/components/PingPongText'
import { motion } from 'motion/react'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import type { ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'
import { playerViewTransitionLayoutId } from '@/features/player/model/playerViewTransition'

type TrackMetaProps = {
  layer: ArtworkVisualLayer | null
  ownsPlayerViewTransition: boolean
}

export function TrackMeta({ layer, ownsPlayerViewTransition }: TrackMetaProps) {
  const appearanceMotion = useAppearanceMotion()
  const track = layer?.track
  const phase = layer?.phase

  return (
    <motion.div
      className="track-pills"
      layoutId={ownsPlayerViewTransition ? playerViewTransitionLayoutId('copy', track?.id) : undefined}
      transition={{ layout: appearanceMotion.layoutTransition }}
      aria-live={phase === 'active' ? 'polite' : undefined}
    >
      {track ? <>
        <PingPongText className="track-pill title-pill" text={track.title} />
        <PingPongText className="track-pill artist-pill" text={`${track.artist} - ${track.album}`} />
      </> : null}
    </motion.div>
  )
}
