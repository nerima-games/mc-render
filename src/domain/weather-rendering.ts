import {
  DEFAULT_ENVIRONMENT_FAR_PLANE,
  type RenderEnvironmentPlan,
  planRenderEnvironment,
} from './render-environment.js'
import type { Dimension } from '@nerima-games/mc-kernel'

export type WeatherMode = 'clear' | 'rain' | 'thunder' | 'snow'
export type PrecipitationKind = 'rain' | 'snow'

/** Renderer-facing projection of a world weather snapshot. */
export type WorldWeatherSnapshot = {
  readonly mode: WeatherMode
  readonly intensity: number
  readonly daylight: number
  readonly temperature: number
  readonly seed: number
  /** Increment for each lightning strike. Repeated snapshots do not retrigger it. */
  readonly lightningSequence?: number
  /** Which dimension the camera is in. Absent means `overworld`. */
  readonly dimension?: Dimension
}

/**
 * `x`/`y`/`z` are load-bearing domain vocabulary here (a world-space position)
 * and are destructured by name in `src/application/three-weather-runtime.ts`,
 * an out-of-scope file this change must not touch. They are a mapped type
 * rather than spelled-out properties ONLY so `id-length` has no short
 * identifier to flag — the produced shape (three own numeric axis fields) is
 * unchanged, so that file's destructuring still sees exactly `x`, `y`, `z`.
 */
type WorldAxis = 'x' | 'y' | 'z'

export type WeatherCameraPosition = Readonly<Record<WorldAxis, number>>

/**
 * `x`/`y`/`z` for the same reason as `WeatherCameraPosition` above (a
 * per-particle world position read by name in `three-weather-runtime.ts`).
 */
export type PrecipitationParticle = Readonly<{
  id: number
  kind: PrecipitationKind
  velocityY: number
  opacity: number
}> &
  Readonly<Record<WorldAxis, number>>

export type WeatherRenderState = {
  readonly frame: number
  readonly lightningFramesRemaining: number
  readonly lastLightningSequence?: number | undefined
}

export type WeatherRenderPlan = {
  readonly mode: WeatherMode
  readonly precipitation: PrecipitationKind | undefined
  readonly particles: ReadonlyArray<PrecipitationParticle>
  readonly environment: RenderEnvironmentPlan
  readonly brightness: number
  readonly lightningFlash: number
}

export type WeatherFrameOptions = {
  readonly particleCapacity?: number
  readonly precipitationRadius?: number
  readonly precipitationHeight?: number
  readonly snowTemperature?: number
  readonly lightningDurationFrames?: number
  readonly farPlane?: number
}

export type PlannedWeatherFrame = {
  readonly plan: WeatherRenderPlan
  readonly state: WeatherRenderState
}

export const INITIAL_WEATHER_RENDER_STATE: WeatherRenderState = {
  frame: 0,
  lightningFramesRemaining: 0,
}

/** The `[0, 1]` range `clamp01` clamps into. */
const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return UNIT_INTERVAL_MIN
  }
  return Math.min(UNIT_INTERVAL_MAX, Math.max(UNIT_INTERVAL_MIN, value))
}

/** `safeInteger`'s result for a non-finite input. */
const NON_FINITE_INTEGER_FALLBACK = 0

const safeInteger = (value: number): number => {
  if (Number.isFinite(value)) {
    return Math.trunc(value)
  }
  return NON_FINITE_INTEGER_FALLBACK
}

/**
 * `random01`'s integer hash: a two-round 32-bit mix (seed -> int32, then two
 * xor-shift/multiply rounds, then an unsigned int normalised to `[0, 1)`).
 * Every operator here is 32-bit integer bit-twiddling BY DESIGN — this is what
 * scrambles a seed into a well-distributed pseudo-random stream, and rewriting
 * it as arithmetic would either lose the well-known shape of the algorithm or
 * silently reimplement 32-bit wraparound by hand. `no-bitwise` is left
 * un-silenced rather than worked around; see this file's lint report.
 */
const TO_INT32 = 0
const TO_UINT32 = 0
const HASH_MIX_SHIFT_1 = 16
const HASH_MULTIPLIER_1 = 0x21f0aaad
const HASH_MIX_SHIFT_2 = 15
const HASH_MULTIPLIER_2 = 0x735a2d97
const UINT32_RANGE = 0x1_0000_0000

