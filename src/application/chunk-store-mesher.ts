import {
  type ChunkMesher,
  type SyncOptions,
  type WorldRendererAttachment,
  attachWorldRenderer,
} from './world-sync'
import {
  type LightSampler,
  NO_LIGHT,
  type SkyBlockLight,
  lightSamplePoint,
  packedLightColor,
} from '../domain/voxel-lighting'
import { type MeshConfig, meshChunk } from '@nerima-games/mc-meshing'
import { type MeshQuad, type QuadColor, faceNormal } from '../domain/chunk-geometry'
import {
  blockIdsWithOpacity,
  blockPosition,
  blockTypeOfId,
  chunkCoord,
} from '@nerima-games/mc-kernel'
import type { BlockNameLookup } from '../domain/block-texture-map'
import { CHUNK_SIZE } from '../domain/lod-vocabulary'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import type { WorldRenderer } from './world-renderer'

/** The kernel registry is the single numeric-id to texture-name authority. */
export const blockNameFromKernel: BlockNameLookup = (blockId) => blockTypeOfId(blockId) ?? 'unknown'

/** Water's block id in the kernel registry (`BlockId(6)`, block-registry-data.ts). */
const WATER_BLOCK_ID = 6
/** Water's maximum fluid fall-off level: 8 levels, 0-7. */
const WATER_MAX_FLUID_LEVEL = 7
/** Lava's block id in the kernel registry (`BlockId(11)`, block-registry-data.ts). */
const LAVA_BLOCK_ID = 11
/** Lava's maximum fluid fall-off level: 4 levels, 0-3 — lava spreads over fewer levels than water. */
const LAVA_MAX_FLUID_LEVEL = 3

/**
 * Material routing supported by the current renderer geometry.
 *
 * Cross-plants and variable-height fluids intentionally stay disabled until
 * `buildChunkGeometry` can represent their non-rectangular geometry. They are
 * still visible as cubes and routed to their correct material layer.
 */
export const KERNEL_MESH_CONFIG: MeshConfig = {
  fluidMaxLevels: new Map([
    [WATER_BLOCK_ID, WATER_MAX_FLUID_LEVEL],
    [LAVA_BLOCK_ID, LAVA_MAX_FLUID_LEVEL],
  ]),
  transparentSolidBlockIds: blockIdsWithOpacity('transparentSolid'),
  waterBlockIds: blockIdsWithOpacity('fluid'),
}

/** The two store operations required to mesh one resident chunk. */
export type MeshingChunkStore = Pick<ChunkStoreApi, 'peek' | 'neighbours'>

/** The published worldgen surface needed for renderer attachment and meshing. */
export type RendererChunkStore = Pick<
  ChunkStoreApi,
  'peek' | 'neighbours' | 'subscribeDirty' | 'getLight'
>

const lightKey = (blockX: number, blockY: number, blockZ: number): string => `${blockX},${blockY},${blockZ}`

/** World-space integer coordinates for one light sample, keyed by `lightKey`. */
type LightSamplePosition = {
  readonly blockX: number
  readonly blockY: number
  readonly blockZ: number
}

/** A sample point in chunk-local space, before it is floored into block coordinates. */
type LocalSampleOffset = {
  readonly localX: number
  readonly localY: number
  readonly localZ: number
}

const lightSamplePositionFor = (
  chunk: { readonly cx: number; readonly cz: number },
  local: LocalSampleOffset,
): LightSamplePosition => ({
  blockX: Math.floor(chunk.cx * CHUNK_SIZE + local.localX),
  blockY: Math.floor(local.localY),
  blockZ: Math.floor(chunk.cz * CHUNK_SIZE + local.localZ),
})

/** Every distinct light-sample position a chunk's quads reference, keyed for lookup by `lightKey`. */
const collectLightSamplePositions = (
  chunk: { readonly cx: number; readonly cz: number },
  quads: ReadonlyArray<MeshQuad>,
): ReadonlyMap<string, LightSamplePosition> => {
  const samples = new Map<string, LightSamplePosition>()
  for (const quad of quads) {
    const [localX, localY, localZ] = lightSamplePoint(quad, faceNormal(quad.direction))
    const position = lightSamplePositionFor(chunk, { localX, localY, localZ })
    samples.set(lightKey(position.blockX, position.blockY, position.blockZ), position)
  }
  return samples
}

/** Snapshot the light cells referenced by a chunk mesh into a synchronous colour callback. */
export const makeChunkStoreLightColor = (
  store: Pick<ChunkStoreApi, 'getLight'>,
  chunk: { readonly cx: number; readonly cz: number },
  quads: ReadonlyArray<MeshQuad>,
): Effect.Effect<QuadColor> =>
  Effect.gen(function* () {
    const samples = collectLightSamplePositions(chunk, quads)

    const readings = new Map<string, SkyBlockLight>()
    yield* Effect.forEach(samples, ([key, position]) =>
      Effect.map(store.getLight(blockPosition(position.blockX, position.blockY, position.blockZ)), (reading) => {
        if (reading._tag === 'Light') {
          readings.set(key, { block: reading.block, sky: reading.sky })
          return
        }
        readings.set(key, NO_LIGHT)
      }),
    )

    const sampler: LightSampler = (localX, localY, localZ) => {
      const position = lightSamplePositionFor(chunk, { localX, localY, localZ })
      return readings.get(lightKey(position.blockX, position.blockY, position.blockZ)) ?? NO_LIGHT
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

/** `options` with a light-sampling `colorForChunk` filled in, unless the caller already supplied one (or a flat `color`). */
const withDefaultColorForChunk = (store: RendererChunkStore, options: SyncOptions): SyncOptions => {
  if (options.colorForChunk !== undefined || options.color !== undefined) {
    return options
  }
  return {
    ...options,
    colorForChunk: (chunk: { readonly cx: number; readonly cz: number }, quads: ReadonlyArray<MeshQuad>) =>
      makeChunkStoreLightColor(store, chunk, quads),
  }
}

/** `attachChunkStoreRenderer`'s options: every `SyncOptions` field, plus the mesher's own `MeshConfig`. */
export type ChunkStoreRendererOptions = SyncOptions & {
  readonly config?: MeshConfig
}

/** Attach the renderer directly to a worldgen ChunkStore subscription. */
export const attachChunkStoreRenderer = (
  renderer: WorldRenderer,
  store: RendererChunkStore,
  options: ChunkStoreRendererOptions = {},
): Effect.Effect<WorldRendererAttachment> => {
  const { config = KERNEL_MESH_CONFIG, ...syncOptions } = options
  return attachWorldRenderer(
    renderer,
    store,
    makeChunkStoreMesher(store, config),
    withDefaultColorForChunk(store, syncOptions),
  )
}
