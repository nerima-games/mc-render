import { Brand, Result, Schema } from 'effect'

export const ATLAS_COLUMNS = 32
export const ATLAS_ROWS = 32
export const ATLAS_PIXELS = 1536
export const ATLAS_TILE_COUNT: number = ATLAS_COLUMNS * ATLAS_ROWS
export const TILE_PIXELS = 16
export const TILE_GUTTER_PIXELS = 16
const GUTTER_EDGE_COUNT = 2
export const TILE_CELL_PIXELS: number = TILE_PIXELS + GUTTER_EDGE_COUNT * TILE_GUTTER_PIXELS
export const ATLAS_MIP_LEVEL_COUNT = 11

export type AtlasTileIndex = Brand.Branded<number, 'AtlasTileIndex'>
export type AtlasLayoutInteger = Brand.Branded<number, 'AtlasLayoutInteger'>
export type AtlasGridIndex = Brand.Branded<number, 'AtlasGridIndex'>
export type AtlasPixelCoordinate = Brand.Branded<number, 'AtlasPixelCoordinate'>
export type AtlasSourcePixelIndex = Brand.Branded<number, 'AtlasSourcePixelIndex'>
export type AtlasMipLevel = Brand.Branded<number, 'AtlasMipLevel'>
export type AtlasUvCoordinate = Brand.Branded<number, 'AtlasUvCoordinate'>

const HALF_TEXEL = 0.5
const UV_UNIT = 1
const MIN_TILE_INDEX = 0
const MIN_ATLAS_AXIS_INDEX = 0
const MIN_UV_COORDINATE = 0
const MIN_UV_SPAN = 0
const FIRST_MIP_LEVEL = 0
const LAST_ARRAY_INDEX_OFFSET = 1
const LAST_MIP_LEVEL = ATLAS_MIP_LEVEL_COUNT - LAST_ARRAY_INDEX_OFFSET
const FIRST_CELL_PIXEL = 0
const LAST_CELL_PIXEL = TILE_CELL_PIXELS - LAST_ARRAY_INDEX_OFFSET
const RGBA_COMPONENTS = 4
const MAX_RGBA_BYTE = 255
const FIRST_SOURCE_PIXEL = 0
const SOURCE_PIXEL_MAXIMUM = TILE_PIXELS - LAST_ARRAY_INDEX_OFFSET
const MINIMUM_MIP_DIMENSION = 1
const MIP_REDUCTION_BASE = 2
const FIRST_DIAGNOSTIC_TILE_INDEX = 1
const TILE_INDEX_INCREMENT = 1
const CELL_PIXEL_INCREMENT = 1
const RED_CHANNEL_INDEX = 0
const GREEN_CHANNEL_INDEX = 1
const BLUE_CHANNEL_INDEX = 2
const ALPHA_CHANNEL_INDEX = 3
const DIAGNOSTIC_SHADE_X_FACTOR = 7
const DIAGNOSTIC_SHADE_Y_FACTOR = 11
const DIAGNOSTIC_SHADE_TILE_FACTOR = 13
const DIAGNOSTIC_SHADE_RANGE = 48
const DIAGNOSTIC_RED_BASE = 80
const DIAGNOSTIC_GREEN_BASE = 64
const DIAGNOSTIC_BLUE_BASE = 64
const DIAGNOSTIC_COLOR_RANGE = 160
const DIAGNOSTIC_RED_TILE_FACTOR = 37
const DIAGNOSTIC_GREEN_TILE_FACTOR = 67
const DIAGNOSTIC_BLUE_TILE_FACTOR = 97
const DIAGNOSTIC_RED_SHADE_DIVISOR = 3
const DIAGNOSTIC_GREEN_SHADE_DIVISOR = 4
const DIAGNOSTIC_BLUE_SHADE_DIVISOR = 5
const UV_ORIGIN_ROUNDING_TOLERANCE = 1e-12

export const AtlasTileIndexSchema: Schema.Codec<AtlasTileIndex, number> = Schema.Int
  .check(Schema.isBetween({ maximum: ATLAS_TILE_COUNT - LAST_ARRAY_INDEX_OFFSET, minimum: MIN_TILE_INDEX }))
  .pipe(Schema.brand('AtlasTileIndex'))

