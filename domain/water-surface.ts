/**
 * The water material, as data — and the one material the `forceSinglePass` rule
 * does not classify.
 *
 * ---------------------------------------------------------------------------
 * What is here and what belongs to the mesher
 * ---------------------------------------------------------------------------
 *
 * docs/responsibility.md §2 gives this repository 「水面 / 水マテリアル・屈折」.
 * It gives mc-meshing the GEOMETRY, and that division is sharper than it looks:
 *
 *   FLUID SURFACE HEIGHT — where the top of the water sits in a partially filled
 *   block — and FLOW DIRECTION are mc-meshing's, and NOTHING IN THIS FILE
 *   COMPUTES EITHER. They arrive as vertex data. The reference agrees by
 *   construction: its water vertex shader (water-material.ts:24-34) does no
 *   displacement at all, under a comment saying why —
 *
 *     // No vertex displacement — greedy-meshed quads have only 4 vertices per
 *     // face, so Y-displacement creates visible polygon warping rather than
 *     // smooth waves. All animation is done in the fragment shader instead.
 *
 *   which is the same boundary stated as a rendering consequence: a greedy quad
 *   has no interior vertices to displace, so waves have to be shading rather
 *   than shape.
 *
 * So this file is the SHADING: a colour palette, a Fresnel term, a ripple field,
 * a sun response, and the material flags. All of it is arithmetic over numbers
 * and all of it is checkable in Node, which is what docs/testing.md §3.1 asks
 * for. None of it is a `ShaderMaterial`; that is the adapter's, on the far side
 * of the `three` seam.
 *
 * ---------------------------------------------------------------------------
 * THE `forceSinglePass` QUESTION, WHICH WATER DOES NOT ANSWER CLEANLY
 * ---------------------------------------------------------------------------
 *
 * `domain/material-policy.ts` states a three-condition rule and this file's job
 * is to APPLY it rather than to re-derive it. Applying it is what turned up the
 * following, so it is written out in full.
 *
 * The rule (material-policy.ts:140-141):
 *
 *     requiresForceSinglePass = shared && takesTwoPassPath && isCutout
 *
 * The reference's water material (water-material.ts:127-138) is
 * `transparent: true`, `side: DoubleSide`, shared by every water mesh, and has
 * NO `alphaTest` — so `alphaTest` is 0 and `isCutout` is false. Feed it to
 * `describeMaterialPolicy` and the verdict is `review-sharing`, whose remedy
 * text is 「Un-share the material instead, or accept the program-cache cost
 * deliberately.」
 *
 * THE REFERENCE DID NEITHER. It set `forceSinglePass: true`
 * (water-material.ts:137), and material-policy.ts's own header lists that line
 * at :67-68 as one of the four correct applications of the rule.
 *
 * So the predicate and the prose around it disagree, about a material the prose
 * names. Which is right? The prose, and here is the argument, which is why this
 * file layers rather than edits:
 *
 *   material-policy.ts:62-63 states the criterion as 「each one is a cutout OR A
 *   FLAT SURFACE where the ordering buys nothing」, and then :92-96 encodes only
 *   the cutout half, on the grounds that `alphaTest > 0` is 「the rule rather
 *   than listing the materials by name」. The flat-surface half has no
 *   expression in `MaterialSpec` at all, so the predicate cannot see it.
 *
 *   Water is the witness. THREE's two-pass transparent path draws a material's
 *   back faces and then its front faces, and it exists so a closed translucent
 *   volume shows its far wall before its near one. A water surface is not a
 *   volume — it is a single plane, greedy-meshed, and exactly one of its two
 *   faces is toward the camera at any moment. There is no far wall. The ordering
 *   the second pass buys is between two faces that are never both visible, so it
 *   buys nothing, and that holds whether the camera is above the surface or
 *   under it.
 *
 *   The ordering that DOES matter for water — one water quad behind another at a
 *   different depth — is inter-object sorting, which `forceSinglePass` does not
 *   touch. It splits one material's draw into two passes; it has no opinion
 *   about the order of objects within a pass.
 *
 * Hence: the flag is correct on water, and the predicate is UNDER-INCLUSIVE.
 *
 * WHAT THIS FILE DOES ABOUT IT, and what it deliberately does not:
 *
 *   It does NOT edit `requiresForceSinglePass`. Widening a shipped predicate
 *   from `cutout` to `cutout || flat` needs a `flat` field on `MaterialSpec`
 *   that nothing currently produces, changes the verdict of a rule four other
 *   materials are already judged by, and is a decision about a shared file
 *   rather than about water.
 *
 *   It does NOT fudge water's `alphaTest` to a non-zero number so the predicate
 *   returns the desired answer. That would be editing the data to satisfy the
 *   rule, and the resulting `MaterialSpec` would be a lie about a real material.
 *
 *   It states the missing clause as its own value — `WATER_SURFACE_IS_FLAT` —
 *   and composes it with the shared rule in `waterForceSinglePassVerdict`. The
 *   adapter gets a correct answer, `material-policy.ts` keeps its own, and the
 *   disagreement stays visible instead of being absorbed. `test/water-surface.test.ts`
 *   pins BOTH: that the shared rule says `review-sharing`, and that the composed
 *   verdict says force it. If someone later widens the predicate, the first of
 *   those tests fails and leads them here.
 *
 * ---------------------------------------------------------------------------
 * The refraction index, which the reference never writes down
 * ---------------------------------------------------------------------------
 *
 * water-material.ts:74 says 「Schlick Fresnel (F0 = 0.02 for water)」 and stops
 * there. 0.02 is therefore TRANSCRIBED. But unlike most of the constants in this
 * port it is DERIVABLE, and deriving it converts a magic number into a checked
 * one:
 *
 *     F0 = ((n1 - n2) / (n1 + n2))^2
 *
 * for light passing from air (n = 1) into water (n = 1.333) gives 0.020373...,
 * which rounds to 0.02. `WATER_INDEX_OF_REFRACTION` and `fresnelF0ForIor` below
 * record that, and a test asserts the reference's 0.02 agrees with the
 * derivation to within a rounding step. That is a stronger statement than
 * transcription: it says the number is not merely copied correctly, it is the
 * right number for the substance.
 *
 * ---------------------------------------------------------------------------
 * The sine approximation, and a figure attached to the wrong function
 * ---------------------------------------------------------------------------
 *
 * The ripple field is built from a polynomial sine approximation rather than
 * `sin`, to avoid a GPU transcendental. The reference's, at
 * water-material.ts:50-56:
 *
 *     // Parabolic sin approximation: 4x(1-|x|) normalized to [-π,π] range
 *     // Max error ~0.056 — imperceptible for water distortion
 *     float fastSin(float x) {
 *       x = mod(x, 6.2831853) - 3.1415926;
 *       float ax = abs(x);
 *       return x * (1.2732395 - 0.4052847 * ax);
 *     }
 *
 * The polynomial is Bhaskara's: `(4/π)x - (4/π²)x|x|`, and `1.2732395` and
 * `0.4052847` are 4/π and 4/π² to seven places. Its maximum error against `sin`
 * on `[-π, π]` is 0.05600972, at x = 2.66962. So `~0.056` is exactly right —
 * ABOUT THE POLYNOMIAL.
 *
 * IT IS NOT RIGHT ABOUT `fastSin`. GLSL's `mod(x, y)` is `x - y*floor(x/y)`,
 * which returns a value in `[0, y)`. So for any x, `mod(x, 2π) - π` is the
 * argument x reduced into `[-π, π)` AND SHIFTED BY π — the function evaluates
 * the polynomial at `x - π`, and therefore approximates `sin(x - π)`, which is
 * `-sin(x)`. Measured over `[-20, 20]`: maximum error against `sin` is
 * 2.0000000; against `-sin` it is 0.05600979.
 *
 * `fastSin` computes minus sine. The ~0.056 in the comment is a true fact about
 * a function one sign away from the one it labels — the same shape of error as
 * the `p95 33ms -> 9.2ms` provenance problem material-policy.ts:23-35 documents,
 * and worth naming as such rather than quietly fixing.
 *
 * IT IS HARMLESS WHERE THE REFERENCE USES IT, which is why it survived: the only
 * consumer is the two-layer ripple offset (water-material.ts:66-70), and
 * negating an oscillating distortion field inverts the ripple phase and nothing
 * else. Nobody can see a wave pattern's absolute phase.
 *
 * `waveApprox` below therefore approximates `sin`, with the sign the name
 * claims, and reduces the argument with a modulo that is correct for negative
 * inputs — JavaScript's `%` keeps the sign of the dividend, unlike GLSL's `mod`,
 * so a literal transcription would have been wrong in a THIRD way. The 0.056
 * bound is asserted by a test that samples the domain rather than quoted from
 * the reference, because this repository can actually evaluate it.
 *
 * ---------------------------------------------------------------------------
 * What needs a screenshot and is not tested here
 * ---------------------------------------------------------------------------
 *
 * Whether the water LOOKS like water. The palette is defended in the reference
 * by 「the water must read clearly darker and more saturated than the sky or
 * lakes vanish into the horizon haze」 (water-material.ts:81-82) — a judgement
 * about an image, settled by looking at one. Nothing in this file can check it,
 * and the numbers below are transcribed on the reference's authority. Same for
 * the ripple frequencies, the two sky gradients, and whether 0.86 is the right
 * surface alpha. docs/testing.md §1's fixture-and-screenshot row is where those
 * belong.
 */

