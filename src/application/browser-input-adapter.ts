/**
 * The browser adapter for `InputService`: real DOM events in, `InputEvent`s out.
 *
 * This is the file `application/input-service.ts` promised — "a thin Layer that
 * builds an event source from `window` and `document` and registers exactly the
 * listeners recorded in `GAMEPLAY_LISTENER_TARGET` / `MODAL_LISTENER_TARGET`".
 * It is the reference's `input-service.ts:171-205`, and it is deliberately the
 * only file in this repository that knows what an `addEventListener` is.
 *
 * ---------------------------------------------------------------------------
 * It does not turn `"DOM"` on, and that is the whole design
 * ---------------------------------------------------------------------------
 *
 * See the header of `dom-surface.ts` for the argument and for how the choice is
 * proved rather than asserted. In one line: the DOM is described structurally,
 * narrowly, in one file, so `tsconfig.build.json` still compiles the entire
 * shipped surface with `lib: ["ES2024"]` and `types: []` — which is what keeps
 * `environment: 'node'` able to test the parts that no browser test could reach
 * (plan.md §3.10: Playwright is on SwiftShader and cannot do pointer lock).
 *
 * ---------------------------------------------------------------------------
 * What this file is allowed to decide, and what it is not
 * ---------------------------------------------------------------------------
 *
 * NOT ALLOWED, because a decision made here is a decision no test can reach:
 *
 *   - WHERE a listener goes. `LISTENER_PLAN` says, and this file MAPS over it.
 *     Adding an entry to the plan without a translation for it is a test
 *     failure, not a silently ignored event.
 *   - WHETHER to `preventDefault()`. `suppressesBrowserScroll` and
 *     `suppressesBrowserContextMenu` are the predicates and
 *     `shouldSuppressWheelScroll` / `shouldSuppressContextMenu` apply the lock
 *     state to them. This file reads them; it never re-decides.
 *   - How many pixels make a wheel notch. `notchesForWheelDelta`, in the domain.
 *   - WHEN to ask for the pointer lock. `acquiresPointerLock` decides and the
 *     `render:input` stage acts; this file only performs the ask.
 *   - WHETHER a focus change is worth showing. `reportsKeyboardFocus` is the
 *     predicate and the service applies it; this file reports what the browser
 *     did and never judges it.
 *
 * ALLOWED, and it is all of the same kind — an OPAQUE THING to a NAME at the
 * boundary:
 *
 *   - `MouseEvent.button` -> `mouseButtonForIndex`
 *   - `WheelEvent.deltaMode` -> `wheelDeltaModeForIndex`
 *   - the DOM event NAME -> the `InputEvent` case (`mousemove` -> `pointermove`)
 *   - `document.pointerLockElement` -> `locked: boolean`
 *   - `Event.target` -> `resolveFocusTarget` -> `{ group, index }`
 *   - `Event.target` -> `resolveClickLanding` -> `'lock-target' | 'ui' | 'elsewhere'`
 *
 * The last one is DN-16 §5(b), and it is the same conversion as the one above
 * it rather than a new kind of thing: an element in, a NAME out, and the policy
 * that reads the name (`acquiresPointerLock`) stays a pure predicate in the
 * domain. Whether a click may take the pointer is decided there, not here.
 *
 * ---------------------------------------------------------------------------
 * What this file does NOT do about Tab
 * ---------------------------------------------------------------------------
 *
 * It does not listen for it, does not move focus, and does not suppress it. The
 * browser already moves focus on Tab, and mx-ui deliberately put its focus ring
 * and its single tab stop on the SAME slot so that the platform's own answer is
 * the right one by construction. What was missing was nobody noticing, and
 * `focusin`/`focusout` are the whole of the fix. See `FOCUS_NAVIGATION_POLICY`
 * in `input-service.ts` for why suppressing Tab is not an option at any lock
 * state, and `PREVENT_DEFAULT_EVENTS` below for the list that stays at two.
 *
 * ---------------------------------------------------------------------------
 * Teardown is exact, and it is checkable
 * ---------------------------------------------------------------------------
 *
 * `installInputListeners` returns the registrations it made — the target, the
 * event name, the listener FUNCTION and the options OBJECT — and `remove` walks
 * that same array. So "everything added comes off" is not a promise about two
 * lists that a reader has to keep in step; it is one list, walked twice.
 *
 * This matters more than it looks. plan.md §3.8 records leftover fibers on a
 * SECOND world load as the reference's worst bug class, and a leaked listener is
 * the same failure wearing a different hat: the second load's `keydown` handler
 * runs alongside the first's, both feed their own service, and the symptom is a
 * key that does two things — or, in `mc-playground-kit`, two previews side by
 * side where one drives the other. `removeEventListener` matches on type,
 * function identity and the CAPTURE flag; miss any of the three and the removal
 * silently does nothing, which is why the options object is stored rather than
 * rebuilt.
 */
