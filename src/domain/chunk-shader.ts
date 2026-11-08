/**
 * The chunk shader, as GENERATED SOURCE.
 *
 * This closes the two domain-to-GPU seams that the geometry and lighting
 * modules describe: `./voxel-lighting.ts` packs `R = AO, G = sky, B = block`,
 * and `./block-texture-map.ts` assigns a tile to each face. This module
 * resolves both values per fragment. `application/world-renderer-materials.ts`
 * binds the generated source to a `ShaderMaterial` for the production renderer.
 *
 * ---------------------------------------------------------------------------
 * THE STRINGS ARE BUILT FROM THE DOMAIN CONSTANTS, NOT TYPED OUT
 * ---------------------------------------------------------------------------
 *
 * This is the only interesting thing about the file and it is the reason it is
 * a module rather than two string literals.
 *
 * There are now TWO implementations of the same shading formula: the CPU path in
 * `./voxel-lighting.ts` (`combinedShadeFactor`, for an unlit material) and the
 * GPU path here. A hand-written `0.45 + 0.55 * lightFactor` in the fragment
 * source would be a second hand-written copy of a rule that already exists —
 * the defect shape this organisation has SIX recorded instances of, every one of
 * which eventually disagreed with its twin.
 *
 * And this instance would disagree in the worst available way. Two renderers
 * that shade differently do not throw, do not fail a type check, and do not look
 * broken; they look like two builds with different graphics settings. Nobody
 * files that.
 *
 * So `LIGHT_SHADE_FLOOR`, `LIGHT_SHADE_RANGE`, `AO_SHADE_FLOOR`,
 * `AO_SHADE_RANGE`, the four `FACE_BRIGHTNESS` values, `ATLAS_COLUMNS` and
 * `HALF_TEXEL_UV` are all interpolated from their single declarations, and
 * `test/chunk-shader.test.ts` asserts the emitted source contains the same
 * numbers the CPU path computes with. Changing a coefficient changes both
 * paths, or fails.
 *
 * ---------------------------------------------------------------------------
 * A STANDALONE `ShaderMaterial`, WHERE THE REFERENCE PATCHES A LAMBERT ONE
 * ---------------------------------------------------------------------------
 *
 * This is the one deliberate structural deviation, so it is argued rather than
 * asserted.
 *
 * The reference builds a `MeshLambertMaterial` and rewrites three's own
 * generated source in `onBeforeCompile`, by string-replacing `void main() {`,
 * `#include <map_fragment>` and `#include <color_fragment>`
 * (`chunk-mesh-materials.ts:88-129`). It knows this is fragile — it checks all
 * three tokens are present and throws with "terrain shader injection will
 * silently no-op" if any is missing, which is a good instinct and is the only
 * reason the technique is survivable.
 *
 * Three reasons not to carry it here:
 *
 *   THE TOKENS ARE THREE'S PRIVATE SOURCE. `#include <map_fragment>` is an
 *   implementation detail of a version of three, not an API. The reference's
 *   guard converts a silent no-op into a crash, which is better, but the
 *   failure is still a dependency upgrade away and there is nothing a test in
 *   Node can do about it.
 *
 *   IT CANNOT BE TYPED BY `application/three-surface.ts`. That file's whole
 *   discipline is a narrow structural surface proved against the real `three` by
 *   a fixture. `onBeforeCompile` would put a callback taking three's internal
 *   `Shader` object into that surface, and the members being reached are strings
 *   whose CONTENT is the contract — which no type expresses.
 *
 *   THERE IS NO LAMBERT TERM TO PRESERVE. The reference patches a lit material
 *   because it wants three's light handling underneath its own. This repository
 *   has no light in the scene at all — `application/world-renderer.ts` says so
 *   and says why — so the entire lit pipeline being patched would be dead code
 *   around the four lines that matter.
 *
 * A standalone `ShaderMaterial` is two strings and a uniform record. It is fully
 * described by data, it is testable as data, and it adds ONE constructor to the
 * surface instead of an escape hatch into three's internals.
 *
 * WHAT IS GIVEN UP, stated plainly: tone mapping and three's colour-space
 * conversion, all of which the built-in materials get from shader chunks this
 * file does not include. None is wired up in this repository today. When one is
 * wanted it is written here, in source that is generated and checked, rather
 * than inherited from a pipeline nobody chose.
 *
 * ---------------------------------------------------------------------------
 * THE ATLAS RESOLUTION, WHICH IS WHY MERGED QUADS CAN BE TEXTURED AT ALL
 * ---------------------------------------------------------------------------
 *
 * `./chunk-geometry.ts` emits UVs in BLOCK units — a merged 16x1 quad has `u`
 * running 0..16 — and `./block-texture-map.ts`'s header records that feeding
 * those to a plain textured material tiles the whole 512x512 atlas sixteen
 * times across one face, because `RepeatWrapping` repeats the image and not a
 * tile inside it.
 *
 * `fract(vUv)` is the answer, and it is three lines:
 *
 *     vec2 inTile = fract(vUv);                       // 0..1 within one block
 *     vec2 lo = tile origin + half a texel
 *     vec2 hi = tile origin + tile size - half a texel
 *     texture2D(uAtlas, mix(lo, hi, inTile))
 *
 * so the tile repeats once per block along the merged run, and the half-texel
 * inset keeps the sample inside the tile's own pixels under bilinear filtering
 * and mipmapping. `./texture-atlas.ts`'s header derives that inset at length,
 * including the place the reference cancels it on the far edge by pairing an
 * inset origin with an un-inset span. THIS SHADER DOES NOT REPEAT THAT MISTAKE:
 * `lo` and `hi` are both inset, which is `TILE_UV_SPAN` rather than
 * `TILE_UV_PITCH`, and a test checks the emitted arithmetic against
 * `uvPatchStaysInsideTile`.
 *
 * The tile index and animation kind are per-vertex `float` attributes rather
 * than uniforms, because one draw call covers a whole layer and its blocks are
 * not all the same. Animation kind comes from block identity in geometry, not
 * from the atlas assignment, which may share or reassign tiles independently.
 * `floor(v + 0.5)` on the varying side undoes interpolation because every vertex
 * of a quad carries the same value.
 */
