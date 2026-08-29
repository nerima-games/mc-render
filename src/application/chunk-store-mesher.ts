import {
  BLOCK_IDS,
  blockIdsWithOpacity,
  blockPosition,
  blockTypeOfId,
  chunkCoord,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import {
  type ChunkMesher,
  type SyncOptions,
  type WorldRendererAttachment,
  attachWorldRenderer,
} from './world-sync'
import { type GeometryQuad, type QuadColor } from '../domain/chunk-geometry'
import {
  type LightSampler,
  NO_LIGHT,
  type SkyBlockLight,
  lightSampleForGeometryQuad,
  packedLightColor,
} from '../domain/voxel-lighting'
import { type MeshConfig, meshChunk } from '@nerima-games/mc-meshing'
import type { BlockNameLookup } from '../domain/block-texture-map'
import type { BlockShapeKind } from '../domain/meshing-vocabulary'
import { CHUNK_SIZE } from '../domain/lod-vocabulary'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import type { WorldRenderer } from './world-renderer'
import { meshBlockShapes } from '../domain/block-shapes'

/** The kernel registry is the single numeric-id to texture-name authority. */
export const blockNameFromKernel: BlockNameLookup = (blockId) => blockTypeOfId(blockId) ?? 'unknown'

/** Maximum fall-off level for each fluid kind. */
const FLUID_MAX_LEVELS = {
  lava: 3,
  water: 7,
} as const

type FluidKind = keyof typeof FLUID_MAX_LEVELS

/** Collect kernel block IDs classified as the requested fluid. */
const kernelBlockIdsWithFluid = (fluid: FluidKind): ReadonlySet<number> =>
  new Set(BLOCK_IDS.filter((blockId) => propertyOfBlockId(blockId, 'fluid') === fluid))

/** Build per-block fluid maximum levels from kernel classifications. */
const kernelFluidMaxLevels = (): ReadonlyMap<number, number> =>
  new Map(
    BLOCK_IDS.flatMap((blockId) => {
      const fluid = propertyOfBlockId(blockId, 'fluid')
      if (fluid === 'water' || fluid === 'lava') {
        return [[blockId, FLUID_MAX_LEVELS[fluid]] as const]
      }
      return []
    }),
  )

/** Collect kernel block IDs rendered as diagonal plant plates. */
const kernelCrossPlantBlockIds = (): ReadonlySet<number> =>
  new Set(BLOCK_IDS.filter((blockId) => propertyOfBlockId(blockId, 'renderKind') === 'cross'))

const blockShapeFor = (blockId: number): BlockShapeKind | undefined => {
  const renderKind = propertyOfBlockId(blockId, 'renderKind')
  switch (renderKind) {
    case 'cactus':
      return 'cactus'
    case 'lilyPad':
      return 'lilyPad'
    case 'rail':
      return 'rail'
    default:
      break
  }
  const collisionShape = propertyOfBlockId(blockId, 'collisionShape')
  if (collisionShape === 'pressurePlate') {
    return 'pressurePlate'
  }
  if (collisionShape === 'slab') {
    return 'slab'
  }
  return undefined
}

/** Collect kernel block IDs whose geometry is not a full cube. */
export const KERNEL_BLOCK_SHAPE_KINDS: ReadonlyMap<number, BlockShapeKind> = new Map(
  BLOCK_IDS.flatMap((blockId) => {
    const shape = blockShapeFor(blockId)
    if (shape === undefined) {
      return []
    }
    return [[blockId, shape] as const]
  }),
)

export type RenderMeshConfig = MeshConfig & {
  readonly blockShapeKinds?: ReadonlyMap<number, BlockShapeKind>
}

const EMPTY_BLOCK_SHAPE_KINDS: ReadonlyMap<number, BlockShapeKind> = new Map()

/**
 * Material and shape routing derived from the kernel registry.
 */
export const KERNEL_MESH_CONFIG: RenderMeshConfig = {
  blockShapeKinds: KERNEL_BLOCK_SHAPE_KINDS,
  crossPlantBlockIds: kernelCrossPlantBlockIds(),
  fluidMaxLevels: kernelFluidMaxLevels(),
  transparentSolidBlockIds: blockIdsWithOpacity('transparentSolid'),
  waterBlockIds: kernelBlockIdsWithFluid('water'),
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
  quads: ReadonlyArray<GeometryQuad>,
): ReadonlyMap<string, LightSamplePosition> => {
  const samples = new Map<string, LightSamplePosition>()
  for (const quad of quads) {
    const { point } = lightSampleForGeometryQuad(quad)
    const [localX, localY, localZ] = point
    const position = lightSamplePositionFor(chunk, { localX, localY, localZ })
    samples.set(lightKey(position.blockX, position.blockY, position.blockZ), position)
  }
  return samples
}

/** Snapshot the light cells referenced by a chunk mesh into a synchronous colour callback. */
export const makeChunkStoreLightColor = (
  store: Pick<ChunkStoreApi, 'getLight'>,
  chunk: { readonly cx: number; readonly cz: number },
  quads: ReadonlyArray<GeometryQuad>,
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
  config: RenderMeshConfig = KERNEL_MESH_CONFIG,
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
      const blockShapeKinds = config.blockShapeKinds ?? EMPTY_BLOCK_SHAPE_KINDS
      const quads = [...layers.opaque, ...layers.water, ...layers.transparentSolid].filter(
        (quad) => !blockShapeKinds.has(quad.blockId),
      )
      const blockShapes = meshBlockShapes(chunk, neighbours, blockShapeKinds)
      return Object.assign(quads, {
        blockShapes,
        crossPlants: layers.crossPlants,
        fluids: layers.fluids,
      })
    })

/** `options` with a light-sampling `colorForChunk` filled in, unless the caller already supplied one (or a flat `color`). */
const withDefaultColorForChunk = (store: RendererChunkStore, options: SyncOptions): SyncOptions => {
  if (options.colorForChunk !== undefined || options.color !== undefined) {
    return options
  }
  return {
    ...options,
    colorForChunk: (chunk: { readonly cx: number; readonly cz: number }, quads: ReadonlyArray<GeometryQuad>) =>
      makeChunkStoreLightColor(store, chunk, quads),
  }
}

/** `attachChunkStoreRenderer`'s options: every `SyncOptions` field, plus the mesher's own `MeshConfig`. */
export type ChunkStoreRendererOptions = SyncOptions & {
  readonly config?: RenderMeshConfig
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
