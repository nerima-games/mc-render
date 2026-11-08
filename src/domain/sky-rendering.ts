import { type AnimationClockInput, PartialTickSchema, animationTimeSeconds } from './animation-clock.js'
import { Brand, Result, Schema } from 'effect'
import { type Dimension, SimulationTickSchema } from '@nerima-games/mc-kernel'
import { END_VOID_COLOR, NETHER_FOG_COLOR } from './render-environment.js'

type WorldAxis = 'x' | 'y' | 'z'

export type SkyWorldCoordinate = Brand.Branded<number, 'SkyWorldCoordinate'>
export type SkyUnitValue = Brand.Branded<number, 'SkyUnitValue'>
export type SkyAngleRadians = Brand.Branded<number, 'SkyAngleRadians'>
export type SkyColor = Brand.Branded<number, 'SkyColor'>
export type SkyMoonPhase = Brand.Branded<number, 'SkyMoonPhase'>
export type SkyTimeOfDayTick = AnimationClockInput['timeOfDayTicks']

/** A position relative to the camera anchor, in world units. */
export type SkyPosition = Brand.Branded<Readonly<Record<WorldAxis, SkyWorldCoordinate>>, 'SkyPosition'>

const makeSkyWorldCoordinate = Brand.nominal<SkyWorldCoordinate>()
const makeSkyUnitValue = Brand.nominal<SkyUnitValue>()
const makeSkyAngleRadians = Brand.nominal<SkyAngleRadians>()
const makeSkyColor = Brand.nominal<SkyColor>()
const makeSkyPositionValue = Brand.nominal<SkyPosition>()
const makeSkyPosition = (x: number, y: number, z: number): SkyPosition => makeSkyPositionValue({
  x: makeSkyWorldCoordinate(x),
  y: makeSkyWorldCoordinate(y),
  z: makeSkyWorldCoordinate(z),
})

const SKY_WORLD_COORDINATE_SCHEMA: Schema.Codec<SkyWorldCoordinate, number> = Schema.Finite.pipe(Schema.brand('SkyWorldCoordinate'))
const SKY_UNIT_VALUE_SCHEMA: Schema.Codec<SkyUnitValue, number> = Schema.Finite.pipe(Schema.brand('SkyUnitValue'))
const SKY_ANGLE_RADIANS_SCHEMA: Schema.Codec<SkyAngleRadians, number> = Schema.Finite.pipe(Schema.brand('SkyAngleRadians'))
const SKY_COLOR_SCHEMA: Schema.Codec<SkyColor, number> = Schema.Int.pipe(Schema.brand('SkyColor'))
const SKY_MOON_PHASE_SCHEMA: Schema.Codec<SkyMoonPhase, number> = Schema.Finite.pipe(Schema.brand('SkyMoonPhase'))
const SKY_TIME_OF_DAY_TICK_SCHEMA: Schema.Codec<SkyTimeOfDayTick, number> = Schema.Finite.pipe(Schema.brand('TimeOfDayTicks'))

export type SkyCloudLayerPlan = {
  readonly worldY: SkyWorldCoordinate
  readonly opacity: SkyUnitValue
  readonly offsetX: SkyWorldCoordinate
  readonly offsetZ: SkyWorldCoordinate
}

export type SkyCelestialPlan = {
  readonly color: SkyColor
  readonly opacity: SkyUnitValue
  readonly position: SkyPosition
  readonly visible: boolean
}

export type SkyMoonPlan = SkyCelestialPlan & {
  readonly illumination: SkyUnitValue
  readonly phase: SkyMoonPhase
  readonly shadowOffsetX: SkyWorldCoordinate
}

export type SkyStarsPlan = {
  readonly opacity: SkyUnitValue
  readonly positions: ReadonlyArray<SkyPosition>
  readonly twinkle: SkyUnitValue
}

export type SkyRenderInputError = {
  readonly _tag: 'SkyRenderInputError'
  readonly reason: 'invalid-input' | 'time-out-of-range' | 'phase-out-of-range'
}

