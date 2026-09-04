import { type Dimension, isDimension } from '@nerima-games/mc-kernel'

/** The drawing surface's size in device-independent pixels. */
export type Viewport = {
  readonly width: number
  readonly height: number
}

/** A deterministic, renderer-independent description of daylight and distance fog. */
export type RenderEnvironmentPlan = {
  readonly dimension: Dimension
  readonly daylight: number
  readonly sunIntensity: number
  readonly skyColor: number
  readonly fogColor: readonly [number, number, number]
  readonly fogNear: number
  readonly fogFar: number
}

export const DAY_SKY_COLOR = 0x87ceeb
export const NIGHT_SKY_COLOR = 0x232a45

/**
 * The nether's clear and fog colour: a warm, sunless haze, with no day/night
 * cycle and no visible sky. The same colour clears the canvas and fills the
 * fog, because there is nothing past the fog for the two to differ over. Not
 * a transcription — this package has no reference asset for a dimension it
 * did not previously render — chosen to read as an enclosing atmosphere
 * rather than a lit one, and distinct from both `DAY_SKY_COLOR` and
 * `NIGHT_SKY_COLOR`.
 */
export const NETHER_FOG_COLOR = 0x3c1e18

/**
 * The end's clear colour: a dark, sunless void. Darker than
 * `NIGHT_SKY_COLOR`, but deliberately not pure black —
 * `application/world-renderer.ts`'s `SKY_CLEAR_COLOR` documents why a
 * cleared canvas should not be indistinguishable from one that failed to
 * draw at all, and the same concern applies here. A starfield is a real
 * rendering feature — geometry, not colour — and is deliberately not part of
 * this preset; it is a named follow-up, not an oversight.
 */
export const END_VOID_COLOR = 0x0a0714

export const DEFAULT_ENVIRONMENT_FAR_PLANE = 300

/** The dimension a caller gets when it does not say otherwise. */
export const DEFAULT_DIMENSION: Dimension = 'overworld'

/** The `[0, 1]` range `clamp01` clamps into. */
const NORMALIZED_MIN = 0
const NORMALIZED_MAX = 1

/** `value`, or the bottom of the normalized range when it is not a finite number (e.g. `NaN`). */
const finiteOrMin = (value: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return NORMALIZED_MIN
}

const clamp01 = (value: number): number =>
  Math.min(NORMALIZED_MAX, Math.max(NORMALIZED_MIN, finiteOrMin(value)))

/** `dimension`, or `DEFAULT_DIMENSION` when it is not one `@nerima-games/mc-kernel`'s `isDimension` recognizes. */
const resolveDimension = (dimension: Dimension): Dimension => {
  if (isDimension(dimension)) {
    return dimension
  }
  return DEFAULT_DIMENSION
}

/**
 * Place value of each channel in a packed `0xRRGGBB` color — the divisor that
 * shifts it down to the low byte, and the multiplier that shifts it back up.
 * Arithmetic equivalents of the `>> shift` / `<< shift` this file used to do:
 * every color here is a non-negative 24-bit integer, so `color / place` (then
 * truncated) and `component * place` behave exactly like the bit shifts they
 * replace, without `no-bitwise`.
 */
const RED_PLACE_VALUE = 65536
const GREEN_PLACE_VALUE = 256
const BLUE_PLACE_VALUE = 1
/** How many distinct values a single byte holds; extracts one channel via modulo. */
const BYTE_RANGE = 256
/** The maximum a single channel byte can be, and so the divisor that normalizes it to `[0, 1]`. */
const CHANNEL_MAX = 0xff

const channel = (color: number, placeValue: number): number =>
  Math.floor(color / placeValue) % BYTE_RANGE

const interpolateColor = (from: number, to: number, amount: number): number => {
  const interpolate = (placeValue: number): number =>
    Math.round(channel(from, placeValue) + (channel(to, placeValue) - channel(from, placeValue)) * amount)
  return (
    interpolate(RED_PLACE_VALUE) * RED_PLACE_VALUE +
    interpolate(GREEN_PLACE_VALUE) * GREEN_PLACE_VALUE +
    interpolate(BLUE_PLACE_VALUE) * BLUE_PLACE_VALUE
  )
}