import { describeMaterialPolicy, type MaterialPolicyVerdict, type MaterialSpec } from './material-policy'

// --- The uniform vocabulary -------------------------------------------------

/**
 * The uniforms the water shader takes.
 *
 * Transcribed from `WaterMaterialUniforms` (water-material.ts:5-12). A UNION OF
 * NAMES rather than a comment, because the adapter has to write into each of
 * them by string key and a typo in a uniform name is silent in both GLSL and
 * JavaScript — the value simply never arrives and the surface renders with
 * whatever the default was. Nothing throws, so nothing points at the typo.
 */
export type WaterUniformName =
  | 'uTime'
  | 'uRefractionMap'
  | 'uCameraPosition'
  | 'uResolution'
  | 'uRefractionValid'
  | 'uSunIntensity'

/** Every water uniform, for an adapter to assert its own set against. */
export const WATER_UNIFORM_NAMES: ReadonlyArray<WaterUniformName> = [
  'uTime',
  'uRefractionMap',
  'uCameraPosition',
  'uResolution',
  'uRefractionValid',
  'uSunIntensity',
]

/**
 * Which uniforms change every frame, and which do not.
 *
 * Derived from the reference's own split: `updateWaterUniforms`
 * (world-renderer-refraction.ts:203-214) writes `uTime`, `uCameraPosition` and
 * `uSunIntensity` per frame, while `updateWaterResolution` (:226-233) is
 * documented 「Called only on canvas resize, not per-frame」 and
 * `uRefractionMap` is bound once at construction.
 *
 * Recorded because the distinction is a performance contract that is invisible
 * in the shader: `uResolution` written every frame is not a bug that shows on
 * screen, it is a uniform upload nobody needs, and the only way anyone finds it
 * is by reading two files in the right order.
 */
