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
  remap,
  suppressesBrowserContextMenu,
  type Bindings,
  type InputAction,
  type InputCode,
  type KeyCode,
  type ListenerTarget,
  type MouseButton,
  type RemapOutcome,
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
  | { readonly kind: 'pointerlockchange'; readonly locked: boolean }
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
  readonly pointerLocked: boolean
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
  /** Clear per-frame edges. The frame loop calls this exactly once per frame. */
  readonly endFrame: Effect.Effect<void>
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
  readonly pointerLocked: boolean
  readonly bindings: Bindings
}

const initialState = (bindings: Bindings): InputState => ({
  pressed: new Set<InputCode>(),
  justPressed: new Set<InputCode>(),
  uiClicks: new Set<MouseButton>(),
  pointerDelta: { x: 0, y: 0 },
  pointerLocked: false,
  bindings,
})

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
  state.pointerLocked
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

export const makeInputService = (bindings: Bindings = defaultBindings()): Effect.Effect<InputServiceApi> =>
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
        Ref.update(state, (current) => {
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
              return current.pointerLocked
                ? {
                    ...current,
                    pointerDelta: {
                      x: current.pointerDelta.x + event.deltaX,
                      y: current.pointerDelta.y + event.deltaY,
                    },
                  }
                : current
            case 'pointerlockchange':
              // Losing the lock also zeroes the accumulated delta: the pointer
              // jumps when the lock is released, and feeding that jump to the
              // camera spins the view. It releases the held buttons for the
              // matching reason — see `withoutHeldButtons`.
              return event.locked
                ? { ...current, pointerLocked: true }
                : {
                    ...withoutHeldButtons(current),
                    pointerLocked: false,
                    pointerDelta: { x: 0, y: 0 },
                  }
            case 'blur':
              return {
                ...initialState(current.bindings),
                pointerLocked: current.pointerLocked,
              }
            default:
              return current
          }
        }),

      snapshot: Ref.get(state).pipe(
        Effect.map((current) => ({
          pressed: current.pressed,
          justPressed: current.justPressed,
          uiClicks: current.uiClicks,
          pointerDelta: current.pointerDelta,
          pointerLocked: current.pointerLocked,
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
        Effect.map((current) => suppressesBrowserContextMenu(current.pointerLocked)),
      ),

      endFrame: Ref.update(state, (current) => ({
        ...current,
        justPressed: new Set<InputCode>(),
        uiClicks: new Set<MouseButton>(),
        pointerDelta: { x: 0, y: 0 },
      })),

      clearHeld: Ref.update(state, (current) => ({
        ...initialState(current.bindings),
        pointerLocked: current.pointerLocked,
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

export const InputServiceLayer = (bindings: Bindings = defaultBindings()): Layer.Layer<InputService> =>
  Layer.effect(InputService, makeInputService(bindings))

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
  { event: 'pointerlockchange', target: 'document', note: 'document-only event' },
  { event: 'pointerlockerror', target: 'document', note: 'document-only event' },
  { event: 'wheel', target: 'document', note: 'passive: false — hotbar cycling calls preventDefault' },
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
