/**
 * Which LOD level a chunk is drawn at, and what that choice costs the picture.
 *
 * The half of the reference's `lod-simplification.ts` that TAKES A COORDINATE.
 * mc-meshing `docs/responsibility.md` §3.4 settled the split and named the three
 * symbols by hand: `lodForDistance`, `LOD1_DISTANCE_CHUNKS` and
 * `LOD2_DISTANCE_CHUNKS` are mc-render's, because `distanceChunks` is the norm
 * between the player's chunk and another one and mc-meshing holds no
 * coordinates (§3.3). `simplifyMesh` and the level vocabulary stay there; this
 * module imports that vocabulary directly and owns only distance-based policy.
 *
 * ---------------------------------------------------------------------------
 * THE TWO CONSTANTS ARRIVED WITH A JUSTIFICATION THAT IS WRONG BY A FACTOR OF TEN
 * ---------------------------------------------------------------------------
 *
 * This is the whole reason the file is longer than a switch statement, so it is
 * stated before anything else.
 *
 * The reference justifies its thresholds in a comment at
 * `packages/rendering/infrastructure/meshing/lod-simplification.ts:23-25`:
 *
 *     at distance >= LOD1_DISTANCE chunks the camera is far enough that any
 *     z-fighting / cracks become a sub-pixel artifact at typical FOVs
 *
 * mc-meshing `docs/responsibility.md` §3.5(a) checked it, and it does not hold.
 * The displacement is exactly known — `simplifyMesh` snaps horizontal extents
 * outward onto a `step`-pitched grid, so ONE EDGE MOVES AT MOST `step - 1`
 * BLOCKS and Y never moves at all — and projecting that displacement is
 * elementary. `lodScreenErrorPixels` below is that projection. At the
 * reference's own defaults it says LOD 1 at 4 chunks is **about 11 px**, and
 * that sub-pixel arrives at **about 44 chunks** — where no chunk exists, because
 * the default render distance is 8.
 *
 * The conclusion (use LOD at distance) may well be right. THE EVIDENCE IS NOT,
 * and this repository has eight recorded instances of exactly that shape:
 * a correct conclusion resting on a measurement that does not survive being
 * checked, after which a reader who checks it starts doubting the conclusion.
 *
 * SO THE FIX HERE IS NOT A BETTER NUMBER. It is a FUNCTION, exported, that any
 * reader can evaluate — plus a census function that makes the second defect
 * below arithmetic rather than assertion. The constants stay transcribed and
 * clearly labelled as transcriptions. What is missing is a perception
 * measurement, §3.5(a) writes out the four-step procedure for taking it, and
 * `distanceForScreenErrorPixels` is the inverse this file provides so that when
 * somebody does take it, the answer converts to a threshold without anybody
 * re-deriving the algebra.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND DEFECT: AT `renderDistance = 4`, LOD 2 CAN NEVER FIRE
 * ---------------------------------------------------------------------------
 *
 * §3.5(b) found it and called it fixable without waiting for the perception
 * measurement, which is why it is fixed here and the thresholds are not.
 *
 * `LOD2_DISTANCE_CHUNKS` is 8. A chunk at distance 8 only exists if the render
 * distance reaches 8. At `renderDistance = 4` the furthest chunk is 4 away, so
 * the condition `d >= 8` is unsatisfiable and the coarsest tier is DEAD CODE —
 * `lodTierCensus` returns 0 for it, and a test asserts that it does.
 *
 * `renderDistance = 4` is not a hypothetical. It is where the reference's
 * adaptive quality drops when the frame budget is missed
 * (`frame-runtime-logic.test.ts:212-213`) and what mc-meshing's own load
 * benchmark uses. So the strongest LOD tier is switched off in precisely the
 * setting that needs it most — a defect whose whole content is that an ABSOLUTE
 * threshold was compared against a distance whose RANGE is a setting.
 *
 * `lodThresholdsForRenderDistance` is §3.5(b)'s remedy: hold the thresholds as
 * ratios of the render distance (`LOD1 = R/2`, `LOD2 = R`) so every tier has
 * chunks at every setting. It is a separate exported function rather than a new
 * default, because "which chunks get which tier" and "how wrong does a tier
 * look" are different questions and only the second one has been answered.
 *
 * ---------------------------------------------------------------------------
 * WHY `lodForDistance` TAKES THRESHOLDS, WHICH §3.4 DID NOT ANTICIPATE
 * ---------------------------------------------------------------------------
 *
 * §3.4's table writes the signature as `(distanceChunks: number) -> LodLevel`.
 * What landed takes a second argument and has NO DEFAULT, and the deviation is
 * deliberate.
 *
 * A default would have to be one of two things. The reference's 4/8, which this
 * file's own header argues is defective at `renderDistance = 4` — shipping a
 * defect as the path of least resistance, where every caller that omits the
 * argument silently opts into it. Or the ratio rule, which would be presenting
 * an UNMEASURED choice as the considered one, and §3.5(a) is explicit that the
 * measurement justifying any threshold has not been taken.
 *
 * Neither is honest, so the caller states which it wants. `REFERENCE_LOD_THRESHOLDS`
 * exists so that "the reference's numbers" remains one expression rather than a
 * pair of literals re-typed at each call site.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TIER BUYS IS NOT FIXED, AND THE MEASUREMENT IS NOT DUE YET
 * ---------------------------------------------------------------------------
 *
 * §3.5(c) and (c') are the part a reader of this file needs before choosing a
 * threshold, and they are summarised rather than restated because the numbers
 * are mc-meshing's to publish:
 *
 *   Against a GREEDY-MERGED mesh, LOD 1's quad reduction collapses — `-52.8%`
 *   on a naive flat mesh becomes `-0.0%`, and rolling terrain goes from `-45.9%`
 *   to `-2.9%`. The cause is mechanical: simplification reduces by snapping
 *   quads together and dropping duplicates, and a merged mesh has already
 *   collapsed its flat runs, so there is nothing left to collide with.
 *
 *   Ambient occlusion moved it back UP — AO joins the merge key, so faces with
 *   different corner shading cannot merge, and the ring-weighted take at
 *   `renderDistance = 4` went `1.2% -> 3.1%`. THE DIRECTION IS THE POINT: the
 *   value of a LOD tier is a function of how finely the mesh is already broken
 *   up, and real lighting (mc-worldgen's `LightGrids`) breaks it up further.
 *
 * The operative consequence, which is §3.5(c')'s and is repeated here because
 * this is the file where somebody will be tempted: DO NOT FREEZE A THRESHOLD
 * BEFORE LIGHTING LANDS. Measuring now fixes the constant at the point where the
 * tier buys the least it ever will.
 *
 * And §3.5(d) on cost: `simplifyMesh` runs in the same order as meshing itself
 * and is 2.9x on the checkerboard fixture. It is not a per-frame call. Run it
 * once for a chunk whose tier changed and keep the result — which is why
 * `lodForDistance` is a pure function of a distance and holds no cache: the
 * cache belongs to whatever owns the chunk meshes, not to the level rule.
 */
