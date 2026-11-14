import {
  BLOCK_IDS,
  BLOCK_TYPES,
  BlockAxis,
  type BlockId,
  type BlockType,
  ChunkAxis,
  type ChunkCoord,
  LightLevelCandidate,
  type RenderDistanceChunks,
  blockIdsWithOpacity,
  blockPosition,
  blockTypeOfId,
  chunkCoord,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { BLOCK_TEXTURE_ALPHA_MODES, type BlockNameLookup, quadTileForLookup } from '../domain/block-texture-map.js'
import {
  CHUNK_HEIGHT,
  type ChunkStoreApi,
  type LightQueueUnderflowError,
  type ReadonlyChunk,
  type ChunkNeighbours as WorldgenChunkNeighbours,
} from '@nerima-games/mc-worldgen'
import {
  CHUNK_SIZE,
  type ChunkView,
  type LodLevel,
  type MeshConfig,
  type MeshLayers,
  type ChunkNeighbours as MeshingChunkNeighbours,
  meshChunk,
  simplifyMesh,
} from '@nerima-games/mc-meshing'
import {
  type ChunkMesh,
  type ChunkMesher,
  type ChunkMesherError,
  type DirtySubscriptionStore,
  type SyncOptions,
  type WorldRendererAttachment,
  attachWorldRenderer,
} from './world-sync.js'
import {
  type ChunkMeshingWorkerPayload,
  type ChunkMeshingWorkerResult,
} from './chunk-meshing-worker.js'
import { Effect, Option, Result } from 'effect'
import { type GeometryQuad, type MeshQuad, type QuadColor } from '../domain/chunk-geometry.js'
import {
  type LightSampler,
  NO_LIGHT,
  type SkyBlockLight,
  lightSampleForGeometryQuad,
  packedLightColor,
} from '../domain/voxel-lighting.js'
import {
  type LodInputError,
  chunkDistance,
  lodForDistance,
  lodThresholdsForRenderDistance,
} from '../domain/level-of-detail.js'
import type { BlockShapeKind } from '../domain/meshing-vocabulary.js'
import type { WorkerPool } from './worker-pool.js'
import type { WorldRenderer } from './world-renderer.js'
import { meshBlockShapes } from '../domain/block-shapes.js'

/** The kernel registry is the single numeric-id to texture-name authority. */
export const blockNameFromKernel: BlockNameLookup = (blockId) =>
  Result.getOrThrow(blockTypeOfId(blockId)) ?? 'unknown'

/** Maximum fall-off level for each fluid kind. */
const FLUID_MAX_LEVELS = {
  lava: 3,
  water: 7,
} as const

type FluidKind = keyof typeof FLUID_MAX_LEVELS

/** Collect kernel block IDs classified as the requested fluid. */
const kernelBlockIdsWithFluid = (fluid: FluidKind): ReadonlySet<BlockId> =>
  new Set(BLOCK_IDS.filter((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'fluid')) === fluid))

/** Build per-block fluid maximum levels from kernel classifications. */
const kernelFluidMaxLevels = (): ReadonlyMap<BlockId, number> =>
  new Map(
    BLOCK_IDS.flatMap((blockId) => {
      const fluid = Result.getOrThrow(propertyOfBlockId(blockId, 'fluid'))
      if (fluid === 'water' || fluid === 'lava') {
        return [[blockId, FLUID_MAX_LEVELS[fluid]] as const]
      }
      return []
    }),
  )

/** Collect kernel block IDs rendered as diagonal plant plates. */
const kernelCrossPlantBlockIds = (): ReadonlySet<BlockId> =>
  new Set(BLOCK_IDS.filter((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'renderKind')) === 'cross'))

const blockShapeFor = (blockId: BlockId): BlockShapeKind | undefined => {
  const renderKind = Result.getOrThrow(propertyOfBlockId(blockId, 'renderKind'))
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
  const collisionShape = Result.getOrThrow(propertyOfBlockId(blockId, 'collisionShape'))
  if (collisionShape === 'pressurePlate') {
    return 'pressurePlate'
  }
  if (collisionShape === 'slab') {
    return 'slab'
  }
  return undefined
}

