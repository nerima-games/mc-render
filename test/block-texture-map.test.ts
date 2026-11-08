import { BLOCK_TYPES, type BlockType } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  ANIMATED_TEXTURE_FRAMES,
  BLOCK_TEXTURE_ALPHA_MODES,
  BLOCK_TEXTURE_VARIANTS,
  BlockTextureManifestErrorSchema,
  type BlockTextureManifestFailureReason,
  decodeBlockTextureManifest,
  quadTileForLookup,
  quadTileFromResolver,
  referencedTileIndices,
  TILE_BY_BLOCK_NAME,
  tileIndexForFaceAssignment,
  tileIndexForBlockName,
  tileIndexResolver,
} from '../src/domain/block-texture-map'
import { ATLAS_TILE_COUNT, AtlasTileIndexSchema, isTileIndex } from '../src/domain/texture-atlas'
import type { FaceRole, GeometryQuad } from '../src/domain/meshing-vocabulary'
import { blockId } from './support/kernel-brands'
import sourceManifest from '../src/assets/block-textures/manifest.json' with { type: 'json' }

const FACE_ROLES: ReadonlyArray<FaceRole> = ['top', 'side', 'bottom']

const expectManifestFailure = (input: unknown, reason: BlockTextureManifestFailureReason): void => {
  const result = decodeBlockTextureManifest(input)
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure.reason).toBe(reason)
  }
}