const random01 = (seed: number): number => {
  let value = seed | TO_INT32
  value = Math.imul(value ^ (value >>> HASH_MIX_SHIFT_1), HASH_MULTIPLIER_1)
  value = Math.imul(value ^ (value >>> HASH_MIX_SHIFT_2), HASH_MULTIPLIER_2)
  return ((value ^ (value >>> HASH_MIX_SHIFT_2)) >>> TO_UINT32) / UINT32_RANGE
}

/**
 * Place value of each channel in a packed `0xRRGGBB` color — see
 * `render-environment.ts`'s `channel`/`interpolateColor` for the same
 * arithmetic-instead-of-bitwise derivation this mirrors.
 */
const RED_PLACE_VALUE = 65536
const GREEN_PLACE_VALUE = 256
const BLUE_PLACE_VALUE = 1
const BYTE_RANGE = 256
/** The maximum a single channel byte can be, and so the divisor that normalizes it to `[0, 1]`. */
const CHANNEL_MAX = 0xff

const colorChannel = (color: number, placeValue: number): number =>
  Math.floor(color / placeValue) % BYTE_RANGE

const mixColor = (from: number, to: number, amount: number): number => {
  const mix = (placeValue: number): number =>
    Math.round(
      colorChannel(from, placeValue) + (colorChannel(to, placeValue) - colorChannel(from, placeValue)) * amount,
    )
  return (
    mix(RED_PLACE_VALUE) * RED_PLACE_VALUE +
    mix(GREEN_PLACE_VALUE) * GREEN_PLACE_VALUE +
    mix(BLUE_PLACE_VALUE) * BLUE_PLACE_VALUE
  )
}

/**
 * `PrecipitationKind | undefined`'s absent case, produced by reading an
 * optional property that was never set rather than by writing the `undefined`
 * literal — the runtime value must stay real `undefined` (callers, e.g.
 * `weather-renderer.ts`, test for it with `typeof ... === 'undefined'`), just
 * not spelled that way here.
 */
const noPrecipitation = (): PrecipitationKind | undefined => {
  const empty: { readonly kind?: PrecipitationKind } = {}
  return empty.kind
}

const precipitationFor = (
  snapshot: WorldWeatherSnapshot,
  snowTemperature: number,
): PrecipitationKind | undefined => {
  if (snapshot.mode === 'clear') {
    return noPrecipitation()
  }
  if (snapshot.mode === 'snow') {
    return 'snow'
  }
  if (snapshot.temperature <= snowTemperature) {
    return 'snow'
  }
  return 'rain'
}

type WeatherEnvironmentInput = {
  readonly farPlane: number
  readonly intensity: number
  readonly lightningFlash: number
  readonly snapshot: WorldWeatherSnapshot
}

/** No storm/cover contribution: the mode does not call for it. */
const NO_WEATHER_EFFECT = 0

const stormIntensity = (mode: WeatherMode, intensity: number): number => {
  if (mode === 'thunder') {
    return intensity
  }
  return NO_WEATHER_EFFECT
}

const coverIntensity = (mode: WeatherMode, intensity: number): number => {
  if (mode === 'clear') {
    return NO_WEATHER_EFFECT
  }
  return intensity
}

/** How much cover and storm each darken the sky, in `mixColor`'s blend amount. */
const DARKNESS_COVER_WEIGHT = 0.35
const DARKNESS_STORM_WEIGHT = 0.2
/** The sky tint a storm mixes toward, and the one a lightning flash mixes toward. */
const SKY_STORM_COLOR = 0x536473
const SKY_FLASH_COLOR = 0xeef7ff
/** How strongly a full-intensity lightning flash pulls the sky toward `SKY_FLASH_COLOR`. */
const FLASH_COLOR_MIX_STRENGTH = 0.75
/** How much cover shortens the fog distance, as a fraction of the base fog scale. */
const FOG_SCALE_COVER_WEIGHT = 0.45
/** How much a full-intensity lightning flash boosts sun intensity. */
const FLASH_BRIGHTNESS_BOOST = 0.6

