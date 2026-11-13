import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  COLOR_VISION_CORRECTIONS,
  ColorFilterInputSchema,
  ColorCorrectionShaderSourceSchema,
  ColorVisionCoefficientSchema,
  ColorVisionCorrectionSchema,
  UnderwaterColorStrengthSchema,
  decodeColorFilterInput,
  isColorFilterActive,
  makeColorCorrectionPass,
  makeColorCorrectionShader,
  planColorCorrection,
  updateColorCorrectionPass,
  type ColorCorrectionShader,
  type ColorCorrectionUniforms,
  type ColorFilterInput,
} from '../src/domain/color-correction'
import type { Settings } from '@nerima-games/mc-sim'

const INPUTS: ReadonlyArray<ColorFilterInput> = COLOR_VISION_CORRECTIONS.map((colorVisionCorrection) => ({
  colorVisionCorrection,
  underwater: false,
}))

const expectedUnderwaterStrength = (underwater: boolean): number => {
  if (underwater) {
    return 1
  }
  return 0
}

const isColorVisionCorrection = (value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(ColorVisionCorrectionSchema)(value))

describe('color vision correction input', () => {
  it.effect('uses the setting union exported by the pinned mc-sim Settings type', () =>
    Effect.sync(() => {
      const currentSetting: Settings['colorVisionCorrection'] = 'tritanopia'
      expect(COLOR_VISION_CORRECTIONS).toStrictEqual(['off', 'protanopia', 'deuteranopia', 'tritanopia'])
      expect(isColorVisionCorrection(currentSetting)).toBe(true)
      expect(isColorVisionCorrection('achromatopsia')).toBe(false)
    }),
  )

  it.effect('decodes only a complete known input and rejects extra fields', () =>
    Effect.sync(() => {
      for (const input of INPUTS) {
        expect(Result.isSuccess(decodeColorFilterInput(input))).toBe(true)
      }
      expect(Result.isFailure(decodeColorFilterInput({ colorVisionCorrection: 'off' }))).toBe(true)
      expect(Result.isFailure(decodeColorFilterInput({
        colorVisionCorrection: 'off',
        underwater: false,
        unknown: true,
      }))).toBe(true)
      expect(Result.isFailure(decodeColorFilterInput({
        colorVisionCorrection: 'off',
        underwater: 1,
      }))).toBe(true)
    }),
  )

  it.effect('property: arbitrary inputs return a typed failure or a schema-valid decoded input', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.anything(), (input) => {
          const decoded = decodeColorFilterInput(input)
          if (Result.isFailure(decoded)) {
            return true
          }
          return Result.isSuccess(Schema.decodeUnknownResult(ColorFilterInputSchema, {
            onExcessProperty: 'error',
          })(decoded.success))
        }),
        { numRuns: 500 },
      )
    }),
  )

  it.effect('brands finite transform coefficients and bounds underwater blend strength', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(FastCheck.double(), (candidate) => {
        const decoded = Schema.decodeUnknownResult(ColorVisionCoefficientSchema)(candidate)
        return Result.isFailure(decoded) || Number.isFinite(decoded.success)
      }))
      FastCheck.assert(FastCheck.property(FastCheck.double(), (candidate) => {
        const decoded = Schema.decodeUnknownResult(UnderwaterColorStrengthSchema)(candidate)
        return Result.isFailure(decoded) || (decoded.success >= 0 && decoded.success <= 1)
      }))
      FastCheck.assert(FastCheck.property(FastCheck.string(), (candidate) => {
        const decoded = Schema.decodeUnknownResult(ColorCorrectionShaderSourceSchema)(candidate)
        return Result.isFailure(decoded) || decoded.success.length > 0
      }))

      for (const coefficient of [-1.25, 0, 1.5]) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(ColorVisionCoefficientSchema)(coefficient))).toBe(true)
      }
      expect(Result.isFailure(Schema.decodeUnknownResult(ColorVisionCoefficientSchema)(Number.NaN))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(ColorVisionCoefficientSchema)(Number.POSITIVE_INFINITY))).toBe(true)

      expect(Result.isSuccess(Schema.decodeUnknownResult(UnderwaterColorStrengthSchema)(0))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(UnderwaterColorStrengthSchema)(1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(UnderwaterColorStrengthSchema)(-Number.MIN_VALUE))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(UnderwaterColorStrengthSchema)(1 + Number.EPSILON))).toBe(true)

      expect(Result.isSuccess(Schema.decodeUnknownResult(ColorCorrectionShaderSourceSchema)('void main() {}'))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(ColorCorrectionShaderSourceSchema)(''))).toBe(true)
    }),
  )

  it.effect('boundary: the four setting literals pass and neighboring or absent values fail', () =>
    Effect.sync(() => {
      expect(COLOR_VISION_CORRECTIONS.map(isColorVisionCorrection)).toStrictEqual([
        true,
        true,
        true,
        true,
      ])
      expect(isColorVisionCorrection('off ')).toBe(false)
      expect(isColorVisionCorrection('protanomaly')).toBe(false)
      expect(Result.isFailure(decodeColorFilterInput(undefined))).toBe(true)
    }),
  )
})

