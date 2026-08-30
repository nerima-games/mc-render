import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  assertRendererMaterialPolicies,
  findRendererMaterialPolicyViolations,
} from '../src/application/world-renderer-materials'
import type { ThreeMaterial } from '../src/application/three-surface'

const makeMaterial = (forceSinglePass?: boolean): ThreeMaterial => {
  if (forceSinglePass === undefined) {
    return { dispose: () => undefined }
  }
  return { dispose: () => undefined, forceSinglePass }
}

describe('renderer material policy assertions', () => {
  it.effect('accepts the production water and particle flags', () =>
    Effect.sync(() => {
      expect(findRendererMaterialPolicyViolations(makeMaterial(true), makeMaterial(true))).toStrictEqual([])
    }),
  )

  it.effect('reports every required flag that is missing', () =>
    Effect.sync(() => {
      const findings = findRendererMaterialPolicyViolations(makeMaterial(false), makeMaterial())

      expect(findings.map(({ materialName }) => materialName)).toStrictEqual([
        'waterSurfaceMaterial',
        'particleMaterial',
      ])
      expect(findings.every(({ verdict }) => verdict.kind === 'must-force-single-pass')).toBe(true)
    }),
  )

  it.effect('fails loudly when a required flag is missing', () =>
    Effect.sync(() => {
      expect(() => assertRendererMaterialPolicies(makeMaterial(false), makeMaterial(true))).toThrow(
        /waterSurfaceMaterial/,
      )
    }),
  )
})