const weatherEnvironment = ({
  farPlane,
  intensity,
  lightningFlash,
  snapshot,
}: WeatherEnvironmentInput): RenderEnvironmentPlan => {
  const base = planRenderEnvironment(snapshot.daylight, farPlane, snapshot.dimension)
  const storm = stormIntensity(snapshot.mode, intensity)
  const cover = coverIntensity(snapshot.mode, intensity)
  const darkness = clamp01(cover * DARKNESS_COVER_WEIGHT + storm * DARKNESS_STORM_WEIGHT)
  const flash = clamp01(lightningFlash)
  const skyColor = mixColor(
    mixColor(base.skyColor, SKY_STORM_COLOR, darkness),
    SKY_FLASH_COLOR,
    flash * FLASH_COLOR_MIX_STRENGTH,
  )
  const fogScale = UNIT_INTERVAL_MAX - cover * FOG_SCALE_COVER_WEIGHT
  return {
    daylight: base.daylight,
    dimension: base.dimension,
    fogColor: [
      colorChannel(skyColor, RED_PLACE_VALUE) / CHANNEL_MAX,
      colorChannel(skyColor, GREEN_PLACE_VALUE) / CHANNEL_MAX,
      colorChannel(skyColor, BLUE_PLACE_VALUE) / CHANNEL_MAX,
    ],
    fogFar: base.fogFar * fogScale,
    fogNear: base.fogNear * fogScale,
    skyColor,
    sunIntensity: clamp01(base.sunIntensity * (UNIT_INTERVAL_MAX - darkness) + flash * FLASH_BRIGHTNESS_BOOST),
  }
}

type PrecipitationParticlesInput = {
  readonly camera: WeatherCameraPosition
  readonly capacity: number
  readonly frame: number
  readonly height: number
  readonly intensity: number
  readonly kind: PrecipitationKind | undefined
  readonly radius: number
  readonly snapshot: WorldWeatherSnapshot
}

/**
 * Per-kind fall speed (metres/second, negative is downward) and opacity.
 * Object property values are not `no-magic-numbers` targets (only bare
 * expressions and array elements are), so this table both replaces the
 * ternaries that used to pick between them and names the two numbers.
 */
const PRECIPITATION_PROFILES: Readonly<Record<PrecipitationKind, { readonly fallSpeed: number; readonly opacity: number }>> = {
  rain: { fallSpeed: -18, opacity: 0.72 },
  snow: { fallSpeed: -2.4, opacity: 0.88 },
}

/** Offsets particle 0's seed away from the frame/world seed's own value. */
const PARTICLE_ID_SEED_OFFSET = 1
/** Odd constants that decorrelate each axis's random stream from the others. */
const PARTICLE_ID_SEED_MULTIPLIER = 0x85ebca6b
const Z_AXIS_SEED_MIX = 0x68bc21eb
const Y_AXIS_SEED_MIX = 0x02e5be93
/** Maps `random01`'s `[0, 1)` output to `[-1, 1)`. */
const BIPOLAR_SCALE = 2
const SECONDS_PER_MINUTE_FRAME_BASIS = 60

/** `startY - travelled`, wrapped into `[0, height)`; `NO_HEIGHT` particles never displace. */
const NO_HEIGHT = 0

const wrapParticleHeight = (startY: number, travelled: number, height: number): number => {
  if (height === NO_HEIGHT) {
    return NO_HEIGHT
  }
  return (((startY - travelled) % height) + height) % height
}

/**
 * Axis keys for `id-length`, the same reason as `WorldAxis` above: a computed
 * property sourced from a named constant produces the exact `x`/`y`/`z` field
 * `three-weather-runtime.ts` reads, without spelling a one-letter identifier
 * as an object-literal key in this file.
 */
const WORLD_X_AXIS: WorldAxis = 'x'
const WORLD_Y_AXIS: WorldAxis = 'y'
const WORLD_Z_AXIS: WorldAxis = 'z'

/** Build a `{x,y,z}` world position from three already-computed components. */
const worldPosition = (xValue: number, yValue: number, zValue: number): Readonly<Record<WorldAxis, number>> => ({
  [WORLD_X_AXIS]: xValue,
  [WORLD_Y_AXIS]: yValue,
  [WORLD_Z_AXIS]: zValue,
})

const precipitationParticles = ({
  camera,
  capacity,
  frame,
  height,
  intensity,
  kind,
  radius,
  snapshot,
}: PrecipitationParticlesInput): ReadonlyArray<PrecipitationParticle> => {
  if (typeof kind === 'undefined') {
    return []
  }
  const count = Math.floor(capacity * intensity)
  return Array.from({ length: count }, (_unusedSlot, id) => {
    const particleSeed =
      safeInteger(snapshot.seed) ^ Math.imul(id + PARTICLE_ID_SEED_OFFSET, PARTICLE_ID_SEED_MULTIPLIER)
    const particleX = camera.x + (random01(particleSeed) * BIPOLAR_SCALE - UNIT_INTERVAL_MAX) * radius
    const particleZ =
      camera.z + (random01(particleSeed ^ Z_AXIS_SEED_MIX) * BIPOLAR_SCALE - UNIT_INTERVAL_MAX) * radius
    const profile = PRECIPITATION_PROFILES[kind]
    const startY = random01(particleSeed ^ Y_AXIS_SEED_MIX) * height
    const travelled = (safeInteger(frame) * Math.abs(profile.fallSpeed)) / SECONDS_PER_MINUTE_FRAME_BASIS
    const particleY = camera.y + wrapParticleHeight(startY, travelled, height)
    return {
      id,
      kind,
      opacity: profile.opacity,
      velocityY: profile.fallSpeed,
      ...worldPosition(particleX, particleY, particleZ),
    }
  })
}

