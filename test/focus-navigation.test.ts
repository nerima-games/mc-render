import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ARROW_FOCUS_NAVIGATION_POLICY,
  FOCUS_NAVIGATION_CODES,
  focusNavigationDirectionForCode,
} from '../src/domain/focus-navigation'

describe('arrow focus navigation policy', () => {
  it.effect('maps every supported browser code to its semantic direction', () =>
    Effect.sync(() => {
      const mappings = [
        ['ArrowUp', 'up'],
        ['ArrowLeft', 'left'],
        ['ArrowRight', 'right'],
        ['ArrowDown', 'down'],
      ] as const

      expect(FOCUS_NAVIGATION_CODES).toStrictEqual(mappings.map(([code]) => code))
      for (const [code, direction] of mappings) {
        expect(focusNavigationDirectionForCode(code)).toBe(direction)
      }
    }),
  )

  it.effect('does not turn unrelated or absent codes into navigation', () =>
    Effect.sync(() => {
      expect(focusNavigationDirectionForCode('KeyW')).toBeUndefined()
      expect(focusNavigationDirectionForCode(undefined)).toBeUndefined()
    }),
  )

  it.effect('records host ownership and conditional default suppression', () =>
    Effect.sync(() => {
      expect(ARROW_FOCUS_NAVIGATION_POLICY).toStrictEqual({
        codes: ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'],
        owner: 'host',
        preventDefault: 'when-consumed',
        disabledWhilePointerLocked: true,
      })
    }),
  )
})
