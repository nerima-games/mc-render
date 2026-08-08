/**
 * The refraction pre-pass, reduced to the question it actually asks: SHOULD IT
 * RUN THIS FRAME?
 *
 * ---------------------------------------------------------------------------
 * Why a whole file for one boolean
 * ---------------------------------------------------------------------------
 *
 * The refraction pre-pass renders the ENTIRE SCENE A SECOND TIME, with the water
 * hidden, into an off-screen target that the water shader then samples
 * (`domain/water-surface.ts`, uniform `uRefractionMap`). It is by a wide margin
 * the most expensive thing the water surface costs, and it is worth almost
 * nothing most frames — the scene behind the water has not changed, or there is
 * no water on screen, or the water is four pixels wide on the horizon.
 *
 * So the reference wraps it in SIX independent gates. They are spread across
 * three files and two packages, none of them names the set, and the only way to
 * learn that there are six is to follow the call chain:
 *
 *   packages/app/.../frame/stages/post-processing-stage.ts:31   the interval is 0
 *   packages/app/.../frame/stages/post-processing-stage.ts:38   not this frame's turn
 *   packages/rendering/.../world-renderer-refraction.ts:100     no water meshes
 *   packages/rendering/.../world-renderer-refraction.ts:103     none of them visible
 *   packages/rendering/.../world-renderer-refraction.ts:108-112 too small on screen
 *   packages/rendering/.../world-renderer-refraction.ts:132-147 camera and scene unchanged
 *
 * The last of those exists TWICE over: once in the stage
 * (post-processing-stage.ts:44-46, `hasCameraPoseChanged` against
 * `lastRefractionFrameRef`) and once inside the pre-pass itself
 * (`_lastRefractionState`). Two caches of one predicate, in two packages,
 * neither aware of the other. Modelled once here.
 *
 * This is docs/testing.md §3.1's move applied to a control-flow decision rather
 * than to an ordering: the gates become a named set, the decision becomes a
 * pure function of plain numbers, and each gate becomes something a unit test
 * can fail. A gate that silently stops gating is otherwise observable only as
 * "the frame rate is worse than it was", which is how these get lost.
 *
 * NOTHING HERE RENDERS. The projection maths that produces `waterScreenRatio` is
 * on the far side of the `three` seam, and so is the render target. This file
 * takes the ratio as a number, which is what makes it testable at all.
 *
 * ---------------------------------------------------------------------------
 * `refractionThrottleFrames`, whose zero does not mean what it reads as
 * ---------------------------------------------------------------------------
 *
 * The reference's preset field is `refractionThrottleFrames`, and
 * post-processing-stage.ts:31 and :38 give it this meaning:
 *
 *     0  ->  the pre-pass NEVER runs
 *     N  ->  it runs on frames 1, 1+N, 1+2N, ...
 *
 * A field called "throttle frames" whose zero value is the MOST throttled state
 * is a name that will be misread, and misreading it costs a full extra scene
 * render per frame on the default preset. The reference itself is at pains about
 * this — settings-service.config.ts:39-42 spends four lines explaining that
 * medium's 0 means the prepass is skipped entirely 「the live refraction texture
 * is a high/ultra-only luxury, not worth a per-frame extra scene pass on the
 * balanced default」.
 *
 * Renamed here to `REFRACTION_INTERVAL_FRAMES`, which reads correctly at 0 (an
 * interval of zero frames happens zero times) and at 1 (every frame). The values
 * are transcribed unchanged; only the name is different, and this paragraph is
 * the record of that so a diff against the reference is still checkable.
 *
 * Note that HIGH refreshes refraction LESS often than ULTRA — interval 2 against
 * interval 1 (settings-service.config.ts:52, :61). That is not a transcription
 * slip. It is the one preset axis where high is genuinely half of ultra rather
 * than a subset of it.
 *
 * ---------------------------------------------------------------------------
 * The order of the gates, which this file deliberately changes
 * ---------------------------------------------------------------------------
 *
 * Within the pre-pass the reference evaluates: meshes exist, any visible, SCREEN
 * RATIO, then CAMERA/SCENE UNCHANGED (world-renderer-refraction.ts:100-147).
 * That runs the most expensive gate before the cheapest one.
 *
 *   The screen-ratio gate projects the eight corners of every water mesh's AABB
 *   through the view-projection matrix and sums the clamped NDC rectangles
 *   (world-renderer-refraction-ratio.ts). It also forces a
 *   `camera.updateMatrixWorld()` first (:109), which the pre-pass would not
 *   otherwise need at that point.
 *
 *   The unchanged gate is twelve float comparisons against a retained record.
 *
 * On the common frame — a player standing still, looking at a lake — the
 * unchanged gate is the one that fires, and the reference pays for the whole
 * AABB sweep before reaching it. `REFRACTION_GATE_ORDER` below puts the cheap
 * one first.
 *
 * WHY THAT IS SAFE, stated because reordering gates usually is not: the six
 * gates are mutually independent predicates over the inputs. None of them
 * changes state that another reads, and the `updateMatrixWorld` the ratio gate
 * triggers in the reference is needed only BY the ratio gate. So the order can
 * change WHETHER THE PRE-PASS RUNS in no case at all; it changes only which
 * skip reason is reported and how much was computed to get there.
 *
 * That is a property, so it is tested as one: `test/water-refraction.test.ts`
 * runs all 720 permutations of the six gates over a fixture set and asserts
 * that run-versus-skip agrees in every one. It deliberately does NOT assert the
 * reason agrees — it does not, when two gates both fire, and pretending
 * otherwise would be a false claim about what the reordering preserves.
 *
 * ---------------------------------------------------------------------------
 * What needs a real screenshot
 * ---------------------------------------------------------------------------
 *
 * Whether 0.005 and 0.05 are the right thresholds. They are a trade between a
 * dropped refraction the player might notice and a scene render they definitely
 * pay for, and settling it means looking at water at the threshold size on a
 * real GPU. Transcribed on the reference's authority; the comments at :53 and
 * :62 (「conservative — only drop frames where water is <0.5% of screen」) state
 * the intent but no measurement. Likewise whether interval 2 on high produces
 * visible refraction lag when the player turns.
 */

