/**
 * Quads to interleaved vertex buffers. THE HALF OF THE RENDERER THAT IS PURE.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * mc-meshing turns block ids into face lists; this turns a face list into the
 * five typed arrays a `BufferGeometry` is assembled from. No THREE, no DOM, no
 * services — so the whole of the geometry contract is testable under
 * `environment: 'node'`, and `application/world-renderer.ts` is left holding
 * only the calls that genuinely need a GPU.
 *
 * ---------------------------------------------------------------------------
 * Why `MeshQuad` is declared here and not imported from mc-meshing
 * ---------------------------------------------------------------------------
 *
 * `@nerima-games/mc-meshing` IS a permitted parent of this repository —
 * `scripts/check-dependency-whitelist.ts`'s authoritative row is
 * `mc-meshing, mc-sim, mc-worldgen`. It still cannot be imported, for the same
 * two reasons `domain/kernel-vocabulary.ts` gives for mirroring mc-kernel:
 *
 *   1. NOTHING IS PUBLISHED (plan.md §6 Step 3 is bottom-up
 *      publish-then-pin), and mc-dev-meta's `check-repoint.ts` states the
 *      organisation-wide consequence — each repository also builds standalone
 *      in its own CI, where a `workspace:*` specifier does not resolve, so no
 *      package.json on disk may gain a sibling before it is published.
 *   2. mc-compose's `vite.config.ts` aliases exactly three siblings
 *      (`mc-render`, `mx-ui`, `mx-redstone`), because those are the three whose
 *      registration requirements a host can discharge. An import of
 *      `@nerima-games/mc-meshing` from this file would not resolve in the
 *      browser at all: the composed page would fail to boot, and mc-compose's
 *      smoke test #3 would go red for a reason that has nothing to do with
 *      rendering.
 *
 * So the type is MIRRORED, and the mirror is a copy with a scheduled death:
 * when mc-meshing is published, this declaration is deleted and the import
 * replaces it. What makes that safe is that the mirror is STRUCTURAL — a real
 * `mc-meshing.Quad` satisfies `MeshQuad` with no adaptation, because it is the
 * same shape spelled the same way. `test/chunk-geometry.test.ts` pins the field
 * names against mc-meshing's `domain/mesh.ts:149-169` so that a divergence is a
 * failing test rather than a silent mis-read.
 *
 * ---------------------------------------------------------------------------
 * QUADS ARE NOT UNIT FACES. This is the thing that is wrong everywhere if wrong
 * ---------------------------------------------------------------------------
 *
 * mc-meshing merges coplanar like-for-like faces into maximal rectangles, so
 * `width` and `height` are extents and are frequently much larger than 1 — on
 * flat terrain almost every quad is merged. A builder that assumed unit faces
 * would produce a mesh that is wrong over the overwhelming majority of the
 * surface, and wrong in the way that is hardest to see: the FACE COUNT and the
 * emission order would both be right, and only the shape would have moved.
 *
 * `width` and `height` run along `tangentAxes(direction)`, in that order, and
 * mc-meshing's `domain/faces.ts` is emphatic that this convention was implicit
 * until LOD simplification needed it and that implicit was wrong. It is
 * mirrored below rather than re-derived, because "the two axes that are not the
 * normal, in x, y, z order" is a rule that a reader and a writer can each get
 * right on their own and still disagree about.
 *
 * NOTE that this is NOT the reference's convention, and the difference is a
 * transposition rather than a disagreement. ts-minecraft's x-facing passes scan
 * `u = lz, v = y` (`packages/rendering/infrastructure/meshing/greedy-meshing-algorithms.ts:24`
 * and :63), so its `du` is the z extent and its `dv` is the y extent — the
 * opposite way round from `tangentAxes('xPos') === ['y', 'z']`. Transcribing
 * the reference's vertex formulae without applying that swap is exactly the
 * silent shape error above, on the four side directions only. `quadCorners`
 * below does the swap once, in one place, and the test file checks it by
 * measuring the emitted extents rather than by re-reading the formula.
 *
 * ---------------------------------------------------------------------------
 * AO IS ONE VALUE PER QUAD, NOT FOUR PER VERTEX
 * ---------------------------------------------------------------------------
 *
 * `MeshQuad.ao` is a single `[0, AO_MAX]` level for the whole face, and that is
 * the reference's model rather than a simplification of it —
 * mc-meshing's `domain/ambient-occlusion.ts` argues it at length, and its
 * central point is that PER-VERTEX AO AND GREEDY MERGING CONFLICT: a 16x1 run
 * has 17 corners and no set of four vertex shades reproduces them. Per-face AO
 * does not conflict, because the value joins the merge key, so every cell a
 * quad covers already agreed on it.
 *
 * The consequence here is that all four vertices of a quad get the SAME colour,
 * which is what `greedy-meshing-passes.ts:154` does too (`aoQuad[0] = ao;
 * aoQuad[1] = ao; ...`). The four-value write is kept anyway rather than being
 * collapsed into a per-face attribute, because per-vertex is where this has to
 * end up when a light grid arrives and the two stop agreeing.
 */

