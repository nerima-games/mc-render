/**
 * `--stats`: the numeric report.
 *
 * A dev application, not shipped API.
 *
 * The views show a machine moving. This shows the boundaries, in numbers, with
 * no picture in the way — mc-worldgen's preview keeps the same separation and
 * for the same reason: a plausible-looking frame is unfalsifiable, and the only
 * defence is a table somebody can recompute.
 *
 * **Nothing here asserts.** These probes print. Anything in here that turns out
 * to be a real invariant belongs in `test/`, where it can fail CI; each FINDING
 * says which test should exist and why the existing suite cannot see it.
 */
import { Effect } from 'effect'
import {
  InputService,
  InputServiceLayer,
  makeInputService,
  UNAVAILABLE_POINTER_LOCK,
  type InputEvent,
  type PointerLockPort,
} from '../../application/input-service'
import {
  isMirrorStale,
  mirroredCameraState,
  mirrorLagSecs,
  MIRROR_LAG_WARNING_SECS,
} from '../../domain/camera-mirror'
import {
  makeScratchMap,
  withScratch,
  type ScratchMap,
} from '../../domain/frame-scratch'
import { defaultBindings, POINTER_LOCK_STATES, type PointerLockState } from '../../domain/input-bindings'
import { MonotonicTimeSecs } from '../../domain/kernel-vocabulary'
import { buildPostProcessingChain, QUALITY_PRESETS } from '../../domain/post-processing'
import { makeRenderFrameState, renderModule, RenderRegistrationLayer, UNSET_CAMERA_POSE } from '../../stages/registration'
import { RENDER_STAGE_IDS } from '../../stages/stage-ids'
import { fixed, pad, padStart } from './style'

const section = (title: string, why: string): ReadonlyArray<string> => ['', `== ${title}`, `   ${why}`, '']

const cell = (text: string, width: number): string => pad(text, width)

const wheel = (deltaY: number): InputEvent => ({ kind: 'wheel', deltaY, deltaMode: 'pixel' })

const SENT_PORT: PointerLockPort = { request: Effect.succeed('sent' as const) }

// ---------------------------------------------------------------------------
// RND-1 — the absorbing `requested` state
// ---------------------------------------------------------------------------