import {
  AO_SHADE_FLOOR,
  AO_SHADE_RANGE,
  FACE_BRIGHTNESS,
  LIGHT_SHADE_FLOOR,
  LIGHT_SHADE_RANGE,
} from './voxel-lighting.js'
import {
  ATLAS_COLUMNS,
  ATLAS_PIXELS,
  type AtlasTileIndex,
  AtlasTileIndexSchema,
  HALF_TEXEL_UV,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_UV_SPAN,
} from './texture-atlas.js'
import { type AnimationSeconds, AnimationSecondsSchema } from './animation-clock.js'
import { CHUNK_ANIMATION_KIND, type ChunkAnimationKind } from './chunk-animation-kind.js'
import { Result, Schema } from 'effect'
import { ANIMATED_TEXTURE_FRAMES } from './block-texture-map.js'

/**
 * Render a number as a GLSL float literal.
 *
 * NOT COSMETIC. GLSL is strictly typed and `1` is an `int`: `0.45 + 0.55 * x`
 * compiles, and `1 * x` where `x` is a float does NOT — "wrong operand types,
 * no operation '*' exists". Interpolating `FACE_BRIGHTNESS.yPos`, which is
 * exactly 1, would emit `1` and break the shader at compile time in the
 * browser, where nothing in this repository's Node suite could see it.
 *
 * So every interpolated number goes through here, and a test asserts the
 * emitted source contains no bare integer literal in an arithmetic position.
 * `toFixed` rather than `String`: it guarantees the decimal point that `String(1)`
 * omits, and six places is well inside the precision of the constants involved
 * (the coarsest is 0.05).
 */
const GLSL_FLOAT_DECIMAL_PLACES = 6

export const glslFloat = (value: number): string => value.toFixed(GLSL_FLOAT_DECIMAL_PLACES)

