/**
 * Tests for the instanced particle pool.
 *
 * The load-bearing groups, in the order they appear:
 *
 *   - EVICTION. The pool's whole reason for having a capacity. Drop-oldest is
 *     asserted positively AND by its negation (docs/testing.md §5.5): the newest
 *     particle must survive, or "evict oldest" and "evict arbitrary" would both
 *     pass.
 *   - DETERMINISM. The seeded generator exists so two runs of one scenario
 *     agree. A test that only checked the bounds would pass against
 *     `Math.random()`.
 *   - INVALID INPUT. A zero-count burst and invalid frame deltas fail with a
 *     typed Result before they can become a no-op or poison particle state.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { requiresForceSinglePass } from '../src/domain/material-policy'
import {
  advanceParticles as advanceParticlesTypedResult,
  clearParticles as clearParticlesResult,
  DEFAULT_BURST_PARTICLES,
  DEFAULT_PARTICLE_SEED,
  evictionOrderIsSpawnOrder,
  isSlotActive,
  makeParticlePool as makeParticlePoolResult,
  MAX_PARTICLE_STEP_SECS,
  PARTICLE_GRAVITY_M_PER_S2,
  PARTICLE_LIFETIME_SECS,
  PARTICLE_MATERIAL_SPEC,
  PARTICLE_POOL_CAPACITY,
  PARTICLE_QUAD_SIZE_M,
  PARTICLE_SPREAD_DOWN_M_PER_S,
  PARTICLE_SPREAD_HORIZONTAL_M_PER_S,
  PARTICLE_SPREAD_UP_M_PER_S,
  PARTICLE_UV_SPAN,
  PARTICLE_UV_STRIDE,
  PARTICLE_VECTOR_STRIDE,
  PARTICLE_WRITES_DEPTH,
  readSlot,
  spawnParticle as spawnParticleResult,
  spawnBlockBurst as spawnBlockBurstTypedResult,
  spawnBurst as spawnBurstTypedResult,
  ParticlePoolInputErrorSchema,
  ParticlePoolInputResultSchema,
  ParticlePoolOptionsSchema,
  ParticleBurstCountSchema,
  ParticleDeltaSecsSchema,
  ParticleSpawnSpecSchema,
  ParticleTileIndexSchema,
  ParticleUvCoordinateSchema,
  ParticleWorldCoordinateSchema,
  type ParticleFrameSnapshot,
  type ParticlePool,
  type ParticleSpawnSpecEncoded,
  visibleParticleCount,
} from '../src/domain/particle-pool'
import { TILE_UV_SPAN, tileUvOrigin } from '../src/domain/texture-atlas'

const FAST_CHECK_OPTIONS = { numRuns: 100, seed: 0x5eed }
const makeParticlePool = (...args: Parameters<typeof makeParticlePoolResult>) =>
  Result.getOrThrow(makeParticlePoolResult(...args))
const spawnParticle = (...args: Parameters<typeof spawnParticleResult>) =>
  Result.getOrThrow(spawnParticleResult(...args))
const decodePosition = Schema.decodeUnknownSync(ParticleWorldCoordinateSchema)
const decodeUv = Schema.decodeUnknownSync(ParticleUvCoordinateSchema)
const decodeCount = Schema.decodeUnknownSync(ParticleBurstCountSchema)
const decodeTile = Schema.decodeUnknownSync(ParticleTileIndexSchema)
const decodeDelta = Schema.decodeUnknownSync(ParticleDeltaSecsSchema)
const spawnBurstResult = (...args: [
  pool: ParticlePool,
  positionX: number,
  positionY: number,
  positionZ: number,
  uvU: number,
  uvV: number,
  count?: number,
]): ReturnType<typeof spawnBurstTypedResult> =>
  Function.prototype.apply.call(spawnBurstTypedResult, undefined, args)
const spawnBlockBurstResult = (...args: [
  pool: ParticlePool,
  positionX: number,
  positionY: number,
  positionZ: number,
  tileIndex: number,
  count?: number,
]): ReturnType<typeof spawnBlockBurstTypedResult> =>
  Function.prototype.apply.call(spawnBlockBurstTypedResult, undefined, args)
const advanceParticlesResult = (...args: [
  pool: ParticlePool,
  dtSecs: number,
  frame?: ParticleFrameSnapshot,
]): ReturnType<typeof advanceParticlesTypedResult> =>
  Function.prototype.apply.call(advanceParticlesTypedResult, undefined, args)
const spawnBlockBurst = (
  pool: ParticlePool,
  x: number,
  y: number,
  z: number,
  tileIndex: number,
  count = DEFAULT_BURST_PARTICLES,
) => Result.getOrThrow(spawnBlockBurstTypedResult(
  pool,
  decodePosition(x),
  decodePosition(y),
  decodePosition(z),
  decodeTile(tileIndex),
  decodeCount(count),
))
const spawnBurst = (
  pool: ParticlePool,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  count = DEFAULT_BURST_PARTICLES,
) => Result.getOrThrow(spawnBurstTypedResult(
  pool,
  decodePosition(x),
  decodePosition(y),
  decodePosition(z),
  decodeUv(u),
  decodeUv(v),
  decodeCount(count),
))
const advanceParticles = (
  pool: ParticlePool,
  dtSecs: number,
  frame?: ParticleFrameSnapshot,
) => Result.getOrThrow(advanceParticlesTypedResult(pool, decodeDelta(dtSecs), frame))
const clearParticles = (...args: Parameters<typeof clearParticlesResult>) =>
  Result.getOrThrow(clearParticlesResult(...args))
const particleSpawn = (overrides: Partial<ParticleSpawnSpecEncoded> = {}): ParticleSpawnSpecEncoded => ({
  dimension: 'overworld',
  lifetimeSecs: 0.4,
  positionX: 1,
  positionY: 2,
  positionZ: 3,
  tint: { blue: 0.3, green: 0.2, red: 0.1 },
  uvU: 0.25,
  uvV: 0.5,
  ...overrides,
})

const isDecodedParticleInputFailure = (
  result: ReturnType<typeof makeParticlePoolResult> | ReturnType<typeof spawnBurstResult> |
    ReturnType<typeof spawnParticleResult> | ReturnType<typeof spawnBlockBurstResult> |
    ReturnType<typeof advanceParticlesResult> | ReturnType<typeof clearParticlesResult>,
  operation: 'pool' | 'spawn' | 'burst' | 'block-burst' | 'advance' | 'clear',
  reason: 'invalid-capacity' | 'invalid-seed' | 'invalid-options' | 'invalid-pool' | 'invalid-spawn' |
    'invalid-count' | 'invalid-position' | 'invalid-uv' | 'invalid-tile-index' | 'invalid-delta',
): boolean => {
  const decoded = Schema.decodeUnknownResult(ParticlePoolInputResultSchema, {
    onExcessProperty: 'error',
  })(result)
  return Result.isSuccess(decoded) && decoded.success._tag === 'Failure' &&
    Result.isSuccess(Schema.decodeUnknownResult(ParticlePoolInputErrorSchema, {
      onExcessProperty: 'error',
    })(decoded.success.failure)) && decoded.success.failure.operation === operation &&
    decoded.success.failure.reason === reason
}

/** Every live slot's remaining lifetime, ascending. Oldest first. */
const remainingLifetimes = (pool: ParticlePool): ReadonlyArray<number> => {
  const lives: Array<number> = []
  for (let slot = 0; slot < pool.capacity; slot += 1) {
    if (isSlotActive(pool, slot)) {
      lives.push(pool.lifetimesSecs[slot] ?? 0)
    }
  }
  return lives.sort((a, b) => a - b)
}