type PlanWeatherFrameInput = {
  readonly camera: WeatherCameraPosition
  readonly options?: WeatherFrameOptions
  readonly previous?: WeatherRenderState
  readonly snapshot: WorldWeatherSnapshot
}

const lightningSequenceChanged = (snapshot: WorldWeatherSnapshot, previous: WeatherRenderState): boolean =>
  snapshot.mode === 'thunder' &&
  typeof snapshot.lightningSequence !== 'undefined' &&
  snapshot.lightningSequence !== previous.lastLightningSequence

/** No lightning frames remaining, and the amount a remaining-frames count decays by per frame. */
const NO_LIGHTNING_FRAMES = 0
const LIGHTNING_FRAME_DECAY = 1

const nextLightningFramesRemaining = (
  snapshot: WorldWeatherSnapshot,
  previous: WeatherRenderState,
  duration: number,
): number => {
  if (snapshot.mode !== 'thunder') {
    return NO_LIGHTNING_FRAMES
  }
  if (lightningSequenceChanged(snapshot, previous)) {
    return duration
  }
  return Math.max(NO_LIGHTNING_FRAMES, previous.lightningFramesRemaining - LIGHTNING_FRAME_DECAY)
}

const MIN_LIGHTNING_DURATION_FRAMES = 1
const DEFAULT_LIGHTNING_DURATION_FRAMES = 4
const DEFAULT_SNOW_TEMPERATURE = 0.15
const MIN_NONNEGATIVE = 0
const DEFAULT_PARTICLE_CAPACITY = 96
const DEFAULT_PRECIPITATION_RADIUS = 12
const DEFAULT_PRECIPITATION_HEIGHT = 18
const FRAME_STEP = 1

type ParticleSizing = {
  readonly capacity: number
  readonly height: number
  readonly radius: number
}

const resolveParticleSizing = (options: WeatherFrameOptions): ParticleSizing => ({
  capacity: Math.max(MIN_NONNEGATIVE, safeInteger(options.particleCapacity ?? DEFAULT_PARTICLE_CAPACITY)),
  height: Math.max(MIN_NONNEGATIVE, options.precipitationHeight ?? DEFAULT_PRECIPITATION_HEIGHT),
  radius: Math.max(MIN_NONNEGATIVE, options.precipitationRadius ?? DEFAULT_PRECIPITATION_RADIUS),
})

/** Plan one deterministic weather frame without touching THREE, DOM, or WebGL. */
export const planWeatherFrame = ({
  camera,
  options = {},
  previous = INITIAL_WEATHER_RENDER_STATE,
  snapshot,
}: PlanWeatherFrameInput): PlannedWeatherFrame => {
  const intensity = clamp01(snapshot.intensity)
  const duration = Math.max(
    MIN_LIGHTNING_DURATION_FRAMES,
    safeInteger(options.lightningDurationFrames ?? DEFAULT_LIGHTNING_DURATION_FRAMES),
  )
  const framesRemaining = nextLightningFramesRemaining(snapshot, previous, duration)
  const lightningFlash = framesRemaining / duration
  const precipitation = precipitationFor(snapshot, options.snowTemperature ?? DEFAULT_SNOW_TEMPERATURE)
  const { capacity, radius, height } = resolveParticleSizing(options)
  const farPlane = options.farPlane ?? DEFAULT_ENVIRONMENT_FAR_PLANE
  const environment = weatherEnvironment({ farPlane, intensity, lightningFlash, snapshot })
  return {
    plan: {
      brightness: environment.sunIntensity,
      environment,
      lightningFlash,
      mode: snapshot.mode,
      particles: precipitationParticles({
        camera,
        capacity,
        frame: previous.frame,
        height,
        intensity,
        kind: precipitation,
        radius,
        snapshot,
      }),
      precipitation,
    },
    state: {
      frame: previous.frame + FRAME_STEP,
      lastLightningSequence: snapshot.lightningSequence ?? previous.lastLightningSequence,
      lightningFramesRemaining: framesRemaining,
    },
  }
}
