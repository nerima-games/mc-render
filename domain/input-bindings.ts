/**
 * Input bindings, and the Escape-key ownership rule.
 *
 * ---------------------------------------------------------------------------
 * Why input lives in mc-render at all
 * ---------------------------------------------------------------------------
 *
 * plan.md §2.3-2:
 *
 *   **実行時入力サービスは mc-render が所有。** kit は devDependency 専用のため、
 *   kit に入力を置くと本番ゲームから入力が消える。
 *
 * mc-playground-kit is dev-only: it is never in a release build. If the runtime
 * input service lived there, the shipped game would have no input handling at
 * all — it would build, start, render, and ignore the keyboard. That failure is
 * silent at compile time and total at run time, which is the worst combination,
 * so `scripts/check-dependency-whitelist.ts` makes a runtime dependency on
 * mc-playground-kit a hard CI failure (`dev-only-package-in-dependencies`).
 *
 * mc-render is the right owner because input is a browser-platform concern and
 * mc-render is already the repository that owns the browser platform (canvas,
 * WebGL, pointer lock). plan.md §7 assigns it here explicitly.
 *
 * ---------------------------------------------------------------------------
 * The Escape key has exactly one owner
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.9:
 *
 *   入力は `window` にキー登録。モーダルは stopPropagation で遮蔽し、
 *   **Escapeキーの所有者はフレーム側の単一ハンドラ**
 *
 * The mechanism, from the reference at
 * ts-minecraft/packages/presentation/input/input-service.ts:172-177:
 *
 *   // Key listeners live on `window` (bubble phase) so modal overlays
 *   // (inventory/settings/pause/chat) that consume a key with
 *   // stopPropagation() on `document` shield it from gameplay input.
 *   // Otherwise the frame-pipeline sees the same Escape one frame after
 *   // the modal already handled it and acts on stale modal state.
 *
 * Read carefully, that is a three-part protocol:
 *
 *   1. gameplay input registers on `window` (:178-179 `keydown`/`keyup`);
 *   2. modals register on `document`, which is INSIDE window in the bubble
 *      path, and call `stopPropagation()` on keys they consume;
 *   3. therefore a key a modal consumed never reaches gameplay input at all.
 *
 * The failure it prevents is specific and worth naming: without it, the modal
 * closes on Escape AND the frame pipeline sees the same Escape one frame later,
 * reads the now-stale modal state, and opens the pause menu. The player presses
 * Escape once and gets two things.
 *
 * The reference's single frame-level Escape owner is
 * `ts-minecraft/packages/app/application/frame/stages/input-stage-menu.ts:6`
 * (`handleEscape`), called from exactly one place,
 * `.../input-stage.ts:33`. `ESCAPE_OWNER` below records that as a value so the
 * rule is greppable rather than folklore.
 *
 * ---------------------------------------------------------------------------
 * Why this module is pure
 * ---------------------------------------------------------------------------
 *
 * Everything here is data and pure functions: no `window`, no `document`, no
 * DOM types. The browser adapter is `application/input-service.ts`, which takes
 * an injected event source. That split is what lets key remapping, chord
 * resolution and the Escape rule be tested in Node under
 * `environment: 'node'` — no jsdom, no Playwright, no SwiftShader.
 */

/**
 * Every action the game can be told to perform by an input device.
 *
 * PRE-AUDIT FIRST CUT. The reference's real set is larger (hotbar slots 1-9,
 * gamepad axes, touch gestures, screenshot, debug overlay). This is the subset
 * needed to express the Escape rule and the remapping mechanism.
 */
