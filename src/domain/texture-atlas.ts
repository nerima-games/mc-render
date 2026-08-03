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

const CUTOUT_TILES = new Set([45, 85, 87, 100, 103, 104, 106, 107, 108, 109, 110, 111, 112, 115, 121, 125, 127, 149])

/** The material treatment for a mapped tile. Values align with block-texture-map.ts. */
export const terrainTileKind = (tileIndex: number): TerrainTileKind => {
  switch (normaliseTileIndex(tileIndex)) {
    case 7:
    case 122:
      return 'water'
    case 18:
      return 'lava'
    case 8:
      return 'leaves'
    case 9:
      return 'glass'
    default:
      return CUTOUT_TILES.has(normaliseTileIndex(tileIndex)) ? 'cutout' : 'solid'
  }
}

const channel = (tile: number, multiplier: number): number => 48 + ((tile * multiplier) % 160)

const writePixel = (
  data: Uint8ClampedArray,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void => {
  const offset = (y * ATLAS_PIXELS + x) * 4
  data[offset] = red
  data[offset + 1] = green
  data[offset + 2] = blue
  data[offset + 3] = alpha
}

const tilePixel = (
  tile: number,
  kind: TerrainTileKind,
  x: number,
  y: number,
): readonly [number, number, number, number] => {
  const noise = (tile * 37 + Math.floor(x / 4) * 17 + Math.floor(y / 4) * 29) & 31
  const marker = y < 4 && x < 16 && ((tile >> Math.floor(x / 2)) & 1) === 1

  if (kind === 'water') return [20 + noise, 92 + noise, 178 + noise, 176]
  if (kind === 'lava') return [224 + (noise & 15), 54 + noise * 2, noise >> 1, 255]
  if (kind === 'leaves') return [32 + noise, 104 + noise * 2, 38 + noise, (x + y + tile) % 7 === 0 ? 0 : 255]
  if (kind === 'glass') {
    const edge = x < 3 || y < 3 || x >= TILE_PIXELS - 3 || y >= TILE_PIXELS - 3
    return [marker ? 245 : 150 + noise, 220 + (noise >> 1), 230 + (noise >> 1), edge ? 144 : 48]
  }

  const alpha = kind === 'cutout' && (x * 3 + y * 5 + tile) % 11 < 3 ? 0 : 255
  const shade = marker ? 42 : noise - 16
  return [channel(tile, 73) + shade, channel(tile, 151) + shade, channel(tile, 199) + shade, alpha]
}

/**
 * Generate the complete 16x16 terrain atlas as deterministic pixel-art RGBA.
 * Every tile carries a compact binary marker derived from its index, while
 * mapped translucent materials use recognisable, materially distinct palettes.
 */
export const generateTerrainAtlas = (): RgbaAtlas => {
  const data = new Uint8ClampedArray(ATLAS_PIXELS * ATLAS_PIXELS * 4)

  for (let tile = 0; tile < ATLAS_TILE_COUNT; tile += 1) {
    const originX = tileColumn(tile) * TILE_PIXELS
    const originY = tileRow(tile) * TILE_PIXELS
    const kind = terrainTileKind(tile)

    for (let y = 0; y < TILE_PIXELS; y += 1) {
      for (let x = 0; x < TILE_PIXELS; x += 1) {
        writePixel(data, originX + x, originY + y, ...tilePixel(tile, kind, x, y))
      }
    }
  }

  return { width: ATLAS_PIXELS, height: ATLAS_PIXELS, data }
}

/**
 * Half of one texel, in UV units.
 *
 * The inset applied to every side of every tile rectangle. See the header for
 * why half and not zero, and not one.
 */
export const HALF_TEXEL_UV = 0.5 / ATLAS_PIXELS

/** One tile's edge in UV units, WITHOUT the inset. `1 / 16`. */
export const TILE_UV_PITCH = 1 / ATLAS_COLUMNS

/**
 * One tile's usable edge in UV units, WITH the inset on both sides.
 *
 * This, and not `TILE_UV_PITCH`, is the width a quad anchored at an inset origin
 * may span. The reference uses `TILE_UV_PITCH` for the particle quad and
 * `TILE_UV_PITCH` minus the inset for chunk faces; see the header.
 */
export const TILE_UV_SPAN = TILE_UV_PITCH - 2 * HALF_TEXEL_UV

/** A rectangle in UV space. `u0 < u1` and `v0 < v1` for every tile. */
export type TileUvBounds = {
  readonly u0: number
  readonly v0: number
  readonly u1: number
  readonly v1: number
}

/** A point in UV space. The bottom-left corner of a tile's usable rectangle. */
export type UvOrigin = {
  readonly u: number
  readonly v: number
}

/**
 * True when `tileIndex` names a tile the atlas actually has.
 *
 * TOTAL, and it takes a `number` rather than a branded index because its whole
 * job is to be the thing that decides. A non-integer, a negative and a NaN are
 * all "not a tile", and they arrive from block ids that this repository does not
 * own — mc-worldgen does.
 */
export const isTileIndex = (tileIndex: number): boolean =>
  Number.isInteger(tileIndex) && tileIndex >= 0 && tileIndex < ATLAS_TILE_COUNT

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
export const normaliseTileIndex = (tileIndex: number): number =>
  isTileIndex(tileIndex) ? tileIndex : 0

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
    v0: 1 - (row + 1) / ATLAS_COLUMNS + HALF_TEXEL_UV,
    u1: (column + 1) / ATLAS_COLUMNS - HALF_TEXEL_UV,
    v1: 1 - row / ATLAS_COLUMNS - HALF_TEXEL_UV,
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
  Number.isFinite(span) && span >= 0 && span <= TILE_UV_SPAN

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
    return -1
  }

  const column = Math.round((origin.u - HALF_TEXEL_UV) * ATLAS_COLUMNS)
  const rowFromBottom = Math.round((origin.v - HALF_TEXEL_UV) * ATLAS_COLUMNS)
  const row = ATLAS_COLUMNS - 1 - rowFromBottom

  if (column < 0 || column >= ATLAS_COLUMNS || row < 0 || row >= ATLAS_COLUMNS) {
    return -1
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

  if (HALF_TEXEL_UV * 2 * ATLAS_COLUMNS >= TILE_UV_PITCH * ATLAS_COLUMNS) {
    violations.push(
      'the half-texel inset consumes a whole tile: HALF_TEXEL_UV is not derived from ATLAS_PIXELS.',
    )
  }

  if (TILE_UV_SPAN <= 0) {
    violations.push('TILE_UV_SPAN is not positive, so no quad can sample a tile at all.')
  }

  return violations
}
