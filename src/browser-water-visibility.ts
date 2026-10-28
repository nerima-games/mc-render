import * as THREE from 'three'
import {
  BEHIND_NEAR_PLANE_RATIO,
  type NdcRect,
  type RefractionInputError,
  RefractionInputErrorSchema,
  screenRatioForNdcRect,
} from './domain/water-refraction.js'
import { Result, Schema } from 'effect'

const EMPTY_WATER_MESH_COUNT = 0
const BOUNDING_BOX_MIN = 0
const BOUNDING_BOX_MAX = 1
const NDC_MIN = -1
const NDC_MAX = 1
const VISIBLE_MESH_COUNT_INCREMENT = 1

type BoundingBoxCoordinate = typeof BOUNDING_BOX_MIN | typeof BOUNDING_BOX_MAX
type BoundingBoxCorner = readonly [BoundingBoxCoordinate, BoundingBoxCoordinate, BoundingBoxCoordinate]

const WATER_BOUNDING_BOX_CORNERS: ReadonlyArray<BoundingBoxCorner> = [
  [BOUNDING_BOX_MIN, BOUNDING_BOX_MIN, BOUNDING_BOX_MIN],
  [BOUNDING_BOX_MIN, BOUNDING_BOX_MIN, BOUNDING_BOX_MAX],
  [BOUNDING_BOX_MIN, BOUNDING_BOX_MAX, BOUNDING_BOX_MIN],
  [BOUNDING_BOX_MIN, BOUNDING_BOX_MAX, BOUNDING_BOX_MAX],
  [BOUNDING_BOX_MAX, BOUNDING_BOX_MIN, BOUNDING_BOX_MIN],
  [BOUNDING_BOX_MAX, BOUNDING_BOX_MIN, BOUNDING_BOX_MAX],
  [BOUNDING_BOX_MAX, BOUNDING_BOX_MAX, BOUNDING_BOX_MIN],
  [BOUNDING_BOX_MAX, BOUNDING_BOX_MAX, BOUNDING_BOX_MAX],
]

const resolveBoundingBoxAxis = (min: number, max: number, coordinate: BoundingBoxCoordinate): number => {
  if (coordinate === BOUNDING_BOX_MIN) {
    return min
  }
  return max
}

const resolveBoundingBoxCorner = (
  bounds: THREE.Box3,
  [x, y, z]: BoundingBoxCorner,
): THREE.Vector3 =>
  new THREE.Vector3(
    resolveBoundingBoxAxis(bounds.min.x, bounds.max.x, x),
    resolveBoundingBoxAxis(bounds.min.y, bounds.max.y, y),
    resolveBoundingBoxAxis(bounds.min.z, bounds.max.z, z),
  )

const projectWaterBounds = (mesh: THREE.Mesh, camera: THREE.Camera): ReadonlyArray<THREE.Vector3> => {
  mesh.updateWorldMatrix(true, false)
  mesh.geometry.computeBoundingBox()
  const bounds = mesh.geometry.boundingBox
  if (!bounds) {
    return []
  }
  return WATER_BOUNDING_BOX_CORNERS.map((corner) =>
    resolveBoundingBoxCorner(bounds, corner).applyMatrix4(mesh.matrixWorld).project(camera),
  )
}

const isUsableNdcPoint = (point: THREE.Vector3): boolean =>
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  Number.isFinite(point.z) &&
  point.z >= NDC_MIN &&
  point.z <= NDC_MAX

type MutableNdcBounds = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

const extendNdcBounds = (bounds: MutableNdcBounds, point: THREE.Vector3): void => {
  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

const resolveWaterNdcRect = (points: ReadonlyArray<THREE.Vector3>): NdcRect | undefined => {
  if (points.length === EMPTY_WATER_MESH_COUNT) {
    return undefined
  }
  const bounds: MutableNdcBounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
  }
  for (const point of points) {
    if (!isUsableNdcPoint(point)) {
      return undefined
    }
    extendNdcBounds(bounds, point)
  }
  return bounds
}

export type BrowserWaterVisibility = {
  readonly screenRatio: number
  readonly visibleMeshCount: number
}

type BrowserWaterVisibilityResultShape =
  | { readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: BrowserWaterVisibility }
  | { readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: RefractionInputError }

export const BrowserWaterVisibilitySchema: Schema.Codec<BrowserWaterVisibility> = Schema.Struct({
  screenRatio: Schema.Finite,
  visibleMeshCount: Schema.Int,
})

export const BrowserWaterVisibilityResultSchema: Schema.Codec<BrowserWaterVisibilityResultShape> = Schema.Union([
  Schema.Struct({
    _op: Schema.Literal('Success'),
    _tag: Schema.Literal('Success'),
    success: BrowserWaterVisibilitySchema,
  }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: RefractionInputErrorSchema,
  }),
])

const resolveWaterScreenRatio = (
  mesh: THREE.Mesh,
  camera: THREE.Camera,
): Result.Result<number, RefractionInputError> => {
  const ndcRect = resolveWaterNdcRect(projectWaterBounds(mesh, camera))
  if (ndcRect) {
    return screenRatioForNdcRect(ndcRect)
  }
  return Result.succeed(BEHIND_NEAR_PLANE_RATIO)
}

const addWaterScreenRatio = (
  screenRatio: number,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
): Result.Result<number, RefractionInputError> =>
  resolveWaterScreenRatio(mesh, camera).pipe(
    Result.map((meshScreenRatio) => screenRatio + meshScreenRatio),
  )

const measureWaterVisibilityForMesh = (
  visibility: BrowserWaterVisibility,
  meshValue: unknown,
  camera: THREE.Camera,
): Result.Result<BrowserWaterVisibility, RefractionInputError> => {
  if (!(meshValue instanceof THREE.Mesh)) {
    return Result.fail({
      _tag: 'RefractionInputError',
      operation: 'water-visibility',
      reason: 'invalid-input',
    })
  }
  if (!meshValue.visible) {
    return Result.succeed(visibility)
  }
  return addWaterScreenRatio(visibility.screenRatio, meshValue, camera).pipe(
    Result.map((screenRatio) => ({
      screenRatio,
      visibleMeshCount: visibility.visibleMeshCount + VISIBLE_MESH_COUNT_INCREMENT,
    })),
  )
}

const measureValidWaterMeshes = (
  waterMeshes: ReadonlySet<unknown>,
  camera: THREE.Camera,
): Result.Result<BrowserWaterVisibility, RefractionInputError> => {
  camera.updateMatrixWorld()
  let visibility: BrowserWaterVisibility = { screenRatio: 0, visibleMeshCount: 0 }
  for (const meshValue of waterMeshes) {
    const nextVisibility = measureWaterVisibilityForMesh(visibility, meshValue, camera)
    if (Result.isFailure(nextVisibility)) {
      return Result.fail(nextVisibility.failure)
    }
    visibility = nextVisibility.success
  }
  return Result.succeed(visibility)
}

export const measureWaterVisibility = (
  waterMeshes: unknown,
  camera: unknown,
): Result.Result<BrowserWaterVisibility, RefractionInputError> => {
  if (!(waterMeshes instanceof Set) || !(camera instanceof THREE.Camera)) {
    return Result.fail({
      _tag: 'RefractionInputError',
      operation: 'water-visibility',
      reason: 'invalid-input',
    })
  }
  return measureValidWaterMeshes(waterMeshes, camera)
}
