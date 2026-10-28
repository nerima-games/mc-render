import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, BlockAxis, BlockId, LocalAxis, propertyOfBlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import type { Chunk, ReadonlyChunk } from '@nerima-games/mc-worldgen'
import { emptyBlocks, setBlockAt, type SubscriberId } from '@nerima-games/mc-worldgen/testing'
import { Effect, Ref, Result } from 'effect'
import {
  attachChunkStoreRenderer,
  blockNameFromKernel,
  KERNEL_MESH_CONFIG,
  makeChunkStoreLightColor,
  makeChunkStoreMesher,
  type MeshingChunkStore,
  type RendererChunkStore,
} from '../src/application/chunk-store-mesher'
import { makeWorldRenderer } from '../src/application/world-renderer'
import { aoShade } from '../src/domain/chunk-geometry'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'
import { chunkCoord } from './support/kernel-brands'

const VIEWPORT = { width: 640, height: 360 }

const chunk = (cx: number, cz: number, blocks: ReadonlyArray<readonly [number, number, number, number]>): Chunk => {
  const data = emptyBlocks()
  for (const [lx, y, lz, blockId] of blocks) {
    setBlockAt(data, LocalAxis(lx), BlockAxis(y), LocalAxis(lz), BlockId(blockId))
  }
  return {
    coord: chunkCoord(cx, cz),
    blocks: data,
    biomes: Array.from({ length: 16 * 16 }, () => 'PLAINS' as const),
  }
}

const neighboursFor = (xPos?: ReadonlyChunk): { xPos?: ReadonlyChunk } => {
  if (xPos === undefined) {
    return {}
  }
  return { xPos }
}

const storeOf = (center?: ReadonlyChunk, xPos?: ReadonlyChunk): MeshingChunkStore => ({
  peek: () => Effect.succeed(center),
  neighbours: () => Effect.succeed(neighboursFor(xPos)),
})

const storeWithNeighbours = (
  center: ReadonlyChunk,
  neighbours: {
    readonly xPos?: ReadonlyChunk
    readonly xNeg?: ReadonlyChunk
    readonly zPos?: ReadonlyChunk
    readonly zNeg?: ReadonlyChunk
  },
): MeshingChunkStore => ({
  peek: () => Effect.succeed(center),
  neighbours: () => Effect.succeed(neighbours),
})

describe('makeChunkStoreMesher', () => {
  it.effect('returns undefined when the requested chunk is not resident', () =>
    Effect.gen(function* () {
      const quads = yield* makeChunkStoreMesher(storeOf())(chunkCoord(0, 0))
      expect(quads).toBeUndefined()
    }),
  )

  it.effect('meshes opaque, fluid, and transparent-solid kernel blocks', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [
        [1, 20, 1, 2],
        [4, 20, 1, 6],
        [7, 20, 1, 10],
      ])

      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))

      expect(new Set(quads?.map(({ blockId }) => blockId))).toEqual(new Set([2, 10]))
      expect(quads).toHaveLength(12)
      expect(quads?.fluids?.length).toBeGreaterThan(0)
      expect(new Set(quads?.fluids?.map(({ blockId }) => blockId))).toEqual(new Set([6]))
    }),
  )

  it.effect('keeps readonly worldgen block storage unchanged while meshing', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[15, 20, 1, 2]])
      const neighbour = chunk(1, 0, [[0, 20, 1, 2]])
      const originalBlocks = resident.blocks.slice()
      const originalNeighbourBlocks = neighbour.blocks.slice()

      yield* makeChunkStoreMesher(storeOf(resident, neighbour))(chunkCoord(0, 0))

      expect(resident.blocks).toStrictEqual(originalBlocks)
      expect(neighbour.blocks).toStrictEqual(originalNeighbourBlocks)
    }),
  )

  it.effect('returns InvalidChunkBlocksLength for a short worldgen chunk', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [])
      const shortChunk = {
        ...resident,
        blocks: resident.blocks.subarray(0, resident.blocks.length - 1),
      }

      const result = yield* Effect.result(makeChunkStoreMesher(storeOf(shortChunk))(chunkCoord(0, 0)))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: 'InvalidChunkBlocksLength',
          actual: resident.blocks.length - 1,
          expected: resident.blocks.length,
        })
      }
    }),
  )

  it.effect('derives fluid and cross-plant routing from kernel properties', () =>
    Effect.gen(function* () {
      const waterId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'fluid')) === 'water')
      const lavaId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'fluid')) === 'lava')
      const plantId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'renderKind')) === 'cross')
      if (waterId === undefined || lavaId === undefined || plantId === undefined) {
        throw new Error('mc-kernel must expose water, lava, and cross-plant block IDs')
      }

      expect(KERNEL_MESH_CONFIG.waterBlockIds.has(waterId)).toBe(true)
      expect(KERNEL_MESH_CONFIG.waterBlockIds.has(lavaId)).toBe(false)
      expect(KERNEL_MESH_CONFIG.fluidMaxLevels?.get(waterId)).toBe(7)
      expect(KERNEL_MESH_CONFIG.fluidMaxLevels?.get(lavaId)).toBe(3)
      expect(KERNEL_MESH_CONFIG.crossPlantBlockIds?.has(plantId)).toBe(true)

      const resident = chunk(0, 0, [[1, 20, 1, plantId]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))

      expect(quads?.crossPlants).toHaveLength(2)
      expect(quads?.crossPlants?.every(({ blockId }) => blockId === plantId)).toBe(true)
    }),
  )

  it.effect('uses resident neighbours to hide shared boundary faces', () =>
    Effect.gen(function* () {
      const center = chunk(0, 0, [[15, 20, 1, 2]])
      const neighbour = chunk(1, 0, [[0, 20, 1, 2]])

      const quads = yield* makeChunkStoreMesher(storeOf(center, neighbour))(chunkCoord(0, 0))

      expect(quads).toHaveLength(5)
      expect(quads?.some(({ direction }) => direction === 'xPos')).toBe(false)
    }),
  )

  it.effect('adapts the x-negative and z neighbours when hiding shared faces', () =>
    Effect.gen(function* () {
      const cases = [
        {
          center: chunk(0, 0, [[0, 20, 1, 2]]),
          neighbour: chunk(-1, 0, [[15, 20, 1, 2]]),
          neighbourKey: 'xNeg',
          hiddenDirection: 'xNeg',
        },
        {
          center: chunk(0, 0, [[1, 20, 15, 2]]),
          neighbour: chunk(0, 1, [[1, 20, 0, 2]]),
          neighbourKey: 'zPos',
          hiddenDirection: 'zPos',
        },
        {
          center: chunk(0, 0, [[1, 20, 0, 2]]),
          neighbour: chunk(0, -1, [[1, 20, 15, 2]]),
          neighbourKey: 'zNeg',
          hiddenDirection: 'zNeg',
        },
      ] as const

      for (const { center, neighbour, neighbourKey, hiddenDirection } of cases) {
        const neighbours = { [neighbourKey]: neighbour }
        const quads = yield* makeChunkStoreMesher(storeWithNeighbours(center, neighbours))(center.coord)

        expect(quads).toHaveLength(5)
        expect(quads?.some(({ direction }) => direction === hiddenDirection)).toBe(false)
      }
    }),
  )

  it.effect('supports a meshing config without local shape routing', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const config = {
        crossPlantBlockIds: KERNEL_MESH_CONFIG.crossPlantBlockIds,
        fluidMaxLevels: KERNEL_MESH_CONFIG.fluidMaxLevels,
        waterBlockIds: KERNEL_MESH_CONFIG.waterBlockIds,
        transparentSolidBlockIds: KERNEL_MESH_CONFIG.transparentSolidBlockIds,
      }

      const quads = yield* makeChunkStoreMesher(storeOf(resident), config)(chunkCoord(0, 0))

      expect(quads).toHaveLength(6)
      expect(quads?.blockShapes).toStrictEqual([])
    }),
  )
})