const WATER_FRAMES_PER_SECOND = 1
const LAVA_FRAMES_PER_SECOND = 1
const FIRE_FRAMES_PER_SECOND = 2
const NETHER_PORTAL_FRAMES_PER_SECOND = 1
const END_PORTAL_FRAMES_PER_SECOND = 1
const END_GATEWAY_FRAMES_PER_SECOND = 1
const FRAME_INDEX_HALF_STEP = 0.5
const LAST_FRAME_OFFSET = 1

const CHUNK_ANIMATION_KIND_VALUES = [
  CHUNK_ANIMATION_KIND.none,
  CHUNK_ANIMATION_KIND.water,
  CHUNK_ANIMATION_KIND.lava,
  CHUNK_ANIMATION_KIND.fire,
  CHUNK_ANIMATION_KIND.netherPortal,
  CHUNK_ANIMATION_KIND.endPortal,
  CHUNK_ANIMATION_KIND.endGateway,
] as const

type AnimationFrameSet = Readonly<{
  readonly animationKind: ChunkAnimationKind
  readonly frames: readonly [AtlasTileIndex, ...AtlasTileIndex[]]
  readonly framesPerSecond: number
}>

const ANIMATION_FRAME_SETS: ReadonlyArray<AnimationFrameSet> = [
  {
    animationKind: CHUNK_ANIMATION_KIND.water,
    frames: ANIMATED_TEXTURE_FRAMES.water.water,
    framesPerSecond: WATER_FRAMES_PER_SECOND,
  },
  {
    animationKind: CHUNK_ANIMATION_KIND.lava,
    frames: ANIMATED_TEXTURE_FRAMES.lava.lava,
    framesPerSecond: LAVA_FRAMES_PER_SECOND,
  },
  {
    animationKind: CHUNK_ANIMATION_KIND.fire,
    frames: ANIMATED_TEXTURE_FRAMES.fire.fire,
    framesPerSecond: FIRE_FRAMES_PER_SECOND,
  },
  {
    animationKind: CHUNK_ANIMATION_KIND.netherPortal,
    frames: ANIMATED_TEXTURE_FRAMES.portal.nether_portal,
    framesPerSecond: NETHER_PORTAL_FRAMES_PER_SECOND,
  },
  {
    animationKind: CHUNK_ANIMATION_KIND.endPortal,
    frames: ANIMATED_TEXTURE_FRAMES.portal.end_portal,
    framesPerSecond: END_PORTAL_FRAMES_PER_SECOND,
  },
  {
    animationKind: CHUNK_ANIMATION_KIND.endGateway,
    frames: ANIMATED_TEXTURE_FRAMES.portal.end_gateway,
    framesPerSecond: END_GATEWAY_FRAMES_PER_SECOND,
  },
]

export type ChunkTextureFrameSelectionError = Readonly<{
  readonly _tag: 'ChunkTextureFrameSelectionError'
  readonly reason: 'invalid-input'
}>

export const ChunkTextureFrameSelectionErrorSchema: Schema.Codec<ChunkTextureFrameSelectionError> = Schema.Struct({
  _tag: Schema.Literal('ChunkTextureFrameSelectionError'),
  reason: Schema.Literal('invalid-input'),
})

const ChunkAnimationKindSchema: Schema.Codec<ChunkAnimationKind, (typeof CHUNK_ANIMATION_KIND_VALUES)[number]> =
  Schema.Literals(CHUNK_ANIMATION_KIND_VALUES)

type ChunkTextureFrameSelectionInput = Readonly<{
  readonly animationKind: ChunkAnimationKind
  readonly baseTileIndex: AtlasTileIndex
  readonly timeSeconds: AnimationSeconds
}>

const ChunkTextureFrameSelectionInputSchema: Schema.Codec<ChunkTextureFrameSelectionInput, Readonly<{
  readonly animationKind: number
  readonly baseTileIndex: number
  readonly timeSeconds: number
}>> = Schema.Struct({
  animationKind: ChunkAnimationKindSchema,
  baseTileIndex: AtlasTileIndexSchema,
  timeSeconds: AnimationSecondsSchema,
})

