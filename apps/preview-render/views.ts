/**
 * The six views.
 *
 * A dev application, not shipped API.
 *
 * Every function here is a pure function of a `MachineView` (or of the library's
 * own data) and a `Style`. That is not tidiness: the views ARE the claim this
 * preview makes, and a claim that can only be evaluated by running a terminal UI
 * is a claim nobody checks.
 *
 * mc-render ships no THREE.js and no `lib.DOM`, so there is nothing here to
 * draw a picture OF. What there is, is a great deal of policy modelled as data —
 * the pass order, the preset table, the material rules, the stage graph, the
 * listener plan, the four-value lock machine — and every one of those is a table
 * a person can read and disagree with. That is what these views print.
 */
import {
  auditMaterials,
  describeMaterialPolicy,
  isCutout,
  requiresForceSinglePass,
  takesTwoPassPath,
  type MaterialSpec,
} from '../../src/domain/material-policy'
import {
  buildPostProcessingChain,
  chainEffects,
  chainPasses,
  COMPOSITE_SUBSUMES,
  isCompositeActive,
  MANDATORY_PASSES,
  passOrderIndex,
  POST_PROCESSING_PASS_ORDER,
  QUALITY_PRESETS,
  validatePostProcessingChain,
  type PostProcessingPass,
  type QualityPreset,
} from '../../src/domain/post-processing'
import {
  ESCAPE_KEY_CODE,
  ESCAPE_OWNER,
  MOUSE_BUTTONS,
  POINTER_LOCK_ACQUIRE_BUTTON,
  POINTER_LOCK_STATES,
  WHEEL_LINES_PER_NOTCH,
  WHEEL_PAGES_PER_NOTCH,
  WHEEL_PIXELS_PER_NOTCH,
} from '../../src/domain/input-bindings'
import { LISTENER_PLAN } from '../../src/application/input-service'
import { MIRROR_LAG_WARNING_SECS } from '../../src/domain/camera-mirror'
import { RENDER_STAGE_IDS, UPSTREAM_STAGE_IDS } from '../../src/stages/stage-ids'
import { scenarioFor, scenarioLength, stepAt, type ScenarioName } from './script'
import { describeCommand, describeEvent, type MachineView } from './machine'
import {
  BAD,
  bar,
  bold,
  fixed,
  GOOD,
  LABEL,
  NOTE,
  pad,
  padStart,
  signedBar,
  VALUE,
  WARN,
  yesNo,
  type Style,
} from './style'

const LABEL_WIDTH = 15

const row = (style: Style, label: string, value: string): string =>
  `${style.paint(pad(label, LABEL_WIDTH), LABEL)}${value}`

const heading = (style: Style, text: string, width: number): string => {
  const prefix = `-- ${text} `
  return style.dim(prefix + '-'.repeat(Math.max(0, width - prefix.length)))
}

const codes = (values: ReadonlyArray<string>): string =>
  values.length === 0 ? '(none)' : values.join(' ')

export const VIEW_MODES = ['input', 'postfx', 'material', 'mirror', 'scratch', 'stages'] as const

export type ViewMode = (typeof VIEW_MODES)[number]

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

/**
 * The four-value lock machine, drawn as a machine.
 *
 * `POINTER_LOCK_STATES` is the declaration order and `PointerLockState`'s doc
 * explains each. Printing the current one against the whole set is what makes
 * `requested` legible as a state you can be STUCK in, rather than as a
 * momentary value that happens to be showing.
 */
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

// ---------------------------------------------------------------------------
// postfx
// ---------------------------------------------------------------------------

const PASS_NOTE: Readonly<Record<PostProcessingPass, string>> = {
  render: 'the scene into a buffer. Unconditional',
  gtao: 'ambient occlusion. Needs the RAW depth/normal buffers, so it goes first',
  godRays: 'bright streaks. BEFORE bloom, or bloom never picks them up',
  bloom: 'threshold + blur. AFTER god rays, BEFORE depth of field',
  bokeh: 'depth of field. AFTER bloom, or the blur is re-sharpened',
  composite: 'bloom + godRays + bokeh in ONE shader. plan.md omits this pass',
  smaa: 'anti-aliasing. Must see the FINAL image, so nothing may follow it but output',
  output: 'tone mapping + colour space. Unconditional, and always last',
}

