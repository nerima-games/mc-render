import type { MirroredCameraState } from './camera-mirror'

export type AxisAlignedBounds = {
  readonly min: Readonly<{ x: number; y: number; z: number }>
  readonly max: Readonly<{ x: number; y: number; z: number }>
}

/**
 * A world-space sample point, private to this file's vertex-scanning and
 * plane-mask machinery.
 *
 * Deliberately its own type rather than reusing `AxisAlignedBounds`'s `{ x, y, z }`
 * shape: nothing outside this file constructs one, so its fields are named for
 * what the consuming code does with them rather than for brevity.
 */
type SampledPoint = {
  readonly worldX: number
  readonly worldY: number
  readonly worldZ: number
}

export type PerspectiveFrustum = {
  readonly camera: MirroredCameraState
  readonly verticalFovDegrees: number
  readonly aspect: number
  readonly nearPlane: number
  readonly farPlane: number
}

export type PreparedPerspectiveFrustum = {
  readonly positionX: number
  readonly positionY: number
  readonly positionZ: number
  readonly nearPlane: number
  readonly farPlane: number
  readonly halfHeight: number
  readonly halfWidth: number
  readonly cosYaw: number
  readonly sinYaw: number
  readonly cosPitch: number
  readonly sinPitch: number
  readonly cosRoll: number
  readonly sinRoll: number
  readonly isValid: boolean
}

/** An empty position buffer carries no vertices at all. */
const EMPTY_POSITIONS_LENGTH = 0
/** Each vertex contributes three components: x, y, z. */
const POSITION_COMPONENTS_PER_VERTEX = 3
/** A complete buffer's length divides evenly into vertices. */
const NO_REMAINDER = 0
/** The flat buffer's y component sits one slot after its x component. */
const Y_OFFSET = 1
/** The flat buffer's z component sits two slots after its x component. */
const Z_OFFSET = 2

const hasCompleteVertices = (positions: Float32Array): boolean =>
  positions.length !== EMPTY_POSITIONS_LENGTH && positions.length % POSITION_COMPONENTS_PER_VERTEX === NO_REMAINDER

type BoundsAccumulator = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

const initialBoundsAccumulator = (): BoundsAccumulator => ({
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  maxZ: Number.NEGATIVE_INFINITY,
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  minZ: Number.POSITIVE_INFINITY,
})

/** Absorb one sample into the accumulator; reports `false` (rather than throwing) on a non-finite sample so the caller can fail closed. */
const accumulateVertex = (accumulator: BoundsAccumulator, sample: SampledPoint): boolean => {
  if (!Number.isFinite(sample.worldX) || !Number.isFinite(sample.worldY) || !Number.isFinite(sample.worldZ)) {
    return false
  }
  accumulator.minX = Math.min(accumulator.minX, sample.worldX)
  accumulator.minY = Math.min(accumulator.minY, sample.worldY)
  accumulator.minZ = Math.min(accumulator.minZ, sample.worldZ)
  accumulator.maxX = Math.max(accumulator.maxX, sample.worldX)
  accumulator.maxY = Math.max(accumulator.maxY, sample.worldY)
  accumulator.maxZ = Math.max(accumulator.maxZ, sample.worldZ)
  return true
}

export const boundsFromPositions = (positions: Float32Array): AxisAlignedBounds | undefined => {
  if (!hasCompleteVertices(positions)) {
    return undefined
  }

  const accumulator = initialBoundsAccumulator()
  for (let index = 0; index < positions.length; index += POSITION_COMPONENTS_PER_VERTEX) {
    const worldX = positions[index]!
    const worldY = positions[index + Y_OFFSET]!
    const worldZ = positions[index + Z_OFFSET]!
    if (!accumulateVertex(accumulator, { worldX, worldY, worldZ })) {
      return undefined
    }
  }

  return {
    max: { x: accumulator.maxX, y: accumulator.maxY, z: accumulator.maxZ },
    min: { x: accumulator.minX, y: accumulator.minY, z: accumulator.minZ },
  }
}

const finiteBounds = (bounds: AxisAlignedBounds): boolean =>
  Number.isFinite(bounds.min.x) &&
  Number.isFinite(bounds.min.y) &&
  Number.isFinite(bounds.min.z) &&
  Number.isFinite(bounds.max.x) &&
  Number.isFinite(bounds.max.y) &&
  Number.isFinite(bounds.max.z) &&
  bounds.min.x <= bounds.max.x &&
  bounds.min.y <= bounds.max.y &&
  bounds.min.z <= bounds.max.z

