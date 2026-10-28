import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { QUALITY_PRESETS, type QualityPreset } from '../src/domain/post-processing'
import {
  RefractionBooleanResultSchema,
  REFRACTION_MIN_SCREEN_RATIO,
  shouldRunRefractionRatioGate,
} from '../src/domain/water-refraction'

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(JSON.stringify(result.failure))
  }
  return result.success
}

describe('refraction screen-ratio gate', () => {
  it.effect('uses the low/medium and high/ultra preset thresholds', () =>
    Effect.sync(() => {
      expect(REFRACTION_MIN_SCREEN_RATIO).toStrictEqual({
        high: 0.005,
        low: 0.05,
        medium: 0.05,
        ultra: 0.005,
      })

      for (const preset of Object.keys(QUALITY_PRESETS) as ReadonlyArray<QualityPreset>) {
        const threshold = QUALITY_PRESETS[preset].refractionMinScreenRatio
        expect(REFRACTION_MIN_SCREEN_RATIO[preset]).toBe(threshold)
        expect(expectSuccess(shouldRunRefractionRatioGate(1, threshold - threshold / 100, threshold))).toBe(false)
        expect(expectSuccess(shouldRunRefractionRatioGate(1, threshold, threshold))).toBe(true)
        expect(expectSuccess(shouldRunRefractionRatioGate(1, threshold + threshold / 100, threshold))).toBe(true)
      }
    }),
  )

  it.effect('skips when there are no visible water meshes before applying the ratio threshold', () =>
    Effect.sync(() => {
      expect(expectSuccess(shouldRunRefractionRatioGate(0, 1, 0.05))).toBe(false)
      const invalid = shouldRunRefractionRatioGate(-1, 1, 0.05)
      const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
        onExcessProperty: 'error',
      })(invalid)
      expect(Result.isSuccess(inspected)).toBe(true)
      if (Result.isSuccess(inspected)) {
        expect(inspected.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: {
            _tag: 'RefractionInputError',
            operation: 'ratio-gate',
            reason: 'out-of-range',
          },
        })
      }
    }),
  )

  it.effect('honors custom runtime thresholds', () =>
    Effect.sync(() => {
      expect(expectSuccess(shouldRunRefractionRatioGate(1, 0.299, 0.3))).toBe(false)
      expect(expectSuccess(shouldRunRefractionRatioGate(1, 0.3, 0.3))).toBe(true)
      expect(expectSuccess(shouldRunRefractionRatioGate(1, 1.25, 1))).toBe(true)
      expect(expectSuccess(shouldRunRefractionRatioGate(1, 0.99, 1))).toBe(false)
    }),
  )

  it.effect('property: invalid visible counts produce strict typed failures', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ max: -1 }), (visibleMeshCount) => {
          const actual = shouldRunRefractionRatioGate(visibleMeshCount, 0.05, 0.005)
          const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
            onExcessProperty: 'error',
          })(actual)
          expect(Result.isSuccess(inspected)).toBe(true)
          if (Result.isFailure(inspected)) {
            return
          }
          expect(inspected.success).toStrictEqual({
            _tag: 'Failure',
            _op: 'Failure',
            failure: {
              _tag: 'RefractionInputError',
              operation: 'ratio-gate',
              reason: 'out-of-range',
            },
          })
        }),
      )
    }),
  )
})