import { CHUNK_SIZE, LOD_LEVELS, type LodLevel, STEP_FOR_LOD } from '@nerima-games/mc-meshing'

/** The three tiers, named — derived from `LOD_LEVELS` rather than re-spelling `0, 1, 2`. */
const [LOD_LEVEL_FINEST, LOD_LEVEL_MIDDLE, LOD_LEVEL_COARSEST] = LOD_LEVELS

/**
 * A chunk coordinate pair. Not a world position — the units are CHUNKS.
 *
 * Declared here rather than mirrored from mc-kernel's `ChunkCoord`, and the
 * reason is worth a line: this file needs only "two integers to subtract", and
 * kernel's coordinate types are branded, so mirroring one would oblige every
 * caller to brand its inputs before it could ask which tier a chunk is at.
 * This local coordinate pair mirrors only what this repository USES; a brand
 * imposed for a subtraction is not use.
 */
export type ChunkXZ = {
  readonly chunkX: number
  readonly chunkZ: number
}

/**
 * Distance in chunks, in the CHEBYSHEV (L-infinity) norm: the larger of the two
 * axis separations.
 *
 * WHICH NORM IS LOAD-BEARING AND IS NOT A STYLE CHOICE. The loaded region is a
 * SQUARE — `renderDistance = R` loads `(2R+1)^2` chunks — and Chebyshev is the
 * norm whose balls are that square. Under it, "distance <= R" and "inside the
 * loaded region" are the same statement, so tier bands are concentric rings of
 * `8d` chunks each and `lodTierCensus` can count them exactly.
 *
 * Euclidean would make the tier boundaries circles inscribed in a square region,
 * so the corners of the loaded area would fall in a coarser tier than their
 * edge-adjacent neighbours at the same ring — visible as four diagonal seams
 * that move with the player. The L1 norm would produce the same artefact rotated
 * 45 degrees. Neither is wrong about distance; both disagree with the SHAPE of
 * the thing being tiered.
 *
 * `Math.abs` and not a squared comparison: the value is returned, not only
 * compared, because `lodScreenErrorPixels` takes it as a divisor.
 */
