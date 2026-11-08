import { Result, Schema } from 'effect'

export type AnimationClockInput = Readonly<{
  readonly simulationTick: number
  readonly partialTick: number
  readonly timeOfDayTicks: number
}>

export type AnimationClockInputError = Readonly<{
  readonly _tag: 'AnimationClockInputError'
  readonly reason:
    | 'invalid-clock-input'
    | 'invalid-simulation-tick'
    | 'invalid-partial-tick'
    | 'invalid-time-of-day-ticks'
}>

export const AnimationClockInputErrorSchema: Schema.Codec<AnimationClockInputError> = Schema.Struct({
  _tag: Schema.Literal('AnimationClockInputError'),
  reason: Schema.Literals([
    'invalid-clock-input',
    'invalid-simulation-tick',
    'invalid-partial-tick',
    'invalid-time-of-day-ticks',
  ]),
})

const TICKS_PER_SECOND = 20
const TICKS_PER_DAY = 24_000
const MINIMUM_SIMULATION_TICK = 0
const MINIMUM_PARTIAL_TICK = 0
const PARTIAL_TICK_UPPER_BOUND = 1
const MINIMUM_TIME_OF_DAY_TICKS = 0

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

/** Convert the host's simulation clock to animation seconds. */
export const animationTimeSeconds = (
  input: unknown,
): Result.Result<number, AnimationClockInputError> => {
  if (!isAnimationClockInputRecord(input)) {
    return Result.fail(animationClockInputError('invalid-clock-input'))
  }
  const { partialTick, simulationTick, timeOfDayTicks } = input
  if (
    typeof simulationTick !== 'number' ||
    !Number.isSafeInteger(simulationTick) ||
    simulationTick < MINIMUM_SIMULATION_TICK
  ) {
    return Result.fail(animationClockInputError('invalid-simulation-tick'))
  }
  if (
    typeof partialTick !== 'number' ||
    !Number.isFinite(partialTick) ||
    partialTick < MINIMUM_PARTIAL_TICK ||
    partialTick >= PARTIAL_TICK_UPPER_BOUND
  ) {
    return Result.fail(animationClockInputError('invalid-partial-tick'))
  }
  if (
    typeof timeOfDayTicks !== 'number' ||
    !Number.isSafeInteger(timeOfDayTicks) ||
    timeOfDayTicks < MINIMUM_TIME_OF_DAY_TICKS ||
    timeOfDayTicks >= TICKS_PER_DAY
  ) {
    return Result.fail(animationClockInputError('invalid-time-of-day-ticks'))
  }
  return Result.succeed((simulationTick + partialTick) / TICKS_PER_SECOND)
}