import { Effect, Layer, Scope } from 'effect'
import {
  defaultBindings,
  mouseButtonForIndex,
  wheelDeltaModeForIndex,
  type Bindings,
  type ClickLanding,
  type FocusTarget,
  type InputAction,
  type ListenerTarget,
} from '../domain/input-bindings'
import {
  InputService,
  LISTENER_PLAN,
  makeInputService,
  UNAVAILABLE_POINTER_LOCK,
  type InputEvent,
  type InputServiceApi,
  type PointerLockPort,
  type PointerLockRequestOutcome,
} from './input-service'
import {
  isPointerLockHeld,
  type DomDocument,
  type DomEventTarget,
  type DomInputEvent,
  type DomListener,
  type DomListenerOptions,
  type PointerLockTarget,
} from './dom-surface'

/**
 * The two objects the plan's two `ListenerTarget`s name.
 *
 * A record rather than two arguments so that a caller cannot pass them the wrong
 * way round without the field names saying so, and so that a test's fake DOM is
 * one value.
 */
export type BrowserInputTargets = {
  readonly window: DomEventTarget
  readonly document: DomDocument
}

/** One entry of `LISTENER_PLAN`, as much of it as the adapter reads. */
export type PlannedListener = {
  readonly event: string
  readonly target: ListenerTarget
}

/**
 * What the adapter did, as data.
 *
 * Exported so that `remove` is auditable from outside: a test compares this
 * against what the fake DOM was actually asked to add, and against what it was
 * asked to remove.
 */
export type ListenerRegistration = {
  readonly event: string
  readonly target: ListenerTarget
  readonly listener: DomListener
  readonly options: DomListenerOptions
}

export type InstalledInputListeners = {
  readonly registrations: ReadonlyArray<ListenerRegistration>
  /**
   * Remove every registration. Idempotent: calling it twice removes nothing the
   * second time, so a manual teardown followed by a scope finalizer (or two
   * finalizers, after a refactor) cannot un-register somebody else's listener
   * that happens to be equal by identity.
   */
  readonly remove: () => void
}

/**
 * One roving-`tabindex` group, as the host names it.
 *
 * `targets` is `ReadonlyArray<unknown>` because THE ADAPTER NEVER LOOKS INSIDE
 * THEM. It compares `event.target` against each by `===` and reports the
 * position it matched. In a browser these are the nine `HTMLElement`s mx-ui
 * created; in a test they are nine distinct objects; in both cases the code
 * that runs is the same code, which is the point.
 *
 * ---------------------------------------------------------------------------
 * Why identity and not an attribute
 * ---------------------------------------------------------------------------
 *
 * mx-ui does mark its slots — `data-mx-ui="slot"` and `data-slot-index="n"` —
 * and reading those would need no cooperation from a host. It is rejected on
 * three counts:
 *
 *   1. `data-slot-index` is region-LOCAL in mx-ui: an inventory slot 0 and the
 *      hotbar's slot 0 carry the same value, and telling them apart means
 *      walking ancestors. `[data-mx-ui="hotbar"] [data-slot-index]` is a
 *      SELECTOR, and a selector in this file is a copy of mx-ui's DOM structure
 *      living in a repository that cannot test it against the real thing.
 *   2. It would put `getAttribute` in `dom-surface.ts`, which breaks the
 *      assignability proof outright — see `DomInputEvent.target`.
 *   3. It hard-codes mx-ui as the only possible source of focusable UI. A host
 *      that draws its own settings screen has groups too, and with a roster it
 *      simply names them.
 *
 * The ORDER of `targets` is the tab order, and the ARRAY POSITION is the index
 * reported — the same "the position IS the number" arrangement
 * `MOUSE_BUTTON_BY_INDEX` uses. 0-based, which is what
 * `HudView.setKeyboardFocus` takes.
 */
export type FocusGroupTargets = {
  readonly group: string
  readonly targets: ReadonlyArray<unknown>
}

/**
 * The group and position of a focused element, or `undefined` for an element in
 * no group at all.
 *
 * PURE and exported, so that "focus outside the hotbar is reported as no focus,
 * not as slot 0" is a unit test rather than something reachable only by firing
 * a fake event at a fake document.
 *
 * `undefined`, `null` and an element nobody named all resolve the same way, and
 * that is deliberate rather than lazy: all three mean "the keyboard is not on
 * UI this host asked about", and `HudView.setKeyboardFocus(undefined)` is the
 * one right answer to all three. Reporting an unknown element as index 0 —
 * which is what a bare `indexOf` returning `-1` would become after a careless
 * clamp — would light the ring on slot 0 whenever the player Tabbed to the
 * address bar.
 */
export const resolveFocusTarget = (
  groups: ReadonlyArray<FocusGroupTargets>,
  target: unknown,
): FocusTarget | undefined => {
  if (target === undefined || target === null) {
    return undefined
  }
  for (const group of groups) {
    const index = group.targets.indexOf(target)
    if (index >= 0) {
      return { group: group.group, index }
    }
  }
  return undefined
}

