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
 * Default bindings. `KeyboardEvent.code`, not `.key`: `code` is layout-
 * independent, so WASD stays under the same fingers on AZERTY and Dvorak.
 * Binding `.key` is how a French player ends up unable to walk forward.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Exclude<InputAction, 'escape'>, KeyCode>> = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  openInventory: 'KeyE',
  openChat: 'KeyT',
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

export type Bindings = Readonly<Record<string, KeyCode>>

export const defaultBindings = (): Bindings => ({ ...DEFAULT_BINDINGS })

/**
 * The key bound to an action, or `undefined`.
 *
 * `escape` always returns `undefined`, whatever the map says. It is not a
 * bindable action; it belongs to the frame handler.
 */
export const bindingFor = (bindings: Bindings, action: InputAction): KeyCode | undefined =>
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
export const remap = (bindings: Bindings, action: InputAction, key: KeyCode): RemapOutcome => {
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

/** The action a key code triggers, or `undefined`. Never resolves Escape. */
export const actionForKey = (bindings: Bindings, key: KeyCode): InputAction | undefined => {
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
