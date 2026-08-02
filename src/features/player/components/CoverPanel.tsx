import { useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { Track } from '@/features/player/model/playerTypes'
import type { SystemIcon } from '@/icons/systemIcons'
import { IconButton } from './IconButton'
import { MoreActionsMenu } from './MoreActionsMenu'

type CoverStyle = CSSProperties & { '--cover-art'?: string }

type CoverPanelProps = {
  track: Track
  coverStyle?: CoverStyle
  likeIcon: SystemIcon
  dislikeIcon: SystemIcon
  liked: boolean
  disliked: boolean
  onLike: () => void
  onDislike: () => void
}

export function CoverPanel({ track, coverStyle, likeIcon, dislikeIcon, liked, disliked, onLike, onDislike }: CoverPanelProps) {
  const systemIcons = useSystemIcons()
  const appearanceMotion = useAppearanceMotion()
  const [coverImageSrc, setCoverImageSrc] = useState(track.coverImage)

  return (
    <motion.article layout className="cover-column">
      <motion.div
        className="cover-frame"
        variants={appearanceMotion.variants.track}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <div
          className="cover-art"
          data-tone={track.coverTone}
          data-has-image={Boolean(coverImageSrc)}
          style={coverStyle}
        >
          {coverImageSrc ? (
            <img
              className="cover-image"
              src={coverImageSrc}
              alt={`${track.title} 封面`}
              onError={() => {
                if (track.coverImageFallback && coverImageSrc !== track.coverImageFallback) {
                  setCoverImageSrc(track.coverImageFallback)
                } else {
                  setCoverImageSrc(undefined)
                }
              }}
            />
          ) : null}
          {!coverImageSrc ? <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div> : null}
          <div className="cover-feedback">
            <IconButton animated icon={likeIcon} label={appCopy.controls.like} selected={liked} onClick={onLike} />
            <IconButton animated icon={dislikeIcon} label={appCopy.controls.dislike} selected={disliked} onClick={onDislike} />
          </div>
          <MoreActionsMenu
            track={track}
            coverStyle={coverStyle}
            likeIcon={likeIcon}
            dislikeIcon={dislikeIcon}
            liked={liked}
            disliked={disliked}
            onLike={onLike}
            onDislike={onDislike}
          />
        </div>
      </motion.div>
    </motion.article>
  )
}