/**
 * WHERE an unlocked click landed, resolved the only way this repository is
 * willing to look at an element: by `===`.
 *
 * PURE and exported, for the reason `resolveFocusTarget` above is: the three
 * cases — the lock target, declared UI, and NEITHER — have to be writable as
 * unit tests rather than reachable only by firing a fake event at a fake
 * document. `elsewhere` is the case that used not to exist and is the one worth
 * writing down: a click on the letterbox beside a fixed-aspect canvas, on the
 * page background, or on a header the host drew and did not declare.
 *
 * ---------------------------------------------------------------------------
 * Why `===` on `event.target` is enough, and why no `contains` was added
 * ---------------------------------------------------------------------------
 *
 * DN-16 §5(b) listed "`dom-surface.ts` grows `contains` or `composedPath`" as
 * the mc-render-side option, and it turns out neither is needed. `event.target`
 * is the DEEPEST element the hit test found, and the two shapes that matter both
 * fall out of that:
 *
 *   - a HUD drawn OVER the canvas is the target of a click on it, so the click
 *     resolves as `ui` (or `elsewhere`) and never as the canvas underneath —
 *     which is the hazard, closed;
 *   - a HUD element with `pointer-events: none` is not hit at all, the click
 *     reaches the canvas, and it also focuses nothing — so there is no ring to
 *     contradict and locking is right.
 *
 * `<canvas>` has no rendered children (its content is FALLBACK and is not hit
 * tested), so a click on the lock target is a click ON the lock target and
 * `contains` would have no subtree to walk. The limitation this does leave is
 * worth stating rather than discovering: a host that makes a CONTAINER its lock
 * target — `Element.requestPointerLock` exists on any element — gets `elsewhere`
 * for clicks on that container's children. That host should name the canvas.
 * Adding `contains` would reopen the DN-15 assignability proof (`EventTarget`
 * has no `contains`; `Node` does) for a case no host has.
 *
 * ---------------------------------------------------------------------------
 * Precedence
 * ---------------------------------------------------------------------------
 *
 * The lock target is checked FIRST. An element that is both the lock target and
 * a member of a focus roster is a host contradiction with no safe reading, and
 * the tie has to be broken somewhere; breaking it toward the lock target says
 * the true thing, because that IS the element `requestPointerLock` will be
 * called on. A host must not put its lock target in a focus group — and no host
 * does by accident, because a roster comes from a query like
 * `[data-mx-ui="slot"]`, which cannot return the canvas.
 */
export const resolveClickLanding = (
  pointerLockTarget: unknown,
  groups: ReadonlyArray<FocusGroupTargets>,
  target: unknown,
): ClickLanding => {
  if (target === undefined || target === null) {
    // A click the host cannot place. NOT the lock target even when the host
    // named none: `undefined === undefined` would otherwise make every
    // unplaceable click acquire the pointer in exactly the hosts that declared
    // nothing, which is the failure this whole predicate exists to prevent.
    return 'elsewhere'
  }
  if (pointerLockTarget !== undefined && pointerLockTarget !== null && target === pointerLockTarget) {
    return 'lock-target'
  }
  return resolveFocusTarget(groups, target) === undefined ? 'elsewhere' : 'ui'
}

/**
 * One on-screen control, as the host names it.
 *
 * `target` is `unknown` for the reason `FocusGroupTargets.targets` is: THE
 * ADAPTER NEVER LOOKS INSIDE IT. It compares by `===` and reports the action the
 * host attached. In a browser this is the `<button>` the host drew; in a test it
 * is an object; the code that runs is the same either way.
 *
 * ---------------------------------------------------------------------------
 * Why this needed NOTHING new in `dom-surface.ts`
 * ---------------------------------------------------------------------------
 *
 * `DomInputEvent.target` already exists, already is `unknown`, and already is
 * only ever compared — it was added for `focusin` and reused for
 * `resolveClickLanding`. A tap is the third reader of the same member, so the
 * DOM surface this repository depends on is UNCHANGED by touch support: no
 * `TouchList`, no `changedTouches`, no `clientX`, and therefore nothing new for
 * the assignability proof in `test/fixtures/dom-surface.ts` to survive. That is
 * not luck. It is the consequence of resolving the ELEMENT rather than the
 * POSITION, which is possible because a control is a widget with an identity and
 * not a region with coordinates.
 *
 * `TouchEvent.target` is the element the touch STARTED on, for every event in
 * the sequence including `touchend` and `touchcancel` — it does not follow the
 * finger. So a press and its release resolve to the SAME control even if the
 * finger slid off the button first, which is the behaviour a player expects and
 * the one that cannot leave a control stuck.
 *
 * SINGULAR, unlike `FocusGroupTargets`, which holds an array. A focus group is a
 * roving-`tabindex` set whose ORDER is the reported index; a touch control is
 * one widget with one meaning, and a d-pad is four controls rather than one
 * control with four positions.
 */
export type TouchControlTarget = {
  readonly action: InputAction
  readonly target: unknown
}

/**
 * The action a tapped element stands for, or `undefined` for an element in no
 * roster.
 *
 * PURE and exported, for the reason `resolveFocusTarget` and
 * `resolveClickLanding` are: the case that matters — a tap on something the host
 * never declared — has to be writable as a unit test rather than reachable only
 * by firing a fake event at a fake window.
 *
 * `undefined` is a DROP and not a report, which is the opposite of what
 * `focusin` does with the same non-answer. The asymmetry is deliberate: "focus
 * left our UI" is news a HUD must act on, while "the player touched the
 * background" is not an input at all. Reporting it would mean inventing an
 * action for a tap on empty screen.
 *
 * FIRST MATCH WINS, and a host that declares one element twice gets the first
 * declaration. There is no rejection for it, because there is no reading in
 * which the second is more true than the first, and an event handler is the one
 * place that must not throw.
 */
