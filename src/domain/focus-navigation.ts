export type FocusNavigationDirection = 'up' | 'left' | 'right' | 'down'

export const FOCUS_NAVIGATION_CODES = [
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'ArrowDown',
] as const

export const focusNavigationDirectionForCode = (
  code: string | undefined,
): FocusNavigationDirection | undefined => {
  switch (code) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'ArrowDown':
      return 'down'
    default:
      return
  }
}

export const ARROW_FOCUS_NAVIGATION_POLICY = {
  codes: FOCUS_NAVIGATION_CODES,
  disabledWhilePointerLocked: true,
  owner: 'host',
  preventDefault: 'when-consumed',
} as const

/**
 * The index step ONE press of a direction takes, in a group's own tab order.
 *
 * `left`/`up` step back, `right`/`down` step forward. `HOTBAR_FOCUS_GROUP`
 * (`domain/input-bindings.ts`) is the only focus group that exists today and
 * it is a single ROW, so `up`/`down` land on the same step as `left`/`right`
 * rather than doing nothing — the pairing both ARIA's toolbar and listbox
 * patterns accept for a one-dimensional widget. A future GRID-shaped group
 * could special-case `up`/`down` by row width without any caller of this
 * function changing, because this function only ever answers "which way
 * along the list", never "how far": that half is `wrapHotbarSelection`'s
 * (`domain/input-bindings.ts`), reused rather than re-derived by
 * `resolveFocusNavigationTarget` in `application/browser-input-adapter.ts`,
 * the one place that combines the two.
 */
/** The two index steps a navigation direction can produce — named, not `-1`/`1` inline. */
const FOCUS_STEP_BACK = -1
const FOCUS_STEP_FORWARD = 1

/** `typeof` the two constants above, so the type itself never spells the numbers either. */
export type FocusStep = typeof FOCUS_STEP_BACK | typeof FOCUS_STEP_FORWARD

export const focusStepForDirection = (direction: FocusNavigationDirection): FocusStep => {
  switch (direction) {
    case 'left':
    case 'up':
      return FOCUS_STEP_BACK
    default:
      return FOCUS_STEP_FORWARD
  }
}

/**
 * `code` straight to a step, or `undefined` for anything that is not a
 * navigation code. Composes `focusNavigationDirectionForCode` and
 * `focusStepForDirection` so a caller never has to thread the intermediate
 * `FocusNavigationDirection` through just to drop it again.
 */
export const focusNavigationStepForCode = (code: string | undefined): FocusStep | undefined => {
  const direction = focusNavigationDirectionForCode(code)
  if (typeof direction === 'undefined') {
    return
  }
  return focusStepForDirection(direction)
}
