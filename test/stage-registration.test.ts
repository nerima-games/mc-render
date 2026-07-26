import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import {
  GAMEPLAY_LISTENER_TARGET,
  MODAL_LISTENER_TARGET,
} from '../domain/input-bindings'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  position,
  StageId,
  type CameraPoseSnapshot,
  type StageRegistration,
} from '../domain/kernel-vocabulary'
import { QUALITY_PRESETS } from '../domain/post-processing'
import { InputService, InputServiceLayer } from '../application/input-service'
import {
  makeRenderStagesForPreview,
  renderModule,
  UNSET_CAMERA_POSE,
  type RenderFrameState,
} from '../stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  OWN_STAGE_PREFIX,
  RENDER_STAGE_IDS,
  UPSTREAM_STAGE_IDS,
} from '../stages/stage-ids'

const FRAME_SERVICES = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(100),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

const dt = DeltaTimeSecs(0.016)

/** Build the stages and hand back the state they close over. */
const withStages = <A>(
  use: (
    stages: ReadonlyArray<StageRegistration>,
    state: RenderFrameState,
    input: InputService['Type'],
  ) => Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const input = yield* InputService
    const { state, stages } = yield* makeRenderStagesForPreview()
    return yield* use(stages, state, input)
  }).pipe(Effect.provide(InputServiceLayer()))

const stageById = (
  stages: ReadonlyArray<StageRegistration>,
  id: StageId,
): StageRegistration => {
  const found = stages.find((stage) => stage.id === id)
  if (found === undefined) {
    throw new Error(`no stage registered with id ${id}`)
  }
  return found
}

describe('what mc-render registers', () => {
  it.effect('registers exactly the five stages of stage-ids.ts, each once', () =>
    withStages((stages) =>
      Effect.sync(() => {
        expect(stages.map((stage) => stage.id)).toStrictEqual([
          RENDER_STAGE_IDS.input,
          RENDER_STAGE_IDS.cameraMirror,
          RENDER_STAGE_IDS.chunkSync,
          RENDER_STAGE_IDS.draw,
          RENDER_STAGE_IDS.postFx,
        ])
        expect(new Set(stages.map((stage) => stage.id)).size).toBe(stages.length)
      }),
    ),
  )

  // REGRESSION — the defect this module exists to close. `InputService.endFrame`
  // must be called exactly once per frame, which makes it a stage by
  // definition; before this, the only registered input stage in the whole
  // roster was `input:sample` in mc-playground-kit, and kit is dev-only. The
  // SHIPPED build had no input stage at all (plan.md §2.3-2).
  it.effect('registers an input stage AT ALL, which the shipped build previously did not', () =>
    withStages((stages) =>
      Effect.sync(() => {
        const input = stages.filter((stage) => stage.id === RENDER_STAGE_IDS.input)
        expect(input).toHaveLength(1)
      }),
    ),
  )

  it.effect('every id it owns carries this repository’s prefix', () =>
    Effect.sync(() => {
      for (const id of Object.values(RENDER_STAGE_IDS)) {
        expect(id.startsWith(OWN_STAGE_PREFIX)).toBe(true)
      }
    }),
  )

  // REGRESSION: plan.md §2.3-1 — no edge to a sibling experience module, at the
  // ORDERING level as well as the import level. An `after: ['ui:hud-sync']`
  // would pass `pnpm check:deps` (it is a string) while still coupling
  // mc-render's frame position to mx-ui's existence.
  it.effect('orders itself against no experience module', () =>
    withStages((stages) =>
      Effect.sync(() => {
        const declared = stages.flatMap((stage) => [...(stage.after ?? [])])
        for (const edge of declared) {
          for (const prefix of EXPERIENCE_MODULE_STAGE_PREFIXES) {
            expect(edge.startsWith(prefix)).toBe(false)
          }
        }
      }),
    ),
  )

  // The upstream edge is deliberately the minimum. Declaring `render:input`
  // before `sim:physics` would be a claim about the GLOBAL order, which only
  // mc-compose is entitled to make (plan.md §2.3-3).
  it.effect('declares exactly one upstream edge: the camera mirror after sim:physics', () =>
    withStages((stages) =>
      Effect.sync(() => {
        const foreign = stages.flatMap((stage) =>
          [...(stage.after ?? [])].filter((edge) => !edge.startsWith(OWN_STAGE_PREFIX)),
        )
        expect(foreign).toStrictEqual([UPSTREAM_STAGE_IDS.simPhysics])
        expect(stageById(stages, RENDER_STAGE_IDS.cameraMirror).after).toStrictEqual([
          UPSTREAM_STAGE_IDS.simPhysics,
        ])
        expect(stageById(stages, RENDER_STAGE_IDS.input).after).toBeUndefined()
      }),
    ),
  )

  // REGRESSION: the ARRAY order is for human reading. Meaning lives in `after`.
  it.effect('carries its internal order in `after`, not in the array', () =>
    withStages((stages) =>
      Effect.sync(() => {
        expect(stageById(stages, RENDER_STAGE_IDS.chunkSync).after).toStrictEqual([
          RENDER_STAGE_IDS.cameraMirror,
        ])
        expect(stageById(stages, RENDER_STAGE_IDS.draw).after).toStrictEqual([
          RENDER_STAGE_IDS.chunkSync,
        ])
        expect(stageById(stages, RENDER_STAGE_IDS.postFx).after).toStrictEqual([
          RENDER_STAGE_IDS.draw,
        ])
      }),
    ),
  )
})

