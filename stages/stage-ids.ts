/**
 * Every `StageId` this repository writes down, in one file.
 *
 * See `@nerima-games/mc-kernel` for why a stage id is a string and what
 * that implies: naming one creates no import and no dependency edge, so an
 * `after` constraint is invisible to `pnpm check:deps`. Collecting them here is
 * what makes them reviewable, and `test/stage-registration.test.ts` reads this
 * file and fails if an edge points somewhere it should not.
 *
 * ---------------------------------------------------------------------------
 * Why these five stages are mc-render's, and not a new module's
 * ---------------------------------------------------------------------------
 *
 * The vertical-slice spike had to place the render stages somewhere, and the
 * candidates were "a new experience module" and "mc-render". Three findings
 * settled it on mc-render:
 *
 * 1. Their complete import set is mc-kernel + mc-sim (read-only) + mc-render +
 *    mc-meshing — which is already mc-render's declared row in the dependency
 *    graph. A new module would need exactly the same row, plus an edge to
 *    mc-render, plus a new node in plan.md §2.1.
 * 2. They contain no game rule. An experience module (plan.md §2.2) owns VERBS;
 *    a module hosting these would own none, which makes it an experience module
 *    in name only.
 * 3. mc-render must register a stage regardless — see the next paragraph.
 *
 * ---------------------------------------------------------------------------
 * The live defect this file closes
 * ---------------------------------------------------------------------------
 *
 * `InputService.endFrame` (`../application/input-service.ts`) clears the
 * per-frame input edges and MUST be called exactly once per frame. Anything
 * that must happen exactly once per frame is a stage by definition.
 *
 * Before this file existed, the ONLY registered input stage anywhere in the
 * 16-repository roster was `input:sample` in `mc-playground-kit` — and kit is
 * developer tooling, banned from `dependencies` by rule 6 of
 * `scripts/check-dependency-whitelist.ts`. So the SHIPPED build had no input
 * stage at all: `justPressed` would never clear, and a single press of the
 * inventory key would re-fire on every frame it was held.
 *
 * That is precisely the failure plan.md §2.3-2 was written to prevent ("runtime
 * input belongs in mc-render, NOT in mc-playground-kit, because kit is
 * dev-only"), and it had been reintroduced by a missing stage rather than by a
 * misplaced service.
 */
import { StageId } from "@nerima-games/mc-kernel"

/**
 * Stages owned by mc-render.
 *
 * All five carry the `render:` prefix, including the ones whose work matches a
 * skeleton phase of the same bare name (`camera-mirror`, `chunk-sync`,
 * `post-fx`). The convention in plan.md §4.1 is `<owning-repo-suffix>:<stage>`
 * and every other repository in the roster follows it — mx-ui registers
 * `ui:hud-sync` even though the phase is called `hud-sync`. Two reasons not to
 * make an exception here:
 *
 * - mc-compose's `domain/modding.ts` RESERVES the bare names (`camera-mirror`,
 *   `chunk-sync`, `render`, `post-fx`, `input`) against a mod claiming them.
 *   Registering a bare name is legal for a first-party module and needlessly
 *   spends the reserved id.
 * - the prefix is what makes `pnpm check:deps`-invisible ownership legible: a
 *   reviewer looking at a resolved frame order can tell at a glance which
 *   repository to open.
 *
 * mc-compose's phase membership matches on the NAME half of an id — the part
 * after the last colon — so `render:camera-mirror` lands in the `camera-mirror`
 * phase, `render:draw` in `render`, and so on. `render:input` is the case
 * mc-compose's `domain/stage-order.ts` calls out by name: it matches both
 * `input` and (by namespace) nothing else, and a stage matching several phases
 * belongs to the EARLIEST, so it is input rather than render. That is the
 * intended reading — input must be sampled before anything reacts to it.
 *
 * NOTE that stating any of this is not the same as CLAIMING a position. The
 * skeleton is mc-compose's alone (plan.md §2.3-3); this repository only names
 * its stages and declares what its own correctness requires.
 */
export const RENDER_STAGE_IDS = {
  /**
   * Sample input, then close the frame's input edges.
   *
   * The stage the shipped build did not have. See the module header.
   */
  input: StageId('render:input'),
  /**
   * Copy mc-sim's authoritative camera pose into renderer state.
   *
   * plan.md §3.8 / §5.1-2: mc-sim owns the pose and the renderer mirrors it.
   * The direction of this copy is the whole reason the stage is named.
   */
  cameraMirror: StageId('render:camera-mirror'),
  /** Hand dirty chunks to the mesher. After simulation, before draw. */
  chunkSync: StageId('render:chunk-sync'),
  /** Draw. */
  draw: StageId('render:draw'),
  /**
   * The post-processing chain.
   *
   * plan.md §3.9 fixes its INTERNAL order
   * (RenderPass -> GTAO -> GodRays -> Bloom -> Bokeh -> SMAA -> Output); that
   * order is `domain/post-processing.ts`'s business, and this stage is the
   * single point in the frame at which the chain runs.
   */
  postFx: StageId('render:post-fx'),
} as const

/**
 * Stages owned by OTHER repositories that mc-render orders itself against.
 *
 * `sim:physics` only, and deliberately the minimum. The camera mirror must see
 * this frame's resolved player position — mirroring a pre-integration pose is
 * a one-frame lag on the view, which reads as input latency rather than as a
 * bug and is therefore the kind of thing nobody ever files.
 *
 * Note what is NOT declared. mc-render does NOT order `render:input` before
 * `sim:physics`, even though plan.md §4.2's skeleton puts input first: that
 * would be a claim about the global order, which only mc-compose is entitled to
 * make (plan.md §2.3-3). And it declares no edge to any `gameplay:`, `ui:` or
 * `redstone:` stage — mc-render is not an experience module's parent and must
 * not couple its frame position to one existing.
 */
export const UPSTREAM_STAGE_IDS = {
  simPhysics: StageId('sim:physics'),
} as const

/**
 * The `<repo>:` prefixes belonging to the four experience modules (plan.md
 * §2.2). Used by the regression test that enforces §2.3-1's zero-edge rule at
 * the ordering level as well as at the import level.
 *
 * An `after: [StageId('ui:hud-sync')]` would pass `pnpm check:deps` — it is a
 * string — while still coupling mc-render's frame position to mx-ui's
 * existence. The test closes that gap.
 */
export const EXPERIENCE_MODULE_STAGE_PREFIXES = ['gameplay:', 'redstone:', 'ui:', 'multiplayer:'] as const

/** This repository's own prefix. */
export const OWN_STAGE_PREFIX = 'render:'
