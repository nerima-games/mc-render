/**
 * `domain/chunk-geometry.ts` — quads to interleaved vertex buffers.
 *
 * Two claims here are load-bearing and everything else supports them:
 *
 *   MERGED EXTENTS. mc-meshing's quads carry `width`/`height` > 1, and they run
 *   along `tangentAxes(direction)` — which for the two x-facing directions is
 *   the OPPOSITE way round from the reference's own scan order. A builder that
 *   transcribed the reference without applying that swap emits every merged
 *   side face transposed, with the face count, the winding and the normals all
 *   still correct. So the tests below MEASURE the extent along each world axis
 *   rather than comparing against a re-spelling of the vertex table: a test
 *   written from the same formula as the code cannot catch the formula being
 *   wrong.
 *
 *   PER-FACE AO. `Quad.ao` is one level for the whole quad, not four vertex
 *   shades — mc-meshing's `domain/ambient-occlusion.ts` argues at length that
 *   per-vertex AO and greedy merging genuinely conflict. The tests assert that
 *   all four vertices of a quad carry the same shade AND that the shade tracks
 *   the level, because either half alone is satisfied by a constant.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  AO_MAX,
  AO_SHADE_BY_LEVEL,
  aoShade,
  buildChunkGeometry,
  COLOR_COMPONENTS,
  faceNormal,
  INDICES_PER_QUAD,
  POSITION_COMPONENTS,
  quadCorners,
  quadUvExtent,
  tangentAxes,
  totalQuadArea,
  UV_COMPONENTS,
  VERTICES_PER_QUAD,
  type FaceDirection,
  type MeshQuad,
  type QuadAxis,
} from '../src/domain/chunk-geometry'

const DIRECTIONS: ReadonlyArray<FaceDirection> = ['xPos', 'xNeg', 'yPos', 'yNeg', 'zPos', 'zNeg']

/**
 * A quad with everything named, so a test can vary one field and mean it.
 *
 * `width`/`height` default to 4 and 3 — DELIBERATELY UNEQUAL AND BOTH > 1. A
 * square merged quad makes the transposition bug invisible, and a unit quad
 * makes it invisible twice over.
 */
const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: 1,
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 4,
  height: 3,
  ao: 0,
  ...overrides,
})

/** Which position component (x, y or z) a `QuadAxis` reads at. */
const AXIS_COMPONENT_INDEX: Readonly<Record<QuadAxis, number>> = { x: 0, y: 1, z: 2 }

/** The axis of a unit axis-aligned vector (e.g. a face normal) that is nonzero. */
const nonzeroAxisOf = (vector: readonly [number, number, number]): QuadAxis => {
  if (vector[0] !== 0) {
    return 'x'
  }
  if (vector[1] !== 0) {
    return 'y'
  }
  return 'z'
}

/** The span of the emitted positions along one world axis, for quad 0. */
const extentAlong = (positions: Float32Array, axis: QuadAxis): number => {
  const component = AXIS_COMPONENT_INDEX[axis]
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex += 1) {
    const value = positions[vertex * POSITION_COMPONENTS + component] ?? Number.NaN
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  return high - low
}

/** The x-facing directions transpose (u, v); the UV u axis follows from that. */
const uAxisFor = (direction: FaceDirection): QuadAxis => {
  if (direction === 'xPos' || direction === 'xNeg') {
    return 'z'
  }
  return 'x'
}

/** The y-facing directions transpose (u, v) on the other axis; the UV v axis follows from that. */
const vAxisFor = (direction: FaceDirection): QuadAxis => {
  if (direction === 'yPos' || direction === 'yNeg') {
    return 'z'
  }
  return 'y'
}

const vertexColor = (colors: Uint8Array, vertex: number): readonly [number, number, number] => [
  colors[vertex * COLOR_COMPONENTS] ?? Number.NaN,
  colors[vertex * COLOR_COMPONENTS + 1] ?? Number.NaN,
  colors[vertex * COLOR_COMPONENTS + 2] ?? Number.NaN,
]