describe('the particle constants', () => {
  it.effect('are the reference values, asserted as literals', () =>
    Effect.sync(() => {
      // docs/testing.md §5.4. Each is cited in domain/particle-pool.ts.
      expect(PARTICLE_POOL_CAPACITY).toBe(512)
      expect(PARTICLE_LIFETIME_SECS).toBe(0.5)
      expect(PARTICLE_GRAVITY_M_PER_S2).toBe(12)
      expect(PARTICLE_QUAD_SIZE_M).toBe(0.1)
      expect(PARTICLE_SPREAD_HORIZONTAL_M_PER_S).toBe(2)
      expect(PARTICLE_SPREAD_UP_M_PER_S).toBe(3)
      expect(PARTICLE_SPREAD_DOWN_M_PER_S).toBe(0.5)
      expect(DEFAULT_BURST_PARTICLES).toBe(6)
      expect(MAX_PARTICLE_STEP_SECS).toBe(0.1)
      expect(PARTICLE_VECTOR_STRIDE).toBe(3)
      expect(PARTICLE_UV_STRIDE).toBe(2)
    }),
  )

  it.effect('gravity is NOT real gravity, and the asymmetric spread is NOT symmetric', () =>
    Effect.sync(() => {
      // Both are the shape of "tidy-up" that would silently undo the reference's
      // tuning. Pinned so the tidy-up fails a test instead of a playtest.
      expect(PARTICLE_GRAVITY_M_PER_S2).not.toBeCloseTo(9.81, 1)
      expect(PARTICLE_SPREAD_DOWN_M_PER_S).not.toBe(PARTICLE_SPREAD_UP_M_PER_S)
    }),
  )

  it.effect('the quad UV span carries the half-texel inset, not the raw tile pitch', () =>
    Effect.sync(() => {
      expect(PARTICLE_UV_SPAN).toBe(TILE_UV_SPAN)
    }),
  )

  it.effect('the material is a shared cutout, so the shared forceSinglePass rule covers it', () =>
    Effect.sync(() => {
      // Unlike water. See domain/water-surface.ts.
      expect(PARTICLE_MATERIAL_SPEC.alphaTest).toBe(0.5)
      expect(PARTICLE_MATERIAL_SPEC.shared).toBe(true)
      expect(requiresForceSinglePass(PARTICLE_MATERIAL_SPEC)).toBe(true)
      expect(PARTICLE_WRITES_DEPTH).toBe(false)
    }),
  )
})

