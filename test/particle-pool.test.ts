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
 *   - THE TWO DIVERGENCES from the reference — a zero-count burst, and a
 *     non-finite frame delta — each pinned as a REGRESSION so nobody
 *     "corrects" them back.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { requiresForceSinglePass } from '../src/domain/material-policy'
import {
  advanceParticles,
  clearParticles,
  DEFAULT_BURST_PARTICLES,
  DEFAULT_PARTICLE_SEED,
  evictionOrderIsSpawnOrder,
  isSlotActive,
  makeParticlePool,
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
  spawnBlockBurst,
  spawnBurst,
  type ParticlePool,
} from '../src/domain/particle-pool'
import { TILE_UV_SPAN, tileUvOrigin } from '../src/domain/texture-atlas'

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
      expect(pool.scales.length).toBe(PARTICLE_POOL_CAPACITY)
      expect(pool.uvOffsets.length).toBe(PARTICLE_POOL_CAPACITY * 2)
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
      expect(makeParticlePool({ capacity: 0 }).capacity).toBe(1)
      expect(makeParticlePool({ capacity: -4 }).capacity).toBe(1)
      expect(makeParticlePool({ capacity: 2.5 }).capacity).toBe(1)
      expect(makeParticlePool({ capacity: Number.NaN }).capacity).toBe(1)
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
        expect(particle?.x).toBe(1)
        expect(particle?.y).toBe(2)
        expect(particle?.z).toBe(3)
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

  it.effect('REGRESSION: a burst of zero spawns NOTHING (the reference spawns one)', () =>
    Effect.sync(() => {
      // particle-system.ts:129 clamps with Math.max(1, ...), so asking for zero
      // particles produces one stray fleck. See domain/particle-pool.ts.
      const pool = makeParticlePool({ capacity: 8 })
      expect(spawnBurst(pool, 0, 0, 0, 0, 0, 0)).toBe(0)
      expect(spawnBurst(pool, 0, 0, 0, 0, 0, -3)).toBe(0)
      expect(spawnBurst(pool, 0, 0, 0, 0, 0, Number.NaN)).toBe(0)
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
      expect(spawnBurst(pool, Number.NaN, 0, 0, 0, 0)).toBe(0)
      expect(spawnBurst(pool, 0, Number.POSITIVE_INFINITY, 0, 0, 0)).toBe(0)
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

  it.effect('a non-finite seed is folded rather than propagated as NaN', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: Number.NaN })
      spawnBurst(pool, 0, 0, 0, 0, 0, 4)
      for (let slot = 0; slot < 4; slot += 1) {
        expect(Number.isFinite(readSlot(pool, slot)?.velocityY ?? Number.NaN)).toBe(true)
      }
    }),
  )
})

describe('integration', () => {
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
      expect(readSlot(pool, 0)?.y ?? 0).toBeCloseTo(10 + expectedVy * 0.05, 4)
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

      expect(readSlot(clamped, 0)?.y ?? 0).toBeCloseTo(readSlot(stepped, 0)?.y ?? 0, 5)
    }),
  )

  it.effect('REGRESSION: a non-finite dt advances NOTHING (the reference writes NaN everywhere)', () =>
    Effect.sync(() => {
      // particle-system.ts:166's Math.max(0, Math.min(NaN, 0.1)) is NaN, and one
      // bad frame delta poisons every live particle permanently.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 1, 2, 3, 0, 0, 2)

      expect(advanceParticles(pool, Number.NaN)).toBe(0)
      expect(advanceParticles(pool, Number.POSITIVE_INFINITY)).toBe(0)

      expect(readSlot(pool, 0)?.x).toBe(1)
      expect(readSlot(pool, 0)?.y).toBe(2)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
      expect(pool.activeCount()).toBe(2)
    }),
  )

  it.effect('a negative dt is clamped to zero rather than running time backwards', () =>
    Effect.sync(() => {
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      spawnBurst(pool, 0, 0, 0, 0, 0, 1)
      advanceParticles(pool, -5)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(PARTICLE_LIFETIME_SECS, 6)
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The capacity is only a design decision because of what happens
// when it is reached. Asserted in both directions per docs/testing.md §5.5.
// ---------------------------------------------------------------------------
describe('eviction, when the pool is full', () => {
  it.effect('states the assumption its ordering rests on', () =>
    Effect.sync(() => {
      // Remaining lifetime orders by spawn time ONLY while lifetime is one
      // shared constant. See domain/particle-pool.ts.
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
      // Growing would reallocate five typed arrays and the InstancedMesh behind
      // them, in the frame that is already busiest.
      const pool = makeParticlePool({ capacity: 4, seed: 7 })
      const {positions} = pool
      const lifetimes = pool.lifetimesSecs

      for (let burst = 0; burst < 50; burst += 1) {
        spawnBurst(pool, burst, 0, 0, 0, 0, 6)
        advanceParticles(pool, 0.016)
      }

      expect(pool.positions).toBe(positions)
      expect(pool.lifetimesSecs).toBe(lifetimes)
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
        expect(particle?.x).toBe(pool.positions[vectorBase])
        expect(particle?.y).toBe(pool.positions[vectorBase + 1])
        expect(particle?.z).toBe(pool.positions[vectorBase + 2])
        expect(particle?.scale).toBe(pool.scales[slot])
        expect(particle?.uvU).toBe(pool.uvOffsets[uvBase])
        expect(particle?.uvV).toBe(pool.uvOffsets[uvBase + 1])
      }
    }),
  )
})
