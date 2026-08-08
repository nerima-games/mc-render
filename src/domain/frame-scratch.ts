/**
 * Per-frame scratch buffers: allocate once, reuse forever.
 *
 * ---------------------------------------------------------------------------
 * plan.md §3.9 / §5.2
 * ---------------------------------------------------------------------------
 *
 *   フレーム毎の一時 `Map` は事前確保して再利用(GC回避)
 *
 * and, in the list of measured performance exceptions that must NOT be
 * "corrected" into idiomatic Effect (§5.2):
 *
 *   フレーム毎の事前確保 `Map` バッファ(§3.9)
 *
 * The reference reaches the same conclusion repeatedly, in its own words:
 *
 *   ts-minecraft/packages/rendering/infrastructure/entity/entity-renderer.ts:35-38
 *     // FR-2.5: per-frame scratch matrices. Constructing THREE.Matrix4 /
 *     // Quaternion / Euler objects in the hot loop produces measurable GC
 *     // pressure (one frame touches 6 roles × N mobs). Allocate once per
 *     // service instance and reuse.
 *
 *   ts-minecraft/packages/rendering/infrastructure/renderer/world-renderer.ts:52-58
 *     // ... pose into this reusable scratch (no allocation); on a cache miss
 *     // the two objects are swapped so the scratch becomes the new "last" and
 *     // the old "last" is recycled as the next scratch — zero allocation, zero
 *     // field copy on either path.
 *     // Pre-allocated objects for frustum culling and refraction pre-pass —
 *     // reused every frame to avoid GC pressure
 *
 *   ts-minecraft/packages/rendering/infrastructure/renderer/world-renderer-refraction-ratio.ts:4
 *     // FR-4.4: pre-allocated scratch for AABB projection — reused across
 *     // frames to avoid GC pressure
 *
 * ---------------------------------------------------------------------------
 * Why a `Map` and not a `HashMap`
 * ---------------------------------------------------------------------------
 *
 * This is deliberately NOT idiomatic Effect, and the deviation is sanctioned by
 * plan.md §5.2 alongside meshing's native `Set` (§3.3) and noise's `let` + `for`
 * octave loop (§3.2). A persistent `HashMap` allocates on every insert by
 * design — that is what makes it persistent. At 60 Hz over the chunk set, that
 * is thousands of allocations per second whose only purpose is to be discarded
 * before the next frame. The resulting garbage collection appears to the player
 * as periodic hitching, which is exactly what plan.md §3.9's other note
 * (`forceSinglePass`, p95 33ms -> 9.2ms) was also about.
 *
 * A pre-allocated native `Map` that is CLEARED rather than replaced allocates
 * nothing steady-state. `Map.clear()` keeps the bucket array.
 *
 * ---------------------------------------------------------------------------
 * The contract, and why it is enforced rather than documented
 * ---------------------------------------------------------------------------
 *
 * A reused mutable buffer is only safe under one rule: NOTHING MAY HOLD A
 * REFERENCE TO IT ACROSS A FRAME BOUNDARY. A consumer that keeps the map sees
 * it silently emptied and refilled with next frame's data — a bug that
 * reproduces only under specific timing and is close to impossible to find by
 * reading.
 *
 * `withScratch` below is the safe way to use one: the buffer is cleared before
 * the callback, and the callback's return value must not be the buffer itself.
 * `borrowedCount` tracks re-entrancy, which is the other way this goes wrong —
 * two nested users of the same buffer clobber each other.
 */

/**
 * A reusable keyed buffer.
 *
 * Generic over key and value so the same mechanism serves the per-frame chunk
 * visibility set, the entity instance map, and the light-update queue.
 */
export type ScratchMap<K, V> = {
  readonly name: string
  /** The live buffer. Valid ONLY inside a `withScratch` callback. */
  readonly buffer: Map<K, V>
  /** Frames this buffer has served. Never resets; diagnostics only. */
  readonly usageCount: () => number
  /** Nesting depth. Greater than 1 means two users are clobbering each other. */
  readonly borrowedCount: () => number
}

export type ScratchViolation = {
  readonly rule: 're-entrant-borrow' | 'escaped-buffer'
  readonly message: string
}

export class ScratchMisuseError extends Error {
  readonly violation: ScratchViolation

  constructor(violation: ScratchViolation) {
    super(violation.message)
    this.name = 'ScratchMisuseError'
    this.violation = violation
  }
}

/**
 * Borrow bookkeeping, deliberately absent from the public `ScratchMap` type.
 *
 * Only `withScratch` may drive it, which is what guarantees that a borrow
 * cannot happen without the clear that goes with it.
 */
