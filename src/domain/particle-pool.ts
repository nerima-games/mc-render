/**
 * The instanced particle pool: fixed capacity, drop-oldest, no frame-path
 * allocation, and a seeded generator.
 *
 * ---------------------------------------------------------------------------
 * plan.md §3.9
 * ---------------------------------------------------------------------------
 *
 * docs/responsibility.md §2 gives this repository 「パーティクル /
 * インスタンス化パーティクルプール」. The word that carries the design is
 * INSTANCED: one geometry, one material, one draw call, and N transforms in a
 * buffer. The alternative — an object per particle added to and removed from the
 * scene — is what the reference started from and moved away from, and the shape
 * it moved to is `THREE.InstancedMesh` over pre-allocated typed arrays
 * (ts-minecraft/packages/rendering/infrastructure/particles/particle-system-factory.ts:96-128).
 *
 * A pool is not just "an array with a maximum". It is a maximum plus AN ANSWER
 * TO WHAT HAPPENS WHEN THE MAXIMUM IS REACHED, and that answer is a design
 * decision that has to be stated rather than discovered by a player who mined a
 * wall of stone and watched the sparks stop. This file's answer, and its source,
 * are in the next section.
 *
 * ---------------------------------------------------------------------------
 * Capacity and eviction: the decision, and where it comes from
 * ---------------------------------------------------------------------------
 *
 * CAPACITY IS 512. Transcribed from `MAX_PARTICLES = 512`
 * (particle-system-factory.ts:5). TRANSCRIBED, NOT JUSTIFIED — the reference
 * gives no measurement, no frame-time budget and no derivation for 512, and this
 * repository cannot re-measure it (there is no GPU in the test environment; see
 * docs/testing.md §1). It is a round power of two that is plausibly one draw
 * call's worth of quads, and that is the whole of the evidence. Do not cite it
 * as a tuned number.
 *
 * EVICTION IS DROP-OLDEST. Not drop-new, and not grow. The reference decided
 * this and the decision is legible in its code rather than in a comment:
 *
 *   particle-system-factory.ts:147-169  `acquireSlot` — takes a free slot when
 *                                       one exists, and otherwise falls through
 *                                       to `findOldestSlot`;
 *   particle-system-factory.ts:130-145  `findOldestSlot` — linear scan for the
 *                                       live slot with the smallest age, which
 *                                       is the one spawned longest ago.
 *
 * The comment at :167 says it in words: 「Pool full -> evict oldest」.
 *
 * Why that is the right one of the three, stated because the reference does not:
 *
 *   DROP-NEW would make a saturated pool STOP RESPONDING. The particles on
 *   screen would be the ones from the first block broken, frozen in the sense
 *   that no new hit produces anything, and the player's own most recent action
 *   is the one with no feedback. That is the worst possible assignment of a
 *   scarce resource, because the newest particle is the one attached to the
 *   thing the player just did.
 *
 *   GROW would make the pool not a pool. The capacity exists so the transform
 *   buffer, the instance count and the draw call are fixed at construction;
 *   growing reallocates all five typed arrays and the `InstancedMesh` behind
 *   them, at exactly the moment the frame is already busiest. It converts a
 *   hard visual limit, which players do not notice, into a frame-time spike,
 *   which they do.
 *
 *   DROP-OLDEST spends the limit on the most recent events and degrades by
 *   shortening effective particle life under load, which reads as "busy" rather
 *   than as "broken".
 *
 * ---------------------------------------------------------------------------
 * How "oldest" is found, and why NOT the way the reference finds it
 * ---------------------------------------------------------------------------
 *
 * The reference keeps a second array, `ages` (particle-system-factory.ts:103),
 * holding a monotonically increasing spawn counter per slot, and scans it for
 * the minimum. Its comment at :101-102 reads:
 *
 *   // Per-instance "spawn frame" counter used to find the OLDEST active slot
 *   // when the pool is full. Wraps every ~136 years at 60fps — irrelevant.
 *
 * THE COMMENT ANSWERS THE WRONG QUESTION, and this is worth spelling out because
 * it is the exact failure mode this project has on record eight times over: a
 * figure that is correct about something other than the thing it is defending.
 * `ages` is a `Float32Array`. The binding constraint on a counter stored in
 * float32 is not when it WRAPS, it is when it stops being able to represent
 * consecutive integers — which is 2^24, or 16,777,216, because that is where the
 * 24-bit mantissa runs out. Past it, `ages[slot] = n` and `ages[slot] = n + 1`
 * store the same value, every live slot ties, and `findOldestSlot` returns slot
 * 0 forever. Whatever "~136 years" is measuring, it is not that.
 *
 * So this file does not keep an age array at all. It reads the ordering off
 * `lifetimesSecs`, which it already has:
 *
 *   every particle is spawned with the same `PARTICLE_LIFETIME_SECS`, and every
 *   live particle is decremented by the same `dt` in the same sweep, so
 *   REMAINING LIFETIME IS A STRICTLY DECREASING FUNCTION OF SPAWN TIME. The
 *   smallest remaining lifetime is the oldest particle. Exactly.
 *
 * That deletes 2KB of buffer, a counter, a `MutableRef`, and the precision
 * question, and it cannot go out of sync with the thing it is ordering because
 * it IS the thing it is ordering.
 *
 * THE ONE CONDITION IT DEPENDS ON, stated so that whoever breaks it finds this
 * paragraph: the equivalence holds because lifetime is a single shared constant.
 * The moment particles gain per-type lifetimes — smoke lingering longer than
 * block flecks — remaining lifetime stops ordering by spawn time and this must
 * go back to an explicit spawn counter. In a `Float64Array`, which represents
 * every integer up to 2^53 exactly and would have made the reference's comment
 * true as well as beside the point. `evictionOrderIsSpawnOrder` below is a value
 * that says so, and a test asserts on it, so the assumption is not only in prose.
 *
 * Ties — two particles spawned in the same frame have identical remaining
 * lifetime — are broken by lowest slot index. The choice is arbitrary and is
 * made explicit only so the pool is DETERMINISTIC: two runs of one scenario must
 * evict the same slot, or the seeded generator below is pointless.
 *
 * ---------------------------------------------------------------------------
 * Randomness: seeded, because the alternative is banned and also wrong
 * ---------------------------------------------------------------------------
 *
 * Particle spawn velocity is jittered. The reference draws it from
 * `Math.random()` (particle-system-factory.ts:171-174) under a comment that
 * weighs the allocator cost of a xorshift against it and concludes 「Math.random
 * is already non-allocating in modern V8. Stick with it.」 — a cost argument that
 * never reaches the question of REPRODUCIBILITY, which is the one that decides
 * it here. plan.md §5.1-3 makes determinism the precondition for using the
 * reference's behaviour as an oracle at all.
 *
 * The generator is Lehmer / Park-Miller MINSTD, transcribed from mx-gameplay's
 * `domain/frame-rolls.ts`, which is this project's precedent and carries the
 * full argument for it. The short form of that argument, because it governs the
 * code below: every intermediate of `16807 * x` for `x < 2^31` is exact in a
 * double, so the sequence is identical in every JavaScript engine, and it uses
 * no bitwise operator, so `.oxlintrc.json`'s `no-bitwise` needs no suppression in
 * the one file that produces randomness.
 *
 * It is kept as local deterministic data rather than imported from gameplay
 * code. A renderer should not add a gameplay dependency merely to obtain a
 * numeric constant, and the small arithmetic sequence is part of the render
 * domain's own reproducible particle behavior.
 *
 * ---------------------------------------------------------------------------
 * Why there is no `ScratchMap` here
 * ---------------------------------------------------------------------------
 *
 * `domain/frame-scratch.ts` holds this repository's argument about per-frame
 * allocation and the pool obeys it: `spawnBurst` and `advanceParticles` allocate
 * NOTHING, return numbers rather than objects, and write into buffers fixed at
 * construction.
 *
 * It does not use a `ScratchMap`, and the reason is a real difference rather
 * than an exemption. A `ScratchMap` solves "a keyed collection whose CONTENTS are
 * rebuilt every frame and must not outlive it" — the visible-chunk set, keyed by
 * a string nobody can predict. The pool's state is the opposite on both counts:
 * it is keyed by a dense integer slot in a fixed range, so a hash map buys
 * nothing over an offset, and its contents deliberately DO survive the frame
 * boundary, because a particle's whole job is to still be there next frame. A
 * buffer that must persist is exactly the thing `withScratch` exists to reject.
 *
 * ---------------------------------------------------------------------------
 * What is NOT here
 * ---------------------------------------------------------------------------
 *
 * No `THREE.InstancedMesh`, no `Matrix4`, no `BufferAttribute`. The adapter
 * reads `positions`, `scales` and `uvOffsets` with the stride constants below
 * and composes the instance matrix itself; that is the seam, and it belongs to
 * whoever owns the `three` surface. Nothing here needs a GPU to be checked, and
 * `test/particle-pool.test.ts` checks all of it.
 *
 * WHAT NEEDS A REAL SCREENSHOT AND CANNOT BE CHECKED HERE: whether the
 * particles LOOK right — the quad size against the block, the fade curve, the
 * atlas tile actually being the one that was broken, and whether 512 is enough
 * under a fast pickaxe. Those are docs/testing.md §1's fixture-and-screenshot
 * row, and this file does not pretend to cover them.
 */

