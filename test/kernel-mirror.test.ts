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
 * mc-render's mirror carries the brands, the snapshot shape, the Clock Port
 * WHOLE, and the frame contract — because `stages/` registers frame stages and
 * `FrameServices` is `ClockPort`. See the mirror's own header on why a narrower
 * `ClockService` would be a runtime hazard rather than merely less vocabulary.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  monotonicSecs,
  MonotonicTimeSecs,
  position,
  snapshotAgeSecs,
  StageId,
  wallClockEpochMillis,
  type CameraPoseSnapshot,
  type ClockService,
  type FrameServices,
  type GameModule,
  type StageRegistration,
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

describe('the mirrored Clock Port is kernel’s', () => {
  const FIXED_AT = {
    monotonicSecs: MonotonicTimeSecs(1_234.5),
    wallClockEpochMillis: EpochMillis(1_700_000_000_000),
  }

  // REGRESSION — the exact failure mc-sim's mirror once had. Effect resolves a
  // Tag by its TEXTUAL KEY, so a Layer built against a one-field mirror
  // satisfies kernel's two-field tag and the missing field reads `undefined` in
  // a repository that never saw this file. `tsc` cannot see it; this can.
  it.effect('carries kernel’s tag string, so it IS kernel’s service at runtime', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('REGRESSION: ClockService has BOTH readings, not just the one mc-render uses', () =>
    Effect.gen(function* () {
      /** Kernel's shape, restated from `mc-kernel/domain/clock.ts`. */
      type KernelClockService = {
        readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
        readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
      }

      const asKernel: KernelClockService = fixedClock(FIXED_AT)
      const asMirror: ClockService = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }

      const fields = ['monotonicSecs', 'wallClockEpochMillis']
      expect(Object.keys(asKernel).sort()).toStrictEqual(fields)
      expect(Object.keys(asMirror).sort()).toStrictEqual(fields)

      expect(yield* monotonicSecs.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(1_234.5)
      expect(yield* wallClockEpochMillis.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(
        1_700_000_000_000,
      )
    }),
  )

  it.effect('EpochMillis is a safe integer, as kernel refines it', () =>
    Effect.sync(() => {
      expect(EpochMillis(0)).toBe(0)
      expect(() => EpochMillis(1.5)).toThrow()
    }),
  )

  it.effect('StageId refuses a blank id, as kernel refines it', () =>
    Effect.sync(() => {
      expect(StageId('render:draw')).toBe('render:draw')
      expect(() => StageId('   ')).toThrow()
      expect(() => StageId('')).toThrow()
    }),
  )
})

describe('the mirrored frame contract is kernel’s', () => {
  // REGRESSION: kernel froze `FrameServices = ClockPort` after the vertical
  // slice spike. A mirror that drifted narrow would let a stage compile here
  // and fail to assign against the published kernel; one that drifted wide
  // would demand something no host supplies. `Exclude` both ways is what makes
  // this an equality rather than a containment.
  it.effect('FrameServices is exactly ClockPort — no wider, no narrower', () =>
    Effect.sync(() => {
      type NoWider = Exclude<FrameServices, ClockPort>
      type NoNarrower = Exclude<ClockPort, FrameServices>
      const widerIsEmpty: NoWider extends never ? true : false = true
      const narrowerIsEmpty: NoNarrower extends never ? true : false = true

      expect(widerIsEmpty).toBe(true)
      expect(narrowerIsEmpty).toBe(true)
    }),
  )

  // REGRESSION: `GameModule.frameStages` is an EFFECT, not an array. That is
  // the change the vertical-slice spike forced, and mc-render is the repository
  // that forced it — `render:input` cannot be built without first acquiring an
  // InputService. A mirror that kept the array would compile against nothing
  // this repository actually ships.
  it.effect('GameModule.frameStages is an Effect, with its own requirement parameter', () =>
    Effect.gen(function* () {
      class Needed extends Effect.Tag('test/Needed')<Needed, { readonly value: number }>() {}

      const module: GameModule<never, never, never, Needed> = {
        layers: Layer.empty,
        frameStages: Effect.map(Needed, (needed) => [
          {
            id: StageId('render:draw'),
            run: () => Effect.asVoid(Effect.succeed(needed.value)),
          } satisfies StageRegistration,
        ]),
      }

      const stages = yield* module.frameStages.pipe(
        Effect.provideService(Needed, { value: 1 }),
      )
      expect(stages).toHaveLength(1)
    }),
  )

  // The default is what keeps every three-parameter module in the roster
  // compiling. If it were removed, every mirror would have to change in the
  // same commit.
  it.effect('RRegister defaults to never, so a module needing nothing writes three parameters', () =>
    Effect.sync(() => {
      const threeParams: GameModule<never, never, never> = {
        layers: Layer.empty,
        frameStages: Effect.succeed([]),
      }
      const fourParams: GameModule<never, never, never, never> = threeParams
      expect(fourParams.layers).toBe(Layer.empty)
    }),
  )

  it.effect('`after` is optional, and a stage runs against FrameServices', () =>
    Effect.gen(function* () {
      const standalone: StageRegistration = {
        id: StageId('render:draw'),
        run: () => Effect.asVoid(monotonicSecs),
      }

      expect(standalone.after).toBeUndefined()
      yield* standalone
        .run(DeltaTimeSecs(0))
        .pipe(
          Effect.provide(
            FixedClockLayer({
              monotonicSecs: MonotonicTimeSecs(0),
              wallClockEpochMillis: EpochMillis(0),
            }),
          ),
        )
    }),
  )
})
