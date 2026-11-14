import { describe, expect, it } from '@effect/vitest'
import {
  BLOCK_IDS,
  BlockAxis,
  BlockId,
  LocalAxis,
  RenderDistanceChunks,
  blockIdOf,
  encodeBlockState,
  propertyOfBlockId,
  type BlockStateValues,
  type BlockType,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'
import { blockIndex, type FluidQuad, type SpecialBlockQuad } from '@nerima-games/mc-meshing'
import { LightQueueUnderflowError, type Chunk, type ReadonlyChunk } from '@nerima-games/mc-worldgen'
import { emptyBlocks, setBlockAt } from '@nerima-games/mc-worldgen/testing'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  ChunkMeshingWorkerFailureSchema,
  decodeChunkMeshingWorkerRequest,
  processChunkMeshingWorkerRequest,
  type ChunkMeshingWorkerPayload,
  type ChunkMeshingWorkerResult,
} from '../src/application/chunk-meshing-worker'
import {
  attachChunkStoreRenderer,
  blockNameFromKernel,
  KERNEL_BLOCK_SHAPE_KINDS,
  KERNEL_MESH_CONFIG,
  makeChunkStoreLightColor,
  makeChunkStoreMesher,
  type MeshingChunkStore,
  type RendererChunkStore,
} from '../src/application/chunk-store-mesher'
import {
  type JobOutcome,
  type WorkerPool,
  WorkerPoolFailureSchema,
  type WorkerPoolFailure,
} from '../src/application/worker-pool'
import { startMeshingWorkerPool } from '../src/application/meshing-worker-pool.js'
import type {
  BrowserWorkerLike,
  BrowserWorkerMessageEvent,
} from '../src/application/browser-worker-port.js'
import { makeWorldRenderer } from '../src/application/world-renderer'
import { quadTileForLookup } from '../src/domain/block-texture-map'
import { aoShade, POSITION_COMPONENTS, type GeometryQuad } from '../src/domain/chunk-geometry'
import { WorkerCountSchema } from '../src/domain/worker-parallelism.js'
import { LodInputErrorSchema, type LodInputError } from '../src/domain/level-of-detail.js'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'
import { chunkCoord } from './support/kernel-brands'

const INVALID_ENCODED_BLOCK_STATE = 0xffff_ffff
const VIEWPORT = { width: 640, height: 360 }
const workerCount = Schema.decodeUnknownSync(WorkerCountSchema)
const emptyLayers = {
  crossPlants: [],
  fluids: [],
  opaque: [],
  specialBlocks: [],
  transparentSolid: [],
  water: [],
}

const workerPoolWithOutcome = (
  outcome: JobOutcome<ChunkMeshingWorkerResult>,
): Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> => ({
  cancel: () => Effect.succeed(0),
  concurrency: workerCount(1),
  submit: () => Effect.succeed(outcome),
})

const makeMesherWithRuntimeOptions = (
  store: MeshingChunkStore,
  options: unknown,
): ReturnType<typeof makeChunkStoreMesher> =>
  Function.prototype.apply.call(makeChunkStoreMesher, undefined, [store, KERNEL_MESH_CONFIG, options])

const chunk = (cx: number, cz: number, blocks: ReadonlyArray<readonly [number, number, number, number]>): Chunk => {
  const data = emptyBlocks()
  for (const [lx, y, lz, blockId] of blocks) {
    setBlockAt(data, LocalAxis(lx), BlockAxis(y), LocalAxis(lz), BlockId(blockId))
  }
  return {
    coord: chunkCoord(cx, cz),
    blocks: data,
    biomes: Array.from({ length: 16 * 16 }, () => 'PLAINS' as const),
  }
}

type StatefulBlockEntry = {
  readonly blockType: BlockType
  readonly position: readonly [lx: number, y: number, lz: number]
  readonly state: BlockStateValues
}

const blockIdForType = (blockType: BlockType) => Option.getOrThrow(blockIdOf(blockType))

const encodedStateFor = (blockType: BlockType, state: BlockStateValues): number =>
  Result.getOrThrow(encodeBlockState(blockIdForType(blockType), state))

const chunkWithStates = (
  cx: number,
  cz: number,
  entries: ReadonlyArray<StatefulBlockEntry>,
): Chunk & { readonly blockStates: Uint32Array } => {
  const blocks: Array<readonly [number, number, number, number]> = []
  for (const { blockType, position } of entries) {
    const [lx, y, lz] = position
    blocks.push([lx, y, lz, blockIdForType(blockType)])
  }
  const resident = chunk(cx, cz, blocks)
  const blockStates = new Uint32Array(resident.blocks.length)
  blockStates.fill(encodedStateFor('air', {}))
  for (const { blockType, position, state } of entries) {
    const [lx, y, lz] = position
    blockStates[blockIndex(lx, y, lz)] = encodedStateFor(blockType, state)
  }
  return { ...resident, blockStates }
}

const boundsOfExplicitVertices = (
  quads: ReadonlyArray<{ readonly vertices: ReadonlyArray<readonly [number, number, number]> }>,
) => {
  const vertices = quads.flatMap(({ vertices: quadVertices }) => quadVertices)
  const [first] = vertices
  if (first === undefined) {
    throw new Error('expected explicit mesh vertices')
  }
  let [minX, minY, minZ] = first
  let [maxX, maxY, maxZ] = first
  for (const [x, y, z] of vertices) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  return { maxX, maxY, maxZ, minX, minY, minZ }
}

