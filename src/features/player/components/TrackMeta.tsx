import { motion } from 'motion/react'
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
      <span className="title-pill">{track.title}</span>
      <span className="artist-pill">{track.artist} - {track.album}</span>
    </motion.div>
  )
}
