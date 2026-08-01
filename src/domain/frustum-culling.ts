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
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
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

export const aabbIntersectsPerspectiveFrustum = (
  bounds: AxisAlignedBounds,
  frustum: PerspectiveFrustum,
): boolean => {
  const { aspect, nearPlane, farPlane, verticalFovDegrees, camera } = frustum
  if (
    !finiteBounds(bounds) ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(nearPlane) ||
    nearPlane < 0 ||
    !Number.isFinite(farPlane) ||
    farPlane < nearPlane ||
    !Number.isFinite(verticalFovDegrees) ||
    verticalFovDegrees <= 0 ||
    verticalFovDegrees >= 180
  ) {
    return false
  }

  const halfHeight = Math.tan((verticalFovDegrees * Math.PI) / 360)
  const halfWidth = halfHeight * aspect
  const cosYaw = Math.cos(camera.rotation.y)
  const sinYaw = Math.sin(camera.rotation.y)
  const cosPitch = Math.cos(camera.rotation.x)
  const sinPitch = Math.sin(camera.rotation.x)
  const cosRoll = Math.cos(camera.rotation.z)
  const sinRoll = Math.sin(camera.rotation.z)
  const planeHasInsideCorner = [false, false, false, false, false, false]

  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const dx = x - camera.position.x
        const dy = y - camera.position.y
        const dz = z - camera.position.z

        // Inverse of Three.js Euler YXZ: Rz(-roll) * Rx(-pitch) * Ry(-yaw).
        const yawX = cosYaw * dx - sinYaw * dz
        const yawZ = sinYaw * dx + cosYaw * dz
        const pitchY = cosPitch * dy + sinPitch * yawZ
        const pitchZ = -sinPitch * dy + cosPitch * yawZ
        const viewX = cosRoll * yawX + sinRoll * pitchY
        const viewY = -sinRoll * yawX + cosRoll * pitchY
        const depth = -pitchZ
        const distances = [
          depth - nearPlane,
          farPlane - depth,
          viewX + depth * halfWidth,
          depth * halfWidth - viewX,
          viewY + depth * halfHeight,
          depth * halfHeight - viewY,
        ]
        const tolerance =
          Number.EPSILON * 16 * Math.max(1, Math.abs(viewX), Math.abs(viewY), Math.abs(depth), farPlane)
        for (let plane = 0; plane < distances.length; plane += 1) {
          if (distances[plane]! >= -tolerance) {
            planeHasInsideCorner[plane] = true
          }
        }
      }
    }
  }

  return planeHasInsideCorner.every(Boolean)
}