const specialBounds = (quads: ReadonlyArray<SpecialBlockQuad>) => boundsOfExplicitVertices(quads)

const fluidBounds = (quads: ReadonlyArray<FluidQuad>) => boundsOfExplicitVertices(quads)

const neighboursFor = (xPos?: ReadonlyChunk): { xPos?: ReadonlyChunk } => {
  if (xPos === undefined) {
    return {}
  }
  return { xPos }
}

const storeOf = (center?: ReadonlyChunk, xPos?: ReadonlyChunk): MeshingChunkStore => ({
  peek: () => Effect.succeed(center),
  neighbours: () => Effect.succeed(neighboursFor(xPos)),
})

const storeWithNeighbours = (
  center: ReadonlyChunk,
  neighbours: {
    readonly xPos?: ReadonlyChunk
    readonly xNeg?: ReadonlyChunk
    readonly zPos?: ReadonlyChunk
    readonly zNeg?: ReadonlyChunk
  },
): MeshingChunkStore => ({
  peek: () => Effect.succeed(center),
  neighbours: () => Effect.succeed(neighbours),
})

type StructuredCloneWorker = BrowserWorkerLike<ArrayBuffer> & {
  readonly blockStateSidecars: () => ReadonlyArray<{
    readonly cloned: Uint32Array | undefined
    readonly posted: Uint32Array | undefined
  }>
  readonly transferredBuffers: () => ReadonlyArray<ArrayBuffer>
}

const makeStructuredCloneWorker = (): StructuredCloneWorker => {
  let messageListener: (event: BrowserWorkerMessageEvent) => void = () => {
    throw new Error('worker message listener is not installed')
  }
  const transferredBuffers: Array<ArrayBuffer> = []
  const blockStateSidecars: Array<{
    readonly cloned: Uint32Array | undefined
    readonly posted: Uint32Array | undefined
  }> = []
  return {
    addEventListener: (type, listener) => {
      if (type === 'message') {
        messageListener = (event) => Function.prototype.apply.call(listener, undefined, [event])
      }
    },
    postMessage: (message: unknown, transfer?: Array<ArrayBuffer>) => {
      const postedRequest = decodeChunkMeshingWorkerRequest(message)
      const transferList = transfer ?? []
      const workerMessage = structuredClone(message, { transfer: transferList })
      transferredBuffers.push(...transferList)
      const request = decodeChunkMeshingWorkerRequest(workerMessage)
      if (Result.isFailure(request)) {
        throw new Error('structured-cloned worker request did not decode')
      }
      if (Result.isSuccess(postedRequest)) {
        blockStateSidecars.push({
          cloned: request.success.payload.chunk.blockStates,
          posted: postedRequest.success.payload.chunk.blockStates,
        })
      }
      messageListener({ data: processChunkMeshingWorkerRequest(request.success) })
    },
    terminate: () => undefined,
    blockStateSidecars: () => blockStateSidecars,
    transferredBuffers: () => transferredBuffers,
  }
}

