/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-meshing`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * Same reason and same fate as `./kernel-vocabulary.ts`, whose header carries
 * the full argument. plan.md §6 Step 3 publishes bottom-up, `@nerima-games/mc-meshing`
 * does not resolve yet, and `scripts/check-dependency-whitelist.ts` would reject
 * an import of something absent from `package.json#dependencies` in any case.
 *
 * WHEN mc-meshing IS PUBLISHED:
 *   1. add `@nerima-games/mc-meshing` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './lod-vocabulary'` at `'@nerima-games/mc-meshing'`.
 * If step 3 does not typecheck, this file has drifted and the drift is the bug.
 * mc-dev-meta's `check:repoint` rehearses exactly that, and `check:mirrors`
 * compares the declarations below against mc-meshing's by value on every run.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LEVEL VOCABULARY IS mc-meshing's AND THE DISTANCES ARE NOT
 * ---------------------------------------------------------------------------
 *
 * mc-meshing `docs/responsibility.md` §3.4 split the reference's
 * `lod-simplification.ts` (288 LOC) down the middle, and the criterion was
 * whether a symbol takes a COORDINATE:
 *
 *   simplifyMesh, LodLevel, LOD_LEVELS, LodLevelSchema, STEP_FOR_LOD
 *                                                       -> mc-meshing
 *   lodForDistance, LOD1_DISTANCE_CHUNKS, LOD2_DISTANCE_CHUNKS
 *                                                       -> mc-render (./level-of-detail.ts)
 *
 * mc-meshing holds no coordinates (§3.3), and `distanceChunks` is one — it is
 * the norm between the player's chunk and some other chunk. So THIS repository
 * decides which level a chunk is at, and mc-meshing decides what a level means.
 * That division only works if the vocabulary lives on one side and is mirrored
 * to the other, which is this file.
 *
 * ---------------------------------------------------------------------------
 * `LOD_LEVELS` IS A CLOSED UNION AND IS MIRRORED WHOLE
 * ---------------------------------------------------------------------------
 *
 * The mirror discipline says "mirror only what you use", and this file breaks
 * that rule on purpose, for a reason the organisation has already paid for
 * once. mc-dev-meta's records the case: mc-sim's `ITEM_TYPES` carried 23 of
 * mc-kernel's 97 literals, both repositories' own suites were green — each was
 * pinning its own copy — and the defect surfaced only when `check:repoint`
 * actually swapped the import.
 *
 * A PARTIAL MIRROR OF A CLOSED UNION IS NOT "LESS VOCABULARY". IT IS A
 * DIFFERENT, NARROWER TYPE. A `LodLevel` mirrored as `0 | 1` type-checks
 * everywhere in this repository, and fails on the day the import is repointed —
 * or worse, does not fail, because `0 | 1` is assignable to `0 | 1 | 2` and only
 * the REVERSE direction breaks. `lodForDistance` returning the narrow type would
 * flow into mc-meshing's `simplifyMesh` without complaint while being incapable
 * of ever selecting the coarsest level.
 *
 * So all three levels are here, and `test/lod-vocabulary-mirror.test.ts` pins
 * the roster by length as well as by membership.
 */
import { Schema } from 'effect'

/**
 * The levels, coarsest last. MIRRORS `mc-meshing/domain/lod.ts:63`.
 *
 * `0` is "do not simplify" and is a real level rather than the absence of one,
 * so a caller can hold a `LodLevel` unconditionally instead of a
 * `LodLevel | undefined`. `lodForDistance` in `./level-of-detail.ts` is total
 * because of this: there is no distance for which it has nothing to return.
 */
export const LOD_LEVELS = [0, 1, 2] as const

/** MIRRORS `mc-meshing/domain/lod.ts:65`. */
export type LodLevel = (typeof LOD_LEVELS)[number]

/**
 * Validation for a level that arrived from outside the type system.
 * MIRRORS `mc-meshing/domain/lod.ts:75`.
 *
 * Mirrored even though nothing in this repository parses one yet, and the
 * reason is the same one `kernel-vocabulary.ts` gives for carrying the whole
 * Clock Port: mc-meshing's own header names the use as a WORKER MESSAGE, which
 * crosses `postMessage` and lands as `unknown`. index.ts records the mesher pool
 * as the thing that will finally turn `"WebWorker"` on in this package's
 * tsconfig, and the level is what its messages will carry. Mirroring the schema
 * now costs one line; discovering at pool-assembly time that the validator lives
 * behind an unpublished import costs a decision under pressure.
 *
 * Derived by spread from `LOD_LEVELS` rather than re-spelling `0, 1, 2`, so a
 * fourth level cannot be added to one and not the other — mc-meshing's reason,
 * kept because a mirror that "tidies" its source is a mirror that has drifted.
 */
export const LodLevelSchema = Schema.Literal(...LOD_LEVELS)

/**
 * Blocks per LOD grid cell. MIRRORS `mc-meshing/domain/lod.ts:84`.
 *
 * THE REASON THIS FILE EXISTS AT ALL. mc-meshing `docs/responsibility.md`
 * §3.5(a) states the apparent-error formula this repository needs in order to
 * say anything defensible about `LOD1_DISTANCE_CHUNKS` and
 * `LOD2_DISTANCE_CHUNKS`, and its numerator is `step - 1`:
 *
 *   error[px] = (step - 1) / (16 * d) * H / (2 * tan(fov_v / 2))
 *
 * `step - 1` is the furthest one edge of a quad can move when `simplifyMesh`
 * snaps its extents outward onto the coarser grid. That is a fact about
 * mc-meshing's mechanism, so the number belongs there and is READ from here.
 * `./level-of-detail.ts`'s `lodScreenErrorPixels` is the formula; this is its
 * one input that is not a property of the camera.
 *
 * The table was private until this mirror needed it. mc-meshing's own header
 * records why it was opened rather than re-spelled here: two hand-written lists
 * stating the same thing is a defect shape this organisation has six recorded
 * instances of, and this instance would have diverged INVISIBLY — a stale step
 * makes the error formula report a plausible pixel count that is wrong by the
 * ratio of the two steps, with nothing on either side going red.
 *
 * `Readonly<Record<LodLevel, number>>` and not a wider `Record<number, number>`:
 * a caller has to hold a `LodLevel` before it can index this, which is what
 * keeps `lodScreenErrorPixels` total without a runtime guard.
 */
export const STEP_FOR_LOD: Readonly<Record<LodLevel, number>> = { 0: 1, 1: 2, 2: 4 }

/**
 * Blocks along one horizontal edge of a chunk. MIRRORS
 * `mc-meshing/domain/chunk-view.ts:11`.
 *
 * The formula on `STEP_FOR_LOD` above needs it, because `distanceChunks` is in
 * CHUNKS and `step - 1` is in BLOCKS, and `16` is the conversion between them.
 *
 * MIRRORED RATHER THAN WRITTEN AS `16`, which is worth defending because the
 * literal looks harmless. `application/world-renderer.ts`'s `CAMERA_FAR_PLANE`
 * is the cautionary case in this very repository: the reference computes the far
 * plane as `renderDistance * CHUNK_SIZE * 1.5 + CHUNK_HEIGHT`, that comment
 * declines to restate the formula precisely because the constants were not
 * reachable from here, and it settles for the floor instead — noting that a
 * number which "looks derived and is not" is the failure mode with eight
 * recorded instances. This mirror removes the excuse for one of the two, so the
 * error formula is genuinely derived rather than merely plausible.
 *
 * There is deliberately NO `CHUNK_HEIGHT` here. `simplifyMesh` never snaps Y
 * (mc-meshing `domain/lod.ts:40-43`: a silhouette that jumps at a LOD threshold
 * reads as a pop rather than as distance), so the vertical extent does not enter
 * the apparent-error calculation at all, and a mirror carries what it uses.
 */
export const CHUNK_SIZE = 16
