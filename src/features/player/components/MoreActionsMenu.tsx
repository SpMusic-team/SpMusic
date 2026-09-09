import {
  BookmarkIcon,
  CirclePlusIcon,
  ClosedCaptionIcon,
  Disc3Icon,
  FolderIcon,
  GuitarIcon,
  ImageIcon,
  InfoIcon,
  Mic2Icon,
  Music2Icon,
  Trash2Icon,
} from 'lucide-react'
import { DataHistogram24Regular } from '@fluentui/react-icons'
import { PingPongText } from '@/components/PingPongText'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { IconButton } from '@/features/player/components/IconButton'
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ArtworkSourceView } from '@/features/player/hooks/useArtworkVisualResource'
import type { Track } from '@/features/player/model/playerTypes'
import { formatCompactDuration } from '@/features/player/model/trackUtils'
import type { SystemIcon } from '@/icons/systemIcons'
import { cn } from '@/lib/utils'
import { ArtworkCanvas } from './ArtworkCanvas'

type MoreActionsMenuProps = {
  track: Track
  coverSource?: ArtworkSourceView
  likeIcon: SystemIcon
  dislikeIcon: SystemIcon
  liked: boolean
  disliked: boolean
  onLike: () => void
  onDislike: () => void
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

type UnavailableActionProps = {
  icon: SystemIcon
  label: string
  wide?: boolean
}

function UnavailableAction({ icon: Icon, label, wide = false }: UnavailableActionProps) {
  return (
    <button
      type="button"
      className={cn('more-action', wide && 'more-action-wide')}
      aria-label={`${label}，${appCopy.moreMenu.unavailable}`}
      disabled
    >
      <Icon />
      <span className="more-action-copy">
        <strong>{label}</strong>
        <small>{appCopy.moreMenu.unavailable}</small>
      </span>
    </button>
  )
}

export function MoreActionsMenu({
  track,
  coverSource,
  likeIcon: LikeIcon,
  dislikeIcon: DislikeIcon,
  liked,
  disliked,
  onLike,
  onDislike,
  onOpenChange,
  open,
}: MoreActionsMenuProps) {
  const systemIcons = useSystemIcons()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <PressFeedbackButton
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'icon' }),
                    'cover-press-feedback-button more-button',
                  )}
                  aria-label={appCopy.controls.more}
                  data-slot="button"
                  tone="secondary-container"
                >
                  <systemIcons.more />
                </PressFeedbackButton>
              }
            />
          }
        />
        <TooltipContent>{appCopy.controls.more}</TooltipContent>
      </Tooltip>

      <DialogContent className="more-actions-menu" overlayClassName="more-actions-overlay" showCloseButton={false}>
        <DialogTitle className="sr-only">{appCopy.moreMenu.title}</DialogTitle>
        <DialogDescription className="sr-only">{track.title}</DialogDescription>

        <section className="more-track-group" aria-label={appCopy.moreMenu.title}>
          <div className="more-track-summary">
            <div className="more-menu-cover" data-tone={track.coverTone}>
              {coverSource
                ? <ArtworkCanvas source={coverSource} label={`${track.title} 演示封面`} />
                : <systemIcons.music aria-hidden="true" />}
            </div>
            <div className="more-track-details">
              <PingPongText as="strong" className="more-track-title" text={track.title} />
              <PingPongText className="more-track-byline" text={`${track.artist} - ${track.album}`} />
              <div className="more-track-meta">
                <span><Music2Icon />{formatCompactDuration(track.durationSeconds)} | {track.fileExtension ?? 'flac'}</span>
              </div>
              <div className="more-feedback-actions">
                <IconButton
                  className="more-feedback-action"
                  animated
                  pressFeedback
                  icon={LikeIcon}
                  label={appCopy.controls.like}
                  selected={liked}
                  onClick={onLike}
                />
                <IconButton
                  className="more-feedback-action"
                  animated
                  pressFeedback
                  icon={DislikeIcon}
                  label={appCopy.controls.dislike}
                  selected={disliked}
                  onClick={onDislike}
                />
              </div>
            </div>
          </div>
        </section>

        <Separator />

        <section className="more-action-grid" aria-label={appCopy.moreMenu.title}>
          <UnavailableAction icon={Trash2Icon} label={appCopy.moreMenu.delete} wide />
          <UnavailableAction icon={CirclePlusIcon} label={appCopy.moreMenu.playlist} />
          <UnavailableAction icon={BookmarkIcon} label={appCopy.moreMenu.bookmark} />
          <UnavailableAction icon={ImageIcon} label={appCopy.moreMenu.cover} wide />
          <UnavailableAction icon={InfoIcon} label={appCopy.moreMenu.info} />
          <UnavailableAction icon={ClosedCaptionIcon} label={appCopy.moreMenu.lyrics} />
        </section>

        <Separator />

        <section className="more-action-grid more-action-grid-secondary" aria-label={appCopy.moreMenu.title}>
          <UnavailableAction icon={Mic2Icon} label={appCopy.moreMenu.artist} />
          <UnavailableAction icon={Disc3Icon} label={appCopy.moreMenu.album} />
          <UnavailableAction icon={GuitarIcon} label={appCopy.moreMenu.genre} />
          <div className="more-action-spacer" aria-hidden="true" />
          <UnavailableAction icon={FolderIcon} label={appCopy.moreMenu.folder} />
          <UnavailableAction icon={DataHistogram24Regular} label={appCopy.moreMenu.listeningHistory} />
        </section>
      </DialogContent>
    </Dialog>
  )
}
