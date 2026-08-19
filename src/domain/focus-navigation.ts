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
