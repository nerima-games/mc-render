/**
 * InputService — the runtime input service mc-render owns (plan.md §2.3-2, §7).
 *
 * ---------------------------------------------------------------------------
 * Why the DOM is injected rather than imported
 * ---------------------------------------------------------------------------
 *
 * The reference registers its listeners directly:
 *
 *   ts-minecraft/packages/presentation/input/input-service.ts:178-190
 *     window.addEventListener('keydown', handleKeyDown)
 *     window.addEventListener('keyup', handleKeyUp)
 *     document.addEventListener('mousemove', handleMouseMove)
 *     ... pointerlockchange, pointerlockerror, wheel, contextmenu ...
 *     window.addEventListener('blur', handleBlur)
 *
 * ...guarded by `typeof window !== 'undefined' && typeof document !== 'undefined'`
 * (:171) so that the module can at least be imported outside a browser.
 *
 * This skeleton takes the events through an injected `InputEventSource` port
 * instead. Two reasons, and the second is the important one:
 *
 * 1. The whole service becomes testable under `environment: 'node'` — no jsdom,
 *    no Playwright, no SwiftShader. plan.md §3.10 records that Playwright runs
 *    on SwiftShader and cannot do pointer lock headless, so an input test that
 *    needs a real browser is an input test that cannot cover pointer lock.
 *
 * 2. The `window` / `document` split is a POLICY (see `domain/input-bindings.ts`
 *    and the Escape ownership rule), not an implementation detail. Making the
 *    target an argument means the policy is checked by the type system at the
 *    call site rather than by reading two `addEventListener` lines.
 *
 * The real browser adapter is a thin `Layer` that builds an `InputEventSource`
 * from `window` and `document` and registers exactly the listeners recorded in
 * `GAMEPLAY_LISTENER_TARGET` / `MODAL_LISTENER_TARGET`. It is not in this
 * skeleton; adding it is what turns `"DOM"` on in `tsconfig.base.json`.
 *
 * ---------------------------------------------------------------------------
 * The blur rule
 * ---------------------------------------------------------------------------
 *
 * `clearHeld` exists because of a real user report, quoted from
 * ts-minecraft/packages/presentation/input/input-service.ts:155-158:
 *
 *   // Clear all held input when the window loses focus. The browser does NOT
 *   // deliver keyup/mouseup for keys/buttons still held when focus leaves, so
 *   // without this a key held during a tab/window switch stays "pressed"
 *   // forever and the player keeps walking/acting on return (user report:
 *   // stuck controls).
 *
 * It is wired to `blur` (:190) rather than to `visibilitychange`, and it clears
 * mouse buttons and analogue state as well as keys.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import {
  type Bindings,
  type ClickLanding,
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  FOCUS_NAVIGATION_KEY_CODE,
  FOCUS_NAVIGATION_OWNER,
  type FocusTarget,
  GAMEPLAY_LISTENER_TARGET,
  type InputAction,
  type InputCode,
  type KeyCode,
  type ListenerTarget,
  MODAL_LISTENER_TARGET,
  type MouseButton,
  type PointerLockState,
  type RemapOutcome,
  type WheelDeltaMode,
  codeForTouchAction,
  defaultBindings,
  isMouseButton,
  notchesForWheelDelta,
  remap,
  reportsKeyboardFocus,
  suppressesBrowserContextMenu,
  suppressesBrowserScroll,
} from '../domain/input-bindings'
import type { GamepadAxes } from '../domain/gamepad-input'

/**
 * One input event, as the service sees it.
 *
 * `target` is where the listener that received it was registered. It is part of
 * the event rather than of the handler so that the shielding rule
 * (`domain/input-bindings.ts`) is checkable per event.
 *
 * The button cases are named for the DOM events the adapter listens to
 * (`mousedown` / `mouseup` / `contextmenu`, exactly the reference's
 * ts-minecraft/packages/presentation/input/input-service.ts:181-183) rather
 * than for the `pointer*` family, so that there is no question which listener
 * produces which case. `pointermove` is the odd one out and predates this; it
 * is fed by `mousemove`.
 *
 * `button` is a NAME, not the DOM's number — see `MOUSE_BUTTONS` in
 * `domain/input-bindings.ts` for why, and `mouseButtonForIndex` for the single
 * place the adapter converts.
 */
