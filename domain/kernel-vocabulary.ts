/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes the repositories bottom-up: a repository is
 * published to GitHub Packages only once its interface has held still, and only
 * then may its consumers pin it. Nothing is published yet, so mc-render cannot
 * `import ... from '@nerima-games/mc-kernel'` — there is no package to resolve,
 * and `scripts/check-dependency-whitelist.ts` would in any case reject an
 * import of something absent from `package.json#dependencies`.
 *
 * Rather than invent a different vocabulary that would have to be reconciled
 * later, this file mirrors the handful of kernel declarations mc-render actually
 * uses, verbatim in shape and semantics, from
 * `mc-kernel/domain/{quantities,coordinates,camera,clock,identifiers,frame}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * Nothing else should need to change. If step 3 turns out not to typecheck,
 * this file has drifted and the drift is the bug.
 *
 * The mirror is deliberately MINIMAL — only what mc-render uses. A larger mirror
 * would be a larger thing to keep honest.
 *
 * ---------------------------------------------------------------------------
 * ONE EXCEPTION TO "MINIMAL": the Clock Port is mirrored WHOLE
 * ---------------------------------------------------------------------------
 *
 * `stages/` registers frame stages, so this file has to carry kernel's frame
 * contract, and `FrameServices` is `ClockPort`. Naming it means constructing
 * the Tag — and a `Context.Tag` is resolved by its TEXTUAL KEY, so a mirror
 * built from `'@nerima-games/mc-kernel/ClockPort'` IS kernel's service at
 * runtime. That is what makes the mirror sound, and it is also why a NARROWER
 * mirror of `ClockService` would be a silent runtime hazard rather than merely
 * "less of the vocabulary": a `Layer` built against a one-field mirror
 * satisfies the two-field tag, and the missing field reads `undefined` in a
 * repository that never saw this file.
 *
 * `EpochMillis`, `fixedClock`, `wallClockEpochMillis` and the object-shaped
 * `FixedClockLayer` are therefore mirrored even though nothing in mc-render
 * reads a wall clock. mc-sim's mirror carries the identical reasoning.
 * `test/kernel-mirror.test.ts` pins the shape against kernel's.
 */
import { Brand, Context, Effect, Layer } from 'effect'

// ---------------------------------------------------------------------------
// Quantities — mirrors mc-kernel/domain/quantities.ts
// ---------------------------------------------------------------------------

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 * A zero delta is legal: a frame may be scheduled twice inside one clock tick.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds. Never decreases; the origin is
 * unspecified, so only differences are meaningful. Comes from `ClockPort`.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch. Only for values a
 * human reads or that must survive a save/load round trip — never for
 * durations, because it can jump in either direction.
 *
 * Mirrored solely so that `ClockService` below has kernel's real shape.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

// ---------------------------------------------------------------------------
// Identifiers — mirrors mc-kernel/domain/identifiers.ts
// ---------------------------------------------------------------------------

/**
 * Identifies a frame stage. Stage ids are the vertices of the per-frame
 * ordering graph and are STRINGS ON PURPOSE: `after: [StageId('sim:physics')]`
 * expresses "run me after mc-sim's physics" without importing anything from
 * mc-sim's stage module (plan.md §2.3-1, §2.3-3).
 *
 * Convention: `<owning-repo-suffix>:<stage>`. Everything this repository owns is
 * prefixed `render:`.
 */
export type StageId = string & Brand.Brand<'StageId'>

export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`StageId must be a non-blank string, received ${JSON.stringify(value)}`),
)

// ---------------------------------------------------------------------------
// Coordinates — mirrors mc-kernel/domain/coordinates.ts (the continuous part)
// ---------------------------------------------------------------------------

/** A continuous world-space point. Y is up, 1 block = 1 unit. */
export type Position = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const position = (x: number, y: number, z: number): Position => ({ x, y, z })

// ---------------------------------------------------------------------------
// Camera pose — mirrors mc-kernel/domain/camera.ts
// ---------------------------------------------------------------------------

/**
 * The camera pose, as a value.
 *
 * plan.md §4.3 / §5.1-2: **mc-sim owns the truth and this repository mirrors
 * it.** The type has no setter and must never grow one. See `domain/camera-mirror.ts`, which is where
 * this repository turns a snapshot into renderer state — in one direction only.
 */
export type CameraPoseSnapshot = {
  readonly position: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly capturedAtSecs: MonotonicTimeSecs
}

/**
 * Age of a snapshot at a given instant, in seconds. Negative under clock skew,
 * which is a real condition (a worker stamping a pose ahead of the reader) and
 * is surfaced rather than clamped away.
 */
export const snapshotAgeSecs = (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs): number =>
  now - snapshot.capturedAtSecs

// ---------------------------------------------------------------------------
// Clock Port — mirrors mc-kernel/domain/clock.ts, WHOLE (see the module header)
// ---------------------------------------------------------------------------

export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

/** A clock frozen at one instant. Platform-independent, hence shippable by kernel. */
export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

/** `fixedClock` as a Layer, for deterministic tests and replays. */
export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

/** Read the monotonic clock. The only sanctioned answer to "what time is it?". */
export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

/** Read the wall clock. Only for human-facing or persisted values. */
export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

// ---------------------------------------------------------------------------
// Frame contract — mirrors mc-kernel/domain/frame.ts
// ---------------------------------------------------------------------------

/**
 * The context every frame stage may assume is present. Kernel's answer, settled
 * by the vertical-slice spike: `ClockPort`, and nothing else.
 *
 * Unlike the `mx-*` repositories — which mirror this as `never` because they
 * are stage AUTHORS and an `Effect<void, never, never>` assigns wherever
 * `Effect<void, never, ClockPort>` is wanted — mc-render actually reads the
 * clock from a stage (`render:camera-mirror` measures how stale the mirrored
 * pose is), so the narrow mirror would be a lie here rather than a convenience.
 */
export type FrameServices = ClockPort

/**
 * One unit of per-frame work, contributed by a repository.
 *
 * `after` declares ORDERING EDGES ONLY. It is not a dependency on the named
 * stage existing, and it is not a request for a position in the sequence: the
 * total order over all stages from all modules is resolved solely by mc-compose
 * (plan.md §2.3-3, §4.2).
 *
 * Reproduced verbatim from plan.md §4.1, `interface` and all.
 */
export interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

/**
 * A repository's contribution to a running game.
 *
 * `frameStages` is an EFFECT, not an array, and that is the whole point of the
 * type for mc-render: `render:input` cannot be built without first acquiring
 * `InputService`, and with a value there was no context in which to do that.
 * See `mc-kernel/domain/frame.ts` for why that forced every such service into
 * `FrameServices` and why `RRegister` is separate from `RIn`.
 */
export interface GameModule<ROut, E, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, E, RIn>
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>
}
