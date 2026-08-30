import {
  AIR,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  ambientOcclusionAt,
  blockIndex,
  getBlockAcrossBoundary,
} from '@nerima-games/mc-meshing'
import {
  type BlockShapeKind,
  type BlockShapeQuad,
  type FaceDirection,
  type FaceRole,
  type QuadAxis,
  type QuadCorners,
  tangentAxes,
} from './meshing-vocabulary'
import { propertyOfBlockId } from '@nerima-games/mc-kernel'

const ZERO = 0
const UNIT = 1
const HALF_DIVISOR = 2
const SIXTEENTH_DIVISOR = 16
const SIXTY_FOURTH_DIVISOR = 64
const HALF_UNIT = UNIT / HALF_DIVISOR
const SIXTEENTH_UNIT = UNIT / SIXTEENTH_DIVISOR
const SIXTY_FOURTH_UNIT = UNIT / SIXTY_FOURTH_DIVISOR
const LOOP_STEP = 1

/** Bounds inside one block cell for each non-cubic render shape. */
export type BlockShapeBounds = {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}

export const BLOCK_SHAPE_BOUNDS: Readonly<Record<BlockShapeKind, BlockShapeBounds>> = {
  cactus: {
    maxX: UNIT - SIXTEENTH_UNIT,
    maxY: UNIT,
    maxZ: UNIT - SIXTEENTH_UNIT,
    minX: SIXTEENTH_UNIT,
    minY: ZERO,
    minZ: SIXTEENTH_UNIT,
  },
  lilyPad: {
    maxX: UNIT - SIXTEENTH_UNIT,
    maxY: SIXTY_FOURTH_UNIT,
    maxZ: UNIT - SIXTEENTH_UNIT,
    minX: SIXTEENTH_UNIT,
    minY: ZERO,
    minZ: SIXTEENTH_UNIT,
  },
  pressurePlate: {
    maxX: UNIT - SIXTEENTH_UNIT,
    maxY: SIXTEENTH_UNIT,
    maxZ: UNIT - SIXTEENTH_UNIT,
    minX: SIXTEENTH_UNIT,
    minY: ZERO,
    minZ: SIXTEENTH_UNIT,
  },
  rail: {
    maxX: UNIT,
    maxY: SIXTEENTH_UNIT,
    maxZ: UNIT,
    minX: ZERO,
    minY: ZERO,
    minZ: ZERO,
  },
  slab: {
    maxX: UNIT,
    maxY: HALF_UNIT,
    maxZ: UNIT,
    minX: ZERO,
    minY: ZERO,
    minZ: ZERO,
  },
}

type FaceBoundary = 'xMax' | 'xMin' | 'yMax' | 'yMin' | 'zMax' | 'zMin'

type FaceDefinition = {
  readonly boundary: FaceBoundary
  readonly direction: FaceDirection
  readonly normal: readonly [number, number, number]
  readonly role: FaceRole
}

type BlockLocation = {
  readonly lx: number
  readonly y: number
  readonly lz: number
}

type ShapeCell = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly blockId: number
  readonly shape: BlockShapeKind
  readonly location: BlockLocation
}

type ShapeQuadInput = ShapeCell & {
  readonly face: FaceDefinition
}

type BlockShapeMeshContext = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly shapeKinds: ReadonlyMap<number, BlockShapeKind>
}

const NEGATIVE = -1

const FACE_DEFINITIONS: ReadonlyArray<FaceDefinition> = [
  { boundary: 'xMin', direction: 'xNeg', normal: [NEGATIVE, ZERO, ZERO], role: 'side' },
  { boundary: 'xMax', direction: 'xPos', normal: [UNIT, ZERO, ZERO], role: 'side' },
  { boundary: 'yMin', direction: 'yNeg', normal: [ZERO, NEGATIVE, ZERO], role: 'bottom' },
  { boundary: 'yMax', direction: 'yPos', normal: [ZERO, UNIT, ZERO], role: 'top' },
  { boundary: 'zMin', direction: 'zNeg', normal: [ZERO, ZERO, NEGATIVE], role: 'side' },
  { boundary: 'zMax', direction: 'zPos', normal: [ZERO, ZERO, UNIT], role: 'side' },
]

const extentFor = (bounds: BlockShapeBounds, axis: QuadAxis): number => {
  switch (axis) {
    case 'x':
      return bounds.maxX - bounds.minX
    case 'y':
      return bounds.maxY - bounds.minY
    default:
      return bounds.maxZ - bounds.minZ
  }
}

const extentsFor = (bounds: BlockShapeBounds, direction: FaceDirection): readonly [number, number] => {
  const [widthAxis, heightAxis] = tangentAxes(direction)
  return [extentFor(bounds, widthAxis), extentFor(bounds, heightAxis)]
}

