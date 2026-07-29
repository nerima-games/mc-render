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
 * to be a real invariant belongs in `test/`, where it can fail CI; each note
 * says which test holds the claim, and each KNOWN GAP says why it is a pin
 * rather than a fix.
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
import {
  defaultBindings,
  notchesForWheelDelta,
  POINTER_LOCK_STATES,
  type PointerLockState,
} from '../../domain/input-bindings'
import { MonotonicTimeSecs } from '../../domain/kernel-vocabulary'
import { buildPostProcessingChain, QUALITY_PRESETS } from '../../domain/post-processing'
import { makeRenderFrameState, renderModule, UNSET_CAMERA_POSE } from '../../stages/registration'
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
      yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'lock-target' })
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
        Effect.zipRight(dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'lock-target' })),
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
    '   `requested` is no longer an absorbing state — read the `blur` row. Only two events used to',
    '   leave it, and both came from the browser. `blur` did not: it rebuilt the state from',
    '   initialState() and then restored `pointerLockState` unchanged. `requestPointerLock` does',
    '   not either, and that half is CORRECT — it claims the transition only from `unlocked` or',
    '   `refused`, because a second request while one is pending is one of the documented ways a',
    '   browser refuses the next one.',
    '',
    '   So a request issued and never answered stranded the session. The window blurring between',
    '   the ask and the answer is the ordinary way that happens, and the user gesture that would',
    '   normally fix it (a click) is exactly what acquiresPointerLock() declines to act on in',
    '   `requested`. The player could walk and type; they could never look around again.',
    '',
    '   The repository already knew this hazard by name for the OTHER path.',
    '   PointerLockRequestOutcome documents `unavailable` as existing because "a request that can',
    '   never be answered would otherwise leave the state machine in `requested` for the rest of',
    '   the session", and a test pins it with "Leaving the machine in `requested` would strand it',
    '   for the session." The `sent` path had the identical hole and nothing guarded it.',
    '',
    '   blur resolves to `unlocked` and NOT to `refused`: the browser did not refuse anything, the',
    '   ask was abandoned. `refused` is what a UI draws as "click again to look around". An',
    '   existing `refused` survives a blur, because it is sticky until something ASKS again.',
    '',
    '   Pinned by test/input.test.ts `REGRESSION: a blur ABANDONS a pending request rather than',
    '   stranding the session`, which checks the port is asked a SECOND time afterwards.',
    '   Watch it: pnpm preview --scenario stranded-request --at 10 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// RND-2 — the lost wheel notch
// ---------------------------------------------------------------------------

