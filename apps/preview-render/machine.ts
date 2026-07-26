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
} from '../../application/input-service'
import {
  isMirrorStale,
  mirroredCameraState,
  mirrorLagSecs,
  NO_VIEW_OFFSET,
  type MirroredCameraState,
  type ViewOffset,
} from '../../domain/camera-mirror'
import {
  acquiresPointerLock,
  actionForKey,
  defaultBindings,
  INPUT_ACTIONS,
  isMouseButton,
  type Bindings,
  type InputAction,
  type InputCode,
  type MouseButton,
  type PointerLockState,
} from '../../domain/input-bindings'
import { UNSET_CAMERA_POSE } from '../../stages/registration'
import { MonotonicTimeSecs, position, type CameraPoseSnapshot } from '../../domain/kernel-vocabulary'
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
  readonly uiClicks: ReadonlyArray<MouseButton>
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

  /** True when an unlocked click is one `acquiresPointerLock` would act on. */
  readonly wouldAcquireOnLeftClick: boolean

  readonly clockSecs: number
  readonly authoritativePose: CameraPoseSnapshot
  readonly mirrored: MirroredCameraState
  readonly viewOffset: ViewOffset
  readonly mirrorLag: number
  readonly mirrorStale: boolean
  /** True while no pose has ever been published — the mirror is showing UNSET. */
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
  authoritativePose: CameraPoseSnapshot
  viewOffset: ViewOffset
  poseNeverPublished: boolean
  lastFrameSnapshot: InputSnapshot | undefined
  lastFrameSnapshotAtStep: number | undefined
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
    case 'mouseup':
      return `${event.kind} ${event.button} @${event.target}`
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

export const makeMachine = async (config: MachineConfig): Promise<Machine> => {
  const book: Book = {
    step: 0,
    lastThing: '(nothing yet)',
    clockSecs: 0,
    authoritativePose: UNSET_CAMERA_POSE,
    viewOffset: NO_VIEW_OFFSET,
    poseNeverPublished: true,
    lastFrameSnapshot: undefined,
    lastFrameSnapshotAtStep: undefined,
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

      case 'readSnapshot':
        return service.snapshot.pipe(
          Effect.tap((snapshot) =>
            Effect.sync(() => {
              book.lastFrameSnapshot = snapshot
              book.lastFrameSnapshotAtStep = book.step
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
        // number the app can print rather than a claim it makes. This is the
        // whole `lost-notch` finding: the trunc endFrame subtracts is re-read at
        // endFrame time and need not equal the one the snapshot reported.
        return Effect.gen(function* () {
          const before = (yield* service.snapshot).wheelNotches
          yield* service.endFrame
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
          book.authoritativePose = {
            position: position(command.x, command.y, command.z),
            yawRadians: book.authoritativePose.yawRadians,
            pitchRadians: book.authoritativePose.pitchRadians,
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
          uiClicks: [...snapshot.uiClicks],
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
          wouldAcquireOnLeftClick: acquiresPointerLock('MouseLeft', snapshot.pointerLockState),
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

function isInputEventKind(kind: string): boolean {
  return INPUT_EVENT_KINDS.has(kind)
}

/** Which action a raw code currently means, for the live key echo. */
export const meaningOf = (bindings: Bindings, code: InputCode): string => {
  const action = actionForKey(bindings, code)
  if (action !== undefined) {
    return action
  }
  return isMouseButton(code) ? '(unbound button)' : '(unbound)'
}
