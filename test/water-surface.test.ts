/**
 * Tests for the water material.
 *
 * Two groups carry the weight:
 *
 *   - THE `forceSinglePass` GAP. The shared rule in domain/material-policy.ts
 *     returns `review-sharing` for water, and the reference sets the flag
 *     anyway. Both halves are pinned, so a future widening of the shared
 *     predicate fails here and leads the reader to the argument.
 *   - THE SINE APPROXIMATION. Its error bound is MEASURED rather than quoted,
 *     which is how the reference's `~0.056` turns out to be a true statement
 *     about a function one sign away from the one it labels.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { describeMaterialPolicy, requiresForceSinglePass } from '../src/domain/material-policy'
import {
  clampSunIntensity,
  fresnelF0ForIor,
  MAX_RIPPLE_OFFSET_UV,
  mixWaterColor,
  PER_FRAME_WATER_UNIFORMS,
  RIPPLE_AMPLITUDE_UV,
  RIPPLE_LAYERS_U,
  RIPPLE_LAYERS_V,
  rippleOffset,
  schlickFresnel,
  WATER_DEEP_COLOR,
  WATER_FRESNEL_F0,
  WATER_INDEX_OF_REFRACTION,
  WATER_MATERIAL_SPEC,
  WATER_SHALLOW_COLOR,
  WATER_SURFACE_ALPHA,
  WATER_SURFACE_IS_FLAT,
  WATER_UNIFORM_NAMES,
  WATER_WRITES_DEPTH,
  waterDepthFactor,
  waterForceSinglePassVerdict,
  waterSunAttenuation,
  waterTint,
  WAVE_APPROX_MAX_ERROR,
  waveApprox,
  waveApproxCos,
} from '../src/domain/water-surface'

describe('the water uniforms', () => {
  it.effect('are the six the reference declares', () =>
    Effect.sync(() => {
      expect([...WATER_UNIFORM_NAMES].sort()).toStrictEqual([
        'uCameraPosition',
        'uRefractionMap',
        'uRefractionValid',
        'uResolution',
        'uSunIntensity',
        'uTime',
      ])
    }),
  )

  it.effect('and only three of them are written per frame', () =>
    Effect.sync(() => {
      // uResolution is resize-only and uRefractionMap is bound once. Writing
      // either per frame is a uniform upload nobody needs and nothing shows.
      expect([...PER_FRAME_WATER_UNIFORMS].sort()).toStrictEqual([
        'uCameraPosition',
        'uSunIntensity',
        'uTime',
      ])
      for (const name of PER_FRAME_WATER_UNIFORMS) {
        expect(WATER_UNIFORM_NAMES).toContain(name)
      }
    }),
  )
})

describe('the palette', () => {
  it.effect('is the reference values, asserted as literals', () =>
    Effect.sync(() => {
      expect(WATER_SHALLOW_COLOR).toStrictEqual({ r: 0.13, g: 0.38, b: 0.78, a: 0.84 })
      expect(WATER_DEEP_COLOR).toStrictEqual({ r: 0.03, g: 0.12, b: 0.45, a: 0.92 })
      expect(WATER_SURFACE_ALPHA).toBe(0.86)
    }),
  )

  it.effect('deep water is darker and more saturated than shallow, which is the stated intent', () =>
    Effect.sync(() => {
      // water-material.ts:81-82: the water must read clearly darker than the sky
      // or lakes vanish into the horizon haze.
      expect(WATER_DEEP_COLOR.r).toBeLessThan(WATER_SHALLOW_COLOR.r)
      expect(WATER_DEEP_COLOR.g).toBeLessThan(WATER_SHALLOW_COLOR.g)
      expect(WATER_DEEP_COLOR.b).toBeLessThan(WATER_SHALLOW_COLOR.b)
    }),
  )

  it.effect('a LOW fresnel term means looking straight down, which is the DEEP case', () =>
    Effect.sync(() => {
      // Easy to invert while reading. Face-on is deep; glancing is shallow,
      // because at a glancing angle you see reflection rather than depth.
      expect(waterDepthFactor(0)).toBeGreaterThan(waterDepthFactor(1))
      expect(waterDepthFactor(0)).toBeCloseTo(0.95, 10)
      expect(waterDepthFactor(1)).toBeCloseTo(0.55, 10)
    }),
  )

  it.effect('the depth factor is clamped into [0,1] whatever it is handed', () =>
    Effect.sync(() => {
      expect(waterDepthFactor(-10)).toBe(1)
      expect(waterDepthFactor(10)).toBe(0)
    }),
  )

  it.effect('the tint moves toward deep as the view becomes face-on', () =>
    Effect.sync(() => {
      expect(waterTint(0).b).toBeLessThan(waterTint(1).b)
    }),
  )

  it.effect('mixing is clamped at both ends and total on a bad t', () =>
    Effect.sync(() => {
      expect(mixWaterColor(WATER_SHALLOW_COLOR, WATER_DEEP_COLOR, 0)).toStrictEqual(WATER_SHALLOW_COLOR)
      expect(mixWaterColor(WATER_SHALLOW_COLOR, WATER_DEEP_COLOR, 1)).toStrictEqual(WATER_DEEP_COLOR)
      expect(mixWaterColor(WATER_SHALLOW_COLOR, WATER_DEEP_COLOR, 5)).toStrictEqual(WATER_DEEP_COLOR)
      expect(mixWaterColor(WATER_SHALLOW_COLOR, WATER_DEEP_COLOR, Number.NaN)).toStrictEqual(
        WATER_SHALLOW_COLOR,
      )
    }),
  )
})

// ---------------------------------------------------------------------------
// The reference writes only `F0 = 0.02 for water`. Deriving it from the index of
// refraction turns a transcribed constant into a checked one.
// ---------------------------------------------------------------------------
describe('the Fresnel term and the refraction index', () => {
  it.effect("the reference's F0 agrees with the physics it stands for", () =>
    Effect.sync(() => {
      expect(WATER_INDEX_OF_REFRACTION).toBe(1.333)
      expect(WATER_FRESNEL_F0).toBe(0.02)
      // ((1 - 1.333) / (1 + 1.333))^2 = 0.020373...
      expect(fresnelF0ForIor(WATER_INDEX_OF_REFRACTION)).toBeCloseTo(0.020373, 6)
      // Agrees with the transcribed value to a rounding step.
      expect(Math.abs(fresnelF0ForIor(WATER_INDEX_OF_REFRACTION) - WATER_FRESNEL_F0)).toBeLessThan(0.0005)
    }),
  )

  it.effect('and does NOT agree with an index that is not water', () =>
    Effect.sync(() => {
      // The reverse test: without it, `fresnelF0ForIor` returning a constant
      // near 0.02 for everything would pass the assertion above.
      expect(fresnelF0ForIor(1.5)).toBeCloseTo(0.04, 3) // glass
      expect(Math.abs(fresnelF0ForIor(1.5) - WATER_FRESNEL_F0)).toBeGreaterThan(0.0005)
      expect(fresnelF0ForIor(1)).toBe(0) // air into air reflects nothing
    }),
  )

  it.effect('reports no reflectance for a non-physical index of refraction, rather than extrapolating', () =>
    Effect.sync(() => {
      // `ior = 1` above also returns 0, but through the Schlick formula (a
      // REAL zero-reflectance answer for air-into-air). These inputs are not
      // physical at all — a zero or negative index of refraction — and must
      // take the explicit guard rather than fall through to a formula that
      // would happily square a negative ratio into a positive, non-zero
      // number and report a plausible-looking but meaningless reflectance.
      expect(fresnelF0ForIor(0)).toBe(0)
      expect(fresnelF0ForIor(-1)).toBe(0)
      expect(fresnelF0ForIor(Number.NaN)).toBe(0)
    }),
  )

  it.effect('Schlick runs from F0 face-on to total reflection edge-on', () =>
    Effect.sync(() => {
      expect(schlickFresnel(1)).toBeCloseTo(WATER_FRESNEL_F0, 10)
      expect(schlickFresnel(0)).toBeCloseTo(1, 10)
    }),
  )

  it.effect('is monotonic, so grazing angles never reflect LESS than face-on ones', () =>
    Effect.sync(() => {
      let previous = schlickFresnel(0)
      for (let step = 1; step <= 100; step += 1) {
        const current = schlickFresnel(step / 100)
        expect(current).toBeLessThanOrEqual(previous)
        previous = current
      }
    }),
  )

  it.effect('clamps a normal that points away, and a cosine that is not a number', () =>
    Effect.sync(() => {
      expect(schlickFresnel(-3)).toBeCloseTo(1, 10)
      expect(schlickFresnel(Number.NaN)).toBeCloseTo(1, 10)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The bound is measured here rather than quoted from the
// reference, which is what makes it a fact about THIS function.
// ---------------------------------------------------------------------------
describe('the polynomial sine approximation', () => {
  it.effect('stays within WAVE_APPROX_MAX_ERROR of Math.sin across many periods', () =>
    Effect.sync(() => {
      let worst = 0
      // Deliberately spanning several periods in both directions, because the
      // argument reduction is exactly where a transcription of GLSL `mod` goes
      // wrong and a single-period sweep would not see it.
      for (let step = 0; step <= 200_000; step += 1) {
        const x = -20 + (40 * step) / 200_000
        worst = Math.max(worst, Math.abs(waveApprox(x) - Math.sin(x)))
      }
      expect(worst).toBeLessThanOrEqual(WAVE_APPROX_MAX_ERROR)
      // And the bound is TIGHT — a constant of 1 would also pass a `<=` test.
      expect(worst).toBeGreaterThan(0.05)
    }),
  )

  it.effect('REGRESSION: it approximates +sin, NOT -sin', () =>
    Effect.sync(() => {
      // The reference's `fastSin` reduces with `mod(x, 2π) - π`, which evaluates
      // the polynomial at `x - π` and therefore computes `-sin(x)`. Its stated
      // `~0.056` is true against `-sin` and is 2.0 against `sin`. Harmless in a
      // ripple field, wrong in a function called `sin`.
      expect(waveApprox(Math.PI / 2)).toBeGreaterThan(0.9)
      expect(waveApprox(-Math.PI / 2)).toBeLessThan(-0.9)

      let worstAgainstNegated = 0
      for (let step = 0; step <= 20_000; step += 1) {
        const x = -20 + (40 * step) / 20_000
        worstAgainstNegated = Math.max(worstAgainstNegated, Math.abs(waveApprox(x) + Math.sin(x)))
      }
      // Nowhere near sin: this is what the reference's version would score.
      expect(worstAgainstNegated).toBeGreaterThan(1.9)
    }),
  )

  it.effect('handles negative arguments, which a literal JS `%` transcription would not', () =>
    Effect.sync(() => {
      // JavaScript's `%` keeps the dividend's sign, unlike GLSL's `mod`, so a
      // direct transcription evaluates the polynomial outside its domain.
      for (const x of [-0.5, -1, -3, -7, -12.5]) {
        expect(Math.abs(waveApprox(x) - Math.sin(x))).toBeLessThanOrEqual(WAVE_APPROX_MAX_ERROR)
      }
    }),
  )

  it.effect('is periodic and odd, like the function it stands in for', () =>
    Effect.sync(() => {
      for (const x of [0.3, 1.1, 2.9, 5.5]) {
        expect(waveApprox(x + 2 * Math.PI)).toBeCloseTo(waveApprox(x), 4)
        expect(waveApprox(-x)).toBeCloseTo(-waveApprox(x), 6)
      }
    }),
  )

  it.effect('the cosine variant leads the sine by a quarter period', () =>
    Effect.sync(() => {
      expect(waveApproxCos(0)).toBeCloseTo(1, 1)
      expect(Math.abs(waveApproxCos(Math.PI / 2))).toBeLessThan(0.06)
    }),
  )

  it.effect('returns 0 rather than NaN for an argument that is not a number', () =>
    Effect.sync(() => {
      expect(waveApprox(Number.NaN)).toBe(0)
      expect(waveApprox(Number.POSITIVE_INFINITY)).toBe(0)
    }),
  )
})

describe('the ripple field', () => {
  it.effect('is the reference amplitude', () =>
    Effect.sync(() => {
      expect(RIPPLE_AMPLITUDE_UV).toBe(0.014)
    }),
  )

  it.effect('has TWO layers per axis at DIFFERENT frequencies', () =>
    Effect.sync(() => {
      // Two layers at one frequency sum to one layer, which loses half the
      // effect while the code still looks like it does two things.
      for (const layers of [RIPPLE_LAYERS_U, RIPPLE_LAYERS_V]) {
        expect(layers).toHaveLength(2)
        expect(layers[0]?.spatialFrequency).not.toBe(layers[1]?.spatialFrequency)
        expect(layers[0]?.temporalSpeed).not.toBe(layers[1]?.temporalSpeed)
        expect(layers[1]?.amplitudeScale).toBe(0.5)
      }
    }),
  )

  it.effect('and the two AXES run at different speeds, so they do not beat in lockstep', () =>
    Effect.sync(() => {
      // Equal speeds on both axes would make the distortion visibly diagonal.
      expect(RIPPLE_LAYERS_U[0]?.temporalSpeed).not.toBe(RIPPLE_LAYERS_V[0]?.temporalSpeed)
      expect(RIPPLE_LAYERS_U[1]?.temporalSpeed).not.toBe(RIPPLE_LAYERS_V[1]?.temporalSpeed)
    }),
  )

  it.effect('stays bounded, so water never samples unrelated scenery into itself', () =>
    Effect.sync(() => {
      for (let step = 0; step <= 4000; step += 1) {
        const t = step / 40
        const offset = rippleOffset(t * 1.7, t * 0.3, t)
        expect(Math.abs(offset.u)).toBeLessThanOrEqual(MAX_RIPPLE_OFFSET_UV)
        expect(Math.abs(offset.v)).toBeLessThanOrEqual(MAX_RIPPLE_OFFSET_UV)
      }
      // A few percent of the screen at most.
      expect(MAX_RIPPLE_OFFSET_UV).toBeLessThan(0.03)
    }),
  )

  it.effect('actually moves with time, and with position', () =>
    Effect.sync(() => {
      // Without this, a rippleOffset stuck at {0,0} would pass every bound test
      // above.
      expect(rippleOffset(0, 0, 0)).not.toStrictEqual(rippleOffset(0, 0, 1.3))
      expect(rippleOffset(0, 0, 1)).not.toStrictEqual(rippleOffset(5, 5, 1))
    }),
  )

  it.effect('returns no displacement for inputs that are not numbers', () =>
    Effect.sync(() => {
      expect(rippleOffset(Number.NaN, 0, 0)).toStrictEqual({ u: 0, v: 0 })
      expect(rippleOffset(0, 0, Number.POSITIVE_INFINITY)).toStrictEqual({ u: 0, v: 0 })
    }),
  )
})

describe('the sun response', () => {
  it.effect('clamps into [0,1]', () =>
    Effect.sync(() => {
      expect(clampSunIntensity(-1)).toBe(0)
      expect(clampSunIntensity(5)).toBe(1)
      expect(clampSunIntensity(Number.NaN)).toBe(0)
      expect(clampSunIntensity(0.4)).toBe(0.4)
    }),
  )

  it.effect('never dims the surface to black — the floor is 0.30, not 0', () =>
    Effect.sync(() => {
      // Water that goes fully black at night is water the player walks into.
      expect(waterSunAttenuation(0)).toBeCloseTo(0.3, 10)
      expect(waterSunAttenuation(1)).toBeCloseTo(1, 10)
      expect(waterSunAttenuation(-5)).toBeCloseTo(0.3, 10)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING, and the finding this file exists to record. See the header of
// domain/water-surface.ts.
// ---------------------------------------------------------------------------
describe('forceSinglePass on the water material', () => {
  it.effect('the material is transcribed truthfully, alphaTest 0 and all', () =>
    Effect.sync(() => {
      expect(WATER_MATERIAL_SPEC).toStrictEqual({
        name: 'waterSurfaceMaterial',
        transparent: true,
        side: 'double',
        alphaTest: 0,
        shared: true,
      })
      expect(WATER_WRITES_DEPTH).toBe(false)
      expect(WATER_SURFACE_IS_FLAT).toBe(true)
    }),
  )

  it.effect('KNOWN GAP: the shared rule does NOT classify water as needing the flag', () =>
    Effect.sync(() => {
      // material-policy.ts's predicate is `shared && two-pass && cutout`, and
      // water is not a cutout. Its own header names water as one of the four
      // correct applications (:67-68) and its own prose states the criterion as
      // 「a cutout OR A FLAT SURFACE」 (:62-63) — only the cutout half is encoded.
      //
      // THE FAILURE MESSAGES BELOW CARRY THE ARGUMENT, not just the expectation.
      // This test is designed to fail the day someone widens the predicate, and
      // the person it fails for will be reading a CI log rather than this file.
      // A bare `expected true to be false` would send them to delete the test.
      const guidance =
        'If you just taught requiresForceSinglePass about FLAT surfaces, this failure is ' +
        'EXPECTED and this test is what should change — see docs/responsibility.md §2.1 and ' +
        "domain/water-surface.ts's header. Water is shared + transparent + DoubleSide with " +
        'alphaTest 0, so the cutout test says review-sharing, yet the reference correctly sets ' +
        'forceSinglePass (water-material.ts:137) because a greedy-meshed water plane is not a ' +
        'closed volume and the two-pass ordering resolves nothing. Delete this assertion ONLY ' +
        'together with WATER_SURFACE_IS_FLAT and waterForceSinglePassVerdict, which exist ' +
        'solely to cover the gap it records. Do NOT make this pass by giving water a non-zero ' +
        'alphaTest: that would be falsifying the material to satisfy the rule.'

      expect(requiresForceSinglePass(WATER_MATERIAL_SPEC), guidance).toBe(false)
      expect(describeMaterialPolicy(WATER_MATERIAL_SPEC).kind, guidance).toBe('review-sharing')
    }),
  )

  it.effect('and the reference nonetheless sets it, correctly — so this file composes the missing clause', () =>
    Effect.sync(() => {
      const verdict = waterForceSinglePassVerdict()
      expect(verdict.kind).toBe('must-force-single-pass')
      // The diagnostic carries the ARGUMENT, not just the verdict, the way
      // docs/testing.md §5.6 requires of describeMaterialPolicy's.
      expect(verdict.reason).toContain('FLAT')
      expect(verdict.reason).toContain('not a closed volume')
      expect(verdict.reason).toContain('water-material.ts:137')
    }),
  )

  it.effect('and it defers to the shared rule for every case the shared rule DOES cover', () =>
    Effect.sync(() => {
      // The reverse test: the composed verdict must not simply always say
      // "force it". A material that is not shared, or not two-pass, still gets
      // material-policy's own answer.
      const shared = describeMaterialPolicy(WATER_MATERIAL_SPEC)
      expect(shared.kind).not.toBe(waterForceSinglePassVerdict().kind)
      expect(describeMaterialPolicy({ ...WATER_MATERIAL_SPEC, shared: false }).kind).toBe('ok')
      expect(describeMaterialPolicy({ ...WATER_MATERIAL_SPEC, side: 'front' }).kind).toBe('ok')
    }),
  )
})
