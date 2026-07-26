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
  defaultBindings,
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  GAMEPLAY_LISTENER_TARGET,
  isMouseButton,
  MODAL_LISTENER_TARGET,
  notchesForWheelDelta,
  remap,
  suppressesBrowserContextMenu,
  suppressesBrowserScroll,
  type Bindings,
  type InputAction,
  type InputCode,
  type KeyCode,
  type ListenerTarget,
  type MouseButton,
  type PointerLockState,
  type RemapOutcome,
  type WheelDeltaMode,
} from '../domain/input-bindings'

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
  | { readonly kind: 'mousedown'; readonly button: MouseButton; readonly target: ListenerTarget }
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
   * dismissing a menu, or clicking the canvas to re-acquire the lock. It is
   * kept out of `pressed` / `justPressed` entirely, so `attack` cannot fire
   * from it, and reported separately so the thing that DOES want it — the
   * click-to-lock handler — has something to read.
   */
  readonly uiClicks: ReadonlySet<MouseButton>
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
   * locked. What the click-to-acquire-pointer-lock handler reads.
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
  readonly uiClicks: ReadonlySet<MouseButton>
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
  readonly bindings: Bindings
}

const initialState = (bindings: Bindings): InputState => ({
  pressed: new Set<InputCode>(),
  justPressed: new Set<InputCode>(),
  uiClicks: new Set<MouseButton>(),
  pointerDelta: { x: 0, y: 0 },
  wheelNotches: 0,
  pointerLockState: 'unlocked',
  bindings,
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
    pressed: new Set([...state.pressed, code]),
    justPressed: alreadyHeld ? state.justPressed : new Set([...state.justPressed, code]),
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
 * The reference does NOT make this distinction: `handleMouseDown` (:119-123)
 * records every button whatever the lock state, and gameplay is kept off it by
 * a separate `gamePausedRef` check further down the frame
 * (interaction-stage-snapshot.ts:56-62). That works only while every unlocked
 * state is also a paused state. The click that RE-acquires the lock is the
 * counter-example: it is delivered before the frame knows anything changed, and
 * it is the same left-click that breaks a block. Deciding here, from the state
 * the service already tracks, removes the coupling.
 */
const withButtonDown = (state: InputState, button: MouseButton): InputState =>
  isLocked(state)
    ? withCodeDown(state, button)
    : { ...state, uiClicks: new Set([...state.uiClicks, button]) }

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
  pressed: new Set([...state.pressed].filter((code) => !isMouseButton(code))),
  justPressed: new Set([...state.justPressed].filter((code) => !isMouseButton(code))),
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
                : withButtonDown(current, event.button)
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
              return {
                ...initialState(current.bindings),
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
          uiClicks: current.uiClicks,
          pointerDelta: current.pointerDelta,
          wheelNotches: current.wheelNotches,
          // Truncated TOWARD ZERO, so a partial notch is never a step and the
          // sign is never flipped by rounding. `endFrame` keeps what is left.
          wheelSteps: Math.trunc(current.wheelNotches),
          pointerLocked: isLocked(current),
          pointerLockState: current.pointerLockState,
        })),
      ),

      isActionActive: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.pressed))),

      wasActionJustTriggered: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.justPressed))),

      isButtonDown: (button) => Ref.get(state).pipe(Effect.map((current) => current.pressed.has(button))),

      wasButtonJustPressed: (button) =>
        Ref.get(state).pipe(Effect.map((current) => current.justPressed.has(button))),

      wasUiClick: (button) => Ref.get(state).pipe(Effect.map((current) => current.uiClicks.has(button))),

      shouldSuppressContextMenu: Ref.get(state).pipe(
        Effect.map((current) => suppressesBrowserContextMenu(isLocked(current))),
      ),

      shouldSuppressWheelScroll: Ref.get(state).pipe(
        Effect.map((current) => suppressesBrowserScroll(isLocked(current))),
      ),

      pointerLockState: Ref.get(state).pipe(Effect.map((current) => current.pointerLockState)),

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
          uiClicks: new Set<MouseButton>(),
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

      clearHeld: Ref.update(state, (current) => ({
        ...initialState(current.bindings),
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
    target: GAMEPLAY_LISTENER_TARGET,
    note: 'bubble phase on window, so a modal that stopPropagation()s on document shields it',
  },
  { event: 'keyup', target: GAMEPLAY_LISTENER_TARGET, note: 'same target as keydown, or keys stick' },
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
    target: GAMEPLAY_LISTENER_TARGET,
    note: 'attack/use edge; shielded by modals exactly as keydown is',
  },
  {
    event: 'mouseup',
    target: GAMEPLAY_LISTENER_TARGET,
    note: 'same target as mousedown, or a held button sticks (hold-to-break never stops)',
  },
  // The pointer/wheel events below sit on `document` because that is where the
  // browser dispatches them, not because of the modal-shielding rule. Only the
  // key and button events participate in that rule, and only they use the named
  // constants.
  { event: 'mousemove', target: 'document', note: 'pointer delta; only meaningful while locked' },
  {
    event: 'pointerlockchange',
    target: 'document',
    note: 'document-only event; the GRANT half of the answer to requestPointerLock',
  },
  {
    event: 'pointerlockerror',
    target: 'document',
    note:
      'document-only event; the REFUSAL half of the answer to requestPointerLock. Without it a ' +
      'refused request is indistinguishable from never having asked, and the player is told nothing',
  },
  {
    event: 'wheel',
    target: 'document',
    note:
      'passive: false, so the handler MAY call preventDefault() — but only when ' +
      'shouldSuppressWheelScroll says so, or an unlocked player cannot scroll their own settings ' +
      'screen; deltaMode is translated by wheelDeltaModeForIndex and normalised to notches in the domain',
  },
  {
    event: 'contextmenu',
    target: 'document',
    note:
      'preventDefault() while the pointer is locked, so right-click places a block instead of ' +
      'opening the browser menu; the decision is shouldSuppressContextMenu, and dispatching the ' +
      'event records NO button state (mousedown already did)',
  },
  {
    event: 'blur',
    target: GAMEPLAY_LISTENER_TARGET,
    note: 'clears held input; the browser sends no keyup while unfocused (stuck-controls report)',
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
  registeredBy: 'nobody — the frame-level handler reads it, no binding maps to it',
  rationale:
    'Two owners means one press both closes the modal and opens the pause menu. ' +
    'The reference has exactly one frame-level handler ' +
    '(ts-minecraft/packages/app/application/frame/stages/input-stage-menu.ts:6, called only from input-stage.ts:33).',
} as const
