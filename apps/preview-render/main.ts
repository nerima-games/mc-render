/**
 * `apps/preview-render` — mc-render's built-in preview.
 *
 * plan.md §2.3-4 requires a preview to live with the thing it verifies, and
 * plan.md §4.1 puts it under `apps/preview-<name>/`: a dev application INSIDE
 * mc-render, not a package, not part of `index.ts`, and not something a consumer
 * can import.
 *
 * ---------------------------------------------------------------------------
 * Why this previews an input machine instead of loading a chunk
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md names this repository's preview 「固定チャンクを読み込んで
 * マテリアルとポストFXを目視」 — load a fixed chunk and eyeball the materials
 * and the post-processing. That needs a THREE.js adapter, a canvas and a GPU,
 * and mc-render deliberately has none of them: `tsconfig.base.json` omits "DOM"
 * from `lib`, which is exactly what makes the post-FX ordering, the wheel model
 * and the lock state machine testable in Node.
 *
 * Adding THREE to the preview alone would trade that mechanical guarantee for a
 * promise that some other tsconfig keeps — the same argument mc-worldgen's
 * preview makes at length and reaches the same conclusion on.
 *
 * So this previews what is actually modelled as data, and there is a great deal
 * of it: the pass chain in canonical order (including `composite`, which
 * plan.md's list omits), the four presets and what each enables, the material
 * policy and its `forceSinglePass` reason, the frame-scratch borrow/return
 * discipline, the camera mirror's staleness, and the whole input model.
 *
 * **The input state machine is the reason this app is a stepper.** plan.md §3.10
 * records that Playwright runs on SwiftShader and cannot do pointer lock at all,
 * so there is no browser test that can drive the four-value lock machine — and
 * that machine decides, for every mouse button press, whether it is a game
 * action or a UI click. `test/input.test.ts` drives it thoroughly in one fiber,
 * in the order a test author thought of. A steppable preview is the only place
 * where the ORDER of events is a knob, and two of this app's findings are
 * nothing but a reordering of two events a test happens to issue the other way
 * round.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - `apps` is in `SCAN_ROOTS` (scripts/check-dependency-whitelist.ts), so the
 *    preview's imports are gated like any other source here. It imports this
 *    repository's own modules and `effect`, which is already a declared
 *    dependency. No org package, no new npm dependency, no THREE.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies. The
 *    camera mirror's staleness is measured against a `MonotonicTimeSecs` this
 *    app holds and the operator moves, which is the whole point of that view.
 *    The `mc-kernel-allow-time-source` escape hatch is NOT used.
 *  - `pnpm verify` does not run this app. `tsconfig.preview.json` typechecks it
 *    and `pnpm lint` lints it, but `pnpm preview` is not a gate.
 */
import { Effect } from 'effect'
import type { InputEvent } from '../../src/application/input-service'
import { parseArguments, USAGE, type PreviewOptions } from './options'
import { describeCommand, describeEvent, makeMachine, type Machine } from './machine'
import { statsReport } from './probes'
import { SCENARIO_NAMES, type Command, type ScenarioName } from './script'
import { ANSI_STYLE, dim, PLAIN_STYLE, type Style } from './style'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  screenSize,
  writeLine,
} from './terminal'
import { renderFrame, scenarioCatalogue, VIEW_MODES, type ViewMode, type ViewToggles } from './views'

type State = {
  machine: Machine
  scenario: ScenarioName
  view: ViewMode
  toggles: ViewToggles
  showHelp: boolean
  busy: boolean
}

const frameWidth = (options: PreviewOptions): number =>
  Math.max(70, options.width ?? screenSize().columns)

const styleFor = (options: PreviewOptions): Style => (options.ascii ? PLAIN_STYLE : ANSI_STYLE)

/**
 * Keys that inject an event the script did not contain.
 *
 * This is the half a scripted timeline cannot give you: the ability to put a
 * `blur` between a `requestPointerLock` and its answer, or an `endFrame` before
 * the wheel event instead of after, and watch what the machine does about it.
 * Returning a value rather than dispatching keeps the table a pure function.
 */
