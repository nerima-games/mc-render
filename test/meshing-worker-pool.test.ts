import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Result, Schema } from 'effect'
import { CHUNK_HEIGHT, type ChunkView } from '@nerima-games/mc-meshing'
import { emptyBlocks } from '@nerima-games/mc-worldgen/testing'
import {
  MeshingWorkerPoolStartupError,
  MeshingWorkerPoolFactoryOptionsSchema,
  startMeshingWorkerPool,
  type MeshingWorkerPoolFactoryOptions,
} from '../src/application/meshing-worker-pool.js'
import {
  WorkerCountSchema,
  WorkerQueueCapacitySchema,
  WorkerParallelismErrorSchema,
} from '../src/domain/worker-parallelism.js'
import { chunkCoord } from './support/kernel-brands'
import { KERNEL_MESH_CONFIG } from '../src/application/chunk-store-mesher.js'
import type {
  BrowserWorkerErrorEvent,
  BrowserWorkerLike,
  BrowserWorkerMessageEvent,
} from '../src/application/browser-worker-port.js'

type FakeWorker = BrowserWorkerLike<ArrayBuffer> & {
  readonly posts: () => ReadonlyArray<Readonly<{ message: unknown; transfer: ReadonlyArray<ArrayBuffer> }>>
  readonly terminated: () => boolean
}

const makeFakeWorker = (): FakeWorker => {
  let terminated = false
  const posts: Array<Readonly<{ message: unknown; transfer: ReadonlyArray<ArrayBuffer> }>> = []
  return {
    addEventListener: (_type: 'message' | 'error', _listener: ((event: BrowserWorkerMessageEvent) => void) | ((event: BrowserWorkerErrorEvent) => void)) => undefined,
    postMessage: (message: unknown, transfer?: Array<ArrayBuffer>) => {
      posts.push({ message, transfer: transfer ?? [] })
    },
    posts: () => posts,
    terminate: () => { terminated = true },
    terminated: () => terminated,
  }
}

const workerCount = Schema.decodeUnknownSync(WorkerCountSchema)
const queueCapacity = Schema.decodeUnknownSync(WorkerQueueCapacitySchema)

const startMeshingWorkerPoolWithUnknownOptions = (
  options: unknown,
): ReturnType<typeof startMeshingWorkerPool> =>
  Function.prototype.apply.call(startMeshingWorkerPool, undefined, [options])

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
        maxQueued: queueCapacity(3),
        workerCount: workerCount(2),
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
        workerCount: workerCount(2),
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

  it.effect('rejects an invalid count at the options boundary before worker creation', () =>
    Effect.sync(() => {
      expect(Result.isFailure(Schema.decodeUnknownResult(MeshingWorkerPoolFactoryOptionsSchema)({ workerCount: 0 })))
        .toBe(true)
    }),
  )

  it.effect('returns the parallelism failure for a runtime-invalid count before worker creation', () =>
    Effect.gen(function* () {
      let createdWorkers = 0
      const outcome = yield* Effect.result(startMeshingWorkerPoolWithUnknownOptions({
        createWorker: () => {
          createdWorkers += 1
          return makeFakeWorker()
        },
        workerCount: 0,
      }))

      expect(outcome).toStrictEqual(Result.fail({
        _tag: 'WorkerParallelismError',
        reason: 'invalid-worker-count',
      }))
      if (Result.isFailure(outcome)) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerParallelismErrorSchema)(outcome.failure))).toBe(true)
      }
      expect(createdWorkers).toBe(0)
    }),
  )

  it.effect('returns a typed startup failure when an accepted count exceeds the JavaScript array limit', () =>
    Effect.gen(function* () {
      let createdWorkers = 0
      const outcome = yield* Effect.result(startMeshingWorkerPool({
        createWorker: () => {
          createdWorkers += 1
          return makeFakeWorker()
        },
        workerCount: workerCount(4_294_967_296),
      }))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toBeInstanceOf(MeshingWorkerPoolStartupError)
        expect(outcome.failure).toMatchObject({
          _tag: 'MeshingWorkerPoolStartupError',
          reason: 'worker-creation-failed',
        })
        if (outcome.failure instanceof MeshingWorkerPoolStartupError) {
          expect(outcome.failure.cause).toBeInstanceOf(RangeError)
        }
      }
      expect(createdWorkers).toBe(0)
    }),
  )

  it.effect('returns a typed startup failure for an invalid queue bound before worker creation', () =>
    Effect.gen(function* () {
      const created: Array<FakeWorker> = []
      const outcome = yield* Effect.result(startMeshingWorkerPoolWithUnknownOptions({
          createWorker: () => {
            const worker = makeFakeWorker()
            created.push(worker)
            return worker
          },
          maxQueued: 0,
          workerCount: workerCount(1),
      }))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toMatchObject({
          _tag: 'MeshingWorkerPoolStartupError',
          reason: 'invalid-max-queued',
        })
      }
      expect(created).toHaveLength(0)
    }),
  )

  it.effect('returns a typed startup failure for a null queue bound before worker creation', () =>
    Effect.gen(function* () {
      let createdWorkers = 0
      const outcome = yield* Effect.result(startMeshingWorkerPoolWithUnknownOptions({
        createWorker: () => {
          createdWorkers += 1
          return makeFakeWorker()
        },
        maxQueued: null,
        workerCount: workerCount(1),
      }))

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toMatchObject({
          _tag: 'MeshingWorkerPoolStartupError',
          reason: 'invalid-max-queued',
        })
      }
      expect(createdWorkers).toBe(0)
    }),
  )

  it.effect('transfers each distinct chunk-sidecar buffer once, including loaded neighbours', () =>
    Effect.gen(function* () {
      const blocks = new Uint16Array(emptyBlocks())
      const fluid = {
        falling: new Uint8Array(1),
        levels: new Uint8Array(1),
        sources: new Uint8Array(1),
      }
      const railShapes = new Uint8Array(1)
      const light = { blockLight: new Uint8Array(1), skyLight: new Uint8Array(1) }
      const chunk: ChunkView = {
        blocks,
        coord: chunkCoord(0, 0),
        fluid,
        height: CHUNK_HEIGHT,
        light,
        railShapes,
      }
      const worker = makeFakeWorker()
      const pool = yield* startMeshingWorkerPool({
        createWorker: () => worker,
        workerCount: workerCount(1),
      })
      const job = yield* Effect.forkChild(pool.submit('0,0', {
        chunk,
        config: KERNEL_MESH_CONFIG,
        lod: 0,
        neighbours: { xPos: chunk },
      }))
      yield* Effect.yieldNow

      const [post] = worker.posts()
      expect(post?.transfer).toStrictEqual([
        blocks.buffer,
        fluid.levels.buffer,
        fluid.sources.buffer,
        fluid.falling.buffer,
        railShapes.buffer,
        light.blockLight.buffer,
        light.skyLight.buffer,
      ])
      expect(worker.posts()).toHaveLength(1)

      yield* pool.shutdown
      expect(yield* Fiber.join(job)).toStrictEqual({ _tag: 'cancelled' })
    }),
  )
})