const withoutBlockShapes = (
  quads: ReadonlyArray<MeshQuad>,
  blockShapeKinds: ReadonlyMap<BlockId, BlockShapeKind>,
): ReadonlyArray<MeshQuad> => quads.filter((quad) => !blockShapeKinds.has(quad.blockId))

const blockTypeForQuad = (quad: MeshQuad): BlockType | undefined =>
  BLOCK_TYPES.find((candidate) => candidate === blockNameFromKernel(quad.blockId))

const isCutoutQuad = (quad: MeshQuad): boolean => {
  const blockType = blockTypeForQuad(quad)
  return blockType !== undefined && BLOCK_TEXTURE_ALPHA_MODES[blockType] === 'cutout'
}

const splitTransparentSolids = (quads: ReadonlyArray<MeshQuad>) => {
  const cutout: Array<MeshQuad> = []
  const blended: Array<MeshQuad> = []
  for (const quad of quads) {
    if (isCutoutQuad(quad)) {
      cutout.push(quad)
    } else {
      blended.push(quad)
    }
  }
  return { blended, cutout }
}

/** Collect kernel block IDs whose geometry is not a full cube. */
export const KERNEL_BLOCK_SHAPE_KINDS: ReadonlyMap<BlockId, BlockShapeKind> = new Map(
  BLOCK_IDS.flatMap((blockId) => {
    const shape = blockShapeFor(blockId)
    if (shape === undefined) {
      return []
    }
    return [[blockId, shape] as const]
  }),
)

export type RenderMeshConfig = MeshConfig & {
  readonly blockShapeKinds?: ReadonlyMap<BlockId, BlockShapeKind>
}

const EMPTY_BLOCK_SHAPE_KINDS: ReadonlyMap<BlockId, BlockShapeKind> = new Map()

/**
 * Material and shape routing derived from the kernel registry.
 */
export const KERNEL_MESH_CONFIG: RenderMeshConfig = {
  blockShapeKinds: KERNEL_BLOCK_SHAPE_KINDS,
  crossPlantBlockIds: kernelCrossPlantBlockIds(),
  fluidMaxLevels: kernelFluidMaxLevels(),
  transparentSolidBlockIds: Option.getOrElse(
    Result.getOrThrow(blockIdsWithOpacity('transparentSolid')),
    () => new Set<BlockId>(),
  ),
  waterBlockIds: kernelBlockIdsWithFluid('water'),
}

/** The chunk-store fields this adapter consumes until #66 adds state-driven model selection. */
export type MeshingChunkStore = {
  readonly peek: (coord: ChunkCoord) => Effect.Effect<ReadonlyChunk | undefined>
  readonly neighbours: (coord: ChunkCoord) => Effect.Effect<ReadonlyWorldgenChunkNeighbours>
}

/** The worldgen surface needed for renderer attachment, meshing, and light sampling. */
export type RendererChunkStore = MeshingChunkStore & Pick<ChunkStoreApi, 'getLight'> & DirtySubscriptionStore

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
): Effect.Effect<QuadColor, LightQueueUnderflowError> =>
  Effect.gen(function* () {
    const samples = collectLightSamplePositions(chunk, quads)

    const readings = new Map<string, SkyBlockLight>()
    yield* Effect.forEach(samples, ([key, position]) =>
      Effect.map(
        store.getLight(
          blockPosition(BlockAxis(position.blockX), BlockAxis(position.blockY), BlockAxis(position.blockZ)),
        ),
        (reading) => {
        if (reading._tag === 'Light') {
          readings.set(key, {
            block: LightLevelCandidate(reading.block),
            sky: LightLevelCandidate(reading.sky),
          })
          return
        }
        readings.set(key, NO_LIGHT)
        },
      ),
    )

    const sampler: LightSampler = (localX, localY, localZ) => {
      const position = lightSamplePositionFor(chunk, { localX, localY, localZ })
      return readings.get(lightKey(position.blockX, position.blockY, position.blockZ)) ?? NO_LIGHT
    }
    return packedLightColor(sampler)
  })

