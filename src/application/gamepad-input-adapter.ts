import { Effect } from 'effect'
import {
  DEFAULT_GAMEPAD_BINDINGS,
  gamepadButtonForIndex,
  gamepadButtonIsPressed,
  normalizeGamepadAxes,
  ZERO_GAMEPAD_AXES,
  type GamepadBindings,
  type GamepadSnapshot,
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
  let previousButtons: ReadonlyArray<boolean> = []

  const reset = Effect.gen(function* () {
    for (let index = 0; index < previousButtons.length; index += 1) {
      const button = gamepadButtonForIndex(index)
      const action = button === undefined ? undefined : bindings[button]
      if (previousButtons[index] && action !== undefined) {
        yield* input.dispatch({ kind: 'gamepadrelease', action, target: GAMEPLAY_LISTENER_TARGET })
      }
    }
    previousButtons = []
    yield* input.dispatch({ kind: 'gamepadtick', axes: ZERO_GAMEPAD_AXES })
  })

  return {
    reset,
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

      const nextButtons = pad.buttons.map(gamepadButtonIsPressed)
      const buttonCount = Math.max(previousButtons.length, nextButtons.length)
      for (let index = 0; index < buttonCount; index += 1) {
        const button = gamepadButtonForIndex(index)
        const action: InputAction | undefined = button === undefined ? undefined : bindings[button]
        if (action === undefined) continue
        const wasPressed = previousButtons[index] ?? false
        const isPressed = nextButtons[index] ?? false
        if (isPressed && !wasPressed) {
          yield* input.dispatch({ kind: 'gamepadpress', action, target: GAMEPLAY_LISTENER_TARGET })
        } else if (!isPressed && wasPressed) {
          yield* input.dispatch({ kind: 'gamepadrelease', action, target: GAMEPLAY_LISTENER_TARGET })
        }
      }
      previousButtons = nextButtons
    }),
  }
}
