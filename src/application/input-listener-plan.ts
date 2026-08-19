import {
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  FOCUS_NAVIGATION_KEY_CODE,
  FOCUS_NAVIGATION_OWNER,
  GAMEPLAY_LISTENER_TARGET,
  type ListenerTarget,
} from '../domain/input-bindings'

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
  /* `mousedown` / `mouseup` sit on `window` with the keys, and NOT on
     `document` where the reference puts them (:181-182). The reference's
     placement was safe when no button carried a gameplay action; now that left
     and right click ARE `attack` and `use`, buttons must obey the same modal
     shielding as keys, and a listener on `document` cannot be shielded by a
     modal that also stops propagation at `document` — whether it is shielded
     would depend on registration order. Both events bubble to `window`, so the
     move costs nothing. */
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
  /* The pointer/wheel events below sit on `document` because that is where the
     browser dispatches them, not because of the modal-shielding rule. Only the
     key and button events participate in that rule, and only they use the named
     constants. */
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
  /* The touch trio. On `window` with the keys and the mouse buttons, and NOT on
     `document` where the other pointer events sit: a tap is gameplay input that
     a modal must be able to shield, which is the same argument that moved
     `mousedown`/`mouseup` off `document`. A touch listener on `document` could
     not be shielded by a modal that also stops propagation at `document` —
     whether it was shielded would depend on registration order. */
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
  /* The focus pair. On `document` because `focusin`/`focusout` BUBBLE and
     `focus`/`blur` do not — which is the whole reason these two event names are
     the ones registered. A `focus` listener would have to be installed on every
     slot mx-ui creates, i.e. this repository would need to know about elements
     it does not own and re-install listeners whenever the HUD rebuilt.

     Note also what is NOT here: no `keydown` entry for Tab. The browser moves
     focus; these two listeners find out where it went. Anything else would be
     reimplementing the platform's focus order, badly, and would then need
     `preventDefault()` to stop the platform's own version running as well. */
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