describe('a fresh pool', () => {
  it.effect('is empty, and every buffer is sized from the capacity', () =>
    Effect.sync(() => {
      const pool = makeParticlePool()
      expect(pool.capacity).toBe(PARTICLE_POOL_CAPACITY)
      expect(pool.activeCount()).toBe(0)
      expect(pool.evictionCount()).toBe(0)
      expect(pool.positions.length).toBe(PARTICLE_POOL_CAPACITY * 3)
      expect(pool.velocities.length).toBe(PARTICLE_POOL_CAPACITY * 3)
      expect(pool.lifetimesSecs.length).toBe(PARTICLE_POOL_CAPACITY)
      expect(pool.initialLifetimesSecs.length).toBe(PARTICLE_POOL_CAPACITY)
      expect(pool.scales.length).toBe(PARTICLE_POOL_CAPACITY)
      expect(pool.uvOffsets.length).toBe(PARTICLE_POOL_CAPACITY * 2)
      expect(pool.colors.length).toBe(PARTICLE_POOL_CAPACITY * 3)
    }),
  )

  it.effect('starts every slot free, which is what a zero lifetime means', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 8 })
      for (let slot = 0; slot < pool.capacity; slot += 1) {
        expect(isSlotActive(pool, slot)).toBe(false)
        expect(pool.scales[slot]).toBe(0)
        expect(readSlot(pool, slot)).toBeUndefined()
      }
    }),
  )

  it.effect('refuses a capacity that is not a positive integer, rather than making a zero-length buffer', () =>
    Effect.sync(() => {
      expect(isDecodedParticleInputFailure(makeParticlePoolResult({ capacity: 0 }), 'pool', 'invalid-capacity')).toBe(true)
      expect(isDecodedParticleInputFailure(makeParticlePoolResult({ capacity: -4 }), 'pool', 'invalid-capacity')).toBe(true)
      expect(isDecodedParticleInputFailure(makeParticlePoolResult({ capacity: 2.5 }), 'pool', 'invalid-capacity')).toBe(true)
      expect(isDecodedParticleInputFailure(makeParticlePoolResult({ capacity: Number.NaN }), 'pool', 'invalid-capacity')).toBe(true)
    }),
  )

  it.effect('property: invalid capacities, seeds, and extra option fields fail their decoded Result', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, PARTICLE_POOL_CAPACITY + 1),
          (capacity) => {
            const decodedOptions = Schema.decodeUnknownResult(ParticlePoolOptionsSchema, {
              onExcessProperty: 'error',
            })({ capacity })
            return Result.isFailure(decodedOptions) && isDecodedParticleInputFailure(
              makeParticlePoolResult({ capacity }),
              'pool',
              'invalid-capacity',
            )
          },
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            0.5,
            Number.MAX_SAFE_INTEGER + 1,
            Number.MIN_SAFE_INTEGER - 1,
          ),
          (seed) => {
            const decodedOptions = Schema.decodeUnknownResult(ParticlePoolOptionsSchema, {
              onExcessProperty: 'error',
            })({ seed })
            return Result.isFailure(decodedOptions) && isDecodedParticleInputFailure(
              makeParticlePoolResult({ seed }),
              'pool',
              'invalid-seed',
            )
          },
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) => {
          const options = { capacity: 4, extra }
          const decodedOptions = Schema.decodeUnknownResult(ParticlePoolOptionsSchema, {
            onExcessProperty: 'error',
          })(options)
          return Result.isFailure(decodedOptions) && isDecodedParticleInputFailure(
            makeParticlePoolResult(options),
            'pool',
            'invalid-options',
          )
        }),
        FAST_CHECK_OPTIONS,
      )
    }),
  )
})

describe('spawning', () => {
  it.effect('a default burst is six particles, all fully scaled and at the spawn point', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 32 })
      expect(spawnBurst(pool, 1, 2, 3, 0.25, 0.5)).toBe(DEFAULT_BURST_PARTICLES)
      expect(pool.activeCount()).toBe(DEFAULT_BURST_PARTICLES)

      for (let slot = 0; slot < DEFAULT_BURST_PARTICLES; slot += 1) {
        const particle = readSlot(pool, slot)
        expect(particle?.positionX).toBe(1)
        expect(particle?.positionY).toBe(2)
        expect(particle?.positionZ).toBe(3)
        expect(particle?.remainingSecs).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
        // Visible in THIS frame, before advanceParticles has ever run.
        expect(particle?.scale).toBe(1)
        expect(particle?.uvU).toBeCloseTo(0.25, 6)
        expect(particle?.uvV).toBeCloseTo(0.5, 6)
      }
    }),
  )

  it.effect('launch velocities stay inside the spread envelope', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 256 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 256)

      for (let slot = 0; slot < pool.capacity; slot += 1) {
        const particle = readSlot(pool, slot)
        expect(Math.abs(particle?.velocityX ?? 0)).toBeLessThanOrEqual(PARTICLE_SPREAD_HORIZONTAL_M_PER_S)
        expect(Math.abs(particle?.velocityZ ?? 0)).toBeLessThanOrEqual(PARTICLE_SPREAD_HORIZONTAL_M_PER_S)
        expect(particle?.velocityY ?? 0).toBeGreaterThanOrEqual(-PARTICLE_SPREAD_DOWN_M_PER_S)
        expect(particle?.velocityY ?? 0).toBeLessThanOrEqual(PARTICLE_SPREAD_UP_M_PER_S)
      }
    }),
  )

  it.effect('and the vertical envelope is ASYMMETRIC — mostly up, a little down', () =>
    Effect.sync(() => {
      // The reverse test for the bound above: a symmetric envelope would also
      // satisfy "inside [-0.5, 3]". This asserts the distribution actually uses
      // the upper part of it, which a symmetrised version would not.
      const pool = makeParticlePool({ capacity: 256 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 256)

      let upward = 0
      for (let slot = 0; slot < pool.capacity; slot += 1) {
        if ((readSlot(pool, slot)?.velocityY ?? 0) > PARTICLE_SPREAD_DOWN_M_PER_S) {
          upward += 1
        }
      }
      // [-0.5, 3] is 3.5 wide; the part above +0.5 is 2.5 of it, so ~71%.
      expect(upward / pool.capacity).toBeGreaterThan(0.6)
    }),
  )

  it.effect('fails zero and invalid burst counts before mutating the pool', () =>
    Effect.sync(() => {
      // particle-system.ts:129 clamps with Math.max(1, ...), so asking for zero
      // particles produces one stray fleck. The pool rejects invalid counts at
      // its public boundary.
      const pool = makeParticlePool({ capacity: 8 })
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, 0, 0, 0, 0, 0, 0), 'burst', 'invalid-count')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, 0, 0, 0, 0, 0, -3), 'burst', 'invalid-count')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, 0, 0, 0, 0, 0, Number.NaN), 'burst', 'invalid-count')).toBe(true)
      expect(pool.activeCount()).toBe(0)
    }),
  )

  it.effect('a burst larger than the pool is clamped, so the return value is honest', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4 })
      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 100)).toBe(4)
      expect(pool.activeCount()).toBe(4)
    }),
  )

  it.effect('refuses a spawn point that is not a point, rather than writing NaN into the buffer', () =>
    Effect.sync(() => {
      // A NaN position reaches the instance matrix and removes the WHOLE
      // InstancedMesh from the screen, not one particle.
      const pool = makeParticlePool({ capacity: 8 })
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, Number.NaN, 0, 0, 0, 0), 'burst', 'invalid-position')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, 0, Number.POSITIVE_INFINITY, 0, 0, 0), 'burst', 'invalid-position')).toBe(true)
      expect(pool.activeCount()).toBe(0)
    }),
  )

  it.effect('property: invalid burst count, position, UV, and spawn extras are decoded failures', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 8 })
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1),
          (count) => isDecodedParticleInputFailure(
            spawnBurstResult(pool, 0, 0, 0, 0, 0, count),
            'burst',
            'invalid-count',
          ),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 3.4028236e38),
          (positionX) => isDecodedParticleInputFailure(
            spawnBurstResult(pool, positionX, 0, 0, 0, 0, 1),
            'burst',
            'invalid-position',
          ),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -Number.EPSILON,
            1 - TILE_UV_SPAN + Number.EPSILON,
          ),
          (uvU) => isDecodedParticleInputFailure(
            spawnBurstResult(pool, 0, 0, 0, uvU, 0, 1),
            'burst',
            'invalid-uv',
          ),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(-1, 256, 0.5, Number.NaN, Number.POSITIVE_INFINITY),
          (tileIndex) => isDecodedParticleInputFailure(
            spawnBlockBurstResult(pool, 0, 0, 0, tileIndex, 1),
            'block-burst',
            'invalid-tile-index',
          ),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) => {
          const spawn: ParticleSpawnSpecEncoded & { readonly extra: number } = {
            dimension: 'overworld',
            lifetimeSecs: 0.4,
            positionX: 1,
            positionY: 2,
            positionZ: 3,
            tint: { blue: 0.3, green: 0.2, red: 0.1 },
            uvU: 0.25,
            uvV: 0.5,
            extra,
          }
          const decodedSpawn = Schema.decodeUnknownResult(ParticleSpawnSpecSchema, {
            onExcessProperty: 'error',
          })(spawn)
          return Result.isFailure(decodedSpawn) && isDecodedParticleInputFailure(
            spawnParticleResult(pool, spawn),
            'spawn',
            'invalid-spawn',
          )
        }),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
          (dtSecs) => isDecodedParticleInputFailure(
            advanceParticlesResult(pool, dtSecs),
            'advance',
            'invalid-delta',
          ),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) => {
          const result = {
            _tag: 'Failure',
            _op: 'Failure',
            failure: { _tag: 'ParticlePoolInputError', operation: 'advance', reason: 'invalid-delta' },
            extra,
          }
          const decoded = Schema.decodeUnknownResult(ParticlePoolInputResultSchema, {
            onExcessProperty: 'error',
          })(result)
          return Result.isFailure(decoded)
        }),
        FAST_CHECK_OPTIONS,
      )

      expect(pool.activeCount()).toBe(0)
    }),
  )

  it.effect('spawnBlockBurst samples the tile the block uses', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 8 })
      const expected = tileUvOrigin(7)
      spawnBlockBurst(pool, 0, 0, 0, 7, 2)

      expect(readSlot(pool, 0)?.uvU).toBeCloseTo(expected.u, 6)
      expect(readSlot(pool, 0)?.uvV).toBeCloseTo(expected.v, 6)
    }),
  )

  it.effect('preserves the block-burst operation when a valid tile reaches an invalid burst', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4 })
      const result = spawnBlockBurstResult(pool, 0, 0, 0, 7, 0)

      expect(isDecodedParticleInputFailure(result, 'block-burst', 'invalid-count')).toBe(true)
      expect(pool.activeCount()).toBe(0)
    }),
  )

  it.effect('a non-finite UV origin is rejected instead of becoming the neutral origin', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4 })
      expect(isDecodedParticleInputFailure(
        spawnBurstResult(pool, 0, 0, 0, Number.NaN, Number.POSITIVE_INFINITY, 1),
        'burst',
        'invalid-uv',
      )).toBe(true)
      expect(pool.activeCount()).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The seeded generator is the whole reason this file does not
