/**
 * Mc-render's contribution to the frame (plan.md §4.1).
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 *
 * `InputService.endFrame` (`../application/input-service.ts`) clears the
 * per-frame input edges and must be called exactly once per frame. Anything
 * that must happen exactly once per frame IS a stage.
 *
 * Until this file existed, the only registered input stage in the entire
 * 16-repository roster was `input:sample` in `mc-playground-kit` — which is
 * developer tooling and is excluded from runtime `dependencies`. The SHIPPED build therefore had
 * no input stage: `justPressed` would never clear, and one press of the
 * inventory key would re-fire on every frame it was held. plan.md §2.3-2 was
 * written to prevent exactly that, and it had been reintroduced by a missing
 * stage rather than by a misplaced service.
 *
 * See `stage-ids.ts` for why the other four stages belong here too.
 *
 * ---------------------------------------------------------------------------
 * `frameStages` is an Effect, and this repository is why
 * ---------------------------------------------------------------------------
 *
 * `renderStages` cannot be a constant: `render:input` is meaningless without an
 * `InputService`, so building it requires ACQUIRING one. That is the case that
 * settled `mc-kernel`'s `GameModule.frameStages` — with a plain array there was
 * no context in which to acquire anything, so every service any stage touched
 * had to be reachable from `run`, i.e. had to live in `FrameServices`. See
 * `mc-kernel/domain/frame.ts` and its freeze checklist (b).
 *
 * `InputService` is also the reason `RRegister` is a separate parameter from
 * `RIn`: mc-render PROVIDES `InputService` (it is in `ROut`) and needs it to
 * register. Folding the two together would say the module cannot be built until
 * something else supplies what it itself ships.
 *
 * ---------------------------------------------------------------------------
 * What is FIRST CUT here, and what is not
 * ---------------------------------------------------------------------------
 *
 * The frame POSITIONS and the ordering edges are settled — that is what
 * mc-compose needs and it does not change when the bodies fill in.
 *
 * The bodies that need a service this repository cannot yet reach are marked
 * FIRST CUT and do the minimum, exactly as `mx-gameplay/stages/registration.ts`
 * does. Nothing here invents a cross-repository dependency: mc-sim and
 * mc-meshing are declared parents of mc-render but nothing is published yet
 * (plan.md §6 Step 3 is bottom-up publish-then-pin), so where a stage would
 * read one it reads a `Ref` that a preview or a test fills instead. An invented
 * local port would be a second answer to "who owns the camera pose", which is
 * the inversion plan.md §3.8 records as the reference's worst structural bug.
 */
