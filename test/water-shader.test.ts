/**
 * The water shader source.
 *
 * NONE OF THIS COMPILES GLSL — see `domain/water-shader.ts`'s header, and
 * `test/chunk-shader.test.ts`'s, which says the same thing at length. mc-compose's
 * Playwright run is where the source meets a GL context.
 *
 * What is checked here is the property whose ABSENCE is why this file exists.
 * `WATER_UNIFORM_NAMES` was declared "for an adapter to assert its own set
 * against" and no adapter existed; the only test read the list and compared it
 * to a second hand-written copy of itself. These assertions instead PARSE THE
 * EMITTED SOURCE, so they are answerable questions about a shader rather than
 * restatements of a list.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  glslVec4,
  waterFragmentShader,
  waterShaderSource,
  waterVertexShader,
} from '../src/domain/water-shader'
import {
  RIPPLE_LAYERS_U,
  RIPPLE_LAYERS_V,
  WATER_DEEP_COLOR,
  WATER_DEPTH_FACTOR_FLOOR,
  WATER_DEPTH_FACTOR_RANGE,
  WATER_FRESNEL_F0,
  WATER_SHALLOW_COLOR,
  WATER_SUN_FLOOR,
  WATER_SUN_RANGE,
  WATER_SURFACE_ALPHA,
  WATER_UNIFORM_NAMES,
  rippleOffset,
  waterDepthFactor,
  waterSunAttenuation,
} from '../src/domain/water-surface'

/** Every `uniform <type> <name>;` the fragment source declares. */
const declaredUniforms = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/uniform\s+\w+\s+(?<name>\w+)\s*;/g)].map((match) => match.groups?.['name'] ?? '')

describe('the source declares exactly the uniforms the domain names', () => {
  it.effect('every name in WATER_UNIFORM_NAMES is declared in the fragment source', () =>
    Effect.sync(() => {
      // The direction that catches a MISSING declaration: a host binds a
      // uniform the shader never declared, three drops it silently, and the
      // effect it was supposed to drive simply does not happen.
      const declared = declaredUniforms(waterFragmentShader())

      for (const name of WATER_UNIFORM_NAMES) {
        expect(declared).toContain(name)
      }
    }),
  )

  it.effect('the source declares NO uniform the domain does not name', () =>
    Effect.sync(() => {
      // The other direction, and the one a list-to-list comparison cannot ask
      // at all: an undeclared-in-the-domain uniform is one nobody binds, which
      // reads as 0 in GLSL. A stray `uniform float uOpacity;` would make the
      // water fully transparent and nothing would report it.
      expect([...declaredUniforms(waterFragmentShader())].sort()).toStrictEqual(
        [...WATER_UNIFORM_NAMES].sort(),
      )
    }),
  )

  it.effect('waterShaderSource hands back the domain list itself, not a copy', () =>
    Effect.sync(() => {
      // Identity, not equality. A copy would pass every assertion above on the
      // day it was written and drift afterwards, which is precisely the failure
      // mode this file was written to close.
      expect(waterShaderSource().uniformNames).toBe(WATER_UNIFORM_NAMES)
    }),
  )
})

describe('the constants in the source are the constants the CPU path uses', () => {
  it.effect('every ripple layer appears with its own frequency and speed', () =>
    Effect.sync(() => {
      // Two layers at the SAME frequency sum to one layer — the way to lose
      // half the effect while the code still looks like it does two things.
      // `RippleLayer`'s comment names that hazard; this checks the emitted
      // source actually carries two distinct pairs per axis.
      const source = waterFragmentShader()

      for (const layer of [...RIPPLE_LAYERS_U, ...RIPPLE_LAYERS_V]) {
        expect(source).toContain(layer.spatialFrequency.toFixed(6))
        expect(source).toContain(layer.temporalSpeed.toFixed(6))
      }

      expect(new Set(RIPPLE_LAYERS_U.map((layer) => layer.spatialFrequency)).size).toBe(
        RIPPLE_LAYERS_U.length,
      )
    }),
  )

  it.effect('the shading coefficients are present as generated floats', () =>
    Effect.sync(() => {
      const source = waterFragmentShader()

      for (const value of [
        WATER_FRESNEL_F0,
        WATER_DEPTH_FACTOR_FLOOR,
        WATER_DEPTH_FACTOR_RANGE,
        WATER_SUN_FLOOR,
        WATER_SUN_RANGE,
        WATER_SURFACE_ALPHA,
      ]) {
        expect(source).toContain(value.toFixed(6))
      }
    }),
  )

  it.effect('REGRESSION: the palette is emitted with alpha, not as a vec3', () =>
    Effect.sync(() => {
      // The two palette colours differ in alpha (0.84 vs 0.92) and the mix
      // between them is what WATER_SURFACE_ALPHA then overrides. Dropping alpha
      // here would hide that the palette has an opinion being discarded.
      expect(waterFragmentShader()).toContain(glslVec4(WATER_SHALLOW_COLOR))
      expect(waterFragmentShader()).toContain(glslVec4(WATER_DEEP_COLOR))
      expect(glslVec4(WATER_DEEP_COLOR)).toContain(WATER_DEEP_COLOR.a.toFixed(6))
    }),
  )

  it.effect('REGRESSION: no bare integer literal sits in an arithmetic position', () =>
    Effect.sync(() => {
      // The trap `glslFloat` exists for, restated for this source: `0.45 + 1 * x`
      // does not compile in GLSL when `x` is a float — "no operation '*' exists".
      // Every interpolated number goes through `toFixed(6)`; the literals that
      // remain are the hand-written `0.0`/`1.0`/`0.5` forms, which are floats.
      const arithmetic = [...waterFragmentShader().matchAll(/[*+-]\s*(?<digits>\d+)(?![.\d])/g)]

      expect(arithmetic.map((match) => match[0])).toStrictEqual([])
    }),
  )
})

