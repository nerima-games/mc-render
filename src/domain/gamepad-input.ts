import { Result, Schema } from 'effect'
import type { InputAction } from './input-bindings.js'

export const GAMEPAD_BUTTONS = [
  'a',
  'b',
  'x',
  'y',
  'leftShoulder',
  'rightShoulder',
  'back',
  'start',
  'leftStick',
  'rightStick',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
] as const

export type GamepadButton = (typeof GAMEPAD_BUTTONS)[number]

export type GamepadButtonState = {
  readonly pressed: boolean
  readonly value: number
}

export type GamepadSnapshot = {
  readonly connected: boolean
  readonly buttons: ReadonlyArray<GamepadButtonState>
  readonly axes: ReadonlyArray<number>
}

export type GamepadAxes = {
  readonly leftX: number
  readonly leftY: number
  readonly rightX: number
  readonly rightY: number
}


export type GamepadAxesInputError = {
  readonly _tag: 'GamepadAxesInputError'
  readonly reason:
    | 'invalid-axes'
    | 'invalid-deadzone'
    | 'invalid-axis-value'
    | 'non-finite-axis'
    | 'axis-out-of-range'
}

type ResultRuntimeShape<Success, Failure> =
  | {
      readonly _tag: 'Success'
      readonly _op: 'Success'
      readonly success: Success
    }
  | {
      readonly _tag: 'Failure'
      readonly _op: 'Failure'
      readonly failure: Failure
    }

export const GamepadAxesInputErrorSchema: Schema.Codec<GamepadAxesInputError> = Schema.Struct({
  _tag: Schema.Literal('GamepadAxesInputError'),
  reason: Schema.Literals([
    'invalid-axes',
    'invalid-deadzone',
    'invalid-axis-value',
    'non-finite-axis',
    'axis-out-of-range',
  ]),
})

export const GamepadAxesSchema: Schema.Codec<GamepadAxes> = Schema.Struct({
  leftX: Schema.Finite,
  leftY: Schema.Finite,
  rightX: Schema.Finite,
  rightY: Schema.Finite,
})

export const GamepadAxesResultSchema: Schema.Codec<
  ResultRuntimeShape<GamepadAxes, GamepadAxesInputError>
> = Schema.Union([
  Schema.Struct({
    _op: Schema.Literal('Success'),
    _tag: Schema.Literal('Success'),
    success: GamepadAxesSchema,
  }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: GamepadAxesInputErrorSchema,
  }),
])

export type GamepadButtonIndexError = {
  readonly _tag: 'GamepadButtonIndexError'
}

export const GamepadButtonIndexErrorSchema: Schema.Codec<GamepadButtonIndexError> = Schema.Struct({
  _tag: Schema.Literal('GamepadButtonIndexError'),
})

export const GamepadButtonForIndexResultSchema: Schema.Codec<
  ResultRuntimeShape<GamepadButton, GamepadButtonIndexError>
> = Schema.Union([
  Schema.Struct({
    _op: Schema.Literal('Success'),
    _tag: Schema.Literal('Success'),
    success: Schema.Literals(GAMEPAD_BUTTONS),
  }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: GamepadButtonIndexErrorSchema,
  }),
])

export type GamepadBindings = Readonly<Record<GamepadButton, InputAction | undefined>>

/* Gamepad button identifiers below ('a', 'b', 'x', 'y', ...) are the Web
   Gamepad API's standard mapping button names and must match `GamepadButton`
   exactly; they are carried as tuple values rather than object keys purely
   so the short ones don't read as short identifiers. */
const NO_DEFAULT_BINDING: InputAction | undefined = undefined

export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  a: 'jump', b: 'sneak', back: 'openInventory', dpadDown: 'moveBackward',
  dpadLeft: 'moveLeft', dpadRight: 'moveRight', dpadUp: 'moveForward',
  leftShoulder: 'hotbarSlot9', leftStick: 'sprint', rightShoulder: 'hotbarSlot1',
  rightStick: NO_DEFAULT_BINDING, start: 'escape', x: 'attack', y: 'use',
}