describe('render:input', () => {
  // REGRESSION: the whole reason the stage exists. `justPressed` is an EDGE;
  // without an `endFrame` once per frame, one press of the inventory key
  // re-fires on every frame it is held.
  it.effect('samples this frame’s input and then clears the per-frame edges', () =>
    withStages((stages, state, input) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'keydown', code: 'KeyE', target: GAMEPLAY_LISTENER_TARGET })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        // Sampled BEFORE the clear, so this frame sees the edge.
        expect([...(yield* Ref.get(state.input)).justPressed]).toStrictEqual(['KeyE'])
        // ...and the service no longer holds it, so next frame will not.
        expect([...(yield* input.snapshot).justPressed]).toStrictEqual([])
        // The key is still HELD — `endFrame` clears edges, not state.
        expect([...(yield* input.snapshot).pressed]).toStrictEqual(['KeyE'])

        // Second frame, key still down: no new edge.
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect([...(yield* Ref.get(state.input)).justPressed]).toStrictEqual([])
      }),
    ),
  )

  it.effect('sampling and clearing are ONE stage, so nothing can be scheduled between them', () =>
    withStages((stages, state, input) =>
      Effect.gen(function* () {
        // A modal-targeted event is ignored by the service, so the snapshot this
        // stage publishes carries the same shielding rule as the service does.
        yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: MODAL_LISTENER_TARGET })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect([...(yield* Ref.get(state.input)).pressed]).toStrictEqual([])
      }),
    ),
  )
})

describe('render:camera-mirror', () => {
  const pose: CameraPoseSnapshot = {
    position: position(8, 65, -12),
    yawRadians: 0.5,
    pitchRadians: -0.25,
    capturedAtSecs: MonotonicTimeSecs(99.5),
  }

  it.effect('copies the authoritative pose into renderer state, one direction only', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.authoritativePose, pose)
        yield* stageById(stages, RENDER_STAGE_IDS.cameraMirror)
          .run(dt)
          .pipe(Effect.provide(FRAME_SERVICES))

        const mirrored = yield* Ref.get(state.mirroredCamera)
        expect(mirrored.position).toStrictEqual(pose.position)
        expect(mirrored.rotation).toStrictEqual({ x: -0.25, y: 0.5, z: 0, order: 'YXZ' })

        // The authoritative value is UNTOUCHED. plan.md §3.8: the reference had
        // this inverted and the simulation read its view direction back out of
        // the renderer. There is no path from output to input here, and this is
        // the assertion that says so.
        expect(yield* Ref.get(state.authoritativePose)).toStrictEqual(pose)
      }),
    ),
  )

  // The one real read of `FrameServices` in this repository, and the reason
  // mc-render's kernel mirror carries the Clock Port whole. Time comes from the
  // injected Port; plan.md §5.1-3 bans reading a global clock.
  it.effect('measures how stale the mirrored pose is, from the injected clock', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        yield* Ref.set(state.authoritativePose, pose)
        yield* stageById(stages, RENDER_STAGE_IDS.cameraMirror)
          .run(dt)
          .pipe(Effect.provide(FRAME_SERVICES))

        // Fixed clock reads 100; the pose was stamped at 99.5.
        expect(yield* Ref.get(state.mirrorLagSecs)).toBeCloseTo(0.5, 10)
      }),
    ),
  )

  it.effect('starts from a visibly-unset pose rather than a plausible one', () =>
    Effect.sync(() => {
      expect(UNSET_CAMERA_POSE.position).toStrictEqual(position(0, 0, 0))
      expect(UNSET_CAMERA_POSE.capturedAtSecs).toBe(0)
    }),
  )
})