import { TILE_UV_SPAN, tileUvOrigin } from './texture-atlas.js'
import { type MaterialSpec } from './material-policy.js'

// --- Constants transcribed from the reference ------------------------------
/*
 * Every value in this block is a TRANSCRIPTION from
 * ts-minecraft/packages/rendering/infrastructure/particles/, cited per line.
 * None of them is re-derived here and none of them is defended by a measurement
 * this repository can reproduce. Where the reference offers a rationale it is
 * quoted; where it offers none, that is said.
 */

/**
 * Slots the pool holds. `MAX_PARTICLES` at particle-system-factory.ts:5.
 *
 * TRANSCRIBED, NOT JUSTIFIED. See the header.
 */
export const PARTICLE_POOL_CAPACITY = 512

/**
 * How long a particle lives. `PARTICLE_LIFETIME_SECS` at
 * particle-system-factory.ts:6.
 *
 * Load-bearing beyond its own effect: the eviction order reads off remaining
 * lifetime and that only orders by spawn time because this is ONE constant
 * shared by every particle. See the header.
 */
export const PARTICLE_LIFETIME_SECS = 0.5

/**
 * Downward acceleration, m/s^2. `PARTICLE_GRAVITY` at
 * particle-system-factory.ts:7, whose comment is 「tuned to feel snappy in 0.5s
 * lifetime」.
 *
 * That is a feel claim, not a measurement, and it is coupled to
 * `PARTICLE_LIFETIME_SECS`: 12 m/s^2 is not real gravity (9.81) and was picked
 * against the 0.5s window. Changing either without the other discards whatever
 * tuning produced them.
 */
