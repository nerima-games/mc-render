import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ARROW_FOCUS_NAVIGATION_POLICY,
  FOCUS_NAVIGATION_CODES,
  focusNavigationDirectionForCode,
  focusNavigationStepForCode,
  focusStepForDirection,
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

describe('DN-16 §5(a): the index step a direction takes in a one-dimensional group', () => {
  it.effect('left and up step back; right and down step forward', () =>
    Effect.sync(() => {
      expect(focusStepForDirection('left')).toBe(-1)
      expect(focusStepForDirection('up')).toBe(-1)
      expect(focusStepForDirection('right')).toBe(1)
      expect(focusStepForDirection('down')).toBe(1)
    }),
  )

  it.effect('a navigation code resolves straight to a step, composing the two lookups', () =>
    Effect.sync(() => {
      expect(focusNavigationStepForCode('ArrowLeft')).toBe(-1)
      expect(focusNavigationStepForCode('ArrowUp')).toBe(-1)
      expect(focusNavigationStepForCode('ArrowRight')).toBe(1)
      expect(focusNavigationStepForCode('ArrowDown')).toBe(1)
    }),
  )

  it.effect('a non-navigation code, or none at all, resolves to no step', () =>
    Effect.sync(() => {
      expect(focusNavigationStepForCode('KeyW')).toBeUndefined()
      expect(focusNavigationStepForCode(undefined)).toBeUndefined()
    }),
  )
})