const frameSelectionError: ChunkTextureFrameSelectionError = {
  _tag: 'ChunkTextureFrameSelectionError',
  reason: 'invalid-input',
}

const animationFrameIndex = (timeSeconds: number, framesPerSecond: number, frameCount: number): number | undefined => {
  const framePosition = timeSeconds * framesPerSecond
  if (!Number.isFinite(framePosition)) {
    return undefined
  }
  return Math.floor(framePosition) % frameCount
}

const selectAnimationFrame = ({ animationKind, baseTileIndex, timeSeconds }: ChunkTextureFrameSelectionInput):
  Result.Result<AtlasTileIndex, ChunkTextureFrameSelectionError> => {
  const frameSet = ANIMATION_FRAME_SETS.find((candidate) => candidate.animationKind === animationKind)
  if (frameSet === undefined) {
    return Result.succeed(baseTileIndex)
  }

  const frameIndex = animationFrameIndex(timeSeconds, frameSet.framesPerSecond, frameSet.frames.length)
  if (frameIndex === undefined) {
    return Result.fail(frameSelectionError)
  }
  const [firstFrame] = frameSet.frames
  const frameTile = frameSet.frames.reduce((selectedFrame, candidateFrame, candidateIndex) => {
    if (candidateIndex === frameIndex) {
      return candidateFrame
    }
    return selectedFrame
  }, firstFrame)
  return Result.succeed(frameTile)
}

/** Select an atlas frame from the block-derived animation kind and simulation time. */
export const chunkTextureFrameTile = (input: unknown): Result.Result<AtlasTileIndex, ChunkTextureFrameSelectionError> => {
  const decoded = Schema.decodeUnknownResult(ChunkTextureFrameSelectionInputSchema)(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(frameSelectionError)
  }
  return selectAnimationFrame(decoded.success)
}

const chunkTextureFrameShaderFunction = (): string => {
  const branches = ANIMATION_FRAME_SETS.map(({ animationKind, frames, framesPerSecond }) => {
    const frameSelections = frames.map((frameTile, index) => {
      if (index === frames.length - LAST_FRAME_OFFSET) {
        return `    return ${glslFloat(frameTile)};`
      }
      return `    if (frameIndex < ${glslFloat(index + FRAME_INDEX_HALF_STEP)}) { return ${glslFloat(frameTile)}; }`
    })
    return `  if (animationKind == ${glslFloat(animationKind)}) {
    float frameIndex = mod(floor(time * ${glslFloat(framesPerSecond)}), ${glslFloat(frames.length)});
${frameSelections.join('\n')}
  }`
  })

  return `float chunkTextureFrameTile(float tile, float animationKind, float time) {
${branches.join('\n')}
  return tile;
}`
}

/** Attribute names the geometry must supply. */
export const CHUNK_SHADER_ATTRIBUTES = {
  /** `float`, per vertex. The animated material kind derived from block identity. */
  animationKind: 'animationKind',
  /** `float`, per vertex. Which atlas tile this face draws. */
  tileIndex: 'tileIndex',
} as const

/** Uniform names the host must set. */
export const CHUNK_SHADER_UNIFORMS = {
  /** `sampler2D`. The atlas image. */
  atlas: 'uAtlas',
  /** `vec3`. Linear interpolation target for distance fog. */
  fogColor: 'uFogColor',
  fogFar: 'uFogFar',
  fogNear: 'uFogNear',
  /** `float` 0..1. The day/night cycle's one input; scales the sky channel only. */
  sunIntensity: 'uSunIntensity',
  /** `float`. Tick-derived simulation time in seconds used to select animated atlas frames. */
  time: 'uTime',
} as const

const CHUNK_ALPHA_TEST_UNIFORM = 'uAlphaTest'

