/**
 * The scripted input sequences.
 *
 * A dev application, not shipped API.
 *
 * A scenario is DATA: a list of `(step, InputEvent | Command)` pairs. Nothing
 * here runs anything, which is what makes a scenario quotable in a bug report —
 * the whole reproduction is `--scenario <name> --at <step>`, and the reader can
 * see what each step does without running it.
 *
 * ---------------------------------------------------------------------------
 * Why the input state machine is the thing being previewed
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.10 records that Playwright runs on SwiftShader and **cannot do
 * pointer lock at all**. `application/input-service.ts:209-214` repeats it and
 * draws the conclusion: a `canvas.requestPointerLock()` inside the service
 * "would be a behaviour NOTHING could test".
 *
 * The consequence for a preview is sharper than that. The lock state is a
 * four-value machine whose transitions decide, for every mouse button press,
 * whether it is a game action or a UI click (`withButtonDown`,
 * input-service.ts:432-435). No browser test can drive it. `test/input.test.ts`
 * drives it beautifully, in one fiber, in the order a test author thought of.
 *
 * A steppable preview is therefore the only place a human can watch that
 * machine — and, crucially, the only place the ORDER of events is a knob rather
 * than a constant. Two of the three findings in this app come from reordering
 * two events that a test happens to issue in the other order.
 */
import type { InputEvent } from '../../application/input-service'
import type { WheelDeltaMode } from '../../domain/input-bindings'

/** Something the driver does that is not an `InputEvent`. */
export type Command =
  /** Ask for the pointer lock, as `stages/registration.ts` does on a UI click. */
  | { readonly kind: 'requestLock' }
  /** Read a frame snapshot, as a frame stage would. Recorded, so ordering is visible. */
  | { readonly kind: 'readSnapshot' }
  /** End the frame. The frame loop calls this exactly once per frame. */
  | { readonly kind: 'endFrame' }
  /** `blur`'s companion: the explicit API a host may call. */
  | { readonly kind: 'clearHeld' }
  | { readonly kind: 'rebind'; readonly action: string; readonly code: string }
  | { readonly kind: 'resetBindings' }
  /** Move the injected monotonic clock, for the camera-mirror view. */
  | { readonly kind: 'advanceClock'; readonly seconds: number }
  /** Publish a pose from "mc-sim", as the authority would. */
  | { readonly kind: 'publishPose'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'note'; readonly text: string }

export type ScriptedThing = { readonly event: InputEvent } | { readonly command: Command }

export type ScriptedStep = {
  readonly step: number
  readonly what: ScriptedThing
  /** Why this step is here. Shown in the timeline. */
  readonly why: string
}

export type Scenario = {
  readonly name: string
  readonly headline: string
  readonly detail: ReadonlyArray<string>
  readonly steps: ReadonlyArray<ScriptedStep>
}

const at = (step: number, why: string, what: ScriptedThing): ScriptedStep => ({ step, what, why })
const ev = (event: InputEvent): ScriptedThing => ({ event })
const cmd = (command: Command): ScriptedThing => ({ command })

const wheel = (deltaY: number, deltaMode: WheelDeltaMode = 'pixel'): InputEvent => ({
  kind: 'wheel',
  deltaY,
  deltaMode,
})

/**
 * An ordinary frame, so the panels have a baseline that is not a defect.
 *
 * Walk forward, look around, break a block, cycle the hotbar, open a modal that
 * shields a key. Everything behaves.
 */