export const resolveTouchControl = (
  controls: ReadonlyArray<TouchControlTarget>,
  target: unknown,
): InputAction | undefined => {
  if (target === undefined || target === null) {
    return undefined
  }
  return controls.find((control) => control.target === target)?.action
}

/**
 * Everything the adapter needs from the world outside `dispatch`.
 *
 * `pointerLockHeld` is read from `document.pointerLockElement` and is only
 * consulted for `pointerlockchange` — it is a parameter rather than a second
 * argument of the same type so that `translateDomEvent` stays a pure function of
 * its inputs and can be tested without a document at all.
 *
 * `focusGroups` is the host's roster and is consulted only for `focusin`. It is
 * here for the same reason: the translation from an element to a
 * `FocusTarget` must be a pure function of its arguments, or the case that
 * matters — focus on something nobody named — could not be written as a test.
 */
export type DomEventContext = {
  readonly pointerLockHeld: boolean
  readonly focusGroups: ReadonlyArray<FocusGroupTargets>
  /**
   * The element the pointer lock would be granted to — the host's canvas.
   *
   * Consulted only for `mousedown`, and only ever COMPARED, which is why it is
   * `unknown` for the reason `DomInputEvent.target` is. Optional, and its
   * absence is a coherent state rather than a degenerate one: a host that named
   * no canvas has `UNAVAILABLE_POINTER_LOCK` and could not have locked anyway,
   * so every click resolving as `ui` or `elsewhere` is the truth for it.
   */
  readonly pointerLockTarget?: unknown
  /**
   * The on-screen controls this host drew, consulted only for the touch trio.
   *
   * OPTIONAL, and its absence is the ordinary case rather than a degenerate one:
   * a desktop host draws no touch controls, registers the listeners anyway
   * (`LISTENER_PLAN` is the single answer to what is registered, in every host),
   * and every tap resolves to `undefined` and is dropped. That is the truth for
   * it — a stray touch on a laptop trackpad is not a game action.
   */
  readonly touchControls?: ReadonlyArray<TouchControlTarget>
}

/**
 * The events whose handler MAY call `preventDefault()`, and therefore the events
 * that must be registered with `passive: false`.
 *
 * Exactly two, and the same two the domain has predicates for:
 * `wheel` (`suppressesBrowserScroll`) and `contextmenu`
 * (`suppressesBrowserContextMenu`). One list drives both the listener options
 * and the handler, so "non-passive" and "may prevent the default" cannot drift
 * apart.
 *
 * Only `wheel` strictly NEEDS it — browsers make `wheel`, `mousewheel`,
 * `touchstart` and `touchmove` passive by default at `window`, `document` and
 * `body`, and `contextmenu` is never passive. `contextmenu` is listed anyway
 * because the two facts this list encodes are "may prevent the default" and
 * "must be registered non-passive", they agree on both events today, and the
 * one that does not strictly need the flag costs nothing to state: an explicit
 * `passive: false` on a listener that is already non-passive changes no
 * behaviour and no frame time.
 *
 * TOUCH IS DELIBERATELY NOT HERE, and the omission is a decision rather than an
 * oversight. `touchstart` is passive by default at `window` precisely because
 * suppressing it is expensive, and what it suppresses is the platform: page
 * scrolling, pinch-zoom, and the synthesised `mousedown`/`click` pair. Taking
 * all three away is the touch-device equivalent of suppressing Tab — it removes
 * the player's ability to scroll their own settings screen and to operate any
 * DOM UI the host draws, and this repository has no predicate that could narrow
 * it, because a tap has no lock state to narrow by (pointer lock is a mouse
 * feature; a phone has no pointer to capture).
 *
 * The synthesised `mousedown` that this leaves alive was checked rather than
 * assumed, because it is the one that could have reopened DN-16 §5(b): it
 * carries the CONTROL as its target, so `resolveClickLanding` answers `ui` or
 * `elsewhere` for it, and `acquiresPointerLock` requires `lock-target`. A tap
 * therefore cannot take the pointer. See `resolveClickLanding` for why the
 * closed-world form is what makes that true — under `landing !== 'ui'` an
 * undeclared touch control would have read "not UI" and grabbed the pointer on
 * every single tap.
 */
export const PREVENT_DEFAULT_EVENTS: ReadonlyArray<string> = ['wheel', 'contextmenu']

/** Whether the handler for `eventName` may call `preventDefault()`. */
export const mayPreventDefault = (eventName: string): boolean =>
  PREVENT_DEFAULT_EVENTS.includes(eventName)

/**
 * The options a listener is registered with — and removed with.
 *
 * `capture: false` is stated rather than left to the default, because a removal
 * matches on the capture flag: an `addEventListener(t, l)` and a
 * `removeEventListener(t, l, { capture: true })` are a leak that no type can
 * catch. Passing the same object to both is the cheapest way to make them agree.
 */