export const PER_FRAME_WATER_UNIFORMS: ReadonlyArray<WaterUniformName> = [
  'uTime',
  'uCameraPosition',
  'uSunIntensity',
]

// --- Palette ----------------------------------------------------------------

/** A linear colour with alpha, each channel in `[0, 1]`. */
export type WaterColor = {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Water seen close to face-on. `shallowColor` at water-material.ts:83.
 *
 * TRANSCRIBED. See the header on what cannot be checked here.
 */
export const WATER_SHALLOW_COLOR: WaterColor = { r: 0.13, g: 0.38, b: 0.78, a: 0.84 }

/** Water seen at a glancing angle. `deepColor` at water-material.ts:84. */
export const WATER_DEEP_COLOR: WaterColor = { r: 0.03, g: 0.12, b: 0.45, a: 0.92 }

/**
 * The alpha the fragment shader forces at the very end, overriding whatever the
 * palette mix produced. `color.a = 0.86` at water-material.ts:107.
 *
 * Worth its own constant precisely BECAUSE it overrides: the two palette colours
 * carry alphas of 0.84 and 0.92 that are mixed and then discarded. Someone
 * tuning `WATER_DEEP_COLOR.a` and seeing no change would otherwise have no way
 * to find out why.
 */
export const WATER_SURFACE_ALPHA = 0.86

/**
 * How the two palette colours are weighted. `depthFactor` at
 * water-material.ts:85: `clamp(0.55 + (1 - fresnel) * 0.4, 0, 1)`.
 *
 * Note the direction, which is easy to invert while reading: a LOW Fresnel term
 * means a steep, face-on view, and that pushes the factor UP toward
 * `WATER_DEEP_COLOR`. Looking straight down into water is the deep case; looking
 * across it at a glancing angle is the shallow one, because at a glancing angle
 * you are seeing reflection rather than depth.
 */
export const WATER_DEPTH_FACTOR_FLOOR = 0.55

/**
 * The span the Fresnel term moves the depth factor across. `* 0.4` at
 * water-material.ts:85.
 *
 * NAMED RATHER THAN INLINE because `./water-shader.ts` interpolates it into the
 * GLSL. The two implementations of this expression — this one and the fragment
 * stage's — must not be two hand-written copies: a shader whose depth mix
 * disagrees with the CPU's throws nothing and type-checks, and the symptom is
 * water that is the wrong blue at some angles, which reads as a palette opinion
 * rather than a defect. Same argument `./voxel-lighting.ts` makes for
 * `LIGHT_SHADE_FLOOR` and `LIGHT_SHADE_RANGE`.
 */
export const WATER_DEPTH_FACTOR_RANGE = 0.4

export const waterDepthFactor = (fresnel: number): number => {
  const factor = WATER_DEPTH_FACTOR_FLOOR + (1 - fresnel) * WATER_DEPTH_FACTOR_RANGE
  return Math.min(1, Math.max(0, factor))
}

/** Mix two colours channel-wise. `t` is clamped, so callers need not be careful. */
export const mixWaterColor = (from: WaterColor, to: WaterColor, t: number): WaterColor => {
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  return {
    r: from.r + (to.r - from.r) * k,
    g: from.g + (to.g - from.g) * k,
    b: from.b + (to.b - from.b) * k,
    a: from.a + (to.a - from.a) * k,
  }
}

/** The water tint at a given Fresnel term. `waterTint` at water-material.ts:86. */
export const waterTint = (fresnel: number): WaterColor =>
  mixWaterColor(WATER_SHALLOW_COLOR, WATER_DEEP_COLOR, waterDepthFactor(fresnel))

// --- Refraction and Fresnel -------------------------------------------------

/**
 * Water's index of refraction at visible wavelengths.
 *
 * NOT IN THE REFERENCE — it writes only the resulting F0. This is the physical
 * constant that F0 is derived from, recorded so the derivation can be checked.
 * 1.333 is the standard textbook value for water at room temperature.
 */
export const WATER_INDEX_OF_REFRACTION = 1.333

/**
 * The Fresnel reflectance at normal incidence, for light entering a medium of
 * index `ior` from air.
 *
 * `((n1 - n2) / (n1 + n2))^2` with `n1 = 1`. This is the standard Schlick
 * parameterisation's F0 and it is written as a function rather than as a
 * constant so that the reference's 0.02 can be CHECKED against it rather than
 * merely stored next to it.
 */
export const fresnelF0ForIor = (ior: number): number => {
  if (!Number.isFinite(ior) || ior <= 0) {
    return 0
  }
  const ratio = (1 - ior) / (1 + ior)
  return ratio * ratio
}

/**
 * The F0 the reference uses. `0.02` at water-material.ts:74, 79.
 *
 * Transcribed, and agrees with `fresnelF0ForIor(WATER_INDEX_OF_REFRACTION)` =
 * 0.020373 to a rounding step. A test asserts that agreement, which is what
 * makes this a checked number rather than a copied one.
 */
export const WATER_FRESNEL_F0 = 0.02

/**
 * Schlick's approximation: `F0 + (1 - F0) * (1 - cos θ)^5`.
 *
 * `cosTheta` is the dot product of the view direction and the surface normal, so
 * 1 is face-on and 0 is edge-on. It is clamped at 0 the way the shader clamps it
 * (`max(dot(viewDir, n), 0.0)`, water-material.ts:76) — a negative dot means the
 * normal points away, which after the shader's `gl_FrontFacing` flip at :73
 * should not happen, and treating it as edge-on is the inert reading.
 *
 * The quintic is computed as `f2 * f2 * base`, matching the shader's :77-78 and
 * its stated reason 「to avoid a GPU pow() transcendental」. Written the same way
 * here, rather than with `**`, so the two are visibly the same computation: an
 * adapter comparing this against the GLSL should see one expression, not two
 * that need to be argued equal.
 */
export const schlickFresnel = (cosTheta: number): number => {
  const clamped = Number.isFinite(cosTheta) ? Math.min(1, Math.max(0, cosTheta)) : 0
  const base = 1 - clamped
  const squared = base * base
  const quintic = squared * squared * base
  return WATER_FRESNEL_F0 + (1 - WATER_FRESNEL_F0) * quintic
}

// --- The ripple field -------------------------------------------------------

/**
 * `2π`, to the precision the reference's shader uses (water-material.ts:53).
 *
 * EXPORTED, along with the two Bhaskara coefficients below, because
 * `./water-shader.ts` has to emit this same wave function in GLSL. They were
 * module-private while there was only one implementation; a second one is
 * exactly the circumstance under which a private constant becomes a constant
 * somebody retypes. The GLSL interpolates these three, so the approximation
 * cannot drift between the CPU and the GPU without the interpolation changing.
 */
export const TWO_PI = 6.2831853

/**
 * `4 / π`, the linear coefficient of Bhaskara's parabolic sine.
 * `1.2732395` at water-material.ts:55.
 */
export const BHASKARA_LINEAR = 1.2732395

/**
 * `4 / π²`, the quadratic coefficient. `0.4052847` at water-material.ts:55.
 */
export const BHASKARA_QUADRATIC = 0.4052847

/**
 * The maximum error of `waveApprox` against `Math.sin`, over all finite inputs.
 *
 * 0.056, and this repository MEASURES it rather than quoting it —
 * `test/water-surface.test.ts` samples the domain densely and asserts the
 * maximum observed deviation is under this bound. The exact supremum is
 * 0.05600972 at x = 2.66962; the constant is rounded up so the assertion has
 * somewhere to sit.
 *
 * The reference states the same 0.056 (water-material.ts:51) and states it about
 * a function that does not have it. See the header.
 */
export const WAVE_APPROX_MAX_ERROR = 0.0561

/**
 * A polynomial approximation to `Math.sin`.
 *
 * Bhaskara's parabola, `(4/π)x - (4/π²)x|x|` on `[-π, π]`, with the argument
 * reduced by a modulo THAT IS CORRECT FOR NEGATIVE INPUTS. That last point is
 * the transcription trap: GLSL's `mod(x, y)` returns a value in `[0, y)`, while
 * JavaScript's `%` keeps the sign of the dividend, so `x % TWO_PI` is negative
 * for negative x and the polynomial would be evaluated outside its domain. The
 * `((a % n) + n) % n` form below is the standard fix.
 *
 * Reduced into `[-π, π]` CENTRED, not into `[0, 2π)` then shifted: the shift is
 * what makes the reference's version compute `-sin`. See the header.
 */
export const waveApprox = (x: number): number => {
  if (!Number.isFinite(x)) {
    return 0
  }
  // Into [0, 2π), then into [-π, π) by subtracting a full period from the upper
  // half rather than by subtracting π from everything.
  const wrapped = ((x % TWO_PI) + TWO_PI) % TWO_PI
  const centred = wrapped > TWO_PI / 2 ? wrapped - TWO_PI : wrapped

  return centred * (BHASKARA_LINEAR - BHASKARA_QUADRATIC * Math.abs(centred))
}

/** The cosine of the same approximation. A quarter period ahead. */
export const waveApproxCos = (x: number): number => waveApprox(x + TWO_PI / 4)

/**
 * One layer of the ripple field.
 *
 * The reference inlines two of these per axis (water-material.ts:66-70) as four
 * hand-written expressions. As a table they can be compared at a glance, and the
 * property that matters — that the two layers have DIFFERENT spatial frequencies
 * and DIFFERENT temporal speeds — becomes checkable instead of visual. Two
 * layers at the same frequency sum to one layer, which is a way of quietly
 * losing half the effect while the code still looks like it does two things.
 */
export type RippleLayer = {
  /** Cycles per metre of world space. */
  readonly spatialFrequency: number
  /** Radians per second. */
  readonly temporalSpeed: number
  /** This layer's share of `RIPPLE_AMPLITUDE_UV`. */
  readonly amplitudeScale: number
}

/**
 * Peak UV displacement of the refraction sample. `float s = 0.014` at
 * water-material.ts:66.
 *
 * In SCREEN UV, not world units: the distortion is applied to `screenUV` when
 * sampling the refraction map (:101), so 0.014 is 1.4% of the screen. That is
 * why it does not scale with distance, and why it is the same number regardless
 * of how large the water body is.
 */
export const RIPPLE_AMPLITUDE_UV = 0.014

/**
 * The two ripple layers, transcribed from water-material.ts:67-70.
 *
 * The primary layer runs at frequency 3 and the secondary at 2, with the
 * secondary at half amplitude (`s * 0.5`). Temporal speeds differ per axis in
 * the reference — 1.8/0.9 for the U component and 1.6/1.1 for V — which is what
 * stops the two axes beating in lockstep and producing a visibly diagonal
 * pattern. Both axes are listed rather than one being assumed a copy.
 */
export const RIPPLE_LAYERS_U: ReadonlyArray<RippleLayer> = [
  { spatialFrequency: 3, temporalSpeed: 1.8, amplitudeScale: 1 },
  { spatialFrequency: 2, temporalSpeed: 0.9, amplitudeScale: 0.5 },
]

/** The V component's layers. water-material.ts:69. */
export const RIPPLE_LAYERS_V: ReadonlyArray<RippleLayer> = [
  { spatialFrequency: 3, temporalSpeed: 1.6, amplitudeScale: 1 },
  { spatialFrequency: 2, temporalSpeed: 1.1, amplitudeScale: 0.5 },
]

/** A UV displacement. */
export type RippleOffset = {
  readonly u: number
  readonly v: number
}

/**
 * The screen-UV distortion at a world position and time.
 *
 * Transcribed from water-material.ts:66-70, including the axis crossover: the U
 * displacement is driven by world Z and the V displacement by world X. That
 * looks like a bug and is not — decorrelating the two axes is the point, and
 * driving each from its own coordinate would make the distortion field
 * degenerate along the diagonal.
 *
 * `waveApproxCos` on the V axis, `waveApprox` on U, again matching the
 * reference. The two differ only by a phase quarter, which is another way of
 * saying the axes do not peak together.
 */
export const rippleOffset = (worldX: number, worldZ: number, timeSecs: number): RippleOffset => {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ) || !Number.isFinite(timeSecs)) {
    return { u: 0, v: 0 }
  }

  let u = 0
  for (const layer of RIPPLE_LAYERS_U) {
    u +=
      waveApprox(worldZ * layer.spatialFrequency + timeSecs * layer.temporalSpeed) *
      RIPPLE_AMPLITUDE_UV *
      layer.amplitudeScale
  }

  let v = 0
  for (const layer of RIPPLE_LAYERS_V) {
    v +=
      waveApproxCos(worldX * layer.spatialFrequency + timeSecs * layer.temporalSpeed) *
      RIPPLE_AMPLITUDE_UV *
      layer.amplitudeScale
  }

  return { u, v }
}