export const AtlasLayoutIntegerSchema: Schema.Codec<AtlasLayoutInteger, number> = Schema.Int
  .check(Schema.isBetween({ maximum: ATLAS_PIXELS, minimum: MINIMUM_MIP_DIMENSION }))
  .pipe(Schema.brand('AtlasLayoutInteger'))

export const AtlasGridIndexSchema: Schema.Codec<AtlasGridIndex, number> = Schema.Int
  .check(Schema.isBetween({ maximum: ATLAS_COLUMNS - LAST_ARRAY_INDEX_OFFSET, minimum: MIN_ATLAS_AXIS_INDEX }))
  .pipe(Schema.brand('AtlasGridIndex'))

export const AtlasPixelCoordinateSchema: Schema.Codec<AtlasPixelCoordinate, number> = Schema.Int
  .check(Schema.isBetween({ maximum: ATLAS_PIXELS - LAST_ARRAY_INDEX_OFFSET, minimum: MIN_ATLAS_AXIS_INDEX }))
  .pipe(Schema.brand('AtlasPixelCoordinate'))

export const AtlasSourcePixelIndexSchema: Schema.Codec<AtlasSourcePixelIndex, number> = Schema.Int
  .check(Schema.isBetween({ maximum: SOURCE_PIXEL_MAXIMUM, minimum: FIRST_SOURCE_PIXEL }))
  .pipe(Schema.brand('AtlasSourcePixelIndex'))

export const AtlasMipLevelSchema: Schema.Codec<AtlasMipLevel, number> = Schema.Int
  .check(Schema.isBetween({ maximum: LAST_MIP_LEVEL, minimum: FIRST_MIP_LEVEL }))
  .pipe(Schema.brand('AtlasMipLevel'))

export const AtlasUvCoordinateSchema: Schema.Codec<AtlasUvCoordinate, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: UV_UNIT, minimum: MIN_UV_COORDINATE }))
  .pipe(Schema.brand('AtlasUvCoordinate'))

export const HALF_TEXEL_UV: number = HALF_TEXEL / ATLAS_PIXELS
export const TILE_UV_PITCH: number = TILE_CELL_PIXELS / ATLAS_PIXELS
export const TILE_UV_SPAN: number = (TILE_PIXELS - GUTTER_EDGE_COUNT * HALF_TEXEL) / ATLAS_PIXELS

export type RgbaAtlas = Readonly<{
  readonly width: AtlasLayoutInteger
  readonly height: AtlasLayoutInteger
  readonly data: Uint8ClampedArray
}>

export type AtlasCoordinateOperation =
  | 'atlas-dimension'
  | 'cell-coordinate'
  | 'mip-level'
  | 'tile-index'
  | 'uv-origin'
  | 'uv-span'
export type AtlasCoordinateReason = 'invalid-shape' | 'not-finite' | 'not-integer' | 'out-of-range' | 'not-tile-origin'

export type AtlasCoordinateError = Readonly<{
  readonly _tag: 'AtlasCoordinateError'
  readonly input: unknown
  readonly operation: AtlasCoordinateOperation
  readonly reason: AtlasCoordinateReason
}>

export type AtlasCoordinateResult<Value> = Result.Result<Value, AtlasCoordinateError>

export type PixelPosition = Readonly<{ readonly x: AtlasPixelCoordinate; readonly y: AtlasPixelCoordinate }>
export type TileUvBounds = Readonly<{
  readonly u0: AtlasUvCoordinate
  readonly v0: AtlasUvCoordinate
  readonly u1: AtlasUvCoordinate
  readonly v1: AtlasUvCoordinate
}>
export type UvOrigin = Readonly<{ readonly u: AtlasUvCoordinate; readonly v: AtlasUvCoordinate }>
export type MipLevelDimensions = Readonly<{
  readonly level: AtlasMipLevel
  readonly width: AtlasLayoutInteger
  readonly height: AtlasLayoutInteger
}>