const DAY_LENGTH_TICKS = 24_000
const ONE = 1
const TWO = 2
const THREE = 3
const ZERO = 0
const HALF = 0.5
const LAST_TICK_OF_DAY = DAY_LENGTH_TICKS - ONE
const MOON_PHASE_COUNT = 8
const LAST_MOON_PHASE = MOON_PHASE_COUNT - ONE
const HALF_MOON_CYCLE = MOON_PHASE_COUNT / TWO
const FULL_TURN_RADIANS = Math.PI * TWO
const SKY_ORBIT_RADIUS = 160
const SUN_COLOR = 0xfff2ce
const MOON_COLOR = 0xe3e8ff
const NIGHT_SKY_COLOR = 0x111a32
const DAY_SKY_COLOR = 0x6fb6e7
const NIGHT_HORIZON_COLOR = 0x1a2440
const DAY_HORIZON_COLOR = 0xb9e3f4
const END_SKY_COLOR = END_VOID_COLOR
const NETHER_SKY_COLOR = NETHER_FOG_COLOR
const SUNRISE_HORIZON_COLOR = 0xffc17b
const SUNSET_HORIZON_COLOR = 0xf17e68
const SUNRISE_SUN_COLOR = 0xffcf91
const SUNSET_SUN_COLOR = 0xff9a71
const STAR_COUNT = 128
const STAR_RADIUS = SKY_ORBIT_RADIUS - TWO
const STAR_MIN_ELEVATION = 0.06
const GOLDEN_ANGLE_MULTIPLIER = 3
const GOLDEN_ANGLE_RADICAND = 5
const GOLDEN_ANGLE_RADIANS = Math.PI * (GOLDEN_ANGLE_MULTIPLIER - Math.sqrt(GOLDEN_ANGLE_RADICAND))
const CLOUD_WRAP_DISTANCE = 240
const CLOUD_NEAR_WORLD_Y = 192.33
const CLOUD_FAR_WORLD_Y = 196.33
const CLOUD_OPACITY = 0.68
const CLOUD_BASE_OPACITY_RATIO = 0.82
const FAR_CLOUD_OPACITY_RATIO = 0.82
const CLOUD_NEAR_SPEED_X = -0.78
const CLOUD_NEAR_SPEED_Z = 0
const CLOUD_FAR_SPEED_X = -0.43
const CLOUD_FAR_SPEED_Z = 0
const CLOUD_DAYLIGHT_BONUS = 0.18
const STAR_TWINKLE_BASE = HALF
const STAR_TWINKLE_VARIATION = HALF
const STAR_TWINKLE_SPEED = 1.7
const STAR_NIGHT_FULL_ELEVATION = 0.34
const TWILIGHT_ELEVATION = 0.3
const TWILIGHT_MIX_STRENGTH = 0.86
const DAYLIGHT_START_ELEVATION = -0.12
const DAYLIGHT_END_ELEVATION = 0.2
const SUN_HORIZON_CUTOFF = -0.015
const DAYLIGHT_MIN = ZERO
const DAYLIGHT_MAX = ONE
const ZERO_OPACITY = ZERO
const FULL_OPACITY = ONE
const EMPTY_SHADOW_OFFSET = 2
const COLOR_RED_PLACE = 65_536
const COLOR_GREEN_PLACE = 256
const COLOR_BLUE_PLACE = ONE
const BYTE_RANGE = 256
const SKY_DIMENSIONS = ['overworld', 'nether', 'end'] as const
const INVALID_INPUT_ERROR: SkyRenderInputError = { _tag: 'SkyRenderInputError', reason: 'invalid-input' }

const SKY_DIMENSION_SCHEMA: Schema.Codec<Dimension> = Schema.Literals(SKY_DIMENSIONS)

const SKY_POSITION_SCHEMA: Schema.Codec<SkyPosition, Readonly<Record<WorldAxis, number>>> = Schema.Struct({
  x: SKY_WORLD_COORDINATE_SCHEMA,
  y: SKY_WORLD_COORDINATE_SCHEMA,
  z: SKY_WORLD_COORDINATE_SCHEMA,
}).pipe(Schema.brand('SkyPosition'))

export type SkyFrameInput = AnimationClockInput & Readonly<{
  cameraPitchRadians: SkyAngleRadians
  cameraPosition: SkyPosition
  cameraYawRadians: SkyAngleRadians
  dimension: Dimension
  moonPhase: SkyMoonPhase
}>