describe('makeChunkStoreMesher', () => {
  it.effect('returns undefined when the requested chunk is not resident', () =>
    Effect.gen(function* () {
      const quads = yield* makeChunkStoreMesher(storeOf())(chunkCoord(0, 0))
      expect(quads).toBeUndefined()
    }),
  )

  it.effect('meshes opaque, fluid, and transparent-solid kernel blocks', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [
        [1, 20, 1, 2],
        [4, 20, 1, 6],
        [7, 20, 1, 10],
      ])

      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))

      expect(new Set(quads?.map(({ blockId }) => blockId))).toEqual(new Set([2, 10]))
      expect(quads).toHaveLength(12)
      expect(quads?.fluids?.length).toBeGreaterThan(0)
      expect(new Set(quads?.fluids?.map(({ blockId }) => blockId))).toEqual(new Set([6]))
    }),
  )

  it.effect('selects worker LOD from host distance at the thresholds and their near sides', () =>
    Effect.gen(function* () {
      let requested = chunkCoord(0, 0)
      const store: MeshingChunkStore = {
        peek: () => Effect.succeed(chunk(requested.cx, requested.cz, [])),
        neighbours: () => Effect.succeed({}),
      }
      const observedLods: Array<number> = []
      const layers = {
        crossPlants: [],
        fluids: [],
        opaque: [],
        specialBlocks: [],
        transparentSolid: [],
        water: [],
      }
      const workerPool: Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> = {
        cancel: () => Effect.succeed(0),
        concurrency: workerCount(1),
        submit: (_key, payload) => {
          observedLods.push(payload.lod)
          return Effect.succeed({ _tag: 'completed', result: { _tag: 'meshed', layers } })
        },
      }
      const mesher = makeChunkStoreMesher(store, KERNEL_MESH_CONFIG, {
        cameraChunk: () => chunkCoord(0, 0),
        renderDistance: RenderDistanceChunks(4),
        workerPool,
      })

      for (const distance of [1, 2, 3, 4]) {
        requested = chunkCoord(distance, 0)
        yield* mesher(requested)
      }

      expect(observedLods).toStrictEqual([0, 1, 1, 2])
    }),
  )

  it.effect('transfers worker copies and preserves the store buffer for block-shape assembly', () =>
    Effect.gen(function* () {
      const slabBlockId = BLOCK_IDS.find((blockId) =>
        Result.getOrThrow(propertyOfBlockId(blockId, 'collisionShape')) === 'slab'
      )
      if (slabBlockId === undefined) {
        throw new Error('mc-kernel must expose a slab block')
      }
      const resident = chunk(0, 0, [[4, 20, 4, slabBlockId]])
      const storeBuffer = resident.blocks.buffer
      const worker = makeStructuredCloneWorker()
      const pool = yield* startMeshingWorkerPool({
        createWorker: () => worker,
        workerCount: workerCount(1),
      })
      const mesher = makeChunkStoreMesher(storeOf(resident), KERNEL_MESH_CONFIG, { workerPool: pool })

      const mesh = yield* mesher(chunkCoord(0, 0))

      expect(mesh?.blockShapes).toHaveLength(6)
      expect(new Set(mesh?.blockShapes?.map(({ shape }) => shape))).toStrictEqual(new Set(['slab']))
      expect(storeBuffer.byteLength).toBe(131_072)
      expect(resident.blocks.buffer).toBe(storeBuffer)
      expect(worker.transferredBuffers()).toHaveLength(1)
      expect(worker.transferredBuffers()[0]?.byteLength).toBe(0)

      yield* pool.shutdown
    }),
  )

  it.effect('keeps cancellation and both worker failure layers distinct', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [])
      const requested = chunkCoord(0, 0)
      const cancelledMesher = makeChunkStoreMesher(storeOf(resident), KERNEL_MESH_CONFIG, {
        workerPool: workerPoolWithOutcome({ _tag: 'cancelled' }),
      })
      expect(yield* cancelledMesher(requested)).toBeUndefined()

      let cancelledKey: string | undefined = undefined
      const cancellationPool = {
        ...workerPoolWithOutcome({
          _tag: 'completed',
          result: { _tag: 'meshed', layers: emptyLayers },
        }),
        cancel: (key: string) => {
          cancelledKey = key
          return Effect.succeed(1)
        },
      }
      const cancellableMesher = makeChunkStoreMesher(storeOf(resident), KERNEL_MESH_CONFIG, {
        workerPool: cancellationPool,
      })
      if (cancellableMesher.cancel === undefined) {
        throw new Error('worker-backed mesher must expose its cancellation port')
      }
      yield* cancellableMesher.cancel(requested)
      expect(cancelledKey).toBe('0,0')

      const workerFailure: WorkerPoolFailure = { _tag: 'WorkerPoolFailure', reason: 'worker-failed' }
      const poolFailedMesher = makeChunkStoreMesher(storeOf(resident), KERNEL_MESH_CONFIG, {
        workerPool: workerPoolWithOutcome({ _tag: 'failed', error: workerFailure }),
      })
      const poolFailure = yield* Effect.result(poolFailedMesher(requested))
      expect(Result.isFailure(poolFailure)).toBe(true)
      if (Result.isFailure(poolFailure)) {
        expect(poolFailure.failure).toStrictEqual(workerFailure)
        expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerPoolFailureSchema)(poolFailure.failure))).toBe(true)
      }

      const meshingFailure = { _tag: 'ChunkMeshingWorkerFailure', reason: 'mesh-failed' } as const
      const resultFailedMesher = makeChunkStoreMesher(storeOf(resident), KERNEL_MESH_CONFIG, {
        workerPool: workerPoolWithOutcome({
          _tag: 'completed',
          result: { _tag: 'failed', error: meshingFailure },
        }),
      })
      const meshFailure = yield* Effect.result(resultFailedMesher(requested))
      expect(Result.isFailure(meshFailure)).toBe(true)
      if (Result.isFailure(meshFailure)) {
        expect(meshFailure.failure).toStrictEqual(meshingFailure)
        expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)(meshFailure.failure)))
          .toBe(true)
      }
    }),
  )

  it.effect('validates render-distance and camera chunk failures before selecting an LOD', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [])
      const invalidDistanceMesher = makeMesherWithRuntimeOptions(storeOf(resident), {
        cameraChunk: () => chunkCoord(0, 0),
        renderDistance: 2.5,
      })
      const invalidDistance = yield* Effect.result(invalidDistanceMesher(chunkCoord(0, 0)))
      expect(Result.isFailure(invalidDistance)).toBe(true)
      if (Result.isFailure(invalidDistance)) {
        expect(invalidDistance.failure).toMatchObject({
          _tag: 'LodInputError',
          operation: 'thresholds',
          reason: 'invalid-render-distance',
        } satisfies LodInputError)
        expect(Result.isSuccess(Schema.decodeUnknownResult(LodInputErrorSchema)(invalidDistance.failure))).toBe(true)
      }

      const invalidCameraMesher = makeMesherWithRuntimeOptions(storeOf(resident), {
        cameraChunk: () => ({ cx: Number.MAX_VALUE, cz: 0 }),
        renderDistance: RenderDistanceChunks(4),
      })
      const invalidCamera = yield* Effect.result(invalidCameraMesher(chunkCoord(0, 0)))
      expect(Result.isFailure(invalidCamera)).toBe(true)
      if (Result.isFailure(invalidCamera)) {
        expect(invalidCamera.failure).toMatchObject({
          _tag: 'LodInputError',
          operation: 'chunk-distance',
          reason: 'invalid-chunk-coordinate',
        })
        expect(Result.isSuccess(Schema.decodeUnknownResult(LodInputErrorSchema)(invalidCamera.failure))).toBe(true)
      }
    }),
  )

  it.effect('returns a typed failure when a resident LOD cannot be recomputed after camera movement', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [])
      let cameraChunk: unknown = chunkCoord(0, 0)
      const mesher = makeMesherWithRuntimeOptions(storeOf(resident), {
        cameraChunk: () => cameraChunk,
        renderDistance: RenderDistanceChunks(4),
      })
      yield* mesher(resident.coord)

      cameraChunk = { cx: Number.MAX_VALUE, cz: 0 }
      const { refreshLod } = mesher
      if (refreshLod === undefined) {
        throw new Error('render-distance mesher must expose LOD refresh')
      }
      const refresh = refreshLod()

      expect(Result.isFailure(refresh)).toBe(true)
      if (Result.isFailure(refresh)) {
        const { failure } = refresh
        expect(failure).toMatchObject({
          _tag: 'LodInputError',
          operation: 'chunk-distance',
          reason: 'invalid-chunk-coordinate',
        })
        expect(Result.isSuccess(Schema.decodeUnknownResult(LodInputErrorSchema)(failure))).toBe(true)
      }
    }),
  )

  it.effect('removes a locally meshed chunk from camera LOD refresh when cancelled', () =>
    Effect.gen(function* () {
      const resident = chunk(2, 0, [])
      let cameraChunk: unknown = chunkCoord(0, 0)
      const mesher = makeMesherWithRuntimeOptions(storeOf(resident), {
        cameraChunk: () => cameraChunk,
        renderDistance: RenderDistanceChunks(4),
      })
      yield* mesher(resident.coord)

      const { cancel, refreshLod } = mesher
      if (cancel === undefined || refreshLod === undefined) {
        throw new Error('render-distance mesher must expose cancellation and LOD refresh')
      }
      yield* cancel(resident.coord)
      cameraChunk = chunkCoord(1, 0)

      expect(refreshLod()).toStrictEqual(Result.succeed([]))
    }),
  )

  it.effect('keeps readonly worldgen block storage unchanged while meshing', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[15, 20, 1, 2]])
      const neighbour = chunk(1, 0, [[0, 20, 1, 2]])
      const originalBlocks = resident.blocks.slice()
      const originalNeighbourBlocks = neighbour.blocks.slice()

      yield* makeChunkStoreMesher(storeOf(resident, neighbour))(chunkCoord(0, 0))

      expect(resident.blocks).toStrictEqual(originalBlocks)
      expect(neighbour.blocks).toStrictEqual(originalNeighbourBlocks)
    }),
  )

  it.effect('returns InvalidChunkBlocksLength for a short worldgen chunk', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [])
      const shortChunk = {
        ...resident,
        blocks: resident.blocks.subarray(0, resident.blocks.length - 1),
      }

      const result = yield* Effect.result(makeChunkStoreMesher(storeOf(shortChunk))(chunkCoord(0, 0)))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: 'InvalidChunkBlocksLength',
          actual: resident.blocks.length - 1,
          expected: resident.blocks.length,
        })
      }
    }),
  )

  it.effect('derives fluid and cross-plant routing from kernel properties', () =>
    Effect.gen(function* () {
      const waterId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'fluid')) === 'water')
      const lavaId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'fluid')) === 'lava')
      const plantId = BLOCK_IDS.find((blockId) => Result.getOrThrow(propertyOfBlockId(blockId, 'renderKind')) === 'cross')
      if (waterId === undefined || lavaId === undefined || plantId === undefined) {
        throw new Error('mc-kernel must expose water, lava, and cross-plant block IDs')
      }

      expect(KERNEL_MESH_CONFIG.waterBlockIds.has(waterId)).toBe(true)
      expect(KERNEL_MESH_CONFIG.waterBlockIds.has(lavaId)).toBe(false)
      expect(KERNEL_MESH_CONFIG.fluidMaxLevels?.get(waterId)).toBe(7)
      expect(KERNEL_MESH_CONFIG.fluidMaxLevels?.get(lavaId)).toBe(3)
      expect(KERNEL_MESH_CONFIG.crossPlantBlockIds?.has(plantId)).toBe(true)

      const resident = chunk(0, 0, [[1, 20, 1, plantId]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))

      expect(quads?.crossPlants).toHaveLength(2)
      expect(quads?.crossPlants?.every(({ blockId }) => blockId === plantId)).toBe(true)
    }),
  )

  it.effect('uses resident neighbours to hide shared boundary faces', () =>
    Effect.gen(function* () {
      const center = chunk(0, 0, [[15, 20, 1, 2]])
      const neighbour = chunk(1, 0, [[0, 20, 1, 2]])

      const quads = yield* makeChunkStoreMesher(storeOf(center, neighbour))(chunkCoord(0, 0))

      expect(quads).toHaveLength(5)
      expect(quads?.some(({ direction }) => direction === 'xPos')).toBe(false)
    }),
  )

  it.effect('adapts the x-negative and z neighbours when hiding shared faces', () =>
    Effect.gen(function* () {
      const cases = [
        {
          center: chunk(0, 0, [[0, 20, 1, 2]]),
          neighbour: chunk(-1, 0, [[15, 20, 1, 2]]),
          neighbourKey: 'xNeg',
          hiddenDirection: 'xNeg',
        },
        {
          center: chunk(0, 0, [[1, 20, 15, 2]]),
          neighbour: chunk(0, 1, [[1, 20, 0, 2]]),
          neighbourKey: 'zPos',
          hiddenDirection: 'zPos',
        },
        {
          center: chunk(0, 0, [[1, 20, 0, 2]]),
          neighbour: chunk(0, -1, [[1, 20, 15, 2]]),
          neighbourKey: 'zNeg',
          hiddenDirection: 'zNeg',
        },
      ] as const

      for (const { center, neighbour, neighbourKey, hiddenDirection } of cases) {
        const neighbours = { [neighbourKey]: neighbour }
        const quads = yield* makeChunkStoreMesher(storeWithNeighbours(center, neighbours))(center.coord)

        expect(quads).toHaveLength(5)
        expect(quads?.some(({ direction }) => direction === hiddenDirection)).toBe(false)
      }
    }),
  )

  it.effect('supports a meshing config without local shape routing', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const config = {
        crossPlantBlockIds: KERNEL_MESH_CONFIG.crossPlantBlockIds,
        fluidMaxLevels: KERNEL_MESH_CONFIG.fluidMaxLevels,
        waterBlockIds: KERNEL_MESH_CONFIG.waterBlockIds,
        transparentSolidBlockIds: KERNEL_MESH_CONFIG.transparentSolidBlockIds,
      }

      const quads = yield* makeChunkStoreMesher(storeOf(resident), config)(chunkCoord(0, 0))

      expect(quads).toHaveLength(6)
      expect(quads?.blockShapes).toStrictEqual([])
    }),
  )

  it.effect('uses encoded door states for closed and open panel geometry', () =>
    Effect.gen(function* () {
      const closedChunk = chunkWithStates(0, 0, [
        {
          blockType: 'door',
          position: [2, 20, 3],
          state: { facing: 'north', half: 'lower', hinge: 'left', open: false },
        },
      ])
      const openChunk = chunkWithStates(0, 0, [
        {
          blockType: 'door',
          position: [2, 20, 3],
          state: { facing: 'north', half: 'lower', hinge: 'left', open: true },
        },
      ])
      const closedMesh = yield* makeChunkStoreMesher(storeOf(closedChunk))(chunkCoord(0, 0))
      const openMesh = yield* makeChunkStoreMesher(storeOf(openChunk))(chunkCoord(0, 0))
      const closedDoor = closedMesh?.specialBlocks?.filter(({ kind }) => kind === 'door') ?? []
      const openDoor = openMesh?.specialBlocks?.filter(({ kind }) => kind === 'door') ?? []

      expect(closedDoor.length).toBeGreaterThan(0)
      expect(openDoor.length).toBeGreaterThan(0)
      expect(specialBounds(closedDoor)).toStrictEqual({
        maxX: 3,
        maxY: 21,
        maxZ: 4,
        minX: 2,
        minY: 20,
        minZ: 3 + 13 / 16,
      })
      expect(specialBounds(openDoor)).toStrictEqual({
        maxX: 2 + 3 / 16,
        maxY: 21,
        maxZ: 4,
        minX: 2,
        minY: 20,
        minZ: 3,
      })

      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(closedChunk),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }),
      }
      const attachment = yield* attachChunkStoreRenderer(renderer, store)
      yield* attachment.update
      const uploadedPositions = three.geometries().flatMap((geometry) => {
        const position = geometry.attributes.get('position')
        if (position === undefined || !(position.array instanceof Float32Array)) {
          return []
        }
        return [position.array]
      })
      expect(uploadedPositions.some((positions) => Array.from(positions).includes(3 + 13 / 16))).toBe(true)
    }),
  )

  it.effect('uses stair direction and corner shape in the published special geometry', () =>
    Effect.gen(function* () {
      const straightChunk = chunkWithStates(0, 0, [
        {
          blockType: 'oak_stairs',
          position: [4, 20, 4],
          state: { facing: 'east', half: 'bottom', shape: 'straight' },
        },
      ])
      const outerCornerChunk = chunkWithStates(0, 0, [
        {
          blockType: 'oak_stairs',
          position: [4, 20, 4],
          state: { facing: 'north', half: 'bottom', shape: 'outer_right' },
        },
      ])
      const straightMesh = yield* makeChunkStoreMesher(storeOf(straightChunk))(chunkCoord(0, 0))
      const outerCornerMesh = yield* makeChunkStoreMesher(storeOf(outerCornerChunk))(chunkCoord(0, 0))
      const straightStairs = straightMesh?.specialBlocks?.filter(({ kind }) => kind === 'stairs') ?? []
      const outerCornerStairs = outerCornerMesh?.specialBlocks?.filter(({ kind }) => kind === 'stairs') ?? []
      const topFaces = (quads: ReadonlyArray<SpecialBlockQuad>) =>
        quads.filter(({ direction, vertices }) => direction === 'yPos' && vertices.every(([, y]) => y === 21))

      expect(straightStairs.length).toBeGreaterThan(0)
      expect(outerCornerStairs.length).toBeGreaterThan(0)
      expect(straightStairs.every(({ blockState }) => blockState?.facing === 'east' && blockState.shape === 'straight')).toBe(true)
      expect(outerCornerStairs.every(({ blockState }) => blockState?.facing === 'north' && blockState.shape === 'outer_right')).toBe(true)
      expect(specialBounds(topFaces(straightStairs))).toStrictEqual({
        maxX: 5,
        maxY: 21,
        maxZ: 5,
        minX: 4.5,
        minY: 21,
        minZ: 4,
      })
      expect(specialBounds(topFaces(outerCornerStairs))).toStrictEqual({
        maxX: 5,
        maxY: 21,
        maxZ: 4.5,
        minX: 4.5,
        minY: 21,
        minZ: 4,
      })
    }),
  )

  it.effect('computes water surface height and flow from encoded neighbour states', () =>
    Effect.gen(function* () {
      const resident = chunkWithStates(0, 0, [
        { blockType: 'water', position: [8, 20, 8], state: { level: 7 } },
        { blockType: 'water', position: [3, 20, 3], state: { level: 0 } },
        { blockType: 'water', position: [4, 20, 3], state: { level: 7 } },
      ])
      const mesh = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const fluids = mesh?.fluids ?? []
      const tops = fluids.filter(({ direction }) => direction === 'yPos')
      const isolatedFlow = tops.find(({ vertices }) =>
        vertices.every(([x, , z]) => x >= 8 && x <= 9 && z >= 8 && z <= 9),
      )
      const directedFlow = tops.find(({ vertices }) =>
        vertices.every(([x, , z]) => x >= 4 && x <= 5 && z >= 3 && z <= 4),
      )

      expect(isolatedFlow).toBeDefined()
      expect(directedFlow).toBeDefined()
      expect(fluidBounds([isolatedFlow!]).maxY).toBe(20.125)
      expect(directedFlow?.flow).toStrictEqual({ direction: [1, 0], falling: false })
    }),
  )

  it.effect('routes rail state geometry through mc-meshing without a second local rail shape', () =>
    Effect.gen(function* () {
      const resident = chunkWithStates(0, 0, [
        { blockType: 'rail', position: [10, 20, 10], state: { shape: 'north_south' } },
      ])
      const mesh = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const rails = mesh?.specialBlocks?.filter(({ kind }) => kind === 'rail') ?? []

      expect(KERNEL_BLOCK_SHAPE_KINDS.has(blockIdForType('rail'))).toBe(false)
      expect(mesh?.blockShapes?.some(({ blockId }) => blockId === blockIdForType('rail'))).toBe(false)
      expect(rails.length).toBeGreaterThan(0)
      expect(rails.every(({ blockState }) => blockState?.shape === 'north_south')).toBe(true)
      expect(specialBounds(rails)).toStrictEqual({
        maxX: 11,
        maxY: 20 + 1 / 16,
        maxZ: 11,
        minX: 10,
        minY: 20 + 1 / 16,
        minZ: 10,
      })
    }),
  )

  it.effect('keeps explicit block-state codec failures in the Effect error channel', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, blockIdForType('door')]])
      const blockStates = new Uint32Array(resident.blocks.length)
      blockStates.fill(encodedStateFor('air', {}))
      blockStates[blockIndex(1, 20, 1)] = INVALID_ENCODED_BLOCK_STATE
      const chunkWithInvalidBlockState = { ...resident, blockStates }
      const result = yield* Effect.result(
        makeChunkStoreMesher(storeOf(chunkWithInvalidBlockState))(chunkCoord(0, 0)),
      )

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe('ChunkBlockStateCodecFailure')
      }
    }),
  )
})

