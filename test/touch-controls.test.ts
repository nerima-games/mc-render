/**
 * PORTED E2E: the on-screen controls.
 *
 * Reference: ts-minecraft/e2e/mobile/mobile-touch-controls.e2e.ts
 *   `controls fit the safe viewport`                    (row #34)
 *   `inventory and pause are operable without a keyboard` (row #35)
 *
 * mc-compose/docs/e2e-triage.md §3.5 rows #34-35. Both were originally demoted
 * to mx-ui and both were CORRECTED to mc-render on 2026-07-27, on a measurement
 * rather than an intuition: mx-ui's `application/dom-surface.ts` deliberately
 * declares no `addEventListener` (DN-UI-4 — the omission is what keeps Escape a
 * single-owner key), and this repository's declares one at :172. A tap IS an
 * `addEventListener`. "Is the verb in the vocabulary" is a checkable criterion
 * where "is it an input surface" is an argument.
 *
 * ---------------------------------------------------------------------------
 * Which half of #34 is here, and which half is not
 * ---------------------------------------------------------------------------
 *
 * NOT HERE: the 48px hit target and the safe-area inset. Both are LAYOUT, and
 * this repository cannot measure layout without lying about it — it ships no
 * `lib.DOM`, `application/dom-surface.ts` contains no geometry by design, and a
 * `getBoundingClientRect` in Node returns zeroes. A test asserting `48` against
 * a number a fake produced would assert that the fake was written correctly.
 * The triage says the same thing in its own row: 「34 の残り半分(48px の当たり
 * 判定とセーフエリア)はレイアウトなので、どちらにせよブラウザが要る」.
 *
 * HERE: the failure underneath the layout one, and the worse of the two. A
 * control can be 48px, correctly inset, and BOUND TO NOTHING. The player
 * reaches it, presses it, and the game does not respond — which reads as a
 * broken game rather than as a cramped one. `unboundTouchActions` is the check,
 * and it is answerable with no browser at all because it is a question about the
 * binding table.
 *
 * ---------------------------------------------------------------------------
 * What #35 actually claims
 * ---------------------------------------------------------------------------
 *
 * Not "touch is supported". The claim is that a tap binds to the SAME INTENT a
 * key does, and the tests below are written to fail if it merely binds to a
 * parallel one that happens to agree today. The sharpest form is the rebind
 * test: move `openInventory` off `KeyE` and the on-screen inventory button must
 * follow, because a touch vocabulary with its own codes would not.
 *
 * ---------------------------------------------------------------------------
 * The hazard this feature had to not reopen
 * ---------------------------------------------------------------------------
 *
 * DN-16 §5(b) was a LIVE DEFECT: clicking the HUD acquired the pointer lock,
 * because `acquiresPointerLock` knew the button and the lock state and nothing
 * about where the click landed. The fix scoped acquisition to the lock target
 * with a closed three-value `ClickLanding` rather than an open "not UI" test.
 * Adding a second input source is exactly the occasion to reopen it, so the last
 * describe block is entirely about proving that a tap cannot take the pointer —
 * by the touch path, and by the compatibility `mousedown` a browser synthesises
 * from a tap.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  acquiresPointerLock,
  bindingFor,
  codeForTouchAction,
  defaultBindings,
  ESCAPE_KEY_CODE,
  GAMEPLAY_LISTENER_TARGET,
  MODAL_LISTENER_TARGET,
  TOUCH_LOOK_IDLE,
  touchLookStep,
  unboundTouchActions,
  type Bindings,
  type InputAction,
} from '../src/domain/input-bindings'
import {
  LISTENER_PLAN,
  makeInputService,
  type InputEvent,
} from '../src/application/input-service'
import {
  installInputListeners,
  resolveClickLanding,
  resolveTouchControl,
  translateDomEvent,
  TRANSLATED_DOM_EVENTS,
  type TouchControlTarget,
} from '../src/application/browser-input-adapter'
import type { DomInputEvent, DomListener, DomListenerOptions } from '../src/application/dom-surface'

// ---------------------------------------------------------------------------
// The controls a mobile host would draw
// ---------------------------------------------------------------------------

/**
 * Opaque stand-ins for the elements a host creates.
 *
 * Distinct objects and nothing else, because that is ALL the adapter is allowed
 * to see: `TouchControlTarget.target` is `unknown` and the only operation on it
 * is `===`. A test that gave these `getAttribute` would be testing an adapter
 * this repository refused to write.
 */
