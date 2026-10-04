import '@/features/player/styles/player.css'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type TransitionEvent } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useReducedMotion, type MotionValue } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance, useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { ControlDock, ExternalPlaybackModeControls } from '@/features/player/components/ControlDock'
import { EmptyPlayerState } from '@/features/player/components/EmptyPlayerState'
import { LyricsPanel } from '@/features/player/components/LyricsPanel'
import { PlaybackInfoButton } from '@/features/player/components/PlaybackInfoButton'
import { PlaylistPanel } from '@/features/player/components/PlaylistPanel'
import { QueuePanel } from '@/features/player/components/QueuePanel'
import { ResponsivePlayerLayout } from '@/features/player/components/ResponsivePlayerLayout'
import { TrackMeta } from '@/features/player/components/TrackMeta'
import { WindowBar, type WindowLayoutState } from '@/features/player/components/WindowBar'
import { ArtworkCanvas } from '@/features/player/components/ArtworkCanvas'
import { appCopy } from '@/features/player/model/playerCopy'
import type { TrackFeedback } from '@/features/player/model/playerTypes'
import {
  useArtworkResourceConsumer,
  useArtworkVisualResource,
  type ArtworkVisualLayer,
} from '@/features/player/hooks/useArtworkVisualResource'
import type { PlayerPlaybackViewModel, PlayerUiViewModel, TrackCardPreviewToken } from '@/features/player/model/playerUiViewModel'
import { getTrackCardOpacity, getTrackCardPose, trackCardTransform, type TrackCardPose, type TrackCardRole } from '@/features/player/model/trackCardTransition'
import {
  integrateTrackCardPointer,
  trackCardDirection,
  type TrackCardInteractionPhase,
} from '@/features/player/model/trackCardGesture'
import { selectPlayerViewTransitionOwnerIds } from '@/features/player/model/playerViewTransition'

export type PlayerSurfaceDevAudioTools = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  content: ReactNode
}

export type PlayerSurfaceProps = {
  viewModel: PlayerUiViewModel
  devAudioTools?: PlayerSurfaceDevAudioTools
}

type PlaylistWindowReport = NonNullable<ComponentProps<typeof PlaylistPanel>['onVisibleTrackIdsChange']>
type PlaylistWindowOwners = { active: symbol | null; closing: symbol | null }

function OwnedPlaylistPanel({
  ownerStateRef,
  onVisibleTrackIdsChange,
  ...props
}: ComponentProps<typeof PlaylistPanel> & { ownerStateRef: RefObject<PlaylistWindowOwners> }) {
  const [owner] = useState(() => Symbol('playlist-panel'))
  const reportRef = useRef(onVisibleTrackIdsChange)
  useLayoutEffect(() => { reportRef.current = onVisibleTrackIdsChange }, [onVisibleTrackIdsChange])

  useLayoutEffect(() => {
    const owners = ownerStateRef.current
    owners.active = owner
    owners.closing = null
    return () => {
      if (owners.active === owner) {
        owners.active = null
        owners.closing = owner
      }
    }
  }, [owner, ownerStateRef])

  const reportWindow = useCallback<PlaylistWindowReport>((trackIds, keepPersistentArtwork, showArtwork, demand) => {
    const state = ownerStateRef.current
    if (state.active === owner) {
      reportRef.current?.(trackIds, keepPersistentArtwork, showArtwork, demand)
      return
    }
    // An exiting panel may clear the window once only when no successor owns it.
    const finalClear = trackIds.length === 0 && keepPersistentArtwork === true && showArtwork === true
      && demand?.visibleIds.length === 0 && demand.prefetchIds.length === 0 && demand.heldIds.length === 0
    if (state.closing === owner && finalClear) {
      state.closing = null
      reportRef.current?.(trackIds, keepPersistentArtwork, showArtwork, demand)
    }
  }, [owner, ownerStateRef])

  return <PlaylistPanel {...props} onVisibleTrackIdsChange={onVisibleTrackIdsChange ? reportWindow : undefined} />
}

type PlaybackVisualState = 'playing' | 'paused'

type PlaybackTransitionRequest = {
  requestId: number
  target: PlaybackVisualState
  trackId: string
  durationMs: number
  visualComplete: boolean
}

type PlaybackTransitionStyle = CSSProperties & {
  '--player-playback-transition-duration': string
  '--player-control-transition-duration': string
}

const PLAYBACK_VISUAL_TRANSITION_MS = 500
const PLAYBACK_CONTROL_TRANSITION_MS = 250
let lastPlaybackTransitionRequestId = 0

function nextPlaybackTransitionRequestId(): number {
  const candidate = Math.max(lastPlaybackTransitionRequestId + 1, Date.now() * 1000)
  lastPlaybackTransitionRequestId = Number.isSafeInteger(candidate) ? candidate : lastPlaybackTransitionRequestId + 1
  return lastPlaybackTransitionRequestId
}

type AmbientArtworkProps = {
  layer: ArtworkVisualLayer | null
  role: TrackCardRole | null
  progress: MotionValue<number>
  outgoingHandoffOpacity?: number
  outgoingReturnToCenter?: boolean
}

const AmbientArtwork = memo(function AmbientArtwork({ layer, role, progress, outgoingHandoffOpacity, outgoingReturnToCenter }: AmbientArtworkProps) {
  useArtworkResourceConsumer(layer?.resource)
  const opacity = useMotionValue(0)
  useLayoutEffect(() => {
    const update = (value: number) => {
      const regular = role === 'outgoing'
        ? outgoingReturnToCenter ? 1 : 1 - value
        : role === 'incoming' ? value : layer?.phase === 'active' ? 1 : 0
      opacity.set(role === 'outgoing' && outgoingHandoffOpacity !== undefined
        ? outgoingHandoffOpacity + (regular - outgoingHandoffOpacity) * value
        : regular)
    }
    update(progress.get())
    return progress.on('change', update)
  }, [layer?.phase, opacity, outgoingHandoffOpacity, outgoingReturnToCenter, progress, role])
  return (
    <motion.div
      className="ambient-cover"
      data-tone={layer?.artwork.coverTone ?? 'blue'}
      data-has-image={Boolean(layer?.resource.view)}
      style={layer ? { opacity } : { display: 'none' }}
      aria-hidden="true"
    >
      <ArtworkCanvas
        className="ambient-cover-image"
        source={layer?.resource.view}
        hidden
        maxBackingEdge={1024}
      />
    </motion.div>
  )
})

type ArtworkReadinessProbeProps = {
  layer: ArtworkVisualLayer | null
  onReady: (layerId: number) => void
  onLoadError: (layerId: number) => void
}

const ArtworkReadinessProbe = memo(function ArtworkReadinessProbe({
  layer,
  onReady,
  onLoadError,
}: ArtworkReadinessProbeProps) {
  useArtworkResourceConsumer(layer?.resource)

  useEffect(() => {
    if (layer?.phase === 'incoming' && !layer.resource.view) onReady(layer.id)
  }, [layer, onReady])

  if (!layer || layer.phase !== 'incoming' || !layer.resource.view) return null

  return (
    <ArtworkCanvas
      className="artwork-readiness-probe"
      source={layer.resource.view}
      hidden
      maxBackingEdge={2}
      onReady={() => onReady(layer.id)}
      onError={() => onLoadError(layer.id)}
    />
  )
})

type TrackCardMotionLayerProps = {
  layer: ArtworkVisualLayer
  feedbackValue?: TrackFeedback
  onFeedbackToggle: (feedback: TrackFeedback) => void
  onReady: (layerId: number) => void
  onLoadError: (layerId: number) => void
  role: TrackCardRole | null
  direction: -1 | 1
  progress: MotionValue<number>
  overshootX: MotionValue<number>
  reducedMotion: boolean
  coverGeometry: { width: number; height: number; centerX: number; centerY: number; perspective: number } | null
  acceptsDrag: boolean
  outgoingHandoff?: TrackCardHandoffPose
  outgoingReturnToCenter?: boolean
  onMoreOpenChange?: (open: boolean) => void
  moreOpen?: boolean
  ownsPlayerViewTransition: boolean
}

