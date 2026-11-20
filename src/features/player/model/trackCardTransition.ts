export type TrackCardRole = 'outgoing' | 'incoming'

export type TrackCardPose = Readonly<{
  xPx: number
  yPx: number
  zPx: number
  rotateX: number
  rotateY: number
  rotateZ: number
  scale: number
  opacity: number
}>

type PoseKeyframe = Omit<TrackCardPose, 'xPx' | 'yPx' | 'zPx' | 'opacity'> & {
  progress: number
  xWidth: number
  yWidth: number
  zWidth: number
}

// Keep this in sync with the lower bound of --player-track-card-perspective.
// Positive translateZ magnifies a plane by perspective / (perspective - z),
// so scale <= 1 by itself is not a sufficient upper bound on painted size.
export const TRACK_CARD_MIN_PERSPECTIVE_PX = 1200

const nextOutgoing: readonly PoseKeyframe[] = [
  { progress: 0, xWidth: 0, yWidth: 0, zWidth: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 },
  { progress: 0.1, xWidth: -0.04, yWidth: 0, zWidth: 0.02, rotateX: -1, rotateY: 9, rotateZ: -0.2, scale: 0.995 },
  { progress: 0.5, xWidth: -0.34, yWidth: 0, zWidth: 0, rotateX: -5.5, rotateY: 36, rotateZ: -1.3, scale: 0.93 },
  { progress: 0.9, xWidth: -0.78, yWidth: 0, zWidth: -0.04, rotateX: -2, rotateY: 45, rotateZ: -2, scale: 0.82 },
  { progress: 1, xWidth: -0.94, yWidth: 0, zWidth: -0.07, rotateX: 0, rotateY: 48, rotateZ: -2.2, scale: 0.78 },
]

const nextIncoming: readonly PoseKeyframe[] = [
  { progress: 0, xWidth: 0.94, yWidth: 0, zWidth: -0.07, rotateX: 0, rotateY: -48, rotateZ: 2.2, scale: 0.78 },
  { progress: 0.1, xWidth: 0.78, yWidth: 0.006, zWidth: -0.04, rotateX: 2, rotateY: -45, rotateZ: 2, scale: 0.8 },
  { progress: 0.5, xWidth: 0.34, yWidth: 0.024, zWidth: 0, rotateX: 5.5, rotateY: -36, rotateZ: 1.3, scale: 0.86 },
  { progress: 0.9, xWidth: 0.04, yWidth: 0.006, zWidth: 0.02, rotateX: 1, rotateY: -9, rotateZ: 0.2, scale: 0.995 },
  { progress: 1, xWidth: 0, yWidth: 0, zWidth: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 },
]

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function interpolateKeyframes(keyframes: readonly PoseKeyframe[], progress: number, coverWidth: number): Omit<TrackCardPose, 'opacity'> {
  const clamped = Math.min(1, Math.max(0, progress))
  const rightIndex = keyframes.findIndex((frame) => frame.progress >= clamped)
  const right = keyframes[Math.max(0, rightIndex)]
  const left = keyframes[Math.max(0, rightIndex - 1)]
  const local = (clamped - left.progress) / Math.max(0.0001, right.progress - left.progress)
  return {
    xPx: mix(left.xWidth, right.xWidth, local) * coverWidth,
    yPx: mix(left.yWidth, right.yWidth, local) * coverWidth,
    zPx: mix(left.zWidth, right.zWidth, local) * coverWidth,
    rotateX: mix(left.rotateX, right.rotateX, local),
    rotateY: mix(left.rotateY, right.rotateY, local),
    rotateZ: mix(left.rotateZ, right.rotateZ, local),
    scale: mix(left.scale, right.scale, local),
  }
}

type ProjectedBounds = Readonly<{
  width: number
  height: number
}>

type RotatedCorner = Readonly<{
  x: number
  y: number
  z: number
}>

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

