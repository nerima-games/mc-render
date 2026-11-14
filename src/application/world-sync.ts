/**
 * The chunk-to-screen path: drain what changed, mesh it, put it in the scene.
 *
 * docs/responsibility.md gives this repository 「`ChunkStore.subscribeDirty` を
 * 購読 → メッシュ更新」, and this is that line. It is the last seam between a
 * world that exists in memory and a world that is drawn — before it,
 * `makeWorldRenderer` had `setChunk` and nothing in the organisation called it,
 * so a composed game acquired a WebGL2 context, ran its frame loop, and cleared
 * to sky blue over an empty scene.
 *
 * `syncWorld` takes ports so its state transition remains testable without a
 * generator, mesher or GPU. `application/chunk-store-mesher.ts` is the concrete
 * adapter from the published worldgen and meshing packages to those ports.
 *
 * The consequence worth stating: `syncWorld` is fully testable in Node against
 * a fake that returns three coordinates, with no world generator, no mesher and
 * no GPU. What it CANNOT tell you is whether the resulting pixels are right —
 * `test/support/fake-three.ts`'s header lists that, and mc-compose's Playwright
 * run is the only thing in the organisation that can answer it.
 *
 * ---------------------------------------------------------------------------
 * WHY DRAINING IS PULL AND NOT A CALLBACK
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen's `ChunkDirtySubscription` exposes `drain` — "everything that
 * changed since the previous drain, clears the pending set" — rather than
 * firing per edit, and this file is shaped to that rather than adapting it.
 *
 * The reason is coalescing, and it is the same reason `setChunk` REPLACES
 * rather than adds: a falling column of sand dirties one chunk on every tick of
 * its fall. A callback per edit would re-mesh that chunk once per tick; one
 * drain per frame re-meshes it once per frame, which is the most often anything
 * can be seen. The batch is the unit of work because the frame is.
 */
import { BLOCK_IDS, type BlockId, type ChunkCoord, chunkCoord, propertyOfBlockId } from '@nerima-games/mc-kernel'
import {
  type BlockShapeQuad,
  type CrossPlantQuad,
  type FluidQuad,
  type GeometryQuad,
  type MeshQuad,
  type QuadColor,
  type QuadTile,
  type SpecialBlockQuad,
  buildBlockShapeGeometry,
  buildChunkGeometry,
  buildCrossPlantGeometry,
  buildFluidGeometry,
  combineChunkGeometry,
} from '../domain/chunk-geometry.js'
import type { BlockTextureLookupError, QuadTileLookup } from '../domain/block-texture-map.js'
import { CHUNK_SIZE, meshChunk } from '@nerima-games/mc-meshing'
import { type ChunkGeometryUpdate, type ChunkKey, type WorldRenderer } from './world-renderer.js'
import { Effect, Ref, Result, Schema, Semaphore } from 'effect'
import { type LightQueueUnderflowError, chunkKeyOf as worldgenChunkKeyOf } from '@nerima-games/mc-worldgen'
import type { ChunkMeshingWorkerFailure } from './chunk-meshing-worker.js'
import type { LodInputError } from '../domain/level-of-detail.js'
import type { WorkerCount } from '../domain/worker-parallelism.js'
import type { WorkerPoolFailure } from './worker-pool.js'

/**
 * Which chunk, in chunk coordinates.
 *
 * Structurally mc-worldgen's `ChunkCoord`, so a host passes its own through
 * with no adaptation — but NOT a mirror of it: `ChunkCoord` is branded there
 * and this is not, because nothing here validates a coordinate and a brand this
 * file could mint would be a brand that means nothing.
 */
export type ChunkRef = ChunkCoord

/** What changed since the last drain. Structurally mc-worldgen's `ChunkDirtyBatch`. */
export type DirtyBatch = {
  readonly changed: ReadonlyArray<ChunkRef>
  readonly removed: ReadonlyArray<ChunkRef>
}

/**
 * The one question this file asks the world: what changed?
 *
 * Structurally the `drain` member of mc-worldgen's `ChunkDirtySubscription`, so
 * a host writes `{ drain: subscription.drain }` and is done.
 */
export type DirtySource = {
  readonly drain: Effect.Effect<DirtyBatch>
}

/** The part of mc-worldgen's dirty subscription used by the renderer. */
export type DirtySubscription = DirtySource & {
  readonly unsubscribe: Effect.Effect<void>
}

/** The narrow ChunkStore surface required to attach a renderer. */
export type DirtySubscriptionStore = {
  readonly subscribeDirty: Effect.Effect<DirtySubscription>
}

/**
 * The other question: what are this chunk's visible faces?
 *
 * Returns `undefined` for a chunk that cannot be meshed right now — not an
 * empty array, and the distinction is load-bearing. An EMPTY ARRAY means "this
 * chunk has no visible faces", which is a real and common answer at the edge of
 * the world, and the honest response is to put an empty geometry in the scene.
 * `undefined` means "ask again later" because the chunk itself is not loaded.
 * Missing neighbours do not defer meshing: their boundary faces are drawn, and
 * mc-worldgen dirties the resident neighbour when a chunk arrives or leaves so
 * the seam is meshed again.
 *
 * Collapsing the two would remove a previously visible chunk when a transient
 * lookup cannot supply its contents.
 */
