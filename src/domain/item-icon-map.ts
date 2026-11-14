import {
  ATLAS_COLUMNS,
  ATLAS_MIP_LEVEL_COUNT,
  ATLAS_PIXELS,
  ATLAS_ROWS,
  ATLAS_TILE_COUNT,
  type AtlasLayoutInteger,
  AtlasLayoutIntegerSchema,
  type AtlasPixelCoordinate,
  type AtlasTileIndex,
  AtlasTileIndexSchema,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
  type TileUvBounds,
  tileImageOriginPixels,
  tileUvBounds,
} from './texture-atlas.js'
import { Brand, Result, Schema } from 'effect'
import { ITEM_TYPES, type ItemType } from '@nerima-games/mc-kernel'
import itemIconManifest from '../assets/item-icons/manifest.json' with { type: 'json' }

declare global {
  interface ImportMeta {
    url: string
  }
}

const MANIFEST_SCHEMA_VERSION = 1
const ITEM_ICON_URL_PATH_SEPARATOR = '/'
const ITEM_ICON_URL_PATH_SEPARATOR_LENGTH = 1
const URL_SLICE_START = 0
const ITEM_ICON_DIMENSION: AtlasLayoutInteger = Schema.decodeUnknownSync(AtlasLayoutIntegerSchema)(TILE_PIXELS)
const ITEM_ICON_ATLAS_DIMENSION: AtlasLayoutInteger = Schema.decodeUnknownSync(AtlasLayoutIntegerSchema)(ATLAS_PIXELS)

export type ItemIconLookupError = Readonly<{
  readonly _tag: 'ItemIconLookupError'
  readonly itemId: unknown
  readonly reason: 'invalid-item-id' | 'unknown-item' | 'invalid-atlas-tile'
}>

export type ItemIconAtlasResolution = Readonly<{
  readonly kind: 'atlas'
  readonly url: ItemIconAtlasUrl
  readonly x: AtlasPixelCoordinate
  readonly y: AtlasPixelCoordinate
  readonly width: AtlasLayoutInteger
  readonly height: AtlasLayoutInteger
  readonly atlasWidth: AtlasLayoutInteger
  readonly atlasHeight: AtlasLayoutInteger
}>

export type ItemIconAtlasUrl = Brand.Branded<string, 'ItemIconAtlasUrl'>

export type ItemIconAtlasResolutionFailure = Readonly<{ readonly _tag: 'ItemIconUnavailable' }>

export type ItemIconResolver = (
  itemType: ItemType,
) => Result.Result<unknown, ItemIconAtlasResolutionFailure>

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
const makeItemIconAtlasUrl = Brand.nominal<ItemIconAtlasUrl>()
const itemIconModuleUrl = import.meta.url
const itemIconModuleDirectory = itemIconModuleUrl.slice(
  URL_SLICE_START,
  itemIconModuleUrl.lastIndexOf(ITEM_ICON_URL_PATH_SEPARATOR) + ITEM_ICON_URL_PATH_SEPARATOR_LENGTH,
)
export const ITEM_ICON_ATLAS_URL: string = `${itemIconModuleDirectory}../assets/item-icons/atlas.png`

export const ITEM_ICON_TILE_BY_ITEM_ID: Readonly<Record<ItemType, AtlasTileIndex>> = Object.freeze(
  decodedManifest.itemIcons,
)

const lookupFailure = (
  itemId: unknown,
  reason: ItemIconLookupError['reason'],
): Result.Result<never, ItemIconLookupError> =>
  Result.fail({ _tag: 'ItemIconLookupError', itemId, reason })

const isItemType = (itemId: string): itemId is ItemType => itemNames.has(itemId)

const itemIconTileForItemId = (
  itemId: unknown,
): Result.Result<Readonly<{ readonly bounds: TileUvBounds; readonly tileIndex: AtlasTileIndex }>, ItemIconLookupError> => {
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
  return Result.succeed({ bounds: bounds.success, tileIndex: decodedManifest.itemIcons[itemId] })
}

/** Return the inset atlas UV bounds for a registered item name. */
export const itemIconUvForItemId = (itemId: unknown): Result.Result<TileUvBounds, ItemIconLookupError> => {
  const tile = itemIconTileForItemId(itemId)
  if (Result.isFailure(tile)) {
    return Result.fail(tile.failure)
  }
  return Result.succeed(tile.success.bounds)
}

/** Resolve an item ID to its image URL and pixel rectangle for atlas consumers. */
export const itemIconAtlasForItemId = (
  itemId: unknown,
): Result.Result<ItemIconAtlasResolution, ItemIconAtlasResolutionFailure> => {
  const tile = itemIconTileForItemId(itemId)
  if (Result.isFailure(tile)) {
    return Result.fail({ _tag: 'ItemIconUnavailable' })
  }
  const { tileIndex } = tile.success
  const pixelOrigin = tileImageOriginPixels(tileIndex)
  if (Result.isFailure(pixelOrigin)) {
    return Result.fail({ _tag: 'ItemIconUnavailable' })
  }
  return Result.succeed({
    atlasHeight: ITEM_ICON_ATLAS_DIMENSION,
    atlasWidth: ITEM_ICON_ATLAS_DIMENSION,
    height: ITEM_ICON_DIMENSION,
    kind: 'atlas',
    url: makeItemIconAtlasUrl(ITEM_ICON_ATLAS_URL),
    width: ITEM_ICON_DIMENSION,
    x: pixelOrigin.success.x,
    y: pixelOrigin.success.y,
  })
}