describe('blockNameFromKernel', () => {
  it('resolves canonical texture names and safely falls back for unknown ids', () => {
    expect(blockNameFromKernel(BlockId(4))).toBe('grass_block')
    expect(blockNameFromKernel(BlockId(255))).toBe('unknown')
  })
})

describe('attachChunkStoreRenderer', () => {
  it.effect('fills in a light-sampling colorForChunk when the caller supplies neither color option', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const getLightCalls = yield* Ref.make(0)
      const batches = yield* Ref.make<ReadonlyArray<{ readonly changed: ReadonlyArray<ChunkCoord>; readonly removed: ReadonlyArray<ChunkCoord> }>>([
        { changed: [chunkCoord(0, 0)], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          id: 0 as SubscriberId,
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () =>
          Ref.update(getLightCalls, (count) => count + 1).pipe(
            Effect.as({ _tag: 'Light' as const, block: 15, sky: 15 }),
          ),
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store)
      yield* attachment.update

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(yield* Ref.get(getLightCalls)).toBeGreaterThan(0)
    }),
  )

  it.effect('leaves an explicit color option untouched, and never samples light for it', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const getLightCalls = yield* Ref.make(0)
      const batches = yield* Ref.make<ReadonlyArray<{ readonly changed: ReadonlyArray<ChunkCoord>; readonly removed: ReadonlyArray<ChunkCoord> }>>([
        { changed: [chunkCoord(0, 0)], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          id: 0 as SubscriberId,
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () =>
          Ref.update(getLightCalls, (count) => count + 1).pipe(
            Effect.as({ _tag: 'Light' as const, block: 15, sky: 15 }),
          ),
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        color: () => [1, 1, 1],
      })
      yield* attachment.update

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(yield* Ref.get(getLightCalls)).toBe(0)
    }),
  )

})

describe('makeChunkStoreLightColor', () => {
  it.effect('falls back to NO_LIGHT for a sample the store cannot answer, distinctly from a real reading', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const [quad] = quads ?? []
      if (quad === undefined) {
        throw new Error('expected at least one quad from the fixture chunk')
      }

      const unansweredColor = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'ChunkNotLoaded' as const }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )
      const litColor = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )

      // NO_LIGHT (block: 0, sky: 0) and a full (15, 15) reading must shade the
      // same quad differently — this is the assertion that would fail if the
      // `_tag !== 'Light'` branch silently used the wrong fallback value.
      expect(unansweredColor(quad)).not.toStrictEqual(litColor(quad))
      expect(unansweredColor(quad)).toStrictEqual([aoShade(quad.ao), 0, 0])
    }),
  )

  it.effect('the sampler falls back to NO_LIGHT for a position outside what it pre-fetched', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const [quad] = quads ?? []
      if (quad === undefined) {
        throw new Error('expected at least one quad from the fixture chunk')
      }

      // No quads passed in means `readings` is built empty, so every sampler
      // lookup the returned `QuadColor` makes is a cache miss — proving the
      // sampler's own `?? NO_LIGHT` (not the getLight-tag fallback covered
      // above) is real, not merely unreachable dead code.
      const colorFromNothingPrefetched = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        [],
      )
      const colorFromPrefetched = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )

      expect(colorFromNothingPrefetched(quad)).not.toStrictEqual(colorFromPrefetched(quad))
    }),
  )
})
