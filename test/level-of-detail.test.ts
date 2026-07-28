/**
 * LOD tier selection, and the apparent-error measurement that judges it.
 *
 * mc-meshing `docs/responsibility.md` §3.4 assigned `lodForDistance` and the two
 * distance constants to this repository, and §3.5 wrote down what would have to
 * be measured to justify them. Two of those measurements are arithmetic and are
 * taken here; the third is perceptual and is not takeable in a test runner.
 *
 * The tests are in the order the argument runs:
 *
 *   1. the tier rule itself — total, coarsest-first, saturating
 *   2. §3.5(a)'s published table, RECOMPUTED rather than quoted
 *   3. the "sub-pixel" claim, refuted by that computation
 *   4. the dead-tier defect at `renderDistance = 4`, pinned as arithmetic
 *   5. the ratio rule, shown to fix (4) without touching (3)
 *   6. forward and inverse are actually inverses
 *   7. the mirror agrees with mc-meshing, and with `world-renderer.ts`
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  LOD1_DISTANCE_CHUNKS,
  LOD2_DISTANCE_CHUNKS,
  REFERENCE_LOD_THRESHOLDS,
  REFERENCE_VIEWING_CONDITIONS,
  chunkDistance,
  distanceForScreenErrorPixels,
  lodForDistance,
  lodScreenErrorPixels,
  lodThresholdsForRenderDistance,
  lodTierCensus,
  unreachableLodTiers,
  type LodThresholds,
} from '../domain/level-of-detail'
import { CHUNK_SIZE, LOD_LEVELS, STEP_FOR_LOD, type LodLevel } from '../domain/lod-vocabulary'
import { CAMERA_FOV_DEGREES } from '../application/world-renderer'

const arbitraryLevel: FastCheck.Arbitrary<LodLevel> = FastCheck.constantFrom(...LOD_LEVELS)

/** Distances a chunk can actually be at: non-negative and not absurd. */
const arbitraryDistance = FastCheck.integer({ min: 0, max: 64 })

describe('chunkDistance', () => {
  it.effect('is the Chebyshev norm, so the loaded square and the tier rings agree', () =>
    Effect.sync(() => {
      // The norm is load-bearing, not stylistic: `renderDistance = R` loads a
      // SQUARE of (2R+1)^2 chunks, and Chebyshev is the norm whose balls are
      // that square. A Euclidean norm would put the corners of the loaded region
      // in a coarser tier than same-ring neighbours — four diagonal seams that
      // track the player.
      expect(chunkDistance({ chunkX: 0, chunkZ: 0 }, { chunkX: 3, chunkZ: 3 })).toBe(3)
      expect(chunkDistance({ chunkX: 0, chunkZ: 0 }, { chunkX: 3, chunkZ: 0 })).toBe(3)
      // Euclidean would give 4.24 for the diagonal above, and any threshold
      // between 3 and 4.24 would separate the two cases this line joins.
      expect(chunkDistance({ chunkX: 0, chunkZ: 0 }, { chunkX: -3, chunkZ: 2 })).toBe(3)
    }),
  )

  it.effect('is symmetric and zero only on the diagonal', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: -64, max: 64 }),
          FastCheck.integer({ min: -64, max: 64 }),
          FastCheck.integer({ min: -64, max: 64 }),
          FastCheck.integer({ min: -64, max: 64 }),
          (ax, az, bx, bz) => {
            const left = { chunkX: ax, chunkZ: az }
            const right = { chunkX: bx, chunkZ: bz }
            expect(chunkDistance(left, right)).toBe(chunkDistance(right, left))
            expect(chunkDistance(left, right) === 0).toBe(ax === bx && az === bz)
          },
        ),
        { seed: 0, numRuns: 300 },
      )
    }),
  )
})