/**
 * `@nerima-games/mc-worldgen`'s `Chunk` has no `height` field — it is a fixed-height column
 * baked into its own constants (`CHUNK_VOLUME = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ
 * * CHUNK_HEIGHT`), not a per-chunk value. mc-meshing's `ChunkView`
 * added an explicit, required per-chunk `height` for its own variable-height
 * support. This repository is the adapter between the two: every mc-worldgen
 * chunk it hands to mc-meshing today is exactly `CHUNK_HEIGHT` tall, so that
 * constant is the correct (not placeholder) value here — re-exported from
 * `@nerima-games/mc-worldgen`, which is also where mc-meshing's OWN
 * `CHUNK_HEIGHT` (256) draws its "canonical vertical extent" from; the two
 * packages agree on the number. A real variable-height chunk is Wave 1
 * pin-alignment work in mc-worldgen, not something to invent here.
 */
const toChunkView = (chunk: ReadonlyChunk): ChunkView => ({
  // #66 owns passing block state into model selection.
  // Worldgen exposes live read-only buffers, so meshing receives detached storage.
  blocks: new Uint16Array(chunk.blocks),
  coord: chunk.coord,
  height: CHUNK_HEIGHT,
})

type ReadonlyWorldgenChunkNeighbours = Readonly<{
  [Key in keyof WorldgenChunkNeighbours]: ReadonlyChunk
}>

type WorldgenMeshingInput = {
  readonly chunk: ReadonlyChunk
  readonly neighbours: ReadonlyWorldgenChunkNeighbours
}

type MeshingChunkInput = {
  readonly chunk: ChunkView
  readonly neighbours: MeshingChunkNeighbours
}

/** Adapt mc-worldgen's four read-only neighbours to meshing views. */
const toMeshingNeighbours = (neighbours: ReadonlyWorldgenChunkNeighbours): MeshingChunkNeighbours => {
  const adapted: {
    xPos?: ChunkView
    xNeg?: ChunkView
    zPos?: ChunkView
    zNeg?: ChunkView
  } = {}
  if (neighbours.xPos !== undefined) {
    adapted.xPos = toChunkView(neighbours.xPos)
  }
  if (neighbours.xNeg !== undefined) {
    adapted.xNeg = toChunkView(neighbours.xNeg)
  }
  if (neighbours.zPos !== undefined) {
    adapted.zPos = toChunkView(neighbours.zPos)
  }
  if (neighbours.zNeg !== undefined) {
    adapted.zNeg = toChunkView(neighbours.zNeg)
  }
  return adapted
}

const toMeshingChunkInput = ({ chunk, neighbours }: WorldgenMeshingInput): MeshingChunkInput => ({
  chunk: toChunkView(chunk),
  neighbours: toMeshingNeighbours(neighbours),
})

const readWorldgenMeshingInput = ({
  coord,
  store,
}: {
  readonly coord: ChunkCoord
  readonly store: MeshingChunkStore
}): Effect.Effect<WorldgenMeshingInput | undefined> =>
  Effect.gen(function* () {
    const chunk = yield* store.peek(coord)
    if (chunk === undefined) {
      return undefined
    }
    return { chunk, neighbours: yield* store.neighbours(coord) }
  })

const assembleWorldgenMesh = (
  input: MeshingChunkInput,
  config: RenderMeshConfig,
  layers: MeshLayers,
): ChunkMesh => {
    const blockShapeKinds = config.blockShapeKinds ?? EMPTY_BLOCK_SHAPE_KINDS
    const opaque = withoutBlockShapes(layers.opaque, blockShapeKinds)
    const water = withoutBlockShapes(layers.water, blockShapeKinds)
    const transparentSolid = withoutBlockShapes(layers.transparentSolid, blockShapeKinds)
    const { blended, cutout } = splitTransparentSolids(transparentSolid)
    const quads = [...layers.opaque, ...layers.water, ...layers.transparentSolid].filter(
      (quad) => !blockShapeKinds.has(quad.blockId),
    )
    const blockShapes = meshBlockShapes(input.chunk, input.neighbours, blockShapeKinds)
    return Object.assign(quads, {
      blockShapes,
      crossPlants: layers.crossPlants,
      fluids: layers.fluids,
      renderLayers: {
        cutout,
        opaque,
        transparentSolid: blended,
        water,
      },
    })
}

