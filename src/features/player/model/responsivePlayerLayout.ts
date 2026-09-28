export type PlayerLayoutMode = 'full' | 'horizontal' | 'vertical' | 'quarter'
export type ResolvedPlayerLayoutMode = PlayerLayoutMode | 'compact'
export type CompactLayoutProfile =
  | 'compact-row'
  | 'compact-row-lyric'
  | 'compact-stacked'
  | 'compact-stacked-lyric'

export type ViewportSize = {
  width: number
  height: number
}

export type PlayerLayoutBounds = {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  informationLevel: number
  tieBreakPriority: number
}

export type ResponsivePlayerLayoutConfig = {
  minScale: number
  promotionScale: number
  decisionBucketPx: number
  layouts: Readonly<Record<PlayerLayoutMode, PlayerLayoutBounds>>
}

export type PlayerLayoutCandidate = {
  layout: PlayerLayoutMode
  lower: number
  upper: number
  scale: number
  virtualWidth: number
  virtualHeight: number
  scaleLoss: number
  overflowWidth: number
  overflowHeight: number
  distortion: number
}

export type ResponsivePlayerLayoutResult = {
  layout: ResolvedPlayerLayoutMode
  scale: number
  fallback: boolean
  short: boolean
  decisionWidth: number
  decisionHeight: number
  compactProfile: CompactLayoutProfile | null
}

export const PLAYER_LAYOUT_MODES: readonly PlayerLayoutMode[] = [
  'full',
  'horizontal',
  'vertical',
  'quarter',
]

export const RESPONSIVE_PLAYER_LAYOUT_CONFIG: ResponsivePlayerLayoutConfig = {
  minScale: 0.9,
  promotionScale: 0.96,
  decisionBucketPx: 4,
  layouts: {
    full: {
      minWidth: 1920,
      maxWidth: 2560,
      minHeight: 1080,
      maxHeight: 1440,
      informationLevel: 3,
      tieBreakPriority: 4,
    },
    horizontal: {
      minWidth: 1723,
      maxWidth: 2560,
      minHeight: 720,
      maxHeight: 1080,
      informationLevel: 2,
      tieBreakPriority: 3,
    },
    vertical: {
      minWidth: 1024,
      maxWidth: 1920,
      minHeight: 1120,
      maxHeight: 1440,
      informationLevel: 2,
      tieBreakPriority: 2,
    },
    quarter: {
      minWidth: 640,
      maxWidth: 1024,
      minHeight: 1200,
      maxHeight: 1440,
      informationLevel: 1,
      tieBreakPriority: 1,
    },
  },
}

const EPSILON = 1e-9
const SHORT_LAYOUT_BREAKPOINT = 600
const COMPACT_MIN_WIDTH = 640
const COMPACT_MIN_HEIGHT = 720
const COMPACT_SAFE_MIN_WIDTH = COMPACT_MIN_WIDTH * RESPONSIVE_PLAYER_LAYOUT_CONFIG.minScale
const COMPACT_SAFE_MIN_HEIGHT = COMPACT_MIN_HEIGHT * RESPONSIVE_PLAYER_LAYOUT_CONFIG.minScale
const COMPACT_WIDTH_ANCHORS = [640, 900, 924, 1552] as const
const COMPACT_HEIGHT_ANCHORS = [720, 891, 1008, 1031, 1080] as const

function finiteViewportDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

type ViewportAxis = 'width' | 'height'

export function getPlayerLayoutDecisionAnchors(
  axis: ViewportAxis,
  config: ResponsivePlayerLayoutConfig = RESPONSIVE_PLAYER_LAYOUT_CONFIG,
): readonly number[] {
  const minimumKey = axis === 'width' ? 'minWidth' : 'minHeight'
  const maximumKey = axis === 'width' ? 'maxWidth' : 'maxHeight'
  const compactAnchors = axis === 'width' ? COMPACT_WIDTH_ANCHORS : COMPACT_HEIGHT_ANCHORS
  return [...new Set([
    ...PLAYER_LAYOUT_MODES.flatMap((layout) => [
      config.layouts[layout][minimumKey],
      config.layouts[layout][maximumKey],
    ]),
    ...compactAnchors,
  ])].sort((left, right) => left - right)
}

