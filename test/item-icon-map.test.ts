import { ITEM_TYPES, type ItemType } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import * as FastCheck from 'fast-check'
import itemIconManifest from '../src/assets/item-icons/manifest.json' with { type: 'json' }
import { describe, expect, it, vi } from 'vitest'
import {
  ITEM_ICON_ATLAS_URL,
  ITEM_ICON_TILE_BY_ITEM_ID,
  itemIconAtlasForItemId,
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
const EXPECTED_ITEM_ICON_ATLAS_URL = new URL('../src/assets/item-icons/atlas.png', import.meta.url).href
type Ui1ItemIconResolverFailure = Readonly<{ readonly _tag: 'ItemIconUnavailable' }>
type Ui1ItemIconResolver = (itemType: ItemType) => Result.Result<unknown, Ui1ItemIconResolverFailure>

const expectRejectedManifest = async (manifest: unknown): Promise<void> => {
  vi.resetModules()
  vi.doMock('../src/assets/item-icons/manifest.json', () => ({ default: manifest }))
  try {
    await expect(import('../src/domain/item-icon-map.js')).rejects.toThrow()
  } finally {
    vi.doUnmock('../src/assets/item-icons/manifest.json')
    vi.resetModules()
  }
}

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

  it('matches the UI1 resolver contract with an atlas URL and pixel rectangle', () => {
    const resolver: Ui1ItemIconResolver = itemIconAtlasForItemId
    const itemId: ItemType = 'bookshelf'
    const resolved = resolver(itemId)
    const tileIndex = ITEM_ICON_TILE_BY_ITEM_ID[itemId]
    const tileColumn = tileIndex % ATLAS_COLUMNS
    const tileRow = Math.floor(tileIndex / ATLAS_COLUMNS)

    expect(Result.isSuccess(resolved)).toBe(true)
    expect(new URL(ITEM_ICON_ATLAS_URL).href).toBe(EXPECTED_ITEM_ICON_ATLAS_URL)
    if (Result.isSuccess(resolved)) {
      expect(resolved.success).toStrictEqual({
        atlasHeight: ATLAS_PIXELS,
        atlasWidth: ATLAS_PIXELS,
        height: TILE_PIXELS,
        kind: 'atlas',
        url: ITEM_ICON_ATLAS_URL,
        width: TILE_PIXELS,
        x: tileColumn * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS,
        y: tileRow * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS,
      })
    }
  })

  it('returns a typed UI1 unavailable failure for an unknown item ID', () => {
    const itemId: unknown = 'unregistered_item'
    const resolved = itemIconAtlasForItemId(itemId)

    expect(Result.isFailure(resolved)).toBe(true)
    if (Result.isFailure(resolved)) {
      expect(resolved.failure).toStrictEqual({ _tag: 'ItemIconUnavailable' })
    }
  })

  it('returns a typed UI1 Result for arbitrary item IDs without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (itemId) => {
        const resolved = itemIconAtlasForItemId(itemId)
        let registeredItem: ItemType | undefined = undefined
        if (typeof itemId === 'string') {
          registeredItem = ITEM_TYPES.find((itemType) => itemType === itemId)
        }
        expect(Result.isSuccess(resolved)).toBe(registeredItem !== undefined)
        if (Result.isFailure(resolved)) {
          expect(resolved.failure._tag).toBe('ItemIconUnavailable')
          return
        }
        if (registeredItem === undefined) {
          return
        }

        const tileIndex = ITEM_ICON_TILE_BY_ITEM_ID[registeredItem]
        const tileColumn = tileIndex % ATLAS_COLUMNS
        const tileRow = Math.floor(tileIndex / ATLAS_COLUMNS)
        expect(resolved.success).toStrictEqual({
          atlasHeight: ATLAS_PIXELS,
          atlasWidth: ATLAS_PIXELS,
          height: TILE_PIXELS,
          kind: 'atlas',
          url: ITEM_ICON_ATLAS_URL,
          width: TILE_PIXELS,
          x: tileColumn * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS,
          y: tileRow * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS,
        })
      }),
    )
  })

  it('rejects manifests with incomplete coverage or mismatched layout, count, or item order', async () => {
    const OMITTED_ENTRY_COUNT = 1
    const LAYOUT_WIDTH_DELTA = 1
    const invalidLayout = {
      ...itemIconManifest.layout,
      width: itemIconManifest.layout.width - LAYOUT_WIDTH_DELTA,
    }
    const incompleteItemIcons = Object.fromEntries(Object.entries(itemIconManifest.itemIcons).slice(OMITTED_ENTRY_COUNT))
    const [firstEntry, secondEntry, ...remainingEntries] = Object.entries(itemIconManifest.itemIcons)
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('the item icon manifest must contain more than one entry')
    }
    const reorderedItemIcons = Object.fromEntries([
      [firstEntry[0], secondEntry[1]],
      [secondEntry[0], firstEntry[1]],
      ...remainingEntries,
    ])

    await expectRejectedManifest({ ...itemIconManifest, layout: invalidLayout })
    await expectRejectedManifest({ ...itemIconManifest, itemIcons: incompleteItemIcons })
    await expectRejectedManifest({
      ...itemIconManifest,
      tileCount: itemIconManifest.tileCount + OMITTED_ENTRY_COUNT,
    })
    await expectRejectedManifest({ ...itemIconManifest, itemIcons: reorderedItemIcons })
  })

  it('returns a tagged lookup failure if a validated atlas tile cannot produce UV bounds', async () => {
    const atlasFailure = {
      _tag: 'AtlasCoordinateError',
      input: -1,
      operation: 'tile-index',
      reason: 'out-of-range',
    } as const
    vi.resetModules()
    vi.doMock('../src/domain/texture-atlas.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../src/domain/texture-atlas.js')>()
      return { ...original, tileUvBounds: () => Result.fail(atlasFailure) }
    })
    try {
      const itemIconMap = await import('../src/domain/item-icon-map.js')
      const itemId = ITEM_TYPES.at(0)
      if (itemId === undefined) {
        throw new Error('the kernel item roster must be nonempty')
      }
      const lookup = itemIconMap.itemIconUvForItemId(itemId)
      expect(Result.isFailure(lookup)).toBe(true)
      if (Result.isFailure(lookup)) {
        expect(lookup.failure).toStrictEqual({
          _tag: 'ItemIconLookupError',
          itemId,
          reason: 'invalid-atlas-tile',
        })
      }
    } finally {
      vi.doUnmock('../src/domain/texture-atlas.js')
      vi.resetModules()
    }
  })

  it('returns the UI1 unavailable failure if a validated atlas tile has no pixel origin', async () => {
    const atlasFailure = {
      _tag: 'AtlasCoordinateError',
      input: -1,
      operation: 'tile-index',
      reason: 'out-of-range',
    } as const
    vi.resetModules()
    vi.doMock('../src/domain/texture-atlas.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../src/domain/texture-atlas.js')>()
      return { ...original, tileImageOriginPixels: () => Result.fail(atlasFailure) }
    })
    try {
      const itemIconMap = await import('../src/domain/item-icon-map.js')
      const itemId = ITEM_TYPES.at(0)
      if (itemId === undefined) {
        throw new Error('the kernel item roster must be nonempty')
      }
      const lookup = itemIconMap.itemIconAtlasForItemId(itemId)
      expect(Result.isFailure(lookup)).toBe(true)
      if (Result.isFailure(lookup)) {
        expect(lookup.failure).toStrictEqual({ _tag: 'ItemIconUnavailable' })
      }
    } finally {
      vi.doUnmock('../src/domain/texture-atlas.js')
      vi.resetModules()
    }
  })
})