export type InputEvent =
  | { readonly kind: 'keydown'; readonly code: KeyCode; readonly target: ListenerTarget }
  | { readonly kind: 'keyup'; readonly code: KeyCode; readonly target: ListenerTarget }
  /**
   * A button went down.
   *
   * `landing` is WHERE it went down — the third thing `acquiresPointerLock`
   * needs and the one the predicate used not to have (DN-16 §5(b)). It rides on
   * `mousedown` and on nothing else because it is only ever consulted for a
   * click that arrives UNLOCKED: while locked the pointer is captured by the
   * lock target, every event goes there by definition, and a release is
   * unconditional. It is REQUIRED rather than defaulted for the reason
   * `acquiresPointerLock` states — a permissive default is the hazard.
   *
   * `target` and `landing` are different questions and both are needed.
   * `target` is WHERE THE LISTENER WAS REGISTERED (`window` or `document`) and
   * carries the modal-shielding rule; `landing` is WHERE THE POINTER WAS when
   * the button went down. A modal that stopped propagation answers the first
   * and says nothing about the second.
   */
  | {
      readonly kind: 'mousedown'
      readonly button: MouseButton
      readonly target: ListenerTarget
      readonly landing: ClickLanding
    }
  | { readonly kind: 'mouseup'; readonly button: MouseButton; readonly target: ListenerTarget }
  /**
   * The browser is about to open its context menu.
   *
   * Carried as an event even though the service records no button state for it,
   * because the reference's comment at :137-139 is a real trap: `mousedown`
   * has ALREADY captured button 2 by the time this arrives, so adding an edge
   * here fires `use` twice for one right-click. Routing it through `dispatch`
   * means that "and does nothing to the button state" is a property a test can
   * assert, instead of an omission nobody can see.
   */
  | { readonly kind: 'contextmenu'; readonly target: ListenerTarget }
  | { readonly kind: 'pointermove'; readonly deltaX: number; readonly deltaY: number }
  /**
   * The wheel turned.
   *
   * `deltaY` is the browser's RAW number and `deltaMode` says what unit it is
   * in; `domain/input-bindings.ts` converts to notches and explains why that
   * conversion is domain policy rather than adapter arithmetic. The adapter's
   * only job is `wheelDeltaModeForIndex(event.deltaMode)` — the same
   * number→name translation it already does for `MouseEvent.button`.
   *
   * No `deltaX`. Horizontal scroll exists on trackpads and nothing reads it;
   * recording it would repeat the reference's mistake of storing every
   * `event.button` a device reports (:120) and never reading most of them.
   * There is also no `target`: `wheel` sits on `document` like the other
   * pointer events and does not participate in the modal-shielding rule.
   */
  | { readonly kind: 'wheel'; readonly deltaY: number; readonly deltaMode: WheelDeltaMode }
  | { readonly kind: 'pointerlockchange'; readonly locked: boolean }
  /**
   * The pointer lock request was REFUSED.
   *
   * Distinct from `pointerlockchange { locked: false }`, which says "the lock
   * ended" — and the distinction is the point. Never having asked and having
   * been told no are different states with different UI, and the reference has
   * only a `console.warn` between them
   * (<reference-impl>/packages/presentation/input/input-service.ts:150-153).
   */
  | { readonly kind: 'pointerlockerror' }
  | { readonly kind: 'blur' }
  /**
   * The keyboard moved to a different element — or off every element this host
   * named.
   *
   * ONE case for the DOM's TWO events (`focusin`, `focusout`), which is the one
   * place this type stops naming cases after the listener that produces them.
   * The reason is that the browser fires both for a single move — `focusout`
   * from the old element, then `focusin` on the new one, synchronously, in that
   * order — so a model with two cases would have an "off everything" state
   * between them that no frame can ever see and every reader would have to
   * reason about. One case carrying the RESOLVED answer says the only thing a
   * consumer wants: the keyboard is now here, or nowhere.
   *
   * `focus: undefined` is "nowhere this host named", and it is what `focusout`
   * always translates to. It is deliberately NOT the same as index 0:
   * `HudView.setKeyboardFocus(undefined)` hides every ring while
   * `setKeyboardFocus(0)` lights slot 0, and reporting a departure as slot 0 is
   * how the ring would follow the player out of the group.
   *
   * There is no `target` field and therefore no modal shielding, exactly as for
   * `pointermove` and `wheel`: `focusin`/`focusout` sit on `document` because
   * that is where the browser dispatches them, and only the key and button
   * events participate in the `window`/`document` rule.
   */
  | { readonly kind: 'focuschange'; readonly focus: FocusTarget | undefined }
  /**
   * An on-screen control was pressed, or released.
   *
   * Carries the ACTION and not a code, and that is the whole of triage row #35
   * ("a tap binds to the same intent a key does"). The roster the host declares
   * says which control means which action; `codeForTouchAction` turns that into
   * the code the player currently has bound, AT DISPATCH TIME rather than at
   * install time — see `withTouchDown`. The adapter cannot do the resolution
   * itself: the bindings live in this service's `Ref`, and an adapter that
   * cached them would go on pressing `KeyE` after the player rebound the
   * inventory to `KeyI`.
   *
   * `target` is here for the same reason it is on `keydown`: a modal that
   * consumed the tap stopped it at `document`, and an event that still says
   * `document` is one the modal did not want either. Touch registers on
   * `window` with the keys and the buttons, so the shielding rule covers all
   * three devices with one mechanism.
   *
   * TWO cases rather than one with a phase, matching `keydown`/`keyup` and
   * `mousedown`/`mouseup`. A press that is held IS a held control — a
   * touch d-pad's forward button is `pressed` for as long as the finger is on
   * it — so the release half is not optional, and a single case carrying a
   * boolean would have made it look like it was.
   */
  | { readonly kind: 'touchpress'; readonly action: InputAction; readonly target: ListenerTarget }
  | { readonly kind: 'touchrelease'; readonly action: InputAction; readonly target: ListenerTarget }
  | { readonly kind: 'gamepadpress'; readonly action: InputAction; readonly target: ListenerTarget }
  | { readonly kind: 'gamepadrelease'; readonly action: InputAction; readonly target: ListenerTarget }
  | { readonly kind: 'gamepadtick'; readonly axes: GamepadAxes }

/**
 * One click that arrived while the pointer was NOT locked, and where it landed.
 *
 * The unit `uiClicks` used to be a bare button. It became a pair when
 * `acquiresPointerLock` grew its third question (DN-16 §5(b)): a set of buttons
 * cannot say that THIS click was on the canvas and THAT one was on a hotbar
 * slot, and the whole of the fix is telling those two apart.
 */
export type UiClick = {
  readonly button: MouseButton
  readonly landing: ClickLanding
}

/**
 * A snapshot of input state, taken once per frame.
 *
 * `justPressed` is separate from `pressed` because "is the jump key down" and
 * "was jump pressed this frame" are different questions, and conflating them
 * is how a single press opens a menu on every frame it is held. It is cleared
 * by `endFrame`, which the frame loop must call exactly once per frame.
 *
 * Mouse buttons live in `pressed` and `justPressed` alongside keys, as
 * `InputCode`s — "break one block per click" is the same edge that "open the
 * inventory once per press" is, and giving it a second mechanism would give it
 * a second way to be cleared, or not cleared, at the frame boundary.
 */
export type InputSnapshot = {
  /** Held gameplay codes: keys, plus buttons pressed while the pointer was LOCKED. */
  readonly pressed: ReadonlySet<InputCode>
  /** Gameplay codes that went down this frame. Cleared by `endFrame`. */
  readonly justPressed: ReadonlySet<InputCode>
  /**
   * Buttons clicked while the pointer was NOT locked. Cleared by `endFrame`.
   *
   * A click while unlocked is a UI click, not a game action: it is the player
   * dismissing a menu, clicking a hotbar slot, or clicking the canvas to
   * re-acquire the lock. It is kept out of `pressed` / `justPressed` entirely,
   * so `attack` cannot fire from it, and reported separately so the things that
   * DO want it — a menu, and the click-to-lock handler — have something to read.
   *
   * The BUTTONS only, and every one of them whatever it landed on: this is what
   * a menu asks ("was I clicked at all"). What asks for the pointer needs to
   * know WHERE, and reads `uiClickLandings` below. DERIVED from that array at
   * snapshot time rather than stored beside it, so the two cannot drift — the
   * same arrangement `pointerLocked` has with `pointerLockState`.
   */
  readonly uiClicks: ReadonlySet<MouseButton>
  /**
   * Every UI click this frame, with WHERE it landed. Cleared by `endFrame`.
   *
   * The reading `acquiresPointerLock` needs, and the reason it is a list of
   * PAIRS rather than a second set: a player can click their hotbar and then the
   * canvas inside one frame, and a shape that lost the pairing would let the
   * first click's landing answer for the second — or the second's for the first,
   * which is the hazard back again with an extra step.
   *
   * Deduplicated on the pair, so a `mousedown` delivered twice for one physical
   * click is one entry, exactly as `justPressed` is one edge. Two clicks of the
   * same button on DIFFERENT landings stay two entries, because they are two
   * different facts.
   */
  readonly uiClickLandings: ReadonlyArray<UiClick>
  readonly pointerDelta: { readonly x: number; readonly y: number }
  /**
   * Signed wheel travel accumulated this frame, in notches, possibly
   * fractional. The analogue reading, for anything that wants smooth travel
   * (a zoom, a scroll bar). A hotbar wants `wheelSteps`.
   *
   * Accumulate-and-clear, exactly like `pointerDelta` — and for the same
   * reason. A wheel event is a delta and the browser delivers several per
   * frame; a snapshot that showed only the last one would silently drop the
   * rest of a fast flick.
   */
  readonly wheelNotches: number
  /**
   * WHOLE notches this frame: `+2` is "the player scrolled two notches down".
   * This is what a hotbar reads, and `wrapHotbarSelection` is what it does
   * with it.
   *
   * `Math.trunc` of `wheelNotches`, and `endFrame` keeps the sub-notch
   * remainder rather than dropping it — see `endFrame`. So `wheelSteps` is
   * never a partial slot, and a trackpad that emits 0.2 notches per frame
   * still advances one slot every fifth frame instead of never advancing.
   */
  readonly wheelSteps: number
  /**
   * True only in `pointerLockState === 'locked'`. Kept as its own field
   * because "is mouselook live" is what most readers actually ask, and derived
   * from the state so the two cannot disagree.
   */
  readonly pointerLocked: boolean
  /**
   * The full lock state. `unlocked` (never asked) and `refused` (asked, told
   * no) are both "not locked" and are not the same thing to a player — see
   * `PointerLockState` in `domain/input-bindings.ts`.
   */
  readonly pointerLockState: PointerLockState
  /**
   * Where the keyboard is, on UI this host named. `undefined` is "not on any of
   * it" and is what `HudView.setKeyboardFocus` must be given to hide the ring.
   *
   * A LEVEL, not an edge, and it is grouped with `pressed` and
   * `pointerLockState` above rather than with `justPressed` and `uiClicks` for
   * that reason. Focus does not happen; focus IS. It persists until the player
   * moves it, so `endFrame` leaves it alone — a ring cleared at the frame
   * boundary would be a ring that flickers at the refresh rate.
   *
   * Reported as `undefined` while the pointer is LOCKED, whatever the browser
   * is actually holding: see `reportsKeyboardFocus`. The observation underneath
   * survives, so unlocking reports the same slot again without the player
   * having to Tab back to it.
   */
  readonly keyboardFocus: FocusTarget | undefined
  /** Normalized left/right stick values for this frame, in the range [-1, 1]. */
  readonly gamepadAxes: GamepadAxes
}