describe('the mirrored mc-meshing vocabulary', () => {
  it.effect('tangentAxes names the two axes that are NOT the normal, in x, y, z order', () =>
    Effect.sync(() => {
      // Mirror of `mc-meshing/domain/faces.ts`. Asserted as the RULE rather
      // than as a table, because the rule is what a future reader will apply
      // and the table is what they would copy.
      for (const direction of DIRECTIONS) {
        const [first, second] = tangentAxes(direction)
        const normal = faceNormal(direction)
        const normalAxis: QuadAxis = nonzeroAxisOf(normal)

        expect([first, second]).not.toContain(normalAxis)
        // x, y, z order: the pair is sorted.
        expect(['x', 'y', 'z'].indexOf(first)).toBeLessThan(['x', 'y', 'z'].indexOf(second))
      }
    }),
  )

  it.effect('the six normals are unit and axis-aligned, and opposite pairs negate', () =>
    Effect.sync(() => {
      expect(faceNormal('xPos')).toStrictEqual([1, 0, 0])
      expect(faceNormal('xNeg')).toStrictEqual([-1, 0, 0])
      expect(faceNormal('yPos')).toStrictEqual([0, 1, 0])
      expect(faceNormal('yNeg')).toStrictEqual([0, -1, 0])
      expect(faceNormal('zPos')).toStrictEqual([0, 0, 1])
      expect(faceNormal('zNeg')).toStrictEqual([0, 0, -1])
    }),
  )
})

describe('REGRESSION: merged extents land on the axes tangentAxes names', () => {
  it.effect('a 4x3 quad spans 4 along its first tangent axis and 3 along its second', () =>
    Effect.sync(() => {
      // THE TEST THE WHOLE FILE IS FOR. Greedy merging landed in mc-meshing, so
      // on flat terrain nearly every quad is merged; a builder that swapped
      // these would be wrong over almost the entire visible surface while
      // emitting the right number of faces with the right normals.
      //
      // It is stated per direction rather than once, because the reference's
      // scan order agrees with `tangentAxes` for four directions and disagrees
      // for two — so a single-direction test passes for the broken code.
      for (const direction of DIRECTIONS) {
        const [first, second] = tangentAxes(direction)
        const built = buildChunkGeometry([quad({ direction, width: 4, height: 3 })])

        expect({ direction, along: extentAlong(built.positions, first) }).toStrictEqual({
          direction,
          along: 4,
        })
        expect({ direction, along: extentAlong(built.positions, second) }).toStrictEqual({
          direction,
          along: 3,
        })
      }
    }),
  )

  it.effect('a quad is flat: it has zero extent along its own normal', () =>
    Effect.sync(() => {
      for (const direction of DIRECTIONS) {
        const normal = faceNormal(direction)
        const normalAxis: QuadAxis = nonzeroAxisOf(normal)
        const built = buildChunkGeometry([quad({ direction, width: 4, height: 3 })])

        expect({ direction, along: extentAlong(built.positions, normalAxis) }).toStrictEqual({
          direction,
          along: 0,
        })
      }
    }),
  )

  it.effect('the positive face sits one block beyond the origin cell, the negative one on it', () =>
    Effect.sync(() => {
      // The `depth + 1` / `depth` distinction in the reference's six passes
      // (`greedy-meshing-algorithms.ts:26` vs :65, :104 vs :143, :182 vs :221).
      // Get it wrong and every face of the world is displaced one block along
      // its own normal — which reads as z-fighting with the neighbour rather
      // than as a translation, and is diagnosed as a depth-buffer problem.
      const at = quad({ lx: 5, y: 6, lz: 7, width: 1, height: 1 })

      expect(quadCorners({ ...at, direction: 'xPos' }, 0, 0)[0][0]).toBe(6)
      expect(quadCorners({ ...at, direction: 'xNeg' }, 0, 0)[0][0]).toBe(5)
      expect(quadCorners({ ...at, direction: 'yPos' }, 0, 0)[0][1]).toBe(7)
      expect(quadCorners({ ...at, direction: 'yNeg' }, 0, 0)[0][1]).toBe(6)
      expect(quadCorners({ ...at, direction: 'zPos' }, 0, 0)[0][2]).toBe(8)
      expect(quadCorners({ ...at, direction: 'zNeg' }, 0, 0)[0][2]).toBe(7)
    }),
  )

  it.effect('the chunk origin is added to x and z and never to y', () =>
    Effect.sync(() => {
      // mc-meshing emits chunk-local positions and says mc-render applies the
      // offset (`mc-meshing/domain/mesh.ts:143`). There is no `originY` because
      // there is no vertical chunking — a y offset would silently sink the
      // world by one chunk height.
      const local = buildChunkGeometry([quad({ lx: 1, y: 2, lz: 3, width: 1, height: 1 })])
      const offset = buildChunkGeometry(
        [quad({ lx: 1, y: 2, lz: 3, width: 1, height: 1 })],
        // A chunk at (2, -3) in chunk coordinates, with CHUNK_SIZE 16.
        32,
        -48,
      )

      for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex += 1) {
        const base = vertex * POSITION_COMPONENTS
        expect(offset.positions[base]).toBe((local.positions[base] ?? Number.NaN) + 32)
        expect(offset.positions[base + 1]).toBe(local.positions[base + 1])
        expect(offset.positions[base + 2]).toBe((local.positions[base + 2] ?? Number.NaN) - 48)
      }
    }),
  )

  it.effect('every corner of a quad is distinct, so no triangle is degenerate', () =>
    Effect.sync(() => {
      // A transposition that collapsed one axis would produce two coincident
      // corners and two zero-area triangles — invisible geometry that costs a
      // draw call. Checked for a merged quad in every direction.
      for (const direction of DIRECTIONS) {
        const corners = quadCorners(quad({ direction, width: 4, height: 3 }), 0, 0)
        const seen = new Set(corners.map((corner) => corner.join(',')))
        expect({ direction, distinct: seen.size }).toStrictEqual({ direction, distinct: 4 })
      }
    }),
  )
})

