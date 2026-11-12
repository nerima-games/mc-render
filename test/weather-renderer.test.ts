import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  makeWeatherRenderer,
  type WeatherPrecipitationResource,
} from '../src/application/weather-renderer'
import type { RenderEnvironmentPlan } from '../src/domain/render-environment'
import type { PrecipitationKind, WorldWeatherSnapshot } from '../src/domain/weather-rendering'

const CLEAR_INTENSITY = 0
const PRECIPITATING_INTENSITY = 1

const intensityFor = (mode: WorldWeatherSnapshot['mode']): number => {
  if (mode === 'clear') {
    return CLEAR_INTENSITY
  }
  return PRECIPITATING_INTENSITY
}

const camera = { x: 0, y: 70, z: 0 }
const snapshot = (mode: WorldWeatherSnapshot['mode'], temperature: number = 1): WorldWeatherSnapshot => ({
  mode,
  intensity: intensityFor(mode),
  daylight: 0.8,
  temperature,
  seed: 9,
})

describe('weather renderer resource lifecycle', () => {
  it.effect('rejects invalid options before invoking renderer ports', () =>
    Effect.gen(function* () {
      let environmentCalls = 0
      const result = yield* Effect.result(makeWeatherRenderer({
        setEnvironment: () => Effect.sync(() => { environmentCalls += 1 }),
        createPrecipitation: () => Effect.die('invalid options must fail before creating precipitation'),
      }, { farPlane: Number.NaN }))

      expect(Result.isFailure(result)).toBe(true)
      expect(environmentCalls).toBe(0)
    }),
  )

  it.effect('reuses resources, forwards resize, and releases on clear and dispose', () =>
    Effect.gen(function* () {
      const created: Array<PrecipitationKind> = []
      const updates: Array<number> = []
      const resizes: Array<string> = []
      let disposals = 0
      let environments = 0
      const makeResource = (): WeatherPrecipitationResource => ({
        update: (particles) => Effect.sync(() => { updates.push(particles.length) }),
        resize: ({ width, height }) => Effect.sync(() => { resizes.push(`${width}x${height}`) }),
        dispose: Effect.sync(() => { disposals += 1 }),
      })
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.sync(() => { environments += 1 }),
        createPrecipitation: (kind) => Effect.sync(() => {
          created.push(kind)
          return makeResource()
        }),
      }, { particleCapacity: 4 })

      yield* renderer.resize({ width: 800, height: 600 })
      yield* renderer.frame(snapshot('rain'), camera)
      yield* renderer.frame(snapshot('rain'), camera)
      expect(created).toStrictEqual(['rain'])
      expect(updates).toStrictEqual([4, 4])
      expect(resizes).toStrictEqual(['800x600'])

      yield* renderer.frame(snapshot('clear'), camera)
      expect(disposals).toBe(1)
      yield* renderer.dispose
      yield* renderer.dispose
      expect(disposals).toBe(1)
      expect(environments).toBe(5)
    }),
  )

  it.effect('forwards active strikes and hides their geometry after the flash expires', () =>
    Effect.gen(function* () {
      const createdKinds: Array<PrecipitationKind> = []
      const boltSequences: Array<number | undefined> = []
      const flashes: Array<number> = []
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.void,
        createPrecipitation: (kind) => Effect.sync(() => {
          createdKinds.push(kind)
          return {
            update: () => Effect.void,
            updateLightning: (bolt, flash) => Effect.sync(() => {
              boltSequences.push(bolt?.sequence)
              flashes.push(flash)
            }),
            resize: () => Effect.void,
            dispose: Effect.void,
          }
        }),
      }, { lightningDurationFrames: 1 })
      const thunder = { ...snapshot('thunder'), lightningSequence: 11 }

      const activePlan = yield* renderer.frame(thunder, camera)
      const expiredPlan = yield* renderer.frame(thunder, camera)
      expect(activePlan.lightningBolt?.sequence).toBe(11)
      expect(expiredPlan.lightningBolt).toBeUndefined()
      expect(createdKinds).toStrictEqual(['rain'])
      expect(boltSequences).toStrictEqual([11, undefined])
      expect(flashes).toStrictEqual([1, 0])

      yield* renderer.frame(snapshot('clear'), camera)
      expect(boltSequences).toStrictEqual([11, undefined])
      yield* renderer.dispose
    }),
  )

  it.effect('fails invalid thunder snapshots before mutating the renderer state or resources', () =>
    Effect.gen(function* () {
      let environments = 0
      let particleUpdates = 0
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.sync(() => { environments += 1 }),
        createPrecipitation: () => Effect.succeed({
          update: () => Effect.sync(() => { particleUpdates += 1 }),
          resize: () => Effect.void,
          dispose: Effect.void,
        }),
      })

      const invalidSeed = yield* Effect.result(renderer.frame({
        ...snapshot('thunder'),
        seed: Number.NaN,
        lightningSequence: 5,
      }, camera))
      const invalidSequence = yield* Effect.result(renderer.frame({
        ...snapshot('thunder'),
        lightningSequence: 1.5,
      }, camera))

      expect(Result.isFailure(invalidSeed)).toBe(true)
      expect(Result.isFailure(invalidSequence)).toBe(true)
      expect(environments).toBe(0)
      expect(particleUpdates).toBe(0)
      expect(yield* renderer.state).toMatchObject({ frame: 0, lightningFramesRemaining: 0 })
      yield* renderer.dispose
    }),
  )

  it.effect('keeps the active resource after a failed strike and releases it on clear', () =>
    Effect.gen(function* () {
      let environments = 0
      let particleUpdates = 0
      let disposals = 0
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.sync(() => { environments += 1 }),
        createPrecipitation: () => Effect.succeed({
          update: () => Effect.sync(() => { particleUpdates += 1 }),
          resize: () => Effect.void,
          dispose: Effect.sync(() => { disposals += 1 }),
        }),
      })

      yield* renderer.frame(snapshot('rain'), camera)
      const stateAfterRain = yield* renderer.state
      const failedStrike = yield* Effect.result(renderer.frame({
        ...snapshot('thunder'),
        lightningSequence: 8,
      }, { ...camera, x: Number.NaN }))

      expect(Result.isFailure(failedStrike)).toBe(true)
      expect(yield* renderer.state).toStrictEqual(stateAfterRain)
      expect(environments).toBe(1)
      expect(particleUpdates).toBe(1)
      expect(disposals).toBe(0)

      yield* renderer.frame(snapshot('clear'), camera)
      expect(environments).toBe(2)
      expect(disposals).toBe(1)
      yield* renderer.dispose
    }),
  )

  it.effect('keeps precipitation rendering when the host resource has no lightning updater', () =>
    Effect.gen(function* () {
      let particleUpdateCount = 0
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.void,
        createPrecipitation: () => Effect.succeed({
          update: () => Effect.sync(() => { particleUpdateCount += 1 }),
          resize: () => Effect.void,
          dispose: Effect.void,
        }),
      })
      const thunder = { ...snapshot('thunder'), lightningSequence: 7 }

      const plan = yield* renderer.frame(thunder, camera)

      expect(plan.lightningBolt).toBeDefined()
      expect(particleUpdateCount).toBe(1)
      yield* renderer.dispose
    }),
  )

  it.effect('disposes rain before acquiring snow and restores initial state on stop', () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: () => Effect.void,
        createPrecipitation: (kind) => Effect.succeed({
          update: () => Effect.void,
          resize: () => Effect.void,
          dispose: Effect.sync(() => { events.push(`dispose:${kind}`) }),
        }),
      })

      yield* renderer.frame(snapshot('rain'), camera)
      yield* renderer.frame(snapshot('rain', 0), camera)
      expect(events).toStrictEqual(['dispose:rain'])
      yield* renderer.stop(0.25)
      expect(events).toStrictEqual(['dispose:rain', 'dispose:snow'])
      expect(yield* renderer.state).toMatchObject({ frame: 0, lightningFramesRemaining: 0 })
    }),
  )

  it.effect('`stop` forwards the requested dimension to the restored environment', () =>
    Effect.gen(function* () {
      const environments: Array<RenderEnvironmentPlan> = []
      const renderer = yield* makeWeatherRenderer({
        setEnvironment: (environment) => Effect.sync(() => { environments.push(environment) }),
        createPrecipitation: () => Effect.succeed({
          update: () => Effect.void,
          resize: () => Effect.void,
          dispose: Effect.void,
        }),
      })

      yield* renderer.stop(1, 'end')
      expect(environments.at(-1)?.dimension).toBe('end')

      yield* renderer.stop(1)
      expect(environments.at(-1)?.dimension).toBe('overworld')
    }),
  )
})