export type ChunkMesh = ReadonlyArray<MeshQuad> & {
  readonly renderLayers?: {
    readonly opaque: ReadonlyArray<MeshQuad>
    readonly cutout: ReadonlyArray<MeshQuad>
    readonly transparentSolid: ReadonlyArray<MeshQuad>
    readonly water: ReadonlyArray<MeshQuad>
  }
  readonly blockShapes?: ReadonlyArray<BlockShapeQuad>
  readonly crossPlants?: ReadonlyArray<CrossPlantQuad>
  readonly specialBlocks?: ReadonlyArray<SpecialBlockQuad>
  readonly fluids?: ReadonlyArray<FluidQuad>
}
type ChunkMeshCollectionField = 'blockShapes' | 'crossPlants' | 'fluids' | 'specialBlocks'
type ChunkMeshGeometryInputField = ChunkMeshCollectionField | 'renderLayers'
type ChunkMeshGeometryInputFailure = Readonly<{
  readonly _tag: 'ChunkMeshGeometryInputFailure'
  readonly field: ChunkMeshGeometryInputField
}>
type ChunkMeshGeometryInput = Readonly<{
  readonly blockShapes: NonNullable<ChunkMesh['blockShapes']>
  readonly crossPlants: NonNullable<ChunkMesh['crossPlants']>
  readonly fluids: NonNullable<ChunkMesh['fluids']>
  readonly renderLayers: NonNullable<ChunkMesh['renderLayers']>
  readonly specialBlocks: NonNullable<ChunkMesh['specialBlocks']>
}>
export type ChunkMesherError = ReturnType<typeof meshChunk> extends Result.Result<unknown, infer Failure>
  ? | Failure
    | BlockTextureLookupError
    | ChunkMeshGeometryInputFailure
    | LightQueueUnderflowError
    | ChunkMeshingWorkerFailure
    | WorkerPoolFailure
    | LodInputError
  : never
export type ChunkMesher = ((chunk: ChunkRef) => Effect.Effect<ChunkMesh | undefined, ChunkMesherError>) & {
  /** Worker-backed meshers expose their fixed pool width to the frame batcher. */
  readonly concurrency?: WorkerCount
  /** Cancel queued/in-flight work when the corresponding chunk unloads. */
  readonly cancel?: (chunk: ChunkRef) => Effect.Effect<void>
  /** Resident chunks whose cached LOD no longer matches the current camera chunk. */
  readonly refreshLod?: () => Result.Result<ReadonlyArray<ChunkRef>, ChunkMesherError>
}

const FLUID_KIND_BY_BLOCK_ID = new Map<BlockId, 'lava' | 'water'>(
  BLOCK_IDS.flatMap((blockId) => {
    const fluid = Result.getOrThrow(propertyOfBlockId(blockId, 'fluid'))
    if (fluid === 'lava' || fluid === 'water') {
      return [[blockId, fluid] as const]
    }
    return []
  }),
)

const splitFluidsByKind = (fluids: ReadonlyArray<FluidQuad>) => {
  const water: Array<FluidQuad> = []
  const transparent: Array<FluidQuad> = []
  for (const fluid of fluids) {
    if (FLUID_KIND_BY_BLOCK_ID.get(fluid.blockId) === 'water') {
      water.push(fluid)
    } else {
      transparent.push(fluid)
    }
  }
  return { transparent, water }
}

type ChunkLayerGeometryBuffers = Pick<
  ChunkGeometryUpdate,
  'buffers' | 'cutoutBuffers' | 'transparentSolidBuffers' | 'waterBuffers'
>

/** How a chunk coordinate becomes the renderer's key. */
export const chunkKeyOf = (chunk: ChunkRef): ChunkKey =>
  worldgenChunkKeyOf(chunkCoord(chunk.cx, chunk.cz))

/**
 * The world-space corner of a chunk.
 *
 * mc-meshing emits chunk-LOCAL positions and says "mc-render applies the
 * offset" (`mc-meshing/domain/mesh.ts:143`), and this is where it is applied.
 * `CHUNK_SIZE` comes from this repository's local LOD vocabulary, backed by the
 * shared kernel constant, rather than a duplicated literal.
 *
 * There is no Y term because there is no vertical chunking: `CHUNK_HEIGHT` is
 * the whole column.
 */
export const chunkOrigin = (chunk: ChunkRef): readonly [number, number] => [
  chunk.cx * CHUNK_SIZE,
  chunk.cz * CHUNK_SIZE,
]