/**
 * How the service ASKS for the pointer lock.
 *
 * A port, not a DOM call, on the rule this whole file is built on: this
 * repository ships no `lib.DOM`, and that is what keeps the input model
 * testable under `environment: 'node'` — which matters more for pointer lock
 * than for anything else, because plan.md §3.10 records that Playwright runs on
 * SwiftShader and cannot do pointer lock at all. A `canvas.requestPointerLock()`
 * in here would be a behaviour NOTHING could test.
 *
 * The browser adapter's implementation is the reference's `requestPointerLock`
 * (<reference-impl>/packages/presentation/input/input-service.ts:252-272)
 * minus its `pointerLockFallbackRef`: it finds the canvas, checks
 * `document.featurePolicy?.allowsFeature('pointer-lock')` (:258-262), and calls
 * the DOM method.
 *
 * `request` yields only whether the ASK went out. It cannot yield whether the
 * lock was granted, because the browser does not know yet either: the answer
 * arrives later, as a `pointerlockchange` or a `pointerlockerror` event through
 * `dispatch`. Modelling the ask as if it were the answer is the bug this port
 * shape exists to make unwritable.
 */
export type PointerLockPort = {
  readonly request: Effect.Effect<PointerLockRequestOutcome>
}

/**
 * `sent` — the ask went to the platform; an event will answer it.
 *
 * `unavailable` — there is nothing to ask: no canvas, no `requestPointerLock`,
 * or a feature policy that forbids it. This is NOT a refusal by the browser and
 * no event will ever arrive, which is exactly why it needs its own value: a
 * request that can never be answered would otherwise leave the state machine in
 * `requested` for the rest of the session. The service resolves it to `refused`
 * immediately.
 *
 * The reference instead sets `pointerLockFallbackRef` and reports itself as
 * LOCKED when the feature policy denies the lock
 * (<reference-impl>/packages/presentation/input/input-service.ts:263-266,
 * :282-284), so that its MCP-driven environment keeps working. That makes
 * `isPointerLocked()` lie, and every click-means-different-things rule in
 * DN-12 is built on that boolean. Not carried over.
 */
export type PointerLockRequestOutcome = 'sent' | 'unavailable'

/**
 * The default port: a platform with no pointer lock, which is precisely what
 * Node is.
 *
 * `makeInputService()` with no arguments therefore has coherent behaviour
 * rather than a hang — asking yields `refused` at once, which is the true
 * answer for the environment the tests run in.
 */
export const UNAVAILABLE_POINTER_LOCK: PointerLockPort = {
  request: Effect.succeed<PointerLockRequestOutcome>('unavailable'),
}