// call Math.random(); a bounds test alone would pass against Math.random().
// ---------------------------------------------------------------------------
describe('determinism', () => {
  it.effect('two pools with the same seed produce identical velocities', () =>
    Effect.sync(() => {
      const first = makeParticlePool({ capacity: 16, seed: 12_345 })
      const second = makeParticlePool({ capacity: 16, seed: 12_345 })
      spawnBurst(first, 0, 0, 0, 0, 0, 16)
      spawnBurst(second, 0, 0, 0, 0, 0, 16)

      expect([...first.velocities]).toStrictEqual([...second.velocities])
    }),
  )

  it.effect('and two pools with DIFFERENT seeds do not', () =>
    Effect.sync(() => {
      // The reverse test: without it, a generator stuck at a constant would pass
      // the test above.
      const first = makeParticlePool({ capacity: 16, seed: 12_345 })
      const second = makeParticlePool({ capacity: 16, seed: 999 })
      spawnBurst(first, 0, 0, 0, 0, 0, 16)
      spawnBurst(second, 0, 0, 0, 0, 0, 16)

      expect([...first.velocities]).not.toStrictEqual([...second.velocities])
    }),
  )

  it.effect('the seed advances on every draw and never lands on the fixed point', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 64, seed: DEFAULT_PARTICLE_SEED })
      const seen = new Set<number>()
      for (let burst = 0; burst < 64; burst += 1) {
        spawnBurst(pool, 0, 0, 0, 0, 0, 1)
        expect(pool.seed()).not.toBe(0)
        seen.add(pool.seed())
      }
      // Three draws per particle, 64 particles: the state must not be cycling
      // through a handful of values.
      expect(seen.size).toBe(64)
    }),
  )

  it.effect('a non-finite seed is rejected rather than folded into a valid seed', () =>
    Effect.sync(() => {
      expect(isDecodedParticleInputFailure(
        makeParticlePoolResult({ capacity: 4, seed: Number.NaN }),
        'pool',
        'invalid-seed',
      )).toBe(true)
    }),
  )

  it.effect('a seed of exactly zero folds to the fixed-point fallback, not to zero itself', () =>
    Effect.sync(() => {
      // normaliseSeed's `folded === 0` branch: zero is the generator's fixed point
      // (0 * PRNG_MULTIPLIER % PRNG_MODULUS stays 0 forever), so it must fold to 1
      // rather than being accepted as-is.
      const pool = makeParticlePool({ capacity: 4, seed: 0 })
      expect(pool.seed()).toBe(1)

      // And the generator actually advances afterward, proving it did not stay stuck.
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      expect(pool.seed()).not.toBe(0)
      expect(pool.seed()).not.toBe(1)
    }),
  )
})