describe('winding', () => {
  it.effect('the emitted winding is counter-clockwise seen from outside the face', () =>
    Effect.sync(() => {
      // What makes `side: FrontSide` — three's default and
      // `domain/material-policy.ts`'s `'front'` — cull the BACK of the world
      // rather than the front of it. Reverse the winding and the terrain
      // becomes invisible from outside and solid from inside, which reads as
      // "the renderer draws nothing" and sends the search to the wrong file.
      //
      // Computed, not transcribed: the cross product of the first two edges
      // must point along the face normal.
      for (const direction of DIRECTIONS) {
        const [v0, v1, v2] = quadCorners(quad({ direction, width: 4, height: 3 }), 0, 0)
        const edgeA = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]] as const
        const edgeB = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]] as const
        const cross = [
          edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
          edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
          edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
        ] as const
        const normal = faceNormal(direction)
        const alignment = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]

        expect({ direction, facingOutwards: alignment > 0 }).toStrictEqual({
          direction,
          facingOutwards: true,
        })
      }
    }),
  )

  it.effect('the two triangles share the 0-2 diagonal and cover the quad once', () =>
    Effect.sync(() => {
      // `(0,1,2)` and `(0,2,3)` — `greedy-meshing-accumulator.ts:173-174`. The
      // other legal split, `(0,1,2)` + `(2,3,0)`, has the same winding and the
      // same coverage, so this pins the reference's choice rather than a
      // correctness property; the golden buffer test below is what makes that
      // choice worth pinning.
      const built = buildChunkGeometry([quad(), quad()])

      expect([...built.indices]).toStrictEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    }),
  )
})

describe('ambient occlusion is per FACE and reaches all four vertices', () => {
  it.effect('aoShade transcribes the reference table and saturates outside it', () =>
    Effect.sync(() => {
      // `AO_COLOR_BY_LEVEL = [255, 204, 153, 102]`,
      // `greedy-meshing-accumulator.ts:10`.
      expect([...AO_SHADE_BY_LEVEL]).toStrictEqual([255, 204, 153, 102])
      expect([0, 1, 2, 3].map(aoShade)).toStrictEqual([255, 204, 153, 102])

      // Saturating, not throwing: a quad with an out-of-range `ao` is a mesher
      // bug, and a renderer that threw would take the frame down over shading.
      expect(aoShade(-1)).toBe(255)
      expect(aoShade(AO_MAX + 1)).toBe(102)
      expect(aoShade(1.9)).toBe(204)

      // `Math.trunc`/`Math.max`/`Math.min` all propagate NaN, so `clamped` is
      // NaN here despite the [0, AO_MAX] clamp above it — the one input the
      // header comment's "cannot miss" argument does not cover. The `??
      // AO_DARKEST` fallback is reachable after all, and degrades to the
      // documented conservative direction rather than returning `undefined`.
      expect(aoShade(Number.NaN)).toBe(102)
    }),
  )

  it.effect('all four vertices of a quad carry the same shade, and it tracks the level', () =>
    Effect.sync(() => {
      // BOTH HALVES, because either alone is satisfied by a constant: "all four
      // agree" passes for a builder that writes 255 everywhere, and "it tracks
      // the level" passes for one that shades only the first vertex.
      for (let level = 0; level <= AO_MAX; level += 1) {
        const built = buildChunkGeometry([quad({ ao: level })])
        const expected = aoShade(level)

        for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex += 1) {
          expect({ level, vertex, color: vertexColor(built.colors, vertex) }).toStrictEqual({
            level,
            vertex,
            color: [expected, expected, expected],
          })
        }
      }
    }),
  )

  it.effect('two quads with different AO get different shades in one buffer', () =>
    Effect.sync(() => {
      // The per-quad write must be indexed by the quad. A builder that computed
      // the shade once outside the loop passes every test above.
      const built = buildChunkGeometry([quad({ ao: 0 }), quad({ ao: AO_MAX })])

      expect(vertexColor(built.colors, 0)).toStrictEqual([255, 255, 255])
      expect(vertexColor(built.colors, VERTICES_PER_QUAD)).toStrictEqual([102, 102, 102])
    }),
  )
})