export const chunkDistance = (from: ChunkXZ, to: ChunkXZ): number =>
  Math.max(Math.abs(from.chunkX - to.chunkX), Math.abs(from.chunkZ - to.chunkZ))

/**
 * The distance at which each tier takes over, in chunks.
 *
 * Two fields rather than an array indexed by level, because the array would have
 * a meaningless slot at index 0: LOD 0 is not "reached at a distance", it is
 * what a chunk is when it has reached nothing. `lodForDistance` returning 0 as
 * the fall-through says the same thing without a `thresholds[0]` that no reader
 * could interpret.
 */
export type LodThresholds = {
  /** At or beyond this many chunks, a chunk is at least LOD 1. */
  readonly lod1: number
  /** At or beyond this many chunks, a chunk is at LOD 2. */
  readonly lod2: number
}

/**
 * TRANSCRIBED from the reference's `lod-simplification.ts` (`LOD1_DISTANCE = 4`).
 *
 * The name §3.4 assigned, kept exactly, so that a search for it across the
 * organisation lands here. It is a TRANSCRIPTION AND NOT A RECOMMENDATION — see
 * this file's header for the 11 px the accompanying "sub-pixel" claim does not
 * survive.
 */
export const LOD1_DISTANCE_CHUNKS = 4

/** TRANSCRIBED from the reference (`LOD2_DISTANCE = 8`). See `LOD1_DISTANCE_CHUNKS`. */
export const LOD2_DISTANCE_CHUNKS = 8

/**
 * The reference's pair, as one value.
 *
 * Exists so that a caller wanting the reference's behaviour names it once
 * instead of re-typing `{ lod1: 4, lod2: 8 }`, and so that every such call site
 * is findable when the perception measurement finally replaces them.
 */
export const REFERENCE_LOD_THRESHOLDS: LodThresholds = {
  lod1: LOD1_DISTANCE_CHUNKS,
  lod2: LOD2_DISTANCE_CHUNKS,
}

/**
 * Thresholds as ratios of the render distance: `LOD1 = R/2`, `LOD2 = R`.
 *
 * §3.5(b)'s remedy for the dead-tier defect in this file's header. Because the
 * outermost loaded ring is at exactly `R`, `lod2 = R` puts the coarsest tier on
 * that ring at EVERY setting, which is the property the absolute 8 loses as soon
 * as `R < 8`.
 *
 * `Math.max(1, ...)` and `Math.round`: `R` may be odd, and a `lod1` of 0 would
 * put the player's own chunk — the one whose geometry is most visible — at LOD 1.
 * The floor of 1 is the first distance at which a chunk is not the one the
 * player stands in.
 *
 * DEGENERATE AT `R <= 1`, deliberately and visibly: both thresholds land on 1,
 * so the LOD 1 band `[lod1, lod2)` is empty and chunks step from 0 straight to
 * 2. That is the correct behaviour for a two-ring world rather than a bug — with
 * one ring of neighbours there is no room for a graduated middle — and it is
 * pinned by a test so that it is a decision rather than an accident.
 *
 * THE RATIO ITSELF IS NOT MEASURED. `1/2` and `1` are a shape, chosen because it
 * cannot produce an unreachable tier; the header says why no ratio can be
 * justified until the perception measurement is taken and why that measurement
 * should wait for lighting. Preferring this to the reference's pair is a claim
 * about REACHABILITY only, and that claim is arithmetic — `lodTierCensus` proves
 * it — rather than perceptual.
 */
