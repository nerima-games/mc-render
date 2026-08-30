/**
 * The water material, as data, including the geometry fact that drives its
 * `forceSinglePass` decision.
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
 * THE `forceSinglePass` POLICY FOR A FLAT SURFACE
 * ---------------------------------------------------------------------------
 *
 * `domain/material-policy.ts` owns the material rule. This file supplies the
 * truthful geometry fact that water is a flat surface and applies the same
 * rule as every other material.
 *
 * The rule is:
 *
 *     requiresForceSinglePass = shared && takesTwoPassPath && (isCutout || flatSurface)
 *
 * The reference's water material (water-material.ts:127-138) is
 * `transparent: true`, `side: DoubleSide`, shared by every water mesh, and has
 * `alphaTest: 0`, truthfully preserving THREE's default. `flatSurface: true`
 * records that the greedy-meshed water geometry is a surface quad, not a
 * closed volume.
 *
 * THREE's two-pass transparent path is useful for a closed translucent volume:
 * it draws back faces before front faces. A water surface has no far wall, so
 * that intra-material ordering buys nothing. Inter-object sorting between
 * separate water quads is unaffected by `forceSinglePass`.
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

import { type MaterialSpec } from './material-policy.js'

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

/**
 * The `[0, 1]` range several water quantities clamp into: depth factor, colour
 * mix/blend amount, Fresnel cosine, and sun intensity. Shared across the
 * Palette, Refraction and Fresnel, and Sun response sections below.
 */
const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1

/** Clamp into `[0, 1]`; a non-finite input (`NaN`, `±Infinity`) clamps to the bottom of the range. */
const clampUnitInterval = (value: number): number => {
  if (!Number.isFinite(value)) {
    return UNIT_INTERVAL_MIN
  }
  return Math.min(UNIT_INTERVAL_MAX, Math.max(UNIT_INTERVAL_MIN, value))
}

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
export const WATER_SHALLOW_COLOR: WaterColor = { a: 0.84, b: 0.78, g: 0.38, r: 0.13 }

/** Water seen at a glancing angle. `deepColor` at water-material.ts:84. */
export const WATER_DEEP_COLOR: WaterColor = { a: 0.92, b: 0.45, g: 0.12, r: 0.03 }

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
  const factor = WATER_DEPTH_FACTOR_FLOOR + (UNIT_INTERVAL_MAX - fresnel) * WATER_DEPTH_FACTOR_RANGE
  return Math.min(UNIT_INTERVAL_MAX, Math.max(UNIT_INTERVAL_MIN, factor))
}

