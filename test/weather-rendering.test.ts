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

  it.effect('a non-finite intensity clamps to zero rather than propagating NaN through the plan', () =>
    Effect.sync(() => {
      // `clamp01`'s `Number.isFinite` guard is what stands between a NaN
      // snapshot (a corrupt save, a sensor glitch upstream) and a NaN
      // `intensity` poisoning `count = Math.floor(capacity * intensity)`
      // below. Without it this reads as zero rain, which is the same
      // conservative answer `-1` gets above.
      const planned = planWeatherFrame({
        camera,
        options: { particleCapacity: 8 },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: { ...rain, intensity: Number.NaN },
      })
      expect(planned.plan.particles).toHaveLength(0)
    }),
  )

  it.effect('a non-finite particle capacity is treated as zero, not as NaN or Infinity particles', () =>
    Effect.sync(() => {
      // `safeInteger`'s non-finite branch is what keeps `resolveParticleSizing`
      // from handing `Array.from` a NaN/Infinity length. Distinct from the
      // intensity guard above: this exercises `options.particleCapacity`,
      // read through the same `safeInteger` helper but a different call site.
      const nan = planWeatherFrame({
        camera,
        options: { particleCapacity: Number.NaN },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: { ...rain, intensity: 1 },
      })
      const infinite = planWeatherFrame({
        camera,
        options: { particleCapacity: Number.POSITIVE_INFINITY },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: { ...rain, intensity: 1 },
      })
      expect(nan.plan.particles).toHaveLength(0)
      expect(infinite.plan.particles).toHaveLength(0)
    }),
  )

  it.effect('zero precipitation height collapses every particle onto the camera altitude', () =>
    Effect.sync(() => {
      // `wrapParticleHeight`'s `height === NO_HEIGHT` guard exists because the
      // formula below it divides the travel distance's modulus by `height` —
      // a zero precipitation height (an explicit `0`, not just "small") must
      // short-circuit to `NO_HEIGHT` rather than reach a `% 0`.
      const planned = planWeatherFrame({
        camera,
        options: { particleCapacity: 4, precipitationHeight: 0 },
        previous: INITIAL_WEATHER_RENDER_STATE,
        snapshot: { ...rain, intensity: 1 },
      })
      expect(planned.plan.particles).toHaveLength(4)
      for (const particle of planned.plan.particles) {
        expect(particle.y).toBe(camera.y)
      }
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