export const PARTICLE_GRAVITY_M_PER_S2 = 12

/**
 * The particle quad's edge, in metres. `PARTICLE_BASE_SIZE` at
 * particle-system-factory.ts:8.
 *
 * Consumed by the adapter building the geometry, not by the integrator. It is
 * here so that every particle constant is in one place and a reader does not
 * have to know which file the reference happened to put each one in.
 */
export const PARTICLE_QUAD_SIZE_M = 0.1

/** Horizontal launch speed bound, m/s. `SPREAD_HORIZONTAL`, factory:11. */
export const PARTICLE_SPREAD_HORIZONTAL_M_PER_S = 2

/** Upward launch speed bound, m/s. `SPREAD_UP`, factory:12. */
export const PARTICLE_SPREAD_UP_M_PER_S = 3

/**
 * Downward launch speed bound, m/s. `SPREAD_DOWN`, factory:13.
 *
 * Asymmetric with the upward bound on purpose — the reference's comment at :13
 * is 「downward seed (so some particles fall faster)」 — so vertical velocity is
 * drawn from `[-0.5, +3]`, not from a symmetric interval. Symmetrising it would
 * be an easy and invisible "tidy-up"; it would halve the upward kick.
 */
export const PARTICLE_SPREAD_DOWN_M_PER_S = 0.5

/**
 * Particles in a burst when the caller does not say. `count: number = 6` at
 * particle-system.ts:126.
 *
 * The spread bounds at :11-13 are documented as 「Tuned so 6-particle bursts
 * visually scatter without leaving the 1m source cube」, so this and those four
 * were chosen together.
 */
export const DEFAULT_BURST_PARTICLES = 6

/**
 * The largest step the integrator will take, in seconds.
 * `Math.min(dtSecs, 0.1)` at particle-system.ts:166.
 *
 * The reference's reason, at :164-165: 「at the start of a tab-resumed frame
 * dtSecs can be huge and we don't want particles to teleport into orbit」. The
 * clamp is not a smoothing filter — it is a guard against one specific
 * pathological frame, and at 0.1s it is already four times a 60Hz step, so it
 * never fires during normal play.
 */
export const MAX_PARTICLE_STEP_SECS = 0.1

/**
 * The seed a pool starts from when the caller does not supply one.
 *
 * A literal keeps repeated runs of one scenario reproducible. It is written as
 * a full number rather than as `1` so nobody reads it as a placeholder.
 */
export const DEFAULT_PARTICLE_SEED = 20_260_728

/** Floats per particle in `positions` and `velocities`: x, y, z. */
export const PARTICLE_VECTOR_STRIDE = 3

/** Floats per particle in `uvOffsets`: u, v. */
export const PARTICLE_UV_STRIDE = 2

/**
 * The UV width an instanced particle quad may span.
 *
 * Re-exported from `domain/texture-atlas.ts` rather than restated, because the
 * reference restates it — as `TILE_FRACTION = 1/16` at
 * particle-system-factory.ts:17 — and the restatement is where the half-texel
 * inset gets lost. That file's header has the derivation.
 */
export const PARTICLE_UV_SPAN = TILE_UV_SPAN

/**
 * A statement of the assumption the eviction order rests on.
 *
 * `true` exactly while every particle shares one lifetime constant. It is a
 * value and not a comment so that `test/particle-pool.test.ts` can assert on it:
 * the day someone adds per-type lifetimes, the honest move is to set this to
 * `false`, at which point the test that pins drop-oldest fails and points at the
 * header rather than at a stale paragraph. See the header.
 */
export const evictionOrderIsSpawnOrder = true

// --- The seeded generator ---------------------------------------------------
/*
 * Park-Miller MINSTD, transcribed from mx-gameplay/domain/frame-rolls.ts. That
 * file carries the argument; this is the arithmetic. Kept private: the pool's
 * randomness is an implementation detail of its jitter and exposing a second
 * public generator in this repository would invite a second sequence.
 */

/** `2^31 - 1`, prime. */
const PRNG_MODULUS = 2_147_483_647

/** Park & Miller's multiplier, a primitive root of `PRNG_MODULUS`. */
const PRNG_MULTIPLIER = 16_807

/** The shared "empty slot" / "no offset" / "off" value used throughout this file. */
const ZERO = 0

/** The single-slot step used by every index-advancing loop and counter in this file. */
const ONE_SLOT = 1

