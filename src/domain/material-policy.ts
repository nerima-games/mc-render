/**
 * Material policy: the `forceSinglePass` rule.
 *
 * ---------------------------------------------------------------------------
 * The bug
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.9:
 *
 *   共有マテリアルの transparent + DoubleSide には `forceSinglePass`
 *   (アイドルスタッターの原因。p95 33ms→9.2ms の実測)
 *
 * The reference's own explanation, at
 * ts-minecraft/packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:145-150:
 *
 *   // forceSinglePass: Three.js renders transparent+DoubleSide materials in TWO
 *   // passes (back then front faces), setting material.needsUpdate per pass. On a
 *   // material SHARED by every glass/leaves chunk mesh that version bump forces a
 *   // shader-program re-resolution for all sharers each frame (measured ~15k
 *   // getParameters calls/3s at idle). Cutout foliage gains nothing from the
 *   // two-pass ordering, so render single-pass like vanilla.
 *
 * THE TWO NUMBERS ARE NOT EQUALLY SOURCED. Do not cite them as one body of
 * evidence:
 *
 *   - `~15k getParameters calls / 3s at idle` is in the reference's SOURCE, in
 *     the comment quoted just above. Code-verified.
 *   - `p95 33ms -> 9.2ms` appears ONLY in plan.md §3.9 and in the reference
 *     repository's own copy of that same planning document, at
 *     ts-minecraft/docs/explanations/architecture/repo-decomposition-plan.md:202.
 *     It is in NO source file, test or measurement output (searched for both
 *     `33ms` and `9.2ms`; the only other hits are the unrelated `over33ms`
 *     counter in packages/app/application/main/qa-api-perf.ts:22,97 and a
 *     "~8.33ms at 120 FPS" budget test). Treat it as a claim carried by the
 *     plan until someone re-measures it.
 *
 * The p95 pair is still quoted in the diagnostic message below, deliberately:
 * it is the sentence that stops the next reader deleting the flag as a
 * micro-optimisation. That is motivation, not provenance — this comment is the
 * provenance. See docs/design-notes.md DN-02.
 *
 * Three properties have to hold at once for the stutter to appear:
 *
 *   1. `transparent: true`   — enables the two-pass path;
 *   2. `side: DoubleSide`    — the two passes are back faces then front faces;
 *   3. the material is SHARED — one `material.version` bump invalidates the
 *      shader program for every mesh that references it.
 *
 * Drop any one and the problem vanishes: a per-mesh material bumps only its own
 * version, `FrontSide` never takes the two-pass path, and an opaque material
 * never sorts. That is why the predicate below takes all three.
 *
 * ---------------------------------------------------------------------------
 * When NOT to force single pass
 * ---------------------------------------------------------------------------
 *
 * `forceSinglePass` is not free: the two-pass render exists so that the inside
 * faces of a genuinely translucent object are drawn before the outside ones.
 * Turning it off on real translucency (stained glass, deep water seen from
 * within) produces visibly wrong ordering.
 *
 * The reference sets the flag in exactly four places, and each one is a cutout
 * or a flat surface where the ordering buys nothing:
 *
 *   ts-minecraft/packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:164
 *     the SHARED glass/leaves chunk material (`alphaTest: 0.1` — a cutout)
 *   ts-minecraft/packages/rendering/infrastructure/post-processing/water-material.ts:137
 *     the SHARED water surface material (:134-136 gives the same reasoning)
 *   ts-minecraft/packages/rendering/infrastructure/particles/particle-system.ts:60
 *     the pooled (SHARED) particle material (`alphaTest: 0.5` — also a cutout;
 *     :57-59 "Cutout particles don't need it")
 *   ts-minecraft/packages/presentation/hud/first-person-held-item.ts:131
 *     the first-person held item (`transparent: !isBlock`, `DoubleSide`, flat
 *     items are a `PlaneGeometry`). NOT shared — a fresh material is
 *     constructed per call — and it lives in `packages/presentation`, the
 *     reference's HUD package, rather than in `packages/rendering`.
 *
 * That fourth site is worth reading carefully, because it is not a fourth
 * instance of the stutter. It fails condition 3, so it was never costing
 * anything; the flag there is prophylactic. What it shows is that the RULE is
 * broader than the bug: a cutout or flat `DoubleSide` material gains nothing
 * from two-pass ordering whether or not it is shared, so the flag is safe and
 * correct either way. Sharing is the multiplier that makes it urgent, not the
 * condition that makes it right. Hence `requiresForceSinglePass` returns
 * `must-force-single-pass` only when the material is shared — but its `ok`
 * verdict means "no harm either way", not "do not set it".
 *
 * (In the new split, first-person held-item rendering is a rendering concern
 * and belongs to mc-render even though the reference filed it under HUD. It is
 * an easy one to lose in the port — see docs/porting.md.)
 *
 * The distinguishing feature is `alphaTest > 0`: an alpha-tested material is a
 * cutout, every fragment is either fully opaque or discarded, and there is
 * nothing for the two-pass order to resolve. `requiresForceSinglePass` encodes
 * that as the rule rather than listing the materials by name — the same move as
 * plan.md §3.1's capability flags versus named block ids.
 */