describe('block texture manifest mapping', () => {
  it.effect('covers kernel BLOCK_TYPES and keeps base tiles in kernel face order', () =>
    Effect.sync(() => {
      expect(Object.keys(TILE_BY_BLOCK_NAME).sort()).toStrictEqual([...BLOCK_TYPES].sort())
      expect(Object.keys(TILE_BY_BLOCK_NAME)).toHaveLength(BLOCK_TYPES.length)
      expect(TILE_BY_BLOCK_NAME.air).toStrictEqual({ bottom: 0, side: 0, top: 0 })

      let nextTile = 1
      for (const blockName of BLOCK_TYPES.filter((candidate) => candidate !== 'air')) {
        expect(TILE_BY_BLOCK_NAME[blockName]).toStrictEqual({
          bottom: nextTile + 2,
          side: nextTile + 1,
          top: nextTile,
        })
        nextTile += 3
      }
      expect(nextTile).toBe(1 + (BLOCK_TYPES.length - 1) * 3)
    }),
  )

  it.effect('covers every block alpha mode from the generated manifest', () =>
    Effect.sync(() => {
      expect(Object.keys(BLOCK_TEXTURE_ALPHA_MODES).sort()).toStrictEqual([...BLOCK_TYPES].sort())
      expect(BLOCK_TEXTURE_ALPHA_MODES.air).toBe('cutout')
      expect(BLOCK_TEXTURE_ALPHA_MODES.glass).toBe('translucent')
      expect(BLOCK_TEXTURE_ALPHA_MODES.oak_leaves).toBe('cutout')
      expect(BLOCK_TEXTURE_ALPHA_MODES.stone).toBe('opaque')
    }),
  )

  it.effect('returns each mapped face through a typed lookup result', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...BLOCK_TYPES),
          FastCheck.constantFrom(...FACE_ROLES),
          (blockName, role) => {
            const lookup = tileIndexForBlockName(blockName, role)
            expect(Result.isSuccess(lookup)).toBe(true)
            if (Result.isSuccess(lookup)) {
              expect(lookup.success).toBe(TILE_BY_BLOCK_NAME[blockName][role])
              expect(isTileIndex(lookup.success)).toBe(true)
            }
          },
        ),
        { numRuns: 200, seed: 0 },
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ max: ATLAS_TILE_COUNT - 1, min: 0 }), (tile) => {
          const decoded = Schema.decodeUnknownResult(AtlasTileIndexSchema)(tile)
          expect(Result.isSuccess(decoded)).toBe(true)
          if (Result.isSuccess(decoded)) {
            expect(isTileIndex(decoded.success)).toBe(true)
          }
        }),
        { numRuns: 200, seed: 4 },
      )
    }),
  )

  it.effect('fails unknown names rather than mapping them to transparent air', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.string().filter((name) => !BLOCK_TYPES.includes(name as BlockType)), (name) => {
          expect(tileIndexForBlockName(name, 'top')).toStrictEqual(Result.fail({
            _tag: 'BlockTextureLookupError',
            blockName: name,
            reason: 'unknown-block',
            role: 'top',
          }))
        }),
        { numRuns: 100, seed: 1 },
      )
    }),
  )

  it.effect('keeps crop variants and animation frames within the packed atlas', () =>
    Effect.sync(() => {
      expect(Object.keys(BLOCK_TEXTURE_VARIANTS).length).toBeGreaterThan(0)
      for (const [crop, stages] of Object.entries(BLOCK_TEXTURE_VARIANTS)) {
        expect(stages.length).toBeGreaterThan(1)
        expect(stages[0]).toBe(TILE_BY_BLOCK_NAME[crop as BlockType].top)
        expect(stages.every(isTileIndex)).toBe(true)
      }

      expect(Object.keys(ANIMATED_TEXTURE_FRAMES).sort()).toStrictEqual(['fire', 'lava', 'portal', 'water'])
      for (const blocks of Object.values(ANIMATED_TEXTURE_FRAMES)) {
        for (const frames of Object.values(blocks)) {
          expect(frames.length).toBeGreaterThan(0)
          expect(frames.every(isTileIndex)).toBe(true)
        }
      }
      expect(ANIMATED_TEXTURE_FRAMES['portal']).toHaveProperty('end_portal')
      expect(ANIMATED_TEXTURE_FRAMES['portal']).toHaveProperty('nether_portal')
      expect(ANIMATED_TEXTURE_FRAMES['portal']).toHaveProperty('end_gateway')

      const variantTiles = Object.values(BLOCK_TEXTURE_VARIANTS).flatMap((stages) => stages.slice(1))
      const animationTiles = Object.values(ANIMATED_TEXTURE_FRAMES).flatMap((blocks) =>
        Object.values(blocks).flat(),
      )
      expect(Math.min(...animationTiles)).toBeGreaterThan(Math.max(...variantTiles))
      expect(new Set(animationTiles).size).toBe(animationTiles.length)
    }),
  )

  it.effect('uses typed failures through the resolver and quad adapter', () =>
    Effect.sync(() => {
      const resolveStone = tileIndexResolver(() => 'stone')
      const stone = resolveStone(blockId(1), 'top')
      expect(Result.isSuccess(stone)).toBe(true)
      if (Result.isSuccess(stone)) {
        expect(stone.success).toBe(TILE_BY_BLOCK_NAME.stone.top)
      }

      const resolveUnknown = tileIndexResolver(() => 'missing_block')
      const failure = resolveUnknown(blockId(1), 'side')
      expect(Result.isFailure(failure)).toBe(true)
      if (Result.isFailure(failure)) {
        const quad = { blockId: blockId(1), role: 'side' } as unknown as GeometryQuad
        expect(quadTileFromResolver(resolveUnknown)(quad)).toStrictEqual(Result.fail(failure.failure))
      }

      const quad = { blockId: blockId(1), role: 'top' } as unknown as GeometryQuad
      expect(quadTileForLookup(() => 'stone')(quad)).toStrictEqual(Result.succeed(TILE_BY_BLOCK_NAME.stone.top))
    }),
  )

  it.effect('decodes manifests into typed results and rejects invalid allocation contracts', () =>
    Effect.sync(() => {
      const valid = decodeBlockTextureManifest(sourceManifest)
      expect(Result.isSuccess(valid)).toBe(true)
      if (Result.isSuccess(valid)) {
        expect(Object.keys(valid.success.blockFaces).sort()).toStrictEqual([...BLOCK_TYPES].sort())
      }
      expectManifestFailure(null, 'schema')
      expectManifestFailure({ ...sourceManifest, schemaVersion: 2 }, 'schema')
      const invalid = decodeBlockTextureManifest(null)
      if (Result.isFailure(invalid)) {
        expect(Schema.is(BlockTextureManifestErrorSchema)(invalid.failure)).toBe(true)
      }

      FastCheck.assert(
        FastCheck.property(FastCheck.oneof(FastCheck.constant(null), FastCheck.string(), FastCheck.integer()), (input) => {
          expect(Result.isFailure(decodeBlockTextureManifest(input))).toBe(true)
        }),
        { numRuns: 100, seed: 3 },
      )
      FastCheck.assert(
        FastCheck.property(FastCheck.constantFrom(...BLOCK_TYPES), (blockName) => {
          const decoded = decodeBlockTextureManifest(sourceManifest)
          expect(Result.isSuccess(decoded)).toBe(true)
          if (Result.isSuccess(decoded)) {
            const faces = decoded.success.blockFaces[blockName]
            expect(faces).toBeDefined()
            if (faces !== undefined) {
              expect([faces.top, faces.side, faces.bottom].every(isTileIndex)).toBe(true)
              const stages = decoded.success.variants[blockName]
              if (stages !== undefined) {
                expect(stages[0]).toBe(faces.top)
              }
            }
          }
        }),
        { numRuns: 200, seed: 5 },
      )

      const invalidLayout = {
        ...sourceManifest,
        layout: { ...sourceManifest.layout, width: 1024 },
      }
      expectManifestFailure(invalidLayout, 'layout')

      const invalidFaces = {
        ...sourceManifest,
        blockFaces: {
          ...sourceManifest.blockFaces,
          stone: { ...sourceManifest.blockFaces.stone, top: ATLAS_TILE_COUNT },
        },
      }
      expectManifestFailure(invalidFaces, 'schema')

      const incompleteFaces = Object.fromEntries(
        Object.entries(sourceManifest.blockFaces).filter(([blockName]) => blockName !== 'stone'),
      )
      expectManifestFailure({ ...sourceManifest, blockFaces: incompleteFaces }, 'block-faces')

      const incompleteAlphaModes = Object.fromEntries(
        Object.entries(sourceManifest.blockAlphaModes).filter(([blockName]) => blockName !== 'stone'),
      )
      expectManifestFailure({ ...sourceManifest, blockAlphaModes: incompleteAlphaModes }, 'block-alpha-modes')

      const invalidAir = {
        ...sourceManifest,
        blockFaces: {
          ...sourceManifest.blockFaces,
          air: { ...sourceManifest.blockFaces.air, bottom: 1 },
        },
      }
      expectManifestFailure(invalidAir, 'air-face')

      const invalidBaseOrder = {
        ...sourceManifest,
        blockFaces: {
          ...sourceManifest.blockFaces,
          stone: { ...sourceManifest.blockFaces.stone, side: sourceManifest.blockFaces.stone.side + 1 },
        },
      }
      expectManifestFailure(invalidBaseOrder, 'base-face-order')

      const invalidVariantName = {
        ...sourceManifest,
        variants: { ...sourceManifest.variants, unknown_crop: [1] },
      }
      expectManifestFailure(invalidVariantName, 'variant-block')

      const invalidVariantList = {
        ...sourceManifest,
        variants: { ...sourceManifest.variants, wheat_crop: [ATLAS_TILE_COUNT] },
      }
      expectManifestFailure(invalidVariantList, 'schema')

      const invalidVariantAlias = {
        ...sourceManifest,
        variants: { ...sourceManifest.variants, wheat_crop: [sourceManifest.blockFaces.stone.top] },
      }
      expectManifestFailure(invalidVariantAlias, 'variant-alias')

      const invalidVariantOrder = {
        ...sourceManifest,
        variants: {
          ...sourceManifest.variants,
          wheat_crop: [sourceManifest.blockFaces.wheat_crop.top, ATLAS_TILE_COUNT - 1],
        },
      }
      expectManifestFailure(invalidVariantOrder, 'variant-order')

      const emptyVariant = {
        ...sourceManifest,
        variants: { ...sourceManifest.variants, wheat_crop: [] },
      }
      expectManifestFailure(emptyVariant, 'variant-tiles')

      const invalidAnimationName = {
        ...sourceManifest,
        animations: {
          ...sourceManifest.animations,
          fire: { ...sourceManifest.animations.fire, unknown_block: [400] },
        },
      }
      expectManifestFailure(invalidAnimationName, 'animation-block')

      const invalidAnimationGroup = {
        ...sourceManifest,
        animations: { ...sourceManifest.animations, fire: undefined },
      }
      expectManifestFailure(invalidAnimationGroup, 'animation-group')

      const missingAnimationBlock = {
        ...sourceManifest,
        animations: { ...sourceManifest.animations, fire: {} },
      }
      expectManifestFailure(missingAnimationBlock, 'animation-block')

      const missingAnimationGroup = {
        ...sourceManifest,
        animations: Object.fromEntries(
          Object.entries(sourceManifest.animations).filter(([group]) => group !== 'fire'),
        ),
      }
      expectManifestFailure(missingAnimationGroup, 'animation-group')

      const emptyAnimation = {
        ...sourceManifest,
        animations: { ...sourceManifest.animations, fire: { fire: [] } },
      }
      expectManifestFailure(emptyAnimation, 'animation-tiles')

      const extraAnimationGroup = {
        ...sourceManifest,
        animations: { ...sourceManifest.animations, extra: {} },
      }
      expectManifestFailure(extraAnimationGroup, 'animation-group')

      const duplicateAnimationTile = {
        ...sourceManifest,
        animations: {
          ...sourceManifest.animations,
          water: { water: sourceManifest.animations.water.water.map(() => sourceManifest.animations.water.water[0]) },
        },
      }
      expectManifestFailure(duplicateAnimationTile, 'animation-coverage')

      expectManifestFailure({ ...sourceManifest, tileCount: ATLAS_TILE_COUNT + 1 }, 'tile-count')

      expect(tileIndexForFaceAssignment('stone', 'side', {
        bottom: TILE_BY_BLOCK_NAME.stone.bottom,
        side: ATLAS_TILE_COUNT,
        top: TILE_BY_BLOCK_NAME.stone.top,
      })).toStrictEqual(Result.fail({
        _tag: 'BlockTextureLookupError',
        blockName: 'stone',
        reason: 'invalid-tile-index',
        role: 'side',
      }))
      expect(tileIndexForFaceAssignment('stone', 'top', TILE_BY_BLOCK_NAME.stone)).toStrictEqual(
        Result.succeed(TILE_BY_BLOCK_NAME.stone.top),
      )
      expect(tileIndexForFaceAssignment('missing_block', 'top', TILE_BY_BLOCK_NAME.stone)).toStrictEqual(
        Result.fail({
          _tag: 'BlockTextureLookupError',
          blockName: 'missing_block',
          reason: 'unknown-block',
          role: 'top',
        }),
      )
    }),
  )

  it.effect('references only valid atlas cells and returns sorted unique indices', () =>
    Effect.sync(() => {
      const indices = referencedTileIndices()
      expect(indices).toStrictEqual([...indices].sort((left, right) => left - right))
      expect(new Set(indices).size).toBe(indices.length)
      expect(indices.length).toBeGreaterThan(0)
      expect(indices.every((tile) => isTileIndex(tile) && tile < ATLAS_TILE_COUNT)).toBe(true)
    }),
  )
})
