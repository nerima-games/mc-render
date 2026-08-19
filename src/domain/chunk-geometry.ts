/**
 * Converts `@nerima-games/mc-meshing` output into renderer-owned typed-array buffers.
 *
 * Geometry stays independent of Three.js and DOM state. The dependency owns
 * voxel identities and meshing output; this module owns GPU-buffer layout.
 */
import {
  AO_LEVELS,
  AO_MAX,
  AO_NONE,
  type CrossPlantQuad as MeshingCrossPlantQuad,
  type FaceDirection as MeshingFaceDirection,
  type FaceRole as MeshingFaceRole,
  type FluidQuad as MeshingFluidQuad,
  type Quad as MeshingQuad,
  type QuadAxis as MeshingQuadAxis,
  faceOf,
  tangentAxes,
} from '@nerima-games/mc-meshing'

/** Shared face vocabulary, consumed directly from mc-meshing. */
export type FaceDirection = MeshingFaceDirection
export type FaceRole = MeshingFaceRole

/** One of the three chunk-local axes used by quad extents. */
export type QuadAxis = MeshingQuadAxis

/** Direct aliases keep geometry aligned with the published meshing output. */
export type MeshQuad = MeshingQuad
export type FluidQuad = MeshingFluidQuad
export type CrossPlantQuad = MeshingCrossPlantQuad
export type RenderableQuad = MeshQuad | CrossPlantQuad | FluidQuad

/** Use mc-meshing's canonical width/height axis convention directly. */
export { tangentAxes }

/** Vertices and indices per quad. Two triangles, four shared corners. */
export const VERTICES_PER_QUAD = 4
export const INDICES_PER_QUAD = 6

/** Components per vertex, per attribute. */
export const POSITION_COMPONENTS = 3
export const NORMAL_COMPONENTS = 3
export const COLOR_COMPONENTS = 3
export const UV_COMPONENTS = 2
/**
 * One `float` per vertex, because `./chunk-shader.ts` declares
 * `attribute float tileIndex` and a `vec` would not link against it.
 *
 * A whole number in a `Float32Array` and not a `Uint16Array`, which is the
 * shader's constraint rather than a preference: GLSL ES 1.00 has no integer
 * attributes, so the value crosses as a float and the fragment stage rounds it
 * back with `floor(vTileIndex + 0.5)`. Float32 carries every integer up to
 * 2^24 exactly, and the atlas has 256 tiles.
 */
export const TILE_INDEX_COMPONENTS = 1
export const FLUID_DIRECTION_COMPONENTS = 2
export const FLUID_FALLING_COMPONENTS = 1


/**
 * How dark each AO level draws, as an 8-bit vertex-colour channel.
 *
 * TRANSCRIBED from ts-minecraft
 * `packages/rendering/infrastructure/meshing/greedy-meshing-accumulator.ts:10`
 * (`const AO_COLOR_BY_LEVEL = [255, 204, 153, 102] as const`), which is level
 * 0 (unoccluded) through level 3 (most occluded) in steps of 51/255 = 0.2.
 *
 * THE VALUES ARE TRANSCRIBED; THE EFFECT IS NOT THE REFERENCE'S, and the
 * difference is stated here rather than discovered later. The reference feeds
 * this into a custom fragment shader that combines it as
 * `diffuse *= (0.45 + 0.55*light) * (0.8 + 0.2*R)` (:135), so its AO spans a
 * 20% range. The production chunk path now applies that curve in
 * `./chunk-shader.ts`, while the base renderer still accepts `MeshBasicMaterial`
 * as an intentionally unlit fallback. In that fallback,
 * `vertexColors` multiplies the base colour by the vertex colour directly, so
 * the same table spans 100% down to 40%. Geometry does not rewrite the table to
 * compensate for a material; the material owns the final interpretation.
 */
/** 8-bit shade for AO level 0: fully unoccluded. */
const AO_LEVEL_0_SHADE = 255
/** 8-bit shade for AO level 1. */
const AO_LEVEL_1_SHADE = 204
/** 8-bit shade for AO level 2. */
const AO_LEVEL_2_SHADE = 153
/** 8-bit shade for AO level 3: the most occluded level. Equal to `AO_DARKEST`. */
const AO_LEVEL_3_SHADE = 102

export const AO_SHADE_BY_LEVEL: ReadonlyArray<number> = [
  AO_LEVEL_0_SHADE,
  AO_LEVEL_1_SHADE,
  AO_LEVEL_2_SHADE,
  AO_LEVEL_3_SHADE,
]

/** Keep the renderer's public AO vocabulary sourced from mc-meshing. */
export { AO_LEVELS, AO_MAX }

/** The lowest AO level: fully unoccluded. The floor `aoShade` clamps to. */
const AO_MIN_LEVEL = AO_NONE

/** The shade of the most occluded level. See `aoShade` on why it is a fallback. */
const AO_DARKEST = AO_LEVEL_3_SHADE

/**
 * The shade for a level, saturating at both ends.
 *
 * Saturating rather than throwing, and that is the boundary rule this whole
 * repository already uses for numbers it cannot name (`mouseButtonForIndex`,
 * `wheelDeltaModeForIndex` in `domain/input-bindings.ts`): a quad carrying an
 * out-of-range `ao` is a mesher bug, and a renderer that throws on it takes the
 * whole frame down for a shading error. It draws the nearest legal shade
 * instead, which is visibly wrong in the right place.
 */
export const aoShade = (level: number): number => {
  const clamped = Math.min(Math.max(Math.trunc(level), AO_MIN_LEVEL), AO_MAX)
  /* `?? AO_DARKEST` is unreachable: `clamped` is in `[0, AO_MAX]` by the line
     above and `AO_MAX` is derived from this array's own length, so the read
     cannot miss. `noUncheckedIndexedAccess` types it `number | undefined`
     regardless, and the fallback is the DARKEST shade rather than 0 or 255 so
     that if the impossible ever happens it degrades to "fully occluded" — the
     conservative direction for something whose only job is to darken. */
  return AO_SHADE_BY_LEVEL[clamped] ?? AO_DARKEST
}

/** One corner of a quad, in world coordinates. */
export type QuadVertex = readonly [number, number, number]

/** The four corners of a quad, in winding order. */
export type QuadCorners = readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]

