/**
 * How a light level and an ambient-occlusion level become one number a surface
 * is multiplied by. THE SHADING POLICY, as data and arithmetic.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE ANSWERS A QUESTION `./chunk-geometry.ts` EXPLICITLY DECLINED
 * ---------------------------------------------------------------------------
 *
 * That file's `AO_SHADE_BY_LEVEL` comment says, of the reference's shader
 * combination:
 *
 *     The shading is therefore STRONGER than the reference's, by a factor this
 *     file does not attempt to correct — dividing the range here would put a
 *     shader's job in a geometry builder, and the number to divide by is a
 *     property of a shader that has not been written.
 *
 * BOTH HALVES OF THAT ARE STILL TRUE AND THIS FILE CONTRADICTS NEITHER. The
 * geometry builder still does not decide shading — it applies a function it is
 * HANDED (`./chunk-geometry.ts`'s `QuadShade`), and the default is unchanged.
 * What has changed is the second half: the number is no longer "a property of a
 * shader that has not been written", because the combination rule is written
 * HERE, as a pure function, at the coefficients the reference's shader uses.
 * A shader, when it arrives, transcribes this file rather than defining it.
 *
 * ---------------------------------------------------------------------------
 * THE REFERENCE'S CURVE, AND WHY BOTH TERMS HAVE A FLOOR
 * ---------------------------------------------------------------------------
 *
 * TRANSCRIBED from ts-minecraft's chunk fragment shader
 * (`packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:135`):
 *
 *     diffuse *= (0.45 + 0.55 * light) * (0.8 + 0.2 * R)
 *
 * with `light` and `R` each already normalised to 0..1. Two independent
 * multipliers, and each one is an AFFINE map onto a range that does not reach
 * zero:
 *
 *   LIGHT spans 0.45 .. 1.00. An unlit cave face is 45% lit, not black. That is
 *   a playability decision, not a physical one: a fully black surface is
 *   indistinguishable from a hole in the world, and a player who cannot tell
 *   "unlit floor" from "pit" falls into it. Minecraft itself does the same
 *   thing and calls it ambient light.
 *
 *   AO spans 0.80 .. 1.00, a 20% range. Corner darkening is a depth CUE and
 *   competes with light for the same output; at a wider range it reads as dirt
 *   in the corners rather than as shape.
 *
 * The two are multiplied and not added, so an unlit inside corner lands at
 * 0.45 * 0.8 = 0.36 rather than at 0.25 — the floors compose multiplicatively,
 * which is what keeps the darkest legal surface visible.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT PACK R = AO, G = SKY, B = BLOCK — WHICH THE REFERENCE DOES
 * ---------------------------------------------------------------------------
 *
 * `./chunk-geometry.ts`'s `ChunkGeometryBuffers.colors` documents the reference's
 * layout and says "the two other channels become sky and block light unchanged
 * when a grid arrives". A grid has arrived. THE CHANNELS ARE STILL NOT PACKED,
 * and the reason is a prerequisite that was not written down anywhere:
 *
 *   PACKING REQUIRES A SHADER TO UNPACK. `application/world-renderer.ts` builds
 *   a `MeshBasicMaterial` with `vertexColors: true`, which multiplies the base
 *   colour by the vertex colour DIRECTLY. Feed it R = AO, G = sky, B = block
 *   and it does not compute the formula above — it renders those three numbers
 *   as a colour. A sunlit surface becomes green, a torch-lit one blue. The
 *   world would look like a fault, and the fault would be in the material.
 *
 *   `application/three-surface.ts` has no `ShaderMaterial`. Its own header says
 *   `MeshBasicMaterial` is "the only one this repository can construct today
 *   because it is the only one that needs no light in the scene", and that
 *   "when a lit material and a light arrive, they arrive together".
 *
 * So the missing thing is a NOUN and it can be named: `ShaderMaterial` in
 * `application/three-surface.ts`, plus the GLSL pair that decodes the channels.
 * Until it exists, the honest output for an unlit material is a GREY MULTIPLIER
 * — one number written to all three channels — which is what `./chunk-geometry.ts`
 * already produces for AO alone, and what `combinedShadeByte` below produces for
 * AO and light together.
 *
 * THE FORMULA IS THE SAME EITHER WAY. Pre-combining on the CPU and decoding in a
 * shader compute the identical value; they differ in WHEN, and therefore in
 * whether a chunk must be re-meshed when the light changes. Pre-combined means a
 * torch placed at dusk re-meshes its neighbourhood; packed-plus-shader means the
 * grid is re-uploaded and the geometry is untouched. That is the real argument
 * for packing, it is a performance argument, and it belongs in the change that
 * adds the shader — with a measurement, which this repository has eight recorded
 * reasons to insist on.
 */
