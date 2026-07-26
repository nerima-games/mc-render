/**
 * The post-processing chain, as data.
 *
 * ---------------------------------------------------------------------------
 * The order is fixed, and it is fixed for reasons
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.9: `RenderPass → GTAO → GodRays → Bloom → Bokeh(DoF) → SMAA → Output`.
 *
 * Verified against the reference implementation's single composer build,
 * `ts-minecraft/packages/app/application/main/session-post-processing.ts`, by
 * `comp.addPass(...)` call order:
 *
 *   :51   RenderPass          (unconditional)
 *   :63   GTAOPass            (only when ssaoEnabled)
 *   :76   GodRaysPass         (only when godRaysEnabled && !compositeActive)
 *   :94   UnrealBloomPass     (only when bloomEnabled && !compositeActive)
 *   :110  BokehPass           (only when dofEnabled && !compositeActive)
 *   :127  CompositePass       (only when compositeActive)      <- NOT IN plan.md
 *   :137  SMAAPass            (only when smaaEnabled)
 *   :142  OutputPass          (unconditional)
 *
 * plan.md's list omits `CompositePass`. It is a real eighth stage: at the
 * `ultra` preset the reference merges Bloom + GodRays + Bokeh into ONE
 * full-screen shader instead of three, and forces the individual passes off.
 * The reference states its position explicitly (:115-117):
 *
 *   // CompositePass (new): single fragment shader for bloom + godRays + bokeh.
 *   // Inserted AFTER the individual passes (which are no-ops when active) and
 *   // BEFORE SMAA so anti-aliasing operates on the final composited image.
 *
 * Why each edge in the order matters:
 *
 * - GTAO before everything else that reads colour. Ambient occlusion needs the
 *   raw depth/normal buffers the RenderPass just produced; running it after a
 *   blur would darken creases that a bloom had already brightened.
 * - GodRays before Bloom. God rays produce bright streaks that bloom should
 *   then pick up; reversed, the streaks are added after the threshold pass and
 *   never glow.
 * - Bokeh after Bloom. Depth of field blurs what is on screen, including the
 *   glow. Blur-then-glow re-sharpens the out-of-focus region.
 * - SMAA last but one, ALWAYS. Anti-aliasing must see the final composited
 *   image; any pass after it re-introduces the aliasing it just removed. This
 *   is why CompositePass is inserted before, not after.
 * - OutputPass last, unconditionally. It performs tone mapping and colour-space
 *   conversion; anything after it operates on display-referred values.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 *
 * The order above is the kind of knowledge that is normally encoded only in the
 * sequence of statements in a builder function — which means it can only be
 * checked by reading, and can only be tested with a GPU. Representing the chain
 * as DATA makes the ordering rule a pure function over an array, which is
 * testable in Node with no WebGL, no canvas and no THREE.js. See
 * `test/post-processing.test.ts`.
 *
 * The THREE.js adapter's only job is then to walk `buildPostProcessingChain`'s
 * output and call `composer.addPass` in that order. It cannot get the order
 * wrong without failing a test that needs no GPU to run.
 */

/**
 * Every pass the chain can contain, in canonical order.
 *
 * Declaration order in this array IS the specification. `PASS_ORDER_INDEX`
 * below derives the comparison key from it, so there is no second list to keep
 * in sync.
 */
export const POST_PROCESSING_PASS_ORDER = [
  'render',
  'gtao',
  'godRays',
  'bloom',
  'bokeh',
  'composite',
  'smaa',
  'output',
] as const

export type PostProcessingPass = (typeof POST_PROCESSING_PASS_ORDER)[number]

/** Passes that are always present, whatever the quality preset. */
export const MANDATORY_PASSES: ReadonlySet<PostProcessingPass> = new Set(['render', 'output'])

/**
 * The three passes `composite` subsumes.
 *
 * When the composite shader is active these must be absent: the reference
 * forces their `enabled` flag to false (:70, :82, :100) so that the work is not
 * done twice. Here they are simply not emitted, which is stronger — a disabled
 * pass still allocates its render targets.
 */
export const COMPOSITE_SUBSUMES: ReadonlySet<PostProcessingPass> = new Set([
  'bloom',
  'godRays',
  'bokeh',
])

const PASS_ORDER_INDEX: ReadonlyMap<PostProcessingPass, number> = new Map(
  POST_PROCESSING_PASS_ORDER.map((pass, index) => [pass, index]),
)

