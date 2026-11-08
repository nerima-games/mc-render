import { Schema } from 'effect'
import { AnimationClockInputSchema, type AnimationClockInput } from '../../src/domain/animation-clock'

export const makeAnimationClockInput = (
  simulationTick: number,
  partialTick: number,
  timeOfDayTicks: number,
): AnimationClockInput => Schema.decodeUnknownSync(AnimationClockInputSchema)({
  partialTick,
  simulationTick,
  timeOfDayTicks,
})
