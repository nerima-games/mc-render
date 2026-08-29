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
import { Effect, Ref } from 'effect'
import {
  acquiresPointerLock,
  actionForKey,
  bindingFor,
  defaultBindings,
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  FOCUS_NAVIGATION_KEY_CODE,
  FOCUS_NAVIGATION_OWNER,
  GAMEPLAY_LISTENER_TARGET,
  HOTBAR_FOCUS_GROUP,
  INPUT_ACTIONS,
  isMouseButton,
  MODAL_LISTENER_TARGET,
  modalConsumedKeyReachesGameplay,
  MOUSE_BUTTONS,
  mouseButtonForIndex,
  notchesForWheelDelta,
  CLICK_LANDINGS,
  POINTER_LOCK_ACQUIRE_BUTTON,
  POINTER_LOCK_ACQUIRE_LANDING,
  POINTER_LOCK_STATES,
  remap,
  reportsKeyboardFocus,
  suppressesBrowserContextMenu,
  suppressesBrowserScroll,
  WHEEL_DELTA_MODES,
  wheelDeltaModeForIndex,
  WHEEL_LINES_PER_NOTCH,
  WHEEL_PIXELS_PER_NOTCH,
  wrapHotbarSelection,
  type Bindings,
  type InputAction,
} from '../src/domain/input-bindings'
import {
  ESCAPE_POLICY,
  FOCUS_NAVIGATION_POLICY,
  LISTENER_PLAN,
  makeInputService,
  UNAVAILABLE_POINTER_LOCK,
  type PointerLockPort,
  type PointerLockRequestOutcome,
} from '../src/application/input-service'
import { PREVENT_DEFAULT_EVENTS, mayPreventDefault } from '../src/application/browser-input-adapter'

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

  it.effect('remap rejects an action name outside INPUT_ACTIONS, e.g. from a stale settings UI', () =>
    Effect.sync(() => {
      // `action` is typed as `InputAction`, a closed union, so nothing inside
      // this codebase can call `remap` with an unknown action past the type
      // checker. A settings menu built against an older/newer version of this
      // module is not inside this codebase, and can. `ownershipRemapRejection`
      // must reject it by name rather than writing a binding table entry
      // nothing will ever read back through `bindingFor`.
      const outcome = remap(defaultBindings(), 'flyToTheMoon' as InputAction, 'KeyQ')

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe('unknown-action')
      expect(outcome.kind === 'rejected' && outcome.rejection.message).toContain('flyToTheMoon')
    }),
  )

  it.effect('actionForKey resolves to undefined for a key nothing is bound to', () =>
    Effect.sync(() => {
      // The default bindings never use `KeyZ` (jump remapping tests above
      // move `jump` there deliberately, on their OWN local copy — this reads
      // the untouched defaults), so `Object.entries(...).find(...)` runs out
      // without matching and `found` stays `undefined`.
      expect(actionForKey(defaultBindings(), 'KeyZ')).toBeUndefined()
    }),
  )

  it.effect('actionForKey resolves to undefined for a bound action name outside INPUT_ACTIONS', () =>
    Effect.sync(() => {
      // The other guard `actionForKey` carries independently of `remap`'s:
      // a corrupt or pre-migration persisted `Bindings` blob can map a key to
      // an action name this version of the game no longer knows. `found`
      // succeeds (the key IS present), but the action it names fails the
      // `INPUT_ACTIONS` membership check, so this must still resolve to
      // `undefined` rather than returning a string no `InputAction` switch
      // can handle.
      const legacyBindings = { retiredAction: 'KeyQ' } as unknown as Bindings

      expect(actionForKey(legacyBindings, 'KeyQ')).toBeUndefined()
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

      yield* input.endFrame()
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

      yield* input.endFrame()
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

  it.effect('unknown event kinds leave state unchanged', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      const before = yield* input.snapshot

      yield* input.dispatch({ kind: 'future-event' } as unknown as Parameters<typeof input.dispatch>[0])

      expect(yield* input.snapshot).toStrictEqual(before)
    }),
  )
})

/**
 * A service with the pointer already locked — i.e. the player is in the game
 * looking around, which is the state in which a click is a game action.
 */
const lockedInput = Effect.gen(function* () {
  const input = yield* makeInputService()
  yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
  return input
})

