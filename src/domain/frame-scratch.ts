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
 * `withScratch` below is the safe way to use one. The native `Map` is private;
 * callbacks receive one reusable lease facade whose operations fail after the
 * callback returns. This makes wrappers, closures, deferred Effects, and
 * iterators fail at the point where an escaped reference is used, without
 * allocating a wrapper for each borrow. `borrowedCount` tracks re-entrancy,
 * which is the other way this goes wrong — two nested users of the same buffer
 * clobber each other.
 */

/**
 * The operations available during a scratch borrow.
 *
 * This deliberately mirrors the mutable part of `Map` without exposing the
 * native map. The same lease object is reused for every borrow; its methods
 * check that the borrow is still active before touching the private map.
 */
export type ScratchBuffer<Key, Value> = {
  readonly size: number
  clear: () => void
  delete: (key: Key) => boolean
  entries: () => IterableIterator<[Key, Value]>
  forEach: (
    callbackfn: (value: Value, key: Key, map: ScratchBuffer<Key, Value>) => void,
    thisArg?: unknown,
  ) => void
  get: (key: Key) => Value | undefined
  has: (key: Key) => boolean
  keys: () => IterableIterator<Key>
  set: (key: Key, value: Value) => ScratchBuffer<Key, Value>
  values: () => IterableIterator<Value>
  [Symbol.iterator]: () => IterableIterator<[Key, Value]>
}

/**
 * A reusable keyed buffer.
 *
 * Generic over key and value so the same mechanism serves the per-frame chunk
 * visibility set, the entity instance map, and the light-update queue.
 */
export type ScratchMap<Key, Value> = {
  readonly name: string
  /** Frames this buffer has served. Never resets; diagnostics only. */
  readonly usageCount: () => number
  /** Nesting depth. Greater than 1 means two users are clobbering each other. */
  readonly borrowedCount: () => number
  /** Type-only anchor; the factory never materializes this optional property. */
  readonly __typeParameters?: readonly [Key, Value]
}