/** Below this, an aspect ratio cannot represent a real viewport. */
const MIN_ASPECT_RATIO = 0
/** A camera's near plane cannot sit behind the eye. */
const MIN_NEAR_PLANE = 0
/** A vertical field of view of 0 degrees sees nothing. */
const MIN_VERTICAL_FOV_DEGREES = 0
/** A vertical field of view of 180 degrees or more folds the frustum onto itself. */
const MAX_VERTICAL_FOV_DEGREES = 180

type ProjectionParams = {
  readonly verticalFovDegrees: number
  readonly aspect: number
  readonly nearPlane: number
  readonly farPlane: number
}

const validProjection = (params: ProjectionParams): boolean => {
  const { verticalFovDegrees, aspect, nearPlane, farPlane } = params
  return (
    Number.isFinite(aspect) &&
    aspect > MIN_ASPECT_RATIO &&
    Number.isFinite(nearPlane) &&
    nearPlane >= MIN_NEAR_PLANE &&
    Number.isFinite(farPlane) &&
    farPlane >= nearPlane &&
    Number.isFinite(verticalFovDegrees) &&
    verticalFovDegrees > MIN_VERTICAL_FOV_DEGREES &&
    verticalFovDegrees < MAX_VERTICAL_FOV_DEGREES
  )
}

/** `halfHeight` for an invalid projection: the frustum has no extent. */
const NO_HALF_HEIGHT = 0
/** `2 * 180`: converts a full vertical FOV in degrees into a half-angle in radians (`fov * PI / 360` is `(fov / 2) * (PI / 180)`). */
const DEGREES_TO_HALF_ANGLE_RADIANS_DIVISOR = 360

const halfHeightFor = (isValid: boolean, verticalFovDegrees: number): number => {
  if (!isValid) {
    return NO_HALF_HEIGHT
  }
  return Math.tan((verticalFovDegrees * Math.PI) / DEGREES_TO_HALF_ANGLE_RADIANS_DIVISOR)
}

export const preparePerspectiveFrustum = ({
  camera,
  verticalFovDegrees,
  aspect,
  nearPlane,
  farPlane,
}: PerspectiveFrustum): PreparedPerspectiveFrustum => {
  const isValid = validProjection({ aspect, farPlane, nearPlane, verticalFovDegrees })
  const halfHeight = halfHeightFor(isValid, verticalFovDegrees)

  return {
    cosPitch: Math.cos(camera.rotation.x),
    cosRoll: Math.cos(camera.rotation.z),
    cosYaw: Math.cos(camera.rotation.y),
    farPlane,
    halfHeight,
    halfWidth: halfHeight * aspect,
    isValid,
    nearPlane,
    positionX: camera.position.x,
    positionY: camera.position.y,
    positionZ: camera.position.z,
    sinPitch: Math.sin(camera.rotation.x),
    sinRoll: Math.sin(camera.rotation.z),
    sinYaw: Math.sin(camera.rotation.y),
  }
}

type RotatedOffset = {
  readonly viewX: number
  readonly viewY: number
  readonly depth: number
}

/** Rotate a world-space offset from the camera into view space (Three.js Euler YXZ, inverted: Rz(-roll) * Rx(-pitch) * Ry(-yaw)). */
const rotateToViewSpace = (point: SampledPoint, frustum: PreparedPerspectiveFrustum): RotatedOffset => {
  const dx = point.worldX - frustum.positionX
  const dy = point.worldY - frustum.positionY
  const dz = point.worldZ - frustum.positionZ

  const yawX = frustum.cosYaw * dx - frustum.sinYaw * dz
  const yawZ = frustum.sinYaw * dx + frustum.cosYaw * dz
  const pitchY = frustum.cosPitch * dy + frustum.sinPitch * yawZ
  const pitchZ = -frustum.sinPitch * dy + frustum.cosPitch * yawZ
  const viewX = frustum.cosRoll * yawX + frustum.sinRoll * pitchY
  const viewY = -frustum.sinRoll * yawX + frustum.cosRoll * pitchY

  return { depth: -pitchZ, viewX, viewY }
}

