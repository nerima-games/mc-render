import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  ATLAS_COLUMNS,
  ATLAS_MIP_LEVEL_COUNT,
  ATLAS_PIXELS,
  ATLAS_ROWS,
  ATLAS_TILE_COUNT,
  AtlasTileIndexSchema,
  atlasMipLevelDimensions,
  generateTerrainAtlas,
  HALF_TEXEL_UV,
  isTileIndex,
  mipLevelDimensions,
  sourcePixelForCellCoordinate,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
  TILE_UV_PITCH,
  TILE_UV_SPAN,
  tileCellOriginPixels,
  tileColumn,
  tileImageOriginPixels,
  tileIndexForUvOrigin,
  tileRow,
  tileUvBounds,
  tileUvOrigin,
  uvPatchStaysInsideTile,
} from '../src/domain/texture-atlas'

describe('atlas dimensions', () => {
  it.effect('matches the packed atlas and sampling contract', () =>
    Effect.sync(() => {
      expect(ATLAS_PIXELS).toBe(1536)
      expect(ATLAS_COLUMNS).toBe(32)
      expect(ATLAS_ROWS).toBe(32)
      expect(TILE_PIXELS).toBe(16)
      expect(TILE_GUTTER_PIXELS).toBe(16)
      expect(TILE_CELL_PIXELS).toBe(48)
      expect(ATLAS_TILE_COUNT).toBe(1024)
      expect(ATLAS_MIP_LEVEL_COUNT).toBe(11)
      expect(HALF_TEXEL_UV).toBe(0.5 / 1536)
      expect(TILE_UV_PITCH).toBe(48 / 1536)
      expect(TILE_UV_SPAN).toBe(15 / 1536)
    }),
  )

  it.effect('lists every WebGL mip level through 1x1', () =>
    Effect.sync(() => {
      expect(Result.getOrThrow(atlasMipLevelDimensions())).toStrictEqual([
        { height: 1536, level: 0, width: 1536 },
        { height: 768, level: 1, width: 768 },
        { height: 384, level: 2, width: 384 },
        { height: 192, level: 3, width: 192 },
        { height: 96, level: 4, width: 96 },
        { height: 48, level: 5, width: 48 },
        { height: 24, level: 6, width: 24 },
        { height: 12, level: 7, width: 12 },
        { height: 6, level: 8, width: 6 },
        { height: 3, level: 9, width: 3 },
        { height: 1, level: 10, width: 1 },
      ])
      expect(Result.getOrThrow(mipLevelDimensions(ATLAS_MIP_LEVEL_COUNT - 1))).toStrictEqual({
        height: 1,
        level: 10,
        width: 1,
      })
    }),
  )
})