export type InputServiceApi = {
  /**
   * Feed one event in.
   *
   * Events dispatched at `MODAL_LISTENER_TARGET` are IGNORED: a modal that
   * consumed a key stops propagation before the gameplay listener on `window`
   * ever runs, so an event arriving here tagged `document` means the modal did
   * NOT consume it and it was never meant for gameplay either way.
   */
  readonly dispatch: (event: InputEvent) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<InputSnapshot>
  /** True while the code bound to `action` is held. Never true for `escape`. */
  readonly isActionActive: (action: InputAction) => Effect.Effect<boolean>
  /** True only on the frame the action's code went down. Never true for `escape`. */
  readonly wasActionJustTriggered: (action: InputAction) => Effect.Effect<boolean>
  /**
   * True while `button` is held as GAMEPLAY input — i.e. it went down while the
   * pointer was locked. The level, for hold-to-break; the reference's
   * `isMouseDown` (:241).
   */
  readonly isButtonDown: (button: MouseButton) => Effect.Effect<boolean>
  /**
   * True only on the frame `button` went down as gameplay input. The edge, for
   * one-action-per-click; the reference's `consumeMouseClick` (:286).
   *
   * NOT consuming, unlike the reference: reading it twice in one frame returns
   * true twice, and `endFrame` is what clears it. The reference's consume-on-
   * read is why its `contextmenu` handler needed the :137-139 warning at all —
   * with a consuming read, whether a click survives depends on who read it
   * first, and two stages that both care about right-click silently race.
   */
  readonly wasButtonJustPressed: (button: MouseButton) => Effect.Effect<boolean>
  /**
   * True only on the frame `button` was clicked while the pointer was NOT
   * locked, WHEREVER it landed. What a menu reads.
   *
   * NOT what the click-to-acquire-pointer-lock handler reads any more: that one
   * needs the landing as well, and takes it from
   * `InputSnapshot.uiClickLandings`. A boolean per button cannot say whether the
   * click was on the canvas or on the hotbar, and answering the lock question
   * from one is DN-16 §5(b).
   */
  readonly wasUiClick: (button: MouseButton) => Effect.Effect<boolean>
  /**
   * Whether the adapter's `contextmenu` handler must call `preventDefault()`.
   *
   * Read synchronously inside that handler. The decision itself is
   * `suppressesBrowserContextMenu` in `domain/input-bindings.ts`; this is only
   * the lock state it needs applied to it.
   */
  readonly shouldSuppressContextMenu: Effect.Effect<boolean>
  /**
   * Whether the adapter's `wheel` handler must call `preventDefault()`.
   *
   * Read synchronously inside that handler, exactly like
   * `shouldSuppressContextMenu`. The decision is `suppressesBrowserScroll`;
   * this applies the lock state to it. `LISTENER_PLAN` registers the listener
   * with `passive: false` so that the call is legal at all.
   */
  readonly shouldSuppressWheelScroll: Effect.Effect<boolean>
  /**
   * The current lock state, outside a frame snapshot.
   *
   * The click-to-lock path reads this, and so does any UI that wants to say
   * "your browser refused the pointer lock" — which is a thing to draw, not a
   * frame-local edge.
   */
  readonly pointerLockState: Effect.Effect<PointerLockState>
  /**
   * Where the keyboard is, outside a frame snapshot.
   *
   * The read for the stage that drives the HUD: it holds an `HudView`, not the
   * frame's `InputSnapshot`, and asking the service directly is cheaper than
   * threading a snapshot to it. Masked by the lock state exactly as
   * `InputSnapshot.keyboardFocus` is, so the two reads cannot disagree — the
   * pair `pointerLockState` / `InputSnapshot.pointerLockState` is the same
   * arrangement for the same reason.
   *
   * WHAT MX-UI IS CALLED WITH. `input.keyboardFocus` in, and the value goes
   * straight to `HudView.setKeyboardFocus`: both are `number | undefined` on
   * mx-ui's side and `FocusTarget | undefined` here, so the wiring is
   * `focus?.group === HOTBAR_FOCUS_GROUP ? focus.index : undefined`. The call
   * is idempotent and diffed on mx-ui's side (re-stating the same focus mutates
   * no DOM), which is why this repository reports a LEVEL and not a
   * changed-this-frame edge: an edge would be a second mechanism with no
   * consumer, and one that could be missed by a frame that skipped a read.
   */
  readonly keyboardFocus: Effect.Effect<FocusTarget | undefined>
  /**
   * ASK for the pointer lock, and report the state that leaves us in.
   *
   * `requested` — the ask went out; `pointerlockchange` or `pointerlockerror`
   * will answer it. `refused` — there was nothing to ask (the port said
   * `unavailable`). `locked` — we already had it, and no second request was
   * sent.
   *
   * Idempotent while a request is pending: a second call returns `requested`
   * without asking again, because an already-pending request is one of the
   * documented ways a browser refuses the next one.
   *
   * This is what `uiClicks` was missing. `acquiresPointerLock` in
   * `domain/input-bindings.ts` decides WHICH unlocked click calls it, and
   * `stages/registration.ts` is where the frame does so.
   */
  readonly requestPointerLock: Effect.Effect<PointerLockState>
  /**
   * Clear per-frame edges. The frame loop calls this exactly once per frame.
   *
   * Clears `justPressed`, `uiClicks` and the pointer delta outright, and
   * consumes the whole wheel notches THIS FRAME WAS TOLD ABOUT — which is what
   * `frame` is for. Pass the snapshot the frame acted on; `render:input` in
   * `stages/registration.ts` is the shipped example, and it already holds one.
   *
   * ---------------------------------------------------------------------------
   * Why the reading is an argument rather than something the service remembers
   * ---------------------------------------------------------------------------
   *
   * `snapshot` truncates the accumulator at READ time. `endFrame` used to
   * re-read it and truncate AGAIN, at a different instant, so a wheel event
   * arriving between the two — exactly where a DOM listener runs — could carry
   * the second truncation past a notch boundary the first never reached. The
   * frame was told 0 steps and moved 0 hotbar slots; `endFrame` consumed 1. The
   * player turned a detent and the selection did not move, once,
   * unreproducibly. That is the same class as the reference's consume-on-read
   * `consumeMouseClick`, which `wasButtonJustPressed` above rejects by name.
   *
   * The service could remember what the last `snapshot` reported instead. It
   * deliberately does not: that would make `snapshot` a read WITH AN EFFECT on
   * the frame boundary, so a debug overlay or a preview redrawing its analogue
   * panel would change how much travel the next `endFrame` consumed. An
   * observer must not be able to move the thing it observes. Passing the
   * reading back states the contract in the type instead — you cannot end a
   * frame on a reading you did not take.
   *
   * OMITTING `frame` means "no frame read the wheel", and consumes no notches.
   * That is the honest default rather than a convenience: travel nothing acted
   * on is deferred to the frame that does read it, never spent on its behalf.
   */
  readonly endFrame: (frame?: InputSnapshot | undefined) => Effect.Effect<void>
  /** Drop every held code and analogue value. Wired to `blur`. */
  readonly clearHeld: Effect.Effect<void>
  readonly bindings: Effect.Effect<Bindings>
  readonly rebind: (action: InputAction, key: InputCode) => Effect.Effect<RemapOutcome>
  readonly resetBindings: Effect.Effect<void>
}

export class InputService extends Context.Tag('@nerima-games/mc-render/InputService')<
  InputService,
  InputServiceApi
>() {}

type InputState = {
  readonly pressed: ReadonlySet<InputCode>
  readonly justPressed: ReadonlySet<InputCode>
  /**
   * The PAIRS. `InputSnapshot.uiClicks` is this projected to buttons, computed
   * at snapshot time so that the set and the list cannot disagree about whether
   * a click happened.
   */
  readonly uiClicks: ReadonlyArray<UiClick>
  readonly pointerDelta: { readonly x: number; readonly y: number }
  /**
   * Accumulated wheel travel in notches, INCLUDING the sub-notch remainder
   * carried over from previous frames. The single source of wheel truth;
   * `wheelSteps` is a view of it.
   */
  readonly wheelNotches: number
  /**
   * The single source of lock truth. `pointerLocked` is derived from it at
   * snapshot time rather than stored, so there is no pair of fields that can
   * drift apart.
   */
  readonly pointerLockState: PointerLockState
  /**
   * What the browser last told us about focus — UNMASKED.
   *
   * The lock rule is applied at READ time (`reportsKeyboardFocus`) rather than
   * stored, so that a locked session hides the ring without destroying the fact
   * underneath it. Storing the masked value would make the mask irreversible,
   * and unlocking would then report `undefined` for an element the browser is
   * still focusing — a ring on nothing while Space activates slot 3.
   */
  readonly keyboardFocus: FocusTarget | undefined
  readonly gamepadAxes: GamepadAxes
  readonly bindings: Bindings
}

const initialState = (bindings: Bindings): InputState => ({
  bindings,
  gamepadAxes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
  justPressed: new Set<InputCode>(),
  keyboardFocus: undefined,
  pointerDelta: { x: 0, y: 0 },
  pointerLockState: 'unlocked',
  pressed: new Set<InputCode>(),
  uiClicks: [],
  wheelNotches: 0,
})

/** Mouselook is live. The one question most readers of the lock state ask. */
const isLocked = (state: InputState): boolean => state.pointerLockState === 'locked'

const withCodeDown = (state: InputState, code: InputCode): InputState => {
  // An auto-repeating keydown must not re-fire the `justPressed` edge: holding
  // E would otherwise open and close the inventory dozens of times a second.
  // The same guard covers a mouse button: no browser auto-repeats `mousedown`,
  // but a click that arrives twice in one frame — from a device, a synthetic
  // event, or a second listener — must still break exactly one block.
  const alreadyHeld = state.pressed.has(code)
  return {
    ...state,
    justPressed: alreadyHeld ? state.justPressed : new Set([...state.justPressed, code]),
    pressed: new Set([...state.pressed, code]),
  }
}

