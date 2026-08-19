import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import {
  isMirrorStale,
  mirrorLagSecs,
  mirroredCameraState,
  type MirroredCameraState,
} from '../src/domain/camera-mirror'
import { type ChunkSyncPort } from '../src/application/world-sync'
import { NO_DRAW_TARGET, type DrawPort } from '../src/application/world-renderer'
import {
  GAMEPLAY_LISTENER_TARGET,
  HOTBAR_FOCUS_GROUP,
  MODAL_LISTENER_TARGET,
} from '../src/domain/input-bindings'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  position,
  StageId,
  type CameraPoseSnapshot,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { chainPasses, QUALITY_PRESETS } from '../src/domain/post-processing'
import {
  InputService,
  InputServiceLayer,
  type PointerLockPort,
  type PointerLockRequestOutcome,
} from '../src/application/input-service'
import {
  makeRenderFrameState,
  makeRenderStagesForPreview,
  renderModule,
  UNSET_CAMERA_POSE,
  type RenderFrameState,
} from '../src/stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  OWN_STAGE_PREFIX,
  RENDER_STAGE_IDS,
  UPSTREAM_STAGE_IDS,
} from '../src/stages/stage-ids'

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

/**
 * The same, with a pointer-lock port whose asks are counted.
 *
 * The port is how the request leaves this repository at all: mc-render ships no
 * `lib.DOM`, so `canvas.requestPointerLock()` cannot be called from here — and
 * Playwright cannot test pointer lock anyway (plan.md §3.10), which is what
 * makes a port the only shape this behaviour can be tested in.
 */
const withStagesUsingPointerLock = <A>(
  outcome: PointerLockRequestOutcome,
  use: (
    stages: ReadonlyArray<StageRegistration>,
    state: RenderFrameState,
    input: InputService['Type'],
    asked: Ref.Ref<number>,
  ) => Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const asked = yield* Ref.make(0)
    const port: PointerLockPort = {
      request: Ref.update(asked, (count) => count + 1).pipe(Effect.as(outcome)),
    }
    return yield* Effect.gen(function* () {
      const input = yield* InputService
      const { state, stages } = yield* makeRenderStagesForPreview()
      return yield* use(stages, state, input, asked)
    }).pipe(Effect.provide(InputServiceLayer(undefined, port)))
  })

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
  // is only a string at runtime while still coupling mc-render's frame position
  // to mx-ui's existence.
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
          RENDER_STAGE_IDS.chunkSync,
        ])
      }),
    ),
  )
})