/** The six face directions. Structural mirror of mc-meshing's `FaceDirection`. */
export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'

/** The three texturing roles. Structural mirror of mc-meshing's `FaceRole`. */
export type FaceRole = 'top' | 'bottom' | 'side'

/** One of the three chunk-local axes. Not a coordinate — a choice of axis. */
export type QuadAxis = 'x' | 'y' | 'z'

/**
 * One emitted quad. STRUCTURAL MIRROR of `mc-meshing/domain/mesh.ts:149-169`.
 *
 * Positions are chunk-local and `(lx, y, lz)` is the MINIMUM corner on every
 * axis; `width` and `height` are the extents along `tangentAxes(direction)`.
 * See this file's header for why the type is mirrored and when it dies.
 */
export type MeshQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  /** Extent along the face's first tangent axis. At least 1; larger when merged. */
  readonly width: number
  /** Extent along the face's second tangent axis. At least 1; larger when merged. */
  readonly height: number
  /** Ambient occlusion for the WHOLE quad, in `[0, AO_MAX]`. Higher is darker. */
  readonly ao: number
}

/**
 * The two axes a quad's `width` and `height` run along, in that order.
 *
 * Mirror of `mc-meshing/domain/faces.ts`'s `tangentAxes`. Present so that
 * `quadCorners` reads the convention from a named function rather than from six
 * hand-transposed formulae, and so that a test can assert the convention itself
 * rather than its consequences.
 */
export const tangentAxes = (direction: FaceDirection): readonly [QuadAxis, QuadAxis] => {
  switch (direction) {
    case 'xPos':
    case 'xNeg':
      return ['y', 'z']
    case 'yPos':
    case 'yNeg':
      return ['x', 'z']
    default:
      return ['x', 'y']
  }
}

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

export type FluidQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly vertices: readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]
  readonly flow?: {
    readonly direction: readonly [x: number, z: number]
    readonly falling: boolean
  }
  readonly ao: number
}

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
 * 20% range. This repository has no shader yet: `MeshBasicMaterial` with
 * `vertexColors` multiplies the base colour by the vertex colour directly, so
 * the same table spans 100% down to 40%. The shading is therefore STRONGER than
 * the reference's, by a factor this file does not attempt to correct — dividing
 * the range here would put a shader's job in a geometry builder, and the number
 * to divide by is a property of a shader that has not been written.
 */
export const AO_SHADE_BY_LEVEL: ReadonlyArray<number> = [255, 204, 153, 102]

/** Levels `AO_SHADE_BY_LEVEL` covers. Mirrors mc-meshing's `AO_LEVELS`. */
export const AO_LEVELS = AO_SHADE_BY_LEVEL.length

/** Highest (darkest) level. Mirrors mc-meshing's `AO_MAX`. */
export const AO_MAX = AO_LEVELS - 1

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
  const clamped = Math.min(Math.max(Math.trunc(level), 0), AO_MAX)
  // `?? AO_DARKEST` is unreachable: `clamped` is in `[0, AO_MAX]` by the line
  // above and `AO_MAX` is derived from this array's own length, so the read
  // cannot miss. `noUncheckedIndexedAccess` types it `number | undefined`
  // regardless, and the fallback is the DARKEST shade rather than 0 or 255 so
  // that if the impossible ever happens it degrades to "fully occluded" — the
  // conservative direction for something whose only job is to darken.
  return AO_SHADE_BY_LEVEL[clamped] ?? AO_DARKEST
}

/** The shade of the most occluded level. See `aoShade` on why it is a fallback. */
const AO_DARKEST = 102

/** One corner of a quad, in world coordinates. */
export type QuadVertex = readonly [number, number, number]

/** The four corners of a quad, in winding order. */
export type QuadCorners = readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]

