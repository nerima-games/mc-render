import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  decodeLightningBoltInput,
  LightningBoltInputSchema,
  LightningFlashSchema,
  LightningSeedSchema,
  LightningSequenceSchema,
  planLightningBolt,
  type LightningBoltInput,
} from '../src/domain/lightning-bolt'
import {
  INITIAL_WEATHER_RENDER_STATE,
  planWeatherFrame as planWeatherFrameResult,
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

const planWeatherFrame = (input: Parameters<typeof planWeatherFrameResult>[0]) =>
  Result.getOrThrow(planWeatherFrameResult(input))

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

  it.effect('computes particle density as floor(capacity multiplied by clamped intensity)', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 0, max: 200 }),
          FastCheck.double({ min: 0, max: 1, noNaN: true }),
          (capacity, intensity) => {
            const planned = planWeatherFrame({
              camera,
              options: { particleCapacity: capacity },
              snapshot: { ...rain, intensity },
            })
            return planned.plan.particles.length === Math.floor(capacity * intensity)
          },
        ),
        { numRuns: 300 },
      )
    }),
  )

  it.effect('uses exact density boundaries and the value just below full intensity', () =>
    Effect.sync(() => {
      const density = (capacity: number, intensity: number): number =>
        planWeatherFrame({ camera, options: { particleCapacity: capacity }, snapshot: { ...rain, intensity } })
          .plan.particles.length
      expect(density(0, 1)).toBe(0)
      expect(density(4, 0)).toBe(0)
      expect(density(4, 0.249999)).toBe(Math.floor(4 * 0.249999))
      expect(density(4, 0.25)).toBe(1)
      expect(density(8, 0.999999)).toBe(7)
      expect(density(8, 1)).toBe(8)
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
      expect(first.plan.lightningBolt?.strands).toHaveLength(3)
      expect(first.plan.lightningBolt?.strands.every((strand) => strand.length === 9)).toBe(true)
      expect(first.plan.lightningBolt).toStrictEqual(restored.plan.lightningBolt)
      expect(restored.plan.lightningFlash).toBeCloseTo(2 / 3)
      expect(last.plan.lightningFlash).toBeCloseTo(1 / 3)
      expect(expired.plan.lightningFlash).toBe(0)
      expect(expired.plan.lightningBolt).toBeUndefined()
      expect(
        planWeatherFrame({ camera, previous: first.state, snapshot: { ...strike, mode: 'clear' } }).plan,
      ).toMatchObject({ lightningBolt: undefined, lightningFlash: 0 })
    }),
  )

  it.effect('rejects a weather snapshot with an invalid lightning seed or sequence', () =>
    Effect.sync(() => {
      const sequenceFailure = planWeatherFrameResult({
        camera,
        snapshot: { ...rain, mode: 'thunder', lightningSequence: 1.5 },
      })
      const seedFailure = planWeatherFrameResult({
        camera,
        snapshot: { ...rain, mode: 'thunder', seed: Number.NaN, lightningSequence: 2 },
      })

      expect(Result.isFailure(sequenceFailure)).toBe(true)
      expect(Result.isFailure(seedFailure)).toBe(true)
    }),
  )

  it.effect('returns a schema failure when a valid strike resolves to a non-finite bolt origin', () =>
    Effect.sync(() => {
      const invalidOrigin = planWeatherFrameResult({
        camera: { ...camera, x: Number.NaN },
        snapshot: { ...rain, mode: 'thunder', lightningSequence: 8 },
      })

      expect(Result.isFailure(invalidOrigin)).toBe(true)
    }),
  )

  it.effect('property: only schema-valid seeds and nonnegative integer sequences produce plans', () =>
    Effect.sync(() => {
      const number = FastCheck.double({ min: -1000, max: 1000, noNaN: true })
      FastCheck.assert(
        FastCheck.property(number, number, (seed, sequence) => {
          const planned = planWeatherFrameResult({
            camera,
            snapshot: { ...rain, mode: 'thunder', seed, lightningSequence: sequence },
          })
          const validInput = Number.isInteger(seed) && Number.isInteger(sequence) && sequence >= 0
          if (!validInput) {
            return Result.isFailure(planned)
          }
          if (Result.isFailure(planned)) {
            return false
          }
          return Result.isSuccess(Schema.decodeUnknownResult(LightningSeedSchema)(seed)) &&
            Result.isSuccess(Schema.decodeUnknownResult(LightningSequenceSchema)(sequence)) &&
            Result.isSuccess(Schema.decodeUnknownResult(LightningFlashSchema)(planned.success.plan.lightningFlash))
        }),
        { numRuns: 300 },
      )
    }),
  )

  it.effect('accepts numeric schema boundaries and rejects values immediately outside them', () =>
    Effect.sync(() => {
      const plan = (seed: number, lightningSequence: number) =>
        planWeatherFrameResult({ camera, snapshot: { ...rain, mode: 'thunder', seed, lightningSequence } })

      expect(Result.isSuccess(plan(0, 0))).toBe(true)
      expect(Result.isSuccess(plan(-1, 1))).toBe(true)
      expect(Result.isFailure(plan(Number.MIN_VALUE, 0))).toBe(true)
      expect(Result.isFailure(plan(Number.NaN, 0))).toBe(true)
      expect(Result.isFailure(plan(0, -Number.MIN_VALUE))).toBe(true)
      expect(Result.isFailure(plan(0, Number.MIN_VALUE))).toBe(true)
      expect(Result.isFailure(plan(0, 1 + Number.EPSILON))).toBe(true)
    }),
  )

  it.effect('retains lightning geometry for a thunder snapshot that resolves to snow', () =>
    Effect.sync(() => {
      const planned = planWeatherFrame({
        camera,
        snapshot: { ...rain, mode: 'thunder', temperature: 0.1, lightningSequence: 4 },
      })
      expect(planned.plan.precipitation).toBe('snow')
      expect(planned.plan.lightningBolt?.sequence).toBe(4)
    }),
  )

  it.effect('anchors one strike across camera movement and re-anchors when the sequence changes', () =>
    Effect.sync(() => {
      const strike = { ...rain, mode: 'thunder' as const, lightningSequence: 19 }
      const first = planWeatherFrame({ camera, snapshot: strike })
      const movedCamera = { x: camera.x + 37, y: camera.y + 8, z: camera.z - 11 }
      const sameSequence = planWeatherFrame({ camera: movedCamera, previous: first.state, snapshot: strike })
      const originalBottom = first.plan.lightningBolt?.strands[0]?.at(-1)
      const stableBottom = sameSequence.plan.lightningBolt?.strands[0]?.at(-1)

      expect(stableBottom).toStrictEqual(originalBottom)
      expect(sameSequence.state.lightningOrigin).toStrictEqual(first.state.lightningOrigin)

      const nextSequence = planWeatherFrame({
        camera: movedCamera,
        previous: sameSequence.state,
        snapshot: { ...strike, lightningSequence: 20 },
      })
      const reanchoredBottom = nextSequence.plan.lightningBolt?.strands[0]?.at(-1)
      expect(reanchoredBottom?.x).toBeCloseTo((originalBottom?.x ?? 0) + 37, 10)
      expect(reanchoredBottom?.y).toBe((originalBottom?.y ?? 0) + 8)
      expect(reanchoredBottom?.z).toBeCloseTo((originalBottom?.z ?? 0) - 11, 10)
      expect(nextSequence.state.lightningOrigin).not.toStrictEqual(first.state.lightningOrigin)
    }),
  )

  it.effect("threads the snapshot's dimension into the planned environment, defaulting to `overworld`", () =>
    Effect.sync(() => {
      const clear: WorldWeatherSnapshot = { ...rain, mode: 'clear', intensity: 0 }
      expect(
        planWeatherFrame({ camera, previous: INITIAL_WEATHER_RENDER_STATE, snapshot: clear }).plan.environment
          .dimension,
      ).toBe('overworld')
      expect(
        planWeatherFrame({
          camera,
          previous: INITIAL_WEATHER_RENDER_STATE,
          snapshot: { ...clear, dimension: 'end' },
        }).plan.environment.dimension,
      ).toBe('end')
    }),
  )
})

