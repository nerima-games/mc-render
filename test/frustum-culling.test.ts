import { describe, expect, it } from 'vitest'
import { mirroredCameraState } from '../src/domain/camera-mirror'
import {
  aabbIntersectsPerspectiveFrustum,
  boundsFromPositions,
  type AxisAlignedBounds,
} from '../src/domain/frustum-culling'
import { MonotonicTimeSecs, position } from '../src/domain/kernel-vocabulary'

const camera = (yaw = 0, pitch = 0, roll = 0) => ({
  ...mirroredCameraState({
    position: position(0, 0, 0),
    yawRadians: yaw,
    pitchRadians: pitch,
    capturedAtSecs: MonotonicTimeSecs(0),
  }),
  rotation: { x: pitch, y: yaw, z: roll, order: 'YXZ' as const },
})

const visible = (bounds: AxisAlignedBounds, overrides = {}) =>
  aabbIntersectsPerspectiveFrustum(bounds, {
    camera: camera(),
    verticalFovDegrees: 90,
    aspect: 1,
    nearPlane: 1,
    farPlane: 10,
    ...overrides,
  })

describe('boundsFromPositions', () => {
  it('extracts deterministic minima and maxima', () => {
    expect(boundsFromPositions(new Float32Array([4, -2, 1, -3, 5, -7, 0, 1, 9]))).toStrictEqual({
      min: { x: -3, y: -2, z: -7 },
      max: { x: 4, y: 5, z: 9 },
    })
  })

  it('rejects empty, incomplete, and non-finite position buffers', () => {
    expect(boundsFromPositions(new Float32Array())).toBeUndefined()
    expect(boundsFromPositions(new Float32Array([0, 1]))).toBeUndefined()
    expect(boundsFromPositions(new Float32Array([0, Number.NaN, 0]))).toBeUndefined()
  })
})

describe('aabbIntersectsPerspectiveFrustum', () => {
  it('includes exact near, far, side, and top boundaries', () => {
    expect(visible({ min: { x: 0, y: 0, z: -1 }, max: { x: 0, y: 0, z: -1 } })).toBe(true)
    expect(visible({ min: { x: 0, y: 0, z: -10 }, max: { x: 0, y: 0, z: -10 } })).toBe(true)
    expect(visible({ min: { x: 5, y: 0, z: -5 }, max: { x: 5, y: 0, z: -5 } })).toBe(true)
    expect(visible({ min: { x: 0, y: 5, z: -5 }, max: { x: 0, y: 5, z: -5 } })).toBe(true)
  })

  it('rejects boxes beyond each plane and behind the camera', () => {
    expect(visible({ min: { x: 0, y: 0, z: -0.9 }, max: { x: 0, y: 0, z: -0.9 } })).toBe(false)
    expect(visible({ min: { x: 0, y: 0, z: -10.1 }, max: { x: 0, y: 0, z: -10.1 } })).toBe(false)
    expect(visible({ min: { x: 5.1, y: 0, z: -5 }, max: { x: 5.1, y: 0, z: -5 } })).toBe(false)
    expect(visible({ min: { x: 0, y: 5.1, z: -5 }, max: { x: 0, y: 5.1, z: -5 } })).toBe(false)
    expect(visible({ min: { x: -1, y: -1, z: 1 }, max: { x: 1, y: 1, z: 2 } })).toBe(false)
  })

  it('keeps a large box that encloses the frustum', () => {
    expect(visible({ min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } })).toBe(true)
  })

  it('uses yaw, pitch, and roll from the mirrored camera', () => {
    const point = (x: number, y: number, z: number): AxisAlignedBounds => ({
      min: { x, y, z },
      max: { x, y, z },
    })
    expect(visible(point(-5, 0, 0), { camera: camera(Math.PI / 2) })).toBe(true)
    expect(visible(point(0, 5, -5), { camera: camera(0, Math.PI / 4) })).toBe(true)
    expect(visible(point(4, 0, -5), { camera: camera(0, 0, Math.PI / 2) })).toBe(true)
  })

  it('fails closed for invalid bounds or projection parameters', () => {
    const bounds = { min: { x: 0, y: 0, z: -2 }, max: { x: 0, y: 0, z: -2 } }
    expect(visible(bounds, { aspect: 0 })).toBe(false)
    expect(visible(bounds, { verticalFovDegrees: 180 })).toBe(false)
    expect(visible({ min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } })).toBe(false)
  })
})
