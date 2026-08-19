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
 * This Node preview does not import runtime THREE.js or `lib.DOM`, so there is
 * no host canvas to draw here. The public `./browser` entry supplies the default
 * Three/canvas boundary, while `application/three-surface.ts` keeps the structural
 * contract available to other browser/GPU hosts. What there is, is a great deal of policy modelled as data —
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
  type PostProcessingStep,
  type QualityPreset,
} from '../../src/domain/post-processing'
import { LISTENER_PLAN } from '../../src/application/input-service'
import { MOUSE_BUTTONS } from '../../src/domain/input-bindings'
import { MIRROR_LAG_WARNING_SECS } from '../../src/domain/camera-mirror'
import { RENDER_STAGE_IDS, UPSTREAM_STAGE_IDS } from '../../src/stages/stage-ids'
import { SCENARIO_NAMES, scenarioFor, scenarioLength, stepAt, type ScenarioName } from './script'
import { describeCommand, describeEvent, type MachineView } from './machine'
import { inputView } from './input-view'
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
  VALUE,
  WARN,
  yesNo,
  type Style,
} from './style'
import { heading, LABEL_WIDTH, row } from './view-support'

export { inputView } from './input-view'

export const VIEW_MODES = ['input', 'postfx', 'material', 'mirror', 'scratch', 'stages'] as const

export type ViewMode = (typeof VIEW_MODES)[number]

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

const postProcessingOrderRows = (style: Style): ReadonlyArray<string> =>
  POST_PROCESSING_PASS_ORDER.map((pass) => {
    const mandatory = MANDATORY_PASSES.has(pass)
    const subsumed = COMPOSITE_SUBSUMES.has(pass)
    return row(
      style,
      '',
      `${style.dim(padStart(String(passOrderIndex(pass)), 3))}  ${style.paint(pad(pass, 11), mandatory ? GOOD : VALUE)}${style.paint(pad(mandatory ? 'always' : subsumed ? 'subsumed' : 'optional', 10), mandatory ? GOOD : subsumed ? NOTE : LABEL)}${style.dim(PASS_NOTE[pass])}`,
    )
  })

const postProcessingPresetRows = (style: Style): ReadonlyArray<string> => [
  row(
    style,
    '',
    style.dim(
      `${pad('preset', 9)}${pad('ssao', 6)}${pad('rays', 6)}${pad('bloom', 7)}${pad('dof', 5)}${pad('smaa', 6)}${pad('comp', 6)}${pad('active', 8)}chain`,
    ),
  ),
  ...(['low', 'medium', 'high', 'ultra'] as ReadonlyArray<QualityPreset>).map((preset) => {
    const quality = QUALITY_PRESETS[preset]
    const chain = buildPostProcessingChain(quality)
    const violations = validatePostProcessingChain(chainPasses(chain))
    return row(
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
    )
  }),
]

const effectNames = (chain: ReadonlyArray<PostProcessingStep>): string =>
  chainEffects(chain).filter((pass) => pass !== 'render' && pass !== 'gtao' && pass !== 'smaa' && pass !== 'output').join(' + ')

const postProcessingComparisonRows = (style: Style): ReadonlyArray<string> => {
  const highChain = buildPostProcessingChain(QUALITY_PRESETS.high)
  const ultraChain = buildPostProcessingChain(QUALITY_PRESETS.ultra)

  return [
    row(
      style,
      'ultra',
      style.dim(
        `3 passes merged into 1; the chain is ${String(ultraChain.length)} long instead of 7, and the composite step says it performs ${effectNames(ultraChain)}`,
      ),
    ),
    row(
      style,
      'high',
      `${style.paint('1 pass merged into 1', WARN)}   ${style.dim(
        'bloom is the only composite input at this preset, so the chain trades an UnrealBloomPass for a CompositePass and saves nothing',
      )}`,
    ),
    row(
      style,
      'high vs ultra',
      chainPasses(highChain).join(',') === chainPasses(ultraChain).join(',')
        ? `${style.paint('same PASS order, different chains', NOTE)}   ${style.dim(
            `the difference is WHICH effects composite composites — {${effectNames(highChain)}} against {${effectNames(ultraChain)}} — and every step now carries what it performs, so an adapter that walks this output, as post-processing.ts says it should, cannot build the same composer for both`,
          )}`
        : `${style.paint('IDENTICAL CHAINS', BAD)}   ${style.dim('the ultra player gets no god rays and no depth of field')}`,
    ),
  ]
}

const INVALID_CHAINS: ReadonlyArray<{ readonly why: string; readonly chain: ReadonlyArray<PostProcessingPass> }> = [
  { why: 'smaa before the thing it must anti-alias', chain: ['render', 'smaa', 'bloom', 'output'] },
  { why: 'a pass after output', chain: ['render', 'output', 'smaa'] },
  { why: 'composite alongside what it subsumes', chain: ['render', 'bloom', 'composite', 'output'] },
  { why: 'no render pass at all', chain: ['gtao', 'output'] },
  { why: 'the empty chain', chain: [] },
]

const invalidPostProcessingRows = (style: Style): ReadonlyArray<string> =>
  INVALID_CHAINS.map((entry) => {
    const violations = validatePostProcessingChain(entry.chain)
    return row(
      style,
      '',
      `${style.paint(pad(entry.chain.length === 0 ? '(empty)' : entry.chain.join(','), 34), VALUE)}${style.paint(pad(`${String(violations.length)} violation(s)`, 16), violations.length > 0 ? GOOD : BAD)}${style.dim(violations.map((violation) => violation.rule).join(', ') || entry.why)}`,
    )
  })