describe('integration', () => {
  it.effect('expires a particle before an out-of-world update reaches its buffers', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 1 })
      expect(spawnParticle(pool, particleSpawn({
        positionX: 30_000_000,
        velocity: { x: 64, y: 0, z: 0 },
      }))).toBe(true)

      advanceParticles(pool, 0.1)

      expect(pool.activeCount()).toBe(0)
      expect(Array.from(pool.positions).every(Number.isFinite)).toBe(true)
      expect(Array.from(pool.velocities).every(Number.isFinite)).toBe(true)
      expect(Array.from(pool.lifetimesSecs).every(Number.isFinite)).toBe(true)
    }),
  )

  it.effect('property: accepted particle spawns stay finite across arbitrary advances', () =>
    Effect.sync(() => {
      const numericBuffersStayFinite = (pool: ParticlePool): boolean =>
        [
          pool.colors,
          pool.initialLifetimesSecs,
          pool.lifetimesSecs,
          pool.positions,
          pool.scales,
          pool.uvOffsets,
          pool.velocities,
        ].every((buffer) => Array.from(buffer).every(Number.isFinite))

      FastCheck.assert(
        FastCheck.property(
          FastCheck.record({
            positionX: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            positionY: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            positionZ: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            velocityDirectionX: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            velocityDirectionY: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            velocityDirectionZ: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            velocitySpeed: FastCheck.double({ min: 0, max: 63.9, noNaN: true }),
            lifetimeSecs: FastCheck.double({ min: 0.0001, max: 10, noNaN: true }),
            advanceSteps: FastCheck.array(
              FastCheck.double({ min: 0, max: 1e100, noNaN: true }),
              { maxLength: 256 },
            ),
          }),
          ({ advanceSteps, lifetimeSecs, positionX, positionY, positionZ, velocityDirectionX, velocityDirectionY, velocityDirectionZ, velocitySpeed }) => {
            const pool = makeParticlePool({ capacity: 1 })
            const directionMagnitude = Math.hypot(velocityDirectionX, velocityDirectionY, velocityDirectionZ)
            let velocityScale = 0
            if (directionMagnitude !== 0) {
              velocityScale = velocitySpeed / directionMagnitude
            }
            const spawn = particleSpawn({
              lifetimeSecs,
              positionX,
              positionY,
              positionZ,
              velocity: {
                x: velocityDirectionX * velocityScale,
                y: velocityDirectionY * velocityScale,
                z: velocityDirectionZ * velocityScale,
              },
            })
            const decoded = Schema.decodeUnknownResult(ParticleSpawnSpecSchema, {
              onExcessProperty: 'error',
            })(spawn)
            if (Result.isFailure(decoded) || !spawnParticle(pool, spawn)) {
              return false
            }
            if (!numericBuffersStayFinite(pool)) {
              return false
            }

            for (const dt of advanceSteps) {
              const advanced = advanceParticlesResult(pool, dt)
              if (Result.isFailure(advanced) || !numericBuffersStayFinite(pool)) {
                return false
              }
            }
            return true
          },
        ),
        FAST_CHECK_OPTIONS,
      )
    }),
  )
  it.effect('gravity pulls the vertical velocity down by g*dt', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      const launch = readSlot(pool, 0)?.velocityY ?? 0

      advanceParticles(pool, 0.05)

      expect(readSlot(pool, 0)?.velocityY ?? 0).toBeCloseTo(
        launch - PARTICLE_GRAVITY_M_PER_S2 * 0.05,
        4,
      )
    }),
  )

  it.effect('position moves by the UPDATED velocity — semi-implicit Euler', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 10, 0, 0, 0, 1)
      const launch = readSlot(pool, 0)?.velocityY ?? 0

      advanceParticles(pool, 0.05)

      const expectedVy = launch - PARTICLE_GRAVITY_M_PER_S2 * 0.05
      expect(readSlot(pool, 0)?.positionY ?? 0).toBeCloseTo(10 + expectedVy * 0.05, 4)
    }),
  )

  it.effect('the scale fades linearly from 1 to 0 across the lifetime', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)

      // Steps of MAX_PARTICLE_STEP_SECS, because anything larger is clamped to
      // it — a step of PARTICLE_LIFETIME_SECS / 2 does NOT advance half a
      // lifetime, which is the trap this comment exists to mark.
      advanceParticles(pool, MAX_PARTICLE_STEP_SECS)
      expect(readSlot(pool, 0)?.scale ?? 0).toBeCloseTo(0.8, 5)

      advanceParticles(pool, MAX_PARTICLE_STEP_SECS)
      expect(readSlot(pool, 0)?.scale ?? 0).toBeCloseTo(0.6, 5)

      advanceParticles(pool, MAX_PARTICLE_STEP_SECS)
      expect(readSlot(pool, 0)?.scale ?? 0).toBeCloseTo(0.4, 5)
    }),
  )

  it.effect('a particle expires at the end of its lifetime, freeing the slot', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 3)
      expect(pool.activeCount()).toBe(3)

      let expired = 0
      let steps = 0
      while (pool.activeCount() > 0 && steps < 20) {
        expired += advanceParticles(pool, MAX_PARTICLE_STEP_SECS)
        steps += 1
      }

      expect(expired).toBe(3)
      expect(pool.activeCount()).toBe(0)
      // SIX steps of 0.1s, not five, to drain a 0.5s lifetime. `lifetimesSecs`
      // is a Float32Array and 0.1 is not representable in binary, so five
      // subtractions leave a residue of about 2.4e-8 rather than exactly zero.
      // Pinned rather than hidden behind the loop: the extra frame is invisible
      // (the particle is at scale 5e-8) but a test that hard-coded five steps
      // would fail for a reason that looks like a lifetime bug.
      expect(steps).toBe(6)
      for (let slot = 0; slot < 3; slot += 1) {
        expect(isSlotActive(pool, slot)).toBe(false)
        // Zero scale, so an adapter that composes every slot's matrix without
        // consulting occupancy still draws nothing.
        expect(pool.scales[slot]).toBe(0)
      }
    }),
  )

  it.effect('a huge dt is clamped, so a resumed tab does not teleport particles into orbit', () =>
    Effect.sync(() => {
      const clamped = makeParticlePool({ capacity: 4, seed: 7 })
      const stepped = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(clamped, 0, 0, 0, 0, 0, 1)
      spawnBurst(stepped, 0, 0, 0, 0, 0, 1)

      advanceParticles(clamped, 30)
      advanceParticles(stepped, MAX_PARTICLE_STEP_SECS)

      expect(readSlot(clamped, 0)?.positionY ?? 0).toBeCloseTo(readSlot(stepped, 0)?.positionY ?? 0, 5)
    }),
  )

  it.effect('a non-finite dt fails without changing particle state', () =>
    Effect.sync(() => {
      // particle-system.ts:166's Math.max(0, Math.min(NaN, 0.1)) is NaN, and one
      // bad frame delta poisons every live particle permanently.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 1, 2, 3, 0, 0, 2)

      expect(isDecodedParticleInputFailure(
        advanceParticlesResult(pool, Number.NaN),
        'advance',
        'invalid-delta',
      )).toBe(true)
      expect(isDecodedParticleInputFailure(
        advanceParticlesResult(pool, Number.POSITIVE_INFINITY),
        'advance',
        'invalid-delta',
      )).toBe(true)

      expect(readSlot(pool, 0)?.positionX).toBe(1)
      expect(readSlot(pool, 0)?.positionY).toBe(2)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
      expect(pool.activeCount()).toBe(2)
    }),
  )

  it.effect('a negative dt fails rather than running time backwards', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      expect(isDecodedParticleInputFailure(advanceParticlesResult(pool, -5), 'advance', 'invalid-delta')).toBe(true)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The capacity is only a design decision because of what happens
// when it is reached. Asserted in both directions per docs/testing.md §5.5.
// ---------------------------------------------------------------------------
describe('eviction, when the pool is full', () => {
  it.effect('keeps the public spawn-order marker enabled', () =>
    Effect.sync(() => {
      expect(evictionOrderIsSpawnOrder).toBe(true)
    }),
  )

  it.effect('a saturated pool still accepts spawns, and stays at capacity', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 4)
      expect(pool.activeCount()).toBe(4)
      expect(pool.evictionCount()).toBe(0)

      expect(spawnBurst(pool, 9, 9, 9, 0, 0, 1)).toBe(1)

      expect(pool.activeCount()).toBe(4)
      expect(pool.evictionCount()).toBe(1)
    }),
  )

  it.effect('skips a non-zero lifetime while searching for a free slot', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2, seed: 7 })
      pool.lifetimesSecs[0] = Number.NaN

      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 1)).toBe(1)
      expect(pool.activeCount()).toBe(1)
      expect(pool.evictionCount()).toBe(0)
      expect(pool.lifetimesSecs[0]).toBeNaN()
      expect(pool.lifetimesSecs[1]).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
    }),
  )

  it.effect('falls back to eviction when the live-slot metadata has no free slot', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2, seed: 7 })
      pool.lifetimesSecs.fill(PARTICLE_LIFETIME_SECS)

      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 1)).toBe(1)
      expect(pool.evictionCount()).toBe(1)
      expect(pool.lifetimesSecs[0]).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
    }),
  )

  it.effect('skips a cleared public slot while scanning for the oldest live particle', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2, seed: 7 })
      spawnBurst(pool, 1, 0, 0, 0, 0, 2)
      pool.lifetimesSecs[0] = 0

      expect(spawnBurst(pool, 9, 0, 0, 0, 0, 1)).toBe(1)
      expect(pool.evictionCount()).toBe(1)
      expect(pool.lifetimesSecs[0]).toBe(0)
      expect(readSlot(pool, 0)?.positionX).toBeUndefined()
      expect(readSlot(pool, 1)?.positionX).toBe(9)
    }),
  )

  it.effect('it evicts the OLDEST particle', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      // Two old particles, then time passes, then two young ones.
      spawnBurst(pool, 0, 0, 0, 0, 0, 2)
      advanceParticles(pool, 0.1)
      spawnBurst(pool, 0, 0, 0, 0, 0, 2)

      const before = remainingLifetimes(pool)
      expect(before).toHaveLength(4)
      // Two at ~0.4s (the old ones) and two at 0.5s (the young ones).
      expect(before[0]).toBeCloseTo(0.4, 5)
      expect(before[3]).toBeCloseTo(0.5, 5)

      spawnBurst(pool, 9, 9, 9, 0, 0, 1)

      const after = remainingLifetimes(pool)
      // One of the two 0.4s particles is gone, replaced by a fresh 0.5s one.
      expect(after.filter((life) => life < 0.45)).toHaveLength(1)
      expect(after.filter((life) => life > 0.45)).toHaveLength(3)
    }),
  )

  it.effect('and it does NOT evict the newest — drop-oldest, not drop-new or drop-arbitrary', () =>
    Effect.sync(() => {
      // The reverse test. Without it, an implementation that evicted slot 0
      // unconditionally, or evicted the newest, would pass the test above
      // whenever slot 0 happened to be the oldest.
      const pool = makeParticlePool({ capacity: 3, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1) // oldest, will land in slot 0
      advanceParticles(pool, 0.1)
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      advanceParticles(pool, 0.1)
      spawnBurst(pool, 0, 0, 0, 0, 0, 1) // newest

      const newestBefore = Math.max(...remainingLifetimes(pool))
      spawnBurst(pool, 9, 9, 9, 0, 0, 1)

      // The newest is still there, and the oldest is not.
      expect(remainingLifetimes(pool).some((life) => Math.abs(life - newestBefore) < 1e-6)).toBe(true)
      expect(remainingLifetimes(pool).some((life) => life < 0.31)).toBe(false)
    }),
  )

  it.effect('the pool NEVER grows: every buffer keeps its identity and its length', () =>
    Effect.sync(() => {
      // Growing would reallocate the pool buffers and the InstancedMesh behind
      // them, in the frame that is already busiest.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      const buffers = {
        positions: pool.positions,
        velocities: pool.velocities,
        lifetimesSecs: pool.lifetimesSecs,
        initialLifetimesSecs: pool.initialLifetimesSecs,
        scales: pool.scales,
        uvOffsets: pool.uvOffsets,
        colors: pool.colors,
      }

      for (let burst = 0; burst < 50; burst += 1) {
        spawnBurst(pool, burst, 0, 0, 0, 0, 6)
        advanceParticles(pool, 0.016)
      }

      expect(pool.positions).toBe(buffers.positions)
      expect(pool.velocities).toBe(buffers.velocities)
      expect(pool.lifetimesSecs).toBe(buffers.lifetimesSecs)
      expect(pool.initialLifetimesSecs).toBe(buffers.initialLifetimesSecs)
      expect(pool.scales).toBe(buffers.scales)
      expect(pool.uvOffsets).toBe(buffers.uvOffsets)
      expect(pool.colors).toBe(buffers.colors)
      expect(pool.positions.length).toBe(4 * 3)
      expect(pool.activeCount()).toBeLessThanOrEqual(4)
    }),
  )

  it.effect('a single burst never evicts its own particles — it is clamped to the capacity', () =>
    Effect.sync(() => {
      // Which is why the previous test needs TWO bursts to reach an eviction.
      // Without the clamp, a burst of 8 into 4 slots would spawn 8, evict 4 of
      // its own, and report 8 spawned when 4 are visible.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 8)).toBe(4)
      expect(pool.evictionCount()).toBe(0)
    }),
  )

  it.effect('falls back to eviction when the raw buffers report every slot live', () =>
    Effect.sync(() => {
      // The typed arrays are intentionally exposed to the rendering adapter;
      // exercise the defensive path where a direct write gets ahead of the
      // pool's internal active counter.
      const pool = makeParticlePool({ capacity: 2, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      pool.lifetimesSecs[1] = 0.25

      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 1)).toBe(1)
      expect(pool.evictionCount()).toBe(1)
      expect(pool.activeCount()).toBe(1)
    }),
  )

  it.effect('a saturated pool that then drains reuses slots instead of leaking them', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 4) // saturates
      spawnBurst(pool, 0, 0, 0, 0, 0, 4) // evicts all four
      expect(pool.evictionCount()).toBe(4)

      let steps = 0
      while (pool.activeCount() > 0 && steps < 20) {
        advanceParticles(pool, MAX_PARTICLE_STEP_SECS)
        steps += 1
      }
      expect(pool.activeCount()).toBe(0)

      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 4)).toBe(4)
      expect(pool.activeCount()).toBe(4)
      // No FURTHER eviction: the drained slots really were free again.
      expect(pool.evictionCount()).toBe(4)
    }),
  )
})