/** `(state - 1) / MODULUS`, not `state / MODULUS`. See `nextUnitRoll`'s doc comment. */
const PRNG_OUTPUT_OFFSET = 1

/** What a rejected or fixed-point seed folds to. See `normaliseSeed`'s doc comment. */
const NORMALISED_SEED_FALLBACK = ONE_SLOT

/**
 * Fold any number into the generator's legal state, `[1, PRNG_MODULUS - 1]`.
 *
 * Zero is the generator's fixed point, so it maps to 1 rather than being
 * accepted; a non-number lands on the same value rather than poisoning every
 * subsequent draw with NaN. The inert direction, as everywhere else here.
 */
const normaliseSeed = (seed: number): number => {
  if (!Number.isFinite(seed)) {
    return NORMALISED_SEED_FALLBACK
  }
  const folded = Math.abs(Math.trunc(seed)) % PRNG_MODULUS
  if (folded === ZERO) {
    return NORMALISED_SEED_FALLBACK
  }
  return folded
}

// --- The pool ---------------------------------------------------------------

/**
 * The pool's buffers and its counters.
 *
 * The five typed arrays are the ones the adapter reads. They are exposed
 * DIRECTLY, rather than behind an accessor, for the same reason
 * `domain/frame-scratch.ts` exposes its raw `Map`: an accessor per particle per
 * frame is the allocation and indirection this whole file exists to avoid. The
 * cost is that a caller can write into them, and the mitigation is that the only
 * caller is the adapter that also owns the `InstancedMesh` they feed.
 *
 * `lifetimesSecs[slot] === 0` means the slot is free. That single convention
 * replaces a separate occupancy bitmap and is why `scales[slot]` is also 0 for a
 * free slot: an adapter that ignores occupancy entirely and simply composes
 * every slot's matrix still draws nothing for the free ones, because a zero
 * scale collapses the quad to a point. The reference reaches the same place with
 * an explicit `ZERO_MATRIX` (particle-system-factory.ts:36).
 */
export type ParticlePool = {
  readonly capacity: number
  /** `capacity * 3` floats: x, y, z per slot. */
  readonly positions: Float32Array
  /** `capacity * 3` floats: x, y, z per slot, in m/s. */
  readonly velocities: Float32Array
  /** `capacity` floats. Seconds remaining. ZERO MEANS FREE. */
  readonly lifetimesSecs: Float32Array
  /** `capacity` floats in `[0, 1]`. The lifetime fade, and 0 for a free slot. */
  readonly scales: Float32Array
  /** `capacity * 2` floats: the atlas tile origin this particle samples. */
  readonly uvOffsets: Float32Array
  /** Live slots. Never exceeds `capacity`. */
  readonly activeCount: () => number
  /** The generator's current state. Diagnostics and determinism tests. */
  readonly seed: () => number
  /** Times a live particle was displaced because the pool was full. */
  readonly evictionCount: () => number
}

type PoolInternals = ParticlePool & {
  readonly state: {
    active: number
    seedState: number
    evictions: number
    nextSlot: number
  }
}

/** Construction-time options. Not on the frame path, so an object is fine here. */
export type ParticlePoolOptions = {
  /**
   * Slots. Defaults to `PARTICLE_POOL_CAPACITY`.
   *
   * Configurable ONLY so that eviction can be tested at a capacity a test can
   * reason about — filling 512 slots to observe one eviction is a test nobody
   * reads. Production has no reason to pass it.
   */
  readonly capacity?: number
  /** The generator's starting state. Defaults to `DEFAULT_PARTICLE_SEED`. */
  readonly seed?: number
}

/**
 * Read a float at an index constructed by the pool's bounded loops.
 *
 * `noUncheckedIndexedAccess` is on, so every typed-array read is
 * `number | undefined`. The non-null assertion belongs here because all calls
 * below are in bounds by construction; keeping that invariant explicit avoids
 * adding an unreachable fallback branch to every buffer read.
 */
const readFloat = (buffer: Float32Array, index: number): number => buffer[index]!

/**
 * Allocate a pool. THE ONLY FUNCTION HERE THAT ALLOCATES.
 *
 * Five typed arrays and one state object, once, at construction. Everything
 * after this point writes into them.
 */
/**
 * A pool of zero or of half a slot is a programmer error rather than a state
 * to model, and the inert direction for it is one slot: the pool still works,
 * every spawn evicts, and the mistake shows up as visibly-wrong output rather
 * than as a zero-length buffer that makes every later index silently `0`.
 */
const resolvePoolCapacity = (requested: number): number => {
  if (Number.isInteger(requested) && requested > ZERO) {
    return requested
  }
  return ONE_SLOT
}

export const makeParticlePool = (options?: ParticlePoolOptions): ParticlePool => {
  const requested = options?.capacity ?? PARTICLE_POOL_CAPACITY
  const capacity = resolvePoolCapacity(requested)

  const pool: PoolInternals = {
    activeCount: () => pool.state.active,
    capacity,
    evictionCount: () => pool.state.evictions,
    lifetimesSecs: new Float32Array(capacity),
    positions: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
    scales: new Float32Array(capacity),
    seed: () => pool.state.seedState,
    state: {
      active: 0,
      evictions: 0,
      nextSlot: 0,
      seedState: normaliseSeed(options?.seed ?? DEFAULT_PARTICLE_SEED),
    },
    uvOffsets: new Float32Array(capacity * PARTICLE_UV_STRIDE),
    velocities: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
  }

  return pool
}

