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
      const first = planWeatherFrame({ camera, previous: INITIAL_WEATHER_RENDER_STATE, snapshot: rain })
      expect(
        planWeatherFrame({ camera, previous: INITIAL_WEATHER_RENDER_STATE, snapshot: rain }),
      ).toStrictEqual(first)
      expect(first.plan.particles).toHaveLength(48)
    }),
  )

  it.effect('advances precipitation downward without changing its horizontal track', () =>
    Effect.sync(() => {
      const first = planWeatherFrame({
        camera,
        options: { particleCapacity: 2 },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: rain,
      })
      const second = planWeatherFrame({
        camera,
        options: { particleCapacity: 2 },
        previous: first.state,
        snapshot: rain,
      })
      expect(second.plan.particles[0]?.x).toBe(first.plan.particles[0]?.x)
      expect(second.plan.particles[0]?.z).toBe(first.plan.particles[0]?.z)
      expect(second.plan.particles[0]?.y).toBeLessThan(first.plan.particles[0]?.y ?? 0)
      expect(
        planWeatherFrame({
          camera,
          options: { particleCapacity: 2 },
          previous: first.state,
          snapshot: rain,
        }),
      ).toStrictEqual(second)
    }),
  )

  it.effect('clamps intensity and keeps every particle inside the camera volume', () =>
    Effect.sync(() => {
      const planned = planWeatherFrame({
        camera,
        options: { particleCapacity: 8, precipitationHeight: 7, precipitationRadius: 3 },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: { ...rain, intensity: 4 },
      })
      expect(planned.plan.particles).toHaveLength(8)
      for (const particle of planned.plan.particles) {
        expect(Math.abs(particle.x - camera.x)).toBeLessThanOrEqual(3)
        expect(Math.abs(particle.z - camera.z)).toBeLessThanOrEqual(3)
        expect(particle.y).toBeGreaterThanOrEqual(camera.y)
        expect(particle.y).toBeLessThanOrEqual(camera.y + 7)
      }
      expect(
        planWeatherFrame({ camera, snapshot: { ...rain, intensity: -1 } }).plan.particles,
      ).toHaveLength(0)
    }),
  )

  it.effect('switches rain and thunder precipitation to snow at the temperature boundary', () =>
    Effect.sync(() => {
      expect(
        planWeatherFrame({ camera, snapshot: { ...rain, temperature: 0.15 } }).plan.precipitation,
      ).toBe('snow')
      expect(
        planWeatherFrame({ camera, snapshot: { ...rain, temperature: 0.151 } }).plan.precipitation,
      ).toBe('rain')
      expect(
        planWeatherFrame({ camera, snapshot: { ...rain, mode: 'snow', temperature: 1 } }).plan
          .precipitation,
      ).toBe('snow')
    }),
  )

  it.effect('darkens rain, shortens fog, and restores the clear environment', () =>
    Effect.sync(() => {
      const wet = planWeatherFrame({ camera, snapshot: { ...rain, intensity: 1 } }).plan
      const clear = planWeatherFrame({
        camera,
        snapshot: { ...rain, mode: 'clear', intensity: 1 },
      }).plan
      expect(wet.brightness).toBeLessThan(clear.brightness)
      expect(wet.environment.fogFar).toBeLessThan(clear.environment.fogFar)
      expect(clear.precipitation).toBeUndefined()
      expect(clear.particles).toStrictEqual([])
    }),
  )

  it.effect('emits one temporary flash per lightning sequence and supports state restore', () =>
    Effect.sync(() => {
      const strike = { ...rain, mode: 'thunder' as const, lightningSequence: 7 }
      const first = planWeatherFrame({
        camera,
        options: { lightningDurationFrames: 3 },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: strike,
      })
      const restored = planWeatherFrame({
        camera,
        options: { lightningDurationFrames: 3 },
        previous: first.state,
        snapshot: strike,
      })
      const last = planWeatherFrame({
        camera,
        options: { lightningDurationFrames: 3 },
        previous: restored.state,
        snapshot: strike,
      })
      const expired = planWeatherFrame({
        camera,
        options: { lightningDurationFrames: 3 },
        previous: last.state,
        snapshot: strike,
      })
      expect(first.plan.lightningFlash).toBe(1)
      expect(restored.plan.lightningFlash).toBeCloseTo(2 / 3)
      expect(last.plan.lightningFlash).toBeCloseTo(1 / 3)
      expect(expired.plan.lightningFlash).toBe(0)
      expect(
        planWeatherFrame({ camera, previous: first.state, snapshot: { ...strike, mode: 'clear' } })
          .plan.lightningFlash,
      ).toBe(0)
    }),
  )
})