const coordinateError = (
  operation: AtlasCoordinateOperation,
  input: unknown,
  reason: AtlasCoordinateReason,
): AtlasCoordinateError => ({ _tag: 'AtlasCoordinateError', input, operation, reason })

type IntegerRange = Readonly<{
  readonly maximum: number
  readonly minimum: number
  readonly operation: AtlasCoordinateOperation
  readonly value: number
}>

const rangedInteger = ({ maximum, minimum, operation, value }: IntegerRange): AtlasCoordinateResult<number> => {
  if (!Number.isFinite(value)) {
    return Result.fail(coordinateError(operation, value, 'not-finite'))
  }
  if (!Number.isInteger(value)) {
    return Result.fail(coordinateError(operation, value, 'not-integer'))
  }
  if (value < minimum || value > maximum) {
    return Result.fail(coordinateError(operation, value, 'out-of-range'))
  }
  return Result.succeed(value)
}

const atlasValueFailureReason = (value: number): AtlasCoordinateReason => {
  if (!Number.isFinite(value)) {
    return 'not-finite'
  }
  if (!Number.isInteger(value)) {
    return 'not-integer'
  }
  return 'out-of-range'
}

const decodeAtlasValue = <Value>(
  schema: Schema.Codec<Value, number>,
  value: number,
  operation: AtlasCoordinateOperation,
): AtlasCoordinateResult<Value> =>
  Result.mapError(
    Schema.decodeUnknownResult(schema)(value),
    () => coordinateError(operation, value, atlasValueFailureReason(value)),
  )

export const isTileIndex = (tileIndex: unknown): tileIndex is AtlasTileIndex =>
  Schema.is(AtlasTileIndexSchema)(tileIndex)

const validTileIndex = (tileIndex: unknown): AtlasCoordinateResult<AtlasTileIndex> => {
  if (typeof tileIndex !== 'number') {
    return Result.fail(coordinateError('tile-index', tileIndex, 'invalid-shape'))
  }
  return decodeAtlasValue(AtlasTileIndexSchema, tileIndex, 'tile-index')
}

export const tileColumn = (tileIndex: unknown): AtlasCoordinateResult<AtlasGridIndex> => {
  const valid = validTileIndex(tileIndex)
  if (Result.isFailure(valid)) {
    return Result.fail(valid.failure)
  }
  return decodeAtlasValue(AtlasGridIndexSchema, valid.success % ATLAS_COLUMNS, 'tile-index')
}

export const tileRow = (tileIndex: unknown): AtlasCoordinateResult<AtlasGridIndex> => {
  const valid = validTileIndex(tileIndex)
  if (Result.isFailure(valid)) {
    return Result.fail(valid.failure)
  }
  return decodeAtlasValue(AtlasGridIndexSchema, Math.floor(valid.success / ATLAS_COLUMNS), 'tile-index')
}

export const tileCellOriginPixels = (tileIndex: unknown): AtlasCoordinateResult<PixelPosition> => {
  const valid = validTileIndex(tileIndex)
  if (Result.isFailure(valid)) {
    return Result.fail(valid.failure)
  }
  const origin = Result.all({
    x: decodeAtlasValue(AtlasPixelCoordinateSchema, (valid.success % ATLAS_COLUMNS) * TILE_CELL_PIXELS, 'tile-index'),
    y: decodeAtlasValue(AtlasPixelCoordinateSchema, Math.floor(valid.success / ATLAS_COLUMNS) * TILE_CELL_PIXELS, 'tile-index'),
  })
  return Result.map(origin, ({ x, y }) => ({ x, y }))
}

export const tileImageOriginPixels = (tileIndex: unknown): AtlasCoordinateResult<PixelPosition> => {
  const cellOrigin = tileCellOriginPixels(tileIndex)
  if (Result.isFailure(cellOrigin)) {
    return cellOrigin
  }
  return Result.map(Result.all({
    x: decodeAtlasValue(AtlasPixelCoordinateSchema, cellOrigin.success.x + TILE_GUTTER_PIXELS, 'tile-index'),
    y: decodeAtlasValue(AtlasPixelCoordinateSchema, cellOrigin.success.y + TILE_GUTTER_PIXELS, 'tile-index'),
  }), ({ x, y }) => ({ x, y }))
}