const eventForKey = (key: string): InputEvent | Command | undefined => {
  switch (key) {
    case 'w':
      return { kind: 'keydown', code: 'KeyW', target: 'window' }
    case 'a':
      return { kind: 'keydown', code: 'KeyA', target: 'window' }
    case 's':
      return { kind: 'keydown', code: 'KeyS', target: 'window' }
    case 'd':
      return { kind: 'keydown', code: 'KeyD', target: 'window' }
    case 'W':
      return { kind: 'keyup', code: 'KeyW', target: 'window' }
    case 'A':
      return { kind: 'keyup', code: 'KeyA', target: 'window' }
    case 'S':
      return { kind: 'keyup', code: 'KeyS', target: 'window' }
    case 'D':
      return { kind: 'keyup', code: 'KeyD', target: 'window' }
    case 'e':
      return { kind: 'keydown', code: 'KeyE', target: 'window' }
    // The same key, dispatched where a modal overlay listens. The service must
    // ignore it: an event still tagged `document` is one the modal did not
    // consume, and was never meant for gameplay either way.
    case 'E':
      return { kind: 'keydown', code: 'KeyE', target: 'document' }
    // The three buttons, all landing ON THE CANVAS — the element the lock would
    // be granted to, and therefore the only landing that may ask for it.
    case 'l':
      return { kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'lock-target' }
    case 'r':
      return { kind: 'mousedown', button: 'MouseRight', target: 'window', landing: 'lock-target' }
    case 'm':
      return { kind: 'mousedown', button: 'MouseMiddle', target: 'window', landing: 'lock-target' }
    // The same left click, landing somewhere else. These two are DN-16 §5(b):
    // before the landing existed, all three of these keys did the same thing,
    // and clicking a hotbar slot threw the player into mouselook.
    case 'u':
      return { kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'ui' }
    case 'n':
      return { kind: 'mousedown', button: 'MouseLeft', target: 'window', landing: 'elsewhere' }
    case 'L':
      return { kind: 'mouseup', button: 'MouseLeft', target: 'window' }
    case 'R':
      return { kind: 'mouseup', button: 'MouseRight', target: 'window' }
    case 'M':
      return { kind: 'mouseup', button: 'MouseMiddle', target: 'window' }
    case ',':
      return { kind: 'wheel', deltaY: -100, deltaMode: 'pixel' }
    case '/':
      return { kind: 'wheel', deltaY: 100, deltaMode: 'pixel' }
    case '<':
      return { kind: 'wheel', deltaY: -30, deltaMode: 'pixel' }
    case '?':
      return { kind: 'wheel', deltaY: 30, deltaMode: 'pixel' }
    case 'o':
      return { kind: 'pointermove', deltaX: 12, deltaY: -4 }
    case 'g':
      return { kind: 'pointerlockchange', locked: true }
    case 'G':
      return { kind: 'pointerlockchange', locked: false }
    case 'k':
      return { kind: 'pointerlockerror' }
    case 'K':
      return { kind: 'requestLock' }
    case 'b':
      return { kind: 'blur' }
    case 'c':
      return { kind: 'clearHeld' }
    case 'f':
      return { kind: 'readSnapshot' }
    case 'F':
      return { kind: 'endFrame' }
    case '+':
      return { kind: 'advanceClock', seconds: 0.1 }
    case '-':
      return { kind: 'advanceClock', seconds: -0.1 }
    case 'P':
      return { kind: 'publishPose', x: 8, y: 65.62, z: -8 }
    default:
      return undefined
  }
}

const stepsForKey = (key: string): number | undefined => {
  switch (key) {
    case 'space':
    case '.':
    case 'right':
      return 1
    case '>':
      return 10
    default:
      return undefined
  }
}

const viewForKey = (key: string, current: ViewMode): ViewMode | undefined => {
  switch (key) {
    case '1':
      return 'input'
    case '2':
      return 'postfx'
    case '3':
      return 'material'
    case '4':
      return 'mirror'
    case '5':
      return 'scratch'
    case '6':
      return 'stages'
    case 'v': {
      const index = VIEW_MODES.indexOf(current)
      return VIEW_MODES[(index + 1) % VIEW_MODES.length] ?? current
    }
    default:
      return undefined
  }
}