describe('render:input', () => {
  it.effect('publishes movement and jump intents through the control port', () =>
    Effect.gen(function* () {
      const movement = yield* Ref.make({ forward: 0, strafe: 0 })
      const jump = yield* Ref.make(false)
      const control = {
        setMovementIntent: (intent: { readonly forward: number; readonly strafe: number }) =>
          Ref.set(movement, intent),
        setJumpIntent: (pressed: boolean) => Ref.set(jump, pressed),
      }
      const input = yield* InputService
      const { stages } = yield* makeRenderStagesForPreview({ control })

      yield* input.dispatch({ kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'keydown', code: 'KeyD', target: GAMEPLAY_LISTENER_TARGET })
      yield* input.dispatch({ kind: 'keydown', code: 'Space', target: GAMEPLAY_LISTENER_TARGET })
      yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

      expect(yield* Ref.get(movement)).toStrictEqual({ forward: 1, strafe: 1 })
      expect(yield* Ref.get(jump)).toBe(true)

      yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))
      expect(yield* Ref.get(jump)).toBe(false)
    }).pipe(Effect.provide(InputServiceLayer())),
  )

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

  // The other half of DN-12. `uiClicks` recorded the click that re-acquires the
  // pointer lock and NOTHING acted on it, so a preview could show the world and
  // never enter mouselook. The frame is where the click is acted on: `dispatch`
  // runs inside a DOM event handler and must only record, and a service that
  // grabbed the pointer by itself would take it from a preview that only wanted
  // to read input.
  it.effect('a UI click ASKS for the pointer lock — the consumer uiClicks never had', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        // Unlocked, so this is a UI click and not an attack (DN-12).
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
        expect(yield* input.pointerLockState).toBe('unlocked')

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(1)
        // ASKED, not granted. The browser answers with an event.
        expect(yield* input.pointerLockState).toBe('requested')
        expect((yield* input.snapshot).pointerLocked).toBe(false)

        yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
        expect((yield* input.snapshot).pointerLocked).toBe(true)
      }),
    ),
  )

  // ---------------------------------------------------------------------------
  // DN-16 §5(b): WHERE the click landed
  // ---------------------------------------------------------------------------
  //
  // The frame is where the hazard was reachable, because the frame is what
  // ASKS. `acquiresPointerLock` was `(button, state)`, so every unlocked left
  // click looked identical to it — including the one the player aimed at their
  // own hotbar. Each of the three landings gets its own test, so a failure
  // names the case that broke rather than "pointer lock".

  it.effect('DN-16 §5(b): a click on a REGISTERED UI ELEMENT does not ask for the lock', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        // The hazard, exactly: `tabindex="-1"` focuses on click, so the ring
        // lights — and the same `mousedown` bubbles to `window`.
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(0)
        expect(yield* input.pointerLockState).toBe('unlocked')
      }),
    ),
  )

  it.effect('DN-16 §5(b): the same click IS still a uiClick — the menu that drew the slot wants it', () =>
    withStagesUsingPointerLock('sent', (stages, state, input, asked) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

        // Read BEFORE the stage, because `endFrame` clears the edge.
        expect(yield* input.wasUiClick('MouseLeft')).toBe(true)

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        // The frame saw it as a UI click, and it carries where it landed.
        const sampled = yield* Ref.get(state.input)
        expect([...sampled.uiClicks]).toStrictEqual(['MouseLeft'])
        expect(sampled.uiClickLandings).toStrictEqual([{ button: 'MouseLeft', landing: 'ui' }])
        // Filtering the click out of `uiClicks` instead would have hidden it
        // from the very UI that drew the element it landed on.
        expect(yield* Ref.get(asked)).toBe(0)
      }),
    ),
  )

  it.effect('DN-16 §5(b): a click on the LOCK TARGET does ask — the fix did not break mouselook', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(1)
        expect(yield* input.pointerLockState).toBe('requested')
      }),
    ),
  )

  it.effect('DN-16 §5(b): a click on NEITHER asks for nothing — the rule is "on the lock target"', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        // The third case, and the one that decides which predicate this is. The
        // letterbox beside a fixed-aspect canvas, the page background, a header
        // the host drew and did not declare: none of them are UI this
        // repository was told about, and `landing !== 'ui'` would have granted
        // the pointer to every one of them.
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'elsewhere' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(0)
        expect(yield* input.pointerLockState).toBe('unlocked')
      }),
    ),
  )

  it.effect('DN-16 §5(b): the ring survives a HUD click, and only a canvas click masks it', () =>
    withStagesUsingPointerLock('sent', (stages, state, input, asked) =>
      Effect.gen(function* () {
        // The visible half of the hazard. The player Tabs to slot 3, the ring
        // lights, they click that slot — and used to be thrown into mouselook,
        // which masked the ring the click had just lit. Two symptoms, one
        // cause, and this is the one the player actually sees.
        yield* input.dispatch({
          kind: 'focuschange',
          focus: { group: HOTBAR_FOCUS_GROUP, index: 3 },
        })
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'ui' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(0)
        expect((yield* Ref.get(state.input)).keyboardFocus).toStrictEqual({
          group: HOTBAR_FOCUS_GROUP,
          index: 3,
        })

        // And the mask is not broken either: a click that SHOULD lock still
        // masks it, so this test cannot pass by the report having stopped
        // following the lock state at all.
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))
        yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(1)
        expect((yield* Ref.get(state.input)).keyboardFocus).toBeUndefined()

        // Masked, not forgotten (DN-16 §3): unlocking reports slot 3 again.
        yield* input.dispatch({ kind: 'pointerlockchange', locked: false })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect((yield* Ref.get(state.input)).keyboardFocus).toStrictEqual({
          group: HOTBAR_FOCUS_GROUP,
          index: 3,
        })
      }),
    ),
  )

  it.effect('a REFUSED request is still refused on the next frame, for the UI to draw', () =>
    withStagesUsingPointerLock('sent', (stages, state, input, asked) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        yield* input.dispatch({ kind: 'pointerlockerror' })
        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        // The frame that draws the "click to look around" hint reads this.
        expect((yield* Ref.get(state.input)).pointerLockState).toBe('refused')
        // ...and the frame with no click in it did not ask again.
        expect(yield* Ref.get(asked)).toBe(1)
      }),
    ),
  )

  it.effect('a click while ALREADY locked is a game action and asks for nothing', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(0)
      }),
    ),
  )

  it.effect('an unlocked RIGHT click does not grab the pointer out from under a menu', () =>
    withStagesUsingPointerLock('sent', (stages, _state, input, asked) =>
      Effect.gen(function* () {
        yield* input.dispatch({ kind: 'mousedown', button: 'MouseRight', target: GAMEPLAY_LISTENER_TARGET, landing: 'lock-target' })

        yield* stageById(stages, RENDER_STAGE_IDS.input).run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(asked)).toBe(0)
        expect(yield* input.pointerLockState).toBe('unlocked')
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
  // mc-kernel's published FrameServices contract carries the Clock Port. Time comes from the
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

  it.effect('can seed the mirror from an authoritative initial pose', () =>
    Effect.gen(function* () {
      const state = yield* makeRenderFrameState(QUALITY_PRESETS.high, pose)

      expect(yield* Ref.get(state.authoritativePose)).toStrictEqual(pose)
      expect(yield* Ref.get(state.mirroredCamera)).toStrictEqual(mirroredCameraState(pose))
      expect(yield* Ref.get(state.mirrorLagSecs)).toBe(0)
    }),
  )

  it.effect('before a pose arrives, startup mirror and gauge agree on unpublished state', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        const before = yield* Ref.get(state.mirrorLagSecs)
        const mirrored = yield* Ref.get(state.mirroredCamera)

        expect(before).toBe(Number.POSITIVE_INFINITY)
        expect(mirrored.sourceCapturedAtSecs).toBeUndefined()
        expect(isMirrorStale(mirrored, MonotonicTimeSecs(100))).toBe(true)
        expect(mirrorLagSecs(mirrored, MonotonicTimeSecs(100))).toBe(
          Number.POSITIVE_INFINITY,
        )

        yield* stageById(stages, RENDER_STAGE_IDS.cameraMirror)
          .run(dt)
          .pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(state.mirrorLagSecs)).toBe(
          mirrorLagSecs(yield* Ref.get(state.mirroredCamera), MonotonicTimeSecs(100)),
        )
      }),
    ),
  )
})

