/**
 * The instanced particle pool: fixed capacity, drop-oldest, allocation-free
 * per-particle loops, and a seeded generator.
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
 *   growing reallocates the pool buffers and the `InstancedMesh` behind
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
 * C6 adds per-request lifetimes, so remaining lifetime no longer orders slots
 * by spawn time. This pool stores a per-slot BigInt spawn sequence instead; it
 * remains exact and is read only when the pool is saturated.
 *
 * Keeping the sequence separate from lifetimes is necessary because requests
 * may specify different lifetimes. A Float32 counter would lose consecutive
 * values after 2^24 spawns; BigInt keeps the ordering exact. The slot scan only
 * runs when the pool is full, and the C6 pool test checks this ordering with
 * unequal lifetimes.
 *
 * If two slots have an identical sequence value, `<` keeps the lower slot index.
 * Valid spawns always receive distinct sequence values; the tie rule makes the
 * pool deterministic if its public buffers are altered directly.
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
 * allocation. The pool writes into buffers fixed at construction and avoids
 * per-particle allocation; its public mutators return one typed Result per call
 * so invalid input remains visible to callers.
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

import { ATLAS_TILE_COUNT, TILE_UV_SPAN, tileUvOrigin } from './texture-atlas.js'
import { Brand, Result, Schema } from 'effect'
import type { DeltaTimeSecs, Dimension, PositionAxis } from '@nerima-games/mc-kernel'
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
 * Default lifetime for legacy bursts. `PARTICLE_LIFETIME_SECS` at
 * particle-system-factory.ts:6. C6 requests may supply a per-particle lifetime;
 * saturated-pool eviction uses its separate spawn sequence.
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


/** RGB tint components per particle. */
export const PARTICLE_COLOR_STRIDE: number = PARTICLE_VECTOR_STRIDE

/**
 * The UV width an instanced particle quad may span.
 *
 * Re-exported from `domain/texture-atlas.ts` rather than restated, because the
 * reference restates it — as `TILE_FRACTION = 1/16` at
 * particle-system-factory.ts:17 — and the restatement is where the half-texel
 * inset gets lost. That file's header has the derivation.
 */
export const PARTICLE_UV_SPAN: number = TILE_UV_SPAN

/**
 * The saturated pool replaces the oldest live particle, independent of lifetime.
 * C6's unequal-lifetime test checks the ordering this public marker describes.
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
const INITIAL_SPAWN_SEQUENCE = 0n
/** The upper bound for normalized color and texture coordinates. */
const UNIT_INTERVAL_MAXIMUM = 1
export const MAX_PARTICLE_WORLD_COORDINATE = 30_000_000
export const MAX_PARTICLE_SPEED_M_PER_SECOND = 64
export const MAX_PARTICLE_LIFETIME_SECS = 10
const MAX_PARTICLE_FOLLOW_OFFSET = MAX_PARTICLE_WORLD_COORDINATE + MAX_PARTICLE_WORLD_COORDINATE

/** The single-slot step used by every index-advancing loop and counter in this file. */
const ONE_SLOT = 1

/** `(state - 1) / MODULUS`, not `state / MODULUS`. See `nextUnitRoll`'s doc comment. */
const PRNG_OUTPUT_OFFSET = 1

/** What a rejected or fixed-point seed folds to. See `normaliseSeed`'s doc comment. */
const NORMALISED_SEED_FALLBACK = ONE_SLOT

/**
 * Fold a validated safe integer seed into `[1, PRNG_MODULUS - 1]`.
 *
 * Zero is the generator's fixed point, so it maps to 1. Non-finite and
 * fractional seeds are rejected by `ParticlePoolOptionsSchema` before here.
 */
