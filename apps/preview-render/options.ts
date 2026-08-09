/**
 * Command-line options for the preview.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without running the app
 * — which matters because `--scenario X --at N` is the entire reproduction
 * recipe for everything this app finds.
 */
import { SCENARIO_NAMES, type ScenarioName } from './script'
import { VIEW_MODES, type ViewMode } from './views'
import type { LockPortMode } from './machine'

export type PreviewOptions = {
  readonly scenario: ScenarioName
  readonly view: ViewMode
  /**
   * What the injected `PointerLockPort` answers.
   *
   * `sent` is the default because it is the interesting branch: it defers the
   * answer to a future event, and is therefore the one that can be left
   * unanswered. `unavailable` is the library's own default and what Node really
   * offers — it resolves to `refused` at once and can strand nothing.
   */
  readonly lockPort: LockPortMode
  /** Steps to run before drawing anything. The reproduction handle. */
  readonly at: number
  readonly once: boolean
  readonly ascii: boolean
  readonly stats: boolean
  readonly list: boolean
  readonly help: boolean
  readonly width: number | undefined
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  scenario: 'happy-path',
  view: 'input',
  lockPort: 'sent',
  at: 0,
  once: false,
  ascii: false,
  stats: false,
  list: false,
  help: false,
  width: undefined,
  errors: [],
} satisfies PreviewOptions

const isScenario = (value: string): value is ScenarioName =>
  (SCENARIO_NAMES as ReadonlyArray<string>).includes(value)

const isViewMode = (value: string): value is ViewMode =>
  (VIEW_MODES as ReadonlyArray<string>).includes(value)

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

const readNumber = (
  accumulator: Accumulator,
  flag: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    accumulator.errors = [...accumulator.errors, `${flag}: "${raw}" is not a number`]
    return undefined
  }
  return value
}

/** Splits `--flag=value` into its flag and inline value; `--flag value` has no inline value. */
const splitFlagToken = (token: string): { readonly flag: string; readonly inlineValue: string | undefined } => {
  const equalsAt = token.indexOf('=')
  if (equalsAt === -1) {
    return { flag: token, inlineValue: undefined }
  }
  return { flag: token.slice(0, equalsAt), inlineValue: token.slice(equalsAt + 1) }
}

const applyScenarioFlag = (accumulator: Accumulator, value: string | undefined): void => {
  if (value !== undefined && isScenario(value)) {
    accumulator.scenario = value
    return
  }
  accumulator.errors = [
    ...accumulator.errors,
    `--scenario: "${String(value)}" is not one of ${SCENARIO_NAMES.join(', ')}`,
  ]
}

const applyViewFlag = (accumulator: Accumulator, value: string | undefined): void => {
  if (value !== undefined && isViewMode(value)) {
    accumulator.view = value
    return
  }
  accumulator.errors = [
    ...accumulator.errors,
    `--view: "${String(value)}" is not one of ${VIEW_MODES.join(', ')}`,
  ]
}

const applyAtFlag = (accumulator: Accumulator, flag: string, raw: string | undefined): void => {
  accumulator.at = Math.max(0, Math.trunc(readNumber(accumulator, flag, raw) ?? accumulator.at))
}

const applyWidthFlag = (accumulator: Accumulator, flag: string, raw: string | undefined): void => {
  accumulator.width = readNumber(accumulator, flag, raw) ?? accumulator.width
}

/**
 * Accepts `--flag value` and `--flag=value`.
 *
 * Unknown flags are collected as errors rather than ignored. A silently dropped
 * `--scenario` is a preview confidently showing the wrong run.
 */
export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  while (queue.length > 0) {
    const token = queue.shift()
    if (token === undefined) {
      break
    }

    const { flag, inlineValue } = splitFlagToken(token)
    const takeValue = (): string | undefined => inlineValue ?? queue.shift()

    switch (flag) {
      // pnpm 9 forwards a literal `--` into argv when someone writes
      // `pnpm preview -- --stats` out of npm habit.
      case '--':
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      case '--list':
        accumulator.list = true
        break
      case '--stats':
        accumulator.stats = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--no-lock':
        accumulator.lockPort = 'unavailable'
        break
      case '--scenario':
        applyScenarioFlag(accumulator, takeValue())
        break
      case '--view':
        applyViewFlag(accumulator, takeValue())
        break
      case '--at':
        applyAtFlag(accumulator, flag, takeValue())
        break
      case '--width':
        applyWidthFlag(accumulator, flag, takeValue())
        break
      default:
        accumulator.errors = [...accumulator.errors, `unknown option: ${flag}`]
        break
    }
  }

  return { ...accumulator }
}

export const USAGE: ReadonlyArray<string> = [
  'pnpm preview [options]        steppable input & policy preview for @nerima-games/mc-render',
  '',
  'options',
  `  --scenario <name>   ${SCENARIO_NAMES.join(' | ')}`,
  '                      (default happy-path; --list describes them)',
  `  --view <mode>       ${VIEW_MODES.join(' | ')}   (default input)`,
  '  --at <n>            run n script steps before drawing — the reproduction handle',
  '  --no-lock           inject the library default port (unavailable) instead of one that answers `sent`',
  '  --once              render one frame to stdout and exit (no raw mode, pipe-safe)',
  '  --ascii             glyphs instead of colour — pasteable into an issue or a diff',
  '  --stats             print the numeric probe report instead of a picture',
  '  --list              describe the scenarios and exit',
  '  --width <n>         force the panel width in terminal cells',
  '  --help              this text',
  '',
  'keys (interactive)',
  '  space  .      run the next scripted step        |   >   run 10',
  '  1..6          input | postfx | material | mirror | scratch | stages',
  '  v             cycle the view                    |   [ ]  previous / next scenario',
  '  r             restart the scenario from step 0',
  '',
  'keys that inject an event OUTSIDE the script (this is the point of the app)',
  '  w a s d       keydown  @window                  |   W A S D   keyup @window',
  '  e             keydown KeyE @window              |   E   keydown KeyE @DOCUMENT (a modal consumes it)',
  '  l r m         mousedown MouseLeft / MouseRight / MouseMiddle @window, ON THE CANVAS',
  '  u n           mousedown MouseLeft on a HUD slot / on neither — these never take the pointer',
  '  L R M         mouseup   MouseLeft / MouseRight / MouseMiddle @window',
  '  , /           wheel -100 / +100 px              |   < ?   wheel -30 / +30 px (a trackpad)',
  '  o             pointermove +12, -4',
  '  g             pointerlockchange locked=true     |   G   pointerlockchange locked=false',
  '  k             pointerlockerror                  |   K   requestPointerLock',
  '  b             blur                              |   c   clearHeld',
  '  f             readSnapshot (a frame stage reads)|   F   endFrame',
  '  + -           clock +0.1 s / -0.1 s             |   P   mc-sim publishes a pose',
  '',
  '  t             toggle the timeline   |   p  toggle the findings',
  '  ? h           this help             |   x  Esc  Ctrl-C   quit',
]
