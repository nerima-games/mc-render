import { ITEM_TYPES, type ItemType } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import * as FastCheck from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ITEM_ICON_TILE_BY_ITEM_ID,
  itemIconUvForItemId,
} from '../src/domain/item-icon-map.js'
import {
  ATLAS_COLUMNS,
  ATLAS_PIXELS,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
} from '../src/domain/texture-atlas.js'

const HALF_TEXEL = 0.5

const expectedUvBounds = (tileIndex: number) => {
  const column = tileIndex % ATLAS_COLUMNS
  const row = Math.floor(tileIndex / ATLAS_COLUMNS)
  const originX = column * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const originY = row * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  return {
    u0: (originX + HALF_TEXEL) / ATLAS_PIXELS,
    v0: 1 - (originY + TILE_PIXELS - HALF_TEXEL) / ATLAS_PIXELS,
    u1: (originX + TILE_PIXELS - HALF_TEXEL) / ATLAS_PIXELS,
    v1: 1 - (originY + HALF_TEXEL) / ATLAS_PIXELS,
  }
}

describe('item icon map', () => {
  it('covers every registered item in registry order', () => {
    expect(Object.keys(ITEM_ICON_TILE_BY_ITEM_ID)).toStrictEqual([...ITEM_TYPES])
    for (let index = 0; index < ITEM_TYPES.length; index += 1) {
      const itemId = ITEM_TYPES[index]
      if (itemId !== undefined) {
        expect(ITEM_ICON_TILE_BY_ITEM_ID[itemId]).toBe(index)
      }
    }
  })

  it('returns independently calculated inset UV bounds for every registered item', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.constantFrom(...ITEM_TYPES), (itemId) => {
        const lookup = itemIconUvForItemId(itemId)
        expect(Result.isSuccess(lookup)).toBe(true)
        if (Result.isFailure(lookup)) {
          return
        }

        const expected = expectedUvBounds(ITEM_ICON_TILE_BY_ITEM_ID[itemId])
        expect(lookup.success).toStrictEqual(expected)
        expect(lookup.success.u0).toBeGreaterThanOrEqual(0)
        expect(lookup.success.v0).toBeGreaterThanOrEqual(0)
        expect(lookup.success.u1).toBeLessThanOrEqual(1)
        expect(lookup.success.v1).toBeLessThanOrEqual(1)
        expect(lookup.success.u0).toBeLessThan(lookup.success.u1)
        expect(lookup.success.v0).toBeLessThan(lookup.success.v1)
      }),
    )
  })

  it('keeps atlas UV rectangles disjoint for distinct registered item IDs', () => {
    const distinctItemPairs = FastCheck.tuple(
      FastCheck.constantFrom(...ITEM_TYPES),
      FastCheck.constantFrom(...ITEM_TYPES),
    ).filter(([leftItem, rightItem]) => leftItem !== rightItem)

    FastCheck.assert(
      FastCheck.property(distinctItemPairs, ([leftItem, rightItem]) => {
        const left = itemIconUvForItemId(leftItem)
        const right = itemIconUvForItemId(rightItem)
        if (Result.isFailure(left) || Result.isFailure(right)) {
          return false
        }

        return left.success.u1 <= right.success.u0 ||
          right.success.u1 <= left.success.u0 ||
          left.success.v1 <= right.success.v0 ||
          right.success.v1 <= left.success.v0
      }),
    )
  })

  it('fails with a tagged error for malformed or unregistered item IDs', () => {
    const malformed = [null, undefined, 0, 308, {}, ['stone']] as const
    for (const itemId of malformed) {
      const lookup = itemIconUvForItemId(itemId)
      expect(Result.isFailure(lookup)).toBe(true)
      if (Result.isFailure(lookup)) {
        expect(lookup.failure._tag).toBe('ItemIconLookupError')
        expect(lookup.failure.reason).toBe('invalid-item-id')
      }
    }

    FastCheck.assert(
      FastCheck.property(FastCheck.string().map((value) => `unknown:${value}`), (itemId) => {
        const lookup = itemIconUvForItemId(itemId)
        expect(Result.isFailure(lookup)).toBe(true)
        if (Result.isFailure(lookup)) {
          expect(lookup.failure).toStrictEqual({
            _tag: 'ItemIconLookupError',
            itemId,
            reason: 'unknown-item',
          })
        }
      }),
    )
  })

  it('returns a typed Result without throwing for arbitrary unknown inputs', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (itemId) => {
        const lookup = itemIconUvForItemId(itemId)
        const isSuccess = Result.isSuccess(lookup)
        const isFailure = Result.isFailure(lookup)
        expect(isSuccess || isFailure).toBe(true)

        const isRegisteredItem = typeof itemId === 'string' && ITEM_TYPES.some((known) => known === itemId)
        expect(isSuccess).toBe(isRegisteredItem)
        if (Result.isFailure(lookup)) {
          expect(lookup.failure._tag).toBe('ItemIconLookupError')
          let expectedReason: 'invalid-item-id' | 'unknown-item' = 'invalid-item-id'
          if (typeof itemId === 'string') {
            expectedReason = 'unknown-item'
          }
          expect(lookup.failure.reason).toBe(expectedReason)
        }
      }),
    )
  })

  it('keeps the bookshelf item in the kernel item-name vocabulary', () => {
    const bookshelf: ItemType = 'bookshelf'
    expect(ITEM_TYPES.includes(bookshelf)).toBe(true)
    expect(Result.isSuccess(itemIconUvForItemId(bookshelf))).toBe(true)
  })
})