const sourcePixelFromCellCoordinate = (cellCoordinate: number): number =>
  Math.max(FIRST_SOURCE_PIXEL, Math.min(SOURCE_PIXEL_MAXIMUM, cellCoordinate - TILE_GUTTER_PIXELS))

export const sourcePixelForCellCoordinate = (cellCoordinate: unknown): AtlasCoordinateResult<AtlasSourcePixelIndex> => {
  if (typeof cellCoordinate !== 'number') {
    return Result.fail(coordinateError('cell-coordinate', cellCoordinate, 'invalid-shape'))
  }
  const valid = rangedInteger({
    maximum: LAST_CELL_PIXEL,
    minimum: FIRST_CELL_PIXEL,
    operation: 'cell-coordinate',
    value: cellCoordinate,
  })
  if (Result.isFailure(valid)) {
    return Result.fail(valid.failure)
  }
  return decodeAtlasValue(
    AtlasSourcePixelIndexSchema,
    sourcePixelFromCellCoordinate(valid.success),
    'cell-coordinate',
  )
}

export const atlasMipLevelDimensions = (): AtlasCoordinateResult<ReadonlyArray<MipLevelDimensions>> => {
  const dimensions = Array.from({ length: ATLAS_MIP_LEVEL_COUNT }, (_unused, level) => {
    const size = Math.max(MINIMUM_MIP_DIMENSION, Math.floor(ATLAS_PIXELS / MIP_REDUCTION_BASE ** level))
    return Result.map(Result.all({
      height: decodeAtlasValue(AtlasLayoutIntegerSchema, size, 'mip-level'),
      level: decodeAtlasValue(AtlasMipLevelSchema, level, 'mip-level'),
      width: decodeAtlasValue(AtlasLayoutIntegerSchema, size, 'mip-level'),
    }), ({ height, level: mipLevel, width }) => ({ height, level: mipLevel, width }))
  })
  return Result.all(dimensions)
}

export const mipLevelDimensions = (level: unknown): AtlasCoordinateResult<MipLevelDimensions> => {
  if (typeof level !== 'number') {
    return Result.fail(coordinateError('mip-level', level, 'invalid-shape'))
  }
  const valid = rangedInteger({
    maximum: LAST_MIP_LEVEL,
    minimum: FIRST_MIP_LEVEL,
    operation: 'mip-level',
    value: level,
  })
  if (Result.isFailure(valid)) {
    return Result.fail(valid.failure)
  }
  const size = Math.max(
    MINIMUM_MIP_DIMENSION,
    Math.floor(ATLAS_PIXELS / MIP_REDUCTION_BASE ** valid.success),
  )
  return Result.map(Result.all({
    height: decodeAtlasValue(AtlasLayoutIntegerSchema, size, 'mip-level'),
    level: decodeAtlasValue(AtlasMipLevelSchema, valid.success, 'mip-level'),
    width: decodeAtlasValue(AtlasLayoutIntegerSchema, size, 'mip-level'),
  }), ({ height, level: mipLevel, width }) => ({ height, level: mipLevel, width }))
}

export const tileUvBounds = (tileIndex: unknown): AtlasCoordinateResult<TileUvBounds> => {
  const origin = tileImageOriginPixels(tileIndex)
  if (Result.isFailure(origin)) {
    return Result.fail(origin.failure)
  }

  const left = origin.success.x + HALF_TEXEL
  const top = origin.success.y + HALF_TEXEL
  const right = origin.success.x + TILE_PIXELS - HALF_TEXEL
  const bottom = origin.success.y + TILE_PIXELS - HALF_TEXEL
  const bounds = Result.all({
    u0: decodeAtlasValue(AtlasUvCoordinateSchema, left / ATLAS_PIXELS, 'uv-origin'),
    u1: decodeAtlasValue(AtlasUvCoordinateSchema, right / ATLAS_PIXELS, 'uv-origin'),
    v0: decodeAtlasValue(AtlasUvCoordinateSchema, UV_UNIT - bottom / ATLAS_PIXELS, 'uv-origin'),
    v1: decodeAtlasValue(AtlasUvCoordinateSchema, UV_UNIT - top / ATLAS_PIXELS, 'uv-origin'),
  })
  return bounds
}