import { type QualityPreset } from './post-processing'

// --- Preset-resolved settings -----------------------------------------------

/**
 * Frames between refraction pre-passes, per preset. 0 MEANS NEVER.
 *
 * Transcribed from `GRAPHICS_PRESETS` in
 * ts-minecraft/packages/game/application/settings-service.config.ts:
 *
 *   low    0   :30
 *   medium 0   :43
 *   high   2   :52
 *   ultra  1   :61
 *
 * The reference's field name is `refractionThrottleFrames`; see the header for
 * why it is not that here.
 */
export const REFRACTION_INTERVAL_FRAMES: Readonly<Record<QualityPreset, number>> = {
  high: 2,
  low: 0,
  medium: 0,
  ultra: 1,
}

/**
 * The smallest share of the screen water may cover and still get a pre-pass.
 *
 * Transcribed from `refractionMinScreenRatio`:
 *
 *   low    0.05   settings-service.config.ts:31
 *   medium 0.05   :44
 *   high   0.005  :53
 *   ultra  0.005  :62
 *
 * Zero disables the gate (world-renderer-refraction.ts:88 「0 disables the
 * screen-ratio gate entirely」), which no preset uses but the API permits.
 *
 * The low/medium values are inert in practice and the reference says so at :31 —
 * 「aggressive skip on low — refraction is throttled to 0 anyway」. They are
 * transcribed rather than dropped because a preset that later gains an interval
 * would otherwise silently acquire whatever default a missing entry produced.
 */
export const REFRACTION_MIN_SCREEN_RATIO: Readonly<Record<QualityPreset, number>> = {
  high: 0.005,
  low: 0.05,
  medium: 0.05,
  ultra: 0.005,
}