export type ScratchViolation = {
  readonly rule: 're-entrant-borrow' | 'escaped-buffer' | 'invalid-scratch'
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

type ScratchState<Key, Value> = {
  lease: ScratchBuffer<Key, Value>
  readonly buffer: Map<Key, Value>
  active: boolean
  usage: number
  borrowed: number
}

const scratchStates = new WeakMap<object, ScratchState<unknown, unknown>>()

/** One lease entered or exited, for the `usage`/`borrowed` counters below — named so the `+= `/`-= ` reads as "one lease" rather than an arbitrary tuning knob. */
const LEASE_STEP = 1

const beginScratchBorrow = <Key, Value>(state: ScratchState<Key, Value>): void => {
  state.usage += LEASE_STEP
  state.borrowed += LEASE_STEP
  state.active = true
  state.buffer.clear()
}

const endScratchBorrow = <Key, Value>(state: ScratchState<Key, Value>): void => {
  state.active = false
  state.borrowed -= LEASE_STEP
}

/** The buffer's diagnostic name, with its capacity hint appended when one was given. */
const scratchDisplayName = (name: string, initialCapacity: number | undefined): string => {
  if (initialCapacity === undefined) {
    return name
  }
  return `${name}[~${String(initialCapacity)}]`
}

/**
 * Create a scratch buffer.
 *
 * `initialCapacity` is accepted and deliberately unused for sizing: JavaScript
 * `Map` has no capacity hint. It is recorded in the name so that a profiler
 * trace says which buffer is growing, which is the actionable signal — a buffer
 * that keeps rehashing has outgrown its intended contents and should be split.
 */
export const makeScratchMap = <Key, Value>(name: string, initialCapacity?: number): ScratchMap<Key, Value> => {
  const buffer = new Map<Key, Value>()
  const displayName = scratchDisplayName(name, initialCapacity)
  const state: ScratchState<Key, Value> = {
    active: false,
    borrowed: 0,
    buffer,
    lease: undefined as never,
    usage: 0,
  }
  const assertActive = (): void => {
    if (!state.active) {
      throw new ScratchMisuseError({
        message: `scratch buffer '${displayName}' was used after its withScratch lease ended. Copy what you need before returning from the callback.`,
        rule: 'escaped-buffer',
      })
    }
  }
  const guardedIterator = <Item>(iterator: Iterator<Item>): IterableIterator<Item> => {
    const guarded: IterableIterator<Item> = {
      [Symbol.iterator]: () => guarded,
      next: () => {
        assertActive()
        return iterator.next()
      },
    }
    return guarded
  }
  const lease: ScratchBuffer<Key, Value> = {
    clear: () => {
      assertActive()
      buffer.clear()
    },
    delete: (key) => {
      assertActive()
      return buffer.delete(key)
    },
    entries: () => {
      assertActive()
      return guardedIterator(buffer.entries())
    },
    forEach: (callbackfn, thisArg) => {
      assertActive()
      buffer.forEach((value, key) => {
        assertActive()
        callbackfn.call(thisArg, value, key, lease)
      })
    },
    get: (key) => {
      assertActive()
      return buffer.get(key)
    },
    has: (key) => {
      assertActive()
      return buffer.has(key)
    },
    keys: () => {
      assertActive()
      return guardedIterator(buffer.keys())
    },
    set: (key, value) => {
      assertActive()
      buffer.set(key, value)
      return lease
    },
    get size() {
      assertActive()
      return buffer.size
    },
    values: () => {
      assertActive()
      return guardedIterator(buffer.values())
    },
    [Symbol.iterator]: () => {
      assertActive()
      return guardedIterator(buffer.entries())
    },
  }
  state.lease = lease

  const scratch: ScratchMap<Key, Value> = {
    borrowedCount: () => state.borrowed,
    name: displayName,
    usageCount: () => state.usage,
  }
  scratchStates.set(scratch, state as unknown as ScratchState<unknown, unknown>)

  return scratch
}

/** No lease is currently held on the buffer. */
const NO_ACTIVE_BORROW = 0

const scratchState = <Key, Value>(scratch: ScratchMap<Key, Value>): ScratchState<Key, Value> => {
  const state = scratchStates.get(scratch)
  if (state === undefined) {
    throw new ScratchMisuseError({
      message: `scratch buffer '${scratch.name}' was not created by makeScratchMap. Use the factory so its private lease can be validated.`,
      rule: 'invalid-scratch',
    })
  }
  return state as unknown as ScratchState<Key, Value>
}

const assertNotReentrant = <Key, Value>(scratch: ScratchMap<Key, Value>, state: ScratchState<Key, Value>): void => {
  if (state.borrowed > NO_ACTIVE_BORROW) {
    throw new ScratchMisuseError({
      message:
        `scratch buffer '${scratch.name}' is already borrowed. Two concurrent users share one ` +
        'mutable buffer and will clobber each other. Give the inner operation its own buffer.',
      rule: 're-entrant-borrow',
    })
  }
}

const assertNotEscaped = <Key, Value>(scratch: ScratchMap<Key, Value>, state: ScratchState<Key, Value>, result: unknown): void => {
  if (result === state.lease) {
    throw new ScratchMisuseError({
      message:
        `a caller returned scratch buffer '${scratch.name}' from withScratch. The lease is ` +
        'invalid after the callback, so the escaped reference would fail when used. Copy ' +
        'what you need out of it instead.',
      rule: 'escaped-buffer',
    })
  }
}

/**
 * Borrow a scratch buffer for the duration of one operation.
 *
 * The private native map is cleared on entry, not on exit: clearing on entry is
 * the invariant that actually matters (the callback must never see stale data).
 *
 * Throws `ScratchMisuseError` when:
 *
 * - the buffer is already borrowed (re-entrant use — two users clobbering);
 * - the callback returns the lease itself (the reference escapes the frame);
 * - a value made by another object literal is passed instead of the factory
 *   result.
 *
 * Throwing, rather than returning an Either, is deliberate. Both conditions are
 * programmer errors that must fail loudly in development; neither is a
 * recoverable runtime state, and threading an error channel through the hot
 * path would reintroduce the allocation this module exists to avoid.
 *
 * NOTE for callers: `ScratchBuffer.prototype.set` returns the lease, so a
 * concise arrow body such as `withScratch(s, (b) => b.set(k, v))` returns the lease and
 * trips the escape check. Use a block body. That the check catches it is the
 * system working — an implicitly returned buffer is exactly the accidental
 * escape this is here to prevent, and it is the easiest one to write by
 * mistake.
 */
export const withScratch = <Key, Value, Result>(
  scratch: ScratchMap<Key, Value>,
  use: (buffer: ScratchBuffer<Key, Value>) => Result,
): Result => {
  const state = scratchState<Key, Value>(scratch)
  assertNotReentrant(scratch, state)

  beginScratchBorrow(state)
  try {
    const result = use(state.lease)
    assertNotEscaped(scratch, state, result)
    return result
  } finally {
    endScratchBorrow(state)
  }
}

/**
 * Copy a scratch buffer's contents out.
 *
 * The sanctioned way to keep results past the borrow. It allocates, which is
 * the point: the allocation is explicit and attributable, rather than a
 * reference that looks free and is not.
 */
export const snapshotScratch = <Key, Value>(buffer: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> =>
  new Map(buffer)

/**
 * The buffers one frame needs.
 *
 * These names mirror the renderer's per-frame data flow; a pass adds a buffer
 * only when it needs ownership across the frame.
 */
export type FrameScratch = {
  /** Chunk key -> distance to camera. Rebuilt every frame by frustum culling. */
  readonly visibleChunks: ScratchMap<string, number>
  /** Entity id -> instance slot. `entity-instance-pool.ts` in the reference. */
  readonly entityInstances: ScratchMap<string, number>
  /** Chunk key -> dirty light regions, drained by the light-update pass. */
  readonly lightUpdates: ScratchMap<string, number>
}

/** Capacity hint for `entityInstances`: a typical loaded area's live entity count. */
const ENTITY_INSTANCES_CAPACITY_HINT = 256
/** Capacity hint for `lightUpdates`: dirty light regions rarely span more than a few dozen chunks per frame. */
const LIGHT_UPDATES_CAPACITY_HINT = 64
/** Capacity hint for `visibleChunks`: the render-distance chunk count this scratch buffer is sized against. */
const VISIBLE_CHUNKS_CAPACITY_HINT = 512

export const makeFrameScratch = (): FrameScratch => ({
  entityInstances: makeScratchMap<string, number>('entityInstances', ENTITY_INSTANCES_CAPACITY_HINT),
  lightUpdates: makeScratchMap<string, number>('lightUpdates', LIGHT_UPDATES_CAPACITY_HINT),
  visibleChunks: makeScratchMap<string, number>('visibleChunks', VISIBLE_CHUNKS_CAPACITY_HINT),
})
