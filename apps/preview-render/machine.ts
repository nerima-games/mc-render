/**
 * The driver: one `InputService`, one mirrored camera, one clock the operator owns.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why a step and not a frame
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen's preview steps a camera; mc-sim's steps a frame. This one steps
 * a single EVENT, and that is the whole design.
 *
 * `InputSnapshot` is a per-frame view of a machine that changes several times
 * per frame — the browser delivers a `mousedown`, a `mousemove`, three `wheel`s
 * and a `pointerlockchange` inside one animation frame, in whatever order they
 * happened. Everything interesting about `application/input-service.ts` is
 * about ORDER: whether `endFrame` runs before or after a late wheel event,
 * whether `blur` arrives before or after `pointerlockchange`, whether a
 * `mousedown` lands on the locked or the unlocked side of a state change.
 *
 * A frame stepper would fix that order and hide exactly what it should show.
 * So `readSnapshot` and `endFrame` are steps like any other, the timeline shows
 * where they fell, and moving one of them is how two of this app's findings
 * were found.
 *
 * ---------------------------------------------------------------------------
 * The clock
 * ---------------------------------------------------------------------------
 *
 * `domain/camera-mirror.ts` measures staleness against a `MonotonicTimeSecs`
 * the caller supplies. This app holds that number and the operator moves it, so
 * `MIRROR_LAG_WARNING_SECS` can be crossed on purpose rather than waited for.
 * No `Date.now()`, no `performance.now()`, no escape hatch.
 */
import { Effect } from 'effect'
import {
  makeInputService,
  type InputEvent,
  type InputServiceApi,
  type InputSnapshot,
  type PointerLockPort,
  type PointerLockRequestOutcome,
} from '../../src/application/input-service'
import {
  isMirrorStale,
  mirroredCameraState,
  mirrorLagSecs,
  NO_VIEW_OFFSET,
  type MirroredCameraState,
  type ViewOffset,
} from '../../src/domain/camera-mirror'
import {
  acquiresPointerLock,
  actionForKey,
  defaultBindings,
  INPUT_ACTIONS,
  isMouseButton,
  type Bindings,
  type InputAction,
  type InputCode,
  type PointerLockState,
} from '../../src/domain/input-bindings'
import { MonotonicTimeSecs, position, type CameraPoseSnapshot } from '@nerima-games/mc-kernel'
import { scenarioFor, stepAt, type Command, type ScenarioName, type ScriptedStep } from './script'

/**
 * The pointer-lock port the preview installs.
 *
 * `sent` by default, because that is the interesting branch: it is the one that
 * hands the answer to a future event, and therefore the one that can be left
 * unanswered. `UNAVAILABLE_POINTER_LOCK` — the library's default, and what Node
 * really offers — resolves to `refused` immediately and can never strand
 * anything. See the `stranded-request` scenario.
 */
export type LockPortMode = 'sent' | 'unavailable'

const portFor = (mode: LockPortMode): PointerLockPort => ({
  request: Effect.succeed<PointerLockRequestOutcome>(mode === 'sent' ? 'sent' : 'unavailable'),
})

export type ActionRow = {
  readonly action: InputAction
  readonly code: InputCode | undefined
  readonly active: boolean
  readonly justTriggered: boolean
}

export type LogLine = {
  readonly step: number
  readonly text: string
  readonly severity: 'event' | 'command' | 'note' | 'reject' | 'finding'
}

export type MachineView = {
  readonly step: number
  readonly lastThing: string

  /** The live state, read outside any frame. */
  readonly pressed: ReadonlyArray<InputCode>
  readonly justPressed: ReadonlyArray<InputCode>
  /** `MouseLeft@lock-target` — the button AND where it landed (DN-16 §5(b)). */
  readonly uiClicks: ReadonlyArray<string>
  readonly pointerDelta: { readonly x: number; readonly y: number }
  readonly wheelNotches: number
  readonly wheelSteps: number
  readonly pointerLocked: boolean
  readonly pointerLockState: PointerLockState
  readonly suppressContextMenu: boolean
  readonly suppressWheelScroll: boolean

  /** The last snapshot a `readSnapshot` step took — what a frame stage would have seen. */
  readonly lastFrameSnapshot: InputSnapshot | undefined
  readonly lastFrameSnapshotAtStep: number | undefined

  /** Whole notches the frame ACTED on, versus whole notches `endFrame` consumed. */
  readonly notchesReported: number
  readonly notchesConsumed: number

  readonly bindings: Bindings
  readonly actions: ReadonlyArray<ActionRow>

  /**
   * True when an unlocked left click ON THE CANVAS is one `acquiresPointerLock`
   * would act on.
   */
  readonly wouldAcquireOnLeftClick: boolean
  /**
   * The same click, landing on a hotbar slot instead. FALSE at every lock
   * state, and the whole of DN-16 §5(b): clicking your own HUD must not throw
   * you into mouselook and mask the focus ring the click just lit.
   */
  readonly wouldAcquireOnHudClick: boolean

  readonly clockSecs: number
  /** The latest mc-sim pose, or pending before the first publish. */
  readonly authoritativePose: CameraPoseSnapshot | undefined
  readonly mirrored: MirroredCameraState
  readonly viewOffset: ViewOffset
  readonly mirrorLag: number | undefined
  readonly mirrorStale: boolean
  /** True while no pose has ever been published. */
  readonly poseNeverPublished: boolean

  readonly log: ReadonlyArray<LogLine>
}

