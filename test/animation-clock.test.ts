import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { animationTimeSeconds } from '../src/domain/animation-clock'

describe('animationTimeSeconds', () => {
  it('uses simulation ticks and partial ticks at 20 ticks per second', () => {
    const result = animationTimeSeconds({
      partialTick: 0.25,
      simulationTick: 37,
      timeOfDayTicks: 6000,
    })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toBe((37 + 0.25) / 20)
    }
  })

  it.each([0, 1 - Number.EPSILON])('accepts partial-tick boundary %s', (partialTick) => {
    const result = animationTimeSeconds({ partialTick, simulationTick: 0, timeOfDayTicks: 23_999 })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toBe((0 + partialTick) / 20)
    }
  })

  it('keeps animation time fixed while the simulation clock is paused', () => {
    const first = animationTimeSeconds({ partialTick: 0.5, simulationTick: 12, timeOfDayTicks: 1200 })
    const second = animationTimeSeconds({ partialTick: 0.5, simulationTick: 12, timeOfDayTicks: 1200 })

    expect(Result.isSuccess(first) && Result.isSuccess(second)).toBe(true)
    if (Result.isSuccess(first) && Result.isSuccess(second)) {
      expect(second.success).toBe(first.success)
    }
  })

  it.each([
    { input: { partialTick: 0, simulationTick: -1, timeOfDayTicks: 0 }, reason: 'invalid-simulation-tick' },
    { input: { partialTick: 0, simulationTick: 1.5, timeOfDayTicks: 0 }, reason: 'invalid-simulation-tick' },
    { input: { partialTick: 0, simulationTick: Number.NaN, timeOfDayTicks: 0 }, reason: 'invalid-simulation-tick' },
    { input: { partialTick: Number.NaN, simulationTick: 1, timeOfDayTicks: 0 }, reason: 'invalid-partial-tick' },
    { input: { partialTick: 1, simulationTick: 1, timeOfDayTicks: 0 }, reason: 'invalid-partial-tick' },
    { input: { partialTick: -0.01, simulationTick: 1, timeOfDayTicks: 0 }, reason: 'invalid-partial-tick' },
    { input: { partialTick: 0, simulationTick: 1, timeOfDayTicks: Number.NaN }, reason: 'invalid-time-of-day-ticks' },
    { input: { partialTick: 0, simulationTick: 1, timeOfDayTicks: -1 }, reason: 'invalid-time-of-day-ticks' },
    { input: { partialTick: 0, simulationTick: 1, timeOfDayTicks: 24_000 }, reason: 'invalid-time-of-day-ticks' },
  ])('returns a typed failure for invalid clock input: $reason', ({ input, reason }) => {
    const result = animationTimeSeconds(input)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toStrictEqual({ _tag: 'AnimationClockInputError', reason })
    }
  })

  it('returns a typed failure for a non-object clock input', () => {
    const result = animationTimeSeconds(null)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toStrictEqual({ _tag: 'AnimationClockInputError', reason: 'invalid-clock-input' })
    }
  })
})