const meshWorldgenChunk = (
  input: MeshingChunkInput,
  config: RenderMeshConfig,
  lod: LodLevel,
): Result.Result<ChunkMesh, ChunkMesherError> =>
  Result.map(meshChunk(input.chunk, input.neighbours, config), (meshedLayers) =>
    assembleWorldgenMesh(input, config, simplifyMesh(meshedLayers, lod)),
  )

type MeshingPool = Pick<
  WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>,
  'submit' | 'cancel' | 'concurrency'
>

export type ChunkStoreMeshingOptions = {
  readonly workerPool?: MeshingPool
} & (
  | { readonly renderDistance?: undefined; readonly cameraChunk?: undefined }
  | { readonly renderDistance: RenderDistanceChunks; readonly cameraChunk: () => ChunkCoord }
)

const LOD_FINEST = 0
const NO_LOD_CHANGES = 0

const selectChunkLod = (
  chunk: ChunkCoord,
  options: ChunkStoreMeshingOptions,
): Result.Result<LodLevel, LodInputError> => {
  if (options.renderDistance === undefined) {
    return Result.succeed(LOD_FINEST)
  }
  const thresholds = lodThresholdsForRenderDistance(options.renderDistance)
  if (Result.isFailure(thresholds)) {
    return Result.fail(thresholds.failure)
  }
  const distance = chunkDistance(options.cameraChunk(), chunk)
  if (Result.isFailure(distance)) {
    return Result.fail(distance.failure)
  }
  return lodForDistance(distance.success, thresholds.success)
}

const chunksWithChangedLod = (
  meshedLods: ReadonlyMap<string, { readonly chunk: ChunkCoord; readonly lod: LodLevel }>,
  cameraChunk: ChunkCoord,
  renderDistance: RenderDistanceChunks,
): Result.Result<ReadonlyArray<ChunkCoord>, ChunkMesherError> => {
  const currentOptions = { cameraChunk: () => cameraChunk, renderDistance }
  const changed: Array<ChunkCoord> = []
  for (const { chunk: coord, lod } of meshedLods.values()) {
    const nextLod = selectChunkLod(coord, currentOptions)
    if (Result.isFailure(nextLod)) {
      return Result.fail(nextLod.failure)
    }
    if (nextLod.success !== lod) {
      changed.push(coord)
    }
  }
  return Result.succeed(changed)
}

const cameraStateAfterRefresh = (
  cameraChunk: ChunkCoord,
  changed: ReadonlyArray<ChunkCoord>,
  reconciledCameraChunk: ChunkCoord | undefined,
): Readonly<{ pending: ChunkCoord | undefined; reconciled: ChunkCoord | undefined }> => {
  if (changed.length === NO_LOD_CHANGES) {
    return { pending: undefined, reconciled: cameraChunk }
  }
  return { pending: cameraChunk, reconciled: reconciledCameraChunk }
}

const computeLodRefresh = ({
  cameraChunk,
  meshedLods,
  reconciledCameraChunk,
  renderDistance,
}: {
  readonly cameraChunk: ChunkCoord
  readonly meshedLods: ReadonlyMap<string, { readonly chunk: ChunkCoord; readonly lod: LodLevel }>
  readonly reconciledCameraChunk: ChunkCoord | undefined
  readonly renderDistance: RenderDistanceChunks
}): Result.Result<{
  readonly changed: ReadonlyArray<ChunkCoord>
  readonly pending: ChunkCoord | undefined
  readonly reconciled: ChunkCoord | undefined
}, ChunkMesherError> => {
  const changed = chunksWithChangedLod(meshedLods, cameraChunk, renderDistance)
  if (Result.isFailure(changed)) {
    return Result.fail(changed.failure)
  }
  const cameraState = cameraStateAfterRefresh(cameraChunk, changed.success, reconciledCameraChunk)
  return Result.succeed({ ...cameraState, changed: changed.success })
}