export type MachineConfig = {
  readonly scenario: ScenarioName
  readonly lockPort: LockPortMode
}

type Book = {
  step: number
  lastThing: string
  clockSecs: number
  authoritativePose: CameraPoseSnapshot | undefined
  viewOffset: ViewOffset
  poseNeverPublished: boolean
  lastFrameSnapshot: InputSnapshot | undefined
  lastFrameSnapshotAtStep: number | undefined
  /** The reading the current frame took, handed back to `endFrame`. Cleared by it. */
  frameReading: InputSnapshot | undefined
  notchesReported: number
  notchesConsumed: number
  log: Array<LogLine>
}

export type Machine = {
  readonly config: MachineConfig
  readonly advance: (steps: number) => Promise<void>
  /** Feed one event the operator typed, outside the script. */
  readonly inject: (thing: InputEvent | Command) => Promise<void>
  readonly view: () => Promise<MachineView>
}

const LOG_LIMIT = 10

const push = (book: Book, text: string, severity: LogLine['severity']): void => {
  book.log.push({ step: book.step, text, severity })
  if (book.log.length > LOG_LIMIT) {
    book.log.splice(0, book.log.length - LOG_LIMIT)
  }
}

/** A one-line rendering of an event, for the log and the header. */
export const describeEvent = (event: InputEvent): string => {
  switch (event.kind) {
    case 'keydown':
    case 'keyup':
      return `${event.kind} ${event.code} @${event.target}`
    case 'mousedown':
      // The landing is shown because it is half of what the event MEANS: the
      // same left click asks for the pointer on the canvas and asks for nothing
      // on a hotbar slot.
      return `mousedown ${event.button} @${event.target} on ${event.landing}`
    case 'mouseup':
      return `mouseup ${event.button} @${event.target}`
    case 'contextmenu':
      return `contextmenu @${event.target}`
    case 'pointermove':
      return `pointermove ${String(event.deltaX)}, ${String(event.deltaY)}`
    case 'wheel':
      return `wheel ${String(event.deltaY)} ${event.deltaMode}`
    case 'pointerlockchange':
      return `pointerlockchange locked=${String(event.locked)}`
    case 'pointerlockerror':
      return 'pointerlockerror'
    case 'blur':
      return 'blur'
    default:
      return 'unknown event'
  }
}

export const describeCommand = (command: Command): string => {
  switch (command.kind) {
    case 'requestLock':
      return 'requestPointerLock'
    case 'frameAsk':
      return 'render:input decides whether to ask'
    case 'readSnapshot':
      return 'snapshot  (a frame stage reads)'
    case 'endFrame':
      return 'endFrame  (the frame loop closes)'
    case 'clearHeld':
      return 'clearHeld'
    case 'rebind':
      return `rebind ${command.action} -> ${command.code}`
    case 'resetBindings':
      return 'resetBindings'
    case 'advanceClock':
      return `clock +${String(command.seconds)} s`
    case 'publishPose':
      return `mc-sim publishes (${String(command.x)}, ${String(command.y)}, ${String(command.z)})`
    case 'note':
      return command.text
    default:
      return 'unknown command'
  }
}

const INPUT_EVENT_KINDS: ReadonlySet<string> = new Set([
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'contextmenu',
  'pointermove',
  'wheel',
  'pointerlockchange',
  'pointerlockerror',
  'blur',
])

const isInputEventKind = (kind: string): boolean => INPUT_EVENT_KINDS.has(kind)