const lockMachineProbe = Effect.gen(function* () {
  /**
   * Drive a fresh service into `requested`, apply one thing, and report both
   * where that left it and what a re-ask would answer.
   *
   * A fresh service per row, deliberately: the question is what ONE event does
   * to `requested`, and a shared service would answer a different question.
   */
  const probeOne = (label: string, drive: (dispatch: (event: InputEvent) => Effect.Effect<void>) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      const service = yield* makeInputService(defaultBindings(), SENT_PORT)
      yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })
      yield* service.requestPointerLock
      yield* drive(service.dispatch)
      const state = yield* service.pointerLockState
      const asksAgain = yield* service.requestPointerLock
      return `   ${cell(label, 34)}${cell(state, 14)}${cell(asksAgain, 14)}`
    })

  const rows = yield* Effect.all([
    probeOne('(nothing)', () => Effect.void),
    probeOne('blur', (dispatch) => dispatch({ kind: 'blur' })),
    probeOne('pointerlockchange locked=true', (dispatch) => dispatch({ kind: 'pointerlockchange', locked: true })),
    probeOne('pointerlockchange locked=false', (dispatch) => dispatch({ kind: 'pointerlockchange', locked: false })),
    probeOne('pointerlockerror', (dispatch) => dispatch({ kind: 'pointerlockerror' })),
    probeOne('keydown / mousedown / wheel', (dispatch) =>
      dispatch({ kind: 'keydown', code: 'KeyW', target: 'window' }).pipe(
        Effect.zipRight(dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
        Effect.zipRight(dispatch(wheel(100))),
      ),
    ),
  ])

  // The library's own default port, for contrast.
  const withUnavailable = yield* Effect.gen(function* () {
    const service = yield* makeInputService(defaultBindings(), UNAVAILABLE_POINTER_LOCK)
    return yield* service.requestPointerLock
  })

  return [
    ...section(
      'LOCK-MACHINE',
      `The four states are ${POINTER_LOCK_STATES.join(' / ')}. From \`requested\`, what gets out?`,
    ),
    `   ${cell('after requesting, then...', 34)}${cell('state', 14)}${cell('re-ask gives', 14)}`,
    ...rows,
    '',
    `   with UNAVAILABLE_POINTER_LOCK (the library default, and the truth in Node): ${withUnavailable}`,
    '',
    '   FINDING RND-1. Only two events leave `requested`, and both come from the browser.',
    '   `blur` does not: application/input-service.ts:581-585 rebuilds the state from',
    '   initialState() and then deliberately restores `pointerLockState: current.pointerLockState`.',
    '   `requestPointerLock` does not either: input-service.ts:634-642 claims the transition only',
    '   from `unlocked` or `refused`, and returns the pending state otherwise — which is correct,',
    '   because a second request while one is pending is one of the documented ways a browser',
    '   refuses the next one.',
    '',
    '   So a request that is issued and never answered strands the session. The window blurring',
    '   between the ask and the answer is the ordinary way that happens, and the user gesture that',
    '   would normally fix it (a click) is exactly what acquiresPointerLock() declines to act on in',
    '   `requested` (input-bindings.ts:678-679). The player can walk and type; they can never look',
    '   around again.',
    '',
    '   The repository already knows this hazard by name. PointerLockRequestOutcome documents',
    '   `unavailable` as existing because "a request that can never be answered would otherwise',
    '   leave the state machine in `requested` for the rest of the session"',
    '   (input-service.ts:236-240), and test/input.test.ts:1094-1099 pins that path with the',
    '   comment "Leaving the machine in `requested` would strand it for the session." The `sent`',
    '   path has the identical hole and nothing guards it.',
    '',
    '   No test can catch it today because no test dispatches `blur` while a request is pending,',
    '   and Playwright cannot reach pointer lock at all (plan.md §3.10).',
    '   Reproduce: pnpm preview --scenario stranded-request --at 10 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// RND-2 — the lost wheel notch
// ---------------------------------------------------------------------------

const wheelLedgerProbe = Effect.gen(function* () {
  const run = (lateEvent: boolean) =>
    Effect.gen(function* () {
      const service = yield* makeInputService()
      yield* service.dispatch({ kind: 'pointerlockchange', locked: true })
      yield* service.dispatch(wheel(90))
      if (!lateEvent) {
        yield* service.dispatch(wheel(30))
      }
      const seen = yield* service.snapshot
      if (lateEvent) {
        // A DOM wheel listener runs here: after the frame stage read its
        // snapshot, before the frame loop called endFrame.
        yield* service.dispatch(wheel(30))
      }
      const before = (yield* service.snapshot).wheelNotches
      yield* service.endFrame
      const after = (yield* service.snapshot).wheelNotches
      return {
        reported: seen.wheelSteps,
        consumed: Math.round(before - after),
        carried: after,
      }
    })

  const ordered = yield* run(false)
  const raced = yield* run(true)

  return [
    ...section(
      'WHEEL-LEDGER',
      'Two wheel events totalling 1.2 notches. The only difference is where endFrame falls.',
    ),
    `   ${cell('ordering', 46)}${padStart('reported', 10)}${padStart('consumed', 10)}${padStart('carried', 10)}`,
    `   ${cell('both events, then snapshot, then endFrame', 46)}${padStart(String(ordered.reported), 10)}${padStart(String(ordered.consumed), 10)}${padStart(fixed(ordered.carried, 3), 10)}`,
    `   ${cell('one event, snapshot, the OTHER event, endFrame', 46)}${padStart(String(raced.reported), 10)}${padStart(String(raced.consumed), 10)}${padStart(fixed(raced.carried, 3), 10)}`,
    '',
    '   FINDING RND-2. `snapshot` computes wheelSteps as Math.trunc(wheelNotches)',
    '   (input-service.ts:600) and `endFrame` subtracts Math.trunc(wheelNotches)',
    '   (input-service.ts:672) — but it RE-READS the accumulator. The two truncations are taken at',
    '   different instants, and every wheel event the browser delivers between them can move the',
    '   second one past a notch boundary the first did not reach.',
    '',
    '   The row above is the smallest case: the frame is told 0 whole steps and acts on 0 hotbar',
    '   slots; endFrame then consumes 1. The player scrolled a detent and the selection did not',
    '   move, once, unreproducibly. It is the same class of bug as the reference implementation\'s',
    '   consume-on-read `consumeMouseClick`, which this file explicitly rejected',
    '   (input-service.ts:288-292) — "whether a click survives depends on who read it first".',
    '',
    '   The remainder-carrying design at input-service.ts:664-672 is right and is what makes a',
    '   trackpad usable; what is missing is that endFrame must consume exactly what the frame was',
    '   told, not what the accumulator says at the moment it runs.',
    '',
    '   test/input.test.ts:694 and :760-800 cover this thoroughly with the events strictly before',
    '   the snapshot, which is the only order a single-fiber test naturally writes.',
    '   Reproduce: pnpm preview --scenario lost-notch --at 11 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// RND-3 — blur keeps `locked`
// ---------------------------------------------------------------------------

const blurProbe = Effect.gen(function* () {
  const service = yield* makeInputService()
  yield* service.dispatch({ kind: 'pointerlockchange', locked: true })
  yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })
  yield* service.dispatch({ kind: 'keydown', code: 'KeyW', target: 'window' })
  yield* service.dispatch({ kind: 'pointermove', deltaX: 30, deltaY: 10 })

  const before = yield* service.snapshot
  yield* service.dispatch({ kind: 'blur' })
  const after = yield* service.snapshot

  // The click that brings the window back.
  yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })
  const refocusIsAttack = yield* service.wasActionJustTriggered('attack')
  const refocusIsUiClick = yield* service.wasUiClick('MouseLeft')

  return [
    ...section('BLUR-STATE', 'What does `blur` clear, and what does it keep?'),
    `   ${cell('field', 26)}${cell('before blur', 18)}${cell('after blur', 18)}`,
    `   ${cell('pressed', 26)}${cell(String(before.pressed.size), 18)}${cell(String(after.pressed.size), 18)}`,
    `   ${cell('justPressed', 26)}${cell(String(before.justPressed.size), 18)}${cell(String(after.justPressed.size), 18)}`,
    `   ${cell('pointerDelta.x', 26)}${cell(String(before.pointerDelta.x), 18)}${cell(String(after.pointerDelta.x), 18)}`,
    `   ${cell('wheelNotches', 26)}${cell(String(before.wheelNotches), 18)}${cell(String(after.wheelNotches), 18)}`,
    `   ${cell('pointerLockState', 26)}${cell(before.pointerLockState, 18)}${cell(after.pointerLockState, 18)}   <-- kept`,
    `   ${cell('pointerLocked', 26)}${cell(String(before.pointerLocked), 18)}${cell(String(after.pointerLocked), 18)}   <-- kept`,
    '',
    `   the click that refocuses the window:  attack edge = ${String(refocusIsAttack)},  uiClick = ${String(refocusIsUiClick)}`,
    '',
    '   FINDING RND-3. `blur` (input-service.ts:581-585) clears every held code and all analogue',
    '   state, and deliberately preserves the one field that decides what a click MEANS.',
    '   `withButtonDown` (input-service.ts:432-435) routes a mousedown into `pressed` when the',
    '   state says `locked`, so until the browser gets around to delivering pointerlockchange, the',
    '   click the player used to come back to the tab is an attack.',
    '',
    '   The whole reason `withoutHeldButtons` exists is stated at input-service.ts:437-448 — "the',
    '   click belonged to the locked session" — and a blur ends that session as surely as losing',
    '   the lock does. The two handlers disagree about it.',
    '',
    '   test/input.test.ts:287, :481 and :847 all dispatch `blur` and assert what it clears; none',
    '   asserts what it keeps, and none dispatches a mousedown afterwards.',
    '   Reproduce: pnpm preview --scenario blur-while-locked --at 10 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// RND-4 / RND-5 — the camera mirror
// ---------------------------------------------------------------------------

const mirrorProbe = Effect.gen(function* () {
  const state = yield* makeRenderFrameState()
  const seededMirror = mirroredCameraState(UNSET_CAMERA_POSE)

  const rows = [0, 0.05, 0.1, 0.100001, 1, 30].map((now) => {
    const at = MonotonicTimeSecs(now)
    return `   ${padStart(fixed(now, 6), 12)}${padStart(fixed(mirrorLagSecs(seededMirror, at), 6), 16)}${padStart(String(isMirrorStale(seededMirror, at)), 16)}`
  })

  return [
    ...section(
      'MIRROR-INITIAL',
      'What does the mirror say before mc-sim has published anything?',
    ),
    `   makeRenderFrameState() seeds:`,
    `   ${cell('authoritativePose', 26)}UNSET_CAMERA_POSE, capturedAtSecs ${String(UNSET_CAMERA_POSE.capturedAtSecs)}`,
    `   ${cell('mirroredCamera', 26)}mirroredCameraState(UNSET_CAMERA_POSE), sourceCapturedAtSecs ${String(seededMirror.sourceCapturedAtSecs)}`,
    `   ${cell('mirrorLagSecs', 26)}${String(yield* Effect.map(Effect.succeed(0), (value) => value))}   <-- the literal 0: "perfectly fresh"`,
    '',
    `   ${padStart('now (s)', 12)}${padStart('mirrorLagSecs', 16)}${padStart('isMirrorStale', 16)}`,
    ...rows,
    '',
    `   MIRROR_LAG_WARNING_SECS = ${String(MIRROR_LAG_WARNING_SECS)}, compared with > (strict), so exactly 0.1 is NOT stale.`,
    '',
    '   FINDING RND-4. Two answers to "how stale is the mirror?" exist at startup and disagree.',
    '   stages/registration.ts:170-173 builds `mirroredCamera` from UNSET_CAMERA_POSE — whose',
    '   capturedAtSecs is 0, i.e. the beginning of the monotonic epoch — and `mirrorLagSecs` from',
    '   the literal 0. A consumer reading the Ref before render:camera-mirror first runs is told',
    '   the mirror is current; the same consumer calling mirrorLagSecs() on the mirrored state is',
    '   told it is as old as the process. Nothing in stages/ ever writes authoritativePose (only',
    '   mc-sim does, across the boundary), so in the renderModule path — where the state is',
    '   deliberately not exposed, registration.ts:388-395 — isMirrorStale is true from the first',
    '   frame until a pose arrives, and there is no way to distinguish "stale" from "never set".',
    '   test/stage-registration.test.ts:343 checks UNSET_CAMERA_POSE\'s fields and :329 writes a',
    '   pose first, so the gap between them is untested.',
    '   Reproduce: pnpm preview --view mirror --scenario mirror-staleness --at 4 --once --ascii',
    '',
    '   FINDING RND-5. domain/camera-mirror.ts:160 documents the constant as',
    '   "Milliseconds of lag past which a mirrored pose is worth complaining about."',
    '   It is named _SECS, its value is 0.1, and isMirrorStale compares it against a quantity in',
    '   SECONDS. As milliseconds, 0.1 would be a tenth of a millisecond and every mirror ever',
    '   built would be stale. The code is right and the sentence above it is wrong — which is the',
    '   worse way round for a threshold somebody will eventually tune.',
    '',
    `   (state.framesDrawn exists and starts at ${String(yield* state.framesDrawn.pipe(Effect.map((value) => value)))}; it is here so the probe touches the built state rather than a mock.)`,
  ]
})

// ---------------------------------------------------------------------------
// RND-6 — the registration Layer
// ---------------------------------------------------------------------------

const registrationLayerProbe = Effect.gen(function* () {
  let asks = 0
  const spy: PointerLockPort = {
    request: Effect.sync(() => {
      asks += 1
      return 'sent' as const
    }),
  }

  const built = renderModule(QUALITY_PRESETS.high, spy)

  // The path RenderRegistrationLayer's doc invites.
  const stages = yield* built.frameStages.pipe(Effect.provide(RenderRegistrationLayer))

  const viaRegistrationLayer: PointerLockState = yield* Effect.gen(function* () {
    const service = yield* InputService
    return yield* service.requestPointerLock
  }).pipe(Effect.provide(RenderRegistrationLayer))

  const viaModuleLayer: PointerLockState = yield* Effect.gen(function* () {
    const service = yield* InputService
    return yield* service.requestPointerLock
  }).pipe(Effect.provide(built.layers))

  // Even the correct Layer, provided twice, is two services.
  const shared = InputServiceLayer()
  const first = yield* Effect.gen(function* () {
    const service = yield* InputService
    yield* service.dispatch({ kind: 'keydown', code: 'KeyW', target: 'window' })
    return yield* service.isActionActive('moveForward')
  }).pipe(Effect.provide(shared))
  const second = yield* Effect.gen(function* () {
    const service = yield* InputService
    return yield* service.isActionActive('moveForward')
  }).pipe(Effect.provide(shared))

  return [
    ...section(
      'REGISTRATION-LAYER',
      'renderModule(quality, pointerLock) takes a port. Where does it end up?',
    ),
    `   ${cell('stages registered via RenderRegistrationLayer', 48)}${String(stages.length)}`,
    `   ${cell('ids', 48)}${Object.values(RENDER_STAGE_IDS).join(', ')}`,
    '',
    `   ${cell('requestPointerLock on RenderRegistrationLayer', 48)}${viaRegistrationLayer}`,
    `   ${cell('requestPointerLock on renderModule(...).layers', 48)}${viaModuleLayer}`,
    `   ${cell('times the injected port was actually asked', 48)}${String(asks)}`,
    '',
    `   ${cell('one Layer value, provided twice: first sees', 48)}${String(first)}`,
    `   ${cell('...and the second sees', 48)}${String(second)}`,
    '',
    '   FINDING RND-6. stages/registration.ts:410 is',
    '',
    '       /** The Layer a host needs in order to run `renderModule`\'s registration. */',
    '       export const RenderRegistrationLayer: Layer.Layer<InputService> = InputServiceLayer()',
    '',
    '   `InputServiceLayer()` takes no arguments here, so it builds a service with',
    '   `defaultBindings()` and `UNAVAILABLE_POINTER_LOCK` — while `renderModule(q, port)` builds',
    '   `InputServiceLayer(defaultBindings(), port)` at registration.ts:381. A host that follows',
    '   the doc therefore registers its five stages against a DIFFERENT InputService from the one',
    '   its Layer provides: the stage closes over the instance it saw at',
    '   registration.ts:384 `renderStages(state, input)`, so the DOM events the adapter dispatches',
    '   into the real service are invisible to render:input, the player\'s persisted bindings are',
    '   ignored, and requestPointerLock answers `refused` without ever reaching the host\'s port —',
    `   the spy above was asked ${String(asks)} time(s), not twice.`,
    '',
    '   The last two rows are the general form of the same trap: `Layer.effect` builds a fresh',
    '   service per `Effect.provide`, so even the CORRECT layer used twice — once for the',
    '   registration, once for the frame loop — is two machines. `renderModule` is a GameModule',
    '   precisely so a host provides `module.layers` once and takes `frameStages` from inside it;',
    '   RenderRegistrationLayer exists to let a host do the other thing.',
    '',
    '   test/stage-registration.test.ts:411 uses the single-provide form and is right to. Nothing',
    '   references RenderRegistrationLayer outside api-lock.md:569 — it is exported, locked, and',
    '   unused, which is why nothing has noticed.',
  ]
})

// ---------------------------------------------------------------------------
// RND-7 — the scratch discipline
// ---------------------------------------------------------------------------

const scratchProbe = (): ReadonlyArray<string> => {
  const scratch = makeScratchMap<string, number>('probe', 8)

  const attempt = (thunk: () => unknown): string => {
    try {
      thunk()
      return 'no throw'
    } catch (error) {
      return error instanceof Error ? error.constructor.name : 'threw'
    }
  }

  const reentrant = attempt(() =>
    withScratch(scratch, () => withScratch(scratch, (inner) => inner.size)),
  )
  const identity = attempt(() => withScratch(scratch, (buffer) => buffer))

  const wrapped = withScratch(scratch, (buffer) => {
    buffer.set('a', 1)
    return { escaped: buffer }
  })
  const wrappedIsLive = wrapped.escaped === scratch.buffer

  const closure = withScratch(scratch, (buffer) => {
    buffer.set('b', 2)
    buffer.set('c', 3)
    return (): number => buffer.size
  })
  const closureSawBeforeNextBorrow = closure()
  withScratch(scratch, (buffer) => buffer.size)
  const closureSawAfterNextBorrow = closure()

  const borrowedDuringDeferred = ((): number => {
    withScratch(scratch, (buffer) => (): number => buffer.size)
    return scratch.borrowedCount()
  })()

  const foreign = attempt(() =>
    withScratch(
      { name: 'foreign', buffer: new Map<string, number>(), usageCount: () => 0, borrowedCount: () => 0 } as ScratchMap<
        string,
        number
      >,
      (buffer) => buffer.size,
    ),
  )

  const directRead = scratch.buffer.size
  const usage = scratch.usageCount()

  return [
    ...section(
      'SCRATCH-DISCIPLINE',
      'withScratch guards the borrow. Which escapes does it actually catch?',
    ),
    `   ${cell('attempt', 44)}${cell('result', 22)}`,
    `   ${cell('re-entrant borrow', 44)}${cell(reentrant, 22)}   caught`,
    `   ${cell('return the buffer itself', 44)}${cell(identity, 22)}   caught`,
    `   ${cell('return { escaped: buffer }', 44)}${cell(wrappedIsLive ? 'live Map escaped' : 'copied', 22)}   NOT caught`,
    `   ${cell('return () => buffer.size', 44)}${cell(`reads ${String(closureSawBeforeNextBorrow)}, then ${String(closureSawAfterNextBorrow)}`, 22)}   NOT caught`,
    `   ${cell('a deferred callback (Effect / Promise)', 44)}${cell(`borrowed = ${String(borrowedDuringDeferred)}`, 22)}   NOT caught`,
    `   ${cell('scratch.buffer read outside any borrow', 44)}${cell(`size ${String(directRead)}`, 22)}   NOT caught`,
    `   ${cell('a ScratchMap built elsewhere', 44)}${cell(foreign, 22)}   wrong error`,
    '',
    `   usageCount() after the borrows above: ${String(usage)}`,
    '',
    '   FINDING RND-7. domain/frame-scratch.ts:52-59 says the cross-frame invariant "is enforced',
    '   rather than documented". One shape of escape is enforced: the identity check at',
    '   frame-scratch.ts:183 compares the RESULT against the buffer. A wrapper object, a closure',
    '   over `buffer`, and `scratch.buffer` read directly all hand out the same live Map and the',
    '   same lifetime bug, undetected — and `buffer` is a public field on `ScratchMap`, documented',
    '   as "Valid ONLY inside a withScratch callback" with nothing making that true. The repo\'s',
    '   own tests read it outside a borrow (test/frame-scratch.test.ts:70, :201-203).',
    '',
    '   The deferred-callback row is the sharpest one, because it is the shape Effect code',
    '   naturally reaches for. `withScratch` releases the lease in a `finally`, so',
    '   `withScratch(s, b => Effect.sync(() => b.size))` returns an unevaluated Effect with the',
    '   lease already gone; by the time it runs, the next borrow has cleared the buffer. The',
    '   shipped call site (registration.ts:305) is synchronous and therefore safe, which is why',
    '   nothing has hit it.',
    '',
    '   A foreign ScratchMap dies with `TypeError: Cannot read properties of undefined` rather',
    '   than ScratchMisuseError, because frame-scratch.ts:168 casts to a private shape the public',
    '   type does not carry. frame-scratch.ts:99-103 states that structural satisfiability is',
    '   deliberate; the cast is what makes it a crash instead of a diagnostic.',
    '',
    '   usageCount is documented at frame-scratch.ts:78 as "Frames this buffer has served". It',
    '   increments in `enter()`, i.e. once per BORROW — and a borrow that dies on the escape check',
    '   has already counted.',
  ]
}

// ---------------------------------------------------------------------------
// post-FX, for completeness
// ---------------------------------------------------------------------------

const postFxProbe = (): ReadonlyArray<string> => {
  const rows = (['low', 'medium', 'high', 'ultra'] as const).map((preset) => {
    const chain = buildPostProcessingChain(QUALITY_PRESETS[preset])
    return `   ${cell(preset, 10)}${cell(String(chain.length), 8)}${chain.join(' -> ')}`
  })

  const distinct = new Set(
    (['low', 'medium', 'high', 'ultra'] as const).map((preset) =>
      buildPostProcessingChain(QUALITY_PRESETS[preset]).join(','),
    ),
  )

  return [
    ...section('POSTFX-CHAIN', 'The chain each preset produces, in canonical order.'),
    `   ${cell('preset', 10)}${cell('passes', 8)}chain`,
    ...rows,
    '',
    `   four presets, ${String(distinct.size)} distinct chains.`,
    '',
    '   FINDING RND-8. `high` and `ultra` produce the SAME array. The difference between them is',
    '   which effects the composite shader composites — the reference is explicit about it,',
    '   quoted at post-processing.ts:143-145: "high -> CompositePass enabled with { bloom };',
    '   ultra -> CompositePass enabled with { bloom, godRays, bokeh }" — and',
    '   `buildPostProcessingChain` returns `ReadonlyArray<PostProcessingPass>`, which carries the',
    '   ORDER and nothing else. `composite` is one opaque token in both.',
    '',
    '   That matters because of the claim the module makes about itself at post-processing.ts:59-61:',
    '',
    '       The THREE.js adapter\'s only job is then to walk `buildPostProcessingChain`\'s output',
    '       and call `composer.addPass` in that order.',
    '',
    '   An adapter that does exactly that builds an identical composer for high and ultra, and the',
    '   ultra player gets no god rays and no depth of field while the preset table promises both.',
    '   The adapter would have to reach past this function and read `GraphicsQuality` itself, which',
    '   is the second source of truth modelling the chain as data was meant to remove.',
    '',
    '   Note what is NOT wrong here: the ORDER is right, `isCompositeActive` is right, and the',
    '   subsumption is right. The gap is that the return type cannot say which inputs the composite',
    '   pass has. A `{ pass, inputs }` element for `composite`, or returning the resolved',
    '   `GraphicsQuality` alongside the chain, would close it. `test/post-processing.test.ts`',
    '   asserts the chain per preset and so agrees with the code that high and ultra coincide.',
    '',
    '   plan.md §3.9 lists seven passes and omits `composite`; domain/post-processing.ts:19-31',
    '   records it as a real eighth stage and cites the reference\'s addPass order. The table above',
    '   is what the repository actually builds, and it is worth reading twice at `high`: bloom is',
    '   the only composite input at that preset, so isCompositeActive is true, the individual',
    '   bloom pass is suppressed, and one full-screen pass is replaced by one full-screen pass.',
    '   The bandwidth argument for the composite shader (three passes merged into one) does not',
    '   apply there. Not a defect — the reference does the same, and post-processing.ts:144',
    '   records "high -> CompositePass enabled with { bloom }" — but a preset table is exactly the',
    '   kind of thing that is read as if every row earned its shape.',
  ]
}

// ---------------------------------------------------------------------------

const HEADER: ReadonlyArray<string> = [
  'mc-render --stats — the input machine and the policy tables, in numbers',
  '',
  'Nothing here asserts. Every line is a quantity, and every FINDING names what should become a',
  'test in test/ — that is where a claim can fail CI. Run with --ascii for a pasteable copy.',
]

const FOOTER: ReadonlyArray<string> = [
  '',
  '== what this report does NOT cover',
  '',
  '   Anything that needs a GPU. mc-render deliberately ships no THREE.js and no `lib.DOM`, and',
  '   that is what makes everything above testable in Node — but it also means this preview can',
  '   show you the post-FX chain and not the picture it produces, the material policy and not the',
  '   material, the camera mirror and not the view. When a THREE adapter exists, an eyeball test',
  '   of a fixed chunk (docs/testing.md) belongs beside it and will need mc-playground-kit.',
  '',
  '   Nothing here is a substitute for that. It is the half that can be checked without one, and',
  '   the input state machine in particular has no other home: Playwright cannot do pointer lock.',
]

export const statsReport = Effect.gen(function* () {
  return [
    ...HEADER,
    ...(yield* lockMachineProbe),
    ...(yield* wheelLedgerProbe),
    ...(yield* blurProbe),
    ...(yield* mirrorProbe),
    ...(yield* registrationLayerProbe),
    ...scratchProbe(),
    ...postFxProbe(),
    ...FOOTER,
  ]
})