describe('UVs are in block units and follow the same transposition', () => {
  it.effect('a merged quad tiles once per block rather than stretching one tile', () =>
    Effect.sync(() => {
      // `greedy-meshing-accumulator.ts:153-156`: "keeping UVs in block units
      // lets the shader repeat the selected atlas tile once per block instead
      // of stretching one texel tile across the whole merged face."
      const built = buildChunkGeometry([quad({ direction: 'yPos', width: 4, height: 3 })])

      expect([...built.uvs].slice(0, VERTICES_PER_QUAD * UV_COMPONENTS)).toStrictEqual([
        0, 0, 0, 3, 4, 3, 4, 0,
      ])
    }),
  )

  it.effect('the x-facing directions transpose (u, v) and the other four do not', () =>
    Effect.sync(() => {
      // The same swap `quadCorners` applies, in the attribute where getting it
      // wrong is invisible until a texture is bound — i.e. months later.
      expect(quadUvExtent(quad({ direction: 'xPos', width: 4, height: 3 }))).toStrictEqual([3, 4])
      expect(quadUvExtent(quad({ direction: 'xNeg', width: 4, height: 3 }))).toStrictEqual([3, 4])
      expect(quadUvExtent(quad({ direction: 'yPos', width: 4, height: 3 }))).toStrictEqual([4, 3])
      expect(quadUvExtent(quad({ direction: 'yNeg', width: 4, height: 3 }))).toStrictEqual([4, 3])
      expect(quadUvExtent(quad({ direction: 'zPos', width: 4, height: 3 }))).toStrictEqual([4, 3])
      expect(quadUvExtent(quad({ direction: 'zNeg', width: 4, height: 3 }))).toStrictEqual([4, 3])
    }),
  )

  it.effect('the UV extent equals the world extent along the same two axes', () =>
    Effect.sync(() => {
      // The property that makes the swap CHECKABLE rather than merely stated:
      // whatever `quadUvExtent` says the u extent is, the geometry must span
      // that far along the axis the reference's u ran along. For the x
      // directions that axis is z, for the rest it is x.
      for (const direction of DIRECTIONS) {
        const built = buildChunkGeometry([quad({ direction, width: 4, height: 3 })])
        const [uExtent, vExtent] = quadUvExtent(quad({ direction, width: 4, height: 3 }))
        const uAxis: QuadAxis = uAxisFor(direction)
        const vAxis: QuadAxis = vAxisFor(direction)

        expect({ direction, u: extentAlong(built.positions, uAxis) }).toStrictEqual({
          direction,
          u: uExtent,
        })
        expect({ direction, v: extentAlong(built.positions, vAxis) }).toStrictEqual({
          direction,
          v: vExtent,
        })
      }
    }),
  )
})