export const postFxView = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [
    heading(style, 'the canonical order  (declaration order IS the specification)', width),
  ]

  for (const pass of POST_PROCESSING_PASS_ORDER) {
    const mandatory = MANDATORY_PASSES.has(pass)
    const subsumed = COMPOSITE_SUBSUMES.has(pass)
    lines.push(
      row(
        style,
        '',
        `${style.dim(padStart(String(passOrderIndex(pass)), 3))}  ${style.paint(pad(pass, 11), mandatory ? GOOD : VALUE)}${style.paint(pad(mandatory ? 'always' : subsumed ? 'subsumed' : 'optional', 10), mandatory ? GOOD : subsumed ? NOTE : LABEL)}${style.dim(PASS_NOTE[pass])}`,
      ),
    )
  }

  lines.push('')
  lines.push(heading(style, 'the four presets', width))
  lines.push(
    row(
      style,
      '',
      style.dim(
        `${pad('preset', 9)}${pad('ssao', 6)}${pad('rays', 6)}${pad('bloom', 7)}${pad('dof', 5)}${pad('smaa', 6)}${pad('comp', 6)}${pad('active', 8)}chain`,
      ),
    ),
  )

  for (const preset of ['low', 'medium', 'high', 'ultra'] as ReadonlyArray<QualityPreset>) {
    const quality = QUALITY_PRESETS[preset]
    const chain = buildPostProcessingChain(quality)
    const violations = validatePostProcessingChain(chainPasses(chain))
    lines.push(
      row(
        style,
        '',
        `${style.paint(pad(preset, 9), VALUE)}` +
          `${style.dim(pad(yesNo(quality.ssaoEnabled), 6))}` +
          `${style.dim(pad(yesNo(quality.godRaysEnabled), 6))}` +
          `${style.dim(pad(yesNo(quality.bloomEnabled), 7))}` +
          `${style.dim(pad(yesNo(quality.dofEnabled), 5))}` +
          `${style.dim(pad(yesNo(quality.smaaEnabled), 6))}` +
          `${style.dim(pad(yesNo(quality.useCompositePass), 6))}` +
          `${style.paint(pad(yesNo(isCompositeActive(quality)), 8), isCompositeActive(quality) ? NOTE : LABEL)}` +
          `${style.paint(
            chain
              .map((entry) =>
                entry.pass === 'composite' ? `composite{${entry.effects.join('+')}}` : entry.pass,
              )
              .join(' -> '),
            violations.length === 0 ? VALUE : BAD,
          )}`,
      ),
    )
  }

  lines.push('')
  lines.push(heading(style, 'what the composite pass costs and saves', width))
  const highChain = buildPostProcessingChain(QUALITY_PRESETS.high)
  const ultraChain = buildPostProcessingChain(QUALITY_PRESETS.ultra)
  lines.push(
    row(
      style,
      'ultra',
      style.dim(
        `3 passes merged into 1; the chain is ${String(ultraChain.length)} long instead of 7, and the composite step says it performs ${chainEffects(ultraChain).filter((pass) => pass !== 'render' && pass !== 'gtao' && pass !== 'smaa' && pass !== 'output').join(' + ')}`,
      ),
    ),
  )
  lines.push(
    row(
      style,
      'high',
      `${style.paint('1 pass merged into 1', WARN)}   ${ 
        style.dim(
          `bloom is the only composite input at this preset, so the chain trades an UnrealBloomPass for a CompositePass and saves nothing`,
        )}`,
    ),
  )
  lines.push(
    row(
      style,
      'high vs ultra',
      chainPasses(highChain).join(',') === chainPasses(ultraChain).join(',')
        ? `${style.paint('same PASS order, different chains', NOTE)}   ${ 
          style.dim(
            `the difference is WHICH effects composite composites — {${chainEffects(highChain).filter((pass) => pass !== 'render' && pass !== 'gtao' && pass !== 'smaa' && pass !== 'output').join('+')}} against {${chainEffects(ultraChain).filter((pass) => pass !== 'render' && pass !== 'gtao' && pass !== 'smaa' && pass !== 'output').join('+')}} — and every step now carries what it performs, so an adapter that walks this output, as post-processing.ts says it should, cannot build the same composer for both`,
          )}`
        : `${style.paint('IDENTICAL CHAINS', BAD)}   ${ 
          style.dim('the ultra player gets no god rays and no depth of field')}`,
    ),
  )

  lines.push('')
  lines.push(heading(style, 'the validator, against chains it should reject', width))
  const badChains: ReadonlyArray<{ readonly why: string; readonly chain: ReadonlyArray<PostProcessingPass> }> = [
    { why: 'smaa before the thing it must anti-alias', chain: ['render', 'smaa', 'bloom', 'output'] },
    { why: 'a pass after output', chain: ['render', 'output', 'smaa'] },
    { why: 'composite alongside what it subsumes', chain: ['render', 'bloom', 'composite', 'output'] },
    { why: 'no render pass at all', chain: ['gtao', 'output'] },
    { why: 'the empty chain', chain: [] },
  ]
  for (const entry of badChains) {
    const violations = validatePostProcessingChain(entry.chain)
    lines.push(
      row(
        style,
        '',
        `${style.paint(pad(entry.chain.length === 0 ? '(empty)' : entry.chain.join(','), 34), VALUE)}${style.paint(pad(`${String(violations.length)} violation(s)`, 16), violations.length > 0 ? GOOD : BAD)}${style.dim(violations.map((violation) => violation.rule).join(', ') || entry.why)}`,
      ),
    )
  }

  return lines
}

