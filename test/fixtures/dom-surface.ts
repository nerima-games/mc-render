/**
 * NOT A TEST — a fixture that is COMPILED by one.
 *
 * `test/browser-input-adapter.test.ts` builds a TypeScript program over this
 * file with `lib: ["ES2024", "DOM"]` and asserts it produces zero diagnostics.
 * That is what proves the claim `application/dom-surface.ts` makes: a real
 * `Window`, `Document` and `HTMLCanvasElement` satisfy the adapter's structural
 * types WITHOUT A CAST.
 *
 * The claim is not obvious and it is not stable under a careless edit.
 * `strictFunctionTypes` makes listener parameters contravariant, so tightening
 * `DomInputEvent` — making `code` required, say, or splitting the shape into
 * `KeyboardEventLike` and `WheelEventLike` — makes `Window` UNASSIGNABLE to
 * `DomEventTarget`. Nothing in the ordinary `pnpm typecheck` would notice,
 * because that project has no DOM to be assignable from; the first person to
 * notice would be a browser consumer, and the fix they would reach for is
 * `as unknown as`, which is where the type safety would actually be lost.
 *
 * Excluded from `tsconfig.json` and `tsconfig.test.json` (`test/fixtures/**`),
 * because it names DOM types those projects deliberately cannot see. It is
 * still linted and still scanned by `pnpm check:deps`.
 */
import {
  isPointerLockHeld,
  type DomDocument,
  type DomEventTarget,
  type DomInputEvent,
  type DomListener,
  type DomListenerOptions,
  type PointerLockTarget,
} from '../../src/application/dom-surface'

declare const browserWindow: Window
declare const browserDocument: Document
declare const browserCanvas: HTMLCanvasElement
/** The nine hotbar slots mx-ui creates, as a browser host would collect them. */
declare const browserSlots: ReadonlyArray<HTMLElement>

/** The gameplay listener target. `LISTENER_PLAN` puts keys and buttons here. */
export const windowIsAnEventTarget: DomEventTarget = browserWindow

/** The modal listener target, and the one that answers who holds the lock. */
export const documentIsADomDocument: DomDocument = browserDocument

/** `pointerLockElement` is `Element | null`; the adapter only compares it. */
export const lockHeld: boolean = isPointerLockHeld(browserDocument)

/**
 * A canvas satisfies the port's target whether lib.DOM declares
 * `requestPointerLock(): void` or `requestPointerLock(): Promise<void>`.
 */
export const canvasCanBeAsked: PointerLockTarget = browserCanvas

/** An element is an event target too, for a host that scopes listeners to one. */
export const canvasIsAnEventTarget: DomEventTarget = browserCanvas

/**
 * The direction that actually bites: a handler written against `DomInputEvent`
 * has to be acceptable to the REAL `addEventListener`, whose parameter is
 * `EventListenerOrEventListenerObject`.
 */
const handler: DomListener = (event: DomInputEvent) => {
  event.preventDefault()
}

const nonPassive: DomListenerOptions = { capture: false, passive: false }

export const registersAndRemoves = (): void => {
  browserWindow.addEventListener('keydown', handler)
  browserDocument.addEventListener('wheel', handler, nonPassive)
  browserDocument.removeEventListener('wheel', handler, nonPassive)
  browserWindow.removeEventListener('keydown', handler)
}

/**
 * The member added for focus navigation, and the one direction that could have
 * broken everything above.
 *
 * `Event.target` is `EventTarget | null`, so `DomInputEvent.target` has to
 * accept BOTH — and it has to do so without giving TypeScript a reason to stop
 * accepting `Event` itself, because listener parameters are contravariant under
 * `strictFunctionTypes` and an unassignable `Event` makes `Window`
 * unassignable to `DomEventTarget`. `unknown` is the only shape that survives
 * that: an object type with a `getAttribute` member would be a WEAK TYPE with
 * no overlap against `EventTarget`, and TypeScript would reject it outright.
 *
 * If this file ever stops compiling here, the fix is NOT to widen `target` into
 * an element type — it is to keep comparing rather than reading.
 */
const focusHandler: DomListener = (event: DomInputEvent) => {
  const {target} = event
  if (target === null || target === undefined) {
    return
  }
  // The only operation the adapter performs on it: identity, against elements
  // the host named. `resolveFocusTarget` does exactly this, in a loop.
  for (const slot of browserSlots) {
    if (target === slot) {
      return
    }
  }
}

