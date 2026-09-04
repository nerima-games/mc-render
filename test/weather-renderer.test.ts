import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
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
