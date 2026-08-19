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
 * so placing runtime input in mc-playground-kit would violate the
 * direct-dependency and shipped-source boundary.
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
 * DOM types. The browser adapter is `application/browser-input-adapter.ts`, which takes
 * an injected event source. That split is what lets key remapping, chord
 * resolution and the Escape rule be tested in Node under
 * `environment: 'node'` — no jsdom, no Playwright, no SwiftShader.
 */

/**
 * Every action the game can be told to perform by an input device.
 *
 * This is the renderer's current action vocabulary. Platform-specific sources
 * translate their controls into these actions at the application boundary.
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
   * Direct hotbar selection, `Digit1` … `Digit9`.
   *
   * In the reference as `KeyMappings.HOTBAR_SLOT_1` … `_9`
   * (<reference-impl>/packages/entity/domain/key-mappings.ts:22-30), read by
   * <reference-impl>/packages/inventory/application/hotbar-service.ts:56-72.
   *
   * NINE of them, and no more, because NINE IS A KEYBOARD FACT: the digit row
   * has nine non-zero keys and vanilla binds exactly those. The hotbar's LENGTH
   * is NOT a fact of this repository — it belongs to whoever owns the inventory
   * (the reference's `HOTBAR_SIZE = 9`,
   * <reference-impl>/packages/inventory/application/inventory-service.config.ts:3),
   * which is why `wrapHotbarSelection` below takes the size as an argument and
   * why nothing here stores a selected slot. A consumer with five slots simply
   * never acts on `hotbarSlot6`.
   *
   * These are EDGES — one press selects one slot — so they are ordinary bound
   * actions and need nothing new. Cycling is not: see `notchesForWheelDelta`.
   */
  'hotbarSlot1',
  'hotbarSlot2',
  'hotbarSlot3',
  'hotbarSlot4',
  'hotbarSlot5',
  'hotbarSlot6',
  'hotbarSlot7',
  'hotbarSlot8',
  'hotbarSlot9',
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
 * ---------------------------------------------------------------------------
 * The wheel: NOTCHES in the model, browser units only at the boundary
 * ---------------------------------------------------------------------------
 *
 * The wheel is the one input in this repository that is NOT an `InputCode`, and
 * that is the whole design decision. A wheel is a DELTA: "the player moved the
 * selection two slots this frame". `pressed` cannot say that (a wheel is never
 * held) and `justPressed` cannot either (an edge has no magnitude). Encoding it
 * as `WheelUp` / `WheelDown` codes would fit the existing machinery and would
 * collapse two notches into one edge — which is exactly the reference's bug:
 * <reference-impl>/packages/inventory/application/hotbar-service.ts:76 reduces
 * the accumulated delta to `wheelDelta > 0 ? 1 : -1`, so a fast flick of three
 * notches moves the selection by one slot.
 *
 * So the wheel is analogue state, alongside `pointerDelta`, and the unit it is
 * carried in is the NOTCH — one physical detent of a mouse wheel, one hotbar
 * slot.
 *
 * ---------------------------------------------------------------------------
 * Why normalisation is HERE and not in the adapter
 * ---------------------------------------------------------------------------
 *
 * `WheelEvent.deltaY` is reported in one of three units and `deltaMode` says
 * which: pixels (Chrome, Safari, and every trackpad), lines (Firefox on
 * Windows for a classic wheel), or pages. The same physical notch is therefore
 * `100`, `3` or `1` depending on the browser, and a hotbar that divides by the
 * wrong one either never moves or jumps nine slots.
 *
 * The adapter does exactly what it does for `MouseEvent.button`: it translates
 * the DOM's NUMBER into this module's NAME (`wheelDeltaModeForIndex`) and hands
 * both numbers on. The arithmetic — how many pixels make a notch — stays here
 * for the same reason `suppressesBrowserContextMenu` does: it is a POLICY with
 * a value that will be argued about and tuned, and policy in an adapter is
 * policy that `environment: 'node'` cannot test. plan.md §3.10 makes that
 * decisive rather than merely tidy: Playwright runs on SwiftShader and cannot
 * do pointer lock, so there is no browser test that could cover the locked
 * branch where the wheel means anything at all.
 *
 * The reference does not normalise. It accumulates raw `event.deltaY`
 * (<reference-impl>/packages/presentation/input/input-service.ts:130-133) and
 * gets away with it only because its single consumer throws the magnitude away.
 */
export const WHEEL_DELTA_MODES = ['pixel', 'line', 'page'] as const

export type WheelDeltaMode = (typeof WHEEL_DELTA_MODES)[number]

/**
 * Indexed by `WheelEvent.deltaMode`. The array position IS the DOM number
 * (`DOM_DELTA_PIXEL` 0, `DOM_DELTA_LINE` 1, `DOM_DELTA_PAGE` 2), exactly as
 * `MOUSE_BUTTON_BY_INDEX` is indexed by `MouseEvent.button`.
 */
export const WHEEL_DELTA_MODE_BY_INDEX: ReadonlyArray<WheelDeltaMode> = WHEEL_DELTA_MODES

/**
 * The named delta mode for a `WheelEvent.deltaMode`, or `undefined`.
 *
 * The only function in this repository that knows what `1` means. Total, and
 * `undefined` rather than a throw for an unknown mode, because it runs inside a
 * DOM event handler — the one place that must not throw. An event the adapter
 * cannot name is dropped at the boundary rather than guessed at, on the same
 * rule as `mouseButtonForIndex`: mis-scaling a scroll by 33x is worse than
 * ignoring it.
 */
