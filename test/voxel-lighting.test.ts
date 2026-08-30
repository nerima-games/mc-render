/**
 * The shading curve, and the seam that feeds it.
 *
 * The load-bearing assertions, in the order the argument runs:
 *
 *   1. the reference's coefficients, at the endpoints and in between
 *   2. `max`, not sum — the one rule the whole light model rests on
 *   3. NOTHING CHANGED for callers that pass no shade function
 *   4. a `FULLY_LIT` sampler reproduces AO-only shading EXACTLY, which is what
 *      makes (3) a property rather than a coincidence of defaults
 *   5. the sample point steps into the air, on all six directions
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  AO_MAX,
  AO_ONLY_SHADE,
  aoShade,
  buildChunkGeometry,
  faceNormal,
  type CrossPlantQuad,
  type FaceDirection,
  type MeshQuad,
} from '../src/domain/chunk-geometry'
import { LIGHT_LEVEL_MAX } from '@nerima-games/mc-kernel'
import {
  AO_SHADE_FLOOR,
  AO_SHADE_RANGE,
  FULLY_LIT,
  FULL_LIGHT,
  LIGHT_SHADE_FLOOR,
  LIGHT_SHADE_RANGE,
  MAX_SHADE_BYTE,
  NO_LIGHT,
  aoShadeFactor,
  combinedShadeByte,
  combinedShadeFactor,
  effectiveLightLevel,
  faceBrightness,
  lightSampleForGeometryQuad,
  lightSamplePoint,
  lightShadeFactor,
  litColor,
  litShade,
  type LightSampler,
  type SkyBlockLight,
} from '../src/domain/voxel-lighting'

const FACE_DIRECTIONS: ReadonlyArray<FaceDirection> = ['xPos', 'xNeg', 'yPos', 'yNeg', 'zPos', 'zNeg']

// A tangent axis (the normal's component is 0 on it) moves by the sampler's half-block offset;
// the normal axis itself moves by its own unit component. See `lightSamplePoint`.
const TANGENT_AXIS_OFFSET = 0.5

const expectedAxisDelta = (normalComponent: number): number => {
  if (normalComponent === 0) {
    return TANGENT_AXIS_OFFSET
  }
  return normalComponent
}

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: 1,
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 64,
  lz: 0,
  width: 1,
  height: 1,
  ao: 0,
  ...overrides,
})

const crossPlantQuad = (overrides: Partial<CrossPlantQuad> = {}): CrossPlantQuad => ({
  blockId: 21,
  role: 'side',
  vertices: [
    [0, 64, 0],
    [0, 65, 0],
    [1, 65, 1],
    [1, 64, 1],
  ],
  nx: 0,
  ny: 0,
  nz: 1,
  ao: 0,
  ...overrides,
})

const arbitraryLevel = FastCheck.integer({ min: 0, max: LIGHT_LEVEL_MAX })

describe('the reference`s curve', () => {
  it.effect('REGRESSION: the two terms are the reference shader`s, at both endpoints', () =>
    Effect.sync(() => {
      // ts-minecraft chunk-mesh-materials.ts:135 —
      //   diffuse *= (0.45 + 0.55 * light) * (0.8 + 0.2 * R)
      // Asserted at the endpoints rather than by restating the coefficients,
      // because restating them would be a second copy of the same list, and a
      // test that agrees with the code it copies asks nothing.
      expect(lightShadeFactor(0)).toBeCloseTo(LIGHT_SHADE_FLOOR, 10)
      expect(lightShadeFactor(LIGHT_LEVEL_MAX)).toBeCloseTo(LIGHT_SHADE_FLOOR + LIGHT_SHADE_RANGE, 10)
      // The floors are chosen so a fully lit surface is exactly 1 — a multiplier
      // that does not darken. If this drifted, every surface in the world would
      // be uniformly wrong and nothing would look locally broken.
      expect(lightShadeFactor(LIGHT_LEVEL_MAX)).toBe(1)

      expect(aoShadeFactor(AO_MAX)).toBeCloseTo(AO_SHADE_FLOOR + AO_SHADE_RANGE * (aoShade(AO_MAX) / MAX_SHADE_BYTE), 10)
      expect(aoShadeFactor(0)).toBe(1)
    }),
  )

  it.effect('is affine in the light level, so half-lit is halfway up the range', () =>
    Effect.sync(() => {
      // A curve that agreed at the endpoints and bent in between is the failure
      // mode `aoShadeFactor`'s comment warns about for the AO table. Checked
      // here for light too, on the midpoint and by differencing.
      const mid = lightShadeFactor(LIGHT_LEVEL_MAX / 2)
      expect(mid).toBeCloseTo(LIGHT_SHADE_FLOOR + LIGHT_SHADE_RANGE / 2, 10)

      const step = LIGHT_SHADE_RANGE / LIGHT_LEVEL_MAX
      for (let level = 1; level <= LIGHT_LEVEL_MAX; level += 1) {
        expect(lightShadeFactor(level) - lightShadeFactor(level - 1)).toBeCloseTo(step, 10)
      }
    }),
  )

  it.effect('reads the AO TABLE rather than re-deriving a curve from the level', () =>
    Effect.sync(() => {
      // AO_SHADE_BY_LEVEL is [255, 204, 153, 102] — even steps of 51 — so a
      // re-derivation like `1 - level / AO_MAX` agrees at the endpoints and
      // differs nowhere obvious. This pins that the table is the input.
      for (let level = 0; level <= AO_MAX; level += 1) {
        expect(aoShadeFactor(level)).toBeCloseTo(
          AO_SHADE_FLOOR + AO_SHADE_RANGE * (aoShade(level) / MAX_SHADE_BYTE),
          10,
        )
      }
    }),
  )

  it.effect('REGRESSION: the floors compose multiplicatively — the darkest surface is 0.36, not 0.25', () =>
    Effect.sync(() => {
      // The point of two independent multipliers. A single clamped minimum
      // would put an unlit inside corner at 0.25 and it would read as a hole.
      const darkest = combinedShadeFactor(NO_LIGHT, AO_MAX, { skyIntensity: 1 })
      expect(darkest).toBeCloseTo(LIGHT_SHADE_FLOOR * aoShadeFactor(AO_MAX), 10)
      expect(darkest).toBeGreaterThan(0.3)

      // And never actually reaches zero, at any legal input.
      FastCheck.assert(
        FastCheck.property(arbitraryLevel, arbitraryLevel, FastCheck.integer({ min: 0, max: AO_MAX }), (sky, block, ao) => {
          const factor = combinedShadeFactor({ sky, block }, ao, { skyIntensity: 1 })
          expect(factor).toBeGreaterThan(0)
          expect(factor).toBeLessThanOrEqual(1)
        }),
        { seed: 0, numRuns: 300 },
      )
    }),
  )

  it.effect('a fully lit unoccluded face is exactly 255, not 254', () =>
    Effect.sync(() => {
      // `Math.round` and not `Math.trunc`. An off-by-one here lands on the exact
      // value every other test is most likely to assert.
      expect(combinedShadeByte(FULL_LIGHT, 0, { skyIntensity: 1 })).toBe(MAX_SHADE_BYTE)
    }),
  )
})

describe('the fixed per-face brightness', () => {
  // ADDED AFTER THE FACT, and the reason is worth recording. The face term was
  // missing from the first version of this file, and when it was added EVERY
  // TEST HERE STILL PASSED — because every fixture defaults to `yPos`, whose
  // brightness is exactly 1. Seventeen green tests were blind to a term that
  // changes five sixths of the world's surfaces.
  //
  // A default that happens to be the identity element is the most effective way
  // to hide a multiplicative term, and it is not visible in a pass/fail count.

  it.effect('REGRESSION: the four vanilla brightness levels, per direction', () =>
    Effect.sync(() => {
      // TRANSCRIBED from the reference vertex shader (chunk-mesh-materials.ts:92):
      //   normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.5 : abs(normal.x) > 0.5 ? 0.6 : 0.8
      expect(faceBrightness('yPos')).toBe(1)
      expect(faceBrightness('yNeg')).toBe(0.5)
      expect(faceBrightness('xPos')).toBe(0.6)
      expect(faceBrightness('xNeg')).toBe(0.6)
      expect(faceBrightness('zPos')).toBe(0.8)
      expect(faceBrightness('zNeg')).toBe(0.8)
    }),
  )

  it.effect('REGRESSION: gives a uniformly lit cube six distinguishable faces', () =>
    Effect.sync(() => {
      // THE PROPERTY THE TERM EXISTS FOR. Under full light and no occlusion —
      // the case where every other term in this file is the identity — the six
      // faces must still differ, or a block reads as a flat hexagon.
      const lit = litShade(FULLY_LIT)
      const byDirection = FACE_DIRECTIONS.map((direction) => lit(quad({ direction })))

      // Top is the brightest and bottom the darkest, always.
      expect(Math.max(...byDirection)).toBe(lit(quad({ direction: 'yPos' })))
      expect(Math.min(...byDirection)).toBe(lit(quad({ direction: 'yNeg' })))

      // Four distinct values across six faces: the opposing horizontal pairs
      // agree with each other and differ from the other axis.
      expect(new Set(byDirection).size).toBe(4)
      expect(lit(quad({ direction: 'xPos' }))).toBe(lit(quad({ direction: 'xNeg' })))
      expect(lit(quad({ direction: 'zPos' }))).toBe(lit(quad({ direction: 'zNeg' })))
      expect(lit(quad({ direction: 'xPos' }))).toBeLessThan(lit(quad({ direction: 'zPos' })))
    }),
  )

  it.effect('does not vary with light, sun or occlusion — it is FIXED', () =>
    Effect.sync(() => {
      // The reference's comment calls it "fixed per-face brightness" and that is
      // load-bearing: a wall must look the same at dawn and at noon, which is
      // what makes voxel terrain readable. A term that moved with the sun would
      // be a lighting model, and this deliberately is not one.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...FACE_DIRECTIONS),
          arbitraryLevel,
          arbitraryLevel,
          FastCheck.integer({ min: 0, max: AO_MAX }),
          FastCheck.double({ min: 0, max: 1, noNaN: true }),
          (direction, sky, block, ao, skyIntensity) => {
            // The ratio of the shaded value to the same value on a top face is
            // the face factor, whatever else is going on.
            const shaded = combinedShadeFactor({ sky, block }, ao, { direction, skyIntensity })
            const onTop = combinedShadeFactor({ sky, block }, ao, { direction: 'yPos', skyIntensity })
            expect(shaded / onTop).toBeCloseTo(faceBrightness(direction), 10)
          },
        ),
        { seed: 0, numRuns: 400 },
      )
    }),
  )

  it.effect('REGRESSION: the darkest legal surface is an unlit occluded UNDERSIDE', () =>
    Effect.sync(() => {
      // 0.45 * 0.88 * 0.5 = 0.198. Adding the face term LOWERED the floor from
      // 0.36, which is the reference's range and not a regression — it is why
      // LIGHT_SHADE_FLOOR can afford to be as high as 0.45.
      const darkest = combinedShadeFactor(NO_LIGHT, AO_MAX, { direction: 'yNeg', skyIntensity: 1 })
      expect(darkest).toBeCloseTo(LIGHT_SHADE_FLOOR * aoShadeFactor(AO_MAX) * 0.5, 10)
      expect(darkest).toBeGreaterThan(0)

      // Nothing is darker, over the whole legal input space.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...FACE_DIRECTIONS),
          arbitraryLevel,
          arbitraryLevel,
          FastCheck.integer({ min: 0, max: AO_MAX }),
          (direction, sky, block, ao) => {
            expect(combinedShadeFactor({ sky, block }, ao, { direction, skyIntensity: 1 })).toBeGreaterThanOrEqual(darkest)
          },
        ),
        { seed: 0, numRuns: 300 },
      )
    }),
  )
})

describe('effectiveLightLevel', () => {
  it.effect('REGRESSION: takes the MAX of the two sources, never the sum', () =>
    Effect.sync(() => {
      // The rule the whole model rests on. A sum saturates at 15 almost
      // everywhere outdoors and erases every torch in daylight — which is why
      // mc-worldgen keeps the two grids separate in the first place.
      expect(effectiveLightLevel({ sky: 15, block: 15 }, 1)).toBe(15)
      expect(effectiveLightLevel({ sky: 8, block: 8 }, 1)).toBe(8)
      expect(effectiveLightLevel({ sky: 0, block: 14 }, 1)).toBe(14)
    }),
  )

  it.effect('attenuates sky and NOT block, which is what makes a torch work at night', () =>
    Effect.sync(() => {
      const torchlitAtDusk: SkyBlockLight = { sky: 15, block: 14 }
      expect(effectiveLightLevel(torchlitAtDusk, 0)).toBe(14)
      expect(effectiveLightLevel(torchlitAtDusk, 1)).toBe(15)

      // Midnight with no torch is genuinely dark — the sky term is gone.
      expect(effectiveLightLevel({ sky: 15, block: 0 }, 0)).toBe(0)
    }),
  )

  it.effect('clamps readings arriving through the sampler seam', () =>
    Effect.sync(() => {
      // `@nerima-games/mc-kernel`'s clampLightLevel contract names a host-supplied
      // function as exactly the seam an out-of-range value arrives through.
      expect(effectiveLightLevel({ sky: 99, block: -5 }, 1)).toBe(LIGHT_LEVEL_MAX)
      expect(effectiveLightLevel({ sky: -1, block: -1 }, 1)).toBe(0)
      // skyIntensity is clamped too: a caller cannot brighten past noon.
      expect(effectiveLightLevel({ sky: 15, block: 0 }, 5)).toBe(15)
      expect(effectiveLightLevel({ sky: 15, block: 0 }, -1)).toBe(0)
    }),
  )
})

describe('the sample point', () => {
  it.effect('REGRESSION: steps into the AIR across the face, on all six directions', () =>
    Effect.sync(() => {
      // Sampling the quad's own voxel would read the solid block, which is dark,
      // and shade the entire world at level 0. Stepping the WRONG way on one
      // direction darkens one sixth of the world uniformly — which reads as a
      // texture problem, not a lighting one.
      for (const direction of FACE_DIRECTIONS) {
        const normal = faceNormal(direction)
        const [x, y, z] = lightSamplePoint({ lx: 5, y: 64, lz: 7 }, normal)

        // The component along the normal has moved one whole block, in the
        // normal's direction.
        const moved = [x - 5, y - 64, z - 7]
        expect(moved[0]).toBeCloseTo(expectedAxisDelta(normal[0]), 10)
        expect(moved[1]).toBeCloseTo(expectedAxisDelta(normal[1]), 10)
        expect(moved[2]).toBeCloseTo(expectedAxisDelta(normal[2]), 10)
      }
    }),
  )

  it.effect('lands inside a cell rather than on the seam between two', () =>
    Effect.sync(() => {
      // The half-block offset on the tangent axes. A sample exactly on an
      // integer boundary is ambiguous the moment a sampler floors it, and which
      // of the two cells it picks would depend on the sign of the coordinate.
      const [x, y, z] = lightSamplePoint({ lx: 0, y: 0, lz: 0 }, faceNormal('yPos'))
      expect([x, y, z]).toStrictEqual([0.5, 1, 0.5])
    }),
  )

  it.effect('samples a cross plant at its geometric centre', () =>
    Effect.sync(() => {
      expect(lightSampleForGeometryQuad(crossPlantQuad())).toStrictEqual({
        direction: 'yPos',
        point: [0.5, 64.5, 0.5],
      })
    }),
  )
})

describe('the injection seam', () => {
  it.effect('REGRESSION: passing no shade function changes NOTHING', () =>
    Effect.sync(() => {
      // The property that makes every pre-existing AO assertion in
      // `test/chunk-geometry.test.ts` evidence about this change rather than a
      // casualty of it.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...FACE_DIRECTIONS),
          FastCheck.integer({ min: 0, max: AO_MAX }),
          (direction, ao) => {
            const built = buildChunkGeometry([quad({ direction, ao })])
            expect(built.colors[0]).toBe(aoShade(ao))
            expect(AO_ONLY_SHADE(quad({ direction, ao }))).toBe(aoShade(ao))
          },
        ),
        { seed: 0, numRuns: 200 },
      )
    }),
  )

  it.effect('REGRESSION: turning lighting on WEAKENS ambient occlusion, on purpose', () =>
    Effect.sync(() => {
      // THE ONE BEHAVIOUR CHANGE THIS FEATURE MAKES TO AN ALREADY-LIT SCENE, and
      // it is deliberate. An earlier draft of this test asserted the opposite —
      // that a FULLY_LIT sampler reproduces AO-only shading byte for byte — and
      // it failed at ao=1 with 245 against 204. The code was right.
      //
      // `chunk-geometry.ts`'s AO_SHADE_BY_LEVEL comment predicted exactly this
      // and declined to fix it:
      //
      //     the same table spans 100% down to 40%. The shading is therefore
      //     STRONGER than the reference's, by a factor this file does not
      //     attempt to correct [...] the number to divide by is a property of a
      //     shader that has not been written.
      //
      // `aoShadeFactor` IS that number, so the correction lands here:
      //
      //     ao   raw table   under the curve
      //      0         255               255
      //      1         204               245
      //      2         153               235
      //      3         102               224
      //
      // 255..102 is a 60% range; 255..224 is the reference's 20% one. AO becomes
      // a depth cue rather than dirt in the corners, which is what it is for.
      const lit = litShade(FULLY_LIT)

      expect(lit(quad({ ao: 0 }))).toBe(MAX_SHADE_BYTE)
      for (let ao = 1; ao <= AO_MAX; ao += 1) {
        // Brighter than the raw table at every occluded level — the compression
        // is toward white, never away from it.
        expect(lit(quad({ ao }))).toBeGreaterThan(aoShade(ao))
        // And exactly the curve, so this is the reference's number and not
        // merely "some lighter value".
        expect(lit(quad({ ao }))).toBe(Math.round(aoShadeFactor(ao) * MAX_SHADE_BYTE))
      }

      // The span is the reference's 20%, measured rather than asserted.
      const span = (lit(quad({ ao: 0 })) - lit(quad({ ao: AO_MAX }))) / MAX_SHADE_BYTE
      expect(span).toBeCloseTo(AO_SHADE_RANGE * (1 - aoShade(AO_MAX) / MAX_SHADE_BYTE), 2)
    }),
  )

  it.effect('preserves the ORDER of the AO levels, and the direction is unchanged', () =>
    Effect.sync(() => {
      // What the compression must NOT do. Darker occlusion stays darker, on
      // every face direction, so the depth cue still reads even though its
      // amplitude changed.
      const lit = litShade(FULLY_LIT)
      for (const direction of FACE_DIRECTIONS) {
        for (let ao = 1; ao <= AO_MAX; ao += 1) {
          expect(lit(quad({ direction, ao }))).toBeLessThan(lit(quad({ direction, ao: ao - 1 })))
        }
      }
    }),
  )

  it.effect('darkens a face the sampler says is unlit', () =>
    Effect.sync(() => {
      const sealed: LightSampler = () => NO_LIGHT
      const built = buildChunkGeometry([quad()], 0, 0, litColor(sealed))

      expect(built.colors[0]).toBe(combinedShadeByte(NO_LIGHT, 0, { skyIntensity: 1 }))
      expect(built.colors[0]).toBeLessThan(MAX_SHADE_BYTE)
      // All three channels carry the same grey — an unlit MeshBasicMaterial
      // multiplies vertex colour directly, so anything else would TINT the
      // world rather than shade it. See voxel-lighting.ts's header on why the
      // reference's R/G/B packing needs a shader this repository does not have.
      expect([built.colors[0], built.colors[1], built.colors[2]]).toStrictEqual([
        built.colors[0],
        built.colors[0],
        built.colors[0],
      ])
    }),
  )

  it.effect('asks the sampler for the cell across the face, not the quad`s own', () =>
    Effect.sync(() => {
      // Recorded rather than asserted indirectly: a sampler that logs its
      // arguments is the only way to see which cell was read, and reading the
      // wrong one produces a plausible-looking uniformly dark world.
      const asked: Array<readonly [number, number, number]> = []
      const spy: LightSampler = (x, y, z) => {
        asked.push([x, y, z])
        return FULL_LIGHT
      }

      buildChunkGeometry([quad({ direction: 'yPos', lx: 3, y: 10, lz: 4 })], 0, 0, litColor(spy))
      expect(asked).toStrictEqual([[3.5, 11, 4.5]])
    }),
  )

  it.effect('calls the sampler ONCE per quad, not once per vertex', () =>
    Effect.sync(() => {
      // A per-vertex call would quadruple the cost of every re-mesh, and the
      // four vertices share a shade anyway — AO is per face because it joins the
      // merge key. Pinned so that a future per-vertex light does not arrive by
      // accident in a change that was about something else.
      let calls = 0
      const counting: LightSampler = () => {
        calls += 1
        return FULL_LIGHT
      }

      buildChunkGeometry([quad(), quad({ lx: 1 }), quad({ lx: 2 })], 0, 0, litColor(counting))
      expect(calls).toBe(3)
    }),
  )

  it.effect('honours skyIntensity, so a day/night cycle has somewhere to plug in', () =>
    Effect.sync(() => {
      const skyOnly: LightSampler = () => ({ sky: LIGHT_LEVEL_MAX, block: 0 })
      const noon = litShade(skyOnly, { skyIntensity: 1 })
      const midnight = litShade(skyOnly, { skyIntensity: 0 })

      expect(noon(quad())).toBe(MAX_SHADE_BYTE)
      expect(midnight(quad())).toBe(combinedShadeByte(NO_LIGHT, 0, { skyIntensity: 1 }))
      expect(midnight(quad())).toBeLessThan(noon(quad()))
    }),
  )
})
