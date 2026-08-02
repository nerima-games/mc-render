import type { InputAction } from './input-bindings'

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

export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  a: 'jump',
  b: 'sneak',
  x: 'attack',
  y: 'use',
  leftShoulder: 'hotbarSlot9',
  rightShoulder: 'hotbarSlot1',
  back: 'openInventory',
  start: 'escape',
  leftStick: 'sprint',
  rightStick: undefined,
  dpadUp: 'moveForward',
  dpadDown: 'moveBackward',
  dpadLeft: 'moveLeft',
  dpadRight: 'moveRight',
}

const axis = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value as number)) : 0

const applyDeadzone = (value: number, deadzone: number): number => {
  const magnitude = Math.abs(value)
  if (magnitude <= deadzone) return 0
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone))
}

export const normalizeGamepadAxes = (
  axes: ReadonlyArray<number>,
  deadzone = 0.15,
): GamepadAxes => ({
  leftX: applyDeadzone(axis(axes[0]), deadzone),
  leftY: applyDeadzone(axis(axes[1]), deadzone),
  rightX: applyDeadzone(axis(axes[2]), deadzone),
  rightY: applyDeadzone(axis(axes[3]), deadzone),
})

export const ZERO_GAMEPAD_AXES: GamepadAxes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 }

export const gamepadButtonForIndex = (index: number): GamepadButton | undefined =>
  GAMEPAD_BUTTONS[index]

export const gamepadButtonIsPressed = (button: GamepadButtonState | undefined): boolean =>
  button !== undefined && (button.pressed || button.value >= 0.5)