/** The floor every threshold is clamped to: a `lod1` of 0 would put the player's own chunk at LOD 1. */
const MIN_LOD_THRESHOLD_CHUNKS = 1
/** `lod1`'s ratio of the render distance: half. */
const LOD1_RENDER_DISTANCE_RATIO = 2

export const lodThresholdsForRenderDistance = (renderDistance: number): LodThresholds => ({
  lod1: Math.max(MIN_LOD_THRESHOLD_CHUNKS, Math.round(renderDistance / LOD1_RENDER_DISTANCE_RATIO)),
  lod2: Math.max(MIN_LOD_THRESHOLD_CHUNKS, Math.round(renderDistance)),
})

/**
 * The level a chunk at this distance is drawn at.
 *
 * TOTAL: every real number maps to a level, including negatives and NaN. A
 * distance is a measurement and a renderer that threw on a strange one would
 * take down the frame for a bookkeeping error — the same rule `aoShade` in
 * `./chunk-geometry.ts` and `mouseButtonForIndex` in `./input-bindings.ts`
 * already follow in this repository.
 *
 * The comparison order matters and is coarsest-first: with thresholds that
 * cross (`lod1 > lod2`, which `lodThresholdsForRenderDistance` cannot produce
 * but a hand-written pair can) a distance satisfying both must resolve to the
 * COARSER tier. Testing `lod1` first would return LOD 1 for a chunk beyond the
 * LOD 2 boundary, which is the direction that costs frame time rather than
 * fidelity.
 *
 * NaN falls through both `>=` comparisons to LOD 0 — the finest, most expensive
 * and most correct-looking tier. Degrading toward "draw it properly" is the safe
 * direction for a value nobody can interpret.
 */
export const lodForDistance = (distanceChunks: number, thresholds: LodThresholds): LodLevel => {
  if (distanceChunks >= thresholds.lod2) {
    return LOD_LEVEL_COARSEST
  }
  if (distanceChunks >= thresholds.lod1) {
    return LOD_LEVEL_MIDDLE
  }
  return LOD_LEVEL_FINEST
}

/** The viewing conditions the apparent error depends on. */
export type ViewingConditions = {
  /** The drawing surface's height in pixels. Width does not enter: the FOV is vertical. */
  readonly viewportHeightPixels: number
  /**
   * VERTICAL field of view in degrees — three's `PerspectiveCamera` convention,
   * which is what `application/world-renderer.ts` constructs.
   */
  readonly verticalFovDegrees: number
}

/**
 * The conditions §3.5(a)'s published table was computed at: 1080p at FOV 75.
 *
 * Present so the table is REPRODUCIBLE rather than quoted — `test/level-of-detail.test.ts`
 * recomputes all four of its numbers from `lodScreenErrorPixels` and this value.
 * A table that could only be quoted is how a wrong measurement survives review,
 * which is the defect class this file exists to close.
 *
 * The FOV is the reference's default and the centre of the range its schema
 * permits (`settings.schema.ts:53`); it is also
 * `application/world-renderer.ts`'s `CAMERA_FOV_DEGREES`, and the test asserts
 * the two agree rather than trusting that they do.
 */
export const REFERENCE_VIEWING_CONDITIONS: ViewingConditions = {
  verticalFovDegrees: 75,
  viewportHeightPixels: 1080,
}

/** Degrees in a half turn — the divisor `toRadians` converts through. */
const HALF_TURN_DEGREES = 180

/** Degrees to radians. `Math` has no such constant and the conversion appears twice. */
const toRadians = (degrees: number): number => (degrees * Math.PI) / HALF_TURN_DEGREES

/**
 * Pixels per world unit at a given distance — the projection, isolated.
 *
 * `H / (2 * tan(fov_v / 2))` is the focal length in pixels, and dividing by the
 * distance gives the on-screen size of a unit-length object there. Both public
 * functions below are this quantity times, or divided into, a displacement in
 * blocks; factoring it out is what keeps the forward and inverse forms provably
 * each other's inverse instead of two hand-transposed formulae that can drift
 * apart — the mistake `quadCorners` in `./chunk-geometry.ts` documents at
 * length for the six face directions.
 */
