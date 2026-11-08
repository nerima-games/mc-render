import { BLOCK_IDS, type BlockId, blockTypeOfId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { animationTimeSeconds } from '../src/domain/animation-clock'
import { ANIMATED_TEXTURE_FRAMES, tileIndexForBlockName } from '../src/domain/block-texture-map'
import {
  CHUNK_ANIMATION_KIND,
  CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE,
} from '../src/domain/chunk-animation-kind'
import { buildChunkGeometry, type MeshQuad } from '../src/domain/chunk-geometry'
import {
  chunkTextureFrameTile,
  ChunkTextureFrameSelectionErrorSchema,
} from '../src/domain/chunk-shader'
import { AtlasTileIndexSchema } from '../src/domain/texture-atlas'
import { makeAnimationClockInput } from './support/animation-clock'

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

const frameTileAt = (
  blockType: string,
  simulationTick: number,
  partialTick = 0,
  baseTileIndex = 17,
  role: MeshQuad['role'] = 'top',
): number => {
  const blockId = blockIdForType(blockType)
  const geometry = buildChunkGeometry([quad(blockId, role)], 0, 0, undefined, () => baseTileIndex)
  const [animationKind] = geometry.animationKinds
  const timeSeconds = Result.getOrThrow(animationTimeSeconds(makeAnimationClockInput(simulationTick, partialTick, 0)))
  return Result.getOrThrow(chunkTextureFrameTile({ animationKind, baseTileIndex, timeSeconds }))
}

const ANIMATED_BLOCKS = [
  { blockType: 'water', frames: ANIMATED_TEXTURE_FRAMES.water.water, firstChangeTick: 20 },
  { blockType: 'water_cauldron', frames: ANIMATED_TEXTURE_FRAMES.water.water, firstChangeTick: 20 },
  { blockType: 'lava', frames: ANIMATED_TEXTURE_FRAMES.lava.lava, firstChangeTick: 20 },
  { blockType: 'fire', frames: ANIMATED_TEXTURE_FRAMES.fire.fire, firstChangeTick: 10 },
  { blockType: 'nether_portal', frames: ANIMATED_TEXTURE_FRAMES.portal.nether_portal, firstChangeTick: 20 },
  { blockType: 'end_portal', frames: ANIMATED_TEXTURE_FRAMES.portal.end_portal, firstChangeTick: 20 },
  { blockType: 'end_gateway', frames: ANIMATED_TEXTURE_FRAMES.portal.end_gateway, firstChangeTick: 20 },
] as const

describe('animated atlas frame selection', () => {
  it.effect('connects block geometry and the simulation clock to manifest frame sequences', () =>
    Effect.sync(() => {
      for (const { blockType, frames, firstChangeTick } of ANIMATED_BLOCKS) {
        const beforeBoundaryTick = firstChangeTick - 1
        const before = frameTileAt(blockType, beforeBoundaryTick)
        const beforeWithPartialTick = frameTileAt(blockType, beforeBoundaryTick, 0.99)
        const after = frameTileAt(blockType, firstChangeTick)

        expect(before, blockType).toBe(frames[0])
        expect(beforeWithPartialTick, blockType).toBe(frames[0])
        expect(after, blockType).toBe(frames[1])
        expect(frameTileAt(blockType, firstChangeTick), blockType).toBe(after)
      }

      expect(CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE['lava_cauldron']).toBe(CHUNK_ANIMATION_KIND.lava)
    }),
  )

  it.effect('keeps ice on its assigned static tile as the clock advances', () =>
    Effect.sync(() => {
      const ice = blockIdForType('ice')
      const geometry = buildChunkGeometry([quad(ice)], 0, 0, undefined, () => 51)
      expect(geometry.animationKinds[0]).toBe(CHUNK_ANIMATION_KIND.none)
      expect(frameTileAt('ice', 0, 0, 51)).toBe(51)
      expect(frameTileAt('ice', 200, 0.75, 51)).toBe(51)
    }),
  )

  it.effect('animates the water cauldron surface while preserving the static vessel faces', () =>
    Effect.sync(() => {
      const topTile = Result.getOrThrow(tileIndexForBlockName('water_cauldron', 'top'))
      const sideTile = Result.getOrThrow(tileIndexForBlockName('water_cauldron', 'side'))
      const bottomTile = Result.getOrThrow(tileIndexForBlockName('water_cauldron', 'bottom'))
      expect(frameTileAt('water_cauldron', 20, 0, topTile, 'top')).toBe(ANIMATED_TEXTURE_FRAMES.water.water[1])
      expect(frameTileAt('water_cauldron', 20, 0, sideTile, 'side')).toBe(sideTile)
      expect(frameTileAt('water_cauldron', 20, 0, bottomTile, 'bottom')).toBe(bottomTile)

      const lavaCauldronKind = CHUNK_ANIMATION_KIND_BY_BLOCK_TYPE['lava_cauldron']
      expect(lavaCauldronKind).toBe(CHUNK_ANIMATION_KIND.lava)
      const lavaCauldronFrame = chunkTextureFrameTile({
        animationKind: lavaCauldronKind,
        baseTileIndex: ANIMATED_TEXTURE_FRAMES.lava.lava[0],
        timeSeconds: 1,
      })
      expect(Result.getOrThrow(lavaCauldronFrame)).toBe(ANIMATED_TEXTURE_FRAMES.lava.lava[1])
    }),
  )

  it.effect('returns typed failures for invalid input and overflowing frame time', () =>
    Effect.sync(() => {
      const invalidInputs: ReadonlyArray<unknown> = [
        null,
        1,
        { animationKind: 7, baseTileIndex: 0, timeSeconds: 0 },
        { animationKind: CHUNK_ANIMATION_KIND.water, baseTileIndex: -1, timeSeconds: 0 },
        { animationKind: CHUNK_ANIMATION_KIND.water, baseTileIndex: 0, timeSeconds: -1 },
      ]
      for (const input of invalidInputs) {
        const actual = chunkTextureFrameTile(input)
        expect(Result.isFailure(actual)).toBe(true)
        if (Result.isFailure(actual)) {
          expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkTextureFrameSelectionErrorSchema)(actual.failure)))
            .toBe(true)
        }
      }

      const overflowing = chunkTextureFrameTile({
        animationKind: CHUNK_ANIMATION_KIND.fire,
        baseTileIndex: 0,
        timeSeconds: Number.MAX_VALUE,
      })
      expect(Result.isFailure(overflowing)).toBe(true)
    }),
  )

  it.effect('property: arbitrary inputs return a typed failure or a schema-valid atlas tile without throwing', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.jsonValue(), (input) => {
          const actual = chunkTextureFrameTile(input)
          if (Result.isFailure(actual)) {
            expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkTextureFrameSelectionErrorSchema)(actual.failure)))
              .toBe(true)
          } else {
            expect(Result.isSuccess(Schema.decodeUnknownResult(AtlasTileIndexSchema)(actual.success))).toBe(true)
          }
        }),
        { numRuns: 200, seed: 0 },
      )
    }),
  )
})