type MeshedLodTracker = {
  readonly refresh: (() => Result.Result<ReadonlyArray<ChunkCoord>, ChunkMesherError>) | undefined
  readonly remember: (coord: ChunkCoord, lod: LodLevel, mesh: ChunkMesh | undefined) => ChunkMesh | undefined
  readonly remove: (coord: ChunkCoord) => void
}

const makeMeshedLodTracker = (options: ChunkStoreMeshingOptions): MeshedLodTracker => {
  const meshedLods = new Map<string, { readonly chunk: ChunkCoord; readonly lod: LodLevel }>()
  let reconciledCameraChunk: ChunkCoord | undefined = undefined
  let pendingCameraChunk: ChunkCoord | undefined = undefined
  const remember = (coord: ChunkCoord, lod: LodLevel, mesh: ChunkMesh | undefined): ChunkMesh | undefined => {
    if (mesh !== undefined && options.renderDistance !== undefined) {
      meshedLods.set(`${coord.cx},${coord.cz}`, { chunk: coord, lod })
    }
    return mesh
  }
  const { renderDistance } = options
  let refresh: MeshedLodTracker['refresh'] = undefined
  if (renderDistance !== undefined) {
    refresh = () => {
    const cameraChunk = options.cameraChunk()
    if (
      pendingCameraChunk === undefined &&
      reconciledCameraChunk?.cx === cameraChunk.cx &&
      reconciledCameraChunk.cz === cameraChunk.cz
    ) {
      return Result.succeed([])
    }
    const changed = computeLodRefresh({ cameraChunk, meshedLods, reconciledCameraChunk, renderDistance })
    if (Result.isFailure(changed)) {
      return Result.fail(changed.failure)
    }
    reconciledCameraChunk = changed.success.reconciled
    pendingCameraChunk = changed.success.pending
    return Result.succeed(changed.success.changed)
    }
  }
  return { refresh, remember, remove: (coord) => { meshedLods.delete(`${coord.cx},${coord.cz}`) } }
}

const withMesherCapabilities = (
  mesher: ChunkMesher,
  lodTracker: MeshedLodTracker,
  options: ChunkStoreMeshingOptions,
): ChunkMesher => {
  const refreshLod = lodTracker.refresh
  if (options.workerPool === undefined && refreshLod === undefined) {
    return mesher
  }
  const cancelChunk = (coord: ChunkCoord): Effect.Effect<void> => {
    lodTracker.remove(coord)
    return Effect.asVoid(options.workerPool?.cancel(`${coord.cx},${coord.cz}`) ?? Effect.void)
  }
  let enhancedMesher = Object.assign(mesher, { cancel: cancelChunk })
  if (refreshLod !== undefined) {
    enhancedMesher = Object.assign(enhancedMesher, { refreshLod })
  }
  if (options.workerPool !== undefined) {
    enhancedMesher = Object.assign(enhancedMesher, { concurrency: options.workerPool.concurrency })
  }
  return enhancedMesher
}

const meshConfigForWorker = (config: RenderMeshConfig): ChunkMeshingWorkerPayload['config'] => ({
  crossPlantBlockIds: config.crossPlantBlockIds,
  fluidMaxLevels: config.fluidMaxLevels,
  transparentSolidBlockIds: config.transparentSolidBlockIds,
  waterBlockIds: config.waterBlockIds,
})

const meshInWorker = ({
  config,
  input,
  lod,
  workerPool,
  workerKey,
}: {
  readonly config: RenderMeshConfig
  readonly input: MeshingChunkInput
  readonly lod: LodLevel
  readonly workerPool: MeshingPool
  readonly workerKey: string
}): Effect.Effect<ChunkMesh | undefined, ChunkMesherError> =>
  Effect.gen(function* () {
    // Keep the local input attached for block-shape assembly after the worker replies.
    const workerInput = structuredClone(input)
    const outcome = yield* workerPool.submit(workerKey, {
      chunk: workerInput.chunk,
      config: meshConfigForWorker(config),
      lod,
      neighbours: workerInput.neighbours,
    })
    if (outcome._tag === 'cancelled') {
      return undefined
    }
    if (outcome._tag === 'failed') {
      return yield* Effect.fail(outcome.error)
    }
    if (outcome.result._tag === 'failed') {
      return yield* Effect.fail(outcome.result.error)
    }
    return assembleWorldgenMesh(input, config, outcome.result.layers)
  })