/**
 * The `2` in the standard `H / (2 * tan(fov_v / 2))` focal-length-in-pixels
 * formula: halves the full FOV to the half-angle `tan` wants, and doubles
 * that tangent back out to the full angular extent.
 */
const FOCAL_LENGTH_FORMULA_FACTOR = 2

const pixelsPerBlockAt = (distanceBlocks: number, view: ViewingConditions): number =>
  view.viewportHeightPixels /
  (FOCAL_LENGTH_FORMULA_FACTOR *
    Math.tan(toRadians(view.verticalFovDegrees) / FOCAL_LENGTH_FORMULA_FACTOR) *
    distanceBlocks)

/**
 * How far, in pixels on screen, a simplified chunk's worst edge sits from where
 * it belongs.
 *
 * THE MEASUREMENT THE REFERENCE'S "sub-pixel" COMMENT ASSERTS WITHOUT TAKING.
 * mc-meshing `docs/responsibility.md` §3.5(a):
 *
 *   error[px] = (step - 1) / (CHUNK_SIZE * d) * H / (2 * tan(fov_v / 2))
 *
 * with `step = STEP_FOR_LOD[level]` from the local LOD vocabulary, so the numerator
 * tracks the snapping mechanism rather than a copy of it.
 *
 * WHY `step - 1` IS THE RIGHT NUMERATOR, since it is the one part that is not
 * optics. Simplification sends an extent `[a, b]` to
 * `[floor(a/step)*step, ceil(b/step)*step]`. Each end therefore moves by at most
 * `step - 1` blocks, and mc-meshing's own suite pins that bound as a property
 * over arbitrary merged extents AND pins that it is attained. This is a WORST
 * CASE, not a typical one: a quad already aligned to the coarse grid does not
 * move at all, and on merged flat terrain most are.
 *
 * ONLY HORIZONTAL. `simplifyMesh` never snaps Y, so a hill's silhouette — the
 * thing a player actually reads as shape — carries zero error at every level.
 * The number below is the error in the two axes that were snapped.
 *
 * Returns 0 at LOD 0 by construction, since `step` is 1 there and the numerator
 * vanishes: "level 0 is exact" falls out of the table rather than being a
 * special case that could disagree with it. Returns `Infinity` at distance 0,
 * which is honest — a chunk at the player's own position has no meaningful
 * apparent size — and unreachable in practice, because no threshold below puts
 * distance 0 above LOD 0.
 */
/** The `- 1` in `step - 1`: each end of a snapped extent moves by at most this many fewer blocks than `step`. */
const STEP_DISPLACEMENT_OFFSET = 1

export const lodScreenErrorPixels = (
  level: LodLevel,
  distanceChunks: number,
  view: ViewingConditions,
): number =>
  (STEP_FOR_LOD[level] - STEP_DISPLACEMENT_OFFSET) * pixelsPerBlockAt(distanceChunks * CHUNK_SIZE, view)

/**
 * The inverse: how far away a chunk must be for its LOD error to fall under a
 * given pixel budget.
 *
 * THIS IS THE FUNCTION THAT TURNS §3.5(a)'s MISSING MEASUREMENT INTO A NUMBER.
 * Its procedure ends with "solve the formula for `d`", and the point of exporting
 * the solution is that whoever runs the A/B test does not have to re-derive
 * algebra to use their own result — they pass the pixel error at which observers
 * started noticing and get the threshold back.
 *
 * Feeding it 1 px reproduces §3.5(a)'s "distance at which the error drops below
 * one pixel" column (about 44 and 132 chunks), which is an UPPER BOUND on any
 * measured threshold rather than the threshold itself: nobody perceives a
 * one-pixel edge shift on distant terrain, so the measured answer will be
 * smaller. Whether it is smaller than 4 is exactly what is unknown.
 *
 * Returns 0 at LOD 0: an exact tier satisfies every budget at every distance.
 */
