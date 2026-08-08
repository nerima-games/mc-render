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

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

const channel = (color: number, shift: number): number => (color >> shift) & 0xff

const interpolateColor = (from: number, to: number, amount: number): number => {
  const interpolate = (shift: number): number =>
    Math.round(channel(from, shift) + (channel(to, shift) - channel(from, shift)) * amount)
  return (interpolate(16) << 16) | (interpolate(8) << 8) | interpolate(0)
}

/** Build the complete environment state before touching THREE or uniform boxes. */
export const planRenderEnvironment = (
  daylight: number,
  farPlane: number = DEFAULT_ENVIRONMENT_FAR_PLANE,
): RenderEnvironmentPlan => {
  const safeDaylight = clamp01(daylight)
  const safeFar = Number.isFinite(farPlane) && farPlane > 0 ? farPlane : DEFAULT_ENVIRONMENT_FAR_PLANE
  const skyColor = interpolateColor(NIGHT_SKY_COLOR, DAY_SKY_COLOR, safeDaylight)
  return {
    daylight: safeDaylight,
    fogColor: [channel(skyColor, 16) / 255, channel(skyColor, 8) / 255, channel(skyColor, 0) / 255],
    fogFar: safeFar * 0.9,
    fogNear: safeFar * 0.45,
    skyColor,
    sunIntensity: safeDaylight,
  }
}

export const DEFAULT_RENDER_ENVIRONMENT = planRenderEnvironment(1)