const HAPPY_PATH: Scenario = {
  name: 'happy-path',
  headline: 'lock, walk, look, break a block, cycle the hotbar, shield a key',
  detail: [
    'The baseline. A UI click asks for the lock, the browser grants it, and from',
    'there every button is a game action. Watch justPressed appear for exactly',
    'one frame, uiClicks stay empty once locked, and the KeyE dispatched at',
    'document be ignored — that is the modal shielding rule, and it is the only',
    'thing standing between one Escape and two consequences.',
  ],
  steps: [
    at(0, 'the player clicks the canvas while unlocked: a UI click, not an attack', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(1, 'the frame sees the UI click and asks', cmd({ kind: 'requestLock' })),
    at(2, 'the browser grants it', ev({ kind: 'pointerlockchange', locked: true })),
    at(3, 'walk forward', ev({ kind: 'keydown', code: 'KeyW', target: 'window' })),
    at(4, 'read', cmd({ kind: 'readSnapshot' })),
    at(5, 'frame boundary: justPressed clears, pressed does not', cmd({ kind: 'endFrame' })),
    at(6, 'auto-repeat. NOT a second edge — holding E must not toggle a menu 30x/s', ev({ kind: 'keydown', code: 'KeyW', target: 'window' })),
    at(7, 'mouselook', ev({ kind: 'pointermove', deltaX: 12, deltaY: -4 })),
    at(8, 'break a block: locked, so MouseLeft joins the ordinary code space', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(9, 'the browser wants its menu; the adapter suppresses it while locked', ev({ kind: 'contextmenu', target: 'document' })),
    at(10, 'read', cmd({ kind: 'readSnapshot' })),
    at(11, 'end', cmd({ kind: 'endFrame' })),
    at(12, 'one detent down the hotbar', ev(wheel(100))),
    at(13, 'read', cmd({ kind: 'readSnapshot' })),
    at(14, 'end', cmd({ kind: 'endFrame' })),
    at(15, 'an inventory modal consumed this key at document. Gameplay must not see it', ev({ kind: 'keyup', code: 'KeyW', target: 'document' })),
    at(16, 'read: KeyW is STILL held, because the modal shielded the keyup', cmd({ kind: 'readSnapshot' })),
    at(17, 'the real keyup, at window', ev({ kind: 'keyup', code: 'KeyW', target: 'window' })),
    at(18, 'end', cmd({ kind: 'endFrame' })),
  ],
}

/**
 * The absorbing state.
 *
 * `PointerLockRequestOutcome`'s doc (input-service.ts:236-240) says the
 * `unavailable` value exists because "a request that can never be answered
 * would otherwise leave the state machine in `requested` for the rest of the
 * session", and `test/input.test.ts:1094-1099` pins that path with the comment
 * "Leaving the machine in `requested` would strand it for the session."
 *
 * The `sent` path has the same hole and nothing guards it.
 */
const STRANDED_REQUEST: Scenario = {
  name: 'stranded-request',
  headline: 'the ask went out, the answer never came, and nothing can ask again',
  detail: [
    'The port reports `sent`, so the service moves to `requested` and waits for',
    'an event. The window then blurs. `blur` clears every held code and',
    'deliberately KEEPS the lock state, so `requested` survives it — and',
    'requestPointerLock is idempotent while pending, by design, so it will not',
    'ask again. From step 3 on, every click the player makes is a uiClick that',
    'acquiresPointerLock() declines to act on, for the rest of the session.',
  ],
  steps: [
    at(0, 'a UI click', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(1, 'the ask goes out; the port says `sent`', cmd({ kind: 'requestLock' })),
    at(2, 'the user alt-tabs before the browser answers', ev({ kind: 'blur' })),
    at(3, 'back at the tab. Click to look around again', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(4, 'the frame asks. It is refused by our OWN machine, not the browser', cmd({ kind: 'requestLock' })),
    at(5, 'end', cmd({ kind: 'endFrame' })),
    at(6, 'and again', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(7, 'and again', cmd({ kind: 'requestLock' })),
    at(8, 'a keypress still works — the keyboard never needed the lock', ev({ kind: 'keydown', code: 'KeyW', target: 'window' })),
    at(9, 'read: pointerLocked false, state `requested`, and no way out', cmd({ kind: 'readSnapshot' })),
  ],
}

/**
 * The lost notch.
 *
 * `endFrame` consumes `Math.trunc(wheelNotches)` READ AT endFrame TIME, not the
 * value the frame's snapshot reported. A wheel event that lands between the two
 * pushes the accumulator over a notch boundary, and that notch is subtracted
 * without any consumer having seen it.
 *
 * The events here are the same in both halves; only the order differs.
 */
const LOST_NOTCH: Scenario = {
  name: 'lost-notch',
  headline: 'endFrame consumes a wheel step the snapshot never reported',
  detail: [
    'Steps 0-4 are the ordered case: the browser delivers, the frame reads, the',
    'frame ends. One notch in, one notch acted on.',
    'Steps 5-10 are the same events with one of them arriving between the read',
    'and the endFrame — which is exactly where a DOM listener runs. The frame',
    'sees 0 steps and acts on 0 slots; endFrame then subtracts 1. The hotbar',
    'slot the player scrolled to is never selected, and nothing reports it.',
  ],
  steps: [
    at(0, 'locked, so the wheel means the hotbar', ev({ kind: 'pointerlockchange', locked: true })),
    at(1, 'a trackpad flick: 0.9 of a notch', ev(wheel(90))),
    at(2, 'and 0.3 more, BEFORE the frame reads', ev(wheel(30))),
    at(3, 'read: 1.2 notches -> 1 whole step. The hotbar moves one slot', cmd({ kind: 'readSnapshot' })),
    at(4, 'end: 1 consumed, 0.2 carried. Correct', cmd({ kind: 'endFrame' })),
    at(5, 'now the same total, reordered. 0.6 on top of the 0.2 carried = 0.8', ev(wheel(60))),
    at(6, 'read: 0.8 notches -> 0 whole steps. The hotbar does not move', cmd({ kind: 'readSnapshot' })),
    at(7, 'a DOM wheel listener fires HERE, between the read and the endFrame', ev(wheel(30))),
    at(8, 'end: trunc is re-read at 1.1, so 1 is consumed that no frame was told about', cmd({ kind: 'endFrame' })),
    at(9, 'read: 0.1 carried. The detent the player turned selected nothing', cmd({ kind: 'readSnapshot' })),
    at(10, 'note', cmd({ kind: 'note', text: 'the NOTCH LEDGER row is now out of balance by 1' })),
  ],
}

/**
 * Blur leaves the machine reporting that mouselook is live.
 *
 * `blur` returns `{ ...initialState(bindings), pointerLockState: current.pointerLockState }`
 * (input-service.ts:581-585). Every held code goes; the one field that decides
 * whether the NEXT click is an attack or a UI click stays.
 */
const BLUR_WHILE_LOCKED: Scenario = {
  name: 'blur-while-locked',
  headline: 'after blur the service still reports pointerLocked, so the refocus click attacks',
  detail: [
    'blur clears pressed, justPressed, uiClicks, the pointer delta and the wheel',
    'accumulator — everything except pointerLockState. So between the blur and',
    "the browser's pointerlockchange, isActionActive is false but pointerLocked",
    'is TRUE, shouldSuppressContextMenu is TRUE, and withButtonDown routes the',
    'next mousedown into `pressed` as a game action. That mousedown is the click',
    'the player used to come back to the tab.',
  ],
  steps: [
    at(0, 'in the game', ev({ kind: 'pointerlockchange', locked: true })),
    at(1, 'holding left to break a block', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(2, 'and walking', ev({ kind: 'keydown', code: 'KeyW', target: 'window' })),
    at(3, 'read: attack held, moveForward held', cmd({ kind: 'readSnapshot' })),
    at(4, 'alt-tab', ev({ kind: 'blur' })),
    at(5, 'read: everything released — except the lock state', cmd({ kind: 'readSnapshot' })),
    at(6, 'the click that refocuses the window', ev({ kind: 'mousedown', button: 'MouseLeft', target: 'window' })),
    at(7, 'read: it is in pressed and justPressed. attack fired', cmd({ kind: 'readSnapshot' })),
    at(8, 'the browser gets around to telling us the lock ended', ev({ kind: 'pointerlockchange', locked: false })),
    at(9, 'read: now it is unlocked, one click too late', cmd({ kind: 'readSnapshot' })),
  ],
}

/**
 * The camera mirror, and the state it starts in.
 *
 * `makeRenderFrameState` seeds `mirroredCamera` from `UNSET_CAMERA_POSE`
 * (`capturedAtSecs` 0) and `mirrorLagSecs` from the literal `0`. Those two
 * disagree from the first instant.
 */
const MIRROR_STALENESS: Scenario = {
  name: 'mirror-staleness',
  headline: 'the mirrored pose starts unset, and starts claiming to be fresh',
  detail: [
    'No render stage ever writes authoritativePose — mc-sim does, across the',
    'boundary. Until it does, the mirror holds UNSET_CAMERA_POSE with',
    'capturedAtSecs 0, while mirrorLagSecs is initialised to 0, i.e. "perfectly',
    'fresh". Advance the injected clock and the two answers diverge without any',
    'pose having changed. Then publish a pose and watch it settle.',
  ],
  steps: [
    at(0, 'nothing has published a pose yet', cmd({ kind: 'note', text: 'lag says 0; the pose is UNSET' })),
    at(1, 'a tenth of a second of real startup', cmd({ kind: 'advanceClock', seconds: 0.1 })),
    at(2, 'a second more', cmd({ kind: 'advanceClock', seconds: 1 })),
    at(3, 'four seconds of chunk loading', cmd({ kind: 'advanceClock', seconds: 4 })),
    at(4, 'mc-sim finally publishes', cmd({ kind: 'publishPose', x: 8, y: 65.62, z: -8 })),
    at(5, 'one frame later', cmd({ kind: 'advanceClock', seconds: 0.016 })),
    at(6, 'a 200 ms hitch: past MIRROR_LAG_WARNING_SECS', cmd({ kind: 'advanceClock', seconds: 0.2 })),
    at(7, 'sim catches up', cmd({ kind: 'publishPose', x: 8, y: 65.62, z: -9 })),
  ],
}

/**
 * Remapping, and the Escape ownership rule.
 */
const REBINDING: Scenario = {
  name: 'rebinding',
  headline: 'one key one action, and Escape belongs to nobody',
  detail: [
    'Buttons and keys share one code space, which is why `attack` can be moved',
    'to a key and `jump` to a button with no new machinery. The three rejections',
    'are shown in priority order. Note that the rebind is applied to a service',
    'that already has codes held.',
  ],
  steps: [
    at(0, 'move attack to a key. The vertical-slice workaround, now a legitimate remap', cmd({ kind: 'rebind', action: 'attack', code: 'KeyB' })),
    at(1, 'jump to a mouse button', cmd({ kind: 'rebind', action: 'jump', code: 'MouseMiddle' })),
    at(2, 'REJECTED: MouseMiddle now belongs to jump', cmd({ kind: 'rebind', action: 'use', code: 'MouseMiddle' })),
    at(3, 'REJECTED: escape is not a bindable action', cmd({ kind: 'rebind', action: 'escape', code: 'KeyP' })),
    at(4, 'REJECTED: Escape is not a bindable KEY either', cmd({ kind: 'rebind', action: 'sprint', code: 'Escape' })),
    at(5, 'REJECTED: not an action at all — reachable from a corrupt settings blob', cmd({ kind: 'rebind', action: 'fly', code: 'KeyG' })),
    at(6, 'press the new attack key', ev({ kind: 'keydown', code: 'KeyB', target: 'window' })),
    at(7, 'read: attack is active from a KEY, with no mouse in sight', cmd({ kind: 'readSnapshot' })),
    at(8, 'Escape reaches gameplay as a raw code, bound to nothing', ev({ kind: 'keydown', code: 'Escape', target: 'window' })),
    at(9, 'read: `Escape` is in pressed; actionForKey resolves it to nothing', cmd({ kind: 'readSnapshot' })),
    at(10, 'back to defaults', cmd({ kind: 'resetBindings' })),
    at(11, 'read: KeyB is still HELD, and now means nothing', cmd({ kind: 'readSnapshot' })),
  ],
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  HAPPY_PATH,
  STRANDED_REQUEST,
  LOST_NOTCH,
  BLUR_WHILE_LOCKED,
  MIRROR_STALENESS,
  REBINDING,
]

export const SCENARIO_NAMES = [
  'happy-path',
  'stranded-request',
  'lost-notch',
  'blur-while-locked',
  'mirror-staleness',
  'rebinding',
] as const

export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export const scenarioFor = (name: ScenarioName): Scenario =>
  SCENARIOS.find((scenario) => scenario.name === name) ?? HAPPY_PATH

/** The step scheduled at `step`, if any. One per step: order is the subject here. */
export const stepAt = (scenario: Scenario, step: number): ScriptedStep | undefined =>
  scenario.steps.find((scripted) => scripted.step === step)

/** How many steps the scenario has. */
export const scenarioLength = (scenario: Scenario): number =>
  scenario.steps.reduce((longest, scripted) => Math.max(longest, scripted.step + 1), 0)
