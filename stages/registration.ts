/**
 * mc-render's contribution to the frame (plan.md §4.1).
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
 * developer tooling and is banned from `dependencies` by rule 6 of
 * `../scripts/check-dependency-whitelist.ts`. The SHIPPED build therefore had
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
import { Effect, Layer, Ref } from 'effect'
import {
  InputService,
  InputServiceLayer,
  type InputServiceApi,
  type InputSnapshot,
} from '../application/input-service'
import {
  mirroredCameraState,
  mirrorLagSecs,
  NO_VIEW_OFFSET,
  type MirroredCameraState,
  type ViewOffset,
} from '../domain/camera-mirror'
import { makeFrameScratch, withScratch, type FrameScratch } from '../domain/frame-scratch'
import {
  monotonicSecs,
  MonotonicTimeSecs,
  position,
  type CameraPoseSnapshot,
  type GameModule,
  type StageRegistration,
} from '../domain/kernel-vocabulary'
import {
  buildPostProcessingChain,
  QUALITY_PRESETS,
  type GraphicsQuality,
  type PostProcessingPass,
} from '../domain/post-processing'
import { RENDER_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

/**
 * The pose a renderer mirrors before mc-sim has said anything.
 *
 * Deliberately the origin looking down -Z rather than a plausible spawn point.
 * A renderer that draws this is drawing "no pose has arrived yet", and making
 * that visibly wrong is better than making it plausibly wrong.
 */
