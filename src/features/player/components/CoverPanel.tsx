import { memo, useEffect } from 'react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { SystemIcon } from '@/icons/systemIcons'
import type { ArtworkVisualLayer } from '@/features/player/hooks/useArtworkVisualResource'
import { ArtworkCanvas } from './ArtworkCanvas'
import { IconButton } from './IconButton'
import { MoreActionsMenu } from './MoreActionsMenu'

type CoverPanelProps = {
  layer: ArtworkVisualLayer | null
  likeIcon: SystemIcon
  dislikeIcon: SystemIcon
  liked: boolean
  disliked: boolean
  onLike: () => void
  onDislike: () => void
  onReady: () => void
  onLoadError: () => void
  onMoreOpenChange?: (open: boolean) => void
  moreOpen?: boolean
}

export const CoverPanel = memo(function CoverPanel({
  layer,
  likeIcon,
  dislikeIcon,
  liked,
  disliked,
  onLike,
  onDislike,
  onReady,
  onLoadError,
  onMoreOpenChange,
  moreOpen,
}: CoverPanelProps) {
  const systemIcons = useSystemIcons()
  const track = layer?.track
  const artwork = layer?.artwork
  const phase = layer?.phase
  const coverSource = layer?.resource.view

  useEffect(() => {
    if (phase === 'incoming' && !coverSource) onReady()
  }, [coverSource, onReady, phase])

  return (
    <article
      className="cover-column"
    >
      <div className="cover-frame">
        <div
          className="cover-art"
          data-tone={artwork?.coverTone ?? 'blue'}
          data-has-image={Boolean(coverSource)}
        >
          <div hidden={!coverSource}>
            <ArtworkCanvas
              className="cover-image"
              source={coverSource}
              label={artwork && track && artwork.id === track.id ? `${track.title} 封面` : undefined}
              onReady={onReady}
              onError={onLoadError}
            />
          </div>
          {layer && track && artwork ? <>
            {!coverSource ? <div className="cover-mark"><systemIcons.music /><strong>{appCopy.productName}</strong><span>LOCAL LISTENING</span></div> : null}
            <div className="cover-actions">
              <div className="cover-feedback">
                <IconButton animated pressFeedback icon={likeIcon} label={appCopy.controls.like} selected={liked} onClick={onLike} />
                <IconButton animated pressFeedback icon={dislikeIcon} label={appCopy.controls.dislike} selected={disliked} onClick={onDislike} />
              </div>
              <MoreActionsMenu
                track={track}
                coverSource={artwork.id === track.id ? coverSource : undefined}
                likeIcon={likeIcon}
                dislikeIcon={dislikeIcon}
                liked={liked}
                disliked={disliked}
                onLike={onLike}
                onDislike={onDislike}
                onOpenChange={onMoreOpenChange}
                open={moreOpen}
              />
            </div>
          </> : null}
        </div>
      </div>
    </article>
  )
})
