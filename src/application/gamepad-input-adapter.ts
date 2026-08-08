import { Effect } from 'effect'
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
import type { InputServiceApi } from './input-service'

export type GamepadSource = () => ReadonlyArray<GamepadSnapshot | null>

export type GamepadInputAdapter = {
  readonly poll: Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const firstConnected = (pads: ReadonlyArray<GamepadSnapshot | null>): GamepadSnapshot | undefined =>
  pads.find((pad): pad is GamepadSnapshot => pad !== null && pad.connected)

export const makeGamepadInputAdapter = (
  input: InputServiceApi,
  source: GamepadSource,
  bindings: GamepadBindings = DEFAULT_GAMEPAD_BINDINGS,
): GamepadInputAdapter => {
  const previousButtons: boolean[] = []

  const reset = Effect.gen(function* () {
    for (let index = 0; index < previousButtons.length; index += 1) {
      const button = gamepadButtonForIndex(index)
      const action = button === undefined ? undefined : bindings[button]
      if (previousButtons[index] && action !== undefined) {
        yield* input.dispatch({ action, kind: 'gamepadrelease', target: GAMEPLAY_LISTENER_TARGET })
      }
    }
    previousButtons.length = 0
    yield* input.dispatch({ axes: ZERO_GAMEPAD_AXES, kind: 'gamepadtick' })
  })

  return {
    poll: Effect.gen(function* () {
      const pad = firstConnected(source())
      if (pad === undefined) {
        yield* reset
        return
      }

      yield* input.dispatch({
        kind: 'gamepadtick',
        axes: normalizeGamepadAxes(pad.axes),
      })

      const buttonCount = Math.max(previousButtons.length, pad.buttons.length)
      for (let index = 0; index < buttonCount; index += 1) {
        const button = gamepadButtonForIndex(index)
        const action: InputAction | undefined = button === undefined ? undefined : bindings[button]
        const wasPressed = previousButtons[index] ?? false
        const isPressed = gamepadButtonIsPressed(pad.buttons[index])
        if (action !== undefined && isPressed && !wasPressed) {
          yield* input.dispatch({ kind: 'gamepadpress', action, target: GAMEPLAY_LISTENER_TARGET })
        } else if (action !== undefined && !isPressed && wasPressed) {
          yield* input.dispatch({ kind: 'gamepadrelease', action, target: GAMEPLAY_LISTENER_TARGET })
        }
        previousButtons[index] = isPressed
      }
      previousButtons.length = pad.buttons.length
    }),
    reset,
  }
}
