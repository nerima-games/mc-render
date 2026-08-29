import { describe, expect, it } from '@effect/vitest'
import {
  blockIndex,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkView,
} from '@nerima-games/mc-meshing'
import { BLOCK_IDS, propertyOfBlockId } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import {
  buildBlockShapeGeometry,
  type CrossPlantQuad,
  type GeometryQuad,
  type MeshQuad,
} from '../src/domain/chunk-geometry'
import { BLOCK_SHAPE_BOUNDS, meshBlockShapes } from '../src/domain/block-shapes'
import {
  isBlockShapeQuad,
  isCrossPlantQuad,
  type BlockShapeKind,
  type BlockShapeQuad,
} from '../src/domain/meshing-vocabulary'
import { lightSampleForGeometryQuad } from '../src/domain/voxel-lighting'

const SHAPE_PLACEMENTS: ReadonlyArray<readonly [BlockShapeKind, number, number, number, number]> = [
  ['slab', 4, 20, 4, 101],
  ['pressurePlate', 6, 20, 6, 102],
  ['cactus', 8, 20, 8, 103],
  ['rail', 10, 20, 10, 104],
  ['lilyPad', 12, 20, 12, 105],
]

const chunkWithBlocks = (
  entries: ReadonlyArray<readonly [number, number, number, number]>,
): ChunkView => {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE)
  for (const [lx, y, lz, blockId] of entries) {
    blocks[blockIndex(lx, y, lz)] = blockId
  }
  return { blocks }
}

const shapeKindsForPlacements = (): ReadonlyMap<number, BlockShapeKind> =>
  new Map(SHAPE_PLACEMENTS.map(([shape, , , , blockId]) => [blockId, shape]))

const findBlockId = (predicate: (blockId: number) => boolean, description: string): number => {
  const blockId = BLOCK_IDS.find(predicate)
  if (blockId === undefined) {
    throw new Error(`mc-kernel must expose ${description}`)
  }
  return blockId
}

const fullOpaqueBlockId = (): number =>
  findBlockId(
    (blockId) =>
      propertyOfBlockId(blockId, 'opacity') === 'opaque' &&
      propertyOfBlockId(blockId, 'collisionShape') === 'full' &&
      propertyOfBlockId(blockId, 'renderKind') === 'cube',
    'a full opaque cube',
  )

const partialBlockId = (): number =>
  findBlockId((blockId) => propertyOfBlockId(blockId, 'renderKind') === 'cactus', 'a non-cubic block',)

const crossPlantQuad = (): CrossPlantQuad => ({
  ao: 0,
  blockId: 21,
  nx: 0,
  ny: 0,
  nz: 1,
  role: 'side',
  vertices: [
    [0, 20, 0],
    [0, 21, 0],
    [1, 21, 1],
    [1, 20, 1],
  ],
})

const cubeQuad = (): MeshQuad => ({
  ao: 0,
  blockId: 1,
  direction: 'zNeg',
  height: 1,
  lx: 2,
  lz: 3,
  role: 'side',
  width: 1,
  y: 20,
})