describe('blockNameFromKernel', () => {
  it('resolves canonical names and leaves unknown IDs as typed texture lookup failures', () => {
    expect(blockNameFromKernel(BlockId(4))).toBe('grass_block')
    const unknownBlockId = BlockId(255)
    expect(() => blockNameFromKernel(unknownBlockId)).not.toThrow()
    expect(blockNameFromKernel(unknownBlockId)).toBe(unknownBlockId)

    const lookup = quadTileForLookup(blockNameFromKernel)
    const quad = {
      ao: 0,
      blockId: unknownBlockId,
      direction: 'yPos',
      height: 1,
      lx: 0,
      lz: 0,
      role: 'top',
      width: 1,
      y: 0,
    } satisfies GeometryQuad
    expect(() => lookup(quad)).not.toThrow()
    expect(lookup(quad)).toStrictEqual(Result.fail({
      _tag: 'BlockTextureLookupError',
      blockName: unknownBlockId,
      reason: 'unknown-block',
      role: 'top',
    }))
  })
})

describe('attachChunkStoreRenderer', () => {
  it.effect('uploads stage-selected crop atlas tiles through the attached renderer', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunkWithStates(0, 0, [
        { blockType: 'wheat_crop', position: [2, 20, 2], state: { age: 0 } },
        { blockType: 'wheat_crop', position: [4, 20, 2], state: { age: 7 } },
      ])
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }),
      }

      const worker = makeStructuredCloneWorker()
      const pool = yield* startMeshingWorkerPool({
        createWorker: () => worker,
        workerCount: workerCount(1),
      })
      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        color: () => [255, 255, 255],
        workerPool: pool,
      })
      yield* attachment.update
      const renderedVertexTiles = three.geometries().flatMap((geometry) => {
        const tileAttribute = geometry.attributes.get('tileIndex')
        const positionAttribute = geometry.attributes.get('position')
        if (
          tileAttribute === undefined || !(tileAttribute.array instanceof Float32Array) ||
          positionAttribute === undefined || !(positionAttribute.array instanceof Float32Array)
        ) {
          return []
        }
        expect(positionAttribute.array.length).toBe(tileAttribute.array.length * POSITION_COMPONENTS)
        return Array.from(tileAttribute.array, (tileIndex, vertexIndex) => {
          const x = positionAttribute.array[vertexIndex * POSITION_COMPONENTS]
          if (x === undefined) {
            throw new Error('rendered vertex must have an x coordinate')
          }
          return { tileIndex, x }
        })
      })
      expect(worker.blockStateSidecars()).toHaveLength(1)
      const [sidecar] = worker.blockStateSidecars()
      const postedStates = sidecar?.posted
      const clonedStates = sidecar?.cloned
      if (postedStates === undefined || clonedStates === undefined) {
        throw new Error('worker request must carry wheat block states')
      }

      expect(clonedStates).not.toBe(postedStates)
      expect(clonedStates.buffer).not.toBe(postedStates.buffer)
      expect(clonedStates[blockIndex(2, 20, 2)]).toBe(encodedStateFor('wheat_crop', { age: 0 }))
      expect(clonedStates[blockIndex(4, 20, 2)]).toBe(encodedStateFor('wheat_crop', { age: 7 }))
      const tilesForBlockAtX = (blockX: number): ReadonlyArray<number> =>
        [...new Set(
          renderedVertexTiles
            .filter(({ x }) => x >= blockX && x < blockX + 2)
            .map(({ tileIndex }) => tileIndex),
        )].sort((left, right) => left - right)
      expect(tilesForBlockAtX(2)).toStrictEqual([211])
      expect(tilesForBlockAtX(4)).toStrictEqual([388])
      yield* attachment.detach
      yield* pool.shutdown
    }),
  )

  it.effect('fills in a light-sampling colorForChunk when the caller supplies neither color option', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const getLightCalls = yield* Ref.make(0)
      const batches = yield* Ref.make<ReadonlyArray<{ readonly changed: ReadonlyArray<ChunkCoord>; readonly removed: ReadonlyArray<ChunkCoord> }>>([
        { changed: [chunkCoord(0, 0)], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () =>
          Ref.update(getLightCalls, (count) => count + 1).pipe(
            Effect.as({ _tag: 'Light' as const, block: 15, sky: 15 }),
          ),
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store)
      yield* attachment.update

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(yield* Ref.get(getLightCalls)).toBeGreaterThan(0)
    }),
  )

  it.effect('propagates light queue failures through the attached renderer update', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const failure = new LightQueueUnderflowError({ index: 0 })
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(chunk(0, 0, [[1, 20, 1, 2]])),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.fail(failure),
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store)
      const result = yield* Effect.result(attachment.update)

      expect(Result.isFailure(result) && result.failure).toBe(failure)
      yield* attachment.detach
    }),
  )

  it.effect('leaves an explicit color option untouched, and never samples light for it', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const getLightCalls = yield* Ref.make(0)
      const batches = yield* Ref.make<ReadonlyArray<{ readonly changed: ReadonlyArray<ChunkCoord>; readonly removed: ReadonlyArray<ChunkCoord> }>>([
        { changed: [chunkCoord(0, 0)], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () =>
          Ref.update(getLightCalls, (count) => count + 1).pipe(
            Effect.as({ _tag: 'Light' as const, block: 15, sky: 15 }),
          ),
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        color: () => [1, 1, 1],
      })
      yield* attachment.update

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(yield* Ref.get(getLightCalls)).toBe(0)
    }),
  )

  it.effect('passes host LOD and unload cancellation through the attached worker pool', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([
        { changed: [chunkCoord(0, 0)], removed: [] },
        { changed: [], removed: [chunkCoord(0, 0)] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(chunk(0, 0, [])),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light', block: 15, sky: 15 }),
      }
      const submittedLods: Array<number> = []
      const cancelledKeys: Array<string> = []
      const workerPool: Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> = {
        cancel: (key) => {
          cancelledKeys.push(key)
          return Effect.succeed(1)
        },
        concurrency: workerCount(1),
        submit: (_key, payload) => {
          submittedLods.push(payload.lod)
          return Effect.succeed({
            _tag: 'completed',
            result: { _tag: 'meshed', layers: emptyLayers },
          })
        },
      }

      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        cameraChunk: () => chunkCoord(0, 0),
        renderDistance: RenderDistanceChunks(4),
        workerPool,
      })
      yield* attachment.update
      yield* attachment.update

      expect(submittedLods).toStrictEqual([0])
      expect(cancelledKeys).toStrictEqual(['0,0'])
      yield* attachment.detach
      yield* renderer.dispose
    }),
  )

  it.effect('refreshes only resident chunks whose LOD band changes when the camera chunk moves', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const residentChunks = [0, 2, 4, 10].map((cx) => chunk(cx, 0, []))
      const residents = new Map(residentChunks.map((resident) => [`${resident.coord.cx},${resident.coord.cz}`, resident]))
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([
        { changed: residentChunks.map(({ coord }) => coord), removed: [] },
        { changed: [], removed: [] },
        { changed: [], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: (coord) => Effect.succeed(residents.get(`${coord.cx},${coord.cz}`)),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light', block: 15, sky: 15 }),
      }
      let cameraChunk = chunkCoord(0, 0)
      const submissions: Array<readonly [string, number]> = []
      const workerPool: Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> = {
        cancel: () => Effect.succeed(0),
        concurrency: workerCount(1),
        submit: (key, payload) => {
          submissions.push([key, payload.lod])
          return Effect.succeed({ _tag: 'completed', result: { _tag: 'meshed', layers: emptyLayers } })
        },
      }
      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        cameraChunk: () => cameraChunk,
        renderDistance: RenderDistanceChunks(4),
        workerPool,
      })

      yield* attachment.update
      cameraChunk = chunkCoord(1, 0)
      yield* attachment.update
      yield* attachment.update

      expect(submissions).toStrictEqual([
        ['0,0', 0],
        ['2,0', 1],
        ['4,0', 2],
        ['10,0', 2],
        ['2,0', 0],
        ['4,0', 1],
      ])
      yield* attachment.detach
      yield* renderer.dispose
    }),
  )

  it.effect('retries a camera-driven LOD update after the first worker mesh fails', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const resident = chunk(2, 0, [])
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([
        { changed: [resident.coord], removed: [] },
        { changed: [], removed: [] },
        { changed: [], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: () => Effect.succeed(resident),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light', block: 15, sky: 15 }),
      }
      let cameraChunk = chunkCoord(0, 0)
      const submittedLods: Array<number> = []
      const workerFailure: WorkerPoolFailure = { _tag: 'WorkerPoolFailure', reason: 'worker-failed' }
      const workerPool: Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> = {
        cancel: () => Effect.succeed(0),
        concurrency: workerCount(1),
        submit: (_key, payload) => {
          submittedLods.push(payload.lod)
          if (submittedLods.length === 2) {
            return Effect.succeed({ _tag: 'failed', error: workerFailure })
          }
          return Effect.succeed({ _tag: 'completed', result: { _tag: 'meshed', layers: emptyLayers } })
        },
      }
      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        cameraChunk: () => cameraChunk,
        renderDistance: RenderDistanceChunks(4),
        workerPool,
      })

      yield* attachment.update
      cameraChunk = chunkCoord(1, 0)
      const firstRefresh = yield* Effect.result(attachment.update)
      expect(firstRefresh).toStrictEqual(Result.fail(workerFailure))
      yield* attachment.update

      expect(submittedLods).toStrictEqual([1, 0, 0])
      yield* attachment.update
      expect(submittedLods).toStrictEqual([1, 0, 0])
      yield* attachment.detach
      yield* renderer.dispose
    }),
  )

  it.effect('does not refresh an unloaded chunk after the camera moves', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const residentChunks = [chunk(2, 0, []), chunk(4, 0, [])]
      const batches = yield* Ref.make<ReadonlyArray<{
        readonly changed: ReadonlyArray<ChunkCoord>
        readonly removed: ReadonlyArray<ChunkCoord>
      }>>([
        { changed: residentChunks.map(({ coord }) => coord), removed: [] },
        { changed: [], removed: [chunkCoord(2, 0)] },
        { changed: [], removed: [] },
      ])
      const store: RendererChunkStore = {
        peek: (coord) => Effect.succeed(residentChunks.find(({ coord: candidate }) =>
          candidate.cx === coord.cx && candidate.cz === coord.cz
        )),
        neighbours: () => Effect.succeed({}),
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [next ?? { changed: [], removed: [] }, rest]),
          unsubscribe: Effect.void,
        }),
        getLight: () => Effect.succeed({ _tag: 'Light', block: 15, sky: 15 }),
      }
      let cameraChunk = chunkCoord(0, 0)
      const submissions: Array<readonly [string, number]> = []
      const cancelledKeys: Array<string> = []
      const workerPool: Pick<WorkerPool<ChunkMeshingWorkerPayload, ChunkMeshingWorkerResult>, 'cancel' | 'concurrency' | 'submit'> = {
        cancel: (key) => {
          cancelledKeys.push(key)
          return Effect.succeed(1)
        },
        concurrency: workerCount(1),
        submit: (key, payload) => {
          submissions.push([key, payload.lod])
          return Effect.succeed({ _tag: 'completed', result: { _tag: 'meshed', layers: emptyLayers } })
        },
      }
      const attachment = yield* attachChunkStoreRenderer(renderer, store, {
        cameraChunk: () => cameraChunk,
        renderDistance: RenderDistanceChunks(4),
        workerPool,
      })

      yield* attachment.update
      yield* attachment.update
      cameraChunk = chunkCoord(1, 0)
      yield* attachment.update

      expect(cancelledKeys).toStrictEqual(['2,0'])
      expect(submissions).toStrictEqual([
        ['2,0', 1],
        ['4,0', 2],
        ['4,0', 1],
      ])
      yield* attachment.detach
      yield* renderer.dispose
    }),
  )

})