/**
 * A host's focus roster is `ReadonlyArray<unknown>`, so real elements go in
 * without a cast and nothing in this repository can read one by accident.
 */
export const slotsAreOpaqueToTheAdapter: ReadonlyArray<unknown> = browserSlots

/**
 * The lock target is compared the same way, and needs no more of the DOM than
 * the roster does (DN-16 §5(b)).
 *
 * This is the half of the fix that could have cost the surface a member.
 * `contains` (or `composedPath`) was the option DN-16 §5(b) named, and it would
 * have had to go on `DomInputEvent.target` or on the canvas: `EventTarget` has
 * no `contains` — `Node` does — so declaring one would make `Event` unassignable
 * to `DomInputEvent`, and listener parameters being contravariant under
 * `strictFunctionTypes`, `Window` would stop being assignable to
 * `DomEventTarget`. Silently, because `pnpm typecheck` has no DOM to be
 * assignable from. `===` on `event.target` needs none of it: the target IS the
 * deepest element hit, and `<canvas>` has no rendered children to descend into.
 *
 * If this file ever stops compiling here, the fix is NOT to reach for `contains`
 * — it is to keep comparing the element the host named.
 */
const clickLandingHandler: DomListener = (event: DomInputEvent) => {
  const {target} = event
  // The lock target, as the host declares it: the same object it hands to
  // `makeBrowserPointerLockPort`, and the only operation is identity.
  const lockTarget: unknown = browserCanvas
  if (target === lockTarget) {
    return
  }
  for (const slot of browserSlots) {
    if (target === slot) {
      return
    }
  }
}

export const scopesTheLockToAnElementItOnlyCompares = (): void => {
  browserWindow.addEventListener('mousedown', clickLandingHandler, { capture: false })
  browserWindow.removeEventListener('mousedown', clickLandingHandler, { capture: false })
}

/**
 * TOUCH, and the point of this block is what it does NOT need.
 *
 * Adding an input device is the classic occasion for a DOM surface to grow, and
 * the obvious growth is a position: `TouchList`, `changedTouches`, `clientX`.
 * None of it is here, because a tap is resolved by the IDENTITY of the control
 * it landed on, exactly as a focus and a click landing already are. So
 * `DomInputEvent` is byte-identical before and after touch support, and the
 * three assertions this file makes about `Window` and `Document` did not have to
 * be re-argued.
 *
 * `TouchEvent` is deliberately not named below either. It never has to be
 * assignable to `DomInputEvent`: listener parameters are contravariant, so what
 * `addEventListener` requires is that `Event` — the parameter of the real
 * `EventListener` — be assignable, and every event type is delivered through
 * that one signature. Naming `TouchEvent` here would prove nothing and would
 * make the fixture fail to compile in a lib.DOM vintage that lacks it.
 *
 * If this file ever stops compiling here, the fix is NOT to model a touch
 * position — it is to keep resolving the control by identity.
 */
export const registersTheTouchTrio = (): void => {
  const touchHandler: DomListener = (event: DomInputEvent) => {
    const {target} = event
    // The only operation, on the only member: `===` against the elements the
    // host declared as controls. `resolveTouchControl` does exactly this.
    for (const slot of browserSlots) {
      if (target === slot) {
        return
      }
    }
  }
  // Passive by default and left that way. Suppressing `touchstart` would take
  // page scrolling and pinch-zoom away from the player, and `PREVENT_DEFAULT_EVENTS`
  // records why touch is not on the list that may call `preventDefault()`.
  browserWindow.addEventListener('touchstart', touchHandler, { capture: false })
  browserWindow.addEventListener('touchend', touchHandler, { capture: false })
  browserWindow.addEventListener('touchcancel', touchHandler, { capture: false })
  browserWindow.removeEventListener('touchcancel', touchHandler, { capture: false })
  browserWindow.removeEventListener('touchend', touchHandler, { capture: false })
  browserWindow.removeEventListener('touchstart', touchHandler, { capture: false })
}

export const observesFocusAndGivesItBack = (): void => {
  // `focusin` / `focusout` rather than `focus` / `blur`, because only the first
  // pair bubbles — one listener on `document` therefore covers every slot mx-ui
  // ever creates, including ones created after this call.
  browserDocument.addEventListener('focusin', focusHandler, { capture: false })
  browserDocument.addEventListener('focusout', focusHandler, { capture: false })
  browserDocument.removeEventListener('focusout', focusHandler, { capture: false })
  browserDocument.removeEventListener('focusin', focusHandler, { capture: false })
}