type SkyPositionEncoded = Readonly<Record<WorldAxis, number>>
type SkyFrameInputEncoded = Readonly<{
  cameraPitchRadians: number
  cameraPosition: SkyPositionEncoded
  cameraYawRadians: number
  dimension: Dimension
  moonPhase: number
  partialTick: number
  simulationTick: number
  timeOfDayTicks: number
}>

export const SkyFrameInputSchema: Schema.Codec<SkyFrameInput, SkyFrameInputEncoded> = Schema.Struct({
  cameraPitchRadians: SKY_ANGLE_RADIANS_SCHEMA,
  cameraPosition: SKY_POSITION_SCHEMA,
  cameraYawRadians: SKY_ANGLE_RADIANS_SCHEMA,
  dimension: SKY_DIMENSION_SCHEMA,
  moonPhase: SKY_MOON_PHASE_SCHEMA,
  partialTick: PartialTickSchema,
  simulationTick: SimulationTickSchema,
  timeOfDayTicks: SKY_TIME_OF_DAY_TICK_SCHEMA,
})

type SkyCloudLayerPlanEncoded = Readonly<{ worldY: number; opacity: number; offsetX: number; offsetZ: number }>
type SkyCloudLayerPair = readonly [SkyCloudLayerPlan, SkyCloudLayerPlan]
type SkyCloudLayerPairEncoded = readonly [SkyCloudLayerPlanEncoded, SkyCloudLayerPlanEncoded]
type SkyCelestialPlanEncoded = Readonly<{ color: number; opacity: number; position: SkyPositionEncoded; visible: boolean }>
type SkyMoonPlanEncoded = Readonly<SkyCelestialPlanEncoded & { illumination: number; phase: number; shadowOffsetX: number }>
type SkyStarsPlanEncoded = Readonly<{ opacity: number; positions: ReadonlyArray<SkyPositionEncoded>; twinkle: number }>

const SKY_CLOUD_LAYER_SCHEMA: Schema.Codec<SkyCloudLayerPlan, SkyCloudLayerPlanEncoded> = Schema.Struct({
  offsetX: SKY_WORLD_COORDINATE_SCHEMA,
  offsetZ: SKY_WORLD_COORDINATE_SCHEMA,
  opacity: SKY_UNIT_VALUE_SCHEMA,
  worldY: SKY_WORLD_COORDINATE_SCHEMA,
})

const SKY_CELESTIAL_SCHEMA: Schema.Codec<SkyCelestialPlan, SkyCelestialPlanEncoded> = Schema.Struct({
  color: SKY_COLOR_SCHEMA,
  opacity: SKY_UNIT_VALUE_SCHEMA,
  position: SKY_POSITION_SCHEMA,
  visible: Schema.Boolean,
})

const SKY_MOON_SCHEMA: Schema.Codec<SkyMoonPlan, SkyMoonPlanEncoded> = Schema.Struct({
  color: SKY_COLOR_SCHEMA,
  illumination: SKY_UNIT_VALUE_SCHEMA,
  opacity: SKY_UNIT_VALUE_SCHEMA,
  phase: SKY_MOON_PHASE_SCHEMA,
  position: SKY_POSITION_SCHEMA,
  shadowOffsetX: SKY_WORLD_COORDINATE_SCHEMA,
  visible: Schema.Boolean,
})

const SKY_STARS_SCHEMA: Schema.Codec<SkyStarsPlan, SkyStarsPlanEncoded> = Schema.Struct({
  opacity: SKY_UNIT_VALUE_SCHEMA,
  positions: Schema.Array(SKY_POSITION_SCHEMA),
  twinkle: SKY_UNIT_VALUE_SCHEMA,
})

export type SkyRenderPlan = Readonly<{
  anchor: SkyPosition
  cameraPitchRadians: SkyAngleRadians
  cameraYawRadians: SkyAngleRadians
  clouds: SkyCloudLayerPair
  daylight: SkyUnitValue
  dimension: Dimension
  horizonColor: SkyColor
  moon: SkyMoonPlan
  skyColor: SkyColor
  solarElevation: SkyAngleRadians
  stars: SkyStarsPlan
  sun: SkyCelestialPlan
}>