describe('render:chunk-sync, render:draw and render:post-fx', () => {
  it.effect('runs the injected chunk-sync port once per stage execution', () =>
    Effect.gen(function* () {
      const updates = yield* Ref.make(0)
      const chunkSync: ChunkSyncPort = {
        update: Ref.update(updates, (count) => count + 1).pipe(
          Effect.as({ meshed: 0, deferred: 0, removed: 0 }),
        ),
      }

      yield* Effect.gen(function* () {
        const { stages } = yield* makeRenderStagesForPreview({ chunkSync })
        const stage = stageById(stages, RENDER_STAGE_IDS.chunkSync)

        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect(yield* Ref.get(updates)).toBe(1)
      }).pipe(Effect.provide(InputServiceLayer()))
    }),
  )

  it.effect('runs with the default no-op chunk-sync port', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        const stage = stageById(stages, RENDER_STAGE_IDS.chunkSync)

        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        expect(yield* Ref.get(state.visibleChunkCount)).toBe(0)
        expect(state.scratch.visibleChunks.usageCount()).toBe(0)
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

  it.effect('render:draw hands the DrawPort the mirrored camera, once per frame', () =>
    Effect.gen(function* () {
      // The stage is no longer a counter: it calls a `DrawPort`, and in a
      // browser that port is `application/world-renderer.ts`'s. What is checked
      // here is the WIRING — that the stage reaches the port at all, exactly
      // once, and with the right value. What the port then does to a GPU is
      // `test/world-renderer.test.ts`'s and, for anything visual,
      // mc-compose's `pnpm e2e:browser`.
      const drawn = yield* Ref.make<ReadonlyArray<MirroredCameraState>>([])
      const port: DrawPort = {
        draw: (camera) => Ref.update(drawn, (seen) => [...seen, camera]),
        resize: () => Effect.void,
        setPostProcessingChain: () => Effect.void,
      }

      yield* Effect.gen(function* () {
        const { state, stages } = yield* makeRenderStagesForPreview({ draw: port })
        const stage = stageById(stages, RENDER_STAGE_IDS.draw)

        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(drawn)).toHaveLength(2)
        expect(yield* Ref.get(state.framesDrawn)).toBe(2)
      }).pipe(Effect.provide(InputServiceLayer()))
    }),
  )

  it.effect('REGRESSION: it draws the MIRRORED camera and not the authoritative pose', () =>
    Effect.gen(function* () {
      // The two differ by exactly the cosmetic view offset, and a renderer
      // handed the raw pose would draw a correct-looking world with the view
      // bob silently switched off — nothing would fail and no test that only
      // counted frames could tell. `domain/camera-mirror.ts` composes the
      // offset into the mirrored VALUE; this asserts the stage reads that one.
      const drawn = yield* Ref.make<ReadonlyArray<MirroredCameraState>>([])
      const port: DrawPort = {
        draw: (camera) => Ref.update(drawn, (seen) => [...seen, camera]),
        resize: () => Effect.void,
        setPostProcessingChain: () => Effect.void,
      }

      yield* Effect.gen(function* () {
        const { state, stages } = yield* makeRenderStagesForPreview({ draw: port })

        yield* Ref.set(state.authoritativePose, {
          position: position(0, 64, 0),
          yawRadians: 0,
          pitchRadians: 0,
          capturedAtSecs: MonotonicTimeSecs(1),
        })
        yield* Ref.set(state.viewOffset, { right: 0, up: 0.5, rollRadians: 0 })

        // The mirror stage is what composes the two; draw must read its output.
        yield* stageById(stages, RENDER_STAGE_IDS.cameraMirror)
          .run(dt)
          .pipe(Effect.provide(FRAME_SERVICES))
        yield* stageById(stages, RENDER_STAGE_IDS.draw)
          .run(dt)
          .pipe(Effect.provide(FRAME_SERVICES))

        const seen = yield* Ref.get(drawn)
        expect(seen[0]?.position.y).toBe(64.5)
        expect(seen[0]).toStrictEqual(yield* Ref.get(state.mirroredCamera))
      }).pipe(Effect.provide(InputServiceLayer()))
    }),
  )

  it.effect('with no DrawPort the stage still runs, and has genuinely not drawn', () =>
    withStages((stages, state) =>
      Effect.gen(function* () {
        // `NO_DRAW_TARGET` is the default, and it is the common case: every
        // Node test, `apps/preview-render`, and any consumer composing the
        // module to inspect the frame order. A stage that required a renderer
        // would make the module unregisterable outside a browser.
        //
        // `framesDrawn` counts the STAGE and rises anyway; nothing anywhere
        // claims a frame reached a GPU.
        const stage = stageById(stages, RENDER_STAGE_IDS.draw)
        yield* stage.run(dt).pipe(Effect.provide(FRAME_SERVICES))

        expect(yield* Ref.get(state.framesDrawn)).toBe(1)
        expect(NO_DRAW_TARGET.draw(yield* Ref.get(state.mirroredCamera))).toBeDefined()
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
        expect(chainPasses(after)).toStrictEqual(['render', 'output'])
        // The state holds STEPS, not bare passes: `high` and `ultra` share a
        // pass order and differ only in what `composite` composites, so a Ref
        // of pass names could not tell the two presets apart at all.
        expect(chainPasses(before)).toStrictEqual(['render', 'gtao', 'composite', 'smaa', 'output'])
        expect(before.find((entry) => entry.pass === 'composite')?.effects).toStrictEqual(['bloom'])
      }),
    ),
  )

  it.effect('forwards the selected post-FX chain to the DrawPort', () =>
    Effect.gen(function* () {
      const received = yield* Ref.make<ReadonlyArray<string>>([])
      const draw: DrawPort = {
        draw: () => Effect.void,
        resize: () => Effect.void,
        setPostProcessingChain: (chain) =>
          Ref.set(received, chain.map((step) => step.pass)),
      }
      const { stages } = yield* makeRenderStagesForPreview({ draw }).pipe(
        Effect.provide(InputServiceLayer()),
      )

      yield* stageById(stages, RENDER_STAGE_IDS.postFx)
        .run(dt)
        .pipe(Effect.provide(FRAME_SERVICES))

      expect(yield* Ref.get(received)).toStrictEqual([
        'render',
        'gtao',
        'composite',
        'smaa',
        'output',
      ])
    }),
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

  it.effect('defaults the public module to an unpublished startup mirror', () =>
    Effect.gen(function* () {
      const drawn = yield* Ref.make<ReadonlyArray<MirroredCameraState>>([])
      const draw: DrawPort = {
        draw: (camera) => Ref.update(drawn, (seen) => [...seen, camera]),
        resize: () => Effect.void,
        setPostProcessingChain: () => Effect.void,
      }
      const module = renderModule(QUALITY_PRESETS.high, undefined, draw)
      const stages = yield* module.frameStages.pipe(Effect.provide(module.layers))

      yield* stageById(stages, RENDER_STAGE_IDS.cameraMirror)
        .run(dt)
        .pipe(Effect.provide(FRAME_SERVICES))
      yield* stageById(stages, RENDER_STAGE_IDS.draw)
        .run(dt)
        .pipe(Effect.provide(FRAME_SERVICES))

      const [camera] = yield* Ref.get(drawn)
      expect(camera?.sourceCapturedAtSecs).toBeUndefined()
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
