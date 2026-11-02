import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { PlaylistAddDialog, PlaylistDeleteDialog } from './PlaylistSongDialogs'
import type { PlayerMoreActions, PlaylistAddRequest, PlaylistDeleteAction, PlaylistDeleteSnapshot } from '../model/playerUiViewModel'
import {
  AddCircle48Regular,
  Bookmark24Regular,
  Cd16Regular,
  CheckmarkCircle48Regular,
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
  actions?: PlayerMoreActions
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

function MenuAction({ icon: Icon, label, wide = false, onClick, reason, containsTrack }: UnavailableActionProps & { onClick?: () => void; reason?: string; containsTrack?: boolean }) {
  return <button type="button" className={cn('more-action', wide && 'more-action-wide')} disabled={!onClick}
    aria-label={label} data-contains-track={containsTrack} title={!onClick ? reason : undefined} onClick={onClick}>
    <Icon aria-hidden="true" /><span className="more-action-copy"><strong>{label}</strong></span>
  </button>
}

function syncScrollMarker(scroll: HTMLDivElement) {
  const range = scroll.scrollHeight - scroll.clientHeight
  const progress = range > 0 ? scroll.scrollTop / range : 0
  scroll.style.setProperty('--more-scroll-progress', `${Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0}`)
}

export function MoreActionsMenu({
  actions: suppliedActions,
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
  const actions = suppliedActions?.trackId === track.id ? suppliedActions : undefined
  const [deletion, setDeletion] = useState<{ snapshot: PlaylistDeleteSnapshot; action: PlaylistDeleteAction } | null>(null)
  const [deleteMode, setDeleteMode] = useState<'list' | 'files'>('list')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [addition, setAddition] = useState<{ request: PlaylistAddRequest; actions: PlayerMoreActions } | null>(null)
  const [membership, setMembership] = useState<{ trackId: string; request: PlaylistAddRequest } | null>(null)
  const prepareAdd = actions?.onPreparePlaylistAdd
  const addScope = actions?.addSnapshot?.scope
  const addKey = actions?.addSnapshot?.songKeys[0]
  // Reuse the picker request as the membership source. Resolve before paint on
  // entry/track changes; never retain a boolean that can drift from its targets.
  const refreshMembership = useCallback(() => {
    if (!prepareAdd || !addKey) return
    const request = prepareAdd({ scope: addScope ?? null, songKeys: [addKey] })
    if (request) setMembership({ trackId: track.id, request })
  }, [prepareAdd, addScope, addKey, track.id])
  useLayoutEffect(() => {
    // A closed menu is mounted for each artwork layer, including rapid track
    // previews. Preparing its picker scans the playlist registry; defer that
    // work until this menu is actually visible. The trigger also refreshes
    // synchronously so the first visible frame retains the membership icon.
    if (!open) return
    let current = true
    queueMicrotask(() => { if (current) refreshMembership() })
    return () => { current = false }
  }, [refreshMembership, open])
  const containsTrack = membership?.trackId === track.id && membership.request.targets.some(target => target.containsAll)
  const beginDelete = () => {
    if (!actions?.deleteSnapshot || !actions.onDeleteSongs || actions.disabled) return
    setDeletion({ snapshot: actions.deleteSnapshot, action: actions.onDeleteSongs })
    setDeleteMode('list')
    setError(null)
  }
  const confirmDelete = async () => {
    if (!deletion || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await deletion.action(deletion.snapshot, deleteMode)
      if (!result.failedKeys.length && result.succeededKeys.length && !result.errorMessage) {
        setDeletion(null)
        onOpenChange?.(false)
      } else setError(result.errorMessage || `${result.failedKeys.length} 项未能删除，请重试。`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '删除失败，请重试。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const beginAdd = () => {
    if (!actions?.addSnapshot || actions.disabled) return
    const request = actions.onPreparePlaylistAdd?.(actions.addSnapshot)
    if (request) setAddition({ request, actions })
  }
  const navigate = (action: (() => void) | undefined) => action ? () => { onOpenChange?.(false); action() } : undefined
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
    <Dialog open={open} onOpenChange={next => { if (next) { refreshMembership(); actions?.onPrepareNavigation?.() } onOpenChange?.(next) }}>
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
              <MenuAction icon={Delete48Regular} label={appCopy.moreMenu.delete} wide onClick={actions?.deleteSnapshot && actions.onDeleteSongs && !actions.disabled ? beginDelete : undefined} />
              <MenuAction icon={containsTrack ? CheckmarkCircle48Regular : AddCircle48Regular} label={appCopy.moreMenu.playlist} containsTrack={containsTrack} onClick={actions?.addSnapshot && actions.onPreparePlaylistAdd && !actions.disabled ? beginAdd : undefined} />
              <UnavailableAction icon={Bookmark24Regular} label={appCopy.moreMenu.bookmark} />
              <UnavailableAction icon={Image48Regular} label={appCopy.moreMenu.cover} wide />
              <UnavailableAction icon={ErrorCircle48Regular} label={appCopy.moreMenu.info} />
              <UnavailableAction icon={ClosedCaption48Regular} label={appCopy.moreMenu.lyrics} />
            </section>

            <Separator />
          </div>

          <section className="more-action-grid more-action-grid-secondary" aria-label={appCopy.moreMenu.title}>
            <MenuAction icon={Mic48Regular} label={appCopy.moreMenu.artist} onClick={navigate(actions?.onArtist)} reason={actions?.navigationUnavailableReason} />
            <MenuAction icon={Cd16Regular} label={appCopy.moreMenu.album} onClick={navigate(actions?.onAlbum)} reason={actions?.navigationUnavailableReason} />
            <UnavailableAction icon={Guitar24Regular} label={appCopy.moreMenu.genre} />
            <div className="more-action-spacer" aria-hidden="true" />
            <MenuAction icon={Folder48Regular} label={appCopy.moreMenu.folder} onClick={navigate(actions?.onFolder)} reason={actions?.navigationUnavailableReason} />
            <UnavailableAction icon={DataHistogram24Regular} label={appCopy.moreMenu.listeningHistory} />
          </section>
        </div>
      </DialogContent>
      <PlaylistDeleteDialog open={Boolean(deletion)} mode={deleteMode} canRemoveFromList={deletion?.snapshot.canRemoveFromList ?? false} busy={busy} error={error}
        onCancel={() => { setDeletion(null); setError(null) }} onModeChange={mode => { setDeleteMode(mode); setError(null) }} onConfirm={() => { void confirmDelete() }} />
      {addition ? <PlaylistAddDialog request={addition.request} active selection={{
        onAddToPlaylist: addition.actions.onAddToPlaylist,
        onRemoveFromPlaylist: addition.actions.onRemoveFromPlaylist,
        onRefreshAddToPlaylist: snapshot => {
          const request = addition.actions.onPreparePlaylistAdd?.(snapshot)
          if (request) setMembership({ trackId: addition.actions.trackId, request })
          return request
        },
        onCreateAddPlaylist: (name, snapshot) => {
          const request = addition.actions.onCreateAddPlaylist?.(name, snapshot)
          if (request) setMembership({ trackId: addition.actions.trackId, request })
          return request
        },
      }} onCancel={() => { setAddition(null); refreshMembership() }} onDone={() => { setAddition(null); refreshMembership() }} /> : null}
    </Dialog>
  )
}