const buildChunkLayerGeometryBuffers = ({
  blockShapes,
  chunk,
  color,
  crossPlants,
  specialBlocks,
  renderLayers,
  tile,
  transparentFluids,
  waterFluids,
}: {
  readonly blockShapes: ReadonlyArray<BlockShapeQuad>
  readonly chunk: ChunkRef
  readonly color: QuadColor | undefined
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly specialBlocks: ReadonlyArray<SpecialBlockQuad>
  readonly renderLayers: NonNullable<ChunkMesh['renderLayers']>
  readonly tile: QuadTile | undefined
  readonly transparentFluids: ReadonlyArray<FluidQuad>
  readonly waterFluids: ReadonlyArray<FluidQuad>
}): ChunkLayerGeometryBuffers => {
  const [originX, originZ] = chunkOrigin(chunk)
  return {
    buffers: combineChunkGeometry(
      buildChunkGeometry(renderLayers.opaque, originX, originZ, color, tile),
      buildBlockShapeGeometry([...blockShapes, ...specialBlocks], originX, originZ, color, tile),
    ),
    cutoutBuffers: combineChunkGeometry(
      buildChunkGeometry(renderLayers.cutout, originX, originZ, color, tile),
      buildCrossPlantGeometry(crossPlants, originX, originZ, color, tile),
    ),
    transparentSolidBuffers: combineChunkGeometry(
      buildChunkGeometry(renderLayers.transparentSolid, originX, originZ, color, tile),
      buildFluidGeometry(transparentFluids, originX, originZ, color, tile),
    ),
    waterBuffers: combineChunkGeometry(
      buildChunkGeometry(renderLayers.water, originX, originZ, color, tile),
      buildFluidGeometry(waterFluids, originX, originZ, color, tile),
    ),
  }
}

const buildChunkLayerGeometryBuffersWithLookup = ({
  blockShapes,
  chunk,
  color,
  crossPlants,
  specialBlocks,
  renderLayers,
  tileLookup,
  transparentFluids,
  waterFluids,
}: {
  readonly blockShapes: ReadonlyArray<BlockShapeQuad>
  readonly chunk: ChunkRef
  readonly color: QuadColor | undefined
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly specialBlocks: ReadonlyArray<SpecialBlockQuad>
  readonly renderLayers: NonNullable<ChunkMesh['renderLayers']>
  readonly tileLookup: QuadTileLookup
  readonly transparentFluids: ReadonlyArray<FluidQuad>
  readonly waterFluids: ReadonlyArray<FluidQuad>
}): Result.Result<ChunkLayerGeometryBuffers, BlockTextureLookupError> => {
  const [originX, originZ] = chunkOrigin(chunk)
  return Result.map(
    Result.all({
      blockShapes: buildBlockShapeGeometry([...blockShapes, ...specialBlocks], originX, originZ, color, {
        resolve: tileLookup,
      }),
      crossPlants: buildCrossPlantGeometry(crossPlants, originX, originZ, color, { resolve: tileLookup }),
      cutout: buildChunkGeometry(renderLayers.cutout, originX, originZ, color, { resolve: tileLookup }),
      opaque: buildChunkGeometry(renderLayers.opaque, originX, originZ, color, { resolve: tileLookup }),
      transparent: buildChunkGeometry(renderLayers.transparentSolid, originX, originZ, color, {
        resolve: tileLookup,
      }),
      transparentFluids: buildFluidGeometry(transparentFluids, originX, originZ, color, { resolve: tileLookup }),
      water: buildChunkGeometry(renderLayers.water, originX, originZ, color, { resolve: tileLookup }),
      waterFluids: buildFluidGeometry(waterFluids, originX, originZ, color, { resolve: tileLookup }),
    }),
    ({ blockShapes: shapes, crossPlants: plants, cutout, opaque, transparent, transparentFluids: transparentFluidGeometry, water, waterFluids: waterFluidGeometry }) => ({
      buffers: combineChunkGeometry(opaque, shapes),
      cutoutBuffers: combineChunkGeometry(cutout, plants),
      transparentSolidBuffers: combineChunkGeometry(transparent, transparentFluidGeometry),
      waterBuffers: combineChunkGeometry(water, waterFluidGeometry),
    }),
  )
}

/** What one `syncWorld` pass did. Diagnostics, and what the tests assert on. */
export type SyncReport = {
  /** Chunks re-meshed and put in the scene. */
  readonly meshed: number
  /** Chunks the mesher deferred by returning `undefined`. */
  readonly deferred: number
  /** Chunks taken out of the scene. */
  readonly removed: number
  /** Typed chunk failures and update-scoped LOD refresh failures, when any occurred. */
  readonly faults?: ReadonlyArray<SyncFault>
}

/** Nothing changed. Allocation-free, and the common case once a world settles. */
export const EMPTY_SYNC_REPORT: SyncReport = { deferred: 0, meshed: 0, removed: 0 }

/** Everything a caller may vary. */
export type SyncOptions = {
  /** Vertex colouring. Defaults to `buildChunkGeometry`'s AO-only grey. */
  readonly color?: QuadColor
  /** Resolve vertex colouring after meshing, for chunk-scoped data such as light. */
  readonly colorForChunk?: (
    chunk: ChunkRef,
    quads: ReadonlyArray<GeometryQuad>,
  ) => Effect.Effect<QuadColor, ChunkMesherError>
  /** Atlas tile per quad. Direct `syncWorld` calls default to the untextured tile. */
  readonly tile?: QuadTile
  /** Typed atlas lookup used by the attached texture path. */
  readonly tileLookup?: QuadTileLookup
}

