/**
 * The particle GLSL, generated from `./particle-pool.ts`'s constants.
 *
 * Third shader in the repository and the same discipline as the first two: no
 * number is typed here that is declared there. `./chunk-shader.ts`'s header
 * argues the case at length.
 *
 * ---------------------------------------------------------------------------
 * THE ATTRIBUTE NAMES ARE THE CONTRACT WITH THE POOL, AND ARE DECLARED ONCE
 * ---------------------------------------------------------------------------
 *
 * `PARTICLE_INSTANCE_ATTRIBUTES` below names the three per-instance buffers,
 * and `application/particle-system.ts` binds `ParticlePool`'s typed arrays to
 * exactly those names. The pairing is checked in
 * `test/particle-shader.test.ts` by reading BOTH sides, because this repository
 * has now found the same defect twice in two days — a shader declaring an input
 * nothing produced (`tileIndex`), and a domain declaring uniform names no
 * adapter bound (`WATER_UNIFORM_NAMES`) — and in both cases every suite
 * involved was green, because each file was checked against itself.
 *
 * The stride constants are the load-bearing part of the pairing and are the
 * part a reader skims. `PARTICLE_VECTOR_STRIDE` is 3 and `PARTICLE_UV_STRIDE`
 * is 2; binding `uvOffsets` with itemSize 3 would not throw, would not fail to
 * link, and would read every particle's V from the next particle's U — a
 * diagonal smear through the atlas that looks like a texture bug.
 *
 * ---------------------------------------------------------------------------
 * WHY THE QUAD IS BILLBOARDED IN THE VERTEX STAGE
 * ---------------------------------------------------------------------------
 *
 * A particle is a flat square and has to face the camera, and there are two
 * places to arrange that: rotate each instance on the CPU, or build the quad in
 * view space on the GPU. The pool exists to keep the CPU out of the frame path
 * — five typed arrays written once per spawn and integrated in place — so a
 * per-particle rotation on the CPU would undo the thing the pool is for.
 *
 * In view space the camera's right and up axes are the first two columns of the
 * model-view matrix, so the billboard is two multiply-adds and no branch. That
 * is also why the base geometry is a UNIT quad centred on the origin: its
 * corners are directions, not positions, and the instance's own position is
 * added afterwards.
 */
import {
  PARTICLE_ALPHA_TEST,
  PARTICLE_QUAD_SIZE_M,
  PARTICLE_UV_SPAN,
  PARTICLE_UV_STRIDE,
  PARTICLE_VECTOR_STRIDE,
} from './particle-pool'
import { glslFloat } from './chunk-shader'

/**
 * The per-instance attributes, with the stride each one is bound at.
 *
 * A RECORD AND NOT THREE STRING CONSTANTS, so that the adapter can iterate it
 * and cannot bind a buffer the shader does not declare or miss one it does.
 * `CHUNK_SHADER_UNIFORMS` in `./chunk-shader.ts` is the same move; this one
 * additionally carries the stride because a particle attribute has one and
 * getting it wrong is silent.
 */
export const PARTICLE_INSTANCE_ATTRIBUTES = {
  /** World position of the particle's centre, in metres. */
  position: { name: 'instancePosition', stride: PARTICLE_VECTOR_STRIDE },
  /** The lifetime fade in `[0, 1]`. 0 is a free slot and is invisible. */
  scale: { name: 'instanceScale', stride: 1 },
  /** The atlas tile origin this particle samples. */
  uvOffset: { name: 'instanceUvOffset', stride: PARTICLE_UV_STRIDE },
} as const

/** The uniform names a host has to bind. */
export const PARTICLE_SHADER_UNIFORMS = {
  /** `sampler2D`. The same atlas the chunks sample. */
  atlas: 'uAtlas',
} as const

/**
 * The vertex stage: billboard the unit quad, scale it, place it, pick the tile.
 *
 * `instanceScale` multiplies `PARTICLE_QUAD_SIZE_M` rather than replacing it,
 * which is what makes the fade a FADE rather than a resize to an arbitrary
 * size: the pool writes a 0..1 value and the physical size of a full-strength
 * particle stays the one constant that declares it.
 *
 * A ZERO SCALE COLLAPSES THE QUAD TO A POINT, and that is the mechanism by
 * which a free slot is invisible — `ParticlePool` documents `scales` as "0 for
 * a free slot", so the dead instances that `instanceCount` has not yet excluded
 * still render as nothing. Two independent guards for the same thing, and the
 * cheaper one is the one that cannot be got wrong by an off-by-one.
 */
