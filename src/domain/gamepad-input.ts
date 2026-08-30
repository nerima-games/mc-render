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

export type GamepadBindings = Readonly<Record<GamepadButton, InputAction | undefined>>

/* Gamepad button identifiers below ('a', 'b', 'x', 'y', ...) are the Web
   Gamepad API's standard mapping button names and must match `GamepadButton`
   exactly; they are carried as tuple values rather than object keys purely
   so the short ones don't read as short identifiers. */
const { unbound: NO_DEFAULT_BINDING } = {} as { unbound?: InputAction }

const DEFAULT_GAMEPAD_BINDING_ENTRIES: ReadonlyArray<
  readonly [GamepadButton, InputAction | undefined]
> = [
  ['a', 'jump'],
  ['b', 'sneak'],
  ['back', 'openInventory'],
  ['dpadDown', 'moveBackward'],
  ['dpadLeft', 'moveLeft'],
  ['dpadRight', 'moveRight'],
  ['dpadUp', 'moveForward'],
  ['leftShoulder', 'hotbarSlot9'],
  ['leftStick', 'sprint'],
  ['rightShoulder', 'hotbarSlot1'],
  ['rightStick', NO_DEFAULT_BINDING],
  ['start', 'escape'],
  ['x', 'attack'],
  ['y', 'use'],
]

export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = Object.fromEntries(
  DEFAULT_GAMEPAD_BINDING_ENTRIES,
) as GamepadBindings

/** Clamp bounds for a normalized joystick axis value. */
const AXIS_CLAMP_MIN = -1
const AXIS_CLAMP_MAX = 1
/** Axis value reported when a stick is centered or its raw reading is non-finite. */
const NEUTRAL_AXIS_VALUE = 0
/** Fraction of full deflection ignored near center to absorb stick drift. */
const DEFAULT_GAMEPAD_DEADZONE = 0.15
/** Index into the raw `Gamepad.axes` array for each analog stick axis. */
const LEFT_STICK_X_AXIS_INDEX = 0
const LEFT_STICK_Y_AXIS_INDEX = 1
const RIGHT_STICK_X_AXIS_INDEX = 2
const RIGHT_STICK_Y_AXIS_INDEX = 3
/** Analog trigger/stick value at or above which it counts as "pressed". */
const GAMEPAD_PRESSED_VALUE_THRESHOLD = 0.5

const axis = (value: number | undefined): number => {
  if (Number.isFinite(value)) {
    return Math.max(AXIS_CLAMP_MIN, Math.min(AXIS_CLAMP_MAX, value as number))
  }
  return NEUTRAL_AXIS_VALUE
}

const applyDeadzone = (value: number, deadzone: number): number => {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) {
    return NEUTRAL_AXIS_VALUE
  }
  return Math.sign(value) * ((magnitude - deadzone) / (AXIS_CLAMP_MAX - deadzone))
}

export const normalizeGamepadAxes = (
  axes: ReadonlyArray<number>,
  deadzone = DEFAULT_GAMEPAD_DEADZONE,
): GamepadAxes => ({
  leftX: applyDeadzone(axis(axes[LEFT_STICK_X_AXIS_INDEX]), deadzone),
  leftY: applyDeadzone(axis(axes[LEFT_STICK_Y_AXIS_INDEX]), deadzone),
  rightX: applyDeadzone(axis(axes[RIGHT_STICK_X_AXIS_INDEX]), deadzone),
  rightY: applyDeadzone(axis(axes[RIGHT_STICK_Y_AXIS_INDEX]), deadzone),
})

export const ZERO_GAMEPAD_AXES: GamepadAxes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 }

export const gamepadButtonForIndex = (index: number): GamepadButton | undefined =>
  GAMEPAD_BUTTONS[index]

export const gamepadButtonIsPressed = (button: GamepadButtonState | undefined): boolean =>
  typeof button !== 'undefined' &&
  (button.pressed || button.value >= GAMEPAD_PRESSED_VALUE_THRESHOLD)
