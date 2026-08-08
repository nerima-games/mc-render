/**
 * The texture atlas, as deterministic data and arithmetic.
 *
 * ---------------------------------------------------------------------------
 * What this file is, and what it deliberately is not
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.9 gives mc-render 「テクスチャ同梱」 and plan.md §5.3 says
 * 「独立アセットリポジトリは作らない」, so the atlas PNG belongs in this
 * repository. Rather than checking in an opaque PNG, this module generates the
 * same 512x512 RGBA asset deterministically. The result can be handed to a
 * renderer-specific texture adapter without introducing DOM types here.
 *
 * An atlas is two separable things:
 *
 *   THE IMAGE      512x512 pixels of block faces. `generateTerrainAtlas`
 *                  creates its RGBA bytes without a canvas, DOM or filesystem,
 *                  so dimensions, determinism and alpha can be tested in Node.
 *
 *   THE LAYOUT     which tile index sits at which (column, row), and what UV
 *                  rectangle that is. Pure arithmetic over two integers. Every
 *                  bug it can have is a bug a unit test can see.
 *
 * Both halves are here as pure data. Turning those bytes into a `THREE.Texture`
 * remains an adapter concern; generating them does not require that adapter.
 *
 * The layout half is not optional decoration. `domain/particle-pool.ts` needs a
 * per-particle UV offset to sample the block it was broken from, so the
 * arithmetic below is a dependency of the particle work rather than a
 * side-quest next to it.
 *
 * ---------------------------------------------------------------------------
 * The constants, and where each one comes from
 * ---------------------------------------------------------------------------
 *
 * All four are TRANSCRIBED from
 * ts-minecraft/packages/rendering/infrastructure/textures/block-texture-map.ts:
 *
 *   ATLAS_COLUMNS      16       :9   (`ATLAS_COLS`)
 *   ATLAS_PIXELS       512      :10  (`ATLAS_SIZE`)
 *   HALF_TEXEL_UV      0.5/512  :11  (`HALF_TEXEL`)
 *   tile UV formula             :14-26 (`getTileUVs`)
 *
 * TRANSCRIBED, NOT JUSTIFIED: the reference states none of these as a measured
 * or derived choice. 16 columns of 32 pixels filling 512 is self-consistent and
 * that is all that can be said for it from the source. What IS derivable, and is
 * derived below, is that the three must agree — `ATLAS_PIXELS / ATLAS_COLUMNS`
 * has to be a whole number of pixels or every tile boundary lands mid-texel.
 * `atlasLayoutViolations` checks that rather than trusting it.
 *
 * ---------------------------------------------------------------------------
 * The half-texel inset, and the one place the reference forgets it
 * ---------------------------------------------------------------------------
 *
 * `tileUvBounds` insets every rectangle by half a texel on all four sides. That
 * is not fussiness. A UV that lands exactly on a tile boundary is ambiguous
 * under bilinear filtering and under every mip level below the top one: the
 * sampler blends with the neighbouring tile, and grass bleeds a line of dirt
 * along its edge. Half a texel is the smallest inset that puts the sample point
 * strictly inside the tile's own pixels.
 *
 * THE FOLLOWING IS MY DERIVATION FROM TWO REFERENCE FILES AND IS NOT SOMETHING
 * THE REFERENCE STATES. It is written out so the next reader can check it rather
 * than take it:
 *
 *   `getParticleUvOffset` (particle-system-factory.ts:57-64) returns the INSET
 *   origin `(u0, v0)` from `getTileUVs`.
 *
 *   `buildParticleGeometry` (particle-system-factory.ts:39-54) gives the
 *   particle quad a UV span of `TILE_FRACTION`, which is `1 / 16` exactly
 *   (:17) — the UN-inset tile width.
 *
 *   The shader adds them (particle-system.ts:84, `vMapUv = vMapUv + uvOffset`),
 *   so a particle samples
 *
 *       [ col/16 + HALF_TEXEL , col/16 + HALF_TEXEL + 1/16 ]
 *
 *   whose far edge is `(col + 1)/16 + HALF_TEXEL` — half a texel PAST the tile
 *   boundary, and therefore inside the neighbouring tile. The inset that was
 *   applied to the near edge was cancelled on the far edge by using the full
 *   `1/16` width with it.
 *
 * The span that stays inside the tile is `1/16 - 2 * HALF_TEXEL`, which is what
 * `TILE_UV_SPAN` is, and `uvPatchStaysInsideTile` is the predicate that tells
 * the two apart. `test/texture-atlas.test.ts` asserts it rejects the reference's
 * `1/16` and accepts `TILE_UV_SPAN`, so the finding is pinned as a test rather
 * than as this paragraph.
 *
 * How much it matters, stated honestly: one texel of bleed on two edges of a
 * 0.1m particle quad (`domain/particle-pool.ts`) is not something a player will
 * report. It is here because it is free to get right and because the same
 * mistake on a chunk face would be the classic visible one.
 *
 * ---------------------------------------------------------------------------
 * V is flipped and that is not a mistake
 * ---------------------------------------------------------------------------
 *
 * `tileRow` counts DOWN from the top of the image, the way an image file is
 * laid out. GL texture coordinates count UP from the bottom. So `v0` is
 * `1 - (row + 1)/16` rather than `row/16`, exactly as the reference has it
 * (block-texture-map.ts:22-23). Getting this backwards is invisible on a
 * symmetric tile and obvious on grass, which is the worst combination — it
 * survives whatever you happened to test with. `tileIndexForUvOrigin` inverts
 * the whole mapping so a round-trip test can catch it, which is a check no
 * amount of staring at the formula provides.
 *
 * ---------------------------------------------------------------------------
 * Ordering note (lint cleanup)
 * ---------------------------------------------------------------------------
 *
 * The tile-index primitives (`isTileIndex`, `normaliseTileIndex`, `tileColumn`,
 * `tileRow`) are declared before anything that calls them — `terrainTileKind`
 * and `generateTerrainAtlas` — rather than after, as pure reordering with no
 * behaviour change. `no-use-before-define` is enforced strictly in this file.
 */

