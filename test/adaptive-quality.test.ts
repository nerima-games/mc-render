import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ADAPTIVE_QUALITY_POLICY,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
} from '../src/domain/adaptive-quality'
import { stepQualityPreset } from '../src/domain/post-processing'

describe('adaptive quality preset steps', () => {
  it.effect('moves exactly one step and stays within the preset range', () =>
    Effect.sync(() => {
      expect(stepQualityPreset('low', 'lower')).toBe('low')
      expect(stepQualityPreset('medium', 'lower')).toBe('low')
      expect(stepQualityPreset('high', 'higher')).toBe('ultra')
      expect(stepQualityPreset('ultra', 'higher')).toBe('ultra')
    }),
  )
})

describe('frame-rate adaptive quality', () => {
  it.effect('uses the proposed thresholds and cooldown', () =>
    Effect.sync(() => {
      expect(ADAPTIVE_QUALITY_POLICY).toStrictEqual({
        downgradeBelowFps: 50,
        recoveryAtOrAboveFps: 60,
        sustainedFrames: 20,
        cooldownFrames: 20,
      })
    }),
  )

  it.effect('downgrades one step after 20 consecutive frames below 50 FPS', () =>
    Effect.sync(() => {
      let state = createAdaptiveQualityState()
      let preset = 'ultra' as const
      for (let frame = 1; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames; frame += 1) {
        const result = advanceAdaptiveQuality(state, preset, 49.99)
        expect(result.change, `frame ${String(frame)}`).toBe('none')
        expect(result.preset, `frame ${String(frame)}`).toBe('ultra')
        state = result.state
      }

      const result = advanceAdaptiveQuality(state, preset, 49.99)
      expect(result.change).toBe('downgrade')
      expect(result.preset).toBe('high')
      expect(result.state).toStrictEqual({ overBudgetFrames: 0, cooldownFramesRemaining: 20 })
    }),
  )

  it.effect('does not count separated over-budget frames as sustained', () =>
    Effect.sync(() => {
      let state = createAdaptiveQualityState()
      for (let frame = 0; frame < 19; frame += 1) {
        state = advanceAdaptiveQuality(state, 'high', 49).state
      }
      const result = advanceAdaptiveQuality(state, 'high', 50)
      expect(result.change).toBe('none')
      expect(result.preset).toBe('high')
      expect(result.state).toStrictEqual(createAdaptiveQualityState())
    }),
  )

  it.effect('holds changes for 20 frames after a transition, then can downgrade again', () =>
    Effect.sync(() => {
      const first = advanceAdaptiveQuality(createAdaptiveQualityState(), 'medium', 60)
      let state = first.state
      let preset = first.preset
      expect(first.change).toBe('recover')
      expect(preset).toBe('high')
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.cooldownFrames; frame += 1) {
        const cooling = advanceAdaptiveQuality(state, preset, 0)
        expect(cooling.change).toBe('none')
        expect(cooling.preset).toBe('high')
        state = cooling.state
        preset = cooling.preset
      }

      expect(state.cooldownFramesRemaining).toBe(0)
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames - 1; frame += 1) {
        const pending = advanceAdaptiveQuality(state, preset, 49)
        expect(pending.change).toBe('none')
        state = pending.state
      }
      const second = advanceAdaptiveQuality(state, preset, 49)
      expect(second.change).toBe('downgrade')
      expect(second.preset).toBe('medium')
    }),
  )

  it.effect('recovers one step at 60 FPS and starts the same cooldown', () =>
    Effect.sync(() => {
      const result = advanceAdaptiveQuality(
        { overBudgetFrames: 8, cooldownFramesRemaining: 0 },
        'medium',
        60,
      )
      expect(result.change).toBe('recover')
      expect(result.preset).toBe('high')
      expect(result.state).toStrictEqual({ overBudgetFrames: 0, cooldownFramesRemaining: 20 })
    }),
  )

  it.effect('holds the top preset and treats 50 to below 60 FPS as the hysteresis band', () =>
    Effect.sync(() => {
      const atTop = advanceAdaptiveQuality(createAdaptiveQualityState(), 'ultra', 60)
      expect(atTop.change).toBe('none')
      expect(atTop.preset).toBe('ultra')

      const inBand = advanceAdaptiveQuality({ overBudgetFrames: 12, cooldownFramesRemaining: 0 }, 'high', 50)
      expect(inBand.change).toBe('none')
      expect(inBand.state).toStrictEqual(createAdaptiveQualityState())
    }),
  )

  it.effect('does not downgrade below low quality', () =>
    Effect.sync(() => {
      let state = createAdaptiveQualityState()
      for (let frame = 0; frame < ADAPTIVE_QUALITY_POLICY.sustainedFrames; frame += 1) {
        const result = advanceAdaptiveQuality(state, 'low', 49)
        expect(result.change).toBe('none')
        expect(result.preset).toBe('low')
        state = result.state
      }
      expect(state.overBudgetFrames).toBe(ADAPTIVE_QUALITY_POLICY.sustainedFrames)
    }),
  )

  it.effect('resets the over-budget window for invalid frame rates', () =>
    Effect.sync(() => {
      const partial = { overBudgetFrames: 11, cooldownFramesRemaining: 0 }
      for (const fps of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        const result = advanceAdaptiveQuality(partial, 'high', fps)
        expect(result.change).toBe('none')
        expect(result.state).toStrictEqual(createAdaptiveQualityState())
      }
    }),
  )
})