const normaliseSeed = (seed: number): number => {
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
 * The typed arrays are the ones the adapter reads. They are exposed
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
declare const particlePoolBrand: unique symbol

export type ParticleBuffer = Float32Array

export type ParticleLifetimeBuffer = Float64Array
export type ParticleTintBuffer = Float32Array

export type ParticlePool = {
  readonly [particlePoolBrand]: never
  readonly capacity: number
  /** `capacity * 3` floats: x, y, z per slot. */
  readonly positions: ParticleBuffer
  /** `capacity * 3` floats: x, y, z per slot, in m/s. */
  readonly velocities: ParticleBuffer
  /** `capacity` double values. Seconds remaining; zero means free. */
  readonly lifetimesSecs: ParticleLifetimeBuffer
  /** `capacity` double values. The lifetime assigned at spawn. */
  readonly initialLifetimesSecs: ParticleLifetimeBuffer
  /** `capacity` floats in [0, 1]. The lifetime fade, and zero for a free or hidden slot. */
  readonly scales: ParticleBuffer
  /** `capacity * 2` floats: the atlas tile origin this particle samples. */
  readonly uvOffsets: ParticleBuffer
  /** `capacity * 3` floats: per-instance RGB tint. */
  readonly colors: ParticleTintBuffer
  /** The world dimension each active slot belongs to. */
  readonly dimensions: Array<Dimension | undefined>
  /** Follow target IDs, cleared when a target disappears from its dimension. */
  readonly followEntityIds: Array<string | undefined>
  /** Live slots. Never exceeds `capacity`. */
  readonly activeCount: () => number
  /** The generator's current state. Diagnostics and determinism tests. */
  readonly seed: () => number
  /** Times a live particle was displaced because the pool was full. */
  readonly evictionCount: () => number
}

type ParticleState = {
  active: number
  seedState: number
  evictions: number
  nextSlot: number
  nextSpawnSequence: bigint
  readonly spawnSequences: Array<bigint>
  readonly followOffsets: Float32Array
  readonly followEntityIds: Array<string | undefined>
}
const particlePools = new WeakSet<object>()

const isKnownParticlePool = (pool: ParticlePool): pool is ParticlePoolImpl => particlePools.has(pool)

/** Construction-time options. Not on the frame path, so an object is fine here. */
export type ParticlePoolOptions = {
  /**
   * Slots. Defaults to `PARTICLE_POOL_CAPACITY`.
   *
   * Configurable ONLY so that eviction can be tested at a capacity a test can
   * reason about — filling 512 slots to observe one eviction is a test nobody
   * reads. Production has no reason to pass it.
   */
  readonly capacity?: number | undefined
  /** The generator's starting state. Defaults to `DEFAULT_PARTICLE_SEED`. */
  readonly seed?: number | undefined
}

export type ParticlePoolInputOperation =
  | 'pool'
  | 'spawn'
  | 'burst'
  | 'block-burst'
  | 'advance'
  | 'clear'
  | 'request'
  | 'render-context'

export type ParticlePoolInputReason =
  | 'invalid-options'
  | 'invalid-capacity'
  | 'invalid-seed'
  | 'invalid-pool'
  | 'invalid-spawn'
  | 'invalid-count'
  | 'invalid-position'
  | 'invalid-uv'
  | 'invalid-tile-index'
  | 'invalid-delta'
  | 'invalid-request'
  | 'invalid-frame'
  | 'render-context-failed'

export type ParticlePoolInputError = Readonly<{
  readonly _tag: 'ParticlePoolInputError'
  readonly operation: ParticlePoolInputOperation
  readonly reason: ParticlePoolInputReason
}>

export const ParticlePoolInputErrorSchema: Schema.Codec<ParticlePoolInputError> = Schema.Struct({
  _tag: Schema.Literal('ParticlePoolInputError'),
  operation: Schema.Literals([
    'pool',
    'spawn',
    'burst',
    'block-burst',
    'advance',
    'clear',
    'request',
    'render-context',
  ]),
  reason: Schema.Literals([
    'invalid-options',
    'invalid-capacity',
    'invalid-seed',
    'invalid-pool',
    'invalid-spawn',
    'invalid-count',
    'invalid-position',
    'invalid-uv',
    'invalid-tile-index',
    'invalid-delta',
    'invalid-request',
    'invalid-frame',
    'render-context-failed',
  ]),
})

export const ParticlePoolOptionsSchema: Schema.Codec<ParticlePoolOptions> = Schema.Struct({
  capacity: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: PARTICLE_POOL_CAPACITY, minimum: 1 })),
  ),
  seed: Schema.optional(Schema.Int.check(
    Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: Number.MIN_SAFE_INTEGER }),
  )),
})

const decodeParticlePoolOptions = (options: ParticlePoolOptions | undefined) => {
  const decode = Schema.decodeUnknownResult(ParticlePoolOptionsSchema, {
    onExcessProperty: 'error',
  })
  if (options === undefined) {
    return decode({})
  }
  return decode(options)
}

const particlePoolOptionsFailureReason = (
  options: ParticlePoolOptions | undefined,
): ParticlePoolInputReason => {
  const capacity = options?.capacity
  if (capacity !== undefined &&
    (!Number.isSafeInteger(capacity) || capacity < ONE_SLOT || capacity > PARTICLE_POOL_CAPACITY)) {
    return 'invalid-capacity'
  }
  const seed = options?.seed
  if (seed !== undefined && !Number.isSafeInteger(seed)) {
    return 'invalid-seed'
  }
  return 'invalid-options'
}

type ParticlePoolInputResultShape<Success> =
  | Readonly<{ readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: Success }>
  | Readonly<{ readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: ParticlePoolInputError }>

/** Decode Result values with `onExcessProperty: 'error'` to enforce exact envelopes. */
export const ParticlePoolInputResultSchema: Schema.Codec<ParticlePoolInputResultShape<unknown>> = Schema.Union([
  Schema.Struct({
    _op: Schema.Literal('Success'),
    _tag: Schema.Literal('Success'),
    success: Schema.Unknown,
  }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: ParticlePoolInputErrorSchema,
  }),
])

const particlePoolInputError = (
  operation: ParticlePoolInputOperation,
  reason: ParticlePoolInputReason,
): ParticlePoolInputError => ({ _tag: 'ParticlePoolInputError', operation, reason })


export type ParticleTint = Readonly<{
  readonly red: number
  readonly green: number
  readonly blue: number
}>

export type ParticleVelocityAxis = Brand.Branded<number, 'ParticleVelocityAxis'>

export type ParticleVelocity = Readonly<{
  readonly x: ParticleVelocityAxis
  readonly y: ParticleVelocityAxis
  readonly z: ParticleVelocityAxis
}>

export type ParticleFollowTarget = Readonly<{
  readonly id: string
  readonly feetPosition: Readonly<{
    readonly x: number
    readonly y: number
    readonly z: number
  }>
}>

export type ParticleFollowLink = Readonly<{
  readonly id: string
  readonly x: number
  readonly y: number
  readonly z: number
}>

export type ParticleUvCoordinate = Brand.Branded<number, 'ParticleUvCoordinate'>

export type ParticleBurstCount = Brand.Branded<number, 'ParticleBurstCount'>

export type ParticleTileIndex = Brand.Branded<number, 'ParticleTileIndex'>

export type ParticleSpawnSpec = Readonly<{
  readonly dimension: Dimension
  readonly positionX: PositionAxis
  readonly positionY: PositionAxis
  readonly positionZ: PositionAxis
  readonly uvU: ParticleUvCoordinate
  readonly uvV: ParticleUvCoordinate
  readonly tint: ParticleTint
  readonly lifetimeSecs: number
  readonly velocity?: ParticleVelocity | undefined
  readonly follow?: ParticleFollowLink | undefined
}>

