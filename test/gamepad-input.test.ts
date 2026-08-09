import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DEFAULT_GAMEPAD_BINDINGS,
  normalizeGamepadAxes,
  type GamepadSnapshot,
} from '../src/domain/gamepad-input'
import {
  makeGamepadInputAdapter,
  type GamepadSource,
} from '../src/application/gamepad-input-adapter'
import {
  GAMEPLAY_LISTENER_TARGET,
  MODAL_LISTENER_TARGET,
} from '../src/domain/input-bindings'
import { makeInputService } from '../src/application/input-service'

const PRESSED_BUTTON_VALUE = 1
const RELEASED_BUTTON_VALUE = 0

const defaultButtonValueFor = (pressed: boolean): number => {
  if (pressed) {
    return PRESSED_BUTTON_VALUE
  }
  return RELEASED_BUTTON_VALUE
}

const pad = (buttons: ReadonlyArray<{ pressed: boolean; value?: number }>, axes: ReadonlyArray<number> = []): GamepadSnapshot => ({
  connected: true,
  buttons: buttons.map((button) => ({ pressed: button.pressed, value: button.value ?? defaultButtonValueFor(button.pressed) })),
  axes,
})

describe('gamepad input', () => {
  it.effect('applies a rescaled deadzone and clamps malformed axes', () =>
    Effect.sync(() => {
      const normalized = normalizeGamepadAxes([0.1, -0.575, 2, Number.NaN])
      expect(normalized.leftX).toBe(0)
      expect(normalized.leftY).toBeCloseTo(-0.5, 10)
      expect(normalized.rightX).toBe(1)
      expect(normalized.rightY).toBe(0)
    }),
  )

  it.effect('maps button edges and analog axes into the input service', () =>
    Effect.gen(function* () {
      let current: ReadonlyArray<GamepadSnapshot | null> = [pad([{ pressed: false }])]
      const source: GamepadSource = () => current
      const input = yield* makeInputService()
      const adapter = makeGamepadInputAdapter(input, source)

      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(false)

      current = [pad([{ pressed: true }], [0.5, 0, -0.5, 0])]
      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(true)
      expect(yield* input.wasActionJustTriggered('jump')).toBe(true)
      expect(yield* input.snapshot).toMatchObject({
        gamepadAxes: { leftX: expect.closeTo(0.4117, 3), rightX: expect.closeTo(-0.4117, 3) },
      })

      yield* input.endFrame()
      yield* adapter.poll
      expect(yield* input.wasActionJustTriggered('jump')).toBe(false)

      current = [pad([{ pressed: false }])]
      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(false)
      expect(yield* input.snapshot).toMatchObject({ gamepadAxes: { leftX: 0, rightX: 0 } })
    }),
  )

  it.effect('releases held actions and axes when the controller disconnects', () =>
    Effect.gen(function* () {
      let current: ReadonlyArray<GamepadSnapshot | null> = [pad([{ pressed: true }], [1, 0, 0, 0])]
      const input = yield* makeInputService()
      const adapter = makeGamepadInputAdapter(input, () => current)

      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(true)
      current = [null]
      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(false)
      expect(yield* input.snapshot).toMatchObject({ gamepadAxes: { leftX: 0, leftY: 0 } })
    }),
  )

  it.effect('releases a held action when its button is no longer reported', () =>
    Effect.gen(function* () {
      let current: ReadonlyArray<GamepadSnapshot | null> = [pad([{ pressed: true }])]
      const input = yield* makeInputService()
      const adapter = makeGamepadInputAdapter(input, () => current)

      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(true)
      current = [pad([])]
      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )

  it.effect('keeps modal shielding identical to keyboard and touch input', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'gamepadpress', action: 'jump', target: MODAL_LISTENER_TARGET })
      expect(yield* input.isActionActive('jump')).toBe(false)
      yield* input.dispatch({ kind: 'gamepadpress', action: 'jump', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('jump')).toBe(true)
    }),
  )

  it.effect('a button index past the known mapping is dropped, not misbound', () =>
    Effect.gen(function* () {
      // `gamepadButtonForIndex` is a fixed 14-entry table (`GAMEPAD_BUTTONS`);
      // a gamepad reporting MORE buttons than that — real hardware does, e.g.
      // extra paddles — hands `bindingForButtonIndex` an index the table has
      // no name for. It must resolve to "no action" rather than throwing or
      // aliasing onto a real one.
      const input = yield* makeInputService()
      // 15 buttons: indices 0-13 are the known mapping (all unpressed here),
      // and index 14 is the one past the end of `GAMEPAD_BUTTONS`.
      const buttons = Array.from({ length: 15 }, (_unused, index) => ({
        pressed: index === 14,
      }))
      const adapter = makeGamepadInputAdapter(input, () => [pad(buttons)])

      yield* adapter.poll

      // Nothing became active: the phantom 15th button pressed no bound
      // action, and the poll did not throw reaching it.
      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.size).toBe(0)
      expect(snapshot.justPressed.size).toBe(0)
    }),
  )

  it.effect('uses the current keyboard binding for a gamepad action', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      const outcome = yield* input.rebind('jump', 'KeyJ')
      expect(outcome.kind).toBe('ok')
      const adapter = makeGamepadInputAdapter(input, () => [pad([{ pressed: true }])])
      yield* adapter.poll
      expect(yield* input.isActionActive('jump')).toBe(true)
      expect(yield* input.snapshot).toMatchObject({ pressed: new Set(['KeyJ']) })
      expect(DEFAULT_GAMEPAD_BINDINGS.a).toBe('jump')
    }),
  )
})