describe('block shape meshing', () => {
  it.effect('emits all configured shape kinds with every visible face', () =>
    Effect.sync(() => {
      const chunk = chunkWithBlocks(SHAPE_PLACEMENTS.map(([, lx, y, lz, blockId]) => [lx, y, lz, blockId]))
      const quads = meshBlockShapes(chunk, {}, shapeKindsForPlacements())

      expect(quads).toHaveLength(SHAPE_PLACEMENTS.length * 6)
      expect(new Set(quads.map(({ shape }) => shape))).toEqual(
        new Set(SHAPE_PLACEMENTS.map(([shape]) => shape)),
      )
      expect(new Set(quads.map(({ direction }) => direction))).toEqual(
        new Set(['xPos', 'xNeg', 'yPos', 'yNeg', 'zPos', 'zNeg']),
      )
      expect(BLOCK_SHAPE_BOUNDS.slab.maxY).toBe(0.5)
      expect(BLOCK_SHAPE_BOUNDS.lilyPad.maxY).toBe(1 / 64)
      for (const quad of quads) {
        expect(quad.vertices).toHaveLength(4)
        expect(quad.width).toBeGreaterThan(0)
        expect(quad.height).toBeGreaterThan(0)
      }
    }),
  )

  it.effect('returns no work for an empty shape map', () =>
    Effect.sync(() => {
      const chunk = chunkWithBlocks([[4, 20, 4, 101]])
      expect(meshBlockShapes(chunk, {}, new Map())).toStrictEqual([])
    }),
  )

  it.effect('treats missing block storage entries as air', () =>
    Effect.sync(() => {
      const incompleteChunk: ChunkView = { blocks: new Uint8Array(0) }

      expect(
        meshBlockShapes(incompleteChunk, {}, new Map<number, BlockShapeKind>([[101, 'slab']])),
      ).toStrictEqual([])
    }),
  )

  it.effect('culls a boundary face only against a full opaque cube', () =>
    Effect.sync(() => {
      const shapeId = 201
      const shapeKinds = new Map<number, BlockShapeKind>([[shapeId, 'slab']])
      const center = chunkWithBlocks([[0, 20, 0, shapeId]])
      const fullNeighbour = chunkWithBlocks([[15, 20, 0, fullOpaqueBlockId()]])
      const partialNeighbour = chunkWithBlocks([[15, 20, 0, partialBlockId()]])

      const culled = meshBlockShapes(center, { xNeg: fullNeighbour }, shapeKinds)
      const transparent = meshBlockShapes(center, { xNeg: partialNeighbour }, shapeKinds)
      const uncovered = meshBlockShapes(center, {}, shapeKinds)

      expect(culled).toHaveLength(5)
      expect(culled.some(({ direction }) => direction === 'xNeg')).toBe(false)
      expect(transparent).toHaveLength(6)
      expect(uncovered).toHaveLength(6)
    }),
  )
})

describe('block shape geometry and lighting', () => {
  it.effect('builds single-sided explicit vertices and samples their centre', () =>
    Effect.sync(() => {
      const chunk = chunkWithBlocks([[4, 20, 4, 101]])
      const shapeKinds = new Map<number, BlockShapeKind>([[101, 'slab']])
      const quads = meshBlockShapes(chunk, {}, shapeKinds)
      const top = quads.find(({ direction }) => direction === 'yPos')
      if (top === undefined) {
        throw new Error('expected a top slab face')
      }

      const built = buildBlockShapeGeometry([top], 10, -3, () => [7, 8, 9], () => 12)
      expect(buildBlockShapeGeometry([])).toBe(buildBlockShapeGeometry([]))
      expect(built.quadCount).toBe(1)
      expect(built.vertexCount).toBe(4)
      expect(built.indexCount).toBe(6)
      expect([...built.positions]).toStrictEqual([
        14,
        20.5,
        1,
        14,
        20.5,
        2,
        15,
        20.5,
        2,
        15,
        20.5,
        1,
      ])
      expect([...built.normals]).toStrictEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
      expect([...built.colors]).toStrictEqual([7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9])
      expect([...built.tileIndices]).toStrictEqual([12, 12, 12, 12])
      expect([...built.uvs]).toStrictEqual([0, 0, 0, 1, 1, 1, 1, 0])
      expect([...built.indices]).toStrictEqual([0, 1, 2, 0, 2, 3])
      expect(lightSampleForGeometryQuad(top)).toStrictEqual({
        direction: 'yPos',
        point: [4.5, 20.5, 4.5],
      })
    }),
  )

  it.effect('distinguishes explicit shape, plant, and cube quads', () =>
    Effect.sync(() => {
      const shape: BlockShapeQuad = {
        ao: 0,
        blockId: 101,
        direction: 'xPos',
        height: 1,
        lx: 0,
        lz: 0,
        role: 'side',
        shape: 'slab',
        vertices: [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
        width: 1,
        y: 0,
      }
      const cross = crossPlantQuad()
      const cube = cubeQuad()
      const geometry: ReadonlyArray<GeometryQuad> = [shape, cross, cube]

      expect(geometry.filter(isBlockShapeQuad)).toHaveLength(1)
      expect(geometry.filter(isCrossPlantQuad)).toHaveLength(1)
      expect(isBlockShapeQuad(cube)).toBe(false)
      expect(isCrossPlantQuad(shape)).toBe(false)
      expect(lightSampleForGeometryQuad(cross)).toStrictEqual({
        direction: 'yPos',
        point: [0.5, 20.5, 0.5],
      })
      expect(lightSampleForGeometryQuad(cube)).toStrictEqual({
        direction: 'zNeg',
        point: [2.5, 20.5, 2],
      })
    }),
  )
})