export const listenerOptionsFor = (eventName: string): DomListenerOptions =>
  mayPreventDefault(eventName) ? { capture: false, passive: false } : { capture: false }

/**
 * A number the adapter is willing to pass on, or `undefined`.
 *
 * `NaN` and `Infinity` are droppable rather than clampable: `pointerDelta`
 * accumulates raw, so one `NaN` from a misbehaving device disables mouselook for
 * the rest of the session — the same failure `notchesForWheelDelta` guards
 * against on its own side.
 */
const finiteOrUndefined = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) ? value : undefined

/**
 * One DOM event, translated — or `undefined` when it carries no usable payload.
 *
 * PURE, and exported, so that "every event kind translates to the right
 * `InputEvent`" is a table-driven unit test rather than something only reachable
 * by firing a fake event at a fake window.
 *
 * `undefined` is the boundary rule this repository already states twice
 * (`mouseButtonForIndex`, `wheelDeltaModeForIndex`): an event the adapter cannot
 * name is DROPPED, never guessed at. A thumb button that became `MouseLeft`
 * would break blocks; a wheel event whose unit could not be read would be
 * mis-scaled by 33x.
 *
 * The `target` comes from the plan entry rather than from a constant here, so
 * the modal-shielding policy stays in one place: move `keydown` to `document` in
 * `LISTENER_PLAN` and the events this produces become modal-tagged, which
 * `dispatch` then ignores — the policy breaks visibly instead of silently.
 */
export const translateDomEvent = (
  planned: PlannedListener,
  event: DomInputEvent,
  context: DomEventContext,
): InputEvent | undefined => {
  switch (planned.event) {
    case 'keydown': {
      const code = event.code
      return code === undefined ? undefined : { kind: 'keydown', code, target: planned.target }
    }
    case 'keyup': {
      const code = event.code
      return code === undefined ? undefined : { kind: 'keyup', code, target: planned.target }
    }
    case 'mousedown': {
      const button = event.button === undefined ? undefined : mouseButtonForIndex(event.button)
      // ELEMENT to NAME, at the boundary, exactly as `focusin` below does it and
      // for the same reason: the decision that follows (`acquiresPointerLock`)
      // is a pure predicate over names, so it stays testable in Node with fakes
      // — which matters more here than anywhere, because plan.md §3.10 records
      // that Playwright cannot do pointer lock at all.
      return button === undefined
        ? undefined
        : {
            kind: 'mousedown',
            button,
            target: planned.target,
            landing: resolveClickLanding(context.pointerLockTarget, context.focusGroups, event.target),
          }
    }
    case 'mouseup': {
      const button = event.button === undefined ? undefined : mouseButtonForIndex(event.button)
      return button === undefined ? undefined : { kind: 'mouseup', button, target: planned.target }
    }
    case 'contextmenu':
      // Carries NO button state by design — `mousedown` already recorded button
      // 2, and recording it again fires `use` twice for one right-click
      // (reference :137-139). The event is dispatched anyway so that "and does
      // nothing" is a property a test can assert.
      return { kind: 'contextmenu', target: planned.target }
    case 'mousemove': {
      // The DOM event is `mousemove`; the model calls it `pointermove`. This
      // rename is the whole of the mapping — `movementX/Y` is already a DELTA,
      // which is why the service can accumulate it without knowing where the
      // pointer is.
      const deltaX = finiteOrUndefined(event.movementX)
      const deltaY = finiteOrUndefined(event.movementY)
      return deltaX === undefined && deltaY === undefined
        ? undefined
        : { kind: 'pointermove', deltaX: deltaX ?? 0, deltaY: deltaY ?? 0 }
    }
    case 'wheel': {
      // NUMBER to NAME, and nothing else. How many pixels make a notch is
      // `notchesForWheelDelta`'s to know (DN-13): a policy in an adapter is a
      // policy `environment: 'node'` cannot test, and there is no browser test
      // that could reach the locked branch either.
      const deltaMode = event.deltaMode === undefined ? undefined : wheelDeltaModeForIndex(event.deltaMode)
      const deltaY = event.deltaY
      return deltaMode === undefined || deltaY === undefined
        ? undefined
        : { kind: 'wheel', deltaY, deltaMode }
    }
    case 'pointerlockchange':
      // The event itself says nothing; `document.pointerLockElement` is the
      // answer, and `locked: false` here means the lock ENDED — never that it
      // was refused. Only `pointerlockerror` says refused (DN-14).
      return { kind: 'pointerlockchange', locked: context.pointerLockHeld }
    case 'pointerlockerror':
      return { kind: 'pointerlockerror' }
    case 'blur':
      // The browser sends no keyup while unfocused, so a key held across a tab
      // switch stays pressed forever and the player walks on return (DN-08,
      // reference :155-158 — a user report, not a theory).
      return { kind: 'blur' }
    case 'focusin':
      // ELEMENT to NAME, at the boundary, in exactly one place — the same
      // conversion `mouseButtonForIndex` and `wheelDeltaModeForIndex` are, with
      // an element where they have a number. An element in no roster resolves
      // to `undefined`, which is a REPORT ("focus left our UI") and not a drop:
      // dropping it would leave the ring lit on the slot the player just Tabbed
      // away from.
      return { kind: 'focuschange', focus: resolveFocusTarget(context.focusGroups, event.target) }
    case 'touchstart': {
      // ELEMENT to NAME, at the boundary, in exactly one place — the third
      // reader of `event.target` and the same conversion `focusin` and
      // `mousedown` already perform. What comes out is an ACTION and not a
      // code, because the code depends on the player's current bindings and
      // those live in the service (`withTouchDown`), not here. An adapter that
      // resolved the code would keep pressing `KeyE` after a rebind.
      const action = resolveTouchControl(context.touchControls ?? [], event.target)
      return action === undefined
        ? undefined
        : { kind: 'touchpress', action, target: planned.target }
    }
    case 'touchend':
    case 'touchcancel': {
      // ONE case for two events, and it is the only place this switch collapses
      // two DOM names — for the reason `focuschange` collapses `focusin` and
      // `focusout`. A cancel and an end are the same fact to everything
      // downstream: the finger is off the control. They differ only in whose
      // decision it was, and nothing here can act on that difference.
      //
      // Handling `touchcancel` is not optional. The platform fires it INSTEAD
      // of `touchend` when it takes the gesture over, so an adapter that
      // listened only for `touchend` would leave the control held for the rest
      // of the session — the player swipes in from the screen edge while
      // holding the forward button and walks into a wall until they reload.
      const action = resolveTouchControl(context.touchControls ?? [], event.target)
      return action === undefined
        ? undefined
        : { kind: 'touchrelease', action, target: planned.target }
    }
    case 'focusout':
      // Never resolves anything. `focusout` fires on the element being LEFT, so
      // resolving its target would report the slot the keyboard just departed
      // as the slot it is on. The browser fires focusout then focusin for a
      // move, in that order and in the same task, so the arrival overwrites
      // this before any frame can read it; a departure to nothing has no
      // arrival, and this is the whole of what says so.
      return { kind: 'focuschange', focus: undefined }
    default:
      // An event name the plan grew without this switch growing with it. Dropped
      // rather than guessed, and a test asserts the two lists agree so that the
      // drop cannot be how anyone finds out.
      return undefined
  }
}