import { LIGHT_LEVEL_MAX, clampLightLevel } from '@nerima-games/mc-kernel'
import {
  type FaceDirection,
  type QuadColor,
  type QuadShade,
  aoShade,
  faceNormal,
  greyQuadColor,
} from './chunk-geometry'

/**
 * The two light values at a point: how much of it is daylight and how much is
 * emitted by blocks.
 *
 * STRUCTURALLY IDENTICAL to one reading from mc-worldgen's `ChunkLight`, which
 * holds two packed `Uint8Array`s (`sky` and `block`) and answers `getLightAt`
 * per voxel. It is NOT a mirror of that type and deliberately is not: mc-worldgen
 * owns two GRIDS and the nibble packing, this repository wants two NUMBERS at a
 * face, and mirroring the storage would drag `LIGHT_BYTE_LENGTH`, the nibble
 * order and the voxel index across a boundary that has no use for any of them.
 *
 * The seam is an injected sampler instead — the pattern this project records as
 * having settled three separate ownership disputes (`transparentBlockIds`,
 * `IsRailAt`, `BlockAt`): the owner answers a question, the consumer states the
 * question's shape.
 */
export type SkyBlockLight = {
  /** Daylight reaching this point, 0..15. Attenuated by `skyIntensity`. */
  readonly sky: number
  /** Light emitted by blocks, 0..15. Not attenuated: a torch is a torch at night. */
  readonly block: number
}

/** Fully lit, from both sources. The reading for a face with no grid behind it. */
export const FULL_LIGHT: SkyBlockLight = { block: LIGHT_LEVEL_MAX, sky: LIGHT_LEVEL_MAX }

/** Fully dark. The reading for a sealed cave face. */
export const NO_LIGHT: SkyBlockLight = { block: 0, sky: 0 }

/**
 * The floor of the light term: how lit a surface at level 0 still draws.
 *
 * TRANSCRIBED from the reference shader's `0.45 +`. See this file's header on
 * why it is not 0 — a black surface and a hole in the world look identical, and
 * only one of them can be walked on.
 */
export const LIGHT_SHADE_FLOOR = 0.45

/** The span above the floor. `LIGHT_SHADE_FLOOR + LIGHT_SHADE_RANGE === 1`. */
export const LIGHT_SHADE_RANGE = 0.55

/** The maximum value of an 8-bit colour channel. The units `colors` is uploaded in. */
export const MAX_SHADE_BYTE = 255

/** The floor of the AO term. TRANSCRIBED from the reference shader's `0.8 +`. */
export const AO_SHADE_FLOOR = 0.8

/** The span above it. A 20% range: AO is a depth cue, not a second light. */
export const AO_SHADE_RANGE = 0.2

/** A fully bright, unoccluded surface. Both terms at 1, so their product is 1. */
export const MAX_SHADE_FACTOR = 1

/**
 * The effective light level at a point, 0..15.
 *
 * `max` and not a sum, which is the rule the whole light model rests on:
 * standing in a torch-lit room at noon is not brighter than the brighter of the
 * two sources. A sum would saturate at 15 almost everywhere outdoors and erase
 * every torch in daylight — the two grids exist SEPARATELY precisely so that
 * this combination is a choice made at read time rather than at propagation
 * time.
 *
 * `skyIntensity` attenuates the sky term only. It is the day/night cycle's one
 * input to shading, and 1 (noon) is the caller's decision rather than a default
 * here for the same reason `application/world-renderer.ts` fixes
 * `SKY_CLEAR_COLOR` at the day value: there is no day/night cycle in this
 * organisation and no owner for one, so a default would invent an authority.
 * The block term is NOT attenuated — a torch is as bright at midnight.
 *
 * Both readings are clamped, because they arrive through an injected sampler
 * and `@nerima-games/mc-kernel.ts`'s `clampLightLevel` header lists a host-supplied
 * function as exactly the seam an out-of-range value comes through.
 */
export const effectiveLightLevel = (light: SkyBlockLight, skyIntensity: number): number =>
  Math.max(clampLightLevel(light.sky) * Math.min(Math.max(skyIntensity, 0), 1), clampLightLevel(light.block))

