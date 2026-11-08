import { describe, expect, it } from 'vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  SKY_DAY_LENGTH_TICKS,
  SKY_LAST_TICK_OF_DAY,
  SKY_MOON_PHASE_COUNT,
  SkyFrameInputSchema,
  SkyRenderResultSchema,
  planSkyFrame,
  type SkyRenderPlan,
} from '../src/domain/sky-rendering.js'

const SKY_RADIUS = 160
const MIDDAY_TICK = SKY_DAY_LENGTH_TICKS / 4
const SUNSET_TICK = SKY_DAY_LENGTH_TICKS / 2
const MIDNIGHT_TICK = (SKY_DAY_LENGTH_TICKS * 3) / 4
const CLOUD_DRIFT_START_SECONDS = 100
const CLOUD_DRIFT_END_SECONDS = 110
const CLOUD_BASE_WORLD_Y = 192.33
const CLOUD_UPPER_WORLD_Y = 196.33
const CLOUD_WRAP_DISTANCE = 240
const TICKS_PER_SECOND = 20
const MAX_PROPERTY_SIMULATION_TICK = 2_000_000
const MOON_PHASE_ILLUMINATION: ReadonlyArray<number> = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75]
const PROPERTY_RUNS = 200
const PROPERTY_CAMERA_COORDINATE_LIMIT = 10_000
const EXPECTED_NEAR_CLOUD_SPEED_X = -0.78
const EXPECTED_FAR_CLOUD_SPEED_X = -0.43
const CLOUD_SPEED_Z = 0
const EXPECTED_STAR_TWINKLE_BASE = 0.5
const EXPECTED_STAR_TWINKLE_VARIATION = 0.5
const EXPECTED_STAR_TWINKLE_SPEED = 1.7

type SkyFrameInputEncoded = Schema.Codec.Encoded<typeof SkyFrameInputSchema>

const frame = (overrides: Partial<SkyFrameInputEncoded> = {}): SkyFrameInputEncoded => ({
  cameraPosition: { x: 12, y: 70, z: -5 },
  cameraPitchRadians: 0,
  cameraYawRadians: 0,
  dimension: 'overworld',
  moonPhase: 0,
  partialTick: 0,
  simulationTick: 0,
  timeOfDayTicks: 0,
  ...overrides,
})

const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus

const skyFrameArbitrary = FastCheck.record({
  cameraPitchRadians: FastCheck.double({ min: -Math.PI, max: Math.PI, noDefaultInfinity: true, noNaN: true }),
  cameraPosition: FastCheck.record({
    x: FastCheck.integer({ min: -PROPERTY_CAMERA_COORDINATE_LIMIT, max: PROPERTY_CAMERA_COORDINATE_LIMIT }),
    y: FastCheck.integer({ min: -PROPERTY_CAMERA_COORDINATE_LIMIT, max: PROPERTY_CAMERA_COORDINATE_LIMIT }),
    z: FastCheck.integer({ min: -PROPERTY_CAMERA_COORDINATE_LIMIT, max: PROPERTY_CAMERA_COORDINATE_LIMIT }),
  }),
  cameraYawRadians: FastCheck.double({ min: -Math.PI, max: Math.PI, noDefaultInfinity: true, noNaN: true }),
  dimension: FastCheck.constant('overworld'),
  moonPhase: FastCheck.integer({ min: 0, max: SKY_MOON_PHASE_COUNT - 1 }),
  partialTick: FastCheck.integer({ min: 0, max: 999_999 }).map((value) => value / 1_000_000),
  simulationTick: FastCheck.integer({ min: 0, max: MAX_PROPERTY_SIMULATION_TICK }),
  timeOfDayTicks: FastCheck.integer({ min: 0, max: SKY_LAST_TICK_OF_DAY }),
})

const success = (input: unknown): SkyRenderPlan | undefined => {
  const actual = planSkyFrame(input)
  expect(Result.isSuccess(actual)).toBe(true)
  if (Result.isFailure(actual)) {
    return undefined
  }
  return actual.success
}