/**
 * Whether this frame is a refraction frame for a given interval.
 *
 * `frameNumber` is 1-based, matching the reference's counter, which is
 * incremented BEFORE the test (post-processing-stage.ts:33-34) so the first
 * frame is 1 and always runs: `(1 - 1) % N === 0` for every N.
 *
 * An interval of 0 is never, and is checked first — `% 0` is NaN, and
 * `NaN === 0` is false, so the modulo would coincidentally give the right answer
 * for the wrong reason. Relying on that would break the moment someone
 * "simplified" the comparison.
 */
export const refractionRunsOnFrame = (intervalFrames: number, frameNumber: number): boolean => {
  if (!Number.isInteger(intervalFrames) || intervalFrames <= 0) {
    return false
  }
  if (!Number.isInteger(frameNumber) || frameNumber < 1) {
    return false
  }
  return (frameNumber - 1) % intervalFrames === 0
}

// --- The camera key ---------------------------------------------------------

/**
 * Everything that can invalidate a retained refraction texture.
 *
 * Transcribed from the fields the reference compares at
 * world-renderer-refraction.ts:132-144. It is a FLAT RECORD OF NUMBERS rather
 * than a camera, because that is the whole reason this decision can be tested
 * without a GPU.
 *
 * The four projection entries are `elements[0]`, `[5]`, `[10]` and `[14]` of the
 * projection matrix, which for a perspective camera are the only ones that move
 * when fov, aspect, near or far do. Comparing all sixteen would be correct and
 * slower; comparing fewer would miss a near-plane change. This is the
 * reference's selection and it is right.
 *
 * `sceneVersion` is what makes a chunk rebuild invalidate the texture even
 * though the camera has not moved. Without it, a player standing still while a
 * chunk finishes meshing keeps refracting the old scene indefinitely.
 */
export type RefractionCameraKey = {
  readonly sceneVersion: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly qx: number
  readonly qy: number
  readonly qz: number
  readonly qw: number
  readonly projection0: number
  readonly projection5: number
  readonly projection10: number
  readonly projection14: number
}

/**
 * True when two keys describe the same view of the same scene.
 *
 * EXACT equality on every field, matching the reference. A tolerance would be
 * defensible on the position — a camera that moved a micrometre produces an
 * identical image — and is deliberately not used: the values come from a
 * simulation snapshot rather than from accumulating float error, so an
 * unchanged camera produces bit-identical numbers, and a tolerance would only
 * add a threshold nobody could justify.
 *
 * NaN is handled by falling out of `===`, so a key with a NaN field never
 * matches anything, including itself. That is the inert direction: an
 * uninterpretable camera re-renders rather than serving a stale texture forever.
 */
export const sameRefractionKey = (a: RefractionCameraKey, b: RefractionCameraKey): boolean =>
  a.sceneVersion === b.sceneVersion &&
  a.x === b.x &&
  a.y === b.y &&
  a.z === b.z &&
  a.qx === b.qx &&
  a.qy === b.qy &&
  a.qz === b.qz &&
  a.qw === b.qw &&
  a.projection0 === b.projection0 &&
  a.projection5 === b.projection5 &&
  a.projection10 === b.projection10 &&
  a.projection14 === b.projection14

// --- Screen ratio -----------------------------------------------------------

/**
 * The area of the NDC viewport. Two units wide by two tall.
 *
 * Named because the ratio arithmetic divides by it and `/ 4` in that expression
 * is otherwise indistinguishable from a fudge factor.
 * world-renderer-refraction-ratio.ts:18 states it: 「viewport NDC area = 4」.
 */
export const NDC_VIEWPORT_AREA = 4

/**
 * The ratio reported when an AABB corner falls behind the near plane.
 *
 * 1, meaning "assume it fills the screen, do not skip". The reference's reason,
 * at world-renderer-refraction-ratio.ts:21-24: projecting a partially clipped
 * box produces invalid NDC, and 「treating those frames as 'fully visible'
 * prevents false-positive skips when water is right under the camera」.
 *
 * Which is the case that matters — standing in water is exactly when refraction
 * is most visible, and it is also exactly when the surface AABB straddles the
 * near plane. An estimator that failed toward "skip" would drop the effect
 * precisely where it counts.
 */