describe('buffer shape and conservation', () => {
  it.effect('every array is exactly sized for the quad count', () =>
    Effect.sync(() => {
      const built = buildChunkGeometry([quad(), quad(), quad()])

      expect(built.quadCount).toBe(3)
      expect(built.vertexCount).toBe(3 * VERTICES_PER_QUAD)
      expect(built.indexCount).toBe(3 * INDICES_PER_QUAD)
      expect(built.positions.length).toBe(built.vertexCount * POSITION_COMPONENTS)
      expect(built.normals.length).toBe(built.vertexCount * POSITION_COMPONENTS)
      expect(built.colors.length).toBe(built.vertexCount * COLOR_COMPONENTS)
      expect(built.uvs.length).toBe(built.vertexCount * UV_COMPONENTS)
      expect(built.indices.length).toBe(built.indexCount)
    }),
  )

  it.effect('no index ever points past the position attribute', () =>
    Effect.sync(() => {
      // A WebGL error rather than a wrong picture, and one the fake `three` in
      // `test/support/fake-three.ts` explicitly says it cannot detect.
      const built = buildChunkGeometry([quad(), quad(), quad(), quad()])
      const vertexSlots = built.positions.length / POSITION_COMPONENTS

      for (const index of built.indices) {
        expect(index).toBeLessThan(vertexSlots)
      }
    }),
  )

  it.effect('the normal is the face normal, repeated for all four vertices', () =>
    Effect.sync(() => {
      for (const direction of DIRECTIONS) {
        const built = buildChunkGeometry([quad({ direction })])
        const normal = faceNormal(direction)

        for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex += 1) {
          const base = vertex * POSITION_COMPONENTS
          expect({
            direction,
            vertex,
            normal: [built.normals[base], built.normals[base + 1], built.normals[base + 2]],
          }).toStrictEqual({ direction, vertex, normal: [...normal] })
        }
      }
    }),
  )

  it.effect('an empty quad list produces empty buffers and allocates nothing', () =>
    Effect.sync(() => {
      // The normal case at the edge of the loaded world, not an error. It is
      // also what `computeBoundingSphere` exists to be called on — see
      // `application/three-surface.ts`.
      const built = buildChunkGeometry([])

      expect(built.quadCount).toBe(0)
      expect(built.positions.length).toBe(0)
      expect(built.indices.length).toBe(0)
      // The same frozen value every time: an empty chunk must not cost five
      // allocations, and there are many of them.
      expect(buildChunkGeometry([]).positions).toBe(built.positions)
    }),
  )

  it.effect('totalQuadArea counts covered block faces, not quads', () =>
    Effect.sync(() => {
      // mc-meshing's own invariant, mirrored: merging REDUCES the quad count
      // and must not move the area. Stated here so that a caller can compare a
      // geometry against the faces it was built from without importing
      // mc-meshing, which this repository cannot do — see the module header.
      const merged = [quad({ width: 4, height: 3 })]
      const unmerged = Array.from({ length: 12 }, () => quad({ width: 1, height: 1 }))

      expect(totalQuadArea(merged)).toBe(12)
      expect(totalQuadArea(unmerged)).toBe(12)
      expect(buildChunkGeometry(merged).quadCount).toBe(1)
      expect(buildChunkGeometry(unmerged).quadCount).toBe(12)
    }),
  )
})

describe('GOLDEN: one merged top face, every byte', () => {
  it.effect('a 2x3 yPos quad at (1, 4, 2) with ao 1 emits exactly this', () =>
    Effect.sync(() => {
      // plan.md §3.3 asks for golden tests that hash a geometry buffer, and
      // mc-meshing's `domain/faces.ts` warns that changing the canonical order
      // invalidates "every golden hash in this repository and in mc-render".
      // This is mc-render's, written out rather than hashed: a hash tells you
      // that something moved and this tells you what.
      const built = buildChunkGeometry(
        [{ blockId: 3, direction: 'yPos', role: 'top', lx: 1, y: 4, lz: 2, width: 2, height: 3, ao: 1 }],
        0,
        0,
      )

      expect([...built.positions]).toStrictEqual([
        1, 5, 2,
        1, 5, 5,
        3, 5, 5,
        3, 5, 2,
      ])
      expect([...built.normals]).toStrictEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
      expect([...built.colors]).toStrictEqual([
        204, 204, 204,
        204, 204, 204,
        204, 204, 204,
        204, 204, 204,
      ])
      expect([...built.uvs]).toStrictEqual([0, 0, 0, 3, 2, 3, 2, 0])
      expect([...built.indices]).toStrictEqual([0, 1, 2, 0, 2, 3])
    }),
  )
})