/** The unit normal of a face direction. */
export const faceNormal = (direction: FaceDirection): QuadVertex => {
  switch (direction) {
    case 'xPos':
      return [1, 0, 0]
    case 'xNeg':
      return [-1, 0, 0]
    case 'yPos':
      return [0, 1, 0]
    case 'yNeg':
      return [0, -1, 0]
    case 'zPos':
      return [0, 0, 1]
    default:
      return [0, 0, -1]
  }
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
export const quadCorners = (quad: MeshQuad, originX: number, originZ: number): QuadCorners => {
  const x0 = originX + quad.lx
  const y0 = quad.y
  const z0 = originZ + quad.lz
  const { width, height } = quad

  switch (quad.direction) {
    case 'xPos': {
      const x = x0 + 1
      return [
        [x, y0, z0],
        [x, y0 + width, z0],
        [x, y0 + width, z0 + height],
        [x, y0, z0 + height],
      ]
    }
    case 'xNeg': {
      return [
        [x0, y0, z0 + height],
        [x0, y0 + width, z0 + height],
        [x0, y0 + width, z0],
        [x0, y0, z0],
      ]
    }
    case 'yPos': {
      const y = y0 + 1
      return [
        [x0, y, z0],
        [x0, y, z0 + height],
        [x0 + width, y, z0 + height],
        [x0 + width, y, z0],
      ]
    }
    case 'yNeg': {
      return [
        [x0 + width, y0, z0],
        [x0 + width, y0, z0 + height],
        [x0, y0, z0 + height],
        [x0, y0, z0],
      ]
    }
    case 'zPos': {
      const z = z0 + 1
      return [
        [x0 + width, y0, z],
        [x0 + width, y0 + height, z],
        [x0, y0 + height, z],
        [x0, y0, z],
      ]
    }
    default: {
      return [
        [x0, y0, z0],
        [x0, y0 + height, z0],
        [x0 + width, y0 + height, z0],
        [x0 + width, y0, z0],
      ]
    }
  }
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

/** The buffers for a chunk with no visible faces. Allocation-free. */
const EMPTY_BUFFERS: ChunkGeometryBuffers = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Uint8Array(0),
  uvs: new Float32Array(0),
  tileIndices: new Float32Array(0),
  fluidDirections: new Float32Array(0),
  fluidFalling: new Float32Array(0),
  indices: new Uint32Array(0),
  quadCount: 0,
  vertexCount: 0,
  indexCount: 0,
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
export type QuadShade = (quad: MeshQuad) => number

/**
 * The three colour channels of a quad's vertices, 0-255 each.
 *
 * THREE CHANNELS AND NOT ONE, because the two paths this repository has to
 * support disagree about what a channel means and agree about the layout:
 *
 *   NO SHADER — `MeshBasicMaterial` multiplies the vertex colour directly, so
 *   the only honest output is a GREY: one number, written three times. See
 *   `./voxel-lighting.ts`'s header.
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
export type QuadColor = (quad: MeshQuad) => readonly [number, number, number]

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
export type QuadTile = (quad: MeshQuad) => number

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
export const UNTEXTURED_TILE: QuadTile = () => 0

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
 * formulation would allocate four tuples and three arrays per quad.
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
  originX = 0,
  originZ = 0,
  color: QuadColor = AO_ONLY_COLOR,
  tile: QuadTile = UNTEXTURED_TILE,
): ChunkGeometryBuffers => {
  const quadCount = quads.length
  if (quadCount === 0) {
    return EMPTY_BUFFERS
  }

  const vertexCount = quadCount * VERTICES_PER_QUAD
  const indexCount = quadCount * INDICES_PER_QUAD

  const positions = new Float32Array(vertexCount * POSITION_COMPONENTS)
  const normals = new Float32Array(vertexCount * NORMAL_COMPONENTS)
  const colors = new Uint8Array(vertexCount * COLOR_COMPONENTS)
  const uvs = new Float32Array(vertexCount * UV_COMPONENTS)
  const tileIndices = new Float32Array(vertexCount * TILE_INDEX_COMPONENTS)
  const fluidDirections = new Float32Array(vertexCount * FLUID_DIRECTION_COMPONENTS)
  const fluidFalling = new Float32Array(vertexCount * FLUID_FALLING_COMPONENTS)
  const indices = new Uint32Array(indexCount)

  for (let quadIndex = 0; quadIndex < quadCount; quadIndex += 1) {
    const quad = quads[quadIndex]
    if (quad === undefined) {
      continue
    }

    const corners = quadCorners(quad, originX, originZ)
    const normal = faceNormal(quad.direction)
    // ONE CALL PER QUAD, not per vertex. The four vertices of a quad share a
    // shade for the reason the header gives for AO — the value joins the merge
    // key, so every cell the quad covers already agreed on it — and a
    // per-vertex call would invite a `shade` implementation that samples four
    // times and quietly quadruples the cost of a re-mesh.
    const [red, green, blue] = color(quad)
    const [uExtent, vExtent] = quadUvExtent(quad)
    // Once per quad for the same reason `color` is: the tile joins the merge
    // key upstream, so every cell this quad covers already agreed on it.
    const tileIndex = tile(quad)

    const base = quadIndex * VERTICES_PER_QUAD
    const positionOffset = base * POSITION_COMPONENTS
    const uvOffset = base * UV_COMPONENTS
    const tileOffset = base * TILE_INDEX_COMPONENTS

    // `for...of` and not an index loop: `QuadCorners` is a fixed four-tuple, and
    // under `noUncheckedIndexedAccess` a numeric index into one reads as
    // `QuadVertex | undefined` while iteration does not. The alternative is four
    // non-null assertions in the hot path.
    let corner = 0
    for (const vertex of corners) {
      const at = positionOffset + corner * POSITION_COMPONENTS
      const tileAt = tileOffset + corner * TILE_INDEX_COMPONENTS
      corner += 1

      positions[at] = vertex[0]
      positions[at + 1] = vertex[1]
      positions[at + 2] = vertex[2]

      normals[at] = normal[0]
      normals[at + 1] = normal[1]
      normals[at + 2] = normal[2]

      // The same shade four times. See the header: AO is per FACE, and the
      // four-value write is kept so that a light grid can differ per corner
      // without changing the buffer layout.
      colors[at] = red
      colors[at + 1] = green
      colors[at + 2] = blue

      // The same tile four times. A quad is one block face; the per-vertex
      // repetition is what an attribute is, not a claim that corners differ.
      tileIndices[tileAt] = tileIndex
    }

    // `(0,0), (0,v), (u,v), (u,0)` — the reference's order at
    // `greedy-meshing-accumulator.ts:158-161`, which is the winding order of
    // `quadCorners` and must stay in step with it.
    uvs[uvOffset] = 0
    uvs[uvOffset + 1] = 0
    uvs[uvOffset + 2] = 0
    uvs[uvOffset + 3] = vExtent
    uvs[uvOffset + 4] = uExtent
    uvs[uvOffset + 5] = vExtent
    uvs[uvOffset + 6] = uExtent
    uvs[uvOffset + 7] = 0

    const indexOffset = quadIndex * INDICES_PER_QUAD
    indices[indexOffset] = base
    indices[indexOffset + 1] = base + 1
    indices[indexOffset + 2] = base + 2
    indices[indexOffset + 3] = base
    indices[indexOffset + 4] = base + 2
    indices[indexOffset + 5] = base + 3
  }

  return {
    positions, normals, colors, uvs, tileIndices, fluidDirections, fluidFalling,
    indices, quadCount, vertexCount, indexCount,
  }
}

const fluidCellKey = (quad: FluidQuad): string => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  for (const [x, y, z] of quad.vertices) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
  }
  const cellX = Math.floor(minX - (quad.direction === 'xPos' ? 0.5 : 0))
  const cellZ = Math.floor(minZ - (quad.direction === 'zPos' ? 0.5 : 0))
  return `${quad.blockId}:${cellX}:${Math.floor(minY)}:${cellZ}`
}

const safeFlowDirection = (flow: FluidQuad['flow']): readonly [number, number] => {
  if (flow === undefined) return [0, 0]
  const [x, z] = flow.direction
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [0, 0]
  const length = Math.hypot(x, z)
  return length > 0 ? [x / length, z / length] : [0, 0]
}

/** Build non-cubic fluid faces and preserve their animation metadata. */
export const buildFluidGeometry = (
  quads: ReadonlyArray<FluidQuad>,
  originX = 0,
  originZ = 0,
  color: QuadColor = AO_ONLY_COLOR,
  tile: QuadTile = UNTEXTURED_TILE,
): ChunkGeometryBuffers => {
  if (quads.length === 0) return EMPTY_BUFFERS
  const fallingCells = new Set(
    quads.filter((quad) => quad.direction === 'yPos' && quad.flow?.falling === true).map(fluidCellKey),
  )
  const proxies: MeshQuad[] = quads.map((quad) => ({
    blockId: quad.blockId,
    direction: quad.direction,
    role: quad.direction === 'yPos' ? 'top' : 'side',
    lx: 0, y: 0, lz: 0, width: 1, height: 1, ao: quad.ao,
  }))
  const built = buildChunkGeometry(proxies, 0, 0, color, tile)

  for (let quadIndex = 0; quadIndex < quads.length; quadIndex += 1) {
    const quad = quads[quadIndex]
    if (quad === undefined) continue
    const normal = faceNormal(quad.direction)
    const topFlow = safeFlowDirection(quad.flow)
    const falling = quad.flow?.falling === true || fallingCells.has(fluidCellKey(quad))
    const direction: readonly [number, number] = quad.direction === 'yPos'
      ? topFlow
      : falling ? [normal[0], normal[2]] : [0, 0]
    const base = quadIndex * VERTICES_PER_QUAD
    for (let corner = 0; corner < VERTICES_PER_QUAD; corner += 1) {
      const vertex = quad.vertices[corner]
      if (vertex === undefined) continue
      const positionAt = (base + corner) * POSITION_COMPONENTS
      const flowAt = (base + corner) * FLUID_DIRECTION_COMPONENTS
      built.positions[positionAt] = originX + vertex[0]
      built.positions[positionAt + 1] = vertex[1]
      built.positions[positionAt + 2] = originZ + vertex[2]
      built.fluidDirections[flowAt] = direction[0]
      built.fluidDirections[flowAt + 1] = direction[1]
      built.fluidFalling[base + corner] = falling ? 1 : 0
    }

    if (quad.direction === 'yPos' && (topFlow[0] !== 0 || topFlow[1] !== 0)) {
      const cellX = Math.floor(Math.min(...quad.vertices.map(([x]) => x)))
      const cellZ = Math.floor(Math.min(...quad.vertices.map(([, , z]) => z)))
      for (let corner = 0; corner < VERTICES_PER_QUAD; corner += 1) {
        const vertex = quad.vertices[corner]
        if (vertex === undefined) continue
        const u = vertex[0] - cellX - 0.5
        const v = vertex[2] - cellZ - 0.5
        const at = (base + corner) * UV_COMPONENTS
        built.uvs[at] = 0.5 + u * -topFlow[1] + v * topFlow[0]
        built.uvs[at + 1] = 0.5 + u * topFlow[0] + v * topFlow[1]
      }
    }
  }
  return built
}

/** Concatenate independently generated layer buffers into one GPU geometry. */
export const combineChunkGeometry = (...parts: ReadonlyArray<ChunkGeometryBuffers>): ChunkGeometryBuffers => {
  const vertexCount = parts.reduce((sum, part) => sum + part.vertexCount, 0)
  const indexCount = parts.reduce((sum, part) => sum + part.indexCount, 0)
  const quadCount = parts.reduce((sum, part) => sum + part.quadCount, 0)
  const positions = new Float32Array(vertexCount * POSITION_COMPONENTS)
  const normals = new Float32Array(vertexCount * NORMAL_COMPONENTS)
  const colors = new Uint8Array(vertexCount * COLOR_COMPONENTS)
  const uvs = new Float32Array(vertexCount * UV_COMPONENTS)
  const tileIndices = new Float32Array(vertexCount)
  const fluidDirections = new Float32Array(vertexCount * FLUID_DIRECTION_COMPONENTS)
  const fluidFalling = new Float32Array(vertexCount)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  for (const part of parts) {
    positions.set(part.positions, vertexOffset * POSITION_COMPONENTS)
    normals.set(part.normals, vertexOffset * NORMAL_COMPONENTS)
    colors.set(part.colors, vertexOffset * COLOR_COMPONENTS)
    uvs.set(part.uvs, vertexOffset * UV_COMPONENTS)
    tileIndices.set(part.tileIndices, vertexOffset)
    fluidDirections.set(part.fluidDirections, vertexOffset * FLUID_DIRECTION_COMPONENTS)
    fluidFalling.set(part.fluidFalling, vertexOffset)
    for (let index = 0; index < part.indexCount; index += 1) {
      indices[indexOffset + index] = (part.indices[index] ?? 0) + vertexOffset
    }
    vertexOffset += part.vertexCount
    indexOffset += part.indexCount
  }
  return { positions, normals, colors, uvs, tileIndices, fluidDirections, fluidFalling, indices, quadCount, vertexCount, indexCount }
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
