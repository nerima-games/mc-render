import {
  type BrowserWorkerLike,
  makeBrowserWorkerPort,
} from './browser-worker-port.js'
import {
  type ChunkMeshingWorkerPayload,
  ChunkMeshingWorkerResponseSchema,
  type ChunkMeshingWorkerResult,
} from './chunk-meshing-worker.js'
import { Data, Effect, Result, Schema } from 'effect'
import {
  type WorkerParallelismError,
  type WorkerParallelismInput,
  resolveWorkerParallelism,
} from '../domain/worker-parallelism.js'
import {
  type WorkerPool,
  type WorkerPoolFailure,
  type WorkerPort,
  type WorkerRequest,
  type WorkerResponse,
  makeWorkerPool,
} from './worker-pool.js'
import type { ChunkView } from '@nerima-games/mc-meshing'

const MIN_MAX_QUEUED = 1
const MIN_WORKER_COUNT = 1

const MeshingWorkerPoolStartupErrorBase: ReturnType<typeof Data.TaggedError<'MeshingWorkerPoolStartupError'>> =
  Data.TaggedError('MeshingWorkerPoolStartupError')

export class MeshingWorkerPoolStartupError extends MeshingWorkerPoolStartupErrorBase<{
  readonly cause: unknown
  readonly reason: 'worker-creation-failed' | 'invalid-max-queued'
  readonly workerIndex?: number
}> {}

export type MeshingWorkerPoolFactoryOptions = WorkerParallelismInput & {
  readonly createWorker: (workerIndex: number) => BrowserWorkerLike<ArrayBuffer>
  readonly maxQueued?: number | undefined
}

export type MeshingWorkerPool = WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>

const chunkViewsIn = (payload: ChunkMeshingWorkerPayload): ReadonlyArray<ChunkView> => [
  payload.chunk,
  ...Object.values(payload.neighbours).filter((neighbour): neighbour is ChunkView => neighbour !== undefined),
]

const typedViewsIn = (chunk: ChunkView): ReadonlyArray<ArrayBufferView<ArrayBufferLike> | undefined> => [
  chunk.blocks,
  chunk.fluid?.levels,
  chunk.fluid?.sources,
  chunk.fluid?.falling,
  chunk.railShapes,
  chunk.light?.blockLight,
  chunk.light?.skyLight,
]

const transferablesFor = (request: WorkerRequest<ChunkMeshingWorkerPayload>): Array<ArrayBuffer> => {
  const buffers = new Set<ArrayBuffer>()
  for (const chunk of chunkViewsIn(request.payload)) {
    for (const view of typedViewsIn(chunk)) {
      if (view !== undefined && view.buffer instanceof ArrayBuffer) {
        buffers.add(view.buffer)
      }
    }
  }
  return [...buffers]
}

const createWorkerPorts = (
  options: MeshingWorkerPoolFactoryOptions,
  workerCount: number,
): Effect.Effect<
  Array<WorkerPort<
    WorkerRequest<ChunkMeshingWorkerPayload>,
    WorkerResponse<ChunkMeshingWorkerResult>
  >>,
  MeshingWorkerPoolStartupError
> => {
  const workers: Array<BrowserWorkerLike<ArrayBuffer>> = []
  return Effect.try({
    catch: (cause) => {
      for (const worker of workers) {
        worker.terminate()
      }
      return new MeshingWorkerPoolStartupError({
        cause,
        reason: 'worker-creation-failed',
        workerIndex: workers.length,
      })
    },
    try: () => Array.from({ length: workerCount }, (_unused, workerIndex) => {
      const worker = options.createWorker(workerIndex)
      workers.push(worker)
      return makeBrowserWorkerPort<
        WorkerRequest<ChunkMeshingWorkerPayload>,
        WorkerResponse<ChunkMeshingWorkerResult>,
        ArrayBuffer
      >(worker, {
        responseSchema: ChunkMeshingWorkerResponseSchema,
        transfer: transferablesFor,
        workerIndex,
      })
    }),
  })
}

/** Create and adapt workers, cleaning up a partial startup if construction fails. */
export const startMeshingWorkerPool = (
  options: MeshingWorkerPoolFactoryOptions,
): Effect.Effect<MeshingWorkerPool, WorkerParallelismError | MeshingWorkerPoolStartupError | WorkerPoolFailure> => {
  const count = resolveWorkerParallelism(options)
  const { maxQueued } = options
  if (Result.isFailure(count)) {
    return Effect.fail(count.failure)
  }
  if (maxQueued !== undefined && (!Number.isSafeInteger(maxQueued) || maxQueued < MIN_MAX_QUEUED)) {
    return Effect.fail(new MeshingWorkerPoolStartupError({ cause: undefined, reason: 'invalid-max-queued' }))
  }

  const ports = createWorkerPorts(options, count.success)
  if (maxQueued === undefined) {
    return ports.pipe(Effect.flatMap((workerPorts) => makeWorkerPool(workerPorts, { runSync: Effect.runSync })))
  }
  return ports.pipe(Effect.flatMap((workerPorts) => makeWorkerPool(workerPorts, {
    maxQueued,
    runSync: Effect.runSync,
  })))
}

export const MeshingWorkerPoolFactoryOptionsSchema: Schema.Codec<Pick<
  MeshingWorkerPoolFactoryOptions,
  'hardwareConcurrency' | 'maxQueued' | 'workerCount'
>> = Schema.Struct({
  hardwareConcurrency: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_COUNT))),
  maxQueued: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAX_QUEUED))),
  workerCount: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_COUNT))),
})
