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
 *   - `document.activeElement` + `KeyboardEvent.code` -> `resolveFocusNavigationTarget`
 *     -> the roster member to move focus TO
 *
 * The third-from-last is DN-16 §5(b), and it is the same conversion as the one
 * above it rather than a new kind of thing: an element in, a NAME out, and the
 * policy that reads the name (`acquiresPointerLock`) stays a pure predicate in
 * the domain. Whether a click may take the pointer is decided there, not here.
 *
 * The last is DN-16 §5(a), and it is the ONE PLACE this file calls a DOM
 * method other than `addEventListener`/`removeEventListener`/`preventDefault`:
 * `resolveFocusNavigationTarget` is pure and answers WHICH roster member (if
 * any), and this file performs the `.focus()` — the same division `render:input`
 * and `acquiresPointerLock` already draw for the pointer lock ask.
 *
 * ---------------------------------------------------------------------------
 * What this file does NOT do about Tab, and what it DOES about arrow keys
 * ---------------------------------------------------------------------------
 *
 * It does not listen for Tab, does not move focus on it, and does not suppress
 * it. The browser already moves focus on Tab, and mx-ui deliberately put its
 * focus ring and its single tab stop on the SAME slot so that the platform's
 * own answer is the right one by construction. What was missing was nobody
 * noticing, and `focusin`/`focusout` are the whole of the fix. See
 * `FOCUS_NAVIGATION_POLICY` in `input-service.ts` for why suppressing Tab is
 * not an option at any lock state, and `PREVENT_DEFAULT_EVENTS` below for the
 * list that stays at two.
 *
 * Arrow keys are different: the browser has no native "move focus within a
 * roving-`tabindex` group" behaviour to defer to, so DN-16 §5(a) makes this
 * file the one that moves it, by calling `.focus()` on the roster member
 * `resolveFocusNavigationTarget` names. What it still does NOT do is call
 * `event.preventDefault()` for it: `mayPreventDefault` has no `keydown` case,
 * and it must not grow one — a `keydown` exception for arrows would be a
 * `keydown` exception, full stop, and would make Tab eligible for suppression
 * again. `ARROW_FOCUS_NAVIGATION_POLICY` (`domain/focus-navigation.ts`) is
 * `owner: 'host'` for exactly this reason: whether whatever an arrow key would
 * otherwise have done should be suppressed is the HOST's decision, made with
 * its own listener outside this file, never this adapter's.
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
import {
  type Bindings,
  type ClickLanding,
  type FocusTarget,
  type InputAction,
  type ListenerTarget,
  TOUCH_LOOK_IDLE,
  type TouchLookState,
  type TouchPoint,
  defaultBindings,
  mouseButtonForIndex,
  touchLookStep,
  unboundTouchActions,
  wheelDeltaModeForIndex,
  wrapHotbarSelection,
} from '../domain/input-bindings.js'
import {
  type DomDocument,
  type DomEventTarget,
  type DomInputEvent,
  type DomListener,
  type DomListenerOptions,
  type FocusableTarget,
  type PointerLockTarget,
  isPointerLockHeld,
} from './dom-surface.js'
import { Effect, Layer, Scope } from 'effect'
import {
  type InputEvent,
  InputService,
  type InputServiceApi,
  LISTENER_PLAN,
  type PointerLockPort,
  type PointerLockRequestOutcome,
  UNAVAILABLE_POINTER_LOCK,
  makeInputService,
} from './input-service.js'
import { focusNavigationStepForCode } from '../domain/focus-navigation.js'

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
 * `targets` is `ReadonlyArray<FocusableTarget>`. THE ADAPTER STILL NEVER READS
 * THEM: `resolveFocusTarget` below compares `event.target` against each by
 * `===` and reports the position it matched, exactly as when this was
 * `ReadonlyArray<unknown>`. The one new operation, added for DN-16 §5(a), is a
 * WRITE — `resolveFocusNavigationTarget` calls `.focus()` on the member arrow
 * navigation moves TO — which is the whole reason the element type grew a
 * member instead of staying opaque. In a browser these are the nine
 * `HTMLElement`s mx-ui created; in a test they are nine `{ focus: () => void }`
 * fakes; in both cases the code that runs is the same code, which is the
 * point.
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
  readonly targets: ReadonlyArray<FocusableTarget>
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
/** What `Array.prototype.indexOf` (and `findIndex`, below) return for a member never found. */
const NOT_FOUND_INDEX = -1

/**
 * The group OBJECT a target resolved into, and its position — the shared core
 * of `resolveFocusTarget` and `resolveFocusNavigationTarget`.
 *
 * Kept internal (not exported) and returning the `FocusGroupTargets` itself
 * rather than its name, so `resolveFocusNavigationTarget` never has to look a
 * group up a SECOND time by `group.group === name` — a lookup that would
 * silently answer a DIFFERENT group object if two entries shared a name. Every
 * external caller still only ever sees the name (`FocusTarget.group: string`);
 * this is the one function that is allowed to hold the object instead.
 */