/** The unit normal of a face direction. */
export const faceNormal = (direction: FaceDirection): QuadVertex => {
  const { nx, ny, nz } = faceOf(direction)
  return [nx, ny, nz]
}

/**
 * The four corners of a quad, in world coordinates and in winding order.
 *
 * TRANSCRIBED, one direction at a time, from ts-minecraft
 * `packages/rendering/infrastructure/meshing/greedy-meshing-algorithms.ts`:
 * `meshXPosFace` :24-31, `meshXNegFace` :63-70, `meshYPosFace` :102-109,
 * `meshYNegFace` :141-148, `meshZPosFace` :180-187, `meshZNegFace` :219-226.
 *
 * With ONE change applied throughout, which the header states and which is the
 * only thing here that is not a copy: the reference's `(du, dv)` are its own
 * scan axes, and for the four x- and z-facing passes they are not
 * `(width, height)` under `tangentAxes`. Specifically
 *
 *   xPos / xNeg : reference u = z, v = y   -> du = height, dv = width
 *   yPos / yNeg : reference u = x, v = z   -> du = width,  dv = height
 *   zPos / zNeg : reference u = x, v = y   -> du = width,  dv = height
 *
 * so the two x directions swap and the other four do not. Getting that wrong
 * transposes every merged side face and nothing else — the count, the winding
 * and the normals all stay correct, which is why the test measures the emitted
 * EXTENT per axis instead of comparing against a re-spelling of this table.
 *
 * The winding is counter-clockwise seen from outside the face, which is what
 * makes `side: FrontSide` — three's default, and `domain/material-policy.ts`'s
 * `'front'` — cull the back of the world rather than the front of it.
 */
/**
 * One whole block: the offset from a face's minimum corner to its maximum one
 * along the face's own normal axis.
 */
const BLOCK_UNIT = 1

/** One step forward through an index- or vertex-counting loop. */
const LOOP_STEP = 1

/** A face's minimum corner and extents: what every direction's corner builder needs. */
type QuadFaceOrigin = {
  readonly x0: number
  readonly y0: number
  readonly z0: number
  readonly width: number
  readonly height: number
}

/**
 * One corner builder per direction, keyed so `quadCorners` is a lookup and not
 * a fourteen-statement switch — the split this file's `tangentAxes` already
 * makes for the same reason: a table a reader and a writer can each check
 * independently, direction by direction.
 */
const CORNER_BUILDERS: Readonly<Record<FaceDirection, (origin: QuadFaceOrigin) => QuadCorners>> = {
  xNeg: ({ x0, y0, z0, width, height }) => [
    [x0, y0, z0 + height],
    [x0, y0 + width, z0 + height],
    [x0, y0 + width, z0],
    [x0, y0, z0],
  ],
  xPos: ({ x0, y0, z0, width, height }) => {
    const faceX = x0 + BLOCK_UNIT
    return [
      [faceX, y0, z0],
      [faceX, y0 + width, z0],
      [faceX, y0 + width, z0 + height],
      [faceX, y0, z0 + height],
    ]
  },
  yNeg: ({ x0, y0, z0, width, height }) => [
    [x0 + width, y0, z0],
    [x0 + width, y0, z0 + height],
    [x0, y0, z0 + height],
    [x0, y0, z0],
  ],
  yPos: ({ x0, y0, z0, width, height }) => {
    const faceY = y0 + BLOCK_UNIT
    return [
      [x0, faceY, z0],
      [x0, faceY, z0 + height],
      [x0 + width, faceY, z0 + height],
      [x0 + width, faceY, z0],
    ]
  },
  zNeg: ({ x0, y0, z0, width, height }) => [
    [x0, y0, z0],
    [x0, y0 + height, z0],
    [x0 + width, y0 + height, z0],
    [x0 + width, y0, z0],
  ],
  zPos: ({ x0, y0, z0, width, height }) => {
    const faceZ = z0 + BLOCK_UNIT
    return [
      [x0 + width, y0, faceZ],
      [x0 + width, y0 + height, faceZ],
      [x0, y0 + height, faceZ],
      [x0, y0, faceZ],
    ]
  },
}

export const quadCorners = (quad: MeshQuad, originX: number, originZ: number): QuadCorners => {
  const x0 = originX + quad.lx
  const y0 = quad.y
  const z0 = originZ + quad.lz
  const { width, height } = quad
  return CORNER_BUILDERS[quad.direction]({ height, width, x0, y0, z0 })
}

/**
 * The `(u, v)` extents of a quad, in BLOCK units, in the reference's scan order.
 *
 * The reference's UVs are local block-tile coordinates and not atlas ones —
 * `greedy-meshing-accumulator.ts:153-161`, whose comment says why: "Greedy
 * meshing may merge a 16x16 grass surface into one quad; keeping UVs in block
 * units lets the shader repeat the selected atlas tile once per block instead of
 * stretching one texel tile across the whole merged face."
 *
 * So a merged quad's UVs run 0..du and 0..dv, NOT 0..1, and this function is
 * where the transposition described on `quadCorners` shows up in the second
 * attribute. Emitting `(width, height)` unswapped would tile the two x-facing
 * directions the wrong way round — visible only once a texture is bound, which
 * is precisely the kind of defect that lands months after the change.
 */
export const quadUvExtent = (quad: MeshQuad): readonly [number, number] => {
  switch (quad.direction) {
    case 'xPos':
    case 'xNeg':
      return [quad.height, quad.width]
    default:
      return [quad.width, quad.height]
  }
}

/**
 * The five arrays a chunk's `BufferGeometry` is assembled from, plus the counts.
 *
 * OWNED AND EXACTLY SIZED, never a view into a shared accumulator. mc-meshing's
 * `domain/mesh.ts` header records the same decision on its own output and the
 * hazard it avoids: the reference returns zero-copy subarray views that the next
 * call invalidates. The pooled, capacity-doubling fast path
 * (`greedy-meshing-accumulator.ts:39-97`) is the optimisation to add when there
 * is a benchmark that asks for it, and adding it first would be a pool nobody
 * has measured guarding an allocation nobody has measured.
 */
