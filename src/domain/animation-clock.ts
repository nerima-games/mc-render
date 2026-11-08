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
const makeAnimationSeconds = Brand.nominal<AnimationSeconds>()

export const AnimationClockInputSchema: Schema.Codec<AnimationClockInput, Readonly<{
  readonly simulationTick: number
  readonly partialTick: number
  readonly timeOfDayTicks: number
}>> = Schema.Struct({
  partialTick: PartialTickSchema,
  simulationTick: SimulationTickSchema,
  timeOfDayTicks: TimeOfDayTicksSchema,
})

const animationClockInputError = (reason: AnimationClockInputError['reason']): AnimationClockInputError => ({
  _tag: 'AnimationClockInputError',
  reason,
})

const decodeClockField = <Value>(
  schema: Schema.Codec<Value, number>,
  input: unknown,
  reason: AnimationClockInputError['reason'],
): Result.Result<Value, AnimationClockInputError> => {
  const decoded = Schema.decodeUnknownResult(schema)(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(animationClockInputError(reason))
  }
  return Result.succeed(decoded.success)
}

const isAnimationClockInputRecord = (
  input: unknown,
): input is Readonly<Record<'simulationTick' | 'partialTick' | 'timeOfDayTicks', unknown>> =>
  typeof input === 'object' &&
  input !== null &&
  'simulationTick' in input &&
  'partialTick' in input &&
  'timeOfDayTicks' in input

const decodeAnimationClockFields = (
  input: Readonly<Record<'simulationTick' | 'partialTick' | 'timeOfDayTicks', unknown>>,
): Result.Result<AnimationClockInput, AnimationClockInputError> => {
  const simulationTick = decodeClockField(SimulationTickSchema, input.simulationTick, 'invalid-simulation-tick')
  if (Result.isFailure(simulationTick)) {
    return Result.fail(simulationTick.failure)
  }
  const partialTick = decodeClockField(PartialTickSchema, input.partialTick, 'invalid-partial-tick')
  if (Result.isFailure(partialTick)) {
    return Result.fail(partialTick.failure)
  }
  const timeOfDayTicks = decodeClockField(TimeOfDayTicksSchema, input.timeOfDayTicks, 'invalid-time-of-day-ticks')
  if (Result.isFailure(timeOfDayTicks)) {
    return Result.fail(timeOfDayTicks.failure)
  }
  return Result.succeed({
    partialTick: partialTick.success,
    simulationTick: simulationTick.success,
    timeOfDayTicks: timeOfDayTicks.success,
  })
}

const decodeAnimationClockInput = (
  input: unknown,
): Result.Result<AnimationClockInput, AnimationClockInputError> => {
  if (!isAnimationClockInputRecord(input)) {
    return Result.fail(animationClockInputError('invalid-clock-input'))
  }
  return decodeAnimationClockFields(input)
}

/** Convert the host's simulation clock to animation seconds. */
export const animationTimeSeconds = (
  input: unknown,
): Result.Result<AnimationSeconds, AnimationClockInputError> => {
  const clock = decodeAnimationClockInput(input)
  if (Result.isFailure(clock)) {
    return Result.fail(clock.failure)
  }
  // Valid ticks and a fractional tick below one keep the conversion finite and non-negative.
  return Result.succeed(makeAnimationSeconds(
    (clock.success.simulationTick + clock.success.partialTick) / TICKS_PER_SECOND,
  ))
}