/** Position of a pass in the canonical order. Total, because the type is closed. */
export const passOrderIndex = (pass: PostProcessingPass): number => PASS_ORDER_INDEX.get(pass) ?? -1

/**
 * Graphics quality settings that decide which optional passes exist.
 *
 * Field names mirror the reference's resolved preset
 * (`ts-minecraft/packages/game/application/settings-service.config.ts` via
 * `resolvePreset`), so that the preset table ports across unchanged.
 */
export type GraphicsQuality = {
  readonly ssaoEnabled: boolean
  readonly godRaysEnabled: boolean
  readonly bloomEnabled: boolean
  readonly dofEnabled: boolean
  readonly smaaEnabled: boolean
  /**
   * Merge bloom + godRays + bokeh into one full-screen shader.
   *
   * Only meaningful when at least one of the three is enabled — a composite
   * pass that composites nothing is a wasted full-screen read/write.
   */
  readonly useCompositePass: boolean
}

/**
 * The four presets.
 *
 * AUTHORITATIVE SOURCE: the `GRAPHICS_PRESETS` constant in
 * ts-minecraft/packages/game/application/settings-service.config.ts (read by
 * `resolvePreset` at the foot of that file, which is what
 * session-post-processing.ts receives as `initialGraphics`). The values below
 * are transcribed from it field by field.
 *
 * Corroborated by the preset-wiring comment at
 * ts-minecraft/packages/app/application/main/session-post-processing.ts:24-28:
 *
 *   low    -> CompositePass disabled (no effects), individual passes disabled
 *   medium -> CompositePass disabled, individual passes disabled
 *   high   -> CompositePass enabled with { bloom }
 *   ultra  -> CompositePass enabled with { bloom, godRays, bokeh }
 *
 * That comment says which passes are ON, but not which are OFF, so it cannot
 * settle `smaaEnabled` on its own — `GRAPHICS_PRESETS` is the tiebreak. Note in
 * particular that **medium has smaaEnabled: false**. medium is the low-spec
 * balanced default and takes only shadows + sky; SMAA is a full-resolution
 * post pass and is high/ultra only. The tuning philosophy is stated at the top
 * of settings-service.config.ts:
 *
 *   low:    no post-processing, no sky, no shadows (low-spec default, DPR 0.5)
 *   medium: + shadows + sky (balanced, DPR 1.25)
 *   high:   + bloom (HDR), higher DPR, crisper shadows
 *   ultra:  + god rays + dof + max DPR (maximum quality)
 *
 * and, for `useCompositePass` (FR-4.3), that it is
 *
 *   Only enabled on presets that actually use HDR effects (high/ultra) — on
 *   low/medium the CompositePass would have no inputs to composite
 *
 * which is exactly the second conjunct of `isCompositeActive` below.
 *
 * PROVISIONAL: the reference's real preset table also carries render scale,
 * shadow resolution, view distance and composer render-target type. Only the
 * post-FX half is reproduced here, because only the post-FX half has an
 * ordering rule to protect. Two omitted fields are worth recording because they
 * are ordering-adjacent rather than cosmetic:
 *
 *   - `composerRtType` flips from THREE.UnsignedByteType (1009) on low/medium
 *     to THREE.HalfFloatType (1016) on high/ultra, because bloom needs an HDR
 *     render target. A preset that enables bloom without the HDR target would
 *     clip the highlights bloom is supposed to pick up.
 *   - FR-4.3's composite merge is quoted there as saving ~25 MB/frame of
 *     bandwidth, which is the reason the eighth pass exists at all.
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra'

export const QUALITY_PRESETS: Readonly<Record<QualityPreset, GraphicsQuality>> = {
  low: {
    ssaoEnabled: false,
    godRaysEnabled: false,
    bloomEnabled: false,
    dofEnabled: false,
    smaaEnabled: false,
    useCompositePass: false,
  },
  medium: {
    ssaoEnabled: false,
    godRaysEnabled: false,
    bloomEnabled: false,
    dofEnabled: false,
    smaaEnabled: false,
    useCompositePass: false,
  },
  high: {
    ssaoEnabled: true,
    godRaysEnabled: false,
    bloomEnabled: true,
    dofEnabled: false,
    smaaEnabled: true,
    useCompositePass: true,
  },
  ultra: {
    ssaoEnabled: true,
    godRaysEnabled: true,
    bloomEnabled: true,
    dofEnabled: true,
    smaaEnabled: true,
    useCompositePass: true,
  },
}

/**
 * True when the composite shader is worth building.
 *
 * Mirrors the reference's `compositeActive = useCompositePass &&
 * compositeFlagsAnyEnabled(flags)` (:41-43). The second conjunct is what stops
 * a preset that turns everything off from still paying for a full-screen pass.
 */
