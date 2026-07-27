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
  indices: new Uint32Array(0),
  quadCount: 0,
  vertexCount: 0,
  indexCount: 0,
}

/**
 * Build the vertex buffers for one chunk's worth of quads.
 *
 * `originX`/`originZ` are the chunk's world-space corner; mc-meshing emits
 * chunk-local positions and says "mc-render applies the offset"
 * (`mc-meshing/domain/mesh.ts:143`). There is no `originY` because there is no
 * vertical chunking: `CHUNK_HEIGHT` is the whole column.
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
  const indices = new Uint32Array(indexCount)

  for (let quadIndex = 0; quadIndex < quadCount; quadIndex += 1) {
    const quad = quads[quadIndex]
    if (quad === undefined) {
      continue
    }

    const corners = quadCorners(quad, originX, originZ)
    const normal = faceNormal(quad.direction)
    const shade = aoShade(quad.ao)
    const [uExtent, vExtent] = quadUvExtent(quad)

    const base = quadIndex * VERTICES_PER_QUAD
    const positionOffset = base * POSITION_COMPONENTS
    const uvOffset = base * UV_COMPONENTS

    // `for...of` and not an index loop: `QuadCorners` is a fixed four-tuple, and
    // under `noUncheckedIndexedAccess` a numeric index into one reads as
    // `QuadVertex | undefined` while iteration does not. The alternative is four
    // non-null assertions in the hot path.
    let corner = 0
    for (const vertex of corners) {
      const at = positionOffset + corner * POSITION_COMPONENTS
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
      colors[at] = shade
      colors[at + 1] = shade
      colors[at + 2] = shade
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

  return { positions, normals, colors, uvs, indices, quadCount, vertexCount, indexCount }
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
