import type { MirroredCameraState } from './camera-mirror'

export type AxisAlignedBounds = {
  readonly min: Readonly<{ x: number; y: number; z: number }>
  readonly max: Readonly<{ x: number; y: number; z: number }>
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

export const boundsFromPositions = (positions: Float32Array): AxisAlignedBounds | undefined => {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    return undefined
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!
    const y = positions[index + 1]!
    const z = positions[index + 2]!
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return undefined
    }
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  return {
    max: { x: maxX, y: maxY, z: maxZ },
    min: { x: minX, y: minY, z: minZ },
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

const validProjection = (
  verticalFovDegrees: number,
  aspect: number,
  nearPlane: number,
  farPlane: number,
): boolean =>
  Number.isFinite(aspect) &&
  aspect > 0 &&
  Number.isFinite(nearPlane) &&
  nearPlane >= 0 &&
  Number.isFinite(farPlane) &&
  farPlane >= nearPlane &&
  Number.isFinite(verticalFovDegrees) &&
  verticalFovDegrees > 0 &&
  verticalFovDegrees < 180

export const preparePerspectiveFrustum = (
  camera: MirroredCameraState,
  verticalFovDegrees: number,
  aspect: number,
  nearPlane: number,
  farPlane: number,
): PreparedPerspectiveFrustum => {
  const isValid = validProjection(verticalFovDegrees, aspect, nearPlane, farPlane)
  const halfHeight = isValid ? Math.tan((verticalFovDegrees * Math.PI) / 360) : 0

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

const insidePlaneMask = (
  x: number,
  y: number,
  z: number,
  frustum: PreparedPerspectiveFrustum,
): number => {
  const dx = x - frustum.positionX
  const dy = y - frustum.positionY
  const dz = z - frustum.positionZ

  // Inverse of Three.js Euler YXZ: Rz(-roll) * Rx(-pitch) * Ry(-yaw).
  const yawX = frustum.cosYaw * dx - frustum.sinYaw * dz
  const yawZ = frustum.sinYaw * dx + frustum.cosYaw * dz
  const pitchY = frustum.cosPitch * dy + frustum.sinPitch * yawZ
  const pitchZ = -frustum.sinPitch * dy + frustum.cosPitch * yawZ
  const viewX = frustum.cosRoll * yawX + frustum.sinRoll * pitchY
  const viewY = -frustum.sinRoll * yawX + frustum.cosRoll * pitchY
  const depth = -pitchZ
  const tolerance =
    Number.EPSILON * 16 * Math.max(1, Math.abs(viewX), Math.abs(viewY), Math.abs(depth), frustum.farPlane)
  let mask = 0
  if (depth - frustum.nearPlane >= -tolerance) {mask += 1}
  if (frustum.farPlane - depth >= -tolerance) {mask += 2}
  if (viewX + depth * frustum.halfWidth >= -tolerance) {mask += 4}
  if (depth * frustum.halfWidth - viewX >= -tolerance) {mask += 8}
  if (viewY + depth * frustum.halfHeight >= -tolerance) {mask += 16}
  if (depth * frustum.halfHeight - viewY >= -tolerance) {mask += 32}
  return mask
}

export const aabbIntersectsPreparedPerspectiveFrustum = (
  bounds: AxisAlignedBounds,
  frustum: PreparedPerspectiveFrustum,
): boolean => {
  if (!finiteBounds(bounds) || !frustum.isValid) {
    return false
  }

  const { min, max } = bounds
  const allPlanesMask = 63
  let mask = 0
  mask |= insidePlaneMask(min.x, min.y, min.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(min.x, min.y, max.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(min.x, max.y, min.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(min.x, max.y, max.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(max.x, min.y, min.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(max.x, min.y, max.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(max.x, max.y, min.z, frustum)
  if (mask === allPlanesMask) {return true}
  mask |= insidePlaneMask(max.x, max.y, max.z, frustum)
  return mask === allPlanesMask
}

export const aabbIntersectsPerspectiveFrustum = (
  bounds: AxisAlignedBounds,
  frustum: PerspectiveFrustum,
): boolean =>
  aabbIntersectsPreparedPerspectiveFrustum(
    bounds,
    preparePerspectiveFrustum(
      frustum.camera,
      frustum.verticalFovDegrees,
      frustum.aspect,
      frustum.nearPlane,
      frustum.farPlane,
    ),
  )