export type ParticleSpawnSpecEncoded = Readonly<{
  readonly dimension: Dimension
  readonly positionX: number
  readonly positionY: number
  readonly positionZ: number
  readonly uvU: number
  readonly uvV: number
  readonly tint: ParticleTint
  readonly lifetimeSecs: number
  readonly velocity?: Readonly<{ readonly x: number; readonly y: number; readonly z: number }> | undefined
  readonly follow?: ParticleFollowLink | undefined
}>

export const ParticleWorldCoordinateSchema: Schema.Codec<PositionAxis, number> = Schema.Finite
  .check(Schema.isBetween({
    maximum: MAX_PARTICLE_WORLD_COORDINATE,
    minimum: -MAX_PARTICLE_WORLD_COORDINATE,
  }))
  .pipe(Schema.brand('PositionAxis'))

export const ParticleVelocityAxisSchema: Schema.Codec<ParticleVelocityAxis, number> = Schema.Finite
  .check(Schema.isBetween({
    maximum: MAX_PARTICLE_SPEED_M_PER_SECOND,
    minimum: -MAX_PARTICLE_SPEED_M_PER_SECOND,
  }))
  .pipe(Schema.brand('ParticleVelocityAxis'))

export const ParticleVelocitySchema: Schema.Codec<ParticleVelocity, Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
}>> = Schema.Struct({
  x: ParticleVelocityAxisSchema,
  y: ParticleVelocityAxisSchema,
  z: ParticleVelocityAxisSchema,
}).check(Schema.makeFilter<ParticleVelocity>((velocity) =>
  Math.hypot(velocity.x, velocity.y, velocity.z) <= MAX_PARTICLE_SPEED_M_PER_SECOND ||
    'Particle speed must stay within the supported limit'
))

const ParticleFollowOffsetSchema = Schema.Finite.check(Schema.isBetween({
  maximum: MAX_PARTICLE_FOLLOW_OFFSET,
  minimum: -MAX_PARTICLE_FOLLOW_OFFSET,
}))

export const ParticleUvCoordinateSchema: Schema.Codec<ParticleUvCoordinate, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: UNIT_INTERVAL_MAXIMUM - TILE_UV_SPAN, minimum: ZERO }))
  .pipe(Schema.brand('ParticleUvCoordinate'))

const ParticleTintSchema = Schema.Struct({
  blue: Schema.Finite.check(Schema.isBetween({ maximum: UNIT_INTERVAL_MAXIMUM, minimum: ZERO })),
  green: Schema.Finite.check(Schema.isBetween({ maximum: UNIT_INTERVAL_MAXIMUM, minimum: ZERO })),
  red: Schema.Finite.check(Schema.isBetween({ maximum: UNIT_INTERVAL_MAXIMUM, minimum: ZERO })),
})

const ParticleFollowLinkSchema = Schema.Struct({
  id: Schema.String,
  x: ParticleFollowOffsetSchema,
  y: ParticleFollowOffsetSchema,
  z: ParticleFollowOffsetSchema,
})

export const ParticleSpawnSpecSchema: Schema.Codec<ParticleSpawnSpec, ParticleSpawnSpecEncoded> = Schema.Struct({
  dimension: Schema.Literals(['overworld', 'nether', 'end']),
  follow: Schema.optional(ParticleFollowLinkSchema),
  lifetimeSecs: Schema.Finite.check(Schema.isBetween({
    maximum: MAX_PARTICLE_LIFETIME_SECS,
    minimum: Number.MIN_VALUE,
  })),
  positionX: ParticleWorldCoordinateSchema,
  positionY: ParticleWorldCoordinateSchema,
  positionZ: ParticleWorldCoordinateSchema,
  tint: ParticleTintSchema,
  uvU: ParticleUvCoordinateSchema,
  uvV: ParticleUvCoordinateSchema,
  velocity: Schema.optional(ParticleVelocitySchema),
}).check(Schema.makeFilter<ParticleSpawnSpec>((spawn) => {
  const { follow } = spawn
  if (follow === undefined) {
    return true
  }
  return Math.abs(spawn.positionX - follow.x) <= MAX_PARTICLE_FOLLOW_OFFSET &&
    Math.abs(spawn.positionY - follow.y) <= MAX_PARTICLE_FOLLOW_OFFSET &&
    Math.abs(spawn.positionZ - follow.z) <= MAX_PARTICLE_FOLLOW_OFFSET ||
    'Follow offsets must stay within the supported world range'
}))

export const ParticleBurstCountSchema: Schema.Codec<ParticleBurstCount, number> = Schema.Int
  .check(Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: ONE_SLOT }))
  .pipe(Schema.brand('ParticleBurstCount'))

const ParticlePositionSchema = Schema.Struct({
  x: ParticleWorldCoordinateSchema,
  y: ParticleWorldCoordinateSchema,
  z: ParticleWorldCoordinateSchema,
})

const ParticleUvSchema = Schema.Struct({
  u: ParticleUvCoordinateSchema,
  v: ParticleUvCoordinateSchema,
})

const ParticleBurstInputSchema = Schema.Struct({
  count: ParticleBurstCountSchema,
  position: ParticlePositionSchema,
  uv: ParticleUvSchema,
})

export const ParticleDeltaSecsSchema: Schema.Codec<DeltaTimeSecs, number> = Schema.Finite
  .check(Schema.isGreaterThanOrEqualTo(ZERO))
  .pipe(Schema.brand('DeltaTimeSecs'))