/** The object a `ListenerTarget` names. A lookup, not a policy. */
const objectFor = (targets: BrowserInputTargets, target: ListenerTarget): DomEventTarget =>
  target === 'window' ? targets.window : targets.document

/**
 * The suppression question for an event, or `undefined` if it has none.
 *
 * Returning the service's own Effect rather than a boolean keeps the decision
 * where it belongs: the lock state is read at the instant the browser asks, not
 * at the instant the listener was installed.
 */
const suppressionFor = (
  eventName: string,
  input: InputServiceApi,
): Effect.Effect<boolean> | undefined => {
  if (eventName === 'wheel') {
    return input.shouldSuppressWheelScroll
  }
  if (eventName === 'contextmenu') {
    return input.shouldSuppressContextMenu
  }
  return undefined
}

/**
 * Register every listener `LISTENER_PLAN` calls for, and hand back the means to
 * remove exactly those.
 *
 * Synchronous, and returns a plain value rather than an Effect, because it is
 * called from a Layer's acquire and from previews that have no Effect runtime
 * yet — and because the handlers themselves must be synchronous: a DOM handler
 * that wanted to `preventDefault()` after an await has already lost the right
 * to.
 *
 * `Effect.runSync` inside the handlers is safe by construction rather than by
 * luck: `dispatch` is a `Ref.update`, `shouldSuppressWheelScroll` is a
 * `Ref.get`, and neither can fail, suspend or need a service.
 */