const wheelLedgerProbe = Effect.gen(function* () {
  /**
   * ONE frame, with exactly one `snapshot` in it.
   *
   * That constraint is load-bearing for the measurement, not just for realism:
   * `snapshot` records the whole notches it reports, so an extra
   * "let me just read the accumulator" call between the late event and
   * `endFrame` would itself be a frame being told about the late event, and the
   * probe would measure its own instrumentation. The accumulated total is
   * computed from the deltas below instead, which the probe fully controls.
   */
  const FIRST_DELTA_PIXELS = 90
  const SECOND_DELTA_PIXELS = 30

  const run = (lateEvent: boolean) =>
    Effect.gen(function* () {
      const service = yield* makeInputService()
      yield* service.dispatch({ kind: 'pointerlockchange', locked: true })
      yield* service.dispatch(wheel(FIRST_DELTA_PIXELS))
      if (!lateEvent) {
        yield* service.dispatch(wheel(SECOND_DELTA_PIXELS))
      }
      const seen = yield* service.snapshot
      if (lateEvent) {
        // A DOM wheel listener runs here: after the frame stage read its
        // snapshot, before the frame loop called endFrame.
        yield* service.dispatch(wheel(SECOND_DELTA_PIXELS))
      }
      // `seen` — the reading the frame acted on — handed BACK. That is the
      // contract, and it is why the extra instrumentation snapshot below is
      // harmless: `snapshot` is a pure read.
      yield* service.endFrame(seen)
      const after = (yield* service.snapshot).wheelNotches
      const accumulated =
        notchesForWheelDelta(FIRST_DELTA_PIXELS, 'pixel') +
        notchesForWheelDelta(SECOND_DELTA_PIXELS, 'pixel')
      return {
        reported: seen.wheelSteps,
        consumed: Math.round(accumulated - after),
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
    '   Both rows balance: endFrame consumes EXACTLY what the frame was told, whichever order the',
    '   events fall in. `endFrame(frame)` takes the reading the frame acted on and subtracts its',
    '   whole notches — it used to re-read the accumulator and truncate it a SECOND time, at a',
    '   different instant, so every wheel event the browser delivered between the two could move',
    '   the second truncation past a notch boundary the first never reached.',
    '',
    '   The second row was the smallest case: the frame was told 0 whole steps and moved 0 hotbar',
    '   slots; endFrame then consumed 1. The player turned a detent and the selection did not',
    '   move, once, unreproducibly. Same class as the reference implementation\'s consume-on-read',
    '   `consumeMouseClick`, which this file explicitly rejects — "whether a click survives',
    '   depends on who read it first".',
    '',
    '   The reading is an ARGUMENT rather than something the service remembers, and that is not a',
    '   style choice. If `snapshot` recorded what it reported, a debug overlay — or this app, which',
    '   redraws its analogue panel after every step — would change how much travel the next',
    '   endFrame consumed, and the instrumentation would reproduce the bug it exists to watch. An',
    '   observer must not move the thing it observes, so `snapshot` stays a pure read and the',
    '   contract lives in the type: you cannot end a frame on a reading you did not take.',
    '',
    '   Omitting the argument means "no frame read the wheel" and consumes nothing, so travel',
    '   nothing acted on is deferred to the frame that does read it rather than spent on its',
    '   behalf. A stale reading is clamped to what the accumulator can cover, so the worst a',
    '   caller can do is consume nothing — never drive the hotbar backwards.',
    '',
    '   Pinned by test/input.test.ts `REGRESSION: endFrame consumes what the FRAME was told, not',
    '   what arrived after it`, plus three tests around it. The old tests put both events strictly',
    '   before the snapshot, which is the only order a single-fiber test naturally writes.',
    '   Watch it: pnpm preview --scenario lost-notch --at 11 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// RND-3 — blur keeps `locked`
// ---------------------------------------------------------------------------

const blurProbe = Effect.gen(function* () {
  const service = yield* makeInputService()
  yield* service.dispatch({ kind: 'pointerlockchange', locked: true })
  yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'lock-target' })
  yield* service.dispatch({ kind: 'keydown', code: 'KeyW', target: 'window' })
  yield* service.dispatch({ kind: 'pointermove', deltaX: 30, deltaY: 10 })

  const before = yield* service.snapshot
  yield* service.dispatch({ kind: 'blur' })
  const after = yield* service.snapshot

  // The click that brings the window back.
  yield* service.dispatch({ kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'lock-target' })
  const refocusIsAttack = yield* service.wasActionJustTriggered('attack')
  const refocusIsUiClick = yield* service.wasUiClick('MouseLeft')

  return [
    ...section('BLUR-STATE', 'What does `blur` clear, and what does it keep?'),
    `   ${cell('field', 26)}${cell('before blur', 18)}${cell('after blur', 18)}`,
    `   ${cell('pressed', 26)}${cell(String(before.pressed.size), 18)}${cell(String(after.pressed.size), 18)}`,
    `   ${cell('justPressed', 26)}${cell(String(before.justPressed.size), 18)}${cell(String(after.justPressed.size), 18)}`,
    `   ${cell('pointerDelta.x', 26)}${cell(String(before.pointerDelta.x), 18)}${cell(String(after.pointerDelta.x), 18)}`,
    `   ${cell('wheelNotches', 26)}${cell(String(before.wheelNotches), 18)}${cell(String(after.wheelNotches), 18)}`,
    `   ${cell('pointerLockState', 26)}${cell(before.pointerLockState, 18)}${cell(after.pointerLockState, 18)}   <-- the locked session ENDS`,
    `   ${cell('pointerLocked', 26)}${cell(String(before.pointerLocked), 18)}${cell(String(after.pointerLocked), 18)}`,
    '',
    `   the click that refocuses the window:  attack edge = ${String(refocusIsAttack)},  uiClick = ${String(refocusIsUiClick)}`,
    '',
    '   The last row is the one that mattered. `blur` clears every held code and all analogue',
    '   state, and used to PRESERVE the one field that decides what a click MEANS. `withButtonDown`',
    '   routes a mousedown into `pressed` when the state says `locked`, so until the browser got',
    '   around to delivering pointerlockchange, the click the player used to come back to the tab',
    '   was an attack.',
    '',
    '   The whole reason `withoutHeldButtons` exists is stated in input-service.ts — "the click',
    '   belonged to the locked session" — and a blur ends that session as surely as losing the',
    '   lock does. The two handlers disagreed about it; they no longer do.',
    '',
    '   Three tests dispatched `blur` and all three asserted what it CLEARS; none asserted what it',
    '   KEPT, and none dispatched a mousedown afterwards. Pinned now by',
    '   `REGRESSION: blur ends the LOCKED SESSION, so the click that refocuses is not an attack`.',
    '   Watch it: pnpm preview --scenario blur-while-locked --at 10 --once --ascii',
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
    '   KNOWN GAP RND-4, pinned rather than fixed. Two answers to "how stale is the mirror?" exist',
    '   at startup and disagree. `makeRenderFrameState` builds `mirroredCamera` from',
    '   UNSET_CAMERA_POSE — whose capturedAtSecs is 0, i.e. the beginning of the monotonic epoch —',
    '   and `mirrorLagSecs` from the literal 0. A consumer reading the Ref before',
    '   render:camera-mirror first runs is told the mirror is current; the same consumer calling',
    '   mirrorLagSecs() on the mirrored state is told it is as old as the process. Nothing in',
    '   stages/ ever writes authoritativePose (only mc-sim does, across the boundary), so in the',
    '   renderModule path — where the state is deliberately not exposed — isMirrorStale is true',
    '   from the first frame until a pose arrives, with no way to tell "stale" from "never set".',
    '',
    '   NOT FIXED. There is no honest value to seed the gauge with: makeRenderFrameState has no',
    '   clock (it is a constructor, not a stage, and plan.md §5.1-3 bans reading a global one), and',
    '   seeding Infinity would only MOVE the contradiction — mirroredCamera.sourceCapturedAtSecs',
    '   would still read 0, and that is the value consumers actually read. Making the two agree',
    '   means distinguishing "never set" from "stale" in MirroredCameraState itself, which every',
    '   consumer must then handle. That belongs with the mc-sim pin, when authoritativePose stops',
    '   being a FIRST CUT Ref and becomes PlayerService.cameraPose read at registration time — at',
    '   which point the window closes by construction. Until then it is bounded by the first frame',
    '   and the only in-repo reader is a diagnostic gauge.',
    '',
    '   Pinned by test/stage-registration.test.ts `KNOWN GAP: before a pose arrives, the two',
    '   staleness answers DISAGREE`, which also shows one run of the stage reconciling them.',
    '   Watch it: pnpm preview --view mirror --scenario mirror-staleness --at 4 --once --ascii',
    '',
    '   RND-5 is fixed. domain/camera-mirror.ts documented the constant as "Milliseconds of lag',
    '   past which a mirrored pose is worth complaining about." It is named _SECS, its value is',
    '   0.1, and isMirrorStale compares it against a quantity in SECONDS. As milliseconds, 0.1',
    '   would be a tenth of a millisecond and every mirror ever built would be stale. The code was',
    '   right and the sentence above it was wrong — the worse way round for a threshold somebody',
    '   will eventually tune, because tuning starts from the prose.',
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

  // The ONLY supported shape: one provide of `module.layers`, with the
  // registration and the frame's use of the service both inside it.
  const viaModuleLayer = yield* Effect.gen(function* () {
    const stages = yield* built.frameStages
    const service = yield* InputService
    const lock: PointerLockState = yield* service.requestPointerLock
    return { stageCount: stages.length, lock }
  }).pipe(Effect.provide(built.layers))

  // Why there is no standalone registration Layer to reach for: `Layer.effect`
  // builds a fresh service per `Effect.provide`, so one Layer VALUE used twice
  // is two machines. This is the trap in its general form.
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
    `   ${cell('stages registered via module.layers', 48)}${String(viaModuleLayer.stageCount)}`,
    `   ${cell('ids', 48)}${Object.values(RENDER_STAGE_IDS).join(', ')}`,
    '',
    `   ${cell('requestPointerLock on renderModule(...).layers', 48)}${viaModuleLayer.lock}`,
    `   ${cell('times the injected port was actually asked', 48)}${String(asks)}`,
    '',
    `   ${cell('one Layer value, provided twice: first sees', 48)}${String(first)}`,
    `   ${cell('...and the second sees', 48)}${String(second)}`,
    '',
    '   There used to be a `RenderRegistrationLayer` here:',
    '',
    '       /** The Layer a host needs in order to run `renderModule`\'s registration. */',
    '       export const RenderRegistrationLayer: Layer.Layer<InputService> = InputServiceLayer()',
    '',
    '   `InputServiceLayer()` took no arguments, so it built a service with `defaultBindings()`',
    '   and `UNAVAILABLE_POINTER_LOCK` — while `renderModule(q, port)` builds',
    '   `InputServiceLayer(defaultBindings(), port)`. A host that followed the doc registered its',
    '   five stages against a DIFFERENT InputService from the one its Layer provides: the stage',
    '   closes over the instance it saw in `renderStages(state, input)`, so the DOM events the',
    '   adapter dispatched into the real service were invisible to render:input, the player\'s',
    '   persisted bindings were ignored, and requestPointerLock answered `refused` without ever',
    '   reaching the host\'s port.',
    '',
    '   It was DELETED rather than repaired, and the last two rows are why: taking the arguments',
    '   would not have been enough. `Layer.effect` builds a fresh service per `Effect.provide`, so',
    '   even the correct Layer used twice — once for the registration, once for the frame loop —',
    '   is two machines. Any standalone Layer constant or Layer-returning function invites exactly',
    '   that, because having one in hand is an invitation to provide it separately. A GameModule',
    '   is the shape that makes the mistake unwritable: provide `module.layers` ONCE and take',
    `   \`frameStages\` from inside that same provide, which is what the ${String(asks)} above says happened.`,
    '',
    '   test/stage-registration.test.ts uses the single-provide form and is right to. Nothing',
    '   referenced RenderRegistrationLayer outside api-lock.md — it was exported, locked, and',
    '   unused, which is why nothing had noticed.',
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
    '   KNOWN GAP RND-7, pinned rather than fixed. domain/frame-scratch.ts says the cross-frame',
    '   invariant "is enforced rather than documented". One shape of escape is enforced: the',
    '   identity check compares the RESULT against the buffer. A wrapper object, a closure over',
    '   `buffer`, and `scratch.buffer` read directly all hand out the same live Map and the same',
    '   lifetime bug, undetected — and `buffer` is a public field on `ScratchMap`, documented as',
    '   "Valid ONLY inside a withScratch callback" with nothing making that true.',
    '',
    '   The deferred-callback row is the sharpest one, because it is the shape Effect code',
    '   naturally reaches for. `withScratch` releases the lease in a `finally`, so',
    '   `withScratch(s, b => Effect.sync(() => b.size))` returns an unevaluated Effect with the',
    '   lease already gone; by the time it runs, the next borrow has cleared the buffer. The',
    '   shipped call site (render:chunk-sync) is synchronous and therefore safe, which is why',
    '   nothing has hit it.',
    '',
    '   NOT FIXED. Detecting these means not handing out the live Map at all — a lease-checked',
    '   facade, or making `buffer` private. Both change the public type, and the facade puts a',
    '   branch and a wrapper object on the hot path this module exists to keep allocation-free,',
    '   which is the deviation plan.md §5.2 sanctions BY NAME. That is not a local decision.',
    '',
    '   The foreign-ScratchMap row is the one piece that is cheap in isolation — withScratch casts',
    '   to a private shape the public type does not carry, so a hand-built ScratchMap dies with a',
    '   TypeError rather than a diagnostic. It is left with the rest deliberately: makeScratchMap',
    '   is the only constructor and it is exported, so reaching that row means hand-writing an',
    '   object literal against a type documented as "only withScratch may drive it". Paying a new',
    '   public ScratchViolation rule for a case nothing in the org can reach, while the escapes',
    '   above stay open, buys a louder error on the least likely path. Both, or neither.',
    '',
    '   usageCount is documented as "Frames this buffer has served". It increments in `enter()`,',
    '   i.e. once per BORROW — and a borrow that dies on the escape check has already counted.',
    '',
    '   Every row above is pinned by test/frame-scratch.test.ts, under',
    '   `KNOWN GAP: withScratch catches only the identity escape`. When the module is fixed, those',
    '   are the tests that fail.',
  ]
}

// ---------------------------------------------------------------------------
// post-FX, for completeness
// ---------------------------------------------------------------------------

const postFxProbe = (): ReadonlyArray<string> => {
  const rows = (['low', 'medium', 'high', 'ultra'] as const).map((preset) => {
    const chain = buildPostProcessingChain(QUALITY_PRESETS[preset])
    return `   ${cell(preset, 10)}${cell(String(chain.length), 8)}${chain
      .map((entry) => (entry.pass === 'composite' ? `composite{${entry.effects.join('+')}}` : entry.pass))
      .join(' -> ')}`
  })

  const distinct = new Set(
    (['low', 'medium', 'high', 'ultra'] as const).map((preset) =>
      JSON.stringify(buildPostProcessingChain(QUALITY_PRESETS[preset])),
    ),
  )

  return [
    ...section('POSTFX-CHAIN', 'The chain each preset produces, in canonical order.'),
    `   ${cell('preset', 10)}${cell('passes', 8)}chain`,
    ...rows,
    '',
    `   four presets, ${String(distinct.size)} distinct chains.`,
    '',
    '   `high` and `ultra` share a PASS ORDER and are no longer the same chain. The difference',
    '   between them is which effects the composite shader composites — the reference is explicit',
    '   about it: "high -> CompositePass enabled with { bloom }; ultra -> CompositePass enabled',
    '   with { bloom, godRays, bokeh }" — and `buildPostProcessingChain` used to return',
    '   `ReadonlyArray<PostProcessingPass>`, which carries the ORDER and nothing else. `composite`',
    '   was one opaque token in both, so the two presets produced equal values.',
    '',
    '   That mattered because of the claim the module makes about itself:',
    '',
    '       The THREE.js adapter\'s only job is then to walk `buildPostProcessingChain`\'s output',
    '       and call `composer.addPass` in that order.',
    '',
    '   An adapter that did exactly that built an identical composer for high and ultra, and the',
    '   ultra player got no god rays and no depth of field while the preset table promised both.',
    '   The alternative — the adapter reaching past this function and reading `GraphicsQuality`',
    '   itself — is the second source of truth modelling the chain as data was meant to remove.',
    '',
    '   Note what was NOT wrong: the ORDER, `isCompositeActive`, and the subsumption were all',
    '   right. The gap was that the return type could not say which inputs the composite pass has.',
    '   A chain is now a list of `PostProcessingStep` — `{ pass, effects }` — where `effects` is',
    '   `[pass]` for an ordinary pass and the subsumed list for `composite`, so the inputs are in',
    '   the value an adapter already holds at the moment it builds the pass. `chainPasses` is the',
    '   projection the order checker takes. Pinned by test/post-processing.test.ts `REGRESSION:',
    '   `high` and `ultra` are DIFFERENT chains, and the composite step is why`.',
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
  'Nothing here asserts. Every line is a quantity, and every note names the test in test/ that',
  'holds the claim to it — that is where it can fail CI. Run with --ascii for a pasteable copy.',
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