/** Tiles per atlas row. The atlas is square, so also tiles per column. */
export const ATLAS_COLUMNS = 16

/** The atlas image edge, in pixels. */
export const ATLAS_PIXELS = 512

/** Tiles the atlas can hold. `16 * 16`. */
export const ATLAS_TILE_COUNT = ATLAS_COLUMNS * ATLAS_COLUMNS

/** One tile's edge, in pixels. `512 / 16`. */
export const TILE_PIXELS = ATLAS_PIXELS / ATLAS_COLUMNS

/** Semantic rendering treatment used by the generated terrain atlas. */
export type TerrainTileKind = 'solid' | 'cutout' | 'water' | 'lava' | 'leaves' | 'glass'

/** A DOM-independent RGBA image, ordered top-to-bottom and left-to-right. */
export type RgbaAtlas = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** The lowest tile index the atlas can hold. */
const MIN_TILE_INDEX = 0

/**
 * True when `tileIndex` names a tile the atlas actually has.
 *
 * TOTAL, and it takes a `number` rather than a branded index because its whole
 * job is to be the thing that decides. A non-integer, a negative and a NaN are
 * all "not a tile", and they arrive from block ids that this repository does not
 * own — mc-worldgen does.
 */
export const isTileIndex = (tileIndex: number): boolean =>
  Number.isInteger(tileIndex) && tileIndex >= MIN_TILE_INDEX && tileIndex < ATLAS_TILE_COUNT

/** Tile 0 is dirt in the reference's map — see `normaliseTileIndex` below. */
const DIRT_FALLBACK_TILE_INDEX = 0