export const BEHIND_NEAR_PLANE_RATIO = 1

/**
 * The screen share of one clamped NDC rectangle.
 *
 * The scalar half of the reference's estimator, with the projection left on the
 * other side of the seam. Corners are clamped into `[-1, 1]` first, so a box
 * extending off-screen is not counted for the part that is off-screen.
 *
 * An UPPER BOUND, and it must stay one: the caller sums these per mesh without
 * de-duplicating overlap (world-renderer-refraction-ratio.ts:19-20 「sum without
 * union dedupe -> upper bound (safe for skip decisions)」). Overestimating means
 * running a pre-pass that was not needed, which costs a frame; underestimating
 * means skipping one that was, which is a visible artefact. The bound is on the
 * side that fails toward correctness.
 */
export const screenRatioForNdcRect = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number => {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return BEHIND_NEAR_PLANE_RATIO
  }

  const clampedMinX = Math.max(-1, Math.min(1, minX))
  const clampedMaxX = Math.max(-1, Math.min(1, maxX))
  const clampedMinY = Math.max(-1, Math.min(1, minY))
  const clampedMaxY = Math.max(-1, Math.min(1, maxY))

  const width = Math.max(0, clampedMaxX - clampedMinX)
  const height = Math.max(0, clampedMaxY - clampedMinY)

  return (width * height) / NDC_VIEWPORT_AREA
}

// --- The decision -----------------------------------------------------------

/**
 * The five gates, as names.
 *
 * A union rather than a set of booleans so that `REFRACTION_GATE_ORDER` can be
 * an array of them and the order becomes a value the way
 * `POST_PROCESSING_PASS_ORDER` is in `domain/post-processing.ts`.
 */
export type RefractionGate =
  | 'interval-disabled'
  | 'not-this-frame'
  | 'no-water-meshes'
  | 'no-visible-water'
  | 'camera-and-scene-unchanged'
  | 'below-screen-ratio'

/**
 * The order the gates are evaluated in: CHEAPEST FIRST.
 *
 * Differs from the reference by moving `camera-and-scene-unchanged` ahead of
 * `below-screen-ratio`. See the header for the cost argument and for why the
 * reorder cannot change whether the pre-pass runs.
 */
export const REFRACTION_GATE_ORDER: ReadonlyArray<RefractionGate> = [
  'interval-disabled',
  'not-this-frame',
  'no-water-meshes',
  'no-visible-water',
  'camera-and-scene-unchanged',
  'below-screen-ratio',
]

/**
 * The order the reference evaluates them in.
 *
 * Kept as a value, not as a comment, so the test that asserts the two orders
 * agree on run-versus-skip has both of them to run. Delete it only when the
 * reference is no longer the oracle.
 */
export const REFERENCE_REFRACTION_GATE_ORDER: ReadonlyArray<RefractionGate> = [
  'interval-disabled',
  'not-this-frame',
  'no-water-meshes',
  'no-visible-water',
  'below-screen-ratio',
  'camera-and-scene-unchanged',
]

/**
 * Everything the decision needs, as plain data.
 *
 * `waterScreenRatio` is the adapter's estimate, already summed over the visible
 * meshes; `BEHIND_NEAR_PLANE_RATIO` is what it passes when the projection was
 * not usable.
 *
 * `lastRenderedKey` is `undefined` before the first pre-pass of a session. That
 * is a real state rather than a missing value, and it must NOT match — the
 * texture holds nothing yet, so the first frame with water on screen has to
 * render. `exactOptionalPropertyTypes` is on, so this is a required field whose
 * type includes `undefined` rather than an optional one; a caller that forgets
 * it does not silently get "no previous frame".
 */