type SkyRenderPlanEncoded = Readonly<{
  anchor: SkyPositionEncoded
  cameraPitchRadians: number
  cameraYawRadians: number
  clouds: SkyCloudLayerPairEncoded
  daylight: number
  dimension: Dimension
  horizonColor: number
  moon: SkyMoonPlanEncoded
  skyColor: number
  solarElevation: number
  stars: SkyStarsPlanEncoded
  sun: SkyCelestialPlanEncoded
}>

export const SkyRenderPlanSchema: Schema.Codec<SkyRenderPlan, SkyRenderPlanEncoded> = Schema.Struct({
  anchor: SKY_POSITION_SCHEMA,
  cameraPitchRadians: SKY_ANGLE_RADIANS_SCHEMA,
  cameraYawRadians: SKY_ANGLE_RADIANS_SCHEMA,
  clouds: Schema.Tuple([SKY_CLOUD_LAYER_SCHEMA, SKY_CLOUD_LAYER_SCHEMA]),
  daylight: SKY_UNIT_VALUE_SCHEMA,
  dimension: SKY_DIMENSION_SCHEMA,
  horizonColor: SKY_COLOR_SCHEMA,
  moon: SKY_MOON_SCHEMA,
  skyColor: SKY_COLOR_SCHEMA,
  solarElevation: SKY_ANGLE_RADIANS_SCHEMA,
  stars: SKY_STARS_SCHEMA,
  sun: SKY_CELESTIAL_SCHEMA,
})

export const SkyRenderInputErrorSchema: Schema.Codec<SkyRenderInputError> = Schema.Struct({
  _tag: Schema.Literal('SkyRenderInputError'),
  reason: Schema.Literals(['invalid-input', 'time-out-of-range', 'phase-out-of-range']),
})

type SkyResultShape =
  | { readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: SkyRenderPlan }
  | { readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: SkyRenderInputError }

type SkyResultShapeEncoded =
  | { readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: Schema.Codec.Encoded<typeof SkyRenderPlanSchema> }
  | { readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: SkyRenderInputError }

export const SkyRenderResultSchema: Schema.Codec<SkyResultShape, SkyResultShapeEncoded> = Schema.Union([
  Schema.Struct({ _op: Schema.Literal('Success'), _tag: Schema.Literal('Success'), success: SkyRenderPlanSchema }),
  Schema.Struct({ _op: Schema.Literal('Failure'), _tag: Schema.Literal('Failure'), failure: SkyRenderInputErrorSchema }),
])

const skyRenderInputError = (reason: SkyRenderInputError['reason']): SkyRenderInputError => ({
  _tag: 'SkyRenderInputError',
  reason,
})

const clampUnit = (value: number): number => Math.min(DAYLIGHT_MAX, Math.max(DAYLIGHT_MIN, value))

const smoothstep = (start: number, end: number, value: number): number => {
  const amount = clampUnit((value - start) / (end - start))
  return amount * amount * (THREE - TWO * amount)
}

const colorChannel = (color: number, place: number): number => Math.floor(color / place) % BYTE_RANGE

const mixColor = (from: number, to: number, amount: number): number => {
  const mix = (place: number): number =>
    Math.round(colorChannel(from, place) + (colorChannel(to, place) - colorChannel(from, place)) * amount)
  return mix(COLOR_RED_PLACE) * COLOR_RED_PLACE + mix(COLOR_GREEN_PLACE) * COLOR_GREEN_PLACE + mix(COLOR_BLUE_PLACE) * COLOR_BLUE_PLACE
}

const worldPosition = (x: number, y: number, z: number): SkyPosition => makeSkyPosition(x, y, z)

const positiveModulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus

const starPositions = (): ReadonlyArray<SkyPosition> =>
  Array.from({ length: STAR_COUNT }, (_unused, index) => {
    const elevation = STAR_MIN_ELEVATION + ((index + DAYLIGHT_MIN) / STAR_COUNT) * (DAYLIGHT_MAX - STAR_MIN_ELEVATION)
    const horizontalRadius = Math.sqrt(DAYLIGHT_MAX - elevation * elevation)
    const azimuth = index * GOLDEN_ANGLE_RADIANS
    return worldPosition(
      Math.cos(azimuth) * horizontalRadius * STAR_RADIUS,
      elevation * STAR_RADIUS,
      Math.sin(azimuth) * horizontalRadius * STAR_RADIUS,
    )
  })