export const isCompositeActive = (quality: GraphicsQuality): boolean =>
  quality.useCompositePass &&
  (quality.bloomEnabled || quality.godRaysEnabled || quality.dofEnabled)

/**
 * Build the pass chain for a quality setting.
 *
 * Returns passes in canonical order by construction — the function emits them
 * in declaration order rather than sorting afterwards, so the order cannot be
 * lost to an unstable sort or a comparator bug. `assertCanonicalOrder` then
 * checks the result independently, which is the belt to this brace.
 */
export const buildPostProcessingChain = (
  quality: GraphicsQuality,
): ReadonlyArray<PostProcessingPass> => {
  const composite = isCompositeActive(quality)
  const chain: Array<PostProcessingPass> = ['render']

  if (quality.ssaoEnabled) {
    chain.push('gtao')
  }
  // The three subsumed passes are emitted ONLY when the composite shader is
  // not doing their work. The reference builds them and disables them; not
  // building them also saves their render targets (:53-56 documents GTAO
  // costing 30-60 MB of VRAM even while disabled, which is the same lesson).
  if (quality.godRaysEnabled && !composite) {
    chain.push('godRays')
  }
  if (quality.bloomEnabled && !composite) {
    chain.push('bloom')
  }
  if (quality.dofEnabled && !composite) {
    chain.push('bokeh')
  }
  if (composite) {
    chain.push('composite')
  }
  if (quality.smaaEnabled) {
    chain.push('smaa')
  }
  chain.push('output')

  return chain
}

export type ChainViolation = {
  readonly rule: 'out-of-order' | 'missing-mandatory' | 'duplicate' | 'composite-conflict' | 'trailing-pass'
  readonly message: string
}

/**
 * Check a chain against every ordering rule, independently of how it was built.
 *
 * This is the function a THREE.js adapter should call on its own pass list
 * before handing it to `EffectComposer`, and the function
 * `test/post-processing.test.ts` uses to pin the rules. It returns violations
 * rather than throwing so that a caller can log all of them at once.
 */
export const validatePostProcessingChain = (
  chain: ReadonlyArray<PostProcessingPass>,
): ReadonlyArray<ChainViolation> => {
  const violations: Array<ChainViolation> = []

  for (const mandatory of MANDATORY_PASSES) {
    if (!chain.includes(mandatory)) {
      violations.push({
        rule: 'missing-mandatory',
        message: `the chain has no '${mandatory}' pass; it is required whatever the quality preset.`,
      })
    }
  }

  const seen = new Set<PostProcessingPass>()
  for (const pass of chain) {
    if (seen.has(pass)) {
      violations.push({ rule: 'duplicate', message: `'${pass}' appears more than once.` })
    }
    seen.add(pass)
  }

  for (let index = 1; index < chain.length; index += 1) {
    const previous = chain[index - 1]
    const current = chain[index]
    if (previous === undefined || current === undefined) {
      continue
    }
    if (passOrderIndex(previous) >= passOrderIndex(current)) {
      violations.push({
        rule: 'out-of-order',
        message:
          `'${previous}' runs before '${current}', but the canonical order is ` +
          `${POST_PROCESSING_PASS_ORDER.join(' -> ')}.`,
      })
    }
  }

  if (seen.has('composite')) {
    for (const subsumed of COMPOSITE_SUBSUMES) {
      if (seen.has(subsumed)) {
        violations.push({
          rule: 'composite-conflict',
          message:
            `'${subsumed}' is present alongside 'composite', which already performs it. ` +
            'Running both does the work twice and doubles the full-screen bandwidth.',
        })
      }
    }
  }

  // Stated separately from the pairwise order check so the diagnostic names the
  // actual mistake: SMAA anti-aliases the final image, and OutputPass tone-maps
  // it. A pass appended after either undoes what it just did.
  const last = chain[chain.length - 1]
  if (chain.length > 0 && last !== 'output') {
    violations.push({
      rule: 'trailing-pass',
      message: `the chain ends with '${String(last)}'; 'output' must always be last (tone mapping + colour space).`,
    })
  }

  return violations
}

/** True when a chain satisfies every rule. */
export const isCanonicalChain = (chain: ReadonlyArray<PostProcessingPass>): boolean =>
  validatePostProcessingChain(chain).length === 0