const inventoryButton = { name: 'inventory-button' }
const pauseButton = { name: 'pause-button' }
const jumpButton = { name: 'jump-button' }
const attackButton = { name: 'attack-button' }
const undeclaredDecoration = { name: 'a-thing-the-host-never-declared' }
const canvas = { name: 'canvas' }

/** The roster #35 needs: inventory and pause, operable with no keyboard. */
const MOBILE_CONTROLS: ReadonlyArray<TouchControlTarget> = [
  { action: 'openInventory', target: inventoryButton },
  { action: 'escape', target: pauseButton },
  { action: 'jump', target: jumpButton },
  { action: 'attack', target: attackButton },
]

const tap = (action: InputAction): InputEvent => ({
  kind: 'touchpress',
  action,
  target: GAMEPLAY_LISTENER_TARGET,
})

const release = (action: InputAction): InputEvent => ({
  kind: 'touchrelease',
  action,
  target: GAMEPLAY_LISTENER_TARGET,
})

const key = (kind: 'keydown' | 'keyup', code: string): InputEvent => ({
  kind,
  code,
  target: GAMEPLAY_LISTENER_TARGET,
})

/** A plan entry by name, so a test reads the target from the plan and not from itself. */
const planned = (event: string) => {
  const entry = LISTENER_PLAN.find((candidate) => candidate.event === event)
  if (entry === undefined) {
    throw new Error(`LISTENER_PLAN has no entry for '${event}'`)
  }
  return entry
}

const noop = (): void => undefined

const domEvent = (target: unknown): DomInputEvent => ({ preventDefault: noop, target })

const touchEvent = (
  target: unknown,
  ...touches: ReadonlyArray<{ readonly identifier: number; readonly target: unknown }>
): DomInputEvent => ({ preventDefault: noop, target, changedTouches: touches })

// ---------------------------------------------------------------------------
// #35 — the tap and the key are the same intent
// ---------------------------------------------------------------------------