export const tileUvOrigin = (tileIndex: unknown): AtlasCoordinateResult<UvOrigin> => {
  const bounds = tileUvBounds(tileIndex)
  if (Result.isFailure(bounds)) {
    return Result.fail(bounds.failure)
  }
  return Result.succeed({ u: bounds.success.u0, v: bounds.success.v0 })
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeUvCoordinates = (u: number, v: number): AtlasCoordinateResult<UvOrigin> => Result.all({
  u: decodeAtlasValue(AtlasUvCoordinateSchema, u, 'uv-origin'),
  v: decodeAtlasValue(AtlasUvCoordinateSchema, v, 'uv-origin'),
})

const validateUvOrigin = (origin: unknown): AtlasCoordinateResult<UvOrigin> => {
  if (!isRecord(origin)) {
    return Result.fail(coordinateError('uv-origin', origin, 'invalid-shape'))
  }
  const { u, v } = origin
  if (typeof u !== 'number' || typeof v !== 'number') {
    return Result.fail(coordinateError('uv-origin', origin, 'invalid-shape'))
  }
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return Result.fail(coordinateError('uv-origin', origin, 'not-finite'))
  }
  if (
    u < MIN_UV_COORDINATE ||
    u > UV_UNIT ||
    v < MIN_UV_COORDINATE ||
    v > UV_UNIT
  ) {
    return Result.fail(coordinateError('uv-origin', origin, 'out-of-range'))
  }
  return decodeUvCoordinates(u, v)
}

const tileIndexCandidateForUvOrigin = (origin: UvOrigin): AtlasCoordinateResult<AtlasTileIndex> => {
  const column = Math.round((origin.u * ATLAS_PIXELS - (TILE_GUTTER_PIXELS + HALF_TEXEL)) / TILE_CELL_PIXELS)
  const row = Math.round(
    (ATLAS_PIXELS - origin.v * ATLAS_PIXELS - (TILE_GUTTER_PIXELS + TILE_PIXELS - HALF_TEXEL)) /
      TILE_CELL_PIXELS,
  )
  if (
    column < MIN_ATLAS_AXIS_INDEX ||
    column >= ATLAS_COLUMNS ||
    row < MIN_ATLAS_AXIS_INDEX ||
    row >= ATLAS_ROWS
  ) {
    return Result.fail(coordinateError('uv-origin', origin, 'out-of-range'))
  }
  return decodeAtlasValue(AtlasTileIndexSchema, row * ATLAS_COLUMNS + column, 'uv-origin')
}

const originMatchesTile = (tileIndex: AtlasTileIndex, origin: UvOrigin): boolean => {
  const expected = tileUvOrigin(tileIndex)
  if (
    Result.isFailure(expected) ||
    Math.abs(origin.u - expected.success.u) > UV_ORIGIN_ROUNDING_TOLERANCE ||
    Math.abs(origin.v - expected.success.v) > UV_ORIGIN_ROUNDING_TOLERANCE
  ) {
    return false
  }
  return true
}

export const tileIndexForUvOrigin = (origin: unknown): AtlasCoordinateResult<AtlasTileIndex> => {
  const validOrigin = validateUvOrigin(origin)
  if (Result.isFailure(validOrigin)) {
    return Result.fail(validOrigin.failure)
  }
  const candidate = tileIndexCandidateForUvOrigin(validOrigin.success)
  if (Result.isFailure(candidate)) {
    return Result.fail(candidate.failure)
  }
  if (!originMatchesTile(candidate.success, validOrigin.success)) {
    return Result.fail(coordinateError('uv-origin', origin, 'not-tile-origin'))
  }
  return candidate
}