describe('the emitted wave function agrees with the CPU one', () => {
  it.effect('the source spells the centred reduction, not the shifted one', () =>
    Effect.sync(() => {
      // The distinction that makes the reference's version compute `-sin`:
      // reduce into [0, 2π) then CENTRE into [-π, π), rather than reducing and
      // subtracting π. A shifted version would be a sign error over half the
      // domain and would look like the ripples flowing the wrong way.
      const source = waterFragmentShader()

      expect(source).toContain('wrapped - ')
      expect(source).toMatch(/mod\(x,\s*6\.283185\)/)
    }),
  )

  it.effect('the ripple field stays inside the bound the domain proves', () =>
    Effect.sync(() => {
      // The CPU half of the same claim the shader makes. A distortion that can
      // exceed a few percent of the screen samples the refraction map far from
      // the fragment being shaded, which reads as the water smearing unrelated
      // scenery across itself.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -512, max: 512, noNaN: true }),
          FastCheck.double({ min: -512, max: 512, noNaN: true }),
          FastCheck.double({ min: 0, max: 600, noNaN: true }),
          (x, z, t) => {
            const offset = rippleOffset(x, z, t)
            return Math.abs(offset.u) <= 0.03 && Math.abs(offset.v) <= 0.03
          },
        ),
        { numRuns: 300 },
      )
    }),
  )
})

describe('the vertex stage', () => {
  it.effect('defers the perspective divide to the fragment stage', () =>
    Effect.sync(() => {
      // Interpolating a pre-divided screen UV is affine and shears visibly on
      // water seen at a glancing angle — which is the angle water is usually
      // seen at. The vertex stage passes clip space; the fragment divides.
      expect(waterVertexShader()).toContain('vClipPosition = gl_Position')
      expect(waterVertexShader()).not.toContain('/ gl_Position.w')
      expect(waterFragmentShader()).toContain('vClipPosition.xy / vClipPosition.w')
    }),
  )

  it.effect('the normal is flipped for the underwater view', () =>
    Effect.sync(() => {
      // WATER_MATERIAL_SPEC is DoubleSide, so a player underwater sees the back
      // face. Without the flip the Fresnel term is computed against a normal
      // pointing away and the surface reads as uniformly dark from below.
      expect(waterFragmentShader()).toContain('gl_FrontFacing')
    }),
  )
})

describe('the CPU functions the shader mirrors', () => {
  it.effect('waterDepthFactor and waterSunAttenuation read their named constants', () =>
    Effect.sync(() => {
      // Anchors the refactor that exported these four: if someone re-inlines a
      // literal, the shader keeps interpolating the constant and the two paths
      // part company silently. Checking the endpoints is enough to pin both.
      expect(waterDepthFactor(1)).toBeCloseTo(WATER_DEPTH_FACTOR_FLOOR, 10)
      expect(waterDepthFactor(0)).toBeCloseTo(
        WATER_DEPTH_FACTOR_FLOOR + WATER_DEPTH_FACTOR_RANGE,
        10,
      )
      expect(waterSunAttenuation(0)).toBeCloseTo(WATER_SUN_FLOOR, 10)
      expect(waterSunAttenuation(1)).toBeCloseTo(WATER_SUN_FLOOR + WATER_SUN_RANGE, 10)
    }),
  )
})