export type ChunkGeometryBuffers = {
  /** `x, y, z` per vertex, in WORLD coordinates. */
  readonly positions: Float32Array
  /** The face normal, repeated for all four vertices of a quad. */
  readonly normals: Float32Array
  /**
   * `r, g, b` per vertex, 0-255, uploaded with `normalized: true`.
   *
   * All three channels carry the SAME AO shade, and that is a statement about
   * what does not exist yet rather than a colour choice. The reference packs
   * `R = AO, G = sky light, B = block light`
   * (`greedy-meshing-accumulator.ts:131-134`); there is no light grid to read —
   * mc-meshing's `domain/ambient-occlusion.ts` says explicitly that the
   * light-sampling half of the reference's AO file is NOT ported, because
   * docs/responsibility.md §3 gives the light grid to mc-worldgen and there is
   * nothing yet to read. Writing AO into all three channels renders as a grey
   * multiplier, which is what an unlit material with no texture can honestly
   * show; the two other channels become sky and block light unchanged when a
   * grid arrives.
   */
  readonly colors: Uint8Array
  /** Local block-tile coordinates, not atlas coordinates. See `quadUvExtent`. */
  readonly uvs: Float32Array
  /**
   * Which atlas tile each vertex draws, repeated for all four of a quad's.
   *
   * PRESENT UNCONDITIONALLY, including on the path that will never sample an
   * atlas, and that is the same argument `QuadColor` above makes for its three
   * channels: the layout is identical either way, so one builder serves both
   * without a `textured: boolean` threaded through every caller.
   *
   * IT IS ALSO THE ATTRIBUTE WHOSE ABSENCE COULD NOT HAVE BEEN SEEN. Before it
   * existed, `./chunk-shader.ts` declared `attribute float tileIndex` and this
   * builder emitted four arrays; both files' suites were green, because each
   * fixed its own half and nothing compared them. An unbound GL attribute reads
   * as 0, so the whole world would have sampled tile 0 — a real texture on every
   * surface, which is `docs/`'s recorded worst case: it looks like a mistake in
   * the atlas rather than a missing buffer. `test/chunk-shader-geometry.test.ts`
   * is now the comparison, and it reads the attribute names from
   * `chunkShaderSource()` rather than restating them.
   */
  readonly tileIndices: Float32Array
  /** Horizontal animation direction; zero for solids and still fluids. */
  readonly fluidDirections: Float32Array
  /** One for falling fluid faces, zero otherwise. */
  readonly fluidFalling: Float32Array
  /** Two triangles per quad: `(0,1,2)` and `(0,2,3)`. */
  readonly indices: Uint32Array
  readonly quadCount: number
  readonly vertexCount: number
  readonly indexCount: number
}

/** The length of an allocation that holds nothing. */
const EMPTY_LENGTH = 0

/** The count for a geometry that covers no quads, vertices or indices. */
const EMPTY_COUNT = 0

/** The buffers for a chunk with no visible faces. Allocation-free. */
const EMPTY_BUFFERS: ChunkGeometryBuffers = {
  colors: new Uint8Array(EMPTY_LENGTH),
  fluidDirections: new Float32Array(EMPTY_LENGTH),
  fluidFalling: new Float32Array(EMPTY_LENGTH),
  indexCount: EMPTY_COUNT,
  indices: new Uint32Array(EMPTY_LENGTH),
  normals: new Float32Array(EMPTY_LENGTH),
  positions: new Float32Array(EMPTY_LENGTH),
  quadCount: EMPTY_COUNT,
  tileIndices: new Float32Array(EMPTY_LENGTH),
  uvs: new Float32Array(EMPTY_LENGTH),
  vertexCount: EMPTY_COUNT,
}

/**
 * How a quad becomes the 0-255 grey its four vertices are shaded with.
 *
 * AN INJECTED PREDICATE, which is this project's settled answer to "who owns
 * this rule" — the same shape as `transparentBlockIds`, `IsRailAt` and
 * `BlockAt`, each of which resolved an ownership dispute by having the owner
 * answer a question instead of the consumer importing a table.
 *
 * The dispute here is the one `AO_SHADE_BY_LEVEL` above states and declines to
 * settle: this builder must not decide how bright a surface is, because that is
 * a material's job and the material does not exist yet. Handing it a function
 * keeps the decision outside — `./voxel-lighting.ts` holds the curve, a host
 * supplies the light readings, and this file multiplies nothing.
 */
export type QuadShade = (quad: RenderableQuad) => number

/**
 * The three colour channels of a quad's vertices, 0-255 each.
 *
 * THREE CHANNELS AND NOT ONE, because the two paths this repository has to
 * support disagree about what a channel means and agree about the layout:
 *
 *   FALLBACK MATERIAL — `MeshBasicMaterial` multiplies the vertex colour
 *   directly, so the only honest output is a GREY: one number, written three
 *   times. The base renderer keeps this path for unlit callers.
 *
 *   WITH A SHADER — the reference packs `R = AO, G = sky, B = block` and lets
 *   the fragment stage combine them, so the three channels carry three
 *   different quantities. `./chunk-shader.ts` is that decode.
 *
 * A `(quad) => number` hook could express the first and not the second, and
 * the buffer layout is identical either way — which is what lets one builder
 * serve both without a `packed: boolean` that would have to be threaded
 * through every caller. `greyChannels` below is the adapter for the first.
 */
export type QuadColor = (quad: RenderableQuad) => readonly [number, number, number]

/** One value in all three channels: the grey an unlit material can show. */
export const greyChannels = (shade: number): readonly [number, number, number] => [shade, shade, shade]

/** Lift a single-value shading function into a `QuadColor`. */
export const greyQuadColor =
  (shade: QuadShade): QuadColor =>
  (quad) =>
    greyChannels(shade(quad))

/**
 * The default: ambient occlusion only, which is what this file did before a
 * light grid was reachable.
 *
 * IT IS THE DEFAULT SO THAT ADDING LIGHTING CHANGED NO EXISTING PIXEL. Every
 * caller that does not pass a colour function gets exactly the previous output,
 * byte for byte, and `test/chunk-geometry.test.ts`'s AO assertions are
 * unmodified — which is what makes them evidence about the light change rather
 * than a casualty of it.
 */
export const AO_ONLY_SHADE: QuadShade = (quad) => aoShade(quad.ao)

/** `AO_ONLY_SHADE` as a `QuadColor`. The builder's default. */
export const AO_ONLY_COLOR: QuadColor = greyQuadColor(AO_ONLY_SHADE)