/**
 * Draw the next value in `[0, 1)` and advance the pool's generator.
 *
 * `(state - 1) / MODULUS` rather than `state / MODULUS`, matching frame-rolls:
 * the latter never yields 0, and dividing by `MODULUS - 1` instead would yield
 * exactly 1 on the largest state — outside the half-open interval every caller
 * assumes.
 */
const nextUnitRoll = (pool: PoolInternals): number => {
  const state = (PRNG_MULTIPLIER * normaliseSeed(pool.state.seedState)) % PRNG_MODULUS
  pool.state.seedState = state
  return (state - PRNG_OUTPUT_OFFSET) / PRNG_MODULUS
}

/** Draw uniformly from `[min, max)`. */
const nextInRange = (pool: PoolInternals, min: number, max: number): number =>
  min + nextUnitRoll(pool) * (max - min)

/**
 * The live slot that will die soonest, which is the one spawned longest ago.
 *
 * Linear, and that is fine for the reason the reference gives at :131-132: it
 * runs only when the pool is saturated, and the scan is over a contiguous
 * `Float32Array` that fits comfortably in L1 at capacity 512.
 *
 * Ties go to the lowest slot index — `<` rather than `<=` — so a saturated pool
 * evicts deterministically. Returns 0 when no slot is live, which cannot happen
 * on the only path that calls it and is the inert answer if it ever does.
 */
const findOldestSlot = (pool: ParticlePool): number => {
  let oldest = 0
  let smallestRemaining = Number.POSITIVE_INFINITY

  for (let slot = 0; slot < pool.capacity; slot += ONE_SLOT) {
    const remaining = readFloat(pool.lifetimesSecs, slot)
    if (remaining > ZERO && remaining < smallestRemaining) {
      smallestRemaining = remaining
      oldest = slot
    }
  }

  return oldest
}

/**
 * Reserve a slot, evicting the oldest live particle if every slot is taken.
 *
 * The free-slot walk starts from `nextSlot` and wraps, so consecutive spawns
 * spread across the buffer instead of contending for slot 0. That is
 * transcribed from the reference (:154-160) and it is not cosmetic: the walk's
 * cost is "distance to the next free slot", and always restarting from 0 makes
 * that distance grow with occupancy on every single spawn.
 */
const acquireSlot = (pool: PoolInternals): number => {
  if (pool.state.active < pool.capacity) {
    for (let step = 0; step < pool.capacity; step += ONE_SLOT) {
      const candidate = (pool.state.nextSlot + step) % pool.capacity
      if (readFloat(pool.lifetimesSecs, candidate) === ZERO) {
        pool.state.nextSlot = (candidate + ONE_SLOT) % pool.capacity
        pool.state.active += 1
        return candidate
      }
    }
  }

  /*
   * Saturated. Reuse the oldest live slot: `active` does not change, because
   * one particle replaced another rather than joining it.
   */
  pool.state.evictions += 1
  return findOldestSlot(pool)
}

/** The lowest count `spawnBurst` will treat as a request rather than a no-op. */
const MIN_BURST_COUNT = 1

/** Offset of the second component (y, or v) within a stride-3 or stride-2 buffer entry. */
const SECOND_COMPONENT_OFFSET = 1

/** Offset of the third component (z) within a stride-3 buffer entry. */
const THIRD_COMPONENT_OFFSET = 2

/** `value` if finite, `fallback` otherwise. */
const resolveFiniteOr = (value: number, fallback: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return fallback
}

/**
 * Position write for one particle. Positional params, not an options object:
 * this runs once per spawned particle on the frame path (see `spawnBurst`'s
 * doc comment), and an object per particle is the allocation this file exists
 * to avoid.
 */
const writeParticlePosition = (
  internals: PoolInternals,
  vectorBase: number,
  positionX: number,
  positionY: number,
  positionZ: number,
): void => {
  internals.positions[vectorBase] = positionX
  internals.positions[vectorBase + SECOND_COMPONENT_OFFSET] = positionY
  internals.positions[vectorBase + THIRD_COMPONENT_OFFSET] = positionZ
}

/** Jittered velocity write for one particle. See `writeParticlePosition` for the spread. */
const writeParticleVelocity = (internals: PoolInternals, vectorBase: number): void => {
  internals.velocities[vectorBase] = nextInRange(
    internals,
    -PARTICLE_SPREAD_HORIZONTAL_M_PER_S,
    PARTICLE_SPREAD_HORIZONTAL_M_PER_S,
  )
  internals.velocities[vectorBase + SECOND_COMPONENT_OFFSET] = nextInRange(
    internals,
    -PARTICLE_SPREAD_DOWN_M_PER_S,
    PARTICLE_SPREAD_UP_M_PER_S,
  )
  internals.velocities[vectorBase + THIRD_COMPONENT_OFFSET] = nextInRange(
    internals,
    -PARTICLE_SPREAD_HORIZONTAL_M_PER_S,
    PARTICLE_SPREAD_HORIZONTAL_M_PER_S,
  )
}