export const INPUT_ACTIONS = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'sneak',
  'sprint',
  'openInventory',
  'openChat',
  /**
   * The two most basic interactions in the game: break a block, place a block.
   *
   * They are here because a vertical-slice spike could not express "the player
   * breaks a block" — there was no mouse-button action, so the spike bound
   * breaking to `KeyB` to get past it. The reference has had both since the
   * beginning, as raw button numbers read straight out of the frame:
   * ts-minecraft/packages/app/application/frame/stages/interaction-stage-snapshot.ts:63-69
   * (`consumeMouseClick(0)` / `isMouseDown(0)` / `consumeMouseClick(2)` /
   * `isMouseDown(2)`).
   *
   * `attack` and `use` rather than `break` and `place`: `break` is a reserved
   * word, and both actions are already more than their block behaviour —
   * `attack` also hits mobs and `use` also eats, draws a bow and opens a chest
   * (the reference's right-click path in `interaction-stage.ts:76` holds for
   * food, and `interaction-bow-handler.ts` for the bow). Naming them for the
   * block case would be wrong within a week.
   */
  'attack',
  'use',
  /**
   * Middle-click pick-block. In the reference at
   * ts-minecraft/packages/app/application/frame/stages/interaction-stage-snapshot.ts:65
   * (`consumeMouseClick(1)`).
   *
   * Included because the button exists whether or not it is named: `MouseMiddle`
   * is a member of `MOUSE_BUTTONS`, so leaving it unbound would mean the one
   * button with an established meaning in the reference is the one the binding
   * table cannot express.
   */
  'pickBlock',
  /**
   * NOT a gameplay action. Listed so that the type system knows Escape exists,
   * and rejected by `bindingFor` — see `ESCAPE_OWNER`.
   */
  'escape',
] as const

export type InputAction = (typeof INPUT_ACTIONS)[number]

/**
 * `KeyboardEvent.code` values. A branded string is not used: the values come
 * from the browser and refining them would only move the failure to a throw at
 * the boundary of an event handler, which is the one place that must not throw.
 */
export type KeyCode = string

/**
 * ---------------------------------------------------------------------------
 * Mouse buttons: NAMES in the model, numbers only at the adapter boundary
 * ---------------------------------------------------------------------------
 *
 * The DOM numbers its buttons (`MouseEvent.button`: 0 left, 1 middle, 2 right)
 * and the reference carries that number all the way through — its state is a
 * `HashMap<number, boolean>` and its call sites read `isMouseDown(2)`
 * (ts-minecraft/packages/presentation/input/input-service.ts:46,244 and
 * .../frame/stages/interaction-stage.ts:76). A number is what an adapter
 * receives, so the reference's choice costs nothing at the boundary and
 * everything at the call site: `consumeMouseClick(2)` is only readable if you
 * remember which end of the mouse `2` is, and `camera-stage.ts:52` naming its
 * result `rightClickHeld` is the comment that a name would have made
 * unnecessary.
 *
 * This model names them, for one reason that outweighs adapter convenience:
 * **bindings are persisted and remappable.** A settings blob that says
 * `{"attack": 2}` is ambiguous with a key code and unreadable by a human
 * editing it, and `remap` would have to detect conflicts across two value
 * spaces (numbers for buttons, strings for keys) rather than one. Naming them
 * puts buttons in the SAME code space as keys, and everything the keyboard path
 * already does — one code one action, `justPressed` edges, `blur` clearing,
 * `endFrame` — then applies to buttons without a second mechanism.
 *
 * The prefix is what makes one space safe: `KeyboardEvent.code` has a closed
 * vocabulary (`KeyW`, `Space`, `ShiftLeft`, `F3`, `Numpad0`, ...) and no member
 * of it begins with `Mouse`. So the two namespaces cannot collide, and
 * `isMouseButton` can decide which kind a code is by looking at it.
 *
 * The number→name translation happens in exactly one place,
 * `mouseButtonForIndex`, which is the only function in this repository that
 * knows what `2` means.
 */
export const MOUSE_BUTTONS = ['MouseLeft', 'MouseMiddle', 'MouseRight'] as const

export type MouseButton = (typeof MOUSE_BUTTONS)[number]

/**
 * Indexed by `MouseEvent.button`. The array position IS the DOM number, which
 * is why this is an array and not a record.
 */
export const MOUSE_BUTTON_BY_INDEX: ReadonlyArray<MouseButton> = MOUSE_BUTTONS

/**
 * The named button for a `MouseEvent.button` index, or `undefined`.
 *
 * `undefined` for 3 and 4 (the browser's "back"/"forward" thumb buttons) and
 * for anything else a device reports. The reference stored every index it was
 * given (`HashMap.set(mouseButtonsRef, event.button, true)`, :120) and nothing
 * ever read the extra ones, so a thumb button was recorded state that could
 * never become an action. Here an unnamed button is dropped at the boundary:
 * the set of buttons that exist is the set of buttons that can be bound, and
 * adding a thumb button is one entry in `MOUSE_BUTTONS`.
 *
 * Total, and returns a value rather than throwing, because it runs inside a DOM
 * event handler — the one place that must not throw.
 */
export const mouseButtonForIndex = (index: number): MouseButton | undefined =>
  MOUSE_BUTTON_BY_INDEX[index]

