import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  HardwareConcurrencySchema,
  WorkerFailureMessageSchema,
  WorkerIndexSchema,
  WorkerQueueCapacitySchema,
  WorkerCountSchema,
  WorkerParallelismInputSchema,
  resolveWorkerParallelism,
  makeHardwareConcurrency,
  makeWorkerCount,
  WorkerParallelismErrorSchema,
} from '../src/domain/worker-parallelism.js'

const decodeFailure = Schema.decodeUnknownResult(WorkerParallelismErrorSchema, { onExcessProperty: 'error' })
const decodeWorkerCount = Schema.decodeUnknownSync(WorkerCountSchema)
const decodeHardwareConcurrency = Schema.decodeUnknownSync(HardwareConcurrencySchema)
const resolveWorkerParallelismWithUnknownInput = (
  input: unknown,
): ReturnType<typeof resolveWorkerParallelism> =>
  Function.prototype.apply.call(resolveWorkerParallelism, undefined, [input])

describe('resolveWorkerParallelism', () => {
  it.effect('uses a valid explicit count even when hardware reports another value', () =>
    Effect.sync(() => {
      expect(resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(8), workerCount: decodeWorkerCount(3) }))
        .toStrictEqual(Result.succeed(decodeWorkerCount(3)))
      expect(resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(1) }))
        .toStrictEqual(Result.succeed(decodeWorkerCount(1)))
      expect(resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(2) }))
        .toStrictEqual(Result.succeed(decodeWorkerCount(1)))
      expect(resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(3) }))
        .toStrictEqual(Result.succeed(decodeWorkerCount(2)))
    }),
  )

  it.effect('preserves the explicit count for every positive safe integer', () =>
    Effect.sync(() => FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 1, max: 1_000_000 }), (workerCount) => {
        const result = resolveWorkerParallelism({
          hardwareConcurrency: decodeHardwareConcurrency(99),
          workerCount: decodeWorkerCount(workerCount),
        })
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success).toBe(workerCount)
          expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerCountSchema)(result.success))).toBe(true)
        }
      }),
    )),
  )

  it.effect('leaves one logical CPU available for every valid hardware count', () =>
    Effect.sync(() => FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 1, max: 1_000_000 }), (hardwareConcurrency) => {
        const result = resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(hardwareConcurrency) })
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success).toBe(Math.max(1, hardwareConcurrency - 1))
          expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerCountSchema)(result.success))).toBe(true)
        }
      }),
    )),
  )

  it.effect('keeps the derived count safe at the largest valid hardware boundary', () =>
    Effect.sync(() => {
      const result = resolveWorkerParallelism({ hardwareConcurrency: decodeHardwareConcurrency(Number.MAX_SAFE_INTEGER) })

      expect(result).toStrictEqual(Result.succeed(decodeWorkerCount(Number.MAX_SAFE_INTEGER - 1)))
      expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerCountSchema)(Number.MAX_SAFE_INTEGER - 1))).toBe(true)
    }),
  )

  it.effect('returns a typed failure when a runtime caller supplies invalid hardware concurrency', () =>
    Effect.sync(() => {
      const result = resolveWorkerParallelismWithUnknownInput({ hardwareConcurrency: 0 })

      expect(result).toStrictEqual(Result.fail({
        _tag: 'WorkerParallelismError',
        reason: 'invalid-hardware-concurrency',
      }))
      if (Result.isFailure(result)) {
        expect(Result.isSuccess(decodeFailure(result.failure))).toBe(true)
      }
    }),
  )

  it.effect('returns schema-decodable typed failures for invalid or missing inputs', () =>
    Effect.sync(() => {
      const invalidCountConstructors = [makeWorkerCount(0), makeWorkerCount(1.5)]
      for (const result of invalidCountConstructors) {
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorkerParallelismError', reason: 'invalid-worker-count' })
          expect(Result.isSuccess(decodeFailure(result.failure))).toBe(true)
        }
      }

      const invalidHardwareConstructors = [makeHardwareConcurrency(0), makeHardwareConcurrency(Number.NaN)]
      for (const result of invalidHardwareConstructors) {
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorkerParallelismError', reason: 'invalid-hardware-concurrency' })
          expect(Result.isSuccess(decodeFailure(result.failure))).toBe(true)
        }
      }

      const malformedInput = Schema.decodeUnknownResult(WorkerParallelismInputSchema)({
        hardwareConcurrency: 0,
      })
      expect(Result.isFailure(malformedInput)).toBe(true)

      const missingInput = resolveWorkerParallelism({})
      expect(Result.isFailure(missingInput)).toBe(true)
      if (Result.isFailure(missingInput)) {
        expect(missingInput.failure.reason).toBe('missing-hardware-concurrency')
        expect(Result.isSuccess(decodeFailure(missingInput.failure))).toBe(true)
      }
    }),
  )

  it.effect('constructs queue capacities and worker indices at their boundaries', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerQueueCapacitySchema)(1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(WorkerQueueCapacitySchema)(0))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerIndexSchema)(0))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(WorkerIndexSchema)(-1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(WorkerFailureMessageSchema)(1))).toBe(true)

      FastCheck.assert(FastCheck.property(FastCheck.integer({ min: 1, max: 1_000_000 }), (capacity) => {
        const decoded = Schema.decodeUnknownResult(WorkerQueueCapacitySchema)(capacity)
        return Result.isSuccess(decoded) && decoded.success === capacity
      }))
      FastCheck.assert(FastCheck.property(FastCheck.nat({ max: 1_000_000 }), (workerIndex) => {
        const decoded = Schema.decodeUnknownResult(WorkerIndexSchema)(workerIndex)
        return Result.isSuccess(decoded) && decoded.success === workerIndex
      }))
      FastCheck.assert(FastCheck.property(FastCheck.string(), (message) => {
        const decoded = Schema.decodeUnknownResult(WorkerFailureMessageSchema)(message)
        return Result.isSuccess(decoded) && decoded.success === message
      }))
    }),
  )
})
