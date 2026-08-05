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
import { Effect, Ref } from 'effect'
import { buildChunkGeometry, buildFluidGeometry, combineChunkGeometry, type FluidQuad, type MeshQuad, type QuadColor, type QuadTile } from '../domain/chunk-geometry'
import { CHUNK_SIZE } from '../domain/lod-vocabulary'
import type { ChunkGeometryUpdate, ChunkKey, WorldRenderer } from './world-renderer'

/**
 * Which chunk, in chunk coordinates.
 *
 * Structurally mc-worldgen's `ChunkCoord`, so a host passes its own through
 * with no adaptation — but NOT a mirror of it: `ChunkCoord` is branded there
 * and this is not, because nothing here validates a coordinate and a brand this
 * file could mint would be a brand that means nothing.
 */
export type ChunkRef = {
  readonly cx: number
  readonly cz: number
}

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

/** The lifecycle-bearing dirty API published by mc-worldgen's ChunkStore. */
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
export type ChunkMesh = ReadonlyArray<MeshQuad> & { readonly fluids?: ReadonlyArray<FluidQuad> }
export type ChunkMesher = (chunk: ChunkRef) => Effect.Effect<ChunkMesh | undefined>

/** How a chunk coordinate becomes the renderer's key. */
export const chunkKeyOf = (chunk: ChunkRef): ChunkKey => `${chunk.cx},${chunk.cz}`

/**
 * The world-space corner of a chunk.
 *
 * mc-meshing emits chunk-LOCAL positions and says "mc-render applies the
 * offset" (`mc-meshing/domain/mesh.ts:143`), and this is where it is applied.
 * `CHUNK_SIZE` comes from `domain/lod-vocabulary.ts`, which is the mirror that
 * already carries it — not a 16 typed here.
 *
 * There is no Y term because there is no vertical chunking: `CHUNK_HEIGHT` is
 * the whole column.
 */
export const chunkOrigin = (chunk: ChunkRef): readonly [number, number] => [
  chunk.cx * CHUNK_SIZE,
  chunk.cz * CHUNK_SIZE,
]

/** What one `syncWorld` pass did. Diagnostics, and what the tests assert on. */
export type SyncReport = {
  /** Chunks re-meshed and put in the scene. */
  readonly meshed: number
  /** Chunks the mesher deferred by returning `undefined`. */
  readonly deferred: number
  /** Chunks taken out of the scene. */
  readonly removed: number
}

/** Nothing changed. Allocation-free, and the common case once a world settles. */
export const EMPTY_SYNC_REPORT: SyncReport = { meshed: 0, deferred: 0, removed: 0 }

/** Everything a caller may vary. */
export type SyncOptions = {
  /** Vertex colouring. Defaults to `buildChunkGeometry`'s AO-only grey. */
  readonly color?: QuadColor
  /** Resolve vertex colouring after meshing, for chunk-scoped data such as light. */
  readonly colorForChunk?: (
    chunk: ChunkRef,
    quads: ReadonlyArray<MeshQuad>,
  ) => Effect.Effect<QuadColor>
  /** Atlas tile per quad. Defaults to the untextured tile. */
  readonly tile?: QuadTile
}

/** A renderer's exclusive connection to one ChunkStore dirty subscription. */
export type WorldRendererAttachment = {
  /** Drain and apply at most one coalesced dirty batch. */
  readonly update: Effect.Effect<SyncReport>
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
 */
export const syncWorld = (
  renderer: WorldRenderer,
  source: DirtySource,
  mesher: ChunkMesher,
  options: SyncOptions = {},
): Effect.Effect<SyncReport> =>
  Effect.gen(function* () {
    const batch = yield* source.drain

    let removed = 0
    for (const chunk of batch.removed) {
      yield* renderer.removeChunk(chunkKeyOf(chunk))
      removed += 1
    }

    let meshed = 0
    let deferred = 0
    const updates: Array<ChunkGeometryUpdate> = []
    for (const chunk of batch.changed) {
      const mesh = yield* mesher(chunk)
      if (mesh === undefined) {
        deferred += 1
        continue
      }
      const quads = mesh
      const fluids = mesh.fluids ?? []
      const [originX, originZ] = chunkOrigin(chunk)
      const color = options.colorForChunk === undefined
        ? options.color
        : yield* options.colorForChunk(chunk, quads)
      updates.push({
        key: chunkKeyOf(chunk),
        buffers: combineChunkGeometry(
          buildChunkGeometry(quads, originX, originZ, color, options.tile),
          buildFluidGeometry(fluids, originX, originZ, color, options.tile),
        ),
      })
      meshed += 1
    }
    yield* renderer.setChunks(updates)

    return { meshed, deferred, removed }
  })

/**
 * Attach a renderer to the published mc-worldgen dirty-subscription lifecycle.
 *
 * Updates are deliberately caller-driven: mc-worldgen's contract is a
 * coalescing pull subscription, so a render frame calls `update` once rather
 * than installing a callback that can mesh the same chunk repeatedly between
 * frames. The mutex makes drain/application atomic with respect to detach and
 * prevents concurrent callers from applying newer geometry before older work.
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
    const mutex = yield* Effect.makeSemaphore(1)

    const update = mutex.withPermits(1)(
      Effect.flatMap(Ref.get(isAttached), (active) =>
        active
          ? syncWorld(renderer, subscription, mesher, options)
          : Effect.succeed(EMPTY_SYNC_REPORT),
      ),
    )

    const detach = mutex.withPermits(1)(
      Effect.flatMap(
        Ref.getAndSet(isAttached, false),
        (wasAttached) => wasAttached ? subscription.unsubscribe : Effect.void,
      ),
    )

    return { update, detach, attached: Ref.get(isAttached) }
  })
