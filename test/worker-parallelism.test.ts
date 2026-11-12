import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  resolveWorkerParallelism,
  WorkerParallelismErrorSchema,
} from '../src/domain/worker-parallelism.js'

const decodeFailure = Schema.decodeUnknownResult(WorkerParallelismErrorSchema, { onExcessProperty: 'error' })

describe('resolveWorkerParallelism', () => {
  it.effect('uses a valid explicit count even when hardware reports another value', () =>
    Effect.sync(() => {
      expect(resolveWorkerParallelism({ hardwareConcurrency: 8, workerCount: 3 })).toStrictEqual(Result.succeed(3))
      expect(resolveWorkerParallelism({ hardwareConcurrency: 1 })).toStrictEqual(Result.succeed(1))
      expect(resolveWorkerParallelism({ hardwareConcurrency: 2 })).toStrictEqual(Result.succeed(1))
      expect(resolveWorkerParallelism({ hardwareConcurrency: 3 })).toStrictEqual(Result.succeed(2))
    }),
  )

  it.effect('preserves the explicit count for every positive safe integer', () =>
    Effect.sync(() => FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 1, max: 1_000_000 }), (workerCount) => {
        const result = resolveWorkerParallelism({ hardwareConcurrency: 99, workerCount })
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success).toBe(workerCount)
        }
      }),
    )),
  )

  it.effect('leaves one logical CPU available for every valid hardware count', () =>
    Effect.sync(() => FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 1, max: 1_000_000 }), (hardwareConcurrency) => {
        const result = resolveWorkerParallelism({ hardwareConcurrency })
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success).toBe(Math.max(1, hardwareConcurrency - 1))
        }
      }),
    )),
  )

  it.effect('returns schema-decodable typed failures for invalid or missing inputs', () =>
    Effect.sync(() => {
      const invalidInputs = [
        [{ workerCount: 0 }, 'invalid-worker-count'],
        [{ workerCount: 1.5 }, 'invalid-worker-count'],
        [{ hardwareConcurrency: 0 }, 'invalid-hardware-concurrency'],
        [{ hardwareConcurrency: Number.NaN }, 'invalid-hardware-concurrency'],
        [{}, 'missing-hardware-concurrency'],
      ] as const

      for (const [input, reason] of invalidInputs) {
        const result = resolveWorkerParallelism(input)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorkerParallelismError', reason })
          expect(Result.isSuccess(decodeFailure(result.failure))).toBe(true)
        }
      }
    }),
  )
})
