import {
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  POINTER_LOCK_ACQUIRE_BUTTON,
  POINTER_LOCK_STATES,
  WHEEL_LINES_PER_NOTCH,
  WHEEL_PAGES_PER_NOTCH,
  WHEEL_PIXELS_PER_NOTCH,
} from '../../src/domain/input-bindings'
import { LISTENER_PLAN } from '../../src/application/input-service'
import { type MachineView } from './machine'
import {
  BAD,
  fixed,
  GOOD,
  LABEL,
  NOTE,
  padStart,
  signedBar,
  VALUE,
  WARN,
  yesNo,
  type Style,
} from './style'
import { codes, heading, row } from './view-support'

const lockRow = (view: MachineView, style: Style): string => {
  const cells = POINTER_LOCK_STATES.map((state) => {
    const here = state === view.pointerLockState
    const colour = here ? (state === 'locked' ? GOOD : state === 'refused' ? BAD : WARN) : LABEL
    return style.paint(here ? `[${state}]` : ` ${state} `, colour)
  })
  return cells.join(' ')
}

export const inputView = (view: MachineView, style: Style, width: number): ReadonlyArray<string> => {
  const stranded = view.pointerLockState === 'requested'
  const notchGap = view.notchesConsumed - view.notchesReported

  const active = view.actions.filter((action) => action.active)
  const edges = view.actions.filter((action) => action.justTriggered)

  const frame = view.lastFrameSnapshot

  return [
    heading(style, 'pointer lock  (Playwright cannot reach this at all — plan.md §3.10)', width),
    row(style, 'state', lockRow(view, style)),
    row(
      style,
      'derived',
      `pointerLocked ${style.paint(yesNo(view.pointerLocked), view.pointerLocked ? GOOD : LABEL)}   ` +
        `suppress contextmenu ${style.paint(yesNo(view.suppressContextMenu), VALUE)}   ` +
        `suppress scroll ${style.paint(yesNo(view.suppressWheelScroll), VALUE)}`,
    ),
    row(
      style,
      'a left click',
      view.pointerLocked
        ? style.dim('is a GAME action: it joins pressed / justPressed like a key')
        : `${style.paint(`on the canvas -> ${yesNo(view.wouldAcquireOnLeftClick)}`, view.wouldAcquireOnLeftClick ? GOOD : WARN)}   ${style.paint(`on a HUD slot -> ${yesNo(view.wouldAcquireOnHudClick)}`, view.wouldAcquireOnHudClick ? BAD : GOOD)}   ${style.dim(`(only ${POINTER_LOCK_ACQUIRE_BUTTON} asks, only from unlocked / refused, only on the LOCK TARGET)`)}`,
    ),
    ...(view.pointerLocked
      ? []
      : [
          row(
            style,
            '',
            style.dim(
              'DN-16 §5(b): the HUD column was the hazard. tabindex="-1" focuses on click, so the ring ' +
                'lit; the same mousedown bubbled to window and took the pointer, masking it.',
            ),
          ),
        ]),
    ...(stranded
      ? [
          row(
            style,
            '',
            style.paint(
              'STUCK: `requested` is left only by pointerlockchange or pointerlockerror. blur keeps it, ' +
                'and requestPointerLock will not re-ask while it is pending.',
              BAD,
            ),
          ),
        ]
      : []),
    '',
    heading(style, 'held state  (live, outside any frame)', width),
    row(style, 'pressed', style.paint(codes(view.pressed), VALUE)),
    row(
      style,
      'justPressed',
      `${style.paint(codes(view.justPressed), view.justPressed.length > 0 ? WARN : VALUE)}   ${
        style.dim('cleared by endFrame; an auto-repeat keydown does NOT re-arm it')}`,
    ),
    row(
      style,
      'uiClicks',
      `${style.paint(codes(view.uiClicks), view.uiClicks.length > 0 ? NOTE : VALUE)}   ${
        style.dim('clicks that landed while UNLOCKED, with WHERE; attack cannot fire from these')}`,
    ),
    row(
      style,
      'actions',
      active.length === 0
        ? style.dim('(none active)')
        : style.paint(active.map((entry) => entry.action).join(' '), GOOD) +
          (edges.length === 0
            ? ''
            : `   ${style.paint(`edge: ${edges.map((entry) => entry.action).join(' ')}`, WARN)}`),
    ),
    '',
    heading(style, 'analogue', width),
    row(
      style,
      'pointerDelta',
      `x ${style.paint(padStart(fixed(view.pointerDelta.x, 1), 8), VALUE)} ${style.dim(signedBar(view.pointerDelta.x, 100, 12))}   y ${style.paint(padStart(fixed(view.pointerDelta.y, 1), 8), VALUE)}   ${
        style.dim('accumulated ONLY while locked; dropped when the lock ends (DN-09)')}`,
    ),
    row(
      style,
      'wheel',
      `${style.paint(padStart(`${fixed(view.wheelNotches, 3)} notches`, 15), VALUE)} ${style.dim(signedBar(view.wheelNotches, 3, 12))}` +
        `   whole steps ${style.paint(String(view.wheelSteps), VALUE)}`,
    ),
    row(
      style,
      'notch ledger',
      `reported to frames ${style.paint(String(view.notchesReported), VALUE)}   ` +
        `consumed by endFrame ${style.paint(String(view.notchesConsumed), notchGap === 0 ? VALUE : BAD)}${
        notchGap === 0
          ? style.dim('   in balance')
          : style.paint(`   ${String(notchGap)} NOTCH(ES) CONSUMED THAT NO FRAME SAW`, BAD)}`,
    ),
    row(
      style,
      'notch sizes',
      style.dim(
        `pixel ${String(WHEEL_PIXELS_PER_NOTCH)}  ·  line ${String(WHEEL_LINES_PER_NOTCH)}  ·  page ${String(WHEEL_PAGES_PER_NOTCH)} — normalised at dispatch, so a trackpad and a wheel can sum`,
      ),
    ),
    '',
    heading(style, 'last frame snapshot  (what a stage actually saw)', width),
    frame === undefined
      ? row(style, '', style.dim('no readSnapshot step has run yet'))
      : row(
          style,
          `at step ${String(view.lastFrameSnapshotAtStep ?? 0)}`,
          `pressed ${style.paint(String(frame.pressed.size), VALUE)}   ` +
            `justPressed ${style.paint(String(frame.justPressed.size), VALUE)}   ` +
            `uiClicks ${style.paint(String(frame.uiClicks.size), VALUE)}   ` +
            `wheelSteps ${style.paint(String(frame.wheelSteps), VALUE)}   ` +
            `lock ${style.paint(frame.pointerLockState, VALUE)}`,
        ),
    '',
    heading(style, 'the Escape rule', width),
    row(
      style,
      'owner',
      `${style.paint(ESCAPE_OWNER, VALUE)}   ${style.dim(`${ESCAPE_KEY_CODE} is registered by nobody and maps to no action`)}`,
    ),
    row(
      style,
      'shielding',
      style.dim(
        `gameplay listens on ${LISTENER_PLAN[0]?.target ?? 'window'}; a modal stopPropagation()s on document, which is INSIDE it`,
      ),
    ),
  ]
}