describe('mouse buttons are gameplay input, in the same code space as keys', () => {
  it.effect('left click is attack and right click is use — the two the spike could not express', () =>
    Effect.sync(() => {
      // A vertical slice tried to implement "the player breaks a block" and had
      // to bind breaking to KeyB, because no mouse button could carry it.
      expect(defaultBindings()['attack']).toBe('MouseLeft')
      expect(defaultBindings()['use']).toBe('MouseRight')
      expect(defaultBindings()['pickBlock']).toBe('MouseMiddle')
      expect(INPUT_ACTIONS).toContain('attack')
      expect(INPUT_ACTIONS).toContain('use')
    }),
  )

  it.effect('MouseEvent.button numbers are translated to names in exactly one place', () =>
    Effect.sync(() => {
      // 0 left, 1 middle, 2 right — the DOM numbering, which the adapter
      // receives and nothing past this function ever sees.
      expect(mouseButtonForIndex(0)).toBe('MouseLeft')
      expect(mouseButtonForIndex(1)).toBe('MouseMiddle')
      expect(mouseButtonForIndex(2)).toBe('MouseRight')
      // Thumb buttons and anything else a device reports are dropped at the
      // boundary rather than becoming state nothing can read.
      expect(mouseButtonForIndex(3)).toBeUndefined()
      expect(mouseButtonForIndex(-1)).toBeUndefined()
    }),
  )

  it.effect('no KeyboardEvent.code begins with Mouse, which is what makes ONE code space safe', () =>
    Effect.sync(() => {
      expect(MOUSE_BUTTONS.every((button) => isMouseButton(button))).toBe(true)
      for (const code of ['KeyW', 'Space', 'ShiftLeft', 'F3', 'Numpad0', ESCAPE_KEY_CODE]) {
        expect(isMouseButton(code)).toBe(false)
      }
      // ...so a binding table, a pressed set and a conflict check can hold both.
      expect(actionForKey(defaultBindings(), 'MouseLeft')).toBe('attack')
      expect(actionForKey(defaultBindings(), 'KeyW')).toBe('moveForward')
    }),
  )

  it.effect('REGRESSION: a click is an edge for exactly ONE frame — one click breaks one block', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      expect(yield* input.wasActionJustTriggered('attack')).toBe(true)
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)
      // Reading it twice in one frame is still the same one edge.
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)

      yield* input.endFrame()

      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(false)
    }),
  )

  it.effect('a held button stays down across frames, so hold-to-break keeps breaking', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      yield* input.endFrame()
      yield* input.endFrame()

      expect(yield* input.isButtonDown('MouseLeft')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(true)

      yield* input.dispatch({ kind: 'mouseup', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
    }),
  )

  it.effect('a second mousedown within one frame does not produce a second edge', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect((yield* input.snapshot).justPressed.size).toBe(1)
    }),
  )

  it.effect('attack fires from the LEFT button and use from the RIGHT, not the other way round', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('use')).toBe(true)
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasActionJustTriggered('pickBlock')).toBe(false)
    }),
  )

  it.effect('the middle button is pickBlock and fires neither attack nor use', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseMiddle', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('pickBlock')).toBe(true)
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasActionJustTriggered('use')).toBe(false)
    }),
  )

  it.effect('attack can be rebound to a KEY — which is what the spike had to hack in', () =>
    Effect.gen(function* () {
      // The spike bound breaking to KeyB because no button existed. That is now
      // an ordinary remap, and the same path a one-handed player takes.
      const input = yield* lockedInput

      expect((yield* input.rebind('attack', 'KeyB')).kind).toBe('ok')
      yield* input.dispatch({ kind: 'keydown', code: 'KeyB', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('attack')).toBe(true)

      // ...and the button it used to have no longer triggers it, so the rebind
      // MOVED the action rather than adding a second way to fire it.
      yield* input.endFrame()
      yield* input.dispatch({ kind: 'keyup', code: 'KeyB', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
    }),
  )

  it.effect('one code one action applies across the key/button boundary', () =>
    Effect.sync(() => {
      // Binding jump to the button that already breaks blocks is the same
      // conflict as binding it to KeyW, and gets the same rejection.
      const outcome = remap(defaultBindings(), 'jump', 'MouseLeft')

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe('key-already-bound')
      expect(outcome.kind === 'rejected' && outcome.rejection.message).toContain('attack')
    }),
  )

  it.effect('REGRESSION: blur releases held buttons — the browser sends no mouseup while unfocused', () =>
    Effect.gen(function* () {
      // ts-minecraft/packages/presentation/input/input-service.ts:155-158 names
      // buttons explicitly: "no keyup/mouseup for keys/BUTTONS still held".
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      expect(yield* input.isButtonDown('MouseLeft')).toBe(true)

      yield* input.dispatch({ kind: 'blur' })

      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
    }),
  )

  it.effect('REGRESSION: blur ends the LOCKED SESSION, so the click that refocuses is not an attack', () =>
    Effect.gen(function* () {
      // The half of `blur` that nothing used to assert. Three tests dispatched
      // it and all three checked what it CLEARS; none checked what it KEPT —
      // and what it kept was `pointerLockState`, the one field that decides
      // what a click MEANS. `withButtonDown` routes a mousedown into `pressed`
      // while the state says `locked`, so until the browser got around to
      // delivering `pointerlockchange` the click the player used to come BACK
      // to the tab fired `attack`.
      //
      // The reason is already written down for the other handler:
      // `withoutHeldButtons` exists because "the click belonged to the locked
      // session", and a blur ends that session as surely as losing the lock
      // does. The two handlers disagreed.
      const input = yield* lockedInput
      expect((yield* input.snapshot).pointerLocked).toBe(true)

      yield* input.dispatch({ kind: 'blur' })

      expect(yield* input.pointerLockState).toBe('unlocked')
      expect((yield* input.snapshot).pointerLocked).toBe(false)

      // The click that brings the window back is a UI click — which is what
      // ASKS for the lock again — and fires no game action.
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
      expect(acquiresPointerLock('MouseLeft', yield* input.pointerLockState, 'lock-target')).toBe(true)
    }),
  )

  it.effect('blur does NOT invent a refusal — `unlocked` is "nobody asked", not "the browser said no"', () =>
    Effect.gen(function* () {
      // `refused` is what a UI draws as "click again to look around" and is
      // reserved for `pointerlockerror` and for a platform with no pointer lock
      // to ask. A window losing focus is neither.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'blur' })
      expect(yield* input.pointerLockState).toBe('unlocked')

      // ...and an EXISTING refusal survives, because it is documented as sticky
      // until something ASKS again, and a blur is not an ask.
      const refused = yield* makeInputService()
      yield* refused.dispatch({ kind: 'pointerlockerror' })
      yield* refused.dispatch({ kind: 'blur' })

      expect(yield* refused.pointerLockState).toBe('refused')
    }),
  )

  it.effect('mousedown and mouseup register on the same target, or a held button sticks', () =>
    Effect.sync(() => {
      const buttonEvents = LISTENER_PLAN.filter((entry) => entry.event === 'mousedown' || entry.event === 'mouseup')

      expect(buttonEvents).toHaveLength(2)
      // On `window` WITH the keys — not on `document` where the reference put
      // them (:181-182). A gameplay action must be shieldable by a modal, and
      // a listener on `document` cannot be shielded by a modal on `document`.
      expect(buttonEvents.every((entry) => entry.target === GAMEPLAY_LISTENER_TARGET)).toBe(true)
    }),
  )

  it.effect('a click a modal consumed NEVER reaches gameplay', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: MODAL_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect(yield* input.wasUiClick('MouseLeft')).toBe(false)
    }),
  )
})

describe('REGRESSION: a click means different things locked and unlocked', () => {
  it.effect('a click while the pointer is LOCKED is a game action', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('use')).toBe(true)
      expect(yield* input.wasUiClick('MouseRight')).toBe(false)
    }),
  )

  it.effect('a click while UNLOCKED never fires attack — a menu click must not break a block', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect((yield* input.snapshot).pressed.size).toBe(0)
    }),
  )

  it.effect('an unlocked click IS reported as a UI click — it is what re-acquires the lock', () =>
    Effect.gen(function* () {
      // Dropping it entirely would break the click that locks the pointer,
      // which is the same left-click that breaks a block one frame later.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)
      expect((yield* input.snapshot).uiClicks.has('MouseLeft')).toBe(true)
    }),
  )

  it.effect('endFrame clears the UI click edge as well as the gameplay edge', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      yield* input.endFrame()

      expect(yield* input.wasUiClick('MouseLeft')).toBe(false)
      expect((yield* input.snapshot).uiClicks.size).toBe(0)
    }),
  )

  it.effect('losing the lock releases held buttons, so breaking stops when the pause menu opens', () =>
    Effect.gen(function* () {
      // Hold left to break, press Escape: the browser exits pointer lock and no
      // mouseup is coming, because the next click goes to the menu.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      expect(yield* input.isActionActive('attack')).toBe(true)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      expect(yield* input.isActionActive('attack')).toBe(false)
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(false)
    }),
  )

  it.effect('losing the lock does NOT release held keys — chat and the frame handler still need them', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )

  it.effect('a mouseup after the lock was lost is harmless rather than a stuck release', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })
      yield* input.dispatch({ kind: 'mouseup', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect((yield* input.snapshot).pressed.size).toBe(0)
    }),
  )
})

describe('REGRESSION: the browser context menu', () => {
  it.effect('is suppressed while the pointer is locked, or right-click opens a menu mid-place', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      expect(suppressesBrowserContextMenu(true)).toBe(true)
      expect(yield* input.shouldSuppressContextMenu).toBe(true)
    }),
  )

  it.effect('is NOT suppressed while unlocked, where the browser menu is the platform behaviour', () =>
    Effect.gen(function* () {
      // Unlocked means DOM UI — a chat line to copy, a text field to
      // spell-check. The reference suppresses unconditionally (:140-142);
      // narrowing it is deliberate and this is the test that says so.
      const input = yield* makeInputService()

      expect(suppressesBrowserContextMenu(false)).toBe(false)
      expect(yield* input.shouldSuppressContextMenu).toBe(false)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
      expect(yield* input.shouldSuppressContextMenu).toBe(true)
      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })
      expect(yield* input.shouldSuppressContextMenu).toBe(false)
    }),
  )

  it.effect('the contextmenu event adds NO second right-button edge — one click, one placement', () =>
    Effect.gen(function* () {
      // ts-minecraft/packages/presentation/input/input-service.ts:137-139:
      // mousedown has already captured button 2, so counting contextmenu too
      // fires `use` twice for one click.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      yield* input.dispatch({ kind: 'contextmenu', target: GAMEPLAY_LISTENER_TARGET })

      expect((yield* input.snapshot).justPressed.size).toBe(1)

      yield* input.endFrame()
      yield* input.dispatch({ kind: 'contextmenu', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('use')).toBe(false)
      // ...and it does not release the still-held button either.
      expect(yield* input.isButtonDown('MouseRight')).toBe(true)
    }),
  )

  it.effect('the adapter plan registers contextmenu and its note says what to do with it', () =>
    Effect.sync(() => {
      const entry = LISTENER_PLAN.find((planned) => planned.event === 'contextmenu')

      expect(entry).toBeDefined()
      expect(entry?.note).toContain('preventDefault()')
      expect(entry?.note).toContain('shouldSuppressContextMenu')
    }),
  )
})

