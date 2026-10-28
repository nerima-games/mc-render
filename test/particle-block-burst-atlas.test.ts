import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { vi } from 'vitest'

vi.mock('../src/domain/texture-atlas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/texture-atlas')>()
  return { ...actual, tileUvOrigin: () => ({ u: 1, v: 0 }) }
})

import {
  makeParticlePool,
  ParticleBurstCountSchema,
  ParticlePoolInputErrorSchema,
  ParticleTileIndexSchema,
  ParticleWorldCoordinateSchema,
  spawnBlockBurst,
} from '../src/domain/particle-pool'

describe('block burst atlas boundary', () => {
  it.effect('returns a typed failure when a valid tile resolves to an unsafe UV origin', () =>
    Effect.sync(() => {
      const poolResult = makeParticlePool({ capacity: 1 })
      expect(Result.isSuccess(poolResult)).toBe(true)
      if (Result.isFailure(poolResult)) {
        return
      }
      const position = Schema.decodeUnknownSync(ParticleWorldCoordinateSchema)(0)
      const tileIndex = Schema.decodeUnknownSync(ParticleTileIndexSchema)(0)
      const count = Schema.decodeUnknownSync(ParticleBurstCountSchema)(1)
      const result = spawnBlockBurst(poolResult.success, position, position, position, tileIndex, count)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        const decoded = Schema.decodeUnknownResult(ParticlePoolInputErrorSchema, { onExcessProperty: 'error' })(
          result.failure,
        )
        expect(Result.isSuccess(decoded)).toBe(true)
        if (Result.isSuccess(decoded)) {
          expect(decoded.success).toStrictEqual({
            _tag: 'ParticlePoolInputError',
            operation: 'block-burst',
            reason: 'invalid-uv',
          })
        }
      }
    }),
  )
})