const resolveFocusMember = (
  groups: ReadonlyArray<FocusGroupTargets>,
  target: unknown,
): { readonly group: FocusGroupTargets; readonly index: number } | undefined => {
  if (typeof target === 'undefined' || target === null) {
    return
  }
  for (const group of groups) {
    /* `findIndex` with an explicit `===`, not `indexOf(target)`: `target` is
       `unknown` (it comes straight off `event.target`) and `targets` is now
       `ReadonlyArray<FocusableTarget>` (DN-16 §5(a)), so `indexOf` would
       demand an argument typed `FocusableTarget` — exactly the cast this file
       exists to avoid. `findIndex`'s callback parameter is `FocusableTarget`,
       but its body only ever compares, so `unknown` on the other side of `===`
       needs nothing from it. */
    const index = group.targets.findIndex((candidate) => candidate === target)
    if (index > NOT_FOUND_INDEX) {
      return { group, index }
    }
  }
  return
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
  const resolved = resolveFocusMember(groups, target)
  if (typeof resolved === 'undefined') {
    return
  }
  return { group: resolved.group.group, index: resolved.index }
}

/**
 * Where ONE press of a navigation code would move focus TO, given who holds it
 * now — or `undefined` when the press moves nothing: no group is focused, the
 * code is not a navigation code, or the pointer lock currently masks focus
 * (DN-16 §5(a): the same arrow may be steering the avatar, and moving the ring
 * underneath that would be the bug `reportsKeyboardFocus` already exists to
 * prevent on the read side).
 *
 * PURE and exported, for the reason `resolveFocusTarget` above is: "ArrowRight
 * from the last slot wraps to the first" has to be a unit test, not something
 * reachable only by firing a fake keydown at a fake document.
 *
 * Reuses `wrapHotbarSelection`'s arithmetic rather than re-deriving it — the
 * precedent this file's header already states for `notchesForWheelDelta`:
 * `wrapHotbarSelection` takes the size as an argument, stores no selection,
 * and exists purely so a second caller does not re-derive the wrap trap.
 * `current.index` is always in range because it and `current.group.targets`
 * came from the SAME `resolveFocusMember` call — there is no second, by-name
 * lookup here to disagree with it.
 */
/**
 * What one `keydown` knows, gathered into one value rather than three
 * parameters — `max-params` is 3 in this repository, and a fourth would have
 * meant either loosening that or splitting a query that is one fact
 * ("what does this keydown mean for focus") into separate arguments a caller
 * would have to keep in step by hand.
 */
export type FocusNavigationQuery = {
  readonly activeElement: unknown
  readonly code: string | undefined
  readonly pointerLockHeld: boolean
}

export const resolveFocusNavigationTarget = (
  groups: ReadonlyArray<FocusGroupTargets>,
  query: FocusNavigationQuery,
): FocusableTarget | undefined => {
  if (query.pointerLockHeld) {
    return
  }
  const step = focusNavigationStepForCode(query.code)
  if (typeof step === 'undefined') {
    return
  }
  const current = resolveFocusMember(groups, query.activeElement)
  if (typeof current === 'undefined') {
    return
  }
  return current.group.targets[wrapHotbarSelection(current.index, step, current.group.targets.length)]
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
  if (typeof target === 'undefined' || target === null) {
    /* A click the host cannot place. NOT the lock target even when the host
       named none: `undefined === undefined` would otherwise make every
       unplaceable click acquire the pointer in exactly the hosts that declared
       nothing, which is the failure this whole predicate exists to prevent. */
    return 'elsewhere'
  }
  if (
    typeof pointerLockTarget !== 'undefined' &&
    pointerLockTarget !== null &&
    target === pointerLockTarget
  ) {
    return 'lock-target'
  }
  if (typeof resolveFocusTarget(groups, target) === 'undefined') {
    return 'elsewhere'
  }
  return 'ui'
}

/**
 * One on-screen control, as the host names it.
 *
 * `target` is `unknown` for the reason `FocusGroupTargets.targets` is: THE
 * ADAPTER NEVER LOOKS INSIDE IT. It compares by `===` and reports the action the
 * host attached. In a browser this is the `<button>` the host drew; in a test it
 * is an object; the code that runs is the same either way.
 *
 * A touch sequence cannot rely on the event-level target for release: browsers
 * may retarget `touchend` or `touchcancel`. The listener therefore resolves each
 * contact from `changedTouches` on start and remembers the resulting action by
 * touch identifier until that contact ends.
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
  if (typeof target === 'undefined' || target === null) {
    return
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
export const listenerOptionsFor = (eventName: string): DomListenerOptions => {
  if (mayPreventDefault(eventName)) {
    return { capture: false, passive: false }
  }
  return { capture: false }
}

/**
 * A number the adapter is willing to pass on, or `undefined`.
 *
 * `NaN` and `Infinity` are droppable rather than clampable: `pointerDelta`
 * accumulates raw, so one `NaN` from a misbehaving device disables mouselook for
 * the rest of the session — the same failure `notchesForWheelDelta` guards
 * against on its own side.
 */
