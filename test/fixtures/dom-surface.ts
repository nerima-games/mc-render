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
} from '../../application/dom-surface'

declare const browserWindow: Window
declare const browserDocument: Document
declare const browserCanvas: HTMLCanvasElement

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