/**
 * Which atlas tile a quad draws.
 *
 * THE FOURTH INJECTED PREDICATE, and injected for a sharper reason than the
 * others. `QuadColor` could in principle have been computed here; this one
 * cannot be, because the answer needs `blockId -> name` and the names are
 * mc-kernel's closed 120-literal union. `./block-texture-map.ts`'s
 * `BlockNameLookup` header records why this repository declines to mirror it —
 * the organisation has already paid once for a PARTIAL mirror of a closed union
 * (mc-sim's `ITEM_TYPES` at 23 of 97, invisible until `check:repoint`).
 *
 * So the shape is forced: the host owns the vocabulary and answers a question.
 * `tileIndexResolver` in `./block-texture-map.ts` is the binding, and
 * `quadTileFromResolver` there is the adapter into this type — it lives in that
 * file and not this one because the dependency runs that way already
 * (`block-texture-map.ts` imports `FaceRole` from here) and the reverse would
 * close a cycle.
 */
export type QuadTile = (quad: RenderableQuad) => number

/** The tile index every quad draws when no atlas is bound. See `UNTEXTURED_TILE`. */
const UNTEXTURED_TILE_INDEX = 0

/**
 * The default: every quad draws tile 0.
 *
 * NAMED FOR WHAT IT IS RATHER THAN SPELLED `() => 0`, because the two readings
 * of a zero here are not the same claim and one of them is a bug. This is "no
 * atlas is bound, and the unlit path does not sample one" — honest, and what
 * every existing caller and preview is in. The other reading is "the tile
 * lookup ran and found nothing", which is `MISSING_TILE` in
 * `./block-texture-map.ts` and happens to be the same number.
 *
 * A host on the textured path that forgets to pass a resolver therefore gets a
 * uniform world rather than a plausible-looking wrong one, and `UNTEXTURED_TILE`
 * is greppable in a way `0` is not.
 */
export const UNTEXTURED_TILE: QuadTile = () => UNTEXTURED_TILE_INDEX

/** Default chunk-local origin: a caller that does not offset the mesh. */
const DEFAULT_CHUNK_ORIGIN = 0

/** The quad, vertex or index count of an empty input. */
const EMPTY_QUAD_COUNT = 0

/** Offsets of the y and z components within a 3-component position or normal write; x is the base offset. */
const Y_COMPONENT_OFFSET = 1
const Z_COMPONENT_OFFSET = 2

/** Offsets of the green and blue channels within a 3-component colour write; red is the base offset. */
const GREEN_CHANNEL_OFFSET = 1
const BLUE_CHANNEL_OFFSET = 2

/** The offset of the second value in a 2-component pair write: a flow direction's z, or a UV's v. */
const PAIR_SECOND_OFFSET = 1

/** Slot offsets within a quad's 8-value UV block: two components per corner. */
const CORNER_0_U_OFFSET = 0
const CORNER_0_V_OFFSET = 1
const CORNER_1_U_OFFSET = 2
const CORNER_1_V_OFFSET = 3
const CORNER_2_U_OFFSET = 4
const CORNER_2_V_OFFSET = 5
const CORNER_3_U_OFFSET = 6
const CORNER_3_V_OFFSET = 7

/** The `u` and `v` coordinate at a quad's own origin corner. */
const UV_ORIGIN = 0

/** A quad's second, third and fourth vertices, by position within its 4-vertex block. */
const VERTEX_1 = 1
const VERTEX_2 = 2
const VERTEX_3 = 3

/** Index-buffer slot offsets for a quad's six indices: two triangles, three each. */
const INDEX_SLOT_1 = 1
const INDEX_SLOT_2 = 2
const INDEX_SLOT_3 = 3
const INDEX_SLOT_4 = 4
const INDEX_SLOT_5 = 5

type ChunkWriteBuffers = {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Uint8Array
  readonly uvs: Float32Array
  readonly tileIndices: Float32Array
  readonly fluidDirections: Float32Array
  readonly fluidFalling: Float32Array
  readonly indices: Uint32Array
}

const allocateChunkWriteBuffers = (vertexCount: number, indexCount: number): ChunkWriteBuffers => ({
  colors: new Uint8Array(vertexCount * COLOR_COMPONENTS),
  fluidDirections: new Float32Array(vertexCount * FLUID_DIRECTION_COMPONENTS),
  fluidFalling: new Float32Array(vertexCount * FLUID_FALLING_COMPONENTS),
  indices: new Uint32Array(indexCount),
  normals: new Float32Array(vertexCount * NORMAL_COMPONENTS),
  positions: new Float32Array(vertexCount * POSITION_COMPONENTS),
  tileIndices: new Float32Array(vertexCount * TILE_INDEX_COMPONENTS),
  uvs: new Float32Array(vertexCount * UV_COMPONENTS),
})

type ChunkBuildContext = {
  readonly buffers: ChunkWriteBuffers
  readonly originX: number
  readonly originZ: number
  readonly color: QuadColor
  readonly tile: QuadTile
}

type QuadAttributes = {
  readonly corners: QuadCorners
  readonly normal: QuadVertex
  readonly color: readonly [number, number, number]
  readonly tileIndex: number
}

type VertexWrite = {
  readonly buffers: ChunkWriteBuffers
  readonly at: number
  readonly tileAt: number
  readonly vertex: QuadVertex
  readonly normal: QuadVertex
  readonly color: readonly [number, number, number]
  readonly tileIndex: number
}

/** Write one vertex's position and normal. Split from colour/tile so each stays a small function. */
const writeVertexPositionAndNormal = (write: VertexWrite): void => {
  const { buffers, at, vertex, normal } = write
  const [vertexX, vertexY, vertexZ] = vertex
  const [normalX, normalY, normalZ] = normal
  buffers.positions[at] = vertexX
  buffers.positions[at + Y_COMPONENT_OFFSET] = vertexY
  buffers.positions[at + Z_COMPONENT_OFFSET] = vertexZ
  buffers.normals[at] = normalX
  buffers.normals[at + Y_COMPONENT_OFFSET] = normalY
  buffers.normals[at + Z_COMPONENT_OFFSET] = normalZ
}

/**
 * Write one vertex's colour and tile index.
 *
 * The same shade and the same tile four times per quad — see `processQuad`'s
 * header on why both are computed once per quad and written once per vertex.
 */