type ChunkMeshingFault = Readonly<{
  readonly chunk: ChunkRef
  readonly error: ChunkMesherError
}>

type SyncFault = Readonly<{
  readonly chunk: ChunkRef | undefined
  readonly error: ChunkMesherError
}>

type ChunkRenderFault = Readonly<{
  readonly _tag: 'ChunkRenderFault'
  readonly chunk: ChunkRef | undefined
  readonly error: ChunkMesherError
  readonly occurrences: number
}>

/** A renderer's exclusive connection to one ChunkStore dirty subscription. */
export type WorldRendererAttachment = {
  /** Drain and apply at most one coalesced dirty batch. */
  readonly update: Effect.Effect<SyncReport>
  /** Drain accumulated typed render faults without clearing renderer state. */
  readonly drainFaults: Effect.Effect<ReadonlyArray<ChunkRenderFault>>
  /** Unsubscribe once; queued and future updates become no-ops. */
  readonly detach: Effect.Effect<void>
  readonly attached: Effect.Effect<boolean>
}

/** The one frame-driven operation `render:chunk-sync` needs. */
export type ChunkSyncPort = {
  readonly update: Effect.Effect<SyncReport>
}

/** Default for headless callers and previews without a world attachment. */
export const NO_CHUNK_SYNC: ChunkSyncPort = {
  update: Effect.succeed(EMPTY_SYNC_REPORT),
}

/**
 * `syncWorld`'s per-chunk helpers, extracted so the drain-and-apply pass
 * itself reads as three calls rather than one function over the
 * `max-statements` threshold. Ordering (removals before changes) and
 * behaviour are unchanged; see `syncWorld`'s own doc comment for why that
 * order matters.
 */
/** The amount every one-more-chunk counter in this file advances by. */
const COUNT_STEP = 1
const EMPTY_GEOMETRY_COUNT = 0
const DEFAULT_MESHER_CONCURRENCY = 1

/** `options.colorForChunk` wins when given; otherwise the flat `options.color`. */
const resolveChunkColor = (
  options: SyncOptions,
  chunk: ChunkRef,
  quads: ReadonlyArray<GeometryQuad>,
): Effect.Effect<QuadColor | undefined, ChunkMesherError> => {
  if (options.colorForChunk === undefined) {
    return Effect.succeed(options.color)
  }
  return options.colorForChunk(chunk, quads)
}

const colorQuadsForMesh = (
  quads: ReadonlyArray<MeshQuad>,
  blockShapes: ReadonlyArray<BlockShapeQuad>,
  crossPlants: ReadonlyArray<CrossPlantQuad>,
  specialBlocks: ReadonlyArray<SpecialBlockQuad>,
): ReadonlyArray<GeometryQuad> => {
  if (
    crossPlants.length === EMPTY_GEOMETRY_COUNT &&
    blockShapes.length === EMPTY_GEOMETRY_COUNT &&
    specialBlocks.length === EMPTY_GEOMETRY_COUNT
  ) {
    return quads
  }
  return [...quads, ...crossPlants, ...blockShapes, ...specialBlocks]
}

const EMPTY_CHUNK_MESH_COLLECTIONS: Readonly<{
  readonly [Field in ChunkMeshCollectionField]: NonNullable<ChunkMesh[Field]>
}> = {
  blockShapes: [],
  crossPlants: [],
  fluids: [],
  specialBlocks: [],
}

const chunkMeshGeometryInputFailure = (
  field: ChunkMeshGeometryInputField,
): Result.Result<never, ChunkMeshGeometryInputFailure> =>
  Result.fail({ _tag: 'ChunkMeshGeometryInputFailure', field })

