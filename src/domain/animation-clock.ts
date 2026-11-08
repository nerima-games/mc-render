import { Brand, Result, Schema } from 'effect'
import { type SimulationTick, SimulationTickSchema } from '@nerima-games/mc-kernel'

export type PartialTick = Brand.Branded<number, 'PartialTick'>
export type TimeOfDayTicks = Brand.Branded<number, 'TimeOfDayTicks'>
export type AnimationSeconds = Brand.Branded<number, 'AnimationSeconds'>

export type AnimationClockInput = Readonly<{
  readonly simulationTick: SimulationTick
  readonly partialTick: PartialTick
  readonly timeOfDayTicks: TimeOfDayTicks
}>

export type AnimationClockInputError = Readonly<{
  readonly _tag: 'AnimationClockInputError'
  readonly reason:
    | 'invalid-clock-input'
    | 'invalid-simulation-tick'
    | 'invalid-partial-tick'
    | 'invalid-time-of-day-ticks'
}>

const ZERO = 0
const ONE = 1
const TICKS_PER_SECOND = 20
const TICKS_PER_DAY = 24_000

export const AnimationClockInputErrorSchema: Schema.Codec<AnimationClockInputError> = Schema.Struct({
  _tag: Schema.Literal('AnimationClockInputError'),
  reason: Schema.Literals([
    'invalid-clock-input',
    'invalid-simulation-tick',
    'invalid-partial-tick',
    'invalid-time-of-day-ticks',
  ]),
})

export const PartialTickSchema: Schema.Codec<PartialTick, number> = Schema.Finite
  .check(Schema.makeFilter<number>((value) =>
    value >= ZERO && value < ONE || 'Partial tick must be in [0, 1)'
  ))
  .pipe(Schema.brand('PartialTick'))

export const TimeOfDayTicksSchema: Schema.Codec<TimeOfDayTicks, number> = Schema.Int
  .check(Schema.isBetween({ maximum: TICKS_PER_DAY - ONE, minimum: ZERO }))
  .pipe(Schema.brand('TimeOfDayTicks'))

export const AnimationSecondsSchema: Schema.Codec<AnimationSeconds, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(ZERO))
  .pipe(Schema.brand('AnimationSeconds'))

const AnimationSimulationTickSchema: Schema.Codec<SimulationTick, number> = SimulationTickSchema
  .check(Schema.makeFilter<SimulationTick>((value) =>
    Number.isSafeInteger(value) || 'Simulation tick must be a safe integer'
  ))

export const AnimationClockInputSchema: Schema.Codec<AnimationClockInput, Readonly<{
  readonly simulationTick: number
  readonly partialTick: number
  readonly timeOfDayTicks: number
}>> = Schema.Struct({
  partialTick: PartialTickSchema,
  simulationTick: AnimationSimulationTickSchema,
  timeOfDayTicks: TimeOfDayTicksSchema,
})

const animationClockInputError = (reason: AnimationClockInputError['reason']): AnimationClockInputError => ({
  _tag: 'AnimationClockInputError',
  reason,
})

const isAnimationClockInputRecord = (
  input: unknown,
): input is Readonly<Record<'simulationTick' | 'partialTick' | 'timeOfDayTicks', unknown>> =>
  typeof input === 'object' &&
  input !== null &&
  'simulationTick' in input &&
  'partialTick' in input &&
  'timeOfDayTicks' in input

const invalidAnimationClockReason = (
  input: Readonly<Record<'simulationTick' | 'partialTick' | 'timeOfDayTicks', unknown>>,
): AnimationClockInputError['reason'] => {
  if (Result.isFailure(Schema.decodeUnknownResult(AnimationSimulationTickSchema)(input.simulationTick))) {
    return 'invalid-simulation-tick'
  }
  if (Result.isFailure(Schema.decodeUnknownResult(PartialTickSchema)(input.partialTick))) {
    return 'invalid-partial-tick'
  }
  if (Result.isFailure(Schema.decodeUnknownResult(TimeOfDayTicksSchema)(input.timeOfDayTicks))) {
    return 'invalid-time-of-day-ticks'
  }
  return 'invalid-clock-input'
}

const convertClockToAnimationSeconds = (
  clock: AnimationClockInput,
): Result.Result<AnimationSeconds, AnimationClockInputError> => {
  const decodedSeconds = Schema.decodeUnknownResult(AnimationSecondsSchema)(
    (clock.simulationTick + clock.partialTick) / TICKS_PER_SECOND,
  )
  if (Result.isFailure(decodedSeconds)) {
    return Result.fail(animationClockInputError('invalid-clock-input'))
  }
  return Result.succeed(decodedSeconds.success)
}

/** Convert the host's simulation clock to animation seconds. */
export const animationTimeSeconds = (
  input: unknown,
): Result.Result<AnimationSeconds, AnimationClockInputError> => {
  if (!isAnimationClockInputRecord(input)) {
    return Result.fail(animationClockInputError('invalid-clock-input'))
  }
  const decodedClock = Schema.decodeUnknownResult(AnimationClockInputSchema)(input)
  if (Result.isFailure(decodedClock)) {
    return Result.fail(animationClockInputError(invalidAnimationClockReason(input)))
  }
  return convertClockToAnimationSeconds(decodedClock.success)
}
