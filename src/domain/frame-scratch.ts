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
 * the callback, and the callback receives a lease-checked Map view rather than
 * the native backing Map. Retaining the view, a wrapper, an iterator, or a
 * deferred callback is therefore detected when it is used after the lease.
 * `snapshotScratch` is the explicit copy operation for values that must live
 * beyond the borrow. `borrowedCount` tracks re-entrancy, which is the other way
 * this goes wrong — two nested users of the same buffer clobber each other.
 */

/**
 * A reusable keyed buffer.
 *
 * Generic over key and value so the same mechanism serves the per-frame chunk
 * visibility set, the entity instance map, and the light-update queue.
 */
export type ScratchMap<Key, Value> = {
  readonly name: string
  /** Type-only brand; the field is omitted from every runtime scratch value. */
  readonly __scratchMapTypes?: readonly [Key, Value]
  /** Frames this buffer has served. Never resets; diagnostics only. */
  readonly usageCount: () => number
  /** Nesting depth. Greater than 1 means two users are clobbering each other. */
  readonly borrowedCount: () => number
}

export type ScratchViolation = {
  readonly rule: 're-entrant-borrow' | 'escaped-buffer' | 'foreign-scratch'
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

/** One lease entered or exited, for the `usage`/`borrowed` counters below — named so the `+= `/`-= ` reads as "one lease" rather than an arbitrary tuning knob. */
const LEASE_STEP = 1
const NO_ACTIVE_LEASES = 0

/** The buffer's diagnostic name, with its capacity hint appended when one was given. */
const scratchDisplayName = (name: string, initialCapacity: number | undefined): string => {
  if (initialCapacity === undefined) {
    return name
  }
  return `${name}[~${String(initialCapacity)}]`
}

type ScratchOwner = {
  readonly assertActive: () => void
}

class GuardedIterator<Item> implements IterableIterator<Item> {
  constructor(
    private readonly source: Iterator<Item>,
    private readonly owner: ScratchOwner,
  ) {}

  next(...args: [] | [undefined]): IteratorResult<Item> {
    this.owner.assertActive()
    return this.source.next(...args)
  }

  [Symbol.iterator](): IterableIterator<Item> {
    this.owner.assertActive()
    return this
  }
}

class GuardedMap<Key, Value> implements Map<Key, Value> {
  readonly [Symbol.toStringTag] = 'Map'

  constructor(
    private readonly source: Map<Key, Value>,
    private readonly owner: ScratchOwner,
  ) {}

  get size(): number {
    this.owner.assertActive()
    return this.source.size
  }

  clear(): void {
    this.owner.assertActive()
    this.source.clear()
  }

  delete(key: Key): boolean {
    this.owner.assertActive()
    return this.source.delete(key)
  }

  entries(): ReturnType<Map<Key, Value>['entries']> {
    this.owner.assertActive()
    return new GuardedIterator(this.source.entries(), this.owner) as unknown as ReturnType<
      Map<Key, Value>['entries']
    >
  }

  forEach(
    callbackfn: (value: Value, key: Key, map: Map<Key, Value>) => void,
    thisArg?: unknown,
  ): void {
    this.owner.assertActive()
    this.source.forEach((value, key) => callbackfn.call(thisArg, value, key, this), thisArg)
  }

  get(key: Key): Value | undefined {
    this.owner.assertActive()
    return this.source.get(key)
  }

  has(key: Key): boolean {
    this.owner.assertActive()
    return this.source.has(key)
  }

  keys(): ReturnType<Map<Key, Value>['keys']> {
    this.owner.assertActive()
    return new GuardedIterator(this.source.keys(), this.owner) as unknown as ReturnType<Map<Key, Value>['keys']>
  }

  set(key: Key, value: Value): this {
    this.owner.assertActive()
    this.source.set(key, value)
    return this
  }

  values(): ReturnType<Map<Key, Value>['values']> {
    this.owner.assertActive()
    return new GuardedIterator(this.source.values(), this.owner) as unknown as ReturnType<
      Map<Key, Value>['values']
    >
  }

  [Symbol.iterator](): ReturnType<Map<Key, Value>['entries']> {
    return this.entries()
  }
}

class ScratchState<Key, Value> implements ScratchOwner {
  readonly buffer = new Map<Key, Value>()
  readonly view: Map<Key, Value>
  private active = false
  private usage = NO_ACTIVE_LEASES
  private borrowed = NO_ACTIVE_LEASES

  constructor(readonly name: string) {
    this.view = new GuardedMap(this.buffer, this)
  }

  assertActive(): void {
    if (!this.active) {
      throw new ScratchMisuseError({
        message: `scratch buffer '${this.name}' was used outside its withScratch borrow. Copy results with snapshotScratch before returning.`,
        rule: 'escaped-buffer',
      })
    }
  }

  enter(): void {
    this.usage += LEASE_STEP
    this.borrowed += LEASE_STEP
    this.active = true
  }

  exit(): void {
    this.borrowed -= LEASE_STEP
    this.active = false
  }

  borrowedCount(): number {
    return this.borrowed
  }

  usageCount(): number {
    return this.usage
  }
}

const scratchStates = new WeakMap<object, ScratchState<unknown, unknown>>()

const stateFor = <Key, Value>(scratch: ScratchMap<Key, Value>): ScratchState<Key, Value> => {
  if (typeof scratch !== 'object' || scratch === null) {
    throw new ScratchMisuseError({
      message: 'withScratch received a non-object scratch value created outside makeScratchMap.',
      rule: 'foreign-scratch',
    })
  }

  const state = scratchStates.get(scratch)
  if (state === undefined) {
    throw new ScratchMisuseError({
      message: 'withScratch received a ScratchMap that was not created by makeScratchMap.',
      rule: 'foreign-scratch',
    })
  }
  return state as ScratchState<Key, Value>
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
  const state = new ScratchState<Key, Value>(scratchDisplayName(name, initialCapacity))
  const scratch: ScratchMap<Key, Value> = {
    borrowedCount: () => state.borrowedCount(),
    name: state.name,
    usageCount: () => state.usageCount(),
  }

  scratchStates.set(scratch, state as ScratchState<unknown, unknown>)
  return scratch
}

/** No lease is currently held on the buffer. */
const NO_ACTIVE_BORROW = 0

const assertNotReentrant = <Key, Value>(state: ScratchState<Key, Value>): void => {
  if (state.borrowedCount() > NO_ACTIVE_BORROW) {
    throw new ScratchMisuseError({
      message:
        `scratch buffer '${state.name}' is already borrowed. Two concurrent users share one ` +
        'mutable buffer and will clobber each other. Give the inner operation its own buffer.',
      rule: 're-entrant-borrow',
    })
  }
}

const assertNotEscaped = <Key, Value>(state: ScratchState<Key, Value>, result: unknown): void => {
  if (result === state.view) {
    throw new ScratchMisuseError({
      message:
        `a caller returned scratch buffer '${state.name}' from withScratch. The buffer is ` +
        'cleared and refilled every frame, so the escaped reference would silently change ' +
        'under its holder. Copy what you need out of it instead.',
      rule: 'escaped-buffer',
    })
  }
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
 * - the callback returns the live buffer itself (the reference escapes the frame);
 * - a buffer or iterator retained by a caller is used after the borrow ends.
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
export const withScratch = <Key, Value, Result>(
  scratch: ScratchMap<Key, Value>,
  use: (buffer: Map<Key, Value>) => Result,
): Result => {
  const state = stateFor(scratch)
  assertNotReentrant(state)

  state.enter()
  try {
    state.buffer.clear()
    const result = use(state.view)
    assertNotEscaped(state, result)
    return result
  } finally {
    state.exit()
  }
}

/**
 * Copy a scratch buffer's contents out.
 *
 * The sanctioned way to keep results past the borrow. It allocates, which is
 * the point: the allocation is explicit and attributable, rather than a
 * reference that looks free and is not.
 */
export const snapshotScratch = <Key, Value>(buffer: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> =>
  new Map(buffer)

/**
 * The buffers one frame needs.
 *
 * Named after the renderer's per-frame temporaries; the storage stays separate
 * from the rendering backend so the update logic remains testable.
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
