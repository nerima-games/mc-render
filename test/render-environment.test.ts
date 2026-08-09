import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DAY_SKY_COLOR,
  NIGHT_SKY_COLOR,
  planRenderEnvironment,
} from '../src/domain/render-environment'

describe('render environment planning', () => {
  it.effect('maps night and day to the reference sky endpoints', () =>
    Effect.sync(() => {
      expect(planRenderEnvironment(0).skyColor).toBe(NIGHT_SKY_COLOR)
      expect(planRenderEnvironment(1).skyColor).toBe(DAY_SKY_COLOR)
    }),
  )

  it.effect('clamps external daylight and keeps the fog interval ordered', () =>
    Effect.sync(() => {
      expect(planRenderEnvironment(-2, 100).daylight).toBe(0)
      expect(planRenderEnvironment(2, 100).daylight).toBe(1)
      expect(planRenderEnvironment(Number.NaN, 100).daylight).toBe(0)
      expect(planRenderEnvironment(0.5, 100)).toMatchObject({ fogNear: 45, fogFar: 90 })
    }),
  )

  it.effect('falls back to the default far plane for a non-positive or non-finite value', () =>
    Effect.sync(() => {
      // `resolveFarPlane` guards against a far plane that would put the fog
      // interval behind the camera or make it NaN: zero, negative, and
      // non-finite are all rejected the same way, in favor of
      // DEFAULT_ENVIRONMENT_FAR_PLANE (300) rather than propagating the bad
      // value into `fogNear`/`fogFar`.
      const defaultFog = { fogFar: 270, fogNear: 135 }
      expect(planRenderEnvironment(0.5, 0)).toMatchObject(defaultFog)
      expect(planRenderEnvironment(0.5, -50)).toMatchObject(defaultFog)
      expect(planRenderEnvironment(0.5, Number.NaN)).toMatchObject(defaultFog)
      expect(planRenderEnvironment(0.5, Number.POSITIVE_INFINITY)).toMatchObject(defaultFog)
    }),
  )

  it.effect('is deterministic and emits normalized fog channels', () =>
    Effect.sync(() => {
      const first = planRenderEnvironment(0.375, 640)
      expect(planRenderEnvironment(0.375, 640)).toStrictEqual(first)
      expect(first.fogColor.every((value) => value >= 0 && value <= 1)).toBe(true)
    }),
  )
})
