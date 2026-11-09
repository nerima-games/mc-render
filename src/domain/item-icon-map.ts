import {
  ATLAS_COLUMNS,
  ATLAS_MIP_LEVEL_COUNT,
  ATLAS_PIXELS,
  ATLAS_ROWS,
  ATLAS_TILE_COUNT,
  AtlasLayoutIntegerSchema,
  type AtlasTileIndex,
  AtlasTileIndexSchema,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
  type TileUvBounds,
  tileUvBounds,
} from './texture-atlas.js'
import { ITEM_TYPES, type ItemType } from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import itemIconManifest from '../assets/item-icons/manifest.json' with { type: 'json' }

const MANIFEST_SCHEMA_VERSION = 1

export type ItemIconLookupError = Readonly<{
  readonly _tag: 'ItemIconLookupError'
  readonly itemId: unknown
  readonly reason: 'invalid-item-id' | 'unknown-item' | 'invalid-atlas-tile'
}>

type ItemIconManifestError = Readonly<{
  readonly _tag: 'ItemIconManifestError'
  readonly reason: 'layout' | 'tile-count' | 'tile-order'
}>

type ItemIconManifestLayout = Readonly<{
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
  readonly tilePixels: number
  readonly gutterPixels: number
  readonly cellPixels: number
  readonly capacity: number
  readonly mipLevels: number
}>

type ItemIconManifest = Readonly<{
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  readonly layout: ItemIconManifestLayout
  readonly tileCount: number
  readonly itemIcons: Readonly<Record<ItemType, AtlasTileIndex>>
}>

const ItemIconManifestLayoutSchema: Schema.Codec<ItemIconManifestLayout> = Schema.Struct({
  capacity: AtlasLayoutIntegerSchema,
  cellPixels: AtlasLayoutIntegerSchema,
  columns: AtlasLayoutIntegerSchema,
  gutterPixels: AtlasLayoutIntegerSchema,
  height: AtlasLayoutIntegerSchema,
  mipLevels: AtlasLayoutIntegerSchema,
  rows: AtlasLayoutIntegerSchema,
  tilePixels: AtlasLayoutIntegerSchema,
  width: AtlasLayoutIntegerSchema,
})

const ItemIconManifestSchema = Schema.Struct({
  itemIcons: Schema.Record(Schema.Literals(ITEM_TYPES), AtlasTileIndexSchema),
  layout: ItemIconManifestLayoutSchema,
  schemaVersion: Schema.Literal(MANIFEST_SCHEMA_VERSION),
  tileCount: AtlasLayoutIntegerSchema,
})

const manifest = Schema.decodeUnknownSync(ItemIconManifestSchema)(itemIconManifest)
const itemNames = new Set<string>(ITEM_TYPES)

const layoutMatchesAtlas = (layout: ItemIconManifestLayout): boolean =>
  layout.width === ATLAS_PIXELS &&
  layout.height === ATLAS_PIXELS &&
  layout.columns === ATLAS_COLUMNS &&
  layout.rows === ATLAS_ROWS &&
  layout.tilePixels === TILE_PIXELS &&
  layout.gutterPixels === TILE_GUTTER_PIXELS &&
  layout.cellPixels === TILE_CELL_PIXELS &&
  layout.capacity === ATLAS_TILE_COUNT &&
  layout.mipLevels === ATLAS_MIP_LEVEL_COUNT

const hasExpectedTileOrder = (map: Readonly<Record<ItemType, AtlasTileIndex>>): boolean => {
  for (const [index, itemId] of ITEM_TYPES.entries()) {
    if (itemId === undefined || map[itemId] !== index) {
      return false
    }
  }
  return true
}

const validateManifest = (value: ItemIconManifest): Result.Result<ItemIconManifest, ItemIconManifestError> => {
  if (!layoutMatchesAtlas(value.layout)) {
    return Result.fail({ _tag: 'ItemIconManifestError', reason: 'layout' })
  }
  if (value.tileCount !== ITEM_TYPES.length) {
    return Result.fail({ _tag: 'ItemIconManifestError', reason: 'tile-count' })
  }
  if (!hasExpectedTileOrder(value.itemIcons)) {
    return Result.fail({ _tag: 'ItemIconManifestError', reason: 'tile-order' })
  }
  return Result.succeed(value)
}

const decodedManifest = Result.getOrThrow(validateManifest(manifest))

export const ITEM_ICON_TILE_BY_ITEM_ID: Readonly<Record<ItemType, AtlasTileIndex>> = Object.freeze(
  decodedManifest.itemIcons,
)

const lookupFailure = (
  itemId: unknown,
  reason: ItemIconLookupError['reason'],
): Result.Result<never, ItemIconLookupError> =>
  Result.fail({ _tag: 'ItemIconLookupError', itemId, reason })

const isItemType = (itemId: string): itemId is ItemType => itemNames.has(itemId)

/** Return the inset atlas UV bounds for a registered item name. */
export const itemIconUvForItemId = (itemId: unknown): Result.Result<TileUvBounds, ItemIconLookupError> => {
  if (typeof itemId !== 'string') {
    return lookupFailure(itemId, 'invalid-item-id')
  }
  if (!isItemType(itemId)) {
    return lookupFailure(itemId, 'unknown-item')
  }
  const bounds = tileUvBounds(decodedManifest.itemIcons[itemId])
  if (Result.isFailure(bounds)) {
    return lookupFailure(itemId, 'invalid-atlas-tile')
  }
  return Result.succeed(bounds.success)
}