const TrackCardMotionLayer = memo(function TrackCardMotionLayer({
  layer,
  feedbackValue,
  onFeedbackToggle,
  onReady,
  onLoadError,
  role,
  direction,
  progress,
  overshootX,
  reducedMotion,
  coverGeometry,
  acceptsDrag,
  outgoingHandoff,
  outgoingReturnToCenter,
  onMoreOpenChange,
  moreOpen,
  ownsPlayerViewTransition,
}: TrackCardMotionLayerProps) {
  const systemIcons = useSystemIcons()
  const phase = layer.phase
  const measuredCoverWidth = coverGeometry?.width ?? 1
  const measuredCoverHeight = coverGeometry?.height ?? measuredCoverWidth
  const measuredPerspective = coverGeometry?.perspective
  const incomingPaintedRef = useRef(false)
  const readyPendingRef = useRef(false)
  const planeTransform = useMotionValue('none')
  const contentOpacity = useMotionValue(1)
  const isStandaloneActive = phase === 'active' && role === null
  useArtworkResourceConsumer(layer.resource)

  // useTransform keeps the transformer captured by its first subscription.
  // A card layer normally mounts without a transition role, so reusing that
  // derived MotionValue after the next track change makes every pointer update
  // evaluate the original `role === null` branch and write `transform: none`.
  // Subscribe explicitly so each role/geometry hand-off owns a fresh closure.
  useLayoutEffect(() => {
    const update = (value: number) => {
      const regularPose = role && coverGeometry
        ? getTrackCardPose(
            role,
            direction,
            outgoingReturnToCenter && role === 'outgoing' ? 0 : value,
            measuredCoverWidth,
            reducedMotion,
            measuredCoverHeight,
            measuredPerspective,
          )
        : null
      const handoffPose = role === 'outgoing' && outgoingHandoff && coverGeometry
        ? outgoingHandoff.pose
        : null
      const pose = regularPose
        ? handoffPose ? mixTrackCardPose(handoffPose, regularPose, value) : regularPose
        : null
      planeTransform.set(pose
        ? trackCardTransform(role === 'incoming' ? { ...pose, xPx: pose.xPx + overshootX.get() } : pose)
        : 'none')
      const regularOpacity = role
        ? outgoingReturnToCenter && role === 'outgoing' ? 1 : getTrackCardOpacity(role, value)
        : 1
      const handoffOpacity = outgoingHandoff
        ? outgoingHandoff.opacity
        : regularOpacity
      contentOpacity.set(role === 'outgoing' && outgoingHandoff
           ? handoffOpacity + (regularOpacity - handoffOpacity) * value
           : regularOpacity)
    }
    update(progress.get())
    const unsubscribeProgress = progress.on('change', update)
    const unsubscribeOvershoot = overshootX.on('change', () => update(progress.get()))
    return () => {
      unsubscribeProgress()
      unsubscribeOvershoot()
    }
  }, [
    contentOpacity,
    coverGeometry,
    direction,
    measuredCoverHeight,
    measuredCoverWidth,
    measuredPerspective,
    outgoingHandoff,
    outgoingReturnToCenter,
    overshootX,
    planeTransform,
    progress,
    reducedMotion,
    role,
  ])
  const handleReady = useCallback(() => {
    if (layer.phase === 'preview') {
      // CoverPanel also reports ready for a cover-less fallback. A draggable
      // target is eligible only after ArtworkCanvas has painted a real source.
      if (!layer.resource.view) return
      onReady(layer.id)
      return
    }
    if (layer.phase !== 'incoming') return
    if (!incomingPaintedRef.current) {
      readyPendingRef.current = true
      return
    }
    onReady(layer.id)
  }, [layer, onReady])
  const handleLoadError = useCallback(() => {
    if (layer.phase === 'incoming') onLoadError(layer.id)
  }, [layer, onLoadError])
  const handleLike = useCallback(() => onFeedbackToggle('liked'), [onFeedbackToggle])
  const handleDislike = useCallback(() => onFeedbackToggle('disliked'), [onFeedbackToggle])
  const LikeIcon = feedbackValue === 'liked' ? systemIcons.likeSelected : systemIcons.like
  const DislikeIcon = feedbackValue === 'disliked' ? systemIcons.dislikeSelected : systemIcons.dislike

  // ArtworkCanvas draws in requestAnimationFrame. Without this paint barrier,
  // a cached cover can report ready before the browser has ever presented the
  // incoming transform. React then promotes it to active in the same frame,
  // which skips the real two-card hand-off (especially in release builds).
  useEffect(() => {
    if (phase !== 'incoming') return
    let cancelled = false
    let secondFrameId: number | null = null
    const firstFrameId = requestAnimationFrame(() => {
      if (cancelled) return
      secondFrameId = requestAnimationFrame(() => {
        if (cancelled) return
        incomingPaintedRef.current = true
        if (readyPendingRef.current || layer.resource.view) {
          readyPendingRef.current = false
          onReady(layer.id)
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrameId)
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId)
    }
  }, [layer.id, layer.resource.view, onReady, phase])

  return (
    <motion.div
      className="track-card-plane"
      data-track-card-layer-id={layer.id}
      data-track-card-phase={phase}
      data-track-card-direction={direction < 0 ? 'previous' : 'next'}
      style={{
        transform: role && coverGeometry ? planeTransform : 'none',
        transformOrigin: coverGeometry
          ? `${coverGeometry.centerX}px ${coverGeometry.centerY}px`
          : '50% 50%',
        pointerEvents: acceptsDrag || isStandaloneActive ? 'auto' : 'none',
      }}
      aria-hidden={phase !== 'active' || undefined}
      inert={phase !== 'active'}
    >
      {/* A released transition layer can remain in the artwork pool while a
          newer drag owns the only valid card pair. If that old exiting layer
          loses its role, rendering it as a normal card resets its transform
          to the centre and produces the rapid-drag recoil. Only the one
          unowned active layer is allowed to use the static visible pose. */}
      <motion.div
        className="track-card-content"
        style={{ opacity: role ? contentOpacity : isStandaloneActive ? 1 : 0 }}
      >
        <CoverPanel
          layer={layer}
          likeIcon={LikeIcon}
          dislikeIcon={DislikeIcon}
          liked={feedbackValue === 'liked'}
          disliked={feedbackValue === 'disliked'}
          onLike={handleLike}
          onDislike={handleDislike}
          onReady={handleReady}
          onLoadError={handleLoadError}
          ownsPlayerViewTransition={ownsPlayerViewTransition}
          onMoreOpenChange={onMoreOpenChange}
          moreOpen={moreOpen}
        />
        <TrackMeta layer={layer} ownsPlayerViewTransition={ownsPlayerViewTransition} />
      </motion.div>
    </motion.div>
  )
})

type TrackCardTransitionSession = {
  key: string
  outgoingLayerId: number
  incomingLayerId: number
  direction: -1 | 1
  kind: 'automatic' | 'drag'
  outgoingHandoff?: TrackCardHandoffPose
  outgoingReturnToCenter?: boolean
}

type TrackCardHandoffPose = {
  pose: TrackCardPose
  opacity: number
  sessionProgress: number
}

type TrackCardSettleContext = {
  session: TrackCardTransitionSession
  target: 0 | 1
  durationSeconds: number
  overshootPx?: number
  onComplete: () => void
}

function mixTrackCardPose(from: TrackCardPose, to: TrackCardPose, progress: number): TrackCardPose {
  const p = Math.min(1, Math.max(0, progress))
  const mix = (start: number, end: number) => start + (end - start) * p
  return {
    xPx: mix(from.xPx, to.xPx),
    yPx: mix(from.yPx, to.yPx),
    zPx: mix(from.zPx, to.zPx),
    rotateX: mix(from.rotateX, to.rotateX),
    rotateY: mix(from.rotateY, to.rotateY),
    rotateZ: mix(from.rotateZ, to.rotateZ),
    scale: mix(from.scale, to.scale),
    opacity: mix(from.opacity, to.opacity),
  }
}

function trackCardSessionsMatch(
  session: TrackCardTransitionSession,
  candidate: TrackCardTransitionSession,
): boolean {
  return session.key === candidate.key
    && session.outgoingLayerId === candidate.outgoingLayerId
    && session.incomingLayerId === candidate.incomingLayerId
    && session.direction === candidate.direction
    && session.kind === candidate.kind
}

function resolveRenderedTrackCardSession(
  liveSession: TrackCardTransitionSession | null,
  artworkSlots: readonly [ArtworkVisualLayer | null, ArtworkVisualLayer | null, ArtworkVisualLayer | null],
  previewToken: TrackCardPreviewToken | null,
): TrackCardTransitionSession | null {
  // A new gesture can own the entering card before its adjacent preview is
  // painted. The old exiting card has already been retired at this point.
  if (liveSession?.kind === 'drag' && liveSession.incomingLayerId < 0
    && artworkSlots.some((layer) => layer?.id === liveSession.outgoingLayerId && layer.phase === 'active')) {
    return liveSession
  }
  const liveDragOutgoing = liveSession?.kind === 'drag'
    ? artworkSlots.find((layer) => (
      layer?.id === liveSession.outgoingLayerId
      && (layer.phase === 'active' || layer.phase === 'exiting')
    ))
    : null
  const liveDragIncoming = liveSession?.kind === 'drag'
    ? artworkSlots.find((layer) => (
      layer?.id === liveSession.incomingLayerId
      && (layer.phase === 'preview' || layer.phase === 'incoming' || layer.phase === 'active')
    ))
    : null
  // A drag owns the shared progress from preview readiness through commit or
  // rollback. The committed pair can gain automatic transition metadata before
  // the drag settle is re-keyed; that metadata must not steal its render roles.
  if (
    liveSession?.kind === 'drag'
    && liveDragOutgoing
    && liveDragIncoming
    && liveDragOutgoing.id !== liveDragIncoming.id
  ) return liveSession

  const automaticIncoming = artworkSlots.find((layer) => (
    layer?.phase === 'active'
    && Boolean(layer.transitionIntent)
  ))
  const automaticIntent = automaticIncoming?.transitionIntent
  const automaticOutgoing = automaticIntent
    ? artworkSlots.find((layer) => (
      layer?.phase === 'exiting'
      && layer.transitionIntent?.requestId === automaticIntent.requestId
    ))
    : null
  let candidate: TrackCardTransitionSession | null = null

  if (
    automaticOutgoing
    && automaticIncoming
    && automaticIntent
    && automaticOutgoing.id !== automaticIncoming.id
  ) {
    candidate = {
      key: `selection:${automaticIntent.requestId}`,
      outgoingLayerId: automaticOutgoing.id,
      incomingLayerId: automaticIncoming.id,
      direction: automaticIntent.direction,
      kind: 'automatic',
    }
  } else if (previewToken) {
    const expectedDragKey = `drag:${previewToken.id}`
    const liveOutgoing = liveSession?.kind === 'drag'
      && liveSession.key === expectedDragKey
      && liveSession.direction === previewToken.direction
      ? artworkSlots.find((layer) => (
        layer?.id === liveSession.outgoingLayerId
        && layer.phase === 'active'
      ))
      : null
    // An active layer can retain the previous automatic transition intent
    // after its exit peer is released. That historical metadata does not make
    // the layer ineligible to become the outgoing card for a new drag.
    const outgoing = liveOutgoing
      ?? artworkSlots.find((layer) => layer?.phase === 'active')
    const incoming = artworkSlots.find((layer) => (
      layer?.previewTokenId === previewToken.id
      && (layer.phase === 'preview' || layer.phase === 'incoming')
    ))
    if (outgoing && incoming && outgoing.id !== incoming.id) {
      candidate = {
        key: expectedDragKey,
        outgoingLayerId: outgoing.id,
        incomingLayerId: incoming.id,
        direction: previewToken.direction,
        kind: 'drag',
      }
    }
  }

  if (!candidate) return null
  return liveSession && trackCardSessionsMatch(liveSession, candidate)
    ? liveSession
    : candidate
}

type CoverDragGesture = {
  gestureId: number
  revision: number
  pointerId: number
  captureElement: HTMLDivElement
  originTrackId: string
  startX: number
  latestX: number
  latestAt: number
  velocityX: number
  coverWidth: number
  direction: -1 | 1 | null
  token: TrackCardPreviewToken | null
  progress: number
  signedProgress: number
  moved: boolean
  released: boolean
  captureRecoveryAttempts: number
  deferredHandoff: boolean
  interruptedRollbackTokenId: number | null
  interruptedSettle: TrackCardSettleContext | null
  interruptedOvershootX: number
  handoffLayerId: number | null
  handoffPose: TrackCardHandoffPose | null
  targetReady: boolean
}

type CoverPointerSample = Pick<PointerEvent, 'clientX' | 'pointerId'>

const TRACK_CARD_DURATION_SECONDS = 0.3
const TRACK_CARD_CANCEL_SECONDS = 0.38
const TRACK_CARD_RECENTER_SECONDS = 0.19
const TRACK_CARD_DRAG_LOCK_PX = 6
const TRACK_CARD_COMMIT_PROGRESS = 0.28
const TRACK_CARD_COMMIT_VELOCITY = 650
const TRACK_CARD_OVERSHOOT_VELOCITY = 1100
const TRACK_CARD_RELEASE_FRESH_MS = 70
const TRACK_CARD_OVERSHOOT_SECONDS = 0.09
const TRACK_CARD_OVERSHOOT_WIDTH = 0.07
const TRACK_CARD_SETTLE_DEADLINE_MS = 800
const TRACK_CARD_CAPTURE_IDLE_DEADLINE_MS = 2000
let lastCoverDragGestureId = 0

export function PlayerSurface({
  viewModel,
  devAudioTools,
}: PlayerSurfaceProps) {
  const { playback, timeline, volume, queue, playlist, feedback } = viewModel
  const { track } = playback
  const prepareTrackPreview = playback.onPrepareTrackPreview
  const commitTrackPreview = playback.onCommitTrackPreview
  const discardTrackPreview = playback.onDiscardTrackPreview
  const trackCardProgress = useMotionValue(0)
  const retiringTrackCardProgress = useMotionValue(0)
  const trackCardOvershootX = useMotionValue(0)
  const trackCardAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const trackCardOvershootAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const trackCardStartFrameRef = useRef<number | null>(null)
  const trackCardRunIdRef = useRef(0)
  const trackCardSettleRef = useRef<TrackCardSettleContext | null>(null)
  const retiringTrackCardAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const retiringTrackCardSessionRef = useRef<TrackCardTransitionSession | null>(null)
  const retiringTrackCardStartedAtRef = useRef(0)
  const [retiringTrackCardSession, setRetiringTrackCardSession] = useState<TrackCardTransitionSession | null>(null)
  const trackCardDeckRef = useRef<HTMLDivElement>(null)
  const [trackCardCoverGeometry, setTrackCardCoverGeometry] = useState<{
    width: number
    height: number
    centerX: number
    centerY: number
    perspective: number
  } | null>(null)
  const coverDragRef = useRef<CoverDragGesture | null>(null)
  const coverInteractionPhaseRef = useRef<TrackCardInteractionPhase>('idle')
  const suppressCoverClickRef = useRef(false)
  const [trackCardPreviewToken, setTrackCardPreviewToken] = useState<TrackCardPreviewToken | null>(null)
  const [trackCardSession, setTrackCardSession] = useState<TrackCardTransitionSession | null>(null)
  const trackCardSessionRef = useRef<TrackCardTransitionSession | null>(null)
  const [retiredTrackCardSession, setRetiredTrackCardSession] = useState<TrackCardTransitionSession | null>(null)
  const retiredTrackCardSessionRef = useRef<TrackCardTransitionSession | null>(null)
  const [retiredExitingLayerIds, setRetiredExitingLayerIds] = useState<ReadonlySet<number>>(() => new Set())
  const publishTrackCardSession = useCallback((session: TrackCardTransitionSession | null) => {
    const current = trackCardSessionRef.current
    if (
      (current === null && session === null)
      || (current !== null && session !== null && trackCardSessionsMatch(current, session))
    ) return
    trackCardSessionRef.current = session
    setTrackCardSession(session)
  }, [])
  const [coverDragActive, setCoverDragActive] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const playlistCloseRequestedRef = useRef(false)
  const observedTrackContextRef = useRef({
    trackId: track?.id ?? null,
    sequence: playback.selectionActivitySequence ?? 0,
  })
  const latestTrackContextRef = useRef({
    trackId: track?.id ?? null,
    sequence: playback.selectionActivitySequence ?? 0,
    intent: playback.selectionVisualIntent ?? null,
  })
  useLayoutEffect(() => {
    latestTrackContextRef.current = {
      trackId: track?.id ?? null,
      sequence: playback.selectionActivitySequence ?? 0,
      intent: playback.selectionVisualIntent ?? null,
    }
  }, [playback.selectionActivitySequence, playback.selectionVisualIntent, track?.id])
  const {
    slots: artworkSlots,
    currentArtworkReady,
    previewArtworkReady,
    markReady: markArtworkReady,
    markLoadError: markArtworkLoadError,
    markExitComplete: markArtworkExitComplete,
  } = useArtworkVisualResource(
    playback.artwork ?? null,
    track,
    playback.detailsPending ?? false,
    playback.artworkPrefetchCandidates ?? (playback.artworkPrefetchCandidate ? [playback.artworkPrefetchCandidate] : []),
    playback.selectionActivitySequence ?? 0,
    playback.selectionVisualIntent ?? null,
    trackCardPreviewToken,
  )
  const activeArtworkLayerId = artworkSlots.find((layer) => layer?.phase === 'active')?.id ?? null
  const playerViewTransitionOwnerIds = useMemo(() => selectPlayerViewTransitionOwnerIds(
    artworkSlots.flatMap((layer) => layer ? [{
      id: layer.id,
      trackId: layer.track.id,
      phase: layer.phase,
    }] : []),
  ), [artworkSlots])
  const trackCardGeometryReady = Boolean(
    trackCardCoverGeometry
    && trackCardCoverGeometry.width > 1
    && trackCardCoverGeometry.height > 1
    && Number.isFinite(trackCardCoverGeometry.centerX)
    && Number.isFinite(trackCardCoverGeometry.centerY),
  )
  const artworkSlotsRef = useRef(artworkSlots)
  useLayoutEffect(() => {
    artworkSlotsRef.current = artworkSlots
    const exitingIds = new Set(artworkSlots.flatMap((layer) => layer?.phase === 'exiting' ? [layer.id] : []))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRetiredExitingLayerIds((current) => {
      const remaining = [...current].filter((id) => exitingIds.has(id))
      return remaining.length === current.size ? current : new Set(remaining)
    })
  }, [artworkSlots])
  const completeTrackCardExit = useCallback(
    (layerId: number) => {
      markArtworkExitComplete(layerId, 'ambient')
      markArtworkExitComplete(layerId, 'cover')
    },
    [markArtworkExitComplete],
  )
  const finishRetiringTrackCard = useCallback(() => {
    const retiring = retiringTrackCardSessionRef.current
    retiringTrackCardSessionRef.current = null
    retiringTrackCardAnimationRef.current?.stop()
    retiringTrackCardAnimationRef.current = null
    if (!retiring) return
    completeTrackCardExit(retiring.outgoingLayerId)
    setRetiredExitingLayerIds((current) => new Set(current).add(retiring.outgoingLayerId))
    setRetiringTrackCardSession(null)
  }, [completeTrackCardExit])
  useEffect(() => {
    if (!retiringTrackCardSession) return
    const remainingMs = Math.max(0, TRACK_CARD_SETTLE_DEADLINE_MS
      - (performance.now() - retiringTrackCardStartedAtRef.current))
    const timeoutId = window.setTimeout(() => {
      if (retiringTrackCardSessionRef.current === retiringTrackCardSession) finishRetiringTrackCard()
    }, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [finishRetiringTrackCard, retiringTrackCardSession])
  useEffect(() => {
    if (retiringTrackCardSession && !artworkSlots.some((layer) => (
      layer?.id === retiringTrackCardSession.outgoingLayerId && layer.phase === 'exiting'
    ))) finishRetiringTrackCard()
  }, [artworkSlots, finishRetiringTrackCard, retiringTrackCardSession])
  useEffect(() => () => {
    retiringTrackCardSessionRef.current = null
    retiringTrackCardAnimationRef.current?.stop()
    retiringTrackCardAnimationRef.current = null
  }, [])
  const selectionMatchesTrackCardSession = useCallback((
    session: TrackCardTransitionSession,
    incomingTrackId: string,
  ) => {
    const { trackId, sequence, intent } = latestTrackContextRef.current
    return Boolean(intent
      && trackId === incomingTrackId
      && intent.targetTrackId === incomingTrackId
      && intent.sequence === sequence
      && (session.kind === 'drag'
        ? session.key === `drag:${intent.previewTokenId}`
        : session.key === `selection:${intent.requestId}`))
  }, [])
  const canResumeInterruptedSettle = useCallback((settle: TrackCardSettleContext | null) => Boolean(
    settle?.target === 1
    && artworkSlotsRef.current.some((layer) => layer?.id === settle.session.outgoingLayerId && layer.phase === 'exiting')
    && artworkSlotsRef.current.some((layer) => layer?.id === settle.session.incomingLayerId
      && layer.phase === 'active' && selectionMatchesTrackCardSession(settle.session, layer.track.id)),
  ), [selectionMatchesTrackCardSession])
  const hasValidTrackCardSessionPair = useCallback((session: TrackCardTransitionSession) => {
    const outgoing = artworkSlotsRef.current.find((layer) => layer?.id === session.outgoingLayerId)
    const incoming = artworkSlotsRef.current.find((layer) => layer?.id === session.incomingLayerId)
    if (!outgoing || !incoming || outgoing.id === incoming.id) return false
    if (session.kind === 'automatic') return outgoing.phase === 'exiting'
      && incoming.phase === 'active'
      && selectionMatchesTrackCardSession(session, incoming.track.id)
    if ((outgoing.phase !== 'active' && outgoing.phase !== 'exiting')
      || (incoming.phase !== 'preview' && incoming.phase !== 'incoming' && incoming.phase !== 'active')) return false
    const settle = trackCardSettleRef.current
    if (settle?.session === session && settle.target === 1) {
      return selectionMatchesTrackCardSession(session, incoming.track.id)
    }
    if (coverDragRef.current && !coverDragRef.current.released) return true
    if (settle?.session === session && settle.target === 0) return true
    return false
  }, [selectionMatchesTrackCardSession])
  const toneLayer = artworkSlots.find((layer) => layer?.phase === 'active')
    ?? artworkSlots.find((layer) => layer?.phase === 'incoming')
    ?? artworkSlots.find((layer) => layer?.phase === 'exiting')
  const contentState = playback.contentState ?? (track ? 'track' : 'empty')
  const { appearance } = useAppearance()
  const appearanceMotion = useAppearanceMotion()
  const playlistOpen = playlist.isOpen
  const onPlaylistOpenChange = playlist.onOpenChange
  const playlistWindowOwnersRef = useRef<PlaylistWindowOwners>({ active: null, closing: null })
  useLayoutEffect(() => {
    const owners = playlistWindowOwnersRef.current
    if (playlistOpen) {
      // A rapid reopen can reuse the exiting keyed panel instead of mounting a new one.
      if (owners.active === null && owners.closing !== null) {
        owners.active = owners.closing
        owners.closing = null
      }
    } else if (owners.active !== null) {
      owners.closing = owners.active
      owners.active = null
    }
  }, [playlistOpen])
  const requestPlaylistOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen || !track || currentArtworkReady) {
      playlistCloseRequestedRef.current = false
      onPlaylistOpenChange(nextOpen)
      return
    }
    playlistCloseRequestedRef.current = true
  }, [currentArtworkReady, onPlaylistOpenChange, track])

  useEffect(() => {
    if (!playlistOpen) {
      playlistCloseRequestedRef.current = false
      return
    }
    if (!playlistCloseRequestedRef.current || !currentArtworkReady) return
    playlistCloseRequestedRef.current = false
    onPlaylistOpenChange(false)
  }, [currentArtworkReady, onPlaylistOpenChange, playlistOpen])
  const reduceMotion = useReducedMotion()
  const trackCardReducedMotion = Boolean(reduceMotion || appearanceMotion.disabled)
  const [nativeWindowState, setNativeWindowState] = useState<WindowLayoutState>({ maximized: false, fullscreen: false })
  const realPlaybackState: PlaybackVisualState = playback.isPlaying ? 'playing' : 'paused'
  const [pendingVisualPlaybackState, setPendingVisualPlaybackState] = useState<PlaybackVisualState | null>(null)
  const visualPlaybackState = pendingVisualPlaybackState ?? realPlaybackState
  const [playbackTransitionPending, setPlaybackTransitionPending] = useState(false)
  const playerStageRef = useRef<HTMLElement>(null)
  const playbackTransitionRequestRef = useRef<PlaybackTransitionRequest | null>(null)
  const playbackTransitionDuration = appearanceMotion.disabled || reduceMotion
    ? 0
    : PLAYBACK_VISUAL_TRANSITION_MS
  const playbackTransitionStyle: PlaybackTransitionStyle = {
    '--player-playback-transition-duration': `${playbackTransitionDuration}ms`,
    '--player-control-transition-duration': `${playbackTransitionDuration === 0 ? 0 : PLAYBACK_CONTROL_TRANSITION_MS}ms`,
  }
  const lyricLayoutKey = [
    appearance.player.lyricsFontScale,
    appearance.player.lyricsTightSpacing,
    appearance.player.lyricsNormalSpacing,
    appearance.player.lyricsTightThresholdSeconds,
  ].join(':')

  useLayoutEffect(() => {
    const deck = trackCardDeckRef.current
    if (!deck || activeArtworkLayerId === null) return
    const cover = deck.querySelector<HTMLElement>(
      `.track-card-plane[data-track-card-layer-id="${activeArtworkLayerId}"] .cover-frame`,
    )
    if (!cover) return
    let frameId: number | null = null
    const measure = () => {
      frameId = null
      const layoutPosition = (element: HTMLElement) => {
        let x = 0
        let y = 0
        let current: HTMLElement | null = element
        while (current) {
          x += current.offsetLeft
          y += current.offsetTop
          current = current.offsetParent as HTMLElement | null
        }
        return { x, y }
      }
      const deckPosition = layoutPosition(deck)
      const coverPosition = layoutPosition(cover)
      const width = cover.offsetWidth
      const height = cover.offsetHeight
      const perspective = Number.parseFloat(getComputedStyle(deck).perspective)
      if (
        !Number.isFinite(width)
        || width <= 1
        || !Number.isFinite(height)
        || height <= 1
        || !Number.isFinite(perspective)
        || perspective <= 1
      ) return
      const next = {
        width,
        height,
        centerX: coverPosition.x - deckPosition.x + width / 2,
        centerY: coverPosition.y - deckPosition.y + height / 2,
        perspective,
      }
      setTrackCardCoverGeometry((current) => (
        current
        && Math.abs(current.width - next.width) < 0.25
        && Math.abs(current.height - next.height) < 0.25
        && Math.abs(current.centerX - next.centerX) < 0.25
        && Math.abs(current.centerY - next.centerY) < 0.25
        && Math.abs(current.perspective - next.perspective) < 0.25
          ? current
          : next
      ))
    }
    const scheduleMeasure = () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(deck)
    observer.observe(cover)
    scheduleMeasure()
    return () => {
      observer.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [activeArtworkLayerId, visualPlaybackState])

  const stopTrackCardAnimation = useCallback((clearSettle = true) => {
    // This monotonic run id is also the settle id: all completion callbacks are
    // fenced by it inside animateTrackCardProgress.
    trackCardRunIdRef.current += 1
    if (trackCardStartFrameRef.current !== null) {
      cancelAnimationFrame(trackCardStartFrameRef.current)
      trackCardStartFrameRef.current = null
    }
    trackCardAnimationRef.current?.stop()
    trackCardAnimationRef.current = null
    trackCardOvershootAnimationRef.current?.stop()
    trackCardOvershootAnimationRef.current = null
    if (clearSettle) trackCardSettleRef.current = null
  }, [])

  useEffect(() => stopTrackCardAnimation, [stopTrackCardAnimation])

  const animateTrackCardProgress = useCallback((
    target: number,
    durationSeconds: number,
    onComplete: () => void,
    overshootPx = 0,
  ) => {
    stopTrackCardAnimation(false)
    const runId = trackCardRunIdRef.current
    const overshootReturnSeconds = TRACK_CARD_OVERSHOOT_SECONDS * appearance.motion.durationScale
    if (durationSeconds <= 0) {
      trackCardProgress.set(target)
      trackCardOvershootX.set(0)
      if (trackCardRunIdRef.current === runId) onComplete()
      return
    }
    let progressComplete = false
    let residualOvershootComplete = trackCardOvershootX.get() === 0
    if (overshootPx !== 0) {
      trackCardOvershootX.set(0)
      trackCardOvershootAnimationRef.current = animate(trackCardOvershootX, overshootPx, {
        duration: durationSeconds,
        ease: 'easeIn',
      })
    } else if (trackCardOvershootX.get() !== 0) {
      // An interrupted fast settle keeps its painted x until the pointer
      // handoff is known. Ease that residual translation away on rollback.
      trackCardOvershootAnimationRef.current = animate(trackCardOvershootX, 0, {
        duration: Math.min(durationSeconds, overshootReturnSeconds),
        ease: 'easeOut',
        onComplete: () => {
          if (trackCardRunIdRef.current !== runId) return
          trackCardOvershootAnimationRef.current = null
          residualOvershootComplete = true
          if (progressComplete) onComplete()
        },
      })
    }
    const controls = animate(trackCardProgress, target, {
      duration: durationSeconds,
      // A canceled drag returns from its release pose with a visible,
      // decelerating finish. Completed transitions keep their linear timeline
      // because card opacity owns exact 10%/90% timing windows.
      ease: target === 0 ? 'easeOut' : 'linear',
      onComplete: () => {
        if (trackCardRunIdRef.current !== runId) return
        if (trackCardAnimationRef.current === controls) trackCardAnimationRef.current = null
        if (overshootPx === 0) {
          progressComplete = true
          if (residualOvershootComplete) onComplete()
          return
        }
        trackCardOvershootAnimationRef.current?.stop()
        trackCardOvershootAnimationRef.current = animate(trackCardOvershootX, 0, {
          duration: overshootReturnSeconds,
          ease: 'easeOut',
          onComplete: () => {
            if (trackCardRunIdRef.current !== runId) return
            trackCardOvershootAnimationRef.current = null
            onComplete()
          },
        })
      },
    })
    trackCardAnimationRef.current = controls
  }, [appearance.motion.durationScale, stopTrackCardAnimation, trackCardOvershootX, trackCardProgress])

  const runTrackCardSettle = useCallback((context: TrackCardSettleContext) => {
    trackCardSettleRef.current = context
    coverInteractionPhaseRef.current = 'settling'
    const distance = Math.abs(context.target - trackCardProgress.get())
    // Scaling a sub-threshold rollback by distance reduced it to 29–53 ms.
    // The release pose already encodes the traveled distance; animate that
    // pose all the way home on the cancellation timeline instead.
    const durationSeconds = context.target === 0
      ? context.durationSeconds * appearance.motion.durationScale
      : context.durationSeconds * Math.max(0.15, distance)
    animateTrackCardProgress(
      context.target,
      durationSeconds,
      () => {
        if (trackCardSettleRef.current !== context) return
        trackCardSettleRef.current = null
        coverInteractionPhaseRef.current = coverDragRef.current && !coverDragRef.current.released
          ? 'dragging' : 'idle'
        context.onComplete()
      },
      context.target === 1 ? context.overshootPx : 0,
    )
  }, [animateTrackCardProgress, appearance.motion.durationScale, trackCardProgress])

  const hardResetTrackCardInteraction = useCallback(() => {
    const gesture = coverDragRef.current
    coverDragRef.current = null
    if (gesture) {
      gesture.released = true
      if (gesture.captureElement.hasPointerCapture(gesture.pointerId)) {
        gesture.captureElement.releasePointerCapture(gesture.pointerId)
      }
    }
    const tokenId = gesture?.token?.id ?? trackCardPreviewToken?.id ?? -1
    discardTrackPreview?.(tokenId)
    finishRetiringTrackCard()
    stopTrackCardAnimation()
    trackCardSettleRef.current = null
    suppressCoverClickRef.current = false
    setCoverDragActive(false)
    coverInteractionPhaseRef.current = 'idle'
    setMoreMenuOpen(false)
    setTrackCardPreviewToken(null)
    publishTrackCardSession(null)
    trackCardProgress.set(0)
    trackCardOvershootX.set(0)
  }, [discardTrackPreview, finishRetiringTrackCard, publishTrackCardSession, stopTrackCardAnimation, trackCardPreviewToken?.id, trackCardOvershootX, trackCardProgress])

  const handleMoreOpenChange = useCallback((open: boolean) => {
    if (open) hardResetTrackCardInteraction()
    setMoreMenuOpen(open)
  }, [hardResetTrackCardInteraction])

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const previous = observedTrackContextRef.current
      const current = latestTrackContextRef.current
      observedTrackContextRef.current = {
        trackId: current.trackId,
        sequence: current.sequence,
      }
      if (previous.trackId === current.trackId && previous.sequence === current.sequence) return
      const isNavigationTransition = Boolean(
        current.intent
        && current.intent.targetTrackId === current.trackId
        && current.intent.sequence === current.sequence,
      )
      if (!isNavigationTransition) hardResetTrackCardInteraction()
    })
    return () => cancelAnimationFrame(frameId)
  }, [
    hardResetTrackCardInteraction,
    playback.selectionActivitySequence,
    playback.selectionVisualIntent,
    track?.id,
  ])

  const discardCoverDrag = useCallback((animateBack = true) => {
    const gesture = coverDragRef.current
    if (gesture?.deferredHandoff) {
      // The pointer never became a drag, so it never acquired the old pair.
      // Releasing it must not stop or rewind the committed settle.
      coverDragRef.current = null
      gesture.released = true
      if (gesture.captureElement.hasPointerCapture(gesture.pointerId)) {
        gesture.captureElement.releasePointerCapture(gesture.pointerId)
      }
      setCoverDragActive(false)
      suppressCoverClickRef.current = false
      coverInteractionPhaseRef.current = trackCardSettleRef.current ? 'settling' : 'idle'
      return
    }
    const session = trackCardSessionRef.current
    // A released pointer is no longer a live gesture, but its painted pair
    // still owns progress until the rollback reaches zero. Capture that
    // ownership before clearing the pointer ref/released flag below.
    const canAnimateBack = Boolean(
      animateBack
      && gesture?.targetReady
      && gesture.token
      && session?.kind === 'drag'
      && session.key === `drag:${gesture.token.id}`
      && session.direction === gesture.direction
      && artworkSlotsRef.current.some((layer) => layer?.id === session.outgoingLayerId
        && layer.phase === 'active' && layer.track.id === gesture.originTrackId)
      && artworkSlotsRef.current.some((layer) => layer?.id === session.incomingLayerId
        && layer.phase === 'preview' && layer.previewTokenId === gesture.token?.id),
    )
    coverDragRef.current = null
    setCoverDragActive(false)
    suppressCoverClickRef.current = false
    if (!gesture) return
    gesture.released = true
    if (gesture.captureElement.hasPointerCapture(gesture.pointerId)) {
      gesture.captureElement.releasePointerCapture(gesture.pointerId)
    }
    const cleanup = () => {
      discardTrackPreview?.(gesture.token?.id ?? -1)
      const waitingRollbackGesture = coverDragRef.current?.interruptedRollbackTokenId === gesture.token?.id
        ? coverDragRef.current : null
      if (waitingRollbackGesture) waitingRollbackGesture.interruptedRollbackTokenId = null
      suppressCoverClickRef.current = false
      if (gesture.handoffPose && canResumeInterruptedSettle(gesture.interruptedSettle)) {
        setTrackCardPreviewToken((current) => current?.id === gesture.token?.id ? null : current)
        trackCardOvershootX.set(gesture.interruptedOvershootX)
        publishTrackCardSession(gesture.interruptedSettle!.session)
        trackCardProgress.set(gesture.handoffPose.sessionProgress)
        runTrackCardSettle(gesture.interruptedSettle!)
        return
      }
      const clearSession = () => {
        // Drop render roles before resetting the shared MotionValue.
        flushSync(() => {
          setTrackCardPreviewToken((current) => current?.id === gesture.token?.id ? null : current)
          if (trackCardSessionRef.current) publishTrackCardSession(null)
        })
        trackCardProgress.set(0)
        trackCardOvershootX.set(0)
        if (waitingRollbackGesture && coverDragRef.current === waitingRollbackGesture) {
          waitingRollbackGesture.deferredHandoff = false
        }
        coverInteractionPhaseRef.current = coverDragRef.current && !coverDragRef.current.released
          ? 'dragging' : 'idle'
      }
      const activeLayer = artworkSlotsRef.current.find((layer) => layer?.id === gesture.handoffLayerId
        && layer.phase === 'active' && layer.track.id === gesture.originTrackId)
      if (gesture.handoffPose && activeLayer) {
        // The old incoming card was caught before it reached the centre.
        // Rolling the new drag back to zero only reaches that captured pose;
        // give the card its remaining trip home before dropping its role.
        const recenterSession: TrackCardTransitionSession = {
          key: `recenter:${gesture.gestureId}`,
          outgoingLayerId: activeLayer.id,
          incomingLayerId: -1,
          direction: gesture.direction ?? 1,
          kind: 'drag',
          outgoingHandoff: gesture.handoffPose,
          outgoingReturnToCenter: true,
        }
        flushSync(() => {
          setTrackCardPreviewToken((current) => current?.id === gesture.token?.id ? null : current)
          publishTrackCardSession(recenterSession)
        })
        trackCardProgress.set(0)
        trackCardOvershootX.set(0)
        runTrackCardSettle({
          session: recenterSession,
          target: 1,
          durationSeconds: trackCardReducedMotion ? 0 : TRACK_CARD_RECENTER_SECONDS,
          onComplete: clearSession,
        })
        return
      }
      clearSession()
    }
    if (canAnimateBack && session) {
      runTrackCardSettle({
        session,
        target: 0,
        durationSeconds: trackCardReducedMotion ? 0 : TRACK_CARD_CANCEL_SECONDS,
        onComplete: cleanup,
      })
    } else {
      stopTrackCardAnimation()
      trackCardSettleRef.current = null
      cleanup()
    }
  }, [canResumeInterruptedSettle, discardTrackPreview, publishTrackCardSession, runTrackCardSettle, stopTrackCardAnimation, trackCardOvershootX, trackCardProgress, trackCardReducedMotion])

  const commitCoverDrag = useCallback((gesture: CoverDragGesture, releaseVelocityX: number) => {
    const activeSession = trackCardSessionRef.current
    if (
      !gesture.token
      || !gesture.direction
      || gesture.token.direction !== gesture.direction
      || !activeSession
      || activeSession.kind !== 'drag'
      || activeSession.direction !== gesture.direction
    ) {
      discardCoverDrag(false)
      return
    }
    coverDragRef.current = null
    setCoverDragActive(false)
    const accepted = commitTrackPreview?.(gesture.token.id) ?? false
    if (!accepted) {
      coverDragRef.current = gesture
      discardCoverDrag(true)
      return
    }
    const interruptedOutgoingId = gesture.interruptedSettle?.session.outgoingLayerId
    if (interruptedOutgoingId !== undefined && interruptedOutgoingId !== activeSession.outgoingLayerId) {
      completeTrackCardExit(interruptedOutgoingId)
    }
    runTrackCardSettle({
      session: activeSession,
      target: 1,
      durationSeconds: trackCardReducedMotion ? 0.08 : TRACK_CARD_DURATION_SECONDS,
      overshootPx: !trackCardReducedMotion && -releaseVelocityX * gesture.direction >= TRACK_CARD_OVERSHOOT_VELOCITY
        ? -gesture.direction * gesture.coverWidth * TRACK_CARD_OVERSHOOT_WIDTH
        : 0,
      onComplete: () => {
        // Keep the completed pose until React has committed removal of the
        // exiting layer. The stale-session effect clears the session and
        // resets progress on the following frame, after the old DOM subscriber
        // can no longer jump back to its progress=0 pose.
        completeTrackCardExit(activeSession.outgoingLayerId)
      },
    })
  }, [commitTrackPreview, completeTrackCardExit, discardCoverDrag, runTrackCardSettle, trackCardReducedMotion])

  const handleCoverPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const coverFrame = (event.target as HTMLElement).closest<HTMLElement>('.cover-frame')
    if (
      event.button !== 0
      || !track
      || !prepareTrackPreview
      || !trackCardGeometryReady
      || !coverFrame
      || !event.currentTarget.contains(coverFrame)
      || (event.target as HTMLElement).closest('button, [role="button"], a, input')
    ) return
    // A committed preview can advance the logical track before its artwork
    // becomes active. Do not start a new pair from the previous track's card.
    if (!artworkSlots.some((layer) => layer?.phase === 'active' && layer.track.id === track.id)) return
    let interruptedSession = trackCardSessionRef.current
    let interruptedSettle = trackCardSettleRef.current
    const interruptedProgress = trackCardProgress.get()
    // A press during rollback has not chosen a new drag yet. Keep the old
    // pair moving until the pointer crosses the lock threshold, then hand its
    // current pose to the new gesture instead of snapping progress to zero.
    const interruptedRollbackTokenId = interruptedSettle?.target === 0
      && interruptedSettle.session === interruptedSession
      && trackCardPreviewToken
      && interruptedSession?.key === `drag:${trackCardPreviewToken.id}`
      && artworkSlots.some((layer) => layer?.id === interruptedSession?.outgoingLayerId
        && layer?.phase === 'active' && layer.track.id === track.id)
      && artworkSlots.some((layer) => layer?.id === interruptedSession?.incomingLayerId
        && layer?.phase === 'preview' && layer.previewTokenId === trackCardPreviewToken.id)
      ? trackCardPreviewToken.id : null
    const deferredHandoff = Boolean(interruptedSession && (
      canResumeInterruptedSettle(interruptedSettle)
      || interruptedRollbackTokenId !== null
      || (interruptedSession.outgoingReturnToCenter
        && artworkSlots.some((layer) => layer?.id === interruptedSession?.outgoingLayerId
          && layer?.phase === 'active' && layer.track.id === track.id))
    ))
    if (interruptedSession && !deferredHandoff) {
      const outgoingIsExiting = artworkSlots.some((layer) => (
        layer?.id === interruptedSession?.outgoingLayerId && layer?.phase === 'exiting'
      ))
      // A completed settle clears its context before React necessarily removes
      // the outgoing layer. Retire that session synchronously before the new
      // gesture is allowed to reset the shared MotionValue; otherwise the old
      // outgoing subscriber still has a role and jumps back to progress zero.
      stopTrackCardAnimation()
      const completedOutgoingLayerId = interruptedSession.outgoingLayerId
      flushSync(() => {
        if (outgoingIsExiting) completeTrackCardExit(completedOutgoingLayerId)
        publishTrackCardSession(null)
        setTrackCardPreviewToken(null)
      })
      trackCardProgress.set(0)
      trackCardOvershootX.set(0)
      interruptedSession = null
      interruptedSettle = null
    }
    const plane = coverFrame.closest<HTMLElement>('.track-card-plane')
    const planeLayerId = Number.parseInt(plane?.dataset.trackCardLayerId ?? '', 10)
    const handoffLayerId = Number.isInteger(planeLayerId) ? planeLayerId : null
    const handoffRole: TrackCardRole | null = interruptedSession && handoffLayerId !== null
      ? interruptedSession.outgoingLayerId === handoffLayerId
        ? 'outgoing'
        : interruptedSession.incomingLayerId === handoffLayerId ? 'incoming' : null
      : null
    const regularHandoffPose = handoffRole && interruptedSession && trackCardCoverGeometry
      ? getTrackCardPose(
          handoffRole,
          interruptedSession.direction,
          interruptedProgress,
          trackCardCoverGeometry.width,
          trackCardReducedMotion,
          trackCardCoverGeometry.height,
          trackCardCoverGeometry.perspective,
        )
      : null
    const handoffPose = regularHandoffPose && handoffRole && interruptedSession
      ? {
          pose: handoffRole === 'outgoing' && interruptedSession.outgoingHandoff
            ? mixTrackCardPose(interruptedSession.outgoingHandoff.pose, regularHandoffPose, interruptedProgress)
            : handoffRole === 'incoming'
              ? { ...regularHandoffPose, xPx: regularHandoffPose.xPx + trackCardOvershootX.get() }
              : regularHandoffPose,
          opacity: handoffRole === 'outgoing' && interruptedSession.outgoingHandoff
            ? interruptedSession.outgoingHandoff.opacity
              + (getTrackCardOpacity(handoffRole, interruptedProgress) - interruptedSession.outgoingHandoff.opacity)
                * interruptedProgress
            : getTrackCardOpacity(handoffRole, interruptedProgress),
          sessionProgress: interruptedProgress,
        } satisfies TrackCardHandoffPose
      : null
    // A press is not yet a new drag. Let the committed A→B animation finish
    // unless this pointer actually crosses the direction lock threshold.
    if (!deferredHandoff) stopTrackCardAnimation()
    // The deck survives preview insertion and active/incoming phase changes.
    // Keeping capture here prevents a layer hand-off from terminating the
    // gesture merely because the card subtree changed its interaction role.
    event.currentTarget.setPointerCapture(event.pointerId)
    const now = performance.now()
    lastCoverDragGestureId += 1
    coverDragRef.current = {
      gestureId: lastCoverDragGestureId,
      revision: 0,
      pointerId: event.pointerId,
      captureElement: event.currentTarget,
      originTrackId: track.id,
      startX: event.clientX,
      latestX: event.clientX,
      latestAt: now,
      velocityX: 0,
      coverWidth: Math.max(1, trackCardCoverGeometry?.width ?? coverFrame.offsetWidth),
      direction: null,
      token: null,
      progress: 0,
      signedProgress: 0,
      moved: false,
      released: false,
      captureRecoveryAttempts: 0,
      deferredHandoff,
      interruptedRollbackTokenId,
      interruptedSettle: canResumeInterruptedSettle(interruptedSettle)
        ? { ...interruptedSettle!, overshootPx: 0 }
        : null,
      interruptedOvershootX: trackCardOvershootX.get(),
      handoffLayerId,
      handoffPose: deferredHandoff ? null : handoffPose,
      targetReady: false,
    }
    setCoverDragActive(true)
    coverInteractionPhaseRef.current = 'dragging'
    suppressCoverClickRef.current = false
  }, [artworkSlots, canResumeInterruptedSettle, completeTrackCardExit, prepareTrackPreview, publishTrackCardSession, stopTrackCardAnimation, track, trackCardCoverGeometry, trackCardGeometryReady, trackCardOvershootX, trackCardPreviewToken, trackCardProgress, trackCardReducedMotion])

  const handleCoverPointerMove = useCallback((event: CoverPointerSample) => {
    const gesture = coverDragRef.current
    if (
      coverInteractionPhaseRef.current !== 'dragging'
      || !gesture
      || gesture.pointerId !== event.pointerId
      || gesture.released
    ) return
    const integrated = integrateTrackCardPointer({
      latestX: gesture.latestX,
      latestAt: gesture.latestAt,
      velocityX: gesture.velocityX,
      viewportPosition: gesture.signedProgress,
    }, {
      clientX: event.clientX,
      at: performance.now(),
    }, gesture.coverWidth)
    gesture.velocityX = integrated.velocityX
    gesture.latestX = integrated.latestX
    gesture.latestAt = integrated.latestAt
    const directionPosition = gesture.direction && !gesture.targetReady
      ? Math.min(0.96, Math.max(-0.96, (gesture.startX - event.clientX) / (gesture.coverWidth * 0.55)))
      : integrated.viewportPosition
    if (gesture.targetReady || !gesture.direction) {
      gesture.signedProgress = integrated.viewportPosition
      gesture.progress = Math.abs(gesture.signedProgress)
    }
    const nextDirection = trackCardDirection(
      directionPosition,
      gesture.coverWidth,
      TRACK_CARD_DRAG_LOCK_PX,
    )

    if (nextDirection && gesture.deferredHandoff) {
      const oldSession = trackCardSessionRef.current
      const oldProgress = trackCardProgress.get()
      const currentLayer = artworkSlotsRef.current.find((layer) => (
        layer?.phase === 'active' && layer.track.id === gesture.originTrackId
      ))
      const oldOutgoing = artworkSlotsRef.current.find((layer) => layer?.id === oldSession?.outgoingLayerId)
      const oldRole: TrackCardRole | null = currentLayer && oldSession
        ? oldSession.incomingLayerId === currentLayer.id ? 'incoming'
          : oldSession.outgoingLayerId === currentLayer.id ? 'outgoing' : null
        : null
       const regularPose = oldRole && oldSession && trackCardCoverGeometry
         ? getTrackCardPose(
             oldRole, oldSession.direction,
             oldRole === 'outgoing' && oldSession.outgoingReturnToCenter ? 0 : oldProgress,
            trackCardCoverGeometry.width, trackCardReducedMotion,
            trackCardCoverGeometry.height, trackCardCoverGeometry.perspective,
          )
        : null
      gesture.handoffPose = regularPose && oldRole && oldSession
        ? {
            pose: oldRole === 'outgoing' && oldSession.outgoingHandoff
              ? mixTrackCardPose(oldSession.outgoingHandoff.pose, regularPose, oldProgress)
              : oldRole === 'incoming'
                ? { ...regularPose, xPx: regularPose.xPx + trackCardOvershootX.get() }
                : regularPose,
             opacity: oldRole === 'outgoing' && oldSession.outgoingHandoff
               ? oldSession.outgoingHandoff.opacity
                 + ((oldSession.outgoingReturnToCenter ? 1 : getTrackCardOpacity(oldRole, oldProgress))
                   - oldSession.outgoingHandoff.opacity) * oldProgress
               : getTrackCardOpacity(oldRole, oldProgress),
            sessionProgress: oldProgress,
          }
        : null
      gesture.handoffLayerId = currentLayer?.id ?? null
      gesture.interruptedSettle = null
      gesture.deferredHandoff = false
      stopTrackCardAnimation()
      finishRetiringTrackCard()
      const retiringSession = oldOutgoing?.phase === 'exiting' ? oldSession : null
      if (retiringSession) retiringTrackCardProgress.set(oldProgress)
      const intent = currentLayer?.transitionIntent
      const retiredSession: TrackCardTransitionSession | null = oldSession && intent
        ? {
            key: `selection:${intent.requestId}`,
            outgoingLayerId: oldSession.outgoingLayerId,
            incomingLayerId: currentLayer.id,
            direction: intent.direction,
            kind: 'automatic',
          }
        : oldSession
      flushSync(() => {
        if (retiringSession) {
          retiringTrackCardStartedAtRef.current = performance.now()
          retiringTrackCardSessionRef.current = retiringSession
          setRetiringTrackCardSession(retiringSession)
        }
        if (retiredSession) {
          retiredTrackCardSessionRef.current = retiredSession
          setRetiredTrackCardSession(retiredSession)
        }
        setTrackCardPreviewToken(null)
        publishTrackCardSession(currentLayer ? {
          key: `pending:${gesture.gestureId}:${gesture.revision + 1}`,
          outgoingLayerId: currentLayer.id,
          incomingLayerId: -1,
          direction: nextDirection,
          kind: 'drag',
          outgoingHandoff: gesture.handoffPose ?? undefined,
        } : null)
      })
      // The old rollback callback no longer runs after this handoff, so its
      // preview lease must be retired by the new gesture.
      if (gesture.interruptedRollbackTokenId !== null) {
        discardTrackPreview?.(gesture.interruptedRollbackTokenId)
        gesture.interruptedRollbackTokenId = null
      }
      trackCardProgress.set(0)
      trackCardOvershootX.set(0)
      if (retiringSession) {
        if (oldProgress >= 0.999) {
          finishRetiringTrackCard()
        } else {
          retiringTrackCardAnimationRef.current = animate(retiringTrackCardProgress, 1, {
            duration: TRACK_CARD_DURATION_SECONDS * Math.max(0.15, 1 - oldProgress),
            ease: 'linear',
            onComplete: () => {
              if (retiringTrackCardSessionRef.current === retiringSession) finishRetiringTrackCard()
            },
          })
        }
      }
    }

    if (nextDirection !== gesture.direction) {
      gesture.revision += 1
      const revision = gesture.revision
      const gestureId = gesture.gestureId
      if (gesture.token) discardTrackPreview?.(gesture.token.id)
      else if (gesture.direction) discardTrackPreview?.(-1)
      gesture.token = null
      gesture.targetReady = false
      gesture.direction = nextDirection
      setTrackCardPreviewToken(null)
      stopTrackCardAnimation()
      if (!nextDirection) {
        if (gesture.handoffPose && canResumeInterruptedSettle(gesture.interruptedSettle)) {
          trackCardOvershootX.set(gesture.interruptedOvershootX)
          publishTrackCardSession(gesture.interruptedSettle!.session)
          trackCardProgress.set(gesture.handoffPose.sessionProgress)
        } else if (gesture.handoffPose) {
          // Retain the captured incoming pose until release. Clearing this
          // role here would snap the half-entered card to the centre.
          trackCardProgress.set(0)
          trackCardOvershootX.set(0)
        } else {
          publishTrackCardSession(null)
          trackCardProgress.set(0)
          trackCardOvershootX.set(0)
        }
        return
      }
      gesture.moved = true
      suppressCoverClickRef.current = true
      // The direction can lock before the adjacent real cover is painted.
      // Keep the current card at rest; there is no outgoing-only drag session.
      gesture.signedProgress = 0
      gesture.progress = 0
      if (!gesture.handoffPose || !canResumeInterruptedSettle(gesture.interruptedSettle)) trackCardProgress.set(0)
      const requestedDirection = nextDirection
      void prepareTrackPreview?.(requestedDirection).then((token) => {
        const activeGesture = coverDragRef.current
        const requestIsCurrent = Boolean(
          activeGesture
          && activeGesture.gestureId === gestureId
          && activeGesture.revision === revision
          && !activeGesture.released
          && activeGesture.direction === requestedDirection
          && activeGesture.originTrackId === gesture.originTrackId,
        )
        if (!requestIsCurrent) {
          if (token) discardTrackPreview?.(token.id)
          return
        }
        if (!token) {
          return
        }
        if (
          token.direction !== requestedDirection
          || token.originTrackId !== gesture.originTrackId
        ) {
          discardTrackPreview?.(token.id)
          return
        }
        gesture.token = token
        flushSync(() => setTrackCardPreviewToken(token))
      })
      return
    }
    if (!gesture.direction) return
    if (!gesture.targetReady) {
      gesture.signedProgress = 0
      gesture.progress = 0
      return
    }
    const activeSession = trackCardSessionRef.current
    if (activeSession?.kind === 'drag') {
      trackCardProgress.set(gesture.progress)
    }
  }, [canResumeInterruptedSettle, discardTrackPreview, finishRetiringTrackCard, prepareTrackPreview, publishTrackCardSession, retiringTrackCardProgress, stopTrackCardAnimation, trackCardCoverGeometry, trackCardOvershootX, trackCardProgress, trackCardReducedMotion])

  const handleCoverPointerUp = useCallback((event: CoverPointerSample) => {
    let gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.released) return
    if (coverInteractionPhaseRef.current !== 'dragging') {
      discardCoverDrag(true)
      return
    }
    // WebView may coalesce the last move into pointerup. Always integrate that
    // physical coordinate before deciding direction, velocity or commitment.
    const releaseAt = performance.now()
    const finalDeltaX = event.clientX - gesture.latestX
    const previousVelocityX = gesture.velocityX
    const sampleAgeMs = releaseAt - gesture.latestAt
    handleCoverPointerMove(event)
    gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const releaseVelocityX = sampleAgeMs > TRACK_CARD_RELEASE_FRESH_MS
      ? finalDeltaX / (sampleAgeMs / 1000)
      : Math.abs(finalDeltaX) >= TRACK_CARD_DRAG_LOCK_PX
        ? gesture.velocityX
        : previousVelocityX
    gesture.released = true
    if (gesture.captureElement.hasPointerCapture(event.pointerId)) {
      gesture.captureElement.releasePointerCapture(event.pointerId)
    }
    const displacement = gesture.progress * gesture.coverWidth * 0.55
    const finalDirection = trackCardDirection(
      gesture.signedProgress,
      gesture.coverWidth,
      TRACK_CARD_DRAG_LOCK_PX,
    )
    const commitRequested = Boolean(
      finalDirection
      && gesture.direction === finalDirection
      && trackCardGeometryReady
      && (
        gesture.progress >= TRACK_CARD_COMMIT_PROGRESS
        || (Math.abs(gesture.velocityX) >= TRACK_CARD_COMMIT_VELOCITY && displacement >= 24)
      ),
    )
    if (!gesture.targetReady || !commitRequested) {
      discardCoverDrag(gesture.targetReady)
      return
    }
    const activeSession = trackCardSessionRef.current
    const previewLayer = gesture.token
      ? artworkSlots.find((layer) => (
          layer?.phase === 'preview'
          && layer.previewTokenId === gesture.token?.id
        ))
      : null
    const previewLayerReady = Boolean(
      gesture.token
      && gesture.token.direction === finalDirection
      && activeSession?.kind === 'drag'
      && activeSession.key === `drag:${gesture.token.id}`
      && previewLayer
      && activeSession.incomingLayerId === previewLayer.id,
    )
    // Pointer release has exactly two bounded outcomes. A fully hydrated,
    // token-matched layer pair continues from the pointer-owned pose; every
    // other state immediately starts the existing rollback settle. Keeping a
    // released gesture alive while waiting for artwork would leave progress
    // ownerless if that asynchronous request never obtained a canvas lease.
    if (previewLayerReady) commitCoverDrag(gesture, releaseVelocityX)
    else discardCoverDrag(true)
  }, [artworkSlots, commitCoverDrag, discardCoverDrag, handleCoverPointerMove, trackCardGeometryReady])

  const handleCoverPointerCancel = useCallback(() => {
    if (coverDragRef.current?.released) return
    discardCoverDrag(true)
  }, [discardCoverDrag])
  const handleCoverLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.released) return
    // WebView may release capture while replacing a child card. Recover once
    // while the pointer is still pressed; a failed or repeated loss cannot
    // safely wait for a pointerup that may occur outside this window.
    if (event.buttons !== 0 && gesture.captureRecoveryAttempts === 0 && gesture.captureElement.isConnected) {
      gesture.captureRecoveryAttempts += 1
      try {
        gesture.captureElement.setPointerCapture(event.pointerId)
        if (gesture.captureElement.hasPointerCapture(event.pointerId)) return
      } catch {
        // The pointer is no longer active, so finish through rollback below.
      }
    }
    discardCoverDrag(true)
  }, [discardCoverDrag])
  const handleCoverClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressCoverClickRef.current) return
    suppressCoverClickRef.current = false
    if ((event.target as HTMLElement).closest('button, [role="button"], a, input')) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const coverDragProps = useMemo(() => ({
    onPointerDown: handleCoverPointerDown,
    onPointerMove: handleCoverPointerMove,
    onPointerUp: handleCoverPointerUp,
    onPointerCancel: handleCoverPointerCancel,
    onLostPointerCapture: handleCoverLostPointerCapture,
    onClickCapture: handleCoverClickCapture,
  }), [
    handleCoverClickCapture,
    handleCoverPointerCancel,
    handleCoverLostPointerCapture,
    handleCoverPointerDown,
    handleCoverPointerMove,
    handleCoverPointerUp,
  ])

  useEffect(() => {
    if (!coverDragActive) return
    const handleWindowPointerMove = (event: PointerEvent) => {
      const gesture = coverDragRef.current
      if (!gesture || gesture.pointerId !== event.pointerId || event.buttons !== 0) return
      // A hover event with no pressed buttons proves the release was missed,
      // even when WebView still incorrectly reports pointer capture. Its new
      // coordinate is no longer a drag sample, so only roll back the preview.
      discardCoverDrag(true)
    }
    const handleWindowPointerUp = (event: PointerEvent) => {
      const gesture = coverDragRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      handleCoverPointerUp(event)
    }
    const handleWindowPointerCancel = (event: PointerEvent) => {
      const gesture = coverDragRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      handleCoverPointerCancel()
    }
    // Capture release before a synchronous preview/session render can change
    // the event target subtree. The React handler becomes a harmless no-op
    // after this path clears the gesture.
    window.addEventListener('pointermove', handleWindowPointerMove, true)
    window.addEventListener('pointerup', handleWindowPointerUp, true)
    window.addEventListener('pointercancel', handleWindowPointerCancel, true)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove, true)
      window.removeEventListener('pointerup', handleWindowPointerUp, true)
      window.removeEventListener('pointercancel', handleWindowPointerCancel, true)
    }
  }, [coverDragActive, discardCoverDrag, handleCoverPointerCancel, handleCoverPointerUp])

  useLayoutEffect(() => {
    if (!trackCardPreviewToken || !previewArtworkReady) return
    const gesture = coverDragRef.current
    const outgoing = artworkSlots.find((layer) => layer?.phase === 'active')
    const incoming = artworkSlots.find((layer) => layer?.previewTokenId === trackCardPreviewToken.id)
    if (
      !gesture
      || gesture.released
      || !outgoing
      || !incoming
      || gesture.token?.id !== trackCardPreviewToken.id
      || gesture.direction !== trackCardPreviewToken.direction
      || gesture.token.direction !== gesture.direction
      || gesture.token.originTrackId !== gesture.originTrackId
    ) return
    const session: TrackCardTransitionSession = {
      key: `drag:${trackCardPreviewToken.id}`,
      outgoingLayerId: outgoing.id,
      incomingLayerId: incoming.id,
      direction: trackCardPreviewToken.direction,
      kind: 'drag',
      outgoingHandoff: gesture.handoffPose ?? undefined,
    }
    const activeSession = trackCardSessionRef.current
    const sessionIsCurrent = Boolean(
      activeSession
      && activeSession.key === session.key
      && activeSession.outgoingLayerId === session.outgoingLayerId
      && activeSession.incomingLayerId === session.incomingLayerId
      && activeSession.direction === session.direction
      && activeSession.kind === session.kind,
    )
    // Resource refreshes can rerun this layout effect for the same painted
    // pair. Resetting an already live gesture would jump its progress to zero.
    if (gesture.targetReady && sessionIsCurrent) return
    // The pointer handoff already initialized the shared MotionValues before
    // this preview can paint. A layout effect cannot flush React's pending
    // session update; writing progress here would notify the old DOM roles.
    if (!sessionIsCurrent) publishTrackCardSession(session)
    // The pointer has kept moving while the target canvas was prepared. Keep
    // the displacement from pointerdown: rebasing startX here makes a slow
    // drag lose most of its distance and fail the release threshold.
    gesture.targetReady = true
    gesture.signedProgress = Math.min(0.96, Math.max(-0.96,
      (gesture.startX - gesture.latestX) / (gesture.coverWidth * 0.55),
    ))
    gesture.progress = Math.abs(gesture.signedProgress)
    gesture.velocityX = 0
    gesture.latestAt = performance.now()
  }, [artworkSlots, previewArtworkReady, publishTrackCardSession, trackCardPreviewToken])

  useLayoutEffect(() => {
    const gesture = coverDragRef.current
    if (
      !gesture?.targetReady
      || gesture.released
      || !gesture.token
      || trackCardSession?.key !== `drag:${gesture.token.id}`
      || trackCardSessionRef.current !== trackCardSession
    ) return
    // The new pair's subscribers are mounted now. Applying the accumulated
    // distance in the readiness effect would move the previous pair instead.
    trackCardProgress.set(gesture.progress)
  }, [trackCardProgress, trackCardSession])

  // Automatic navigation can expose the new layer pair while the shared
  // MotionValue still contains the completed pose from the previous session.
  // Reset it before paint; drag navigation already establishes its progress
  // before assigning roles, which is why that path never showed the size jump.
  useLayoutEffect(() => {
    const incoming = artworkSlots.find((layer) => layer?.phase === 'active' && layer.transitionIntent)
    const intent = incoming?.transitionIntent
    const outgoing = intent ? artworkSlots.find((layer) => layer?.phase === 'exiting'
      && layer.transitionIntent?.requestId === intent.requestId) : null
    if (!outgoing || !incoming || !intent) return
    if (!trackCardGeometryReady) return
    const sessionKey = `selection:${intent.requestId}`
    if (retiredTrackCardSessionRef.current?.key === sessionKey
      && retiredTrackCardSessionRef.current.outgoingLayerId === outgoing.id
      && retiredTrackCardSessionRef.current.incomingLayerId === incoming.id) return
    const activeSession = trackCardSessionRef.current
    const activeGesture = coverDragRef.current
    // A live pointer gesture owns the card pair. Publishing an automatic
    // selection session here would race the preview-ready layout effect and
    // make both effects continuously replace each other's session.
    if (activeGesture && !activeGesture.released) return
    if (
      activeSession
      && activeSession.key === sessionKey
      && activeSession.outgoingLayerId === outgoing.id
      && activeSession.incomingLayerId === incoming.id
      && activeSession.direction === intent.direction
      && activeSession.kind === 'automatic'
    ) {
      const pendingSettle = trackCardSettleRef.current
      const settlingThisPair = pendingSettle?.target === 1
        && pendingSettle.session.outgoingLayerId === outgoing.id
        && pendingSettle.session.incomingLayerId === incoming.id
        && (pendingSettle.session === activeSession
          || (pendingSettle.session.kind === 'drag'
            && pendingSettle.session.key === `drag:${intent.previewTokenId}`))
        && (trackCardAnimationRef.current !== null || trackCardOvershootAnimationRef.current !== null)
      if (settlingThisPair || trackCardStartFrameRef.current !== null) return
      if (trackCardProgress.get() >= 0.999 && trackCardOvershootX.get() === 0) {
        completeTrackCardExit(outgoing.id)
      } else {
        runTrackCardSettle({
          session: activeSession,
          target: 1,
          durationSeconds: trackCardReducedMotion ? 0.08 : TRACK_CARD_DURATION_SECONDS,
          onComplete: () => completeTrackCardExit(outgoing.id),
        })
      }
      return
    }
    const pendingDragSettle = trackCardSettleRef.current
    const isCommittedDragPair = Boolean(
      intent.previewTokenId !== undefined
      && activeSession?.kind === 'drag'
      && activeSession.key === `drag:${intent.previewTokenId}`
      && activeSession.outgoingLayerId === outgoing.id
      && activeSession.incomingLayerId === incoming.id
      && activeSession.direction === intent.direction
    )
    const continuesCommittedDrag = isCommittedDragPair
      && pendingDragSettle?.target === 1
      && pendingDragSettle.session === activeSession
    const completedCommittedDrag = isCommittedDragPair
      && !pendingDragSettle
      && trackCardProgress.get() >= 0.999
      && trackCardOvershootX.get() === 0
    if (continuesCommittedDrag || completedCommittedDrag) {
      // Committing a prepared drag promotes the same preview layer pair into
      // the selection transition. Only re-key the session: resetting progress
      // here would replay the whole animation after pointerup instead of
      // completing from the pointer-controlled pose.
      publishTrackCardSession({
        key: sessionKey,
        outgoingLayerId: outgoing.id,
        incomingLayerId: incoming.id,
        direction: intent.direction,
        kind: 'automatic',
        outgoingHandoff: activeSession?.outgoingHandoff,
      })
      setTrackCardPreviewToken(null)
      if (completedCommittedDrag) completeTrackCardExit(outgoing.id)
      return
    }
    // Drag rollback/cleanup retains ownership until its session is removed.
    // An ownerless drag is retired by the stale-session effect below before
    // this automatic pair can take ownership.
    if (activeSession?.kind === 'drag') return
    stopTrackCardAnimation()
    const runId = trackCardRunIdRef.current
    const session: TrackCardTransitionSession = {
      key: sessionKey,
      outgoingLayerId: outgoing.id,
      incomingLayerId: incoming.id,
      direction: intent.direction,
      kind: 'automatic',
    }
    trackCardProgress.set(0)
    trackCardOvershootX.set(0)
    // Register the layer pair in the same commit that exposes it. Artwork and
    // metadata can settle before the next frame; leaving the session unowned
    // until then lets that render enter this branch again, cancel the pending
    // run, and reset progress a second time.
    publishTrackCardSession(session)
    trackCardStartFrameRef.current = requestAnimationFrame(() => {
      if (trackCardRunIdRef.current !== runId) return
      trackCardStartFrameRef.current = null
      runTrackCardSettle({
        session,
        target: 1,
        durationSeconds: trackCardReducedMotion ? 0.08 : TRACK_CARD_DURATION_SECONDS,
        onComplete: () => completeTrackCardExit(outgoing.id),
      })
    })
  }, [
    artworkSlots,
    completeTrackCardExit,
    publishTrackCardSession,
    runTrackCardSettle,
    stopTrackCardAnimation,
    trackCardOvershootX,
    trackCardProgress,
    trackCardReducedMotion,
    trackCardGeometryReady,
    trackCardSession,
  ])

  useLayoutEffect(() => {
    if (!trackCardSession) return
    if (
      trackCardSession.kind === 'drag'
      && trackCardSession.incomingLayerId < 0
    ) return
    if (coverDragRef.current && !coverDragRef.current.released) return
    if (hasValidTrackCardSessionPair(trackCardSession)) return
    if (!trackCardSessionRef.current || !trackCardSessionsMatch(trackCardSessionRef.current, trackCardSession)) return
    const outgoing = artworkSlots.find((layer) => layer?.id === trackCardSession.outgoingLayerId)
    const incoming = artworkSlots.find((layer) => layer?.id === trackCardSession.incomingLayerId)
    if (
      trackCardSession.kind === 'drag'
      && outgoing?.phase === 'exiting'
      && incoming?.phase === 'active'
      && selectionMatchesTrackCardSession(trackCardSession, incoming.track.id)
    ) {
      // The preview was committed, but its prior animation owner disappeared.
      // Continue from the painted pose so the old card cannot remain midway.
      if (trackCardProgress.get() >= 0.999 && trackCardOvershootX.get() === 0) {
        completeTrackCardExit(outgoing.id)
      } else {
        runTrackCardSettle({
          session: trackCardSession,
          target: 1,
          durationSeconds: trackCardReducedMotion ? 0.08 : TRACK_CARD_DURATION_SECONDS,
          onComplete: () => completeTrackCardExit(outgoing.id),
        })
      }
      return
    }
    stopTrackCardAnimation()
    if (outgoing?.phase === 'exiting') completeTrackCardExit(outgoing.id)
    discardTrackPreview?.(trackCardPreviewToken?.id ?? -1)
    publishTrackCardSession(null)
    // The stale render roles must disappear before resetting shared progress.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrackCardPreviewToken(null)
    trackCardProgress.set(0)
    trackCardOvershootX.set(0)
    coverInteractionPhaseRef.current = 'idle'
  }, [artworkSlots, completeTrackCardExit, discardTrackPreview, hasValidTrackCardSessionPair, playback.selectionActivitySequence, playback.selectionVisualIntent, publishTrackCardSession, runTrackCardSettle, selectionMatchesTrackCardSession, stopTrackCardAnimation, track?.id, trackCardOvershootX, trackCardPreviewToken?.id, trackCardProgress, trackCardReducedMotion, trackCardSession])

  useEffect(() => {
    const cancel = () => discardCoverDrag(true)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [discardCoverDrag])

  // Session state schedules React renders, but the ref is the synchronous
  // source of truth for role assignment. In particular, preview insertion can
  // render before its paired state update commits in production Win32 builds.
  const candidateTrackCardSession = resolveRenderedTrackCardSession(
    // Intentional live render snapshot: publishTrackCardSession updates this
    // ref before scheduling state, closing the production batching race.
    // eslint-disable-next-line react-hooks/refs
    trackCardSessionRef.current,
    artworkSlots,
    trackCardPreviewToken,
  )
  const renderedTrackCardSession = candidateTrackCardSession && retiredTrackCardSession
    && trackCardSessionsMatch(candidateTrackCardSession, retiredTrackCardSession)
    ? null
    : candidateTrackCardSession

  // MotionValue updates do not render React. Reconcile the pair that is
  // actually painted, even if its animation callback or live session was lost.
  // A captured pointer may be held still beyond a normal settle; a separate
  // idle bound covers WebView releases that deliver no pointer event at all.
  const renderedTrackCardKey = renderedTrackCardSession?.key ?? null
  const renderedOutgoingLayerId = renderedTrackCardSession?.outgoingLayerId ?? null
  const renderedIncomingLayerId = renderedTrackCardSession?.incomingLayerId ?? null
  const renderedTrackCardDirection = renderedTrackCardSession?.direction ?? null
  const renderedTrackCardKind = renderedTrackCardSession?.kind ?? null
  useEffect(() => {
    const session: TrackCardTransitionSession | null = renderedTrackCardKey !== null
      && renderedOutgoingLayerId !== null && renderedIncomingLayerId !== null
      && renderedTrackCardDirection !== null && renderedTrackCardKind !== null
      ? {
          key: renderedTrackCardKey,
          outgoingLayerId: renderedOutgoingLayerId,
          incomingLayerId: renderedIncomingLayerId,
          direction: renderedTrackCardDirection,
          kind: renderedTrackCardKind,
        }
      : null
    if (!session && !coverDragActive) return
    const startedAt = performance.now()
    let disposed = false
    const reconcile = () => {
      if (disposed) return
      const now = performance.now()
      const outgoing = session
        ? artworkSlotsRef.current.find((layer) => layer?.id === session.outgoingLayerId)
        : null
      const incoming = session
        ? artworkSlotsRef.current.find((layer) => layer?.id === session.incomingLayerId)
        : null
      const committedPair = outgoing?.phase === 'exiting'
        && incoming?.phase === 'active'
        && incoming.track.id === latestTrackContextRef.current.trackId
      const gesture = coverDragRef.current
      if (gesture && !gesture.released) {
        const captured = gesture.captureElement.isConnected
          && gesture.captureElement.hasPointerCapture(gesture.pointerId)
        if (committedPair && gesture.originTrackId !== latestTrackContextRef.current.trackId) {
          // The logical selection has already advanced. An orphaned pointer
          // cannot own this pair, even when WebView still reports capture.
          gesture.released = true
          coverDragRef.current = null
          if (captured) gesture.captureElement.releasePointerCapture(gesture.pointerId)
          if (gesture.token) {
            discardTrackPreview?.(gesture.token.id)
            setTrackCardPreviewToken((current) => current?.id === gesture.token?.id ? null : current)
          }
          setCoverDragActive(false)
          coverInteractionPhaseRef.current = 'settling'
        } else if (
          gesture.originTrackId !== latestTrackContextRef.current.trackId
          || coverInteractionPhaseRef.current !== 'dragging'
          || (!captured && now - gesture.latestAt > 250)
          || now - gesture.latestAt > TRACK_CARD_CAPTURE_IDLE_DEADLINE_MS
        ) {
          discardCoverDrag(true)
          return
        } else if (!committedPair) {
          // A current captured drag keeps its pose until a release signal or
          // the bounded idle limit above, whichever arrives first.
          return
        }
      }
      if (!session || now - startedAt < TRACK_CARD_SETTLE_DEADLINE_MS) return
      const liveSession = trackCardSessionRef.current
      const currentGesture = coverDragRef.current
      const gestureOwnsMotion = Boolean(currentGesture && !currentGesture.released
        && currentGesture.originTrackId === latestTrackContextRef.current.trackId
        && coverInteractionPhaseRef.current === 'dragging')
      const liveSettle = trackCardSettleRef.current
      const differentLiveIsCurrent = Boolean(liveSession
        && !trackCardSessionsMatch(liveSession, session)
        && hasValidTrackCardSessionPair(liveSession)
        && (liveSession.kind === 'automatic'
          || (gestureOwnsMotion && currentGesture?.token
            && liveSession.key === `drag:${currentGesture.token.id}`)
          || liveSettle?.session === liveSession))
      // A mismatched ref is preserved only when it owns a real, newer pair.
      // Otherwise it must not republish the retired cards on the next render.
      const ownsMotion = !differentLiveIsCurrent && !gestureOwnsMotion
      if (ownsMotion) stopTrackCardAnimation()
      if (committedPair) {
        completeTrackCardExit(outgoing.id)
        // Resource exit completion may be ignored after a rapid phase reuse.
        // Retire this exact painted pair before touching the shared progress,
        // so even a still-present exiting resource cannot retain a mid-pose.
        flushSync(() => {
          setRetiredExitingLayerIds((current) => current.has(outgoing.id)
            ? current : new Set(current).add(outgoing.id))
          retiredTrackCardSessionRef.current = session
          setRetiredTrackCardSession(session)
          if (!differentLiveIsCurrent) publishTrackCardSession(null)
        })
        if (gestureOwnsMotion && currentGesture) {
          currentGesture.handoffPose = null
          currentGesture.interruptedSettle = null
          currentGesture.interruptedOvershootX = 0
        }
        if (ownsMotion) {
          trackCardProgress.set(0)
          trackCardOvershootX.set(0)
          coverInteractionPhaseRef.current = 'idle'
        }
        return
      }
      if (outgoing?.phase === 'exiting') completeTrackCardExit(outgoing.id)
      if (session.kind === 'drag' && trackCardPreviewToken?.id !== undefined
        && session.key === `drag:${trackCardPreviewToken.id}`) {
        discardTrackPreview?.(trackCardPreviewToken.id)
        setTrackCardPreviewToken((current) => current?.id === trackCardPreviewToken.id ? null : current)
      }
      if (!differentLiveIsCurrent) publishTrackCardSession(null)
      if (ownsMotion) {
        trackCardProgress.set(0)
        trackCardOvershootX.set(0)
        coverInteractionPhaseRef.current = 'idle'
      }
    }
    const intervalId = window.setInterval(reconcile, 100)
    return () => {
      disposed = true
      window.clearInterval(intervalId)
    }
  }, [
    completeTrackCardExit,
    coverDragActive,
    discardCoverDrag,
    discardTrackPreview,
    hasValidTrackCardSessionPair,
    publishTrackCardSession,
    renderedTrackCardKey,
    renderedOutgoingLayerId,
    renderedIncomingLayerId,
    renderedTrackCardDirection,
    renderedTrackCardKind,
    stopTrackCardAnimation,
    trackCardOvershootX,
    trackCardPreviewToken?.id,
    trackCardProgress,
  ])

  const cancelPlaybackTransition = useCallback(() => {
    playbackTransitionRequestRef.current = null
    setPlaybackTransitionPending(false)
    setPendingVisualPlaybackState(null)
  }, [])

  const settlePlaybackTransitionIfComplete = useCallback(() => {
    const request = playbackTransitionRequestRef.current
    const backendPhaseMatches = playback.isPlaying === (request?.target === 'playing')
    if (
      !request?.visualComplete
      || (playback.transportTransition ?? null) !== null
      || playback.transportSettledRequestId !== request.requestId
      || !backendPhaseMatches
    ) return
    playbackTransitionRequestRef.current = null
    setPlaybackTransitionPending(false)
    setPendingVisualPlaybackState(null)
  }, [playback.isPlaying, playback.transportSettledRequestId, playback.transportTransition])

  const completePlaybackVisualTransition = useCallback((requestId: number) => {
    const request = playbackTransitionRequestRef.current
    if (!request || request.requestId !== requestId) return
    request.visualComplete = true
    settlePlaybackTransitionIfComplete()
  }, [settlePlaybackTransitionIfComplete])

  const playbackCoverTransitionTarget = useCallback((event: TransitionEvent<HTMLElement>) => {
    const target = event.target
    if (
      event.propertyName !== 'width'
      || !(target instanceof HTMLElement)
      || !target.classList.contains('cover-frame')
    ) return null
    return target
  }, [])

  const handlePlaybackVisualTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    const target = playbackCoverTransitionTarget(event)
    if (!target) return
    const request = playbackTransitionRequestRef.current
    if (request) completePlaybackVisualTransition(request.requestId)
  }, [completePlaybackVisualTransition, playbackCoverTransitionTarget])

  const handlePlayToggle = useCallback(() => {
    const trackId = track?.id
    const busy = playback.isAudioBusy || playback.isSelectionPending
    if (!trackId || busy || timeline.interaction === 'seeking') return

    const source = playbackTransitionRequestRef.current?.target ?? visualPlaybackState
    const target = source === 'playing' ? 'paused' : 'playing'
    const layout = playerStageRef.current
      ?.closest<HTMLElement>('.responsive-player-layout')
      ?.dataset.playerLayout
    const durationMs = layout === 'full' && currentArtworkReady ? playbackTransitionDuration : 0
    const request: PlaybackTransitionRequest = {
      requestId: nextPlaybackTransitionRequestId(),
      target,
      trackId,
      durationMs,
      visualComplete: false,
    }
    playbackTransitionRequestRef.current = request
    setPlaybackTransitionPending(true)
    setPendingVisualPlaybackState(target)

    if (durationMs === 0) {
      queueMicrotask(() => completePlaybackVisualTransition(request.requestId))
    }

    let transitionResult: ReturnType<PlayerPlaybackViewModel['onPlayToggle']>
    try {
      transitionResult = playback.onPlayToggle({
        requestId: request.requestId,
        expectedTrackId: trackId,
        target,
        durationMs,
      })
    } catch {
      cancelPlaybackTransition()
      return
    }
    void Promise.resolve(transitionResult)
      .then((result) => {
        const activeRequest = playbackTransitionRequestRef.current
        if (!activeRequest || activeRequest.requestId !== request.requestId) return
        if (result && result.requestId !== request.requestId) return
        settlePlaybackTransitionIfComplete()
      })
      .catch(() => {
        if (playbackTransitionRequestRef.current?.requestId === request.requestId) {
          cancelPlaybackTransition()
        }
      })
  }, [
    cancelPlaybackTransition,
    completePlaybackVisualTransition,
    playback,
    playbackTransitionDuration,
    currentArtworkReady,
    settlePlaybackTransitionIfComplete,
    timeline.interaction,
    track?.id,
    visualPlaybackState,
  ])

  useEffect(() => {
    const request = playbackTransitionRequestRef.current
    if (!request) return
    settlePlaybackTransitionIfComplete()
  }, [
    playback.isPlaying,
    playback.transportSettledRequestId,
    playback.transportTransition,
    settlePlaybackTransitionIfComplete,
  ])

  useEffect(() => {
    const request = playbackTransitionRequestRef.current
    if (!request) return

    const contextInvalidated = request.trackId !== (track?.id ?? null)
      || playback.isAudioBusy
      || playback.isSelectionPending
      || timeline.interaction === 'seeking'
    if (contextInvalidated) cancelPlaybackTransition()
  }, [
    cancelPlaybackTransition,
    playback.isAudioBusy,
    playback.isSelectionPending,
    playbackTransitionPending,
    timeline.interaction,
    track?.id,
  ])

  useEffect(() => () => {
    playbackTransitionRequestRef.current = null
  }, [])

  const playlistTransportOnlyBusy = Boolean(
    playlist.isOpen
    && track
    && playback.isTransportBusy
    && !playback.isAudioBusy
    && !playback.isSelectionPending
    && timeline.interaction !== 'seeking',
  )

  return (
    <TooltipProvider>
      <main
        className="player-shell"
        data-cover={toneLayer?.artwork.coverTone ?? track?.coverTone ?? 'empty'}
        data-content-state={contentState}
        data-playlist-transport-only-busy={playlistTransportOnlyBusy ? '' : undefined}
        data-window-fullscreen={nativeWindowState.fullscreen}
        aria-busy={contentState === 'loading'}
        aria-labelledby="app-title"
      >
        {artworkSlots.map((layer, slot) => (
          <AmbientArtwork
            key={`ambient-slot:${slot}`}
            layer={layer?.phase === 'exiting' && retiredExitingLayerIds.has(layer.id) ? null : layer}
            role={layer && retiringTrackCardSession?.outgoingLayerId === layer.id && layer.phase === 'exiting'
              ? 'outgoing'
              : layer && renderedTrackCardSession?.outgoingLayerId === layer.id
              ? 'outgoing'
              : layer && renderedTrackCardSession?.incomingLayerId === layer.id ? 'incoming' : null}
            progress={retiringTrackCardSession?.outgoingLayerId === layer?.id && layer?.phase === 'exiting'
              ? retiringTrackCardProgress : trackCardProgress}
            outgoingHandoffOpacity={retiringTrackCardSession?.outgoingLayerId === layer?.id && layer?.phase === 'exiting'
              ? retiringTrackCardSession?.outgoingHandoff?.opacity
              : renderedTrackCardSession?.outgoingLayerId === layer?.id
                ? renderedTrackCardSession?.outgoingHandoff?.opacity : undefined}
            outgoingReturnToCenter={retiringTrackCardSession?.outgoingLayerId === layer?.id && layer?.phase === 'exiting'
              ? retiringTrackCardSession?.outgoingReturnToCenter : renderedTrackCardSession?.outgoingReturnToCenter}
          />
        ))}
        {playlist.isOpen ? artworkSlots.map((layer, slot) => (
          <ArtworkReadinessProbe
            key={`artwork-readiness:${slot}`}
            layer={layer}
            onReady={markArtworkReady}
            onLoadError={markArtworkLoadError}
          />
        )) : null}
        {devAudioTools?.content}

        <LayoutGroup id="playlist-player-view-transition">
          <ResponsivePlayerLayout
            nativeWindowState={nativeWindowState}
            windowBar={(
              <WindowBar
                onWindowStateChange={setNativeWindowState}
                debugToolsEnabled={devAudioTools !== undefined}
                debugToolsOpen={devAudioTools?.isOpen ?? false}
                onDebugToolsOpenChange={devAudioTools?.onOpenChange}
                playlistOpen={playlist.isOpen}
                onTogglePlaylist={() => requestPlaylistOpenChange(!playlist.isOpen)}
              />
            )}
          >
            <AnimatePresence initial={false}>
              {!playlist.isOpen ? <motion.section
            key="player-detail"
            ref={playerStageRef}
            className="player-stage"
            data-playback-state={visualPlaybackState}
            style={playbackTransitionStyle}
            initial={{ opacity: appearanceMotion.disabled ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: appearanceMotion.disabled ? 1 : 0 }}
            transition={appearanceMotion.layoutTransition}
            onTransitionEnd={handlePlaybackVisualTransitionEnd}
            aria-label={appCopy.shellLabel}
          >
            {track ? (
              <>
                <div
                  ref={trackCardDeckRef}
                  className="track-card-deck"
                  {...coverDragProps}
                  style={trackCardGeometryReady && trackCardCoverGeometry ? {
                    perspectiveOrigin: `${trackCardCoverGeometry.centerX}px ${trackCardCoverGeometry.centerY}px`,
                  } : undefined}
                >
                  {artworkSlots.filter((layer): layer is ArtworkVisualLayer => (
                    layer !== null && !(layer.phase === 'exiting' && retiredExitingLayerIds.has(layer.id))
                  )).map((layer) => {
                    const retiringLayer = layer.phase === 'exiting'
                      && retiringTrackCardSession?.outgoingLayerId === layer.id
                    const layerSession = retiringLayer ? retiringTrackCardSession : renderedTrackCardSession
                    const role: TrackCardRole | null = retiringLayer
                      ? 'outgoing'
                      : renderedTrackCardSession?.outgoingLayerId === layer.id
                      ? 'outgoing'
                      : renderedTrackCardSession?.incomingLayerId === layer.id ? 'incoming' : null
                    const acceptsDrag = layer.phase === 'active'
                      && !moreMenuOpen
                      && (renderedTrackCardSession === null || role === 'outgoing' || role === 'incoming')
                    return (
                      <TrackCardMotionLayer
                        key={`track-card:${layer.id}`}
                        layer={layer}
                        feedbackValue={feedback.valuesByTrackId?.[layer.track.id]}
                        onFeedbackToggle={feedback.onToggle}
                        onReady={markArtworkReady}
                        onLoadError={markArtworkLoadError}
                        role={role}
                        direction={layerSession?.direction ?? 1}
                        progress={retiringLayer ? retiringTrackCardProgress : trackCardProgress}
                        overshootX={trackCardOvershootX}
                        reducedMotion={trackCardReducedMotion}
                        coverGeometry={trackCardGeometryReady && trackCardCoverGeometry
                          ? trackCardCoverGeometry
                          : null}
                        acceptsDrag={acceptsDrag}
                        outgoingHandoff={role === 'outgoing' ? layerSession?.outgoingHandoff : undefined}
                        outgoingReturnToCenter={layerSession?.outgoingReturnToCenter}
                        onMoreOpenChange={layer.phase === 'active' ? handleMoreOpenChange : undefined}
                        moreOpen={layer.phase === 'active' && role === null && moreMenuOpen}
                        ownsPlayerViewTransition={
                          !coverDragActive
                          && renderedTrackCardSession === null
                          && trackCardPreviewToken === null
                          && layer.phase === 'active'
                          && layer.track.id === track.id
                          && playerViewTransitionOwnerIds.has(layer.id)
                        }
                      />
                    )
                  })}
                </div>

                <div className="track-meta-layout-spacer" aria-hidden="true" />
                <div className="track-lyrics-region">
                  <LyricsPanel
                    track={track}
                    detailsPending={playback.detailsPending}
                    positionSeconds={timeline.positionSeconds}
                    interaction={timeline.interaction}
                    visualClock={timeline.visualClock}
                    lyricLayoutKey={lyricLayoutKey}
                    tightThresholdSeconds={appearance.player.lyricsTightThresholdSeconds}
                    onLineSelect={playbackTransitionPending ? () => undefined : timeline.onCommit}
                  />
                </div>

                <AnimatePresence initial={false}>
                  {queue.isOpen ? (
                    <QueuePanel
                      tracks={queue.tracks}
                      unavailableTrackIds={queue.unavailableTrackIds}
                      currentTrackId={track.id}
                      playlistName={queue.playlistName}
                      onTrackSelect={playbackTransitionPending ? undefined : queue.onTrackSelect}
                    />
                  ) : null}
                </AnimatePresence>
              </>
            ) : <EmptyPlayerState state={contentState === 'track' ? 'empty' : contentState} statusText={playback.statusText} />}

            <div className="player-control-region">
              <ExternalPlaybackModeControls
                playback={playback}
                playbackInfo={(
                  <PlaybackInfoButton
                    visible={Boolean(track)}
                    visualIsPlaying={visualPlaybackState === 'playing'}
                    currentTrack={track}
                    audioOutputInfo={playback.audioOutputInfo}
                  />
                )}
              />
              <ControlDock
                playback={coverDragActive ? {
                  ...playback,
                  isAudioBusy: true,
                  onPrevious: () => undefined,
                  onNext: () => undefined,
                } : playback}
                timeline={timeline}
                volume={volume}
                queue={queue}
                visualIsPlaying={visualPlaybackState === 'playing'}
                playbackTransitionPending={playbackTransitionPending}
                playbackVisualReady={currentArtworkReady}
                onPlayToggle={handlePlayToggle}
              />
            </div>
              </motion.section> : null}
            </AnimatePresence>
          </ResponsivePlayerLayout>

          <AnimatePresence initial={false}>
            {playlist.isOpen ? (
              <OwnedPlaylistPanel
              key={`${playlist.playlistName ?? 'playlist'}:${playlist.tracks.length}:${playlist.tracks[0]?.id ?? ''}:${playlist.tracks[playlist.tracks.length - 1]?.id ?? ''}`}
              ownerStateRef={playlistWindowOwnersRef}
              tracks={playlist.tracks}
              unavailableTrackIds={playlist.unavailableTrackIds}
              playlistName={playlist.playlistName}
              currentTrackId={playlist.currentTrackId}
              totalDurationSeconds={playlist.totalDurationSeconds}
              shuffleMode={playlist.shuffleMode}
              onShuffleCycle={playlist.onShuffleCycle}
              isOpenAudioDisabled={playlist.isOpenAudioDisabled}
              onOpenAudio={playlist.onOpenAudio}
              onTrackSelect={playlist.onTrackSelect}
              onVisibleTrackIdsChange={playlist.onVisibleTrackIdsChange}
              playback={playback}
              timeline={timeline}
              visualIsPlaying={visualPlaybackState === 'playing'}
              playbackTransitionPending={playbackTransitionPending}
              onPlayToggle={handlePlayToggle}
              onClose={() => requestPlaylistOpenChange(false)}
              />
            ) : null}
          </AnimatePresence>
        </LayoutGroup>
      </main>
    </TooltipProvider>
  )
}