export const ParticleTileIndexSchema: Schema.Codec<ParticleTileIndex, number> = Schema.Int
  .check(Schema.isBetween({ maximum: ATLAS_TILE_COUNT - ONE_SLOT, minimum: ZERO }))
  .pipe(Schema.brand('ParticleTileIndex'))

const decodeBlockBurstUv = (tileIndex: ParticleTileIndex) => {
  const decodedTileIndex = Schema.decodeUnknownResult(ParticleTileIndexSchema)(tileIndex)
  if (Result.isFailure(decodedTileIndex)) {
    return Result.fail(particlePoolInputError('block-burst', 'invalid-tile-index'))
  }

  const origin = tileUvOrigin(decodedTileIndex.success)
  const decodedOrigin = Schema.decodeUnknownResult(ParticleUvSchema, { onExcessProperty: 'error' })(origin)
  if (Result.isFailure(decodedOrigin)) {
    return Result.fail(particlePoolInputError('block-burst', 'invalid-uv'))
  }
  return Result.succeed(decodedOrigin.success)
}

export type ParticleFrameSnapshot = Readonly<{
  readonly dimension: Dimension
  readonly entities: ReadonlyArray<ParticleFollowTarget>
}>

export const ParticleFrameSnapshotSchema: Schema.Codec<ParticleFrameSnapshot> = Schema.Struct({
  dimension: Schema.Literals(['overworld', 'nether', 'end']),
  entities: Schema.Array(Schema.Struct({
    feetPosition: Schema.Struct({
      x: ParticleWorldCoordinateSchema,
      y: ParticleWorldCoordinateSchema,
      z: ParticleWorldCoordinateSchema,
    }),
    id: Schema.String,
  })),
})

export const DEFAULT_PARTICLE_TINT: ParticleTint = { blue: 1, green: 1, red: 1 }

/**
 * Read a float at an index constructed by the pool's bounded loops.
 *
 * The opaque pool constructor guarantees the index exists. Number preserves a
 * numeric return type under noUncheckedIndexedAccess without a per-read branch
 * or allocation.
 */
const readFloat = (buffer: ArrayLike<number>, index: number): number =>
  Number(buffer[index])

/**
 * Allocate a pool. The only function here that allocates persistent buffers.
 *
 * Allocate the pool buffers and one state object once. Particle state after
 * construction stays in those buffers and private pool state.
 */
type ParticlePoolBuffers = Pick<
  ParticlePool,
  | 'capacity'
  | 'colors'
  | 'dimensions'
  | 'followEntityIds'
  | 'initialLifetimesSecs'
  | 'lifetimesSecs'
  | 'positions'
  | 'scales'
  | 'uvOffsets'
  | 'velocities'
>

const particlePoolBuffersFor = (capacity: number): ParticlePoolBuffers => ({
  capacity,
  colors: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
  dimensions: new Array<Dimension | undefined>(capacity),
  followEntityIds: new Array<string | undefined>(capacity),
  initialLifetimesSecs: new Float64Array(capacity),
  lifetimesSecs: new Float64Array(capacity),
  positions: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
  scales: new Float32Array(capacity),
  uvOffsets: new Float32Array(capacity * PARTICLE_UV_STRIDE),
  velocities: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
})

class ParticlePoolImpl implements ParticlePool {
  #state: ParticleState
  declare readonly [particlePoolBrand]: never
  declare readonly capacity: number
  declare readonly positions: ParticleBuffer
  declare readonly velocities: ParticleBuffer
  declare readonly lifetimesSecs: ParticleLifetimeBuffer
  declare readonly initialLifetimesSecs: ParticleLifetimeBuffer
  declare readonly scales: ParticleBuffer
  declare readonly uvOffsets: ParticleBuffer
  declare readonly colors: ParticleTintBuffer
  declare readonly dimensions: Array<Dimension | undefined>
  declare readonly followEntityIds: Array<string | undefined>
  readonly activeCount = (): number => this.#state.active
  readonly seed = (): number => this.#state.seedState
  readonly evictionCount = (): number => this.#state.evictions

  static stateFor(pool: ParticlePoolImpl): ParticleState {
    return pool.#state
  }

  constructor(options: ParticlePoolOptions | undefined, capacity: number) {
    Object.assign(this, particlePoolBuffersFor(capacity))
    this.#state = {
      active: 0,
      evictions: 0,
      followEntityIds: this.followEntityIds,
      followOffsets: new Float32Array(capacity * PARTICLE_VECTOR_STRIDE),
      nextSlot: 0,
      nextSpawnSequence: INITIAL_SPAWN_SEQUENCE,
      seedState: normaliseSeed(options?.seed ?? DEFAULT_PARTICLE_SEED),
      spawnSequences: Array.from({ length: capacity }, () => INITIAL_SPAWN_SEQUENCE),
    }
    particlePools.add(this)
  }
}

const poolState = (pool: ParticlePoolImpl): ParticleState => ParticlePoolImpl.stateFor(pool)

export const makeParticlePool = (
  options?: ParticlePoolOptions,
): Result.Result<ParticlePool, ParticlePoolInputError> => {
  const decoded = decodeParticlePoolOptions(options)
  if (Result.isFailure(decoded)) {
    return Result.fail(particlePoolInputError('pool', particlePoolOptionsFailureReason(options)))
  }

  const capacity = decoded.success.capacity ?? PARTICLE_POOL_CAPACITY
  return Result.succeed(new ParticlePoolImpl(decoded.success, capacity))
}

/**
 * Draw the next value in `[0, 1)` and advance the pool's generator.
 *
 * `(state - 1) / MODULUS` rather than `state / MODULUS`, matching frame-rolls:
 * the latter never yields 0, and dividing by `MODULUS - 1` instead would yield
 * exactly 1 on the largest state — outside the half-open interval every caller
 * assumes.
 */
