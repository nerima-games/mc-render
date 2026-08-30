import * as THREE from 'three'
import {
  BEHIND_NEAR_PLANE_RATIO,
  type NdcRect,
  screenRatioForNdcRect,
} from './domain/water-refraction.js'

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

const resolveWaterScreenRatio = (mesh: THREE.Mesh, camera: THREE.Camera): number => {
  const ndcRect = resolveWaterNdcRect(projectWaterBounds(mesh, camera))
  if (ndcRect) {
    return screenRatioForNdcRect(ndcRect)
  }
  return BEHIND_NEAR_PLANE_RATIO
}

export const measureWaterVisibility = (
  waterMeshes: ReadonlySet<THREE.Mesh>,
  camera: THREE.Camera,
): { readonly screenRatio: number; readonly visibleMeshCount: number } => {
  camera.updateMatrixWorld()
  let screenRatio = 0
  let visibleMeshCount = 0
  for (const mesh of waterMeshes) {
    if (mesh.visible) {
      visibleMeshCount += VISIBLE_MESH_COUNT_INCREMENT
      screenRatio += resolveWaterScreenRatio(mesh, camera)
    }
  }
  return { screenRatio, visibleMeshCount }
}
