/**
 * The chunk shader source.
 *
 * A test suite for a string is worth being explicit about. NONE OF THIS
 * COMPILES GLSL — there is no GL context in Node, and docs/testing.md §1 says
 * to name what needs a browser instead of giving it a weaker test that looks
 * like coverage. mc-compose's Playwright smoke tests are where the source is
 * actually compiled, and a shader that fails to compile there takes the canvas
 * with it, so the browser check is real.
 *
 * What CAN be checked here is the thing most likely to be wrong and least
 * likely to be noticed: that the numbers in the shader are the numbers the CPU
 * path shades with. Two renderers that disagree do not throw, do not fail a
 * type check and do not look broken — they look like two builds with different
 * graphics settings, which nobody reports.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  CHUNK_SHADER_ATTRIBUTES,
  CHUNK_SHADER_UNIFORMS,
  chunkFragmentShader,
  chunkShaderSource,
  chunkVertexShader,
  glslFloat,
} from '../src/domain/chunk-shader'
import {
  AO_SHADE_FLOOR,
  AO_SHADE_RANGE,
  FACE_BRIGHTNESS,
  LIGHT_SHADE_FLOOR,
  LIGHT_SHADE_RANGE,
} from '../src/domain/voxel-lighting'
import { ATLAS_COLUMNS, HALF_TEXEL_UV, TILE_UV_SPAN, uvPatchStaysInsideTile } from '../src/domain/texture-atlas'

describe('glslFloat', () => {
  it.effect('REGRESSION: always emits a decimal point, because GLSL `1` is an int', () =>
    Effect.sync(() => {
      // NOT COSMETIC. `0.45 + 0.55 * x` compiles; `1 * x` with a float `x` does
      // not — "no operation '*' exists". FACE_BRIGHTNESS.yPos is exactly 1, so
      // a naive String() would emit `1` and break the shader at compile time in
      // the browser, where no Node test can see it.
      expect(glslFloat(1)).toContain('.')
      expect(glslFloat(0)).toContain('.')
      expect(glslFloat(-2)).toContain('.')

      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: -1000, max: 1000 }), (whole) => {
          expect(glslFloat(whole)).toMatch(/^-?\d+\.\d+$/)
        }),
        { seed: 0, numRuns: 200 },
      )
    }),
  )

  it.effect('keeps enough precision for every constant the shader interpolates', () =>
    Effect.sync(() => {
      // The coarsest constant is 0.05 and the finest is HALF_TEXEL_UV at
      // ~0.00098. Six places is comfortably inside both; this asserts it rather
      // than assuming it.
      for (const value of [
        LIGHT_SHADE_FLOOR, LIGHT_SHADE_RANGE, AO_SHADE_FLOOR, AO_SHADE_RANGE,
        HALF_TEXEL_UV, ATLAS_COLUMNS,
        ...Object.values(FACE_BRIGHTNESS),
      ]) {
        expect(Number(glslFloat(value))).toBeCloseTo(value, 6)
      }
    }),
  )
})

describe('the fragment source carries the CPU path`s coefficients', () => {
  it.effect('REGRESSION: the light and AO terms are the domain constants', () =>
    Effect.sync(() => {
      // THE ASSERTION THIS FILE EXISTS FOR. domain/voxel-lighting.ts's
      // combinedShadeFactor and this shader are two implementations of one
      // formula; the source is generated from the constants so that changing a
      // coefficient changes both paths or fails here.
      const source = chunkFragmentShader()

      expect(source).toContain(glslFloat(LIGHT_SHADE_FLOOR))
      expect(source).toContain(glslFloat(LIGHT_SHADE_RANGE))
      expect(source).toContain(glslFloat(AO_SHADE_FLOOR))
      expect(source).toContain(glslFloat(AO_SHADE_RANGE))
    }),
  )

  it.effect('REGRESSION: decodes the channels in the order packedLightColor writes them', () =>
    Effect.sync(() => {
      // R = AO, G = sky, B = block. Transposing two of these produces a picture
      // that is wrong everywhere and broken nowhere — sky light would darken
      // corners and occlusion would follow the sun.
      const source = chunkFragmentShader()
      expect(source).toMatch(/float\s+ao\s*=\s*vColor\.r/)
      expect(source).toMatch(/float\s+sky\s*=\s*vColor\.g/)
      expect(source).toMatch(/float\s+block\s*=\s*vColor\.b/)
    }),
  )

  it.effect('REGRESSION: combines the two light sources with max, and suns only the sky', () =>
    Effect.sync(() => {
      // The rule the whole light model rests on, and the one the CPU path's
      // effectiveLightLevel is tested for separately. A sum saturates outdoors
      // and erases every torch in daylight.
      const source = chunkFragmentShader()
      expect(source).toMatch(
        new RegExp(`max\\(\\s*sky\\s*\\*\\s*${CHUNK_SHADER_UNIFORMS.sunIntensity}\\s*,\\s*block\\s*\\)`),
      )
    }),
  )

  it.effect('applies the face term as a third multiplier, not an addend', () =>
    Effect.sync(() => {
      expect(chunkFragmentShader()).toContain('* vFaceBrightness')
    }),
  )
})

describe('the atlas resolution', () => {
  it.effect('REGRESSION: uses fract(), which is what lets a MERGED quad be textured', () =>
    Effect.sync(() => {
      // chunk-geometry.ts emits UVs in BLOCK units so a merged 16x1 quad has u
      // running 0..16. Without fract() the sampler walks off the tile and the
      // whole 512x512 atlas tiles sixteen times across one face.
      const source = chunkFragmentShader()
      expect(source).toContain('fract(vUv)')
      expect(source).toContain('mix(lo, hi, inTile)')
    }),
  )

  it.effect('REGRESSION: insets BOTH bounds by half a texel, unlike the reference', () =>
    Effect.sync(() => {
      // domain/texture-atlas.ts's header derives the reference's mistake: it
      // insets the near edge and pairs it with a full-pitch span, so the far
      // edge lands half a texel inside the neighbouring tile. The predicate that
      // tells the two apart already exists, so this test uses it rather than
      // re-deriving the arithmetic.
      expect(uvPatchStaysInsideTile(TILE_UV_SPAN)).toBe(true)
      expect(uvPatchStaysInsideTile(1 / ATLAS_COLUMNS)).toBe(false)

      const source = chunkFragmentShader()
      // `lo` adds the inset and `hi` subtracts it — four occurrences, two per
      // component. A source that insets only `lo` has two.
      expect(source.match(/\+ HALF_TEXEL/g)?.length).toBe(2)
      expect(source.match(/- HALF_TEXEL/g)?.length).toBe(2)
    }),
  )

  it.effect('REGRESSION: flips V, because GL counts up and an image counts down', () =>
    Effect.sync(() => {
      // Getting this backwards is invisible on a symmetric tile and obvious on
      // grass — the worst combination, because it survives whatever you happened
      // to test with.
      const source = chunkFragmentShader()
      expect(source).toContain('1.0 - (row + 1.0) / ATLAS_COLUMNS + HALF_TEXEL')
      expect(source).toContain('1.0 - row / ATLAS_COLUMNS - HALF_TEXEL')
    }),
  )

  it.effect('rounds the interpolated tile index rather than truncating it', () =>
    Effect.sync(() => {
      // Every vertex of a quad carries the same index, so the varying is that
      // index up to float error — which can be either side. floor() alone turns
      // a 3.9999997 into tile 3 and draws a different block's texture.
      expect(chunkFragmentShader()).toContain('floor(vTileIndex + 0.5)')
    }),
  )
})

describe('the vertex source', () => {
  it.effect('REGRESSION: emits all four FACE_BRIGHTNESS values as GLSL floats', () =>
    Effect.sync(() => {
      // The values come from one declaration; only the DISPATCH differs between
      // the two paths (a shader has no enum, only the normal). This checks the
      // values made it across.
      const source = chunkVertexShader()
      for (const value of new Set(Object.values(FACE_BRIGHTNESS))) {
        expect(source).toContain(glslFloat(value))
      }
      // Specifically the one that would have been emitted as a bare `1`.
      expect(source).toContain(glslFloat(FACE_BRIGHTNESS.yPos))
      expect(source).not.toMatch(/\?\s*1\s*$/m)
    }),
  )

  it.effect('compares normals against 0.5, not against exact unit values', () =>
    Effect.sync(() => {
      // The normals survived a Float32Array upload. Exact equality across that
      // boundary works until a driver normalises differently; 0.5 is
      // unambiguous for a set of unit axis vectors.
      const source = chunkVertexShader()
      expect(source).toContain('normal.y > 0.5')
      expect(source).toContain('normal.y < -0.5')
      expect(source).toContain('abs(normal.x) > 0.5')
      expect(source).not.toContain('normal.y == 1.0')
    }),
  )

  it.effect('declares the attribute the geometry has to supply, and passes it through', () =>
    Effect.sync(() => {
      const source = chunkVertexShader()
      expect(source).toContain(`attribute float ${CHUNK_SHADER_ATTRIBUTES.tileIndex}`)
      expect(source).toContain(`vTileIndex = ${CHUNK_SHADER_ATTRIBUTES.tileIndex}`)
    }),
  )
})

describe('the two stages agree with each other', () => {
  it.effect('REGRESSION: every varying the fragment reads, the vertex writes', () =>
    Effect.sync(() => {
      // A varying declared in one stage and not the other is a link error in the
      // browser and nothing at all here. Cheap to check, and it is the failure
      // that costs the most time to diagnose from a blank canvas.
      const vertex = chunkVertexShader()
      const fragment = chunkFragmentShader()

      const declared = (source: string): ReadonlyArray<string> =>
        [...source.matchAll(/varying\s+\w+\s+(?<name>\w+)\s*;/g)].map((match) => match.groups?.['name'] ?? '')

      expect([...declared(fragment)].sort()).toStrictEqual([...declared(vertex)].sort())

      for (const name of declared(fragment)) {
        // Written in the vertex stage, not merely declared there.
        expect(vertex).toMatch(new RegExp(`${name}\\s*=`))
      }
    }),
  )

  it.effect('names every uniform it declares, and declares every uniform it names', () =>
    Effect.sync(() => {
      const { fragmentShader, uniformNames } = chunkShaderSource()
      for (const name of uniformNames) {
        expect(fragmentShader).toContain(name)
      }
      const declared = [...fragmentShader.matchAll(/uniform\s+\w+\s+(?<name>\w+)\s*;/g)].map((m) => m.groups?.['name'] ?? '')
      expect(declared.sort()).toStrictEqual([...uniformNames].sort())
    }),
  )

  it.effect('writes gl_Position and gl_FragColor exactly once each', () =>
    Effect.sync(() => {
      // The two outputs a GLSL 1.0 program must produce. Omitting either is a
      // compile error in the browser and invisible here.
      expect(chunkVertexShader().match(/gl_Position\s*=/g)?.length).toBe(1)
      expect(chunkFragmentShader().match(/gl_FragColor\s*=/g)?.length).toBe(1)
    }),
  )

  it.effect('is deterministic — the same source every call', () =>
    Effect.sync(() => {
      // The source is generated, so it could in principle vary. A material
      // rebuilt with different source would recompile a program per chunk,
      // which is the same class of defect domain/material-policy.ts's
      // forceSinglePass rule exists to prevent.
      expect(chunkVertexShader()).toBe(chunkVertexShader())
      expect(chunkFragmentShader()).toBe(chunkFragmentShader())
    }),
  )
})
