import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  INITIAL_WEATHER_RENDER_STATE,
  planWeatherFrame,
  type WorldWeatherSnapshot,
} from '../src/domain/weather-rendering'

const camera = { x: 10, y: 64, z: -5 }
const rain: WorldWeatherSnapshot = {
  mode: 'rain',
  intensity: 0.5,
  daylight: 1,
  temperature: 0.8,
  seed: 42,
}

describe('weather frame planning', () => {
  it.effect('is deterministic for the same snapshot, camera, and state', () =>
    Effect.sync(() => {
      const first = planWeatherFrame(rain, camera, INITIAL_WEATHER_RENDER_STATE)
      expect(planWeatherFrame(rain, camera, INITIAL_WEATHER_RENDER_STATE)).toStrictEqual(first)
      expect(first.plan.particles).toHaveLength(48)
    }),
  )

  it.effect('clamps intensity and keeps every particle inside the camera volume', () =>
    Effect.sync(() => {
      const planned = planWeatherFrame(
        { ...rain, intensity: 4 },
        camera,
        INITIAL_WEATHER_RENDER_STATE,
        { particleCapacity: 8, precipitationRadius: 3, precipitationHeight: 7 },
      )
      expect(planned.plan.particles).toHaveLength(8)
      for (const particle of planned.plan.particles) {
        expect(Math.abs(particle.x - camera.x)).toBeLessThanOrEqual(3)
        expect(Math.abs(particle.z - camera.z)).toBeLessThanOrEqual(3)
        expect(particle.y).toBeGreaterThanOrEqual(camera.y)
        expect(particle.y).toBeLessThanOrEqual(camera.y + 7)
      }
      expect(planWeatherFrame({ ...rain, intensity: -1 }, camera).plan.particles).toHaveLength(0)
    }),
  )

  it.effect('switches rain and thunder precipitation to snow at the temperature boundary', () =>
    Effect.sync(() => {
      expect(planWeatherFrame({ ...rain, temperature: 0.15 }, camera).plan.precipitation).toBe('snow')
      expect(planWeatherFrame({ ...rain, temperature: 0.151 }, camera).plan.precipitation).toBe('rain')
      expect(planWeatherFrame({ ...rain, mode: 'snow', temperature: 1 }, camera).plan.precipitation).toBe('snow')
    }),
  )

  it.effect('darkens rain, shortens fog, and restores the clear environment', () =>
    Effect.sync(() => {
      const wet = planWeatherFrame({ ...rain, intensity: 1 }, camera).plan
      const clear = planWeatherFrame({ ...rain, mode: 'clear', intensity: 1 }, camera).plan
      expect(wet.brightness).toBeLessThan(clear.brightness)
      expect(wet.environment.fogFar).toBeLessThan(clear.environment.fogFar)
      expect(clear.precipitation).toBeUndefined()
      expect(clear.particles).toStrictEqual([])
    }),
  )

  it.effect('emits one temporary flash per lightning sequence and supports state restore', () =>
    Effect.sync(() => {
      const strike = { ...rain, mode: 'thunder' as const, lightningSequence: 7 }
      const first = planWeatherFrame(strike, camera, INITIAL_WEATHER_RENDER_STATE, {
        lightningDurationFrames: 3,
      })
      const restored = planWeatherFrame(strike, camera, first.state, { lightningDurationFrames: 3 })
      const last = planWeatherFrame(strike, camera, restored.state, { lightningDurationFrames: 3 })
      const expired = planWeatherFrame(strike, camera, last.state, { lightningDurationFrames: 3 })
      expect(first.plan.lightningFlash).toBe(1)
      expect(restored.plan.lightningFlash).toBeCloseTo(2 / 3)
      expect(last.plan.lightningFlash).toBeCloseTo(1 / 3)
      expect(expired.plan.lightningFlash).toBe(0)
      expect(planWeatherFrame({ ...strike, mode: 'clear' }, camera, first.state).plan.lightningFlash).toBe(0)
    }),
  )
})