/** One notch of a classic mouse wheel, as Chrome reports it. */
const oneNotchDown = { kind: 'wheel', deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 'pixel' } as const

describe('the wheel is a DELTA — not an edge, not a level', () => {
  it.effect('a flick ACCUMULATES within one frame: the frame sees the SUM of its events', () =>
    Effect.gen(function* () {
      // The browser delivers one `wheel` event per notch (several per notch on
      // a trackpad). A snapshot that showed only the last one would turn every
      // fast flick into a single slot — which is what the reference does, by
      // reducing the accumulated delta to its sign
      // (<reference-impl>/packages/inventory/application/hotbar-service.ts:76).
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)
      yield* input.dispatch(oneNotchDown)

      const snapshot = yield* input.snapshot
      expect(snapshot.wheelNotches).toBe(2)
      expect(snapshot.wheelSteps).toBe(2)
    }),
  )

  it.effect('endFrame clears the accumulated notches, so one flick cycles the hotbar once', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)
      yield* input.dispatch(oneNotchDown)
      const frame = yield* input.snapshot
      expect(frame.wheelSteps).toBe(2)

      // The frame hands back the reading it acted on; `endFrame` consumes
      // exactly that.
      yield* input.endFrame(frame)

      const after = yield* input.snapshot
      expect(after.wheelNotches).toBe(0)
      expect(after.wheelSteps).toBe(0)
    }),
  )

  it.effect('scrolling UP is negative, scrolling DOWN is positive — the DOM and vanilla sign', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: -WHEEL_PIXELS_PER_NOTCH, deltaMode: 'pixel' })

      expect((yield* input.snapshot).wheelSteps).toBe(-1)
    }),
  )

  it.effect('deltaMode is NORMALISED: 100 pixels, 3 lines and 1 page are each one notch', () =>
    Effect.sync(() => {
      // The same physical detent, in the three units browsers report it in.
      // Divide by the wrong one and the hotbar either never moves (pixels
      // treated as lines) or jumps 33 slots (lines treated as pixels).
      expect(notchesForWheelDelta(WHEEL_PIXELS_PER_NOTCH, 'pixel')).toBe(1)
      expect(notchesForWheelDelta(WHEEL_LINES_PER_NOTCH, 'line')).toBe(1)
      expect(notchesForWheelDelta(1, 'page')).toBe(1)
      expect(notchesForWheelDelta(-WHEEL_PIXELS_PER_NOTCH, 'pixel')).toBe(-1)
    }),
  )

  it.effect('normalisation applies at DISPATCH, so mixed units can be added at all', () =>
    Effect.gen(function* () {
      // A trackpad (pixels) and a wheel (lines) can both deliver inside one
      // frame. Summing the raw numbers would add 3 to 100 and mean nothing.
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)
      yield* input.dispatch({ kind: 'wheel', deltaY: WHEEL_LINES_PER_NOTCH, deltaMode: 'line' })

      expect((yield* input.snapshot).wheelSteps).toBe(2)
    }),
  )

  it.effect('WheelEvent.deltaMode numbers are translated to names in exactly one place', () =>
    Effect.sync(() => {
      // DOM_DELTA_PIXEL 0, DOM_DELTA_LINE 1, DOM_DELTA_PAGE 2 — the same
      // number→name boundary `mouseButtonForIndex` is.
      expect(wheelDeltaModeForIndex(0)).toBe('pixel')
      expect(wheelDeltaModeForIndex(1)).toBe('line')
      expect(wheelDeltaModeForIndex(2)).toBe('page')
      expect(wheelDeltaModeForIndex(3)).toBeUndefined()
      expect(wheelDeltaModeForIndex(-1)).toBeUndefined()
      expect(WHEEL_DELTA_MODES).toStrictEqual(['pixel', 'line', 'page'])
    }),
  )

  it.effect('a sub-notch trackpad scroll CARRIES across frames instead of being lost', () =>
    Effect.gen(function* () {
      // A trackpad emits a few pixels per event. If endFrame zeroed the
      // accumulator outright, every frame would round to zero notches and the
      // hotbar would be unreachable on a laptop.
      const input = yield* lockedInput

      for (let frame = 0; frame < 4; frame += 1) {
        yield* input.dispatch({ kind: 'wheel', deltaY: 20, deltaMode: 'pixel' })
        const sampled = yield* input.snapshot
        expect(sampled.wheelSteps).toBe(0)
        yield* input.endFrame(sampled)
      }

      // The fifth 0.2 completes the notch.
      yield* input.dispatch({ kind: 'wheel', deltaY: 20, deltaMode: 'pixel' })
      const fifth = yield* input.snapshot
      expect(fifth.wheelSteps).toBe(1)

      // ...and only the whole notch is consumed.
      yield* input.endFrame(fifth)
      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )

  it.effect('REGRESSION: endFrame consumes what the FRAME was told, not what arrived after it', () =>
    Effect.gen(function* () {
      // The event ordering no single-fiber test naturally writes, and the only
      // one that shows the bug: a `wheel` listener fires between the frame
      // stage's `snapshot` and the frame loop's `endFrame`.
      //
      // `snapshot` truncated at read time and `endFrame` re-read the
      // accumulator and truncated AGAIN, at a different instant. 0.9 notches is
      // 0 whole steps, so the frame moved the hotbar by nothing; the next 0.3
      // pushed the accumulator to 1.2, and `endFrame` then ate a whole notch
      // the frame was never told about. The player turned a detent and the
      // selection did not move, once, unreproducibly.
      //
      // Same class as the consume-on-read `consumeMouseClick` this file
      // explicitly rejects: whether travel survives depended on who read it
      // first. The fix is that the frame hands its reading BACK.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 90, deltaMode: 'pixel' })
      const seenByTheFrame = yield* input.snapshot
      expect(seenByTheFrame.wheelSteps).toBe(0)

      // The DOM listener runs here.
      yield* input.dispatch({ kind: 'wheel', deltaY: 30, deltaMode: 'pixel' })

      yield* input.endFrame(seenByTheFrame)

      // Nothing was consumed, because nothing was reported. The 1.2 notches
      // carry whole into the next frame instead of being silently spent.
      const nextFrame = yield* input.snapshot
      expect(nextFrame.wheelNotches).toBeCloseTo(1.2, 10)
      expect(nextFrame.wheelSteps).toBe(1)

      // ...and THAT frame's endFrame consumes exactly the notch it reported.
      yield* input.endFrame(nextFrame)
      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(0.2, 10)
    }),
  )

  it.effect('REGRESSION: snapshot is a PURE read — an observer cannot move the frame boundary', () =>
    Effect.gen(function* () {
      // The reason the reading is an argument rather than something the service
      // remembers. If `snapshot` recorded what it reported, a debug overlay or a
      // preview redrawing its analogue panel would change how much travel the
      // next `endFrame` consumed — and this repository's own preview redraws
      // after every step, so it would have reproduced the bug through its
      // instrumentation alone. An observer must not move the thing it observes.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 90, deltaMode: 'pixel' })
      const frame = yield* input.snapshot
      expect(frame.wheelSteps).toBe(0)

      yield* input.dispatch({ kind: 'wheel', deltaY: 30, deltaMode: 'pixel' })
      // A dev overlay reads the accumulator. Three times, for good measure.
      expect((yield* input.snapshot).wheelSteps).toBe(1)
      expect((yield* input.snapshot).wheelSteps).toBe(1)
      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(1.2, 10)

      yield* input.endFrame(frame)

      // Still 1.2: the overlay's reads changed nothing.
      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(1.2, 10)
    }),
  )

  it.effect('two stages reading the same frame see the same travel, and it is consumed once', () =>
    Effect.gen(function* () {
      // Not a consuming read, which is what `wasButtonJustPressed` rejects by
      // name: neither reader can take travel away from the other.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 250, deltaMode: 'pixel' })

      const stageA = yield* input.snapshot
      const stageB = yield* input.snapshot
      expect(stageA.wheelSteps).toBe(2)
      expect(stageB.wheelSteps).toBe(2)

      yield* input.endFrame(stageA)

      // Two whole notches, consumed once.
      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(0.5, 10)
    }),
  )

  it.effect('a frame loop that never samples consumes nothing — travel is deferred, not lost', () =>
    Effect.gen(function* () {
      // The corollary of "consume exactly what was reported", and the reason
      // omitting the argument is the honest default rather than a convenience.
      // Nothing acted on this travel, so throwing it away would lose it
      // outright rather than defer it to a frame that will read it.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 150, deltaMode: 'pixel' })
      yield* input.endFrame()

      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(1.5, 10)
      expect((yield* input.snapshot).wheelSteps).toBe(1)
    }),
  )

  it.effect('a STALE reading cannot drive the accumulator past zero', () =>
    Effect.gen(function* () {
      // The one way a caller can get the argument wrong: hand back a snapshot
      // the accumulator can no longer cover, because the lock was lost in
      // between. A bare subtraction would invent travel in the opposite
      // direction — a hotbar that cycles on its own — so the worst case is
      // "this frame consumed nothing" instead.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 250, deltaMode: 'pixel' })
      const stale = yield* input.snapshot
      expect(stale.wheelSteps).toBe(2)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })
      yield* input.endFrame(stale)

      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )

  it.effect('the carried remainder is under one notch, so it cannot become a phantom step', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 250, deltaMode: 'pixel' })
      const frame = yield* input.snapshot
      expect(frame.wheelSteps).toBe(2)

      yield* input.endFrame(frame)

      expect((yield* input.snapshot).wheelNotches).toBeCloseTo(0.5, 10)
      expect((yield* input.snapshot).wheelSteps).toBe(0)
    }),
  )

  it.effect('scrolling back cancels the carried remainder rather than banking it', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: 50, deltaMode: 'pixel' })
      yield* input.endFrame(yield* input.snapshot)
      yield* input.dispatch({ kind: 'wheel', deltaY: -50, deltaMode: 'pixel' })

      expect((yield* input.snapshot).wheelNotches).toBe(0)
      expect((yield* input.snapshot).wheelSteps).toBe(0)
    }),
  )

  it.effect('the wheel NEVER touches pressed or justPressed — an edge cannot say "two"', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)

      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.size).toBe(0)
      expect(snapshot.justPressed.size).toBe(0)
    }),
  )

  it.effect('a wheel event is IGNORED while unlocked — that scroll belongs to the DOM', () =>
    Effect.gen(function* () {
      // Symmetric with `pointer motion is ignored while the pointer is NOT
      // locked`: an unlocked wheel is scrolling the chat log or the settings
      // list, not cycling the hotbar.
      const input = yield* makeInputService()

      yield* input.dispatch(oneNotchDown)

      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )

  it.effect('losing the lock drops the wheel travel, so the hotbar does not jump on return', () =>
    Effect.gen(function* () {
      // DN-09, generalised: analogue state belongs to the locked session that
      // produced it. Half a flick left over from before the pause menu opened
      // must not cycle the hotbar afterwards.
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)
      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )

  it.effect('blur drops the wheel travel too — the reference clears it in handleBlur', () =>
    Effect.gen(function* () {
      // <reference-impl>/packages/presentation/input/input-service.ts:167
      // (`MutableRef.set(wheelDeltaRef, 0)` inside handleBlur).
      const input = yield* lockedInput

      yield* input.dispatch(oneNotchDown)
      yield* input.dispatch({ kind: 'blur' })

      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )

  it.effect('a non-finite delta cannot poison the accumulator for the rest of the session', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'wheel', deltaY: Number.NaN, deltaMode: 'pixel' })
      yield* input.dispatch({ kind: 'wheel', deltaY: Number.POSITIVE_INFINITY, deltaMode: 'line' })
      yield* input.dispatch(oneNotchDown)

      expect((yield* input.snapshot).wheelSteps).toBe(1)
    }),
  )

  it.effect('browser scrolling is suppressed while locked and NOT while unlocked', () =>
    Effect.gen(function* () {
      // Unconditional preventDefault on a passive:false wheel listener means an
      // unlocked player cannot scroll their own settings screen.
      const input = yield* makeInputService()

      expect(suppressesBrowserScroll(false)).toBe(false)
      expect(yield* input.shouldSuppressWheelScroll).toBe(false)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      expect(suppressesBrowserScroll(true)).toBe(true)
      expect(yield* input.shouldSuppressWheelScroll).toBe(true)
    }),
  )

  it.effect('the adapter plan registers wheel with passive:false and says when to preventDefault', () =>
    Effect.sync(() => {
      const entry = LISTENER_PLAN.find((planned) => planned.event === 'wheel')

      expect(entry).toBeDefined()
      expect(entry?.note).toContain('passive: false')
      expect(entry?.note).toContain('shouldSuppressWheelScroll')
      expect(entry?.note).toContain('wheelDeltaModeForIndex')
    }),
  )
})