describe('makeChunkStoreLightColor', () => {
  it.effect('falls back to NO_LIGHT for a sample the store cannot answer, distinctly from a real reading', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const [quad] = quads ?? []
      if (quad === undefined) {
        throw new Error('expected at least one quad from the fixture chunk')
      }

      const unansweredColor = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'ChunkNotLoaded' as const }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )
      const litColor = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )

      // NO_LIGHT (block: 0, sky: 0) and a full (15, 15) reading must shade the
      // same quad differently — this is the assertion that would fail if the
      // `_tag !== 'Light'` branch silently used the wrong fallback value.
      expect(unansweredColor(quad)).not.toStrictEqual(litColor(quad))
      expect(unansweredColor(quad)).toStrictEqual([aoShade(quad.ao), 0, 0])
    }),
  )

  it.effect('the sampler falls back to NO_LIGHT for a position outside what it pre-fetched', () =>
    Effect.gen(function* () {
      const resident = chunk(0, 0, [[1, 20, 1, 2]])
      const quads = yield* makeChunkStoreMesher(storeOf(resident))(chunkCoord(0, 0))
      const [quad] = quads ?? []
      if (quad === undefined) {
        throw new Error('expected at least one quad from the fixture chunk')
      }

      // No quads passed in means `readings` is built empty, so every sampler
      // lookup the returned `QuadColor` makes is a cache miss — proving the
      // sampler's own `?? NO_LIGHT` (not the getLight-tag fallback covered
      // above) is real, not merely unreachable dead code.
      const colorFromNothingPrefetched = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        [],
      )
      const colorFromPrefetched = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed({ _tag: 'Light' as const, block: 15, sky: 15 }) },
        { cx: 0, cz: 0 },
        quads ?? [],
      )

      expect(colorFromNothingPrefetched(quad)).not.toStrictEqual(colorFromPrefetched(quad))
    }),
  )
})
