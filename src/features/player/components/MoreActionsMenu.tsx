import { useCallback } from 'react'
import {
  AddCircle48Regular,
  Bookmark24Regular,
  Cd16Regular,
  ClosedCaption48Regular,
  DataHistogram24Regular,
  Delete48Regular,
  ErrorCircle48Regular,
  Folder48Regular,
  Guitar24Regular,
  Image48Regular,
  Mic48Regular,
  MusicNote124Regular,
} from '@fluentui/react-icons'
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
      <Icon aria-hidden="true" className={cn(Icon === ErrorCircle48Regular && 'more-info-icon')} />
      <span className="more-action-copy">
        <strong>{label}</strong>
        <small>{appCopy.moreMenu.unavailable}</small>
      </span>
    </button>
  )
}

function syncScrollMarker(scroll: HTMLDivElement) {
  const range = scroll.scrollHeight - scroll.clientHeight
  const progress = range > 0 ? scroll.scrollTop / range : 0
  scroll.style.setProperty('--more-scroll-progress', `${Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0}`)
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
  const measureMenu = useCallback((menu: HTMLDivElement | null) => {
    if (!menu) return
    const leading = menu.querySelector<HTMLElement>('.more-actions-leading')
    const scroll = menu.querySelector<HTMLDivElement>('.more-actions-scroll')
    if (!leading || !scroll) return

    // Measure the actual first two sections, including font metrics and view
    // density, so the scrolling viewport ends exactly at their divider.
    const updateMeasurements = () => {
      menu.style.setProperty('--more-leading-height', `${leading.getBoundingClientRect().height}px`)
      syncScrollMarker(scroll)
    }
    updateMeasurements()
    const observer = new ResizeObserver(updateMeasurements)
    observer.observe(leading)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

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

      <DialogContent ref={measureMenu} className="more-actions-menu" overlayClassName="more-actions-overlay" showCloseButton={false}>
        <div className="more-actions-scroll" onScroll={(event) => syncScrollMarker(event.currentTarget)}>
          <DialogTitle className="sr-only">{appCopy.moreMenu.title}</DialogTitle>
          <DialogDescription className="sr-only">{track.title}</DialogDescription>

          <div className="more-actions-leading">
            <section className="more-track-group" aria-label={appCopy.moreMenu.title}>
              <div className="more-track-summary">
                <div className="more-menu-cover">
                  {coverSource
                    ? <ArtworkCanvas source={coverSource} label={`${track.title} 封面`} />
                    : (
                      <span className="more-menu-cover-mark">
                        <systemIcons.music aria-hidden="true" />
                      </span>
                    )}
                </div>
                <div className="more-track-details">
                  <PingPongText as="strong" className="more-track-title" text={track.title} />
                  <PingPongText className="more-track-byline" text={`${track.artist} - ${track.album}`} />
                  <div className="more-track-meta">
                    <span><MusicNote124Regular />{formatCompactDuration(track.durationSeconds)} | {track.fileExtension ?? 'flac'}</span>
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
              <UnavailableAction icon={Delete48Regular} label={appCopy.moreMenu.delete} wide />
              <UnavailableAction icon={AddCircle48Regular} label={appCopy.moreMenu.playlist} />
              <UnavailableAction icon={Bookmark24Regular} label={appCopy.moreMenu.bookmark} />
              <UnavailableAction icon={Image48Regular} label={appCopy.moreMenu.cover} wide />
              <UnavailableAction icon={ErrorCircle48Regular} label={appCopy.moreMenu.info} />
              <UnavailableAction icon={ClosedCaption48Regular} label={appCopy.moreMenu.lyrics} />
            </section>

            <Separator />
          </div>

          <section className="more-action-grid more-action-grid-secondary" aria-label={appCopy.moreMenu.title}>
            <UnavailableAction icon={Mic48Regular} label={appCopy.moreMenu.artist} />
            <UnavailableAction icon={Cd16Regular} label={appCopy.moreMenu.album} />
            <UnavailableAction icon={Guitar24Regular} label={appCopy.moreMenu.genre} />
            <div className="more-action-spacer" aria-hidden="true" />
            <UnavailableAction icon={Folder48Regular} label={appCopy.moreMenu.folder} />
            <UnavailableAction icon={DataHistogram24Regular} label={appCopy.moreMenu.listeningHistory} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
