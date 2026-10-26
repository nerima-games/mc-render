import { describe, expect, it } from '@effect/vitest'
import {
  focusNavigationDirectionForCode,
  type BrowserInputOptions,
  type ClickLandingForTarget,
  type FocusNavigationDirection,
  type FocusNavigationHandler,
  type FocusTarget,
  type FocusTargetForElement,
} from '../src/index.js'

describe('public focus navigation and input DTO exports', () => {
  it('exports the focus DTO, host callbacks, and key-to-direction helper', () => {
    const focus = { group: 'hotbar', index: 3 } satisfies FocusTarget
    const direction: FocusNavigationDirection = 'right'
    const focusTargetForElement: FocusTargetForElement = (target) =>
      target === focus ? focus : undefined
    const clickLandingForTarget: ClickLandingForTarget = (target) =>
      target === focus ? 'ui' : 'elsewhere'
    const directions: Array<FocusNavigationDirection> = []
    const onFocusNavigationDirection: FocusNavigationHandler = (next) => directions.push(next)
    const browserOptions: Pick<
      BrowserInputOptions,
      'focusTargetForElement' | 'clickLandingForTarget' | 'onFocusNavigationDirection'
    > = { clickLandingForTarget, focusTargetForElement, onFocusNavigationDirection }

    expect(focusNavigationDirectionForCode('ArrowRight')).toBe(direction)
    expect(focusTargetForElement(focus)).toStrictEqual(focus)
    expect(clickLandingForTarget(focus)).toBe('ui')
    browserOptions.onFocusNavigationDirection?.('down')
    expect(directions).toStrictEqual(['down'])
  })
})