export const uvPatchStaysInsideTile = (span: unknown): AtlasCoordinateResult<boolean> => {
  if (typeof span !== 'number') {
    return Result.fail(coordinateError('uv-span', span, 'invalid-shape'))
  }
  if (!Number.isFinite(span)) {
    return Result.fail(coordinateError('uv-span', span, 'not-finite'))
  }
  if (span < MIN_UV_SPAN) {
    return Result.fail(coordinateError('uv-span', span, 'out-of-range'))
  }
  return Result.succeed(span <= TILE_UV_SPAN)
}

const diagnosticAtlasPixel = (tile: number, x: number, y: number): readonly [number, number, number, number] => {
  const shade =
    (x * DIAGNOSTIC_SHADE_X_FACTOR +
      y * DIAGNOSTIC_SHADE_Y_FACTOR +
      tile * DIAGNOSTIC_SHADE_TILE_FACTOR) %
    DIAGNOSTIC_SHADE_RANGE
  return [
    DIAGNOSTIC_RED_BASE +
      (tile * DIAGNOSTIC_RED_TILE_FACTOR) % DIAGNOSTIC_COLOR_RANGE +
      Math.floor(shade / DIAGNOSTIC_RED_SHADE_DIVISOR),
    DIAGNOSTIC_GREEN_BASE +
      (tile * DIAGNOSTIC_GREEN_TILE_FACTOR) % DIAGNOSTIC_COLOR_RANGE +
      Math.floor(shade / DIAGNOSTIC_GREEN_SHADE_DIVISOR),
    DIAGNOSTIC_BLUE_BASE +
      (tile * DIAGNOSTIC_BLUE_TILE_FACTOR) % DIAGNOSTIC_COLOR_RANGE +
      Math.floor(shade / DIAGNOSTIC_BLUE_SHADE_DIVISOR),
    MAX_RGBA_BYTE,
  ]
}

const writeDiagnosticPixel = (
  data: Uint8ClampedArray,
  offset: number,
  pixel: readonly [number, number, number, number],
): void => {
  const [red, green, blue, alpha] = pixel
  data[offset + RED_CHANNEL_INDEX] = red
  data[offset + GREEN_CHANNEL_INDEX] = green
  data[offset + BLUE_CHANNEL_INDEX] = blue
  data[offset + ALPHA_CHANNEL_INDEX] = alpha
}

const drawDiagnosticTile = (data: Uint8ClampedArray, tile: number): void => {
  const cellX = (tile % ATLAS_COLUMNS) * TILE_CELL_PIXELS
  const cellY = Math.floor(tile / ATLAS_COLUMNS) * TILE_CELL_PIXELS
  for (let y = FIRST_CELL_PIXEL; y < TILE_CELL_PIXELS; y += CELL_PIXEL_INCREMENT) {
    const sourceY = sourcePixelFromCellCoordinate(y)
    for (let x = FIRST_CELL_PIXEL; x < TILE_CELL_PIXELS; x += CELL_PIXEL_INCREMENT) {
      const sourceX = sourcePixelFromCellCoordinate(x)
      const pixelOffset = ((cellY + y) * ATLAS_PIXELS + cellX + x) * RGBA_COMPONENTS
      writeDiagnosticPixel(data, pixelOffset, diagnosticAtlasPixel(tile, sourceX, sourceY))
    }
  }
}

/** Deterministic diagnostic image for callers that explicitly need an RGBA atlas. */
export const generateTerrainAtlas = (): AtlasCoordinateResult<RgbaAtlas> => {
  const dimension = decodeAtlasValue(AtlasLayoutIntegerSchema, ATLAS_PIXELS, 'atlas-dimension')
  return Result.map(dimension, (decodedDimension) => {
    const data = new Uint8ClampedArray(ATLAS_PIXELS * ATLAS_PIXELS * RGBA_COMPONENTS)
    for (let tile = FIRST_DIAGNOSTIC_TILE_INDEX; tile < ATLAS_TILE_COUNT; tile += TILE_INDEX_INCREMENT) {
      drawDiagnosticTile(data, tile)
    }
    return { data, height: decodedDimension, width: decodedDimension }
  })
}
