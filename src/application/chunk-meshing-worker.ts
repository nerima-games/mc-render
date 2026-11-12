import {
  type ChunkNeighbours,
  type ChunkView,
  type LodLevel,
  type MeshConfig,
  type MeshLayers,
  meshChunk,
  simplifyMesh,
} from '@nerima-games/mc-meshing'
import { Result, Schema } from 'effect'
import type { WorkerRequest, WorkerResponse } from './worker-pool.js'

export type ChunkMeshingWorkerPayload = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly config: MeshConfig
  readonly lod: LodLevel
}

export type ChunkMeshingWorkerFailure = {
  readonly _tag: 'ChunkMeshingWorkerFailure'
  readonly reason: 'invalid-request' | 'mesh-failed'
  readonly causeTag?: string | undefined
}

export const ChunkMeshingWorkerFailureSchema: Schema.Codec<ChunkMeshingWorkerFailure> = Schema.Struct({
  _tag: Schema.Literal('ChunkMeshingWorkerFailure'),
  causeTag: Schema.optional(Schema.String),
  reason: Schema.Literals(['invalid-request', 'mesh-failed']),
})

export type ChunkMeshingWorkerResult =
  | { readonly _tag: 'meshed'; readonly layers: MeshLayers }
  | { readonly _tag: 'failed'; readonly error: ChunkMeshingWorkerFailure }

const MIN_CHUNK_HEIGHT = 1
const LOD_FINEST = 0
const LOD_MIDDLE = 1
const LOD_COARSEST = 2
const FIRST_WORKER_REQUEST_ID = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const isMeshChunkView = (value: unknown): value is ChunkView => {
  if (!isRecord(value)) {
    return false
  }
  const { coord, height, blocks } = value
  if (!isRecord(coord)) {
    return false
  }
  return isSafeInteger(coord['cx']) &&
    isSafeInteger(coord['cz']) &&
    isSafeInteger(height) &&
    height >= MIN_CHUNK_HEIGHT &&
    blocks instanceof Uint16Array
}

const isMeshNeighbours = (value: unknown): value is ChunkNeighbours => {
  if (!isRecord(value)) {
    return false
  }
  const keys = ['xPos', 'xNeg', 'zPos', 'zNeg', 'xPosZPos', 'xPosZNeg', 'xNegZPos', 'xNegZNeg'] as const
  return keys.every((key) => value[key] === undefined || isMeshChunkView(value[key]))
}

const isMeshConfig = (value: unknown): value is MeshConfig => {
  if (!isRecord(value)) {
    return false
  }
  const isBlockSet = (input: unknown): input is ReadonlySet<number> =>
    input instanceof Set && [...input].every(isSafeInteger)
  const fluidLevels = value['fluidMaxLevels']
  return isBlockSet(value['waterBlockIds']) &&
    isBlockSet(value['transparentSolidBlockIds']) &&
    isBlockSet(value['crossPlantBlockIds']) &&
    fluidLevels instanceof Map &&
    [...fluidLevels].every(([blockId, level]) => isSafeInteger(blockId) && typeof level === 'number' && Number.isFinite(level))
}

const isChunkMeshingWorkerPayload = (value: unknown): value is ChunkMeshingWorkerPayload =>
  isRecord(value) &&
  isMeshChunkView(value['chunk']) &&
  isMeshNeighbours(value['neighbours']) &&
  isMeshConfig(value['config']) &&
  (value['lod'] === LOD_FINEST || value['lod'] === LOD_MIDDLE || value['lod'] === LOD_COARSEST)

export const ChunkMeshingWorkerPayloadSchema: Schema.Codec<ChunkMeshingWorkerPayload> =
  Schema.declare<ChunkMeshingWorkerPayload>(isChunkMeshingWorkerPayload)

const isMeshLayers = (value: unknown): value is MeshLayers => {
  if (!isRecord(value)) {
    return false
  }
  const layers = ['opaque', 'water', 'transparentSolid', 'crossPlants', 'fluids', 'specialBlocks'] as const
  return layers.every((key) => Array.isArray(value[key]) && value[key].every(isRecord))
}

const isChunkMeshingWorkerResult = (value: unknown): value is ChunkMeshingWorkerResult => {
  if (!isRecord(value)) {
    return false
  }
  const { _tag, error, layers } = value
  if (_tag === 'meshed') {
    return isMeshLayers(layers)
  }
  if (_tag === 'failed' && isRecord(error)) {
    return error['_tag'] === 'ChunkMeshingWorkerFailure' &&
      (error['reason'] === 'invalid-request' || error['reason'] === 'mesh-failed') &&
      (error['causeTag'] === undefined || typeof error['causeTag'] === 'string')
  }
  return false
}

const isWorkerResponse = (value: unknown): value is WorkerResponse<ChunkMeshingWorkerResult> =>
  isRecord(value) &&
  isSafeInteger(value['id']) &&
  value['id'] >= FIRST_WORKER_REQUEST_ID &&
  isChunkMeshingWorkerResult(value['result'])

export const ChunkMeshingWorkerResponseSchema: Schema.Codec<WorkerResponse<ChunkMeshingWorkerResult>> =
  Schema.declare<WorkerResponse<ChunkMeshingWorkerResult>>(isWorkerResponse)

const errorTag = (error: unknown): string | undefined => {
  if (isRecord(error) && typeof error['_tag'] === 'string') {
    return error['_tag']
  }
  return undefined
}

export const processChunkMeshingWorkerRequest = (
  request: WorkerRequest<ChunkMeshingWorkerPayload>,
): WorkerResponse<ChunkMeshingWorkerResult> => {
  const meshed = meshChunk(request.payload.chunk, request.payload.neighbours, request.payload.config)
  if (Result.isFailure(meshed)) {
    const causeTag = errorTag(meshed.failure)
    return {
      id: request.id,
      result: {
        _tag: 'failed',
        error: {
          _tag: 'ChunkMeshingWorkerFailure',
          causeTag,
          reason: 'mesh-failed',
        },
      },
    }
  }
  return {
    id: request.id,
    result: {
      _tag: 'meshed',
      layers: simplifyMesh(meshed.success, request.payload.lod),
    },
  }
}

export const decodeChunkMeshingWorkerRequest = (
  input: unknown,
): Result.Result<WorkerRequest<ChunkMeshingWorkerPayload>, ChunkMeshingWorkerFailure> => {
  const requestSchema = Schema.Struct({
    id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(FIRST_WORKER_REQUEST_ID)),
    payload: ChunkMeshingWorkerPayloadSchema,
  })
  const decoded = Schema.decodeUnknownResult(requestSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail({ _tag: 'ChunkMeshingWorkerFailure', reason: 'invalid-request' })
  }
  return Result.succeed(decoded.success)
}