const withCodeUp = (state: InputState, code: InputCode): InputState => ({
  ...state,
  pressed: new Set([...state.pressed].filter((held) => held !== code)),
})

/**
 * A button going down. THE lock rule lives here.
 *
 * Locked: the pointer is captured by the canvas, so the click is a game action
 * and joins the ordinary code space, edge and all.
 *
 * Unlocked: the click landed on DOM UI, or on the canvas in order to acquire
 * the lock. It becomes a `uiClick` and touches neither `pressed` nor
 * `justPressed`, so `attack` cannot fire from it.
 *
 * WHICH of those two it was is `landing`, recorded here and decided by nothing
 * here. Both are still `uiClicks` — a menu wants the hotbar click as much as the
 * lock handler wants the canvas one — and `acquiresPointerLock` is the only
 * thing that reads the difference. Filtering here instead would have hidden the
 * HUD click from the menu that drew it.
 *
 * The reference does NOT make this distinction: `handleMouseDown` (:119-123)
 * records every button whatever the lock state, and gameplay is kept off it by
 * a separate `gamePausedRef` check further down the frame
 * (interaction-stage-snapshot.ts:56-62). That works only while every unlocked
 * state is also a paused state. The click that RE-acquires the lock is the
 * counter-example: it is delivered before the frame knows anything changed, and
 * it is the same left-click that breaks a block. Deciding here, from the state
 * the service already tracks, removes the coupling.
 */
const withButtonDown = (
  state: InputState,
  button: MouseButton,
  landing: ClickLanding,
): InputState =>
  isLocked(state)
    ? withCodeDown(state, button)
    : {
        ...state,
        // Deduplicated on the PAIR. Two `mousedown`s for one physical click are
        // one UI click, for the reason `withCodeDown` guards the `justPressed`
        // edge; two clicks on two different landings are two facts and both
        // survive.
        uiClicks: state.uiClicks.some(
          (click) => click.button === button && click.landing === landing,
        )
          ? state.uiClicks
          : [...state.uiClicks, { button, landing }],
      }

/**
 * An on-screen control going down, resolved through the CURRENT bindings.
 *
 * `withCodeDown` and not a mechanism of its own, and that is the point rather
 * than a saving: the tap lands in the same `pressed` set, takes the same
 * `justPressed` edge, is cleared by the same `endFrame`, and is dropped by the
 * same `blur`. Row #35's claim is not that touch is supported, it is that a tap
 * and a key press are the same event by the time anything reads them, and
 * reusing this function is what makes that true rather than nearly true.
 *
 * A control bound to nothing does NOTHING — no state change, no throw. The host
 * is expected to have asked `unboundTouchActions` at setup; by the time a finger
 * is on the glass the only options are to drop it or to guess, and this
 * repository drops what it cannot name (`mouseButtonForIndex`,
 * `wheelDeltaModeForIndex`, `translateDomEvent`).
 *
 * ---------------------------------------------------------------------------
 * Why this does NOT go through `withButtonDown`, even for `attack`
 * ---------------------------------------------------------------------------
 *
 * A touch control for `attack` resolves to `MouseLeft` under the defaults, and
 * routing that through `withButtonDown` would gate it on the pointer lock:
 * unlocked, it would become a `uiClick` instead of a press. On a touch device
 * the pointer is NEVER locked — pointer lock is a mouse feature and a phone has
 * no mouse to capture — so the attack button would be dead on every device it
 * was drawn for.
 *
 * The gate that replaces it is the ROSTER. A control only exists while the host
 * has drawn it, and a host draws its touch HUD when the game is live, so
 * "should this tap be a game action" is answered by whether the widget is on
 * screen at all. That is a stronger gate than the lock state, because the host
 * can see the pause menu and the lock state cannot.
 *
 * It also means a tap can never become a `UiClick`, and therefore can never
 * reach `acquiresPointerLock`, which reads `InputSnapshot.uiClickLandings` and
 * nothing else. That is deliberate and is checked by a test: DN-16 §5(b) was a
 * live defect in which clicking the HUD took the pointer, and adding a second
 * input source is exactly the occasion to reopen it.
 */
const withTouchDown = (state: InputState, action: InputAction): InputState => {
  const code = codeForTouchAction(state.bindings, action)
  return code === undefined ? state : withCodeDown(state, code)
}

/** The release half. Same resolution, same code space, same `withCodeUp`. */
const withTouchUp = (state: InputState, action: InputAction): InputState => {
  const code = codeForTouchAction(state.bindings, action)
  return code === undefined ? state : withCodeUp(state, code)
}

/**
 * Losing the pointer lock releases every held button.
 *
 * Symmetric with dropping the accumulated pointer delta (DN-09) and for the
 * same class of reason: the click belonged to the locked session. Hold left to
 * break a block, press Escape — the browser exits the lock and the pause menu
 * opens, and without this the block keeps breaking behind the menu, because
 * `pressed` still holds `MouseLeft` and no `mouseup` is coming while the
 * player's next click goes to the menu.
 *
 * Keys are NOT cleared: keyboard events keep arriving unlocked (the player is
 * typing in chat), and the frame handler still needs to see Escape.
 */
const withoutHeldButtons = (state: InputState): InputState => ({
  ...state,
  justPressed: new Set([...state.justPressed].filter((code) => !isMouseButton(code))),
  pressed: new Set([...state.pressed].filter((code) => !isMouseButton(code))),
})

/**
 * Losing the lock, or being refused it, ends the analogue session.
 *
 * The delta must go (DN-09: the pointer jumps to its pre-lock position and
 * feeding that jump to the camera spins the view) and the accumulated wheel
 * travel must go with it, for the reason DN-09 generalises to: analogue state
 * belongs to the locked session that produced it. Half a flick of the wheel,
 * left over from before the pause menu opened, must not cycle the hotbar when
 * the player comes back.
 */
const withoutAnalogueState = (state: InputState): InputState => ({
  ...state,
  pointerDelta: { x: 0, y: 0 },
  wheelNotches: 0,
})

/**
 * Whole wheel notches `endFrame` may take, given what the frame was told.
 *
 * `frame.wheelSteps` is the figure a consumer acted on, and consuming exactly
 * it is the whole rule. The clamp guards the one way a caller can get this
 * wrong: handing back a STALE snapshot, whose reading the accumulator can no
 * longer cover — the lock was lost in between, or the player scrolled back. A
 * bare subtraction would then drive the accumulator past zero and invent travel
 * in the opposite direction, which is a hotbar that cycles on its own. Taking
 * the smaller magnitude, and only when the two agree on direction, makes the
 * worst case "this frame consumed nothing" instead.
 */
const consumableSteps = (frame: InputSnapshot | undefined, state: InputState): number => {
  const reported = frame === undefined ? 0 : frame.wheelSteps
  const available = Math.trunc(state.wheelNotches)
  if (reported === 0 || available === 0 || Math.sign(reported) !== Math.sign(available)) {
    return 0
  }
  return Math.sign(reported) * Math.min(Math.abs(reported), Math.abs(available))
}