/** THREE's `side` values, mirrored so this module needs no THREE import. */
export type MaterialSide = 'front' | 'back' | 'double'

/**
 * The material properties this policy reasons about.
 *
 * A structural subset of `THREE.Material`, so a real material satisfies it
 * without adaptation, but expressible and testable with no THREE.js present.
 */
export type MaterialSpec = {
  readonly name: string
  readonly transparent: boolean
  readonly side: MaterialSide
  /** Alpha cutoff. Greater than zero means the material is a cutout. */
  readonly alphaTest: number
  /** True when the rendered geometry is a single surface, not a closed volume. */
  readonly flatSurface: boolean
  /** True when one material instance is referenced by many meshes. */
  readonly shared: boolean
}

/**
 * True when this material would take THREE's two-pass transparent path.
 *
 * Costly only when shared; harmless on a per-mesh material.
 */
export const takesTwoPassPath = (material: MaterialSpec): boolean =>
  material.transparent && material.side === 'double'

/** `alphaTest` at or below this value means no cutout is applied. */
const ALPHA_TEST_DISABLED = 0

/**
 * True when the material is a cutout: every fragment is opaque or discarded, so
 * back-to-front ordering resolves nothing.
 */
export const isCutout = (material: MaterialSpec): boolean => material.alphaTest > ALPHA_TEST_DISABLED

/**
 * THE RULE. `forceSinglePass: true` is required exactly when a material is
 * shared, takes the two-pass path, and is either a cutout or a flat surface.
 *
 * Shared + two-pass + NOT a cutout is genuine translucency: it must keep the
 * two-pass ordering and must instead be un-shared, or accept the cost. See
 * `describeMaterialPolicy` for that case's diagnostic.
 */
export const requiresForceSinglePass = (material: MaterialSpec): boolean =>
  material.shared && takesTwoPassPath(material) && (isCutout(material) || material.flatSurface)

export type MaterialPolicyVerdict =
  | { readonly kind: 'ok'; readonly reason: string }
  | { readonly kind: 'must-force-single-pass'; readonly reason: string }
  | { readonly kind: 'review-sharing'; readonly reason: string }

/**
 * Explain what to do about a material.
 *
 * Returns a verdict rather than a boolean so that the awkward middle case —
 * shared, two-pass, genuinely translucent — gets its own answer instead of
 * being silently lumped in with "fine".
 */
export const describeMaterialPolicy = (material: MaterialSpec): MaterialPolicyVerdict => {
  if (!takesTwoPassPath(material)) {
    return {
      kind: 'ok',
      reason: `${material.name} does not take THREE's two-pass transparent path (transparent + DoubleSide).`,
    }
  }
  if (!material.shared) {
    return {
      kind: 'ok',
      reason:
        `${material.name} is two-pass but per-mesh, so its material.version bump invalidates ` +
        'only its own shader program.',
    }
  }
  if (isCutout(material) || material.flatSurface) {
    return {
      kind: 'must-force-single-pass',
      reason:
        `${material.name} is shared, transparent and DoubleSide, so every frame bumps ` +
        'material.version twice and re-resolves the shader program for every mesh that shares it ' +
        '(~15k getParameters calls per 3s at idle in the reference; p95 frame time 33ms -> 9.2ms ' +
        `once forced). ${
          material.flatSurface
            ? 'flatSurface is true: the geometry is not a closed volume; '
            : `alphaTest ${String(material.alphaTest)} makes it a cutout; `
        }` +
        'the two-pass ordering buys nothing. Set forceSinglePass: true.',
    }
  }
  return {
    kind: 'review-sharing',
    reason:
      `${material.name} is shared, transparent and DoubleSide, but flatSurface is false and ` +
      `alphaTest ${String(material.alphaTest)} does not enable alpha testing — it is ` +
      'genuinely translucent and needs the two-pass ordering for correct back-then-front ' +
      'rendering. forceSinglePass would visibly break it. Un-share the material instead, or ' +
      'accept the program-cache cost deliberately.',
  }
}

/**
 * Audit a set of materials, returning those that need attention.
 *
 * Intended for a startup assertion in the THREE.js adapter: build every shared
 * material, run them past this, and fail loudly in development rather than
 * shipping an idle stutter that only shows up in a p95 frame-time histogram.
 */
export const auditMaterials = (
  materials: ReadonlyArray<MaterialSpec>,
): ReadonlyArray<{ readonly material: MaterialSpec; readonly verdict: MaterialPolicyVerdict }> =>
  materials
    .map((material) => ({ material, verdict: describeMaterialPolicy(material) }))
    .filter((entry) => entry.verdict.kind !== 'ok')
