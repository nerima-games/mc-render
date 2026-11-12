import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  startMeshingWorkerPool,
  type MeshingWorkerPoolFactoryOptions,
} from '../src/application/meshing-worker-pool.js'
import type {
  BrowserWorkerErrorEvent,
  BrowserWorkerLike,
  BrowserWorkerMessageEvent,
} from '../src/application/browser-worker-port.js'

type FakeWorker = BrowserWorkerLike<ArrayBuffer> & {
  readonly terminated: () => boolean
}

const makeFakeWorker = (): FakeWorker => {
  let terminated = false
  return {
    addEventListener: (_type: 'message' | 'error', _listener: ((event: BrowserWorkerMessageEvent) => void) | ((event: BrowserWorkerErrorEvent) => void)) => undefined,
    postMessage: () => undefined,
    terminate: () => { terminated = true },
    terminated: () => terminated,
  }
}

describe('startMeshingWorkerPool', () => {
  it.effect('creates exactly the explicit worker count and shuts all workers down', () =>
    Effect.gen(function* () {
      const created: Array<FakeWorker> = []
      const options: MeshingWorkerPoolFactoryOptions = {
        createWorker: () => {
          const worker = makeFakeWorker()
          created.push(worker)
          return worker
        },
        workerCount: 2,
      }
      const pool = yield* startMeshingWorkerPool(options)

      expect(created).toHaveLength(2)
      expect(pool.concurrency).toBe(2)
      yield* pool.shutdown
      expect(created.every((worker) => worker.terminated())).toBe(true)
    }),
  )

  it.effect('returns a typed startup failure and terminates partial construction', () =>
    Effect.gen(function* () {
      const created: Array<FakeWorker> = []
      const outcome = yield* Effect.result(startMeshingWorkerPool({
        createWorker: (workerIndex) => {
          if (workerIndex === 1) {
            throw new Error('worker construction failed')
          }
          const worker = makeFakeWorker()
          created.push(worker)
          return worker
        },
        workerCount: 2,
      }))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toMatchObject({
          _tag: 'MeshingWorkerPoolStartupError',
          reason: 'worker-creation-failed',
          workerIndex: 1,
        })
      }
      expect(created).toHaveLength(1)
      expect(created[0]?.terminated()).toBe(true)
    }),
  )

  it.effect('rejects an invalid count before creating any worker', () =>
    Effect.gen(function* () {
      let createCalls = 0
      const outcome = yield* Effect.result(startMeshingWorkerPool({
        createWorker: () => {
          createCalls += 1
          return makeFakeWorker()
        },
        workerCount: 0,
      }))

      expect(createCalls).toBe(0)
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toStrictEqual({
          _tag: 'WorkerParallelismError',
          reason: 'invalid-worker-count',
        })
      }
    }),
  )
})