const STAR_POSITIONS = starPositions()

type CloudLayerInput = Readonly<{
  animationSeconds: number
  cameraPosition: SkyPosition
  daylight: number
  visible: boolean
}>

const cloudLayers = ({
  animationSeconds,
  cameraPosition,
  daylight,
  visible,
}: CloudLayerInput): SkyCloudLayerPair => {
  let opacity = ZERO_OPACITY
  if (visible) {
    opacity = CLOUD_OPACITY * (CLOUD_BASE_OPACITY_RATIO + daylight * CLOUD_DAYLIGHT_BONUS)
  }
  return [
    {
      offsetX: makeSkyWorldCoordinate(positiveModulo(animationSeconds * CLOUD_NEAR_SPEED_X - cameraPosition.x, CLOUD_WRAP_DISTANCE)),
      offsetZ: makeSkyWorldCoordinate(positiveModulo(animationSeconds * CLOUD_NEAR_SPEED_Z - cameraPosition.z, CLOUD_WRAP_DISTANCE)),
      opacity: makeSkyUnitValue(opacity),
      worldY: makeSkyWorldCoordinate(CLOUD_NEAR_WORLD_Y),
    },
    {
      offsetX: makeSkyWorldCoordinate(positiveModulo(animationSeconds * CLOUD_FAR_SPEED_X - cameraPosition.x, CLOUD_WRAP_DISTANCE)),
      offsetZ: makeSkyWorldCoordinate(positiveModulo(animationSeconds * CLOUD_FAR_SPEED_Z - cameraPosition.z, CLOUD_WRAP_DISTANCE)),
      opacity: makeSkyUnitValue(opacity * FAR_CLOUD_OPACITY_RATIO),
      worldY: makeSkyWorldCoordinate(CLOUD_FAR_WORLD_Y),
    },
  ]
}

const twilightColorFor = (
  solarElevation: number,
  isSunrise: boolean,
): { readonly horizon: number; readonly sun: number } => {
  const twilight = DAYLIGHT_MAX - smoothstep(DAYLIGHT_MIN, TWILIGHT_ELEVATION, Math.abs(solarElevation))
  let color = SUNSET_HORIZON_COLOR
  let sun = SUNSET_SUN_COLOR
  if (isSunrise) {
    color = SUNRISE_HORIZON_COLOR
    sun = SUNRISE_SUN_COLOR
  }
  return {
    horizon: mixColor(DAY_HORIZON_COLOR, color, twilight * TWILIGHT_MIX_STRENGTH),
    sun: mixColor(SUN_COLOR, sun, twilight),
  }
}

const moonIlluminationFor = (phase: number): number => {
  const distanceFromFull = Math.min(phase, MOON_PHASE_COUNT - phase)
  return DAYLIGHT_MAX - distanceFromFull / HALF_MOON_CYCLE
}

const moonShadowOffsetFor = (phase: number): number => {
  if (phase <= HALF_MOON_CYCLE) {
    return EMPTY_SHADOW_OFFSET * (DAYLIGHT_MAX - phase / HALF_MOON_CYCLE)
  }
  return -EMPTY_SHADOW_OFFSET * (DAYLIGHT_MAX - (MOON_PHASE_COUNT - phase) / HALF_MOON_CYCLE)
}

const skyColorsFor = (
  daylight: number,
  solarElevation: number,
  isSunrise: boolean,
): { readonly horizonColor: number; readonly skyColor: number } => {
  const { horizon } = twilightColorFor(solarElevation, isSunrise)
  const twilight = DAYLIGHT_MAX - smoothstep(DAYLIGHT_MIN, TWILIGHT_ELEVATION, Math.abs(solarElevation))
  return {
    horizonColor: mixColor(mixColor(NIGHT_HORIZON_COLOR, DAY_HORIZON_COLOR, daylight), horizon, twilight),
    skyColor: mixColor(NIGHT_SKY_COLOR, DAY_SKY_COLOR, daylight),
  }
}