/**
 * The overworld's sky colour is the day/night interpolation this file has
 * always done. The nether and end ignore `daylight` entirely: neither has a
 * day/night cycle, so there is nothing for the scalar to drive.
 */
const skyColorFor = (dimension: Dimension, daylight: number): number => {
  if (dimension === 'nether') {
    return NETHER_FOG_COLOR
  }
  if (dimension === 'end') {
    return END_VOID_COLOR
  }
  return interpolateColor(NIGHT_SKY_COLOR, DAY_SKY_COLOR, daylight)
}

/** No skylight: neither the nether nor the end has an open sky to light the world from above. */
const NO_SKYLIGHT = 0

/** The overworld lights from `daylight`; the nether and end have no sky to light from. */
const sunIntensityFor = (dimension: Dimension, daylight: number): number => {
  if (dimension === 'overworld') {
    return daylight
  }
  return NO_SKYLIGHT
}

/** The nearest valid far plane below `MIN_FAR_PLANE` falls back to the default. */
const MIN_FAR_PLANE = 0

const resolveFarPlane = (farPlane: number): number => {
  if (Number.isFinite(farPlane) && farPlane > MIN_FAR_PLANE) {
    return farPlane
  }
  return DEFAULT_ENVIRONMENT_FAR_PLANE
}

/** The overworld's and end's fog: starts at 45% of the far plane and ends at 90%, so it never clips the far plane itself. */
const FOG_NEAR_FACTOR = 0.45
const FOG_FAR_FACTOR = 0.9

/**
 * The nether's fog interval, as a fraction of the far plane: much tighter
 * than `FOG_NEAR_FACTOR`/`FOG_FAR_FACTOR`, so the haze closes in well short of
 * the far plane regardless of view distance — the enclosing atmosphere the
 * nether is known for.
 */
const NETHER_FOG_NEAR_FACTOR = 0.05
const NETHER_FOG_FAR_FACTOR = 0.3

type FogFactors = {
  readonly far: number
  readonly near: number
}

const fogFactorsFor = (dimension: Dimension): FogFactors => {
  if (dimension === 'nether') {
    return { far: NETHER_FOG_FAR_FACTOR, near: NETHER_FOG_NEAR_FACTOR }
  }
  return { far: FOG_FAR_FACTOR, near: FOG_NEAR_FACTOR }
}

/** Full daylight, the state `DEFAULT_RENDER_ENVIRONMENT` renders. */
const FULL_DAYLIGHT = 1

/** Build the complete environment state before touching THREE or uniform boxes. */
export const planRenderEnvironment = (
  daylight: number,
  farPlane: number = DEFAULT_ENVIRONMENT_FAR_PLANE,
  dimension: Dimension = DEFAULT_DIMENSION,
): RenderEnvironmentPlan => {
  const safeDaylight = clamp01(daylight)
  const safeFar = resolveFarPlane(farPlane)
  const safeDimension = resolveDimension(dimension)
  const skyColor = skyColorFor(safeDimension, safeDaylight)
  const { far: farFactor, near: nearFactor } = fogFactorsFor(safeDimension)
  return {
    daylight: safeDaylight,
    dimension: safeDimension,
    fogColor: [
      channel(skyColor, RED_PLACE_VALUE) / CHANNEL_MAX,
      channel(skyColor, GREEN_PLACE_VALUE) / CHANNEL_MAX,
      channel(skyColor, BLUE_PLACE_VALUE) / CHANNEL_MAX,
    ],
    fogFar: safeFar * farFactor,
    fogNear: safeFar * nearFactor,
    skyColor,
    sunIntensity: sunIntensityFor(safeDimension, safeDaylight),
  }
}

export const DEFAULT_RENDER_ENVIRONMENT = planRenderEnvironment(FULL_DAYLIGHT)