export type RefractionInputs = {
  readonly intervalFrames: number
  readonly frameNumber: number
  readonly waterMeshCount: number
  readonly visibleWaterMeshCount: number
  readonly waterScreenRatio: number
  readonly minScreenRatio: number
  readonly cameraKey: RefractionCameraKey
  readonly lastRenderedKey: RefractionCameraKey | undefined
}

/**
 * What to do this frame.
 *
 * A STRING UNION, not a record, and that is a frame-path decision rather than a
 * style one: this is evaluated every frame, and a `{ kind, reason }` object
 * would be one allocation per frame for a value that is discarded immediately.
 * String literals are interned constants and allocate nothing.
 * `describeRefractionDecision` is where the prose lives, called only when
 * somebody is actually looking.
 */
export type RefractionDecision = 'run' | `skip:${RefractionGate}`

/** True when the decision is any kind of skip. */
export const isRefractionSkipped = (decision: RefractionDecision): boolean => decision !== 'run'

/** Evaluate one gate. `true` means this gate says skip. */
const gateFires = (gate: RefractionGate, inputs: RefractionInputs): boolean => {
  switch (gate) {
    case 'interval-disabled':
      return !Number.isInteger(inputs.intervalFrames) || inputs.intervalFrames <= 0
    case 'not-this-frame':
      return !refractionRunsOnFrame(inputs.intervalFrames, inputs.frameNumber)
    case 'no-water-meshes':
      return inputs.waterMeshCount <= 0
    case 'no-visible-water':
      return inputs.visibleWaterMeshCount <= 0
    case 'camera-and-scene-unchanged':
      return inputs.lastRenderedKey !== undefined && sameRefractionKey(inputs.cameraKey, inputs.lastRenderedKey)
    case 'below-screen-ratio':
      return inputs.minScreenRatio > 0 && inputs.waterScreenRatio < inputs.minScreenRatio
  }
}

/**
 * Should the refraction pre-pass run?
 *
 * Returns the FIRST gate that fires, in `order`. The order is a parameter and
 * not a constant so that the property in the header — that order changes the
 * reason but never the run/skip answer — is something a test can actually
 * exercise rather than something this comment asserts.
 *
 * Note that `not-this-frame` subsumes `interval-disabled`: an interval of 0
 * makes `refractionRunsOnFrame` false too. Both gates are kept because they are
 * different FACTS about the configuration — "this preset never refracts" is a
 * settings answer and "it is not this frame's turn" is a scheduling one — and a
 * skip reason that cannot tell them apart is a skip reason nobody can act on.
 */
export const decideRefractionPrePass = (
  inputs: RefractionInputs,
  order: ReadonlyArray<RefractionGate> = REFRACTION_GATE_ORDER,
): RefractionDecision => {
  for (const gate of order) {
    if (gateFires(gate, inputs)) {
      return `skip:${gate}`
    }
  }

  return 'run'
}

/**
 * Explain a decision.
 *
 * Diagnostics only — it allocates, and it is called when a developer asks, not
 * every frame. The same split `domain/material-policy.ts` makes between
 * `requiresForceSinglePass` and `describeMaterialPolicy`.
 */
export const describeRefractionDecision = (decision: RefractionDecision): string => {
  switch (decision) {
    case 'run':
      return 'Rendering the refraction pre-pass: a second full scene render with water hidden.'
    case 'skip:interval-disabled':
      return 'This quality preset never refracts (REFRACTION_INTERVAL_FRAMES is 0 on low and medium).'
    case 'skip:not-this-frame':
      return "The pre-pass is throttled and this is not one of its frames; the retained texture stands."
    case 'skip:no-water-meshes':
      return 'No water meshes exist, so there is nothing that could sample a refraction texture.'
    case 'skip:no-visible-water':
      return 'Every water mesh is culled, so nothing on screen would read the result.'
    case 'skip:camera-and-scene-unchanged':
      return 'Camera pose, projection and scene version are all unchanged, so the retained texture is still correct.'
    case 'skip:below-screen-ratio':
      return 'Water covers less of the screen than the preset threshold; a full scene render is not worth it.'
  }
}