// ---------------------------------------------------------------------------
// material
// ---------------------------------------------------------------------------

/**
 * The four materials the policy exists for, plus two the policy does not name.
 *
 * The two extras are the point of showing this as a table rather than a list of
 * verdicts: `alphaTest: -1` and `alphaTest: NaN` are not cutouts by
 * `isCutout`'s `> 0` test, so they take the two-pass path — and the diagnostic
 * `describeMaterialPolicy` produces for them says "alphaTest is 0", which is
 * false.
 */
export const MATERIAL_FIXTURES: ReadonlyArray<MaterialSpec> = [
  { name: 'opaque-block', transparent: false, side: 'front', alphaTest: 0, shared: true },
  { name: 'leaves-cutout', transparent: true, side: 'double', alphaTest: 0.5, shared: true },
  { name: 'water-translucent', transparent: true, side: 'double', alphaTest: 0, shared: true },
  { name: 'held-item', transparent: true, side: 'double', alphaTest: 0.5, shared: false },
  { name: 'glass-per-mesh', transparent: true, side: 'double', alphaTest: 0, shared: false },
  { name: 'negative-alphaTest', transparent: true, side: 'double', alphaTest: -1, shared: true },
]

export const materialView = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [
    heading(style, 'material policy  (forceSinglePass, and why)', width),
    row(
      style,
      '',
      style.dim(
        `${pad('material', 20)}${pad('transp', 8)}${pad('side', 8)}${pad('alphaT', 8)}${pad('shared', 8)}${pad('2-pass', 8)}${pad('cutout', 8)}${pad('force', 7)}verdict`,
      ),
    ),
  ]

  for (const material of MATERIAL_FIXTURES) {
    const verdict = describeMaterialPolicy(material)
    const colour = verdict.kind === 'ok' ? VALUE : verdict.kind === 'must-force-single-pass' ? WARN : NOTE
    lines.push(
      row(
        style,
        '',
        `${style.paint(pad(material.name, 20), colour)}${style.dim(pad(yesNo(material.transparent), 8))}${style.dim(pad(material.side, 8))}${style.dim(pad(String(material.alphaTest), 8))}${style.dim(pad(yesNo(material.shared), 8))}${style.dim(pad(yesNo(takesTwoPassPath(material)), 8))}${style.dim(pad(yesNo(isCutout(material)), 8))}${style.dim(pad(yesNo(requiresForceSinglePass(material)), 7))}${style.paint(verdict.kind, colour)}`,
      ),
    )
  }

  const audit = auditMaterials(MATERIAL_FIXTURES)

  lines.push('')
  lines.push(heading(style, 'auditMaterials — the startup assertion', width))
  lines.push(
    row(
      style,
      'findings',
      `${style.paint(String(audit.length), audit.length === 0 ? GOOD : WARN)} of ${String(MATERIAL_FIXTURES.length)}   ${ 
        style.dim('the doc prescribes asserting length === 0 at startup')}`,
    ),
  )
  for (const entry of audit) {
    lines.push(row(style, '', `${style.paint(pad(entry.material.name, 20), WARN)}${style.dim(entry.verdict.reason)}`))
  }

  return lines
}

// ---------------------------------------------------------------------------
// mirror
// ---------------------------------------------------------------------------

const xyz = (point: { readonly x: number; readonly y: number; readonly z: number }): string =>
  `${padStart(fixed(point.x, 3), 9)} ${padStart(fixed(point.y, 3), 9)} ${padStart(fixed(point.z, 3), 9)}`

