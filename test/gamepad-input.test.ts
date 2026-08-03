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

const pad = (buttons: ReadonlyArray<{ pressed: boolean; value?: number }>, axes: ReadonlyArray<number> = []): GamepadSnapshot => ({
  connected: true,
  buttons: buttons.map((button) => ({ pressed: button.pressed, value: button.value ?? (button.pressed ? 1 : 0) })),
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

  it.effect('keeps modal shielding identical to keyboard and touch input', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'gamepadpress', action: 'jump', target: MODAL_LISTENER_TARGET })
      expect(yield* input.isActionActive('jump')).toBe(false)
      yield* input.dispatch({ kind: 'gamepadpress', action: 'jump', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('jump')).toBe(true)
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