/**
 * One particle's writes into `internals`' buffers at `slot`. Seven positional
 * params, not an options object: this runs once per spawned particle on the
 * frame path (see `spawnBurst`'s doc comment for why that rules out an
 * allocating options object here too).
 */
const writeParticle = (
  internals: PoolInternals,
  slot: number,
  positionX: number,
  positionY: number,
  positionZ: number,
  uvU: number,
  uvV: number,
): void => {
  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  const uvBase = slot * PARTICLE_UV_STRIDE

  writeParticlePosition(internals, vectorBase, positionX, positionY, positionZ)
  writeParticleVelocity(internals, vectorBase)

  internals.uvOffsets[uvBase] = uvU
  internals.uvOffsets[uvBase + SECOND_COMPONENT_OFFSET] = uvV

  internals.lifetimesSecs[slot] = PARTICLE_LIFETIME_SECS
  /*
   * Full scale immediately, so the particle is visible in THIS frame even if
   * `advanceParticles` has not run since the spawn. The reference makes the
   * same point at particle-system.ts:152.
   */
  internals.scales[slot] = 1
}

/**
 * Resolve how many particles a burst should spawn, or `0` if the request is
 * invalid (a non-finite/too-small `count`, or a non-finite spawn point).
 *
 * COUNT HANDLING DIVERGES FROM THE REFERENCE, deliberately. It clamps with
 * `Math.max(1, Math.min(MAX_PARTICLES, Math.floor(count)))` (particle-system.ts:129),
 * so `spawnBurst(..., 0)` spawns ONE particle: asking for nothing gets you
 * something. That is a defect rather than a decision — nothing in the reference
 * defends it — and a caller computing a count from, say, a block's hardness will
 * hit the zero case and get a stray fleck. Here, a count that is zero, negative
 * or not a number spawns nothing and returns 0.
 *
 * A spawn point that is not a point would write NaN into the position buffer,
 * and NaN propagates through every subsequent integration step and into the
 * instance matrix, where it silently removes the whole InstancedMesh from the
 * screen rather than one particle. Refuse the burst instead.
 *
 * A burst larger than the pool would evict its own earlier particles and end
 * with `capacity` of them, so clamping here makes the return value honest
 * rather than reporting spawns that were immediately overwritten.
 */
const resolveSpawnRequest = (
  pool: ParticlePool,
  count: number,
  positionX: number,
  positionY: number,
  positionZ: number,
): number => {
  if (!Number.isFinite(count) || count < MIN_BURST_COUNT) {
    return ZERO
  }
  if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(positionZ)) {
    return ZERO
  }
  return Math.min(Math.floor(count), pool.capacity)
}

/**
 * The spawn loop itself. Seven positional params for the same reason as
 * `writeParticle`: this is the frame-path body, not a call site an options
 * object would meaningfully clarify.
 */
const spawnRequestedParticles = (
  internals: PoolInternals,
  requested: number,
  positionX: number,
  positionY: number,
  positionZ: number,
  safeU: number,
  safeV: number,
): void => {
  for (let spawned = 0; spawned < requested; spawned += ONE_SLOT) {
    const slot = acquireSlot(internals)
    writeParticle(internals, slot, positionX, positionY, positionZ, safeU, safeV)
  }
}

/**
 * Spawn a burst at a point. ALLOCATES NOTHING.
 *
 * Positional arguments rather than a `BurstSpawn` object, and a `number` return
 * rather than a result record, for that reason — a burst fires on the frame path
 * whenever a block is hit, and an object per hit is an allocation per hit.
 *
 * `uvU` / `uvV` are an atlas tile origin; `spawnBlockBurst` below is the
 * convenience that turns a tile index into one.
 *
 * Returns the number of particles actually spawned. See `resolveSpawnRequest`
 * for how an invalid request is distinguished from a legitimately small one.
 */
export const spawnBurst = (
  pool: ParticlePool,
  positionX: number,
  positionY: number,
  positionZ: number,
  uvU: number,
  uvV: number,
  count: number = DEFAULT_BURST_PARTICLES,
): number => {
  const internals = pool as PoolInternals
  const requested = resolveSpawnRequest(pool, count, positionX, positionY, positionZ)
  if (requested === ZERO) {
    return ZERO
  }

  const safeU = resolveFiniteOr(uvU, ZERO)
  const safeV = resolveFiniteOr(uvV, ZERO)
  spawnRequestedParticles(internals, requested, positionX, positionY, positionZ, safeU, safeV)

  return requested
}

/**
 * Spawn a burst that samples one atlas tile.
 *
 * The convenience over `spawnBurst`, and the only place particle code touches
 * the atlas. It allocates one `UvOrigin` per burst — per BLOCK HIT, not per
 * frame and not per particle — which is the boundary this file draws: the frame
 * path allocates nothing, an input event may allocate a small constant amount.
 * A caller in a genuinely hot loop can call `spawnBurst` with a hoisted origin.
 *
 * `max-params` stays un-silenced despite the allocation allowance above: an
 * options object here is still a signature change, and `test/particle-pool.test.ts`
 * calls this positionally (`spawnBlockBurst(pool, 0, 0, 0, 7, 2)`), which is
 * out of scope for a lint-only pass. The allowance is about the runtime cost,
 * not about the shape of the parameter list.
 */