export const makeInputService = (
  bindings: Bindings = defaultBindings(),
  /**
   * How to ask for the pointer lock. Defaults to "this platform has none",
   * which is the truth in Node and makes an un-injected service answer
   * `refused` rather than hang in `requested`.
   */
  pointerLock: PointerLockPort = UNAVAILABLE_POINTER_LOCK,
): Effect.Effect<InputServiceApi> =>
  Effect.map(Ref.make(initialState(bindings)), (state) => {
    const resolveHeld = (action: InputAction, held: ReadonlySet<InputCode>) =>
      Ref.get(state).pipe(
        Effect.map((current) => {
          // `escape` resolves to undefined by construction — it is owned by the
          // frame-level handler, not by any binding.
          const key = action === 'escape' ? undefined : current.bindings[action]
          return key !== undefined && held.has(key)
        }),
      )

    return {
      dispatch: (event) =>
        Ref.update(state, (current): InputState => {
          switch (event.kind) {
            case 'keydown':
              return event.target === MODAL_LISTENER_TARGET ? current : withCodeDown(current, event.code)
            case 'keyup':
              return event.target === MODAL_LISTENER_TARGET ? current : withCodeUp(current, event.code)
            case 'mousedown':
              // Same shielding rule as the keys, and for the same reason: a
              // modal that consumed the click stopped it at `document`, so an
              // event that still says `document` is one the modal did not want
              // either. This is why the adapter registers `mousedown` on
              // `window` — see LISTENER_PLAN.
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withButtonDown(current, event.button, event.landing)
            case 'mouseup':
              // Released whatever the lock state. A button that went down while
              // unlocked is not in `pressed` anyway, so this is a no-op for it;
              // a button that went down while locked and is released after the
              // lock was lost must not be left held.
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withCodeUp(current, event.button)
            case 'contextmenu':
              // Deliberately no state change. `mousedown` already recorded the
              // right button; recording it again here would fire `use` twice
              // for one click (reference :137-139). Whether the browser menu is
              // suppressed is `shouldSuppressContextMenu`, which the adapter
              // reads in the handler — it is a decision, not a state change.
              return current
            case 'pointermove':
              return isLocked(current)
                ? {
                    ...current,
                    pointerDelta: {
                      x: current.pointerDelta.x + event.deltaX,
                      y: current.pointerDelta.y + event.deltaY,
                    },
                  }
                : current
            case 'wheel':
              // Accumulated, not replaced: the browser delivers several wheel
              // events per frame and a fast flick is their SUM. This is the
              // same accumulate-and-clear `pointerDelta` uses in the case
              // above, and deliberately NOT the `justPressed` edge mechanism —
              // an edge cannot say "two notches" (see the wheel section of
              // `domain/input-bindings.ts`).
              //
              // Ignored while unlocked, exactly as `pointermove` is, and for
              // the same reason: an unlocked wheel is scrolling the chat log or
              // the settings list, not cycling the hotbar. `shouldSuppressWheelScroll`
              // is the other half of that rule — unlocked, the adapter does not
              // call `preventDefault()` either, so the scroll reaches the DOM
              // element the player is actually looking at.
              //
              // Normalised HERE, at dispatch, so the accumulator holds one unit.
              // A trackpad (pixels) and a wheel (lines) can both deliver inside
              // one frame; summing raw `deltaY` across them would add 3 to 100
              // and mean nothing.
              return isLocked(current)
                ? {
                    ...current,
                    wheelNotches:
                      current.wheelNotches + notchesForWheelDelta(event.deltaY, event.deltaMode),
                  }
                : current
            case 'pointerlockchange':
              // Losing the lock drops the accumulated analogue state (DN-09)
              // and releases the held buttons (`withoutHeldButtons`).
              //
              // `locked: false` resolves to `unlocked` and NOT to `refused`:
              // this event means a lock ENDED (or a request quietly failed to
              // produce one), while `refused` is only ever what
              // `pointerlockerror` says. Collapsing them would make every
              // ordinary Escape look to the UI like a browser refusal.
              return event.locked
                ? { ...current, pointerLockState: 'locked' }
                : {
                    ...withoutAnalogueState(withoutHeldButtons(current)),
                    pointerLockState: 'unlocked',
                  }
            case 'focuschange':
              // Recorded UNCONDITIONALLY, whatever the lock state, and the
              // masking happens at read time. Dropping the event while locked
              // would be the same class of bug as storing the masked value: the
              // browser really did move focus, and a report built on an
              // observation we declined to make would be stale for the rest of
              // the session.
              //
              // Also deliberately not an edge and not additive: focus is
              // single-valued, so the last thing the browser said IS the state.
              // `focusout` then `focusin` for one move therefore settles on the
              // arrival rather than leaving a hole, because the second
              // assignment overwrites the first within the same DOM task.
              return { ...current, keyboardFocus: event.focus }
            case 'touchpress':
              // The same shielding rule as `keydown` and `mousedown`, applied
              // to the third device. A modal that consumed the tap stopped it at
              // `document`; one that still says `document` was never meant for
              // gameplay.
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withTouchDown(current, event.action)
            case 'touchrelease':
              // Released whatever the lock state, exactly as `mouseup` is, and
              // for the reason `touchcancel` exists at all: if a release can go
              // missing the control sticks, and a stuck on-screen forward button
              // is the touch spelling of the stuck-key report `clearHeld` was
              // written for.
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withTouchUp(current, event.action)
            case 'gamepadpress':
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withTouchDown(current, event.action)
            case 'gamepadrelease':
              return event.target === MODAL_LISTENER_TARGET
                ? current
                : withTouchUp(current, event.action)
            case 'gamepadtick':
              return { ...current, gamepadAxes: event.axes }
            case 'pointerlockerror':
              // Only the lock state changes. A refused request never held the
              // pointer, so there is no delta to drop and no button to release
              // — anything else this touched would be state invented out of a
              // failure.
              return { ...current, pointerLockState: 'refused' }
            case 'blur':
              // The window losing focus ENDS the locked session, exactly as
              // losing the lock does — and `withoutHeldButtons` already states
              // why that matters: "the click belonged to the locked session".
              // Preserving `pointerLockState` here made the two handlers
              // disagree, and the field it preserved is the one that decides
              // what a click MEANS: `withButtonDown` routes a mousedown into
              // `pressed` while the state says `locked`, so until the browser
              // got around to delivering `pointerlockchange` the click the
              // player used to come BACK to the tab was an `attack`.
              //
              // It also unsticks `requested`. Only `pointerlockchange` and
              // `pointerlockerror` ever left that state, and
              // `requestPointerLock` refuses to re-ask while one is pending —
              // correctly, because a second request while one is pending is one
              // of the ways the browser refuses the next. So a request issued
              // and never answered stranded the session: `acquiresPointerLock`
              // declines to act on a click in `requested`, and the player could
              // walk and type but never look around again. This repository
              // already knows that hazard by name for the `unavailable` path
              // (`PointerLockRequestOutcome` above); the `sent` path had the
              // identical hole, and a blur between the ask and the answer is
              // the ordinary way it opens.
              //
              // `unlocked` and NOT `refused`, because the browser did not
              // refuse anything: the ask was abandoned. `refused` is what a UI
              // draws as "click again to look around" and is reserved for
              // `pointerlockerror` and for a platform that has no pointer lock
              // to ask. An existing `refused` therefore survives a blur — it is
              // documented as sticky until something ASKS again, and a blur is
              // not an ask.
              //
              // `keyboardFocus` is the one thing a blur does NOT clear, and it
              // is carried over explicitly rather than by omission so that the
              // exception is visible next to the rule. A window losing focus
              // does not move the DOM focus INSIDE it: the browser remembers
              // which element was focused and restores it when the player comes
              // back, usually without re-announcing it. Clearing here would
              // therefore hide the ring on a tab switch and never bring it back
              // — mc-render's report and the browser's actual focus would
              // disagree, which is the single failure this whole feature exists
              // to prevent. A `focusout` that really did leave the element
              // clears it, and that event arrives on its own.
              return {
                ...initialState(current.bindings),
                keyboardFocus: current.keyboardFocus,
                pointerLockState: current.pointerLockState === 'refused' ? 'refused' : 'unlocked',
              }
            default:
              return current
          }
        }),

      // A PURE read, with no effect on the frame boundary — see `endFrame` on
      // why the reading is handed back rather than remembered here.
      snapshot: Ref.get(state).pipe(
        Effect.map((current) => ({
          pressed: current.pressed,
          justPressed: current.justPressed,
          // PROJECTED from the pairs, never stored beside them. A set and a
          // list that both claimed to know whether a click happened would be
          // two answers to one question.
          uiClicks: new Set(current.uiClicks.map((click) => click.button)),
          uiClickLandings: current.uiClicks,
          pointerDelta: current.pointerDelta,
          wheelNotches: current.wheelNotches,
          // Truncated TOWARD ZERO, so a partial notch is never a step and the
          // sign is never flipped by rounding. `endFrame` keeps what is left.
          wheelSteps: Math.trunc(current.wheelNotches),
          pointerLocked: isLocked(current),
          pointerLockState: current.pointerLockState,
          // MASKED, never cleared. `reportsKeyboardFocus` is the policy and
          // `InputState.keyboardFocus` says why the mask is applied here rather
          // than at dispatch.
          keyboardFocus: reportsKeyboardFocus(current.pointerLockState)
            ? current.keyboardFocus
            : undefined,
          gamepadAxes: current.gamepadAxes,
        })),
      ),

      isActionActive: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.pressed))),

      wasActionJustTriggered: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.justPressed))),

      isButtonDown: (button) => Ref.get(state).pipe(Effect.map((current) => current.pressed.has(button))),

      wasButtonJustPressed: (button) =>
        Ref.get(state).pipe(Effect.map((current) => current.justPressed.has(button))),

      // Whatever it landed ON. A menu asks "was I clicked", not "was the canvas
      // clicked"; the landing is `acquiresPointerLock`'s question and is read
      // through `InputSnapshot.uiClickLandings`.
      wasUiClick: (button) =>
        Ref.get(state).pipe(
          Effect.map((current) => current.uiClicks.some((click) => click.button === button)),
        ),

      shouldSuppressContextMenu: Ref.get(state).pipe(
        Effect.map((current) => suppressesBrowserContextMenu(isLocked(current))),
      ),

      shouldSuppressWheelScroll: Ref.get(state).pipe(
        Effect.map((current) => suppressesBrowserScroll(isLocked(current))),
      ),

      pointerLockState: Ref.get(state).pipe(Effect.map((current) => current.pointerLockState)),

      keyboardFocus: Ref.get(state).pipe(
        Effect.map((current) =>
          reportsKeyboardFocus(current.pointerLockState) ? current.keyboardFocus : undefined,
        ),
      ),

      requestPointerLock: Effect.gen(function* () {
        // Claim the transition BEFORE asking, in one atomic step. Two stages
        // that both see a UI click in the same frame would otherwise both send
        // a request, and a request sent while another is pending is one of the
        // ways the browser refuses.
        const asked = yield* Ref.modify(state, (current): [boolean, InputState] =>
          current.pointerLockState === 'unlocked' || current.pointerLockState === 'refused'
            ? [true, { ...current, pointerLockState: 'requested' }]
            : [false, current],
        )
        if (!asked) {
          // Already `locked` or already `requested`. Report which, ask nothing.
          return yield* Ref.get(state).pipe(Effect.map((current) => current.pointerLockState))
        }

        const outcome = yield* pointerLock.request
        return yield* Ref.modify(state, (current): [PointerLockState, InputState] => {
          // Resolve `unavailable` to `refused` only if we are still waiting.
          // The answer to a `sent` request comes as an event, and by the time
          // we get here that event may already have landed — overwriting a
          // `locked` we have just been granted would be a lie the next frame
          // would draw.
          const next: PointerLockState =
            outcome === 'unavailable' && current.pointerLockState === 'requested'
              ? 'refused'
              : current.pointerLockState
          return [next, { ...current, pointerLockState: next }]
        })
      }),

      endFrame: (frame) =>
        Ref.update(state, (current) => ({
          ...current,
          justPressed: new Set<InputCode>(),
          uiClicks: [],
          pointerDelta: { x: 0, y: 0 },
          // Whole notches are consumed; the SUB-NOTCH REMAINDER is kept. This
          // is the one deliberate difference from `pointerDelta`, which is
          // zeroed outright, and the reason is the trackpad: it emits a few
          // pixels per event, so every frame's total rounds to zero notches and
          // a clear-everything rule would make the hotbar unreachable on a
          // laptop. The remainder is dropped whenever the lock is lost or the
          // window blurs, and cancels itself out when the player scrolls back —
          // so it cannot accumulate into a phantom step.
          //
          // Consumed: exactly the whole notches `frame` was told about. What
          // the accumulator holds NOW is not the question; see the doc on
          // `endFrame` in `InputServiceApi`.
          wheelNotches: current.wheelNotches - consumableSteps(frame, current),
        })),

      // `keyboardFocus` survives, on the same argument the `blur` case makes:
      // this drops HELD input and ANALOGUE state, and focus is neither. The
      // browser has not moved it, so forgetting it would only make the report
      // wrong.
      clearHeld: Ref.update(state, (current) => ({
        ...initialState(current.bindings),
        keyboardFocus: current.keyboardFocus,
        pointerLockState: current.pointerLockState,
      })),

      bindings: Ref.get(state).pipe(Effect.map((current) => current.bindings)),

      rebind: (action, key) =>
        Ref.modify(state, (current): [RemapOutcome, InputState] => {
          const outcome = remap(current.bindings, action, key)
          return outcome.kind === 'ok'
            ? [outcome, { ...current, bindings: outcome.bindings }]
            : [outcome, current]
        }),

      resetBindings: Ref.update(state, (current) => ({ ...current, bindings: defaultBindings() })),
    }
  })

