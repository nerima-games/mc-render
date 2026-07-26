/**
 * REGRESSION: the Escape key has exactly one owner, and input is shielded by
 * the window/document bubble relationship.
 *
 * plan.md §3.9 / §2.3-2. Reference:
 * ts-minecraft/packages/presentation/input/input-service.ts:172-190 (listener
 * targets and the shielding comment), :155-158 (the blur rule), and
 * .../frame/stages/input-stage-menu.ts:6 (`handleEscape`, the single owner,
 * called only from input-stage.ts:33).
 *
 * Runs under `environment: 'node'`: no jsdom, no browser. That is deliberate —
 * plan.md §3.10 records that Playwright runs on SwiftShader and cannot do
 * pointer lock headless, so anything that can only be tested in a browser is
 * something pointer-lock behaviour cannot be tested against.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  actionForKey,
  bindingFor,
  defaultBindings,
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  GAMEPLAY_LISTENER_TARGET,
  MODAL_LISTENER_TARGET,
  modalConsumedKeyReachesGameplay,
  remap,
} from '../domain/input-bindings'
import { ESCAPE_POLICY, LISTENER_PLAN, makeInputService } from '../application/input-service'

describe('REGRESSION: Escape has exactly one owner', () => {
  it.effect('the owner is the frame-level handler, recorded as a value not a comment', () =>
    Effect.sync(() => {
      expect(ESCAPE_OWNER).toBe('frame-handler')
      expect(ESCAPE_POLICY.owner).toBe('frame-handler')
      expect(ESCAPE_POLICY.key).toBe('Escape')
    }),
  )

  it.effect('escape is not a bindable action: bindingFor always returns undefined', () =>
    Effect.sync(() => {
      const bindings = defaultBindings()

      expect(bindingFor(bindings, 'escape')).toBeUndefined()
      // Even if a corrupt persisted settings blob smuggled one in.
      expect(bindingFor({ ...bindings, escape: 'KeyQ' }, 'escape')).toBeUndefined()
    }),
  )

  it.effect('rebinding TO escape is rejected', () =>
    Effect.sync(() => {
      const outcome = remap(defaultBindings(), 'escape', 'KeyQ')

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe('escape-is-not-bindable')
    }),
  )

  it.effect('rebinding the Escape KEY to another action is rejected', () =>
    Effect.sync(() => {
      // This is the one that actually creates a second owner: bind Escape to
      // openInventory and one press both closes the modal and toggles the
      // inventory.
      const outcome = remap(defaultBindings(), 'openInventory', ESCAPE_KEY_CODE)

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe('escape-is-not-bindable')
    }),
  )

  it.effect('actionForKey never resolves Escape to a gameplay action', () =>
    Effect.sync(() => {
      expect(actionForKey(defaultBindings(), ESCAPE_KEY_CODE)).toBeUndefined()
      expect(actionForKey({ openInventory: ESCAPE_KEY_CODE }, ESCAPE_KEY_CODE)).toBeUndefined()
    }),
  )

  it.effect('no listener in the adapter plan binds Escape', () =>
    Effect.sync(() => {
      expect(LISTENER_PLAN.every((entry) => !entry.event.includes('Escape'))).toBe(true)
      expect(ESCAPE_POLICY.registeredBy).toContain('nobody')
    }),
  )

  it.effect('the escape action never reads as active or triggered, whatever arrives', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'keydown', code: ESCAPE_KEY_CODE, target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.isActionActive('escape')).toBe(false)
      expect(yield* input.wasActionJustTriggered('escape')).toBe(false)
      // ...though the raw key IS visible, because the frame handler needs it.
      expect((yield* input.snapshot).pressed.has(ESCAPE_KEY_CODE)).toBe(true)
    }),
  )
})

describe('REGRESSION: modal shielding via the window/document bubble path', () => {
  it.effect('gameplay listens on window, modals on document', () =>
    Effect.sync(() => {
      expect(GAMEPLAY_LISTENER_TARGET).toBe('window')
      expect(MODAL_LISTENER_TARGET).toBe('document')
    }),
  )

  it.effect('a key a modal stopped propagating NEVER reaches gameplay', () =>
    Effect.sync(() => {
      expect(
        modalConsumedKeyReachesGameplay(MODAL_LISTENER_TARGET, GAMEPLAY_LISTENER_TARGET, true),
      ).toBe(false)
    }),
  )

  it.effect('swapping the two targets breaks the shielding — which is why they are constants', () =>
    Effect.sync(() => {
      // If gameplay listened on document and modals on window, document runs
      // first and gameplay sees every key the modal was about to consume. This
      // is a one-word edit away, hence the test.
      expect(modalConsumedKeyReachesGameplay('window', 'document', true)).toBe(true)
    }),
  )

  it.effect('a key the modal did not consume still reaches gameplay', () =>
    Effect.sync(() => {
      expect(
        modalConsumedKeyReachesGameplay(MODAL_LISTENER_TARGET, GAMEPLAY_LISTENER_TARGET, false),
      ).toBe(true)
    }),
  )

  it.effect('key listeners sit on window in the adapter plan; keydown and keyup agree', () =>
    Effect.sync(() => {
      const keyEvents = LISTENER_PLAN.filter((entry) => entry.event.startsWith('key'))

      expect(keyEvents).toHaveLength(2)
      expect(keyEvents.every((entry) => entry.target === GAMEPLAY_LISTENER_TARGET)).toBe(true)
    }),
  )
})

describe('key remapping', () => {
  it.effect('binds layout-independent KeyboardEvent.code values, not .key', () =>
    Effect.sync(() => {
      // Binding `.key` is how an AZERTY player ends up unable to walk forward.
      expect(defaultBindings()['moveForward']).toBe('KeyW')
      expect(defaultBindings()['jump']).toBe('Space')
      expect(defaultBindings()['sneak']).toBe('ShiftLeft')
    }),
  )

  it.effect('a successful rebind returns new bindings and leaves the old ones alone', () =>
    Effect.sync(() => {
      const before = defaultBindings()
      const outcome = remap(before, 'jump', 'KeyZ')

      expect(outcome.kind).toBe('ok')
      expect(outcome.kind === 'ok' && outcome.bindings['jump']).toBe('KeyZ')
      expect(before['jump']).toBe('Space')
    }),
  )

  it.effect('rejects a key already bound elsewhere rather than silently stealing it', () =>
    Effect.sync(() => {
      const outcome = remap(defaultBindings(), 'jump', 'KeyW')

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe('key-already-bound')
      expect(outcome.kind === 'rejected' && outcome.rejection.message).toContain('moveForward')
    }),
  )

  it.effect('rebinding an action to the key it already has is allowed', () =>
    Effect.sync(() => {
      expect(remap(defaultBindings(), 'jump', 'Space').kind).toBe('ok')
    }),
  )

  it.effect('the service applies a rebind and can reset', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      expect((yield* input.rebind('jump', 'KeyZ')).kind).toBe('ok')
      yield* input.dispatch({ kind: 'keydown', code: 'KeyZ', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('jump')).toBe(true)

      yield* input.resetBindings
      expect(yield* input.isActionActive('jump')).toBe(false)
      expect((yield* input.bindings)['jump']).toBe('Space')
    }),
  )

  it.effect('a rejected rebind leaves the service state untouched', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      expect((yield* input.rebind('jump', 'KeyW')).kind).toBe('rejected')
      expect((yield* input.bindings)['jump']).toBe('Space')
    }),
  )
})

describe('InputService frame semantics', () => {
  it.effect('justPressed is an EDGE: auto-repeat must not re-fire it', () =>
    Effect.gen(function* () {
      // Without this, holding E opens and closes the inventory dozens of times
      // a second, because the browser repeats keydown while a key is held.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'keydown', code: 'KeyE', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.wasActionJustTriggered('openInventory')).toBe(true)

      yield* input.endFrame
      yield* input.dispatch({ kind: 'keydown', code: 'KeyE', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('openInventory')).toBe(false)
      expect(yield* input.isActionActive('openInventory')).toBe(true)
    }),
  )

  it.effect('endFrame clears the edge and the accumulated pointer delta, not the held keys', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'pointermove', deltaX: 3, deltaY: -2 })
      yield* input.dispatch({ kind: 'pointermove', deltaX: 1, deltaY: 1 })

      expect((yield* input.snapshot).pointerDelta).toStrictEqual({ x: 4, y: -1 })

      yield* input.endFrame
      const after = yield* input.snapshot

      expect(after.pointerDelta).toStrictEqual({ x: 0, y: 0 })
      expect(after.justPressed.size).toBe(0)
      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )

  it.effect('pointer motion is ignored while the pointer is NOT locked', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'pointermove', deltaX: 100, deltaY: 100 })

      expect((yield* input.snapshot).pointerDelta).toStrictEqual({ x: 0, y: 0 })
    }),
  )

  it.effect('losing the pointer lock zeroes the delta, so the view does not spin', () =>
    Effect.gen(function* () {
      // The pointer jumps to its pre-lock position when the lock is released;
      // feeding that jump to the camera whips the view around.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
      yield* input.dispatch({ kind: 'pointermove', deltaX: 50, deltaY: 50 })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      const after = yield* input.snapshot
      expect(after.pointerDelta).toStrictEqual({ x: 0, y: 0 })
      expect(after.pointerLocked).toBe(false)
    }),
  )

  it.effect('REGRESSION: blur clears held input — the browser sends no keyup while unfocused', () =>
    Effect.gen(function* () {
      // ts-minecraft/packages/presentation/input/input-service.ts:155-158 —
      // "a key held during a tab/window switch stays 'pressed' forever and the
      // player keeps walking/acting on return (user report: stuck controls)".
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'keydown', code: 'ShiftLeft', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('moveForward')).toBe(true)

      yield* input.dispatch({ kind: 'blur' })

      expect(yield* input.isActionActive('moveForward')).toBe(false)
      expect(yield* input.isActionActive('sneak')).toBe(false)
      expect((yield* input.snapshot).pressed.size).toBe(0)
    }),
  )

  it.effect('an event tagged as arriving at the modal target is not gameplay input', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: MODAL_LISTENER_TARGET })

      expect(yield* input.isActionActive('moveForward')).toBe(false)
    }),
  )

  it.effect('keyup releases the key', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'keydown', code: 'KeyD', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('moveRight')).toBe(true)

      yield* input.dispatch({ kind: 'keyup', code: 'KeyD', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isActionActive('moveRight')).toBe(false)
    }),
  )
})
