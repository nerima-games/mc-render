import {
  blockIdsWithOpacity,
  blockPosition,
  blockTypeOfId,
  chunkCoord,
} from '@nerima-games/mc-kernel'
import { meshChunk, type MeshConfig } from '@nerima-games/mc-meshing'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import type { BlockNameLookup } from '../domain/block-texture-map'
import { faceNormal, type MeshQuad, type QuadColor } from '../domain/chunk-geometry'
import { CHUNK_SIZE } from '../domain/lod-vocabulary'
import {
  lightSamplePoint,
  NO_LIGHT,
  packedLightColor,
  type LightSampler,
  type SkyBlockLight,
} from '../domain/voxel-lighting'
import type { WorldRenderer } from './world-renderer'
import {
  attachWorldRenderer,
  type ChunkMesher,
  type SyncOptions,
  type WorldRendererAttachment,
} from './world-sync'

/** The kernel registry is the single numeric-id to texture-name authority. */
export const blockNameFromKernel: BlockNameLookup = (blockId) => blockTypeOfId(blockId) ?? 'unknown'

/**
 * Material routing supported by the current renderer geometry.
 *
 * Cross-plants and variable-height fluids intentionally stay disabled until
 * `buildChunkGeometry` can represent their non-rectangular geometry. They are
 * still visible as cubes and routed to their correct material layer.
 */
export const KERNEL_MESH_CONFIG: MeshConfig = {
  waterBlockIds: blockIdsWithOpacity('fluid'),
  fluidMaxLevels: new Map([[6, 7], [11, 3]]),
  transparentSolidBlockIds: blockIdsWithOpacity('transparentSolid'),
}

/** The two store operations required to mesh one resident chunk. */
export type MeshingChunkStore = Pick<ChunkStoreApi, 'peek' | 'neighbours'>

/** The published worldgen surface needed for renderer attachment and meshing. */
export type RendererChunkStore = Pick<
  ChunkStoreApi,
  'peek' | 'neighbours' | 'subscribeDirty' | 'getLight'
>

const lightKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

/** Snapshot the light cells referenced by a chunk mesh into a synchronous colour callback. */
export const makeChunkStoreLightColor = (
  store: Pick<ChunkStoreApi, 'getLight'>,
  chunk: { readonly cx: number; readonly cz: number },
  quads: ReadonlyArray<MeshQuad>,
): Effect.Effect<QuadColor> =>
  Effect.gen(function* () {
    const samples = new Map<string, readonly [number, number, number]>()
    for (const quad of quads) {
      const [localX, localY, localZ] = lightSamplePoint(quad, faceNormal(quad.direction))
      const x = Math.floor(chunk.cx * CHUNK_SIZE + localX)
      const y = Math.floor(localY)
      const z = Math.floor(chunk.cz * CHUNK_SIZE + localZ)
      samples.set(lightKey(x, y, z), [x, y, z])
    }

    const readings = new Map<string, SkyBlockLight>()
    yield* Effect.forEach(samples, ([key, [x, y, z]]) =>
      Effect.map(store.getLight(blockPosition(x, y, z)), (reading) => {
        readings.set(
          key,
          reading._tag === 'Light' ? { sky: reading.sky, block: reading.block } : NO_LIGHT,
        )
      }),
    )

    const sampler: LightSampler = (localX, localY, localZ) => {
      const x = Math.floor(chunk.cx * CHUNK_SIZE + localX)
      const y = Math.floor(localY)
      const z = Math.floor(chunk.cz * CHUNK_SIZE + localZ)
      return readings.get(lightKey(x, y, z)) ?? NO_LIGHT
    }
    return packedLightColor(sampler)
  })

/** Adapt a worldgen chunk store to the renderer's pull-based meshing port. */
export const makeChunkStoreMesher = (
  store: MeshingChunkStore,
  config: MeshConfig = KERNEL_MESH_CONFIG,
): ChunkMesher =>
  ({ cx, cz }) =>
    Effect.gen(function* () {
      const coord = chunkCoord(cx, cz)
      const chunk = yield* store.peek(coord)
      if (chunk === undefined) {
        return undefined
      }

      const neighbours = yield* store.neighbours(coord)
      const layers = meshChunk(chunk, neighbours, config)
      const quads = [...layers.opaque, ...layers.water, ...layers.transparentSolid]
      return Object.assign(quads, { fluids: layers.fluids })
    })

/** Attach the renderer directly to a worldgen ChunkStore subscription. */
export const attachChunkStoreRenderer = (
  renderer: WorldRenderer,
  store: RendererChunkStore,
  options: SyncOptions = {},
  config: MeshConfig = KERNEL_MESH_CONFIG,
): Effect.Effect<WorldRendererAttachment> => {
  const syncOptions =
    options.colorForChunk === undefined && options.color === undefined
      ? {
          ...options,
          colorForChunk: (
            chunk: { readonly cx: number; readonly cz: number },
            quads: ReadonlyArray<MeshQuad>,
          ) => makeChunkStoreLightColor(store, chunk, quads),
        }
      : options
  return attachWorldRenderer(renderer, store, makeChunkStoreMesher(store, config), syncOptions)
}