/**
 * Anything a binding can point at: a `KeyboardEvent.code` or a named mouse
 * button.
 *
 * Both are strings, so this is `string` at run time and the distinction is for
 * the reader and for `isMouseButton`. That is the point — the pressed set, the
 * `justPressed` edge set, the conflict check in `remap` and the persisted
 * settings blob are all one space, so a player may bind `attack` to `KeyB` (the
 * spike's workaround, now a legitimate accessibility remap) or `jump` to
 * `MouseMiddle`, and neither needs new code.
 */
export type InputCode = KeyCode | MouseButton

/** True when a code names a mouse button rather than a keyboard key. */
export const isMouseButton = (code: InputCode): code is MouseButton =>
  (MOUSE_BUTTONS as ReadonlyArray<string>).includes(code)

/**
 * Default bindings. Keys are `KeyboardEvent.code`, not `.key`: `code` is
 * layout-independent, so WASD stays under the same fingers on AZERTY and
 * Dvorak. Binding `.key` is how a French player ends up unable to walk forward.
 *
 * Mouse buttons follow vanilla: left breaks, right places/uses, middle picks.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Exclude<InputAction, 'escape'>, InputCode>> = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  openInventory: 'KeyE',
  openChat: 'KeyT',
  attack: 'MouseLeft',
  use: 'MouseRight',
  pickBlock: 'MouseMiddle',
}

/**
 * WHO OWNS ESCAPE.
 *
 * A value rather than a comment, so that "who closes the modal?" is a question
 * with a greppable answer. `'frame-handler'` means: the single frame-level
 * handler decides, and nothing else may bind Escape.
 *
 * The reference's equivalent is
 * ts-minecraft/packages/app/application/frame/stages/input-stage-menu.ts:6
 * `handleEscape`, invoked from exactly one call site (input-stage.ts:33).
 */
export const ESCAPE_OWNER = 'frame-handler' as const

/** The key code the frame-level handler owns. */
export const ESCAPE_KEY_CODE: KeyCode = 'Escape'

export type Bindings = Readonly<Record<string, InputCode>>

export const defaultBindings = (): Bindings => ({ ...DEFAULT_BINDINGS })

/**
 * The code bound to an action, or `undefined`.
 *
 * `escape` always returns `undefined`, whatever the map says. It is not a
 * bindable action; it belongs to the frame handler.
 */
export const bindingFor = (bindings: Bindings, action: InputAction): InputCode | undefined =>
  action === 'escape' ? undefined : bindings[action]

export type RemapRejection = {
  readonly reason: 'escape-is-not-bindable' | 'key-already-bound' | 'unknown-action'
  readonly message: string
}

export type RemapOutcome =
  | { readonly kind: 'ok'; readonly bindings: Bindings }
  | { readonly kind: 'rejected'; readonly rejection: RemapRejection }

/**
 * Rebind an action.
 *
 * Rejects rather than throws — this is driven by a settings UI in mx-ui, and a
 * rejected rebind is an ordinary outcome that the UI shows to the player, not
 * an exceptional one.
 *
 * Three rejections, in priority order:
 *
 * 1. `escape-is-not-bindable` — neither as the action nor as the key. Allowing
 *    a second Escape owner is precisely the bug the ownership rule prevents.
 * 2. `unknown-action` — the action is not in `INPUT_ACTIONS`. Reachable at run
 *    time from a corrupt persisted settings blob.
 * 3. `key-already-bound` — one key, one action. Silently stealing the key from
 *    its previous owner leaves the player with an action they can no longer
 *    perform and no indication of why.
 */
export const remap = (bindings: Bindings, action: InputAction, key: InputCode): RemapOutcome => {
  if (action === 'escape') {
    return {
      kind: 'rejected',
      rejection: {
        reason: 'escape-is-not-bindable',
        message:
          'escape is not a bindable action: it is owned by the single frame-level handler ' +
          `(ESCAPE_OWNER = '${ESCAPE_OWNER}'). A second owner is how one key press closes a modal ` +
          'AND opens the pause menu.',
      },
    }
  }
  if (key === ESCAPE_KEY_CODE) {
    return {
      kind: 'rejected',
      rejection: {
        reason: 'escape-is-not-bindable',
        message: `${ESCAPE_KEY_CODE} cannot be bound to '${action}': it is owned by the frame-level handler.`,
      },
    }
  }
  if (!INPUT_ACTIONS.includes(action)) {
    return {
      kind: 'rejected',
      rejection: { reason: 'unknown-action', message: `'${String(action)}' is not a known input action.` },
    }
  }

  const conflict = Object.entries(bindings).find(([bound, code]) => code === key && bound !== action)
  if (conflict !== undefined) {
    return {
      kind: 'rejected',
      rejection: {
        reason: 'key-already-bound',
        message: `${key} is already bound to '${conflict[0]}'. Unbind it first.`,
      },
    }
  }

  return { kind: 'ok', bindings: { ...bindings, [action]: key } }
}