/**
 * The largest displacement `rippleOffset` can produce on one axis.
 *
 * `1.5 * RIPPLE_AMPLITUDE_UV`, because the two layers have amplitude scales 1
 * and 0.5 and `waveApprox` is bounded by 1 plus its error. It exists so a test
 * can assert the field STAYS BOUNDED: a distortion that can exceed a few percent
 * of the screen samples the refraction map far from the fragment being shaded,
 * which reads as the water smearing unrelated scenery across itself.
 */
export const MAX_RIPPLE_OFFSET_UV = RIPPLE_AMPLITUDE_UV * 1.5 * (1 + WAVE_APPROX_MAX_ERROR)

// --- Sun response -----------------------------------------------------------

/**
 * Clamp a sun intensity into `[0, 1]`.
 *
 * Transcribed from `updateWaterUniforms` (world-renderer-refraction.ts:213),
 * which clamps on the way IN to the uniform rather than in the shader. Kept on
 * this side for the same reason: the shader multiplies by it twice (:95, :106)
 * and a value outside the range would blow out the colour in one place and
 * invert the sky mix in the other, from one bad write.
 */
export const clampSunIntensity = (sunIntensity: number): number => {
  if (!Number.isFinite(sunIntensity)) {
    return 0
  }
  return Math.min(1, Math.max(0, sunIntensity))
}

