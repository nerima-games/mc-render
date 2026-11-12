import {
  type ChunkMeshingWorkerResult,
  decodeChunkMeshingWorkerRequest,
  processChunkMeshingWorkerRequest,
} from '../application/chunk-meshing-worker.js'
import type { WorkerResponse } from '../application/worker-pool.js'

const MIN_WORKER_REQUEST_ID = 1

const workerRequestIdFrom = (input: unknown): number | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || !('id' in input)) {
    return undefined
  }
  const { id } = input
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < MIN_WORKER_REQUEST_ID) {
    return undefined
  }
  return id
}

const postWorkerResponse = (response: WorkerResponse<ChunkMeshingWorkerResult>): void => {
  postMessage(response)
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  const decoded = decodeChunkMeshingWorkerRequest(event.data)
  if (decoded._tag === 'Failure') {
    const id = workerRequestIdFrom(event.data)
    if (id !== undefined) {
      postWorkerResponse({ id, result: { _tag: 'failed', error: decoded.failure } })
    }
    return
  }
  postWorkerResponse(processChunkMeshingWorkerRequest(decoded.success))
})