export const particleVertexShader = (): string => `
attribute vec3 ${PARTICLE_INSTANCE_ATTRIBUTES.position.name};
attribute float ${PARTICLE_INSTANCE_ATTRIBUTES.scale.name};
attribute vec2 ${PARTICLE_INSTANCE_ATTRIBUTES.uvOffset.name};

varying vec2 vUv;
varying float vScale;

void main() {
  vUv = ${PARTICLE_INSTANCE_ATTRIBUTES.uvOffset.name} + uv * ${glslFloat(PARTICLE_UV_SPAN)};
  vScale = ${PARTICLE_INSTANCE_ATTRIBUTES.scale.name};

  // The camera's right and up axes in world space are the first two COLUMNS of
  // the model-view matrix read as rows — see this file's header. The quad's own
  // position supplies the two coefficients.
  vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
  vec3 up = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);

  float size = ${glslFloat(PARTICLE_QUAD_SIZE_M)} * ${PARTICLE_INSTANCE_ATTRIBUTES.scale.name};
  vec3 offset = (right * position.x + up * position.y) * size;
  vec3 world = ${PARTICLE_INSTANCE_ATTRIBUTES.position.name} + offset;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`

/**
 * The fragment stage: sample the atlas, discard the cutout.
 *
 * `discard` AND NOT A BLEND, because `PARTICLE_MATERIAL_SPEC` declares
 * `alphaTest: 0.5` and that is what an alpha test IS — the fragment does not
 * exist rather than being mixed at low weight. The distinction is visible: a
 * blended cutout writes depth for fully transparent pixels and the square
 * outline of every particle occludes what is behind it.
 *
 * `PARTICLE_WRITES_DEPTH` is false and is NOT expressed here, because it is a
 * material flag rather than a shader statement. `application/particle-system.ts`
 * carries it. This is the same split `WATER_WRITES_DEPTH` has and it is worth
 * noticing that a shader cannot enforce it.
 */
export const particleFragmentShader = (): string => `
uniform sampler2D ${PARTICLE_SHADER_UNIFORMS.atlas};

varying vec2 vUv;
varying float vScale;

void main() {
  vec4 texel = texture2D(${PARTICLE_SHADER_UNIFORMS.atlas}, vUv);

  // The cutout. A free slot has scale 0 and is already degenerate, but a
  // fading one is not, and its texel alpha is what decides.
  if (texel.a < ${glslFloat(PARTICLE_ALPHA_TEST)}) {
    discard;
  }

  gl_FragColor = vec4(texel.rgb, texel.a * vScale);
}
`

/** Everything needed to construct the particle material, as one value. */
export type ParticleShaderSource = {
  readonly vertexShader: string
  readonly fragmentShader: string
  readonly attributeNames: ReadonlyArray<string>
  readonly uniformNames: ReadonlyArray<string>
}

/** The pair, plus the names an adapter has to bind. Derived, never restated. */
export const particleShaderSource = (): ParticleShaderSource => ({
  attributeNames: Object.values(PARTICLE_INSTANCE_ATTRIBUTES).map((attribute) => attribute.name),
  fragmentShader: particleFragmentShader(),
  uniformNames: Object.values(PARTICLE_SHADER_UNIFORMS),
  vertexShader: particleVertexShader(),
})

/**
 * The unit quad every particle instance is a copy of.
 *
 * CENTRED ON THE ORIGIN, so the corners read as directions and the billboard in
 * the vertex stage is a scale-and-add. A corner-anchored quad would put the
 * particle's pivot at its bottom-left and every particle would appear offset
 * half a size up and right of where the pool says it is — a discrepancy small
 * enough to look like a physics tuning problem.
 */
/** Half the quad's edge length in local space; the quad spans `[-HALF, HALF]` on x and y. */
const QUAD_HALF_EXTENT = 0.5
/** The quad is flat in local space: every corner shares this z. */
const QUAD_LOCAL_Z = 0

export const PARTICLE_QUAD_POSITIONS: ReadonlyArray<number> = [
  -QUAD_HALF_EXTENT,
  -QUAD_HALF_EXTENT,
  QUAD_LOCAL_Z,
  QUAD_HALF_EXTENT,
  -QUAD_HALF_EXTENT,
  QUAD_LOCAL_Z,
  QUAD_HALF_EXTENT,
  QUAD_HALF_EXTENT,
  QUAD_LOCAL_Z,
  -QUAD_HALF_EXTENT,
  QUAD_HALF_EXTENT,
  QUAD_LOCAL_Z,
]

/** The two ends of the `[0, 1]` UV range each corner sits at. */
const UV_MIN = 0
const UV_MAX = 1

/** The base quad's UVs, in the same winding. `vUv` scales these by the tile span. */
export const PARTICLE_QUAD_UVS: ReadonlyArray<number> = [
  UV_MIN,
  UV_MIN,
  UV_MAX,
  UV_MIN,
  UV_MAX,
  UV_MAX,
  UV_MIN,
  UV_MAX,
]

/** The quad's four corners, in `PARTICLE_QUAD_POSITIONS`/`PARTICLE_QUAD_UVS` order. */
const QUAD_CORNER_A = 0
const QUAD_CORNER_B = 1
const QUAD_CORNER_C = 2
const QUAD_CORNER_D = 3

/** Two triangles, sharing the diagonal. Matches `chunk-geometry.ts`'s winding. */
export const PARTICLE_QUAD_INDICES: ReadonlyArray<number> = [
  QUAD_CORNER_A,
  QUAD_CORNER_B,
  QUAD_CORNER_C,
  QUAD_CORNER_A,
  QUAD_CORNER_C,
  QUAD_CORNER_D,
]