describe('lodForDistance', () => {
  it.effect('places the reference bands where the reference places them', () =>
    Effect.sync(() => {
      const at = (distance: number) => lodForDistance(distance, REFERENCE_LOD_THRESHOLDS)
      expect([at(0), at(3)]).toStrictEqual([0, 0])
      // The boundaries are INCLUSIVE at the near end: `d >= LOD1` is the
      // reference's comparison, so 4 is the first LOD 1 chunk, not the last
      // LOD 0 one.
      expect([at(4), at(7)]).toStrictEqual([1, 1])
      expect([at(8), at(999)]).toStrictEqual([2, 2])
    }),
  )

  it.effect('REGRESSION: is total — no distance, however strange, throws or returns undefined', () =>
    Effect.sync(() => {
      // The rule this repository already follows in `aoShade` and
      // `mouseButtonForIndex`: a renderer that throws on an odd number takes the
      // whole frame down for a bookkeeping error.
      for (const distance of [-1, -0, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 1e308]) {
        expect(LOD_LEVELS).toContain(lodForDistance(distance, REFERENCE_LOD_THRESHOLDS))
      }
    }),
  )

  it.effect('sends NaN to the FINEST tier, which is the safe direction', () =>
    Effect.sync(() => {
      // NaN fails both `>=` comparisons and falls through. That is not an
      // accident of operator semantics being tolerated — it is the direction
      // worth having: an uninterpretable distance draws the chunk properly and
      // costs frame time, rather than drawing it coarsely and looking broken.
      expect(lodForDistance(Number.NaN, REFERENCE_LOD_THRESHOLDS)).toBe(0)
    }),
  )

  it.effect('resolves crossed thresholds to the COARSER tier', () =>
    Effect.sync(() => {
      // `lodThresholdsForRenderDistance` cannot produce this, but a hand-written
      // pair can, and the comparison order decides the answer. Coarsest-first
      // means a chunk beyond both boundaries gets LOD 2; testing `lod1` first
      // would return LOD 1 for a distant chunk — the direction that costs frame
      // time instead of fidelity.
      const crossed: LodThresholds = { lod1: 8, lod2: 4 }
      expect(lodForDistance(10, crossed)).toBe(2)
      expect(lodForDistance(4, crossed)).toBe(2)
      expect(lodForDistance(3, crossed)).toBe(0)
    }),
  )

  it.effect('is monotone in distance for any sane threshold pair', () =>
    Effect.sync(() => {
      // A tier that got FINER as a chunk receded would be invisible in any
      // single-distance assertion above, and would show up in play as terrain
      // sharpening as you walk away from it.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 1, max: 32 }),
          arbitraryDistance,
          arbitraryDistance,
          (renderDistance, left, right) => {
            const thresholds = lodThresholdsForRenderDistance(renderDistance)
            const [near, far] = left <= right ? [left, right] : [right, left]
            expect(lodForDistance(near, thresholds)).toBeLessThanOrEqual(
              lodForDistance(far, thresholds),
            )
          },
        ),
        { seed: 0, numRuns: 300 },
      )
    }),
  )
})