const writeVertexColorAndTile = (write: VertexWrite): void => {
  const { buffers, at, tileAt, color, tileIndex } = write
  const [red, green, blue] = color
  buffers.colors[at] = red
  buffers.colors[at + GREEN_CHANNEL_OFFSET] = green
  buffers.colors[at + BLUE_CHANNEL_OFFSET] = blue
  buffers.tileIndices[tileAt] = tileIndex
}

/**
 * Write a quad's four corners into the position, normal, colour and tile
 * buffers.
 *
 * `for...of` and not an index loop: `QuadCorners` is a fixed four-tuple, and
 * under `noUncheckedIndexedAccess` a numeric index into one reads as
 * `QuadVertex | undefined` while iteration does not. The alternative is four
 * non-null assertions in the hot path.
 */
const writeQuadCorners = (buffers: ChunkWriteBuffers, base: number, attributes: QuadAttributes): void => {
  const { corners, normal, color, tileIndex } = attributes
  let corner = 0
  for (const vertex of corners) {
    const at = (base + corner) * POSITION_COMPONENTS
    const tileAt = (base + corner) * TILE_INDEX_COMPONENTS
    corner += LOOP_STEP
    const write: VertexWrite = { at, buffers, color, normal, tileAt, tileIndex, vertex }
    writeVertexPositionAndNormal(write)
    writeVertexColorAndTile(write)
  }
}

/**
 * Write a quad's UVs: `(0,0), (0,v), (u,v), (u,0)` — the reference's order at
 * `greedy-meshing-accumulator.ts:158-161`, which is the winding order of
 * `quadCorners` and must stay in step with it.
 */
const writeQuadUVs = (uvs: Float32Array, uvOffset: number, extent: readonly [number, number]): void => {
  const [uExtent, vExtent] = extent
  uvs[uvOffset + CORNER_0_U_OFFSET] = UV_ORIGIN
  uvs[uvOffset + CORNER_0_V_OFFSET] = UV_ORIGIN
  uvs[uvOffset + CORNER_1_U_OFFSET] = UV_ORIGIN
  uvs[uvOffset + CORNER_1_V_OFFSET] = vExtent
  uvs[uvOffset + CORNER_2_U_OFFSET] = uExtent
  uvs[uvOffset + CORNER_2_V_OFFSET] = vExtent
  uvs[uvOffset + CORNER_3_U_OFFSET] = uExtent
  uvs[uvOffset + CORNER_3_V_OFFSET] = UV_ORIGIN
}

/** Write a quad's two triangles: `(0,1,2)` and `(0,2,3)`. See `ChunkGeometryBuffers.indices`. */
const writeQuadIndices = (indices: Uint32Array, indexOffset: number, base: number): void => {
  indices[indexOffset] = base
  indices[indexOffset + INDEX_SLOT_1] = base + VERTEX_1
  indices[indexOffset + INDEX_SLOT_2] = base + VERTEX_2
  indices[indexOffset + INDEX_SLOT_3] = base
  indices[indexOffset + INDEX_SLOT_4] = base + VERTEX_2
  indices[indexOffset + INDEX_SLOT_5] = base + VERTEX_3
}

/**
 * Everything one quad contributes to the buffers: corners, colour, UVs, tile
 * and the index triangles.
 *
 * ONE CALL PER QUAD, not per vertex, for `color` and `tile`: the four vertices
 * of a quad share a shade for the reason the header gives for AO — the value
 * joins the merge key, so every cell the quad covers already agreed on it —
 * and a per-vertex call would invite a `shade` implementation that samples
 * four times and quietly quadruples the cost of a re-mesh. Once per quad for
 * the same reason `tile` is: the tile joins the merge key upstream too.
 */
type ProjectedQuad = MeshQuad | FluidQuad

const processQuad = (
  context: ChunkBuildContext,
  source: ProjectedQuad,
  quad: MeshQuad,
  quadIndex: number,
): void => {
  const corners = quadCorners(quad, context.originX, context.originZ)
  const normal = faceNormal(quad.direction)
  const color = context.color(source)
  const [uExtent, vExtent] = quadUvExtent(quad)
  const tileIndex = context.tile(source)
  const base = quadIndex * VERTICES_PER_QUAD
  writeQuadCorners(context.buffers, base, { color, corners, normal, tileIndex })
  writeQuadUVs(context.buffers.uvs, base * UV_COMPONENTS, [uExtent, vExtent])
  writeQuadIndices(context.buffers.indices, quadIndex * INDICES_PER_QUAD, base)
}

const buildProjectedGeometry = <TQuad extends ProjectedQuad>(
  quads: ReadonlyArray<TQuad>,
  project: (quad: TQuad) => MeshQuad,
  originX: number,
  originZ: number,
  color: QuadColor,
  tile: QuadTile,
): ChunkGeometryBuffers => {
  const quadCount = quads.length
  if (quadCount === EMPTY_QUAD_COUNT) {
    return EMPTY_BUFFERS
  }

  const buffers = allocateChunkWriteBuffers(quadCount * VERTICES_PER_QUAD, quadCount * INDICES_PER_QUAD)
  const context: ChunkBuildContext = { buffers, color, originX, originZ, tile }
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex += LOOP_STEP) {
    const quad = quads[quadIndex]
    if (quad) {
      processQuad(context, quad, project(quad), quadIndex)
    }
  }

  return {
    ...buffers,
    indexCount: quadCount * INDICES_PER_QUAD,
    quadCount,
    vertexCount: quadCount * VERTICES_PER_QUAD,
  }
}

