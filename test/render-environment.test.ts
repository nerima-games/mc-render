import type { Dimension } from '@nerima-games/mc-kernel'
import * as FastCheck from 'fast-check'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import {
  DAY_SKY_COLOR,
  END_VOID_COLOR,
  NETHER_FOG_COLOR,
  NIGHT_SKY_COLOR,
  RenderEnvironmentInputSchema,
  RenderEnvironmentPlanSchema,
  planRenderEnvironment,
} from '../src/domain/render-environment'
import { renderEnvironmentPlan as plan } from './support/render-environment'

describe('render environment planning', () => {
  it.effect('maps valid daylight endpoints to the reference sky colors', () =>
    Effect.sync(() => {
      expect(plan(0).skyColor).toBe(NIGHT_SKY_COLOR)
      expect(plan(1).skyColor).toBe(DAY_SKY_COLOR)
    }),
  )

  it.effect('accepts daylight boundaries and rejects values outside the unit interval', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(planRenderEnvironment(0))).toBe(true)
      expect(Result.isSuccess(planRenderEnvironment(1))).toBe(true)
      const invalidDaylight = planRenderEnvironment(Number.NaN)
      expect(Result.isFailure(invalidDaylight)).toBe(true)
      if (Result.isFailure(invalidDaylight)) {
        expect(invalidDaylight.failure).toBeInstanceOf(Schema.SchemaError)
      }
      for (const daylight of [-Number.MIN_VALUE, 1 + Number.EPSILON, Number.NaN, Infinity, -Infinity, null]) {
        expect(Result.isFailure(planRenderEnvironment(daylight as number))).toBe(true)
      }
    }),
  )

  it.effect('rejects invalid far planes and defaults only when the option is omitted', () =>
    Effect.sync(() => {
      const defaultFog = { fogFar: 270, fogNear: 135 }
      expect(plan(0.5)).toMatchObject(defaultFog)
      expect(plan(0.5, undefined)).toMatchObject(defaultFog)
      expect(plan(0.5, Number.MIN_VALUE).daylight).toBe(0.5)
      for (const farPlane of [0, -Number.MIN_VALUE, Number.NaN, Infinity, -Infinity, null]) {
        expect(Result.isFailure(planRenderEnvironment(0.5, farPlane as number))).toBe(true)
      }
    }),
  )

  it.effect('is deterministic and emits normalized fog channels', () =>
    Effect.sync(() => {
      const first = plan(0.375, 640)
      expect(plan(0.375, 640)).toStrictEqual(first)
      expect(first.fogColor.every((value) => value >= 0 && value <= 1)).toBe(true)
    }),
  )

  describe('dimension-aware sky', () => {
    it.effect('defaults to `overworld`, and explicit `overworld` yields the same plan', () =>
      Effect.sync(() => {
        const implicit = plan(0.6, 200)
        const explicit = plan(0.6, 200, 'overworld')
        expect(implicit).toStrictEqual(explicit)
        expect(implicit.dimension).toBe('overworld')
        expect(implicit.skyColor).toBe(plan(0.6, 200).skyColor)
        expect(plan(0, 200, 'overworld').skyColor).toBe(NIGHT_SKY_COLOR)
        expect(plan(1, 200, 'overworld').skyColor).toBe(DAY_SKY_COLOR)
      }),
    )

    it.effect('the nether has no visible sky or day/night cycle', () =>
      Effect.sync(() => {
        const night = plan(0, 200, 'nether')
        const day = plan(1, 200, 'nether')
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

    it.effect('the end is a dark, sunless void distinct from overworld night and the nether', () =>
      Effect.sync(() => {
        const end = plan(1, 200, 'end')
        expect(end.dimension).toBe('end')
        expect(end.skyColor).toBe(END_VOID_COLOR)
        expect(end.sunIntensity).toBe(0)
        expect(end.skyColor).not.toBe(NIGHT_SKY_COLOR)
        expect(end.skyColor).not.toBe(NETHER_FOG_COLOR)
      }),
    )

    it.effect('renders three different sky colors for the same daylight and far plane', () =>
      Effect.sync(() => {
        const colors = new Set((['overworld', 'nether', 'end'] as const).map((dimension) => plan(1, 200, dimension).skyColor))
        expect(colors.size).toBe(3)
      }),
    )

    it.effect("the nether's fog is tighter than the overworld's", () =>
      Effect.sync(() => {
        const overworld = plan(1, 200, 'overworld')
        const nether = plan(1, 200, 'nether')
        expect(nether.fogNear).toBeLessThan(overworld.fogNear)
        expect(nether.fogFar).toBeLessThan(overworld.fogFar)
      }),
    )

    it.effect('rejects an unrecognized or null dimension', () =>
      Effect.sync(() => {
        for (const dimension of ['moon', null]) {
          expect(Result.isFailure(planRenderEnvironment(1, 200, dimension as Dimension))).toBe(true)
        }
      }),
    )
  })

  it('returns a typed failure or a value decoded by the exported plan schema for arbitrary inputs', () => {
    const optionalAnything = FastCheck.oneof(FastCheck.constant(undefined), FastCheck.anything())
    FastCheck.assert(FastCheck.property(
      FastCheck.tuple(FastCheck.anything(), optionalAnything, optionalAnything),
      ([daylight, farPlane, dimension]) => {
        const result = planRenderEnvironment(daylight as number, farPlane as number | undefined, dimension as Dimension | undefined)
        return Result.isFailure(result) || Result.isSuccess(Schema.decodeUnknownResult(RenderEnvironmentPlanSchema)(result.success))
      },
    ))
  })

  it('exports an input schema for the accepted option boundaries', () => {
    const decoded = Schema.decodeUnknownResult(RenderEnvironmentInputSchema)({ daylight: 0, dimension: 'end', farPlane: Number.MIN_VALUE })
    expect(Result.isSuccess(decoded)).toBe(true)
  })
})