export const UNSET_CAMERA_POSE: CameraPoseSnapshot = {
  position: position(0, 0, 0),
  yawRadians: 0,
  pitchRadians: 0,
  capturedAtSecs: MonotonicTimeSecs(0),
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
  readonly authoritativePose: Ref.Ref<CameraPoseSnapshot>
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
  readonly mirrorLagSecs: Ref.Ref<number>
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
  /** The post-FX chain built for `quality`. Rebuilt only when quality changes. */
  readonly postFxChain: Ref.Ref<ReadonlyArray<PostProcessingPass>>
  /** The quality object `postFxChain` was built from. Compared by reference. */
  readonly postFxBuiltFrom: Ref.Ref<GraphicsQuality>
  /** Frames drawn. Diagnostics only. */
  readonly framesDrawn: Ref.Ref<number>
}

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
): Effect.Effect<RenderFrameState> =>
  Effect.gen(function* () {
    const authoritativePose = yield* Ref.make(UNSET_CAMERA_POSE)
    const viewOffset = yield* Ref.make(NO_VIEW_OFFSET)
    const mirroredCamera = yield* Ref.make(mirroredCameraState(UNSET_CAMERA_POSE))
    const lag = yield* Ref.make(0)
    const input = yield* Ref.make<InputSnapshot>({
      pressed: new Set<string>(),
      justPressed: new Set<string>(),
      pointerDelta: { x: 0, y: 0 },
      pointerLocked: false,
    })
    const visibleChunkCount = yield* Ref.make(0)
    const qualityRef = yield* Ref.make(quality)
    const postFxChain = yield* Ref.make(buildPostProcessingChain(quality))
    const postFxBuiltFrom = yield* Ref.make(quality)
    const framesDrawn = yield* Ref.make(0)

    return {
      scratch: makeFrameScratch(),
      authoritativePose,
      viewOffset,
      mirroredCamera,
      mirrorLagSecs: lag,
      input,
      visibleChunkCount,
      quality: qualityRef,
      postFxChain,
      postFxBuiltFrom,
      framesDrawn,
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
export const renderStages = (
  state: RenderFrameState,
  input: InputServiceApi,
): ReadonlyArray<StageRegistration> => [
  {
    id: RENDER_STAGE_IDS.input,
    // No `after`. Input is sampled before anything reacts to it, and where that
    // lands in the frame is mc-compose's to decide — its skeleton claims the
    // NAME half of this id (`input`) for the first phase.
    run: () =>
      Effect.gen(function* () {
        // Sample FIRST, then close the edges. The two halves are one stage on
        // purpose: `snapshot` reads `justPressed`, `endFrame` clears it, and
        // anything that ran between them would see the edge either twice or
        // never depending on where the scheduler put it. Keeping them adjacent
        // makes "exactly once per frame" a property of one function body rather
        // than of the stage order.
        yield* Ref.set(state.input, yield* input.snapshot)
        yield* input.endFrame
      }),
  },
  {
    id: RENDER_STAGE_IDS.cameraMirror,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    // Mirroring a pre-integration pose is a one-frame lag on the view, which
    // reads as input latency rather than as a bug and is therefore the kind of
    // thing nobody files.
    run: () =>
      Effect.gen(function* () {
        // FIRST CUT: the snapshot comes from a Ref. When mc-sim is published,
        // `PlayerService` is acquired in `renderModule` below and this reads
        // `player.cameraPose` — which is an `Effect<_, never, ClockPort>`, and
        // `ClockPort` is exactly what `FrameServices` already provides. That is
        // the measurement that let `FrameServices` freeze at `ClockPort`.
        const pose = yield* Ref.get(state.authoritativePose)
        const offset = yield* Ref.get(state.viewOffset)
        const mirrored = mirroredCameraState(pose, offset)
        yield* Ref.set(state.mirroredCamera, mirrored)

        // The one real read of `FrameServices` in this repository. Time comes
        // from the injected Port; plan.md §5.1-3 bans reading a global clock
        // and `pnpm check:deps` enforces it.
        const now = yield* monotonicSecs
        yield* Ref.set(state.mirrorLagSecs, mirrorLagSecs(mirrored, now))
      }),
  },
  {
    id: RENDER_STAGE_IDS.chunkSync,
    after: [RENDER_STAGE_IDS.cameraMirror],
    // After the camera mirror because visibility is decided against THIS
    // frame's view. Culling on last frame's camera is what makes chunks pop in
    // at the edge of the screen when the player turns.
    run: () =>
      Effect.gen(function* () {
        const camera = yield* Ref.get(state.mirroredCamera)
        // FIRST CUT: the real body reads mc-sim's dirty-chunk notification
        // (plan.md §3.8 keeps that on mc-sim's API rather than in the stage
        // contract — a spike finding) and hands the dirty set to mc-meshing.
        // Neither is published, so this does the part that is genuinely
        // mc-render's: borrow the per-frame visibility buffer, which clears it
        // and asserts nobody kept a reference to it across the frame boundary.
        //
        // `withScratch` is synchronous and throws on misuse by design — see
        // `domain/frame-scratch.ts` on why an error channel in the hot path
        // would reintroduce the allocation the buffer exists to avoid.
        const visible = withScratch(state.scratch.visibleChunks, (buffer) => {
          // The camera position is what the real frustum cull keys off; reading
          // it here keeps the data flow honest rather than merely plausible.
          buffer.set('camera-origin', camera.position.y)
          return buffer.size
        })
        yield* Ref.set(state.visibleChunkCount, visible)
      }),
  },
  {
    id: RENDER_STAGE_IDS.draw,
    after: [RENDER_STAGE_IDS.chunkSync],
    // FIRST CUT: the THREE.js renderer call. It is deliberately the ONLY place
    // in the repository that will ever touch the live camera object, and it
    // sets that camera from `state.mirroredCamera` — never the other way round.
    // The reference mutated the live camera for the attack-swing bob and
    // restored it afterwards, and everything reading the camera in between got
    // the bob pose; `domain/camera-mirror.ts` composes the offset into a VALUE
    // instead, which is why that window cannot exist here.
    run: () => Ref.update(state.framesDrawn, (drawn) => drawn + 1),
  },
  {
    id: RENDER_STAGE_IDS.postFx,
    after: [RENDER_STAGE_IDS.draw],
    // plan.md §3.9 fixes the chain's INTERNAL order; `domain/post-processing.ts`
    // owns it and builds it in canonical order by construction. This stage is
    // the single point in the frame at which it runs.
    run: () =>
      Effect.gen(function* () {
        const quality = yield* Ref.get(state.quality)
        const builtFrom = yield* Ref.get(state.postFxBuiltFrom)
        // Rebuild only when the settings object actually changed. Reference
        // equality, not a deep compare: settings arrive as whole immutable
        // records from the settings service, and a per-frame deep compare of a
        // six-field object is exactly the kind of cost plan.md §3.9's
        // pre-allocation notes are about.
        if (quality !== builtFrom) {
          yield* Ref.set(state.postFxChain, buildPostProcessingChain(quality))
          yield* Ref.set(state.postFxBuiltFrom, quality)
        }
        // FIRST CUT: running the chain is the THREE.js EffectComposer call.
      }),
  },
]

/**
 * mc-render as a `GameModule`.
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
): GameModule<InputService, never, never, InputService> => ({
  layers: InputServiceLayer(),
  frameStages: Effect.gen(function* () {
    const input = yield* InputService
    const state = yield* makeRenderFrameState(quality)
    return renderStages(state, input)
  }),
})

/**
 * The module together with the state its stages close over.
 *
 * `renderModule` deliberately does not expose the state — a consumer that could
 * reach into it would be able to write the mirrored camera, which is the
 * inversion this repository exists to prevent. Previews and tests need it, so
 * they get it here, explicitly, and the name says what it is for.
 */
export const makeRenderStagesForPreview = (
  quality: GraphicsQuality = QUALITY_PRESETS.high,
): Effect.Effect<
  { readonly state: RenderFrameState; readonly stages: ReadonlyArray<StageRegistration> },
  never,
  InputService
> =>
  Effect.gen(function* () {
    const input = yield* InputService
    const state = yield* makeRenderFrameState(quality)
    return { state, stages: renderStages(state, input) }
  })

/** The Layer a host needs in order to run `renderModule`'s registration. */
export const RenderRegistrationLayer: Layer.Layer<InputService> = InputServiceLayer()
