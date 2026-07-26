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
  INPUT_ACTIONS,
  isMouseButton,
  MODAL_LISTENER_TARGET,
  modalConsumedKeyReachesGameplay,
  MOUSE_BUTTONS,
  mouseButtonForIndex,
  remap,
  suppressesBrowserContextMenu,
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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.wasActionJustTriggered('attack')).toBe(true)
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)
      // Reading it twice in one frame is still the same one edge.
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)

      yield* input.endFrame

      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(false)
    }),
  )

  it.effect('a held button stays down across frames, so hold-to-break keeps breaking', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.endFrame
      yield* input.endFrame

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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

      expect((yield* input.snapshot).justPressed.size).toBe(1)
    }),
  )

  it.effect('attack fires from the LEFT button and use from the RIGHT, not the other way round', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('use')).toBe(true)
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasActionJustTriggered('pickBlock')).toBe(false)
    }),
  )

  it.effect('the middle button is pickBlock and fires neither attack nor use', () =>
    Effect.gen(function* () {
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseMiddle', target: GAMEPLAY_LISTENER_TARGET })

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
      yield* input.endFrame
      yield* input.dispatch({ kind: 'keyup', code: 'KeyB', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
      expect(yield* input.isButtonDown('MouseLeft')).toBe(true)

      yield* input.dispatch({ kind: 'blur' })

      expect(yield* input.isButtonDown('MouseLeft')).toBe(false)
      expect(yield* input.isActionActive('attack')).toBe(false)
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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: MODAL_LISTENER_TARGET })

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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasActionJustTriggered('use')).toBe(true)
      expect(yield* input.wasUiClick('MouseRight')).toBe(false)
    }),
  )

  it.effect('a click while UNLOCKED never fires attack — a menu click must not break a block', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })

      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)
      expect((yield* input.snapshot).uiClicks.has('MouseLeft')).toBe(true)
    }),
  )

  it.effect('endFrame clears the UI click edge as well as the gameplay edge', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.endFrame

      expect(yield* input.wasUiClick('MouseLeft')).toBe(false)
      expect((yield* input.snapshot).uiClicks.size).toBe(0)
    }),
  )

  it.effect('losing the lock releases held buttons, so breaking stops when the pause menu opens', () =>
    Effect.gen(function* () {
      // Hold left to break, press Escape: the browser exits pointer lock and no
      // mouseup is coming, because the next click goes to the menu.
      const input = yield* lockedInput

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
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

      yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'contextmenu', target: GAMEPLAY_LISTENER_TARGET })

      expect((yield* input.snapshot).justPressed.size).toBe(1)

      yield* input.endFrame
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