/**
 * How much of its colour the surface keeps at a given sun intensity.
 * `0.30 + 0.70 * uSunIntensity` at water-material.ts:106.
 *
 * The floor of 0.30 is the load-bearing part: at midnight the water is dimmed to
 * 30%, NOT to zero. Water that goes fully black at night is water the player
 * walks into, and the 0.30 is what keeps the surface readable as a surface.
 */
export const WATER_SUN_FLOOR = 0.3

/** The span the sun moves the surface brightness across. `0.70` at :106. */
export const WATER_SUN_RANGE = 0.7

export const waterSunAttenuation = (sunIntensity: number): number =>
  WATER_SUN_FLOOR + WATER_SUN_RANGE * clampSunIntensity(sunIntensity)

// --- Material flags, and the policy gap -------------------------------------

/**
 * The water material's properties, as `domain/material-policy.ts` sees them.
 *
 * Transcribed field by field from water-material.ts:127-138:
 *
 *   transparent: true        :131
 *   side: DoubleSide         :133
 *   alphaTest: (absent)      -> 0, the THREE default. NOT a value picked here;
 *                               a `ShaderMaterial` with no `alphaTest` has 0.
 *   shared: true             one material instance is handed to every water
 *                            mesh (world-renderer.ts:110 constructs exactly one)
 *
 * `alphaTest: 0` is the field that makes the shared rule return `review-sharing`
 * for this material. It is recorded truthfully, and the disagreement is handled
 * in `waterForceSinglePassVerdict` rather than by adjusting it. See the header.
 */