export const mirrorView = (view: MachineView, style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'camera mirror  (mc-sim is the AUTHORITY; this is a copy that never writes back)', width),
  row(
    style,
    'clock',
    `${style.paint(`${fixed(view.clockSecs, 3)} s`, VALUE)}   ${ 
      style.dim('injected MonotonicTimeSecs — this app moves it, nothing reads a wall clock')}`,
  ),
  row(
    style,
    'authoritative',
    `${style.paint(xyz(view.authoritativePose.position), view.poseNeverPublished ? LABEL : VALUE)}   ` +
      `stamped ${style.paint(`${fixed(view.authoritativePose.capturedAtSecs, 3)} s`, VALUE)}${ 
      view.poseNeverPublished ? style.paint('   UNSET_CAMERA_POSE — nothing has published', WARN) : ''}`,
  ),
  row(style, 'mirrored', style.paint(xyz(view.mirrored.position), VALUE)),
  row(
    style,
    'rotation',
    `${style.paint(`${fixed(view.mirrored.rotation.x, 4)} ${fixed(view.mirrored.rotation.y, 4)} ${fixed(view.mirrored.rotation.z, 4)}`, VALUE)} ${ 
      style.dim(`order ${view.mirrored.rotation.order} — pitch on X, yaw on Y, exactly as the reference sets it`)}`,
  ),
  row(
    style,
    'lag',
    `${style.paint(`${fixed(view.mirrorLag, 3)} s`, view.mirrorStale ? BAD : GOOD)} ${style.dim(bar(Math.min(view.mirrorLag, MIRROR_LAG_WARNING_SECS * 3), MIRROR_LAG_WARNING_SECS * 3, 20))}   threshold ${style.paint(`${String(MIRROR_LAG_WARNING_SECS)} s`, VALUE)}   ${ 
      style.paint(view.mirrorStale ? 'STALE' : 'fresh', view.mirrorStale ? BAD : GOOD)}`,
  ),
  row(
    style,
    'view offset',
    `right ${style.paint(fixed(view.viewOffset.right, 3), VALUE)}  up ${style.paint(fixed(view.viewOffset.up, 3), VALUE)}  roll ${style.paint(fixed(view.viewOffset.rollRadians, 3), VALUE)}   ${ 
      style.dim('the attack-swing bob lives HERE and is never folded back into the pose')}`,
  ),
  ...(view.poseNeverPublished
    ? [
        '',
        row(
          style,
          '',
          style.paint(
            'makeRenderFrameState seeds mirroredCamera from UNSET_CAMERA_POSE (capturedAtSecs 0) and',
            WARN,
          ),
        ),
        row(
          style,
          '',
          style.paint(
            'mirrorLagSecs from the literal 0 — "perfectly fresh". Move the clock and watch them part.',
            WARN,
          ),
        ),
      ]
    : []),
]

// ---------------------------------------------------------------------------
// scratch
// ---------------------------------------------------------------------------

export const scratchView = (style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'per-frame scratch buffers  (borrow / return, and what is not enforced)', width),
  row(
    style,
    'why',
    style.dim('one Map per buffer for the whole process; allocating per frame is what makes a GC pause'),
  ),
  row(
    style,
    'enforced',
    `${style.paint('re-entrant borrow', GOOD)}   ${style.dim('a second withScratch on a borrowed buffer throws ScratchMisuseError')}`,
  ),
  row(
    style,
    'enforced',
    `${style.paint('identity escape', GOOD)}   ${style.dim('returning the buffer ITSELF throws')}`,
  ),
  row(
    style,
    'NOT enforced',
    `${style.paint('wrapped escape', BAD)}     ${style.dim('return { buffer } — a different object holding the same live Map')}`,
  ),
  row(
    style,
    'NOT enforced',
    `${style.paint('closure escape', BAD)}     ${style.dim('return () => buffer.size — read after the lease was released')}`,
  ),
  row(
    style,
    'NOT enforced',
    `${style.paint('deferred callback', BAD)}  ${style.dim('the lease is released in `finally`, so an Effect- or Promise-returning callback outlives it')}`,
  ),
  row(
    style,
    'NOT enforced',
    `${style.paint('direct field read', BAD)}  ${style.dim('scratch.buffer is a public field; the repo\'s own tests read it outside a borrow')}`,
  ),
  '',
  row(
    style,
    'usageCount',
    style.dim('documented as "Frames this buffer has served"; it increments on every BORROW, and a borrow that dies on the escape check still counts'),
  ),
]