/**
 * The light term of the product: `0.45 + 0.55 * (level / 15)`.
 *
 * Takes a LEVEL and not a fraction, so the division by `LIGHT_LEVEL_MAX` happens
 * in exactly one place. The reference's shader receives a pre-normalised value
 * because normalisation is free on the GPU side of an attribute upload; here it
 * is a division, and a division written twice is a denominator that can be
 * updated once.
 */
export const lightShadeFactor = (level: number): number =>
  LIGHT_SHADE_FLOOR + LIGHT_SHADE_RANGE * (Math.min(Math.max(level, 0), LIGHT_LEVEL_MAX) / LIGHT_LEVEL_MAX)

/**
 * The AO term of the product: `0.8 + 0.2 * (shade / 255)`.
 *
 * Reads `aoShade` from `./chunk-geometry.ts` rather than re-deriving a curve
 * from the level, and that is the load-bearing detail. `AO_SHADE_BY_LEVEL` is
 * `[255, 204, 153, 102]` — even steps of 51 — so a reader could reasonably
 * write `1 - level / AO_MAX * something` and get a curve that agrees at the
 * endpoints and differs in the middle. The reference's shader is fed that TABLE,
 * normalised, so the table is what this must consume.
 *
 * `aoShade` also carries the saturating behaviour for out-of-range levels, which
 * a re-derivation would silently drop.
 */
export const aoShadeFactor = (aoLevel: number): number =>
  AO_SHADE_FLOOR + AO_SHADE_RANGE * (aoShade(aoLevel) / MAX_SHADE_BYTE)

/**
 * Vanilla Minecraft's fixed per-face brightness. THE TERM THAT MAKES A CUBE
 * LOOK LIKE A CUBE.
 *
 * TRANSCRIBED from the reference's vertex shader
 * (`chunk-mesh-materials.ts:92`), whose own comment names it "vanilla
 * Minecraft's fixed per-face brightness":
 *
 *     vFaceFactor = normal.y > 0.5 ? 1.0
 *                 : normal.y < -0.5 ? 0.5
 *                 : abs(normal.x) > 0.5 ? 0.6
 *                 : 0.8
 *
 * It is a constant per DIRECTION and depends on nothing else — not the light,
 * not the sun, not the time of day. That is exactly what makes it the term you
 * notice when it is missing: without it, the six faces of an evenly lit block
 * all draw at the same brightness and the block reads as a flat hexagon rather
 * than as a solid. Every other term in this file varies with the world; this one
 * is what gives geometry its shape when the world is uniform.
 *
 * IT IS NOT A LIGHTING MODEL AND IS NOT MEANT TO BE. A physically-motivated
 * version would shade by the angle between the face and the sun, which moves,
 * and the reference deliberately does not: fixed factors mean a wall looks the
 * same at dawn and at noon, which is what makes voxel terrain readable. The X
 * and Z sides differ (0.6 against 0.8) for the same reason — nothing physical
 * distinguishes them, and giving the two horizontal axes different values is
 * what stops a corner between them from vanishing.
 *
 * Written over `FaceDirection` rather than over the normal vector, which is a
 * deviation from the transcription and is the safer direction: the reference
 * reconstructs the direction from the normal with three float comparisons
 * because a shader has only the normal, whereas `MeshQuad.direction` is the
 * direction, named. Comparing `normal.y > 0.5` against a normal that is exactly
 * `[0, 1, 0]` is unambiguous, but it is a float test standing in for an enum,
 * and this repository has the enum.
 */
export const FACE_BRIGHTNESS: Readonly<Record<FaceDirection, number>> = {
  xNeg: 0.6,
  xPos: 0.6,
  yNeg: 0.5,
  yPos: 1,
  zNeg: 0.8,
  zPos: 0.8,
}

/** The fixed brightness of a face direction. Total by the type of the table. */
export const faceBrightness = (direction: FaceDirection): number => FACE_BRIGHTNESS[direction]

/**
 * The whole curve: light, occlusion and face direction, multiplied.
 *
 * All three terms of the reference's fragment shader
 * (`chunk-mesh-materials.ts:128`):
 *
 *     diffuseColor.rgb *= (0.45 + 0.55 * lightFactor) * (0.8 + 0.2 * aoFactor) * vFaceFactor
 *
 * Range is `[0.45 * 0.8 * 0.5, 1] = [0.18, 1]`. The darkest legal surface is an
 * unlit, fully occluded, DOWNWARD face — which is the underside of an overhang
 * in a cave, and is meant to be the darkest thing in the world.
 *
 * Note that the floor is no longer 0.36: adding the face term lowers it,
 * because `yNeg` contributes 0.5. That is the reference's range and not a
 * regression, and it is the reason `LIGHT_SHADE_FLOOR` can afford to be as high
 * as 0.45 — the face term supplies the rest of the contrast.
 */