describe('the apparent error, which is the measurement the reference asserted without taking', () => {
  // mc-meshing docs/responsibility.md §3.5(a) publishes a four-cell table at
  // 1080p / FOV 75. EVERY CELL IS RECOMPUTED HERE. A table that could only be
  // quoted is how a wrong measurement survives review, and this repository's
  // retrospective lists eight constants whose evidence did not survive checking.

  it.effect('REGRESSION: reproduces §3.5(a)`s published error at each tier`s own threshold', () =>
    Effect.sync(() => {
      const lod1 = lodScreenErrorPixels(1, LOD1_DISTANCE_CHUNKS, REFERENCE_VIEWING_CONDITIONS)
      const lod2 = lodScreenErrorPixels(2, LOD2_DISTANCE_CHUNKS, REFERENCE_VIEWING_CONDITIONS)

      // "about 11 px" and "about 16 px" — the two cells of the published table.
      expect(lod1).toBeCloseTo(11.0, 1)
      expect(lod2).toBeCloseTo(16.5, 1)
    }),
  )

  it.effect('REGRESSION: reproduces §3.5(a)`s "drops below one pixel" column', () =>
    Effect.sync(() => {
      // "about 44 chunks" and "about 132 chunks". The upper bound on any
      // threshold a perception measurement could return.
      expect(distanceForScreenErrorPixels(1, 1, REFERENCE_VIEWING_CONDITIONS)).toBeCloseTo(44.0, 0)
      expect(distanceForScreenErrorPixels(2, 1, REFERENCE_VIEWING_CONDITIONS)).toBeCloseTo(132.0, 0)
    }),
  )

  it.effect('REFUTES the reference`s "sub-pixel at typical FOVs" comment, by an order of magnitude', () =>
    Effect.sync(() => {
      // lod-simplification.ts:23-25 claims the artefact is sub-pixel at and
      // beyond LOD1_DISTANCE_CHUNKS. This is the assertion that says otherwise,
      // and it is the reason `lodScreenErrorPixels` is exported rather than
      // being a comment: the claim is checkable, so it should be checked by
      // something that goes red.
      const claimed = 1
      const actual = lodScreenErrorPixels(1, LOD1_DISTANCE_CHUNKS, REFERENCE_VIEWING_CONDITIONS)
      expect(actual).toBeGreaterThan(claimed * 10)

      // And sub-pixel is not reached anywhere inside the default render
      // distance of 8 — there is no chunk far enough for the claim to be true of.
      const subPixelAt = distanceForScreenErrorPixels(1, claimed, REFERENCE_VIEWING_CONDITIONS)
      expect(subPixelAt).toBeGreaterThan(8)
    }),
  )

  it.effect('is exactly zero at LOD 0, because the step table says so', () =>
    Effect.sync(() => {
      // Not a special case in the code — `STEP_FOR_LOD[0]` is 1 and `step - 1`
      // vanishes. Asserted at several distances so that a future `if (level === 0)`
      // short-circuit would be redundant rather than load-bearing.
      for (const distance of [1, 4, 8, 64]) {
        expect(lodScreenErrorPixels(0, distance, REFERENCE_VIEWING_CONDITIONS)).toBe(0)
      }
      expect(distanceForScreenErrorPixels(0, 1, REFERENCE_VIEWING_CONDITIONS)).toBe(0)
    }),
  )

  it.effect('falls as distance grows and rises with tier coarseness', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 1, max: 256 }),
          FastCheck.integer({ min: 1, max: 256 }),
          (left, right) => {
            const [near, far] = left <= right ? [left, right] : [right, left]
            expect(lodScreenErrorPixels(2, near, REFERENCE_VIEWING_CONDITIONS)).toBeGreaterThanOrEqual(
              lodScreenErrorPixels(2, far, REFERENCE_VIEWING_CONDITIONS),
            )
            // Coarser is never better at the same distance.
            expect(lodScreenErrorPixels(2, near, REFERENCE_VIEWING_CONDITIONS)).toBeGreaterThan(
              lodScreenErrorPixels(1, near, REFERENCE_VIEWING_CONDITIONS),
            )
          },
        ),
        { seed: 0, numRuns: 300 },
      )
    }),
  )

  it.effect('forward and inverse are inverses, at every tier and budget', () =>
    Effect.sync(() => {
      // The two share `pixelsPerBlockAt` precisely so this holds by construction
      // rather than by two formulae being transposed consistently — the mistake
      // `quadCorners` documents for the six face directions. This test is what
      // notices if somebody inlines one of them.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<LodLevel>(1, 2),
          FastCheck.double({ min: 0.25, max: 64, noNaN: true }),
          (level, errorPixels) => {
            const distance = distanceForScreenErrorPixels(level, errorPixels, REFERENCE_VIEWING_CONDITIONS)
            expect(lodScreenErrorPixels(level, distance, REFERENCE_VIEWING_CONDITIONS)).toBeCloseTo(
              errorPixels,
              6,
            )
          },
        ),
        { seed: 0, numRuns: 300 },
      )
    }),
  )

  it.effect('a taller viewport and a narrower FOV each magnify the error', () =>
    Effect.sync(() => {
      // Both follow from the focal length `H / (2 tan(fov/2))`, and both matter
      // for the measurement §3.5(a) asks for: a threshold measured at 1080p is
      // not the threshold at 2160p, and the published table is only the table
      // for its stated conditions.
      const base = lodScreenErrorPixels(1, 4, REFERENCE_VIEWING_CONDITIONS)
      const taller = lodScreenErrorPixels(1, 4, { viewportHeightPixels: 2160, verticalFovDegrees: 75 })
      const narrower = lodScreenErrorPixels(1, 4, { viewportHeightPixels: 1080, verticalFovDegrees: 30 })

      expect(taller).toBeCloseTo(base * 2, 6)
      expect(narrower).toBeGreaterThan(base)
    }),
  )
})

