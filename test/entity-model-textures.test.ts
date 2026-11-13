import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result, Schema } from 'effect'
import {
  ENTITY_MODEL_KINDS,
  InvalidEntityModelKindSchema,
  decodeEntityModelKind,
} from '../src/domain/entity-model-catalog.js'
import {
  ENTITY_MODEL_TEXTURE_ATLAS,
  EntityTextureResolutionIssueSchema,
  EntityTextureUvCoordinatesSchema,
  entityTextureAtlasPixels,
  entityTextureUvForKind,
} from '../src/domain/entity-model-textures.js'

const ENTITY_TEXTURE_COUNT = 128
const ENTITY_TEXTURE_TILE_SIZE = 16
const ENTITY_TEXTURE_GUTTER = 2
const ENTITY_TEXTURE_CELL_SIZE = 20
const ENTITY_TEXTURE_COLUMNS = 16
const ENTITY_TEXTURE_PIXEL_BYTES = 4
const ENTITY_TEXTURE_ATLAS_WIDTH = ENTITY_TEXTURE_COLUMNS * ENTITY_TEXTURE_CELL_SIZE
const tileColorCount = (pixels: Uint8Array, tile: number): number => {
  const column = tile % ENTITY_TEXTURE_COLUMNS
  const row = Math.floor(tile / ENTITY_TEXTURE_COLUMNS)
  const left = column * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const top = row * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const colors = new Set<string>()
  for (let y = 0; y < ENTITY_TEXTURE_TILE_SIZE; y += 1) {
    for (let x = 0; x < ENTITY_TEXTURE_TILE_SIZE; x += 1) {
      const offset = ((top + y) * ENTITY_TEXTURE_ATLAS_WIDTH + left + x) * ENTITY_TEXTURE_PIXEL_BYTES
      colors.add(`${pixels[offset] ?? 0},${pixels[offset + 1] ?? 0},${pixels[offset + 2] ?? 0}`)
    }
  }
  return colors.size
}

describe('entity texture atlas', () => {
  it('provides a patterned tile and valid UV rectangle for all catalog models', () => {
    const pixels = entityTextureAtlasPixels()
    const tileColors = ENTITY_MODEL_TEXTURE_ATLAS.entries.map(({ tile }) => tileColorCount(pixels, tile))
    expect(ENTITY_MODEL_TEXTURE_ATLAS.entries).toHaveLength(ENTITY_TEXTURE_COUNT)
    expect(new Set(ENTITY_MODEL_TEXTURE_ATLAS.entries.map(({ kind }) => kind))).toHaveLength(ENTITY_TEXTURE_COUNT)
    expect(tileColors.every((colorCount) => colorCount > 1)).toBe(true)
    expect(new Set(ENTITY_MODEL_TEXTURE_ATLAS.entries.map(({ motif }) => motif)).size).toBeGreaterThan(8)
    expect(pixels).toHaveLength(
      ENTITY_MODEL_TEXTURE_ATLAS.width * ENTITY_MODEL_TEXTURE_ATLAS.height * ENTITY_TEXTURE_PIXEL_BYTES,
    )

    for (const kind of ENTITY_MODEL_KINDS) {
      const uv = entityTextureUvForKind(kind)
      expect(Result.isSuccess(uv), String(kind)).toBe(true)
      if (Result.isSuccess(uv)) {
        expect(Schema.is(EntityTextureUvCoordinatesSchema)(uv.success), String(kind)).toBe(true)
      }
    }
  })

  it('returns typed failures and schema-valid values for arbitrary kinds without throwing', () => {
    FastCheck.assert(FastCheck.property(
      FastCheck.oneof(
        FastCheck.constantFrom(...ENTITY_MODEL_KINDS.map(String)),
        FastCheck.string(),
      ),
      (input) => {
        const decoded = decodeEntityModelKind(input)
        if (Result.isFailure(decoded)) {
          return Schema.is(InvalidEntityModelKindSchema)(decoded.failure)
        }
        const uv = entityTextureUvForKind(decoded.success)
        if (Result.isFailure(uv)) {
          return Schema.is(EntityTextureResolutionIssueSchema)(uv.failure)
        }
        return Schema.is(EntityTextureUvCoordinatesSchema)(uv.success)
      },
    ), { numRuns: 500 })
  })

  it('accepts inclusive atlas edges and rejects coordinates just outside or out of order', () => {
    expect(Schema.is(EntityTextureUvCoordinatesSchema)([0, 0, 1, 1])).toBe(true)
    expect(Schema.is(EntityTextureUvCoordinatesSchema)([-Number.EPSILON, 0, 1, 1])).toBe(false)
    expect(Schema.is(EntityTextureUvCoordinatesSchema)([0, 0, 1 + Number.EPSILON, 1])).toBe(false)
    expect(Schema.is(EntityTextureUvCoordinatesSchema)([0.5, 0.4, 0.4, 0.7])).toBe(false)
  })
})
