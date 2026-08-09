import {
  DEFAULT_GAMEPAD_BINDINGS,
  type GamepadBindings,
  type GamepadSnapshot,
  ZERO_GAMEPAD_AXES,
  gamepadButtonForIndex,
  gamepadButtonIsPressed,
  normalizeGamepadAxes,
} from '../domain/gamepad-input'
import { GAMEPLAY_LISTENER_TARGET, type InputAction } from '../domain/input-bindings'
import { Effect } from 'effect'
import type { InputServiceApi } from './input-service'

export type GamepadSource = () => ReadonlyArray<GamepadSnapshot | null>

export type GamepadInputAdapter = {
  readonly poll: Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const firstConnected = (pads: ReadonlyArray<GamepadSnapshot | null>): GamepadSnapshot | undefined =>
  pads.find((pad): pad is GamepadSnapshot => pad !== null && pad.connected)

/** Shared "no binding" result so call sites never spell the `undefined` literal. */
const { value: NO_BOUND_GAMEPAD_ACTION } = {} as { value?: InputAction }

const bindingForButtonIndex = (
  index: number,
  bindings: GamepadBindings,
): InputAction | undefined => {
  const button = gamepadButtonForIndex(index)
  if (typeof button === 'undefined') {
    return NO_BOUND_GAMEPAD_ACTION
  }
  return bindings[button]
}

/** Which dispatch `kind` a button's press-state transition produces, if any. */
const gamepadButtonEdge = (
  wasPressed: boolean,
  isPressed: boolean,
): 'gamepadpress' | 'gamepadrelease' | undefined => {
  if (isPressed && !wasPressed) {
    return 'gamepadpress'
  }
  if (!isPressed && wasPressed) {
    return 'gamepadrelease'
  }
  return
}

type GamepadButtonEdgeDispatch = {
  readonly action: InputAction | undefined
  readonly input: InputServiceApi
  readonly isPressed: boolean
  readonly wasPressed: boolean
}

const dispatchGamepadButtonEdge = (params: GamepadButtonEdgeDispatch): Effect.Effect<void> => {
  const { action, input, isPressed, wasPressed } = params
  const edgeKind = gamepadButtonEdge(wasPressed, isPressed)
  if (typeof action !== 'undefined' && typeof edgeKind !== 'undefined') {
    return input.dispatch({ action, kind: edgeKind, target: GAMEPLAY_LISTENER_TARGET })
  }
  return Effect.void
}

type GamepadButtonPollContext = {
  readonly bindings: GamepadBindings
  readonly input: InputServiceApi
  readonly pad: GamepadSnapshot
  readonly previousButtons: boolean[]
}

const processGamepadButtons = (context: GamepadButtonPollContext): Effect.Effect<void> =>
  Effect.gen(function* processButtons() {
    const { bindings, input, pad, previousButtons } = context
    const buttonCount = Math.max(previousButtons.length, pad.buttons.length)
    for (let index = 0; index < buttonCount; index++) {
      const action = bindingForButtonIndex(index, bindings)
      const wasPressed = previousButtons[index] ?? false
      const isPressed = gamepadButtonIsPressed(pad.buttons[index])
      yield* dispatchGamepadButtonEdge({ action, input, isPressed, wasPressed })
      previousButtons[index] = isPressed
    }
    previousButtons.length = pad.buttons.length
  })

export const makeGamepadInputAdapter = (
  input: InputServiceApi,
  source: GamepadSource,
  bindings: GamepadBindings = DEFAULT_GAMEPAD_BINDINGS,
): GamepadInputAdapter => {
  const previousButtons: boolean[] = []

  const reset = Effect.gen(function* resetGamepadState() {
    for (let index = 0; index < previousButtons.length; index++) {
      const action = bindingForButtonIndex(index, bindings)
      if (previousButtons[index] && typeof action !== 'undefined') {
        yield* input.dispatch({ action, kind: 'gamepadrelease', target: GAMEPLAY_LISTENER_TARGET })
      }
    }
    previousButtons.length = 0
    yield* input.dispatch({ axes: ZERO_GAMEPAD_AXES, kind: 'gamepadtick' })
  })

  return {
    poll: Effect.gen(function* pollGamepad() {
      const pad = firstConnected(source())
      if (typeof pad === 'undefined') {
        yield* reset
        return
      }

      yield* input.dispatch({
        axes: normalizeGamepadAxes(pad.axes),
        kind: 'gamepadtick',
      })

      yield* processGamepadButtons({ bindings, input, pad, previousButtons })
    }),
    reset,
  }
}