const nonOverworldSkyColor = (dimension: Dimension): number => {
  if (dimension === 'nether') {
    return NETHER_SKY_COLOR
  }
  return END_SKY_COLOR
}

const nonOverworldPlan = (
  input: SkyFrameInput,
  derived: SkyDerivedFrame,
  animationSeconds: number,
): SkyRenderPlan => {
  const skyColor = makeSkyColor(nonOverworldSkyColor(input.dimension))
  return {
    anchor: input.cameraPosition,
    cameraPitchRadians: input.cameraPitchRadians,
    cameraYawRadians: input.cameraYawRadians,
    clouds: cloudLayers({
      animationSeconds,
      cameraPosition: input.cameraPosition,
      daylight: DAYLIGHT_MIN,
      visible: false,
    }),
    daylight: makeSkyUnitValue(DAYLIGHT_MIN),
    dimension: input.dimension,
    horizonColor: skyColor,
    moon: {
      color: makeSkyColor(MOON_COLOR),
      illumination: makeSkyUnitValue(moonIlluminationFor(input.moonPhase)),
      opacity: makeSkyUnitValue(ZERO_OPACITY),
      phase: input.moonPhase,
      position: worldPosition(-Math.cos(derived.cycle) * SKY_ORBIT_RADIUS, -derived.solarElevation * SKY_ORBIT_RADIUS, ZERO),
      shadowOffsetX: makeSkyWorldCoordinate(moonShadowOffsetFor(input.moonPhase)),
      visible: false,
    },
    skyColor,
    solarElevation: makeSkyAngleRadians(derived.solarElevation),
    stars: { opacity: makeSkyUnitValue(ZERO_OPACITY), positions: STAR_POSITIONS, twinkle: makeSkyUnitValue(ZERO_OPACITY) },
    sun: {
      color: makeSkyColor(SUN_COLOR),
      opacity: makeSkyUnitValue(ZERO_OPACITY),
      position: worldPosition(Math.cos(derived.cycle) * SKY_ORBIT_RADIUS, derived.solarElevation * SKY_ORBIT_RADIUS, ZERO),
      visible: false,
    },
  }
}

/** Plan all world-space sky visuals from a validated simulation time and render clock. */
const decodeSkyFrameInput = (input: unknown): Result.Result<SkyFrameInput, SkyRenderInputError> => {
  const decoded = Schema.decodeUnknownResult(SkyFrameInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(INVALID_INPUT_ERROR)
  }
  return Result.succeed(decoded.success)
}

const validationErrorFor = (frame: SkyFrameInput): SkyRenderInputError | undefined => {
  if (frame.timeOfDayTicks < DAYLIGHT_MIN || frame.timeOfDayTicks >= DAY_LENGTH_TICKS) {
    return skyRenderInputError('time-out-of-range')
  }
  if (!Number.isInteger(frame.moonPhase) || frame.moonPhase < DAYLIGHT_MIN || frame.moonPhase > LAST_MOON_PHASE) {
    return skyRenderInputError('phase-out-of-range')
  }
  return undefined
}

type SkyDerivedFrame = Readonly<{
  cycle: number
  solarElevation: number
  daylight: number
  colors: Readonly<{ horizonColor: number; skyColor: number }>
  sunColor: number
}>

const deriveSkyFrame = (frame: SkyFrameInput): SkyDerivedFrame => {
  const cycle = (frame.timeOfDayTicks / DAY_LENGTH_TICKS) * FULL_TURN_RADIANS
  const solarElevation = Math.sin(cycle)
  const daylight = smoothstep(DAYLIGHT_START_ELEVATION, DAYLIGHT_END_ELEVATION, solarElevation)
  const isSunrise = Math.cos(cycle) >= DAYLIGHT_MIN
  const sunriseOrSunset = twilightColorFor(solarElevation, isSunrise)
  return {
    colors: skyColorsFor(daylight, solarElevation, isSunrise),
    cycle,
    daylight,
    solarElevation,
    sunColor: sunriseOrSunset.sun,
  }
}