export const spawnBlockBurst = (
  pool: ParticlePool,
  positionX: number,
  positionY: number,
  positionZ: number,
  tileIndex: number,
  count: number = DEFAULT_BURST_PARTICLES,
): number => {
  const origin = tileUvOrigin(tileIndex)
  return spawnBurst(pool, positionX, positionY, positionZ, origin.u, origin.v, count)
}

/**
 * Freeing a slot is exactly these two writes: zero lifetime marks it
 * available, zero scale makes it draw nothing. Position and velocity are
 * left alone because the next spawn overwrites both, and clearing them
 * would be six writes per expiry that nothing reads.
 */
const expireSlot = (internals: PoolInternals, slot: number): void => {
  internals.lifetimesSecs[slot] = 0
  internals.scales[slot] = 0
}

/**
 * Euler-integrate one live slot, matching the reference (particle-system.ts:189-193):
 * velocity takes gravity, then position takes velocity. Semi-implicit rather
 * than explicit — the updated velocity is the one that moves the particle — and
 * over a 0.5s life with a 0.1s step ceiling the difference between integrators
 * is far below what a 0.1m quad can show.
 *
 * Four positional params rather than an options object for the same reason as
 * `writeParticle`: this runs once per live particle per frame, and an object
 * per particle per frame is the allocation this file exists to avoid.
 */
const integrateSlot = (internals: PoolInternals, slot: number, nextRemaining: number, dt: number): void => {
  internals.lifetimesSecs[slot] = nextRemaining

  const vectorBase = slot * PARTICLE_VECTOR_STRIDE

  const vy =
    readFloat(internals.velocities, vectorBase + SECOND_COMPONENT_OFFSET) - PARTICLE_GRAVITY_M_PER_S2 * dt
  internals.velocities[vectorBase + SECOND_COMPONENT_OFFSET] = vy

  internals.positions[vectorBase] =
    readFloat(internals.positions, vectorBase) + readFloat(internals.velocities, vectorBase) * dt
  internals.positions[vectorBase + SECOND_COMPONENT_OFFSET] =
    readFloat(internals.positions, vectorBase + SECOND_COMPONENT_OFFSET) + vy * dt
  internals.positions[vectorBase + THIRD_COMPONENT_OFFSET] =
    readFloat(internals.positions, vectorBase + THIRD_COMPONENT_OFFSET) +
    readFloat(internals.velocities, vectorBase + THIRD_COMPONENT_OFFSET) * dt

  /*
   * Linear fade from 1 to 0 across the remaining life, matching
   * particle-system.ts:196-198. Scale rather than opacity because the material
   * is a cutout (`alphaTest: 0.5`, particle-system.ts:54) and a cutout cannot
   * fade its alpha — every fragment is opaque or discarded, so a fading alpha
   * would pop out of existence at the threshold instead of fading.
   */
  internals.scales[slot] = nextRemaining / PARTICLE_LIFETIME_SECS
}

/**
 * Advance one slot by `dt`. Returns whether the slot expired during this step.
 *
 * Extracted from `advanceParticles` so the per-slot early-outs (an inactive
 * slot, an expiring slot) are ordinary returns rather than loop `continue`s.
 */
const advanceSlot = (internals: PoolInternals, slot: number, dt: number): boolean => {
  const remaining = readFloat(internals.lifetimesSecs, slot)
  if (remaining <= ZERO) {
    return false
  }

  const nextRemaining = remaining - dt
  if (nextRemaining <= ZERO) {
    expireSlot(internals, slot)
    return true
  }

  integrateSlot(internals, slot, nextRemaining, dt)
  return false
}

/**
 * Integrate one frame. ALLOCATES NOTHING.
 *
 * Returns the number of particles that expired during this step, which is what
 * a caller needs to decide whether the mesh's instance buffer must be re-uploaded
 * and is a `number`, so returning it costs nothing.
 *
 * `dtSecs` is clamped to `[0, MAX_PARTICLE_STEP_SECS]`, and a NON-FINITE `dtSecs`
 * ADVANCES NOTHING. That last part is a divergence from the reference, whose
 * clamp is `Math.max(0, Math.min(dtSecs, 0.1))` (particle-system.ts:166) —
 * `Math.min(NaN, 0.1)` is NaN and `Math.max(0, NaN)` is NaN, so a single
 * non-finite frame delta writes NaN into every live particle's position and
 * velocity and the pool never recovers. The inert direction for a delta nobody
 * can interpret is to not move, which is what mx-gameplay's `normaliseSeed` and
 * this file's own `readFloat` both do with the same class of input.
 */
export const advanceParticles = (pool: ParticlePool, dtSecs: number): number => {
  if (!Number.isFinite(dtSecs)) {
    return ZERO
  }
  const dt = Math.max(ZERO, Math.min(dtSecs, MAX_PARTICLE_STEP_SECS))

  const internals = pool as PoolInternals
  let expired = 0

  for (let slot = 0; slot < pool.capacity; slot += ONE_SLOT) {
    if (advanceSlot(internals, slot, dt)) {
      expired += ONE_SLOT
    }
  }

  internals.state.active = Math.max(ZERO, internals.state.active - expired)

  return expired
}

