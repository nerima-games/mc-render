/**
 * THE ENTIRE DOM SURFACE THIS REPOSITORY DEPENDS ON, IN ONE FILE.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists instead of `"lib": ["ES2024", "DOM"]`
 * ---------------------------------------------------------------------------
 *
 * `tsconfig.base.json` ships `lib: ["ES2024"]` and `types: []`, and every gate
 * in `pnpm verify` runs over `tsconfig.build.json`, which inherits both. That is
 * not tidiness: it is the mechanism that keeps the post-FX ordering, the wheel
 * model and the pointer-lock state machine testable under `environment: 'node'`.
 * plan.md §3.10 records that Playwright runs on SwiftShader and cannot do
 * pointer lock headless, so a behaviour that needs a real browser to observe is
 * a behaviour NO test in this project can observe — not the unit tests (no DOM)
 * and not the E2E ones (no pointer lock). Turning `"DOM"` on would remove the
 * only thing standing between the domain and that state.
 *
 * The browser adapter still has to talk to `window`, `document` and a canvas.
 * Three ways out were available:
 *
 *   1. Turn `"DOM"` on for the whole project. Rejected: it deletes the property
 *      above for every file, including the pure ones, and nothing would notice
 *      for months.
 *
 *   2. A second tsconfig project that compiles only adapter files with
 *      `lib: ["ES2024", "DOM"]`. Rejected on a mechanical consequence rather
 *      than on taste: `scripts/api-lock.ts` builds its report from
 *      `REPOSITORY_POLICY.tsconfigFile` = `tsconfig.build.json`, and
 *      `scripts/check-dependency-whitelist.ts` classifies shipped source by the
 *      three directory names `index.ts` / `domain/` / `application/` /
 *      `stages/` — both in the byte-identical vendored region that must not be
 *      edited per repository. An adapter outside `tsconfig.build.json` could
 *      not be re-exported from `index.ts` without the API lock either missing it
 *      or failing to emit, so the adapter would be unusable by the previews it
 *      exists for.
 *
 *   3. DESCRIBE, structurally, the handful of DOM members the adapter actually
 *      uses. Chosen.
 *
 * ---------------------------------------------------------------------------
 * The property that makes (3) safe, and how it is proved
 * ---------------------------------------------------------------------------
 *
 * A hand-written structural type is only useful if a REAL `window` satisfies it
 * without a cast. That is not obvious — `strictFunctionTypes` makes listener
 * parameters contravariant, so a naive `(event: KeyboardEventLike) => void`
 * makes `Window` UNASSIGNABLE, and the adapter's users would paper over it with
 * `as unknown as`, which is where the type safety would actually have been lost.
 *
 * So the shapes below are built to be genuine SUPERTYPES of the DOM's own:
 *
 *   - every event member is OPTIONAL, because `Event` guarantees none of them
 *     and `EventListener` is `(evt: Event) => void`. The handler that reads
 *     `event.code` therefore reads `string | undefined` and drops what it cannot
 *     name — the same boundary rule `mouseButtonForIndex` and
 *     `wheelDeltaModeForIndex` already state for numbers it cannot name;
 *   - `preventDefault` is REQUIRED, both because `Event` really does have it and
 *     because a type whose members are all optional is a "weak type" that TS
 *     refuses to accept anything from;
 *   - `pointerLockElement` is `unknown`, because the adapter only ever compares
 *     it against `null`;
 *   - `requestPointerLock` returns `unknown`, because lib.DOM has changed it
 *     from `void` to `Promise<void>` and both must satisfy this.
 *
 * `test/fixtures/dom-surface.ts` is compiled BY A TEST against the real
 * `lib.dom.d.ts` and asserted to produce zero diagnostics, so "a real Window,
 * Document and HTMLCanvasElement satisfy these types" is checked by CI rather
 * than asserted in a comment. That test is the other half of the proof whose
 * first half is `pnpm typecheck`: the build project still compiles with no
 * `lib.DOM` at all, so no domain file can have grown a `document` reference.
 */

/**
 * The third argument of `addEventListener` / `removeEventListener`.
 *
 * A structural subset of the DOM's `AddEventListenerOptions`, which is why the
 * boolean form (`addEventListener(type, listener, true)`) is deliberately not
 * modelled: this adapter always passes an object, and accepting the shorthand
 * would only widen what a fake in a test has to handle.
 *
 * `capture` is here even though the adapter never captures. Removal matches on
 * the capture flag and on nothing else, so passing the same explicit object to
 * both calls is what makes a removal provably match its registration rather
 * than accidentally match it.
 */