/**
 * The vertex stage: pass through material attributes and compute fixed
 * per-face brightness from the normal.
 *
 * THE FACE TERM IS DERIVED FROM THE NORMAL HERE AND FROM `FaceDirection` IN
 * `./voxel-lighting.ts`, and that is a genuine divergence in method rather than
 * a duplication of data — a shader has no enum, only the normal. What keeps the
 * two honest is that the four VALUES come from `FACE_BRIGHTNESS`, which is one
 * declaration; only the dispatch differs. The reference's own comment licenses
 * reading the object-space normal as the world-space direction: "Chunk meshes
 * are never rotated, so the object-space normal IS the world-space face
 * direction."
 *
 * The comparisons are `> 0.5` rather than `== 1.0` because the normals are
 * `Float32Array` values that survived an attribute upload, and float equality
 * across that boundary is the kind of thing that works until a driver
 * normalises differently. 0.5 is unambiguous for a set of unit axis vectors.
 */
export const chunkVertexShader = (): string => `
attribute float ${CHUNK_SHADER_ATTRIBUTES.tileIndex};
attribute float ${CHUNK_SHADER_ATTRIBUTES.animationKind};

varying vec2 vUv;
varying vec3 vColor;
varying float vTileIndex;
varying float vAnimationKind;
varying float vFaceBrightness;
varying float vFogDepth;

void main() {
  vUv = uv;
  vColor = color;
  vTileIndex = ${CHUNK_SHADER_ATTRIBUTES.tileIndex};
  vAnimationKind = ${CHUNK_SHADER_ATTRIBUTES.animationKind};

  // Vanilla Minecraft's fixed per-face brightness. Values from FACE_BRIGHTNESS
  // in domain/voxel-lighting.ts; only the dispatch is normal-based here.
  vFaceBrightness = normal.y > 0.5
    ? ${glslFloat(FACE_BRIGHTNESS.yPos)}
    : (normal.y < -0.5
        ? ${glslFloat(FACE_BRIGHTNESS.yNeg)}
        : (abs(normal.x) > 0.5
            ? ${glslFloat(FACE_BRIGHTNESS.xPos)}
            : ${glslFloat(FACE_BRIGHTNESS.zPos)}));

  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = max(-viewPosition.z, 0.0);
  gl_Position = projectionMatrix * viewPosition;
}
`

/**
 * The fragment stage: resolve the atlas tile, decode the packed light, apply
 * the curve.
 *
 * The three multipliers are the reference's
 * (`chunk-mesh-materials.ts:123-128`), with every coefficient interpolated from
 * `./voxel-lighting.ts` rather than typed — see this file's header on why a
 * second hand-written copy of the formula is the failure that never gets
 * reported.
 *
 * `vColor` arrives as 0..1 because the attribute is uploaded with
 * `normalized: true` (`application/world-renderer.ts` passes `true` for the
 * colour attribute and `false` for every other one, and that asymmetry is
 * exactly this). So no division by 255 appears here, and the CPU path's
 * `MAX_SHADE_BYTE` has no counterpart in the shader — which is correct rather
 * than an omission.
 */
type ChunkShaderText = string

export const chunkFragmentDeclarations = (includeSunIntensity = true): ChunkShaderText => {
  let sunIntensityDeclaration = ''
  if (includeSunIntensity) {
    sunIntensityDeclaration = `uniform float ${CHUNK_SHADER_UNIFORMS.sunIntensity};`
  }
  return `
uniform sampler2D ${CHUNK_SHADER_UNIFORMS.atlas};
uniform float ${CHUNK_SHADER_UNIFORMS.time};
${sunIntensityDeclaration}
uniform vec3 ${CHUNK_SHADER_UNIFORMS.fogColor};
uniform float ${CHUNK_SHADER_UNIFORMS.fogNear};
uniform float ${CHUNK_SHADER_UNIFORMS.fogFar};
uniform float ${CHUNK_ALPHA_TEST_UNIFORM};

varying vec2 vUv;
varying vec3 vColor;
varying float vTileIndex;
varying float vAnimationKind;
varying float vFaceBrightness;
varying float vFogDepth;

const float ATLAS_COLUMNS = ${glslFloat(ATLAS_COLUMNS)};
const float HALF_TEXEL = ${glslFloat(HALF_TEXEL_UV)};
const float CELL_UV_PITCH = ${glslFloat(TILE_CELL_PIXELS / ATLAS_PIXELS)};
const float TILE_GUTTER_UV = ${glslFloat(TILE_GUTTER_PIXELS / ATLAS_PIXELS)};
const float TILE_UV_SPAN = ${glslFloat(TILE_UV_SPAN)};
`
}

