import {
  type MeshingWorkerPool,
  type MeshingWorkerPoolStartupError,
  startMeshingWorkerPool,
} from './application/meshing-worker-pool.js'
import {
  type WorkerParallelismError,
  type WorkerParallelismInput,
} from './domain/worker-parallelism.js'
import type { BrowserWorkerLike } from './application/browser-worker-port.js'
import type { Effect } from 'effect'
import type { WorkerPoolFailure } from './application/worker-pool.js'

export { MeshingWorkerPoolStartupError } from './application/meshing-worker-pool.js'
export type { MeshingWorkerPool } from './application/meshing-worker-pool.js'

export type BrowserMeshingWorkerPoolOptions = WorkerParallelismInput & {
  readonly createWorker?: (workerIndex: number) => BrowserWorkerLike<ArrayBuffer>
  readonly maxQueued?: number | undefined
}

const makeDefaultWorker = (workerIndex: number): BrowserWorkerLike<ArrayBuffer> =>
  new Worker(new URL('./workers/chunk-meshing.worker.mjs', import.meta.url), {
    name: `mc-render-mesher-${workerIndex}`,
    type: 'module',
  })

const meshingPoolOptions = (options: BrowserMeshingWorkerPoolOptions) => {
  const { hardwareConcurrency: configuredHardwareConcurrency, workerCount } = options
  let hardwareConcurrency = configuredHardwareConcurrency
  if (hardwareConcurrency === undefined && workerCount === undefined) {
    hardwareConcurrency = globalThis.navigator?.hardwareConcurrency
  }
  return {
    createWorker: options.createWorker ?? makeDefaultWorker,
    hardwareConcurrency,
    maxQueued: options.maxQueued,
    workerCount: options.workerCount,
  }
}

/** Start a bounded worker pool from host settings or the browser hardware count. */
export const startBrowserMeshingWorkerPool = (
  options: BrowserMeshingWorkerPoolOptions = {},
): Effect.Effect<MeshingWorkerPool, WorkerParallelismError | MeshingWorkerPoolStartupError | WorkerPoolFailure> =>
  startMeshingWorkerPool(meshingPoolOptions(options))