describe('PORTED #35: a tap binds to the same intent a key does', () => {
  it.effect('the on-screen inventory button presses exactly what the inventory KEY presses', () =>
    Effect.gen(function* () {
      const bindings = defaultBindings()
      // The claim, as a value: the control resolves to the code the binding
      // table already holds for that action. Not "some code" — THE code.
      expect(codeForTouchAction(bindings, 'openInventory')).toBe(
        bindingFor(bindings, 'openInventory'),
      )
      expect(codeForTouchAction(bindings, 'openInventory')).toBe('KeyE')

      const input = yield* makeInputService()
      yield* input.dispatch(tap('openInventory'))

      // And the claim as behaviour: every read a consumer has agrees with the
      // keyboard's. If touch had its own vocabulary, `isActionActive` would be
      // false here and only a touch-shaped read would be true.
      expect(yield* input.isActionActive('openInventory')).toBe(true)
      expect(yield* input.wasActionJustTriggered('openInventory')).toBe(true)
      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.has('KeyE')).toBe(true)
    }),
  )

  it.effect('a tap and a key press are INDISTINGUISHABLE downstream of dispatch', () =>
    Effect.gen(function* () {
      // The strongest form of #35, and the reason `withTouchDown` reuses
      // `withCodeDown` rather than adding a mechanism: two services fed the two
      // devices must not merely agree about the action, they must hold equal
      // state. Anything a parallel touch channel added would show up here.
      const tapped = yield* makeInputService()
      yield* tapped.dispatch(tap('openInventory'))
      const tappedSnapshot = yield* tapped.snapshot

      const typed = yield* makeInputService()
      yield* typed.dispatch(key('keydown', 'KeyE'))
      const typedSnapshot = yield* typed.snapshot

      expect([...tappedSnapshot.pressed]).toStrictEqual([...typedSnapshot.pressed])
      expect([...tappedSnapshot.justPressed]).toStrictEqual([...typedSnapshot.justPressed])
      expect(tappedSnapshot.uiClickLandings).toStrictEqual(typedSnapshot.uiClickLandings)
      expect([...tappedSnapshot.uiClicks]).toStrictEqual([...typedSnapshot.uiClicks])
    }),
  )

  it.effect('REGRESSION: rebinding the ACTION moves the on-screen button with it', () =>
    Effect.gen(function* () {
      // The test a parallel touch vocabulary fails. `TouchInventory` as a code
      // would still work above and would still work below — and would go on
      // pressing its own thing after the player rebound the keyboard, so the
      // settings screen would silently describe only half the input.
      const input = yield* makeInputService()
      const outcome = yield* input.rebind('openInventory', 'KeyI')
      expect(outcome.kind).toBe('ok')

      yield* input.dispatch(tap('openInventory'))
      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.has('KeyI')).toBe(true)
      expect(snapshot.pressed.has('KeyE')).toBe(false)
      expect(yield* input.isActionActive('openInventory')).toBe(true)
    }),
  )

  it.effect('PAUSE is operable without a keyboard, and Escape still has ONE owner', () =>
    Effect.gen(function* () {
      // The half of #35 that could not go through the binding table: `remap`
      // refuses Escape and `bindingFor` returns undefined for it, because a
      // second binding is a second owner. A touch device has no Escape key at
      // all, so the pause button emits the KEY CODE directly — the same code the
      // keyboard emits, read by the same single frame-level handler.
      expect(codeForTouchAction(defaultBindings(), 'escape')).toBe(ESCAPE_KEY_CODE)
      expect(bindingFor(defaultBindings(), 'escape')).toBeUndefined()

      const input = yield* makeInputService()
      yield* input.dispatch(tap('escape'))
      const snapshot = yield* input.snapshot

      // In `justPressed` as a raw code, which is exactly where a keyboard
      // Escape lands and is what the frame handler reads.
      expect(snapshot.justPressed.has(ESCAPE_KEY_CODE)).toBe(true)
      // And still bound to NO action, so nothing has become a second owner.
      expect(yield* input.isActionActive('escape')).toBe(false)
      expect(yield* input.wasActionJustTriggered('escape')).toBe(false)
    }),
  )

  it.effect('a held control stays held, and its release releases it', () =>
    Effect.gen(function* () {
      // A touch d-pad is HELD, not tapped, so the release half is load-bearing.
      const input = yield* makeInputService()
      yield* input.dispatch(tap('jump'))
      expect(yield* input.isActionActive('jump')).toBe(true)
      yield* input.dispatch(release('jump'))
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )

  it.effect('a repeated press does not re-fire the edge, exactly as a held key does not', () =>
    Effect.gen(function* () {
      // `withCodeDown`'s auto-repeat guard, inherited rather than reimplemented.
      // Without it a finger resting on the inventory button opens and closes the
      // inventory at the event rate.
      const input = yield* makeInputService()
      yield* input.dispatch(tap('openInventory'))
      yield* input.endFrame()
      yield* input.dispatch(tap('openInventory'))
      expect(yield* input.wasActionJustTriggered('openInventory')).toBe(false)
      expect(yield* input.isActionActive('openInventory')).toBe(true)
    }),
  )

  it.effect('a modal that consumed the tap shields it, as it shields a key', () =>
    Effect.gen(function* () {
      // The touch listeners sit on `window` with the keys and the buttons
      // precisely so this rule covers all three devices with one mechanism.
      const input = yield* makeInputService()
      yield* input.dispatch({
        kind: 'touchpress',
        action: 'openInventory',
        target: MODAL_LISTENER_TARGET,
      })
      expect(yield* input.isActionActive('openInventory')).toBe(false)
    }),
  )

  it.effect('a control bound to nothing does nothing — no state, no throw', () =>
    Effect.gen(function* () {
      const stripped: Bindings = { ...defaultBindings(), openInventory: undefined as never }
      const input = yield* makeInputService(stripped)
      yield* input.dispatch(tap('openInventory'))
      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.size).toBe(0)
      expect(snapshot.justPressed.size).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// #35 — through the real listener path, against the fake surface
// ---------------------------------------------------------------------------

describe('PORTED #35: the same claim through the browser adapter', () => {
  it.effect('LISTENER_PLAN registers the touch trio on window, and the adapter translates all three', () =>
    Effect.sync(() => {
      // On `window`, not `document`: a tap is gameplay input a modal must be
      // able to shield, which is the argument that moved mousedown/mouseup too.
      for (const event of ['touchstart', 'touchend', 'touchcancel']) {
        expect(planned(event).target).toBe(GAMEPLAY_LISTENER_TARGET)
        expect(TRANSLATED_DOM_EVENTS).toContain(event)
      }
    }),
  )

  it.effect('touchstart on a declared control produces the press its roster says', () =>
    Effect.sync(() => {
      const translated = translateDomEvent(planned('touchstart'), domEvent(inventoryButton), {
        pointerLockHeld: false,
        focusGroups: [],
        touchControls: MOBILE_CONTROLS,
      })
      expect(translated).toStrictEqual({
        kind: 'touchpress',
        action: 'openInventory',
        target: GAMEPLAY_LISTENER_TARGET,
      })
    }),
  )

  it.effect('touchcancel releases, because no touchend is coming after one', () =>
    Effect.sync(() => {
      // The platform fires `touchcancel` INSTEAD of `touchend` when it takes the
      // gesture (a system edge-swipe, an incoming call). An adapter that
      // listened only for `touchend` would leave the forward button held for the
      // rest of the session.
      for (const event of ['touchend', 'touchcancel']) {
        expect(
          translateDomEvent(planned(event), domEvent(jumpButton), {
            pointerLockHeld: false,
            focusGroups: [],
            touchControls: MOBILE_CONTROLS,
          }),
        ).toStrictEqual({ kind: 'touchrelease', action: 'jump', target: GAMEPLAY_LISTENER_TARGET })
      }
    }),
  )

  it.effect('a tap on something nobody declared is DROPPED, not guessed at', () =>
    Effect.sync(() => {
      // The boundary rule this repository states for `mouseButtonForIndex` and
      // `wheelDeltaModeForIndex`, applied to an element. Reporting it as the
      // first control — which is what a careless `indexOf` clamp would do —
      // would make a tap on the background jump.
      expect(resolveTouchControl(MOBILE_CONTROLS, undeclaredDecoration)).toBeUndefined()
      expect(resolveTouchControl(MOBILE_CONTROLS, null)).toBeUndefined()
      expect(resolveTouchControl(MOBILE_CONTROLS, undefined)).toBeUndefined()
      expect(resolveTouchControl([], inventoryButton)).toBeUndefined()
      expect(
        translateDomEvent(planned('touchstart'), domEvent(undeclaredDecoration), {
          pointerLockHeld: false,
          focusGroups: [],
          touchControls: MOBILE_CONTROLS,
        }),
      ).toBeUndefined()
    }),
  )

  it.effect('a real tap, end to end: fake window in, action out', () =>
    Effect.gen(function* () {
      // The headless port of what the reference did with `page.tap()`. Every
      // layer runs: the listener the adapter installed, the roster resolution,
      // the binding lookup, and the service state.
      const added: Array<{ type: string; listener: DomListener }> = []
      const target = {
        addEventListener: (type: string, listener: DomListener, _options?: DomListenerOptions) => {
          added.push({ type, listener })
        },
        removeEventListener: noop,
      }
      const targets = { window: target, document: { ...target, pointerLockElement: null } }

      const input = yield* makeInputService()
      installInputListeners(targets, input, [], canvas, MOBILE_CONTROLS)

      const fire = (type: string, element: unknown): void => {
        for (const call of added.filter((candidate) => candidate.type === type)) {
          call.listener(domEvent(element))
        }
      }

      fire('touchstart', inventoryButton)
      expect(yield* input.isActionActive('openInventory')).toBe(true)
      fire('touchend', inventoryButton)
      expect(yield* input.isActionActive('openInventory')).toBe(false)

      fire('touchstart', pauseButton)
      const snapshot = yield* input.snapshot
      expect(snapshot.justPressed.has(ESCAPE_KEY_CODE)).toBe(true)
    }),
  )

  it.effect('touchend releases the action remembered at touchstart, not its retargeted element', () =>
    Effect.gen(function* () {
      const added: Array<{ type: string; listener: DomListener }> = []
      const target = {
        addEventListener: (type: string, listener: DomListener, _options?: DomListenerOptions) => {
          added.push({ type, listener })
        },
        removeEventListener: noop,
      }
      const targets = { window: target, document: { ...target, pointerLockElement: null } }
      const input = yield* makeInputService()
      installInputListeners(targets, input, [], canvas, MOBILE_CONTROLS)

      const fire = (type: string, event: DomInputEvent): void => {
        for (const call of added.filter((candidate) => candidate.type === type)) {
          call.listener(event)
        }
      }

      fire('touchstart', touchEvent(inventoryButton, { identifier: 17, target: inventoryButton }))
      expect(yield* input.isActionActive('openInventory')).toBe(true)
      fire('touchend', touchEvent(canvas, { identifier: 17, target: canvas }))
      expect(yield* input.isActionActive('openInventory')).toBe(false)
    }),
  )

  it.effect('multiple touches release only their own action and share an action until its last finger ends', () =>
    Effect.gen(function* () {
      const added: Array<{ type: string; listener: DomListener }> = []
      const target = {
        addEventListener: (type: string, listener: DomListener, _options?: DomListenerOptions) => {
          added.push({ type, listener })
        },
        removeEventListener: noop,
      }
      const targets = { window: target, document: { ...target, pointerLockElement: null } }
      const input = yield* makeInputService()
      installInputListeners(targets, input, [], canvas, MOBILE_CONTROLS)
      const fire = (type: string, event: DomInputEvent): void => {
        for (const call of added.filter((candidate) => candidate.type === type)) {
          call.listener(event)
        }
      }

      fire(
        'touchstart',
        touchEvent(
          jumpButton,
          { identifier: 1, target: jumpButton },
          { identifier: 2, target: attackButton },
          { identifier: 3, target: jumpButton },
        ),
      )
      expect(yield* input.isActionActive('jump')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(true)

      fire('touchcancel', touchEvent(canvas, { identifier: 1, target: canvas }))
      expect(yield* input.isActionActive('jump')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(true)

      fire('touchend', touchEvent(canvas, { identifier: 2, target: canvas }))
      expect(yield* input.isActionActive('jump')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(false)

      fire('touchend', touchEvent(canvas, { identifier: 3, target: canvas }))
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )
})

// ---------------------------------------------------------------------------
// #34 — the half that is answerable without a browser
// ---------------------------------------------------------------------------

describe('PORTED #34 (input half): no declared control is DEAD', () => {
  it.effect('a roster whose actions are all bound has nothing to report', () =>
    Effect.sync(() => {
      const actions = MOBILE_CONTROLS.map((control) => control.action)
      expect(unboundTouchActions(defaultBindings(), actions)).toStrictEqual([])
    }),
  )

  it.effect('a control whose action lost its binding is named', () =>
    Effect.sync(() => {
      // The failure that is worse than a cramped hit target: the button is
      // reachable, it depresses, and the game does not respond. A host runs
      // this once at setup instead of hearing about it from a player.
      const stripped: Bindings = { ...defaultBindings(), jump: undefined as never }
      expect(unboundTouchActions(stripped, ['jump', 'openInventory'])).toStrictEqual(['jump'])
    }),
  )

  it.effect('a pause control is never reported dead, though nothing binds Escape', () =>
    Effect.sync(() => {
      // The one case where "not in the binding table" does not mean "dead", and
      // the reason `codeForTouchAction` exists rather than the roster calling
      // `bindingFor` itself.
      expect(unboundTouchActions(defaultBindings(), ['escape'])).toStrictEqual([])
    }),
  )
})

// ---------------------------------------------------------------------------
// #36's arithmetic — the computation, not the claim
// ---------------------------------------------------------------------------

describe("the look gesture's arithmetic (row #36 itself remains mc-compose's)", () => {
  it.effect('the touch that STARTS a look rotates nothing', () =>
    Effect.sync(() => {
      // A `Touch` reports an absolute `clientX`, unlike `MouseEvent.movementX`
      // which is already a delta. Handing the absolute coordinate to a camera
      // spins the player by the pixel position of their finger.
      const started = touchLookStep(TOUCH_LOOK_IDLE, 'press', { x: 300, y: 400 })
      expect(started.delta).toStrictEqual({ x: 0, y: 0 })
      expect(started.state.anchor).toStrictEqual({ x: 300, y: 400 })
    }),
  )

  it.effect('a drag reports the difference and re-anchors', () =>
    Effect.sync(() => {
      const started = touchLookStep(TOUCH_LOOK_IDLE, 'press', { x: 300, y: 400 })
      const moved = touchLookStep(started.state, 'move', { x: 310, y: 380 })
      expect(moved.delta).toStrictEqual({ x: 10, y: -20 })
      // Re-anchored, so the NEXT move reports its own travel and not the total.
      const again = touchLookStep(moved.state, 'move', { x: 315, y: 380 })
      expect(again.delta).toStrictEqual({ x: 5, y: 0 })
    }),
  )

  it.effect('REGRESSION: a release forgets the anchor, so the next drag cannot snap', () =>
    Effect.sync(() => {
      // Row #36's "releases cleanly", as a property of the reducer. With the
      // anchor surviving, a second gesture anywhere else on screen computes its
      // first delta from where the FIRST one ended and the camera jumps the
      // whole distance in one frame. DN-09 in a different device.
      const started = touchLookStep(TOUCH_LOOK_IDLE, 'press', { x: 300, y: 400 })
      const released = touchLookStep(started.state, 'release', { x: 300, y: 400 })
      expect(released.state).toStrictEqual(TOUCH_LOOK_IDLE)

      const strayMove = touchLookStep(released.state, 'move', { x: 20, y: 900 })
      expect(strayMove.delta).toStrictEqual({ x: 0, y: 0 })

      const secondGesture = touchLookStep(released.state, 'press', { x: 20, y: 900 })
      expect(secondGesture.delta).toStrictEqual({ x: 0, y: 0 })
      expect(touchLookStep(secondGesture.state, 'move', { x: 25, y: 900 }).delta).toStrictEqual({
        x: 5,
        y: 0,
      })
    }),
  )

  it.effect('a non-finite coordinate yields zero and does NOT poison the anchor', () =>
    Effect.sync(() => {
      // One NaN in a rotation poisons the pose for the rest of the session —
      // the failure `notchesForWheelDelta` guards on its own side. Anchoring on
      // it would be worse than dropping it: every later move would emit NaN.
      const started = touchLookStep(TOUCH_LOOK_IDLE, 'press', { x: 300, y: 400 })
      const broken = touchLookStep(started.state, 'move', { x: Number.NaN, y: 400 })
      expect(broken.delta).toStrictEqual({ x: 0, y: 0 })
      expect(broken.state.anchor).toStrictEqual({ x: 300, y: 400 })
      expect(touchLookStep(broken.state, 'move', { x: 320, y: 400 }).delta).toStrictEqual({
        x: 20,
        y: 0,
      })
    }),
  )
})

// ---------------------------------------------------------------------------
// The hazard: DN-16 §5(b) must stay closed
// ---------------------------------------------------------------------------

describe('REGRESSION: a tap can NOT reach pointer-lock acquisition', () => {
  it.effect('a tap produces no UiClick at all, so the frame has nothing to act on', () =>
    Effect.gen(function* () {
      // `stages/registration.ts` asks for the pointer from
      // `InputSnapshot.uiClickLandings` and from nothing else. A touch press
      // goes through `withCodeDown`, never `withButtonDown`, so it cannot put an
      // entry there — including the `attack` control, which resolves to
      // `MouseLeft` and is the one that looks most like a click.
      const input = yield* makeInputService()
      yield* input.dispatch(tap('attack'))
      const snapshot = yield* input.snapshot

      expect(snapshot.uiClickLandings).toStrictEqual([])
      expect(snapshot.uiClicks.size).toBe(0)
      expect(yield* input.wasUiClick('MouseLeft')).toBe(false)
      // ...and it IS a gameplay press, so hold-to-break works from glass.
      expect(yield* input.isButtonDown('MouseLeft')).toBe(true)
      expect(snapshot.pointerLockState).toBe('unlocked')
    }),
  )

  it.effect("the synthesised mousedown a browser makes from a tap lands 'ui' or 'elsewhere', never 'lock-target'", () =>
    Effect.sync(() => {
      // Touch is NOT in `PREVENT_DEFAULT_EVENTS`, so the browser still
      // synthesises a compatibility `mousedown` from a tap. That event carries
      // the CONTROL as its target, and this is the check that it cannot take the
      // pointer.
      //
      // The closed-world rule is what makes it true. Under the open form
      // `landing !== 'ui'` an undeclared control would read "not UI" and every
      // tap would grab the pointer; under `=== 'lock-target'` the worst case is
      // that mouselook does not engage, which is visible on the first try.
      const groups = [{ group: 'touch', targets: [inventoryButton, pauseButton] }]
      expect(resolveClickLanding(canvas, groups, inventoryButton)).toBe('ui')
      expect(resolveClickLanding(canvas, [], inventoryButton)).toBe('elsewhere')
      expect(resolveClickLanding(canvas, [], undeclaredDecoration)).toBe('elsewhere')

      for (const landing of ['ui', 'elsewhere'] as const) {
        expect(acquiresPointerLock('MouseLeft', 'unlocked', landing)).toBe(false)
        expect(acquiresPointerLock('MouseLeft', 'refused', landing)).toBe(false)
      }
      // The one landing that does acquire, kept in the test so the assertions
      // above cannot pass by the predicate having become constantly false.
      expect(acquiresPointerLock('MouseLeft', 'unlocked', 'lock-target')).toBe(true)
    }),
  )

  it.effect('the roster is matched by IDENTITY, never by shape — which is what keeps the DOM surface closed', () =>
    Effect.sync(() => {
      // `DomInputEvent.target` was added for `focusin` and reused twice since;
      // a tap is the third reader, and it reads it the same way — `===`, and
      // nothing else. That is why touch cost the DOM surface no member: no
      // `TouchList`, no `clientX`, and so nothing new for the assignability
      // proof in `test/fixtures/dom-surface.ts` to survive.
      //
      // The mutation this guards against is the plausible one: matching by
      // attribute or by shape. mx-ui's `data-slot-index` is region-LOCAL, so
      // two controls in different regions are equal by shape and are not the
      // same button — and reading an attribute would put `getAttribute` in
      // `dom-surface.ts`, which breaks the proof outright.
      const lookalike = { name: 'inventory-button' }
      expect(lookalike).toStrictEqual(inventoryButton)
      expect(resolveTouchControl(MOBILE_CONTROLS, lookalike)).toBeUndefined()
      expect(resolveTouchControl(MOBILE_CONTROLS, inventoryButton)).toBe('openInventory')

      const event: DomInputEvent = domEvent(lookalike)
      expect(
        translateDomEvent(planned('touchstart'), event, {
          pointerLockHeld: false,
          focusGroups: [],
          touchControls: MOBILE_CONTROLS,
        }),
      ).toBeUndefined()
    }),
  )
})