export const WATER_MATERIAL_SPEC: MaterialSpec = {
  name: 'waterSurfaceMaterial',
  transparent: true,
  side: 'double',
  alphaTest: 0,
  shared: true,
}

/**
 * `depthWrite: false`. water-material.ts:132.
 *
 * Not part of `MaterialSpec` — the policy has no opinion about it — but it is
 * the other flag that must not be lost in the port, and losing it is invisible
 * in code review. With depth writes on, the nearest water quad occludes every
 * water quad behind it, so a lake renders as one flat sheet and everything
 * underwater disappears.
 */
export const WATER_WRITES_DEPTH = false

/**
 * Whether a water surface is a single plane rather than a closed volume.
 *
 * THE CLAUSE `MaterialSpec` CANNOT EXPRESS, stated as a value so the composed
 * verdict below has something to stand on and so a test can assert on it. It is
 * `true` because water is greedy-meshed as quads at the fluid surface; if water
 * ever becomes a closed shell with a distinct underside, this becomes false and
 * `waterForceSinglePassVerdict` correctly stops recommending the flag.
 *
 * See material-policy.ts:62-63, which states the criterion as 「a cutout OR A
 * FLAT SURFACE」 and then encodes only the first half.
 */
export const WATER_SURFACE_IS_FLAT = true

