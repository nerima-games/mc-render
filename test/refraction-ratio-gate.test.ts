import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { QUALITY_PRESETS, type QualityPreset } from '../src/domain/post-processing'
import {
  REFRACTION_MIN_SCREEN_RATIO,
  shouldRunRefractionRatioGate,
} from '../src/domain/water-refraction'

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
        expect(shouldRunRefractionRatioGate(1, threshold - threshold / 100, threshold)).toBe(false)
        expect(shouldRunRefractionRatioGate(1, threshold, threshold)).toBe(true)
        expect(shouldRunRefractionRatioGate(1, threshold + threshold / 100, threshold)).toBe(true)
      }
    }),
  )

  it.effect('skips when there are no visible water meshes before applying the ratio threshold', () =>
    Effect.sync(() => {
      expect(shouldRunRefractionRatioGate(0, 1, 0.05)).toBe(false)
      expect(shouldRunRefractionRatioGate(-1, 1, 0.05)).toBe(false)
    }),
  )

  it.effect('honors custom runtime thresholds', () =>
    Effect.sync(() => {
      expect(shouldRunRefractionRatioGate(1, 0.299, 0.3)).toBe(false)
      expect(shouldRunRefractionRatioGate(1, 0.3, 0.3)).toBe(true)
      expect(shouldRunRefractionRatioGate(1, 1, 1.25)).toBe(true)
      expect(shouldRunRefractionRatioGate(1, 0.99, 1.25)).toBe(false)
    }),
  )
})