/** Mix two colours channel-wise. `blendFactor` is clamped, so callers need not be careful. */
export const mixWaterColor = (from: WaterColor, to: WaterColor, blendFactor: number): WaterColor => {
  const clampedBlend = clampUnitInterval(blendFactor)
  return {
    a: from.a + (to.a - from.a) * clampedBlend,
    b: from.b + (to.b - from.b) * clampedBlend,
    g: from.g + (to.g - from.g) * clampedBlend,
    r: from.r + (to.r - from.r) * clampedBlend,
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
  /** Below this, an index of refraction is not physical. */
  const MIN_VALID_IOR = 0
  /** No reflectance is reported for a non-physical IOR, rather than an extrapolated value. */
  const NO_REFLECTANCE = 0
  if (!Number.isFinite(ior) || ior <= MIN_VALID_IOR) {
    return NO_REFLECTANCE
  }
  /** `n1` in the Schlick formula above: air's index of refraction. */
  const AIR_INDEX_OF_REFRACTION = 1
  const ratio = (AIR_INDEX_OF_REFRACTION - ior) / (AIR_INDEX_OF_REFRACTION + ior)
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
  const clamped = clampUnitInterval(cosTheta)
  const base = UNIT_INTERVAL_MAX - clamped
  const squared = base * base
  const quintic = squared * squared * base
  return WATER_FRESNEL_F0 + (UNIT_INTERVAL_MAX - WATER_FRESNEL_F0) * quintic
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
/** `waveApprox`'s result for a non-finite input: no displacement. */
const NO_DISPLACEMENT = 0

/** The period divides in half to decide which side of `[0, 2π)` centres negative. */
const HALF_TURN_DIVISOR = 2

/** `wrapped`, or `wrapped` shifted back a full period if it fell in the upper half of `[0, 2π)`. */
const centreWrappedPhase = (wrapped: number): number => {
  if (wrapped > TWO_PI / HALF_TURN_DIVISOR) {
    return wrapped - TWO_PI
  }
  return wrapped
}

export const waveApprox = (radians: number): number => {
  if (!Number.isFinite(radians)) {
    return NO_DISPLACEMENT
  }

  /* Into [0, 2π), then into [-π, π) by subtracting a full period from the upper
   * half rather than by subtracting π from everything. */
  const wrapped = ((radians % TWO_PI) + TWO_PI) % TWO_PI
  const centred = centreWrappedPhase(wrapped)

  return centred * (BHASKARA_LINEAR - BHASKARA_QUADRATIC * Math.abs(centred))
}

/** The period divides in quarters to advance the phase by one quarter-turn. */
const QUARTER_TURN_DIVISOR = 4

/** The cosine of the same approximation. A quarter period ahead. */
export const waveApproxCos = (radians: number): number =>
  waveApprox(radians + TWO_PI / QUARTER_TURN_DIVISOR)

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
  { amplitudeScale: 1, spatialFrequency: 3, temporalSpeed: 1.8 },
  { amplitudeScale: 0.5, spatialFrequency: 2, temporalSpeed: 0.9 },
]

/** The V component's layers. water-material.ts:69. */
export const RIPPLE_LAYERS_V: ReadonlyArray<RippleLayer> = [
  { amplitudeScale: 1, spatialFrequency: 3, temporalSpeed: 1.6 },
  { amplitudeScale: 0.5, spatialFrequency: 2, temporalSpeed: 1.1 },
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

  let uOffset = 0
  for (const layer of RIPPLE_LAYERS_U) {
    uOffset +=
      waveApprox(worldZ * layer.spatialFrequency + timeSecs * layer.temporalSpeed) *
      RIPPLE_AMPLITUDE_UV *
      layer.amplitudeScale
  }

  let vOffset = 0
  for (const layer of RIPPLE_LAYERS_V) {
    vOffset +=
      waveApproxCos(worldX * layer.spatialFrequency + timeSecs * layer.temporalSpeed) *
      RIPPLE_AMPLITUDE_UV *
      layer.amplitudeScale
  }

  return { u: uOffset, v: vOffset }
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
/** `waveApprox`'s peak magnitude before error is added — a `sin`-like approximation is bounded by 1. */
const WAVE_APPROX_PEAK_MAGNITUDE = 1
/** The two ripple layers' amplitude scales (1 and 0.5) sum to this; see `RIPPLE_LAYERS_U`/`_V`. */
const RIPPLE_LAYER_AMPLITUDE_SUM = 1.5

export const MAX_RIPPLE_OFFSET_UV =
  RIPPLE_AMPLITUDE_UV * RIPPLE_LAYER_AMPLITUDE_SUM * (WAVE_APPROX_PEAK_MAGNITUDE + WAVE_APPROX_MAX_ERROR)

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
export const clampSunIntensity = (sunIntensity: number): number => clampUnitInterval(sunIntensity)

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

// --- Material flags ----------------------------------------------------------

/**
 * The water material's properties, as `domain/material-policy.ts` sees them.
 * `alphaTest: 0` is THREE's default for the reference ShaderMaterial. The
 * truthful flat-surface flag supplies the geometry half of the policy.
 */
export const WATER_SURFACE_IS_FLAT = true

export const WATER_MATERIAL_SPEC: MaterialSpec = {
  alphaTest: 0,
  flatSurface: WATER_SURFACE_IS_FLAT,
  name: 'waterSurfaceMaterial',
  shared: true,
  side: 'double',
  transparent: true,
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