export const wheelDeltaModeForIndex = (index: number): WheelDeltaMode | undefined =>
  WHEEL_DELTA_MODE_BY_INDEX[index]

/**
 * One wheel notch, in each of the three units.
 *
 * `100` is what Chrome, Edge and Safari report per detent; `3` is the line
 * count Firefox reports for the same detent. They are the de-facto values, not
 * standardised ones, which is the second reason they are named constants in the
 * domain rather than literals in an adapter — when a device turns up that needs
 * a different number, this is the file the argument happens in.
 */
export const WHEEL_PIXELS_PER_NOTCH = 100
export const WHEEL_LINES_PER_NOTCH = 3
export const WHEEL_PAGES_PER_NOTCH = 1

const NOTCHES_PER_UNIT: Readonly<Record<WheelDeltaMode, number>> = {
  line: WHEEL_LINES_PER_NOTCH,
  page: WHEEL_PAGES_PER_NOTCH,
  pixel: WHEEL_PIXELS_PER_NOTCH,
}

/** What a non-finite or otherwise unusable numeric input collapses to. */
const INVALID_NUMERIC_FALLBACK = 0

/**
 * A raw `WheelEvent.deltaY` as a signed, possibly FRACTIONAL number of notches.
 *
 * Fractional on purpose: a trackpad emits a stream of small pixel deltas and
 * never a whole notch at a time. Rounding each event to a whole notch would
 * make a trackpad either dead (always rounds to 0) or wild (always rounds to
 * 1); the service accumulates these fractions instead and takes whole steps out
 * of the total. See `InputSnapshot.wheelSteps`.
 *
 * SIGN: positive is scroll-down / scroll-away, which selects the NEXT hotbar
 * slot — the DOM's sign convention and the reference's
 * (<reference-impl>/packages/inventory/application/hotbar-service.ts:76,
 * `wheelDelta > 0 ? 1 : -1`) and vanilla's.
 *
 * Total: a non-finite delta from a misbehaving device yields 0 rather than
 * poisoning the accumulator with `NaN`, which would silently disable the wheel
 * for the rest of the session.
 */
export const notchesForWheelDelta = (deltaY: number, mode: WheelDeltaMode): number => {
  if (Number.isFinite(deltaY)) {
    return deltaY / NOTCHES_PER_UNIT[mode]
  }
  return INVALID_NUMERIC_FALLBACK
}

/**
 * Move a wrapping selection by `steps`, given how many slots there are.
 *
 * WHERE THE WRAP LIVES, and why it is here rather than in the consumer: the
 * SIZE is the consumer's (the hotbar's length is the inventory's fact, and this
 * repository must not become a second answer to how long a hotbar is), but the
 * ARITHMETIC is not — it is a trap, and every consumer would re-derive it.
 *
 * The reference writes it as
 *
 *   (SlotIndex.toNumber(cur) + direction + HOTBAR_SIZE) % HOTBAR_SIZE
 *   <reference-impl>/packages/inventory/application/hotbar-service.ts:77-79
 *
 * which is correct only because `direction` is clamped to ±1. JavaScript's `%`
 * keeps the sign of the dividend, so a single `+ size` is enough for one step
 * and NOT enough for two: with `cur = 0` and `steps = -3` that expression
 * yields `-3`, a negative slot index, silently. This implementation carries the
 * full magnitude the wheel produces, so it would have hit that on the first
 * fast flick. `((x % size) + size) % size` is right for any step.
 *
 * Total for any input: a size below 1 selects slot 0, because there is nothing
 * else it could mean and an event handler must not throw.
 */
/** A hotbar always has at least one slot to wrap a selection into. */
const MIN_HOTBAR_SIZE = 1

/** Truncates a finite number, or falls back to `INVALID_NUMERIC_FALLBACK`. */
const finiteTruncated = (value: number): number => {
  if (Number.isFinite(value)) {
    return Math.trunc(value)
  }
  return INVALID_NUMERIC_FALLBACK
}

export const wrapHotbarSelection = (current: number, steps: number, size: number): number => {
  if (!Number.isFinite(size) || size < MIN_HOTBAR_SIZE) {
    return INVALID_NUMERIC_FALLBACK
  }
  const slots = Math.trunc(size)
  const from = finiteTruncated(current)
  const by = finiteTruncated(steps)
  return (((from + by) % slots) + slots) % slots
}

/**
 * Default bindings. Keys are `KeyboardEvent.code`, not `.key`: `code` is
 * layout-independent, so WASD stays under the same fingers on AZERTY and
 * Dvorak. Binding `.key` is how a French player ends up unable to walk forward.
 *
 * Mouse buttons follow vanilla: left breaks, right places/uses, middle picks.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Exclude<InputAction, 'escape'>, InputCode>> = {
  attack: 'MouseLeft',
  /* The digit row, as in the reference
     (<reference-impl>/packages/entity/domain/key-mappings.ts:22-30). `Digit1`
     and not `Numpad1`: `code` is layout-independent but not keypad-independent,
     and vanilla binds the row. */
  hotbarSlot1: 'Digit1',
  hotbarSlot2: 'Digit2',
  hotbarSlot3: 'Digit3',
  hotbarSlot4: 'Digit4',
  hotbarSlot5: 'Digit5',
  hotbarSlot6: 'Digit6',
  hotbarSlot7: 'Digit7',
  hotbarSlot8: 'Digit8',
  hotbarSlot9: 'Digit9',
  jump: 'Space',
  moveBackward: 'KeyS',
  moveForward: 'KeyW',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  openChat: 'KeyT',
  openInventory: 'KeyE',
  pickBlock: 'MouseMiddle',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  use: 'MouseRight',
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