const verticesFor = (
  bounds: BlockShapeBounds,
  location: BlockLocation,
  direction: FaceDirection,
): QuadCorners => {
  const { lx, y, lz } = location
  const minX = lx + bounds.minX
  const minY = y + bounds.minY
  const minZ = lz + bounds.minZ
  const maxX = lx + bounds.maxX
  const maxY = y + bounds.maxY
  const maxZ = lz + bounds.maxZ
  switch (direction) {
    case 'xNeg':
      return [
        [minX, minY, maxZ],
        [minX, maxY, maxZ],
        [minX, maxY, minZ],
        [minX, minY, minZ],
      ]
    case 'xPos':
      return [
        [maxX, minY, minZ],
        [maxX, maxY, minZ],
        [maxX, maxY, maxZ],
        [maxX, minY, maxZ],
      ]
    case 'yNeg':
      return [
        [maxX, minY, minZ],
        [maxX, minY, maxZ],
        [minX, minY, maxZ],
        [minX, minY, minZ],
      ]
    case 'yPos':
      return [
        [minX, maxY, minZ],
        [minX, maxY, maxZ],
        [maxX, maxY, maxZ],
        [maxX, maxY, minZ],
      ]
    case 'zNeg':
      return [
        [minX, minY, minZ],
        [minX, maxY, minZ],
        [maxX, maxY, minZ],
        [maxX, minY, minZ],
      ]
    default:
      return [
        [maxX, minY, maxZ],
        [maxX, maxY, maxZ],
        [minX, maxY, maxZ],
        [minX, minY, maxZ],
      ]
  }
}

const boundaryCoordinateFor = (bounds: BlockShapeBounds, boundary: FaceBoundary): number => {
  switch (boundary) {
    case 'xMin':
      return bounds.minX
    case 'xMax':
      return bounds.maxX
    case 'yMin':
      return bounds.minY
    case 'yMax':
      return bounds.maxY
    case 'zMin':
      return bounds.minZ
    default:
      return bounds.maxZ
  }
}

const cellBoundaryFor = (boundary: FaceBoundary): number => {
  switch (boundary) {
    case 'xMin':
    case 'yMin':
    case 'zMin':
      return ZERO
    default:
      return UNIT
  }
}

const isAtCellBoundary = (bounds: BlockShapeBounds, boundary: FaceBoundary): boolean =>
  boundaryCoordinateFor(bounds, boundary) === cellBoundaryFor(boundary)

const isFullOpaqueCube = (blockId: number): boolean =>
  blockId !== AIR &&
  propertyOfBlockId(blockId, 'opacity') === 'opaque' &&
  propertyOfBlockId(blockId, 'collisionShape') === 'full' &&
  propertyOfBlockId(blockId, 'renderKind') === 'cube'

const isFaceOccluded = (
  cell: Pick<ShapeCell, 'chunk' | 'neighbours' | 'location'>,
  bounds: BlockShapeBounds,
  face: FaceDefinition,
): boolean => {
  if (!isAtCellBoundary(bounds, face.boundary)) {
    return false
  }
  const { chunk, location, neighbours } = cell
  const { lx, y, lz } = location
  const [normalX, normalY, normalZ] = face.normal
  const blockId = getBlockAcrossBoundary(
    chunk,
    neighbours,
    lx + normalX,
    y + normalY,
    lz + normalZ,
  )
  return isFullOpaqueCube(blockId)
}

const shapeQuadFor = ({ chunk, neighbours, blockId, shape, location, face }: ShapeQuadInput): BlockShapeQuad | undefined => {
  const bounds = BLOCK_SHAPE_BOUNDS[shape]
  if (isFaceOccluded({ chunk, location, neighbours }, bounds, face)) {
    return undefined
  }
  const [width, height] = extentsFor(bounds, face.direction)
  const { lx, y, lz } = location
  return {
    ao: ambientOcclusionAt(chunk, neighbours, face.direction, lx, y, lz),
    blockId,
    direction: face.direction,
    height,
    lx,
    lz,
    role: face.role,
    shape,
    vertices: verticesFor(bounds, location, face.direction),
    width,
    y,
  }
}

const shapeQuadsForBlock = (
  context: BlockShapeMeshContext,
  location: BlockLocation,
): ReadonlyArray<BlockShapeQuad> => {
  const { chunk, neighbours, shapeKinds } = context
  const { lx, y, lz } = location
  const blockId = chunk.blocks[blockIndex(lx, y, lz)] ?? AIR
  const shape = shapeKinds.get(blockId)
  if (shape === undefined) {
    return []
  }
  const cell = { blockId, chunk, location, neighbours, shape }
  return FACE_DEFINITIONS.flatMap((face) => {
    const quad = shapeQuadFor({ ...cell, face })
    if (quad === undefined) {
      return []
    }
    return [quad]
  })
}

const meshConfiguredBlockShapes = (context: BlockShapeMeshContext): ReadonlyArray<BlockShapeQuad> => {
  const quads: Array<BlockShapeQuad> = []
  for (let lx = ZERO; lx < CHUNK_SIZE; lx += LOOP_STEP) {
    for (let lz = ZERO; lz < CHUNK_SIZE; lz += LOOP_STEP) {
      for (let y = ZERO; y < CHUNK_HEIGHT; y += LOOP_STEP) {
        quads.push(...shapeQuadsForBlock(context, { lx, lz, y }))
      }
    }
  }
  return quads
}

/** Mesh every configured non-cubic block as explicit face quads. */
export const meshBlockShapes = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  shapeKinds: ReadonlyMap<number, BlockShapeKind>,
): ReadonlyArray<BlockShapeQuad> => {
  if (shapeKinds.size === ZERO) {
    return []
  }
  return meshConfiguredBlockShapes({ chunk, neighbours, shapeKinds })
}