/**
 * Fold any number into a tile the atlas has.
 *
 * The INERT direction, and the same one `normaliseSeed` takes in mx-gameplay's
 * `domain/frame-rolls.ts`: an unknown block draws tile 0 rather than sampling
 * outside the image or propagating NaN through every UV downstream. Tile 0 is
 * dirt in the reference's map (particle-system-factory.ts:56 「Unknown blockId
 * -> dirt (tile 0)」), so the fallback is a real texture and not a magenta
 * checkerboard.
 *
 * Deliberately NOT a modulo fold. `tileIndex % 256` would map an out-of-range id
 * to an arbitrary REAL tile, so a wrong block id would render as a plausible
 * wrong texture — the failure mode that looks like a texture-map bug and costs a
 * day. Everything unknown landing on one known tile is diagnosable at a glance.
 */
export const normaliseTileIndex = (tileIndex: number): number => {
  if (isTileIndex(tileIndex)) {
    return tileIndex
  }
  return DIRT_FALLBACK_TILE_INDEX
}

/** The atlas column a tile sits in, counting from the left. */
export const tileColumn = (tileIndex: number): number => normaliseTileIndex(tileIndex) % ATLAS_COLUMNS

/**
 * The atlas row a tile sits in, counting DOWN from the top.
 *
 * Down, because that is how the image file is laid out. `tileUvBounds` is where
 * that gets turned into GL's upward V. See the header.
 */
export const tileRow = (tileIndex: number): number =>
  Math.floor(normaliseTileIndex(tileIndex) / ATLAS_COLUMNS)

/**
 * Tile indices that render as `cutout` (leaves-like alpha patterns) rather than
 * `solid`, transcribed from the reference's block-texture-map.ts. Named by
 * their atlas index — this repository has the reference's resulting index set
 * but not its per-tile block-name table, so a more specific name would be
 * invented rather than transcribed.
 */
const CUTOUT_TILE_INDEX_45 = 45
const CUTOUT_TILE_INDEX_85 = 85
const CUTOUT_TILE_INDEX_87 = 87
const CUTOUT_TILE_INDEX_100 = 100
const CUTOUT_TILE_INDEX_103 = 103
const CUTOUT_TILE_INDEX_104 = 104
const CUTOUT_TILE_INDEX_106 = 106
const CUTOUT_TILE_INDEX_107 = 107
const CUTOUT_TILE_INDEX_108 = 108
const CUTOUT_TILE_INDEX_109 = 109
const CUTOUT_TILE_INDEX_110 = 110
const CUTOUT_TILE_INDEX_111 = 111
const CUTOUT_TILE_INDEX_112 = 112
const CUTOUT_TILE_INDEX_115 = 115
const CUTOUT_TILE_INDEX_121 = 121
const CUTOUT_TILE_INDEX_125 = 125
const CUTOUT_TILE_INDEX_127 = 127
const CUTOUT_TILE_INDEX_149 = 149

const CUTOUT_TILES = new Set([
  CUTOUT_TILE_INDEX_45,
  CUTOUT_TILE_INDEX_85,
  CUTOUT_TILE_INDEX_87,
  CUTOUT_TILE_INDEX_100,
  CUTOUT_TILE_INDEX_103,
  CUTOUT_TILE_INDEX_104,
  CUTOUT_TILE_INDEX_106,
  CUTOUT_TILE_INDEX_107,
  CUTOUT_TILE_INDEX_108,
  CUTOUT_TILE_INDEX_109,
  CUTOUT_TILE_INDEX_110,
  CUTOUT_TILE_INDEX_111,
  CUTOUT_TILE_INDEX_112,
  CUTOUT_TILE_INDEX_115,
  CUTOUT_TILE_INDEX_121,
  CUTOUT_TILE_INDEX_125,
  CUTOUT_TILE_INDEX_127,
  CUTOUT_TILE_INDEX_149,
])

/** The two tiles the reference maps to `water` (block-texture-map.ts). */
const WATER_TILE_INDEX_7 = 7
const WATER_TILE_INDEX_122 = 122
const LAVA_TILE_INDEX_18 = 18
const LEAVES_TILE_INDEX_8 = 8
const GLASS_TILE_INDEX_9 = 9

