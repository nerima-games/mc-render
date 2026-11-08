import { BLOCK_IDS, type BlockId, blockTypeOfId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { CHUNK_ANIMATION_KIND } from '../src/domain/chunk-animation-kind'
import { buildChunkGeometry, VERTICES_PER_QUAD, type MeshQuad } from '../src/domain/chunk-geometry'

const BLOCK_ID_BY_TYPE = new Map<string, BlockId>(
  BLOCK_IDS.map((blockId) => [Result.getOrThrow(blockTypeOfId(blockId)) ?? 'unknown', blockId]),
)

const blockIdForType = (blockType: string): BlockId => {
  const blockId = BLOCK_ID_BY_TYPE.get(blockType)
  if (blockId === undefined) {
    throw new Error(`The kernel registry does not contain block type ${blockType}`)
  }
  return blockId
}

const quad = (blockId: BlockId): MeshQuad => ({
  ao: 0,
  blockId,
  direction: 'yPos',
  height: 1,
  role: 'top',
  width: 1,
  lx: 0,
  lz: 0,
  y: 0,
})

const ANIMATED_BLOCK_TYPES = [
  { blockType: 'water', kind: CHUNK_ANIMATION_KIND.water },
  { blockType: 'lava', kind: CHUNK_ANIMATION_KIND.lava },
  { blockType: 'fire', kind: CHUNK_ANIMATION_KIND.fire },
  { blockType: 'nether_portal', kind: CHUNK_ANIMATION_KIND.netherPortal },
  { blockType: 'end_portal', kind: CHUNK_ANIMATION_KIND.endPortal },
] as const

describe('chunk animation kinds', () => {
  it.effect('marks water, lava, fire and both portal blocks for animation', () =>
    Effect.sync(() => {
      for (const { blockType, kind } of ANIMATED_BLOCK_TYPES) {
        const buffers = buildChunkGeometry([quad(blockIdForType(blockType))], 0, 0, undefined, () => 18)

        expect([...buffers.tileIndices], blockType).toStrictEqual(Array(VERTICES_PER_QUAD).fill(18))
        expect([...buffers.animationKinds], blockType).toStrictEqual(Array(VERTICES_PER_QUAD).fill(kind))
      }
    }),
  )

  it.effect('leaves ice still when its current atlas tile is also used by lava', () =>
    Effect.sync(() => {
      const buffers = buildChunkGeometry([quad(blockIdForType('ice'))], 0, 0, undefined, () => 18)

      expect([...buffers.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(18))
      expect([...buffers.animationKinds]).toStrictEqual(
        Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.none),
      )
    }),
  )

  it.effect('keeps animation classification when the atlas tile is reassigned', () =>
    Effect.sync(() => {
      const lava = quad(blockIdForType('lava'))
      const oldAtlas = buildChunkGeometry([lava], 0, 0, undefined, () => 18)
      const reassignedAtlas = buildChunkGeometry([lava], 0, 0, undefined, () => 73)

      expect([...oldAtlas.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(18))
      expect([...reassignedAtlas.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(73))
      expect([...reassignedAtlas.animationKinds]).toStrictEqual([...oldAtlas.animationKinds])
      expect([...reassignedAtlas.animationKinds]).toStrictEqual(
        Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.lava),
      )
    }),
  )
})