function rotatedCoverCorners(
  pose: Omit<TrackCardPose, 'opacity'>,
  coverWidth: number,
  coverHeight: number,
): readonly RotatedCorner[] {
  const rx = toRadians(pose.rotateX)
  const ry = toRadians(pose.rotateY)
  const rz = toRadians(pose.rotateZ)
  const sinX = Math.sin(rx)
  const cosX = Math.cos(rx)
  const sinY = Math.sin(ry)
  const cosY = Math.cos(ry)
  const sinZ = Math.sin(rz)
  const cosZ = Math.cos(rz)
  const corners: RotatedCorner[] = []

  for (const xSign of [-1, 1] as const) {
    for (const ySign of [-1, 1] as const) {
      const x = xSign * coverWidth * 0.5
      const y = ySign * coverHeight * 0.5
      // CSS applies the right-most transform first: scale, rotateZ,
      // rotateY, rotateX, then translate3d for our transform string.
      const zRotatedX = x * cosZ - y * sinZ
      const zRotatedY = x * sinZ + y * cosZ
      const yRotatedX = zRotatedX * cosY
      const yRotatedZ = -zRotatedX * sinY
      const rotatedY = zRotatedY * cosX - yRotatedZ * sinX
      const rotatedZ = zRotatedY * sinX + yRotatedZ * cosX
      corners.push({ x: yRotatedX, y: rotatedY, z: rotatedZ })
    }
  }
  return corners
}

function projectedCoverBounds(
  pose: Omit<TrackCardPose, 'opacity'>,
  rotatedCorners: readonly RotatedCorner[],
  perspectivePx: number,
  scale: number,
): ProjectedBounds {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const corner of rotatedCorners) {
      const translatedX = corner.x * scale + pose.xPx
      const translatedY = corner.y * scale + pose.yPx
      const translatedZ = Math.min(pose.zPx + corner.z * scale, perspectivePx * 0.95)
      const projection = perspectivePx / (perspectivePx - translatedZ)
      const projectedX = translatedX * projection
      const projectedY = translatedY * projection
      minX = Math.min(minX, projectedX)
      maxX = Math.max(maxX, projectedX)
      minY = Math.min(minY, projectedY)
      maxY = Math.max(maxY, projectedY)
  }

  return { width: maxX - minX, height: maxY - minY }
}

function constrainProjectedSize(
  pose: Omit<TrackCardPose, 'opacity'>,
  coverWidth: number,
  coverHeight: number,
  perspectivePx: number,
): Omit<TrackCardPose, 'opacity'> {
  const perspective = Math.max(1, perspectivePx)
  const zPx = Math.min(pose.zPx, perspective * 0.25)
  const boundedPose = { ...pose, zPx }
  const corners = rotatedCoverCorners(boundedPose, coverWidth, coverHeight)
  const fits = (scale: number) => {
    const bounds = projectedCoverBounds(boundedPose, corners, perspective, scale)
    return bounds.width <= coverWidth && bounds.height <= coverHeight
  }
  let low = 0
  let high = pose.scale
  if (fits(high)) low = high
  else {
    // The projected AABB includes rotateX/Y/Z, per-corner depth and the
    // translation/depth interaction. A fixed iteration count is deterministic
    // and resolves far below a device pixel for normal cover dimensions.
    for (let index = 0; index < 24; index += 1) {
      const candidate = (low + high) * 0.5
      if (fits(candidate)) low = candidate
      else high = candidate
    }
  }
  return {
    ...boundedPose,
    scale: low,
  }
}

export function getTrackCardPose(
  role: TrackCardRole,
  direction: -1 | 1,
  progress: number,
  coverWidth: number,
  reducedMotion = false,
  coverHeight = coverWidth,
  perspectivePx = TRACK_CARD_MIN_PERSPECTIVE_PX,
): TrackCardPose {
  const width = Math.max(1, coverWidth)
  const height = Math.max(1, coverHeight)
  const p = Math.min(1, Math.max(0, progress))
  const opacity = getTrackCardOpacity(role, p)
  if (reducedMotion) {
    return { xPx: 0, yPx: 0, zPx: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, opacity }
  }
  // Previous is the exact role-swapped, time-reversed canonical next motion.
  const canonicalRole = direction > 0 ? role : role === 'outgoing' ? 'incoming' : 'outgoing'
  const canonicalProgress = direction > 0 ? p : 1 - p
  const geometry = constrainProjectedSize(
    interpolateKeyframes(canonicalRole === 'outgoing' ? nextOutgoing : nextIncoming, canonicalProgress, width),
    width,
    height,
    perspectivePx,
  )
  return { ...geometry, opacity }
}

export function getTrackCardOpacity(role: TrackCardRole, progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return role === 'outgoing'
    ? p <= 0.1 ? 1 : Math.min(1, Math.max(0, (1 - p) / 0.9))
    : Math.min(1, Math.max(0, p / 0.9))
}

export function trackCardTransform(pose: TrackCardPose): string {
  return `translate3d(${pose.xPx}px, ${pose.yPx}px, ${pose.zPx}px) rotateX(${pose.rotateX}deg) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg) scale(${pose.scale})`
}