export const combinedShadeFactor = (
  light: SkyBlockLight,
  aoLevel: number,
  skyIntensity: number,
  direction: FaceDirection = 'yPos',
): number =>
  lightShadeFactor(effectiveLightLevel(light, skyIntensity)) *
  aoShadeFactor(aoLevel) *
  faceBrightness(direction)

/**
 * The curve, as the 0..255 byte `./chunk-geometry.ts` writes into all three
 * colour channels.
 *
 * `Math.round` and not `Math.trunc`: this is a quantisation of a continuous
 * value onto a display scale, where round is the unbiased choice, unlike
 * `clampLightLevel` where trunc preserves the fact that an input was invalid.
 * Truncating would darken every surface by up to one 255th and, more to the
 * point, would make a fully lit unoccluded face 254 rather than 255 — an
 * off-by-one at the exact value a test is most likely to assert.
 */
export const combinedShadeByte = (
  light: SkyBlockLight,
  aoLevel: number,
  skyIntensity: number,
  direction: FaceDirection = 'yPos',
): number => Math.round(combinedShadeFactor(light, aoLevel, skyIntensity, direction) * MAX_SHADE_BYTE)

/**
 * Where a face's light is read from: the block the face LOOKS INTO, not the one
 * it belongs to.
 *
 * A solid block's own voxel is dark — light does not propagate into stone — so
 * sampling there would shade every surface in the world at level 0 and produce a
 * uniformly dim scene that still responds to nothing. The lit cell is the
 * neighbour across the face, which is the air the player sees it from, and it is
 * reached by stepping ONE BLOCK ALONG THE FACE NORMAL from a point on the face.
 *
 * The point chosen is the quad's MINIMUM corner, offset half a block along each
 * tangent so that the sample sits inside the first cell the quad covers rather
 * than on the seam between two. For a merged quad this is one reading for a
 * surface that may span sixteen blocks with different light in each — a real
 * approximation, and the same one the merge itself makes for AO: `MeshQuad.ao`
 * is one value per face because per-vertex AO and greedy merging are
 * incompatible (`./chunk-geometry.ts`'s header). Light is not in the merge key,
 * so unlike AO it can genuinely vary across a merged quad. THAT IS THE COST OF
 * PRE-COMBINING, it is stated here rather than discovered, and it is the second
 * argument for the packed-channel path — a shader samples per fragment.
 */
export const lightSamplePoint = (
  quad: { readonly lx: number; readonly y: number; readonly lz: number },
  normal: readonly [number, number, number],
): readonly [number, number, number] => [
  quad.lx + normal[0] + (normal[0] === 0 ? 0.5 : 0),
  quad.y + normal[1] + (normal[1] === 0 ? 0.5 : 0),
  quad.lz + normal[2] + (normal[2] === 0 ? 0.5 : 0),
]

/**
 * The question this repository asks a light grid, and the whole of it.
 *
 * Chunk-LOCAL coordinates, matching `MeshQuad`'s, because the quad is what the
 * caller has and converting to world coordinates here would need the chunk
 * origin — a second parameter that exists only to be undone by the sampler.
 * `lightSamplePoint` may return a coordinate OUTSIDE the chunk (a face on the
 * boundary looks into the neighbour), which is deliberate: mc-worldgen's store
 * owns neighbour lookup, and a sampler that cannot answer for `lx = -1` should
 * return `NO_LIGHT` rather than make this repository handle chunk edges.
 */
export type LightSampler = (x: number, y: number, z: number) => SkyBlockLight

/**
 * A sampler for a world with no light grid: everything fully lit.
 *
 * THE HONEST ABSENCE, in the sense `NO_DRAW_TARGET` and `UNAVAILABLE_POINTER_LOCK`
 * are — not a fake that pretends. FULL rather than NO light because that is the
 * reading which makes `lightShadeFactor` return 1 and leaves the AO term alone,
 * so composing this sampler reproduces `AO_ONLY_SHADE` exactly. A dark default
 * would make "no grid wired up yet" and "sealed in a cave" indistinguishable,
 * and the first is a configuration mistake that should look like nothing.
 */
export const FULLY_LIT: LightSampler = () => FULL_LIGHT