/**
 * What to do about `forceSinglePass` on the water material.
 *
 * The shared rule, plus the flat-surface clause the shared rule cannot see.
 *
 * Returns `material-policy.ts`'s own verdict type so a caller can treat this
 * exactly like `describeMaterialPolicy` — including the startup audit
 * `auditMaterials` is documented for. The ONLY case it overrides is
 * `review-sharing` on a flat surface, and it says so in the reason string rather
 * than silently returning a different kind, so anyone reading a log gets the
 * argument instead of a verdict they cannot reconstruct.
 *
 * If `WATER_SURFACE_IS_FLAT` were false — water as a closed volume — this
 * returns the shared rule's `review-sharing` untouched, which is the correct
 * answer for genuine translucency and the case material-policy.ts:57-60 warns
 * about by name (「deep water seen from within」).
 */
export const waterForceSinglePassVerdict = (): MaterialPolicyVerdict => {
  const shared = describeMaterialPolicy(WATER_MATERIAL_SPEC)

  if (shared.kind !== 'review-sharing' || !WATER_SURFACE_IS_FLAT) {
    return shared
  }

  return {
    kind: 'must-force-single-pass',
    reason:
      `${WATER_MATERIAL_SPEC.name} is shared, transparent and DoubleSide with alphaTest 0, so ` +
      "material-policy's cutout test returns review-sharing. It is nonetheless a FLAT surface: a " +
      'greedy-meshed water plane is not a closed volume, exactly one of its two faces is toward ' +
      'the camera at any moment, and the two-pass back-then-front ordering therefore resolves ' +
      'nothing. Sorting between separate water quads is inter-object sorting, which ' +
      'forceSinglePass does not affect. Set forceSinglePass: true, as the reference does at ' +
      'water-material.ts:137. material-policy.ts:62-63 states this clause; its predicate encodes ' +
      'only the cutout half of it.',
  }
}