describe('the dead tier at renderDistance = 4', () => {
  it.effect('REGRESSION: pins the defect — the reference thresholds make LOD 2 unreachable', () =>
    Effect.sync(() => {
      // §3.5(b) states this in prose. Prose is the form in which four wrong
      // blockers survived in this project; a category cannot be checked and a
      // number can. THIS TEST PINS THE CURRENT WRONG STATE deliberately, so that
      // the day somebody adopts a threshold rule that fixes it, this line is
      // what tells them they did.
      //
      // `renderDistance = 4` is where the reference's adaptive quality drops
      // when the frame budget is missed, so the strongest tier is switched off
      // in exactly the setting that needs it.
      const census = lodTierCensus(4, REFERENCE_LOD_THRESHOLDS)
      expect(census[2]).toBe(0)
      expect(unreachableLodTiers(4, REFERENCE_LOD_THRESHOLDS)).toStrictEqual([2])
    }),
  )

  it.effect('the census is exact and totals the loaded square', () =>
    Effect.sync(() => {
      // A SAMPLED census would answer "approximately zero" for the dead tier,
      // and approximately zero is the one answer that hides the defect. Exact,
      // and the total is (2R+1)^2 because the rings partition the square.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 0, max: 32 }), (renderDistance) => {
          const census = lodTierCensus(renderDistance, lodThresholdsForRenderDistance(renderDistance))
          // `reduce<number>`: `LOD_LEVELS` is a tuple of `0 | 1 | 2`, so an
          // unannotated reduce infers that union as the accumulator and a sum
          // of 81 is not assignable to it.
          const total = LOD_LEVELS.reduce<number>((sum, level) => sum + census[level], 0)
          expect(total).toBe((2 * renderDistance + 1) ** 2)
        }),
        { seed: 0, numRuns: 100 },
      )
    }),
  )

  it.effect('reproduces §3.5(b)`s ring table at the reference thresholds', () =>
    Effect.sync(() => {
      // The published rows: renderDistance 4 gives 49/81 at LOD 0, 32/81 at
      // LOD 1 and 0/81 at LOD 2; renderDistance 8 gives 49/289, 176/289, 64/289.
      expect(lodTierCensus(4, REFERENCE_LOD_THRESHOLDS)).toStrictEqual({ 0: 49, 1: 32, 2: 0 })
      expect(lodTierCensus(8, REFERENCE_LOD_THRESHOLDS)).toStrictEqual({ 0: 49, 1: 176, 2: 64 })
    }),
  )
})

