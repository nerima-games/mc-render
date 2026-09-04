import type { Dimension } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DAY_SKY_COLOR,
  END_VOID_COLOR,
  NETHER_FOG_COLOR,
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

  describe('dimension-aware sky', () => {
    it.effect('defaults to `overworld`, and an explicit `overworld` is byte-for-byte the same plan a caller got before dimensions existed', () =>
      Effect.sync(() => {
        const implicit = planRenderEnvironment(0.6, 200)
        const explicit = planRenderEnvironment(0.6, 200, 'overworld')
        expect(implicit).toStrictEqual(explicit)
        expect(implicit.dimension).toBe('overworld')
        expect(implicit.skyColor).toBe(planRenderEnvironment(0.6, 200).skyColor)
        expect(planRenderEnvironment(0, 200, 'overworld').skyColor).toBe(NIGHT_SKY_COLOR)
        expect(planRenderEnvironment(1, 200, 'overworld').skyColor).toBe(DAY_SKY_COLOR)
      }),
    )

    it.effect('the nether has no visible sky and no day/night cycle: `daylight` does not move it', () =>
      Effect.sync(() => {
        const night = planRenderEnvironment(0, 200, 'nether')
        const day = planRenderEnvironment(1, 200, 'nether')
        // `daylight` still echoes its (clamped) input either way; every
        // visually-relevant field ignores it entirely for this dimension.
        expect(night.skyColor).toBe(day.skyColor)
        expect(night.fogColor).toStrictEqual(day.fogColor)
        expect(night.fogNear).toBe(day.fogNear)
        expect(night.fogFar).toBe(day.fogFar)
        expect(night.sunIntensity).toBe(day.sunIntensity)
        expect(night.dimension).toBe('nether')
        expect(night.skyColor).toBe(NETHER_FOG_COLOR)
        expect(night.sunIntensity).toBe(0)
      }),
    )

    it.effect('the end is a dark, sunless void, distinct from both overworld night and the nether', () =>
      Effect.sync(() => {
        const plan = planRenderEnvironment(1, 200, 'end')
        expect(plan.dimension).toBe('end')
        expect(plan.skyColor).toBe(END_VOID_COLOR)
        expect(plan.sunIntensity).toBe(0)
        expect(plan.skyColor).not.toBe(NIGHT_SKY_COLOR)
        expect(plan.skyColor).not.toBe(NETHER_FOG_COLOR)
      }),
    )

    it.effect('the three dimensions render three different sky colours for the same daylight and far plane', () =>
      Effect.sync(() => {
        const colors = new Set(
          (['overworld', 'nether', 'end'] as const).map(
            (dimension) => planRenderEnvironment(1, 200, dimension).skyColor,
          ),
        )
        expect(colors.size).toBe(3)
      }),
    )

    it.effect("the nether's fog is tighter than the overworld's, regardless of the far plane", () =>
      Effect.sync(() => {
        const overworld = planRenderEnvironment(1, 200, 'overworld')
        const nether = planRenderEnvironment(1, 200, 'nether')
        expect(nether.fogNear).toBeLessThan(overworld.fogNear)
        expect(nether.fogFar).toBeLessThan(overworld.fogFar)
      }),
    )

    it.effect('an unrecognized dimension falls back to `overworld`, the same defensive treatment this file gives NaN', () =>
      Effect.sync(() => {
        const invalid = 'moon' as Dimension
        expect(planRenderEnvironment(1, 200, invalid)).toStrictEqual(planRenderEnvironment(1, 200, 'overworld'))
      }),
    )
  })
})