describe('clearing', () => {
  it.effect('frees every slot', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 8, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 6)
      clearParticles(pool)

      expect(pool.activeCount()).toBe(0)
      for (let slot = 0; slot < pool.capacity; slot += 1) {
        expect(isSlotActive(pool, slot)).toBe(false)
        expect(pool.scales[slot]).toBe(0)
      }
    }),
  )

  it.effect('but does NOT rewind the generator — a seed is a position, not world state', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 8, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 6)
      const seedAfterSpawn = pool.seed()

      clearParticles(pool)

      expect(pool.seed()).toBe(seedAfterSpawn)
      expect(pool.seed()).not.toBe(7)
    }),
  )
})

describe('reading slots', () => {
  it.effect('rejects a proxy without registered factory identity in every mutator', () =>
    Effect.sync(() => {
      const forged = new Proxy(makeParticlePool({ capacity: 1 }), {})
      expect(isDecodedParticleInputFailure(advanceParticlesResult(forged, 0), 'advance', 'invalid-pool')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(forged, particleSpawn()), 'spawn', 'invalid-pool')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBurstResult(forged, 0, 0, 0, 0, 0, 1), 'burst', 'invalid-pool')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBlockBurstResult(forged, 0, 0, 0, 1, 1), 'block-burst', 'invalid-pool')).toBe(true)
      expect(isDecodedParticleInputFailure(clearParticlesResult(forged), 'clear', 'invalid-pool')).toBe(true)
    }),
  )

  it.effect('refuses an index that is out of range or free, rather than returning zeros', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)

      expect(readSlot(pool, 0)).toBeDefined()
      expect(readSlot(pool, 1)).toBeUndefined() // free
      expect(readSlot(pool, -1)).toBeUndefined()
      expect(readSlot(pool, 4)).toBeUndefined()
      expect(readSlot(pool, 1.5)).toBeUndefined()
    }),
  )

  it.effect('agrees with the raw buffers an adapter reads', () =>
    Effect.sync(() => {
      // The adapter uses the strides, not readSlot. If the two disagree, the
      // tests are checking something the renderer does not draw.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 1, 2, 3, 0.25, 0.5, 2)
      advanceParticles(pool, 0.02)

      for (let slot = 0; slot < 2; slot += 1) {
        const particle = readSlot(pool, slot)
        const vectorBase = slot * PARTICLE_VECTOR_STRIDE
        const uvBase = slot * PARTICLE_UV_STRIDE
        expect(particle?.positionX).toBe(pool.positions[vectorBase])
        expect(particle?.positionY).toBe(pool.positions[vectorBase + 1])
        expect(particle?.positionZ).toBe(pool.positions[vectorBase + 2])
        expect(particle?.scale).toBe(pool.scales[slot])
        expect(particle?.uvU).toBe(pool.uvOffsets[uvBase])
        expect(particle?.uvV).toBe(pool.uvOffsets[uvBase + 1])
      }
    }),
  )
})