describe('lightning bolt geometry planning', () => {
  const origin = { x: 6, y: 62, z: -9 }
  const input: LightningBoltInput = Schema.decodeUnknownSync(LightningBoltInputSchema)({ origin, seed: 147, sequence: 3 })

  it.effect('builds three repeatable eight-segment strands from the strike sequence', () =>
    Effect.sync(() => {
      const first = planLightningBolt(input)
      const second = planLightningBolt(input)
      expect(first).toStrictEqual(second)
      expect(first.sequence).toBe(3)
      expect(first.strands).toHaveLength(3)
      for (const strand of first.strands) {
        expect(strand).toHaveLength(9)
        expect(strand[0]?.y).toBe(origin.y + 32)
        expect(strand.at(-1)?.y).toBe(origin.y)
        expect(strand.flatMap(({ x, y, z }) => [x, y, z]).every(Number.isFinite)).toBe(true)
      }
      expect(first.strands[0]?.at(-1)).toStrictEqual(origin)
    }),
  )

  it.effect('property: valid arbitrary strike inputs yield finite, fixed-shape geometry', () =>
    Effect.sync(() => {
      const coordinate = FastCheck.double({ min: -1000, max: 1000, noNaN: true })
      FastCheck.assert(
        FastCheck.property(
          coordinate,
          coordinate,
          coordinate,
          FastCheck.integer(),
          FastCheck.nat(),
          (x, y, z, seed, sequence) => {
            const decoded = decodeLightningBoltInput({ origin: { x, y, z }, seed, sequence })
            if (Result.isFailure(decoded)) {
              return false
            }
            const bolt = planLightningBolt(decoded.success)
            return bolt.sequence === sequence && bolt.strands.length === 3 && bolt.strands.every((strand) =>
              strand.length === 9 && strand.every((point) =>
                Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
              ),
            )
          },
        ),
        { numRuns: 250 },
      )
    }),
  )

  it.effect('property: arbitrary decoded values fail with Result or satisfy the exported schema', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.anything(), (candidate) => {
          const decoded = decodeLightningBoltInput(candidate)
          return Result.isFailure(decoded) || Result.isSuccess(Schema.decodeUnknownResult(
            LightningBoltInputSchema,
            { onExcessProperty: 'error' },
          )(decoded.success))
        }),
        { numRuns: 500 },
      )
    }),
  )

  it.effect('boundary: finite coordinates and integer sequence values are accepted, just-outside values fail', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(decodeLightningBoltInput(input))).toBe(true)
      expect(Result.isFailure(decodeLightningBoltInput({ ...input, sequence: 3.5 }))).toBe(true)
      expect(Result.isFailure(decodeLightningBoltInput({ ...input, sequence: -1 }))).toBe(true)
      expect(Result.isFailure(decodeLightningBoltInput({ ...input, seed: Number.POSITIVE_INFINITY }))).toBe(true)
      expect(Result.isFailure(decodeLightningBoltInput({ ...input, origin: { ...origin, x: Number.NaN } }))).toBe(true)
      expect(Result.isFailure(decodeLightningBoltInput({ ...input, extra: true }))).toBe(true)
    }),
  )
})