/**
 * WHO OWNS TAB. Not this repository, and not the game.
 *
 * `'user-agent'` means: the BROWSER moves focus on Tab, this repository never
 * calls `preventDefault()` on it, and no binding may claim it. The full
 * argument is with `FocusTarget` at the foot of this file; the short form is
 * that Escape's owner is one we chose and Tab's is one we cannot dislodge.
 *
 * A player CAN still be given a player-list key — vanilla's Tab — by binding
 * any other code to it. What they cannot be given is a Tab that means two
 * things, because the only way to stop the browser's meaning is to take the
 * key away, and taking Tab away traps every keyboard user in the canvas.
 */
export const FOCUS_NAVIGATION_OWNER = 'user-agent' as const

/** The key code the user agent owns. Never bindable; never suppressed. */
export const FOCUS_NAVIGATION_KEY_CODE: KeyCode = 'Tab'

export type Bindings = Readonly<Record<string, InputCode>>

export const defaultBindings = (): Bindings => ({ ...DEFAULT_BINDINGS })

/**
 * The code bound to an action, or `undefined`.
 *
 * `escape` always returns `undefined`, whatever the map says. It is not a
 * bindable action; it belongs to the frame handler.
 */
export const bindingFor = (bindings: Bindings, action: InputAction): InputCode | undefined => {
  if (action === 'escape') {
    return
  }
  return bindings[action]
}

