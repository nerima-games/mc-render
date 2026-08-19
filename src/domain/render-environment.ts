/** The drawing surface's size in device-independent pixels. */
export type Viewport = {
  readonly width: number
  readonly height: number
}

/** A deterministic, renderer-independent description of daylight and distance fog. */
export type RenderEnvironmentPlan = {
  readonly daylight: number
  readonly sunIntensity: number
  readonly skyColor: number
  readonly fogColor: readonly [number, number, number]
  readonly fogNear: number
  readonly fogFar: number
}

export const DAY_SKY_COLOR = 0x87ceeb
export const NIGHT_SKY_COLOR = 0x232a45
export const DEFAULT_ENVIRONMENT_FAR_PLANE = 300

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

/** The nearest valid far plane below `MIN_FAR_PLANE` falls back to the default. */
const MIN_FAR_PLANE = 0

const resolveFarPlane = (farPlane: number): number => {
  if (Number.isFinite(farPlane) && farPlane > MIN_FAR_PLANE) {
    return farPlane
  }
  return DEFAULT_ENVIRONMENT_FAR_PLANE
}

/** Fog starts at 45% of the far plane and ends at 90%, so it never clips the far plane itself. */
const FOG_NEAR_FACTOR = 0.45
const FOG_FAR_FACTOR = 0.9

/** Full daylight, the state `DEFAULT_RENDER_ENVIRONMENT` renders. */
const FULL_DAYLIGHT = 1

/** Build the complete environment state before touching THREE or uniform boxes. */
export const planRenderEnvironment = (
  daylight: number,
  farPlane: number = DEFAULT_ENVIRONMENT_FAR_PLANE,
): RenderEnvironmentPlan => {
  const safeDaylight = clamp01(daylight)
  const safeFar = resolveFarPlane(farPlane)
  const skyColor = interpolateColor(NIGHT_SKY_COLOR, DAY_SKY_COLOR, safeDaylight)
  return {
    daylight: safeDaylight,
    fogColor: [
      channel(skyColor, RED_PLACE_VALUE) / CHANNEL_MAX,
      channel(skyColor, GREEN_PLACE_VALUE) / CHANNEL_MAX,
      channel(skyColor, BLUE_PLACE_VALUE) / CHANNEL_MAX,
    ],
    fogFar: safeFar * FOG_FAR_FACTOR,
    fogNear: safeFar * FOG_NEAR_FACTOR,
    skyColor,
    sunIntensity: safeDaylight,
  }
}

export const DEFAULT_RENDER_ENVIRONMENT = planRenderEnvironment(FULL_DAYLIGHT)