const optionalChunkMeshCollection = <Field extends ChunkMeshCollectionField>(
  mesh: ChunkMesh,
  field: Field,
): Result.Result<NonNullable<ChunkMesh[Field]>, ChunkMeshGeometryInputFailure> => {
  if (!Object.hasOwn(mesh, field)) {
    return Result.succeed(EMPTY_CHUNK_MESH_COLLECTIONS[field])
  }
  const collection = mesh[field]
  if (collection === undefined || !Array.isArray(collection)) {
    return chunkMeshGeometryInputFailure(field)
  }
  return Result.succeed(collection)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isChunkMeshRenderLayers = (
  value: unknown,
): value is NonNullable<ChunkMesh['renderLayers']> =>
  isRecord(value) &&
  Object.hasOwn(value, 'cutout') &&
  'cutout' in value &&
  Array.isArray(value['cutout']) &&
  Object.hasOwn(value, 'opaque') &&
  'opaque' in value &&
  Array.isArray(value['opaque']) &&
  Object.hasOwn(value, 'transparentSolid') &&
  'transparentSolid' in value &&
  Array.isArray(value['transparentSolid']) &&
  Object.hasOwn(value, 'water') &&
  'water' in value &&
  Array.isArray(value['water'])

const chunkMeshRenderLayers = (
  mesh: ChunkMesh,
): Result.Result<NonNullable<ChunkMesh['renderLayers']>, ChunkMeshGeometryInputFailure> => {
  if (!Object.hasOwn(mesh, 'renderLayers')) {
    return Result.succeed({
      cutout: [],
      opaque: mesh,
      transparentSolid: [],
      water: [],
    })
  }
  if (!isChunkMeshRenderLayers(mesh.renderLayers)) {
    return chunkMeshGeometryInputFailure('renderLayers')
  }
  return Result.succeed(mesh.renderLayers)
}

const geometryInputForMesh = (
  mesh: ChunkMesh,
): Result.Result<ChunkMeshGeometryInput, ChunkMeshGeometryInputFailure> =>
  Result.all({
    blockShapes: optionalChunkMeshCollection(mesh, 'blockShapes'),
    crossPlants: optionalChunkMeshCollection(mesh, 'crossPlants'),
    fluids: optionalChunkMeshCollection(mesh, 'fluids'),
    renderLayers: chunkMeshRenderLayers(mesh),
    specialBlocks: optionalChunkMeshCollection(mesh, 'specialBlocks'),
  })

const buildLayerGeometryForMesh = (
  geometryInput: ChunkMeshGeometryInput,
  chunk: ChunkRef,
  color: QuadColor | undefined,
  fluidLayers: ReturnType<typeof splitFluidsByKind>,
  options: SyncOptions,
): ReturnType<typeof buildChunkLayerGeometryBuffersWithLookup> => {
  if (options.tileLookup === undefined) {
    return Result.succeed(buildChunkLayerGeometryBuffers({
      blockShapes: geometryInput.blockShapes,
      chunk,
      color,
      crossPlants: geometryInput.crossPlants,
      renderLayers: geometryInput.renderLayers,
      specialBlocks: geometryInput.specialBlocks,
      tile: options.tile,
      transparentFluids: fluidLayers.transparent,
      waterFluids: fluidLayers.water,
    }))
  }
  return buildChunkLayerGeometryBuffersWithLookup({
    blockShapes: geometryInput.blockShapes,
    chunk,
    color,
    crossPlants: geometryInput.crossPlants,
    renderLayers: geometryInput.renderLayers,
    specialBlocks: geometryInput.specialBlocks,
    tileLookup: options.tileLookup,
    transparentFluids: fluidLayers.transparent,
    waterFluids: fluidLayers.water,
  })
}

/** Resolve one changed chunk's mesh, if the mesher has it ready. */
const meshChangedChunk = (
  chunk: ChunkRef,
  mesher: ChunkMesher,
  options: SyncOptions,
): Effect.Effect<ChunkGeometryUpdate | undefined, ChunkMesherError> =>
  Effect.gen(function* () {
    const mesh = yield* mesher(chunk)
    if (mesh === undefined) {
      return undefined
    }
    const geometryInput = yield* Effect.fromResult(geometryInputForMesh(mesh))
    const fluidLayers = splitFluidsByKind(geometryInput.fluids)
    const color = yield* resolveChunkColor(
      options,
      chunk,
      colorQuadsForMesh(mesh, geometryInput.blockShapes, geometryInput.crossPlants, geometryInput.specialBlocks),
    )
    return {
      ...(yield* Effect.fromResult(buildLayerGeometryForMesh(geometryInput, chunk, color, fluidLayers, options))),
      key: chunkKeyOf(chunk),
    }
  })

/** Remove every chunk in the batch, and count how many. */
const removeChunks = (
  renderer: WorldRenderer,
  removedChunks: ReadonlyArray<ChunkRef>,
  mesher: ChunkMesher,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    let removed = 0
    for (const chunk of removedChunks) {
      yield* mesher.cancel?.(chunk) ?? Effect.void
      yield* renderer.removeChunk(chunkKeyOf(chunk))
      removed += COUNT_STEP
    }
    return removed
  })

const includeLodChanges = (
  changedChunks: ReadonlyArray<ChunkRef>,
  lodChangedChunks: ReadonlyArray<ChunkRef>,
): ReadonlyArray<ChunkRef> => {
  const included = new Set(changedChunks.map(chunkKeyOf))
  const combined = [...changedChunks]
  for (const chunk of lodChangedChunks) {
    const key = chunkKeyOf(chunk)
    if (!included.has(key)) {
      included.add(key)
      combined.push(chunk)
    }
  }
  return combined
}

const lodRefreshForMesher = (mesher: ChunkMesher): {
  readonly changedChunks: ReadonlyArray<ChunkRef>
  readonly faults: ReadonlyArray<SyncFault>
} => {
  if (mesher.refreshLod === undefined) {
    return { changedChunks: [], faults: [] }
  }
  const result = mesher.refreshLod()
  if (Result.isFailure(result)) {
    return { changedChunks: [], faults: [{ chunk: undefined, error: result.failure }] }
  }
  return { changedChunks: result.success, faults: [] }
}