describe('hotbar selection', () => {
  it.effect('the digit row selects a slot directly, as an ordinary bound edge', () =>
    Effect.gen(function* () {
      // <reference-impl>/packages/entity/domain/key-mappings.ts:22-30.
      const input = yield* makeInputService()

      expect(defaultBindings()['hotbarSlot1']).toBe('Digit1')
      expect(defaultBindings()['hotbarSlot9']).toBe('Digit9')
      expect(INPUT_ACTIONS).toContain('hotbarSlot5')

      yield* input.dispatch({ kind: 'keydown', code: 'Digit5', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('hotbarSlot5')).toBe(true)
      expect(yield* input.wasActionJustTriggered('hotbarSlot4')).toBe(false)
    }),
  )

  it.effect('wrapping FORWARD past the last slot returns to the first', () =>
    Effect.sync(() => {
      expect(wrapHotbarSelection(8, 1, 9)).toBe(0)
      expect(wrapHotbarSelection(8, 2, 9)).toBe(1)
    }),
  )

  it.effect('wrapping BACKWARD past the first slot returns to the last', () =>
    Effect.sync(() => {
      expect(wrapHotbarSelection(0, -1, 9)).toBe(8)
      expect(wrapHotbarSelection(0, -2, 9)).toBe(7)
    }),
  )

  it.effect('REGRESSION: a MULTI-notch step wraps too — the reference formula returns -3 here', () =>
    Effect.sync(() => {
      // `(cur + direction + HOTBAR_SIZE) % HOTBAR_SIZE`
      // (<reference-impl>/packages/inventory/application/hotbar-service.ts:77-79)
      // is correct only because `direction` is clamped to ±1. JavaScript's `%`
      // keeps the sign of the dividend, so with a step of -3 that expression
      // yields a NEGATIVE slot index. This model carries the full magnitude of
      // the flick, so it would meet that on the first fast scroll.
      expect((0 + -3 + 9) % 9).toBe(6)
      expect((0 + -12 + 9) % 9).toBe(-3)

      expect(wrapHotbarSelection(0, -3, 9)).toBe(6)
      expect(wrapHotbarSelection(0, -12, 9)).toBe(6)
      expect(wrapHotbarSelection(0, 21, 9)).toBe(3)
    }),
  )

  it.effect('a step of zero selects nothing new', () =>
    Effect.sync(() => {
      expect(wrapHotbarSelection(4, 0, 9)).toBe(4)
    }),
  )

  it.effect('the SIZE is the consumer’s: this repository never assumes nine slots', () =>
    Effect.sync(() => {
      // The hotbar's length belongs to whoever owns the inventory. Only the
      // arithmetic lives here, so a five-slot hotbar needs no new code.
      expect(wrapHotbarSelection(4, 1, 5)).toBe(0)
      expect(wrapHotbarSelection(0, -1, 5)).toBe(4)
    }),
  )

  it.effect('a degenerate size selects slot 0 rather than throwing in an event handler', () =>
    Effect.sync(() => {
      expect(wrapHotbarSelection(3, 1, 0)).toBe(0)
      expect(wrapHotbarSelection(3, 1, -1)).toBe(0)
      expect(wrapHotbarSelection(3, 1, Number.NaN)).toBe(0)
      expect(wrapHotbarSelection(Number.NaN, Number.NaN, 9)).toBe(0)
    }),
  )
})

/** A port that records how many times the lock was asked for. */
const countingPointerLock = (
  outcome: PointerLockRequestOutcome,
): Effect.Effect<{ readonly port: PointerLockPort; readonly asked: Ref.Ref<number> }> =>
  Effect.map(Ref.make(0), (asked) => ({
    asked,
    port: { request: Ref.update(asked, (count) => count + 1).pipe(Effect.as(outcome)) },
  }))

describe('REGRESSION: pointer lock is a REQUEST, and a request can be refused', () => {
  it.effect('never having asked is a different state from having been refused', () =>
    Effect.gen(function* () {
      // Both are "not locked", and only one of them is something to tell the
      // player about. The reference has a console.warn between them
      // (<reference-impl>/packages/presentation/input/input-service.ts:150-153).
      const input = yield* makeInputService()

      expect(yield* input.pointerLockState).toBe('unlocked')
      expect((yield* input.snapshot).pointerLocked).toBe(false)

      yield* input.dispatch({ kind: 'pointerlockerror' })

      expect(yield* input.pointerLockState).toBe('refused')
      expect((yield* input.snapshot).pointerLockState).toBe('refused')
      expect((yield* input.snapshot).pointerLocked).toBe(false)
    }),
  )

  it.effect('the four states are the whole vocabulary, and pointerLocked is derived from it', () =>
    Effect.gen(function* () {
      expect(POINTER_LOCK_STATES).toStrictEqual(['unlocked', 'requested', 'locked', 'refused'])

      const input = yield* lockedInput
      const snapshot = yield* input.snapshot

      expect(snapshot.pointerLockState).toBe('locked')
      expect(snapshot.pointerLocked).toBe(true)
    }),
  )

  it.effect('REQUEST → GRANTED: the ask reports `requested`, and the EVENT is what locks', () =>
    Effect.gen(function* () {
      // The service must not assume the lock succeeded. The browser answers
      // later, and asking is not being granted.
      const { port, asked } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      expect(yield* input.requestPointerLock).toBe('requested')
      expect(yield* Ref.get(asked)).toBe(1)
      expect((yield* input.snapshot).pointerLocked).toBe(false)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      expect(yield* input.pointerLockState).toBe('locked')
      expect((yield* input.snapshot).pointerLocked).toBe(true)
    }),
  )

  it.effect('REQUEST → REFUSED: pointerlockerror answers the ask, and the state says so', () =>
    Effect.gen(function* () {
      const { port } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      expect(yield* input.requestPointerLock).toBe('requested')

      yield* input.dispatch({ kind: 'pointerlockerror' })

      expect(yield* input.pointerLockState).toBe('refused')
      expect((yield* input.snapshot).pointerLocked).toBe(false)
    }),
  )

  it.effect('a REFUSAL is sticky, so the UI can still draw it several frames later', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'pointerlockerror' })
      yield* input.endFrame()
      yield* input.endFrame()

      expect(yield* input.pointerLockState).toBe('refused')
    }),
  )

  it.effect('an ordinary unlock does NOT read as refused — Escape is not a browser refusal', () =>
    Effect.gen(function* () {
      // Collapsing the two would make every pause menu look like a failure.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      expect(yield* input.pointerLockState).toBe('unlocked')
    }),
  )

  it.effect('a second request while one is PENDING does not ask the browser twice', () =>
    Effect.gen(function* () {
      // A request sent while another is pending is one of the ways the browser
      // refuses the next one.
      const { port, asked } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      expect(yield* input.requestPointerLock).toBe('requested')
      expect(yield* input.requestPointerLock).toBe('requested')

      expect(yield* Ref.get(asked)).toBe(1)
    }),
  )

  it.effect('requesting while ALREADY locked asks nothing and reports locked', () =>
    Effect.gen(function* () {
      const { port, asked } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      expect(yield* input.requestPointerLock).toBe('locked')
      expect(yield* Ref.get(asked)).toBe(0)
    }),
  )

  it.effect('REGRESSION: a blur ABANDONS a pending request rather than stranding the session', () =>
    Effect.gen(function* () {
      // `requested` used to be an absorbing state. Only `pointerlockchange` and
      // `pointerlockerror` ever left it, and both come from the browser;
      // `blur` preserved it, and `requestPointerLock` refuses to re-ask while
      // one is pending — correctly, because a second request while one is
      // pending is one of the documented ways the browser refuses the next.
      //
      // So a request issued and never answered stranded the session for good:
      // `acquiresPointerLock` declines to act on a click in `requested`, so the
      // gesture that would normally fix it does nothing. The player could walk
      // and type and never look around again. A window blurring between the ask
      // and the answer is the ordinary way that happens.
      //
      // This repository already knew the hazard by name — see the
      // `unavailable` test below, whose comment reads "Leaving the machine in
      // `requested` would strand it for the session." The `sent` path had the
      // identical hole and nothing guarded it.
      const { port, asked } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      expect(yield* input.requestPointerLock).toBe('requested')
      expect(yield* Ref.get(asked)).toBe(1)

      // The answer never arrives; the window loses focus instead.
      yield* input.dispatch({ kind: 'blur' })

      expect(yield* input.pointerLockState).toBe('unlocked')
      // ...so a click is once again the gesture that asks, and the ask reaches
      // the port a SECOND time.
      expect(acquiresPointerLock('MouseLeft', yield* input.pointerLockState, 'lock-target')).toBe(true)
      expect(yield* input.requestPointerLock).toBe('requested')
      expect(yield* Ref.get(asked)).toBe(2)
    }),
  )

  it.effect('a platform with NO pointer lock refuses at once rather than hanging in requested', () =>
    Effect.gen(function* () {
      // `unavailable` means no event will ever arrive to answer the request —
      // no canvas, no DOM, or a feature policy that forbids it
      // (<reference-impl>/packages/presentation/input/input-service.ts:258-266).
      // Leaving the machine in `requested` would strand it for the session.
      const input = yield* makeInputService(defaultBindings(), UNAVAILABLE_POINTER_LOCK)

      expect(yield* input.requestPointerLock).toBe('refused')
      expect(yield* input.pointerLockState).toBe('refused')
    }),
  )

  it.effect('the default port is the unavailable one, so an un-injected service never hangs', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      expect(yield* input.requestPointerLock).toBe('refused')
    }),
  )

  it.effect('a refusal can be RETRIED — a click is the user gesture the browser wanted', () =>
    Effect.gen(function* () {
      const { port, asked } = yield* countingPointerLock('sent')
      const input = yield* makeInputService(defaultBindings(), port)

      yield* input.dispatch({ kind: 'pointerlockerror' })
      expect(yield* input.requestPointerLock).toBe('requested')

      expect(yield* Ref.get(asked)).toBe(1)
    }),
  )

  it.effect('pointerlockerror touches nothing but the lock state', () =>
    Effect.gen(function* () {
      // A refused request never held the pointer, so there is no delta to drop
      // and no button to release. Anything else it cleared would be state
      // invented out of a failure.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'pointerlockerror' })

      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )

  it.effect('only the LEFT button asks for the lock, and only while it is askable', () =>
    Effect.sync(() => {
      // Right-click while unlocked is the platform's context menu and middle is
      // a paste or an autoscroll; grabbing the pointer from either takes away
      // the menu the player was trying to use.
      expect(POINTER_LOCK_ACQUIRE_BUTTON).toBe('MouseLeft')
      expect(acquiresPointerLock('MouseLeft', 'unlocked', 'lock-target')).toBe(true)
      // A refusal usually means the last attempt lacked a user gesture; a click
      // is exactly the gesture that fixes it.
      expect(acquiresPointerLock('MouseLeft', 'refused', 'lock-target')).toBe(true)
      expect(acquiresPointerLock('MouseLeft', 'requested', 'lock-target')).toBe(false)
      expect(acquiresPointerLock('MouseLeft', 'locked', 'lock-target')).toBe(false)
      expect(acquiresPointerLock('MouseRight', 'unlocked', 'lock-target')).toBe(false)
      expect(acquiresPointerLock('MouseMiddle', 'unlocked', 'lock-target')).toBe(false)
    }),
  )

  // ---------------------------------------------------------------------------
  // DN-16 §5(b): the predicate learned WHERE
  // ---------------------------------------------------------------------------

  it.effect('DN-16 §5(b): only a click on the LOCK TARGET asks — a HUD click does not', () =>
    Effect.sync(() => {
      // The hazard as a truth table. The predicate used to be `(button, state)`
      // and every one of these rows was `true` for the left button.
      expect(POINTER_LOCK_ACQUIRE_LANDING).toBe('lock-target')
      expect(acquiresPointerLock('MouseLeft', 'unlocked', 'lock-target')).toBe(true)
      expect(acquiresPointerLock('MouseLeft', 'unlocked', 'ui')).toBe(false)
      expect(acquiresPointerLock('MouseLeft', 'refused', 'ui')).toBe(false)
    }),
  )

  it.effect('DN-16 §5(b): a click on NEITHER asks for nothing — the rule is "on the lock target", not "not on UI"', () =>
    Effect.sync(() => {
      // THE choice DN-16 §5(b) left open, as one assertion. `!== 'ui'` and
      // `=== 'lock-target'` agree on the first two landings and disagree here,
      // and this is where the argument lands: a rule stated as "not UI" grants
      // the pointer to everything the host failed to declare — the letterbox
      // beside a fixed-aspect canvas, a header, the page background — and the
      // cost of forgetting a declaration is a player thrown into mouselook.
      // Stated as "on the lock target", the cost of forgetting one is mouselook
      // that does not engage: visible immediately, and not disorienting.
      expect(acquiresPointerLock('MouseLeft', 'unlocked', 'elsewhere')).toBe(false)
      expect(acquiresPointerLock('MouseLeft', 'refused', 'elsewhere')).toBe(false)
      // `ui` and `elsewhere` decide the same and are still two names, so that a
      // lock target whose identity stopped matching (a host handing over a
      // wrapper) is distinguishable from a correct refusal on the HUD.
      expect(CLICK_LANDINGS).toStrictEqual(['lock-target', 'ui', 'elsewhere'])
    }),
  )

  it.effect('DN-16 §5(b): the landing does not decide whether it is a uiClick — every unlocked click is one', () =>
    Effect.gen(function* () {
      // Filtering the HUD click out of `uiClicks` would have been the cheap
      // fix and the wrong one: the menu that drew the element is exactly what
      // wants to hear about a click on it.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)
      expect([...(yield* input.snapshot).uiClicks]).toStrictEqual(['MouseLeft'])
      // ...and it is NOT a gameplay click either, exactly as before.
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
      // What changed is that the frame can now tell where it landed.
      expect((yield* input.snapshot).uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'ui' },
      ])
    }),
  )

  it.effect('DN-16 §5(b): two clicks in ONE frame keep their own landings', () =>
    Effect.gen(function* () {
      // The reason the reading is a list of PAIRS and not a second set. A
      // player can click a hotbar slot and then the canvas inside one frame,
      // and a shape that lost the pairing would let one landing answer for
      // both — which is the hazard again, with an extra step.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      const snapshot = yield* input.snapshot
      expect(snapshot.uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'ui' },
        { button: 'MouseLeft', landing: 'lock-target' },
      ])
      // One button, so the projection is still one entry — the two readings
      // answer two different questions and cannot disagree about the first.
      expect([...snapshot.uiClicks]).toStrictEqual(['MouseLeft'])
    }),
  )

  it.effect('DN-16 §5(b): one physical click delivered twice is ONE ui click, landing and all', () =>
    Effect.gen(function* () {
      // The same guard `withCodeDown` puts on the `justPressed` edge, applied
      // to the pair: a duplicate `mousedown` must not become two clicks.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

      expect((yield* input.snapshot).uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'ui' },
      ])
    }),
  )

  it.effect('DN-16 §5(b): endFrame clears the landings with the clicks, because both are the same edge', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
      const frame = yield* input.snapshot
      yield* input.endFrame(frame)

      const next = yield* input.snapshot
      expect([...next.uiClicks]).toStrictEqual([])
      expect(next.uiClickLandings).toStrictEqual([])
    }),
  )

  it.effect('DN-16 §5(b): a HUD click does NOT mask the focus ring, and a canvas click does', () =>
    Effect.gen(function* () {
      // The two halves of the symptom, in one place. Clicking a hotbar slot lit
      // the ring (`tabindex="-1"` focuses on click) and then took the pointer,
      // which masked it — the player saw the ring flash and vanish, and was in
      // mouselook. Half one: the ring survives the HUD click.
      const input = yield* makeInputService()

      yield* input.dispatch({
        kind: 'focuschange',
        focus: { group: HOTBAR_FOCUS_GROUP, index: 3 },
      })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

      expect(yield* input.pointerLockState).toBe('unlocked')
      expect(yield* input.keyboardFocus).toStrictEqual({ group: HOTBAR_FOCUS_GROUP, index: 3 })

      // Half two: the mask itself is untouched. A test that only checked the
      // first half would pass if the report had stopped following the lock
      // state at all, which would be a different bug wearing this one's face.
      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
      expect(yield* input.keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('the UI click that asks for the lock is still not a gameplay click', () =>
    Effect.gen(function* () {
      // The whole point of DN-12: the click that re-acquires the lock must not
      // also break a block.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(acquiresPointerLock('MouseLeft', yield* input.pointerLockState, 'lock-target')).toBe(true)
    }),
  )

  it.effect('the adapter plan registers pointerlockerror and says what it answers', () =>
    Effect.sync(() => {
      const entry = LISTENER_PLAN.find((planned) => planned.event === 'pointerlockerror')

      expect(entry).toBeDefined()
      expect(entry?.target).toBe('document')
      expect(entry?.note).toContain('requestPointerLock')
    }),
  )
})

// ---------------------------------------------------------------------------
// Keyboard focus
// ---------------------------------------------------------------------------

/** mx-ui's hotbar slot 3, as this repository names it. 0-based. */
const HOTBAR_SLOT_3 = { group: HOTBAR_FOCUS_GROUP, index: 3 } as const

describe('REGRESSION: keyboard focus is observed, never moved and never suppressed', () => {
  it.effect('a focus change is visible in the snapshot — the half mx-ui was waiting for', () =>
    Effect.gen(function* () {
      // mx-ui built the ring, the roving tabindex and `setKeyboardFocus`, and
      // then stopped: moving focus and observing it are input, and input is
      // this repository's. Until this line held, a player who pressed Tab saw
      // the user agent's ring instead of the palette's, because nothing told
      // mx-ui the keyboard had arrived.
      const input = yield* makeInputService()

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()

      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      expect((yield* input.snapshot).keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
      expect(yield* input.keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('focus leaving the group is undefined and NOT slot zero', () =>
    Effect.gen(function* () {
      // The asymmetry mx-ui's `setKeyboardFocus` has and this must not lose:
      // `undefined` hides every ring, `0` LIGHTS slot 0. Reporting a departure
      // as slot 0 would make the ring follow the player to the address bar.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      yield* input.dispatch({ kind: 'focuschange', focus: undefined })

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
      expect((yield* input.snapshot).keyboardFocus).not.toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 0,
      })
    }),
  )

  it.effect('a move REPLACES rather than accumulating — focus is single-valued', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      // Exactly what the DOM does for one Tab press: focusout from the old
      // element, focusin on the new one, same task, in that order.
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })
      yield* input.dispatch({ kind: 'focuschange', focus: undefined })
      yield* input.dispatch({ kind: 'focuschange', focus: { group: HOTBAR_FOCUS_GROUP, index: 4 } })

      expect((yield* input.snapshot).keyboardFocus).toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 4,
      })
    }),
  )

  it.effect('endFrame does NOT clear it: focus is a LEVEL, like pressed and unlike justPressed', () =>
    Effect.gen(function* () {
      // The rule this had to be consistent with. `endFrame` clears EDGES —
      // `justPressed`, `uiClicks`, the pointer delta — and leaves LEVELS alone.
      // Focus does not happen, focus IS: a ring cleared at the frame boundary
      // would flicker at the refresh rate.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      const frame = yield* input.snapshot
      yield* input.endFrame(frame)
      const next = yield* input.snapshot

      expect(next.justPressed.size).toBe(0)
      expect(next.pressed.has('KeyW')).toBe(true)
      expect(next.keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)

      // And it survives an arbitrary number of them, because nothing consumes it.
      yield* input.endFrame(next)
      yield* input.endFrame(yield* input.snapshot)
      expect((yield* input.snapshot).keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('blur PRESERVES it — the browser does not move focus when the window loses it', () =>
    Effect.gen(function* () {
      // The one thing a blur does not clear, and the exception is deliberate.
      // A window losing focus does not move the DOM focus inside it: the
      // browser restores the same element on return, usually without
      // re-announcing it. Clearing here would hide the ring on a tab switch and
      // never bring it back — mc-render's report and the browser's actual focus
      // would disagree, which is the failure this whole feature exists to fix.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      yield* input.dispatch({ kind: 'blur' })

      const after = yield* input.snapshot
      expect(after.pressed.has('KeyW')).toBe(false)
      expect(after.keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('clearHeld preserves it too, for the same reason', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })
      yield* input.dispatch({ kind: 'keydown', code: 'Space', target: GAMEPLAY_LISTENER_TARGET })

      yield* input.clearHeld

      const after = yield* input.snapshot
      expect(after.pressed.size).toBe(0)
      expect(after.keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('a real focusout DOES clear it, so the ring does not follow the player out', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      // What the adapter translates a `focusout` with no following `focusin`
      // into: the keyboard left and did not arrive anywhere this host named.
      yield* input.dispatch({ kind: 'focuschange', focus: undefined })

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('focus is NOT reported while the pointer is LOCKED — Tab then is not navigation', () =>
    Effect.gen(function* () {
      // The seam, and it is the one `withButtonDown` already draws for clicks:
      // locked, the keys drive an avatar and the player is looking at a world.
      // A ring lit on a hotbar slot then is a lie about what the next key press
      // will do.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
      expect(yield* input.keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('a focus change ARRIVING while locked is still not reported', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: the lock MASKS the focus, it does not forget it', () =>
    Effect.gen(function* () {
      // The bug the mask exists to avoid, played out: Tab to slot 3, click in
      // to look around, press Escape. The browser never moved the focus — it
      // cannot, the pointer lock does not touch the keyboard — so on unlock the
      // ring must come back where it was. A service that CLEARED on lock would
      // show a ring on nothing while the player's next Space activated slot 3.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()

      yield* input.dispatch({ kind: 'pointerlockchange', locked: false })

      expect((yield* input.snapshot).keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('a blur DURING a locked session leaves the focus recoverable as well', () =>
    Effect.gen(function* () {
      // Blur ends the locked session (it sets `unlocked`), so this is the mask
      // lifting by the other route. Both routes must agree, or the ring would
      // depend on how the player left mouselook.
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })
      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      yield* input.dispatch({ kind: 'blur' })

      expect((yield* input.snapshot).pointerLockState).toBe('unlocked')
      expect((yield* input.snapshot).keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('the mask is exactly `locked`: requested and refused still report', () =>
    Effect.sync(() => {
      // `requested` has captured nothing yet — a ring that blinked out for the
      // browser's round trip would blink straight back. `refused` is a state in
      // which DOM UI is the ONLY thing the player has.
      expect(POINTER_LOCK_STATES.filter((state) => !reportsKeyboardFocus(state))).toStrictEqual([
        'locked',
      ])
      expect(reportsKeyboardFocus('unlocked')).toBe(true)
      expect(reportsKeyboardFocus('requested')).toBe(true)
      expect(reportsKeyboardFocus('refused')).toBe(true)
      expect(reportsKeyboardFocus('locked')).toBe(false)
    }),
  )

  it.effect('a refused lock still reports focus — the DOM UI is all the player has', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()
      yield* input.dispatch({ kind: 'focuschange', focus: HOTBAR_SLOT_3 })

      yield* input.dispatch({ kind: 'pointerlockerror' })

      expect((yield* input.snapshot).pointerLockState).toBe('refused')
      expect((yield* input.snapshot).keyboardFocus).toStrictEqual(HOTBAR_SLOT_3)
    }),
  )

  it.effect('the group is carried, so focus on OTHER UI is not focus on the hotbar', () =>
    Effect.gen(function* () {
      // Why `FocusTarget` is not a bare number. mx-ui's hotbar has to be told
      // `undefined` when the keyboard goes to a settings button, and a report
      // that said only "index 2" could not distinguish the two.
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'focuschange', focus: { group: 'settings', index: 2 } })

      const focus = (yield* input.snapshot).keyboardFocus
      expect(focus?.group).toBe('settings')
      expect(focus?.group).not.toBe(HOTBAR_FOCUS_GROUP)
    }),
  )
})

describe('REGRESSION: Tab belongs to the user agent, and is never taken away', () => {
  it.effect('the owner is the user agent, recorded as a value not a comment', () =>
    Effect.sync(() => {
      expect(FOCUS_NAVIGATION_POLICY.key).toBe(FOCUS_NAVIGATION_KEY_CODE)
      expect(FOCUS_NAVIGATION_POLICY.key).toBe('Tab')
      expect(FOCUS_NAVIGATION_POLICY.owner).toBe(FOCUS_NAVIGATION_OWNER)
      expect(FOCUS_NAVIGATION_POLICY.owner).toBe('user-agent')
      // The one field the rest of the record exists to protect.
      expect(FOCUS_NAVIGATION_POLICY.preventDefault).toBe(false)
    }),
  )

  it.effect('consumed arrows may prevent their default, but NOTHING suppresses Tab', () =>
    Effect.sync(() => {
      // A suppressed context menu costs a player "copy" on a chat line; a
      // suppressed scroll costs them the bottom of a settings screen; a
      // suppressed Tab costs them every way out of the canvas — including the
      // settings screen that would let them rebind their way out of it
      // (WCAG 2.1 SC 2.1.2). `keydown` is listed only because a consumed
      // arrow can be prevented; the adapter never consumes Tab.
      expect([...PREVENT_DEFAULT_EVENTS].sort()).toStrictEqual(['contextmenu', 'keydown', 'wheel'])
      expect(mayPreventDefault('keydown')).toBe(true)
      expect(mayPreventDefault('keyup')).toBe(false)
      expect(mayPreventDefault('focusin')).toBe(false)
      expect(mayPreventDefault('focusout')).toBe(false)
    }),
  )

  it.effect('there is NO Tab listener: the browser moves focus and this repository watches', () =>
    Effect.sync(() => {
      // The plan registers no key handler dedicated to Tab, and it must not:
      // implementing Tab would mean reimplementing the platform's focus order,
      // and then `preventDefault()` to stop the platform running its own.
      expect(LISTENER_PLAN.some((planned) => planned.event.toLowerCase().includes('tab'))).toBe(false)
      expect(FOCUS_NAVIGATION_POLICY.registeredBy).toContain('focusin')
    }),
  )

  it.effect('Tab cannot be bound to an action — the owner that cannot be removed gets no second', () =>
    Effect.sync(() => {
      const outcome = remap(defaultBindings(), 'jump', FOCUS_NAVIGATION_KEY_CODE)

      expect(outcome.kind).toBe('rejected')
      expect(outcome.kind === 'rejected' && outcome.rejection.reason).toBe(
        'key-reserved-by-user-agent',
      )
    }),
  )

  it.effect('a rejected Tab rebind leaves the service state untouched', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      const outcome = yield* input.rebind('attack', FOCUS_NAVIGATION_KEY_CODE)

      expect(outcome.kind).toBe('rejected')
      expect((yield* input.bindings)['attack']).toBe('MouseLeft')
    }),
  )

  it.effect('actionForKey never resolves Tab, even from a corrupt persisted blob', () =>
    Effect.sync(() => {
      // `remap` refuses to WRITE it; this is the other door. A settings blob
      // written before the rule existed, or by hand, arrives here directly.
      const corrupt = { ...defaultBindings(), jump: FOCUS_NAVIGATION_KEY_CODE }

      expect(actionForKey(corrupt, FOCUS_NAVIGATION_KEY_CODE)).toBeUndefined()
      expect(actionForKey(corrupt, 'KeyW')).toBe('moveForward')
    }),
  )

  it.effect('no default binding uses Tab, and none uses Escape', () =>
    Effect.sync(() => {
      const bound = Object.values(defaultBindings())

      expect(bound).not.toContain(FOCUS_NAVIGATION_KEY_CODE)
      expect(bound).not.toContain(ESCAPE_KEY_CODE)
    }),
  )

  it.effect('a Tab keydown still reaches the service as an ordinary held code', () =>
    Effect.gen(function* () {
      // Not swallowed, not special-cased, not prevented. It simply drives no
      // action, exactly as Escape does — and the browser has already moved the
      // focus by the time this is recorded.
      const input = yield* makeInputService()

      yield* input.dispatch({
        kind: 'keydown',
        code: FOCUS_NAVIGATION_KEY_CODE,
        target: GAMEPLAY_LISTENER_TARGET,
      })

      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.has('Tab')).toBe(true)
      for (const action of INPUT_ACTIONS) {
        expect(yield* input.isActionActive(action)).toBe(false)
      }
    }),
  )

  it.effect('Escape and Tab have OPPOSITE policy shapes, and that is the design', () =>
    Effect.sync(() => {
      // Escape's owner is one this codebase chose and could move: a frame-level
      // handler inside the app. Tab's owner is outside the app and cannot be
      // moved, only overridden — which is the keyboard trap. So one policy
      // names an owner inside and forbids a second; the other names an owner
      // outside and forbids the app from becoming one.
      expect(ESCAPE_POLICY.owner).toBe('frame-handler')
      expect(FOCUS_NAVIGATION_POLICY.owner).toBe('user-agent')
      expect(FOCUS_NAVIGATION_POLICY.rationale).toContain('2.1.2')
    }),
  )
})

describe('the focus listeners are planned, on the target the browser dispatches them to', () => {
  it.effect('focusin and focusout are both registered, and on document', () =>
    Effect.sync(() => {
      const focusin = LISTENER_PLAN.find((planned) => planned.event === 'focusin')
      const focusout = LISTENER_PLAN.find((planned) => planned.event === 'focusout')

      expect(focusin).toBeDefined()
      expect(focusout).toBeDefined()
      expect(focusin?.target).toBe(MODAL_LISTENER_TARGET)
      expect(focusout?.target).toBe(MODAL_LISTENER_TARGET)
    }),
  )

  it.effect('they are focusIN and focusOUT, because only those two BUBBLE', () =>
    Effect.sync(() => {
      // `focus` and `blur` do not bubble, so covering the hotbar with them would
      // mean a listener on every slot mx-ui creates — i.e. this repository
      // knowing about elements it does not own, and re-installing whenever the
      // HUD rebuilt. One listener on `document` covers slots that do not exist
      // yet.
      const events = LISTENER_PLAN.map((planned) => planned.event)

      expect(events).toContain('focusin')
      expect(events).toContain('focusout')
      expect(events.filter((event) => event === 'focus')).toStrictEqual([])
      expect(LISTENER_PLAN.find((planned) => planned.event === 'focusin')?.note).toContain('bubbles')
    }),
  )

  it.effect('the focus listeners are NOT gameplay listeners — no code goes on document', () =>
    Effect.sync(() => {
      // The shielding rule is about keys and buttons. Focus events join the
      // pointer and wheel events on `document`: they do not participate, and
      // nothing about them moves a gameplay listener off `window`.
      const gameplay = LISTENER_PLAN.filter((planned) =>
        ['keydown', 'keyup', 'mousedown', 'mouseup', 'blur'].includes(planned.event),
      )

      expect(gameplay).toHaveLength(5)
      expect(gameplay.every((planned) => planned.target === GAMEPLAY_LISTENER_TARGET)).toBe(true)
    }),
  )
})