describe('C6 particle spawn state', () => {
  it.effect('fades against the requested lifetime and preserves tint and dimension', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2 })
      expect(spawnParticle(pool, particleSpawn({ lifetimeSecs: 0.4, dimension: 'nether' }))).toBe(true)

      advanceParticles(pool, 0.1, { dimension: 'overworld', entities: [] })
      expect(readSlot(pool, 0)?.scale).toBe(0)
      expect(visibleParticleCount(pool)).toBe(0)

      advanceParticles(pool, 0.1, { dimension: 'nether', entities: [] })
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(0.2, 8)
      expect(readSlot(pool, 0)?.initialLifetimeSecs).toBeCloseTo(0.4, 8)
      expect(readSlot(pool, 0)?.scale).toBeCloseTo(0.5, 8)
      expect(readSlot(pool, 0)?.colorRed).toBeCloseTo(0.1, 7)
      expect(readSlot(pool, 0)?.colorGreen).toBeCloseTo(0.2, 7)
      expect(readSlot(pool, 0)?.colorBlue).toBeCloseTo(0.3, 7)
      expect(readSlot(pool, 0)?.dimension).toBe('nether')
      expect(visibleParticleCount(pool)).toBe(1)
    }),
  )

  it.effect('accepts supported position and speed bounds and rejects out-of-range spawn data', () =>
    Effect.sync(() => {
      const worldMaximum = 30_000_000
      const speedMaximum = 64
      const pool = makeParticlePool({ capacity: 4 })

      expect(spawnParticle(pool, particleSpawn({
        positionX: worldMaximum,
        velocity: { x: speedMaximum, y: 0, z: 0 },
      }))).toBe(true)
      expect(pool.positions[0]).toBe(worldMaximum)
      expect(pool.velocities[0]).toBe(speedMaximum)

      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        positionX: worldMaximum + 1,
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        positionX: 3.4028234663852886e38,
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        velocity: { x: speedMaximum + 1, y: 0, z: 0 },
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        velocity: { x: 48, y: 48, z: 0 },
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        lifetimeSecs: 10.1,
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnParticleResult(pool, particleSpawn({
        follow: { id: 'mob-1', x: 60_000_001, y: 2, z: 3 },
      })), 'spawn', 'invalid-spawn')).toBe(true)
      expect(isDecodedParticleInputFailure(spawnBurstResult(pool, 30_000_001, 0, 0, 0, 0, 1), 'burst', 'invalid-position')).toBe(true)

      expect(pool.activeCount()).toBe(1)
      expect(pool.evictionCount()).toBe(0)
      expect(Array.from(pool.positions).every(Number.isFinite)).toBe(true)
      expect(Array.from(pool.velocities).every(Number.isFinite)).toBe(true)
    }),
  )

  it.effect('evicts by spawn sequence when custom lifetimes disagree with age', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2 })
      spawnParticle(pool, particleSpawn({
        lifetimeSecs: 0.4,
        positionX: 1,
        velocity: { x: 0, y: 0, z: 0 },
      }))
      advanceParticles(pool, 0.05)
      spawnParticle(pool, particleSpawn({
        lifetimeSecs: 0.1,
        positionX: 2,
        velocity: { x: 0, y: 0, z: 0 },
      }))
      advanceParticles(pool, 0.02)

      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(0.33, 8)
      expect(readSlot(pool, 1)?.remainingSecs).toBeCloseTo(0.08, 8)
      expect(spawnParticle(pool, particleSpawn({ lifetimeSecs: 0.2, positionX: 3 }))).toBe(true)

      expect(readSlot(pool, 0)?.positionX).toBe(3)
      expect(readSlot(pool, 1)?.positionX).toBe(2)
      expect(pool.evictionCount()).toBe(1)
      expect(pool.activeCount()).toBe(2)
    }),
  )

  it.effect('follows the current entity and detaches on its last resolved position when removed', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 2 })
      const firstFrame: ParticleFrameSnapshot = {
        dimension: 'overworld',
        entities: [{ id: 'mob-1', feetPosition: { x: 10, y: 20, z: 30 } }],
      }
      spawnParticle(pool, particleSpawn({
        follow: { id: 'mob-1', x: 10, y: 20, z: 30 },
        positionX: 12,
        positionY: 22,
        positionZ: 32,
        velocity: { x: 1, y: 0, z: 0 },
      }))

      advanceParticles(pool, 0.1, {
        ...firstFrame,
        entities: [
          { id: 'mob-2', feetPosition: { x: 1, y: 2, z: 3 } },
          { id: 'mob-1', feetPosition: { x: 11, y: 21, z: 31 } },
        ],
      })
      expect(readSlot(pool, 0)?.positionX).toBe(13)
      expect(readSlot(pool, 0)?.positionY).toBe(23)
      expect(readSlot(pool, 0)?.positionZ).toBe(33)

      advanceParticles(pool, 0.1, { dimension: 'overworld', entities: [] })
      expect(readSlot(pool, 0)?.followEntity).toBeUndefined()
      expect(readSlot(pool, 0)?.positionX).toBe(13)
      advanceParticles(pool, 0.1, { dimension: 'overworld', entities: [] })
      expect(readSlot(pool, 0)?.positionX).toBeCloseTo(13.1, 6)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(0.1, 8)
    }),
  )
})
