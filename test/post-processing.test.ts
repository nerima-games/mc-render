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
      expect(buildPostProcessingChain(QUALITY_PRESETS.low)).toStrictEqual(['render', 'output'])
    }),
  )

  it.effect('emits every enabled pass in canonical order', () =>
    Effect.sync(() => {
      expect(buildPostProcessingChain(ALL_ON)).toStrictEqual([
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

  it.effect('every quality preset produces a canonical chain', () =>
    Effect.sync(() => {
      for (const [name, quality] of Object.entries(QUALITY_PRESETS)) {
        const chain = buildPostProcessingChain(quality)
        expect(validatePostProcessingChain(chain), `preset ${name}`).toStrictEqual([])
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
        expect(validatePostProcessingChain(chain), `mask ${String(mask)}`).toStrictEqual([])
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

      expect(chain).toContain('composite')
      for (const subsumed of COMPOSITE_SUBSUMES) {
        expect(chain).not.toContain(subsumed)
      }
      expect(chain).toStrictEqual(['render', 'gtao', 'composite', 'smaa', 'output'])
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