type MutableChunkUpdateResults = {
  deferred: number
  faults: Array<ChunkMeshingFault>
  updates: Array<ChunkGeometryUpdate>
}

const collectChunkUpdate = (
  results: MutableChunkUpdateResults,
  chunk: ChunkRef,
  result: Result.Result<ChunkGeometryUpdate | undefined, ChunkMesherError>,
): void => {
  const { faults, updates } = results
  if (Result.isFailure(result)) {
    faults.push({ chunk, error: result.failure })
    return
  }
  if (result.success === undefined) {
    results.deferred += COUNT_STEP
    return
  }
  updates.push(result.success)
}

/** Mesh every changed chunk, splitting the results into applied updates and a deferred count. */
const meshChangedChunks = (
  changedChunks: ReadonlyArray<ChunkRef>,
  mesher: ChunkMesher,
  options: SyncOptions,
): Effect.Effect<
  {
    readonly updates: ReadonlyArray<ChunkGeometryUpdate>
    readonly deferred: number
    readonly faults: ReadonlyArray<ChunkMeshingFault>
  }
> =>
  Effect.gen(function* () {
    const results: MutableChunkUpdateResults = { deferred: 0, faults: [], updates: [] }
    const chunkUpdates = yield* Effect.forEach(
      changedChunks,
      (chunk) => Effect.map(Effect.result(meshChangedChunk(chunk, mesher, options)), (result) => ({ chunk, result })),
      { concurrency: mesher.concurrency ?? DEFAULT_MESHER_CONCURRENCY },
    )
    for (const { chunk, result } of chunkUpdates) {
      collectChunkUpdate(results, chunk, result)
    }
    return results
  })

/**
 * Drain once, and bring the scene up to date.
 *
 * REMOVALS ARE APPLIED BEFORE CHANGES, which matters when a coordinate appears
 * in both lists. `ChunkDirtyBatch` does not promise the two are disjoint — an
 * unload followed by a reload inside one frame puts the same coordinate in
 * each — and the batch describes a set of events, not an ordering. Removing
 * first means the surviving state is "loaded", which is what actually happened;
 * the other order leaves the chunk out of the scene until something dirties it
 * again, and nothing will.
 *
 * ONE DRAIN PER CALL. This does not loop until the batch is empty, because
 * meshing a chunk can dirty its neighbours and a loop would have no bound on a
 * frame's work. The next frame drains what this one produced, which is the same
 * coalescing argument the header makes.
 *
 * FOUR PARAMETERS, NOT AN OPTIONS OBJECT: `renderer`, `source` and `mesher`
 * are called positionally from `test/world-sync.test.ts` (dozens of call
 * sites) and `attachWorldRenderer` below; bundling them would be a breaking
 * signature change reaching into a file this lint pass is not scoped to
 * touch. `max-params` is left un-silenced rather than worked around.
 */
const syncWorldWithFaults = (
  renderer: WorldRenderer,
  source: DirtySource,
  mesher: ChunkMesher,
  options: SyncOptions = {},
): Effect.Effect<Readonly<{ readonly report: SyncReport; readonly faults: ReadonlyArray<SyncFault> }>> =>
  Effect.gen(function* () {
    const batch = yield* source.drain

    const removed = yield* removeChunks(renderer, batch.removed, mesher)
    const lod = lodRefreshForMesher(mesher)
    const changedChunks = includeLodChanges(batch.changed, lod.changedChunks)
    const { deferred, faults, updates } = yield* meshChangedChunks(changedChunks, mesher, options)
    yield* renderer.setChunks(updates)

    const allFaults: Array<SyncFault> = [...lod.faults, ...faults]
    return { faults: allFaults, report: { deferred, meshed: updates.length, removed } }
  })

export const syncWorld = (
  renderer: WorldRenderer,
  source: DirtySource,
  mesher: ChunkMesher,
  options: SyncOptions = {},
): Effect.Effect<SyncReport, ChunkMesherError> =>
  Effect.map(syncWorldWithFaults(renderer, source, mesher, options), ({ faults, report }) => {
    if (faults.length === EMPTY_GEOMETRY_COUNT) {
      return report
    }
    return { ...report, faults }
  })

/** A binary mutex: exactly one permit, so drain/application is atomic with respect to detach. */
const MUTEX_PERMITS = 1

const faultReason = (error: ChunkMesherError): string => {
  if ('reason' in error) {
    const { reason } = error
    return reason
  }
  return ''
}

const faultField = (error: ChunkMesherError): string => {
  if ('field' in error) {
    const { field } = error
    return field
  }
  return ''
}

const renderFaultKey = (fault: Pick<ChunkRenderFault, 'chunk' | 'error'>): string => {
  let chunk = 'stage'
  if (fault.chunk !== undefined) {
    chunk = chunkKeyOf(fault.chunk)
  }
  return `${chunk}:${fault.error._tag}:${faultReason(fault.error)}:${faultField(fault.error)}`
}