describe('sky render planning', () => {
  it('places the sun through sunrise, noon, sunset, and the last tick of the day', () => {
    const sunrise = success(frame())
    const noon = success(frame({ timeOfDayTicks: MIDDAY_TICK }))
    const sunset = success(frame({ timeOfDayTicks: SUNSET_TICK }))
    const lastTick = success(frame({ timeOfDayTicks: SKY_LAST_TICK_OF_DAY }))
    if (sunrise === undefined || noon === undefined || sunset === undefined || lastTick === undefined) {
      return
    }

    expect(sunrise.sun.position).toMatchObject({ x: SKY_RADIUS, y: 0, z: 0 })
    expect(noon.sun.position.y).toBeCloseTo(SKY_RADIUS)
    expect(sunset.sun.position.x).toBeCloseTo(-SKY_RADIUS)
    expect(lastTick.sun.position.y).toBeLessThan(0)
    expect(lastTick.sun.visible).toBe(true)
  })

  it('gives sunrise and sunset different horizon colors', () => {
    const sunrise = success(frame())
    const sunset = success(frame({ timeOfDayTicks: SUNSET_TICK }))
    if (sunrise === undefined || sunset === undefined) {
      return
    }

    expect(sunrise.horizonColor).not.toBe(sunset.horizonColor)
  })

  it('maps all eight moon phases and keeps the moon opposite the sun', () => {
    for (let phase = 0; phase < SKY_MOON_PHASE_COUNT; phase += 1) {
      const plan = success(frame({ moonPhase: phase, timeOfDayTicks: MIDNIGHT_TICK }))
      if (plan === undefined) {
        return
      }
      const expectedIllumination = MOON_PHASE_ILLUMINATION[phase]

      expect(plan.moon.phase).toBe(phase)
      expect(plan.moon.illumination).toBe(expectedIllumination)
      expect(plan.moon.position.y).toBeCloseTo(SKY_RADIUS)
      expect(plan.moon.position.x).toBeCloseTo(-plan.sun.position.x)
    }
  })

  it('moves two cloud layers at different heights as render time advances', () => {
    const still = success(frame({ simulationTick: CLOUD_DRIFT_START_SECONDS * TICKS_PER_SECOND }))
    const later = success(frame({ simulationTick: CLOUD_DRIFT_END_SECONDS * TICKS_PER_SECOND }))
    const movedCamera = success(frame({
      cameraPosition: { x: 62, y: 70, z: 35 },
      simulationTick: CLOUD_DRIFT_START_SECONDS * TICKS_PER_SECOND,
    }))
    if (still === undefined || later === undefined || movedCamera === undefined) {
      return
    }

    expect(still.clouds).toHaveLength(2)
    expect(still.clouds[0]?.worldY).toBe(CLOUD_BASE_WORLD_Y)
    expect(still.clouds[1]?.worldY).toBe(CLOUD_UPPER_WORLD_Y)
    expect(later.clouds[0]?.offsetX).toBeLessThan(still.clouds[0]?.offsetX ?? 0)
    expect(later.clouds[1]?.offsetX).toBeLessThan(still.clouds[1]?.offsetX ?? 0)
    expect((still.anchor.x + (still.clouds[0]?.offsetX ?? 0)) % CLOUD_WRAP_DISTANCE).toBeCloseTo(
      (movedCamera.anchor.x + (movedCamera.clouds[0]?.offsetX ?? 0)) % CLOUD_WRAP_DISTANCE,
    )
  })

  it('rejects a time outside the simulation day range and accepts its last tick', () => {
    expect(Result.isSuccess(planSkyFrame(frame({ timeOfDayTicks: 0 })))).toBe(true)
    expect(Result.isSuccess(planSkyFrame(frame({ timeOfDayTicks: SKY_LAST_TICK_OF_DAY })))).toBe(true)
    expect(planSkyFrame(frame({ timeOfDayTicks: -1 }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'time-out-of-range' } })
    expect(planSkyFrame(frame({ timeOfDayTicks: SKY_DAY_LENGTH_TICKS }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'time-out-of-range' },
    })
  })

  it('rejects phases outside the eight valid moon phases', () => {
    expect(planSkyFrame(frame({ moonPhase: -1 }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'phase-out-of-range' } })
    expect(planSkyFrame(frame({ moonPhase: SKY_MOON_PHASE_COUNT }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'phase-out-of-range' },
    })
    expect(planSkyFrame(frame({ moonPhase: 1.5 }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'phase-out-of-range' } })
  })

  it('rejects invalid simulation and partial ticks', () => {
    expect(planSkyFrame(frame({ simulationTick: -1 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'invalid-input' },
    })
    expect(planSkyFrame(frame({ simulationTick: Number.MAX_SAFE_INTEGER + 1 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'invalid-input' },
    })
    expect(planSkyFrame(frame({ partialTick: 1 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'invalid-input' },
    })
  })

  it('rejects non-integer time-of-day ticks', () => {
    expect(planSkyFrame(frame({ timeOfDayTicks: 1.5 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'invalid-input' },
    })
  })

  it('hides celestial and cloud visuals outside the overworld', () => {
    const nether = success(frame({ dimension: 'nether' }))
    const end = success(frame({ dimension: 'end' }))
    if (nether === undefined || end === undefined) {
      return
    }

    expect(nether.sun.visible).toBe(false)
    expect(nether.moon.visible).toBe(false)
    expect(nether.stars.opacity).toBe(0)
    expect(nether.clouds.every(({ opacity }) => opacity === 0)).toBe(true)
    expect(end.sun.visible).toBe(false)
    expect(end.clouds.every(({ opacity }) => opacity === 0)).toBe(true)
  })

  it('returns a schema-decodable result for arbitrary input without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const actual = planSkyFrame(input)
        const decoded = Schema.decodeUnknownResult(SkyRenderResultSchema, { onExcessProperty: 'error' })(actual)
        return Result.isSuccess(decoded)
      }),
    )
  })

  it('matches independent astronomical and animation-time expectations for valid generated frames', () => {
    FastCheck.assert(
      FastCheck.property(skyFrameArbitrary, (input) => {
        const actual = planSkyFrame(input)
        if (Result.isFailure(actual)) {
          return false
        }
        const expectedAnimationSeconds = (input.simulationTick + input.partialTick) / TICKS_PER_SECOND
        const expectedSunRadians = (input.timeOfDayTicks / SKY_DAY_LENGTH_TICKS) * Math.PI * 2
        const expectedIllumination = MOON_PHASE_ILLUMINATION[input.moonPhase]
        const [nearCloud, farCloud] = actual.success.clouds

        expect(actual.success.sun.position.x).toBeCloseTo(Math.cos(expectedSunRadians) * SKY_RADIUS)
        expect(actual.success.sun.position.y).toBeCloseTo(Math.sin(expectedSunRadians) * SKY_RADIUS)
        expect(actual.success.moon.phase).toBe(input.moonPhase)
        expect(actual.success.moon.illumination).toBeCloseTo(expectedIllumination ?? Number.NaN)
        expect(actual.success.moon.position.x).toBeCloseTo(-actual.success.sun.position.x)
        expect(actual.success.moon.position.y).toBeCloseTo(-actual.success.sun.position.y)
        expect(nearCloud.offsetX).toBeCloseTo(
          modulo(expectedAnimationSeconds * EXPECTED_NEAR_CLOUD_SPEED_X - input.cameraPosition.x, CLOUD_WRAP_DISTANCE),
        )
        expect(nearCloud.offsetZ).toBeCloseTo(
          modulo(expectedAnimationSeconds * CLOUD_SPEED_Z - input.cameraPosition.z, CLOUD_WRAP_DISTANCE),
        )
        expect(farCloud.offsetX).toBeCloseTo(
          modulo(expectedAnimationSeconds * EXPECTED_FAR_CLOUD_SPEED_X - input.cameraPosition.x, CLOUD_WRAP_DISTANCE),
        )
        expect(farCloud.offsetZ).toBeCloseTo(
          modulo(expectedAnimationSeconds * CLOUD_SPEED_Z - input.cameraPosition.z, CLOUD_WRAP_DISTANCE),
        )
        expect(actual.success.stars.twinkle).toBeCloseTo(
          EXPECTED_STAR_TWINKLE_BASE + EXPECTED_STAR_TWINKLE_VARIATION * Math.sin(expectedAnimationSeconds * EXPECTED_STAR_TWINKLE_SPEED),
        )
        return true
      }),
      { numRuns: PROPERTY_RUNS, seed: 0 },
    )
  })

})
