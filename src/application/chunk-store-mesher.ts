import { blockIdsWithOpacity, blockTypeOfId } from '@nerima-games/mc-kernel'
import { meshChunk, type MeshConfig } from '@nerima-games/mc-meshing'
import { chunkCoord, type ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import type { BlockNameLookup } from '../domain/block-texture-map'
import type { ChunkMesher } from './world-sync'

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
  transparentSolidBlockIds: blockIdsWithOpacity('transparentSolid'),
}

/** The two store operations required to mesh one resident chunk. */
export type MeshingChunkStore = Pick<ChunkStoreApi, 'peek' | 'neighbours'>

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
      return [...layers.opaque, ...layers.water, ...layers.transparentSolid]
    })