const makeRenderFaultQueue = (): Effect.Effect<{
  readonly drain: Effect.Effect<ReadonlyArray<ChunkRenderFault>>
  readonly record: (faults: ReadonlyArray<Readonly<{ readonly chunk: ChunkRef | undefined; readonly error: ChunkMesherError }>>) => Effect.Effect<void>
}> => Effect.gen(function* () {
  const pendingFaults = yield* Ref.make<ReadonlyMap<string, ChunkRenderFault>>(new Map())
  const record = (faults: ReadonlyArray<Readonly<{ readonly chunk: ChunkRef | undefined; readonly error: ChunkMesherError }>>): Effect.Effect<void> =>
    Ref.update(pendingFaults, (current) => {
      const next = new Map(current)
      for (const fault of faults) {
        const key = renderFaultKey(fault)
        const previous = next.get(key)
        if (previous === undefined) {
          next.set(key, { _tag: 'ChunkRenderFault', chunk: fault.chunk, error: fault.error, occurrences: COUNT_STEP })
        } else {
          next.set(key, { ...previous, occurrences: previous.occurrences + COUNT_STEP })
        }
      }
      return next
    })
  const drain = Effect.map(
    Ref.getAndSet(pendingFaults, new Map()),
    (faults) => Array.from(faults.values()),
  )
  return { drain, record }
})

/**
 * Attach a renderer to the published mc-worldgen dirty-subscription lifecycle.
 *
 * Updates are deliberately caller-driven: mc-worldgen's contract is a
 * coalescing pull subscription, so a render frame calls `update` once rather
 * than installing a callback that can mesh the same chunk repeatedly between
 * frames. The mutex makes drain/application atomic with respect to detach and
 * prevents concurrent callers from applying newer geometry before older work.
 *
 * FOUR PARAMETERS, NOT AN OPTIONS OBJECT, for the same reason as `syncWorld`
 * above: `chunk-store-mesher.ts` and `test/world-sync.test.ts` call this
 * positionally and are out of this change's scope.
 */
export const attachWorldRenderer = (
  renderer: WorldRenderer,
  store: DirtySubscriptionStore,
  mesher: ChunkMesher,
  options: SyncOptions = {},
): Effect.Effect<WorldRendererAttachment> =>
  Effect.gen(function* () {
    const subscription = yield* store.subscribeDirty
    const isAttached = yield* Ref.make(true)
    const faultQueue = yield* makeRenderFaultQueue()
    const mutex = yield* Semaphore.make(MUTEX_PERMITS)

    const updateIfAttached = (active: boolean): Effect.Effect<SyncReport> =>
      Effect.gen(function* () {
        if (!active) {
          return EMPTY_SYNC_REPORT
        }
        const result = yield* syncWorldWithFaults(renderer, subscription, mesher, options)
        yield* faultQueue.record(result.faults)
        return result.report
      })

    const unsubscribeIfWasAttached = (wasAttached: boolean): Effect.Effect<void> => {
      if (wasAttached) {
        return subscription.unsubscribe
      }
      return Effect.void
    }

    const update = mutex.withPermits(MUTEX_PERMITS)(Effect.flatMap(Ref.get(isAttached), updateIfAttached))

    const detach = mutex.withPermits(MUTEX_PERMITS)(
      Effect.flatMap(Ref.getAndSet(isAttached, false), unsubscribeIfWasAttached),
    )

    return { attached: Ref.get(isAttached), detach, drainFaults: faultQueue.drain, update }
  })

