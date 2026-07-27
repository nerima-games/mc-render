/**
 * Tests for the atlas layout arithmetic.
 *
 * The load-bearing ones are the last two describes: the half-texel derivation
 * (the reference's particle quad overshoots its tile) and the V-flip round trip
 * (a mapping that is a bijection either way round, so only the inverse catches
 * it being the wrong way round).
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ATLAS_COLUMNS,
  ATLAS_PIXELS,
  ATLAS_TILE_COUNT,
  atlasLayoutViolations,
  HALF_TEXEL_UV,
  isTileIndex,
  normaliseTileIndex,
  TILE_PIXELS,
  TILE_UV_PITCH,
  TILE_UV_SPAN,
  tileColumn,
  tileIndexForUvOrigin,
  tileRow,
  tileUvBounds,
  tileUvOrigin,
  uvPatchStaysInsideTile,
} from '../domain/texture-atlas'

describe('the atlas layout constants', () => {
  it.effect('are the reference values, asserted as literals', () =>
    Effect.sync(() => {
      // docs/testing.md §5.4: constants are pinned as literals, not recomputed
      // by the arithmetic that is supposed to be under test.
      expect(ATLAS_COLUMNS).toBe(16)
      expect(ATLAS_PIXELS).toBe(512)
      expect(TILE_PIXELS).toBe(32)
      expect(ATLAS_TILE_COUNT).toBe(256)
      expect(HALF_TEXEL_UV).toBe(0.5 / 512)
      expect(TILE_UV_PITCH).toBe(1 / 16)
    }),
  )

  it.effect('are internally consistent', () =>
    Effect.sync(() => {
      expect(atlasLayoutViolations()).toStrictEqual([])
    }),
  )
})

describe('tile index handling', () => {
  it.effect('accepts exactly the 256 tiles the atlas has', () =>
    Effect.sync(() => {
      expect(isTileIndex(0)).toBe(true)
      expect(isTileIndex(255)).toBe(true)
      expect(isTileIndex(256)).toBe(false)
      expect(isTileIndex(-1)).toBe(false)
      expect(isTileIndex(1.5)).toBe(false)
      expect(isTileIndex(Number.NaN)).toBe(false)
      expect(isTileIndex(Number.POSITIVE_INFINITY)).toBe(false)
    }),
  )

  it.effect('folds everything unknown onto tile 0, NOT onto an arbitrary real tile', () =>
    Effect.sync(() => {
      // The header's argument: a modulo fold would map 300 to tile 44, a real
      // texture, so a wrong block id would render as a plausible wrong block.
      expect(normaliseTileIndex(300)).toBe(0)
      expect(normaliseTileIndex(300)).not.toBe(300 % ATLAS_TILE_COUNT)
      expect(normaliseTileIndex(-7)).toBe(0)
      expect(normaliseTileIndex(Number.NaN)).toBe(0)
    }),
  )

  it.effect('places tiles left-to-right then top-to-bottom', () =>
    Effect.sync(() => {
      expect(tileColumn(0)).toBe(0)
      expect(tileRow(0)).toBe(0)
      expect(tileColumn(15)).toBe(15)
      expect(tileRow(15)).toBe(0)
      expect(tileColumn(16)).toBe(0)
      expect(tileRow(16)).toBe(1)
      expect(tileColumn(255)).toBe(15)
      expect(tileRow(255)).toBe(15)
    }),
  )
})

describe('tile UV rectangles', () => {
  it.effect('every one of the 256 tiles is inside [0,1] and non-degenerate', () =>
    Effect.sync(() => {
      // docs/testing.md §5.3: 256 is exhaustible, so it is exhausted.
      for (let tile = 0; tile < ATLAS_TILE_COUNT; tile += 1) {
        const bounds = tileUvBounds(tile)
        expect(bounds.u0, `tile ${String(tile)} u0`).toBeGreaterThanOrEqual(0)
        expect(bounds.v0, `tile ${String(tile)} v0`).toBeGreaterThanOrEqual(0)
        expect(bounds.u1, `tile ${String(tile)} u1`).toBeLessThanOrEqual(1)
        expect(bounds.v1, `tile ${String(tile)} v1`).toBeLessThanOrEqual(1)
        expect(bounds.u1, `tile ${String(tile)} width`).toBeGreaterThan(bounds.u0)
        expect(bounds.v1, `tile ${String(tile)} height`).toBeGreaterThan(bounds.v0)
      }
    }),
  )

  it.effect('no two tiles overlap: every rectangle is inset inside its own cell', () =>
    Effect.sync(() => {
      for (let tile = 0; tile < ATLAS_TILE_COUNT; tile += 1) {
        const bounds = tileUvBounds(tile)
        const column = tileColumn(tile)
        // Strictly inside the cell the tile owns, on both sides.
        expect(bounds.u0).toBeGreaterThan(column / ATLAS_COLUMNS)
        expect(bounds.u1).toBeLessThan((column + 1) / ATLAS_COLUMNS)
      }
    }),
  )

  it.effect('V is flipped: tile 0 is the TOP row of the image and the TOP of UV space', () =>
    Effect.sync(() => {
      const first = tileUvBounds(0)
      const last = tileUvBounds(240) // row 15, column 0 — the bottom-left of the image
      // Row 0 sits at the high end of V, because GL counts V upward and image
      // rows count downward. Getting this backwards is the classic atlas bug.
      expect(first.v1).toBeGreaterThan(last.v1)
      expect(first.v1).toBeCloseTo(1 - HALF_TEXEL_UV, 10)
      expect(last.v0).toBeCloseTo(HALF_TEXEL_UV, 10)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The reference's particle quad spans TILE_UV_PITCH from an INSET
// origin, so its far edge lands half a texel inside the neighbouring tile. This
// is the derivation in domain/texture-atlas.ts's header, pinned.
// ---------------------------------------------------------------------------
describe("the half-texel inset, and the span the reference's particle quad uses", () => {
  it.effect('TILE_UV_SPAN is the pitch less BOTH insets, not less one', () =>
    Effect.sync(() => {
      expect(TILE_UV_SPAN).toBe(TILE_UV_PITCH - 2 * HALF_TEXEL_UV)
      expect(TILE_UV_SPAN).toBeLessThan(TILE_UV_PITCH)
    }),
  )

  it.effect('REGRESSION: a quad spanning TILE_UV_PITCH from an inset origin leaves its tile', () =>
    Effect.sync(() => {
      // particle-system-factory.ts:17 `TILE_FRACTION = 1/16` used as the quad's
      // UV width, added to the inset origin from getTileUVs.
      expect(uvPatchStaysInsideTile(TILE_UV_PITCH)).toBe(false)
      expect(uvPatchStaysInsideTile(TILE_UV_SPAN)).toBe(true)
    }),
  )

  it.effect('and the overshoot is exactly one texel, on the far edge', () =>
    Effect.sync(() => {
      const tile = 7 // water, in the reference's atlas
      const origin = tileUvOrigin(tile)
      const bounds = tileUvBounds(tile)

      const referenceFarEdge = origin.u + TILE_UV_PITCH
      const correctFarEdge = origin.u + TILE_UV_SPAN

      expect(correctFarEdge).toBeCloseTo(bounds.u1, 12)
      // One whole texel past where the inset rectangle ends.
      expect(referenceFarEdge - bounds.u1).toBeCloseTo(2 * HALF_TEXEL_UV, 12)
      // And half a texel past the tile boundary itself.
      expect(referenceFarEdge - (tileColumn(tile) + 1) / ATLAS_COLUMNS).toBeCloseTo(HALF_TEXEL_UV, 12)
    }),
  )

  it.effect('rejects a span that is negative or not a number', () =>
    Effect.sync(() => {
      expect(uvPatchStaysInsideTile(-0.001)).toBe(false)
      expect(uvPatchStaysInsideTile(Number.NaN)).toBe(false)
      expect(uvPatchStaysInsideTile(0)).toBe(true)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. tileUvOrigin is a bijection whichever way the V flip is written,
// so only inverting it can catch the flip being wrong.
// ---------------------------------------------------------------------------
describe('the UV origin round trip', () => {
  it.effect('every one of the 256 tiles survives origin -> index', () =>
    Effect.sync(() => {
      for (let tile = 0; tile < ATLAS_TILE_COUNT; tile += 1) {
        expect(tileIndexForUvOrigin(tileUvOrigin(tile)), `tile ${String(tile)}`).toBe(tile)
      }
    }),
  )

  it.effect('and the round trip DISTINGUISHES rows, which is what a wrong flip would not', () =>
    Effect.sync(() => {
      // If the V flip were written `row/16` instead of `1 - (row+1)/16`, this
      // pair would swap: row 0 and row 15 are the two the flip exchanges.
      expect(tileIndexForUvOrigin(tileUvOrigin(0))).toBe(0)
      expect(tileIndexForUvOrigin(tileUvOrigin(240))).toBe(240)
      expect(tileUvOrigin(0).v).not.toBe(tileUvOrigin(240).v)
    }),
  )

  it.effect('rejects an origin that is outside the atlas', () =>
    Effect.sync(() => {
      expect(tileIndexForUvOrigin({ u: 1.5, v: 0.5 })).toBe(-1)
      expect(tileIndexForUvOrigin({ u: -0.5, v: 0.5 })).toBe(-1)
      expect(tileIndexForUvOrigin({ u: 0.5, v: Number.NaN })).toBe(-1)
    }),
  )
})
