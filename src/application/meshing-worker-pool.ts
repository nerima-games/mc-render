import { Brand, Data, Effect, Result, Schema } from 'effect'
import {
  type BrowserWorkerLike,
  makeBrowserWorkerPort,
} from './browser-worker-port.js'
import {
  type ChunkMeshingWorkerPayload,
  ChunkMeshingWorkerResponseSchema,
  type ChunkMeshingWorkerResult,
} from './chunk-meshing-worker.js'
import {
  HardwareConcurrencySchema,
  type WorkerCount,
  WorkerCountSchema,
  type WorkerIndex,
  type WorkerParallelismError,
  type WorkerParallelismInput,
  type WorkerQueueCapacity,
  WorkerQueueCapacitySchema,
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

const MeshingWorkerPoolStartupErrorBase: ReturnType<typeof Data.TaggedError<'MeshingWorkerPoolStartupError'>> =
  Data.TaggedError('MeshingWorkerPoolStartupError')

export class MeshingWorkerPoolStartupError extends MeshingWorkerPoolStartupErrorBase<{
  readonly cause: unknown
  readonly reason: 'invalid-max-queued' | 'invalid-worker-index' | 'worker-creation-failed'
  readonly workerIndex?: WorkerIndex
}> {}

const makeStartupError = (
  reason: MeshingWorkerPoolStartupError['reason'],
  cause: unknown,
  workerIndex?: WorkerIndex,
): MeshingWorkerPoolStartupError => {
  if (workerIndex === undefined) {
    return new MeshingWorkerPoolStartupError({ cause, reason })
  }
  return new MeshingWorkerPoolStartupError({ cause, reason, workerIndex })
}

export type MeshingWorkerPoolFactoryOptions = WorkerParallelismInput & {
  readonly createWorker: (workerIndex: WorkerIndex) => BrowserWorkerLike<ArrayBuffer>
  readonly maxQueued?: WorkerQueueCapacity | undefined
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
  workerCount: WorkerCount,
): Effect.Effect<
  Array<WorkerPort<
    WorkerRequest<ChunkMeshingWorkerPayload>,
    WorkerResponse<ChunkMeshingWorkerResult>
  >>,
  MeshingWorkerPoolStartupError
> => {
  const workers: Array<BrowserWorkerLike<ArrayBuffer>> = []
  const makeWorkerIndexFromArrayPosition = Brand.nominal<WorkerIndex>()
  const workerIndices = Effect.try({
    catch: (cause) => makeStartupError('worker-creation-failed', cause),
    try: () => Array.from({ length: workerCount }, (_unused, workerIndex) => makeWorkerIndexFromArrayPosition(workerIndex)),
  })
  const createPort = (workerIndex: WorkerIndex) => Effect.try({
    catch: (cause) => makeStartupError('worker-creation-failed', cause, workerIndex),
    try: () => {
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
    },
  })
  return workerIndices.pipe(
    Effect.flatMap((indices) => Effect.forEach(indices, createPort)),
    Effect.mapError((failure) => {
      for (const worker of workers) {
        worker.terminate()
      }
      return failure
    }),
  )
}

const startPoolWithWorkers = (
  options: MeshingWorkerPoolFactoryOptions,
  workerCount: WorkerCount,
  maxQueued: WorkerQueueCapacity | undefined,
): Effect.Effect<MeshingWorkerPool, MeshingWorkerPoolStartupError | WorkerPoolFailure> =>
  createWorkerPorts(options, workerCount).pipe(Effect.flatMap((workerPorts) => {
    if (maxQueued === undefined) {
      return makeWorkerPool(workerPorts, { runSync: Effect.runSync })
    }
    return makeWorkerPool(workerPorts, { maxQueued, runSync: Effect.runSync })
  }))

/** Create and adapt workers, cleaning up a partial startup if construction fails. */
export const startMeshingWorkerPool = (
  options: MeshingWorkerPoolFactoryOptions,
): Effect.Effect<MeshingWorkerPool, WorkerParallelismError | MeshingWorkerPoolStartupError | WorkerPoolFailure> => {
  const count = resolveWorkerParallelism(options)
  const { maxQueued } = options
  if (Result.isFailure(count)) {
    return Effect.fail(count.failure)
  }
  if (maxQueued === undefined) {
    return startPoolWithWorkers(options, count.success, undefined)
  }
  const queueCapacity = Schema.decodeUnknownResult(WorkerQueueCapacitySchema)(maxQueued)
  if (Result.isFailure(queueCapacity)) {
    return Effect.fail(makeStartupError('invalid-max-queued', queueCapacity.failure))
  }
  return startPoolWithWorkers(options, count.success, queueCapacity.success)
}

type MeshingWorkerPoolFactoryOptionsEncoded = Readonly<{
  readonly hardwareConcurrency?: Schema.Codec.Encoded<typeof HardwareConcurrencySchema> | undefined
  readonly maxQueued?: Schema.Codec.Encoded<typeof WorkerQueueCapacitySchema> | undefined
  readonly workerCount?: Schema.Codec.Encoded<typeof WorkerCountSchema> | undefined
}>

export const MeshingWorkerPoolFactoryOptionsSchema: Schema.Codec<Pick<
  MeshingWorkerPoolFactoryOptions,
  'hardwareConcurrency' | 'maxQueued' | 'workerCount'
>, MeshingWorkerPoolFactoryOptionsEncoded> = Schema.Struct({
  hardwareConcurrency: Schema.optional(HardwareConcurrencySchema),
  maxQueued: Schema.optional(WorkerQueueCapacitySchema),
  workerCount: Schema.optional(WorkerCountSchema),
})