import {
  type CameraPoseSnapshot,
  type GameModule,
  MonotonicTimeSecs,
  type StageRegistration,
  monotonicSecs,
  position,
} from '@nerima-games/mc-kernel'
import { type ChunkSyncPort, NO_CHUNK_SYNC } from '../application/world-sync'
import { type DrawPort, NO_DRAW_TARGET } from '../application/world-renderer'
import { Effect, Ref } from 'effect'
import { type FrameScratch, makeFrameScratch } from '../domain/frame-scratch'
import {
  type GraphicsQuality,
  type PostProcessingStep,
  QUALITY_PRESETS,
  buildPostProcessingChain,
} from '../domain/post-processing'
import {
  InputService,
  type InputServiceApi,
  InputServiceLayer,
  type InputSnapshot,
  type PointerLockPort,
  UNAVAILABLE_POINTER_LOCK,
} from '../application/input-service'
import {
  type MirroredCameraState,
  NO_VIEW_OFFSET,
  type ViewOffset,
  mirrorLagSecs,
  mirroredCameraState,
} from '../domain/camera-mirror'
import { type MouseButton, acquiresPointerLock, defaultBindings } from '../domain/input-bindings'
import { NO_PLAYER_CONTROL, type PlayerControlPort } from '../domain/player-control'
import { RENDER_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

/* Shared numeric building blocks for the explicit display/test fixture and
 * frame-local diagnostics. Each name is the specific domain quantity zero
 * represents here, not a bare literal repeated for its own sake. */
const UNSET_POSE_CAPTURED_AT_SECS = 0
const WORLD_ORIGIN_AXIS = 0
const INITIAL_VISIBLE_CHUNK_COUNT = 0
const INITIAL_FRAMES_DRAWN = 0
const FRAMES_DRAWN_INCREMENT = 1

/**
 * An explicit display/test fixture for a renderer before mc-sim has said
 * anything. It is not the default frame state.
 *
 * Deliberately the origin looking down -Z rather than a plausible spawn point.
 * A renderer that draws this is drawing "no pose has arrived yet", and making
 * that visibly wrong is better than making it plausibly wrong.
 */
export const UNSET_CAMERA_POSE: CameraPoseSnapshot = {
  capturedAtSecs: MonotonicTimeSecs(UNSET_POSE_CAPTURED_AT_SECS),
  pitchRadians: 0,
  position: position(WORLD_ORIGIN_AXIS, WORLD_ORIGIN_AXIS, WORLD_ORIGIN_AXIS),
  yawRadians: 0,
}

/**
 * Frame-local renderer state.
 *
 * Every field here fails the save-file test that `mx-gameplay` states in its
 * own registration module: losing all of it on a reload costs one frame of
 * catch-up and nothing else. The authoritative camera pose is mc-sim's, the
 * blocks are mc-worldgen's, and the meshes are mc-meshing's; what lives here is
 * the renderer's view OF those, which is derived by definition.
 */
export type RenderFrameState = {
  /** Pre-allocated per-frame buffers. See `domain/frame-scratch.ts` on why. */
  readonly scratch: FrameScratch
  /**
   * The authoritative pose, as most recently handed over.
   *
   * FIRST CUT: written by whoever drives the frame. When mc-sim is published
   * this is read from `PlayerService.cameraPose` at registration time and this
   * `Ref` becomes an implementation detail of the previews. It is a COPY, never
   * a live handle — mc-render reads the pose and must never hold a mutable
   * reference to somebody else's state (plan.md §5.1-2).
   */
  readonly authoritativePose: Ref.Ref<CameraPoseSnapshot | undefined>
  /** Cosmetic displacement applied at mirror time. Never fed back. */
  readonly viewOffset: Ref.Ref<ViewOffset>
  /** What a THREE camera would be set to. Derived; never read by anything else. */
  readonly mirroredCamera: Ref.Ref<MirroredCameraState>
  /**
   * How far behind the simulation the mirrored pose was, last frame.
   *
   * Diagnostics, and the reason `render:camera-mirror` reads the clock: the
   * renderer decides whether to interpolate or stall from this rather than
   * drawing a stale pose and finding out from a bug report.
   */
  readonly mirrorLagSecs: Ref.Ref<number | undefined>
  /** This frame's input, sampled once. See `render:input` below. */
  readonly input: Ref.Ref<InputSnapshot>
  /**
   * How many chunks last frame's visibility pass kept.
   *
   * Copied OUT of the scratch buffer, never a reference into it — see
   * `domain/frame-scratch.ts` on why holding the buffer across a frame boundary
   * is the bug that module exists to make impossible.
   */
  readonly visibleChunkCount: Ref.Ref<number>
  readonly quality: Ref.Ref<GraphicsQuality>
  /**
   * The post-FX chain built for `quality`. Rebuilt only when quality changes.
   *
   * Steps, not bare passes: `high` and `ultra` produce the same PASS order and
   * differ only in what the `composite` step composites, so a chain that
   * carried the order alone could not tell the two apart. See
   * `domain/post-processing.ts`.
   */
  readonly postFxChain: Ref.Ref<ReadonlyArray<PostProcessingStep>>
  /** The quality object `postFxChain` was built from. Compared by reference. */
  readonly postFxBuiltFrom: Ref.Ref<GraphicsQuality>
  /** Frames drawn. Diagnostics only. */
  readonly framesDrawn: Ref.Ref<number>
}

/**
 * The three quality-derived refs, built together: `postFxChain` and
 * `postFxBuiltFrom` only mean anything once `quality` exists, so splitting
 * their construction across separate top-level statements in
 * `makeRenderFrameState` would say they are independent when they are not.
 */
const makeQualityState = (
  quality: GraphicsQuality,
): Effect.Effect<{
  readonly qualityRef: Ref.Ref<GraphicsQuality>
  readonly postFxChain: Ref.Ref<ReadonlyArray<PostProcessingStep>>
  readonly postFxBuiltFrom: Ref.Ref<GraphicsQuality>
}> =>
  Effect.gen(function* () {
    const qualityRef = yield* Ref.make(quality)
    const postFxChain = yield* Ref.make(buildPostProcessingChain(quality))
    const postFxBuiltFrom = yield* Ref.make(quality)
    return { postFxBuiltFrom, postFxChain, qualityRef }
  })

/**
 * An Effect rather than a constant, so a test, each preview and the game can
 * hold their own.
 *
 * plan.md §3.8 records app-scope singletons as among the reference's worst bug
 * sources: a second world load inherited the first world's fibers and refs and
 * deadlocked. Re-entrant initialisation from the start is cheaper than
 * retrofitting it — and a renderer is the component most likely to be started
 * twice, because every per-screen preview starts one.
 */
export const makeRenderFrameState = (
  quality: GraphicsQuality = QUALITY_PRESETS.high,
  /**
   * Where the camera starts.
   *
   * `undefined` means mc-sim has not published a pose yet. The mirrored camera
   * keeps that pending state, with no synthetic timestamp or lag measurement.
   * An explicit pose is useful for deterministic host and test setup; choosing
   * a player's spawn point remains mc-sim's responsibility.
   */
  initialPose: CameraPoseSnapshot | undefined = undefined,
): Effect.Effect<RenderFrameState> =>
  Effect.gen(function* () {
    const authoritativePose = yield* Ref.make(initialPose)
    const viewOffset = yield* Ref.make(NO_VIEW_OFFSET)
    const mirroredCamera = yield* Ref.make(mirroredCameraState(initialPose))
    const lag = yield* Ref.make<number | undefined>(undefined)
    const input = yield* Ref.make<InputSnapshot>({
      gamepadAxes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
      justPressed: new Set<string>(),
      // No keyboard focus until the browser says otherwise. `undefined` and NOT
      // Slot 0: mx-ui hides every ring for `undefined` and lights slot 0 for
      // `0`, so a frame that has heard nothing must say nothing.
      keyboardFocus: undefined,
      pointerDelta: { x: 0, y: 0 },
      pointerLockState: 'unlocked',
      pointerLocked: false,
      pressed: new Set<string>(),
      uiClickLandings: [],
      uiClicks: new Set<MouseButton>(),
      wheelNotches: 0,
      wheelSteps: 0,
    })
    const visibleChunkCount = yield* Ref.make(INITIAL_VISIBLE_CHUNK_COUNT)
    const { postFxBuiltFrom, postFxChain, qualityRef } = yield* makeQualityState(quality)
    const framesDrawn = yield* Ref.make(INITIAL_FRAMES_DRAWN)

    return {
      authoritativePose,
      framesDrawn,
      input,
      mirrorLagSecs: lag,
      mirroredCamera,
      postFxBuiltFrom,
      postFxChain,
      quality: qualityRef,
      scratch: makeFrameScratch(),
      viewOffset,
      visibleChunkCount,
    }
  })

/**
 * The five stages mc-render registers.
 *
 * Note what is NOT here: any resolution of a total order. Each registration
 * carries `after` constraints and nothing more; mc-compose topologically sorts
 * the union of every module's registrations (plan.md §2.3-3, §4.2). The array
 * order below is for human reading only, and
 * `test/stage-registration.test.ts` asserts that the declared constraints — not
 * the array order — are what carry the meaning.
 */
export type RenderStagesOptions = {
  readonly state: RenderFrameState
  readonly input: InputServiceApi
  /**
   * Where `render:draw` draws. Defaults to "this platform has no GPU", which is
   * the common case: every Node test, `apps/preview-render`, and any consumer
   * composing the module to inspect the frame order.
   *
   * A parameter and not a service, for the reason `PointerLockPort` is one —
   * `application/world-renderer.ts` needs a canvas and a `three` namespace, and
   * neither can be reached from a Layer this repository is able to build.
   */
  readonly draw?: DrawPort
  readonly control?: PlayerControlPort
  readonly chunkSync?: ChunkSyncPort
}

export const renderStages = ({
  state,
  input,
  draw = NO_DRAW_TARGET,
  control = NO_PLAYER_CONTROL,
  chunkSync = NO_CHUNK_SYNC,
}: RenderStagesOptions): ReadonlyArray<StageRegistration> => [
  {
    id: RENDER_STAGE_IDS.input,
    // No `after`. Input is sampled before anything reacts to it, and where that
    // Lands in the frame is mc-compose's to decide — its skeleton claims the
    // NAME half of this id (`input`) for the first phase.
    run: () =>
      Effect.gen(function* () {
        // Sample FIRST, then close the edges. The two halves are one stage on
        // Purpose: `snapshot` reads `justPressed`, `endFrame` clears it, and
        // Anything that ran between them would see the edge either twice or
        // Never depending on where the scheduler put it. Keeping them adjacent
        // Makes "exactly once per frame" a property of one function body rather
        // Than of the stage order.
        const sampled = yield* input.snapshot
        yield* Ref.set(state.input, sampled)

        const [forward, backward, left, right, jump] = yield* Effect.all([
          input.isActionActive('moveForward'),
          input.isActionActive('moveBackward'),
          input.isActionActive('moveLeft'),
          input.isActionActive('moveRight'),
          input.wasActionJustTriggered('jump'),
        ])
        yield* control.setMovementIntent({
          forward: Number(forward) - Number(backward),
          strafe: Number(right) - Number(left),
        })
        yield* control.setJumpIntent(jump)

        // The consumer `uiClicks` did not have. A click that arrives while the
        // Pointer is unlocked is the player asking to look around again, and
        // Until this line the service recorded it and nothing acted on it — so
        // A preview could start, show the world, and never enter mouselook.
        //
        // In the FRAME, between sampling and `endFrame`, because that is where
        // The edge is still readable and where it is guaranteed to be read
        // Exactly once. Not in `dispatch`: `dispatch` runs inside a DOM event
        // Handler and asking for the lock is a decision, not an event record —
        // And a service that grabbed the pointer by itself would take it from a
        // Preview that only wanted to inspect input.
        //
        // `acquiresPointerLock` is the policy (left button only, ON THE LOCK
        // TARGET only, and not while a request is already pending);
        // `requestPointerLock` is idempotent anyway, so a second click within
        // The same frame costs nothing.
        //
        // `uiClickLandings` and not `uiClicks`, and that is DN-16 §5(b): a set
        // Of buttons cannot say that this click was on the canvas and that one
        // Was on a hotbar slot, so the frame used to ask for the pointer on
        // Behalf of a player who had clicked their own HUD — lighting the focus
        // Ring and then masking it in the same frame.
        const lockState = yield* input.pointerLockState
        const acquiring = sampled.uiClickLandings.some(({ button, landing }) =>
          acquiresPointerLock(button, lockState, landing),
        )
        if (acquiring) {
          yield* input.requestPointerLock
        }

        // `sampled`, not a fresh read: `endFrame` consumes the whole wheel
        // Notches THIS FRAME WAS TOLD ABOUT, and `sampled` is that reading. A
        // Wheel event that lands between the two lines above and this one — and
        // A DOM listener runs exactly there — must not be consumed by a frame
        // That never saw it. See `endFrame` in `application/input-service.ts`.
        //
        // Handing back the same value the stage published to `state.input` is
        // Also what makes "sampling and clearing are ONE stage" mean something
        // Stronger than adjacency: the two halves now agree on a VALUE, not
        // Merely on an ordering.
        yield* input.endFrame(sampled)
      }),
  },
  {
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    id: RENDER_STAGE_IDS.cameraMirror,
    // Mirroring a pre-integration pose is a one-frame lag on the view, which
    // Reads as input latency rather than as a bug and is therefore the kind of
    // Thing nobody files.
    run: () =>
      Effect.gen(function* () {
        // FIRST CUT: the snapshot comes from a Ref. When mc-sim is published,
        // `PlayerService` is acquired in `renderModule` below and this reads
        // `player.cameraPose` — which is an `Effect<_, never, ClockPort>`, and
        // `ClockPort` is exactly what `FrameServices` already provides. That is
        // The measurement that let `FrameServices` freeze at `ClockPort`.
        const pose = yield* Ref.get(state.authoritativePose)
        const offset = yield* Ref.get(state.viewOffset)
        const mirrored = mirroredCameraState(pose, offset)
        yield* Ref.set(state.mirroredCamera, mirrored)

        // The one real read of `FrameServices` in this repository. Time comes
        // From the injected Port; plan.md §5.1-3 bans reading a global clock
        // The injected Port keeps the stage deterministic and testable.
        const now = yield* monotonicSecs
        yield* Ref.set(state.mirrorLagSecs, mirrorLagSecs(mirrored, now))
      }),
  },
  {
    after: [RENDER_STAGE_IDS.cameraMirror],
    id: RENDER_STAGE_IDS.chunkSync,
    // After the camera mirror because visibility is decided against THIS
    // Frame's view. Culling on last frame's camera is what makes chunks pop in
    // At the edge of the screen when the player turns.
    run: () =>
      Effect.gen(function* () {
        yield* chunkSync.update
      }),
  },
  {
    after: [RENDER_STAGE_IDS.chunkSync],
    id: RENDER_STAGE_IDS.draw,
    // THE THREE.js RENDERER CALL, and it is no longer a FIRST CUT: `draw` is a
    // `DrawPort`, and in a browser it is `application/world-renderer.ts`'s,
    // Which acquires a WebGL2 context and submits a frame.
    //
    // This is deliberately the ONLY place in the repository that touches a live
    // Camera object, and it sets that camera from `state.mirroredCamera` —
    // Never the other way round. The reference mutated the live camera for the
    // Attack-swing bob and restored it afterwards, and everything reading the
    // Camera in between got the bob pose; `domain/camera-mirror.ts` composes
    // The offset into a VALUE instead, which is why that window cannot exist
    // Here. The port's `draw` takes that value and cannot hand a camera back.
    run: () =>
      Effect.gen(function* () {
        // `state.mirroredCamera` and NOT `state.authoritativePose`: the pose is
        // Mc-sim's and the mirror is this repository's view of it, and drawing
        // The pose directly would skip the cosmetic offset — i.e. the view bob
        // Would stop working and nothing would fail.
        const camera = yield* Ref.get(state.mirroredCamera)
        yield* draw.draw(camera)
        // Counted whether or not anything was drawn, because this counter
        // Answers "did the stage run", which is a frame-loop question. What the
        // GPU was actually given is `WorldRenderer.framesRendered`, and the two
        // Differ by exactly the frames that ran without a renderer — which is
        // The distinction that makes a headless run legible rather than a lie.
        yield* Ref.update(state.framesDrawn, (drawn) => drawn + FRAMES_DRAWN_INCREMENT)
      }),
  },
  {
    after: [RENDER_STAGE_IDS.chunkSync],
    id: RENDER_STAGE_IDS.postFx,
    // Plan.md §3.9 fixes the chain's INTERNAL order; `domain/post-processing.ts`
    // Owns it and builds it in canonical order by construction. This stage
    // Selects the plan and hands it to the draw port; a browser host may
    // Translate it into EffectComposer passes, while headless ports stay no-op.
    run: () =>
      Effect.gen(function* () {
        const quality = yield* Ref.get(state.quality)
        const builtFrom = yield* Ref.get(state.postFxBuiltFrom)
        // Rebuild only when the settings object actually changed. Reference
        // Equality, not a deep compare: settings arrive as whole immutable
        // Records from the settings service, and a per-frame deep compare of a
        // Six-field object is exactly the kind of cost plan.md §3.9's
        // Pre-allocation notes are about.
        if (quality !== builtFrom) {
          yield* Ref.set(state.postFxChain, buildPostProcessingChain(quality))
          yield* Ref.set(state.postFxBuiltFrom, quality)
        }
        yield* draw.setPostProcessingChain(yield* Ref.get(state.postFxChain))
      }),
  },
]

/**
 * Mc-render as a `GameModule`.
 *
 * This IS kernel's `GameModule` — `layers` and an Effect-valued `frameStages` —
 * rather than the "stages only, the Layer comes later" shape the mx-*
 * repositories still use. mc-render can write the full thing because the one
 * service it provides is its own: `InputService`.
 *
 * Read the type parameters as the whole argument for `RRegister`:
 *
 *   ROut      = InputService   — mc-render provides it
 *   RIn       = never          — nothing has to be given for that Layer to build
 *   RRegister = InputService   — but registering `render:input` needs it
 *
 * `InputService` is in `ROut` AND in `RRegister`, and in neither case in `RIn`.
 * Collapsing `RRegister` into `RIn` would demand that a host supply the very
 * service this module ships.
 */
export const renderModule = (
  quality: GraphicsQuality = QUALITY_PRESETS.high,
  /**
   * How the host asks for the pointer lock. The default is "this platform has
   * none", which is true in Node and in any preview that has not wired a
   * canvas yet; a browser host passes a port that calls
   * `canvas.requestPointerLock()`. It is a parameter rather than a DOM call
   * inside the service for the reason `PointerLockPort` documents — this
   * repository ships no `lib.DOM`.
   */
  pointerLock: PointerLockPort = UNAVAILABLE_POINTER_LOCK,
  /**
   * Where `render:draw` draws. See `renderStages`.
   *
   * A browser host builds one with
   * `makeWorldRenderer(THREE, canvas, viewport)` and passes it here; everything
   * else leaves it at `NO_DRAW_TARGET`. It is the THIRD platform thing a host
   * supplies, after the clock and the input targets, and it is supplied the
   * same way for the same reason: this repository owns what to draw, and the
   * host owns what there is to draw ON.
   */
  draw: DrawPort = NO_DRAW_TARGET,
  /** Where the camera starts. `undefined` remains pending until mc-sim publishes a pose. */
  initialPose: CameraPoseSnapshot | undefined = undefined,
  control: PlayerControlPort = NO_PLAYER_CONTROL,
  chunkSync: ChunkSyncPort = NO_CHUNK_SYNC,
): GameModule<InputService, never, never, InputService> => ({
  frameStages: Effect.gen(function* () {
    const input = yield* InputService
    const state = yield* makeRenderFrameState(quality, initialPose)
    return renderStages({ chunkSync, control, draw, input, state })
  }),
  layers: InputServiceLayer(defaultBindings(), pointerLock),
})

/**
 * The module together with the state its stages close over.
 *
 * `renderModule` deliberately does not expose the state — a consumer that could
 * reach into it would be able to write the mirrored camera, which is the
 * inversion this repository exists to prevent. Previews and tests need it, so
 * they get it here, explicitly, and the name says what it is for.
 */
export type MakeRenderStagesForPreviewOptions = {
  readonly quality?: GraphicsQuality
  readonly draw?: DrawPort
  readonly control?: PlayerControlPort
  readonly chunkSync?: ChunkSyncPort
}

export const makeRenderStagesForPreview = ({
  quality = QUALITY_PRESETS.high,
  draw = NO_DRAW_TARGET,
  control = NO_PLAYER_CONTROL,
  chunkSync = NO_CHUNK_SYNC,
}: MakeRenderStagesForPreviewOptions = {}): Effect.Effect<
  { readonly state: RenderFrameState; readonly stages: ReadonlyArray<StageRegistration> },
  never,
  InputService
> =>
  Effect.gen(function* () {
    const input = yield* InputService
    const state = yield* makeRenderFrameState(quality)
    return { stages: renderStages({ chunkSync, control, draw, input, state }), state }
  })

/**
 * There is deliberately NO `RenderRegistrationLayer`.
 *
 * There used to be one, and it was a trap in two independent ways:
 *
 *   export const RenderRegistrationLayer: Layer.Layer<InputService> = InputServiceLayer()
 *
 * FIRST, it took no arguments, so it built a service with `defaultBindings()`
 * and `UNAVAILABLE_POINTER_LOCK` while `renderModule(quality, pointerLock)`
 * builds `InputServiceLayer(defaultBindings(), pointerLock)`. A host following
 * the doc registered its five stages against a DIFFERENT `InputService` from
 * the one its Layer provides — the stage closes over the instance it saw in
 * `renderStages(state, input)` — so the DOM events the adapter dispatched into
 * the real service were invisible to `render:input`, the player's persisted
 * bindings were ignored, and `requestPointerLock` answered `refused` without
 * ever reaching the host's port.
 *
 * SECOND, and this is why it could not be repaired by taking the arguments:
 * `InputServiceLayer` is `Layer.effect`, so it builds a FRESH service per
 * `Effect.provide`. Even the correct Layer, provided twice — once for the
 * registration and once for the frame loop — is two machines. Any standalone
 * Layer constant or Layer-returning function invites exactly that, because
 * having it in hand is an invitation to provide it separately.
 *
 * A `GameModule` is the shape that makes the mistake unwritable: a host
 * provides `module.layers` ONCE, and takes `frameStages` from inside that same
 * provide. `makeRenderStagesForPreview` above is the same discipline for a
 * preview or a test — it runs IN the context, and cannot bring its own.
 */