/**
 * Build the vertex buffers for one chunk's worth of quads.
 *
 * `originX`/`originZ` are the chunk's world-space corner; mc-meshing emits
 * chunk-local positions and says "mc-render applies the offset"
 * (`mc-meshing/domain/mesh.ts:143`). There is no `originY` because there is no
 * vertical chunking: `CHUNK_HEIGHT` is the whole column.
 *
 * `shade` decides the vertex grey and defaults to `AO_ONLY_SHADE`. See
 * `QuadShade` on why it is a parameter rather than a branch on "is there a
 * light grid": `application/world-renderer.ts` makes the same move with
 * `DrawPort`, and its header states the rule this follows — what a richer host
 * adds is a port, not a branch.
 *
 * `let` + `for` and direct typed-array writes, which is the same performance
 * exemption mc-meshing takes for its own inner loops (plan.md §5.2): this runs
 * once per re-meshed chunk over every visible face in it, and a functional
 * formulation would allocate four tuples and three arrays per quad. The
 * per-quad work itself is `processQuad`, above, split out so this function's
 * own body stays a plain allocate-then-loop shape.
 *
 * EVERY QUAD IS EMITTED. There is no culling, no LOD and no layer separation
 * here — `MeshLayers` has three quad lists plus plants and fluids, and choosing
 * which of them to draw and in what order is `domain/material-policy.ts`'s
 * business and the caller's, not this function's. Handing it one list and
 * getting one geometry back is what lets the opaque and water passes be two
 * calls rather than a flag.
 */
export const buildChunkGeometry = (
  quads: ReadonlyArray<MeshQuad>,
  originX = DEFAULT_CHUNK_ORIGIN,
  originZ = DEFAULT_CHUNK_ORIGIN,
  color: QuadColor = AO_ONLY_COLOR,
  tile: QuadTile = UNTEXTURED_TILE,
): ChunkGeometryBuffers => buildProjectedGeometry(quads, (quad) => quad, originX, originZ, color, tile)

const UNIT_UV_EXTENT = 1
const CROSS_PLANT_UV_EXTENT: readonly [number, number] = [UNIT_UV_EXTENT, UNIT_UV_EXTENT]
const X_COMPONENT_INDEX = 0
const Y_COMPONENT_INDEX = 1
const Z_COMPONENT_INDEX = 2

const crossPlantCorners = (quad: CrossPlantQuad, originX: number, originZ: number): QuadCorners => {
  const [first, second, third, fourth] = quad.vertices
  return [
    [first[X_COMPONENT_INDEX] + originX, first[Y_COMPONENT_INDEX], first[Z_COMPONENT_INDEX] + originZ],
    [second[X_COMPONENT_INDEX] + originX, second[Y_COMPONENT_INDEX], second[Z_COMPONENT_INDEX] + originZ],
    [third[X_COMPONENT_INDEX] + originX, third[Y_COMPONENT_INDEX], third[Z_COMPONENT_INDEX] + originZ],
    [fourth[X_COMPONENT_INDEX] + originX, fourth[Y_COMPONENT_INDEX], fourth[Z_COMPONENT_INDEX] + originZ],
  ]
}

const processCrossPlantQuad = (context: ChunkBuildContext, quad: CrossPlantQuad, quadIndex: number): void => {
  const base = quadIndex * VERTICES_PER_QUAD
  const color = context.color(quad)
  const tileIndex = context.tile(quad)
  writeQuadCorners(context.buffers, base, {
    color,
    corners: crossPlantCorners(quad, context.originX, context.originZ),
    normal: [quad.nx, quad.ny, quad.nz],
    tileIndex,
  })
  writeQuadUVs(context.buffers.uvs, base * UV_COMPONENTS, CROSS_PLANT_UV_EXTENT)
  writeQuadIndices(context.buffers.indices, quadIndex * INDICES_PER_QUAD, base)
}

export const buildCrossPlantGeometry = (
  quads: ReadonlyArray<CrossPlantQuad>,
  originX = DEFAULT_CHUNK_ORIGIN,
  originZ = DEFAULT_CHUNK_ORIGIN,
  color: QuadColor = AO_ONLY_COLOR,
  tile: QuadTile = UNTEXTURED_TILE,
): ChunkGeometryBuffers => {
  const quadCount = quads.length
  if (quadCount === EMPTY_QUAD_COUNT) {
    return EMPTY_BUFFERS
  }

  const buffers = allocateChunkWriteBuffers(quadCount * VERTICES_PER_QUAD, quadCount * INDICES_PER_QUAD)
  const context: ChunkBuildContext = { buffers, color, originX, originZ, tile }
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex += LOOP_STEP) {
    const quad = quads[quadIndex]
    if (quad) {
      processCrossPlantQuad(context, quad, quadIndex)
    }
  }

  return {
    ...buffers,
    indexCount: quadCount * INDICES_PER_QUAD,
    quadCount,
    vertexCount: quadCount * VERTICES_PER_QUAD,
  }
}

/** Half a block: the offset applied to a fluid cell key along its quad's own scan axis. */
const CELL_KEY_HALF_BLOCK = 0.5
/** No offset: the axis a fluid cell key's quad direction does not need adjusting along. */
const CELL_KEY_NO_OFFSET = 0

/** The axis offset a fluid cell key applies, or none, depending on whether the quad's direction matches. */
const cellKeyAxisOffset = (matchesQuadDirection: boolean): number => {
  if (matchesQuadDirection) {
    return CELL_KEY_HALF_BLOCK
  }
  return CELL_KEY_NO_OFFSET
}

const fluidCellKey = (quad: FluidQuad): string => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  for (const [vertexX, vertexY, vertexZ] of quad.vertices) {
    minX = Math.min(minX, vertexX)
    minY = Math.min(minY, vertexY)
    minZ = Math.min(minZ, vertexZ)
  }
  const cellX = Math.floor(minX - cellKeyAxisOffset(quad.direction === 'xPos'))
  const cellZ = Math.floor(minZ - cellKeyAxisOffset(quad.direction === 'zPos'))
  return `${quad.blockId}:${cellX}:${Math.floor(minY)}:${cellZ}`
}

/** The x and z flow components when there is no usable flow. */
const ZERO_FLOW = 0
const NO_FLOW_DIRECTION: readonly [number, number] = [ZERO_FLOW, ZERO_FLOW]

const safeFlowDirection = (flow: FluidQuad['flow']): readonly [number, number] => {
  if (!flow) {
    return NO_FLOW_DIRECTION
  }
  const [flowX, flowZ] = flow.direction
  if (!Number.isFinite(flowX) || !Number.isFinite(flowZ)) {
    return NO_FLOW_DIRECTION
  }
  const length = Math.hypot(flowX, flowZ)
  if (length === ZERO_FLOW) {
    return NO_FLOW_DIRECTION
  }
  return [flowX / length, flowZ / length]
}

const roleForFluidDirection = (direction: FaceDirection): FaceRole => {
  if (direction === 'yPos') {
    return 'top'
  }
  return 'side'
}

