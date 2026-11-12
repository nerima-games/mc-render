import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { chunkCoord } from './support/kernel-brands'
import { emptyBlocks } from '@nerima-games/mc-worldgen/testing'
import { CHUNK_HEIGHT } from '@nerima-games/mc-worldgen'
import {
  ChunkMeshingWorkerFailureSchema,
  ChunkMeshingWorkerPayloadSchema,
  ChunkMeshingWorkerResponseSchema,
  decodeChunkMeshingWorkerRequest,
  processChunkMeshingWorkerRequest,
  type ChunkMeshingWorkerPayload,
} from '../src/application/chunk-meshing-worker'
import { KERNEL_MESH_CONFIG } from '../src/application/chunk-store-mesher'

const validPayload = (): ChunkMeshingWorkerPayload => ({
  chunk: {
    blocks: new Uint16Array(emptyBlocks()),
    coord: chunkCoord(0, 0),
    height: CHUNK_HEIGHT,
  },
  config: KERNEL_MESH_CONFIG,
  lod: 0,
  neighbours: {},
})

describe('chunk meshing worker protocol', () => {
  it.effect('decodes a serializable request and returns a schema-valid mesh response', () =>
    Effect.sync(() => {
      const decoded = decodeChunkMeshingWorkerRequest({ id: 1, payload: validPayload() })
      expect(Result.isSuccess(decoded)).toBe(true)
      if (Result.isFailure(decoded)) {
        return
      }

      expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerPayloadSchema)(decoded.success.payload))).toBe(true)
      const response = processChunkMeshingWorkerRequest(decoded.success)
      expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerResponseSchema)(response))).toBe(true)
      expect(response.result._tag).toBe('meshed')
    }),
  )

  it.effect('keeps a mesher rejection typed when the worker receives malformed chunk storage', () =>
    Effect.sync(() => {
      const payload = validPayload()
      const response = processChunkMeshingWorkerRequest({
        id: 3,
        payload: { ...payload, chunk: { ...payload.chunk, blocks: new Uint16Array(1) } },
      })

      expect(response.result._tag).toBe('failed')
      if (response.result._tag === 'failed') {
        expect(response.result.error.reason).toBe('mesh-failed')
        expect(response.result.error.causeTag).toBe('InvalidChunkBlocksLength')
        expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)(response.result.error))).toBe(true)
      }
    }),
  )

  it.effect('returns a schema-decodable failure for arbitrary malformed request values', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.anything(), (input) => {
          const decoded = decodeChunkMeshingWorkerRequest(input)
          if (Result.isFailure(decoded)) {
            expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)(decoded.failure))).toBe(true)
          } else {
            expect(decoded.success.id).toBeGreaterThan(0)
            expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerPayloadSchema)(decoded.success.payload))).toBe(true)
          }
        }),
        { seed: 0, numRuns: 200 },
      )
    }),
  )
})
