/**
 * REGRESSION: shared transparent + DoubleSide materials need `forceSinglePass`.
 *
 * plan.md §3.9 — the cause of the idle stutter, p95 frame time 33ms -> 9.2ms.
 * The reference's own diagnosis is at
 * ts-minecraft/packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:145-150
 * (~15k `getParameters` calls per 3 seconds at idle).
 *
 * The three materials it applies to, in the reference:
 *   chunk-mesh-materials.ts:164            shared glass/leaves chunk material
 *   post-processing/water-material.ts:137  shared water surface
 *   particles/particle-system.ts:60        pooled particle material
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  auditMaterials,
  describeMaterialPolicy,
  isCutout,
  requiresForceSinglePass,
  takesTwoPassPath,
  type MaterialSpec,
} from '../domain/material-policy'

/** ts-minecraft/packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:156-164. */
const GLASS_LEAVES: MaterialSpec = {
  name: 'transparentSolidMaterial',
  transparent: true,
  side: 'double',
  alphaTest: 0.1,
  shared: true,
}

/** ts-minecraft/packages/rendering/infrastructure/particles/particle-system.ts:54-60. */
const PARTICLES: MaterialSpec = {
  name: 'particleMaterial',
  transparent: true,
  side: 'double',
  alphaTest: 0.5,
  shared: true,
}

/** The opaque chunk material: no transparency, so never on the two-pass path. */
const OPAQUE_CHUNK: MaterialSpec = {
  name: 'opaqueMaterial',
  transparent: false,
  side: 'front',
  alphaTest: 0,
  shared: true,
}

describe('takesTwoPassPath', () => {
  it.effect('needs BOTH transparent and DoubleSide — either alone is fine', () =>
    Effect.sync(() => {
      expect(takesTwoPassPath(GLASS_LEAVES)).toBe(true)
      expect(takesTwoPassPath({ ...GLASS_LEAVES, side: 'front' })).toBe(false)
      expect(takesTwoPassPath({ ...GLASS_LEAVES, transparent: false })).toBe(false)
      expect(takesTwoPassPath(OPAQUE_CHUNK)).toBe(false)
    }),
  )
})

describe('requiresForceSinglePass', () => {
  it.effect('REGRESSION: the glass/leaves chunk material requires it', () =>
    Effect.sync(() => {
      expect(requiresForceSinglePass(GLASS_LEAVES)).toBe(true)
      expect(describeMaterialPolicy(GLASS_LEAVES).kind).toBe('must-force-single-pass')
    }),
  )

  it.effect('REGRESSION: the pooled particle material requires it', () =>
    Effect.sync(() => {
      expect(requiresForceSinglePass(PARTICLES)).toBe(true)
    }),
  )

  it.effect('a PER-MESH two-pass material does not: its version bump costs one program', () =>
    Effect.sync(() => {
      // Sharing is the multiplier. One mesh bumping its own material's version
      // re-resolves one shader program; a material shared by every glass chunk
      // re-resolves all of them, every frame.
      expect(requiresForceSinglePass({ ...GLASS_LEAVES, shared: false })).toBe(false)
      expect(describeMaterialPolicy({ ...GLASS_LEAVES, shared: false }).kind).toBe('ok')
    }),
  )

  it.effect('a FrontSide material does not: it never takes the two-pass path', () =>
    Effect.sync(() => {
      expect(requiresForceSinglePass({ ...GLASS_LEAVES, side: 'front' })).toBe(false)
    }),
  )

  it.effect('an opaque material does not', () =>
    Effect.sync(() => {
      expect(requiresForceSinglePass(OPAQUE_CHUNK)).toBe(false)
    }),
  )
})

describe('genuine translucency is NOT forced single-pass', () => {
  it.effect('REGRESSION: alphaTest 0 means the two-pass ordering is doing real work', () =>
    Effect.sync(() => {
      // Forcing single pass here would visibly break back-then-front ordering:
      // the inside faces of a translucent object would draw over the outside.
      // The verdict is 'review-sharing', not 'ok' and not 'must-force'.
      const stainedGlass: MaterialSpec = {
        name: 'stainedGlassMaterial',
        transparent: true,
        side: 'double',
        alphaTest: 0,
        shared: true,
      }

      expect(isCutout(stainedGlass)).toBe(false)
      expect(requiresForceSinglePass(stainedGlass)).toBe(false)

      const verdict = describeMaterialPolicy(stainedGlass)
      expect(verdict.kind).toBe('review-sharing')
      expect(verdict.reason).toContain('genuinely translucent')
    }),
  )
})

describe('auditMaterials', () => {
  it.effect('reports only the materials that need attention', () =>
    Effect.sync(() => {
      const findings = auditMaterials([OPAQUE_CHUNK, GLASS_LEAVES, PARTICLES])

      expect(findings).toHaveLength(2)
      expect(findings.map((finding) => finding.material.name).sort()).toStrictEqual([
        'particleMaterial',
        'transparentSolidMaterial',
      ])
      expect(findings.every((finding) => finding.verdict.kind === 'must-force-single-pass')).toBe(true)
    }),
  )

  it.effect('an all-clear audit is empty, so a startup assertion can be `length === 0`', () =>
    Effect.sync(() => {
      expect(auditMaterials([OPAQUE_CHUNK, { ...GLASS_LEAVES, shared: false }])).toStrictEqual([])
    }),
  )

  it.effect('the diagnostic names the measurement, not just the rule', () =>
    Effect.sync(() => {
      // A developer who hits this needs to know it is a real, measured stutter,
      // not a style preference — otherwise the next person "simplifies" it away.
      const verdict = describeMaterialPolicy(GLASS_LEAVES)

      expect(verdict.reason).toContain('33ms -> 9.2ms')
      expect(verdict.reason).toContain('forceSinglePass: true')
    }),
  )
})
