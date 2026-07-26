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
  MODAL_LISTENER_TARGET,
  remap,
  type Bindings,
  type InputAction,
  type KeyCode,
  type ListenerTarget,
  type RemapOutcome,
} from '../domain/input-bindings'

/**
 * One input event, as the service sees it.
 *
 * `target` is where the listener that received it was registered. It is part of
 * the event rather than of the handler so that the shielding rule
 * (`domain/input-bindings.ts`) is checkable per event.
 */
export type InputEvent =
  | { readonly kind: 'keydown'; readonly code: KeyCode; readonly target: ListenerTarget }
  | { readonly kind: 'keyup'; readonly code: KeyCode; readonly target: ListenerTarget }
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
 */
export type InputSnapshot = {
  readonly pressed: ReadonlySet<KeyCode>
  readonly justPressed: ReadonlySet<KeyCode>
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
  /** True while the key bound to `action` is held. Never true for `escape`. */
  readonly isActionActive: (action: InputAction) => Effect.Effect<boolean>
  /** True only on the frame the action's key went down. Never true for `escape`. */
  readonly wasActionJustTriggered: (action: InputAction) => Effect.Effect<boolean>
  /** Clear per-frame edges. The frame loop calls this exactly once per frame. */
  readonly endFrame: Effect.Effect<void>
  /** Drop every held key and analogue value. Wired to `blur`. */
  readonly clearHeld: Effect.Effect<void>
  readonly bindings: Effect.Effect<Bindings>
  readonly rebind: (action: InputAction, key: KeyCode) => Effect.Effect<RemapOutcome>
  readonly resetBindings: Effect.Effect<void>
}

export class InputService extends Context.Tag('@nerima-games/mc-render/InputService')<
  InputService,
  InputServiceApi
>() {}

type InputState = {
  readonly pressed: ReadonlySet<KeyCode>
  readonly justPressed: ReadonlySet<KeyCode>
  readonly pointerDelta: { readonly x: number; readonly y: number }
  readonly pointerLocked: boolean
  readonly bindings: Bindings
}

const initialState = (bindings: Bindings): InputState => ({
  pressed: new Set<KeyCode>(),
  justPressed: new Set<KeyCode>(),
  pointerDelta: { x: 0, y: 0 },
  pointerLocked: false,
  bindings,
})

const withKeyDown = (state: InputState, code: KeyCode): InputState => {
  // An auto-repeating keydown must not re-fire the `justPressed` edge: holding
  // E would otherwise open and close the inventory dozens of times a second.
  const alreadyHeld = state.pressed.has(code)
  return {
    ...state,
    pressed: new Set([...state.pressed, code]),
    justPressed: alreadyHeld ? state.justPressed : new Set([...state.justPressed, code]),
  }
}

const withKeyUp = (state: InputState, code: KeyCode): InputState => ({
  ...state,
  pressed: new Set([...state.pressed].filter((held) => held !== code)),
})

export const makeInputService = (bindings: Bindings = defaultBindings()): Effect.Effect<InputServiceApi> =>
  Effect.map(Ref.make(initialState(bindings)), (state) => {
    const resolveHeld = (action: InputAction, held: ReadonlySet<KeyCode>) =>
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
              return event.target === MODAL_LISTENER_TARGET ? current : withKeyDown(current, event.code)
            case 'keyup':
              return event.target === MODAL_LISTENER_TARGET ? current : withKeyUp(current, event.code)
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
              // camera spins the view.
              return {
                ...current,
                pointerLocked: event.locked,
                pointerDelta: event.locked ? current.pointerDelta : { x: 0, y: 0 },
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
          pointerDelta: current.pointerDelta,
          pointerLocked: current.pointerLocked,
        })),
      ),

      isActionActive: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.pressed))),

      wasActionJustTriggered: (action) =>
        Ref.get(state).pipe(Effect.flatMap((current) => resolveHeld(action, current.justPressed))),

      endFrame: Ref.update(state, (current) => ({
        ...current,
        justPressed: new Set<KeyCode>(),
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
  // The pointer/wheel events below sit on `document` because that is where the
  // browser dispatches them, not because of the modal-shielding rule. Only the
  // key events participate in that rule, and only they use the named constants.
  { event: 'mousemove', target: 'document', note: 'pointer delta; only meaningful while locked' },
  { event: 'pointerlockchange', target: 'document', note: 'document-only event' },
  { event: 'pointerlockerror', target: 'document', note: 'document-only event' },
  { event: 'wheel', target: 'document', note: 'passive: false — hotbar cycling calls preventDefault' },
  { event: 'contextmenu', target: 'document', note: 'suppressed so right-click can place blocks' },
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