export const installInputListeners = (
  targets: BrowserInputTargets,
  input: InputServiceApi,
  /**
   * The focusable UI groups this host wants reported, in tab order.
   *
   * Defaults to NONE, which is a coherent state and not a degenerate one: a
   * host with no roster registers the focus listeners anyway and reports every
   * focus change as `undefined`. That is the truth for a preview that draws
   * only a canvas — there is no focusable game UI, so the keyboard is never on
   * any. It is also what keeps the listener table identical in every host, so
   * `LISTENER_PLAN` stays the single answer to what is registered.
   */
  focusGroups: ReadonlyArray<FocusGroupTargets> = [],
  /**
   * The element the pointer lock would be granted to — the canvas.
   *
   * The SAME object the `PointerLockPort` asks, and that is the whole rule:
   * the element that will receive the lock is the element you must click to ask
   * for it. `browserInputLayer` passes `options.canvas` here automatically, so a
   * host using it declares nothing new; a host that builds the port itself has
   * to hand the canvas over twice, and this parameter is where.
   *
   * Omitted means "this host has no lock target", which is the same host that
   * gets `UNAVAILABLE_POINTER_LOCK` — no click resolves as `lock-target`, and
   * none could have locked anyway.
   */
  pointerLockTarget?: unknown,
  /**
   * The on-screen controls this host drew, in no particular order.
   *
   * Defaults to NONE, which is what every desktop host has. Order is
   * meaningless here — unlike `focusGroups`, where the array position IS the
   * reported index — because a control is resolved by identity to an action and
   * never to a position.
   */
  touchControls: ReadonlyArray<TouchControlTarget> = [],
): InstalledInputListeners => {
  const registrations: ReadonlyArray<ListenerRegistration> = LISTENER_PLAN.map((planned) => {
    const suppression = suppressionFor(planned.event, input)
    // Decided once, at install time, so that the per-event cost is one boolean
    // test rather than a property read on `document` for every mousemove.
    const readsLockElement = planned.event === 'pointerlockchange'

    const listener: DomListener = (event) => {
      // BEFORE the dispatch. The two are independent for the two events that
      // have a suppression — neither `wheel` nor `contextmenu` changes the lock
      // state — but doing it first means the browser default is suppressed even
      // when the event turns out to be untranslatable. A wheel whose
      // `deltaMode` cannot be named must still not scroll the page out from
      // under a locked canvas.
      if (suppression !== undefined && Effect.runSync(suppression)) {
        event.preventDefault()
      }

      const translated = translateDomEvent(planned, event, {
        pointerLockHeld: readsLockElement && isPointerLockHeld(targets.document),
        focusGroups,
        pointerLockTarget,
        touchControls,
      })
      if (translated !== undefined) {
        Effect.runSync(input.dispatch(translated))
      }
    }

    return {
      event: planned.event,
      target: planned.target,
      listener,
      options: listenerOptionsFor(planned.event),
    }
  })

  for (const registration of registrations) {
    objectFor(targets, registration.target).addEventListener(
      registration.event,
      registration.listener,
      registration.options,
    )
  }

  let removed = false
  return {
    registrations,
    remove: () => {
      if (removed) {
        return
      }
      removed = true
      for (const registration of registrations) {
        objectFor(targets, registration.target).removeEventListener(
          registration.event,
          registration.listener,
          registration.options,
        )
      }
    },
  }
}

/**
 * The same installation, bound to a `Scope`.
 *
 * The reference does this with `Effect.addFinalizer` (:191-); `acquireRelease`
 * is the same guarantee with the acquisition attached, so there is no window in
 * which the listeners exist and the finalizer does not.
 */
export const scopedInputListeners = (
  targets: BrowserInputTargets,
  input: InputServiceApi,
  focusGroups: ReadonlyArray<FocusGroupTargets> = [],
  pointerLockTarget?: unknown,
  touchControls: ReadonlyArray<TouchControlTarget> = [],
): Effect.Effect<InstalledInputListeners, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() =>
      installInputListeners(targets, input, focusGroups, pointerLockTarget, touchControls),
    ),
    (installed) =>
      Effect.sync(() => {
        installed.remove()
      }),
  )

/**
 * How to ASK for the pointer lock, in a browser.
 *
 * `allowsPointerLock` is optional and is how the reference's feature-policy
 * check (:258-262, `document.featurePolicy?.allowsFeature('pointer-lock')`)
 * reaches this port without `featurePolicy` — which is non-standard and absent
 * from lib.DOM — appearing in `dom-surface.ts`. A host that can see it passes
 * `() => document.featurePolicy?.allowsFeature('pointer-lock') ?? true`.
 *
 * What is NOT carried over is the reference's `pointerLockFallbackRef`
 * (:263-266, :282-284), which reports the pointer as LOCKED when the feature
 * policy denies the lock. Every click-means-different-things rule in DN-12 is
 * built on that boolean, so a lie there is a left-click that breaks a block in a
 * menu.
 */
export type BrowserPointerLockOptions = {
  readonly canvas: PointerLockTarget
  readonly allowsPointerLock?: () => boolean
}

/** Just enough of a promise to stop a rejection escaping. */
type ThenableLike = {
  readonly then: (onFulfilled: () => void, onRejected: () => void) => unknown
}

const isThenable = (value: unknown): value is ThenableLike =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'

const ignore = (): void => undefined

/**
 * The browser's `PointerLockPort`.
 *
 * It reports whether the ASK WENT OUT, and nothing more — the answer arrives
 * later as `pointerlockchange` or `pointerlockerror` through `dispatch`, and
 * modelling the ask as the answer is the bug the port's shape exists to make
 * unwritable (DN-14).
 *
 * Three ways it reports `unavailable`, and they share one meaning: NO EVENT WILL
 * EVER ARRIVE. Leaving the state machine in `requested` after one of them would
 * strand it for the session, because a pending request is one of the documented
 * reasons a browser refuses the next one.
 *
 *   - the element has no `requestPointerLock` (not a canvas, or an old browser);
 *   - `allowsPointerLock` said no (a permissions policy forbids it);
 *   - the call THREW. A throw is not a refusal — a refusal is an event — so
 *     reporting `sent` here would wait forever for an answer nobody will send.
 *
 * A REJECTED promise is different and is deliberately not turned into
 * `unavailable`: modern browsers reject the promise AND fire `pointerlockerror`,
 * so the event answers the ask and the rejection is only swallowed to stop it
 * becoming an unhandled rejection that takes the host down.
 */