describe('render:chunk-sync, render:draw and render:post-fx', () => {
  it.effect('borrows the per-frame visibility buffer and copies the result out of it', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        const stage = stageById(stages, RENDER_STAGE_IDS.chunkSync)

        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect(yield* Ref.get(state.visibleChunkCount)).toBe(1)

        // Run again: the buffer is CLEARED on borrow, so the count does not
        // accumulate. A stage that kept a reference across the frame boundary
        // is what `domain/frame-scratch.ts` exists to make impossible.
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect(yield* Ref.get(state.visibleChunkCount)).toBe(1)
        expect(state.scratch.visibleChunks.usageCount()).toBe(2)
        expect(state.scratch.visibleChunks.borrowedCount()).toBe(0)
      }),
    ),
  )

  it.effect('draws once per frame', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        const stage = stageById(stages, RENDER_STAGE_IDS.draw)
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect(yield* Ref.get(state.framesDrawn)).toBe(2)
      }),
    ),
  )

  it.effect('rebuilds the post-FX chain only when the quality settings change', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        const stage = stageById(stages, RENDER_STAGE_IDS.postFx)

        const before = yield* Ref.get(state.postFxChain)
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        // Same settings object: the chain is the SAME ARRAY, not an equal one.
        // Rebuilding every frame is the allocation plan.md §3.9 is about.
        expect(yield* Ref.get(state.postFxChain)).toBe(before)

        yield* Ref.set(state.quality, QUALITY_PRESETS.low)
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        const after = yield* Ref.get(state.postFxChain)
        expect(after).not.toBe(before)
        expect([...after]).toStrictEqual(['render', 'output'])
      }),
    ),
  )
})

describe('renderModule is a real GameModule', () => {
  // REGRESSION: kernel's `frameStages` is an Effect precisely so a module can
  // ACQUIRE a service in order to BUILD a stage, and mc-render is the case that
  // proved it necessary — `render:input` cannot exist without an InputService.
  //
  // Note the type parameters: `InputService` is in ROut and in RRegister, and
  // in NEITHER case in RIn. Collapsing RRegister into RIn would demand that a
  // host supply the very service this module ships.
  it.effect('registers its stages against the InputService it itself provides', () =>
    Effect.gen(function* () {
      const module = renderModule()
      const stages = yield* module.frameStages.pipe(Effect.provide(module.layers))

      expect(stages.map((stage) => stage.id)).toContain(RENDER_STAGE_IDS.input)
      expect(stages).toHaveLength(5)
    }),
  )

  it.effect('builds independent state per module, so two renderers cannot share a frame', () =>
    Effect.gen(function* () {
      // plan.md §3.8: app-scope singletons are among the reference's worst bug
      // sources — a second world load inherited the first's refs and deadlocked.
      // A renderer is the component most likely to be started twice, because
      // every per-screen preview starts one.
      const first = yield* makeRenderStagesForPreview().pipe(Effect.provide(InputServiceLayer()))
      const second = yield* makeRenderStagesForPreview().pipe(Effect.provide(InputServiceLayer()))

      yield* stageById(first.stages, RENDER_STAGE_IDS.draw)
        .run(dt)
        .pipe(Effect.provide(FRAME_SERVICES))

      expect(yield* Ref.get(first.state.framesDrawn)).toBe(1)
      expect(yield* Ref.get(second.state.framesDrawn)).toBe(0)
    }),
  )
})
