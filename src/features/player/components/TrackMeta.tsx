import { motion } from 'motion/react'
import { PingPongText } from '@/components/PingPongText'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import type { Track } from '@/features/player/model/playerTypes'

type TrackMetaProps = {
  track: Track
}

export function TrackMeta({ track }: TrackMetaProps) {
  const appearanceMotion = useAppearanceMotion()

  return (
    <motion.div
      layout
      className="track-pills"
      variants={appearanceMotion.variants.track}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-live="polite"
    >
      <PingPongText className="track-pill title-pill" text={track.title} />
      <PingPongText className="track-pill artist-pill" text={`${track.artist} - ${track.album}`} />
    </motion.div>
  )
}
