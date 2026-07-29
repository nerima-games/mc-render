import { describe, expect, it } from '@effect/vitest'
import { BlockId, chunkCoord, emptyBlocks, setBlockAt, type Chunk } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { blockNameFromKernel, makeChunkStoreMesher, type MeshingChunkStore } from '../application/chunk-store-mesher'

const chunk = (cx: number, cz: number, blocks: ReadonlyArray<readonly [number, number, number, number]>): Chunk => {
  const data = emptyBlocks()
  for (const [lx, y, lz, blockId] of blocks) {
    setBlockAt(data, lx, y, lz, BlockId(blockId))
  }
  return {
    coord: chunkCoord(cx, cz),
    blocks: data,
    biomes: Array.from({ length: 16 * 16 }, () => 'PLAINS' as const),
  }
}

const storeOf = (center?: Chunk, xPos?: Chunk): MeshingChunkStore => ({
  peek: () => Effect.succeed(center),
  neighbours: () => Effect.succeed(xPos === undefined ? {} : { xPos }),
})

describe('makeChunkStoreMesher', () => {
  it.effect('returns undefined when the requested chunk is not resident', () =>
    Effect.gen(function* () {
      const quads = yield* makeChunkStoreMesher(storeOf())({ cx: 0, cz: 0 })
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

      const quads = yield* makeChunkStoreMesher(storeOf(resident))({ cx: 0, cz: 0 })

      expect(new Set(quads?.map(({ blockId }) => blockId))).toEqual(new Set([2, 6, 10]))
      expect(quads).toHaveLength(18)
    }),
  )

  it.effect('uses resident neighbours to hide shared boundary faces', () =>
    Effect.gen(function* () {
      const center = chunk(0, 0, [[15, 20, 1, 2]])
      const neighbour = chunk(1, 0, [[0, 20, 1, 2]])

      const quads = yield* makeChunkStoreMesher(storeOf(center, neighbour))({ cx: 0, cz: 0 })

      expect(quads).toHaveLength(5)
      expect(quads?.some(({ direction }) => direction === 'xPos')).toBe(false)
    }),
  )
})

describe('blockNameFromKernel', () => {
  it('resolves canonical texture names and safely falls back for unknown ids', () => {
    expect(blockNameFromKernel(4)).toBe('grass_block')
    expect(blockNameFromKernel(255)).toBe('unknown')
  })
})
