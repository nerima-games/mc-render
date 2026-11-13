import { Effect, Result } from 'effect'
import {
  type MeshingWorkerPool,
  type MeshingWorkerPoolFactoryOptions,
  type MeshingWorkerPoolStartupError,
  startMeshingWorkerPool,
} from './application/meshing-worker-pool.js'
import {
  type WorkerIndex,
  type WorkerParallelismError,
  type WorkerParallelismInput,
  makeHardwareConcurrency,
} from './domain/worker-parallelism.js'
import type { BrowserWorkerLike } from './application/browser-worker-port.js'
import type { WorkerPoolFailure } from './application/worker-pool.js'

export { MeshingWorkerPoolStartupError } from './application/meshing-worker-pool.js'
export type { MeshingWorkerPool } from './application/meshing-worker-pool.js'

export type BrowserMeshingWorkerPoolOptions = WorkerParallelismInput & {
  readonly createWorker?: (workerIndex: WorkerIndex) => BrowserWorkerLike<ArrayBuffer>
  readonly maxQueued?: MeshingWorkerPoolFactoryOptions['maxQueued']
}

const makeDefaultWorker = (workerIndex: WorkerIndex): BrowserWorkerLike<ArrayBuffer> =>
  new Worker(new URL('./workers/chunk-meshing.worker.mjs', import.meta.url), {
    name: `mc-render-mesher-${workerIndex}`,
    type: 'module',
  })

const meshingPoolOptions = (
  options: BrowserMeshingWorkerPoolOptions,
): Result.Result<MeshingWorkerPoolFactoryOptions, WorkerParallelismError> => {
  const { hardwareConcurrency: configuredHardwareConcurrency, workerCount } = options
  let hardwareConcurrency = configuredHardwareConcurrency
  if (hardwareConcurrency === undefined && workerCount === undefined) {
    const detectedHardwareConcurrency = globalThis.navigator?.hardwareConcurrency
    if (detectedHardwareConcurrency !== undefined) {
      const decoded = makeHardwareConcurrency(detectedHardwareConcurrency)
      if (Result.isFailure(decoded)) {
        return Result.fail(decoded.failure)
      }
      hardwareConcurrency = decoded.success
    }
  }
  return Result.succeed({
    createWorker: options.createWorker ?? makeDefaultWorker,
    hardwareConcurrency,
    maxQueued: options.maxQueued,
    workerCount: options.workerCount,
  })
}

/** Start a bounded worker pool from host settings or the browser hardware count. */
export const startBrowserMeshingWorkerPool = (
  options: BrowserMeshingWorkerPoolOptions = {},
): Effect.Effect<MeshingWorkerPool, WorkerParallelismError | MeshingWorkerPoolStartupError | WorkerPoolFailure> => {
  const poolOptions = meshingPoolOptions(options)
  if (Result.isFailure(poolOptions)) {
    return Effect.fail(poolOptions.failure)
  }
  return startMeshingWorkerPool(poolOptions.success)
}