const sunPlanFor = (derived: SkyDerivedFrame): SkyCelestialPlan => {
  const visible = derived.solarElevation >= SUN_HORIZON_CUTOFF
  let opacity = ZERO_OPACITY
  if (visible) {
    opacity = FULL_OPACITY
  }
  return {
    color: makeSkyColor(derived.sunColor),
    opacity: makeSkyUnitValue(opacity),
    position: worldPosition(Math.cos(derived.cycle) * SKY_ORBIT_RADIUS, derived.solarElevation * SKY_ORBIT_RADIUS, ZERO),
    visible,
  }
}

const moonPlanFor = (frame: SkyFrameInput, derived: SkyDerivedFrame): SkyMoonPlan => {
  const moonElevation = -derived.solarElevation
  const illumination = moonIlluminationFor(frame.moonPhase)
  const opacity = clampUnit((DAYLIGHT_MAX - derived.daylight) * illumination)
  return {
    color: makeSkyColor(MOON_COLOR),
    illumination: makeSkyUnitValue(illumination),
    opacity: makeSkyUnitValue(opacity),
    phase: frame.moonPhase,
    position: worldPosition(-Math.cos(derived.cycle) * SKY_ORBIT_RADIUS, moonElevation * SKY_ORBIT_RADIUS, ZERO),
    shadowOffsetX: makeSkyWorldCoordinate(moonShadowOffsetFor(frame.moonPhase)),
    visible: moonElevation >= SUN_HORIZON_CUTOFF && opacity > ZERO_OPACITY,
  }
}

const starsPlanFor = (derived: SkyDerivedFrame, animationSeconds: number): SkyStarsPlan => ({
  opacity: makeSkyUnitValue(smoothstep(DAYLIGHT_MIN, STAR_NIGHT_FULL_ELEVATION, -derived.solarElevation) * (DAYLIGHT_MAX - derived.daylight)),
  positions: STAR_POSITIONS,
  twinkle: makeSkyUnitValue(STAR_TWINKLE_BASE + STAR_TWINKLE_VARIATION * Math.sin(animationSeconds * STAR_TWINKLE_SPEED)),
})

const overworldPlan = (frame: SkyFrameInput, derived: SkyDerivedFrame, animationSeconds: number): SkyRenderPlan => ({
    anchor: frame.cameraPosition,
    cameraPitchRadians: frame.cameraPitchRadians,
    cameraYawRadians: frame.cameraYawRadians,
    clouds: cloudLayers({
      animationSeconds,
      cameraPosition: frame.cameraPosition,
      daylight: derived.daylight,
      visible: true,
    }),
    daylight: makeSkyUnitValue(derived.daylight),
    dimension: frame.dimension,
    horizonColor: makeSkyColor(derived.colors.horizonColor),
    moon: moonPlanFor(frame, derived),
    skyColor: makeSkyColor(derived.colors.skyColor),
    solarElevation: makeSkyAngleRadians(derived.solarElevation),
    stars: starsPlanFor(derived, animationSeconds),
    sun: sunPlanFor(derived),
  })

/** Plan all world-space sky visuals from a validated simulation time and render clock. */
const planValidatedSkyFrame = (frame: SkyFrameInput): Result.Result<SkyRenderPlan, SkyRenderInputError> => {
  const validationError = validationErrorFor(frame)
  if (validationError !== undefined) {
    return Result.fail(validationError)
  }
  const animationTime = animationTimeSeconds(frame)
  if (Result.isFailure(animationTime)) {
    return Result.fail(INVALID_INPUT_ERROR)
  }
  const derived = deriveSkyFrame(frame)
  if (frame.dimension !== 'overworld') {
    return Result.succeed(nonOverworldPlan(frame, derived, animationTime.success))
  }
  return Result.succeed(overworldPlan(frame, derived, animationTime.success))
}

export const planSkyFrame = (input: unknown): Result.Result<SkyRenderPlan, SkyRenderInputError> => {
  const decoded = decodeSkyFrameInput(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }
  return planValidatedSkyFrame(decoded.success)
}

export const SKY_DAY_LENGTH_TICKS: number = DAY_LENGTH_TICKS
export const SKY_LAST_TICK_OF_DAY: number = LAST_TICK_OF_DAY
export const SKY_MOON_PHASE_COUNT: number = MOON_PHASE_COUNT
export const SKY_STAR_DIRECTIONS: ReadonlyArray<SkyPosition> = STAR_POSITIONS