describe('color correction plan and shader pass', () => {
  it.effect('uses the documented dichromacy matrices and an identity for off', () =>
    Effect.sync(() => {
      expect(planColorCorrection({ colorVisionCorrection: 'off', underwater: false }).matrix).toStrictEqual([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ])
      expect(planColorCorrection({ colorVisionCorrection: 'protanopia', underwater: false }).matrix).toStrictEqual([
        0.152286, 1.052583, -0.204868,
        0.114503, 0.786281, 0.099216,
        -0.003882, -0.048116, 1.051998,
      ])
      expect(planColorCorrection({ colorVisionCorrection: 'deuteranopia', underwater: false }).matrix[0]).toBe(0.367322)
      expect(planColorCorrection({ colorVisionCorrection: 'tritanopia', underwater: false }).matrix[0]).toBe(1.255528)
    }),
  )

  it.effect('gates screen tint on underwater state and leaves the settings value dynamic', () =>
    Effect.sync(() => {
      const descriptor = makeColorCorrectionShader({ colorVisionCorrection: 'off', underwater: false })
      const pass = { uniforms: descriptor.uniforms } satisfies { readonly uniforms: ColorCorrectionUniforms }

      updateColorCorrectionPass(pass, { colorVisionCorrection: 'protanopia', underwater: true })
      expect(pass.uniforms.uColorVisionRow0.value).toStrictEqual([0.152286, 1.052583, -0.204868])
      expect(pass.uniforms.uUnderwaterStrength.value).toBe(1)
      expect(isColorFilterActive({ colorVisionCorrection: 'off', underwater: false })).toBe(false)
      expect(isColorFilterActive({ colorVisionCorrection: 'off', underwater: true })).toBe(true)
      expect(isColorFilterActive({ colorVisionCorrection: 'deuteranopia', underwater: false })).toBe(true)
    }),
  )

  it.effect('constructs a ShaderPass-compatible descriptor from the current input', () =>
    Effect.sync(() => {
      class FakeShaderPass {
        readonly shader: ColorCorrectionShader

        constructor(shader: ColorCorrectionShader) {
          this.shader = shader
        }
      }

      const pass = makeColorCorrectionPass(FakeShaderPass, {
        colorVisionCorrection: 'tritanopia',
        underwater: true,
      })
      expect(pass.shader.vertexShader).toContain('gl_Position')
      expect(pass.shader.fragmentShader).toContain('uUnderwaterStrength')
      expect(pass.shader.uniforms.uColorVisionRow0.value).toStrictEqual([1.255528, -0.076749, -0.178779])
      expect(pass.shader.uniforms.uUnderwaterStrength.value).toBe(1)
    }),
  )

  it.effect('property: every setting input produces finite shader rows and a valid underwater toggle', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...COLOR_VISION_CORRECTIONS),
          FastCheck.boolean(),
          (colorVisionCorrection, underwater) => {
            const shader = makeColorCorrectionShader({ colorVisionCorrection, underwater })
            const rows = [
              shader.uniforms.uColorVisionRow0.value,
              shader.uniforms.uColorVisionRow1.value,
              shader.uniforms.uColorVisionRow2.value,
            ]
            return rows.every((row) => row.length === 3 && row.every(Number.isFinite)) &&
              shader.uniforms.uUnderwaterStrength.value === expectedUnderwaterStrength(underwater)
          },
        ),
        { numRuns: 100 },
      )
    }),
  )
})