const finiteOrUndefined = (value: number | undefined): number | undefined => {
  if (typeof value !== 'undefined' && Number.isFinite(value)) {
    return value
  }
  return
}

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
/** Shared "no report" value so call sites never spell the `undefined` literal. */
const { focus: NO_FOCUS_TARGET } = {} as { focus?: FocusTarget }

/** The zero delta a `pointermove` reports when only one axis moved this frame. */
const NO_POINTER_DELTA = 0

const resolvedMouseButton = (index: number | undefined) => {
  if (typeof index === 'undefined') {
    return
  }
  return mouseButtonForIndex(index)
}

const resolvedWheelDeltaMode = (index: number | undefined) => {
  if (typeof index === 'undefined') {
    return
  }
  return wheelDeltaModeForIndex(index)
}

const translateKeyEvent = (
  kind: 'keydown' | 'keyup',
  event: DomInputEvent,
  target: ListenerTarget,
): InputEvent | undefined => {
  const { code } = event
  if (typeof code === 'undefined') {
    return
  }
  return { code, kind, target }
}

type DomTranslationInput = {
  readonly context: DomEventContext
  readonly event: DomInputEvent
  readonly planned: PlannedListener
}

const translateMouseButtonEvent = (
  kind: 'mousedown' | 'mouseup',
  input: DomTranslationInput,
): InputEvent | undefined => {
  const { context, event, planned } = input
  const button = resolvedMouseButton(event.button)
  if (typeof button === 'undefined') {
    return
  }
  if (kind === 'mouseup') {
    return { button, kind, target: planned.target }
  }
  /* ELEMENT to NAME, at the boundary, exactly as `focusin` below does it and
     for the same reason: the decision that follows (`acquiresPointerLock`)
     is a pure predicate over names, so it stays testable in Node with fakes
     — which matters more here than anywhere, because plan.md §3.10 records
     that Playwright cannot do pointer lock at all. */
  return {
    button,
    kind,
    landing: resolveClickLanding(context.pointerLockTarget, context.focusGroups, event.target),
    target: planned.target,
  }
}

const translatePointerMove = (event: DomInputEvent): InputEvent | undefined => {
  /* The DOM event is `mousemove`; the model calls it `pointermove`. This
     rename is the whole of the mapping — `movementX/Y` is already a DELTA,
     which is why the service can accumulate it without knowing where the
     pointer is. */
  const deltaX = finiteOrUndefined(event.movementX)
  const deltaY = finiteOrUndefined(event.movementY)
  if (typeof deltaX === 'undefined' && typeof deltaY === 'undefined') {
    return
  }
  return {
    deltaX: deltaX ?? NO_POINTER_DELTA,
    deltaY: deltaY ?? NO_POINTER_DELTA,
    kind: 'pointermove',
  }
}

const translateWheel = (event: DomInputEvent): InputEvent | undefined => {
  /* NUMBER to NAME, and nothing else. How many pixels make a notch is
     `notchesForWheelDelta`'s to know (DN-13): a policy in an adapter is a
     policy `environment: 'node'` cannot test, and there is no browser test
     that could reach the locked branch either. */
  const deltaMode = resolvedWheelDeltaMode(event.deltaMode)
  const { deltaY } = event
  if (typeof deltaMode === 'undefined' || typeof deltaY === 'undefined') {
    return
  }
  return { deltaMode, deltaY, kind: 'wheel' }
}

const translateFocusIn = (event: DomInputEvent, context: DomEventContext): InputEvent => ({
  focus: resolveFocusTarget(context.focusGroups, event.target),
  kind: 'focuschange',
})

const translateTouchEdge = (
  kind: 'touchpress' | 'touchrelease',
  input: DomTranslationInput,
): InputEvent | undefined => {
  const { context, event, planned } = input
  const action = resolveTouchControl(context.touchControls ?? [], event.target)
  if (typeof action === 'undefined') {
    return
  }
  return { action, kind, target: planned.target }
}

