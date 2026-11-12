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

  it.effect('rejects malformed nested chunk, neighbour, config, and LOD fields', () =>
    Effect.sync(() => {
      const payload = validPayload()
      const invalidPayloads: ReadonlyArray<unknown> = [
        null,
        { ...payload, chunk: null },
        { ...payload, chunk: { ...payload.chunk, coord: null } },
        { ...payload, chunk: { ...payload.chunk, height: 0 } },
        { ...payload, neighbours: null },
        { ...payload, neighbours: { xPos: null } },
        { ...payload, config: null },
        { ...payload, config: { ...payload.config, waterBlockIds: [1] } },
        { ...payload, config: { ...payload.config, fluidMaxLevels: new Map([[1, Number.POSITIVE_INFINITY]]) } },
        { ...payload, lod: 3 },
      ]

      for (const invalidPayload of invalidPayloads) {
        const decoded = decodeChunkMeshingWorkerRequest({ id: 1, payload: invalidPayload })
        expect(Result.isFailure(decoded)).toBe(true)
        if (Result.isFailure(decoded)) {
          expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)(decoded.failure)))
            .toBe(true)
          expect(decoded.failure.reason).toBe('invalid-request')
        }
      }
    }),
  )

  it.effect('rejects invalid response unions, layer shapes, IDs, and encoded failure tags', () =>
    Effect.sync(() => {
      const emptyLayers = { opaque: [], water: [], transparentSolid: [], crossPlants: [], fluids: [], specialBlocks: [] }
      const malformedResponses: ReadonlyArray<unknown> = [
        null,
        { id: 1, result: null },
        { id: 0, result: { _tag: 'meshed', layers: emptyLayers } },
        { id: 1, result: { _tag: 'meshed', layers: null } },
        { id: 1, result: { _tag: 'meshed', layers: { ...emptyLayers, opaque: null } } },
        { id: 1, result: { _tag: 'failed', error: null } },
        { id: 1, result: { _tag: 'failed', error: { _tag: 'ChunkMeshingWorkerFailure', reason: 'other' } } },
        { id: 1, result: { _tag: 'failed', error: { _tag: 'ChunkMeshingWorkerFailure', reason: 'mesh-failed', causeTag: 1 } } },
      ]

      for (const malformedResponse of malformedResponses) {
        expect(Result.isFailure(Schema.decodeUnknownResult(ChunkMeshingWorkerResponseSchema)(malformedResponse)))
          .toBe(true)
      }
    }),
  )
})