/** Extents mirror a unit block face: fluid faces are meshed one block at a time. */
const FLUID_PROXY_EXTENT = 1
/** A fluid proxy quad's local position: `buildFluidGeometry` supplies world coordinates separately. */
const FLUID_PROXY_ORIGIN = 0

const fluidProxyQuad = (quad: FluidQuad): MeshQuad => ({
  ao: quad.ao,
  blockId: quad.blockId,
  direction: quad.direction,
  height: FLUID_PROXY_EXTENT,
  lx: FLUID_PROXY_ORIGIN,
  lz: FLUID_PROXY_ORIGIN,
  role: roleForFluidDirection(quad.direction),
  width: FLUID_PROXY_EXTENT,
  y: FLUID_PROXY_ORIGIN,
})

const isFallingFluidQuad = (quad: FluidQuad, fallingCells: ReadonlySet<string>): boolean =>
  quad.flow?.falling === true || fallingCells.has(fluidCellKey(quad))

type FlowDirectionInputs = {
  readonly quad: FluidQuad
  readonly normal: QuadVertex
  readonly topFlow: readonly [number, number]
  readonly falling: boolean
}

/** A fluid quad's animated flow direction: the sampled flow on top, the face normal on a falling side, else none. */
const fluidFlowDirection = (inputs: FlowDirectionInputs): readonly [number, number] => {
  const { quad, normal, topFlow, falling } = inputs
  if (quad.direction === 'yPos') {
    return topFlow
  }
  if (falling) {
    const [normalX, , normalZ] = normal
    return [normalX, normalZ]
  }
  return NO_FLOW_DIRECTION
}

const FALLING_FLAG = 1
const NOT_FALLING_FLAG = 0

const writeFluidFalling = (built: ChunkGeometryBuffers, fallingAt: number, falling: boolean): void => {
  if (falling) {
    built.fluidFalling[fallingAt] = FALLING_FLAG
  } else {
    built.fluidFalling[fallingAt] = NOT_FALLING_FLAG
  }
}

type FluidPositionAndFlowWrite = {
  readonly built: ChunkGeometryBuffers
  readonly positionAt: number
  readonly flowAt: number
  readonly origin: readonly [number, number]
  readonly vertex: QuadVertex
  readonly direction: readonly [number, number]
}

const writeFluidPositionAndFlow = (write: FluidPositionAndFlowWrite): void => {
  const { built, positionAt, flowAt, origin, vertex, direction } = write
  const [originX, originZ] = origin
  const [vertexX, vertexY, vertexZ] = vertex
  const [flowX, flowZ] = direction
  built.positions[positionAt] = originX + vertexX
  built.positions[positionAt + Y_COMPONENT_OFFSET] = vertexY
  built.positions[positionAt + Z_COMPONENT_OFFSET] = originZ + vertexZ
  built.fluidDirections[flowAt] = flowX
  built.fluidDirections[flowAt + PAIR_SECOND_OFFSET] = flowZ
}

type FluidQuadWrite = {
  readonly built: ChunkGeometryBuffers
  readonly quad: FluidQuad
  readonly base: number
  readonly origin: readonly [number, number]
  readonly direction: readonly [number, number]
  readonly falling: boolean
}

/** Write every corner of one fluid quad's position, flow and falling flag. */
const writeFluidQuadVertices = (write: FluidQuadWrite): void => {
  const { built, quad, base, origin, direction, falling } = write
  for (let cornerIndex = 0; cornerIndex < VERTICES_PER_QUAD; cornerIndex += LOOP_STEP) {
    const vertex = quad.vertices[cornerIndex]
    if (vertex) {
      const positionAt = (base + cornerIndex) * POSITION_COMPONENTS
      const flowAt = (base + cornerIndex) * FLUID_DIRECTION_COMPONENTS
      writeFluidPositionAndFlow({ built, direction, flowAt, origin, positionAt, vertex })
      writeFluidFalling(built, base + cornerIndex, falling)
    }
  }
}

/** Half a block: centres a flow-UV sample within its cell rather than at the cell's corner. */
const HALF_BLOCK = 0.5
/** The UV value at a flow-animated vertex's own cell centre, before the flow rotation is applied. */
const UV_CENTER = 0.5

type FlowUVVertexWrite = {
  readonly built: ChunkGeometryBuffers
  readonly at: number
  readonly cell: readonly [number, number]
  readonly topFlow: readonly [number, number]
  readonly vertex: QuadVertex
}

const writeFlowUVVertex = (write: FlowUVVertexWrite): void => {
  const { built, at, cell, topFlow, vertex } = write
  const [cellX, cellZ] = cell
  const [flowX, flowZ] = topFlow
  const [vertexX, , vertexZ] = vertex
  const localU = vertexX - cellX - HALF_BLOCK
  const localV = vertexZ - cellZ - HALF_BLOCK
  built.uvs[at] = UV_CENTER + localU * -flowZ + localV * flowX
  built.uvs[at + PAIR_SECOND_OFFSET] = UV_CENTER + localU * flowX + localV * flowZ
}

type FluidFlowUVWrite = {
  readonly built: ChunkGeometryBuffers
  readonly quad: FluidQuad
  readonly base: number
  readonly cell: readonly [number, number]
  readonly topFlow: readonly [number, number]
}

/** Animate a flow-carrying top face's UVs so the water texture scrolls the direction it flows. */
const writeFluidFlowUV = (write: FluidFlowUVWrite): void => {
  const { built, quad, base, cell, topFlow } = write
  for (let cornerIndex = 0; cornerIndex < VERTICES_PER_QUAD; cornerIndex += LOOP_STEP) {
    const vertex = quad.vertices[cornerIndex]
    if (vertex) {
      const at = (base + cornerIndex) * UV_COMPONENTS
      writeFlowUVVertex({ at, built, cell, topFlow, vertex })
    }
  }
}

const fluidVertexX = ([vertexX]: QuadVertex): number => vertexX
const fluidVertexZ = ([, , vertexZ]: QuadVertex): number => vertexZ

const hasHorizontalFlow = (flow: readonly [number, number]): boolean => {
  const [flowX, flowZ] = flow
  return flowX !== ZERO_FLOW || flowZ !== ZERO_FLOW
}

type FluidQuadContext = {
  readonly built: ChunkGeometryBuffers
  readonly origin: readonly [number, number]
  readonly fallingCells: ReadonlySet<string>
}

