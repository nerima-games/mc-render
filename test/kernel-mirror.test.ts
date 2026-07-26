/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * `domain/kernel-vocabulary.ts` promises that deleting it and repointing every
 * import at the published `@nerima-games/mc-kernel` will typecheck. Nothing
 * enforced that promise, and it had already been broken elsewhere in the
 * roster: mc-sim's copy of the same mirror carried a one-field `ClockService`
 * where kernel's carries two, and mc-physics refined `DeltaTimeSecs` to the
 * frame-loop clamp `[0.001, 0.05]` where kernel refines it to "finite and
 * non-negative".
 *
 * Neither divergence was visible to `tsc`. A brand is keyed by its STRING
 * (`Brand.Brand<'DeltaTimeSecs'>`), so a mirror and kernel's original are one
 * type however differently they validate; a `Context.Tag` is keyed by its
 * string too, so two mirrors of a Port are one service at runtime. Both are
 * failures a type checker is structurally unable to catch, which is why they
 * are asserted here instead.
 *
 * mc-render's mirror carries no Port, so what there is to pin is the brands and
 * the snapshot shape.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DeltaTimeSecs,
  MonotonicTimeSecs,
  position,
  snapshotAgeSecs,
  type CameraPoseSnapshot,
} from '../domain/kernel-vocabulary'

describe('the mirrored brands are kernel’s brands', () => {
  // REGRESSION: kernel (mc-kernel/domain/quantities.ts:37-42) refines
  // DeltaTimeSecs to "finite and non-negative" and says a ZERO delta is legal,
  // because a frame may be scheduled twice inside one clock tick. The
  // [0.001, 0.05] clamp of plan.md §3.4 is a FRAME-LOOP concern applied at the
  // boundary by whoever produces the delta — mc-sim's `frame-timing.ts`,
  // mc-physics' `clampDeltaTime` — never a property of the quantity.
  it.effect('DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      expect(DeltaTimeSecs(30)).toBe(30)
      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('MonotonicTimeSecs is finite and non-negative', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})

describe('the mirrored CameraPoseSnapshot is kernel’s', () => {
  /** Kernel's shape, restated from `mc-kernel/domain/camera.ts`. */
  type KernelCameraPoseSnapshot = {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly yawRadians: number
    readonly pitchRadians: number
    readonly capturedAtSecs: MonotonicTimeSecs
  }

  const pose: CameraPoseSnapshot = {
    position: position(1, 2, 3),
    yawRadians: 0.5,
    pitchRadians: -0.25,
    capturedAtSecs: MonotonicTimeSecs(10),
  }

  it.effect('REGRESSION: the mirror is neither narrower nor wider than kernel’s snapshot', () =>
    Effect.sync(() => {
      // mirror -> kernel, then an object literal back the other way, so a
      // dropped field and an invented one both fail to compile.
      const asKernel: KernelCameraPoseSnapshot = pose
      const asMirror: CameraPoseSnapshot = {
        position: { x: 1, y: 2, z: 3 },
        yawRadians: 0.5,
        pitchRadians: -0.25,
        capturedAtSecs: MonotonicTimeSecs(10),
      }

      const fields = ['capturedAtSecs', 'pitchRadians', 'position', 'yawRadians']
      expect(Object.keys(asKernel).sort()).toStrictEqual(fields)
      expect(Object.keys(asMirror).sort()).toStrictEqual(fields)
    }),
  )

  // Kernel surfaces clock skew rather than clamping it — a worker may stamp a
  // pose ahead of the reader, and hiding that would hide a real condition.
  it.effect('snapshotAgeSecs stays signed, as kernel’s does', () =>
    Effect.sync(() => {
      expect(snapshotAgeSecs(pose, MonotonicTimeSecs(12))).toBe(2)
      expect(snapshotAgeSecs(pose, MonotonicTimeSecs(8))).toBe(-2)
    }),
  )
})