describe('tile coordinates', () => {
  it.effect('maps valid tile indices to their cell positions and inner image bounds', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ max: ATLAS_TILE_COUNT - 1, min: 0 }), (tile) => {
          const column = Result.getOrThrow(tileColumn(tile))
          const row = Result.getOrThrow(tileRow(tile))
          const cell = Result.getOrThrow(tileCellOriginPixels(tile))
          const image = Result.getOrThrow(tileImageOriginPixels(tile))
          const bounds = Result.getOrThrow(tileUvBounds(tile))

          expect(isTileIndex(tile)).toBe(true)
          const decodedTile = Schema.decodeUnknownResult(AtlasTileIndexSchema)(tile)
          expect(Result.isSuccess(decodedTile)).toBe(true)
          expect(column).toBe(tile % ATLAS_COLUMNS)
          expect(row).toBe(Math.floor(tile / ATLAS_COLUMNS))
          expect(cell).toStrictEqual({ x: column * TILE_CELL_PIXELS, y: row * TILE_CELL_PIXELS })
          expect(image).toStrictEqual({ x: cell.x + TILE_GUTTER_PIXELS, y: cell.y + TILE_GUTTER_PIXELS })
          expect(bounds.u0).toBeGreaterThanOrEqual(0)
          expect(bounds.v0).toBeGreaterThanOrEqual(0)
          expect(bounds.u1).toBeLessThanOrEqual(1)
          expect(bounds.v1).toBeLessThanOrEqual(1)
          expect(bounds.u1 - bounds.u0).toBeCloseTo(TILE_UV_SPAN, 12)
          expect(bounds.v1 - bounds.v0).toBeCloseTo(TILE_UV_SPAN, 12)
        }),
        { numRuns: 500, seed: 0 },
      )
    }),
  )

  it.effect('round-trips every valid inset origin to its tile index', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ max: ATLAS_TILE_COUNT - 1, min: 0 }), (tile) => {
          const origin = Result.getOrThrow(tileUvOrigin(tile))
          expect(Result.getOrThrow(tileIndexForUvOrigin(origin))).toBe(tile)
        }),
        { numRuns: 500, seed: 1 },
      )
    }),
  )

  it.effect('returns typed failures for invalid tile and mip indices', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(-1, ATLAS_TILE_COUNT, 1.5, Number.NaN, Number.POSITIVE_INFINITY),
          (tile) => {
            expect(isTileIndex(tile)).toBe(false)
            expect(Result.isFailure(tileColumn(tile))).toBe(true)
            expect(Result.isFailure(tileRow(tile))).toBe(true)
            expect(Result.isFailure(tileUvBounds(tile))).toBe(true)
          },
        ),
        { numRuns: 100, seed: 2 },
      )
      expect(Result.isFailure(mipLevelDimensions(-1))).toBe(true)
      expect(Result.isFailure(mipLevelDimensions(ATLAS_MIP_LEVEL_COUNT))).toBe(true)
      expect(Result.isFailure(mipLevelDimensions(0.5))).toBe(true)
      expect(Result.isFailure(mipLevelDimensions(Number.NaN))).toBe(true)
      expect(Result.isFailure(mipLevelDimensions(null))).toBe(true)
      expect(Result.isFailure(tileColumn(null))).toBe(true)
      expect(Result.isFailure(tileCellOriginPixels('not-a-tile'))).toBe(true)
      expect(Result.isFailure(tileUvOrigin(ATLAS_TILE_COUNT))).toBe(true)
    }),
  )

  it.effect('reports invalid UV origins and spans instead of returning sentinels', () =>
    Effect.sync(() => {
      expect(Result.isFailure(tileIndexForUvOrigin({ u: Number.NaN, v: 0.5 }))).toBe(true)
      expect(Result.isFailure(tileIndexForUvOrigin({ u: 1.1, v: 0.5 }))).toBe(true)
      expect(Result.isFailure(tileIndexForUvOrigin({ u: 'bad', v: 0.5 }))).toBe(true)
      expect(Result.isFailure(tileIndexForUvOrigin({
        u: TILE_UV_PITCH * ATLAS_COLUMNS,
        v: TILE_UV_PITCH * ATLAS_COLUMNS,
      }))).toBe(true)
      expect(Result.isFailure(tileIndexForUvOrigin({ u: 0.5, v: 0.5 }))).toBe(true)
      expect(Result.isFailure(tileIndexForUvOrigin(null))).toBe(true)
      expect(Result.isFailure(uvPatchStaysInsideTile(Number.NaN))).toBe(true)
      expect(Result.isFailure(uvPatchStaysInsideTile('not-a-span'))).toBe(true)
      expect(Result.isFailure(uvPatchStaysInsideTile(-Number.EPSILON))).toBe(true)
      expect(Result.getOrThrow(uvPatchStaysInsideTile(TILE_UV_SPAN))).toBe(true)
      expect(Result.getOrThrow(uvPatchStaysInsideTile(TILE_UV_PITCH))).toBe(false)
    }),
  )
})

describe('edge extrusion', () => {
  it.effect('clamps all 48 cell coordinates onto the 16px source edge', () =>
    Effect.sync(() => {
      expect(
        [0, 15, 16, 17, 31, 32, 47].map((cellPixel) =>
          Result.getOrThrow(sourcePixelForCellCoordinate(cellPixel)),
        ),
      ).toStrictEqual([0, 0, 0, 1, 15, 15, 15])
      expect(Result.isFailure(sourcePixelForCellCoordinate(-1))).toBe(true)
      expect(Result.isFailure(sourcePixelForCellCoordinate(TILE_CELL_PIXELS))).toBe(true)
      expect(Result.isFailure(sourcePixelForCellCoordinate(2.5))).toBe(true)
      expect(Result.isFailure(sourcePixelForCellCoordinate(Number.NaN))).toBe(true)
      expect(Result.isFailure(sourcePixelForCellCoordinate(null))).toBe(true)
    }),
  )

  it.effect('keeps tile zero transparent and repeats edge pixels around a diagnostic tile', () =>
    Effect.sync(() => {
      const atlas = Result.getOrThrow(generateTerrainAtlas())
      const pixel = (x: number, y: number): ReadonlyArray<number> => {
        const offset = (y * atlas.width + x) * 4
        return [...atlas.data.slice(offset, offset + 4)]
      }
      const tileZeroBytes: Array<number> = []
      for (let y = 0; y < TILE_CELL_PIXELS; y += 1) {
        const offset = y * atlas.width * 4
        tileZeroBytes.push(...atlas.data.slice(offset, offset + TILE_CELL_PIXELS * 4))
      }
      expect(atlas).toMatchObject({ height: 1536, width: 1536 })
      expect(tileZeroBytes.every((byte) => byte === 0)).toBe(true)

      const tileOne = Result.getOrThrow(tileCellOriginPixels(1))
      const imageOne = Result.getOrThrow(tileImageOriginPixels(1))
      expect(pixel(tileOne.x, tileOne.y)).toStrictEqual(pixel(imageOne.x, imageOne.y))
      expect(pixel(tileOne.x + TILE_CELL_PIXELS - 1, tileOne.y)).toStrictEqual(
        pixel(imageOne.x + TILE_PIXELS - 1, imageOne.y),
      )
      expect(pixel(tileOne.x, tileOne.y + TILE_CELL_PIXELS - 1)).toStrictEqual(
        pixel(imageOne.x, imageOne.y + TILE_PIXELS - 1),
      )
    }),
  )
})
