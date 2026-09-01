---
"@nerima-games/mc-render": minor
---

Add arrow-key navigation WITHIN a keyboard focus group (DN-16 §5(a)), the one piece the observation feature (`focusin`/`focusout` → `InputSnapshot.keyboardFocus`) shipped without: `ArrowLeft`/`ArrowUp` move to the previous member, `ArrowRight`/`ArrowDown` to the next, wrapping at both ends the same way the mouse wheel already cycles the hotbar (`wrapHotbarSelection`, reused rather than re-derived). Disabled while the pointer is locked, on the same argument `reportsKeyboardFocus` already states for the read side: the same arrow may be steering the avatar, and `document.activeElement` does not move on lock, so the mask has to apply to the write side too.

`application/dom-surface.ts` gains `DomDocument.activeElement` and a new `FocusableTarget` type (`{ focus(): void }`) — the first member in that file the adapter WRITES rather than only compares — and `FocusGroupTargets.targets` narrows from `ReadonlyArray<unknown>` to `ReadonlyArray<FocusableTarget>` accordingly; a real `HTMLElement.focus()` satisfies it without a cast (`test/fixtures/dom-surface.ts`). `domain/focus-navigation.ts` gains `focusStepForDirection` / `focusNavigationStepForCode`, composing with the arrow-code vocabulary already there.

No host wiring changes: `installInputListeners` picks this up automatically wherever `focusGroups` is already provided, and `event.preventDefault()` is never called for it — `mayPreventDefault('keydown')` stays `false`, on purpose, so a `keydown` exception for arrows could not also become one for Tab.

Verified against a real browser (Chrome via CDP), not only the Node-side fakes: a real `HTMLElement.focus()` call, triggered by a real `KeyboardEvent('keydown', { code: 'ArrowRight' })` dispatched at `window`, moves `document.activeElement` and round-trips through the existing `focusin`/`focusout` listeners back into `InputSnapshot.keyboardFocus`, with `event.defaultPrevented` staying `false`.