export const makeBrowserPointerLockPort = (options: BrowserPointerLockOptions): PointerLockPort => ({
  request: Effect.sync((): PointerLockRequestOutcome => {
    const canvas = options.canvas
    if (typeof canvas.requestPointerLock !== 'function') {
      return 'unavailable'
    }
    if (options.allowsPointerLock !== undefined && !options.allowsPointerLock()) {
      return 'unavailable'
    }
    try {
      // Called as a method so that `this` is the canvas, which is what the DOM
      // requires and what a `const request = canvas.requestPointerLock` would
      // have quietly broken.
      const result: unknown = canvas.requestPointerLock()
      if (isThenable(result)) {
        result.then(ignore, ignore)
      }
      return 'sent'
    } catch {
      return 'unavailable'
    }
  }),
})

/**
 * Everything a browser host has to decide, in one record.
 *
 * `canvas` is optional because a preview may want to read input without ever
 * taking the pointer: with no canvas the port is `UNAVAILABLE_POINTER_LOCK`,
 * which answers `refused` at once rather than hanging — the same behaviour Node
 * gets, and for the same reason.
 *
 * `canvas` now does TWO things, and they are one thing said twice: it is the
 * element the lock is asked FOR, and it is the element a click must land ON to
 * be allowed to ask (DN-16 §5(b)). A host declares it once and gets both, which
 * is why closing that hazard needed no new field here — and why a host that
 * declares no canvas is unchanged: it could never lock before either.
 */
export type BrowserInputOptions = {
  readonly targets: BrowserInputTargets
  readonly canvas?: PointerLockTarget
  readonly allowsPointerLock?: () => boolean
  readonly bindings?: Bindings
  /**
   * The focusable UI groups to report, in tab order. Optional, for the same
   * reason `canvas` is: a preview that draws no focusable UI has none, and
   * saying so by omission is better than by an empty array a reader has to
   * interpret.
   *
   * A browser host building mx-ui's hotbar passes
   * `[{ group: HOTBAR_FOCUS_GROUP, targets: slotElements }]`, where
   * `slotElements` are the nine elements in slot order. mx-ui does not hand
   * them out — they are reachable as
   * `document.querySelectorAll('[data-mx-ui="hotbar"] [data-mx-ui="slot"]')`,
   * and that query belongs to the host because the host is the only place that
   * knows both repositories are on the page.
   */
  readonly focusGroups?: ReadonlyArray<FocusGroupTargets>
  /**
   * The on-screen controls to bind, if this host drew any.
   *
   * A touch host passes one entry per control —
   * `[{ action: 'jump', target: jumpButton }, { action: 'escape', target: pauseButton }]`
   * — and the elements come from the host for the reason `focusGroups`' do: the
   * host is the only place that knows both repositories are on the page.
   *
   * `unboundTouchActions(bindings, controls.map(c => c.action))` is the check
   * worth running once at setup. A control whose action is bound to nothing is a
   * picture of a button, and this is the only moment anything can notice.
   */
  readonly touchControls?: ReadonlyArray<TouchControlTarget>
}

const pointerLockPortFor = (options: BrowserInputOptions): PointerLockPort => {
  const canvas = options.canvas
  if (canvas === undefined) {
    return UNAVAILABLE_POINTER_LOCK
  }
  return makeBrowserPointerLockPort(
    options.allowsPointerLock === undefined
      ? { canvas }
      : { canvas, allowsPointerLock: options.allowsPointerLock },
  )
}

/**
 * `InputService`, wired to a real browser, with its listeners removed when the
 * Layer's scope closes.
 *
 * A Layer rather than a function a host is trusted to unwind, because the
 * failure being prevented is precisely the one nobody performs by hand: plan.md
 * §3.8 records leftover state on a SECOND world load as the reference's worst
 * bug class, and `mc-playground-kit` puts two previews on one page, so this
 * repository sees the second instance first.
 *
 * Pass it where `InputServiceLayer()` would go — `renderModule`'s `layers` is
 * the same tag.
 */
export const browserInputLayer = (options: BrowserInputOptions): Layer.Layer<InputService> =>
  Layer.scoped(
    InputService,
    Effect.gen(function* () {
      const input = yield* makeInputService(
        options.bindings ?? defaultBindings(),
        pointerLockPortFor(options),
      )
      // `options.canvas` twice, on purpose and in one place: it is what the port
      // ASKS and what a click has to LAND ON to be allowed to ask. Deriving the
      // second from the first is what makes the fix cost a browser host nothing
      // — the declaration it already had to make now also scopes the
      // acquisition (DN-16 §5(b)).
      yield* scopedInputListeners(
        options.targets,
        input,
        options.focusGroups ?? [],
        options.canvas,
        options.touchControls ?? [],
      )
      return input
    }),
  )

/**
 * The plan entries this file has a translation for.
 *
 * Exported so that a test can assert the two agree in BOTH directions: an entry
 * added to `LISTENER_PLAN` without a case in `translateDomEvent` would otherwise
 * be a listener that registers, fires, and drops every event it receives.
 */
export const TRANSLATED_DOM_EVENTS: ReadonlyArray<string> = [
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'contextmenu',
  'mousemove',
  'wheel',
  'pointerlockchange',
  'pointerlockerror',
  'blur',
  'focusin',
  'focusout',
  'touchstart',
  'touchend',
  'touchcancel',
]
