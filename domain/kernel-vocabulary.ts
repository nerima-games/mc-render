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
 * `mc-kernel/domain/{quantities,coordinates,camera}.ts`.
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
 */
import { Brand } from 'effect'

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
