import type { LucideIcon } from 'lucide-react'
import {
  AlbumIcon,
  BarChart3Icon,
  BookmarkIcon,
  CopyIcon,
  FolderIcon,
  GuitarIcon,
  ImageIcon,
  InfoIcon,
  ListPlusIcon,
  Mic2Icon,
  Music2Icon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ArtworkSourceView } from '@/features/player/hooks/useArtworkVisualResource'
import type { Track } from '@/features/player/model/playerTypes'
import { formatDuration } from '@/features/player/model/trackUtils'
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
  icon: LucideIcon
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

  async function copyTrackTitle() {
    if (!navigator.clipboard) {
      toast.error(appCopy.moreMenu.copyUnavailable)
      return
    }

    try {
      await navigator.clipboard.writeText(track.title)
      toast.success(appCopy.moreMenu.copiedTitle)
    } catch {
      toast.error(appCopy.moreMenu.copyUnavailable)
    }
  }

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
                <span><Music2Icon />{formatDuration(track.durationSeconds)}</span>
                <button type="button" className="more-copy-action" aria-label={appCopy.moreMenu.copyTitle} onClick={() => void copyTrackTitle()}>
                  <CopyIcon />
                  <span className="sr-only">{appCopy.moreMenu.copyTitle}</span>
                </button>
              </div>
              <div className="more-feedback-actions">
                <button type="button" className="more-feedback-action" data-selected={liked} aria-label={appCopy.controls.like} aria-pressed={liked} onClick={onLike}>
                  <LikeIcon />
                </button>
                <button type="button" className="more-feedback-action" data-selected={disliked} aria-label={appCopy.controls.dislike} aria-pressed={disliked} onClick={onDislike}>
                  <DislikeIcon />
                </button>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        <section className="more-action-grid" aria-label={appCopy.moreMenu.title}>
          <UnavailableAction icon={Trash2Icon} label={appCopy.moreMenu.delete} wide />
          <UnavailableAction icon={ListPlusIcon} label={appCopy.moreMenu.playlist} />
          <UnavailableAction icon={BookmarkIcon} label={appCopy.moreMenu.bookmark} />
          <UnavailableAction icon={ImageIcon} label={appCopy.moreMenu.cover} wide />
          <UnavailableAction icon={InfoIcon} label={appCopy.moreMenu.info} />
          <UnavailableAction icon={BarChart3Icon} label={appCopy.moreMenu.listeningHistory} />
        </section>

        <Separator />

        <section className="more-action-grid more-action-grid-secondary" aria-label={appCopy.moreMenu.title}>
          <UnavailableAction icon={Mic2Icon} label={appCopy.moreMenu.artist} />
          <UnavailableAction icon={AlbumIcon} label={appCopy.moreMenu.album} />
          <UnavailableAction icon={FolderIcon} label={appCopy.moreMenu.folder} />
          <UnavailableAction icon={GuitarIcon} label={appCopy.moreMenu.genre} />
        </section>
      </DialogContent>
    </Dialog>
  )
}
