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
 *
 * ALLOWED, and it is all of the same kind — NUMBER to NAME at the boundary:
 *
 *   - `MouseEvent.button` -> `mouseButtonForIndex`
 *   - `WheelEvent.deltaMode` -> `wheelDeltaModeForIndex`
 *   - the DOM event NAME -> the `InputEvent` case (`mousemove` -> `pointermove`)
 *   - `document.pointerLockElement` -> `locked: boolean`
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
 * Everything the adapter needs from the world outside `dispatch`.
 *
 * `pointerLockHeld` is read from `document.pointerLockElement` and is only
 * consulted for `pointerlockchange` — it is a parameter rather than a second
 * argument of the same type so that `translateDomEvent` stays a pure function of
 * its inputs and can be tested without a document at all.
 */
export type DomEventContext = {
  readonly pointerLockHeld: boolean
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
      return button === undefined ? undefined : { kind: 'mousedown', button, target: planned.target }
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
): Effect.Effect<InstalledInputListeners, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => installInputListeners(targets, input)),
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
 */
export type BrowserInputOptions = {
  readonly targets: BrowserInputTargets
  readonly canvas?: PointerLockTarget
  readonly allowsPointerLock?: () => boolean
  readonly bindings?: Bindings
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
      yield* scopedInputListeners(options.targets, input)
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
]