// ---------------------------------------------------------------------------
// stages
// ---------------------------------------------------------------------------

export const stagesView = (style: Style, width: number): ReadonlyArray<string> => {
  const ordered: ReadonlyArray<{ readonly id: string; readonly after: string | undefined; readonly note: string }> = [
    { id: RENDER_STAGE_IDS.input, after: undefined, note: 'sample the DOM events collected since the last frame' },
    { id: RENDER_STAGE_IDS.cameraMirror, after: UPSTREAM_STAGE_IDS.simPhysics, note: 'mirror mc-sim\'s pose; the ONE upstream edge this repository declares' },
    { id: RENDER_STAGE_IDS.chunkSync, after: RENDER_STAGE_IDS.cameraMirror, note: 'visibility from the mirrored camera, into a borrowed scratch buffer' },
    { id: RENDER_STAGE_IDS.draw, after: RENDER_STAGE_IDS.chunkSync, note: 'draw what chunk-sync found' },
    { id: RENDER_STAGE_IDS.postFx, after: RENDER_STAGE_IDS.draw, note: 'run the chain; rebuild it only when the quality object CHANGES' },
  ]

  return [
    heading(style, 'the five stages mc-render registers', width),
    row(style, '', style.dim(`${pad('id', 22)}${pad('after', 22)}what it does`)),
    ...ordered.map((entry) =>
      row(
        style,
        '',
        `${style.paint(pad(entry.id, 22), VALUE)}${style.dim(pad(entry.after ?? '(nothing)', 22))}${style.dim(entry.note)}`,
      ),
    ),
    '',
    row(
      style,
      'note',
      style.dim(
        'no total order is resolved here. Each registration carries `after` constraints; mc-compose sorts the union of every module\'s.',
      ),
    ),
    row(
      style,
      'consequence',
      style.dim(
        'render:input declares NO `after`, so nothing in this repository forbids a global order that samples input last.',
      ),
    ),
    '',
    heading(style, 'the listener plan  (data, so the adapter cannot restate it wrongly)', width),
    row(style, '', style.dim(`${pad('event', 20)}${pad('target', 12)}why`)),
    ...LISTENER_PLAN.map((entry) =>
      row(
        style,
        '',
        `${style.paint(pad(entry.event, 20), VALUE)}${style.paint(pad(entry.target, 12), entry.target === 'window' ? GOOD : NOTE)}${style.dim(entry.note.slice(0, Math.max(20, width - LABEL_WIDTH - 34)))}`,
      ),
    ),
    '',
    row(
      style,
      'buttons',
      `${style.dim(MOUSE_BUTTONS.join(' · '))}   ${style.dim('named in the model, numbered only at the adapter boundary')}`,
    ),
  ]
}

// ---------------------------------------------------------------------------
// the whole frame
// ---------------------------------------------------------------------------

export const timelineView = (
  scenarioName: ScenarioName,
  step: number,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const scenario = scenarioFor(scenarioName)
  const length = scenarioLength(scenario)
  const upcoming = scenario.steps.filter((scripted) => scripted.step >= step).slice(0, 4)

  return [
    heading(style, `timeline · ${scenario.name}  (${String(step)}/${String(length)})`, width),
    ...(upcoming.length === 0
      ? [row(style, '', style.dim('script exhausted — the machine keeps its state; press r to restart'))]
      : upcoming.map((scripted) =>
          row(
            style,
            '',
            `${style.paint(padStart(`s${String(scripted.step)}`, 5), scripted.step === step ? WARN : LABEL)} ${style.paint(pad('event' in scripted.what ? describeEvent(scripted.what.event) : describeCommand(scripted.what.command), 34), scripted.step === step ? VALUE : LABEL)}${style.dim(scripted.why)}`,
          ),
        )),
  ]
}

export const logView = (view: MachineView, style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'log', width),
  ...view.log
    .slice(-6)
    .map((entry) =>
      row(
        style,
        '',
        `${style.paint(padStart(`s${String(entry.step)}`, 5), LABEL)} ${ 
          style.paint(
            entry.text,
            entry.severity === 'reject'
              ? WARN
              : entry.severity === 'finding'
                ? BAD
                : entry.severity === 'note'
                  ? NOTE
                  : VALUE,
          )}`,
      ),
    ),
]

