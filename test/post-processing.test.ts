/**
 * REGRESSION: the post-processing chain order is fixed.
 *
 *   RenderPass -> GTAO -> GodRays -> Bloom -> Bokeh(DoF) -> [Composite] -> SMAA -> Output
 *
 * plan.md §3.9, verified against
 * ts-minecraft/packages/app/application/main/session-post-processing.ts by
 * `comp.addPass` call order (:51, :63, :76, :94, :110, :127, :137, :142).
 *
 * NO WEBGL IS INVOLVED. The chain is data and the ordering rule is a pure
 * function, so this whole file runs under `environment: 'node'` in
 * milliseconds. That is the point of representing the chain as data: an
 * ordering bug that would otherwise only be visible as "the god rays stopped
 * glowing" on somebody's ultra-preset machine is a unit test failure here.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  buildPostProcessingChain,
  chainEffects,
  chainPasses,
  COMPOSITE_SUBSUMES,
  isCanonicalChain,
  isCompositeActive,
  MANDATORY_PASSES,
  passOrderIndex,
  POST_PROCESSING_PASS_ORDER,
  QUALITY_PRESETS,
  validatePostProcessingChain,
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
} from '../domain/post-processing'

const ALL_ON: GraphicsQuality = {
  ssaoEnabled: true,
  godRaysEnabled: true,
  bloomEnabled: true,
  dofEnabled: true,
  smaaEnabled: true,
  useCompositePass: false,
}

describe('the canonical order', () => {
  it.effect('is exactly the reference implementation addPass sequence', () =>
    Effect.sync(() => {
      expect(POST_PROCESSING_PASS_ORDER).toStrictEqual([
        'render',
        'gtao',
        'godRays',
        'bloom',
        'bokeh',
        'composite',
        'smaa',
        'output',
      ])
    }),
  )

  it.effect('render is first and output is last, unconditionally', () =>
    Effect.sync(() => {
      expect(passOrderIndex('render')).toBe(0)
      expect(passOrderIndex('output')).toBe(POST_PROCESSING_PASS_ORDER.length - 1)
      expect([...MANDATORY_PASSES].sort()).toStrictEqual(['output', 'render'])
    }),
  )

  it.effect('GodRays runs BEFORE Bloom, so its streaks get picked up by the glow', () =>
    Effect.sync(() => {
      expect(passOrderIndex('godRays')).toBeLessThan(passOrderIndex('bloom'))
    }),
  )

  it.effect('Bokeh runs AFTER Bloom, so depth of field blurs the glow rather than the reverse', () =>
    Effect.sync(() => {
      expect(passOrderIndex('bloom')).toBeLessThan(passOrderIndex('bokeh'))
    }),
  )

  it.effect('GTAO runs before every colour effect, while depth and normals are still raw', () =>
    Effect.sync(() => {
      for (const later of ['godRays', 'bloom', 'bokeh', 'composite', 'smaa', 'output'] as const) {
        expect(passOrderIndex('gtao')).toBeLessThan(passOrderIndex(later))
      }
    }),
  )

  it.effect('SMAA is second to last: it must anti-alias the FINAL composited image', () =>
    Effect.sync(() => {
      // ts-minecraft/.../session-post-processing.ts:115-117 — CompositePass is
      // "Inserted AFTER the individual passes ... and BEFORE SMAA so
      // anti-aliasing operates on the final composited image."
      expect(passOrderIndex('composite')).toBeLessThan(passOrderIndex('smaa'))
      expect(passOrderIndex('smaa')).toBe(passOrderIndex('output') - 1)
    }),
  )
})

describe('buildPostProcessingChain', () => {
  it.effect('the minimum chain is render then output', () =>
    Effect.sync(() => {
      expect(chainPasses(buildPostProcessingChain(QUALITY_PRESETS.low))).toStrictEqual([
        'render',
        'output',
      ])
    }),
  )

  it.effect('emits every enabled pass in canonical order', () =>
    Effect.sync(() => {
      expect(chainPasses(buildPostProcessingChain(ALL_ON))).toStrictEqual([
        'render',
        'gtao',
        'godRays',
        'bloom',
        'bokeh',
        'smaa',
        'output',
      ])
      // An ordinary pass performs itself and nothing else, so an adapter never
      // has to special-case reading `effects`.
      expect(buildPostProcessingChain(ALL_ON).map((entry) => entry.effects)).toStrictEqual([
        ['render'],
        ['gtao'],
        ['godRays'],
        ['bloom'],
        ['bokeh'],
        ['smaa'],
        ['output'],
      ])
    }),
  )

  it.effect('every quality preset produces a canonical chain', () =>
    Effect.sync(() => {
      for (const [name, quality] of Object.entries(QUALITY_PRESETS)) {
        const chain = buildPostProcessingChain(quality)
        expect(validatePostProcessingChain(chainPasses(chain)), `preset ${name}`).toStrictEqual([])
      }
    }),
  )

  it.effect('every one of the 64 on/off combinations produces a canonical chain', () =>
    Effect.sync(() => {
      // Exhaustive rather than sampled: there are only six booleans, and an
      // ordering bug that appears for exactly one combination is precisely the
      // kind that reaches a player before it reaches a developer.
      const flags = ['ssaoEnabled', 'godRaysEnabled', 'bloomEnabled', 'dofEnabled', 'smaaEnabled', 'useCompositePass'] as const
      for (let mask = 0; mask < 1 << flags.length; mask += 1) {
        const quality = Object.fromEntries(
          flags.map((flag, index) => [flag, (mask & (1 << index)) !== 0]),
        ) as unknown as GraphicsQuality
        const chain = buildPostProcessingChain(quality)
        expect(
          validatePostProcessingChain(chainPasses(chain)),
          `mask ${String(mask)}`,
        ).toStrictEqual([])
        // Whatever the flags, the chain never claims to draw an effect twice
        // and never claims to draw one the preset turned off.
        const effects = chainEffects(chain)
        expect(new Set(effects).size, `mask ${String(mask)}`).toBe(effects.length)
      }
    }),
  )
})

describe('CompositePass', () => {
  it.effect('is only active when it actually has something to composite', () =>
    Effect.sync(() => {
      // ts-minecraft/.../session-post-processing.ts:41-43 —
      // compositeActive = useCompositePass && compositeFlagsAnyEnabled(flags).
      // A composite pass that composites nothing is a wasted full-screen
      // read/write.
      expect(isCompositeActive({ ...QUALITY_PRESETS.low, useCompositePass: true })).toBe(false)
      expect(isCompositeActive(QUALITY_PRESETS.ultra)).toBe(true)
      expect(isCompositeActive({ ...ALL_ON, useCompositePass: false })).toBe(false)
    }),
  )

  it.effect('REGRESSION: replaces bloom, godRays and bokeh — never runs alongside them', () =>
    Effect.sync(() => {
      const chain = buildPostProcessingChain(QUALITY_PRESETS.ultra)

      const passes = chainPasses(chain)
      expect(passes).toContain('composite')
      for (const subsumed of COMPOSITE_SUBSUMES) {
        expect(passes).not.toContain(subsumed)
      }
      expect(passes).toStrictEqual(['render', 'gtao', 'composite', 'smaa', 'output'])
      // ...and the work is not lost with them: the composite step SAYS it does
      // all three, which is what `chainEffects` reads.
      expect(chainEffects(chain)).toStrictEqual([
        'render',
        'gtao',
        'godRays',
        'bloom',
        'bokeh',
        'smaa',
        'output',
      ])
    }),
  )

  it.effect('REGRESSION: `high` and `ultra` are DIFFERENT chains, and the composite step is why', () =>
    Effect.sync(() => {
      // The preset table promises the ultra player god rays and depth of field
      // (`ultra: + god rays + dof + max DPR`), and the reference states the
      // difference exactly: `high -> CompositePass enabled with { bloom }`,
      // `ultra -> CompositePass enabled with { bloom, godRays, bokeh }`.
      //
      // Both presets enable SSAO, SMAA and the composite pass, so their PASS
      // ORDER is identical — and while a chain was a bare list of pass names,
      // that made the two chains equal values. An adapter doing what
      // domain/post-processing.ts calls its "only job" (walk the output, call
      // addPass in that order) built the same composer for both, and the ultra
      // player got neither effect. A test asserting the chain per preset agreed
      // with the code, because there was nothing left in the value to disagree
      // about.
      const high = buildPostProcessingChain(QUALITY_PRESETS.high)
      const ultra = buildPostProcessingChain(QUALITY_PRESETS.ultra)

      // The order really is the same. That is not the bug.
      expect(chainPasses(high)).toStrictEqual(chainPasses(ultra))
      // The chains are not.
      expect(high).not.toStrictEqual(ultra)

      const compositeEffects = (chain: ReadonlyArray<PostProcessingStep>) =>
        chain.find((entry) => entry.pass === 'composite')?.effects

      expect(compositeEffects(high)).toStrictEqual(['bloom'])
      expect(compositeEffects(ultra)).toStrictEqual(['godRays', 'bloom', 'bokeh'])

      // Which is what an adapter reads, and what the player sees.
      expect(chainEffects(high)).not.toContain('godRays')
      expect(chainEffects(high)).not.toContain('bokeh')
      expect(chainEffects(ultra)).toContain('godRays')
      expect(chainEffects(ultra)).toContain('bokeh')
    }),
  )

  it.effect('a composite step never claims an effect its preset turned off', () =>
    Effect.sync(() => {
      // `isCompositeActive` guarantees the list is non-empty; this is the other
      // half — it is built from the SAME flags the individual passes were
      // tested against, so it cannot drift into promising work nobody asked
      // for.
      const godRaysOnly = buildPostProcessingChain({
        ...QUALITY_PRESETS.low,
        godRaysEnabled: true,
        useCompositePass: true,
      })

      expect(godRaysOnly.find((entry) => entry.pass === 'composite')?.effects).toStrictEqual([
        'godRays',
      ])
      expect(chainEffects(godRaysOnly)).toStrictEqual(['render', 'godRays', 'output'])
    }),
  )

  it.effect('a chain with both composite and bloom is rejected as doing the work twice', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain([
        'render',
        'bloom',
        'composite',
        'smaa',
        'output',
      ])

      expect(violations.map((violation) => violation.rule)).toContain('composite-conflict')
    }),
  )
})

describe('validatePostProcessingChain', () => {
  it.effect('REGRESSION: rejects SMAA before Bloom — aliasing would return after the blur', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain(['render', 'smaa', 'bloom', 'output'])

      expect(violations.some((violation) => violation.rule === 'out-of-order')).toBe(true)
      expect(violations[0]?.message).toContain('smaa')
    }),
  )

  it.effect('REGRESSION: rejects Bokeh before Bloom — blur-then-glow re-sharpens the blur', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain(['render', 'bokeh', 'bloom', 'output'])

      expect(violations.some((violation) => violation.rule === 'out-of-order')).toBe(true)
    }),
  )

  it.effect('REGRESSION: rejects anything after output — it tone-maps and converts colour space', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain(['render', 'output', 'smaa'])
      const rules = violations.map((violation) => violation.rule)

      expect(rules).toContain('out-of-order')
      expect(rules).toContain('trailing-pass')
    }),
  )

  it.effect('rejects a chain with no render pass, and one with no output pass', () =>
    Effect.sync(() => {
      expect(
        validatePostProcessingChain(['bloom', 'output']).some(
          (violation) => violation.rule === 'missing-mandatory',
        ),
      ).toBe(true)
      expect(
        validatePostProcessingChain(['render', 'bloom']).some(
          (violation) => violation.rule === 'missing-mandatory',
        ),
      ).toBe(true)
    }),
  )

  it.effect('rejects a duplicated pass', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain(['render', 'bloom', 'bloom', 'output'])

      expect(violations.some((violation) => violation.rule === 'duplicate')).toBe(true)
    }),
  )

  it.effect('accepts every prefix-closed canonical subsequence', () =>
    Effect.sync(() => {
      // Any subset of the optional passes, kept in order and wrapped in
      // render/output, must be legal — otherwise a future quality preset would
      // be unable to express itself.
      const optional: ReadonlyArray<PostProcessingPass> = ['gtao', 'godRays', 'bloom', 'bokeh', 'smaa']
      for (let mask = 0; mask < 1 << optional.length; mask += 1) {
        const middle = optional.filter((_, index) => (mask & (1 << index)) !== 0)
        expect(isCanonicalChain(['render', ...middle, 'output']), `mask ${String(mask)}`).toBe(true)
      }
    }),
  )

  it.effect('an empty chain reports its missing mandatory passes and nothing else', () =>
    Effect.sync(() => {
      const violations = validatePostProcessingChain([])

      expect(violations).toHaveLength(2)
      expect(violations.every((violation) => violation.rule === 'missing-mandatory')).toBe(true)
    }),
  )
})