export const InputServiceLayer = (
  bindings: Bindings = defaultBindings(),
  pointerLock: PointerLockPort = UNAVAILABLE_POINTER_LOCK,
): Layer.Layer<InputService> => Layer.effect(InputService, makeInputService(bindings, pointerLock))

/**
 * What the browser adapter must register, as data.
 *
 * Exported so the adapter reads its listener table out of the domain policy
 * rather than restating it, and so a test can assert the table without a DOM.
 * The Escape entry is the one that matters: it is registered nowhere, because
 * `ESCAPE_OWNER` is the frame-level handler.
 */
export const LISTENER_PLAN: ReadonlyArray<{
  readonly event: string
  readonly target: ListenerTarget
  readonly note: string
}> = [
  {
    event: 'keydown',
    note: 'bubble phase on window, so a modal that stopPropagation()s on document shields it',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  { event: 'keyup', note: 'same target as keydown, or keys stick', target: GAMEPLAY_LISTENER_TARGET },
  // `mousedown` / `mouseup` sit on `window` with the keys, and NOT on
  // `document` where the reference puts them (:181-182). The reference's
  // placement was safe when no button carried a gameplay action; now that left
  // and right click ARE `attack` and `use`, buttons must obey the same modal
  // shielding as keys, and a listener on `document` cannot be shielded by a
  // modal that also stops propagation at `document` — whether it is shielded
  // would depend on registration order. Both events bubble to `window`, so the
  // move costs nothing.
  {
    event: 'mousedown',
    note: 'attack/use edge; shielded by modals exactly as keydown is',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  {
    event: 'mouseup',
    note: 'same target as mousedown, or a held button sticks (hold-to-break never stops)',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  // The pointer/wheel events below sit on `document` because that is where the
  // browser dispatches them, not because of the modal-shielding rule. Only the
  // key and button events participate in that rule, and only they use the named
  // constants.
  { event: 'mousemove', note: 'pointer delta; only meaningful while locked', target: 'document' },
  {
    event: 'pointerlockchange',
    note: 'document-only event; the GRANT half of the answer to requestPointerLock',
    target: 'document',
  },
  {
    event: 'pointerlockerror',
    note:
      'document-only event; the REFUSAL half of the answer to requestPointerLock. Without it a ' +
      'refused request is indistinguishable from never having asked, and the player is told nothing',
    target: 'document',
  },
  {
    event: 'wheel',
    note:
      'passive: false, so the handler MAY call preventDefault() — but only when ' +
      'shouldSuppressWheelScroll says so, or an unlocked player cannot scroll their own settings ' +
      'screen; deltaMode is translated by wheelDeltaModeForIndex and normalised to notches in the domain',
    target: 'document',
  },
  {
    event: 'contextmenu',
    note:
      'preventDefault() while the pointer is locked, so right-click places a block instead of ' +
      'opening the browser menu; the decision is shouldSuppressContextMenu, and dispatching the ' +
      'event records NO button state (mousedown already did)',
    target: 'document',
  },
  {
    event: 'blur',
    note: 'clears held input; the browser sends no keyup while unfocused (stuck-controls report)',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  // The touch trio. On `window` with the keys and the mouse buttons, and NOT on
  // `document` where the other pointer events sit: a tap is gameplay input that
  // a modal must be able to shield, which is the same argument that moved
  // `mousedown`/`mouseup` off `document`. A touch listener on `document` could
  // not be shielded by a modal that also stops propagation at `document` —
  // whether it was shielded would depend on registration order.
  {
    event: 'touchstart',
    note:
      'an on-screen control was pressed; the roster resolves the ELEMENT to an action and ' +
      'codeForTouchAction resolves the action to whatever the player has bound (triage #35)',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  {
    event: 'touchend',
    note: 'same target as touchstart, or a held control sticks — the stuck-key report, on glass',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  {
    event: 'touchcancel',
    note:
      'the platform took the gesture (system edge-swipe, incoming call) and NO touchend will ' +
      'follow. Without this entry the control stays pressed for the rest of the session',
    target: GAMEPLAY_LISTENER_TARGET,
  },
  // The focus pair. On `document` because `focusin`/`focusout` BUBBLE and
  // `focus`/`blur` do not — which is the whole reason these two event names are
  // the ones registered. A `focus` listener would have to be installed on every
  // slot mx-ui creates, i.e. this repository would need to know about elements
  // it does not own and re-install listeners whenever the HUD rebuilt.
  //
  // Note also what is NOT here: no `keydown` entry for Tab. The browser moves
  // focus; these two listeners find out where it went. Anything else would be
  // reimplementing the platform's focus order, badly, and would then need
  // `preventDefault()` to stop the platform's own version running as well.
  {
    event: 'focusin',
    note:
      'bubbles (unlike `focus`), so ONE listener covers every slot mx-ui ever creates; the event ' +
      "target is resolved against the host's focus roster and reported as a FocusTarget",
    target: 'document',
  },
  {
    event: 'focusout',
    note:
      'the departure half. Always reports NO focus: a move fires focusout then focusin in the same ' +
      'DOM task, so the arrival overwrites this, and a departure to nothing correctly leaves it',
    target: 'document',
  },
]

/**
 * Everything about Escape, in one exported value.
 *
 * A test asserts against this, so "who closes the modal?" has a greppable
 * answer that CI checks rather than a comment that drifts.
 */
export const ESCAPE_POLICY = {
  key: ESCAPE_KEY_CODE,
  owner: ESCAPE_OWNER,
  rationale:
    'Two owners means one press both closes the modal and opens the pause menu. ' +
    'The reference has exactly one frame-level handler ' +
    '(ts-minecraft/packages/app/application/frame/stages/input-stage-menu.ts:6, called only from input-stage.ts:33).',
  registeredBy: 'nobody — the frame-level handler reads it, no binding maps to it',
} as const

/**
 * Everything about Tab, in one exported value — the counterpart to
 * `ESCAPE_POLICY`, and the place a test can assert that nothing has quietly
 * started suppressing the browser's focus navigation.
 *
 * `preventDefault: false` is the field that matters. It is stated as a value
 * rather than left implicit in the absence of a listener, because "we do not
 * suppress Tab" is a promise that is broken by ADDING something, and a promise
 * that lives only in an absence has nothing for CI to check.
 *
 * The distinction from `ESCAPE_POLICY` is worth reading twice. Escape's owner
 * is one this codebase chose: the frame-level handler, and it could be moved.
 * Tab's owner is the user agent, and it cannot be moved — only overridden, with
 * `preventDefault()`, which is precisely the keyboard trap the whole feature is
 * built to avoid (WCAG 2.1 SC 2.1.2). So the two policies have opposite
 * shapes: Escape names an owner INSIDE the app and forbids a second one;
 * Tab names an owner OUTSIDE it and forbids the app from becoming one.
 */
export const FOCUS_NAVIGATION_POLICY = {
  key: FOCUS_NAVIGATION_KEY_CODE,
  owner: FOCUS_NAVIGATION_OWNER,
  preventDefault: false,
  rationale:
    'Suppressing Tab traps a keyboard user inside the canvas with no way to reach the browser ' +
    'chrome, the next control, or the settings screen that would let them rebind their way out ' +
    '(WCAG 2.1 SC 2.1.2). Unlike the context menu and the page scroll, which are narrowed to the ' +
    'locked state by suppressesBrowserContextMenu / suppressesBrowserScroll, focus navigation has ' +
    'no lock state in which suppressing it is defensible — so there is no predicate for it, only ' +
    'this record. `remap` refuses to bind Tab for the same reason: the owner that cannot be ' +
    'removed must not be given a second.',
  registeredBy:
    'nobody — the browser moves focus, and `focusin`/`focusout` on document report where it went',
} as const