export const makeMachine = async (config: MachineConfig): Promise<Machine> => {
  const book: Book = {
    step: 0,
    lastThing: '(nothing yet)',
    clockSecs: 0,
    authoritativePose: undefined,
    viewOffset: NO_VIEW_OFFSET,
    poseNeverPublished: true,
    lastFrameSnapshot: undefined,
    lastFrameSnapshotAtStep: undefined,
    frameReading: undefined,
    notchesReported: 0,
    notchesConsumed: 0,
    log: [],
  }

  const service: InputServiceApi = await Effect.runPromise(
    makeInputService(defaultBindings(), portFor(config.lockPort)),
  )

  const scenario = scenarioFor(config.scenario)

  const runCommand = (command: Command): Effect.Effect<void> => {
    switch (command.kind) {
      case 'requestLock':
        return service.requestPointerLock.pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              push(book, `requestPointerLock -> ${state}`, state === 'requested' ? 'command' : 'reject')
            }),
          ),
          Effect.asVoid,
        )

      case 'frameAsk':
        // `stages/registration.ts`'s `render:input`, in miniature: the landings
        // are what the predicate reads, and a click on UI or on nothing is
        // reported and then declined.
        return Effect.gen(function* () {
          const snapshot = yield* service.snapshot
          const state = yield* service.pointerLockState
          const acting = snapshot.uiClickLandings.filter(({ button, landing }) =>
            acquiresPointerLock(button, state, landing),
          )
          if (acting.length === 0) {
            const seen = snapshot.uiClickLandings
              .map((click) => `${click.button}@${click.landing}`)
              .join(' ')
            push(
              book,
              `render:input asked for nothing (state ${state}; clicks: ${seen === '' ? '(none)' : seen})`,
              'reject',
            )
            return
          }
          const next = yield* service.requestPointerLock
          push(book, `render:input asked -> ${next}`, next === 'requested' ? 'command' : 'reject')
        })

      case 'readSnapshot':
        return service.snapshot.pipe(
          Effect.tap((snapshot) =>
            Effect.sync(() => {
              book.lastFrameSnapshot = snapshot
              book.lastFrameSnapshotAtStep = book.step
              // The reading this "frame" acted on, kept so the `endFrame` step
              // can hand it BACK — which is the whole contract. Reading it here
              // for the log costs nothing, because `snapshot` is a pure read.
              book.frameReading = snapshot
              book.notchesReported += snapshot.wheelSteps
              push(
                book,
                `snapshot: ${String(snapshot.wheelSteps)} wheel step(s), ${String(snapshot.justPressed.size)} edge(s)`,
                'command',
              )
            }),
          ),
          Effect.asVoid,
        )

      case 'endFrame':
        // Read the accumulator on BOTH sides of endFrame, so the difference is a
        // number the app can print rather than a claim it makes. That is only
        // measurable at all because `snapshot` is a PURE read: if the service
        // remembered what it last reported, these two instrumentation reads
        // would themselves decide how much the endFrame between them consumed,
        // and this app would reproduce the `lost-notch` finding through its own
        // overlay. See `endFrame` in application/input-service.ts.
        //
        // The frame's own reading — the one a `readSnapshot` step took — is what
        // gets handed back, and it is CLEARED afterwards: a frame that never
        // read the wheel must consume nothing.
        return Effect.gen(function* () {
          const before = (yield* service.snapshot).wheelNotches
          yield* service.endFrame(book.frameReading)
          book.frameReading = undefined
          const after = (yield* service.snapshot).wheelNotches
          const consumed = Math.round(before - after)
          book.notchesConsumed += consumed
          push(book, `endFrame: consumed ${String(consumed)} whole notch(es)`, 'command')
        })

      case 'clearHeld':
        return service.clearHeld.pipe(
          Effect.zipRight(Effect.sync(() => { push(book, 'clearHeld', 'command') })),
        )

      case 'rebind':
        return service
          .rebind(command.action as InputAction, command.code)
          .pipe(
            Effect.tap((outcome) =>
              Effect.sync(() => {
                push(
                  book,
                  outcome.kind === 'ok'
                    ? `rebind ${command.action} -> ${command.code}: ok`
                    : `rebind ${command.action} -> ${command.code}: ${outcome.rejection.reason}`,
                  outcome.kind === 'ok' ? 'command' : 'reject',
                )
              }),
            ),
            Effect.asVoid,
          )

      case 'resetBindings':
        return service.resetBindings.pipe(
          Effect.zipRight(Effect.sync(() => { push(book, 'resetBindings', 'command') })),
        )

      case 'advanceClock':
        return Effect.sync(() => {
          book.clockSecs += command.seconds
          push(book, `clock -> ${book.clockSecs.toFixed(3)} s`, 'command')
        })

      case 'publishPose':
        return Effect.sync(() => {
          const previous = book.authoritativePose
          book.authoritativePose = {
            position: position(command.x, command.y, command.z),
            yawRadians: previous?.yawRadians ?? 0,
            pitchRadians: previous?.pitchRadians ?? 0,
            capturedAtSecs: MonotonicTimeSecs(book.clockSecs),
          }
          book.poseNeverPublished = false
          push(book, `mc-sim published a pose stamped ${book.clockSecs.toFixed(3)} s`, 'command')
        })

      case 'note':
        return Effect.sync(() => {
          push(book, command.text, 'note')
        })

      default:
        return Effect.void
    }
  }

  const runThing = (thing: InputEvent | Command): Effect.Effect<void> =>
    'kind' in thing && isInputEventKind(thing.kind)
      ? service.dispatch(thing as InputEvent).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              push(book, describeEvent(thing as InputEvent), 'event')
            }),
          ),
        )
      : runCommand(thing as Command)

  const oneStep = Effect.gen(function* () {
    const scripted: ScriptedStep | undefined = stepAt(scenario, book.step)
    if (scripted !== undefined) {
      const thing = 'event' in scripted.what ? scripted.what.event : scripted.what.command
      book.lastThing =
        'event' in scripted.what
          ? describeEvent(scripted.what.event)
          : describeCommand(scripted.what.command)
      yield* runThing(thing)
    }
    book.step += 1
  })

  const advance = (steps: number): Promise<void> => {
    const count = Math.max(0, Math.trunc(steps))
    return count === 0
      ? Promise.resolve()
      : Effect.runPromise(Effect.repeatN(oneStep, count - 1).pipe(Effect.asVoid))
  }

  const inject = (thing: InputEvent | Command): Promise<void> =>
    Effect.runPromise(
      runThing(thing).pipe(
        Effect.zipRight(
          Effect.sync(() => {
            book.lastThing =
              'kind' in thing && isInputEventKind(thing.kind)
                ? describeEvent(thing as InputEvent)
                : describeCommand(thing as Command)
          }),
        ),
      ),
    )

  const view = (): Promise<MachineView> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* service.snapshot
        const bindings = yield* service.bindings
        const now = MonotonicTimeSecs(book.clockSecs)
        const mirrored = mirroredCameraState(book.authoritativePose, book.viewOffset)

        const actions: Array<ActionRow> = []
        for (const action of INPUT_ACTIONS) {
          actions.push({
            action,
            code: action === 'escape' ? undefined : bindings[action],
            active: yield* service.isActionActive(action),
            justTriggered: yield* service.wasActionJustTriggered(action),
          })
        }

        return {
          step: book.step,
          lastThing: book.lastThing,
          pressed: [...snapshot.pressed],
          justPressed: [...snapshot.justPressed],
          uiClicks: snapshot.uiClickLandings.map(
            (click) => `${click.button}@${click.landing}`,
          ),
          pointerDelta: snapshot.pointerDelta,
          wheelNotches: snapshot.wheelNotches,
          wheelSteps: snapshot.wheelSteps,
          pointerLocked: snapshot.pointerLocked,
          pointerLockState: snapshot.pointerLockState,
          suppressContextMenu: yield* service.shouldSuppressContextMenu,
          suppressWheelScroll: yield* service.shouldSuppressWheelScroll,
          lastFrameSnapshot: book.lastFrameSnapshot,
          lastFrameSnapshotAtStep: book.lastFrameSnapshotAtStep,
          notchesReported: book.notchesReported,
          notchesConsumed: book.notchesConsumed,
          bindings,
          actions,
          wouldAcquireOnLeftClick: acquiresPointerLock(
            'MouseLeft',
            snapshot.pointerLockState,
            'lock-target',
          ),
          wouldAcquireOnHudClick: acquiresPointerLock('MouseLeft', snapshot.pointerLockState, 'ui'),
          clockSecs: book.clockSecs,
          authoritativePose: book.authoritativePose,
          mirrored,
          viewOffset: book.viewOffset,
          mirrorLag: mirrorLagSecs(mirrored, now),
          mirrorStale: isMirrorStale(mirrored, now),
          poseNeverPublished: book.poseNeverPublished,
          log: [...book.log],
        } satisfies MachineView
      }),
    )

  return { config, advance, inject, view }
}

/** Which action a raw code currently means, for the live key echo. */
export const meaningOf = (bindings: Bindings, code: InputCode): string => {
  const action = actionForKey(bindings, code)
  if (action !== undefined) {
    return action
  }
  return isMouseButton(code) ? '(unbound button)' : '(unbound)'
}