const nextUnitRoll = (pool: ParticlePoolImpl): number => {
  const state = (PRNG_MULTIPLIER * normaliseSeed(poolState(pool).seedState)) % PRNG_MODULUS
  poolState(pool).seedState = state
  return (state - PRNG_OUTPUT_OFFSET) / PRNG_MODULUS
}

/** Draw uniformly from `[min, max)`. */
const nextInRange = (pool: ParticlePoolImpl, min: number, max: number): number =>
  min + nextUnitRoll(pool) * (max - min)

/**
 * The live slot that will die soonest, which is the one spawned longest ago.
 *
 * Linear over fixed pool capacity; the scan only runs when the pool is
 * saturated.
 *
 * Ties go to the lowest slot index — `<` rather than `<=` — so a saturated pool
 * evicts deterministically. Returns 0 when no slot is live, which cannot happen
 * on the only path that calls it and is the inert answer if it ever does.
 */
const findOldestSlot = (pool: ParticlePoolImpl): number => {
  let oldest = 0
  let oldestSequence: bigint | undefined = undefined

  for (let slot = 0; slot < pool.capacity; slot += ONE_SLOT) {
    if (!(readFloat(pool.lifetimesSecs, slot) <= ZERO)) {
      // Each live slot was written through writeParticle, and the private sequence
      // Array is allocated to the pool capacity. String keeps BigInt's fail-closed
      // Error for missing metadata without a type assertion.
      const sequence = BigInt(String(poolState(pool).spawnSequences[slot]))
      if (oldestSequence === undefined || sequence < oldestSequence) {
        oldestSequence = sequence
        oldest = slot
      }
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
const acquireSlot = (pool: ParticlePoolImpl): number => {
  if (poolState(pool).active < pool.capacity) {
    for (let step = 0; step < pool.capacity; step += ONE_SLOT) {
      const candidate = (poolState(pool).nextSlot + step) % pool.capacity
      if (readFloat(pool.lifetimesSecs, candidate) === ZERO) {
        poolState(pool).nextSlot = (candidate + ONE_SLOT) % pool.capacity
        poolState(pool).active += 1
        return candidate
      }
    }
  }

  /*
   * Saturated. Reuse the oldest live slot: `active` does not change, because
   * one particle replaced another rather than joining it.
   */
  poolState(pool).evictions += 1
  return findOldestSlot(pool)
}

/** Offset of the second component (y, or v) within a stride-3 or stride-2 buffer entry. */
const SECOND_COMPONENT_OFFSET = 1

/** Offset of the third component (z) within a stride-3 buffer entry. */
const THIRD_COMPONENT_OFFSET = 2

/**
 * Position write for one particle. Positional params, not an options object:
 * this runs once per spawned particle on the frame path (see `spawnBurst`'s
 * doc comment), and an object per particle is the allocation this file exists
 * to avoid.
 */
const writeParticlePosition = (
  internals: ParticlePoolImpl,
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
const writeParticleVelocity = (
  internals: ParticlePoolImpl,
  vectorBase: number,
  velocity?: ParticleVelocity | undefined,
): void => {
  if (velocity !== undefined) {
    internals.velocities[vectorBase] = velocity.x
    internals.velocities[vectorBase + SECOND_COMPONENT_OFFSET] = velocity.y
    internals.velocities[vectorBase + THIRD_COMPONENT_OFFSET] = velocity.z
    return
  }

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

const followOffset = (position: number, targetPosition: number | undefined): number => {
  if (targetPosition === undefined) {
    return ZERO
  }
  return position - targetPosition
}

const writeParticleUvOffset = (internals: ParticlePoolImpl, slot: number, spawn: ParticleSpawnSpec): void => {
  const uvBase = slot * PARTICLE_UV_STRIDE
  internals.uvOffsets[uvBase] = spawn.uvU
  internals.uvOffsets[uvBase + SECOND_COMPONENT_OFFSET] = spawn.uvV
}

const writeParticleColor = (internals: ParticlePoolImpl, slot: number, spawn: ParticleSpawnSpec): void => {
  const colorBase = slot * PARTICLE_COLOR_STRIDE
  internals.colors[colorBase] = spawn.tint.red
  internals.colors[colorBase + SECOND_COMPONENT_OFFSET] = spawn.tint.green
  internals.colors[colorBase + THIRD_COMPONENT_OFFSET] = spawn.tint.blue
}

const writeParticleFollow = (internals: ParticlePoolImpl, slot: number, spawn: ParticleSpawnSpec): void => {
  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  const state = poolState(internals)
  const { follow } = spawn
  internals.dimensions[slot] = spawn.dimension
  internals.followEntityIds[slot] = follow?.id
  state.followOffsets[vectorBase] = followOffset(spawn.positionX, follow?.x)
  state.followOffsets[vectorBase + SECOND_COMPONENT_OFFSET] =
    followOffset(spawn.positionY, follow?.y)
  state.followOffsets[vectorBase + THIRD_COMPONENT_OFFSET] =
    followOffset(spawn.positionZ, follow?.z)
}

const writeParticleLifetime = (internals: ParticlePoolImpl, slot: number, spawn: ParticleSpawnSpec): void => {
  const state = poolState(internals)
  internals.lifetimesSecs[slot] = spawn.lifetimeSecs
  internals.initialLifetimesSecs[slot] = spawn.lifetimeSecs
  state.nextSpawnSequence += 1n
  state.spawnSequences[slot] = state.nextSpawnSequence
  /*
   * Full scale immediately, so the particle is visible in this frame before
   * the first call to `advanceParticles`.
   */
  internals.scales[slot] = 1
}

/**
 * One particle's writes into `internals`' buffers at `slot`. The helpers use
 * positional params rather than an options object: this runs once per spawned
 * particle on the frame path (see `spawnBurst`'s doc comment for why that rules
 * out an allocating options object here too).
 */
const writeParticle = (internals: ParticlePoolImpl, slot: number, spawn: ParticleSpawnSpec): void => {
  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  writeParticlePosition(internals, vectorBase, spawn.positionX, spawn.positionY, spawn.positionZ)
  writeParticleVelocity(internals, vectorBase, spawn.velocity)
  writeParticleUvOffset(internals, slot, spawn)
  writeParticleColor(internals, slot, spawn)
  writeParticleFollow(internals, slot, spawn)
  writeParticleLifetime(internals, slot, spawn)
}

const spawnValidatedParticle = (pool: ParticlePoolImpl, spawn: ParticleSpawnSpec): void => {
  const slot = acquireSlot(pool)
  writeParticle(pool, slot, spawn)
}

const isParticleWorldCoordinateVector = (x: number, y: number, z: number): boolean =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
  Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= MAX_PARTICLE_WORLD_COORDINATE

const isParticleSpeedVector = (x: number, y: number, z: number): boolean =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
  Math.hypot(x, y, z) <= MAX_PARTICLE_SPEED_M_PER_SECOND

const particleBurstFailureReason = (
  count: number,
  positionX: number,
  positionY: number,
  positionZ: number,
): ParticlePoolInputReason => {
  if (!Number.isSafeInteger(count) || count < ONE_SLOT) {
    return 'invalid-count'
  }
  if (!isParticleWorldCoordinateVector(positionX, positionY, positionZ)) {
    return 'invalid-position'
  }
  return 'invalid-uv'
}

export const spawnParticle = (
  pool: ParticlePool,
  spawn: ParticleSpawnSpecEncoded,
): Result.Result<boolean, ParticlePoolInputError> => {
  if (!isKnownParticlePool(pool)) {
    return Result.fail(particlePoolInputError('spawn', 'invalid-pool'))
  }

  const decoded = Schema.decodeUnknownResult(ParticleSpawnSpecSchema, {
    onExcessProperty: 'error',
  })(spawn)
  if (Result.isFailure(decoded)) {
    return Result.fail(particlePoolInputError('spawn', 'invalid-spawn'))
  }

  spawnValidatedParticle(pool, decoded.success)
  return Result.succeed(true)
}

/**
 * The spawn loop itself. Seven positional params for the same reason as
 * `writeParticle`: this is the frame-path body, not a call site an options
 * object would meaningfully clarify.
 */
const spawnRequestedParticles = (
  internals: ParticlePoolImpl,
  requested: number,
  positionX: PositionAxis,
  positionY: PositionAxis,
  positionZ: PositionAxis,
  safeU: ParticleUvCoordinate,
  safeV: ParticleUvCoordinate,
): void => {
  const spawn: ParticleSpawnSpec = {
    dimension: 'overworld',
    lifetimeSecs: PARTICLE_LIFETIME_SECS,
    positionX,
    positionY,
    positionZ,
    tint: DEFAULT_PARTICLE_TINT,
    uvU: safeU,
    uvV: safeV,
  }

  for (let spawned = 0; spawned < requested; spawned += ONE_SLOT) {
    spawnValidatedParticle(internals, spawn)
  }
}

/**
 * Spawn a burst at a point without per-particle allocation. The public Result
 * is one tagged value per burst.
 *
 * Positional arguments rather than a `BurstSpawn` object keep the call site
 * allocation-free. Invalid input is returned as a typed failure rather than
 * normalized into a successful no-op.
 *
 * `uvU` / `uvV` are an atlas tile origin; `spawnBlockBurst` below is the
 * convenience that turns a tile index into one.
 *
 * Returns a typed input failure for invalid count, position or UV values, or
 * the number of particles spawned for a valid request. Oversized valid counts
 * are capped at pool capacity so the result describes particles left alive.
 */
export const spawnBurst = (
  pool: ParticlePool,
  positionX: PositionAxis,
  positionY: PositionAxis,
  positionZ: PositionAxis,
  uvU: ParticleUvCoordinate,
  uvV: ParticleUvCoordinate,
  count?: ParticleBurstCount,
): Result.Result<number, ParticlePoolInputError> => {
  if (!isKnownParticlePool(pool)) {
    return Result.fail(particlePoolInputError('burst', 'invalid-pool'))
  }

  const countValue = count ?? DEFAULT_BURST_PARTICLES
  const decoded = Schema.decodeUnknownResult(ParticleBurstInputSchema, {
    onExcessProperty: 'error',
  })({
    count: countValue,
    position: { x: positionX, y: positionY, z: positionZ },
    uv: { u: uvU, v: uvV },
  })
  if (Result.isFailure(decoded)) {
    return Result.fail(particlePoolInputError(
      'burst',
      particleBurstFailureReason(countValue, positionX, positionY, positionZ),
    ))
  }

  const requested = Math.min(decoded.success.count, pool.capacity)
  spawnRequestedParticles(
    pool,
    requested,
    decoded.success.position.x,
    decoded.success.position.y,
    decoded.success.position.z,
    decoded.success.uv.u,
    decoded.success.uv.v,
  )
  return Result.succeed(requested)
}

/**
 * Spawn a burst that samples one atlas tile.
 *
 * The convenience over `spawnBurst`, and the only place particle code touches
 * the atlas. It allocates one `UvOrigin` per burst — per BLOCK HIT, not per
 * frame and not per particle — which is the boundary this file draws: the
 * per-particle loop allocates nothing, while an input event may allocate a small
 * constant amount.
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
  positionX: PositionAxis,
  positionY: PositionAxis,
  positionZ: PositionAxis,
  tileIndex: ParticleTileIndex,
  count?: ParticleBurstCount,
): Result.Result<number, ParticlePoolInputError> => {
  if (!isKnownParticlePool(pool)) {
    return Result.fail(particlePoolInputError('block-burst', 'invalid-pool'))
  }

  const decodedOrigin = decodeBlockBurstUv(tileIndex)
  if (Result.isFailure(decodedOrigin)) {
    return Result.fail(decodedOrigin.failure)
  }
  const result = spawnBurst(
    pool,
    positionX,
    positionY,
    positionZ,
    decodedOrigin.success.u,
    decodedOrigin.success.v,
    count,
  )
  if (Result.isFailure(result)) {
    return Result.fail({ ...result.failure, operation: 'block-burst' })
  }
  return result
}

/**
 * Freeing a slot is exactly these two writes: zero lifetime marks it
 * available, zero scale makes it draw nothing. Position and velocity are
 * left alone because the next spawn overwrites both, and clearing them
 * would be six writes per expiry that nothing reads.
 */
const expireSlot = (internals: ParticlePoolImpl, slot: number): void => {
  internals.lifetimesSecs[slot] = 0
  internals.initialLifetimesSecs[slot] = 0
  internals.scales[slot] = 0
  internals.followEntityIds[slot] = undefined
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
const integrateFreeParticlePosition = (internals: ParticlePoolImpl, slot: number, dt: number): boolean => {
  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  const nextVelocityY =
    readFloat(internals.velocities, vectorBase + SECOND_COMPONENT_OFFSET) - PARTICLE_GRAVITY_M_PER_S2 * dt
  const nextPositionX =
    readFloat(internals.positions, vectorBase) + readFloat(internals.velocities, vectorBase) * dt
  const nextPositionY =
    readFloat(internals.positions, vectorBase + SECOND_COMPONENT_OFFSET) + nextVelocityY * dt
  const nextPositionZ =
    readFloat(internals.positions, vectorBase + THIRD_COMPONENT_OFFSET) +
      readFloat(internals.velocities, vectorBase + THIRD_COMPONENT_OFFSET) * dt

  if (
    !isParticleSpeedVector(
      readFloat(internals.velocities, vectorBase),
      nextVelocityY,
      readFloat(internals.velocities, vectorBase + THIRD_COMPONENT_OFFSET),
    ) ||
    !isParticleWorldCoordinateVector(nextPositionX, nextPositionY, nextPositionZ)
  ) {
    return false
  }

  internals.velocities[vectorBase + SECOND_COMPONENT_OFFSET] = nextVelocityY
  writeParticlePosition(internals, vectorBase, nextPositionX, nextPositionY, nextPositionZ)
  return true
}

const integrateSlot = (
  internals: ParticlePoolImpl,
  slot: number,
  nextRemaining: number,
  dt: number,
  followed: boolean,
  visible: boolean,
): boolean => {
  internals.lifetimesSecs[slot] = nextRemaining

  if (!followed && !integrateFreeParticlePosition(internals, slot, dt)) {
    expireSlot(internals, slot)
    return true
  }

  if (visible) {
    internals.scales[slot] = nextRemaining / readFloat(internals.initialLifetimesSecs, slot)
  } else {
    internals.scales[slot] = ZERO
  }
  return false
}

const updatePositionFromFollowEntity = (
  internals: ParticlePoolImpl,
  slot: number,
  entity: ParticleFollowTarget,
): boolean => {
  const vectorBase = slot * PARTICLE_VECTOR_STRIDE
  const offset = poolState(internals).followOffsets
  const nextX = entity.feetPosition.x + readFloat(offset, vectorBase)
  const nextY = entity.feetPosition.y + readFloat(offset, vectorBase + SECOND_COMPONENT_OFFSET)
  const nextZ = entity.feetPosition.z + readFloat(offset, vectorBase + THIRD_COMPONENT_OFFSET)

  if (!isParticleWorldCoordinateVector(nextX, nextY, nextZ)) {
    return false
  }

  writeParticlePosition(internals, vectorBase, nextX, nextY, nextZ)
  return true
}

const findFollowEntity = (
  entities: ReadonlyArray<ParticleFollowTarget>,
  followId: string,
): ParticleFollowTarget | undefined => {
  for (const entity of entities) {
    if (entity.id === followId) {
      return entity
    }
  }
  return undefined
}

const updateFollowedPosition = (
  internals: ParticlePoolImpl,
  slot: number,
  entity: ParticleFollowTarget,
): 'followed' | 'expired' => {
  if (!updatePositionFromFollowEntity(internals, slot, entity)) {
    return 'expired'
  }
  return 'followed'
}

const updateFollowPosition = (
  internals: ParticlePoolImpl,
  slot: number,
  frame: ParticleFrameSnapshot | undefined,
): 'free' | 'followed' | 'expired' => {
  const followId = internals.followEntityIds[slot]
  if (
    followId === undefined ||
    frame === undefined ||
    internals.dimensions[slot] !== frame.dimension
  ) {
    if (followId === undefined) {
      return 'free'
    }
    return 'followed'
  }

  const entity = findFollowEntity(frame.entities, followId)
  if (entity === undefined) {
    internals.followEntityIds[slot] = undefined
    return 'followed'
  }
  return updateFollowedPosition(internals, slot, entity)
}

const advanceLiveSlot = (
  internals: ParticlePoolImpl,
  slot: number,
  remaining: number,
  dt: number,
  frame: ParticleFrameSnapshot | undefined,
): boolean => {
  const nextRemaining = remaining - dt
  if (nextRemaining <= ZERO) {
    expireSlot(internals, slot)
    return true
  }

  const followPosition = updateFollowPosition(internals, slot, frame)
  if (followPosition === 'expired') {
    expireSlot(internals, slot)
    return true
  }
  const visible = frame === undefined || internals.dimensions[slot] === frame.dimension
  return integrateSlot(internals, slot, nextRemaining, dt, followPosition === 'followed', visible)
}

/**
 * Advance one slot by `dt`. Returns whether the slot expired during this step.
 *
 * Extracted from `advanceParticles` so the per-slot early-outs (an inactive
 * slot, an expiring slot) are ordinary returns rather than loop `continue`s.
 */
const advanceSlot = (
  internals: ParticlePoolImpl,
  slot: number,
  dt: number,
  frame?: ParticleFrameSnapshot | undefined,
): boolean => {
  const remaining = readFloat(internals.lifetimesSecs, slot)
  if (remaining <= ZERO) {
    return false
  }
  return advanceLiveSlot(internals, slot, remaining, dt, frame)
}

const advanceKnownPool = (
  pool: ParticlePoolImpl,
  dt: number,
  frame: ParticleFrameSnapshot | undefined,
): number => {
  let expired = ZERO
  for (let slot = 0; slot < pool.capacity; slot += ONE_SLOT) {
    if (advanceSlot(pool, slot, dt, frame)) {
      expired += ONE_SLOT
    }
  }
  const state = poolState(pool)
  state.active = Math.max(ZERO, state.active - expired)
  return expired
}

/**
 * Integrate one frame without per-slot allocation.
 *
 * Returns the number of particles that expired during this step, which is what
 * a caller needs to decide whether the mesh's instance buffer must be re-uploaded
 * and is the success value of the typed Result.
 *
 * Finite `dtSecs` is clamped to `[0, MAX_PARTICLE_STEP_SECS]`. Invalid deltas
 * return a typed failure and leave the pool untouched. That is a divergence
 * from the reference, whose
 * clamp is `Math.max(0, Math.min(dtSecs, 0.1))` (particle-system.ts:166) —
 * `Math.min(NaN, 0.1)` is NaN and `Math.max(0, NaN)` is NaN, so a single
 * non-finite frame delta writes NaN into every live particle's position and
 * velocity and the pool never recovers. A bad delta is an input error rather
 * than a request to freeze the simulation silently.
 */
export const advanceParticles = (
  pool: ParticlePool,
  dtSecs: DeltaTimeSecs,
  frame?: ParticleFrameSnapshot | undefined,
): Result.Result<number, ParticlePoolInputError> => {
  if (!isKnownParticlePool(pool)) {
    return Result.fail(particlePoolInputError('advance', 'invalid-pool'))
  }

  const decodedDelta = Schema.decodeUnknownResult(ParticleDeltaSecsSchema)(dtSecs)
  if (Result.isFailure(decodedDelta)) {
    return Result.fail(particlePoolInputError('advance', 'invalid-delta'))
  }
  const dt = Math.min(decodedDelta.success, MAX_PARTICLE_STEP_SECS)
  return Result.succeed(advanceKnownPool(pool, dt, frame))
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
export const visibleParticleCount = (pool: ParticlePool): number => {
  for (let slot = pool.capacity - ONE_SLOT; slot >= ZERO; slot -= ONE_SLOT) {
    if (readFloat(pool.scales, slot) > ZERO) {
      return slot + ONE_SLOT
    }
  }
  return ZERO
}

const clearParticleState = (pool: ParticlePoolImpl): void => {
  const state = poolState(pool)
  state.spawnSequences.fill(INITIAL_SPAWN_SEQUENCE)
  state.followOffsets.fill(ZERO)
  state.active = ZERO
  state.nextSlot = ZERO
  state.nextSpawnSequence = INITIAL_SPAWN_SEQUENCE
}

export const clearParticles = (pool: ParticlePool): Result.Result<void, ParticlePoolInputError> => {
  if (!isKnownParticlePool(pool)) {
    return Result.fail(particlePoolInputError('clear', 'invalid-pool'))
  }

  pool.lifetimesSecs.fill(ZERO)
  pool.initialLifetimesSecs.fill(ZERO)
  pool.scales.fill(ZERO)
  pool.colors.fill(ZERO)
  pool.dimensions.fill(undefined)
  pool.followEntityIds.fill(undefined)
  clearParticleState(pool)
  return Result.succeed(undefined)
}

/** True when `slot` holds a live particle. */
export const isSlotActive = (pool: ParticlePool, slot: number): boolean =>
  Number.isInteger(slot) && slot >= ZERO && slot < pool.capacity && readFloat(pool.lifetimesSecs, slot) > ZERO

/** One particle, as a value. */
export type ParticleSlotState = {
  readonly dimension: Dimension | undefined
  readonly positionX: number
  readonly positionY: number
  readonly positionZ: number
  readonly velocityX: number
  readonly velocityY: number
  readonly velocityZ: number
  readonly remainingSecs: number
  readonly initialLifetimeSecs: number
  readonly scale: number
  readonly uvU: number
  readonly uvV: number
  readonly colorRed: number
  readonly colorGreen: number
  readonly colorBlue: number
  readonly followEntity: string | undefined
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
  const colorBase = slot * PARTICLE_COLOR_STRIDE

  return {
    colorBlue: readFloat(pool.colors, colorBase + THIRD_COMPONENT_OFFSET),
    colorGreen: readFloat(pool.colors, colorBase + SECOND_COMPONENT_OFFSET),
    colorRed: readFloat(pool.colors, colorBase),
    dimension: pool.dimensions[slot],
    followEntity: pool.followEntityIds[slot],
    initialLifetimeSecs: readFloat(pool.initialLifetimesSecs, slot),
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
