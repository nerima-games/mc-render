import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import {
  assertRendererMaterialPolicies,
  findRendererMaterialPolicyViolations,
  makeTranslucentChunkMaterial,
  RendererMaterialPolicyResultSchema,
} from '../src/application/world-renderer-materials'
import type { ThreeMaterial } from '../src/application/three-surface'
import { makeFakeThree } from './support/fake-three'

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
      const result = assertRendererMaterialPolicies(makeMaterial(true), makeMaterial(true))
      expect(Result.isSuccess(result)).toBe(true)
      expect(
        Schema.decodeUnknownSync(RendererMaterialPolicyResultSchema, { onExcessProperty: 'error' })(result),
      ).toStrictEqual({ _tag: 'Success', _op: 'Success', success: undefined })
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

  it.effect('returns a typed failure when a required flag is missing', () =>
    Effect.sync(() => {
      const result = assertRendererMaterialPolicies(makeMaterial(false), makeMaterial(true))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        const decoded = Schema.decodeUnknownSync(RendererMaterialPolicyResultSchema, {
          onExcessProperty: 'error',
        })(result)
        expect(decoded._tag).toBe('Failure')
        if (decoded._tag === 'Failure') {
          expect(decoded.failure.violations.map(({ materialName }) => materialName)).toStrictEqual([
            'waterSurfaceMaterial',
          ])
          expect(decoded.failure.violations.every(({ verdict }) => verdict.kind === 'must-force-single-pass')).toBe(true)
        }
      }
    }),
  )
})

describe('translucent chunk material environment', () => {
  it.effect('uses a supplied valid sun intensity', () =>
    Effect.sync(() => {
      const result = makeTranslucentChunkMaterial({
        atlasTexture: {},
        sunIntensity: 0.25,
        three: makeFakeThree(),
        viewport: { height: 64, width: 64 },
      })

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.success.uniforms['uSunIntensity']?.value).toBe(0.25)
      }
    }),
  )
})