/** The material treatment for a mapped tile. Values align with block-texture-map.ts. */
export const terrainTileKind = (tileIndex: number): TerrainTileKind => {
  switch (normaliseTileIndex(tileIndex)) {
    case WATER_TILE_INDEX_7:
    case WATER_TILE_INDEX_122:
      return 'water'
    case LAVA_TILE_INDEX_18:
      return 'lava'
    case LEAVES_TILE_INDEX_8:
      return 'leaves'
    case GLASS_TILE_INDEX_9:
      return 'glass'
    default: {
      if (CUTOUT_TILES.has(normaliseTileIndex(tileIndex))) {
        return 'cutout'
      }
      return 'solid'
    }
  }
}

const CHANNEL_BASE = 48
const CHANNEL_MODULUS = 160

const channel = (tile: number, multiplier: number): number => CHANNEL_BASE + ((tile * multiplier) % CHANNEL_MODULUS)

/** Bytes per pixel in an RGBA image. */
const RGBA_STRIDE = 4
const GREEN_CHANNEL_OFFSET = 1
const BLUE_CHANNEL_OFFSET = 2
const ALPHA_CHANNEL_OFFSET = 3

type PixelWrite = {
  readonly pixelX: number
  readonly pixelY: number
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

const writePixel = (data: Uint8ClampedArray, pixel: PixelWrite): void => {
  const offset = (pixel.pixelY * ATLAS_PIXELS + pixel.pixelX) * RGBA_STRIDE
  data[offset] = pixel.red
  data[offset + GREEN_CHANNEL_OFFSET] = pixel.green
  data[offset + BLUE_CHANNEL_OFFSET] = pixel.blue
  data[offset + ALPHA_CHANNEL_OFFSET] = pixel.alpha
}

/** A pixel's position within its tile, and the tile's own index (for tile-derived noise/markers). */
type TilePixelContext = {
  readonly tile: number
  readonly pixelX: number
  readonly pixelY: number
}

type TilePixelRgba = readonly [number, number, number, number]

const NOISE_TILE_WEIGHT = 37
const NOISE_BLOCK_DIVISOR = 4
const NOISE_X_WEIGHT = 17
const NOISE_Y_WEIGHT = 29
/** `noise`'s range is `[0, NOISE_RANGE)`; every tile/pixel input is non-negative, so a modulo here is exactly the `& 31` bit-mask it replaces. */
const NOISE_RANGE = 32

const noiseFor = (context: TilePixelContext): number =>
  (context.tile * NOISE_TILE_WEIGHT +
    Math.floor(context.pixelX / NOISE_BLOCK_DIVISOR) * NOISE_X_WEIGHT +
    Math.floor(context.pixelY / NOISE_BLOCK_DIVISOR) * NOISE_Y_WEIGHT) %
  NOISE_RANGE

const MARKER_ROW_LIMIT = 4
const MARKER_COLUMN_LIMIT = 16
const MARKER_BIT_DIVISOR = 2
const MARKER_BIT_MASK = 1

/**
 * True for the pixels that draw the tile's compact binary marker.
 *
 * `(tile >> shift) & 1` reads one BIT of the tile index to decide whether this
 * pixel column draws the marker — genuine bit-flag extraction with no equally
 * clear arithmetic phrasing, unlike the RGB byte-packing elsewhere in this
 * codebase (see `render-environment.ts`). `no-bitwise` is left un-silenced
 * here rather than worked around; see this file's lint report.
 */
const markerFor = (context: TilePixelContext): boolean =>
  context.pixelY < MARKER_ROW_LIMIT &&
  context.pixelX < MARKER_COLUMN_LIMIT &&
  ((context.tile >> Math.floor(context.pixelX / MARKER_BIT_DIVISOR)) & MARKER_BIT_MASK) === MARKER_BIT_MASK

const WATER_BASE_RED = 20
const WATER_BASE_GREEN = 92
const WATER_BASE_BLUE = 178
const WATER_ALPHA = 176

const waterPixel = (noise: number): TilePixelRgba => [
  WATER_BASE_RED + noise,
  WATER_BASE_GREEN + noise,
  WATER_BASE_BLUE + noise,
  WATER_ALPHA,
]

const LAVA_BASE_RED = 224
/** `noise & 15`, replaced with the equivalent modulo since `noise` is never negative. */
const LAVA_RED_NOISE_RANGE = 16
const LAVA_GREEN_BASE = 54
const LAVA_GREEN_NOISE_WEIGHT = 2
/** `noise >> 1`, replaced with the equivalent halving division. */
const LAVA_BLUE_NOISE_DIVISOR = 2
const LAVA_ALPHA = 255

const lavaPixel = (noise: number): TilePixelRgba => [
  LAVA_BASE_RED + (noise % LAVA_RED_NOISE_RANGE),
  LAVA_GREEN_BASE + noise * LAVA_GREEN_NOISE_WEIGHT,
  Math.floor(noise / LAVA_BLUE_NOISE_DIVISOR),
  LAVA_ALPHA,
]

const LEAVES_BASE_RED = 32
const LEAVES_GREEN_BASE = 104
const LEAVES_GREEN_NOISE_WEIGHT = 2
const LEAVES_BASE_BLUE = 38
const LEAVES_HOLE_MODULUS = 7
const LEAVES_HOLE_REMAINDER = 0
const LEAVES_HOLE_ALPHA = 0
const LEAVES_SOLID_ALPHA = 255

const leavesAlpha = (context: TilePixelContext): number => {
  const isHole =
    (context.pixelX + context.pixelY + context.tile) % LEAVES_HOLE_MODULUS === LEAVES_HOLE_REMAINDER
  if (isHole) {
    return LEAVES_HOLE_ALPHA
  }
  return LEAVES_SOLID_ALPHA
}

const leavesPixel = (context: TilePixelContext, noise: number): TilePixelRgba => [
  LEAVES_BASE_RED + noise,
  LEAVES_GREEN_BASE + noise * LEAVES_GREEN_NOISE_WEIGHT,
  LEAVES_BASE_BLUE + noise,
  leavesAlpha(context),
]

const GLASS_EDGE_MARGIN = 3
const GLASS_MARKER_RED = 245
const GLASS_BASE_RED = 150
const GLASS_GREEN_BASE = 220
/** `noise >> 1`, replaced with the equivalent halving division; shared by the green and blue channels. */
const GLASS_NOISE_HALF_DIVISOR = 2
const GLASS_BLUE_BASE = 230
const GLASS_EDGE_ALPHA = 144
const GLASS_INTERIOR_ALPHA = 48

const isGlassEdge = (context: TilePixelContext): boolean =>
  context.pixelX < GLASS_EDGE_MARGIN ||
  context.pixelY < GLASS_EDGE_MARGIN ||
  context.pixelX >= TILE_PIXELS - GLASS_EDGE_MARGIN ||
  context.pixelY >= TILE_PIXELS - GLASS_EDGE_MARGIN

const glassRed = (marker: boolean, noise: number): number => {
  if (marker) {
    return GLASS_MARKER_RED
  }
  return GLASS_BASE_RED + noise
}

const glassAlpha = (context: TilePixelContext): number => {
  if (isGlassEdge(context)) {
    return GLASS_EDGE_ALPHA
  }
  return GLASS_INTERIOR_ALPHA
}

const glassPixel = (context: TilePixelContext, noise: number, marker: boolean): TilePixelRgba => [
  glassRed(marker, noise),
  GLASS_GREEN_BASE + Math.floor(noise / GLASS_NOISE_HALF_DIVISOR),
  GLASS_BLUE_BASE + Math.floor(noise / GLASS_NOISE_HALF_DIVISOR),
  glassAlpha(context),
]

const CUTOUT_ALPHA_X_WEIGHT = 3
const CUTOUT_ALPHA_Y_WEIGHT = 5
const CUTOUT_ALPHA_MODULUS = 11
const CUTOUT_ALPHA_THRESHOLD = 3
const CUTOUT_HOLE_ALPHA = 0
const OPAQUE_ALPHA = 255
const MARKER_SHADE = 42
const NOISE_SHADE_OFFSET = 16
const SOLID_RED_MULTIPLIER = 73
const SOLID_GREEN_MULTIPLIER = 151
const SOLID_BLUE_MULTIPLIER = 199

const solidOrCutoutAlpha = (kind: TerrainTileKind, context: TilePixelContext): number => {
  if (kind !== 'cutout') {
    return OPAQUE_ALPHA
  }
  const isHole =
    (context.pixelX * CUTOUT_ALPHA_X_WEIGHT + context.pixelY * CUTOUT_ALPHA_Y_WEIGHT + context.tile) %
      CUTOUT_ALPHA_MODULUS <
    CUTOUT_ALPHA_THRESHOLD
  if (isHole) {
    return CUTOUT_HOLE_ALPHA
  }
  return OPAQUE_ALPHA
}

const shadeFor = (marker: boolean, noise: number): number => {
  if (marker) {
    return MARKER_SHADE
  }
  return noise - NOISE_SHADE_OFFSET
}

/** The two per-pixel values every renderer derives from a `TilePixelContext`. */
type ShadedSample = {
  readonly noise: number
  readonly marker: boolean
}

const solidOrCutoutPixel = (
  kind: TerrainTileKind,
  context: TilePixelContext,
  sample: ShadedSample,
): TilePixelRgba => {
  const shade = shadeFor(sample.marker, sample.noise)
  return [
    channel(context.tile, SOLID_RED_MULTIPLIER) + shade,
    channel(context.tile, SOLID_GREEN_MULTIPLIER) + shade,
    channel(context.tile, SOLID_BLUE_MULTIPLIER) + shade,
    solidOrCutoutAlpha(kind, context),
  ]
}

type TilePixelRenderer = (context: TilePixelContext, noise: number, marker: boolean) => TilePixelRgba

const renderWater: TilePixelRenderer = (context, noise) => waterPixel(noise)
const renderLava: TilePixelRenderer = (context, noise) => lavaPixel(noise)
const renderLeaves: TilePixelRenderer = (context, noise) => leavesPixel(context, noise)
const renderGlass: TilePixelRenderer = (context, noise, marker) => glassPixel(context, noise, marker)
const renderSolid: TilePixelRenderer = (context, noise, marker) =>
  solidOrCutoutPixel('solid', context, { marker, noise })
const renderCutout: TilePixelRenderer = (context, noise, marker) =>
  solidOrCutoutPixel('cutout', context, { marker, noise })

const TILE_PIXEL_RENDERERS: Readonly<Record<TerrainTileKind, TilePixelRenderer>> = {
  cutout: renderCutout,
  glass: renderGlass,
  lava: renderLava,
  leaves: renderLeaves,
  solid: renderSolid,
  water: renderWater,
}

/**
 * Every tile carries a compact binary marker derived from its index (`markerFor`),
 * while mapped translucent materials (water/lava/leaves/glass) use recognisable,
 * materially distinct palettes instead.
 */
const tilePixel = (kind: TerrainTileKind, context: TilePixelContext): TilePixelRgba => {
  const noise = noiseFor(context)
  const marker = markerFor(context)
  return TILE_PIXEL_RENDERERS[kind](context, noise, marker)
}

/** The step every atlas-generation loop below advances by. */
const LOOP_STEP = 1

/**
 * Generate the complete 16x16 terrain atlas as deterministic pixel-art RGBA.
 * Every tile carries a compact binary marker derived from its index, while
 * mapped translucent materials use recognisable, materially distinct palettes.
 */
export const generateTerrainAtlas = (): RgbaAtlas => {
  const data = new Uint8ClampedArray(ATLAS_PIXELS * ATLAS_PIXELS * RGBA_STRIDE)

  for (let tile = 0; tile < ATLAS_TILE_COUNT; tile += LOOP_STEP) {
    const originX = tileColumn(tile) * TILE_PIXELS
    const originY = tileRow(tile) * TILE_PIXELS
    const kind = terrainTileKind(tile)

    for (let pixelY = 0; pixelY < TILE_PIXELS; pixelY += LOOP_STEP) {
      for (let pixelX = 0; pixelX < TILE_PIXELS; pixelX += LOOP_STEP) {
        const [red, green, blue, alpha] = tilePixel(kind, { pixelX, pixelY, tile })
        writePixel(data, { alpha, blue, green, pixelX: originX + pixelX, pixelY: originY + pixelY, red })
      }
    }
  }

  return { data, height: ATLAS_PIXELS, width: ATLAS_PIXELS }
}

/** `0.5` texels, the fraction `HALF_TEXEL_UV` converts to UV units. */
const HALF_TEXEL_FRACTION = 0.5

/**
 * Half of one texel, in UV units.
 *
 * The inset applied to every side of every tile rectangle. See the header for
 * why half and not zero, and not one.
 */
export const HALF_TEXEL_UV = HALF_TEXEL_FRACTION / ATLAS_PIXELS

/** The full UV range's top edge, and — separately — one whole tile's worth of the range. */
const UV_UNIT = 1

/** One tile's edge in UV units, WITHOUT the inset. `1 / 16`. */
export const TILE_UV_PITCH = UV_UNIT / ATLAS_COLUMNS

/** The inset is applied on both sides of a tile: this is that count. */
const TEXEL_INSET_SIDES = 2

/**
 * One tile's usable edge in UV units, WITH the inset on both sides.
 *
 * This, and not `TILE_UV_PITCH`, is the width a quad anchored at an inset origin
 * may span. The reference uses `TILE_UV_PITCH` for the particle quad and
 * `TILE_UV_PITCH` minus the inset for chunk faces; see the header.
 */
export const TILE_UV_SPAN = TILE_UV_PITCH - TEXEL_INSET_SIDES * HALF_TEXEL_UV

/** A rectangle in UV space. `u0 < u1` and `v0 < v1` for every tile. */
export type TileUvBounds = {
  readonly u0: number
  readonly v0: number
  readonly u1: number
  readonly v1: number
}

/**
 * A point in UV space. The bottom-left corner of a tile's usable rectangle.
 *
 * `u`/`v` are load-bearing domain vocabulary here (UV texture coordinates) and
 * are destructured by name in `src/domain/particle-pool.ts`, an out-of-scope
 * file this change must not touch — left as `id-length` exceptions.
 */
export type UvOrigin = {
  readonly u: number
  readonly v: number
}

/** One tile over: the offset from a tile's own column/row to the next one's. */
const NEXT_TILE_OFFSET = 1

/**
 * The inset UV rectangle of one tile.
 *
 * Transcribed from `getTileUVs` (block-texture-map.ts:14-26), including the V
 * flip and the half-texel inset on all four sides.
 */
export const tileUvBounds = (tileIndex: number): TileUvBounds => {
  const column = tileColumn(tileIndex)
  const row = tileRow(tileIndex)

  return {
    u0: column / ATLAS_COLUMNS + HALF_TEXEL_UV,
    u1: (column + NEXT_TILE_OFFSET) / ATLAS_COLUMNS - HALF_TEXEL_UV,
    v0: UV_UNIT - (row + NEXT_TILE_OFFSET) / ATLAS_COLUMNS + HALF_TEXEL_UV,
    v1: UV_UNIT - row / ATLAS_COLUMNS - HALF_TEXEL_UV,
  }
}

/**
 * The bottom-left corner of a tile's inset rectangle.
 *
 * What an instanced quad adds to its own `[0, TILE_UV_SPAN]` UVs to land on this
 * tile. `domain/particle-pool.ts` stores one of these per live particle; it is
 * the reference's `getParticleUvOffset` (particle-system-factory.ts:57-64) with
 * the block-id lookup removed, because the block vocabulary is mc-worldgen's and
 * a copy of its tile table here would be a second source of truth for it.
 */
export const tileUvOrigin = (tileIndex: number): UvOrigin => {
  const bounds = tileUvBounds(tileIndex)
  return { u: bounds.u0, v: bounds.v0 }
}

/** The smallest UV span `uvPatchStaysInsideTile` accepts. */
const MIN_UV_SPAN = 0

/**
 * True when a quad of UV width `span`, anchored at a tile's inset origin, stays
 * inside that tile.
 *
 * THE PREDICATE THE HEADER'S DERIVATION IS ABOUT. It is written against the
 * inset origin because that is what `tileUvOrigin` hands out: the near edge is
 * already half a texel in, so the far edge may travel at most
 * `TILE_UV_PITCH - 2 * HALF_TEXEL_UV` before it crosses the boundary.
 *
 * A tolerance is not used and is not wanted. The two candidate spans differ by a
 * whole texel, which is four hundred times the floating-point error in this
 * arithmetic, so an exact comparison separates them with room to spare and does
 * not quietly accept a span that is wrong by a little.
 */
export const uvPatchStaysInsideTile = (span: number): boolean =>
  Number.isFinite(span) && span >= MIN_UV_SPAN && span <= TILE_UV_SPAN

/** `tileIndexForUvOrigin`'s result when no tile matches. */
const TILE_NOT_FOUND = -1

/**
 * The tile whose inset origin is `origin`, or -1 when no tile has that origin.
 *
 * The INVERSE of `tileUvOrigin`, and it exists to be round-tripped against it.
 * A V flip written the wrong way round is still a bijection from tiles to UVs,
 * so it passes every test that only checks one direction; it stops being a
 * bijection back onto the ROW it came from, which is what this catches.
 *
 * The comparison is by nearest column and row rather than by float equality,
 * because a caller reconstructing an origin from a shader uniform will not hand
 * back the identical double. Rounding to the nearest tile and then checking the
 * result actually maps back is exact where it needs to be and forgiving where it
 * cannot be.
 */
export const tileIndexForUvOrigin = (origin: UvOrigin): number => {
  if (!Number.isFinite(origin.u) || !Number.isFinite(origin.v)) {
    return TILE_NOT_FOUND
  }

  const column = Math.round((origin.u - HALF_TEXEL_UV) * ATLAS_COLUMNS)
  const rowFromBottom = Math.round((origin.v - HALF_TEXEL_UV) * ATLAS_COLUMNS)
  const row = ATLAS_COLUMNS - NEXT_TILE_OFFSET - rowFromBottom

  if (column < MIN_TILE_INDEX || column >= ATLAS_COLUMNS || row < MIN_TILE_INDEX || row >= ATLAS_COLUMNS) {
    return TILE_NOT_FOUND
  }

  return row * ATLAS_COLUMNS + column
}

/**
 * What is wrong with the atlas layout constants, if anything.
 *
 * Empty in a healthy repository. It exists because the four constants above are
 * transcribed rather than derived, and transcription is where a digit goes
 * missing — a `512` that became `1024` while `ATLAS_COLUMNS` stayed at 16 leaves
 * every UV still inside `[0, 1]` and every test that only checks ranges still
 * green, while every tile boundary lands half a texel off.
 *
 * Returned as a list rather than thrown, so `test/texture-atlas.test.ts` can
 * assert the list is empty and a future adapter can log all of them at once
 * instead of one per restart.
 */
export const atlasLayoutViolations = (): ReadonlyArray<string> => {
  const violations: Array<string> = []

  if (!Number.isInteger(TILE_PIXELS)) {
    violations.push(
      `ATLAS_PIXELS ${String(ATLAS_PIXELS)} / ATLAS_COLUMNS ${String(ATLAS_COLUMNS)} is ` +
        `${String(TILE_PIXELS)}, not a whole number of pixels, so tile boundaries land mid-texel.`,
    )
  }

  if (HALF_TEXEL_UV * TEXEL_INSET_SIDES * ATLAS_COLUMNS >= TILE_UV_PITCH * ATLAS_COLUMNS) {
    violations.push(
      'the half-texel inset consumes a whole tile: HALF_TEXEL_UV is not derived from ATLAS_PIXELS.',
    )
  }

  if (TILE_UV_SPAN <= MIN_UV_SPAN) {
    violations.push('TILE_UV_SPAN is not positive, so no quad can sample a tile at all.')
  }

  return violations
}