/** Everything a caller may vary about the shading. Each default is argued above. */
export type ShadingOptions = {
  /** 0..1. The day/night cycle's one input. Defaults to noon; there is no cycle. */
  readonly skyIntensity?: number
}

/**
 * Bind a light sampler and the curve into the `QuadShade` `buildChunkGeometry`
 * takes.
 *
 * THIS IS THE SEAM. Everything above is arithmetic over numbers and everything
 * below `buildChunkGeometry` is typed arrays; this function is the only place
 * the two meet, and it holds no state, so a host can build one per chunk or one
 * for the world.
 *
 * `faceNormal` is imported from `./chunk-geometry.ts` rather than re-derived,
 * for the reason that file's `quadCorners` documents at length: the six
 * direction-to-vector mappings are a table two people can each get right
 * independently and still disagree about. A sampler stepping the wrong way on
 * one direction would read light from INSIDE the solid block for that face —
 * one sixth of the world uniformly black, which reads as a texture problem.
 */
export const litShade = (
  sampler: LightSampler,
  options: ShadingOptions = {},
): QuadShade => {
  const skyIntensity = options.skyIntensity ?? 1
  return (quad) => {
    const [x, y, z] = lightSamplePoint(quad, faceNormal(quad.direction))
    return combinedShadeByte(sampler(x, y, z), quad.ao, skyIntensity, quad.direction)
  }
}

/** `litShade` as the `QuadColor` the geometry builder takes. Grey, three times. */
export const litColor = (sampler: LightSampler, options: ShadingOptions = {}): QuadColor =>
  greyQuadColor(litShade(sampler, options))

/**
 * The OTHER path: `R = AO, G = sky, B = block`, for a fragment shader to
 * combine.
 *
 * The reference's packing (`greedy-meshing-accumulator.ts:131-134`, decoded at
 * `chunk-mesh-materials.ts:123-128`), and the reason `./chunk-geometry.ts`'s
 * colour hook returns three channels instead of one.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT THE DEFAULT, AND FEEDING IT TO THE WRONG MATERIAL IS SPECTACULAR
 * ---------------------------------------------------------------------------
 *
 * These bytes are three unrelated quantities that happen to be stored in
 * channels named red, green and blue. A `MeshBasicMaterial` — which is what
 * `application/world-renderer.ts` builds today — multiplies them as a COLOUR:
 * a sunlit unoccluded face has `G = 255, B = 0` and renders bright green, a
 * torchlit one renders blue. The failure is loud, which is the one good thing
 * about it.
 *
 * `./chunk-shader.ts` is the decode, and `chunkFragmentShader` is generated
 * from the SAME constants `combinedShadeByte` uses, so the two paths cannot
 * drift into computing different pictures.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS AT ALL, GIVEN THE CPU PATH ALREADY WORKS
 * ---------------------------------------------------------------------------
 *
 * Not speed of the arithmetic — that is a handful of multiplies either way.
 * WHEN the arithmetic happens:
 *
 *   PRE-COMBINED, a torch placed at dusk changes the answer for every face
 *   around it, so those chunks must be RE-MESHED — the shade is baked into the
 *   vertex buffer.
 *
 *   PACKED, the same torch changes only what the shader reads, and
 *   `uSunIntensity` moving with the day/night cycle costs nothing at all.
 *   Geometry is untouched.
 *
 * `skyIntensity` is therefore absent here on purpose: it is a uniform in this
 * path, not a bake-time constant, and accepting one would let a caller bake the
 * time of day into a buffer whose whole point is that it does not have to.
 *
 * The face term is absent for the same reason — the shader derives it from the
 * normal, which it already has. `chunkVertexShader` carries it.
 */
export const packedLightColor =
  (sampler: LightSampler): QuadColor =>
  (quad) => {
    const [x, y, z] = lightSamplePoint(quad, faceNormal(quad.direction))
    const light = sampler(x, y, z)
    return [
      // R: the AO table's own byte, NOT the level. The shader's `0.8 + 0.2 * R`
      // expects a 0..1 fraction, and `normalized: true` on the attribute divides
      // by 255 — so the byte that must be here is the one an unlit material
      // would have shown.
      aoShade(quad.ao),
      // G, B: levels scaled onto the byte range, so the shader's `max(sky *
      // uSunIntensity, block)` operates on 0..1 fractions.
      Math.round((clampLightLevel(light.sky) / LIGHT_LEVEL_MAX) * MAX_SHADE_BYTE),
      Math.round((clampLightLevel(light.block) / LIGHT_LEVEL_MAX) * MAX_SHADE_BYTE),
    ]
  }