export const translateDomEvent = (
  planned: PlannedListener,
  event: DomInputEvent,
  context: DomEventContext,
): InputEvent | undefined => {
  const input: DomTranslationInput = { context, event, planned }
  switch (planned.event) {
    case 'keydown':
      return translateKeyEvent('keydown', event, planned.target)
    case 'keyup':
      return translateKeyEvent('keyup', event, planned.target)
    case 'mousedown':
      return translateMouseButtonEvent('mousedown', input)
    case 'mouseup':
      return translateMouseButtonEvent('mouseup', input)
    case 'contextmenu':
      /* Carries NO button state by design — `mousedown` already recorded button
         2, and recording it again fires `use` twice for one right-click
         (reference :137-139). The event is dispatched anyway so that "and does
         nothing" is a property a test can assert. */
      return { kind: 'contextmenu', target: planned.target }
    case 'mousemove':
      return translatePointerMove(event)
    case 'wheel':
      return translateWheel(event)
    case 'pointerlockchange':
      /* The event itself says nothing; `document.pointerLockElement` is the
         answer, and `locked: false` here means the lock ENDED — never that it
         was refused. Only `pointerlockerror` says refused (DN-14). */
      return { kind: 'pointerlockchange', locked: context.pointerLockHeld }
    case 'pointerlockerror':
      return { kind: 'pointerlockerror' }
    case 'blur':
      /* The browser sends no keyup while unfocused, so a key held across a tab
         switch stays pressed forever and the player walks on return (DN-08,
         reference :155-158 — a user report, not a theory). */
      return { kind: 'blur' }
    case 'focusin':
      /* ELEMENT to NAME, at the boundary, in exactly one place — the same
         conversion `mouseButtonForIndex` and `wheelDeltaModeForIndex` are, with
         an element where they have a number. An element in no roster resolves
         to `undefined`, which is a REPORT ("focus left our UI") and not a drop:
         dropping it would leave the ring lit on the slot the player just Tabbed
         away from. */
      return translateFocusIn(event, context)
    case 'touchstart':
      /* ELEMENT to NAME, at the boundary, in exactly one place — the third
         reader of `event.target` and the same conversion `focusin` and
         `mousedown` already perform. What comes out is an ACTION and not a
         code, because the code depends on the player's current bindings and
         those live in the service (`withTouchDown`), not here. An adapter that
         resolved the code would keep pressing `KeyE` after a rebind. */
      return translateTouchEdge('touchpress', input)
    case 'touchend':
    case 'touchcancel':
      /* ONE case for two events, and it is the only place this switch collapses
         two DOM names — for the reason `focuschange` collapses `focusin` and
         `focusout`. A cancel and an end are the same fact to everything
         downstream: the finger is off the control. They differ only in whose
         decision it was, and nothing here can act on that difference.

         Handling `touchcancel` is not optional. The platform fires it INSTEAD
         of `touchend` when it takes the gesture over, so an adapter that
         listened only for `touchend` would leave the control held for the rest
         of the session — the player swipes in from the screen edge while
         holding the forward button and walks into a wall until they reload. */
      return translateTouchEdge('touchrelease', input)
    case 'focusout':
      /* Never resolves anything. `focusout` fires on the element being LEFT, so
         resolving its target would report the slot the keyboard just departed
         as the slot it is on. The browser fires focusout then focusin for a
         move, in that order and in the same task, so the arrival overwrites
         this before any frame can read it; a departure to nothing has no
         arrival, and this is the whole of what says so. */
      return { focus: NO_FOCUS_TARGET, kind: 'focuschange' }
    default:
      /* An event name the plan grew without this switch growing with it. Dropped
         rather than guessed, and a test asserts the two lists agree so that the
         drop cannot be how anyone finds out. */
      return
  }
}

/** The object a `ListenerTarget` names. A lookup, not a policy. */
const objectFor = (targets: BrowserInputTargets, target: ListenerTarget): DomEventTarget => {
  if (target === 'window') {
    return targets.window
  }
  return targets.document
}

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
  return
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
export type InstallInputListenersOptions = {
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
  readonly focusGroups?: ReadonlyArray<FocusGroupTargets>
  /**
   * The element the pointer lock would be granted to — the canvas.
   *
   * The SAME object the `PointerLockPort` asks, and that is the whole rule:
   * the element that will receive the lock is the element you must click to ask
   * for it. `browserInputLayer` passes `options.canvas` here automatically, so a
   * host using it declares nothing new; a host that builds the port itself has
   * to hand the canvas over twice, and this option is where.
   *
   * Omitted means "this host has no lock target", which is the same host that
   * gets `UNAVAILABLE_POINTER_LOCK` — no click resolves as `lock-target`, and
   * none could have locked anyway.
   */
  readonly pointerLockTarget?: unknown
  /**
   * The on-screen controls this host drew, in no particular order.
   *
   * Defaults to NONE, which is what every desktop host has. Order is
   * meaningless here — unlike `focusGroups`, where the array position IS the
   * reported index — because a control is resolved by identity to an action and
   * never to a position.
   */
  readonly touchControls?: ReadonlyArray<TouchControlTarget>
}

/** One `changedTouches` entry: the DOM's `Touch`, reduced to what this file reads. */
type TouchContact = NonNullable<DomInputEvent['changedTouches']>[number]