const cycleScenario = (current: ScenarioName, by: number): ScenarioName => {
  const index = SCENARIO_NAMES.indexOf(current)
  return SCENARIO_NAMES[(index + by + SCENARIO_NAMES.length) % SCENARIO_NAMES.length] ?? current
}

const drawInto = async (state: State, options: PreviewOptions): Promise<ReadonlyArray<string>> => {
  if (state.showHelp) {
    return [...USAGE, '', dim('press any key to return')]
  }
  const view = await state.machine.view()
  return renderFrame(view, state.view, state.scenario, state.toggles, styleFor(options), frameWidth(options))
}

const runInteractive = (state: State, options: PreviewOptions): void => {
  enterFullScreen()

  let restored = false
  const restore = (): void => {
    if (!restored) {
      restored = true
      leaveFullScreen()
    }
  }
  onExit(restore)

  const draw = (): void => {
    void drawInto(state, options).then((lines) => {
      paintFrame(lines)
    })
  }

  const quit = (): void => {
    restore()
    process.exit(0)
  }

  const busyThen = (work: () => Promise<unknown>): void => {
    if (state.busy) {
      return
    }
    state.busy = true
    void work().then(() => {
      state.busy = false
      draw()
    })
  }

  onResize(draw)
  onInputEnd(quit)
  onKey((key) => {
    if (state.showHelp) {
      state.showHelp = false
      draw()
      return
    }

    if (key === 'x' || key === 'escape' || key === 'ctrl-c') {
      quit()
      return
    }

    const steps = stepsForKey(key)
    if (steps !== undefined) {
      busyThen(() => state.machine.advance(steps))
      return
    }

    const injected = eventForKey(key)
    if (injected !== undefined) {
      busyThen(() => state.machine.inject(injected))
      return
    }

    const nextView = viewForKey(key, state.view)
    if (nextView !== undefined) {
      state.view = nextView
      draw()
      return
    }

    if (key === '[' || key === ']') {
      const scenario = cycleScenario(state.scenario, key === '[' ? -1 : 1)
      busyThen(() =>
        makeMachine({ scenario, lockPort: options.lockPort }).then((machine) => {
          state.machine = machine
          state.scenario = scenario
        }),
      )
      return
    }

    switch (key) {
      case 'R':
        break
      case 't':
        state.toggles = { ...state.toggles, timeline: !state.toggles.timeline }
        break
      case 'p':
        state.toggles = { ...state.toggles, findings: !state.toggles.findings }
        break
      case 'h':
        state.showHelp = true
        break
      default:
        break
    }

    draw()
  })

  draw()
}

const main = async (): Promise<number> => {
  const options = parseArguments(process.argv.slice(2))

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      writeLine(`preview-render: ${error}`)
    }
    writeLine('')
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 1
  }

  if (options.help) {
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 0
  }

  if (options.list) {
    for (const entry of scenarioCatalogue(styleFor(options), frameWidth(options))) {
      writeLine(entry)
    }
    return 0
  }

  if (options.stats) {
    const report = await Effect.runPromise(statsReport)
    for (const entry of report) {
      writeLine(entry)
    }
    return 0
  }

  const machine = await makeMachine({ scenario: options.scenario, lockPort: options.lockPort })
  if (options.at > 0) {
    await machine.advance(options.at)
  }

  const state: State = {
    machine,
    scenario: options.scenario,
    view: options.view,
    toggles: { timeline: true, findings: true },
    showHelp: false,
    busy: false,
  }

  if (options.once || !isInteractive()) {
    if (!options.once) {
      writeLine(
        dim('preview-render: stdin/stdout is not a TTY, drawing a single frame (same as --once)'),
      )
    }
    for (const entry of await drawInto(state, options)) {
      writeLine(entry)
    }
    return 0
  }

  runInteractive(state, options)
  return 0
}

// `describeEvent` / `describeCommand` are re-exported through the views; naming
// them here keeps the import list honest about what this module depends on.
void describeEvent
void describeCommand

void main().then((exitCode) => {
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
})