/**
 * The action an input code triggers, or `undefined`. Never resolves Escape.
 *
 * Takes an `InputCode`, so `actionForKey(bindings, 'MouseLeft')` is `'attack'`
 * under the defaults. The name is kept from when only keys existed; buttons
 * live in the same code space precisely so that this function did not need a
 * mouse-shaped twin.
 */
export const actionForKey = (bindings: Bindings, key: InputCode): InputAction | undefined => {
  if (key === ESCAPE_KEY_CODE) {
    return undefined
  }
  const found = Object.entries(bindings).find(([, code]) => code === key)
  const action = found?.[0]
  return action !== undefined && (INPUT_ACTIONS as ReadonlyArray<string>).includes(action)
    ? (action as InputAction)
    : undefined
}

/**
 * Where a listener must be registered.
 *
 * `window` for gameplay input, `document` for modal overlays. Data, not
 * documentation, so the adapter reads the rule out of this module instead of
 * reimplementing it — and so `test/input.test.ts` can assert it without a DOM.
 */
export type ListenerTarget = 'window' | 'document'

export const GAMEPLAY_LISTENER_TARGET: ListenerTarget = 'window'
export const MODAL_LISTENER_TARGET: ListenerTarget = 'document'

/**
 * True when a key press dispatched at `MODAL_LISTENER_TARGET` and consumed with
 * `stopPropagation()` still reaches `GAMEPLAY_LISTENER_TARGET`.
 *
 * MUST be false. `document` bubbles up to `window`, so a modal that stops
 * propagation at `document` shields the key. The relationship is asserted in a
 * test because it is the single fact the whole shielding scheme rests on, and
 * because reversing the two targets is a one-word edit that would silently
 * re-introduce the double-Escape bug.
 */
export const modalConsumedKeyReachesGameplay = (
  modalTarget: ListenerTarget,
  gameplayTarget: ListenerTarget,
  stoppedPropagation: boolean,
): boolean => {
  if (!stoppedPropagation) {
    return true
  }
  // `document` is inside `window` in the bubble path, so stopping at document
  // prevents the window listener from ever seeing the event. Stopping at window
  // is too late: document already ran.
  return !(modalTarget === 'document' && gameplayTarget === 'window')
}

/**
 * Whether the browser's context menu must be suppressed (`preventDefault()`).
 *
 * Right-click is `use` — placing a block. Without suppression, every placed
 * block also opens the browser's context menu over the game, and the menu takes
 * the pointer lock with it.
 *
 * The reference suppresses it UNCONDITIONALLY
 * (ts-minecraft/packages/presentation/input/input-service.ts:140-142: a
 * `handleContextMenu` that only calls `e.preventDefault()`, registered at :183).
 * This narrows it to "while the pointer is locked", and the narrowing is the
 * whole point of the predicate:
 *
 * - locked means the pointer is captured by the canvas and every click is a
 *   game action, so the menu is never wanted;
 * - unlocked means the player is in a modal, a settings screen or the chat box
 *   — DOM UI, where the browser's own menu is the platform behaviour and
 *   swallowing it means no "copy" on a chat line and no spell-check on a text
 *   field.
 *
 * A pure function of the lock state rather than a `preventDefault` buried in an
 * adapter, so that `environment: 'node'` can test it — which matters more here
 * than usual: plan.md §3.10 records that Playwright runs on SwiftShader and
 * cannot do pointer lock headless, so there is NO browser test that could cover
 * the locked branch.
 *
 * The reference also records the trap on the other side of this listener
 * (:137-139): `contextmenu` must NOT be counted as a right-button press,
 * because `mousedown` already captured it and counting both fires `use` twice
 * for one click. `application/input-service.ts` enforces that where it belongs,
 * in `dispatch`.
 */
export const suppressesBrowserContextMenu = (pointerLocked: boolean): boolean => pointerLocked