export type RemapRejection = {
  readonly reason:
    | 'escape-is-not-bindable'
    | 'key-reserved-by-user-agent'
    | 'key-already-bound'
    | 'unknown-action'
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
 * Four rejections, in priority order:
 *
 * 1. `escape-is-not-bindable` — neither as the action nor as the key. Allowing
 *    a second Escape owner is precisely the bug the ownership rule prevents.
 * 2. `key-reserved-by-user-agent` — Tab. The same shape as the Escape rule and
 *    a strictly stronger case for it: Escape's other owner is one this codebase
 *    chose and could move, while Tab's is the BROWSER, which moves focus on Tab
 *    whatever this repository does. The only way to make a bound Tab mean one
 *    thing is `preventDefault()`, and that traps every keyboard user inside the
 *    canvas with no way out (see `FOCUS_NAVIGATION_OWNER`). So the second owner
 *    that CAN be refused is refused.
 * 3. `unknown-action` — the action is not in `INPUT_ACTIONS`. Reachable at run
 *    time from a corrupt persisted settings blob.
 * 4. `key-already-bound` — one key, one action. Silently stealing the key from
 *    its previous owner leaves the player with an action they can no longer
 *    perform and no indication of why.
 */
/** The first four rejection reasons: ownership rules that don't depend on the current bindings. */
const ownershipRemapRejection = (action: InputAction, key: InputCode): RemapRejection | undefined => {
  if (action === 'escape') {
    return {
      message:
        'escape is not a bindable action: it is owned by the single frame-level handler ' +
        `(ESCAPE_OWNER = '${ESCAPE_OWNER}'). A second owner is how one key press closes a modal ` +
        'AND opens the pause menu.',
      reason: 'escape-is-not-bindable',
    }
  }
  if (key === ESCAPE_KEY_CODE) {
    return {
      message: `${ESCAPE_KEY_CODE} cannot be bound to '${action}': it is owned by the frame-level handler.`,
      reason: 'escape-is-not-bindable',
    }
  }
  if (key === FOCUS_NAVIGATION_KEY_CODE) {
    return {
      message:
        `${FOCUS_NAVIGATION_KEY_CODE} cannot be bound to '${action}': it belongs to the user agent ` +
        `(FOCUS_NAVIGATION_OWNER = '${FOCUS_NAVIGATION_OWNER}'), which moves keyboard focus with it. ` +
        'The only way to stop that is preventDefault(), which traps keyboard users inside the canvas.',
      reason: 'key-reserved-by-user-agent',
    }
  }
  if (!INPUT_ACTIONS.includes(action)) {
    return { message: `'${String(action)}' is not a known input action.`, reason: 'unknown-action' }
  }
  return
}

/** The fifth rejection reason: the key is already claimed by a different action. */
const conflictRemapRejection = (
  bindings: Bindings,
  action: InputAction,
  key: InputCode,
): RemapRejection | undefined => {
  const conflict = Object.entries(bindings).find(([bound, code]) => code === key && bound !== action)
  if (typeof conflict === 'undefined') {
    return
  }
  const [conflictingAction] = conflict
  return {
    message: `${key} is already bound to '${conflictingAction}'. Unbind it first.`,
    reason: 'key-already-bound',
  }
}

export const remap = (bindings: Bindings, action: InputAction, key: InputCode): RemapOutcome => {
  const ownershipRejection = ownershipRemapRejection(action, key)
  if (typeof ownershipRejection !== 'undefined') {
    return { kind: 'rejected', rejection: ownershipRejection }
  }
  const conflictRejection = conflictRemapRejection(bindings, action, key)
  if (typeof conflictRejection !== 'undefined') {
    return { kind: 'rejected', rejection: conflictRejection }
  }
  return { bindings: { ...bindings, [action]: key }, kind: 'ok' }
}

/**
 * The action an input code triggers, or `undefined`. Never resolves Escape and
 * never resolves Tab.
 *
 * Takes an `InputCode`, so `actionForKey(bindings, 'MouseLeft')` is `'attack'`
 * under the defaults. The name is kept from when only keys existed; buttons
 * live in the same code space precisely so that this function did not need a
 * mouse-shaped twin.
 *
 * The two guards are here rather than left to `remap` because `remap` is not
 * the only way a binding table arrives: a corrupt or an OLD persisted settings
 * blob — written before either rule existed — reaches this function directly.
 */
export const actionForKey = (bindings: Bindings, key: InputCode): InputAction | undefined => {
  if (key === ESCAPE_KEY_CODE || key === FOCUS_NAVIGATION_KEY_CODE) {
    return
  }
  const found = Object.entries(bindings).find(([, code]) => code === key)
  if (typeof found === 'undefined') {
    return
  }
  const [action] = found
  if (!(INPUT_ACTIONS as ReadonlyArray<string>).includes(action)) {
    return
  }
  return action as InputAction
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
  /* `document` is inside `window` in the bubble path, so stopping at document
     prevents the window listener from ever seeing the event. Stopping at window
     is too late: document already ran. */
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

/**
 * Whether the browser's own scrolling must be suppressed (`preventDefault()`)
 * for a `wheel` event.
 *
 * The same shape as `suppressesBrowserContextMenu`, the same reason, and the
 * same narrowing. `LISTENER_PLAN` registers `wheel` with `passive: false`
 * precisely so that the handler MAY call `preventDefault()`; what it must not
 * do is call it unconditionally. Locked, the wheel cycles the hotbar and the
 * page must not scroll under the canvas. Unlocked, the wheel is scrolling the
 * chat log, the settings list or the page itself, and swallowing it means a
 * player who cannot reach the bottom of their own settings screen.
 *
 * It is the same predicate as the context menu's TODAY. It is a separate
 * function anyway, because they are separate decisions about separate browser
 * defaults, and collapsing them would mean that narrowing one silently narrows
 * the other.
 */
export const suppressesBrowserScroll = (pointerLocked: boolean): boolean => pointerLocked

/**
 * ---------------------------------------------------------------------------
 * Pointer lock is a REQUEST, and a request can be refused
 * ---------------------------------------------------------------------------
 *
 * A boolean cannot express what a UI needs to say. "Not locked" is at least
 * three different situations:
 *
 *   `unlocked`  — nobody has asked. The player is in a menu. Nothing to show.
 *   `requested` — we asked and the browser has not answered yet. Do not ask
 *                 again: a second request while one is pending is itself one of
 *                 the ways the browser refuses.
 *   `locked`    — granted. Mouselook is live and clicks are game actions.
 *   `refused`   — we asked and the browser said no (`pointerlockerror`): the
 *                 request did not come from a user gesture, another request was
 *                 pending, the document is sandboxed without
 *                 `allow-pointer-lock`, or the user dismissed the prompt. THIS
 *                 is the state a UI must surface — "click again to look
 *                 around", not silence.
 *
 * The reference collapses all four. `handlePointerLockError`
 * (<reference-impl>/packages/presentation/input/input-service.ts:150-153)
 * clears a fallback flag and `console.warn`s, so the only trace of a refusal is
 * in the developer console — a place no player has ever looked.
 *
 * `refused` is STICKY: it survives until something asks again. A transient
 * state would be gone by the time the frame that draws the UI ran.
 */
export const POINTER_LOCK_STATES = ['unlocked', 'requested', 'locked', 'refused'] as const

export type PointerLockState = (typeof POINTER_LOCK_STATES)[number]

/**
 * The button whose UNLOCKED click asks for the pointer lock.
 *
 * Left only. Right-click while unlocked is the platform's context menu (see
 * `suppressesBrowserContextMenu`) and middle-click is a paste or an autoscroll;
 * grabbing the pointer out from under either is how a player loses the menu
 * they were trying to use.
 */
export const POINTER_LOCK_ACQUIRE_BUTTON: MouseButton = 'MouseLeft'

/**
 * WHERE an unlocked click landed, as a name.
 *
 * The third question `acquiresPointerLock` asks, and the one that closes
 * DN-16 §5(b): a click on the HUD used to ask for the pointer lock, because the
 * predicate knew the button and the lock state and nothing at all about the
 * element under the cursor. `tabindex="-1"` elements focus on click, so the ring
 * lit; the same `mousedown` bubbled to `window`, became a `uiClick`, and threw
 * the player into mouselook by clicking their own hotbar — masking the ring they
 * had just lit.
 *
 *   `lock-target` — the element the lock would be GRANTED to. In a browser this
 *                   is the canvas the host passes as `BrowserInputOptions.canvas`
 *                   and that `makeBrowserPointerLockPort` calls
 *                   `requestPointerLock()` on. The rule in one line: **the
 *                   element that will receive the lock is the element you must
 *                   click to ask for it.**
 *   `ui`          — an element in one of the focus groups the host named. A
 *                   hotbar slot, a settings button: the player is operating a
 *                   widget, and a widget is not a request for mouselook.
 *   `elsewhere`   — neither. The letterbox beside a fixed-aspect canvas, the
 *                   page background, a header the host drew and did not declare.
 *
 * `ui` and `elsewhere` DECIDE THE SAME — neither acquires — and they are still
 * two names rather than one boolean. The reason is diagnosis: if the lock
 * target's identity ever stops matching (a host hands over a wrapper `<div>`
 * instead of the canvas, or rebuilds the canvas without rebuilding the input
 * scope) every click reads `elsewhere`, mouselook silently never engages, and a
 * boolean would say only "not the canvas" for both that bug and the correct
 * refusal on a HUD click. With three names a test — and a debug overlay — says
 * which half broke.
 */
export const CLICK_LANDINGS = ['lock-target', 'ui', 'elsewhere'] as const

export type ClickLanding = (typeof CLICK_LANDINGS)[number]

/**
 * The landing whose click asks for the pointer lock.
 *
 * A value rather than a literal in the predicate, for the same reason
 * `POINTER_LOCK_ACQUIRE_BUTTON` is one: "which click takes the pointer" is a
 * question with a greppable answer.
 *
 * The predicate is `landing === 'lock-target'` and NOT `landing !== 'ui'`, and
 * the difference is the whole of the choice DN-16 §5(b) left open. `!== 'ui'`
 * is an OPEN-WORLD rule: it grants the pointer to everything the host failed to
 * enumerate, and the cost of a forgotten declaration is a player thrown into
 * mouselook by clicking a link. `=== 'lock-target'` is CLOSED-WORLD: it grants
 * the pointer only to the one element the host explicitly pointed at, and the
 * cost of a forgotten declaration is mouselook that does not engage — visible on
 * the first try, and not disorienting when it happens.
 *
 * Two more reasons it is the right side of that trade:
 *
 *   - it costs the host NOTHING NEW. The lock target is the canvas the host
 *     already names in order to be able to lock at all; a host that names none
 *     already has `UNAVAILABLE_POINTER_LOCK` and could never lock. So no host
 *     that could lock before has to declare anything, and no host that could not
 *     changes behaviour. "Not UI" would need a new roster from every host that
 *     draws UI, and the host that forgot would stay broken and silent.
 *   - "not UI" can only mean "not FOCUSABLE UI the host listed", because the
 *     roster exists for focus. A plain `<div>` with a click handler, a letterbox
 *     bar, a host-drawn header: none are in it, and all of them would take the
 *     pointer.
 */
export const POINTER_LOCK_ACQUIRE_LANDING: ClickLanding = 'lock-target'

/**
 * Whether a UI click (a click that arrived while the pointer was NOT locked)
 * should ask for the pointer lock.
 *
 * This is the consumer of `InputSnapshot.uiClicks`, which until now had none —
 * the click that re-acquires the lock was modelled and then acted on by
 * nothing, so a preview could enter the game and never enter mouselook.
 *
 * `requested` is excluded because a click during a pending request must not
 * send a second one. `locked` is excluded because a click while locked is not
 * a UI click at all and never reaches here. `refused` IS included, and is the
 * point: a refusal usually means the previous attempt lacked a user gesture,
 * and a click is exactly the gesture that fixes it.
 *
 * `landing` is the third argument and is REQUIRED, with no default. A default
 * would have to be `lock-target` to keep every existing caller compiling, and
 * that default is exactly the hazard: every dispatcher that had not thought
 * about where the click landed would go on granting the pointer to HUD clicks,
 * silently, which is the state this argument exists to leave. Being made to say
 * where the click landed is the point of the parameter.
 */
export const acquiresPointerLock = (
  button: MouseButton,
  state: PointerLockState,
  landing: ClickLanding,
): boolean =>
  button === POINTER_LOCK_ACQUIRE_BUTTON &&
  landing === POINTER_LOCK_ACQUIRE_LANDING &&
  (state === 'unlocked' || state === 'refused')

/**
 * ---------------------------------------------------------------------------
 * Keyboard focus: the browser MOVES it, this repository only OBSERVES it
 * ---------------------------------------------------------------------------
 *
 * mx-ui built the other half of this and then stopped, for a reason it states
 * exactly (mx-ui/docs/design-notes.md DN-UI-13i): making a slot focusable needs
 * `setAttribute` and styling the ring needs `setProperty`, both of which are in
 * its DOM vocabulary — but MOVING focus (`focus()`) and OBSERVING it
 * (`addEventListener`) are input, and input is this repository's (plan.md
 * §2.3-2). So mx-ui made the hotbar a roving-`tabindex` group with ONE native
 * tab stop and a dedicated ring element per slot, and left
 * `HudView.setKeyboardFocus(index | undefined)` for the input owner to call.
 *
 * The shape of what is left is decided by a choice mx-ui made deliberately:
 * **the tab stop and the ring are the same slot.** So the element the browser
 * focuses when the player presses Tab is, by construction, the element mx-ui
 * drew the ring on. Nothing here has to implement Tab, choose where focus goes,
 * or keep an order — the platform already does all three, correctly, including
 * for the screen reader and the on-screen keyboard.
 *
 * What is left is exactly one thing: **NOTICING**. Until something observes the
 * focus change and reports it, mx-ui does not know the keyboard arrived, so the
 * player sees the user agent's default ring instead of the palette's. That is
 * the whole of mc-render's half, and it is why the model below adds an
 * observation and not a navigation.
 *
 * ---------------------------------------------------------------------------
 * Why `preventDefault()` appears nowhere in this feature
 * ---------------------------------------------------------------------------
 *
 * `suppressesBrowserContextMenu` and `suppressesBrowserScroll` above have a
 * defensible narrow case: locked, the pointer is captured by the canvas and the
 * browser default is never what the player meant. Tab has NO such case, at any
 * lock state, and the asymmetry is not a matter of degree:
 *
 *   - a suppressed context menu costs a player "copy" on a chat line;
 *   - a suppressed scroll costs a player the bottom of a settings screen;
 *   - a suppressed Tab costs a player EVERY WAY OUT. Focus is how a keyboard
 *     user reaches the browser's own chrome, the address bar, the next control
 *     and the next frame. A canvas that eats Tab is a keyboard trap
 *     (WCAG 2.1 SC 2.1.2), and the player cannot even reach the settings screen
 *     that would let them rebind their way out of it.
 *
 * So there is no `suppressesBrowserFocusNavigation` predicate to go with the
 * other two. A predicate is a place for the argument to be re-opened, and this
 * one must not be: the answer is no, at every lock state, forever.
 * `FOCUS_NAVIGATION_KEY_CODE` and `FOCUS_NAVIGATION_OWNER` record the ownership
 * as values instead, `remap` refuses to give the key a second owner, and
 * `FOCUS_NAVIGATION_POLICY` in `application/input-listener-plan.ts` states the whole
 * rule where `ESCAPE_POLICY` states Escape's.
 */

/**
 * Where the keyboard is, when it is on UI this repository was told about.
 *
 * `group` names a roving-`tabindex` group — one native tab stop, many
 * programmatically focusable members. `HOTBAR_FOCUS_GROUP` is the first and
 * currently the only one, but the field is not a boolean because focus landing
 * on a settings button is not the same event as focus landing on nothing, and a
 * hotbar told only "not me" would be told the same thing by both.
 *
 * `index` is 0-BASED and is the position within the group's own tab order.
 * mx-ui's `setKeyboardFocus` takes exactly this: 0..8 for its nine hotbar
 * slots, and it clamps rather than rejecting. The 1-based digit row
 * (`hotbarSlot1`) is a KEYBOARD fact and deliberately does not agree — see
 * `INPUT_ACTIONS` on why nine is a fact about the digit row and not about the
 * hotbar.
 *
 * There is no `element` field, and that is the point of the design: this module
 * is pure, and the adapter resolves the DOM element to a group and an index at
 * the boundary, exactly as `mouseButtonForIndex` resolves a number to a name.
 */
export type FocusTarget = {
  readonly group: string
  readonly index: number
}

/**
 * The group name mx-ui's hotbar is reported under.
 *
 * A value here rather than a string literal in a host, so that the two
 * repositories agree by import rather than by spelling. mx-ui's own DOM marker
 * is `data-mx-ui="hotbar"`; nothing in this repository reads that attribute —
 * see `resolveFocusTarget` in `application/browser-input-adapter.ts` on why the
 * roster is by identity and not by attribute.
 */
export const HOTBAR_FOCUS_GROUP = 'hotbar'

/**
 * Whether an observed keyboard focus is something to REPORT.
 *
 * False while `locked`, and that is the whole rule. It is the same seam
 * `withButtonDown` already draws for clicks, applied to the keyboard:
 *
 *   locked   — the pointer is captured by the canvas, the keys are driving an
 *              avatar, and the player is looking at a world, not at a widget.
 *              A ring lit on a hotbar slot then is a lie about what the next
 *              key press will do. Tab while locked is not focus navigation; it
 *              is a player who wanted to leave, or a stray press.
 *   otherwise — `unlocked`, `requested` and `refused` are all "the pointer is
 *              not captured": DOM UI is live, the keyboard is navigating it,
 *              and where it is IS what the ring must show. `requested` is
 *              included because a pending request has captured nothing yet, and
 *              a ring that blinked out for the round trip would blink back.
 *
 * MASKING, not clearing, is what `application/input-service.ts` does with this,
 * and the distinction is load-bearing: the browser does not move focus when the
 * pointer is locked, so the focus is still THERE. Forgetting it would mean that
 * a player who Tabs to slot 3, clicks in to look around, and presses Escape,
 * gets a ring on nothing while their next Space press activates slot 3. The
 * report is suppressed for exactly as long as it would be a lie, and the truth
 * is still underneath it when the lock ends.
 */
export const reportsKeyboardFocus = (state: PointerLockState): boolean => state !== 'locked'

/**
 * ---------------------------------------------------------------------------
 * TOUCH: a tap is a DEVICE, and it is deliberately not a second vocabulary
 * ---------------------------------------------------------------------------
 *
 * mc-compose/docs/e2e-triage.md §3.5 row #35 states the claim this section has
 * to make true: **a tap binds to the same intent a key does.** Not "a tap works
 * too" — the same intent, through the same table, with the same edge.
 *
 * The mouse got into this file by being given NAMES in the key space
 * (`MOUSE_BUTTONS`, and the `Mouse` prefix that keeps the two namespaces from
 * colliding). The obvious move is to do it again — `TouchJump`, `TouchAttack` —
 * and it is wrong, for a reason that is visible the moment the names are
 * written down: `TouchJump` already contains the answer. A code named for the
 * action it performs is not a code, it is a binding with the table deleted, and
 * `remap` would have nothing to say about it.
 *
 * The asymmetry with the mouse is real and is what decides this:
 *
 *   - A MOUSE BUTTON is a physical thing that exists before any meaning is
 *     attached. The player owns it and may rebind it, which is exactly the
 *     argument `MOUSE_BUTTONS` makes for naming buttons instead of numbering
 *     them: bindings are persisted and remappable, so buttons must be in the
 *     same code space as keys.
 *   - AN ON-SCREEN CONTROL is a widget THE HOST DREW, and the host drew it
 *     already knowing what it is for. There is no remapping question to answer:
 *     you do not rebind a button labelled "jump", you relabel it, and relabelling
 *     is a host-side edit to the roster. A settings screen offering "rebind the
 *     on-screen jump button" would be offering to make the picture lie.
 *
 * So a touch control carries an `InputAction` and the tap is resolved through
 * `Bindings` at the moment it happens. `Bindings` therefore needs NO second
 * source and does not change shape: it stays `Record<action, InputCode>`, one
 * key per action, and `remap`'s conflict check still runs over one value space.
 * That is the whole of the answer to "does this file's shape admit a second
 * input source" — it admits it by not being asked to.
 *
 * What falls out for free is the part row #35 actually cares about. Rebind
 * `openInventory` from `KeyE` to `KeyI` and the on-screen inventory button
 * follows, because it never knew about `KeyE` in the first place: it knows
 * `openInventory`, and so does the table. A parallel touch vocabulary would
 * have had to be remapped separately, and the first player to rebind anything
 * would have found the two halves disagreeing.
 */

/**
 * The code a tap on a control for `action` presses.
 *
 * `undefined` means the control is DEAD — nothing is bound, so the widget is a
 * picture of a button. `unboundTouchActions` is how a host finds that out at
 * setup time instead of finding it out from a player who cannot open their
 * inventory.
 *
 * ESCAPE IS THE ONE SPECIAL CASE, and it is a special case that PRESERVES the
 * ownership rule rather than bending it. `bindingFor` refuses Escape, correctly:
 * no binding may map to it, because a second binding is a second owner and one
 * press would both close the modal and open the pause menu. But row #35's other
 * half is "pause is operable without a keyboard", and a touch device has no
 * Escape key at all.
 *
 * The resolution is that OWNERSHIP IS ABOUT WHO ACTS, NOT ABOUT WHO PRESSES. A
 * touch pause control emits `ESCAPE_KEY_CODE` — the same code the keyboard
 * emits, into the same `pressed`/`justPressed` sets, read by the same single
 * frame-level handler `ESCAPE_OWNER` names. Downstream of `dispatch` the two are
 * indistinguishable, which is the strongest form row #35's claim can take:
 * a tap does not merely bind to the same intent as the key, it is the same
 * event. `actionForKey` still resolves `Escape` to no action and `remap` still
 * refuses to bind it, so the code stays inert to everything except the one
 * handler that owns it.
 *
 * The alternative — a `touchEscape` action, or a second Escape channel — is
 * precisely the second owner the whole rule exists to prevent.
 */
export const codeForTouchAction = (
  bindings: Bindings,
  action: InputAction,
): InputCode | undefined => {
  if (action === 'escape') {
    return ESCAPE_KEY_CODE
  }
  return bindingFor(bindings, action)
}

/**
 * The controls in a roster that would do NOTHING if tapped.
 *
 * This is the half of triage row #34 (`controls fit the safe viewport`) that can
 * be answered without a browser, and it is worth being exact about which half
 * that is. #34's own words are about LAYOUT — a 48px hit target, and controls
 * inside the safe-area inset — and neither is answerable here: this repository
 * ships no `lib.DOM`, `dom-surface.ts` contains no geometry by design, and a
 * `getBoundingClientRect` in Node returns zeroes. A test that measured that
 * would be measuring the fake.
 *
 * What IS answerable is the failure UNDERNEATH the layout one, and it is the
 * worse of the two: a control that is 48px, correctly inset, and bound to
 * nothing. The player can reach it, press it, see it depress, and the game does
 * not respond — which reads as a broken game rather than as a cramped one. A
 * roster is data the host writes by hand, so this is the check that catches a
 * typo'd action or an action whose binding was removed.
 *
 * Returns the offending actions rather than a boolean, for the reason
 * `RemapRejection` carries a message: "some control is dead" sends a host
 * looking through the whole roster.
 */
export const unboundTouchActions = (
  bindings: Bindings,
  actions: ReadonlyArray<InputAction>,
): ReadonlyArray<InputAction> =>
  actions.filter((action) => typeof codeForTouchAction(bindings, action) === 'undefined')

/**
 * ---------------------------------------------------------------------------
 * The look gesture: a drag is a DELTA, and the anchor is the whole problem
 * ---------------------------------------------------------------------------
 *
 * WHOSE TEST THIS IS NOT. Triage row #36 (`look gesture rotates the camera and
 * releases cleanly`) is NEEDS-PUBLISH to mc-compose, and it stays there: it
 * asserts that a drag reaches the CAMERA, and this repository is forbidden from
 * being the authority on the camera (see `index.ts` and `domain/camera-mirror.ts`
 * — mc-sim owns the pose and the reverse direction is a dependency cycle).
 *
 * What belongs here is the ARITHMETIC, on the rule this file has already applied
 * twice. `notchesForWheelDelta` states it in full: a policy in an adapter is a
 * policy `environment: 'node'` cannot test, and plan.md §3.10 makes that
 * decisive rather than tidy. `wrapHotbarSelection` is the closer precedent —
 * it takes the size as an argument, stores no selection, and exists purely so
 * that a consumer elsewhere does not re-derive a trap.
 *
 * The trap here is that a mouse and a finger report different things.
 * `MouseEvent.movementX` is ALREADY a delta, which is why `translateDomEvent`
 * can hand `mousemove` straight through. A `Touch` reports `clientX` — an
 * ABSOLUTE screen coordinate. Feeding that to a camera that expects a delta
 * rotates the view by the pixel position of the finger, so the first touch
 * anywhere on the right of the screen spins the player most of the way round.
 *
 * So the delta has to be computed against an ANCHOR, and the anchor is where
 * the second bug lives — the one row #36 names as "releases cleanly". A drag
 * that ends must forget where it was. If the anchor survives the release, the
 * NEXT touch computes its first delta from the last position of the PREVIOUS
 * drag, and the camera snaps across the whole distance between them in one
 * frame. That is DN-09 exactly, in a different device: analogue state belongs to
 * the gesture that produced it, and losing the pointer lock drops the
 * accumulated delta for the same reason.
 */

/** A touch position, in whatever units the host reports. Absolute, not a delta. */
export type TouchPoint = {
  readonly positionX: number
  readonly positionY: number
}

/**
 * The three things a finger does. Named for the DOM events a host would feed
 * them from (`touchstart` / `touchmove` / `touchend`), so there is no question
 * which produces which — the same convention `InputEvent` follows.
 *
 * `touchcancel` is a `release`, not a fourth phase. The browser fires it when
 * the platform takes the gesture away (a system edge-swipe, an incoming call),
 * and the gesture is over either way; giving it its own phase would only offer
 * somewhere to forget to handle it.
 */
export const TOUCH_LOOK_PHASES = ['press', 'move', 'release'] as const

export type TouchLookPhase = (typeof TOUCH_LOOK_PHASES)[number]

/**
 * Where the finger was last seen, or `undefined` between gestures.
 *
 * `undefined` is the state that makes the release safe, and it is a value rather
 * than a flag beside a stale point so that "released" and "released but the
 * coordinates are still lying around" cannot be different states.
 */
export type TouchLookState = {
  readonly anchor: TouchPoint | undefined
}

/** Shared "no anchor yet" value so call sites never spell the `undefined` literal. */
const { anchor: NO_TOUCH_ANCHOR } = {} as { anchor?: TouchPoint }

/** No gesture in progress. What a host starts with, and what a release yields. */
export const TOUCH_LOOK_IDLE: TouchLookState = { anchor: NO_TOUCH_ANCHOR }

export type TouchLookStep = {
  readonly state: TouchLookState
  /** The rotation this step asks for. ZERO whenever there is nothing to subtract. */
  readonly delta: TouchPoint
}

const NO_TOUCH_DELTA: TouchPoint = { positionX: 0, positionY: 0 }

/** A point the arithmetic is willing to anchor on, or `undefined`. */
const finiteTouchPoint = (point: TouchPoint): TouchPoint | undefined => {
  if (Number.isFinite(point.positionX) && Number.isFinite(point.positionY)) {
    return point
  }
  return
}

/**
 * Advance a look gesture by one event.
 *
 * A REDUCER over an explicit state rather than a mutable anchor in an adapter,
 * for the reason the header gives: the release rule is the behaviour worth
 * testing and an adapter-local variable is the one place `environment: 'node'`
 * cannot reach it.
 *
 *   `press`   — anchors, and emits ZERO. The touch that STARTS a look must not
 *               rotate anything: there is nothing to subtract from yet, and the
 *               only number available is the absolute position of the finger.
 *   `move`    — emits the difference from the anchor and re-anchors. With no
 *               anchor it emits zero, which is what makes a `move` that arrives
 *               after a `release` — a stray event, a second finger, a host that
 *               dropped the release — cost nothing instead of snapping the view.
 *   `release` — returns to `TOUCH_LOOK_IDLE` and emits zero. This is row #36's
 *               "releases cleanly", as a property of the reducer rather than as
 *               a promise about a call order.
 *
 * Total, and emits zero rather than `NaN` for a non-finite coordinate: this
 * feeds a camera, and one `NaN` in a rotation poisons the pose for the rest of
 * the session — the same failure `notchesForWheelDelta` and `finiteOrUndefined`
 * each guard on their own side.
 */
/** The `move` case: the difference from the anchor, re-anchored on `current`. */
const touchLookMove = (state: TouchLookState, current: TouchPoint): TouchLookStep => {
  const { anchor } = state
  if (typeof anchor === 'undefined') {
    return { delta: NO_TOUCH_DELTA, state }
  }
  return {
    delta: { positionX: current.positionX - anchor.positionX, positionY: current.positionY - anchor.positionY },
    state: { anchor: current },
  }
}

export const touchLookStep = (
  state: TouchLookState,
  phase: TouchLookPhase,
  point: TouchPoint,
): TouchLookStep => {
  if (phase === 'release') {
    return { delta: NO_TOUCH_DELTA, state: TOUCH_LOOK_IDLE }
  }
  const current = finiteTouchPoint(point)
  if (typeof current === 'undefined') {
    /* A coordinate that cannot be used, and the anchor is LEFT ALONE rather than
       replaced. Anchoring on a NaN would end the gesture in all but name: every
       later `move` would subtract from it and emit NaN forever. */
    return { delta: NO_TOUCH_DELTA, state }
  }
  if (phase === 'press') {
    return { delta: NO_TOUCH_DELTA, state: { anchor: current } }
  }
  return touchLookMove(state, current)
}