/** Adapt a worldgen chunk store to the renderer's pull-based meshing port. */
export const makeChunkStoreMesher = (
  store: MeshingChunkStore,
  config: RenderMeshConfig = KERNEL_MESH_CONFIG,
  options: ChunkStoreMeshingOptions = {},
): ChunkMesher => {
  const { workerPool } = options
  const lodTracker = makeMeshedLodTracker(options)
  const meshPreparedInput = (
    coord: ChunkCoord,
    input: MeshingChunkInput,
    lod: LodLevel,
  ): Effect.Effect<ChunkMesh | undefined, ChunkMesherError> => {
    if (workerPool === undefined) {
      return Effect.map(Effect.fromResult(meshWorldgenChunk(input, config, lod)), (mesh) => lodTracker.remember(coord, lod, mesh))
    }
    return Effect.map(
      meshInWorker({
        config,
        input,
        lod,
        workerKey: `${coord.cx},${coord.cz}`,
        workerPool,
      }),
      (mesh) => lodTracker.remember(coord, lod, mesh),
    )
  }
  const meshChunkFromStore: ChunkMesher = ({ cx, cz }) =>
    Effect.gen(function* () {
      const coord = chunkCoord(ChunkAxis(cx), ChunkAxis(cz))
      const worldgenInput = yield* readWorldgenMeshingInput({ coord, store })
      if (worldgenInput === undefined) {
        return undefined
      }
      const lod = yield* Effect.fromResult(selectChunkLod(coord, options))
      const input = toMeshingChunkInput(worldgenInput)
      return yield* meshPreparedInput(coord, input, lod)
    })

  return withMesherCapabilities(meshChunkFromStore, lodTracker, options)
}

/** `options` with default atlas tiles and chunk lighting, unless the caller supplied overrides. */
const withDefaultColorForChunk = (store: RendererChunkStore, options: SyncOptions): SyncOptions => {
  const tile = options.tile ?? ((quad) => Result.getOrThrow(quadTileForLookup(blockNameFromKernel)(quad)))
  if (options.colorForChunk !== undefined || options.color !== undefined) {
    return { ...options, tile }
  }
  return {
    ...options,
    colorForChunk: (chunk: { readonly cx: number; readonly cz: number }, quads: ReadonlyArray<GeometryQuad>) =>
      makeChunkStoreLightColor(store, chunk, quads),
    tile,
  }
}

/** `attachChunkStoreRenderer` options, including the host-owned distance and optional worker pool. */
export type ChunkStoreRendererOptions = SyncOptions & {
  readonly config?: RenderMeshConfig
  readonly workerPool?: MeshingPool
} & (
  | { readonly renderDistance?: undefined; readonly cameraChunk?: undefined }
  | { readonly renderDistance: RenderDistanceChunks; readonly cameraChunk: () => ChunkCoord }
)

/** Attach the renderer directly to a worldgen ChunkStore subscription. */
export const attachChunkStoreRenderer = (
  renderer: WorldRenderer,
  store: RendererChunkStore,
  options: ChunkStoreRendererOptions = {},
): Effect.Effect<WorldRendererAttachment> => {
  const {
    cameraChunk,
    config = KERNEL_MESH_CONFIG,
    renderDistance,
    workerPool,
    ...syncOptions
  } = options
  const workerPoolOption: { workerPool?: MeshingPool } = {}
  if (workerPool !== undefined) {
    workerPoolOption.workerPool = workerPool
  }
  let meshingOptions: ChunkStoreMeshingOptions = workerPoolOption
  if (renderDistance !== undefined) {
    meshingOptions = { ...workerPoolOption, cameraChunk, renderDistance }
  }
  return attachWorldRenderer(
    renderer,
    store,
    makeChunkStoreMesher(store, config, meshingOptions),
    withDefaultColorForChunk(store, syncOptions),
  )
}