export const chunkFragmentShadeFunction = (): ChunkShaderText => `${chunkTextureFrameShaderFunction()}
vec4 shadeChunkSurface() {
  // Undo the interpolation: every vertex of a quad carries the same index, so
  // the varying is that index up to float error.
  float tile = chunkTextureFrameTile(
    floor(vTileIndex + 0.5),
    floor(vAnimationKind + 0.5),
    ${CHUNK_SHADER_UNIFORMS.time}
  );
  float column = mod(tile, ATLAS_COLUMNS);
  float row = floor(tile / ATLAS_COLUMNS);

  // UVs are in BLOCK units so a merged quad repeats the tile once per block.
  // fract() is what makes that work; see this file's header.
  vec2 inTile = fract(vUv);

  // Cells include edge-extruded gutters; sample only the 16px source image.
  vec2 cellOrigin = vec2(
    column * CELL_UV_PITCH,
    1.0 - (row + 1.0) * CELL_UV_PITCH
  );
  vec2 lo = cellOrigin + vec2(TILE_GUTTER_UV + HALF_TEXEL);
  vec2 hi = lo + vec2(TILE_UV_SPAN);

  vec4 texel = texture2D(${CHUNK_SHADER_UNIFORMS.atlas}, mix(lo, hi, inTile));
  if (texel.a < ${CHUNK_ALPHA_TEST_UNIFORM}) {
    discard;
  }

  // R = ambient occlusion, G = sky light, B = block light. Packed by
  // packedLightColor in domain/voxel-lighting.ts, already 0..1 because the
  // attribute is uploaded normalized.
  float ao = vColor.r;
  float sky = vColor.g;
  float block = vColor.b;

  // max, not sum: standing in a torchlit room at noon is not brighter than the
  // brighter of the two. Only the sky term follows the sun.
  float light = max(sky * ${CHUNK_SHADER_UNIFORMS.sunIntensity}, block);

  float shade =
      (${glslFloat(LIGHT_SHADE_FLOOR)} + ${glslFloat(LIGHT_SHADE_RANGE)} * light)
    * (${glslFloat(AO_SHADE_FLOOR)} + ${glslFloat(AO_SHADE_RANGE)} * ao)
    * vFaceBrightness;

  float fogAmount = smoothstep(
    ${CHUNK_SHADER_UNIFORMS.fogNear},
    ${CHUNK_SHADER_UNIFORMS.fogFar},
    vFogDepth
  );
  return vec4(
    mix(texel.rgb * shade, ${CHUNK_SHADER_UNIFORMS.fogColor}, fogAmount),
    texel.a
  );
}
`

export const chunkFragmentShader = (): string => `${chunkFragmentDeclarations()}${chunkFragmentShadeFunction()}
void main() {
  gl_FragColor = shadeChunkSurface();
}
`

/** Everything needed to construct the material, as one value. */
export type ChunkShaderSource = {
  readonly vertexShader: string
  readonly fragmentShader: string
  readonly attributeNames: ReadonlyArray<string>
  readonly uniformNames: ReadonlyArray<string>
}

/**
 * The pair, plus the names a host has to bind.
 *
 * The name lists are DERIVED from the same records the source interpolates, so
 * a host that iterates them cannot bind a uniform the shader does not declare
 * or miss one it does.
 */
export const chunkShaderSource = (): ChunkShaderSource => ({
  attributeNames: Object.values(CHUNK_SHADER_ATTRIBUTES),
  fragmentShader: chunkFragmentShader(),
  uniformNames: [...Object.values(CHUNK_SHADER_UNIFORMS), CHUNK_ALPHA_TEST_UNIFORM],
  vertexShader: chunkVertexShader(),
})