/** How many fingers are holding an action down before the current contact is applied. */
const NO_FINGERS_HOLDING = 0
const ONE_FINGER_HOLDING = 1

type TouchDispatchState = {
  readonly input: InputServiceApi
  readonly touchActionCounts: Map<InputAction, number>
  readonly touchActions: Map<number, InputAction>
  readonly touchControls: ReadonlyArray<TouchControlTarget>
}

const dispatchTouchPress = (
  state: TouchDispatchState,
  contact: TouchContact,
  target: ListenerTarget,
): void => {
  if (state.touchActions.has(contact.identifier)) {
    return
  }
  const action = resolveTouchControl(state.touchControls, contact.target)
  if (typeof action === 'undefined') {
    return
  }
  state.touchActions.set(contact.identifier, action)
  const count = state.touchActionCounts.get(action) ?? NO_FINGERS_HOLDING
  state.touchActionCounts.set(action, count + ONE_FINGER_HOLDING)
  if (count === NO_FINGERS_HOLDING) {
    Effect.runSync(state.input.dispatch({ action, kind: 'touchpress', target }))
  }
}

const dispatchTouchRelease = (
  state: TouchDispatchState,
  contact: TouchContact,
  target: ListenerTarget,
): void => {
  const action = state.touchActions.get(contact.identifier)
  if (typeof action === 'undefined') {
    return
  }
  state.touchActions.delete(contact.identifier)
  // A tracked touch always has a count until its final release.
  const count = state.touchActionCounts.get(action)!
  if (count <= ONE_FINGER_HOLDING) {
    state.touchActionCounts.delete(action)
    Effect.runSync(state.input.dispatch({ action, kind: 'touchrelease', target }))
    return
  }
  state.touchActionCounts.set(action, count - ONE_FINGER_HOLDING)
}

type TouchDispatchRequest = {
  readonly event: DomInputEvent
  readonly kind: 'touchpress' | 'touchrelease'
  readonly target: ListenerTarget
}

const dispatchTouchEvent = (state: TouchDispatchState, request: TouchDispatchRequest): boolean => {
  const {
    event: { changedTouches },
    kind,
    target,
  } = request
  if (typeof changedTouches === 'undefined') {
    return false
  }
  for (let index = 0; index < changedTouches.length; index++) {
    const touch = changedTouches[index]
    if (typeof touch !== 'undefined' && Number.isFinite(touch.identifier)) {
      if (kind === 'touchpress') {
        dispatchTouchPress(state, touch, target)
      } else {
        dispatchTouchRelease(state, touch, target)
      }
    }
  }
  return true
}

/**
 * The DN-16 §5(a) side effect a `keydown` may trigger, factored out of
 * `installInputListeners`'s listener closure purely to keep that closure under
 * this repository's own `max-statements` — the logic is unchanged from what
 * was inline: resolve, then call `.focus()` on what came back, if anything
 * did. See the listener's own comment for why this runs AFTER the ordinary
 * `keydown` dispatch and never calls `event.preventDefault()`.
 *
 * Takes `eventName` and returns immediately for anything but `'keydown'`,
 * rather than leaving that check in the listener as a second statement: only
 * `keydown` can be arrow-key navigation, so every other event — `mousemove`
 * included — must skip the `activeElement` read and the roster walk below
 * before either happens, not after.
 *
 * One object parameter, not four positional ones — `max-params` is 3 in this
 * repository, and threading `targets`/`focusGroups`/`eventName`/`code`
 * separately would only invite a call site to pass them in the wrong order.
 */
type FocusNavigationDispatch = {
  readonly targets: BrowserInputTargets
  readonly focusGroups: ReadonlyArray<FocusGroupTargets>
  readonly eventName: string
  readonly code: string | undefined
}

const applyFocusNavigation = (dispatch: FocusNavigationDispatch): void => {
  if (dispatch.eventName !== 'keydown') {
    return
  }
  const nextFocus = resolveFocusNavigationTarget(dispatch.focusGroups, {
    activeElement: dispatch.targets.document.activeElement,
    code: dispatch.code,
    pointerLockHeld: isPointerLockHeld(dispatch.targets.document),
  })
  if (typeof nextFocus !== 'undefined') {
    nextFocus.focus()
  }
}

