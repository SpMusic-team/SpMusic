import '@/features/player/styles/player.css'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type TransitionEvent } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance, useAppearanceMotion, useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { CoverPanel } from '@/features/player/components/CoverPanel'
import { ControlDock } from '@/features/player/components/ControlDock'
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
import { getTrackCardOpacity, getTrackCardPose, trackCardTransform, type TrackCardRole } from '@/features/player/model/trackCardTransition'

export type PlayerSurfaceDevAudioTools = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  content: ReactNode
}

export type PlayerSurfaceProps = {
  viewModel: PlayerUiViewModel
  devAudioTools?: PlayerSurfaceDevAudioTools
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
}

const AmbientArtwork = memo(function AmbientArtwork({ layer, role, progress }: AmbientArtworkProps) {
  useArtworkResourceConsumer(layer?.resource)
  const transitionOpacity = useTransform(progress, (value) => role === 'outgoing' ? 1 - value : value)
  const opacity = role ? transitionOpacity : layer?.phase === 'active' ? 1 : 0
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
type TrackCardMotionLayerProps = {
  layer: ArtworkVisualLayer
  feedbackValue?: TrackFeedback
  onFeedbackToggle: (feedback: TrackFeedback) => void
  onReady: (layerId: number) => void
  onLoadError: (layerId: number) => void
  role: TrackCardRole | null
  direction: -1 | 1
  progress: MotionValue<number>
  reducedMotion: boolean
  coverGeometry: { width: number; height: number; centerX: number; centerY: number; perspective: number } | null
  acceptsDrag: boolean
  onMoreOpenChange?: (open: boolean) => void
  moreOpen?: boolean
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
  reducedMotion,
  coverGeometry,
  acceptsDrag,
  onMoreOpenChange,
  moreOpen,
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
  useArtworkResourceConsumer(layer.resource)

  // useTransform keeps the transformer captured by its first subscription.
  // A card layer normally mounts without a transition role, so reusing that
  // derived MotionValue after the next track change makes every pointer update
  // evaluate the original `role === null` branch and write `transform: none`.
  // Subscribe explicitly so each role/geometry hand-off owns a fresh closure.
  useLayoutEffect(() => {
    const update = (value: number) => {
      planeTransform.set(role && coverGeometry
        ? trackCardTransform(getTrackCardPose(
          role,
          direction,
          value,
          measuredCoverWidth,
          reducedMotion,
          measuredCoverHeight,
          measuredPerspective,
        ))
        : 'none')
      contentOpacity.set(role ? getTrackCardOpacity(role, value) : 1)
    }
    update(progress.get())
    return progress.on('change', update)
  }, [
    contentOpacity,
    coverGeometry,
    direction,
    measuredCoverHeight,
    measuredCoverWidth,
    measuredPerspective,
    planeTransform,
    progress,
    reducedMotion,
    role,
  ])
  const handleReady = useCallback(() => {
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
        pointerEvents: acceptsDrag || (phase === 'active' && role === null) ? 'auto' : 'none',
      }}
      aria-hidden={phase !== 'active' || role !== null || undefined}
    >
      <motion.div
        className="track-card-content"
        style={{ opacity: role ? contentOpacity : phase === 'preview' || phase === 'incoming' ? 0 : 1 }}
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
          onMoreOpenChange={onMoreOpenChange}
          moreOpen={moreOpen}
        />
        <TrackMeta layer={layer} />
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
  artworkSlots: readonly [ArtworkVisualLayer | null, ArtworkVisualLayer | null],
  previewToken: TrackCardPreviewToken | null,
): TrackCardTransitionSession | null {
  // A direction lock publishes this session synchronously, before preview
  // hydration can insert its layer. Keep the active card attached to the live
  // MotionValue during that insertion render; the ready effect upgrades it to
  // the validated two-card session on the following render.
  if (
    liveSession?.kind === 'drag'
    && liveSession.incomingLayerId < 0
    && (liveSession.key.startsWith('drag-pending:') || liveSession.key.startsWith('boundary:'))
  ) {
    const outgoingIsCurrent = artworkSlots.some((layer) => (
      layer?.id === liveSession.outgoingLayerId
      && layer.phase === 'active'
    ))
    const tokenMatchesDirection = !previewToken || previewToken.direction === liveSession.direction
    if (outgoingIsCurrent && tokenMatchesDirection) return liveSession
  }

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
  captureLost: boolean
}

type CoverPointerSample = Pick<PointerEvent, 'clientX' | 'pointerId'>

const TRACK_CARD_DURATION_SECONDS = 0.3
const TRACK_CARD_CANCEL_SECONDS = 0.19
const TRACK_CARD_DRAG_LOCK_PX = 6
const TRACK_CARD_COMMIT_PROGRESS = 0.28
const TRACK_CARD_COMMIT_VELOCITY = 650
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
  const trackCardAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const trackCardStartFrameRef = useRef<number | null>(null)
  const trackCardRunIdRef = useRef(0)
  const trackCardDeckRef = useRef<HTMLDivElement>(null)
  const [trackCardCoverGeometry, setTrackCardCoverGeometry] = useState<{
    width: number
    height: number
    centerX: number
    centerY: number
    perspective: number
  } | null>(null)
  const coverDragRef = useRef<CoverDragGesture | null>(null)
  const suppressCoverClickRef = useRef(false)
  const [trackCardPreviewToken, setTrackCardPreviewToken] = useState<TrackCardPreviewToken | null>(null)
  const [trackCardSession, setTrackCardSession] = useState<TrackCardTransitionSession | null>(null)
  const trackCardSessionRef = useRef<TrackCardTransitionSession | null>(null)
  const publishTrackCardSession = useCallback((session: TrackCardTransitionSession | null) => {
    trackCardSessionRef.current = session
    setTrackCardSession(session)
  }, [])
  const [coverDragActive, setCoverDragActive] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
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
  const trackCardGeometryReady = Boolean(
    trackCardCoverGeometry
    && trackCardCoverGeometry.width > 1
    && trackCardCoverGeometry.height > 1
    && Number.isFinite(trackCardCoverGeometry.centerX)
    && Number.isFinite(trackCardCoverGeometry.centerY),
  )
  const completeTrackCardExit = useCallback(
    (layerId: number) => {
      markArtworkExitComplete(layerId, 'ambient')
      markArtworkExitComplete(layerId, 'cover')
    },
    [markArtworkExitComplete],
  )
  const toneLayer = artworkSlots.find((layer) => layer?.phase === 'active')
    ?? artworkSlots.find((layer) => layer?.phase === 'incoming')
    ?? artworkSlots.find((layer) => layer?.phase === 'exiting')
  const contentState = playback.contentState ?? (track ? 'track' : 'empty')
  const { appearance } = useAppearance()
  const appearanceMotion = useAppearanceMotion()
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

  const stopTrackCardAnimation = useCallback(() => {
    trackCardRunIdRef.current += 1
    if (trackCardStartFrameRef.current !== null) {
      cancelAnimationFrame(trackCardStartFrameRef.current)
      trackCardStartFrameRef.current = null
    }
    trackCardAnimationRef.current?.stop()
    trackCardAnimationRef.current = null
  }, [])

  useEffect(() => stopTrackCardAnimation, [stopTrackCardAnimation])

  const animateTrackCardProgress = useCallback((
    target: number,
    durationSeconds: number,
    onComplete: () => void,
  ) => {
    stopTrackCardAnimation()
    const runId = trackCardRunIdRef.current
    if (durationSeconds <= 0) {
      trackCardProgress.set(target)
      if (trackCardRunIdRef.current === runId) onComplete()
      return
    }
    const controls = animate(trackCardProgress, target, {
      duration: durationSeconds,
      // Progress is deliberately linear: card opacity owns exact 10%/90%
      // timing windows and drag gestures share this same raw timeline.
      ease: 'linear',
      onComplete: () => {
        if (trackCardRunIdRef.current !== runId) return
        if (trackCardAnimationRef.current === controls) trackCardAnimationRef.current = null
        onComplete()
      },
    })
    trackCardAnimationRef.current = controls
  }, [stopTrackCardAnimation, trackCardProgress])

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
    stopTrackCardAnimation()
    suppressCoverClickRef.current = false
    setCoverDragActive(false)
    setMoreMenuOpen(false)
    setTrackCardPreviewToken(null)
    publishTrackCardSession(null)
    trackCardProgress.set(0)
  }, [discardTrackPreview, publishTrackCardSession, stopTrackCardAnimation, trackCardPreviewToken?.id, trackCardProgress])

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
      setTrackCardPreviewToken((current) => current?.id === gesture.token?.id ? null : current)
      if (trackCardSessionRef.current?.kind === 'drag') publishTrackCardSession(null)
      trackCardProgress.set(0)
      suppressCoverClickRef.current = false
    }
    if (animateBack && trackCardSessionRef.current?.kind === 'drag') {
      animateTrackCardProgress(0, trackCardReducedMotion ? 0 : TRACK_CARD_CANCEL_SECONDS, cleanup)
    } else {
      stopTrackCardAnimation()
      cleanup()
    }
  }, [animateTrackCardProgress, discardTrackPreview, publishTrackCardSession, stopTrackCardAnimation, trackCardProgress, trackCardReducedMotion])

  const commitCoverDrag = useCallback((gesture: CoverDragGesture) => {
    if (
      !gesture.token
      || !gesture.direction
      || gesture.token.direction !== gesture.direction
      || !trackCardSession
      || trackCardSession.kind !== 'drag'
      || trackCardSession.direction !== gesture.direction
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
    const remainingSeconds = trackCardReducedMotion
      ? 0.08
      : Math.min(0.22, Math.max(0.09, TRACK_CARD_DURATION_SECONDS * (1 - gesture.progress)))
    animateTrackCardProgress(1, remainingSeconds, () => {
      completeTrackCardExit(trackCardSession.outgoingLayerId)
    })
  }, [animateTrackCardProgress, commitTrackPreview, completeTrackCardExit, discardCoverDrag, trackCardReducedMotion, trackCardSession])

  const handleCoverPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const coverFrame = (event.target as HTMLElement).closest<HTMLElement>('.cover-frame')
    if (
      event.button !== 0
      || !track
      || !prepareTrackPreview
      || playback.isAudioBusy
      || playback.isSelectionPending
      || !trackCardGeometryReady
      || trackCardSession
      || !coverFrame
      || !event.currentTarget.contains(coverFrame)
      || (event.target as HTMLElement).closest('button, [role="button"], a, input')
    ) return
    stopTrackCardAnimation()
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
      captureLost: false,
    }
    setCoverDragActive(true)
    suppressCoverClickRef.current = false
  }, [playback.isAudioBusy, playback.isSelectionPending, prepareTrackPreview, stopTrackCardAnimation, track, trackCardCoverGeometry?.width, trackCardGeometryReady, trackCardSession])

  const handleCoverPointerMove = useCallback((event: CoverPointerSample) => {
    const gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.released) return
    const now = performance.now()
    const frameSeconds = Math.max(0.001, (now - gesture.latestAt) / 1000)
    gesture.velocityX = (event.clientX - gesture.latestX) / frameSeconds
    gesture.latestX = event.clientX
    gesture.latestAt = now
    const deltaX = event.clientX - gesture.startX
    gesture.signedProgress = Math.min(0.96, Math.max(-0.96, -deltaX / (gesture.coverWidth * 0.55)))
    gesture.progress = Math.abs(gesture.signedProgress)
    const nextDirection: -1 | 1 | null = Math.abs(deltaX) <= TRACK_CARD_DRAG_LOCK_PX
      ? null
      : gesture.signedProgress > 0 ? 1 : -1

    if (nextDirection !== gesture.direction) {
      gesture.revision += 1
      const revision = gesture.revision
      const gestureId = gesture.gestureId
      if (gesture.token) discardTrackPreview?.(gesture.token.id)
      else if (gesture.direction) discardTrackPreview?.(-1)
      gesture.token = null
      gesture.direction = nextDirection
      setTrackCardPreviewToken(null)
      publishTrackCardSession(null)
      stopTrackCardAnimation()
      trackCardProgress.set(0)
      if (!nextDirection) return
      gesture.moved = true
      suppressCoverClickRef.current = true
      const outgoing = artworkSlots.find((layer) => layer?.phase === 'active')
      if (outgoing) {
        // Preview hydration and artwork decoding are asynchronous. Establish an
        // outgoing-only session as soon as the gesture locks direction so the
        // current card follows the pointer even while the incoming card is not
        // available yet. The ready effect below replaces this placeholder with
        // the two-card session without resetting the shared progress value.
        publishTrackCardSession({
          key: `drag-pending:${gestureId}:${revision}`,
          outgoingLayerId: outgoing.id,
          incomingLayerId: -1,
          direction: nextDirection,
          kind: 'drag',
        })
        trackCardProgress.set(gesture.progress)
      }
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
          const outgoing = artworkSlots.find((layer) => layer?.phase === 'active')
          if (outgoing) {
            publishTrackCardSession({
              key: `boundary:${gestureId}:${revision}`,
              outgoingLayerId: outgoing.id,
              incomingLayerId: -1,
              direction: requestedDirection,
              kind: 'drag',
            })
            trackCardProgress.set(Math.min(0.08, gesture.progress * 0.12))
          }
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
        trackCardProgress.set(gesture.progress)
        setTrackCardPreviewToken(token)
      })
      return
    }
    if (!gesture.direction) return
    const activeSession = trackCardSessionRef.current
    if (activeSession?.kind === 'drag') {
      trackCardProgress.set(activeSession.key.startsWith('boundary:')
        ? Math.min(0.08, gesture.progress * 0.12)
        : gesture.progress)
    }
  }, [artworkSlots, discardTrackPreview, prepareTrackPreview, publishTrackCardSession, stopTrackCardAnimation, trackCardProgress])

  const handleCoverPointerUp = useCallback((event: CoverPointerSample) => {
    const gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.released = true
    if (gesture.captureElement.hasPointerCapture(event.pointerId)) {
      gesture.captureElement.releasePointerCapture(event.pointerId)
    }
    const displacement = Math.abs(gesture.latestX - gesture.startX)
    const finalDirection: -1 | 1 | null = Math.abs(gesture.latestX - gesture.startX) <= TRACK_CARD_DRAG_LOCK_PX
      ? null
      : gesture.signedProgress > 0 ? 1 : -1
    const matchingPreviewLayer = gesture.token && trackCardSession
      ? artworkSlots.some((layer) => (
        layer?.id === trackCardSession.incomingLayerId
        && layer.previewTokenId === gesture.token?.id
      ))
      : false
    const shouldCommit = Boolean(
      gesture.token
      && finalDirection
      && gesture.direction === finalDirection
      && gesture.token.direction === finalDirection
      && previewArtworkReady
      && trackCardSession?.kind === 'drag'
      && trackCardSession.direction === finalDirection
      && matchingPreviewLayer
      && trackCardGeometryReady
      && (
        gesture.progress >= TRACK_CARD_COMMIT_PROGRESS
        || (Math.abs(gesture.velocityX) >= TRACK_CARD_COMMIT_VELOCITY && displacement >= 24)
      ),
    )
    if (shouldCommit) commitCoverDrag(gesture)
    else discardCoverDrag(true)
  }, [artworkSlots, commitCoverDrag, discardCoverDrag, previewArtworkReady, trackCardGeometryReady, trackCardSession])

  const handleCoverPointerCancel = useCallback(() => {
    if (coverDragRef.current?.released) return
    discardCoverDrag(true)
  }, [discardCoverDrag])
  const handleCoverLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = coverDragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.released) return
    // lostpointercapture is not a cancellation signal. WebView can emit it
    // when DOM interaction roles change; the native pointercancel event owns
    // cancellation, while pointerup owns completion.
    gesture.captureLost = true
  }, [])
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
      if (!gesture?.captureLost || gesture.pointerId !== event.pointerId) return
      if (event.composedPath().includes(gesture.captureElement)) return
      handleCoverPointerMove(event)
    }
    const handleWindowPointerUp = (event: PointerEvent) => {
      const gesture = coverDragRef.current
      if (!gesture?.captureLost || gesture.pointerId !== event.pointerId) return
      if (event.composedPath().includes(gesture.captureElement)) return
      handleCoverPointerUp(event)
    }
    const handleWindowPointerCancel = (event: PointerEvent) => {
      const gesture = coverDragRef.current
      if (!gesture?.captureLost || gesture.pointerId !== event.pointerId) return
      if (event.composedPath().includes(gesture.captureElement)) return
      handleCoverPointerCancel()
    }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerCancel)
    }
  }, [coverDragActive, handleCoverPointerCancel, handleCoverPointerMove, handleCoverPointerUp])

  useEffect(() => {
    if (!trackCardPreviewToken || !previewArtworkReady) return
    const gesture = coverDragRef.current
    const outgoing = artworkSlots.find((layer) => layer?.phase === 'active')
    const incoming = artworkSlots.find((layer) => layer?.previewTokenId === trackCardPreviewToken.id)
    if (!gesture || !outgoing || !incoming || gesture.token?.id !== trackCardPreviewToken.id) return
    const session: TrackCardTransitionSession = {
      key: `drag:${trackCardPreviewToken.id}`,
      outgoingLayerId: outgoing.id,
      incomingLayerId: incoming.id,
      direction: trackCardPreviewToken.direction,
      kind: 'drag',
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
    if (!sessionIsCurrent) publishTrackCardSession(session)
    if (trackCardProgress.get() !== gesture.progress) {
      trackCardProgress.set(gesture.progress)
    }
  }, [artworkSlots, previewArtworkReady, publishTrackCardSession, trackCardPreviewToken, trackCardProgress])

  // Automatic navigation can expose the new layer pair while the shared
  // MotionValue still contains the completed pose from the previous session.
  // Reset it before paint; drag navigation already establishes its progress
  // before assigning roles, which is why that path never showed the size jump.
  useLayoutEffect(() => {
    const outgoing = artworkSlots.find((layer) => layer?.phase === 'exiting')
    const incoming = artworkSlots.find((layer) => layer?.phase === 'active' && layer.transitionIntent)
    const intent = incoming?.transitionIntent
    if (!outgoing || !incoming || !intent) return
    if (!trackCardGeometryReady) return
    const sessionKey = `selection:${intent.requestId}`
    const activeSession = trackCardSessionRef.current
    if (
      activeSession
      && activeSession.key === sessionKey
      && activeSession.outgoingLayerId === outgoing.id
      && activeSession.incomingLayerId === incoming.id
      && activeSession.direction === intent.direction
      && activeSession.kind === 'automatic'
    ) {
      if (trackCardProgress.get() >= 0.999) completeTrackCardExit(outgoing.id)
      return
    }
    const continuesCommittedDrag = Boolean(
      intent.previewTokenId !== undefined
      && activeSession?.kind === 'drag'
      && activeSession.outgoingLayerId === outgoing.id
      && activeSession.incomingLayerId === incoming.id,
    )
    if (continuesCommittedDrag) {
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
      })
      setTrackCardPreviewToken(null)
      return
    }
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
    trackCardStartFrameRef.current = requestAnimationFrame(() => {
      if (trackCardRunIdRef.current !== runId) return
      publishTrackCardSession(session)
      trackCardStartFrameRef.current = requestAnimationFrame(() => {
        if (trackCardRunIdRef.current !== runId) return
        trackCardStartFrameRef.current = null
        animateTrackCardProgress(1, trackCardReducedMotion ? 0.08 : TRACK_CARD_DURATION_SECONDS, () => {
          completeTrackCardExit(outgoing.id)
        })
      })
    })
  }, [
    animateTrackCardProgress,
    artworkSlots,
    completeTrackCardExit,
    publishTrackCardSession,
    stopTrackCardAnimation,
    trackCardProgress,
    trackCardReducedMotion,
    trackCardGeometryReady,
    trackCardSession,
  ])

  useEffect(() => {
    if (!trackCardSession) return
    if (
      trackCardSession.kind === 'drag'
      && trackCardSession.incomingLayerId < 0
    ) return
    const layerIds = new Set(artworkSlots.filter(Boolean).map((layer) => layer!.id))
    if (layerIds.has(trackCardSession.outgoingLayerId) && layerIds.has(trackCardSession.incomingLayerId)) return
    const staleSessionKey = trackCardSession.key
    const frameId = requestAnimationFrame(() => {
      if (trackCardSessionRef.current?.key !== staleSessionKey) return
      stopTrackCardAnimation()
      publishTrackCardSession(null)
      setTrackCardPreviewToken(null)
      trackCardProgress.set(0)
    })
    return () => cancelAnimationFrame(frameId)
  }, [artworkSlots, publishTrackCardSession, stopTrackCardAnimation, trackCardProgress, trackCardSession])

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
  const renderedTrackCardSession = resolveRenderedTrackCardSession(
    // Intentional live render snapshot: publishTrackCardSession updates this
    // ref before scheduling state, closing the production batching race.
    // eslint-disable-next-line react-hooks/refs
    trackCardSessionRef.current,
    artworkSlots,
    trackCardPreviewToken,
  )

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

  return (
    <TooltipProvider>
      <main
        className="player-shell"
        data-cover={toneLayer?.artwork.coverTone ?? track?.coverTone ?? 'empty'}
        data-content-state={contentState}
        data-window-fullscreen={nativeWindowState.fullscreen}
        aria-busy={contentState === 'loading'}
        aria-labelledby="app-title"
      >
        {artworkSlots.map((layer, slot) => (
          <AmbientArtwork
            key={`ambient-slot:${slot}`}
            layer={layer}
            role={layer && renderedTrackCardSession?.outgoingLayerId === layer.id
              ? 'outgoing'
              : layer && renderedTrackCardSession?.incomingLayerId === layer.id ? 'incoming' : null}
            progress={trackCardProgress}
          />
        ))}
        {devAudioTools?.content}

        <ResponsivePlayerLayout
          nativeWindowState={nativeWindowState}
          windowBar={(
            <WindowBar
              onWindowStateChange={setNativeWindowState}
              debugToolsEnabled={devAudioTools !== undefined}
              debugToolsOpen={devAudioTools?.isOpen ?? false}
              onDebugToolsOpenChange={devAudioTools?.onOpenChange}
              playlistOpen={playlist.isOpen}
              onTogglePlaylist={() => playlist.onOpenChange(!playlist.isOpen)}
            />
          )}
        >
          <section
            ref={playerStageRef}
            className="player-stage"
            data-playback-state={visualPlaybackState}
            style={playbackTransitionStyle}
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
                  {artworkSlots.filter((layer): layer is ArtworkVisualLayer => layer !== null).map((layer) => {
                    const role: TrackCardRole | null = renderedTrackCardSession?.outgoingLayerId === layer.id
                      ? 'outgoing'
                      : renderedTrackCardSession?.incomingLayerId === layer.id ? 'incoming' : null
                    const acceptsDrag = layer.phase === 'active'
                      && !moreMenuOpen
                      && (renderedTrackCardSession === null || (renderedTrackCardSession.kind === 'drag' && role === 'outgoing'))
                    return (
                      <TrackCardMotionLayer
                        key={`track-card:${layer.id}`}
                        layer={layer}
                        feedbackValue={feedback.valuesByTrackId?.[layer.track.id]}
                        onFeedbackToggle={feedback.onToggle}
                        onReady={markArtworkReady}
                        onLoadError={markArtworkLoadError}
                        role={role}
                        direction={renderedTrackCardSession?.direction ?? 1}
                        progress={trackCardProgress}
                        reducedMotion={trackCardReducedMotion}
                        coverGeometry={trackCardGeometryReady && trackCardCoverGeometry
                          ? trackCardCoverGeometry
                          : null}
                        acceptsDrag={acceptsDrag}
                        onMoreOpenChange={layer.phase === 'active' ? handleMoreOpenChange : undefined}
                        moreOpen={layer.phase === 'active' && role === null && moreMenuOpen}
                      />
                    )
                  })}
                </div>

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
              <PlaybackInfoButton
                visible={Boolean(track)}
                visualIsPlaying={visualPlaybackState === 'playing'}
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
          </section>
        </ResponsivePlayerLayout>

        <AnimatePresence initial={false}>
          {playlist.isOpen ? (
            <PlaylistPanel
              key={`${playlist.playlistName ?? 'playlist'}:${playlist.tracks.length}:${playlist.tracks[0]?.id ?? ''}:${playlist.tracks[playlist.tracks.length - 1]?.id ?? ''}`}
              tracks={playlist.tracks}
              unavailableTrackIds={playlist.unavailableTrackIds}
              playlistName={playlist.playlistName}
              currentTrackId={playlist.currentTrackId}
              totalDurationSeconds={playlist.totalDurationSeconds}
              shuffleMode={playlist.shuffleMode}
              onShuffleCycle={playlist.onShuffleCycle}
              onTrackSelect={playlist.onTrackSelect}
              onClose={() => playlist.onOpenChange(false)}
            />
          ) : null}
        </AnimatePresence>
      </main>
    </TooltipProvider>
  )
}