describe('lodThresholdsForRenderDistance', () => {
  it.effect('REGRESSION: no tier is unreachable at any render distance above 1', () =>
    Effect.sync(() => {
      // §3.5(b)'s remedy, and the ONLY claim being made for the ratio rule:
      // reachability. It is arithmetic. Whether 1/2 and 1 are the right ratios
      // is a perception question §3.5(a) says has not been answered, and this
      // test deliberately does not pretend otherwise.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 2, max: 64 }), (renderDistance) => {
          expect(unreachableLodTiers(renderDistance, lodThresholdsForRenderDistance(renderDistance))).toStrictEqual([])
        }),
        { seed: 0, numRuns: 200 },
      )
    }),
  )

  it.effect('fixes the case the reference thresholds fail', () =>
    Effect.sync(() => {
      const census = lodTierCensus(4, lodThresholdsForRenderDistance(4))
      expect(census[2]).toBeGreaterThan(0)
      // The outermost ring, which is 8R chunks — the coarsest tier lands
      // exactly on the band furthest from the player at every setting.
      expect(census[2]).toBe(32)
      expect(census).toStrictEqual({ 0: 9, 1: 40, 2: 32 })
    }),
  )

  it.effect('never puts the player`s own chunk above LOD 0', () =>
    Effect.sync(() => {
      // The `Math.max(1, ...)` floor. A `lod1` of 0 would simplify the chunk the
      // player is standing in — the one whose geometry is closest and most
      // visible, and where the 11 px of §3.5(a) becomes metres.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 0, max: 64 }), (renderDistance) => {
          expect(lodForDistance(0, lodThresholdsForRenderDistance(renderDistance))).toBe(0)
        }),
        { seed: 0, numRuns: 200 },
      )
    }),
  )

  it.effect('is DEGENERATE at renderDistance <= 1, by decision rather than by accident', () =>
    Effect.sync(() => {
      // Both thresholds land on 1, so the LOD 1 band `[lod1, lod2)` is empty and
      // chunks step 0 -> 2. Correct for a two-ring world — there is no room for
      // a graduated middle — but it IS a discontinuity, and pinning it here is
      // what makes it a decision somebody can revisit rather than a surprise.
      expect(lodThresholdsForRenderDistance(1)).toStrictEqual({ lod1: 1, lod2: 1 })
      expect(lodTierCensus(1, lodThresholdsForRenderDistance(1))).toStrictEqual({ 0: 1, 1: 0, 2: 8 })
      // At renderDistance 0 only the player's chunk is loaded, so LOD 1 and 2
      // are both empty and `unreachableLodTiers` says so rather than hiding it.
      expect(unreachableLodTiers(0, lodThresholdsForRenderDistance(0))).toStrictEqual([1, 2])
    }),
  )

  it.effect('orders the thresholds, so the bands never cross', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 0, max: 256 }), (renderDistance) => {
          const { lod1, lod2 } = lodThresholdsForRenderDistance(renderDistance)
          expect(lod1).toBeLessThanOrEqual(lod2)
          expect(lod1).toBeGreaterThanOrEqual(1)
        }),
        { seed: 0, numRuns: 200 },
      )
    }),
  )
})

describe('the mirrored vocabulary, and the constants it has to agree with', () => {
  it.effect('REGRESSION: the step table matches mc-meshing`s, value for value', () =>
    Effect.sync(() => {
      // `domain/lod-vocabulary.ts` mirrors `mc-meshing/domain/lod.ts:84`.
      // mc-dev-meta's `check:mirrors` compares the two repositories on every
      // run; this is the assertion INSIDE this repository, which is what fails
      // first if somebody edits the mirror to make a local test pass.
      //
      // A stale step here does not produce a compile error or an obviously wrong
      // picture — it makes `lodScreenErrorPixels` report a plausible pixel count
      // that is wrong by the ratio of the two steps.
      expect(STEP_FOR_LOD).toStrictEqual({ 0: 1, 1: 2, 2: 4 })
      expect(CHUNK_SIZE).toBe(16)
    }),
  )

  it.effect('REGRESSION: mirrors the level union WHOLE, not a prefix of it', () =>
    Effect.sync(() => {
      // The `ITEM_TYPES` lesson: mc-sim mirrored 23 of mc-kernel's 97 literals,
      // both suites stayed green because each pinned its own copy, and only
      // `check:repoint` found it. A partial mirror of a closed union is a
      // narrower type, and the narrow direction is the one that type-checks.
      expect([...LOD_LEVELS]).toStrictEqual([0, 1, 2])
      expect(Object.keys(STEP_FOR_LOD).length).toBe(LOD_LEVELS.length)
    }),
  )

  it.effect('REGRESSION: the reference viewing FOV is the FOV the renderer builds', () =>
    Effect.sync(() => {
      // Two hand-written numbers stating the same thing is a defect shape this
      // organisation has six recorded instances of, all of which eventually
      // disagreed. These two cannot be derived from each other — one is a
      // measurement condition and one is a camera parameter — so the guard is
      // this assertion, which goes red the day somebody changes the camera and
      // leaves the published error table describing a different lens.
      expect(REFERENCE_VIEWING_CONDITIONS.verticalFovDegrees).toBe(CAMERA_FOV_DEGREES)
    }),
  )

  it.effect('every level has a step, and every step is usable as a divisor', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(arbitraryLevel, (level) => {
          expect(STEP_FOR_LOD[level]).toBeGreaterThanOrEqual(1)
          expect(Number.isInteger(STEP_FOR_LOD[level])).toBe(true)
        }),
        { seed: 0, numRuns: 50 },
      )
    }),
  )
})