export const postFxView = (style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'the canonical order  (declaration order IS the specification)', width),
  ...postProcessingOrderRows(style),
  '',
  heading(style, 'the four presets', width),
  ...postProcessingPresetRows(style),
  '',
  heading(style, 'what the composite pass costs and saves', width),
  ...postProcessingComparisonRows(style),
  '',
  heading(style, 'the validator, against chains it should reject', width),
  ...invalidPostProcessingRows(style),
]

// ---------------------------------------------------------------------------
// material
// ---------------------------------------------------------------------------

/**
 * The four materials the policy exists for, plus two boundary cases.
 *
 * The two extras are the point of showing this as a table rather than a list of
 * verdicts: `alphaTest: -1` and `alphaTest: NaN` are not cutouts by
 * `isCutout`'s `> 0` test, so they take the two-pass path. The diagnostic shows
 * the actual alpha and `flatSurface` values that explain the verdict.
 */
export const MATERIAL_FIXTURES: ReadonlyArray<MaterialSpec> = [
  { name: 'opaque-block', transparent: false, side: 'front', alphaTest: 0, flatSurface: false, shared: true },
  { name: 'leaves-cutout', transparent: true, side: 'double', alphaTest: 0.5, flatSurface: false, shared: true },
  { name: 'water-flat-surface', transparent: true, side: 'double', alphaTest: 0, flatSurface: true, shared: true },
  { name: 'held-item', transparent: true, side: 'double', alphaTest: 0.5, flatSurface: true, shared: false },
  { name: 'glass-per-mesh', transparent: true, side: 'double', alphaTest: 0, flatSurface: false, shared: false },
  { name: 'negative-alphaTest', transparent: true, side: 'double', alphaTest: -1, flatSurface: false, shared: true },
]

export const materialView = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [
    heading(style, 'material policy  (forceSinglePass, and why)', width),
    row(
      style,
      '',
      style.dim(
        `${pad('material', 20)}${pad('transp', 8)}${pad('side', 8)}${pad('alphaT', 8)}${pad('shared', 8)}${pad('flat', 8)}${pad('2-pass', 8)}${pad('cutout', 8)}${pad('force', 7)}verdict`,
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
        `${style.paint(pad(material.name, 20), colour)}${style.dim(pad(yesNo(material.transparent), 8))}${style.dim(pad(material.side, 8))}${style.dim(pad(String(material.alphaTest), 8))}${style.dim(pad(yesNo(material.shared), 8))}${style.dim(pad(yesNo(material.flatSurface), 8))}${style.dim(pad(yesNo(takesTwoPassPath(material)), 8))}${style.dim(pad(yesNo(isCutout(material)), 8))}${style.dim(pad(yesNo(requiresForceSinglePass(material)), 7))}${style.paint(verdict.kind, colour)}`,
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
            'makeRenderFrameState seeds an explicitly unpublished mirror from UNSET_CAMERA_POSE',
            WARN,
          ),
        ),
        row(
          style,
          '',
          style.paint(
            'sourceCapturedAtSecs is undefined and mirrorLagSecs is Infinity until mc-sim publishes.',
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
  heading(style, 'per-frame scratch buffers  (borrow / return, with lease guards)', width),
  row(
    style,
    'why',
    style.dim('one private Map and one reusable lease per buffer; allocating per frame is what makes a GC pause'),
  ),
  row(
    style,
    'enforced',
    `${style.paint('re-entrant borrow', GOOD)}   ${style.dim('a second withScratch on a borrowed buffer throws ScratchMisuseError')}`,
  ),
  row(
    style,
    'enforced',
    `${style.paint('lease escape', GOOD)}   ${style.dim('returning the lease itself throws')}`,
  ),
  row(
    style,
    'enforced',
    `${style.paint('post-borrow use', GOOD)} ${style.dim('wrappers, closures, deferred Effects, and iterators fail when used after return')}`,
  ),
  row(
    style,
    'enforced',
    `${style.paint('native map', GOOD)}      ${style.dim('ScratchMap has no public buffer field; use snapshotScratch for a copy')}`,
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
      hit: false,
      text: 'startup mirror distinguishes an unpublished pose (undefined source timestamp, Infinity lag) from a stale published pose',
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

const bodyFor = (view: MachineView, mode: ViewMode, style: Style, width: number): ReadonlyArray<string> => {
  switch (mode) {
    case 'input':
      return inputView(view, style, width)
    case 'postfx':
      return postFxView(style, width)
    case 'material':
      return materialView(style, width)
    case 'mirror':
      return mirrorView(view, style, width)
    case 'scratch':
      return scratchView(style, width)
    case 'stages':
      return stagesView(style, width)
    default:
      return []
  }
}

const tabsFor = (mode: ViewMode, style: Style): string =>
  VIEW_MODES.map((candidate) =>
    style.paint(candidate === mode ? `[${candidate}]` : ` ${candidate} `, candidate === mode ? VALUE : LABEL),
  ).join('')

export const renderFrame = (
  view: MachineView,
  mode: ViewMode,
  scenarioName: ScenarioName,
  toggles: ViewToggles,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const body = bodyFor(view, mode, style, width)
  const tabs = tabsFor(mode, style)

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

const SCENARIO_LIST = SCENARIO_NAMES

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
