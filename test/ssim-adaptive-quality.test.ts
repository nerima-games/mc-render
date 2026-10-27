import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  advanceSsimAdaptiveQuality,
  createSsimAdaptiveQualityState,
  SSIM_ADAPTIVE_QUALITY_THRESHOLD,
} from '../src/domain/ssim-adaptive-quality'
import { ADAPTIVE_QUALITY_POLICY } from '../src/domain/adaptive-quality'

describe('SSIM adaptive quality', () => {
  it.effect('uses the 0.95 threshold and the shared 20-frame sustained window', () =>
    Effect.sync(() => {
      expect(SSIM_ADAPTIVE_QUALITY_THRESHOLD).toBe(0.95)
      expect(ADAPTIVE_QUALITY_POLICY.sustainedFrames).toBe(20)
    }),
  )

  it.effect('keeps the preset at 0.95 and above and resets the consecutive window', () =>
    Effect.sync(() => {
      const result = advanceSsimAdaptiveQuality(
        { belowThresholdFrames: 12, hasDowngraded: false },
        'ultra',
        0.95,
      )
      expect(result.change).toBe('none')
      expect(result.preset).toBe('ultra')
      expect(result.state).toStrictEqual({ belowThresholdFrames: 0, hasDowngraded: false })
    }),
  )

  it.effect('downgrades one step after 20 consecutive scores below 0.95', () =>
    Effect.sync(() => {
      let state = createSsimAdaptiveQualityState()
      for (let frame = 1; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames; frame += 1) {
        const result = advanceSsimAdaptiveQuality(state, 'ultra', 0.949)
        expect(result.change, `frame ${String(frame)}`).toBe('none')
        expect(result.preset, `frame ${String(frame)}`).toBe('ultra')
        const { state: nextState } = result
        state = nextState
      }

      const result = advanceSsimAdaptiveQuality(state, 'ultra', 0.949)
      expect(result.change).toBe('downgrade')
      expect(result.preset).toBe('high')
      expect(result.state).toStrictEqual({ belowThresholdFrames: 0, hasDowngraded: true })
    }),
  )

  it.effect('breaks the sustained window when the score is missing', () =>
    Effect.sync(() => {
      const partial = { belowThresholdFrames: 19, hasDowngraded: false }
      const missing = advanceSsimAdaptiveQuality(partial, 'high', Number.NaN)
      expect(missing.change).toBe('none')
      expect(missing.state).toStrictEqual(createSsimAdaptiveQualityState())

      const nonFinite = advanceSsimAdaptiveQuality(partial, 'high', Number.POSITIVE_INFINITY)
      expect(nonFinite.change).toBe('none')
      expect(nonFinite.state).toStrictEqual(createSsimAdaptiveQualityState())
    }),
  )

  it.effect('does not downgrade below low quality', () =>
    Effect.sync(() => {
      let state = createSsimAdaptiveQualityState()
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames; frame += 1) {
        const result = advanceSsimAdaptiveQuality(state, 'low', 0.5)
        expect(result.change).toBe('none')
        expect(result.preset).toBe('low')
        const { state: nextState } = result
        state = nextState
      }
      expect(state).toStrictEqual({ belowThresholdFrames: 20, hasDowngraded: false })
    }),
  )

  it.effect('downgrades only once during the runtime', () =>
    Effect.sync(() => {
      let state = createSsimAdaptiveQualityState()
      let first: ReturnType<typeof advanceSsimAdaptiveQuality> | undefined = undefined
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames; frame += 1) {
        first = advanceSsimAdaptiveQuality(state, 'ultra', 0.8)
        const { state: nextState } = first
        state = nextState
      }
      expect(first?.change).toBe('downgrade')

      const recoveredScore = advanceSsimAdaptiveQuality(state, 'high', 1)
      expect(recoveredScore.change).toBe('none')
      expect(recoveredScore.state.hasDowngraded).toBe(true)

      let repeated = recoveredScore
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames + 1; frame += 1) {
        repeated = advanceSsimAdaptiveQuality(repeated.state, 'high', 0.8)
      }
      expect(repeated.change).toBe('none')
      expect(repeated.preset).toBe('high')
      expect(repeated.state.hasDowngraded).toBe(true)
    }),
  )
})