type ScratchLease = {
  readonly enter: () => void
  readonly exit: () => void
}

type LeasedScratchMap<K, V> = ScratchMap<K, V> & { readonly lease: ScratchLease }

/**
 * Create a scratch buffer.
 *
 * `initialCapacity` is accepted and deliberately unused for sizing: JavaScript
 * `Map` has no capacity hint. It is recorded in the name so that a profiler
 * trace says which buffer is growing, which is the actionable signal — a buffer
 * that keeps rehashing has outgrown its intended contents and should be split.
 */
export const makeScratchMap = <K, V>(name: string, initialCapacity?: number): ScratchMap<K, V> => {
  const buffer = new Map<K, V>()
  let usage = 0
  let borrowed = 0

  const leased: LeasedScratchMap<K, V> = {
    borrowedCount: () => borrowed,
    buffer,
    lease: {
      enter: () => {
        usage += 1
        borrowed += 1
      },
      exit: () => {
        borrowed -= 1
      },
    },
    name: initialCapacity === undefined ? name : `${name}[~${String(initialCapacity)}]`,
    usageCount: () => usage,
  }

  return leased
}

/**
 * Borrow a scratch buffer for the duration of one operation.
 *
 * The buffer is cleared on entry, not on exit: a caller debugging a frame can
 * inspect the contents after the fact, and clearing on entry is the invariant
 * that actually matters (the callback must never see stale data).
 *
 * Throws `ScratchMisuseError` when:
 *
 * - the buffer is already borrowed (re-entrant use — two users clobbering);
 * - the callback returns the buffer itself (the reference escapes the frame).
 *
 * Throwing, rather than returning an Either, is deliberate. Both conditions are
 * programmer errors that must fail loudly in development; neither is a
 * recoverable runtime state, and threading an error channel through the hot
 * path would reintroduce the allocation this module exists to avoid.
 *
 * NOTE for callers: `Map.prototype.set` returns the Map, so a concise arrow
 * body such as `withScratch(s, (b) => b.set(k, v))` returns the buffer and
 * trips the escape check. Use a block body. That the check catches it is the
 * system working — an implicitly returned buffer is exactly the accidental
 * escape this is here to prevent, and it is the easiest one to write by
 * mistake.
 */
export const withScratch = <K, V, A>(scratch: ScratchMap<K, V>, use: (buffer: Map<K, V>) => A): A => {
  const { lease } = scratch as LeasedScratchMap<K, V>

  if (scratch.borrowedCount() > 0) {
    throw new ScratchMisuseError({
      message:
        `scratch buffer '${scratch.name}' is already borrowed. Two concurrent users share one ` +
        'mutable buffer and will clobber each other. Give the inner operation its own buffer.',
      rule: 're-entrant-borrow',
    })
  }

  lease.enter()
  try {
    scratch.buffer.clear()
    const result = use(scratch.buffer)
    if ((result as unknown) === scratch.buffer) {
      throw new ScratchMisuseError({
        message:
          `a caller returned scratch buffer '${scratch.name}' from withScratch. The buffer is ` +
          'cleared and refilled every frame, so the escaped reference would silently change ' +
          'under its holder. Copy what you need out of it instead.',
        rule: 'escaped-buffer',
      })
    }
    return result
  } finally {
    lease.exit()
  }
}

/**
 * Copy a scratch buffer's contents out.
 *
 * The sanctioned way to keep results past the borrow. It allocates, which is
 * the point: the allocation is explicit and attributable, rather than a
 * reference that looks free and is not.
 */
export const snapshotScratch = <K, V>(buffer: ReadonlyMap<K, V>): ReadonlyMap<K, V> => new Map(buffer)

/**
 * The buffers one frame needs.
 *
 * PRE-AUDIT FIRST CUT: named after the reference's per-frame temporaries, sized
 * from its comments. The real set arrives with the THREE.js adapter.
 */
export type FrameScratch = {
  /** Chunk key -> distance to camera. Rebuilt every frame by frustum culling. */
  readonly visibleChunks: ScratchMap<string, number>
  /** Entity id -> instance slot. `entity-instance-pool.ts` in the reference. */
  readonly entityInstances: ScratchMap<string, number>
  /** Chunk key -> dirty light regions, drained by the light-update pass. */
  readonly lightUpdates: ScratchMap<string, number>
}

export const makeFrameScratch = (): FrameScratch => ({
  entityInstances: makeScratchMap<string, number>('entityInstances', 256),
  lightUpdates: makeScratchMap<string, number>('lightUpdates', 64),
  visibleChunks: makeScratchMap<string, number>('visibleChunks', 512),
})