/**
 * ---------------------------------------------------------------------------
 * Throttling a DirtySource, so one storm of edits does not remesh every
 * dirtied chunk in the same frame
 * ---------------------------------------------------------------------------
 *
 * Lowered from mc-compose's `apps/web/chunk-sync-budget.ts` —
 * not mc-sim's, even though it wraps a `DirtySource`: mc-sim would need to
 * import mc-render's own `chunkKeyOf`/`ChunkRef`/`DirtyBatch`/`DirtySource` to
 * do it, and mc-sim sits UPSTREAM of mc-render (DEPENDENCY_POLICY.md §1) — a
 * sim-to-render import is the cycle that rules it out. mc-sim's own
 * responsibility doc also rules chunk-dirty NOTIFICATION out of its scope
 * (worldgen's `ChunkStore` owns that) and leaves CONSUMING the notification to
 * the renderer, which is this file. `makeBudgetedDirtySource` decorates the
 * same `DirtySource` port `syncWorld` and `attachWorldRenderer` already take —
 * a host wraps the subscription's `DirtySource` in this before handing it to
 * either, and nothing downstream has to know the wrapping happened.
 *
 * WHY A BUDGET AT ALL. mc-worldgen's `ChunkDirtySubscription.drain` coalesces
 * by KEY within one drain (`syncWorld`'s own header: a falling sand column
 * dirties one chunk once per frame, not once per tick), but it does not bound
 * how many DISTINCT chunks one drain can return — a chunk-store flush, a
 * lighting recalculation crossing a wide area, or the very first load can
 * dirty hundreds of chunks in one batch. `syncWorld` has no opinion on how
 * many chunks is too many for one frame, by design (ONE DRAIN PER CALL, no
 * count enforced there — see its own doc comment). This wrapper is where that
 * opinion lives instead, upstream of `syncWorld` rather than inside it.
 *
 * WHY REMOVALS GO FIRST. Same rule `syncWorld` itself applies when a batch
 * contains both a removal and a change for one coordinate (see its own doc
 * comment on why removals apply before changes): `merge` below processes
 * `batch.removed` before `batch.changed`, so a chunk that is both removed and
 * changed within one drain lands in `pendingChanged` — coalescing to
 * "loaded", the state that actually holds. Spending the frame's budget on
 * pending REMOVALS before pending CHANGES, in `drain` below, keeps a chunk
 * actually being unloaded from lingering in the scene behind a queue of
 * unrelated edits.
 *
 * WHY NOTHING IS EVER DROPPED. `merge` only ever MOVES an entry between the
 * two pending maps, or (once spent) out of them; nothing is deleted except by
 * being returned in a batch. Over budget this frame means carried to the
 * next, not lost — the invariant `test/world-sync.test.ts` checks as a
 * property below, across an arbitrary sequence of batches, rather than as one
 * hand-picked example.
 */
export type BudgetedDirtySource = DirtySource & {
  /**
   * Merge a batch in directly, bypassing the wrapped source's own `drain` —
   * for a chunk a host knows is ready (a just-loaded chunk, say) before the
   * underlying subscription next reports it.
   */
  readonly enqueue: (batch: DirtyBatch) => void
}

export type BudgetedDirtySourceInputError = {
  readonly _tag: 'BudgetedDirtySourceInputError'
  readonly reason: 'invalid-frame-budget'
}

export const BudgetedDirtySourceInputErrorSchema: Schema.Codec<BudgetedDirtySourceInputError> = Schema.Struct({
  _tag: Schema.Literal('BudgetedDirtySourceInputError'),
  reason: Schema.Literal('invalid-frame-budget'),
})

type BudgetedDirtySourceResultShape =
  | {
      readonly _tag: 'Success'
      readonly _op: 'Success'
      readonly success: { readonly drain: unknown; readonly enqueue: unknown }
    }
  | {
      readonly _tag: 'Failure'
      readonly _op: 'Failure'
      readonly failure: BudgetedDirtySourceInputError
    }

/** Decode with `onExcessProperty: 'error'` to enforce exact result and error shapes. */
export const BudgetedDirtySourceResultSchema: Schema.Codec<BudgetedDirtySourceResultShape> = Schema.Union([
  Schema.Struct({
    _op: Schema.Literal('Success'),
    _tag: Schema.Literal('Success'),
    success: Schema.Struct({
      drain: Schema.Unknown,
      enqueue: Schema.Unknown,
    }),
  }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: BudgetedDirtySourceInputErrorSchema,
  }),
])

const MIN_UPDATES_PER_FRAME = 1

/** Insertion order is the queue order, so a budget always takes from the front. */
const QUEUE_HEAD = 0

/** Take up to `budget` entries out of `pending`, removing exactly the ones taken. */
const takeBudgeted = (pending: Map<string, ChunkRef>, budget: number): ReadonlyArray<ChunkRef> => {
  const taken = [...pending.values()].slice(QUEUE_HEAD, budget)
  for (const chunk of taken) {
    pending.delete(chunkKeyOf(chunk))
  }
  return taken
}

export const makeBudgetedDirtySource = (
  source: DirtySource,
  maxUpdatesPerFrame: number,
): Result.Result<BudgetedDirtySource, BudgetedDirtySourceInputError> => {
  if (!Number.isInteger(maxUpdatesPerFrame) || maxUpdatesPerFrame < MIN_UPDATES_PER_FRAME) {
    return Result.fail({ _tag: 'BudgetedDirtySourceInputError', reason: 'invalid-frame-budget' })
  }

  const pendingChanged = new Map<string, ChunkRef>()
  const pendingRemoved = new Map<string, ChunkRef>()

  const merge = (batch: DirtyBatch): void => {
    for (const chunk of batch.removed) {
      const key = chunkKeyOf(chunk)
      pendingChanged.delete(key)
      pendingRemoved.set(key, chunk)
    }
    for (const chunk of batch.changed) {
      const key = chunkKeyOf(chunk)
      pendingRemoved.delete(key)
      pendingChanged.set(key, chunk)
    }
  }

  return Result.succeed({
    drain: Effect.gen(function* () {
      merge(yield* source.drain)
      const removed = takeBudgeted(pendingRemoved, maxUpdatesPerFrame)
      const changed = takeBudgeted(pendingChanged, maxUpdatesPerFrame - removed.length)
      return { changed, removed }
    }),
    enqueue: merge,
  })
}