export const installInputListeners = (
  targets: BrowserInputTargets,
  input: InputServiceApi,
  options: InstallInputListenersOptions = {},
): InstalledInputListeners => {
  const focusGroups = options.focusGroups ?? []
  const { pointerLockTarget } = options
  const touchControls = options.touchControls ?? []
  const touchState: TouchDispatchState = {
    input,
    touchActionCounts: new Map<InputAction, number>(),
    touchActions: new Map<number, InputAction>(),
    touchControls,
  }

  const registrations: ReadonlyArray<ListenerRegistration> = LISTENER_PLAN.map((planned) => {
    const suppression = suppressionFor(planned.event, input)
    /* Decided once, at install time, so that the per-event cost is one boolean
       test rather than a property read on `document` for every mousemove. */
    const readsLockElement = planned.event === 'pointerlockchange'

    const listener: DomListener = (event) => {
      /* BEFORE the dispatch. The two are independent for the two events that
         have a suppression — neither `wheel` nor `contextmenu` changes the lock
         state — but doing it first means the browser default is suppressed even
         when the event turns out to be untranslatable. A wheel whose
         `deltaMode` cannot be named must still not scroll the page out from
         under a locked canvas. */
      if (typeof suppression !== 'undefined' && Effect.runSync(suppression)) {
        event.preventDefault()
      }

      if (
        planned.event === 'touchstart' &&
        dispatchTouchEvent(touchState, { event, kind: 'touchpress', target: planned.target })
      ) {
        return
      }
      if (
        (planned.event === 'touchend' || planned.event === 'touchcancel') &&
        dispatchTouchEvent(touchState, { event, kind: 'touchrelease', target: planned.target })
      ) {
        return
      }

      const translated = translateDomEvent(planned, event, {
        focusGroups,
        pointerLockHeld: readsLockElement && isPointerLockHeld(targets.document),
        pointerLockTarget,
        touchControls,
      })
      if (typeof translated !== 'undefined') {
        Effect.runSync(input.dispatch(translated))
      }

      /* AFTER the ordinary dispatch above, not instead of it: the raw
         `keydown` — ArrowLeft included — still reaches the service as an
         ordinary held code, exactly as Tab does (see the file header). This
         is a SEPARATE effect layered on top: DN-16 §5(a)'s answer to "which
         member does the group move to", applied by calling `.focus()`
         directly rather than by inventing a new `InputEvent` case for it.
         `.focus()` fires `focusout`/`focusin` on `document` SYNCHRONOUSLY —
         both are already registered listeners — so the resulting
         `keyboardFocus` update reaches `InputService` through the exact same
         path a real Tab press or mouse click does, and this file never
         becomes a second writer of it.

         No `event.preventDefault()` here, and none is added: `mayPreventDefault`
         has no `keydown` case, on purpose (REGRESSION: Tab belongs to the user
         agent), and giving arrow keys an exception would have to be a `keydown`
         exception, which would make Tab eligible too. `ARROW_FOCUS_NAVIGATION_POLICY`
         (`domain/focus-navigation.ts`) records `owner: 'host'` for exactly
         this reason: suppressing whatever a moved arrow key would otherwise
         have done is the HOST's call, made with its own listener, not this
         adapter's. */
      applyFocusNavigation({ code: event.code, eventName: planned.event, focusGroups, targets })
    }

    return {
      event: planned.event,
      listener,
      options: listenerOptionsFor(planned.event),
      target: planned.target,
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
  options: InstallInputListenersOptions = {},
): Effect.Effect<InstalledInputListeners, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => installInputListeners(targets, input, options)),
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

const ignore = (): void => {
  // No-op: swallow a settled promise so it never becomes an unhandled rejection.
}

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
/** The try/catch/thenable-swallowing core of one pointer-lock request. */
const attemptPointerLockRequest = (canvas: PointerLockTarget): PointerLockRequestOutcome => {
  if (typeof canvas.requestPointerLock !== 'function') {
    return 'unavailable'
  }
  try {
    /* Called as a method so that `this` is the canvas, which is what the DOM
       requires and what a `const request = canvas.requestPointerLock` would
       have quietly broken. */
    const result: unknown = canvas.requestPointerLock()
    if (isThenable(result)) {
      result.then(ignore, ignore)
    }
    return 'sent'
  } catch {
    return 'unavailable'
  }
}

export const makeBrowserPointerLockPort = (options: BrowserPointerLockOptions): PointerLockPort => ({
  request: Effect.sync((): PointerLockRequestOutcome => {
    const { canvas } = options
    if (typeof options.allowsPointerLock !== 'undefined' && !options.allowsPointerLock()) {
      return 'unavailable'
    }
    return attemptPointerLockRequest(canvas)
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
  const { canvas } = options
  if (typeof canvas === 'undefined') {
    return UNAVAILABLE_POINTER_LOCK
  }
  if (typeof options.allowsPointerLock === 'undefined') {
    return makeBrowserPointerLockPort({ canvas })
  }
  return makeBrowserPointerLockPort({ allowsPointerLock: options.allowsPointerLock, canvas })
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
    Effect.gen(function* makeBrowserInputService() {
      const input = yield* makeInputService(
        options.bindings ?? defaultBindings(),
        pointerLockPortFor(options),
      )
      /* `options.canvas` twice, on purpose and in one place: it is what the port
         ASKS and what a click has to LAND ON to be allowed to ask. Deriving the
         second from the first is what makes the fix cost a browser host nothing
         — the declaration it already had to make now also scopes the
         acquisition (DN-16 §5(b)). */
      yield* scopedInputListeners(options.targets, input, {
        focusGroups: options.focusGroups ?? [],
        pointerLockTarget: options.canvas,
        touchControls: options.touchControls ?? [],
      })
      return input
    }),
  )

/**
 * ---------------------------------------------------------------------------
 * Building a `TouchControlTarget` roster, and a look gesture across fingers
 * ---------------------------------------------------------------------------
 *
 * Lowered from mc-compose's `apps/web/touch-input.ts`.
 * `TouchControlTarget` and `resolveTouchControl` above are this file's own —
 * a host still has to build the roster and track a multi-finger look drag by
 * hand, which is exactly what a composed game did in its own `apps/`, in
 * mc-render's own vocabulary. Both pieces are DATA and STATE MACHINES, not
 * DOM: `TouchLookContact` below is `{ identifier, clientX, clientY }`, the same
 * three fields a real `Touch` has, but nothing here reads a `Touch` — the
 * adapter above (`dispatchTouchPress`/`dispatchTouchRelease`) is what touches
 * `changedTouches`. They live here rather than in `input-service.ts` for a
 * mechanical reason: `TouchControlTarget` is defined in THIS file, and
 * `input-service.ts` is the module this one imports from — importing it back
 * would be a cycle.
 */

/**
 * The nine actions a touch HUD binds, in a fixed order so a host's target map
 * cannot silently omit one — `TouchControlTargets` below is `Record`-shaped
 * over exactly this tuple, and a missing key is a type error, not a roster
 * with a dead control found only by pressing every button.
 */
export const TOUCH_CONTROL_ACTIONS: readonly [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'attack',
  'use',
  'openInventory',
  'escape',
] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'attack',
  'use',
  'openInventory',
  'escape',
] as const satisfies ReadonlyArray<InputAction>

export type TouchControlAction = (typeof TOUCH_CONTROL_ACTIONS)[number]

export type TouchControlTargets<Target = unknown> = Readonly<Record<TouchControlAction, Target>>

/**
 * Build a `TouchControlTarget` roster from a host's `{action: element}` map.
 *
 * Rejects at construction, not at the first missed tap: `unboundTouchActions`
 * catches an action with no binding (see its own header — this is the check
 * answerable without a browser), and the two loops below catch a target the
 * host forgot to assign and a target the host assigned to two actions. A
 * roster is data a host writes by hand, and all three are typo classes, not
 * runtime conditions.
 *
 * `bindings` defaults to `defaultBindings()` rather than being hardcoded to
 * it — the lowered original always checked the DEFAULT table, which can only
 * ever pass (every `TOUCH_CONTROL_ACTIONS` entry has a default binding, so
 * the throw below was unreachable from any caller and untestable). A host
 * that remapped its keys should validate its roster against what its player
 * ACTUALLY has bound, not the table nobody is using; the parameter also
 * makes the rejection reachable from a test.
 */
const NO_UNAVAILABLE_TOUCH_ACTIONS = 0

export const createTouchControlRoster = <Target>(
  targets: TouchControlTargets<Target>,
  bindings: Bindings = defaultBindings(),
): ReadonlyArray<TouchControlTarget> => {
  const unavailable = unboundTouchActions(bindings, TOUCH_CONTROL_ACTIONS)
  if (unavailable.length > NO_UNAVAILABLE_TOUCH_ACTIONS) {
    throw new Error(`Touch controls have no input binding: ${unavailable.join(', ')}`)
  }

  const owners = new Map<unknown, TouchControlAction>()
  return TOUCH_CONTROL_ACTIONS.map((action) => {
    const target = targets[action]
    if (target === null || target === undefined) {
      throw new Error(`Touch control target is missing: ${action}`)
    }
    const owner = owners.get(target)
    if (owner !== undefined) {
      throw new Error(`Touch control target is shared by ${owner} and ${action}`)
    }
    owners.set(target, action)
    return { action, target }
  })
}

/**
 * One `changedTouches` entry, reduced to the three fields the look gesture
 * reads. A distinct type from this file's own `TouchContact` above (the touch
 * roster's dispatch state, `NonNullable<DomInputEvent['changedTouches']>[number]`)
 * on purpose: that one is shaped by the DOM's `Touch`, and widening it to
 * cover a caller who has already reduced a `Touch` to three plain numbers
 * would let a future DOM-shaped field silently become part of this contract.
 */
export type TouchLookContact = {
  readonly identifier: number
  readonly clientX: number
  readonly clientY: number
}

/**
 * `domain/input-bindings.ts`'s `touchLookStep` advances ONE gesture by one
 * event; a real screen can have several fingers down for other reasons (a
 * touch d-pad, a second hand steadying the device) while only one of them is
 * the look drag. `activeIdentifier` is which finger that is — `null` between
 * drags — so a `move` from any OTHER finger is ignored rather than treated as
 * a second, competing anchor.
 */
export type TouchLookControllerState = {
  readonly activeIdentifier: number | null
  readonly gesture: TouchLookState
  /** Accumulated since the last `consumeTouchLook`, in `touchLookStep`'s delta units. */
  readonly pending: TouchPoint
}

const ZERO_TOUCH_DELTA: TouchPoint = { positionX: 0, positionY: 0 }

export const TOUCH_LOOK_CONTROLLER_IDLE: TouchLookControllerState = {
  activeIdentifier: null,
  gesture: TOUCH_LOOK_IDLE,
  pending: ZERO_TOUCH_DELTA,
}

export type TouchLookContactPhase = 'start' | 'move' | 'end' | 'cancel'

const pointOf = (contact: TouchLookContact): TouchPoint => ({
  positionX: contact.clientX,
  positionY: contact.clientY,
})

const accumulate = (pending: TouchPoint, delta: TouchPoint): TouchPoint => ({
  positionX: pending.positionX + delta.positionX,
  positionY: pending.positionY + delta.positionY,
})

/** The `start` phase: claims the finger only if none is currently claimed. */
const startTouchLook = (
  state: TouchLookControllerState,
  contact: TouchLookContact,
): TouchLookControllerState => {
  if (state.activeIdentifier !== null) {
    return state
  }
  const next = touchLookStep(state.gesture, 'press', pointOf(contact))
  return {
    activeIdentifier: contact.identifier,
    gesture: next.state,
    pending: accumulate(state.pending, next.delta),
  }
}

/**
 * The `end`/`cancel` phase.
 *
 * Calls `touchLookStep(..., 'release', ...)` rather than assigning
 * `TOUCH_LOOK_IDLE` to `gesture` directly — its own 'release' phase always
 * yields that value, and calling it keeps this file from knowing that fact
 * independently of the module that owns it.
 */
const releaseTouchLook = (
  state: TouchLookControllerState,
  contact: TouchLookContact,
): TouchLookControllerState => {
  const released = touchLookStep(state.gesture, 'release', pointOf(contact))
  return {
    activeIdentifier: null,
    gesture: released.state,
    pending: state.pending,
  }
}

/**
 * Advance the look drag by one DOM touch event, already reduced to a
 * `TouchLookContact`.
 *
 * `move`/`end`/`cancel` from any finger OTHER than the one `start` claimed are
 * no-ops: `state` is returned unchanged, which is the same "a stray event
 * costs nothing" rule `touchLookStep` documents for its own
 * `move`-with-no-anchor case.
 */
export const advanceTouchLook = (
  state: TouchLookControllerState,
  phase: TouchLookContactPhase,
  contact: TouchLookContact,
): TouchLookControllerState => {
  if (phase === 'start') {
    return startTouchLook(state, contact)
  }
  if (contact.identifier !== state.activeIdentifier) {
    return state
  }
  if (phase === 'end' || phase === 'cancel') {
    return releaseTouchLook(state, contact)
  }

  const next = touchLookStep(state.gesture, 'move', pointOf(contact))
  return {
    activeIdentifier: state.activeIdentifier,
    gesture: next.state,
    pending: accumulate(state.pending, next.delta),
  }
}

export type ConsumedTouchLook = {
  readonly state: TouchLookControllerState
  readonly delta: TouchPoint
}

/** Read and zero the accumulated delta, same "read empties it" contract `endFrame` uses. */
export const consumeTouchLook = (state: TouchLookControllerState): ConsumedTouchLook => ({
  delta: state.pending,
  state: { ...state, pending: ZERO_TOUCH_DELTA },
})

export type TouchLookResetReason = 'blur' | 'visibility-hidden' | 'state-transition'

/**
 * Drop an in-progress drag without waiting for its `touchend`.
 *
 * Named reasons, not a bare call, so a call site documents ITSELF: `blur` and
 * `visibility-hidden` are the touch equivalent of `InputService`'s own blur
 * rule (a finger lifted while the tab was hidden delivers no event at all),
 * and `state-transition` covers a host leaving gameplay for a modal that owns
 * its own input (opening the inventory mid-drag, for instance).
 */
export const resetTouchLook = (
  _state: TouchLookControllerState,
  reason: TouchLookResetReason,
): TouchLookControllerState => {
  /**
   * Exhaustive over `TouchLookResetReason` already, checked by TypeScript
   * itself (no case, no default, still compiles because every member is
   * covered): a `default` arm here would be dead code no test could reach.
   */
  // oxlint-disable-next-line default-case -- see the comment above.
  switch (reason) {
    case 'blur':
    case 'visibility-hidden':
    case 'state-transition':
      return TOUCH_LOOK_CONTROLLER_IDLE
  }
}

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