const processFluidQuad = (context: FluidQuadContext, quad: FluidQuad, quadIndex: number): void => {
  const normal = faceNormal(quad.direction)
  const topFlow = safeFlowDirection(quad.flow)
  const falling = isFallingFluidQuad(quad, context.fallingCells)
  const direction = fluidFlowDirection({ falling, normal, quad, topFlow })
  const base = quadIndex * VERTICES_PER_QUAD
  writeFluidQuadVertices({ base, built: context.built, direction, falling, origin: context.origin, quad })
  if (quad.direction === 'yPos' && hasHorizontalFlow(topFlow)) {
    const cellX = Math.floor(Math.min(...quad.vertices.map(fluidVertexX)))
    const cellZ = Math.floor(Math.min(...quad.vertices.map(fluidVertexZ)))
    writeFluidFlowUV({ base, built: context.built, cell: [cellX, cellZ], quad, topFlow })
  }
}

/** Build non-cubic fluid faces and preserve their animation metadata. */
export const buildFluidGeometry = (
  quads: ReadonlyArray<FluidQuad>,
  originX = DEFAULT_CHUNK_ORIGIN,
  originZ = DEFAULT_CHUNK_ORIGIN,
  color: QuadColor = AO_ONLY_COLOR,
  tile: QuadTile = UNTEXTURED_TILE,
): ChunkGeometryBuffers => {
  if (quads.length === EMPTY_QUAD_COUNT) {
    return EMPTY_BUFFERS
  }
  const fallingCells = new Set(
    quads.filter((quad) => quad.direction === 'yPos' && quad.flow?.falling === true).map(fluidCellKey),
  )
  const built = buildProjectedGeometry(
    quads,
    fluidProxyQuad,
    DEFAULT_CHUNK_ORIGIN,
    DEFAULT_CHUNK_ORIGIN,
    color,
    tile,
  )
  const context: FluidQuadContext = { built, fallingCells, origin: [originX, originZ] }

  for (let quadIndex = 0; quadIndex < quads.length; quadIndex += LOOP_STEP) {
    const quad = quads[quadIndex]
    if (quad) {
      processFluidQuad(context, quad, quadIndex)
    }
  }
  return built
}

/** The identity element for summing a count across parts: no parts, zero total. */
const SUM_IDENTITY = 0

const sumBy = (
  parts: ReadonlyArray<ChunkGeometryBuffers>,
  selector: (part: ChunkGeometryBuffers) => number,
): number => parts.reduce((sum, part) => sum + selector(part), SUM_IDENTITY)

/**
 * The value used when an index-buffer slot is missing under
 * `noUncheckedIndexedAccess`. Unreachable in practice: every part's `indices`
 * is exactly its own `indexCount` long.
 */
const MISSING_INDEX_FALLBACK = 0

/** One index-buffer slot's advance. */
const INDEX_STEP = 1

/** How far into the combined buffers the next part's vertices and indices start. */
type GeometryOffsets = {
  readonly vertexOffset: number
  readonly indexOffset: number
}

const INITIAL_OFFSETS: GeometryOffsets = { indexOffset: DEFAULT_CHUNK_ORIGIN, vertexOffset: DEFAULT_CHUNK_ORIGIN }

/** Copy one part's index triangles into the combined target, offset by the vertices already copied. */
const copyGeometryIndices = (target: ChunkWriteBuffers, offsets: GeometryOffsets, part: ChunkGeometryBuffers): void => {
  const { vertexOffset, indexOffset } = offsets
  for (let index = 0; index < part.indexCount; index += INDEX_STEP) {
    target.indices[indexOffset + index] = (part.indices[index] ?? MISSING_INDEX_FALLBACK) + vertexOffset
  }
}

/**
 * Copy one part's buffers into the combined target at its assigned offsets,
 * and return the offsets the next part starts at.
 */
const copyGeometryPart = (
  target: ChunkWriteBuffers,
  offsets: GeometryOffsets,
  part: ChunkGeometryBuffers,
): GeometryOffsets => {
  const { vertexOffset, indexOffset } = offsets
  target.positions.set(part.positions, vertexOffset * POSITION_COMPONENTS)
  target.normals.set(part.normals, vertexOffset * NORMAL_COMPONENTS)
  target.colors.set(part.colors, vertexOffset * COLOR_COMPONENTS)
  target.uvs.set(part.uvs, vertexOffset * UV_COMPONENTS)
  target.tileIndices.set(part.tileIndices, vertexOffset)
  target.fluidDirections.set(part.fluidDirections, vertexOffset * FLUID_DIRECTION_COMPONENTS)
  target.fluidFalling.set(part.fluidFalling, vertexOffset)
  copyGeometryIndices(target, offsets, part)
  return { indexOffset: indexOffset + part.indexCount, vertexOffset: vertexOffset + part.vertexCount }
}

/** Concatenate independently generated layer buffers into one GPU geometry. */
export const combineChunkGeometry = (...parts: ReadonlyArray<ChunkGeometryBuffers>): ChunkGeometryBuffers => {
  const vertexCount = sumBy(parts, (part) => part.vertexCount)
  const indexCount = sumBy(parts, (part) => part.indexCount)
  const quadCount = sumBy(parts, (part) => part.quadCount)
  const target = allocateChunkWriteBuffers(vertexCount, indexCount)
  let offsets = INITIAL_OFFSETS
  for (const part of parts) {
    offsets = copyGeometryPart(target, offsets, part)
  }
  return { ...target, indexCount, quadCount, vertexCount }
}

/**
 * Total block-face area the quads cover.
 *
 * The invariant the greedy merge must not move — mc-meshing's `totalQuadArea`
 * is the same measurement on the other side of the seam, and its comment
 * explains why it is not `totalQuadCount`: for unit quads the two are equal,
 * which is exactly why the distinction was invisible until merging landed.
 *
 * It is here so that a caller — and `test/chunk-geometry.test.ts` — can state
 * "this geometry covers the same area as the faces it was built from" without
 * reaching back into mc-meshing for a function it cannot import.
 */
export const totalQuadArea = (quads: ReadonlyArray<MeshQuad>): number => {
  let area = 0
  for (const quad of quads) {
    area += quad.width * quad.height
  }
  return area
}