export type DomListenerOptions = {
  readonly capture?: boolean
  /**
   * `false` means "this handler may call `preventDefault()`".
   *
   * It is set on exactly the two listeners that do — see `mayPreventDefault` in
   * `browser-input-adapter.ts`. A non-passive listener on a scroll path costs
   * real frame time, because the browser must wait for the handler to return
   * before it knows whether it may scroll.
   */
  readonly passive?: boolean
}

/**
 * One DOM event, as this adapter reads it.
 *
 * ONE flat shape rather than a `KeyboardEvent`/`MouseEvent`/`WheelEvent`
 * hierarchy, and every field optional, because `EventListener`'s parameter is
 * `Event` — a per-event listener type would make a real `window` unassignable to
 * `DomEventTarget` (see the header). The cost is that `event.code` is
 * `string | undefined` inside the keydown handler; the benefit is that
 * `installInputListeners(window, ...)` compiles in a browser project with no
 * cast, and that the handler is forced to say what it does with an event that
 * lacks the field it needs. It drops it — an event handler must not throw, and
 * guessing is worse than dropping.
 */
export type DomInputEvent = {
  /** `Event.preventDefault`. Required: it is what makes this not a weak type. */
  readonly preventDefault: () => void
  /** `KeyboardEvent.code` — layout-independent. NOT `.key`; see `DEFAULT_BINDINGS`. */
  readonly code?: string
  /** `MouseEvent.button`: 0 left, 1 middle, 2 right. Named by `mouseButtonForIndex`. */
  readonly button?: number
  /** `MouseEvent.movementX`, which is only meaningful while the pointer is locked. */
  readonly movementX?: number
  readonly movementY?: number
  /** `WheelEvent.deltaY`, RAW. Normalised to notches in the domain, not here. */
  readonly deltaY?: number
  /** `WheelEvent.deltaMode`: 0 pixel, 1 line, 2 page. Named by `wheelDeltaModeForIndex`. */
  readonly deltaMode?: number
}

/** What `addEventListener` is given. */
export type DomListener = (event: DomInputEvent) => void

/**
 * `window` or `document`, reduced to the two methods the adapter calls.
 *
 * `ListenerTarget` in `domain/input-bindings.ts` is the NAME of one of these and
 * carries the modal-shielding policy; this is the OBJECT. They are separate on
 * purpose: the policy has to be assertable without a DOM, and the object cannot
 * exist without one.
 */
export type DomEventTarget = {
  readonly addEventListener: (type: string, listener: DomListener, options?: DomListenerOptions) => void
  readonly removeEventListener: (type: string, listener: DomListener, options?: DomListenerOptions) => void
}

/**
 * `document`: an event target that also answers who holds the pointer lock.
 *
 * `unknown` rather than an element type because the adapter only asks whether it
 * is `null`. Naming an element type here would drag in the DOM's node hierarchy
 * for a question that is answered by one comparison.
 */
export type DomDocument = DomEventTarget & {
  readonly pointerLockElement: unknown
}

/**
 * The canvas, reduced to the one method `PointerLockPort` performs.
 *
 * OPTIONAL, because "this element cannot be asked" is a real state the port has
 * to report as `unavailable` rather than crash on — an older browser, a
 * non-element, or a canvas that has not been created yet.
 *
 * The return type is `unknown` because it has changed: lib.DOM used to declare
 * `requestPointerLock(): void` and now declares
 * `requestPointerLock(options?: PointerLockOptions): Promise<void>`. Both are
 * assignable to `() => unknown`, so this file does not have to pick a browser
 * vintage — and the adapter, which must not care, is stopped from caring.
 */
export type PointerLockTarget = {
  readonly requestPointerLock?: () => unknown
}

/**
 * Whether anything currently holds the pointer lock.
 *
 * Written as two comparisons rather than `!= null` because `oxlint`'s
 * `no-eq-null` bans the loose form, and `unknown` cannot be compared loosely
 * without it.
 *
 * Deliberately NOT "does OUR canvas hold the lock". A lock held by another
 * element is not this game's lock, but distinguishing the two would require
 * this module to know about elements, and no code path in this repository can
 * produce that situation: the only element that ever asks is the one the host
 * passes to `makeBrowserPointerLockPort`.
 */
export const isPointerLockHeld = (document: DomDocument): boolean =>
  document.pointerLockElement !== null && document.pointerLockElement !== undefined
