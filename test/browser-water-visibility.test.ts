import * as THREE from 'three'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  BrowserWaterVisibilityResultSchema,
  measureWaterVisibility as measureWaterVisibilityResult,
} from '../src/browser-water-visibility'
import { BEHIND_NEAR_PLANE_RATIO } from '../src/domain/water-refraction'

const measureWaterVisibility = (
  meshes: ReadonlySet<THREE.Mesh>,
  camera: THREE.Camera,
) => {
  const actual = measureWaterVisibilityResult(meshes, camera)
  const inspected = Schema.decodeUnknownResult(BrowserWaterVisibilityResultSchema, {
    onExcessProperty: 'error',
  })(actual)
  expect(Result.isSuccess(inspected)).toBe(true)
  if (Result.isFailure(inspected)) {
    throw new Error(inspected.failure.message)
  }
  if (inspected.success._tag === 'Failure') {
    throw new Error(JSON.stringify(inspected.success.failure))
  }
  return inspected.success.success
}

const makeCamera = (): THREE.PerspectiveCamera => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100)
  camera.lookAt(0, 0, -1)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

const makeMesh = (z: number, visible = true): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.position.z = z
  mesh.visible = visible
  return mesh
}

describe('measureWaterVisibility', () => {
  it.effect('reports no visible meshes for an empty or hidden set', () =>
    Effect.sync(() => {
      const camera = makeCamera()
      const hiddenMesh = makeMesh(-4, false)

      expect(measureWaterVisibility(new Set(), camera)).toStrictEqual({
        screenRatio: 0,
        visibleMeshCount: 0,
      })
      expect(measureWaterVisibility(new Set([hiddenMesh]), camera)).toStrictEqual({
        screenRatio: 0,
        visibleMeshCount: 0,
      })
    }),
  )

  it.effect('measures the projected area of visible meshes', () =>
    Effect.sync(() => {
      const camera = makeCamera()
      const visibleMesh = makeMesh(-4)

      const result = measureWaterVisibility(new Set([visibleMesh]), camera)

      expect(result.visibleMeshCount).toBe(1)
      expect(result.screenRatio).toBeGreaterThan(0)
      expect(result.screenRatio).toBeLessThanOrEqual(1)
    }),
  )

  it.effect('uses the behind-camera ratio when projection is not usable', () =>
    Effect.sync(() => {
      const camera = makeCamera()
      const behindMesh = makeMesh(4)

      expect(measureWaterVisibility(new Set([behindMesh]), camera)).toStrictEqual({
        screenRatio: BEHIND_NEAR_PLANE_RATIO,
        visibleMeshCount: 1,
      })
    }),
  )

  it.effect('handles geometry without a bounding box', () =>
    Effect.sync(() => {
      const camera = makeCamera()
      const geometry = new THREE.BufferGeometry()
      geometry.computeBoundingBox = () => {
        geometry.boundingBox = null
      }
      const mesh = new THREE.Mesh(geometry)

      expect(measureWaterVisibility(new Set([mesh]), camera)).toStrictEqual({
        screenRatio: BEHIND_NEAR_PLANE_RATIO,
        visibleMeshCount: 1,
      })
    }),
  )

  it.effect('property: malformed mesh or camera inputs return strict failures', () =>
    Effect.sync(() => {
      const camera = makeCamera()
      const malformedMeshes = FastCheck.constantFrom<unknown>(
        null,
        {},
        new Set([{}]),
      )
      FastCheck.assert(
        FastCheck.property(malformedMeshes, (meshes) => {
          const actual = measureWaterVisibilityResult(meshes, camera)
          const inspected = Schema.decodeUnknownResult(BrowserWaterVisibilityResultSchema, {
            onExcessProperty: 'error',
          })(actual)
          expect(Result.isSuccess(inspected)).toBe(true)
          if (Result.isFailure(inspected)) {
            return
          }
          expect(inspected.success).toStrictEqual({
            _tag: 'Failure',
            _op: 'Failure',
            failure: {
              _tag: 'RefractionInputError',
              operation: 'water-visibility',
              reason: 'invalid-input',
            },
          })
        }),
      )
      const invalidCamera = measureWaterVisibilityResult(new Set(), {})
      const decodedCamera = Schema.decodeUnknownResult(BrowserWaterVisibilityResultSchema, {
        onExcessProperty: 'error',
      })(invalidCamera)
      expect(Result.isSuccess(decodedCamera)).toBe(true)
      if (Result.isSuccess(decodedCamera)) {
        expect(decodedCamera.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: {
            _tag: 'RefractionInputError',
            operation: 'water-visibility',
            reason: 'invalid-input',
          },
        })
      }
    }),
  )
})