export const findingsView = (view: MachineView, style: Style, width: number): ReadonlyArray<string> => {
  const findings: ReadonlyArray<{ readonly id: string; readonly hit: boolean; readonly text: string }> = [
    {
      id: 'lock',
      hit: false,
      text:
        view.pointerLockState === 'requested'
          ? 'a request is pending. blur now abandons it and a click can ask again, so `requested` is no longer an absorbing state'
          : '`requested` is left by blur as well as by the browser\'s two answers, so an unanswered ask cannot strand the session',
    },
    {
      id: 'wheel',
      hit: view.notchesConsumed !== view.notchesReported,
      text:
        view.notchesConsumed === view.notchesReported
          ? `the notch ledger balances: ${String(view.notchesConsumed)} consumed against ${String(view.notchesReported)} reported. endFrame consumes what the frame was TOLD, whenever the events fall`
          : `endFrame consumed ${String(view.notchesConsumed)} whole notch(es) against ${String(view.notchesReported)} reported to frames — the difference is hotbar travel no consumer saw`,
    },
    {
      id: 'mirror',
      hit: view.poseNeverPublished && view.clockSecs > MIRROR_LAG_WARNING_SECS,
      text: 'KNOWN GAP (RND-4, pinned not fixed): the mirrored pose is still UNSET_CAMERA_POSE while the clock has moved, and makeRenderFrameState seeds mirrorLagSecs to 0, which claims it is fresh',
    },
  ]

  return [
    heading(style, 'invariants (live predicates, not assertions)', width),
    ...findings.map((finding) =>
      row(
        style,
        '',
        `${style.paint(pad(finding.id, 8), finding.hit ? BAD : LABEL)}${style.paint(pad(finding.hit ? 'GAP' : 'ok', 6), finding.hit ? BAD : LABEL)}${finding.hit ? style.paint(finding.text, BAD) : style.dim(finding.text)}`,
      ),
    ),
  ]
}

export type ViewToggles = {
  readonly timeline: boolean
  readonly findings: boolean
}

export const renderFrame = (
  view: MachineView,
  mode: ViewMode,
  scenarioName: ScenarioName,
  toggles: ViewToggles,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const body =
    mode === 'input'
      ? inputView(view, style, width)
      : mode === 'postfx'
        ? postFxView(style, width)
        : mode === 'material'
          ? materialView(style, width)
          : mode === 'mirror'
            ? mirrorView(view, style, width)
            : mode === 'scratch'
              ? scratchView(style, width)
              : stagesView(style, width)

  const tabs = VIEW_MODES.map((candidate) =>
    style.paint(candidate === mode ? `[${candidate}]` : ` ${candidate} `, candidate === mode ? VALUE : LABEL),
  ).join('')

  return [
    style.bold('mc-render · steppable input & policy preview'),
    tabs,
    row(
      style,
      'step',
      `${style.paint(padStart(String(view.step), 5), VALUE)}   ${style.dim(`last: ${view.lastThing}`)}`,
    ),
    '',
    ...body,
    ...(toggles.timeline && mode === 'input' ? ['', ...timelineView(scenarioName, view.step, style, width)] : []),
    ...(toggles.findings ? ['', ...findingsView(view, style, width)] : []),
    ...(mode === 'input' || mode === 'mirror' ? ['', ...logView(view, style, width)] : []),
  ]
}

const SCENARIO_LIST = [
  'happy-path',
  'stranded-request',
  'lost-notch',
  'blur-while-locked',
  'mirror-staleness',
  'rebinding',
] as const

const describeLast = (name: ScenarioName): string => {
  const scenario = scenarioFor(name)
  const last = stepAt(scenario, scenarioLength(scenario) - 1)
  if (last === undefined) {
    return '(empty)'
  }
  return 'event' in last.what ? describeEvent(last.what.event) : describeCommand(last.what.command)
}

export const scenarioCatalogue = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [heading(style, 'scenarios', width)]
  for (const scenario of SCENARIO_LIST) {
    const found = scenarioFor(scenario)
    lines.push('')
    lines.push(`${bold(found.name)}  ${style.dim(found.headline)}`)
    for (const detail of found.detail) {
      lines.push(`  ${style.dim(detail)}`)
    }
    lines.push(`  ${style.dim(`${String(scenarioLength(found))} steps; the last is: ${describeLast(scenario)}`)}`)
  }
  return lines
}