function quantize(value: number, bucket: number, anchors: readonly number[]): number {
  const bucketedValue = Math.floor(value / bucket) * bucket
  const crossedAnchor = anchors.findLast(
    (anchor) => anchor <= value && anchor > bucketedValue,
  )
  return crossedAnchor ?? bucketedValue
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function calculatePlayerLayoutCandidate(
  layout: PlayerLayoutMode,
  viewport: ViewportSize,
  config: ResponsivePlayerLayoutConfig = RESPONSIVE_PLAYER_LAYOUT_CONFIG,
): PlayerLayoutCandidate | null {
  const bounds = config.layouts[layout]
  // A viewport axis may exceed the scaled design maximum: the composition
  // keeps its content maximum and absorbs that surplus as outer whitespace.
  // Candidate viability depends on reaching both design minima at one shared
  // scale. Excess beyond a design maximum remains viable, but contributes to
  // the candidate's distortion score so a better-shaped layout can win.
  const lower = config.minScale
  const upper = Math.min(
    1,
    viewport.width / bounds.minWidth,
    viewport.height / bounds.minHeight,
  )

  if (lower > upper + EPSILON) return null

  const scale = clamp(upper, lower, 1)
  const virtualWidth = viewport.width / scale
  const virtualHeight = viewport.height / scale
  const scaleLoss = 1 - scale
  const overflowWidth = Math.max(0, virtualWidth / bounds.maxWidth - 1)
  const overflowHeight = Math.max(0, virtualHeight / bounds.maxHeight - 1)

  return {
    layout,
    lower,
    upper,
    scale,
    virtualWidth,
    virtualHeight,
    scaleLoss,
    overflowWidth,
    overflowHeight,
    distortion: Math.max(scaleLoss, overflowWidth, overflowHeight),
  }
}

function compareFixedPriority(
  left: PlayerLayoutMode,
  right: PlayerLayoutMode,
  config: ResponsivePlayerLayoutConfig,
): number {
  return config.layouts[right].tieBreakPriority - config.layouts[left].tieBreakPriority
}

function compareCandidates(
  left: PlayerLayoutCandidate,
  right: PlayerLayoutCandidate,
  promoteInformation: boolean,
  config: ResponsivePlayerLayoutConfig,
): number {
  const informationDifference = config.layouts[right.layout].informationLevel
    - config.layouts[left.layout].informationLevel
  const distortionDifference = left.distortion - right.distortion
  const scaleDifference = right.scale - left.scale

  if (promoteInformation) {
    if (informationDifference !== 0) return informationDifference
    if (Math.abs(distortionDifference) > EPSILON) return distortionDifference
    if (Math.abs(scaleDifference) > EPSILON) return scaleDifference
    return compareFixedPriority(left.layout, right.layout, config)
  }

  if (Math.abs(distortionDifference) > EPSILON) return distortionDifference
  if (informationDifference !== 0) return informationDifference
  if (Math.abs(scaleDifference) > EPSILON) return scaleDifference
  return compareFixedPriority(left.layout, right.layout, config)
}

function normalizedMinimumShortfall(value: number, minimum: number): number {
  return value < minimum ? (minimum - value) / minimum : 0
}

function fallbackDistance(
  viewport: ViewportSize,
  bounds: PlayerLayoutBounds,
  config: ResponsivePlayerLayoutConfig,
): number {
  const widthDistance = normalizedMinimumShortfall(
    viewport.width,
    bounds.minWidth * config.minScale,
  )
  const heightDistance = normalizedMinimumShortfall(
    viewport.height,
    bounds.minHeight * config.minScale,
  )
  return Math.hypot(widthDistance, heightDistance)
}

function resolveFallbackLayout(
  viewport: ViewportSize,
  config: ResponsivePlayerLayoutConfig,
): PlayerLayoutMode {
  return [...PLAYER_LAYOUT_MODES].sort((left, right) => {
    const distanceDifference = fallbackDistance(viewport, config.layouts[left], config)
      - fallbackDistance(viewport, config.layouts[right], config)
    if (Math.abs(distanceDifference) > EPSILON) return distanceDifference

    const informationDifference = config.layouts[right].informationLevel
      - config.layouts[left].informationLevel
    if (informationDifference !== 0) return informationDifference
    return compareFixedPriority(left, right, config)
  })[0]
}

function calculateRawScale(
  layout: PlayerLayoutMode,
  viewport: ViewportSize,
  config: ResponsivePlayerLayoutConfig,
): number {
  const bounds = config.layouts[layout]
  return clamp(
    Math.min(1, viewport.width / bounds.minWidth, viewport.height / bounds.minHeight),
    config.minScale,
    1,
  )
}

function resolveCompactProfile(viewport: ViewportSize): CompactLayoutProfile {
  if (viewport.height >= 1031) return 'compact-stacked-lyric'
  if (viewport.width >= 900) return 'compact-row-lyric'
  if (viewport.height >= 891) return 'compact-stacked'
  return 'compact-row'
}

export function resolveResponsivePlayerLayout(
  width: number,
  height: number,
  config: ResponsivePlayerLayoutConfig = RESPONSIVE_PLAYER_LAYOUT_CONFIG,
): ResponsivePlayerLayoutResult {
  const rawViewport = {
    width: finiteViewportDimension(width, config.layouts.full.minWidth),
    height: finiteViewportDimension(height, config.layouts.full.minHeight),
  }
  const bucket = Math.max(1, config.decisionBucketPx)
  const widthAnchors = getPlayerLayoutDecisionAnchors('width', config)
  const heightAnchors = getPlayerLayoutDecisionAnchors('height', config)
  const decisionViewport = {
    width: quantize(rawViewport.width, bucket, widthAnchors),
    height: quantize(rawViewport.height, bucket, heightAnchors),
  }
  const candidates = PLAYER_LAYOUT_MODES
    .map((layout) => calculatePlayerLayoutCandidate(layout, decisionViewport, config))
    .filter((candidate): candidate is PlayerLayoutCandidate => candidate !== null)
  const promotionCandidates = candidates.filter(
    (candidate) => candidate.distortion <= 1 - config.promotionScale + EPSILON,
  )
  const eligibleCandidates = promotionCandidates.length > 0 ? promotionCandidates : candidates
  const fallback = eligibleCandidates.length === 0
  const compact = fallback
    && decisionViewport.width >= COMPACT_MIN_WIDTH
    && decisionViewport.height >= COMPACT_MIN_HEIGHT
  const compactFallback = fallback
    && !compact
    && decisionViewport.width >= COMPACT_SAFE_MIN_WIDTH
    && decisionViewport.height >= COMPACT_SAFE_MIN_HEIGHT
  if (compact || compactFallback) {
    const compactScale = compact
      ? 1
      : Math.min(
          1,
          rawViewport.width / COMPACT_MIN_WIDTH,
          rawViewport.height / COMPACT_MIN_HEIGHT,
        )
    return {
      layout: 'compact',
      scale: compactScale,
      fallback: compactFallback,
      short: false,
      decisionWidth: decisionViewport.width,
      decisionHeight: decisionViewport.height,
      compactProfile: resolveCompactProfile(decisionViewport),
    }
  }
  const layout = fallback
    ? resolveFallbackLayout(decisionViewport, config)
    : [...eligibleCandidates].sort((left, right) => compareCandidates(
        left,
        right,
        promotionCandidates.length > 0,
        config,
      ))[0].layout

  return {
    layout,
    scale: fallback ? config.minScale : calculateRawScale(layout, rawViewport, config),
    fallback,
    short: rawViewport.height < SHORT_LAYOUT_BREAKPOINT,
    decisionWidth: decisionViewport.width,
    decisionHeight: decisionViewport.height,
    compactProfile: null,
  }
}