export const distanceForScreenErrorPixels = (
  level: LodLevel,
  errorPixels: number,
  view: ViewingConditions,
): number =>
  (STEP_FOR_LOD[level] - STEP_DISPLACEMENT_OFFSET) * (pixelsPerBlockAt(CHUNK_SIZE, view) / errorPixels)

/** How many of the loaded chunks fall in each tier. Indexed by `LodLevel`. */
export type LodTierCensus = Readonly<Record<LodLevel, number>>

/**
 * Count the loaded chunks at each tier, for a render distance and a threshold pair.
 *
 * THE DEAD-TIER DEFECT, MADE ARITHMETIC. §3.5(b) states it in prose — at
 * `renderDistance = 4` the coarsest tier never fires because no chunk is ever 8
 * away — and prose is what this project's retrospective identifies as the form
 * in which four wrong blockers survived: a category cannot be checked, a thing
 * can. `lodTierCensus(4, REFERENCE_LOD_THRESHOLDS)[2] === 0` is a thing, and
 * `test/level-of-detail.test.ts` asserts it, so the defect is pinned in its
 * current wrong state and the day a threshold rule fixes it, that test says so.
 *
 * Exact rather than sampled, and it has to be: a sampled census would answer
 * "approximately zero" for the dead tier, and approximately zero is the one
 * answer that hides the defect. Under the Chebyshev norm the loaded region is
 * the square `[-R, R]^2` and ring `d` holds exactly `8d` chunks for `d > 0` and
 * 1 for `d = 0`, so the loop below counts rings rather than chunks and is O(R).
 *
 * `renderDistance` is truncated toward zero and floored at 0: a fractional
 * render distance is not a thing the loader can honour, and a negative one still
 * loads the chunk the player is in.
 */
/** `lodTierCensus`'s ring counter starts at the centre and advances one ring at a time. */
const CENTER_RING = 0
const RING_STEP = 1
/** The centre "ring" is one chunk (the player's own); every other ring `d` holds `8d`. */
const CENTER_RING_CHUNK_COUNT = 1
const CHUNKS_PER_RING_UNIT = 8

/** 1 chunk at the centre, then `8d` on each ring: `(2d+1)^2 - (2d-1)^2`. */
const ringChunkCount = (ring: number): number => {
  if (ring === CENTER_RING) {
    return CENTER_RING_CHUNK_COUNT
  }
  return CHUNKS_PER_RING_UNIT * ring
}

/** A render distance never yields a negative radius: a negative one still loads the player's own chunk. */
const MIN_RENDER_RADIUS_CHUNKS = 0

export const lodTierCensus = (renderDistance: number, thresholds: LodThresholds): LodTierCensus => {
  const radius = Math.max(MIN_RENDER_RADIUS_CHUNKS, Math.trunc(renderDistance))
  const counts: Record<LodLevel, number> = { 0: 0, 1: 0, 2: 0 }

  for (let ring = CENTER_RING; ring <= radius; ring += RING_STEP) {
    counts[lodForDistance(ring, thresholds)] += ringChunkCount(ring)
  }

  return counts
}

/**
 * The tiers that no chunk can ever be drawn at, given a render distance.
 *
 * The census read as a verdict, so a caller can assert "no tier is unreachable"
 * without knowing which tier to look at — the shape that survives a fourth level
 * being added to `LOD_LEVELS`, which is otherwise the change that would leave a
 * hand-written `census[2] > 0` check silently covering less than it reads as.
 *
 * LOD 0 is included in the sweep even though it is unreachable only for a
 * degenerate threshold pair (`lod1 <= 0`), because excluding it would be a
 * special case whose justification is "it cannot happen", and this file has
 * `lodThresholdsForRenderDistance`'s `Math.max(1, ...)` precisely because it
 * can.
 */
/** A tier with no chunks in the census is unreachable at this render distance. */
const NO_CHUNKS_AT_TIER = 0

export const unreachableLodTiers = (
  renderDistance: number,
  thresholds: LodThresholds,
): ReadonlyArray<LodLevel> => {
  const census = lodTierCensus(renderDistance, thresholds)
  return LOD_LEVELS.filter((level) => census[level] === NO_CHUNKS_AT_TIER)
}