/** Clamp bounds for a normalized joystick axis value. */
const AXIS_CLAMP_MIN = -1
const AXIS_CLAMP_MAX = 1
/** Axis value reported when a stick is centered or the device omits that axis. */
const NEUTRAL_AXIS_VALUE = 0
const MIN_GAMEPAD_DEADZONE = 0
/** Fraction of full deflection ignored near center to absorb stick drift. */
const DEFAULT_GAMEPAD_DEADZONE = 0.15
/** Index into the raw `Gamepad.axes` array for each analog stick axis. */
const LEFT_STICK_X_AXIS_INDEX = 0
const LEFT_STICK_Y_AXIS_INDEX = 1
const RIGHT_STICK_X_AXIS_INDEX = 2
const RIGHT_STICK_Y_AXIS_INDEX = 3
/** Analog trigger/stick value at or above which it counts as "pressed". */
const GAMEPAD_PRESSED_VALUE_THRESHOLD = 0.5

const axis = (axes: ReadonlyArray<unknown>, index: number): Result.Result<number, GamepadAxesInputError> => {
  if (index >= axes.length) {
    return Result.succeed(NEUTRAL_AXIS_VALUE)
  }
  const value = axes[index]
  if (typeof value !== 'number') {
    return Result.fail({ _tag: 'GamepadAxesInputError', reason: 'invalid-axis-value' })
  }
  if (!Number.isFinite(value)) {
    return Result.fail({ _tag: 'GamepadAxesInputError', reason: 'non-finite-axis' })
  }
  if (value < AXIS_CLAMP_MIN || value > AXIS_CLAMP_MAX) {
    return Result.fail({ _tag: 'GamepadAxesInputError', reason: 'axis-out-of-range' })
  }
  return Result.succeed(value)
}

const applyDeadzone = (value: number, deadzone: number): number => {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) {
    return NEUTRAL_AXIS_VALUE
  }
  return Math.sign(value) * ((magnitude - deadzone) / (AXIS_CLAMP_MAX - deadzone))
}

export const normalizeGamepadAxes = (
  axes: unknown,
  deadzone: unknown = DEFAULT_GAMEPAD_DEADZONE,
): Result.Result<GamepadAxes, GamepadAxesInputError> => {
  if (!Array.isArray(axes)) {
    return Result.fail({ _tag: 'GamepadAxesInputError', reason: 'invalid-axes' })
  }
  if (
    typeof deadzone !== 'number' ||
    !Number.isFinite(deadzone) ||
    deadzone < MIN_GAMEPAD_DEADZONE ||
    deadzone >= AXIS_CLAMP_MAX
  ) {
    return Result.fail({ _tag: 'GamepadAxesInputError', reason: 'invalid-deadzone' })
  }
  const values: ReadonlyArray<unknown> = axes
  const normalized = Result.all({
    leftX: axis(values, LEFT_STICK_X_AXIS_INDEX),
    leftY: axis(values, LEFT_STICK_Y_AXIS_INDEX),
    rightX: axis(values, RIGHT_STICK_X_AXIS_INDEX),
    rightY: axis(values, RIGHT_STICK_Y_AXIS_INDEX),
  })
  if (Result.isFailure(normalized)) {
    return Result.fail(normalized.failure)
  }
  return Result.succeed({
    leftX: applyDeadzone(normalized.success.leftX, deadzone),
    leftY: applyDeadzone(normalized.success.leftY, deadzone),
    rightX: applyDeadzone(normalized.success.rightX, deadzone),
    rightY: applyDeadzone(normalized.success.rightY, deadzone),
  })
}

export const ZERO_GAMEPAD_AXES: GamepadAxes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 }

export const gamepadButtonForIndex = (index: unknown): Result.Result<GamepadButton, GamepadButtonIndexError> => {
  if (typeof index !== 'number' || !Number.isInteger(index)) {
    return Result.fail({ _tag: 'GamepadButtonIndexError' })
  }
  const button = GAMEPAD_BUTTONS[index]
  if (typeof button === 'undefined') {
    return Result.fail({ _tag: 'GamepadButtonIndexError' })
  }
  return Result.succeed(button)
}

export const gamepadButtonIsPressed = (button: GamepadButtonState | undefined): boolean =>
  typeof button !== 'undefined' &&
  (button.pressed || button.value >= GAMEPAD_PRESSED_VALUE_THRESHOLD)
