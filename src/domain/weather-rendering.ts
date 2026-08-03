import {
  DEFAULT_ENVIRONMENT_FAR_PLANE,
  planRenderEnvironment,
  type RenderEnvironmentPlan,
} from './render-environment'

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
}

export type WeatherCameraPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type PrecipitationParticle = {
  readonly id: number
  readonly kind: PrecipitationKind
  readonly x: number
  readonly y: number
  readonly z: number
  readonly velocityY: number
  readonly opacity: number
}

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

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

const safeInteger = (value: number): number =>
  Number.isFinite(value) ? Math.trunc(value) : 0

const random01 = (seed: number): number => {
  let value = seed | 0
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000
}

const colorChannel = (color: number, shift: number): number => (color >> shift) & 0xff

const mixColor = (from: number, to: number, amount: number): number => {
  const mix = (shift: number): number =>
    Math.round(colorChannel(from, shift) + (colorChannel(to, shift) - colorChannel(from, shift)) * amount)
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

const precipitationFor = (
  snapshot: WorldWeatherSnapshot,
  snowTemperature: number,
): PrecipitationKind | undefined => {
  if (snapshot.mode === 'clear') return undefined
  if (snapshot.mode === 'snow') return 'snow'
  return snapshot.temperature <= snowTemperature ? 'snow' : 'rain'
}

const weatherEnvironment = (
  snapshot: WorldWeatherSnapshot,
  intensity: number,
  lightningFlash: number,
  farPlane: number,
): RenderEnvironmentPlan => {
  const base = planRenderEnvironment(snapshot.daylight, farPlane)
  const storm = snapshot.mode === 'thunder' ? intensity : 0
  const cover = snapshot.mode === 'clear' ? 0 : intensity
  const darkness = clamp01(cover * 0.35 + storm * 0.2)
  const flash = clamp01(lightningFlash)
  const skyColor = mixColor(mixColor(base.skyColor, 0x536473, darkness), 0xeef7ff, flash * 0.75)
  const fogScale = 1 - cover * 0.45
  return {
    daylight: base.daylight,
    sunIntensity: clamp01(base.sunIntensity * (1 - darkness) + flash * 0.6),
    skyColor,
    fogColor: [
      colorChannel(skyColor, 16) / 255,
      colorChannel(skyColor, 8) / 255,
      colorChannel(skyColor, 0) / 255,
    ],
    fogNear: base.fogNear * fogScale,
    fogFar: base.fogFar * fogScale,
  }
}

const precipitationParticles = (
  snapshot: WorldWeatherSnapshot,
  camera: WeatherCameraPosition,
  frame: number,
  kind: PrecipitationKind | undefined,
  intensity: number,
  capacity: number,
  radius: number,
  height: number,
): ReadonlyArray<PrecipitationParticle> => {
  if (kind === undefined) return []
  const count = Math.floor(capacity * intensity)
  return Array.from({ length: count }, (_, id) => {
    const particleSeed = safeInteger(snapshot.seed) ^ Math.imul(id + 1, 0x85ebca6b)
    const x = camera.x + (random01(particleSeed) * 2 - 1) * radius
    const z = camera.z + (random01(particleSeed ^ 0x68bc21eb) * 2 - 1) * radius
    const velocityY = kind === 'rain' ? -18 : -2.4
    const startY = random01(particleSeed ^ 0x02e5be93) * height
    const travelled = (safeInteger(frame) * Math.abs(velocityY)) / 60
    const y = camera.y + (height === 0 ? 0 : ((startY - travelled) % height + height) % height)
    return {
      id,
      kind,
      x,
      y,
      z,
      velocityY,
      opacity: kind === 'rain' ? 0.72 : 0.88,
    }
  })
}

/** Plan one deterministic weather frame without touching THREE, DOM, or WebGL. */
export const planWeatherFrame = (
  snapshot: WorldWeatherSnapshot,
  camera: WeatherCameraPosition,
  previous: WeatherRenderState = INITIAL_WEATHER_RENDER_STATE,
  options: WeatherFrameOptions = {},
): PlannedWeatherFrame => {
  const intensity = clamp01(snapshot.intensity)
  const duration = Math.max(1, safeInteger(options.lightningDurationFrames ?? 4))
  const sequenceChanged =
    snapshot.mode === 'thunder' &&
    snapshot.lightningSequence !== undefined &&
    snapshot.lightningSequence !== previous.lastLightningSequence
  const framesRemaining = snapshot.mode !== 'thunder'
    ? 0
    : sequenceChanged
      ? duration
      : Math.max(0, previous.lightningFramesRemaining - 1)
  const lightningFlash = framesRemaining / duration
  const precipitation = precipitationFor(snapshot, options.snowTemperature ?? 0.15)
  const capacity = Math.max(0, safeInteger(options.particleCapacity ?? 96))
  const radius = Math.max(0, options.precipitationRadius ?? 12)
  const height = Math.max(0, options.precipitationHeight ?? 18)
  const farPlane = options.farPlane ?? DEFAULT_ENVIRONMENT_FAR_PLANE
  const environment = weatherEnvironment(snapshot, intensity, lightningFlash, farPlane)
  const state: WeatherRenderState = {
    frame: previous.frame + 1,
    lightningFramesRemaining: framesRemaining,
    lastLightningSequence: snapshot.lightningSequence ?? previous.lastLightningSequence,
  }
  return {
    state,
    plan: {
      mode: snapshot.mode,
      precipitation,
      particles: precipitationParticles(
        snapshot,
        camera,
        previous.frame,
        precipitation,
        intensity,
        capacity,
        radius,
        height,
      ),
      environment,
      brightness: environment.sunIntensity,
      lightningFlash,
    },
  }
}