/** Machine-epsilon multiplier absorbing the several chained multiply-adds `rotateToViewSpace` performs. */
const FLOATING_POINT_ERROR_MARGIN = 16
/** Floor for the tolerance scale so it does not collapse to zero near the origin. */
const MIN_MAGNITUDE_FOR_TOLERANCE = 1

const toleranceFor = (view: RotatedOffset, frustum: PreparedPerspectiveFrustum): number =>
  Number.EPSILON *
  FLOATING_POINT_ERROR_MARGIN *
  Math.max(MIN_MAGNITUDE_FOR_TOLERANCE, Math.abs(view.viewX), Math.abs(view.viewY), Math.abs(view.depth), frustum.farPlane)

/**
 * The six frustum-plane bits `insidePlaneMask` reports. Every use of raw bit
 * arithmetic in this file is mask-packing over these six independent flags —
 * see `.oxlintrc.json`'s `no-bitwise` exemption, which names this file by
 * example.
 */
const NEAR_PLANE_BIT = 1
const FAR_PLANE_BIT = 2
const LEFT_PLANE_BIT = 4
const RIGHT_PLANE_BIT = 8
const BOTTOM_PLANE_BIT = 16
const TOP_PLANE_BIT = 32
const ALL_PLANES_MASK =
  NEAR_PLANE_BIT | FAR_PLANE_BIT | LEFT_PLANE_BIT | RIGHT_PLANE_BIT | BOTTOM_PLANE_BIT | TOP_PLANE_BIT

type PlaneTest = {
  readonly bit: number
  readonly signedDistance: number
}

const planeTests = (view: RotatedOffset, frustum: PreparedPerspectiveFrustum): ReadonlyArray<PlaneTest> => [
  { bit: NEAR_PLANE_BIT, signedDistance: view.depth - frustum.nearPlane },
  { bit: FAR_PLANE_BIT, signedDistance: frustum.farPlane - view.depth },
  { bit: LEFT_PLANE_BIT, signedDistance: view.viewX + view.depth * frustum.halfWidth },
  { bit: RIGHT_PLANE_BIT, signedDistance: view.depth * frustum.halfWidth - view.viewX },
  { bit: BOTTOM_PLANE_BIT, signedDistance: view.viewY + view.depth * frustum.halfHeight },
  { bit: TOP_PLANE_BIT, signedDistance: view.depth * frustum.halfHeight - view.viewY },
]

const planeBits = (view: RotatedOffset, tolerance: number, frustum: PreparedPerspectiveFrustum): number => {
  let mask = 0
  for (const test of planeTests(view, frustum)) {
    if (test.signedDistance >= -tolerance) {
      mask |= test.bit
    }
  }
  return mask
}

const insidePlaneMask = (point: SampledPoint, frustum: PreparedPerspectiveFrustum): number => {
  const view = rotateToViewSpace(point, frustum)
  const tolerance = toleranceFor(view, frustum)
  return planeBits(view, tolerance, frustum)
}

/** The eight corners of an AABB, as the `SampledPoint`s `insidePlaneMask` takes. */
const boxCorners = (bounds: AxisAlignedBounds): ReadonlyArray<SampledPoint> => {
  const { min, max } = bounds
  const corners: Array<SampledPoint> = []
  for (const worldX of [min.x, max.x]) {
    for (const worldY of [min.y, max.y]) {
      for (const worldZ of [min.z, max.z]) {
        corners.push({ worldX, worldY, worldZ })
      }
    }
  }
  return corners
}

export const aabbIntersectsPreparedPerspectiveFrustum = (
  bounds: AxisAlignedBounds,
  frustum: PreparedPerspectiveFrustum,
): boolean => {
  if (!finiteBounds(bounds) || !frustum.isValid) {
    return false
  }

  let mask = 0
  for (const corner of boxCorners(bounds)) {
    mask |= insidePlaneMask(corner, frustum)
    if (mask === ALL_PLANES_MASK) {
      return true
    }
  }
  return mask === ALL_PLANES_MASK
}

export const aabbIntersectsPerspectiveFrustum = (
  bounds: AxisAlignedBounds,
  frustum: PerspectiveFrustum,
): boolean =>
  aabbIntersectsPreparedPerspectiveFrustum(bounds, preparePerspectiveFrustum(frustum))