/**
 * Free every slot.
 *
 * For a world unload or a teleport, where carrying the previous location's
 * sparks across is a visible artefact. It does NOT reset the generator: the
 * seed is a position in a sequence, not a fact about the world, and resetting it
 * on every unload would make the sequence restart rather than continue — the
 * same reasoning mx-gameplay's `domain/frame-rolls.ts` gives for the frame seed
 * not belonging in a save file.
 */
export const clearParticles = (pool: ParticlePool): void => {
  const internals = pool as PoolInternals
  internals.lifetimesSecs.fill(ZERO)
  internals.scales.fill(ZERO)
  internals.state.active = 0
  internals.state.nextSlot = 0
}

/** True when `slot` holds a live particle. */
export const isSlotActive = (pool: ParticlePool, slot: number): boolean =>
  Number.isInteger(slot) && slot >= ZERO && slot < pool.capacity && readFloat(pool.lifetimesSecs, slot) > ZERO

/** One particle, as a value. */
export type ParticleSlotState = {
  readonly positionX: number
  readonly positionY: number
  readonly positionZ: number
  readonly velocityX: number
  readonly velocityY: number
  readonly velocityZ: number
  readonly remainingSecs: number
  readonly scale: number
  readonly uvU: number
  readonly uvV: number
}

/**
 * Read one slot out as a value.
 *
 * FOR DIAGNOSTICS AND TESTS. NOT FOR THE FRAME PATH — it allocates, and calling
 * it once per particle per frame reintroduces exactly the garbage the typed
 * arrays exist to avoid. The adapter reads `positions`, `scales` and `uvOffsets`
 * directly with `PARTICLE_VECTOR_STRIDE` and `PARTICLE_UV_STRIDE`.
 *
 * Returns `undefined` for a slot that is out of range or free, so a caller
 * cannot mistake a zeroed record for a particle at the origin.
 */
export const readSlot = (pool: ParticlePool, slot: number): ParticleSlotState | undefined => {
  if (!isSlotActive(pool, slot)) {
    return
  }

  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  const uvBase = slot * PARTICLE_UV_STRIDE

  return {
    positionX: readFloat(pool.positions, vectorBase),
    positionY: readFloat(pool.positions, vectorBase + SECOND_COMPONENT_OFFSET),
    positionZ: readFloat(pool.positions, vectorBase + THIRD_COMPONENT_OFFSET),
    remainingSecs: readFloat(pool.lifetimesSecs, slot),
    scale: readFloat(pool.scales, slot),
    uvU: readFloat(pool.uvOffsets, uvBase),
    uvV: readFloat(pool.uvOffsets, uvBase + SECOND_COMPONENT_OFFSET),
    velocityX: readFloat(pool.velocities, vectorBase),
    velocityY: readFloat(pool.velocities, vectorBase + SECOND_COMPONENT_OFFSET),
    velocityZ: readFloat(pool.velocities, vectorBase + THIRD_COMPONENT_OFFSET),
  }
}

/**
 * The particle material's properties, for `domain/material-policy.ts`.
 *
 * Transcribed from particle-system.ts:50-61. It is `shared` because ONE material
 * backs the whole `InstancedMesh` — which is the entire point of an instanced
 * pool — and that is the shared-material condition of the `forceSinglePass`
 * rule.
 *
 * `alphaTest: 0.5` makes it a cutout, so `requiresForceSinglePass` returns true
 * for it and the reference's flag at :60 is what the rule already says. The
 * billboard geometry is also a flat surface, so its `MaterialSpec` records that
 * fact even though the cutout flag is already sufficient.
 */
/**
 * The cutout threshold. `alphaTest: 0.5` at particle-system.ts:54.
 *
 * NAMED rather than left inline in the spec below, because `./particle-shader.ts`
 * interpolates it into the fragment stage's `discard`. A material's `alphaTest`
 * and a shader's `discard` threshold are the SAME decision expressed twice, and
 * three applies the former only to materials it generates — a `ShaderMaterial`
 * has to test it itself. Two different numbers here would mean the cutout moves
 * depending on which path drew the particle, which is invisible in any test that
 * does not render.
 */
export const PARTICLE_ALPHA_TEST = 0.5

export const PARTICLE_MATERIAL_SPEC: MaterialSpec = {
  alphaTest: PARTICLE_ALPHA_TEST,
  flatSurface: true,
  name: 'particleMaterial',
  shared: true,
  side: 'double',
  transparent: true,
}

/**
 * `depthWrite: false`. particle-system.ts:56.
 *
 * Outside `MaterialSpec` for the same reason `WATER_WRITES_DEPTH` is: the policy
 * has no opinion, and the flag is nonetheless load-bearing. Particles that write
 * depth occlude each other in spawn order rather than in depth order, so a
 * burst renders as a cluster of hard-edged squares punched out of one another.
 */
export const PARTICLE_WRITES_DEPTH = false
