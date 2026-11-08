import { BLOCK_IDS, type BlockId, blockTypeOfId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  CHUNK_ANIMATION_KIND,
  CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE,
} from '../src/domain/chunk-animation-kind'
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

const quad = (blockId: BlockId, role: MeshQuad['role'] = 'top'): MeshQuad => ({
  ao: 0,
  blockId,
  direction: 'yPos',
  height: 1,
  role,
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
  { blockType: 'end_gateway', kind: CHUNK_ANIMATION_KIND.endGateway },
  { blockType: 'water_cauldron', kind: CHUNK_ANIMATION_KIND.water },
] as const

describe('chunk animation kinds', () => {
  it.effect('marks animated blocks and the water cauldron with their block-derived kinds', () =>
    Effect.sync(() => {
      for (const { blockType, kind } of ANIMATED_BLOCK_TYPES) {
        const buffers = buildChunkGeometry([quad(blockIdForType(blockType))], 0, 0, undefined, () => 18)

        expect([...buffers.tileIndices], blockType).toStrictEqual(Array(VERTICES_PER_QUAD).fill(18))
        expect([...buffers.animationKinds], blockType).toStrictEqual(Array(VERTICES_PER_QUAD).fill(kind))
      }
    }),
  )

  it.effect('leaves ice still even when a caller supplies an arbitrary atlas tile', () =>
    Effect.sync(() => {
      const buffers = buildChunkGeometry([quad(blockIdForType('ice'))], 0, 0, undefined, () => 18)

      expect([...buffers.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(18))
      expect([...buffers.animationKinds]).toStrictEqual(
        Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.none),
      )
    }),
  )

  it.effect('aliases both cauldron types to their liquid animation kinds', () =>
    Effect.sync(() => {
      expect(CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE['water_cauldron']).toBe(CHUNK_ANIMATION_KIND.water)
      expect(CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE['lava_cauldron']).toBe(CHUNK_ANIMATION_KIND.lava)
    }),
  )

  it.effect('animates only the liquid face of a cauldron', () =>
    Effect.sync(() => {
      const waterCauldron = blockIdForType('water_cauldron')
      const top = buildChunkGeometry([quad(waterCauldron, 'top')], 0, 0, undefined, () => 18)
      const side = buildChunkGeometry([quad(waterCauldron, 'side')], 0, 0, undefined, () => 19)
      const bottom = buildChunkGeometry([quad(waterCauldron, 'bottom')], 0, 0, undefined, () => 20)

      expect([...top.animationKinds]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.water))
      expect([...side.animationKinds]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.none))
      expect([...bottom.animationKinds]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(CHUNK_ANIMATION_KIND.none))
      expect([...side.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(19))
      expect([...bottom.tileIndices]).toStrictEqual(Array(VERTICES_PER_QUAD).fill(20))
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
